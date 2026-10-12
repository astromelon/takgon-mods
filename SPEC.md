# takgon-mods 명세 (v2 — 엔진 2.1.295 타입 대조 반영)

> 이 문서는 원본 명세를 `plugin-authoring` 스킬과 `claude-code.d.ts`(2.1.295) 기준으로 고친 판이다.
> 바뀐 부분은 **[수정]**, 새로 넣은 부분은 **[추가]**로 표시했다. 문서와 타입이 다르면 타입을 따른다.

# 목표
Claude Code mods로 개인 생산성 플러그인 `takgon-mods`를 만든다.
user scope로 전역 설치해 모든 프로젝트에 적용한다. 8개 모듈로 구성한다.

# 작업 전 필수
1. `plugin-authoring` 스킬을 사용한다.
2. `.claude-plugin/types/claude-code/index.d.ts`(로드 전에는 스킬이 알려주는 `types/claude-code.d.ts`)를 기준으로
   이벤트와 `$` API를 확인한다. 문서와 타입이 다르면 타입을 따른다.
3. 아래 "API 제약 사전 보고" 절의 항목은 이미 확인된 것이다. 구현 중 새로 발견되는 제약만 추가로 보고한다.

# 플러그인 구조 **[수정]**
```
C:\dev\takgon-mods\                 # 프로젝트 저장소 밖에 둔다
├── .claude-plugin/
│   ├── plugin.json                 # name, version, description, "types": "./types/index.d.ts"
│   └── marketplace.json            # [추가] 폴더 자체를 marketplace로 (source "./")
├── hooks/hooks.json                # { "modules": ["../src/index.ts"] }  ← 경로는 하나만
├── types/index.d.ts                # [추가] $.state 계약 (interface PluginState { "takgon-mods": {...} })
├── src/
│   ├── index.ts                    # [수정] 단일 진입점: 각 모듈 register를 import해 순서대로 호출
│   ├── shared/                     # i18n, keys(네임스페이스), settings, providers, render 헬퍼
│   └── m1-i18n/ … m8-diagram/      # 모듈당 register(on, ctx) 하나씩
└── tests/                          # *.test.ts (claude-code/testing)
```
- `hooks.json`의 `modules`는 **경로 하나만** 받는다. 모듈 8개를 나열하지 않고 `src/index.ts`가 import로 묶는다.
- 플러그인 내부 파일은 정적 `import` 선언으로만 불러온다(`import()`가 있으면 모듈 로드 실패).
- `$.state`를 쓰므로 `types/index.d.ts` 계약이 필수이며, `claude plugin validate`가 `$.state` 키를 이 계약과 대조한다.

# 런타임 제약 (반드시 준수)
- **모듈 초기화 규칙 [수정: validate 확인]**: matcher 없는 `session.start`는 플러그인 전체에서
  하나만 허용된다(core가 사용). 각 모듈은 `on('session.start', { isInteractive: true }, ...)`로 초기화한다(`-p` 실행에서는
  돌지 않음).
  **`/clear`·`/resume` 복원 [수정: 실측]**: `classic.*` 훅은 user 플러그인에서 전부 bypass되므로 쓰지 않는다
  (engine-constraints 1). `/clear` 뒤에는 `$.state`가 비고 `session.start`도 오지 않으므로(engine-constraints 2),
  `restored` state에 복원한 모듈 이름을 기록하고, 각 모듈의 `ensureRestored`가 자기 훅(core는 `prompt.submit`·
  `command.run`, 각 모듈은 프롬프트·명령·턴 완료·측정 훅)에 처음 들어올 때 이름이 없으면 store에서 다시 채운다.
  복원 실패는 훅 안에서 삼키고 표시를 되돌려 다음 진입에서 재시도한다(engine-constraints 3).
