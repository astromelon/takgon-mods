"""/clear 뒤 모듈 설정·핀·할 일 복원.

`/clear`는 `$.state`를 비우고 `session.start`를 다시 보내지 않는다. 각 모듈이 첫 명령에서 store로부터 복원하는지 본다.
"""
from harness import Results, Session, StoreGuard, project_dir, project_id

USES_MODEL = False
DESCRIPTION = "/clear 뒤 모듈 on/off·핀·할 일 복원"

TASK = "복원테스트할일"
PIN = "복원테스트핀"


def run(r: Results) -> None:
    proj = project_dir("clear-restore")
    with StoreGuard(projects=[proj], global_keys=["g/core/modules"]) as store:
        store.seed(f"p/{project_id(proj)}/m4/tasks", [{"id": "seed1", "text": TASK, "kind": "checkbox", "isDone": False, "createdAt": 1}])
        with Session(proj, "--model", "haiku", log_name="clear_restore") as s:
            s.ready()
            r.check("시작 시 band에 store 할 일 표시", s.wait_for(TASK, 0, 15))

            m = s.send("/mods composer off")
            r.check("composer off 적용", s.wait_for("composer 모듈: 꺼짐", m))
            s.send("/clear")
            m = s.send("/coach")
            r.check("/clear 뒤 /coach가 composer 꺼짐으로 답함(모듈 설정 복원)", s.wait_for("composer 모듈이 꺼져 있습니다", m))
            m = s.send("/mods composer on")
            r.check("composer on 원복", s.wait_for("composer 모듈: 켜짐", m))

            m = s.send(f"/pin {PIN}")
            r.check("핀 추가", s.wait_for(f"핀을 추가했습니다: {PIN}", m))
            s.send("/clear")
            after = s.mark()
            m = s.send("/pin list")
            r.check("/clear 뒤 /pin list에 핀 복원", s.wait_for("핀 1개", m) and s.wait_for(PIN, m))
            r.check("/clear 뒤 첫 명령 후 band에 할 일 복원", s.wait_for(TASK, after, 10))
