# takgon-mods

Claude Code용 개인 생산성 mods 플러그인. 모듈 8개를 한 플러그인으로 묶었고, `/mods`로 모듈별로 켜고 끈다.

| 모듈 | 명령 | 하는 일 |
|---|---|---|
| i18n | – | Spinner·턴 종료 줄 등 내장 UI 일부를 한국어로 표시 |
| integrations | `/issue` | 현재 브랜치 PR(GitHub, `gh`)·MR(GitLab, `glab`) 상태 폴링, Linear 이슈 검색·연결·상태 변경 |
| composer | `/coach` | 프롬프트 위 band: PR/MR 배지, 다음 작업 후보, 모호한 요청 다듬기 |
| panel | `/panel`, `/pin` | 작업 패널(핀·할 일·서브에이전트·사용량·인수인계), 사용량 경고(`/panel threshold`) |
| handoff | `/tk-handoff` | 컨텍스트 사용률 임계치(기본 75%)에서 인수인계 문서 자동 작성, 다음 프롬프트에 첨부 |
| browser | `/browse` | Bash 출력의 localhost URL 감지, 스크린샷·콘솔 에러 수집 |
| edit | `/edit` | 수정 대상(파일 행 범위·선택 영역·DOM 요소) 지정, 범위 밖 Edit·Write 차단 |
| diagram | – | 응답의 mermaid 블록을 SVG/PNG로 렌더 |

## 사용법

### `/mods`: 모듈 on/off와 명령 등록 상태

```
/mods                      # 모듈 목록, 켜짐/꺼짐, 각 모듈 명령의 등록 결과
/mods <모듈> on|off        # 예: /mods composer off
/mods lang ko|en           # UI 언어
```

목록의 모듈 줄 끝에 그 모듈 명령의 등록 결과가 붙는다.

```
- panel (작업 패널): 켜짐 · /panel ✓ /pin ✓
- browser (브라우저 미리보기): 켜짐 · /browse ✗ (it is the user's /browse)
명령: ✓ 등록됨 · ✗ 등록 거부(사유) · ? 아직 등록 결과 없음
```

- `✗`는 같은 이름의 사용자·프로젝트 명령이나 스킬이 있어 등록이 거부된 것이다. 그 이름으로 입력하면 그쪽이 실행된다.
  거부되면 세션 시작 때 명령마다 toast로 한 번 알리고, 다른 모듈은 정상 동작한다.
- 결과는 프로젝트별로 저장돼 `/clear` 뒤에도 보인다. 아직 등록한 적이 없으면 `?`로 나온다.

### 임계치 설정

| 명령 | 기본값 | 뜻 |
|---|---|---|
| `/panel threshold` | 80% | 현재 사용량 경고 임계치 보기 |
| `/panel threshold <1-99>` | – | 컨텍스트·사용 한도(5시간·7일)가 이 %에 이르면 세션당 한 번 toast로 경고 |
| `/tk-handoff threshold` | 75% | 현재 자동 인수인계 임계치 보기 |
| `/tk-handoff threshold <1-99>` | – | 답변이 끝났을 때 컨텍스트 사용률이 이 % 이상이면 세션당 한 번 인수인계 문서를 자동 작성 |

- 두 값 모두 모든 프로젝트에 공통으로 저장된다(`g/m6/threshold`, `g/m7/threshold`).
- 현재 사용량 경고 임계치는 `/panel usage` 탭에서도 볼 수 있다.
- 인수인계가 사용량 경고보다 먼저 일어나게 하려면 `/tk-handoff` 임계치를 `/panel` 임계치보다 낮게 둔다.

## 설치