- 외부 접근은 `$`로만 한다: `$.fs`, `$.http`, `$.process`, `$.clock`, `$.model`, `$.ui`, `$.store`, `$.state`,
  `$.session`, `$.command`, `$.prompt`, **`$.env`** **[추가]**.
  setTimeout, fetch, Node API, 동적 import()는 사용하지 않는다.
- `$`를 alias하거나 구조분해하지 않는다. 이벤트명은 리터럴로 쓴다. matcher 없는 session.start는 하나만 둔다
  **[수정: 실측]** (`src/core.ts`의 `registerCore`가 갖는다. `src/index.ts`는 각 모듈의 `register*(on)`을 호출만 하고,
  모듈은 자기 파일에서 `{ isInteractive: true }` matcher로 등록한다. engine-constraints 4).
- **`$`는 import 경계를 넘겨 전달할 수 없다** **[추가: shared 구현 중 validate로 확인]**. `$`를 받는 헬퍼는
  같은 파일 최상위에 선언한 함수(또는 함수를 담은 const)여야 한다. 따라서 `src/shared/`에는 순수 함수·상수·타입만 두고,
  store·state·ui 호출은 각 모듈 파일 안에서 한다. `on`은 import한 함수로 넘겨도 된다.
- **`read`/`update`의 atom은 같은 파일에서 `atom(...)`으로 선언해야 한다** **[추가]**. 모듈 간 공유 값은 각 파일이
  같은 `plugin`/`key` 리터럴로 atom을 따로 선언한다(값은 엔진이 하나로 보관).
- 테스트의 `$`(Engine)에는 `store` 명사가 없다. 영속화는 `mock.store(on, 초기값)`으로 주입해 동작으로 검증한다 **[추가]**.
- **`$.env.get(name)`의 `name`은 문자열 리터럴이어야 한다** **[추가]** (`"GITHUB_TOKEN"`, `"LINEAR_API_KEY"`).
- hook 자체 실행 시간은 10초 이내(`HookBudget.ms = 10_000`). `$` 호출·`next` 대기 시간은 예산에 포함되지 않지만
  **`$.clock.sleep`은 포함된다** **[추가]**. 긴 작업은 `session.start`에서 `$.clock.every/after`로 돌린다.
- `$.process.run`은 기본 타임아웃 30초(최대 10분), shell 없이 argv로 실행한다. dispatch가 abort되면 자식도 죽는다 **[추가]**.
- busy loop는 금지한다.
- system prompt 텍스트를 요청마다 바꾸지 않는다 (prompt cache 보호). 프롬프트별 정보는 `prompt.submit`의 `context`로 넣는다.
- 무거운 작업(`$.model.*`, `$.process.run`)은 `ui.render` 안에서 하지 않는다. **render 훅은 `$.state`를 쓸 수 없으므로**
  결과는 `turn.complete`/명령/타이머에서 만들어 `$.state`에 넣고, render는 읽기만 한다 **[추가]**.

# 저장소 규칙 **[수정]**
- `$.state`: 세션 UI 상태(핫 리로드에도 유지). 세션 시작 시 `$.store`로부터 복원한다.
  - 최초 시작: `session.start`. `/clear`는 `session.end(reason:'clear')` 후 **`session.start`가 다시 오지 않으므로**
    **[수정: 실측]** `classic.SessionStart`는 user 플러그인에 전달되지 않으므로(engine-constraints 1·2), `restored`
    state가 비어 있으면 각 모듈이 자기 훅에 처음 들어올 때 store에서 지연 복원한다(`ensureRestored`).
- `$.store`: 이 플러그인 전용 JSON 파일(다른 플러그인과 공유되지 않음)이지만 **모든 프로젝트가 공유**한다.
  - 키 형식: `p/{projectId}/{module}/{key}`, 전역 키는 `g/{module}/{key}`.
  - `projectId` = `$.session.root()` 정규화(소문자·`/` 구분자) 후 짧은 해시(예: FNV-1a 8자).
    **`:` 구분자는 Windows 경로(`C:\...`)와 충돌하므로 쓰지 않는다.**
  - **전체 4 MiB 상한**이 있다. 핀·에이전트 기록 등 누적 데이터는 개수 상한(예: 프로젝트당 핀 100, 에이전트 50)을 두고,
    큰 산출물은 파일로 둔다.
