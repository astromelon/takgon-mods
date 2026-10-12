"""엔진 제약 2번 재현: `/clear` 뒤 `$.state`가 비고 세션 id가 바뀐다(등록한 명령은 남는다).

`probes/state-probe`를 `claude -p --plugin-dir`에 stream-json으로 `/probe set A` → `/clear` → `/probe`를 보낸다.
이 동작이 엔진에서 바뀌면(state 유지 등) 이 시나리오가 실패해 알려 준다.
"""
import json
import re
import subprocess

from harness import PROBES, Results, StoreGuard, find_claude, project_dir

USES_MODEL = False
DESCRIPTION = "엔진 제약 2번(/clear 뒤 state 초기화·session.start 없음)이 여전히 재현되는지"


def run(r: Results) -> None:
    messages = ["/probe set A", "/clear", "/probe"]
    stdin = "\n".join(json.dumps({"type": "user", "message": {"role": "user", "content": m}}, ensure_ascii=False) for m in messages)
    argv = [
        find_claude(),
        "-p",
        "--plugin-dir",
        str(PROBES / "state-probe"),
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
    ]
    # 설치된 takgon-mods도 함께 로드돼 이 폴더의 명령 등록 결과를 store에 남기므로 끝나면 지운다.
    with StoreGuard(projects=[project_dir("probe-state")]):
        done = subprocess.run(
            argv, cwd=project_dir("probe-state"), input=stdin, capture_output=True, text=True, encoding="utf-8", timeout=240
        )
    lines = re.findall(r"PROBE v=(\S*) ends=(\S*) sid=(\w+)", done.stdout)
    unique = list(dict.fromkeys(lines))
    r.check("/clear 뒤에도 /probe가 응답(명령 등록 유지)", len(unique) >= 2, unique)
    if len(unique) >= 2:
        first, second = unique[0], unique[-1]
        r.check("/clear 전 state 값 A", first[0] == "A")
        r.check("/clear 뒤 state 초기화(unset)", second[0] == "unset")
        r.check("/clear 뒤 세션 id 변경", first[2] != second[2])
