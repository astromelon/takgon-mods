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

저장소(`astromelon/takgon-mods`)는 private이다. 설치하는 PC에서 먼저 저장소 접근 권한이 있는 계정으로
`gh auth login`과 `gh auth setup-git`을 해 두어야 Claude Code가 저장소를 받아 온다.

Claude Code 터미널 세션의 프롬프트에서:

```
/plugin install takgon-mods --marketplace astromelon/takgon-mods
```

`Add marketplace?`에 `y`, 설치 범위는 user(모든 프로젝트)를 고른다. CLI로는:

```bash
claude plugin marketplace add astromelon/takgon-mods
claude plugin install takgon-mods@takgon
```

업데이트: `claude plugin update takgon-mods@takgon` 후 열린 세션에서 `/reload-plugins`.

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

- 설계와 결정 사항: `SPEC.md`
- 실제 세션에서 확인한 엔진 제약: `docs/engine-constraints.md`
- 변경 이력: `CHANGELOG.md`