- 파일 산출물은 `{project}/.claude/takgon/` 아래에 둔다. 처음 만들 때 같은 폴더에 `*` 한 줄짜리 `.gitignore`를 써서
  모든 저장소에 미추적 파일이 생기지 않게 한다(git config는 건드리지 않는다).
- 토큰(GitHub, Linear)은 `$.env.get`으로 읽는다. store·로그·toast·에러 메시지에 평문으로 남기지 않는다.
  `$.http`의 `auth` 필드는 Anthropic 1st-party 전용이므로 쓰지 않고 `headers`로 넣는다.

# 공통
- 모듈별 on/off 설정을 두고, 기본값은 전부 on이다. 전역 키 `g/core/modules`에 저장하고 `/mods`로 토글한다.
  - 명령 체계 **[수정]**: `/mods` 하나로 통합한다 — `/mods`(목록·상태), `/mods <모듈> on|off`, `/mods lang en|ko`,
    기능 명령(`/coach`, `/issue`, `/pin`, `/panel`, `/tk-handoff`, `/browse`, `/edit`)은 별도.
    `/tk-handoff`는 사용자 스킬 `/handoff`와 이름이 겹쳐 바꿨다.
  - **내장 명령과 이름이 같으면 `$.command.register`가 거부한다.** 각 모듈 완료 시 validate 결과로 등록 성공을 확인하고,
    충돌하면 `tk-` 접두사(`/tk-mods` 등)로 바꾼다.
  - **[수정: 실측]** 꺼진 모듈의 hook은 자기 기능을 건너뛰고 `next(e)`로 넘긴다. 단 자기 명령(`/coach`, `/issue` 등)은
    `next(e)`가 아니라 "꺼짐" 안내 문구(`*.moduleOff`)로 답한다. 타이머는 모듈을 꺼도 cancel하지 않고, 콜백 안에서
    on/off 플래그를 확인해 건너뛴다(M5 `getStatus`). `cancel()`은 세션 초기화 때 이전 PR 폴링 타이머를 정리하는 데만 쓴다.
- UI 문자열은 전부 i18n 키로 쓴다.
- 외부 연동이 실패하면 해당 요소만 숨기고 `$.ui.toast`로 **원인별 1회** 알린다(같은 원인 재발 시 재알림 금지, 상태는 `$.state`).
- 렌더링할 때 `e.surface`로 분기한다. 요소 표 **[추가]**:
  | surface | 그림 요소 |
  |---|---|
  | terminal | `Raster`, `Image`(kitty·Ghostty만 그림, **Windows Terminal 등은 `alt` 텍스트**), `Svg` 없음 |
  | desktop | `Svg`(최대 131,072자), `Image`/`Raster` 없음 |
  | vscode / mobile | `Svg`. mobile은 `Input`/`Select` 없음 → 텍스트+링크로 대체 |
- `$.state`가 아닌 값으로 화면을 바꿀 때는 `$.ui.invalidate('ui.render')`를 호출한다. 모든 control에 key를 부여한다.
- 컨텍스트·사용량 임계치는 폴링하지 않고 **`session.measure` 이벤트**(턴마다 push)에서 판정한다 **[추가]**.

