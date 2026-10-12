# Claude Code mods 엔진 제약 — 실측 이슈 정리

takgon-mods(0.1.0 → 0.2.0)를 만들고 실제 세션에서 점검하며 확인한 엔진 동작과 문서 공백이다.
환경: Claude Code 2.1.296(타입 선언은 2.1.295), Windows 11, user 범위 설치(`takgon-mods@takgon`).

근거 수준 표기:
- **실측**: 실제 세션(`claude -p`, `--debug-file`, 의사 터미널로 띄운 대화형 세션)에서 확인
- **테스트 킷**: `claude plugin test`에서 관찰(실제 세션과 다를 수 있음)
- **validate**: `claude plugin validate`가 거부·보고한 내용
- **추정**: 직접 확인하지 못함

| # | 제목 | 분류 | 근거 | 심각도 | takgon-mods 대응 |
|---|---|---|---|---|---|
| 1 | user 플러그인의 `classic.*` 훅이 전부 건너뛰어짐 | 엔진 동작·문서 공백 | 실측 | 높음 | 훅 제거, 대체 이벤트 사용 |
| 2 | `/clear` 뒤 `$.state` 전체 초기화, 재초기화 이벤트 없음 | 엔진 동작·API 공백 | 실측 | 높음 | `restored` 표시 + 지연 복원 |
| 3 | 훅 실패 시 `.catch`의 `next(e)`가 같은 플러그인의 뒤쪽 훅을 건너뜀 | 엔진 동작·문서 공백 | 실측 | 중간 | 훅 안에서 예외 처리 |
| 4 | matcher 없는 등록은 이벤트마다 플러그인 전체에서 1개 | 문서 공백 | validate | 중간 | 이벤트 배정표, 공유 matcher |
| 5 | `$`·atom은 import 경계를 넘을 수 없음 | 문서 공백 | validate | 중간 | shared는 순수 함수만 |
| 6 | `$.model.fork`에 시간 상한 옵션이 없음 | API 공백 | 타입 선언 | 낮음 | `$.clock.after`로 분리 |
| 7 | 테스트 킷의 엔진 응답 규약이 문서에 없음 | 문서 공백 | 테스트 킷 | 낮음 | 테스트 헬퍼 |
| 8 | (외부) mermaid-cli SVG가 `Svg` 한도를 넘음 | 서드파티 | 실측 | 낮음 | 폰트 블록 제거 |
| 9 | 사용자·프로젝트 스킬과 이름이 겹친 명령 등록 거부가 3번과 겹쳐 초기화가 연쇄 실패 | 엔진 동작·문서 공백 | 실측 | 높음 | 등록 예외 격리 + 거부 toast, 명령 이름 변경 |

---

## 1. user 플러그인의 `classic.*` 훅이 전부 건너뛰어짐

- **분류**: 엔진 동작 / 문서 공백 · **근거**: 실측 · **심각도**: 높음
- **현상**: 내장 보안 플러그인 `cc-plugin-sec-default`(prepend tier)가 `next.to`로 user tier를 건너뛰어, user 범위로 설치한
  플러그인의 `classic.SessionStart`·`classic.SubagentStart`·`classic.SubagentStop`이 한 번도 실행되지 않는다.
- **기대**: reference 문서는 "The settings hooks' own events are hookable as `classic.<Event>`"라고만 하고 이 제한을 언급하지 않는다.
  user 플러그인에서 쓸 수 없다면 문서·validate가 알려야 한다(지금은 validate가 통과시키고 훅은 조용히 죽는다).
- **재현**: user 범위에 `on('classic.SessionStart', ...)`를 가진 mod를 설치 → `claude -p "<서브에이전트를 띄우는 프롬프트>" --debug-file log`.
- **근거(debug 로그)**:
  ```
  [DEBUG] hooks module takgon-mods@takgon loaded (worker, environment 2, tier user); events: ...classic.SessionStart,...classic.SubagentStart,classic.SubagentStop...
  [DEBUG] takgon-mods: classic.SessionStart bypassed by cc-plugin-sec-default (tier user); beneath runs
  [DEBUG] takgon-mods: classic.SubagentStart bypassed by cc-plugin-sec-default (tier user); beneath runs
  [DEBUG] takgon-mods: classic.SubagentStop bypassed by cc-plugin-sec-default (tier user); beneath runs
  ```
- **영향**: `/clear`·`/resume` 복원(`classic.SessionStart {source}`)과 서브에이전트 추적이 동작하지 않았다. 테스트 킷에서는 정상
  동작해 실제 세션에서만 드러났다.
