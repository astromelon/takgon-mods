# Implementation Plan: 파이프라인 수정 범위 가드(M3) + 게이트 패널 탭(M6)

**Status**: 🔄 In Progress
**Started**: 2026-11-10
**Last Updated**: 2026-11-10
**Estimated Completion**: 2026-11-12

---

**⚠️ CRITICAL INSTRUCTIONS**: 각 페이즈를 마친 뒤:
1. ✅ 끝낸 작업 체크박스에 표시한다
2. 🧪 품질 게이트 검증 명령을 모두 실행한다
3. ⚠️ 품질 게이트 항목이 모두 통과했는지 확인한다
4. 📅 위의 "Last Updated" 날짜를 고친다
5. 📝 Notes 섹션에 배운 점을 적는다
6. ➡️ 그다음에만 다음 페이즈로 넘어간다

⛔ **품질 게이트를 건너뛰거나 실패한 채로 넘어가지 않는다**

---

## 📋 Overview

### Feature Description
`ai-global-pipeline`(4개 AI CLI 공용 유지보수 파이프라인)과 연동하는 두 기능이다.

1. **수정 범위 가드 (M3 edit 확장):** 파이프라인 [Handoff] 계획서(`git rev-parse --git-path ai-task.md`, 보통
   `.git/ai-task.md`)의 `# 변경 대상 파일`에 없는 저장소 파일을 Edit·Write로 고치면 `tool.call`에서 거부한다.
   계획서의 `# 브랜치` 값이 현재 git 브랜치와 같을 때만 켜진다. 지금은 문서로 지시만 하는 "변경 범위" 규칙을 실제로 강제한다.
2. **게이트 패널 탭 (M6 panel 확장):** `/panel gate` 탭에 Node 4 게이트 차단 로그(Claude·agy·Codex)와 동기화 테스트
   이벤트(`~/.ai-gate/.sync-events.json`)를 보여 준다. 새 동기화 실패는 이벤트마다 한 번 toast로 알린다.

### Success Criteria
- [ ] 계획서 브랜치 = 현재 브랜치일 때, 목록 밖 저장소 파일의 Edit·Write가 거부되고 사유에 허용 목록과 고치는 방법이 나온다
- [ ] 계획서 없음, 브랜치 불일치, git 없음, 저장소 밖 경로, `.git/` 안 경로에서는 지금처럼 동작한다(회귀 없음)
- [ ] 기존 `/edit <path>:<start>-<end>` 범위 가드와 함께 켜져 있으면 둘 다 통과해야 수정된다
- [ ] `/panel gate`에서 3개 도구의 최근 차단 내역(시각·도구·판정·걸린 항목·명령 요약)과 최근 동기화 결과가 보인다
- [ ] 새 동기화 실패 이벤트는 이벤트 id마다 한 번만 toast로 알린다. `/clear` 뒤에도 다시 알리지 않는다
- [ ] `claude plugin validate .`, `claude plugin test .`, `tsc`가 통과한다

### User Impact
- 무인 [Handoff] 흐름에서 Claude가 계획 밖 파일을 건드리는 일을 지시가 아니라 장치로 막는다.
- 지금은 모델 쪽 알림과 한 줄 메시지로만 전달되는 게이트 차단·동기화 실패를 사람이 패널에서 직접 본다.

---

## 🏗️ Architecture Decisions

