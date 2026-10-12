"""takgon-mods 대화형(E2E) 확인 실행기.

    python run.py --list                 # 시나리오 목록
    python run.py                        # 모델을 호출하지 않는 시나리오만(기본)
    python run.py browse mods_status     # 고른 시나리오만
    python run.py --with-model           # 모델(haiku)을 호출하는 시나리오까지 전부

모델 시나리오는 사용량을 쓴다. 실행 결과(화면·debug 로그)는 `logs/`에 남는다.
"""
from __future__ import annotations

import argparse
import importlib
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8")

from harness import Results  # noqa: E402

SCENARIOS = [
    "clear_restore",
    "mods_status",
    "browse",
    "linear_issue",
    "probe_classic",
    "probe_catch",
    "probe_clear_state",
    "url_detect",
    "threshold",
    "handoff",
    "agents",
    "diagram",
]


def load(name: str):
    return importlib.import_module(f"scenarios.{name}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("names", nargs="*", help="실행할 시나리오(생략 시 전체)")
    parser.add_argument("--with-model", action="store_true", help="모델을 호출하는 시나리오도 실행")
    parser.add_argument("--list", action="store_true", help="시나리오 목록만 출력")
    args = parser.parse_args()

    unknown = [n for n in args.names if n not in SCENARIOS]
    if unknown:
        parser.error(f"알 수 없는 시나리오: {', '.join(unknown)}")

    if args.list:
        for name in SCENARIOS:
            mod = load(name)
            print(f"{name:18} {'[모델]' if mod.USES_MODEL else '      '} {mod.DESCRIPTION}")
        return 0

    selected = args.names or SCENARIOS
    summary: list[tuple[str, str]] = []
    for name in selected:
        mod = load(name)
        if mod.USES_MODEL and not args.with_model and not args.names:
            summary.append((name, "SKIP(모델)"))
            continue
        print(f"\n== {name}: {mod.DESCRIPTION}", flush=True)
        results = Results(name)
        try:
            mod.run(results)
        except BaseException as error:  # SystemExit 포함: 시나리오 하나의 실패가 나머지를 막지 않게 한다.
            results.check("시나리오 실행", False, f"{type(error).__name__}: {error}")
            traceback.print_exc()
        summary.append((name, "PASS" if results.ok else "FAIL"))

    print("\n== 요약")
    for name, status in summary:
        print(f"  {status:10} {name}")
    return 0 if all(status != "FAIL" for _, status in summary) else 1


if __name__ == "__main__":
    sys.exit(main())
