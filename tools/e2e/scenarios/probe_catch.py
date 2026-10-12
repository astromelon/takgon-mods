"""엔진 제약 3번 재현: 훅 실패 뒤 `.catch`의 `next(e)`는 다음 플러그인부터 재개하고 같은 플러그인의 뒤쪽 훅을 건너뛴다.

`probes/catch-probe`(바깥 훅이 args=boom이면 예외, 안쪽 훅이 /probe2 응답)와 `probes/catch-probe-b`(다른 플러그인)를
`claude -p --plugin-dir`로 띄운다. 이 동작이 엔진에서 바뀌면 이 시나리오가 실패해 알려 준다.
"""
import subprocess
import time

from harness import LOG_DIR, PROBES, Results, StoreGuard, find_claude, project_dir

USES_MODEL = False
DESCRIPTION = "엔진 제약 3번(.catch 뒤 같은 플러그인 훅 건너뜀)이 여전히 재현되는지"


def _run(args: str, log_name: str) -> tuple[str, str]:
    LOG_DIR.mkdir(exist_ok=True)
    debug = LOG_DIR / f"{log_name}-{time.strftime('%Y%m%d-%H%M%S')}.debug.log"
    argv = [
        find_claude(),
        "-p",
        f"/probe2{args}",
        "--plugin-dir",
        str(PROBES / "catch-probe"),
        "--plugin-dir",
        str(PROBES / "catch-probe-b"),
        "--debug-file",
        str(debug),
    ]
    done = subprocess.run(argv, cwd=project_dir("probe-catch"), stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8", timeout=180)
    log = debug.read_text(encoding="utf-8", errors="replace") if debug.exists() else ""
    return done.stdout + done.stderr, log


def run(r: Results) -> None:
    # 설치된 takgon-mods도 함께 로드돼 이 폴더의 명령 등록 결과를 store에 남기므로 끝나면 지운다.
    with StoreGuard(projects=[project_dir("probe-catch")]):
        _checks(r)


def _checks(r: Results) -> None:
    out, log = _run("", "probe_catch-control")
    r.check("대조군: 안쪽 훅이 /probe2에 응답", "PROBE2 OK" in out)
    r.check("대조군: INNER 실행", "INNER ran" in log)

    out, log = _run(" boom", "probe_catch-boom")
    r.check("예외: 바깥 훅·.catch 실행", "OUTER ran args=boom" in log and "CATCH ran called=false" in log)
    r.check("예외: 다른 플러그인 훅은 실행", "B ran args=boom" in log)
    r.check("예외: 같은 플러그인 안쪽 훅은 건너뜀(엔진 제약 3번)", "INNER ran" not in log)
    r.check("예외: /probe2에 응답한 훅 없음", "no command.run hook answered it" in out, out.strip()[:120])