| Decision | Rationale | Trade-offs |
|----------|-----------|------------|
| 범위 가드를 **기존 M3 `tool.call` Edit/Write 훅 안**에 넣는다(새 훅 등록 X) | `.catch`가 답하면 같은 플러그인 뒤쪽 훅이 건너뛰어진다(engine-constraints). 한 훅에서 "계획서 범위 → `/edit` 범위" 순서로 판정해야 순서가 확정된다 | M3 훅이 길어진다 → 판정은 `logic.ts` 순수 함수로 뺀다 |
| 활성 조건: 계획서 `# 브랜치` = `git branch --show-current` | 계획서는 지워지지 않고 다음 작업에서 덮어쓰인다. 파일이 있다는 것만으로 켜면 지난 계획서가 무관한 작업을 막는다(사용자 결정 2026-11-10) | 파이프라인 마스터 규칙의 계획서 형식에 `# 브랜치`를 추가해야 한다(Phase 3) |
| 예상한 비활성 상황(git 없음·저장소 아님·계획서 없음·`# 브랜치` 없음·불일치)은 **허용**, 예상 못 한 예외는 기존 `.catch`대로 **거부** | git이 없는 프로젝트에서 모든 수정이 막히면 안 된다. 반대로 가드 버그는 조용히 통과시키지 않는다(M3 기존 정책) | 가드 버그가 나면 모든 Edit·Write가 막힐 수 있다 → 통합 테스트로 덮는다 |
| 저장소 밖 경로(scratchpad·memory·`~/.claude`)와 `.git/` 안(계획서 자체)은 판정 대상에서 뺀다 | 계획서 작성, 메모리 기록은 계획 범위와 무관하다 | 저장소 안 생성물(빌드 출력 등)도 목록에 없으면 막힌다 → 사유 문구에 계획서 수정 방법을 넣는다 |
| 경로 비교는 `git rev-parse --show-toplevel` 기준 상대 경로, `/` 구분, Windows는 대소문자 무시 | 기존 `resolvePath`·`isSamePath`를 다시 쓴다 | – |
| 게이트 로그는 `$.fs.read`로 직접 읽는다(`gate_report.py --json`은 쓰지 않음) | Python 의존을 없애고, 형식이 단순한 JSONL이다. 1MB 회전이라 4MiB 읽기 한도 안이다 | 로그 형식이 바뀌면 이쪽 파서도 고쳐야 한다 → 필드가 없으면 건너뛰는 관대한 파서 |
| 홈 경로: `$.env.get('USERPROFILE')`, 없으면 `$.env.get('HOME')` | `$.env.get` 인자는 리터럴이어야 한다(CLAUDE.md) | – |
| 동기화 이벤트는 `session.measure`(M6가 이미 matcher 없이 등록)에서 `$.fs.stat` mtime이 바뀌었을 때만 다시 읽는다 | 턴마다 큰 파일을 파싱하지 않는다. render 훅에서는 무거운 작업이 금지돼 있다 | 턴이 끝날 때만 갱신된다(실시간 아님) |
| toast 중복 방지: 마지막으로 알린 이벤트 id를 전역 store `g/m6/syncSeen`에 둔다. 처음이면 최신 이벤트가 실패일 때만 알린다 | `sync_test_hook.py`의 세션별 알림 규칙과 같은 의미. `/clear` 뒤에도 다시 알리지 않는다 | 여러 Claude 세션이 같은 store를 쓰면 먼저 본 세션만 알린다(의도) |

---

## 📦 Dependencies

### Required Before Starting
- [ ] 작업 브랜치: takgon-mods `feat/pipeline-scope-gate-panel`, ai-global-pipeline 원본(`~/.ai-gate` 등) 쪽은 Phase 3에서 따로
- [ ] `claude --plugin-dir .`로 생성된 `.claude-plugin/types/claude-code/index.d.ts` 확인(`$.fs.stat`·`$.process.run`·`$.env.get` 시그니처)

### External Dependencies
- 런타임: git(범위 가드), ai-global-pipeline 설치본(게이트 탭; 없으면 "기록 없음"으로 표시)
- 새 npm 의존성 없음

---

## 🧪 Test Strategy

### Testing Approach
**TDD**: 테스트를 먼저 쓰고 구현한다. 테스트 도구는 `claude-code/testing`(`claude plugin test .`)이며 커버리지 측정 도구가 없으므로,
아래 시나리오 체크리스트로 커버리지를 판단한다. 엔진 op는 test `on`에서 `{ value }`/`{ deny }`로 답한다(docs/issues/07).

| Test Type | 대상 | 파일 |
|-----------|------|------|
| Unit | 계획서 파싱·범위 판정, 로그·이벤트 파싱·새 실패 선별 | `tests/m3-edit.test.tsx`, `tests/m6-panel.test.tsx` |
| Integration | `tool.call` Edit/Write + `process.run`(git)·`fs.read` 목, `session.measure` + `fs.stat`/`fs.read`/`store` 목 | 같은 파일 |
| E2E(수동) | 실제 세션에서 거부·탭·toast 확인 | Phase 6 체크리스트 |

---

## 🚀 Implementation Phases

