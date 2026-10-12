"""tools/e2e 하네스의 pyte 가상 터미널 재구성 및 비표준 CSI 필터 단위 테스트."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

# tools/e2e 디렉터리를 sys.path에 추가하여 harness 모듈 import 지원
E2E_DIR = Path(__file__).resolve().parent
if str(E2E_DIR) not in sys.path:
    sys.path.insert(0, str(E2E_DIR))

import pyte
from harness import PRIVATE_CSI, Results, VirtualTerminal, project_id, squash


class TestHarnessBasics(unittest.TestCase):
    """harness의 기본 유틸리티 함수 및 클래스 테스트."""

    def test_project_id(self) -> None:
        self.assertEqual(len(project_id("C:/test/path")), 8)
        self.assertEqual(project_id("C:\\test\\path"), project_id("c:/test/path/"))

    def test_squash(self) -> None:
        self.assertEqual(squash("hello   world \n \t foo"), "helloworldfoo")

    def test_results_check(self) -> None:
        r = Results("dummy")
        r.check("pass cond", True)
        r.check("fail cond", False, "detail")
        self.assertFalse(r.ok)
        self.assertEqual(r.passed, 1)
        self.assertEqual(len(r.items), 2)


class TestPrivateCsiFilter(unittest.TestCase):
    """비표준 CSI(kitty 키보드 프로토콜 등) 필터 정규식 테스트."""

    def test_non_standard_csi_matching(self) -> None:
        """kitty 프로토콜 등 비표준 CSI 시퀀스가 올바르게 매칭되는지 검증."""
        non_standard_sequences = [
            "\x1b[<1u",          # kitty 키보드 프로토콜 단일 키
            "\x1b[<57;1;120u",   # kitty 복합 파라미터 (키 코드, 수정자 등)
            "\x1b[>4m",          # kitty 키보드 프로토콜 플래그 설정
            "\x1b[>0q",          # kitty/xterm 쿼리 응답
            "\x1b[=1c",          # 사설 모드 / 디바이스 속성 응답
        ]
        for seq in non_standard_sequences:
            with self.subTest(seq=seq):
                self.assertIsNotNone(
                    PRIVATE_CSI.fullmatch(seq),
                    f"비표준 CSI 시퀀스 {seq!r}가 매칭되지 않았습니다.",
                )

    def test_non_standard_csi_removal(self) -> None:
        """텍스트에 포함된 비표준 CSI 시퀀스가 PRIVATE_CSI에 의해 완전히 제거되는지 검증."""
        cases = [
            ("prefix\x1b[<1upostfix", "prefixpostfix"),
            ("alpha\x1b[<57;1;120ubeta", "alphabeta"),
            ("one\x1b[>4mtwo\x1b[>0qthree", "onetwothree"),
            ("test\x1b[=1c", "test"),
            ("\x1b[<1uHello \x1b[<57;1;120uWorld\x1b[>4m!\x1b[>0q\x1b[=1c", "Hello World!"),
        ]
        for raw, expected in cases:
            with self.subTest(raw=raw):
                cleaned = PRIVATE_CSI.sub("", raw)
                self.assertEqual(cleaned, expected)

    def test_standard_ansi_csi_preserved(self) -> None:
        """표준 ANSI/CSI 시퀀스는 PRIVATE_CSI에 의해 제거되지 않고 유지되는지 검증."""
        standard_sequences = [
            "\x1b[31m",          # SGR 색상 (빨강)
            "\x1b[0m",           # SGR 스타일 초기화
            "\x1b[1;32m",        # SGR 굵은 초록
            "\x1b[2J",           # 화면 지우기 (ED)
            "\x1b[H",            # 커서 홈 이동 (CUP 기본값)
            "\x1b[10;20H",       # 커서 특정 좌표 이동 (10행 20열)
            "\x1b[1A",           # 커서 위로 1칸 (CUU)
            "\x1b[2B",           # 커서 아래로 2칸 (CUD)
            "\x1b[3C",           # 커서 오른쪽으로 3칸 (CUF)
            "\x1b[4D",           # 커서 왼쪽으로 4칸 (CUB)
            "\x1b[2K",           # 행 전체 지우기 (EL)
            "\x1b[?25h",         # DEC 사설 모드 커서 보이기 (DECTCEM)
            "\x1b[?25l",         # DEC 사설 모드 커서 숨기기
        ]
        for seq in standard_sequences:
            with self.subTest(seq=seq):
                self.assertIsNone(
                    PRIVATE_CSI.search(seq),
                    f"표준 시퀀스 {seq!r}가 PRIVATE_CSI에 잘못 매칭되었습니다.",
                )
                self.assertEqual(
                    PRIVATE_CSI.sub("", seq),
                    seq,
                    f"표준 시퀀스 {seq!r}가 PRIVATE_CSI에 의해 훼손되었습니다.",
                )

    def test_mixed_standard_and_non_standard(self) -> None:
        """표준 시퀀스와 비표준 시퀀스가 혼합된 경우 비표준만 선별 제거되는지 검증."""
        raw = "\x1b[2J\x1b[H\x1b[<1u\x1b[31mError\x1b[0m\x1b[>4m: something failed\x1b[=1c\x1b[1A"
        expected = "\x1b[2J\x1b[H\x1b[31mError\x1b[0m: something failed\x1b[1A"
        self.assertEqual(PRIVATE_CSI.sub("", raw), expected)


class TestPyteDirectReconstruction(unittest.TestCase):
    """pyte.Screen 및 pyte.Stream의 직접 동작 검증 (청크 유입, dirty, overwrite, 비표준 CSI 유출)."""

    def test_chunked_input_reconstruction(self) -> None:
        """청크 단위로 유입된 텍스트와 개행이 pyte 화면에 올바르게 재구성되는지 검증."""
        screen = pyte.Screen(40, 5)
        stream = pyte.Stream(screen)

        chunks = ["Hel", "lo, ", "world!\r\n", "Second ", "line."]
        for chunk in chunks:
            stream.feed(chunk)

        self.assertEqual(screen.display[0].rstrip(), "Hello, world!")
        self.assertEqual(screen.display[1].rstrip(), "Second line.")

    def test_dirty_line_detection_and_accumulation(self) -> None:
        """텍스트 유입 시 pyte의 dirty set에 변경된 행 번호가 감지되는지 검증."""
        screen = pyte.Screen(40, 5)
        screen.dirty.clear()
        stream = pyte.Stream(screen)

        # 0번 줄 기록
        stream.feed("First line\r\n")
        self.assertIn(0, screen.dirty)
        collected_lines = [screen.display[y].rstrip() for y in sorted(screen.dirty)]
        screen.dirty.clear()

        # 1번 줄 기록
        stream.feed("Second line")
        self.assertIn(1, screen.dirty)
        self.assertNotIn(0, screen.dirty)  # 0번 줄은 변경되지 않음
        collected_lines.extend(screen.display[y].rstrip() for y in sorted(screen.dirty))
        screen.dirty.clear()

        self.assertIn("First line", collected_lines)
        self.assertIn("Second line", collected_lines)

    def test_cursor_move_and_overwrite_dirty(self) -> None:
        """커서 이동 후 특정 줄을 덮어쓰기(overwrite)할 때 해당 줄만 dirty로 감지되는지 검증."""
        screen = pyte.Screen(40, 5)
        screen.dirty.clear()
        stream = pyte.Stream(screen)

        stream.feed("Line 1\r\nLine 2\r\nLine 3")
        screen.dirty.clear()

        # 커서를 1행(0-based: 0번 줄) 첫 칸으로 이동하여 덮어쓰기: \x1b[1;1H
        stream.feed("\x1b[1;1HModified 1")
        self.assertEqual(screen.dirty, {0})
        self.assertEqual(screen.display[0].rstrip(), "Modified 1")
        self.assertEqual(screen.display[1].rstrip(), "Line 2")
        self.assertEqual(screen.display[2].rstrip(), "Line 3")

    def test_unfiltered_vs_filtered_kitty_leakage(self) -> None:
        """PRIVATE_CSI 필터 없이 유입되면 문자가 화면에 새고, 필터링 시 깨끗하게 재구성되는지 검증."""
        raw = "Status: \x1b[<1uOK\x1b[>4m Done\x1b[>0q"

        # 필터링 없이 주입 -> 비표준 시퀀스의 매개변수/글자가 화면에 노출됨
        screen_raw = pyte.Screen(40, 5)
        stream_raw = pyte.Stream(screen_raw)
        stream_raw.feed(raw)
        self.assertIn("1u", screen_raw.display[0])

        # PRIVATE_CSI 필터링 후 주입 -> 깨끗하게 텍스트만 표시
        screen_clean = pyte.Screen(40, 5)
        stream_clean = pyte.Stream(screen_clean)
        stream_clean.feed(PRIVATE_CSI.sub("", raw))
        self.assertEqual(screen_clean.display[0].rstrip(), "Status: OK Done")


class TestVirtualTerminal(unittest.TestCase):
    """harness의 VirtualTerminal 헬퍼 클래스 단위 테스트."""

    def test_feed_chunked_reconstruction(self) -> None:
        """여러 청크로 나뉘어 유입될 때 가상 터미널이 화면 및 누적 lines를 올바르게 재구성하는지 검증."""
        vt = VirtualTerminal(columns=40, rows=10)
        vt.feed("Prompt: ")
        vt.feed("hello\r\n")
        vt.feed("Response: success\r\n")

        self.assertIn("Prompt: hello", vt.display())
        self.assertIn("Response: success", vt.display())

    def test_dirty_lines_collected_on_every_feed(self) -> None:
        """각 feed 호출 시마다 dirty가 발생한 줄 전체가 lines 리스트에 순서대로 누적되는지 검증."""
        vt = VirtualTerminal(columns=40, rows=10)

        new1 = vt.feed("Line A\r\n")
        self.assertEqual(new1, ["Line A"])
        self.assertEqual(vt.lines, ["Line A"])

        new2 = vt.feed("Line B\r\n")
        self.assertEqual(new2, ["Line B"])
        self.assertEqual(vt.lines, ["Line A", "Line B"])

    def test_overwrite_dirty_accumulation(self) -> None:
        """TUI 화면 덮어쓰기 시 변경된 줄이 dirty로 감지되어 갱신된 줄 전체가 lines에 추가되는지 검증."""
        vt = VirtualTerminal(columns=40, rows=5)

        vt.feed("Old title\r\nBody text\r\n")
        initial_mark = len(vt.lines)

        # 커서 1행으로 이동 후 제목 갱신
        new_lines = vt.feed("\x1b[1;1HNew title")
        self.assertIn("New title", new_lines)
        self.assertIn("New title", vt.lines[initial_mark:])

        # display()에도 최신 상태가 반영되어야 함
        display_lines = vt.display().split("\n")
        self.assertEqual(display_lines[0], "New title")
        self.assertEqual(display_lines[1], "Body text")

    def test_private_csi_clean_reconstruction(self) -> None:
        """kitty 비표준 CSI가 유입되어도 글자가 깨지거나 새지 않고 깨끗하게 재구성되는지 검증."""
        vt = VirtualTerminal(columns=60, rows=5)

        # kitty 키보드 및 확장 시퀀스가 뒤섞인 입력
        vt.feed("\x1b[<1uSystem \x1b[<57;1;120uready\x1b[>4m\r\n")
        vt.feed("\x1b[>0qAll \x1b[=1ctests passed\r\n")

        display = vt.display()
        self.assertNotIn("1u", display)
        self.assertNotIn("57;1;120u", display)
        self.assertNotIn("4m", display)
        self.assertNotIn("0q", display)
        self.assertNotIn("1c", display)

        self.assertIn("System ready", display)
        self.assertIn("All tests passed", display)

        # lines 리스트에도 비표준 시퀀스가 유출되지 않음
        for line in vt.lines:
            self.assertNotIn("1u", line)
            self.assertNotIn("4m", line)

    def test_raw_preserves_unfiltered_input(self) -> None:
        """raw 로그용 리스트에는 필터링되지 않은 원본 chunk가 그대로 보존되는지 검증."""
        vt = VirtualTerminal(columns=40, rows=5)
        raw_chunk = "foo\x1b[<1ubar"
        vt.feed(raw_chunk)

        self.assertEqual(vt.raw, [raw_chunk])
        self.assertNotIn("<1u", vt.display())

    def test_text_and_screen_helpers(self) -> None:
        """text(since) 및 screen(since) 메서드가 올바르게 동작하는지 검증."""
        vt = VirtualTerminal(columns=40, rows=5)
        vt.feed("Alpha\r\n")
        mark = len(vt.lines)
        vt.feed("Beta\r\n")

        # mark 이전
        self.assertIn("Alpha", vt.text(0))
        # mark 이후
        self.assertNotIn("Alpha", vt.text(mark))
        self.assertIn("Beta", vt.text(mark))

        # screen() 공백 제거(squash) 동작 확인
        self.assertEqual(vt.screen(mark), squash(vt.text(mark)))


if __name__ == "__main__":
    unittest.main()