- **대응**: `classic.*` 훅을 모두 제거. 서브에이전트는 `agent.spawn` + `$.agent.list()`, 복원은 2번 방식(`208de6f`).
- **제안**: (a) 의도된 정책이면 reference와 validate 경고에 "user tier에는 classic 이벤트가 전달되지 않음"을 명시.
  (b) 테스트 킷도 같은 정책을 재현해 테스트와 실제 동작을 일치.
- **감시**: `tools/e2e` 시나리오 `probe_classic`(`probes/classic-probe`). 엔진이 바뀌어 훅이 실행되기 시작하면 실패한다.

## 2. `/clear` 뒤 `$.state` 전체 초기화, 재초기화 이벤트 없음

- **분류**: 엔진 동작 / API 공백 · **근거**: 실측 · **심각도**: 높음
- **현상**: `/clear` 뒤에는 세션 id가 바뀌고 `$.state`가 모두 초기값으로 돌아간다. 그런데 `session.start`가 다시 오지 않는다
  (이 부분은 `SessionEndInput` 문서에 명시돼 있다). 등록한 명령과 `$.clock` 타이머는 유지된다.
  `session.end {reason:'clear'}` 훅에서 state에 쓴 값도 새 세션에는 남지 않았다.
- **기대**: state가 세션 단위로 비워진다면 새 세션의 시작을 알리는 이벤트가 있어야 한다. 지금은 1번 때문에
  `classic.SessionStart {source:'clear'}`도 user 플러그인에 오지 않아, 남는 수단이 없다.
- **재현(실험 mod, `--plugin-dir`, stream-json 입력)**:
  ```ts
  on('session.end', { reason: 'clear' }, async ($, e, next) => { await update($, ends, l => [...l, 'clear']); return next(e) })
  on('command.run', { command: 'probe' }, async ($, e) => { if (e.args.startsWith('set ')) await update($, v, () => e.args.slice(4))
    return { text: `PROBE v=${await read($, v)} ends=${(await read($, ends)).join(',')} sid=${(await $.session.id()).slice(0, 6)}` } })
  ```
  입력 `/probe set A` → `/clear` → `/probe` 결과:
  ```
  PROBE v=A ends= sid=63aa8b
  PROBE v=unset ends= sid=76f253
  ```
- **영향**: 모듈 on/off·언어·핀·할 일 등 화면 상태가 `/clear` 뒤 기본값으로 돌아갔다. 복원 시점이 없어 band·pane은 사용자의
  첫 입력 전까지 비어 있다.
- **대응**: `restored: string[]` state를 두고, 비어 있으면 각 모듈이 첫 프롬프트·명령·턴 완료 때 store에서 복원(`208de6f`).
  대화형 세션에서 모듈 설정·핀·할 일 복원을 확인했다(7/7).
- **제안**: `/clear`·`/resume` 뒤 새 세션에 대해 `session.start`를 보내거나(`reason` 필드 포함), 별도 `session.reset` 이벤트 제공.
  또는 `$.state`에 세션을 넘어 유지되는 범위(scope) 옵션 제공.
- **감시**: `tools/e2e` 시나리오 `probe_clear_state`.

## 3. 훅 실패 시 `.catch`의 `next(e)`가 같은 플러그인의 뒤쪽 훅을 건너뜀

- **분류**: 엔진 동작 / 문서 공백 · **근거**: 실측(실제 세션 `claude -p --plugin-dir`, 테스트 킷에서도 동일) · **심각도**: 중간
- **현상**: 한 플러그인 안에 같은 이벤트 훅이 여러 개일 때, 바깥 훅이 `next` 전에 예외를 던지고 `.catch(($, e, next) => next(e))`가
  답하면 체인은 **다음 플러그인부터** 이어진다. 같은 플러그인의 안쪽 훅은 실행되지 않는다. 다른 플러그인의 훅과 엔진은 정상 실행된다.
- **기대**: `.catch`가 `next(e)`를 불렀으므로 실패한 훅 바로 아래(같은 플러그인의 다음 훅)부터 이어질 것으로 기대했다.
  reference는 `.catch`의 `next(e)`가 "훅이 `next`를 불렀으면 그 결과를 재생한다"고만 하고, 훅이 `next` 전에 실패했을 때
  같은 플러그인의 나머지 훅이 어떻게 되는지는 다루지 않는다.
