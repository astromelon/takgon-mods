"""명령 이름 충돌 시 등록 거부 toast와 /mods 등록 상태 표시.

테스트 프로젝트에 `browse` 프로젝트 스킬을 두어 takgon-mods의 `/browse` 등록이 거부되게 한다(사용자 스킬 폴더는 건드리지 않는다).
"""
from harness import Results, Session, StoreGuard, project_dir

USES_MODEL = False
DESCRIPTION = "스킬 이름 충돌 → 등록 거부 toast 1회, /mods에 ✓/✗ 표시, 다른 명령은 정상 등록"

SKILL = """---
name: browse
description: 이름 충돌 확인용 테스트 스킬(takgon-mods /browse와 겹치게 함)
---
테스트용 스킬입니다.
"""


def run(r: Results) -> None:
    proj = project_dir("mods-status")
    skill = proj / ".claude" / "skills" / "browse" / "SKILL.md"
    skill.parent.mkdir(parents=True, exist_ok=True)
    skill.write_text(SKILL, encoding="utf-8")

    with StoreGuard(projects=[proj]):
        with Session(proj, "--model", "haiku", log_name="mods_status", columns=220) as s:
            s.ready(20)
            # TUI toast 박스(너비 ~42)에서 줄바꿈되어 '(it is'와 ' the user's /browse)' 사이에
            # 터미널 왼쪽 시작 배너(cwd 등)가 끼어든다. 전체 사유(it is the user's /browse)를 엄격히 확인한다.
            toast = s.wait_re(r"/browse명령을등록하지못했습니다\(itis.*?theuser's/browse\)", 0, 10)
            r.check("등록 거부 toast(명령 이름·사유)", toast is not None, "it is the user's /browse" if toast else "")

            m = s.send("/mods")
            r.check("/mods에 /browse ✗(사유)", s.wait_re(r"/browse✗\(itistheuser's/browse\)", m) is not None)
            screen = s.screen(m)
            for name in ["/panel✓/pin✓", "/tk-handoff✓", "/edit✓", "/issue✓", "/coach✓"]:
                r.check(f"/mods에 {name}", name in screen)

        toasts = s.debug_lines("$.ui.toast (takgon-mods)", "/browse 명령을 등록하지 못했습니다")
        r.check("거부 toast 호출은 1회", len(toasts) == 1, len(toasts))
