"""M6 Agents 탭의 완료·실패 표시.

정상 종료하는 서브에이전트 1개, 백그라운드로 띄웠다가 TaskStop으로 중지(killed → 실패)하는 서브에이전트 1개를 돌린다.
확인 창 없이 Bash·TaskStop을 쓰려고 이 테스트 폴더에서만 권한 확인을 끈다.
"""
import time

from harness import Results, Session, StoreGuard, project_dir

USES_MODEL = True
DESCRIPTION = "/panel agents에 general-purpose · 완료 / · 실패 행"


def run(r: Results) -> None:
    proj = project_dir("agents")
    with StoreGuard(projects=[proj]):
        with Session(proj, "--model", "haiku", "--dangerously-skip-permissions", log_name="agents") as s:
            s.ready(20)
            s.turn("Agent 도구로 general-purpose 서브에이전트를 하나 실행해서 '1+1은?'에 숫자만 답하게 하고, 그 숫자만 출력해.", 180)
            s.turn(
                "Agent 도구로 general-purpose 서브에이전트를 run_in_background를 true로 해서 실행하고, 그 에이전트에게 Bash로 "
                "`sleep 120`을 실행하게 해. 에이전트가 시작되면 기다리지 말고 곧바로 TaskStop 도구로 그 에이전트를 중지한 뒤 "
                "'중지함'이라고만 답해.",
                180,
            )
            time.sleep(5)
            m = s.send("/panel agents")
            time.sleep(6)
            screen = s.screen(m)
            r.check("Agents 탭에 '완료' 행", "general-purpose·완료" in screen)
            r.check("Agents 탭에 '실패' 행", "general-purpose·실패" in screen)
            s.send("/panel close")
