"""엔진 제약 1번 재현: user 범위 플러그인의 `classic.*` 훅은 내장 보안 플러그인이 건너뛰게 해 실행되지 않는다.

`probes/classic-probe`(`classic.SessionStart` 훅이 실행되면 debug 로그에 CLASSIC-PROBE 줄을 남김)를
`claude -p --plugin-dir`로 띄운다(`--plugin-dir` 플러그인은 user tier로 로드된다). 이 동작이 엔진에서 바뀌면
(훅이 실행되기 시작하면) 이 시나리오가 실패해 알려 준다. 그때는 엔진 제약 문서 1번과 takgon-mods의 우회
(`classic.*` 대신 `restored` 지연 복원, `agent.spawn` + `$.agent.list()`)를 다시 본다.
"""
import subprocess
import time

from harness import LOG_DIR, PROBES, Results, StoreGuard, find_claude, project_dir

USES_MODEL = False
DESCRIPTION = "엔진 제약 1번(user 플러그인의 classic.* 훅 bypass)이 여전히 재현되는지"


def run(r: Results) -> None:
    proj = project_dir("probe-classic")
    LOG_DIR.mkdir(exist_ok=True)
    debug = LOG_DIR / f"probe_classic-{time.strftime('%Y%m%d-%H%M%S')}.debug.log"
    argv = [
        find_claude(),
        "-p",
        "/probe-classic",
        "--plugin-dir",
        str(PROBES / "classic-probe"),
        "--debug-file",
        str(debug),
    ]
    # 설치된 takgon-mods도 함께 로드돼 이 폴더의 명령 등록 결과를 store에 남기므로 끝나면 지운다.
    with StoreGuard(projects=[proj]):
        done = subprocess.run(argv, cwd=proj, stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8", timeout=180)
    out = done.stdout + done.stderr
    log = debug.read_text(encoding="utf-8", errors="replace") if debug.exists() else ""

    r.check("probe 플러그인 로드(/probe-classic 응답)", "PROBE-CLASSIC OK" in out, out.strip()[:80])
    r.check("probe가 user tier로 로드", "classic-probe" in log and "tier user" in log)
    bypassed = [line.strip()[25:200] for line in log.splitlines() if "classic-probe: classic.SessionStart bypassed by" in line]
    r.check("classic.SessionStart가 bypass됨(엔진 제약 1번)", bool(bypassed), bypassed[:1])
    r.check("classic.SessionStart 훅 본문은 실행되지 않음", "CLASSIC-PROBE SessionStart ran" not in log)