# API 제약 사전 보고 **[추가]**
| 항목 | 판정 | 근거 / 대안 |
|---|---|---|
| M1 내장 UI 번역 | 부분 가능 | `ui.render` 대상은 `AskUserQuestion, UserMessage, AssistantMessage, ToolUse, ToolResult, ToolGroup, ToolProgress, CommandOutput, Spinner, TurnDuration, InfoNotice, SessionMode, PromptHint, AbovePrompt, Pane`뿐. `/config`·`/help`·슬래시 메뉴·권한 다이얼로그 본문·내장 명령 출력·status line·에러 문구는 교체 불가 → 보고만 |
| M1 응답 언어 | 플러그인 범위 아님 | 모델 응답 언어는 Claude Code `language` 설정을 쓴다. `prompt.compose`로 넣지 않는다(캐시 보호) |
| M2 desktop 인라인 브라우저 | 불가 | webview/iframe 요소 없음(`Client`도 트리를 그릴 뿐). 대안: Link + 상태 + 콘솔 에러 목록 + (가능하면) 스크린샷 |
| M2/M8 terminal 이미지 | 터미널 의존 | `Image`는 kitty 그래픽 프로토콜만. Windows Terminal은 alt만 보인다 → 외부 열기·파일 저장 버튼으로 대체 |
| M2 콘솔 에러 수집 | 가능(외부 스크립트) | `$.process.run`으로 headless(Playwright) 스크립트를 **1회성**(N초 관찰 후 종료) 실행해 JSON 출력. 상주 프로세스는 dispatch 종료 시 죽음 |
| M3 텍스트 선택 | 제한적 | `$.ui.selection()`은 fullscreen terminal(및 desktop 호스트 페이지)만. 대안: `/edit <path>:<start>-<end>` |
| M3 DOM 픽 | 불가(클릭 픽) | 페이지에 스크립트를 넣을 surface 없음. 대안: selector 입력 → headless로 computed style·요소 스크린샷 수집 |
| M6 사용량 | 가능 | `$.session.usage()` → `context`(percent), `rateLimits`(five_hour/seven_day, 구독만), `cost`. breakdown `"full"`은 토큰 카운트 요청을 보내므로 `"summary"`만 사용 |
| M8 desktop SVG | 가능(외부 도구) | 샌드박스에 DOM이 없어 mermaid.js 불가 → desktop도 `mmdc`로 SVG 생성. 131,072자 초과 시 원본 코드 |

# 모듈 명세

## M1. i18n (ko)
- 대상: 이 플러그인의 모든 UI + 위 표의 교체 가능한 내장 요소 중 **문자열 prop이 있는 것**(Spinner 동사, TurnDuration,
  PromptHint 등). `next({ ...e, props })`로 prop만 바꾸고 트리를 새로 그리지 않는다.
  - 각 대상 컴포넌트의 props 타입을 먼저 확인해 번역 가능한 필드 목록을 보고한다.
  - `e.props.isExpanded` 등 원본 표시가 필요한 상태는 건드리지 않는다.
- 기본 언어는 ko이고, `/mods lang en|ko`로 전환한다(전역 키 `g/i18n/lang`). 전환 시 `$.ui.invalidate('ui.render')`.
- 교체 불가 범위는 보고만 하고 구현하지 않는다.

## M5. Integrations (GitHub PR, Linear)
- Provider 인터페이스: `getStatus()`, `search(q)`, `link(id)`. 결과는 `$.state`(`integrations.pr`, `integrations.issues`)에 둔다.
- GitHub: `$.process.run(["gh","pr","view","--json","number,url,reviewDecision,statusCheckRollup"], { timeoutMs: 15000 })`.
  - `gh` 미설치·미인증·PR 없음(exit≠0)은 각각 구분해 배지만 숨긴다. PR 없음은 toast 하지 않는다.
- Linear: `$.http.fetch("https://api.linear.app/graphql", { method:"POST", headers:{ Authorization: <LINEAR_API_KEY> } })`.
  이슈 검색, 상태 변경을 지원한다.
  - **"현재 프로젝트에 이슈 연결" = 로컬 매핑**(`p/{projectId}/m5/linkedIssues`)으로 정의한다. Linear 쪽 project를 바꾸지 않는다 **[수정: 의미 명확화]**.
  - 상태 변경은 쓰기 작업이므로 `$.ui.ask`로 확인 후 실행한다.
