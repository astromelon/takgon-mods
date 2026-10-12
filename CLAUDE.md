# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개요

Claude Code mods 플러그인 `takgon-mods`(개인 생산성 모듈 8개). TypeScript/TSX로 쓰고 Claude Code 엔진이 직접 로드한다
(빌드 단계 없음). 루트 `package.json`은 `tools/headless.mjs`용 playwright 의존성뿐이며 플러그인 모듈과 무관하다.

mods 코드를 고치기 전에 `plugin-authoring` 스킬을 쓰고, 이벤트·`$` API는 `.claude-plugin/types/claude-code/index.d.ts`
(플러그인 로드 시 생성, git 제외)를 기준으로 확인한다. 문서와 타입이 다르면 타입을 따른다.

- 설계·결정: `SPEC.md` (**[수정: 실측]** 표시가 원래 명세를 실제 엔진 동작에 맞게 고친 부분)
- 실측 엔진 제약과 우회: `docs/engine-constraints.md` — 이상한 우회 코드를 지우기 전에 먼저 확인
- 변경 이력: `CHANGELOG.md` (Keep a Changelog, 한국어). 사용자에게 보이는 변경은 `[Unreleased]`에 기록

## 명령

```bash
claude --plugin-dir .            # 개발 세션(저장 시 핫 리로드, 거부 사유는 --debug)
claude plugin validate .         # hooks/calls·$.state 계약·거부 항목 검사
claude plugin test .             # tests/**/*.test.ts(x) 전부 실행(파일 단위 선택 옵션 없음)
npx -p typescript tsc -p .       # 타입 체크(루트 tsconfig는 .claude-plugin/types/tsconfig.json 상속, 둘 다 git 제외)

# tools/e2e: 실제 대화형 세션을 의사 터미널로 띄우는 Windows 전용 하네스
python -m unittest discover -s tools/e2e -p "test_*.py"   # 하네스 단위 테스트
python tools/e2e/run.py --list                            # 시나리오 목록
python tools/e2e/run.py probe_classic probe_catch         # 이름으로 개별 실행([모델] 시나리오는 이름 지정 또는 --with-model)
```

CI(`.github/workflows/ci.yml`)는 Windows에서 Claude Code 2.1.296 고정으로 validate → test → 하네스 단위 테스트 → probe 2개(`probe_classic`은 CI에서 제외, 로컬 전용)를
돈다. 테스트가 Windows 절대 경로(`C:/proj`)를 가정하므로 Linux에서는 실패한다. 엔진 버전을 올릴 때는 로컬에서 먼저 통과시킨다.

## 아키텍처

- `hooks/hooks.json`의 `modules`는 경로 하나만 받으므로 `src/index.ts`가 단일 진입점으로 `core` → 각 모듈 `register*(on)`을
  순서대로 호출한다. 등록 순서가 같은 이벤트의 훅 실행 순서다(core가 가장 바깥).
- 모듈 폴더 `src/mN-<name>/`: `index.tsx`(훅·`$` 호출·UI)만 `$`를 쓰고, 나머지 파일(`logic.ts`·`messages.ts`, M5의
  `github.ts`·`linear.ts`, M8의 `mermaid.ts` 등)은 순수 함수·문자열이다. `src/shared/`에는 **순수 함수·상수·타입만** 둔다.
- `types/index.d.ts`가 `$.state` 계약(`PluginState["takgon-mods"]`)이자 모듈 간 공유 타입이다. validate가 이 계약과 대조한다.

### 엔진 제약 때문에 생긴 규칙 (어기면 validate 거부 또는 실제 세션에서만 깨짐)

- `$`와 atom은 import 경계를 넘을 수 없다. `$`를 받는 헬퍼는 같은 파일 최상위에 두고, `read`/`update`의 atom도 같은 파일에서
  `atom(...)`으로 선언한다. 모듈 간 공유 값은 파일마다 같은 `{ plugin: 'takgon-mods', key }` 리터럴로 atom을 따로 선언한다.
  그래서 `registerCommand`(core, M2~M7)·`ensureRestored` 같은 헬퍼가 파일마다 중복돼 있다(의도된 것).
- `$`를 alias·구조분해하지 않고, 이벤트명은 리터럴로 쓴다. 플러그인 내부 파일은 정적 import만(`import()` 금지).
  `setTimeout`·`fetch`·Node API 대신 `$.clock`·`$.http`·`$.process` 등만 쓴다. `$.env.get` 인자는 문자열 리터럴.