### Phase 1: 계획서 범위 판정 순수 로직 (M3)
**Goal**: 계획서 텍스트와 파일 경로만으로 허용/거부를 판정하는 순수 함수
**Estimated Time**: 1.5h
**Status**: ✅ Complete

**🔴 RED**
- [x] **Test 1.1** `parsePlanScope(text)` → `{ branch?: string, files: string[] }`
  - `# 브랜치` 아래 첫 비어 있지 않은 줄(백틱 제거). 없으면 `branch` 없음
  - `# 변경 대상 파일` 아래 목록 줄(`-`/`*`/`1.`)에서 백틱 안 경로, 없으면 첫 토큰. `(신규)` 같은 꼬리 주석 제거
  - 다음 `# ` 제목에서 섹션 끝. CRLF, 빈 섹션, 섹션 중복(첫 번째만)
- [x] **Test 1.2** `judgeScope({ top, gitDir, filePath, files })` → `{ isAllowed: true, reason: 'outside-repo' | 'git-dir' | 'listed' } | { isAllowed: false }`
  - 목록에 있는 파일(상대·절대·`\` 구분·대소문자 차이) 허용, 목록 밖 거부
  - 저장소 밖 경로, `.git/` 안(워크트리의 `.git` 파일이 가리키는 gitDir 포함) 허용
  - 목록에 디렉터리(`src/m3-edit/`)가 있으면 그 아래 허용

**🟢 GREEN**
- [x] **Task 1.3** `src/m3-edit/logic.ts`에 두 함수 구현(기존 `resolvePath`·`isSamePath` 재사용)

**🔵 REFACTOR**
- [x] **Task 1.4** 경로 정규화 중복 정리, JSDoc

#### Quality Gate ✋
- [x] 1.1·1.2 테스트가 먼저 실패했고 구현 뒤 통과
- [x] `claude plugin test .` 전체 통과, `npx -p typescript tsc -p .` 통과

---

### Phase 2: 수정 범위 가드를 Edit·Write 훅에 연결 (M3)
**Goal**: 실제 `tool.call`에서 계획서 범위 밖 수정을 거부
**Estimated Time**: 2.5h
**Status**: ✅ Complete
**Depends on**: Phase 1

**🔴 RED** (`tests/m3-edit.test.tsx`, `process.run`·`fs.read`·`fs.exists` 목)
- [x] **Test 2.1** 브랜치 일치 + 목록 밖 Edit → `{ deny }`, 사유에 허용 파일 목록과 "계획서 `# 변경 대상 파일`에 추가" 안내
- [x] **Test 2.2** 브랜치 일치 + 목록 안 Edit → 통과(`next` 호출). Write도 같은 판정
- [x] **Test 2.3** 비활성 → 통과: 계획서 없음 / `# 브랜치` 없음 / 브랜치 불일치 / `git` 종료 코드 ≠ 0 / 저장소 밖 경로 / `.git/ai-task.md` 자체
- [x] **Test 2.4** `/edit a.ts:3-5` 범위와 동시 활성: 계획서 통과 + 범위 밖 → 기존 범위 거부 문구, 계획서 거부가 먼저
- [x] **Test 2.5** 모듈 off(`/mods edit off`)면 범위 가드도 끈다
- [x] **Test 2.6** `/edit`(인자 없음) 출력에 계획서 범위 활성 여부·브랜치·파일 수 표시

**🟢 GREEN**
- [x] **Task 2.7** `src/m3-edit/index.tsx`: 같은 파일 최상위에 `planScopeFor($, filePath)` 헬퍼
  - `git rev-parse --show-toplevel --git-dir --git-path ai-task.md`(1회) + `git branch --show-current`(1회)를 `$.process.run`(cwd = 세션 루트, `timeoutMs` 지정)
  - 비활성 사유면 `undefined`, 활성이면 판정 결과
- [x] **Task 2.8** Edit·Write 훅 맨 앞에서 판정, 거부 시 `{ deny }`. 기존 `.catch` 정책 유지
- [x] **Task 2.9** `messages.ts`에 ko/en 문구(`edit.deny.plan`, `edit.plan.active`, `edit.plan.inactive`)

**🔵 REFACTOR**
- [x] **Task 2.10** Edit 1회당 추가 지연 측정(git 2회). 50ms를 넘으면 `$.clock` 기준 짧은 캐시(예: 2초, 브랜치·계획서 mtime 키) 검토 — 측정 결과를 Notes에 기록

#### Quality Gate ✋
- [x] 2.1~2.6 RED → GREEN 확인, 기존 m3 테스트 무변경 통과
- [x] `claude plugin validate .`(matcher·`$` 경계 규칙), `claude plugin test .`, `tsc` 통과
- [x] 지연 측정값 기록(측정한 경우에만 "빨라졌다/괜찮다"고 적는다)

---

### Phase 3: 파이프라인 계획서 형식에 `# 브랜치` 추가 (ai-global-pipeline)
**Goal**: Claude가 쓰는 계획서에 브랜치가 들어가 가드가 실제로 켜지게 한다
**Estimated Time**: 0.5h
**Status**: ✅ Complete (ai-global-pipeline `main` bf2c6d6 반영)
**Depends on**: 없음(Phase 2와 병행 가능). 이 페이즈는 **takgon-mods 저장소 밖** 작업이다

- [x] **Task 3.1** 마스터 `~/.ai-global-pipeline.md` [Handoff] "계획서 형식"에 `# 브랜치`(Node 2에서 만든 브랜치명)를 `# 작업` 다음에 추가
- [x] **Task 3.2** `python ~/.ai-gate/sync_pipeline_rules.py` → `--check` 종료 코드 0
- [x] **Task 3.3** `python ~/.ai-gate/test_gate_hooks_in_sync.py -v` 통과
- [x] **Task 3.4** `python ~/.ai-gate/export_public_repo.py --test`로 `C:\dev\ai-global-pipeline` 반영, 그 저장소에서 별도 브랜치·Node 4 승인 절차

#### Quality Gate ✋
- [x] 동기화 테스트 전체 통과, 사본 4곳 갱신 확인
- [x] 공개 저장소 내보내기 유출 검사 통과(종료 코드 0)

---

### Phase 4: 게이트 로그·동기화 이벤트 파싱 순수 로직 (M6)
**Goal**: 로그 텍스트 → 표시용 레코드, 이벤트 JSON → 새 실패 선별
**Estimated Time**: 1.5h
**Status**: ⏳ Pending

**🔴 RED** (`tests/m6-panel.test.tsx`)
- [ ] **Test 4.1** `parseGateLog(text, tool)` → `GateRecord[]` `{ ts, tool, decision, hits, command, cwd }`
  - 깨진 줄·`ts` 없는 줄 건너뜀, Codex `logged-only (...)` → `log`, 명령은 한 줄로 접고 길이 제한
- [ ] **Test 4.2** `mergeGateRecords(lists, limit)` → 시각 내림차순 최근 N건(`.1` 회전 파일 + 현재 파일 합침)
- [ ] **Test 4.3** `parseSyncEvents(text)` → `{ lastId, events }`. 형식 오류면 빈 결과
- [ ] **Test 4.4** `syncFailuresToNotify(events, seenId)`
  - `seenId` 없음(첫 실행): 최신이 실패면 그 1건, 아니면 없음
  - `seenId` 있음: 이후 이벤트 중 최신이 실패면 그 1건(이미 통과로 풀린 실패는 알리지 않음)

**🟢 GREEN**
- [ ] **Task 4.5** `src/m6-panel/logic.ts`에 구현, 공용 타입은 `types/index.d.ts`

#### Quality Gate ✋
- [ ] RED → GREEN, `claude plugin test .`, `tsc` 통과

---

### Phase 5: `gate` 탭과 동기화 실패 toast (M6)
**Goal**: 패널에서 보이고, 새 실패를 알린다
**Estimated Time**: 2.5h
**Status**: ⏳ Pending
**Depends on**: Phase 4

**🔴 RED** (`fs.read`·`fs.stat`·`store`·`env.get` 목)
- [ ] **Test 5.1** `/panel gate` → `panelTab`이 `gate`, 상태에 차단 레코드·동기화 요약이 채워진다
- [ ] **Test 5.2** 로그 파일 없음 → "기록 없음", 예외로 패널이 안 열리는 일 없음
- [ ] **Test 5.3** `session.measure`: 이벤트 파일 mtime 같으면 `fs.read` 호출 안 함, 바뀌었고 새 실패면 toast 1회 + `g/m6/syncSeen` 갱신
- [ ] **Test 5.4** 같은 실패 이벤트로 두 번째 measure → toast 없음. `/clear` 뒤(state 비움)에도 store 기준으로 없음
- [ ] **Test 5.5** 모듈 off면 읽지도 알리지도 않음

**🟢 GREEN**
- [ ] **Task 5.6** `types/index.d.ts`: `PanelTab`에 `'gate'`, `PluginState`에 `gate` 상태(레코드·이벤트 요약·mtime)
- [ ] **Task 5.7** `logic.ts` `TABS`, `parsePanelArgs`, `argumentHint`에 `gate` 추가(핫키 6)
- [ ] **Task 5.8** `index.tsx`: `refreshGate($)`(같은 파일 최상위), 명령·탭 버튼·`session.measure`에서 호출. render는 state만 읽는다
- [ ] **Task 5.9** `messages.ts` ko/en: 탭 이름, 빈 상태, 레코드 줄, 동기화 요약, toast 문구(실패 요약 첫 줄 + `/panel gate` 안내)

**🔵 REFACTOR**
- [ ] **Task 5.10** `session.measure` 1회당 추가 비용 확인(변경 없을 때 `fs.stat` 1회만)

#### Quality Gate ✋
- [ ] RED → GREEN, 기존 m6 테스트 무변경 통과
- [ ] `claude plugin validate .`, `claude plugin test .`, `tsc` 통과

---

### Phase 6: 문서와 실제 세션 확인
**Goal**: 사용자에게 보이는 변경을 문서화하고 실제 세션에서 확인
**Estimated Time**: 1h
**Status**: ⏳ Pending
**Depends on**: Phase 2, 3, 5

- [ ] **Task 6.1** README 모듈 표(edit·panel 설명), SPEC.md M3·M6 절, CHANGELOG `[Unreleased]`
- [ ] **Task 6.2** `node tools/ci-local.mjs` 통과

**Manual Test Checklist** (`claude --plugin-dir .`)
- [ ] 계획서 `# 브랜치` = 현재 브랜치, 목록 밖 파일 Edit → 거부 사유 확인
- [ ] 브랜치를 바꾸면 같은 Edit이 허용된다
- [ ] `/edit` 출력에 활성 상태 표시
- [ ] `/panel gate`에 실제 `~/.claude/hooks/node4-approval-gate.log` 최근 차단이 보인다
- [ ] `~/.ai-gate` 감시 파일을 일부러 어긋나게 고쳐 동기화 실패 → 다음 턴 toast 1회 → 되돌린 뒤 통과 표시

---

## ⚠️ Risk Assessment

| Risk | Probability | Impact | Mitigation Strategy |
|------|-------------|--------|---------------------|
| 가드 오작동으로 모든 Edit·Write가 막힘 | Low | High | 비활성 사유를 명시적으로 허용하고 통합 테스트로 덮는다. 긴급 시 `/mods edit off` |
| 계획서에 빠진 파일(테스트·CHANGELOG)이 계속 막혀 흐름이 끊김 | Med | Med | 거부 사유에 허용 목록과 계획서 수정 방법을 넣는다(Claude가 `.git/ai-task.md`를 고치면 바로 풀림) |
| Edit마다 git 2회 실행으로 지연 | Med | Low | Phase 2에서 측정, 필요하면 짧은 캐시 |
| Bash·NotebookEdit 경유 수정은 못 막음 | High | Low | 한계로 문서화. 강제가 아니라 보조 장치임을 README에 적는다 |
| 게이트 로그 형식 변경 | Low | Low | 관대한 파서, 모르는 필드 무시 |
| 로그의 명령 문자열에 민감값 | Low | Med | 훅이 이미 `REDACTIONS`로 가린다. 패널은 로컬 표시만 하고 store·context에 명령 원문을 넣지 않는다 |
| Phase 3 규칙 변경이 다른 CLI 세션에 바로 반영되지 않음 | High | Low | 새 세션부터 적용(동기화 훅 안내와 같음). `# 브랜치` 없는 계획서는 가드 비활성이라 안전 |

---

## 🔄 Rollback Strategy

- **Phase 1·4:** `logic.ts` 추가 함수와 테스트만 되돌린다(호출하는 곳 없음).
- **Phase 2:** `src/m3-edit/index.tsx`, `messages.ts`, 테스트를 되돌린다. 급할 때는 `/mods edit off`.
- **Phase 3:** 마스터 규칙에서 `# 브랜치` 줄을 지우고 `sync_pipeline_rules.py` 실행. 계획서에 브랜치가 없으면 가드는 꺼지므로 Phase 2와 독립적이다.
- **Phase 5:** `types/index.d.ts`, `src/m6-panel/*`, 테스트를 되돌린다. store 키 `g/m6/syncSeen`은 남아도 무해하다.

---

## 📊 Progress Tracking

| Phase | Estimated | Actual | Status |
|-------|-----------|--------|--------|
| 1. 범위 판정 로직 | 1.5h | - | ✅ |
| 2. 범위 가드 연결 | 2.5h | - | ✅ |
| 3. 파이프라인 `# 브랜치` | 0.5h | - | ✅ |
| 4. 로그·이벤트 파싱 | 1.5h | - | ⏳ |
| 5. gate 탭·toast | 2.5h | - | ⏳ |
| 6. 문서·실세션 | 1h | - | ⏳ |
| **Total** | **9.5h** | - | |

**검증 명령 (모든 페이즈 공통, takgon-mods 루트)**
```bash
claude plugin validate .
claude plugin test .
npx -p typescript tsc -p .
node tools/ci-local.mjs        # Phase 6
```

---

## 📝 Notes & Learnings

### Implementation Notes
- Phase 1(2026-11-10): agy 구현 → Claude 리뷰. RED는 `judgeScope` export 없음으로 실패 확인, GREEN 167 pass. `## 제목`은 섹션 경계가 아니라 내용 줄로 취급(테스트로 고정).
- Phase 2(2026-11-10): agy 구현(RED 3 fail → GREEN 178 pass) → Claude 리뷰에서 git 2회를 `Promise.all` 병렬로 수정. 실측(이 PC, 20회 중앙값): `git rev-parse ...` 54ms, `git branch --show-current` 68ms → 순차 약 120ms였고 병렬화 후 Edit당 추가 지연은 실세션에서 미측정. 캐시는 아직 넣지 않음.
- Phase 3(2026-11-10): 마스터 계획서 형식에 `# 브랜치` 추가, `# 변경 대상 파일`은 "한 줄에 경로 하나, 백틱, 디렉터리는 `/`로 끝냄"으로 명시(파서와 맞춤). 사본 4곳 자동 갱신, 동기화 테스트 29개 통과, 공개 저장소 `docs/plan-branch-field` 브랜치에 내보냄.
- git·계획서 읽기 실패(목 미등록 포함)는 모두 비활성(허용)으로 처리. 세션 루트를 cwd로 쓰므로 다른 저장소 파일은 `outside-repo`로 허용된다.

### 미확인 항목 (계획 시점)
- `$.fs.read`로 세션 루트 밖 절대 경로(`~/.claude/hooks/*.log`)를 읽을 수 있는지 — 타입 문서상 "fs.* 훅이 정한다"만 확인, 실제 세션에서 Phase 5 전에 확인
- `$.process.run`으로 git을 Edit마다 부를 때 지연 — Phase 2에서 측정

---

## 📚 References
- `docs/engine-constraints.md` — `.catch` 건너뛰기, `$`·atom import 경계, matcher 없는 등록 1개 제한
- `docs/issues/07-testing-kit-engine-answer-conventions.md` — 테스트 op 응답 규칙
- `C:\dev\ai-global-pipeline\pipeline\ai-global-pipeline.md` [Handoff] 계획서 형식
- `C:\dev\ai-global-pipeline\ai-gate\gate_report.py` — 게이트 로그 위치·필드
- `C:\dev\ai-global-pipeline\ai-gate\sync_test_hook.py` — `.sync-events.json` 형식과 세션별 알림 규칙

---

**Plan Status**: 🔄 In Progress (Phase 1~3 완료)
**Next Action**: Phase 4 RED 테스트(게이트 로그·동기화 이벤트 파싱) 작성
**Blocked By**: None
