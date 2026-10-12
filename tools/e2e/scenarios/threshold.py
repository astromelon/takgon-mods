"""/panel threshold 변경이 사용 한도 경고 toast에 반영되는지.

실제 사용 한도(5시간·7일) 값을 쓴다. 시작 시 80% 이상인 한도가 없으면 판정할 수 없어 첫 항목이 실패로 남는다.
경고는 세션당 1회라 단계마다 /clear로 기록을 비우고 짧은 턴으로 측정을 일으킨다.
"""
import re

from harness import Results, Session, StoreGuard, project_dir

USES_MODEL = True
DESCRIPTION = "임계치 80%→경고, 현재 값보다 높게→경고 없음, 다시 80%→경고"

RATE_TOAST = re.compile(r"사용한도(\w+)가(\d+(?:\.\d+)?)%에도달했습니다")


def run(r: Results) -> None:
    proj = project_dir("threshold")
    with StoreGuard(projects=[proj], global_keys=["g/m6/threshold"]):
        with Session(proj, "--model", "haiku", log_name="threshold") as s:
            s.ready()
            start = [(k, float(p)) for k, p in RATE_TOAST.findall(s.screen(0))]
            r.check("기본 80%에서 80% 이상 한도 경고", any(p >= 80 for _, p in start), start)
            high = max((p for _, p in start), default=0.0)

            above = min(99, int(high) + 5)
            m = s.send(f"/panel threshold {above}")
            r.check(f"임계치 {above}% 설정", s.wait_for(f"사용량 경고 임계치: {above}%", m))
            s.send("/clear")
            m = s.turn("1+1은? 숫자만 답해.")
            raised = RATE_TOAST.findall(s.screen(m))
            r.check(f"임계치 {above}%에서는 경고 없음", not raised, raised)

            m = s.send("/panel threshold 80")
            r.check("임계치 80% 설정", s.wait_for("사용량 경고 임계치: 80%", m))
            s.send("/clear")
            m = s.turn("2+2는? 숫자만 답해.")
            lowered = [(k, float(p)) for k, p in RATE_TOAST.findall(s.screen(m))]
            r.check("80%로 내리면 경고 다시 표시", any(p >= 80 for _, p in lowered), lowered)