- **재현(실험 플러그인 2개, 슬래시 명령만 사용)**:
  ```ts
  // catch-probe
  on('session.start', async ($, e, next) => { await $.command.register({ name: 'probe2', description: 'probe' }); return next(e) })
  on('command.run', async ($, e, next) => {            // 바깥: args가 boom이면 next 전에 예외
    $.ui.log(`OUTER ran args=${e.args}`)
    if (e.args === 'boom') throw new Error('outer boom')
    return next(e)
  }).catch(($, e, next) => { $.ui.log(`CATCH ran called=${String(next.called)}`); return next(e) })
  on('command.run', { command: 'probe2' }, async ($, e) => {   // 안쪽: 같은 플러그인의 명령 처리
    $.ui.log(`INNER ran args=${e.args}`)
    return { text: `PROBE2 OK args=${e.args}` }
  })
  // catch-probe-b (다른 플러그인)
  on('command.run', async ($, e, next) => {
    $.ui.log(`B ran args=${e.args}`)
    const result = await next(e)
    $.ui.log(`B after next trace=${next.trace.map(t => `${t.plugin}:${t.outcome}`).join(',')}`)
    return result
  }).catch(($, e, next) => next(e))
  ```
  `claude -p "/probe2 boom" --plugin-dir catch-probe --plugin-dir catch-probe-b --debug-file log`
- **근거**:
  - 대조군 `/probe2` → 출력 `PROBE2 OK args=`, 로그 `OUTER ran` → `INNER ran` →
    `catch-probe (user) answered command.run without next() ...; nothing beneath it ran`
  - `/probe2 boom` → 출력 `catch-probe registered /probe2 but no command.run hook answered it`, 로그:
    ```
    [catch-probe] $.ui.log: OUTER ran args=boom
    [catch-probe] $.ui.log: CATCH ran called=false
    [catch-probe-b] $.ui.log: B ran args=boom beneath=0
    [catch-probe-b] $.ui.log: B after next trace=takgon-mods:returned,engine:returned
    [WARN] hook failed closed: catch-probe: errorKind=Error errorChars=10 (command.run; its .catch answered)
    ```
    `INNER ran`은 끝내 나오지 않는다.
- **영향**: 모듈을 한 플러그인 안에 여럿 둔 구조에서, 공유 이벤트(`prompt.submit`·`command.run`) 훅 하나의 부가 기능이 실패하면
  같은 플러그인의 다른 모듈 훅(명령 응답, context 첨부)이 함께 사라진다. takgon-mods에서 실제로 코치 판정 실패가 M2·M3·M7의
  context 첨부를, core 복원 실패가 `/mods` 응답을 막았다.
- **대응**: 공유 이벤트 훅은 외부 호출을 훅 안에서 try/catch해 훅 자체가 실패하지 않게 한다(`55aaa64`, `208de6f`).
- **제안**: (a) `.catch`의 `next(e)`가 같은 플러그인의 다음 훅부터 재개하도록 하거나, (b) 현재 동작이 의도라면 reference에
  "실패한 훅의 플러그인 안 나머지 훅은 건너뛴다"를 명시하고 validate가 같은 이벤트에 훅이 여러 개인 플러그인에 알림을 주기.
- **감시**: `tools/e2e` 시나리오 `probe_catch`.
- **제출**: anthropics/claude-code#101453

## 4. matcher 없는 등록은 이벤트마다 플러그인 전체에서 1개

- **분류**: 문서 공백 · **근거**: validate · **심각도**: 중간
- **현상**: 어떤 이벤트든 matcher 없이 두 번 등록하면 모듈 로드가 거부된다. matcher가 있으면 같은 matcher를 여러 번 써도 된다.
  ```
  on("turn.complete") is registered twice without a matcher; the first is at ...index.tsx:2
  ```
- **영향**: 모듈을 파일별로 나누면 `session.start`·`turn.complete`·`prompt.submit` 같은 공용 이벤트를 나눠 쓸 수 없다.
  플러그인 설계 초기에 알아야 하는 제약인데 skill·reference에 없다.
- **대응**: 공유 matcher(`{ isInteractive: true }`, `{ reason: 'answer' }`, `{ origin: { kind: 'composer' } }`)와 이벤트 배정표(SPEC).
- **제안**: reference에 규칙 명시. 판별 필드가 없는 이벤트(`session.measure` 등)를 여러 모듈이 구독할 방법 제공.
- **제출**: anthropics/claude-code#101450

## 5. `$`·atom은 import 경계를 넘을 수 없음