저장소는 public이라 별도 인증 없이 설치할 수 있다. 마켓플레이스는 파일 1개짜리 별도 저장소
[`astromelon/takgon-marketplace`](https://github.com/astromelon/takgon-marketplace)이고, 플러그인 본체는 이 저장소
(`astromelon/takgon-mods`)다. 마켓플레이스를 분리한 이유는 아래 EPERM 항목을 본다.

Claude Code 터미널 세션의 프롬프트에서:

```
/plugin install takgon-mods --marketplace astromelon/takgon-marketplace
```

`Add marketplace?`에 `y`, 설치 범위는 user(모든 프로젝트)를 고른다. CLI로는:

```bash
claude plugin marketplace add astromelon/takgon-marketplace
claude plugin install takgon-mods@takgon
```

이전에 `astromelon/takgon-mods`를 마켓플레이스로 등록했다면 이름이 같은 `takgon`이라 그대로 동작하고 업데이트도 된다.
EPERM이 나던 PC는 `claude plugin marketplace remove takgon` 후 위 명령으로 다시 등록한다(설치된 플러그인도 함께
제거되므로 `install`을 다시 한다).

> **주의: 마켓플레이스 이름을 바꾸거나 store 파일을 직접 만지기 전에는 store를 백업한다.** 이름이 `takgon`인 채로
> 소스를 바꾸거나 `marketplace remove` → `add`를 하는 전환은 백업이 필수는 아니지만, 해두면 안전하다.
> 핀(`/panel`)·M5 연결 이슈·M4 작업 목록·M7 인수인계 같은 저장 데이터는 `~/.claude/plugins/store/`의
> `takgon-mods_<마켓플레이스 이름>-<해시>.json` 한 파일에 들어 있다. 파일명은 플러그인 ID(`takgon-mods@takgon`)로만
> 정해지므로, 마켓플레이스 **이름**이 `takgon`으로 같으면 소스(로컬 디렉터리 → GitHub)나 경로가 바뀌어도 같은 파일을
> 쓴다. 이름을 바꾸면 다른 파일이 되어 기존 데이터를 읽지 못한다. `uninstall`·`marketplace remove`는 이 파일을
> 지우지 않는다(임시 환경에서 `uninstall` → `remove` → GitHub 소스로 `add` → `install` 뒤에도 파일과 내용이 그대로인 것을
> 확인했다. 엔진이 만든 파일이 아니라 같은 이름의 센티널 파일로 CLI 동작만 본 것이고, 세션을 돌린 검증은 아니다). 그래도 이름을 바꾸는 전환에 대비해 절차는 아래 [마켓플레이스 전환 전 store 백업·복원](#마켓플레이스-전환-전-store-백업복원)을 따른다.
> 토큰(`GITHUB_TOKEN`, `LINEAR_API_KEY`)은 store에 저장하지 않고 환경변수로만 읽으므로 영향이 없다.

### `marketplace add`가 EPERM으로 실패할 때

파일이 많은 저장소(옛 `astromelon/takgon-mods` 마켓플레이스 소스)를 add하면 일부 Windows PC에서 아래 오류로 실패했다.
마켓플레이스를 파일 1개짜리 저장소로 분리한 뒤에는 임시 환경 실험(5회)에서 add·install이 모두 성공했다.
그래도 아래 오류가 나면 다음을 따른다.

```
Failed to finalize marketplace cache ... EPERM: operation not permitted, rename '...\astromelon-takgon-mods' -> '...\takgon'
```

저장소는 이미 받아졌고, 폴더 이름을 바꾸는 순간 다른 프로세스(실시간 검사 백신 등으로 추정)가 폴더 안 파일을 잡고 있어서
난다. 항상 재현되지는 않는다. 아래 순서로 대처한다.

1. 같은 명령을 한 번 더 실행한다. 타이밍에 따라 성공하기도 한다.
2. 저장소를 직접 받아 로컬 디렉터리 소스로 등록한다(이 방식은 이 PC에서 확인됨). 갱신은 `git pull` 후
   `claude plugin marketplace update takgon` → `claude plugin update takgon-mods@takgon`이다.

   ```bash
   git clone https://github.com/astromelon/takgon-mods.git
   claude plugin marketplace add ./takgon-mods
   claude plugin install takgon-mods@takgon
   ```
3. 백신의 실시간 검사 예외에 Claude 설정 폴더(`~/.claude/plugins`)를 넣으면 해결될 수 있다(확인하지 못한 추정).

### 마켓플레이스 전환 전 store 백업·복원

마켓플레이스 소스를 바꾸거나 `marketplace remove`·플러그인 `uninstall`을 하기 전에 한다. 저장 데이터(핀, M5 연결 이슈,
M4 작업 목록, M7 인수인계 등)는 `~/.claude/plugins/store/` 안의 `takgon-mods_<마켓플레이스 이름>-<해시>.json` 한 파일이다.
파일명의 해시는 `sha256("<플러그인>@<마켓플레이스 이름>")`의 앞 12자리다(`takgon-mods@takgon` → `2488473fd961`, 이 PC에서
일치 확인). 소스나 경로는 해시에 들어가지 않으므로 이름이 `takgon`인 채로 소스만 바꾸는 전환은 파일명이 그대로다. 이름을 바꿀
때만 아래 3번의 "파일명이 다르다" 경우가 된다.

**백업** (열린 세션을 모두 닫은 뒤)

```powershell
$store = "$env:USERPROFILE\.claude\plugins\store"
$bak = "$env:USERPROFILE\.claude\backup-takgon-store-$(Get-Date -Format yyyyMMdd-HHmm)"
New-Item -ItemType Directory $bak | Out-Null
Copy-Item "$store\takgon-mods_*.json" $bak
Get-ChildItem $bak   # 파일이 보이는지 확인
```

**전환 후 확인**

1. 전환(`marketplace add` → `plugin install`)을 마치고 Claude Code를 새로 시작한다.
2. `/panel`의 핀·할 일 등 저장 데이터가 남아 있는지 본다. 남아 있으면 끝이다. 백업은 며칠 두었다가 지운다.
3. 비어 있으면 세션을 모두 닫고 `~/.claude/plugins/store/`를 확인한다. 엔진이 열려 있는 동안 파일을 덮어쓸 수 있어
   세션을 연 채 복사하지 않는다.
   - **파일명이 백업과 같다**: 백업 파일을 그대로 덮어 복사한다.
   - **파일명이 다르다**(마켓플레이스 이름을 바꿔 해시가 달라진 경우): 새 파일이 이미 만들어졌다면 백업 파일을 **새 파일명으로** 복사한다.
     새 파일에만 있는 데이터는 사라지므로 덮어쓰기 전에 새 파일도 따로 복사해 둔다.
4. 세션을 다시 열어 데이터가 보이는지 확인한다.

store 파일은 JSON 하나이며 4 MiB 상한이 있다. 키는 `g/<모듈>/<키>`(전역)와 `p/<프로젝트 해시>/<모듈>/<키>`(프로젝트)다.
프로젝트 해시는 프로젝트 루트 경로로 정해지므로 경로가 바뀐 프로젝트의 데이터는 복원해도 새 경로에서 보이지 않는다.

### 업데이트

마켓플레이스 사본을 먼저 갱신한 뒤 플러그인을 업데이트한다. 순서를 바꾸면 이전 버전이 그대로 남는다.

```bash
claude plugin marketplace update takgon
claude plugin update takgon-mods@takgon
```

세션 안에서는 `/plugin marketplace update takgon` → `/plugin update takgon-mods@takgon`. 끝나면 열린 세션에서
`/reload-plugins`(또는 세션 재시작). 설치된 버전은 `claude plugin list`로 확인한다.

### 새 버전 배포 절차(저장소 관리자)

`plugin.json`의 `version`이 그대로면 다른 PC의 `plugin update`가 새 커밋이 있어도 "이미 최신"으로 판단한다.
mods를 고쳐 다른 PC에 반영하려면:

1. 변경 사항을 `CHANGELOG.md`의 `[Unreleased]`에 기록하고 커밋해 작업 트리를 깨끗하게 만든다.
2. 스크립트로 버전을 올린다(`patch`·`minor`·`major` 또는 `0.4.2` 같은 정확한 버전).

   ```bash
   node tools/release.mjs patch              # 파일만 수정하고 diff 출력
   node tools/release.mjs patch --push       # 수정 + 커밋 + push (--commit은 커밋까지만)
   ```

   스크립트는 `.claude-plugin/plugin.json`의 `version`을 올리고, `[Unreleased]` 내용을 `## [x.y.z] - YYYY-MM-DD`
   절로 옮기며, 커밋 메시지는 `build: x.y.z로 버전을 올리고 CHANGELOG 정리`로 만든다.
3. 다른 PC에서 위 업데이트 명령 두 개를 순서대로 실행한다.

CI는 `node tools/release.mjs --check`로 `plugin.json` 버전과 CHANGELOG 최상단 버전 절이 같은지 검사한다.

특정 저장소에서만 끄기: `claude plugin disable takgon-mods@takgon --scope local`

## 선택 의존성

없으면 해당 기능만 숨기고 원인별로 한 번 알린다.

| 기능 | 필요 | 준비 |
|---|---|---|
| PR 배지(GitHub) | `gh` | 설치 후 `gh auth login` |
| MR 배지(GitLab) | `glab` | 설치 후 `glab auth login --hostname <호스트>` |
| Linear | 환경변수 `LINEAR_API_KEY` | Linear 개인 API 키 |
| `/browse`, `/edit dom` | Node.js, playwright | 플러그인 폴더에서 `npm install && npx playwright install chromium`(전역 설치는 인식되지 않음) |
| 다이어그램 | `mmdc` | `npm i -g @mermaid-js/mermaid-cli` |

## 개발

```bash
claude --plugin-dir <이 폴더>      # 저장 시 핫 리로드
claude plugin validate <이 폴더>
claude plugin test <이 폴더>
```

푸시 전에 CI와 같은 검사(버전 검사 → validate → test → e2e 하네스 단위 테스트 → e2e probe)를 한 번에 돌리려면 저장소 루트에서:

```bash
node tools/ci-local.mjs                  # 첫 실패에서 멈춘다
node tools/ci-local.mjs --keep-going     # 실패해도 끝까지 돌려 요약만 낸다
node tools/ci-local.mjs --install-deps   # e2e 의존성(pywinpty, pyte)을 먼저 설치한다. 새 PC에서 처음 한 번
node tools/ci-local.mjs --tsc            # CI에 없는 타입 체크를 덧붙인다
```

e2e는 Windows 전용 하네스(의사 터미널)라 Windows에서만 돌고, CI는 Claude Code 2.1.296으로 고정이라 로컬 버전이 다르면
경고가 나온다.

- 설계와 결정 사항: `SPEC.md`
- 실제 세션에서 확인한 엔진 제약: `docs/engine-constraints.md`
- 변경 이력: `CHANGELOG.md`
