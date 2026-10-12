"""M7 자동 인수인계가 임계치 도달 시 파일을 만드는지.

75%까지 채우려면 토큰이 많이 들어 임계치를 1%로 낮춰 같은 경로(턴 완료 → 사용률 판정 → fork → 저장 → toast)를 돌린다.
"""
import os
import re
import time

from harness import Results, Session, StoreGuard, project_dir

USES_MODEL = True
DESCRIPTION = "/tk-handoff threshold 1 → 턴 뒤 인수인계 .md 생성·toast·/tk-handoff show"


def run(r: Results) -> None:
    proj = project_dir("handoff")
    out = proj / ".claude" / "takgon" / "handoff"

    def files() -> list[str]:
        return sorted(f for f in os.listdir(out) if f.endswith(".md")) if out.is_dir() else []

    with StoreGuard(projects=[proj], global_keys=["g/m7/threshold"]):
        with Session(proj, "--model", "haiku", log_name="handoff") as s:
            s.ready()
            before = files()
            m = s.send("/tk-handoff threshold 1")
            r.check("임계치 1% 설정", s.wait_for("컨텍스트 1%", m))

            m = s.turn("1+1은? 숫자만 답해.")
            end = time.time() + 150
            while time.time() < end and len(files()) == len(before):
                time.sleep(2)
            created = [f for f in files() if f not in before]
            r.check("handoff 폴더에 새 .md", len(created) == 1, created)
            r.check("저장 toast", s.wait_for("인수인계 문서를 저장했습니다", m, 20))
            if created:
                text = (out / created[0]).read_text(encoding="utf-8")
                r.check("파일 내용(6개 섹션 중 목표·다음 단계)", "## 목표" in text and "## 다음 단계" in text, f"{len(text)}자")
                r.check("파일명 yyyyMMdd-HHmm.md", re.fullmatch(r"\d{8}-\d{4}(-\d+)?\.md", created[0]) is not None)
                m = s.send("/tk-handoff show")
                r.check("/tk-handoff show가 새 파일을 가리킴", s.wait_for(created[0], m))
