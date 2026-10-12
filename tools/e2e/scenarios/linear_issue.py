"""M5 `/issue`의 Linear 검색·연결·해제가 실제 Linear API로 동작하는지.

필요: `LINEAR_API_KEY`(셸 환경 또는 Windows 사용자 환경변수). 워크스페이스의 실제 이슈를 읽기만 한다.
연결은 플러그인 store(테스트 프로젝트 키)에만 기록되고 끝나면 지운다. 이슈 상태를 바꾸는 `/issue status`는 실행하지 않는다.

검색어와 연결할 이슈는 `TAKGON_E2E_LINEAR_QUERY`(기본 "Linear")·`TAKGON_E2E_LINEAR_ISSUE`(기본: 검색 결과 첫 이슈)로 바꿀 수 있다.
"""
import json
import os
import re

from harness import Results, Session, StoreGuard, find_store, project_dir, project_id, user_env

USES_MODEL = False
DESCRIPTION = "/issue 검색 → link → 목록 → 중복 link → unlink (LINEAR_API_KEY 필요)"


def run(r: Results) -> None:
    env = user_env("LINEAR_API_KEY")
    if "LINEAR_API_KEY" not in env:
        r.check("LINEAR_API_KEY 설정", False, "셸 환경과 Windows 사용자 환경변수에 없음")
        return
    query = os.environ.get("TAKGON_E2E_LINEAR_QUERY", "Linear")
    proj = project_dir("linear-issue")
    with StoreGuard(projects=[proj]):
        with Session(proj, "--model", "haiku", log_name="linear_issue", env=env) as s:
            s.ready()
            # 터미널은 이미 같은 글자가 있던 칸을 다시 보내지 않아 제목 줄 등이 출력 기록에서 빠질 수 있다.
            # 그래서 화면 판정은 새로 나타나는 결과 행으로, 연결 여부는 store에 저장된 값으로 확인한다.
            m = s.send(f"/issue {query}")
            s.wait_re(r"-[A-Z][A-Z0-9]*-\d+\[", m, 30)
            rows = re.findall(r"-([A-Z][A-Z0-9]*-\d+)\[([^\]]+)\]", s.screen(m))
            r.check(f"/issue {query} 검색 결과 행(식별자·상태)", bool(rows), rows[:4])
            if not rows:
                return

            ident = os.environ.get("TAKGON_E2E_LINEAR_ISSUE", rows[0][0])
            m = s.send(f"/issue link {ident.lower()}")
            r.check(f"/issue link {ident}(소문자 입력)", s.wait_for(f"{ident}를 이 프로젝트에 연결했습니다", m, 30))
            m = s.send(f"/issue link {ident}")
            r.check("같은 이슈 다시 link는 중복 안내", s.wait_for(f"{ident}는 이미 연결돼 있습니다", m, 30))
            store = json.load(open(find_store(), encoding="utf-8"))
            linked = store.get(f"p/{project_id(proj)}/m5/linkedIssues") or []
            r.check("store에 연결 이슈 저장(p/{pid}/m5/linkedIssues)", [i.get("identifier") for i in linked] == [ident], [i.get("identifier") for i in linked])
            m = s.send("/issue")
            r.check("/issue 목록에 연결된 이슈", s.wait_for(ident, m, 30))

            m = s.send(f"/issue unlink {ident}")
            r.check(f"/issue unlink {ident}", s.wait_for(f"{ident} 연결을 해제했습니다", m, 30))
            m = s.send("/issue")
            r.check("해제 후 목록 비어 있음", s.wait_for("이 프로젝트에 연결된 이슈가 없습니다", m, 30))

        sent = s.debug_lines("api.linear.app")
        r.check("debug 로그에 키 값이 남지 않음", not any(env["LINEAR_API_KEY"] in line for line in open(s.debug_path, encoding="utf-8", errors="replace")), f"linear 요청 줄 {len(sent)}개")
