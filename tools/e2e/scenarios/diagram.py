"""M8 응답 분할 다이어그램 표시.

앞 문단 → mermaid 블록 → 뒤 문단 답변에서, 턴이 끝난 뒤 블록 자리만 다이어그램(이 터미널은 대체 문구)과 버튼으로 바뀌는지 본다.
필요: `mmdc`(`npm i -g @mermaid-js/mermaid-cli`).
"""
import os
import time

from harness import Results, Session, StoreGuard, project_dir

USES_MODEL = True
DESCRIPTION = "mmdc svg·png 생성, 앞뒤 문단 유지, 다이어그램 자리·버튼, 엔진 거부 없음"


def run(r: Results) -> None:
    proj = project_dir("diagram")
    out = proj / ".claude" / "takgon" / "diagram"

    def files() -> set[str]:
        return set(os.listdir(out)) if out.is_dir() else set()

    with StoreGuard(projects=[proj]):
        with Session(proj, "--model", "haiku", log_name="diagram") as s:
            s.ready()
            before = files()
            m = s.turn(
                "다른 말 없이 아래 세 부분만 순서대로 출력해. 첫 줄은 '시작 문단입니다.' 그다음 mermaid 코드블록 "
                "(내용: graph TD 다음 줄에 A[시작] --> B[끝]), 마지막 줄은 '끝 문단입니다.'",
                180,
            )
            end = time.time() + 90
            while time.time() < end and not any(f.endswith(".png") for f in files() - before):
                time.sleep(2)
            new = sorted(files() - before)
            r.check("mmdc가 svg·png 생성", any(f.endswith(".svg") for f in new) and any(f.endswith(".png") for f in new), new)
            time.sleep(5)
            screen = s.screen(m)
            r.check("앞 문단 표시", "시작문단입니다" in screen)
            r.check("뒤 문단 표시", "끝문단입니다" in screen)
            r.check("다이어그램 자리(대체 문구)", "mermaid다이어그램—이터미널은이미지를그리지못합니다" in screen)
            r.check("원본 보기·경로 복사 버튼", "원본보기" in screen and "경로복사" in screen)

        bad = [line for line in s.debug_lines("AssistantMessage") if any(k in line for k in ("refused", "threw while drawn", "does not validate"))]
        r.check("엔진이 AssistantMessage 트리를 거부·실패하지 않음", not bad, bad[:2])
