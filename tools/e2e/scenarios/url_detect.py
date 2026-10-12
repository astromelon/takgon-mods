"""Bash 출력의 localhost URL을 M2가 자동 감지하는지.

모델이 Bash로 dev 서버 로그 줄을 출력하게 한다. 확인 창 없이 Bash를 돌리려고 이 테스트 폴더에서만 권한 확인을 끈다.
"""
from harness import DevServer, Results, Session, StoreGuard, project_dir

USES_MODEL = True
DESCRIPTION = "감지 전 /browse → URL 없음, Bash 출력 후 인자 없는 /browse가 감지된 URL 사용"


def run(r: Results) -> None:
    proj = project_dir("url-detect")
    with StoreGuard(projects=[proj]), DevServer() as dev:
        with Session(proj, "--model", "haiku", "--dangerously-skip-permissions", log_name="url_detect") as s:
            s.ready(20)
            m = s.send("/browse")
            r.check("감지 전 /browse는 URL 없음 안내", s.wait_for("확인할 URL이 없습니다", m))

            m = s.turn(f'Bash 도구로 정확히 echo "  ➜  Local:   {dev.url}" 를 한 번 실행하고, 다른 도구는 쓰지 말고 "완료"라고만 답해.')
            r.check("Bash 출력에 URL", dev.url.replace("/", "") in s.screen(m).replace("/", ""))

            m = s.send("/browse")
            done = s.wait_re(r"(http://localhost:\d+/?)→상태(\d+),콘솔에러(\d+)건", m, 90)
            r.check("인자 없는 /browse가 감지된 URL 사용", done is not None, done.group(0) if done else "")
            if done:
                r.check("감지된 URL 상태 200·콘솔 에러 수집", done.group(2) == "200" and int(done.group(3)) >= 2)
