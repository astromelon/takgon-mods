"""/browse로 로컬 dev 서버의 상태·제목·콘솔 에러·스크린샷 수집.

필요: Node.js, 플러그인 폴더의 playwright(`npm install && npx playwright install chromium`).
"""
import os

from harness import DevServer, Results, Session, StoreGuard, project_dir

USES_MODEL = False
DESCRIPTION = "/browse <url>: 상태 200·제목·콘솔 에러 2건·PNG 스크린샷"


def run(r: Results) -> None:
    proj = project_dir("browse")
    shots = proj / ".claude" / "takgon" / "browse"
    with StoreGuard(projects=[proj]), DevServer() as dev:
        with Session(proj, "--model", "haiku", log_name="browse") as s:
            s.ready()
            before = set(os.listdir(shots)) if shots.is_dir() else set()
            m = s.send(f"/browse {dev.url}")
            done = s.wait_re(r"상태(\d+),콘솔에러(\d+)건", m, 90)
            r.check("/browse 결과 줄(상태·에러 수)", done is not None, done.group(0) if done else "")
            if done:
                r.check("HTTP 상태 200", done.group(1) == "200")
                r.check("콘솔 에러 2건 이상", int(done.group(2)) >= 2, done.group(2))

            screen = s.screen(m)
            r.check("pane에 페이지 제목", "제목:TakgonDevPage" in screen)
            r.check("pane에 console.error 내용", "dev-console-error-1" in screen)
            r.check("pane에 잡히지 않은 예외", "dev-uncaught-boom" in screen)

            pngs = sorted(f for f in (set(os.listdir(shots)) if shots.is_dir() else set()) - before if f.endswith(".png"))
            r.check("스크린샷 PNG 생성", bool(pngs), pngs)
            if pngs:
                data = (shots / pngs[0]).read_bytes()
                r.check("PNG 형식·크기", data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) > 1000, len(data))
            r.check(".gitignore 생성", (proj / ".claude" / "takgon" / ".gitignore").exists())
