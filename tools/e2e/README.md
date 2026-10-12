# tools/e2e — 대화형 세션 확인

`claude plugin test`는 엔진을 흉내 낸 테스트 킷에서 돈다. 이 폴더는 **실제 `claude` 대화형 세션**을 의사 터미널로 띄워
키를 입력하고 화면·debug 로그를 읽어, 테스트 킷과 실제 엔진의 차이(엔진 제약 문서 `docs/engine-constraints.md` 참고)를 확인한다.
Windows 전용이다(pywinpty).

## 준비

```bash
cd tools/e2e
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
```

- takgon-mods가 설치돼 있어야 한다(store 파일 `~/.claude/plugins/store/takgon-mods_*.json`을 쓴다).
- `browse`·`url_detect`: Node.js와 플러그인 폴더의 playwright(`npm install && npx playwright install chromium`).
- `diagram`: `mmdc`(`npm i -g @mermaid-js/mermaid-cli`).

## 실행

```bash
.venv/Scripts/python run.py --list             # 시나리오 목록([모델] 표시는 모델 호출)
.venv/Scripts/python run.py                    # 모델을 호출하지 않는 시나리오만
.venv/Scripts/python run.py browse diagram     # 이름으로 고르면 모델 시나리오도 실행
.venv/Scripts/python run.py --with-model       # 전부
```

결과는 시나리오별 PASS/FAIL과 항목별 판정으로 출력되고, 화면 기록과 debug 로그는 `logs/`(git 제외)에 남는다.

| 시나리오 | 모델 | 확인 내용 |
|---|---|---|
| `clear_restore` | – | `/clear` 뒤 모듈 on/off·핀·할 일 복원 |
| `mods_status` | – | 프로젝트 스킬 `browse`와 이름 충돌 → 거부 toast 1회, `/mods`에 ✓/✗ |
| `browse` | – | `/browse <url>` 상태·제목·콘솔 에러·스크린샷 |
| `linear_issue` | – | `/issue` 검색·연결·중복 연결·해제(실제 Linear API, `LINEAR_API_KEY` 필요, 이슈 상태는 바꾸지 않음) |
| `probe_classic` | – | 엔진 제약 1번 재현(`probes/classic-probe`): user 플러그인의 `classic.*` 훅 bypass |
| `probe_catch` | – | 엔진 제약 3번 재현(`probes/catch-probe*`) |
| `probe_clear_state` | – | 엔진 제약 2번 재현(`probes/state-probe`) |
| `url_detect` | haiku | Bash 출력 URL 자동 감지 |
| `threshold` | haiku | `/panel threshold` 변경이 사용 한도 경고에 반영(실제 한도가 80% 이상일 때만 판정 가능) |
| `handoff` | haiku | 임계치 도달 시 인수인계 파일 자동 생성 |
| `agents` | haiku | M6 Agents 탭 완료·실패 표시 |
| `diagram` | haiku | M8 응답 분할 다이어그램 표시 |

`probe_*`는 엔진 동작이 바뀌었는지 알려 주는 감시용이다. 실패하면 엔진이 고쳐졌을 수 있으니 엔진 제약 문서와 우회 코드를 다시 본다.

## 주의

- **사용량**: 모델 시나리오는 haiku로 짧은 턴을 1~3번 돈다. 기본 실행에서는 건너뛴다.
- **권한**: `url_detect`·`agents`는 Bash·TaskStop을 확인 창 없이 쓰려고 `--dangerously-skip-permissions`로 띄운다.
  테스트 프로젝트 폴더(아래) 안에서만 돌고, 프롬프트는 시나리오에 고정돼 있다.
- **테스트 프로젝트 폴더**: `%TEMP%\takgon-e2e\<시나리오>`(환경변수 `TAKGON_E2E_WORK`로 변경). 처음 실행할 때 폴더 신뢰 창을 자동으로 수락한다.
- **store**: 시나리오가 바꾸는 전역 키(`g/core/modules`, `g/m6/threshold`, `g/m7/threshold`)는 끝나면 원래 값으로 되돌리고,
  테스트 프로젝트 키(`p/{pid}/…`)는 지운다. 시나리오가 도는 동안 다른 Claude Code 세션에서 takgon-mods 설정을 바꾸지 않는다.
- 판정은 화면 문자열(공백 무시)과 debug 로그 기준이다. Claude Code UI 문구가 바뀌면 판정 문자열을 함께 고친다.
- 터미널은 화면을 다시 그릴 때 이미 같은 글자가 있던 칸을 보내지 않아, 출력 기록에서 일부 줄이 빠질 수 있다.
  판정에는 새로 나타나는 고유한 문자열이나 store 상태를 쓴다.
- 사용자 환경변수(예: `LINEAR_API_KEY`)를 설정한 뒤 셸을 새로 열지 않았으면 `harness.user_env()`가 레지스트리에서 읽어 하위 세션에 넘긴다(값은 출력하지 않는다).
