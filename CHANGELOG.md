# Changelog

이 프로젝트의 주요 변경 사항을 기록한다. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르고,
버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따른다.

## [Unreleased]

### Added
- `tools/e2e`: 실제 대화형 세션을 의사 터미널로 띄워 확인하는 E2E 하네스와 시나리오 10개(모델 미사용 5개 기본 실행), 엔진 제약 1·2·3번 감시용 probe 플러그인(`probe_classic`·`probe_clear_state`·`probe_catch`).
- GitHub Actions CI(`.github/workflows/ci.yml`): push·PR마다 Windows에서 `claude plugin validate`·`claude plugin test` 실행(Claude Code 2.1.296 고정).
  테스트가 Windows 절대 경로(`C:/proj`)를 가정해 Linux에서는 실패하므로 Windows만 돌린다.
- `README.md`: 모듈·명령 표, `/mods` 등록 상태 표시와 `/panel`·`/tk-handoff` 임계치 사용법, 설치(private 저장소 `astromelon/takgon-mods`), 선택 의존성 준비 방법.
- **core**: `/mods` 목록의 모듈 줄마다 명령 등록 결과 표시(`/panel ✓`, `/browse ✗ (사유)`, 결과 없으면 `?`). 결과는 프로젝트 store `p/{pid}/core/commands`에도 남겨 `/clear` 뒤에도 보인다.
- `docs/issues/06-model-fork-no-timeout.md`, `docs/issues/07-testing-kit-engine-answer-conventions.md`: 엔진 제약 6·7번 claude-code 이슈 초안. 제출: anthropics/claude-code#101446, #101447.
- `docs/issues/03-catch-skips-same-plugin-hooks.md`: 엔진 제약 3번(`.catch` 뒤 같은 플러그인 훅 건너뜀) claude-code 이슈 초안.
- `docs/issues/09-command-register-skill-conflict.md`: 엔진 제약 9번(스킬 이름 충돌로 초기화 연쇄 실패) claude-code 이슈 초안. 제출: anthropics/claude-code#101452 (4·5번은 #101450, #101451).
- `docs/engine-constraints.md` 7번: 테스트 킷에서 엔진 거부는 `{ deny }`로 답해야 한다는 규약. (`c2c6c99`)

## [0.3.0] - 2026-10-12

임계치 설정과 패널 사용성을 보강하고, 실제 세션에서 명령 등록 거부가 초기화를 연쇄로 막던 문제를 고친다.

### Added
- **M6**: `/panel threshold [1-99]`로 사용량 경고 임계치(컨텍스트·사용 한도, 기본 80%) 설정. 전역 store 키 `g/m6/threshold`. Usage 탭에 현재 임계치 표시.
- **M6**: `/panel <탭>`(pinboard|tasks|agents|usage|handoff)으로 원하는 탭을 바로 열기, 탭 버튼 숫자 단축키 1~5. (`77ce7b0`)
- **M7**: `/tk-handoff threshold [1-99]`로 자동 인수인계 임계치(기본 75%) 설정. 전역 store 키 `g/m7/threshold`. (`ca24cab`)
- `docs/engine-constraints.md`: 실측한 엔진 제약 9건 정리(9번: 스킬 이름 충돌로 인한 초기화 연쇄 실패), `docs/issues/`: claude-code 이슈 초안(4·5번).

### Changed
- **M7**: 명령 이름을 `/handoff` → `/tk-handoff`로 변경. 사용자 스킬 `~/.claude/skills/handoff`와 이름이 겹쳐 등록이 거부됐다.
- 퍼센트 임계치 해석(1~99 정수)을 `shared/settings`의 `toPercent`·`parsePercent`로 모아 M6·M7이 함께 쓴다.

### Fixed
- **명령 등록 거부가 다른 모듈 초기화를 막던 문제**: M7의 `/handoff` 등록이 사용자 스킬과 겹쳐 거부되면, M7 `session.start` 훅이
  실패해 `.catch`가 답하면서 같은 플러그인의 뒤쪽 초기화(M2 `/browse`, M3 `/edit`, M5 `/issue` 등록)까지 건너뛰어졌다(엔진 제약 3번).
  모든 `$.command.register`를 실패해도 넘어가게 하고, 회귀 테스트(`tests/integration.test.tsx`)를 추가했다.
  거부된 명령은 이름과 엔진이 준 사유를 담아 명령마다 세션당 1회 toast로 알린다
  (예: `/browse 명령을 등록하지 못했습니다(it is the user's /browse)`).
- **M2**: playwright 미설치 안내가 전역 설치(`npm i -g`)를 권했지만 headless 스크립트는 전역 모듈을 찾지 못한다. 플러그인 폴더 설치로 안내.
- `plugin.json`·`marketplace.json`에 author·description을 채워 validate 경고 제거. (`0cc5c6f`)

## [0.2.0] - 2026-10-12