- `$.clock.every`로 폴링한다(기본 60초, `session.start`에서 시작). `turn.complete`에서도 1회 갱신하되 직전 갱신 후 10초 이내면 생략한다.
- 명령: `/issue <검색어>`, `/issue link <id>`, `/issue status <id> <state>`.

## M4. Composer Bar (`AbovePrompt` band, ui.render)
- 폭은 `e.props.bodyColumns` 기준으로 맞춘다.
- PR 배지: 리뷰 상태와 체크 상태를 표시한다 (M5 `$.state` 읽기).
- Next-steps: `turn.complete`에서 `$.model.fork`로 다음 작업 후보를 최대 3개 생성해 `$.state`에 저장한다.
  - **비용 제어 [추가]**: 턴에 도구 사용이 있었을 때만, 직전 생성 후 최소 2분 간격. `nothing-to-fork`·`aborted`는 조용히 무시.
  - 렌더러는 checkbox(기본), issue, pr 중에서 고른다. 선택하면 `$.prompt.submit`으로 제출한다.
  - 체크 상태는 `$.store`(`p/{projectId}/m4/tasks`)에 영속화하고, M6 Tasks 탭과 같은 `$.state` 값을 공유한다.
- Prompt-coach: `prompt.submit`에서 모호한 요청을 판정한다.
  - **건너뛰는 경우 [추가]**: `e.origin`이 사용자 본인이 아님(플러그인·Next-steps 제출 포함 → 루프 방지), 슬래시 명령, 휴리스틱 통과(짧은 확정 요청 등).
  - 판정과 다듬기를 `$.model.complete` **1회**(작은 모델, `timeoutMs` 4000, JSON `{ambiguous, refined}`)로 처리한다. 실패·타임아웃은 원문 통과.
  - 모호하면 `$.ui.ask`로 [원문 그대로 / 다듬은 버전 / 취소]를 묻는다. 자동 치환은 금지한다.
    `$.ui.ask`는 dismiss·`-p` 실행에서 reject하므로 catch 시 원문 통과.
  - 가드 훅이므로 `.catch(($, e, next) => next(e))` 형태로(호출 전이면 원문 진행, 호출 후면 그 결과 재생) 실패 시 원문 통과를 보장한다.
  - 토글: `/coach on|off` **[수정]** (병렬 구현 중 core 수정을 피하려고 별도 명령으로 둠).
- 표시할 항목이 없으면 `next(e)`를 반환해 band를 그리지 않는다.

## M6. Work Panel (Pane, 사용자가 `/panel`로 열 때만)
- `$.ui.open({ id, title })`은 `/panel` 명령에서만 호출한다(사용자가 연 pane은 폭과 무관하게 배치됨). 알림은 toast로 한다.
- 탭 구성:
  - Pinboard: `/pin <내용>` 또는 `/pin`(직전 응답, `$.session.messages()` 마지막 assistant row). `command.run`이 `{ text }`로 답하므로 Claude turn이 없다.
  - Tasks: M4의 Next-steps 체크 항목을 표시한다.
  - Agents: `classic.SubagentStart`/`classic.SubagentStop`(`agent_id`로 짝지음)으로 실행 내역과 상태를 기록한다. 최근 50건.
  - Usage: `$.session.usage()`의 `context.percent`, `rateLimits`, `cost`를 표시한다. 임계치(기본 80%) 판정은 `session.measure`에서 하고 세션당 임계치별 1회만 toast.
  - Handoff: M7의 최신 인수인계 요약을 표시한다.

## M7. Auto-handoff
- 트리거: `session.measure`에서 `context.percent`가 임계치(기본 75%)를 넘을 때 **세션당 1회**, 또는 `/handoff` 수동 실행.
  - 임계치는 자동 compact 시점보다 낮아야 한다. M6 경고(80%)보다 먼저 발동하는 것이 의도된 순서다.