- matcher 없는 등록은 이벤트마다 플러그인 전체에서 1개(core가 `session.start`·`prompt.submit`·`command.run`,
  M6가 `session.measure`·`agent.spawn` 사용).
  모듈은 `{ isInteractive: true }`, `{ reason: 'answer' }`, `{ origin: { kind: 'composer' } }`, `{ tool }` 같은 matcher로 등록한다.
  배정표는 SPEC.md "이벤트 배정".
- `classic.*` 훅은 user 플러그인에서 전부 bypass되므로 쓰지 않는다.
- `/clear`·`/resume` 뒤 `$.state`는 비고 `session.start`도 오지 않는다(명령·타이머는 유지). store에서 상태를 읽는 core·M4~M7은
  `restored` state에 자기 id(`core`, `m4` …)가 없으면 자기 훅에 처음 들어올 때 `$.store`에서 다시 채운다(`ensureRestored`).
- `.catch`가 답하면 같은 이벤트의 같은 플러그인 뒤쪽 훅이 건너뛰어진다. 공유 이벤트의 훅은 외부 호출과 명령 등록을 직접
  try/catch해 실패가 다른 모듈로 번지지 않게 한다. 명령 등록 거부(같은 이름의 사용자 명령·스킬)는 삼키고 toast 1회.
- render 훅은 `$.state`에 쓸 수 없고 무거운 작업(`$.model.*`, `$.process.run`)도 금지. 결과는 `turn.complete`·명령·타이머에서
  state에 넣고 render는 읽기만 한다. `$.model.fork`는 시간 상한이 없어 `$.clock.after(0, ...)`로 떼어 내 한 번에 하나만 돌린다.
- 훅 자체 실행 예산 10초(`$.clock.sleep` 포함). 시스템 프롬프트는 요청마다 바꾸지 않고, 프롬프트별 정보는 `prompt.submit`의 `context`로.

### 저장 규칙

- `$.store`는 모든 프로젝트가 한 파일(4 MiB 상한)을 공유한다. 키는 `src/shared/keys.ts`: 프로젝트 `p/{projectId}/{module}/{key}`,
  전역 `g/{module}/{key}`(`:` 금지 — Windows 경로와 충돌). 누적 데이터는 개수 상한(핀 100, 에이전트 50 등)을 둔다.
- 파일 산출물은 `{project}/.claude/takgon/`에 두고 처음 만들 때 `*` 한 줄 `.gitignore`를 같이 쓴다.
- 토큰(`GITHUB_TOKEN`, `LINEAR_API_KEY`)은 `$.env.get`으로만 읽고 store·toast·에러에 남기지 않는다. `$.http`의 `auth` 대신 `headers`.

### UI·공통 동작

- UI 문자열은 전부 i18n 키(`messages.ts` + `src/shared/i18n.ts`의 `t(lang, key, vars)`), 언어 기본값 `ko`.
- 꺼진 모듈(`g/core/modules`, `/mods <모듈> off`)의 훅은 자기 기능을 건너뛰고 `next(e)`로 넘기고, 자기 명령에는 "꺼짐" 안내로 답한다.
  타이머는 cancel하지 않고 콜백에서 건너뛴다(M5 PR 폴링).
- 외부 연동(gh, glab, Linear, playwright, mmdc) 실패 시 해당 요소만 숨기고 원인별 1회 toast.
- 렌더는 `e.surface`로 분기한다(terminal은 `Svg` 없음·`Image`는 kitty 계열만, desktop은 `Svg` 131,072자 상한). 모든 control에 key.
- 사용량·컨텍스트 임계치는 폴링하지 않고 `session.measure`에서 판정한다.

## 테스트

- `claude-code/testing` 킷(`describe`/`test`/`expect`/`mock`) 사용. 테스트의 `$`에는 `store`가 없으므로 `mock.store(on, 초기값)`으로 주입.
- 외부 연동은 하위 훅으로 mock하고, 엔진 거부는 `{ deny }`로 답한다(엔진 제약 7번). surface별 렌더는 `['terminal', 'desktop'] as const`로 반복해 검증(M4·M6·M8).
- `tools/e2e`의 `probe_*` 시나리오는 엔진 제약 감시용이다. 실패하면 엔진이 고쳐졌을 수 있으니 제약 문서와 우회 코드를 다시 본다.
  시나리오 판정은 화면 문자열(pyte로 재구성)과 debug 로그 기준이라 Claude Code UI 문구가 바뀌면 함께 고친다.

## 커밋

Conventional Commits 접두사(`feat`/`fix`/`docs`/`test`/`build`) + 한국어 요약. 버전은 `.claude-plugin/plugin.json`.