- **분류**: 문서 공백 · **근거**: validate · **심각도**: 중간
- **현상**:
  ```
  $ is passed to "startSession", imported from "./core": $ is followed only into a function declared in this same file, never across an import
  $ is passed to "start", which is not a function declared at the top of this file
  the state library's update takes a source ... written there or in a const of this file
  ```
  `on`은 import한 함수로 넘겨도 된다.
- **영향**: `$`를 쓰는 공통 헬퍼(toast 1회, 출력 폴더 생성 등)를 공유할 수 없어 모듈마다 같은 코드가 반복된다.
  모듈 간 공유 state도 파일마다 같은 리터럴로 atom을 다시 선언해야 한다.
- **제안**: reference의 "A mod in one paragraph"에 규칙 명시. 가능하면 import한 함수 안으로의 정적 추적 지원.
- **제출**: anthropics/claude-code#101451

## 6. `$.model.fork`에 시간 상한 옵션이 없음

- **분류**: API 공백 · **근거**: 타입 선언(`ModelForkRequest`는 `prompt`만) · **심각도**: 낮음
- **현상**: `$.model.complete`는 `timeoutMs`를 받지만 `$.model.fork`는 받지 않는다. `turn.complete` 훅에서 fork를 기다리면 턴
  마무리가 fork 시간만큼 늦어질 수 있다(hook 예산은 `$` 호출 대기를 세지 않는다).
- **대응**: `$.clock.after(0, ...)`로 떼어 내고 한 번에 하나만 실행(`208de6f`).
- **제안**: `ModelForkRequest`에 `timeoutMs`·`maxTokens` 추가.
- **제출**: anthropics/claude-code#101446

## 7. 테스트 킷의 엔진 응답 규약이 문서에 없음