- 생성: `$.model.fork`로 작성한다(`timeoutMs` 지정). 항목은 목표, 완료, 진행중, 결정사항(Pinboard), 열린 이슈/PR(M5), 다음 단계.
- 저장 위치: `{project}/.claude/takgon/handoff/{yyyyMMdd-HHmm}.md`(시각은 `$.clock.now()` 기준 로컬). 최신본 경로는 `p/{projectId}/m7/latest`.
- 새 세션: `session.start`/`classic.SessionStart`에서 최신 handoff가 있으면 toast로 안내한다.
  `/handoff load`는 다음 `prompt.submit` 1회에 파일 내용을 `context`로 첨부한다(대기 플래그는 `$.state`).

## M2. Inline Browser **[수정: 범위 축소]**
- URL 감지: `tool.call`(Bash) 결과 출력에서 `https?://(localhost|127\.0\.0\.1):\d+` 패턴을 찾아 `$.state`에 최근 URL로 둔다.
- desktop: pane에 URL `Link`, 응답 상태(`$.http.fetch` HEAD/GET), 콘솔 에러 목록을 표시한다. 인라인 페이지 표시는 불가.
- terminal: `/browse`가 headless 스크립트(`$.process.run`, 1회성)로 스크린샷 PNG와 콘솔 에러 JSON을 `.claude/takgon/browse/`에 만든다.
  - kitty/Ghostty: `Image`(`{ file, format:'png' }`)로 표시. 그 외: alt + [외부 브라우저로 열기] 버튼.
- 콘솔 에러는 다음 `prompt.submit`의 `context`로 첨부할지 버튼으로 선택한다.
- 전제: headless 스크립트(Node + Playwright)는 플러그인 밖 의존성이다. 없으면 기능을 숨기고 설치 안내 toast 1회.
- 명령: `/browse [url]`.

## M3. Select-to-Edit **[수정: 범위 축소]**
- 공통 흐름: 대상 선택 → 컨텍스트 첨부 → 수정 요청 → diff 확인(엔진의 Edit 승인 다이얼로그) → 반영.
- 텍스트:
  - fullscreen terminal에서는 `$.ui.selection()`, 그 외는 `/edit <path>:<start>-<end>`로 범위를 지정한다.
  - 범위와 "나머지 영역 변경 금지" 지시를 `prompt.submit` `context`로 주입한다.
  - **강제 [추가]**: 선택이 활성인 동안 `tool.call`(Edit/Write) 훅에서 해당 파일의 범위 밖 변경을 `{ deny }`한다
    (지시만으로는 보장되지 않음). 가드 훅이므로 `.catch`로 실패 시 deny.
- DOM: 클릭 픽은 불가. `/edit dom <selector>`로 M2 headless 스크립트에서 selector, computed style, 요소 스크린샷을 수집해 첨부한다.

## M8. Diagram Render
- `turn.complete`(또는 `session.append`의 assistant row)에서 mermaid 코드블록을 찾아 코드 해시별로 미리 렌더링하고,
  `ui.render`(`AssistantMessage`)는 결과를 읽어 그리기만 한다. 결과 파일은 `.claude/takgon/diagram/{hash}.{svg|png}`에 캐시.
- desktop: `mmdc -o {hash}.svg` → `Svg`(131,072자 초과 시 원본 코드). terminal: `mmdc -o {hash}.png` → `Image`(kitty 계열만), 그 외는 원본 코드.
- `mmdc` 미설치·실패 시 원본 코드를 그대로 표시하고 toast 1회.
- 원본 보기 토글과 SVG/PNG 저장(경로 복사)을 지원한다. 메시지 본문의 나머지는 엔진 렌더를 유지한다.

