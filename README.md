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

> **주의: 마켓플레이스 이름을 바꾸거나 store 파일을 직접 만지기 전에는 store를 백업한다.** 핀·M5 연결 이슈·M4 작업 목록·M7
> 인수인계 같은 저장 데이터는 `~/.claude/plugins/store/`의 `takgon-mods_<마켓플레이스 이름>-<해시>.json` 한 파일에 있다.
> 이름이 `takgon`으로 같으면 소스(로컬 → GitHub)나 경로가 바뀌어도, `uninstall`·`marketplace remove`를 해도 같은 파일이 그대로
> 쓰인다. **이름이 바뀌면 새 파일이 만들어져 기존 데이터를 읽지 못한다.** 절차는
> [store 백업·복원](#마켓플레이스-전환-전-store-백업복원)을 따른다. 토큰(`GITHUB_TOKEN`, `LINEAR_API_KEY`)은 store에 저장하지
> 않으므로 영향이 없다.

### `marketplace add`가 EPERM으로 실패할 때

파일이 많은 저장소(옛 `astromelon/takgon-mods` 마켓플레이스 소스)를 add하면 일부 Windows PC에서 아래 오류로 실패했다.
이 PC의 임시 환경에서는 옛 방식이 13회 중 12회 실패했다. 파일 1개짜리 마켓플레이스(`astromelon/takgon-marketplace`)로
분리한 뒤에는 저부하에서 101회 중 3회(연달아 발생, 이후 91회는 0건)로 줄었지만 없어지지는 않았다. 이후 같은 PC에서 약 61회 중
6회가 4분 안에 몰려 났고(전문 확보), 그 뒤 부하 통제 실험 126회와 5분 간격 8시간 감시 97회에서는 재현되지 않았다. 실패한 add는
`Failed to finalize marketplace cache`로 시작하고, add 성공 뒤 install을 확인한 17회는 모두 성공했다. 다른 PC의 결과는
확인하지 못했다.

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

실패가 계속되면 증거를 모아 이슈에 올린다. `tools\capture-add-failure.ps1`이 실행마다 새 임시 설정 폴더에서 `marketplace add`를
돌리고, 실패하면 에러 전문(EPERM 포함 여부), `plugins\marketplaces` 상태, 후보 프로세스(백신·검색 인덱서·OneDrive 등), CPU
사용률 상위, 파일 점유 프로세스(알 수 있을 때)를 증거 파일로 남긴다. 실제 `~/.claude`는 건드리지 않는다.

```powershell
# 실패할 때까지 최대 50회(첫 실패에서 멈춤). 저장소 루트에서
powershell -NoProfile -ExecutionPolicy Bypass -File tools\capture-add-failure.ps1 -Runs 50
# 끝까지 돌려 실패율을 보려면(-File이 아니라 -Command). -LogCsv는 성공한 실행을 포함해 모든 실행의 시스템 CPU·디스크 평균을 기록한다
powershell -NoProfile -ExecutionPolicy Bypass -Command "& 'tools\capture-add-failure.ps1' -Runs 30 -StopOnFail:$false -LogCsv run.csv -Label baseline"
```

저장소를 받지 않았다면 설치된 플러그인 폴더(`~/.claude/plugins/cache/takgon/takgon-mods/<버전>/tools/`)에서 같은 명령을 쓴다.
증거 파일에는 사용자명·경로·프로세스 이름이 들어 있으니 올리기 전에 가린다. 한계: 원인을 확정하지는 못하고 정황 증거만 남긴다.
증거 파일의 프로세스별 CPU(WMI 값)는 코어 수를 넘는 값이 나올 수 있어 순위로만 읽는다. 시스템 전체 부하는 `-LogCsv`의 평균이 정확하다.

이 PC에서 이 스크립트로 약 61회를 돌렸더니 EPERM이 6회 났고, 4분 안에 몰려 연달아 난 적도 있다. 이어서 부하를 통제해 시험했다
(부하 없음·CPU 100% 점유·파일 생성/삭제 반복을 교차해 96회, 새 스크립트 파일을 만든 직후 실행 30회). 126회 모두 성공했다. 즉
CPU·디스크 부하만으로는 재현되지 않았고 원인은 아직 모른다. 네트워크 오류(`Empty reply from server`) 1회는 EPERM이 아니라 집계에서 뺐다.

### 마켓플레이스 전환 전 store 백업·복원

마켓플레이스 이름을 바꾸기 전, 또는 store 파일을 직접 만지기 전에 한다. 이름이 `takgon`인 채로 소스를 바꾸거나
`marketplace remove`·`uninstall`을 하는 전환은 백업이 필수는 아니지만 해두면 안전하다.

파일명의 해시는 `sha256("<플러그인>@<마켓플레이스 이름>")`의 앞 12자리다(`takgon-mods@takgon` → `2488473fd961`,
`takgon-mods@takgon-alt` → `610bad6656c8`). 소스와 경로는 해시에 들어가지 않으므로 이름을 바꿀 때만 파일명이 달라진다.

아래 절차는 임시 `CLAUDE_CONFIG_DIR`에서 실제 세션으로 확인했다(백업 명령은 `$env:USERPROFILE\.claude` 대신 그 설정 폴더로
바꿔 실행했다).
- 같은 이름으로 `marketplace remove` → `add` → `install`을 해도 핀이 그대로 남았다.
- store 파일을 지우면 핀이 비었고, 백업 파일을 복사하자(세션을 연 채가 아니라 닫은 상태에서) 핀이 돌아왔다.
- 이름만 `takgon-alt`로 바꾸자 핀이 비었고 새 파일이 생겼으며, 기존 파일은 그대로였다. 백업을 **새 파일명으로** 복사하자 핀이 돌아왔다.

**스크립트로 하기** (권장). 열린 Claude Code 세션을 모두 닫고 별도 PowerShell에서, 저장소 루트(또는 설치된 플러그인의
`tools/` 폴더)에서 실행한다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\store-backup.ps1 List      # store 파일·백업 폴더 목록(바꾸지 않음)
powershell -NoProfile -ExecutionPolicy Bypass -File tools\store-backup.ps1 Backup    # <설정 폴더>\backup-takgon-store-<시각>에 복사 후 해시 확인
powershell -NoProfile -ExecutionPolicy Bypass -File tools\store-backup.ps1 Restore   # store 파일이 든 가장 최근 백업을 현재 마켓플레이스 파일명으로 복원(-WhatIf로 미리 보기)
```

`Restore`는 설치된 마켓플레이스 이름(`installed_plugins.json`)으로 파일명을 계산해, 이름이 같으면 덮어쓰고 이름이 바뀌었으면 새
파일명으로 복사한다. 덮어쓰기 전에 현재 파일을 백업 폴더에 `before-restore-*`로 남기고, 덮어쓴 결과가 백업과 다르면 그 파일로 되돌린다.
다음 경우에는 멈춘다: JSON 객체가 아니거나 4 MiB를 넘는 백업, 여러 파일 중 대상을 못 고르는 백업, 설치된 마켓플레이스를 알 수 없거나
둘 이상인 경우(`-Marketplace <이름>`으로 지정, 영문·숫자·`.`·`_`·`-`만 허용), 이름이 `claude`인 프로세스가 있는 경우(`-Force`로 무시).
마지막 검사는 세션 수가 아니라 `claude`라는 이름의 프로세스를 세므로 설정 폴더가 다른 세션이나 다른 프로세스도 세고, `node.exe`로
도는 세션은 세지 못한다. 그래서 확인용으로만 믿는다. `-WhatIf`는 아무것도 쓰지 않으므로 이 경우 경고만 내고 미리 보기를 계속한다.

가짜 설정 폴더로 하는 시험은 저장소에 있다(`tools\test-store-backup.ps1`, 34개 점검: 백업·같은 이름 복원·이름 변경 복원·깨진/배열/문자열
백업·경로 구분자가 든 `-Marketplace`·`installed_plugins.json` 변형·상대 경로·`-WhatIf` 등). CI가 Windows PowerShell 5.1과 PowerShell 7에서
돌린다. 이 시험은 실제 Claude Code 세션을 쓰지 않으므로, 임시 `CLAUDE_CONFIG_DIR`의 실제 세션으로도 한 번 확인했다(Windows PowerShell 5.1,
위 수정본을 저장소에서 직접 실행, 각 단계 1회). `/pin`으로 핀 1개를 만들어 `Backup` → 핀을 1개 더 만든 뒤 `Restore`하자 세션의
`/pin list`가 다시 1개가 되었다. 마켓플레이스 이름을 `takgon-alt`로 바꿔 설치하자 핀이 비고 새 파일이 생겼으며, `-Marketplace` 없이
`Restore`만 해도 새 파일명으로 복사되어 핀이 돌아왔다(이전 새 파일은 `before-restore-*`로 남았다). 이 스크립트는 v0.4.8부터 설치된
플러그인의 `tools/`에 들어 있지만, 위 수정은 다음 릴리스에 들어간다.

**수동으로 하려면** (열린 세션을 모두 닫은 뒤)

```powershell
$store = "$env:USERPROFILE\.claude\plugins\store"
$bak = "$env:USERPROFILE\.claude\backup-takgon-store-$(Get-Date -Format yyyyMMdd-HHmmss)"
New-Item -ItemType Directory $bak | Out-Null
Copy-Item "$store\takgon-mods_*.json" $bak
Get-ChildItem $bak   # 파일이 보이는지 확인
```

**전환 후 확인**

1. 전환(`marketplace add` → `plugin install`)을 마치고 Claude Code를 새로 시작한다.
2. `/pin list`·`/panel`로 저장 데이터가 남아 있는지 본다. 남아 있으면 끝이다. 백업은 며칠 두었다가 지운다.
3. 비어 있으면 세션을 **모두 닫고** `~/.claude/plugins/store/`를 확인한다(엔진이 열려 있는 동안 파일을 덮어쓸 수 있다).
   - 파일명이 백업과 같으면 백업 파일을 그대로 덮어 복사한다.
   - 파일명이 다르면(이름을 바꿔 해시가 달라진 경우) 백업 파일을 **새 파일명으로** 복사한다. 새 파일에만 있는 데이터는 사라지므로
     덮어쓰기 전에 새 파일도 따로 복사해 둔다.
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

### `plugin update`가 `Host key verification failed`로 실패할 때

`marketplace update`는 성공하는데 `plugin update`가 아래 오류로 실패하는 PC가 있었다. 저장소는 public이라 접근 권한 문제가 아니다.
플러그인을 SSH 주소로 클론하는데 이 PC의 `~/.ssh/known_hosts`에 `github.com` 호스트 키가 없어서 난다.

```
✘ Failed to update plugin "takgon-mods@takgon": Failed to clone repository: ...
No ED25519 host key is known for github.com and you have requested strict checking.
Host key verification failed.
```

둘 중 하나로 해결한다.

1. 이번 한 번만 HTTPS로 받는다. 환경변수는 이 명령에만 적용되고 git 설정과 `known_hosts`는 바뀌지 않는다(이 PC에서 확인됨).

   ```bash
   GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.https://github.com/.insteadOf" GIT_CONFIG_VALUE_0="git@github.com:" \
     claude plugin update takgon-mods@takgon
   ```

   PowerShell은 같은 값을 먼저 `$env:GIT_CONFIG_COUNT=1; $env:GIT_CONFIG_KEY_0="url.https://github.com/.insteadOf";
   $env:GIT_CONFIG_VALUE_0="git@github.com:"`로 설정한 뒤 명령을 실행한다(`git ls-remote`로 SSH 주소가 HTTPS로 바뀌어
   성공하는 것을 확인했다. `claude plugin update` 전체를 PowerShell로 돌려 보지는 않았다).
2. 호스트 키를 한 번 등록한다. `ssh -T git@github.com`을 실행하면 `ED25519 key fingerprint is: SHA256:...`이 나오는데,
   [GitHub 공개 SSH 키 지문](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints)의
   ED25519 값(`SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`)과 같으면 `yes`로 답한다. 이후 같은 명령은 확인 창 없이 지나간다.
   **GitHub에 SSH 키를 등록해 둔 PC에서만 해결된다.** 키가 없으면 호스트 키는 등록돼도 마지막 줄이
   `git@github.com: Permission denied (publickey).`로 끝나고, SSH 클론은 이번엔 이 오류로 실패한다. 키가 없는 PC는 1번을 쓴다.
   (임시 `known_hosts`로 이 PC에서 확인한 것은 지문 표시·`yes` 후 등록·재실행 시 확인 창 없음·키가 없을 때 `publickey` 오류까지다.
   SSH 키가 있는 환경에서 `plugin update`가 성공하는 것까지는 확인하지 못했다.)

### 새 버전 배포 절차(저장소 관리자)

`plugin.json`의 `version`이 그대로면 다른 PC의 `plugin update`가 새 커밋이 있어도 "이미 최신"으로 판단한다.
mods를 고쳐 다른 PC에 반영하려면:

1. 변경 사항을 `CHANGELOG.md`의 `[Unreleased]`에 기록하고 커밋해 작업 트리를 깨끗하게 만든다.
2. 스크립트로 버전을 올린다(`patch`·`minor`·`major` 또는 `0.4.2` 같은 정확한 버전).

   ```bash
   node tools/release.mjs patch              # 파일만 수정하고 diff 출력
   node tools/release.mjs patch --push       # 수정 + 커밋 + 태그 + push (--commit은 커밋·태그까지만)
   ```

   스크립트는 `.claude-plugin/plugin.json`의 `version`을 올리고, `[Unreleased]` 내용을 `## [x.y.z] - YYYY-MM-DD`
   절로 옮기며, 커밋 메시지는 `build: x.y.z로 버전을 올리고 CHANGELOG 정리`로 만든다. `--commit`·`--push`에서는 그 커밋에
   주석 태그 `vx.y.z`도 달고, `--push`는 커밋과 태그를 함께 올린다. 같은 태그가 이미 있으면 파일을 바꾸기 전에 멈춘다.
3. 다른 PC에서 위 업데이트 명령 두 개를 순서대로 실행한다.

CI는 `node tools/release.mjs --check`로 `plugin.json` 버전과 CHANGELOG 최상단 버전 절이 같은지, `--check-tags`로 태그
`vX.Y.Z`마다 그 커밋의 `plugin.json`·CHANGELOG 버전이 `X.Y.Z`인지와 현재 버전의 태그가 있는지(HEAD의 조상인지)를 검사한다.
`--check-tags`는 전체 이력이 필요해 CI의 checkout은 `fetch-depth: 0`이다. 태그를 빠뜨리고 올렸다면
`git tag -a vX.Y.Z <릴리스 커밋> -m vX.Y.Z && git push origin vX.Y.Z`로 단다.

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

푸시 전에 CI와 같은 검사(버전·태그 검사 → validate → test → e2e 하네스 단위 테스트 → e2e probe)를 한 번에 돌리려면 저장소 루트에서:

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