- **분류**: 문서 공백 · **근거**: 테스트 킷 · **심각도**: 낮음
- **현상**(시행착오로 알아낸 것):
  - op(`$.x.y` 호출) 훅은 `{ value: 결과 }`를 반환해야 한다(값만 반환하면 "not a result object").
  - 테스트의 `$`(Engine)에는 `store` 명사가 없다. `mock.store`로 주입하고 동작으로 검증해야 한다.
  - `session.start`, `session.root`, `command.register` 등은 테스트 훅이 직접 답해야 한다. 답하지 않으면 플러그인 초기화 훅이 조용히 skip된다.
  - `$.command.run`은 `origin`·`presentation`까지 전체 입력을 받는다.
  - `$.ui.ask`는 `tool.call {tool:'AskUserQuestion'}`으로 mock한다.
  - **엔진의 거부는 `{ deny: 사유 }`로 답해야 한다.** 엔진 자리 훅이 `throw`하면 그 훅이 "skip"된 것으로 처리된다.
    그러면 호출한 플러그인에는 거부 사유 대신 `no implementation for <op>`가 전달된다(9번 회귀 테스트에서 확인).
    ```ts
    // 잘못: 플러그인은 "no implementation for command.register"를 받는다
    on('command.register', ($, e) => { throw new Error(`"/${e.name}" refused: ...`) })
    // 맞음: 플러그인의 $.command.register가 이 사유로 reject된다
    on('command.register', ($, e) => ({ deny: `"/${e.name}" refused: it is the user's /${e.name}` }))
    ```
- **제안**: `claude-code/testing` 문서에 "엔진 자리 훅 작성법" 절과 기본 응답 helper(`mock.session()` 확장 등) 제공.
  특히 실제 엔진의 거부를 흉내 내는 방법(`{ deny }`)과 `throw`의 차이를 명시.
- **제출**: anthropics/claude-code#101447

## 8. (외부) mermaid-cli SVG가 `Svg` 표시 한도를 넘음

- **분류**: 서드파티(`@mermaid-js/mermaid-cli` 12.0.0) · **근거**: 실측 · **심각도**: 낮음
- **현상**: mmdc가 Recursive 폰트 4종을 base64로 SVG에 넣어, 노드 3개 다이어그램도 197,069자(폰트 167,055자)다.
  desktop `Svg`의 `source` 한도(131,072자)를 넘는다.
- **대응**: 표시할 때만 `@font-face` style 블록 제거 → 29,999자(`b07f40b`).

---
- **추가 확인(2026-10-12)**: 폰트 내장은 mermaid-cli 12.0.0의 의도된 기본 동작이다(PR #1189·#1190, 릴리스 노트에 크기 증가와 `--no-font-embed` 명시). 다만 Recursive 폰트의 `unicode-range` 조각 4개를 다이어그램 문자와 무관하게 모두 넣는다. 영문 다이어그램은 Latin 조각 하나만, 한글 다이어그램은 어느 조각도 쓰지 않는다.
- **업스트림 제안 초안**: `docs/issues/mermaid-cli-font-subset.md`(쓰인 문자와 겹치는 조각만 내장). 미제출.

## 9. 스킬과 이름이 겹친 명령 등록 거부가 3번과 겹쳐 초기화가 연쇄 실패

- **분류**: 엔진 동작 / 문서 공백 · **근거**: 실측(대화형 세션 debug 로그, `.catch` 계측) · **심각도**: 높음
- **현상**: 사용자 스킬 `~/.claude/skills/handoff`가 있는 환경에서 M7이 `/handoff`를 등록하면 엔진이 거부한다.
  M7의 `session.start` 훅은 `.catch(($, e, next) => next(e))`를 달고 있었다. 그래서 3번 동작대로 같은 플러그인의 뒤쪽
  `session.start` 훅(M2 `/browse`, M3 `/edit`, M5 `/issue` 등록)이 모두 건너뛰어졌다. 사용자는 `/browse`가 "Unknown command"로만 보였다.
- **근거**:
  - debug 로그: `/mods`·`/coach`·`/panel`·`/pin`만 `listed`, 이어서
    `[WARN] hook failed closed: takgon-mods: errorKind=HooksError errorChars=78 (session.start; its .catch answered)`.
    로그에는 오류 길이만 남아 원인을 알 수 없었다.
  - `.catch`에 `$.ui.log(next.error.message)`를 넣어 계측한 결과:
    ```
    M7-DIAG kind=throw msg=takgon-mods: $.command.register: "/handoff" refused: it is the user's /handoff
    ```
  - 테스트 프로젝트에 `.claude/skills/browse/SKILL.md`(프로젝트 스킬)를 두어도 `/browse`가 같은 문구로 거부된다.
    엔진은 프로젝트 스킬이어도 사유를 "user's"로 표시한다.
- **추가 관찰(조건 불명)**: 같은 사용자 스킬이 있는데도 앞선 한 대화형 세션에서는 `/handoff`가 등록돼 플러그인 명령이 응답했다.
  어떤 조건에서 거부되는지(스킬 로드 순서 등)는 확인하지 못했다.
- **문서 공백**: `command.register` 문서는 "a built-in's name is refused"만 언급한다. 사용자·프로젝트 스킬과 명령도 거부 대상이라는
  점과 그 사유 문구는 문서에 없다. validate는 실행 환경의 스킬을 모르므로 미리 잡지 못한다.
- **영향**: 플러그인 설치자의 개인 스킬 이름에 따라 플러그인 일부가 조용히 사라진다. 3번과 겹치면 충돌한 모듈과 무관한 모듈까지 함께 사라진다.
- **대응**(`3ab55e0`, `26a7ce3`):
  - 모든 `$.command.register`를 모듈 파일의 헬퍼로 감싸 거부를 삼킨다. 다른 초기화는 계속된다.
  - 거부된 명령은 이름과 사유를 명령마다 세션당 1회 toast로 알린다.
  - M7 명령 이름을 `/tk-handoff`로 바꿨다.
  - 회귀 테스트 `tests/integration.test.tsx`를 추가했다. 테스트 킷에서 엔진 거부는 `{ deny }`로 답해야 사유가 전달된다.
- **제안**:
  - (a) `command.register` 문서와 `CommandSpec`에 "사용자·프로젝트 명령·스킬과 같은 이름도 거부"를 명시.
  - (b) debug 로그의 `hook failed closed` 줄에 오류 메시지(최소한 앞부분)를 남겨, 계측 없이 원인을 알 수 있게.
  - (c) 거부 사유 문구가 스킬 출처(user/project)를 구분하도록.
- **제출**: anthropics/claude-code#101452

## 기타 관찰(이슈 아님)

- `claude -p`(비대화형)는 `session.start`의 `isInteractive`가 false라, takgon-mods 모듈 초기화(명령 등록 등)가 돌지 않는다. 설계상 의도다.
- Git Bash에서 `claude -p "/mods"`를 실행하면 MSYS가 `/mods`를 경로(`C:/Program Files/Git/mods`)로 바꾼다.
  `MSYS_NO_PATHCONV=1`이 필요하다(엔진 문제 아님).
- 설치 직후 이미 떠 있는 세션은 새 PATH를 보지 못해, 설치한 CLI(gh 등)를 `$.process.run`이 찾지 못한다.