# 이벤트 배정 **[추가: validate 확인]**
matcher 없는 등록은 이벤트마다 플러그인 전체에 하나만 허용된다. 같은 matcher는 여러 모듈이 써도 된다.
| 이벤트 | 형태 | 모듈 |
|---|---|---|
| `session.start` | 없음(core) / `{ isInteractive: true }` | core / 각 모듈 |
| `prompt.submit`·`command.run` | 없음(core, 복원 확인 후 `next`) | core |
| `turn.complete` | `{ reason: 'answer' }` | M4, M5, M7, M8 |
| `prompt.submit` | `{ origin: { kind: 'composer' } }` | M4, M7, M2, M3 (등록 순서대로) |
| `tool.call` | `{ tool }` | M2(Bash), M3(Edit, Write) |
| `session.measure`, `agent.spawn` | 없음 | M6 |
**`classic.*`는 쓰지 않는다 [수정: 실측]**: 내장 보안 플러그인(`cc-plugin-sec-default`, 최상위 tier)이 `next.to`로 user tier를
건너뛰어 user 플러그인의 `classic.SessionStart`·`SubagentStart`·`SubagentStop`이 모두 `bypassed`된다(debug 로그 확인).
**`/clear`·`/resume` 복원 [수정: 실측]**: `/clear` 뒤에는 `$.state`가 전부 비고(세션 id 변경) `session.start`도 오지 않는다.
등록한 명령과 `$.clock` 타이머는 유지된다. 그래서 `restored` state에 복원한 모듈을 기록하고, 비어 있으면 각 모듈이 자기
훅(프롬프트·명령·턴 완료·측정)에 처음 들어올 때 store에서 다시 채운다. 복원 실패는 훅 안에서 삼킨다.
**무거운 작업은 `turn.complete`를 붙잡지 않는다**: `$.model.fork`는 시간 상한을 줄 수 없으므로 M4·M7은 `$.clock.after(0, ...)`로
떼어 내고 한 번에 하나만 돌린다.
같은 이벤트를 공유하는 훅은 자기 실패가 다른 모듈로 번지지 않게 외부 호출을 직접 try/catch한다(`.catch`가 답하면 뒤 모듈이 건너뛰어짐).

# 개발 및 검증
- 개발: `claude --plugin-dir C:\dev\takgon-mods` (저장 시 핫 리로드, `claude --debug`로 거부 사유 확인)
- 각 모듈 완료 시:
  1. `claude plugin validate C:\dev\takgon-mods` — hooks/calls 목록, gating hook, 읽는 env 이름, 거부 항목을 보고한다.
  2. `tsc -p C:\dev\takgon-mods` 타입 체크.
  3. `claude plugin test C:\dev\takgon-mods` 통과 (모듈당 최소 1개, 외부 연동은 테스트의 하위 훅으로 mock,
     UI 테스트는 `['terminal','desktop'] as const`로 반복).
  4. 변경 파일, 추가 명령, 설정 키를 보고한다.

# 구현 순서
shared → M1 → M5 → M4 → M6 → M7 → M8 → M3 → M2
**[수정]** 외부 의존성과 제약이 큰 M2(Playwright)·M3(DOM)는 마지막으로 미룬다. M3 텍스트 부분은 M2 없이 가능하다.

# 설치 (전체 완료 후) **[수정]**
`.claude-plugin/marketplace.json`을 플러그인 폴더에 둔다:
```json
{ "name": "takgon", "owner": { "name": "tglee" }, "plugins": [{ "name": "takgon-mods", "source": "./" }] }
```
```
claude plugin marketplace add C:\dev\takgon-mods
claude plugin install takgon-mods@takgon          # 범위 선택에서 user
```
- 폴더 marketplace + 상대 경로 source이므로 설치 후에도 **폴더에서 직접 읽는다**: 수정 후 `/reload-plugins`만 하면 반영된다.
- 특정 레포에서 끌 때: `claude plugin disable takgon-mods@takgon --scope local`