0.1.0을 실제 세션에 설치해 점검하면서 드러난 엔진 동작 차이를 바로잡고, GitLab을 지원한다.

### Added
- **M5**: GitLab MR 조회. `origin` 원격이 github.com이면 `gh`, 그 밖(gitlab.com·사내 셀프호스팅)이면 `glab`을 쓴다.
  `glab mr view -F json`으로 MR·파이프라인을, 승인 API로 리뷰 상태를 읽어 band에 `MR !n` 배지를 표시한다.
  glab 미설치·미인증은 원인별 toast 1회, MR 없음은 조용히 숨긴다. (`42909f0`)
- **M6**: Agents 탭이 서브에이전트 실패(`failed`·`killed`)도 기록한다. (`208de6f`)
- `tools/headless.mjs`용 playwright 로컬 의존성(`package.json`). 전역 설치는 ESM이 찾지 못한다. (`d06cf5a`)

### Changed
- **M6**: 서브에이전트 기록을 `classic.SubagentStart/Stop`에서 `agent.spawn` + `$.agent.list()`로 바꿨다. (`208de6f`)
- **M4·M7**: Next-steps·자동 인수인계의 `$.model.fork`를 `$.clock.after`로 떼어 `turn.complete`를 붙잡지 않는다.
  fork에는 시간 상한을 줄 수 없어서다. 한 번에 하나만 돈다. (`208de6f`)
- `PrStatus`에 `provider`(`github` | `gitlab`) 필드를 추가했다(선택, 없으면 github). (`42909f0`)

### Fixed
- **`/clear`·`/resume` 뒤 상태 유실**: `/clear`는 `$.state`를 전부 비우고 `session.start`를 다시 보내지 않는다(실측).
  `restored` state에 복원한 모듈을 기록하고, 비어 있으면 각 모듈이 첫 프롬프트·명령 때 store에서 다시 채운다.
  모듈 설정·언어·핀·할 일·연결 이슈·인수인계 안내가 복원된다(대화형 세션에서 확인). (`208de6f`)
- **`classic.*` 훅이 동작하지 않음**: 내장 보안 플러그인이 user 플러그인의 `classic.*` 훅을 건너뛰게 한다(debug 로그 확인).
  해당 훅을 모두 제거했다. (`208de6f`)
- **M8**: desktop에서 다이어그램이 늘 원본 코드로 보이던 문제. mermaid-cli가 SVG에 넣는 내장 폰트(약 167KB)를
  표시할 때만 빼서 131,072자 한도 안에 든다(예: 197,069자 → 29,999자). 저장 파일은 원본 그대로다. (`b07f40b`)
- 복원 실패가 같은 이벤트의 다른 모듈 훅(명령 처리 등)을 건너뛰게 하던 문제. 훅 안에서 예외를 처리한다. (`208de6f`)

### Removed
- 엔진이 생성하는 `tsconfig.json`을 git 추적에서 뺐다. (`62ae794`)

## [0.1.0] - 2026-10-12

첫 버전. 8개 모듈과 공통 코어.

### Added
- **core**: 단일 진입점, `/mods`(모듈 목록·on/off·`lang ko|en`), store 네임스페이스(`g/…`, `p/{프로젝트 해시}/…`). (`8c431df`, `05fa3c6`)
- **M1 i18n**: Spinner·TurnDuration·ToolProgress·PromptHint·SessionMode 한국어화. (`0b5fb33`)
- **M5 연동**: `gh`로 현재 브랜치 PR 상태 폴링(60초, 턴 완료 시 1회), Linear 이슈 검색·연결·상태 변경(`/issue`). (`c410303`)
- **M4 Composer Bar**: 프롬프트 위 band에 PR 배지와 다음 작업 후보, 모호한 요청을 다듬어 고르게 하는 프롬프트 코치(`/coach`). (`ed0b598`)
- **M6 작업 패널**: `/panel` pane(핀·할 일·에이전트·사용량·인수인계 탭), `/pin`. 컨텍스트·사용 한도 80% toast. (`63870ad`)
- **M7 자동 인수인계**: 컨텍스트 75%에서 세션당 1회 또는 `/handoff`로 작성, `/handoff load`로 다음 프롬프트에 첨부. (`c09dc42`)
- **M8 다이어그램**: 응답의 mermaid 블록을 `mmdc`로 미리 렌더해 desktop은 SVG, terminal은 PNG로 표시. (`af97317`)
- **M3 선택 영역 수정**: `/edit`로 파일 범위·선택·DOM 대상 지정, 범위 밖 Edit·Write 차단. (`23b2c2a`)
- **M2 브라우저**: Bash 출력의 localhost URL 감지, `/browse`로 스크린샷·콘솔 에러 수집과 프롬프트 첨부. (`22eab76`)

### Fixed
- 코치 판정 실패가 다른 모듈의 프롬프트 context 첨부를 막던 문제. (`55aaa64`)
