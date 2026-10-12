"""takgon-mods 대화형(E2E) 확인 하네스.

실제 `claude` 대화형 세션을 의사 터미널(pywinpty)로 띄워 키를 입력하고 화면을 읽는다. 시나리오가 공통으로 쓰는
세션 조작, 결과 기록, 플러그인 store 백업·복원, 테스트용 dev 서버를 모았다. Windows 전용이다.
"""
from __future__ import annotations

import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import pyte
import winpty

E2E_DIR = Path(__file__).resolve().parent
PLUGIN_DIR = E2E_DIR.parent.parent
LOG_DIR = E2E_DIR / "logs"
FIXTURES = E2E_DIR / "fixtures"
PROBES = E2E_DIR / "probes"

# 시나리오별 테스트 프로젝트 폴더의 상위. 폴더 이름이 같으면 한 번 수락한 폴더 신뢰가 다음 실행에도 유지된다.
WORK_ROOT = Path(os.environ.get("TAKGON_E2E_WORK", Path(tempfile.gettempdir()) / "takgon-e2e"))

ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-Za-z]|\x1b[=>78]")

# pyte가 해석하지 못하는 비표준 CSI(kitty 키보드 프로토콜 `ESC[<u`, `ESC[>4m`, `ESC[>0q` 등). 그대로 넣으면 글자가 화면에 샌다.
PRIVATE_CSI = re.compile(r"\x1b\[[<>=][0-9;]*[ -/]*[@-~]")


def find_claude() -> str:
    """`claude` 실행 파일 경로. PATH에 없으면 기본 설치 위치를 본다."""
    found = shutil.which("claude")
    if found:
        return found
    fallback = Path.home() / ".local" / "bin" / "claude.exe"
    if fallback.exists():
        return str(fallback)
    raise SystemExit("claude 실행 파일을 찾지 못했습니다.")


def find_store(required: bool = True) -> Path | None:
    """takgon-mods 플러그인 store 파일(`~/.claude/plugins/store/takgon-mods_*.json`)."""
    matches = glob.glob(str(Path.home() / ".claude" / "plugins" / "store" / "takgon-mods_*.json"))
    if not matches:
        if required:
            raise SystemExit("takgon-mods store 파일이 없습니다. 플러그인을 설치하고 한 번 실행하세요.")
        return None
    return Path(max(matches, key=os.path.getmtime))


def user_env(*names: str) -> dict[str, str]:
    """현재 프로세스에 없으면 Windows 사용자 환경변수(레지스트리 HKCU의 Environment 키)에서 읽는다.

    사용자가 setx 등으로 설정한 변수는 그 전에 시작된 프로세스(이 하네스를 띄운 셸 포함)에는 보이지 않는다.
    값은 하위 세션에 넘기기만 하고 출력하지 않는다.
    """
    found: dict[str, str] = {}
    try:
        import winreg
    except ImportError:
        return found
    for name in names:
        if os.environ.get(name):
            found[name] = os.environ[name]
            continue
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
                value, _ = winreg.QueryValueEx(key, name)
        except OSError:
            continue
        if isinstance(value, str) and value:
            found[name] = value
    return found


def project_id(root: str | Path) -> str:
    """플러그인 `src/shared/keys.ts`의 projectId와 같은 계산(FNV-1a, 경로 표기 정규화)."""
    text = str(root).replace("\\", "/").rstrip("/").lower()
    h = 0x811C9DC5
    for ch in text:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def squash(text: str) -> str:
    """TUI는 공백을 커서 이동으로 그리므로 비교할 때는 공백을 모두 뺀다."""
    return re.sub(r"\s+", "", text)


def project_dir(name: str) -> Path:
    path = WORK_ROOT / name
    path.mkdir(parents=True, exist_ok=True)
    return path


@dataclass
class Results:
    """시나리오 확인 결과."""

    name: str
    items: list[tuple[str, bool, str]] = field(default_factory=list)

    def check(self, label: str, ok: bool, detail: object = "") -> bool:
        self.items.append((label, bool(ok), str(detail)))
        print(f"  {'PASS' if ok else 'FAIL'} {label} {detail}".rstrip(), flush=True)
        return bool(ok)

    @property
    def passed(self) -> int:
        return sum(1 for _, ok, _ in self.items if ok)

    @property
    def ok(self) -> bool:
        return bool(self.items) and all(ok for _, ok, _ in self.items)


class VirtualTerminal:
    """pyte 기반 가상 터미널 화면 재구성 및 dirty 줄 수집기.

    출력을 가상 터미널에 넣어 화면을 재구성한다. TUI는 이미 같은 글자가 있던 칸을 다시 보내지 않으므로
    원시 출력만 보면 줄이 빠진다. 바뀐 줄(dirty)은 재구성된 줄 전체를 `lines`에 누적 기록한다.
    """

    def __init__(self, columns: int = 180, rows: int = 60) -> None:
        self.columns = columns
        self.rows = rows
        self.vt = pyte.Screen(columns, rows)
        self.vt.dirty.clear()
        self.vt_stream = pyte.Stream(self.vt)
        self.lines: list[str] = []
        self.raw: list[str] = []

    def feed(self, chunk: str) -> list[str]:
        """청크의 비표준 CSI를 필터링하고 pyte에 유입시켜 변경된 줄 전체를 lines에 기록한다."""
        self.raw.append(chunk)
        self.vt_stream.feed(PRIVATE_CSI.sub("", chunk))
        display = self.vt.display
        new_lines: list[str] = []
        for y in sorted(self.vt.dirty):
            if 0 <= y < len(display):
                line = display[y].rstrip()
                self.lines.append(line)
                new_lines.append(line)
        self.vt.dirty.clear()
        return new_lines

    def display(self) -> str:
        """지금 화면에 보이는 그대로."""
        return "\n".join(row.rstrip() for row in self.vt.display)

    def text(self, since: int = 0) -> str:
        """`since` 이후 화면에 그려진(바뀐) 줄."""
        return "\n".join(self.lines[since:])

    def screen(self, since: int = 0) -> str:
        return squash(self.text(since))


class Session:
    """의사 터미널에서 도는 대화형 `claude` 세션."""

    def __init__(
        self,
        cwd: Path,
        *args: str,
        log_name: str,
        columns: int = 180,
        rows: int = 60,
        env: dict[str, str] | None = None,
    ) -> None:
        LOG_DIR.mkdir(exist_ok=True)
        self.log_path = LOG_DIR / f"{log_name}-{time.strftime('%Y%m%d-%H%M%S')}.log"
        self.debug_path = self.log_path.with_suffix(".debug.log")
        argv = [find_claude(), *args, "--debug-file", str(self.debug_path)]
        merged = {**os.environ, **(env or {})} if env else None
        self.proc = winpty.PtyProcess.spawn(argv, cwd=str(cwd), env=merged, dimensions=(rows, columns))
        self.terminal = VirtualTerminal(columns, rows)
        self.vt = self.terminal.vt
        self.vt_stream = self.terminal.vt_stream
        self.lines = self.terminal.lines
        self.raw = self.terminal.raw
        self.lock = threading.Lock()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        while self.proc.isalive():
            try:
                chunk = self.proc.read(4096)
            except EOFError:
                break
            with self.lock:
                self.terminal.feed(chunk)

    def mark(self) -> int:
        """지금까지 기록된 화면 줄 수. 이후 `text(since)`·`wait_for(..., since)`는 이 뒤에 그려진 줄만 본다."""
        with self.lock:
            return len(self.lines)

    def text(self, since: int = 0) -> str:
        """`since` 이후 화면에 그려진(바뀐) 줄. 스크롤로 다시 그려진 줄도 포함되므로 '없음' 판정은 화면을 비운 뒤에 한다."""
        with self.lock:
            return self.terminal.text(since)

    def display(self) -> str:
        """지금 화면에 보이는 그대로."""
        with self.lock:
            return self.terminal.display()

    def screen(self, since: int = 0) -> str:
        return self.terminal.screen(since)

    def wait_for(self, text: str, since: int = 0, timeout: float = 25.0) -> bool:
        needle = squash(text)
        end = time.time() + timeout
        while time.time() < end:
            if needle in self.screen(since):
                return True
            time.sleep(0.5)
        return False

    def wait_re(self, pattern: str, since: int = 0, timeout: float = 25.0) -> re.Match[str] | None:
        end = time.time() + timeout
        while time.time() < end:
            found = re.search(pattern, self.screen(since))
            if found:
                return found
            time.sleep(0.5)
        return None

    def send(self, text: str) -> int:
        """한 줄을 입력하고 Enter. 슬래시 명령이면 자동완성 메뉴를 닫고 보낸다. 입력 직전 위치를 돌려준다."""
        m = self.mark()
        self.proc.write(text)
        time.sleep(0.8)
        if text.startswith("/"):
            self.proc.write("\x1b")
            time.sleep(0.2)
        self.proc.write("\r")
        return m

    def accept_dialogs(self) -> None:
        """시작 시 확인 창(폴더 신뢰, 권한 우회 경고)에서 Yes를 고른다.

        기본 선택이 "No, exit"이므로, 커서가 Yes로 옮겨진 것을 화면에서 확인한 뒤에만 Enter를 누른다.
        """
        since = 0
        wait = 12.0  # 첫 창은 늦게 뜰 수 있다. 창이 뜨기 전에 입력하면 그 입력의 Esc가 창을 취소(=종료)시킨다.
        for _ in range(3):
            end = time.time() + wait
            while time.time() < end and "Entertoconfirm" not in self.screen(since):
                time.sleep(0.5)
            if "Entertoconfirm" not in self.screen(since):
                return
            wait = 6.0
            start = self.mark()
            moved = False
            for _ in range(3):
                self.proc.write("\x1b[B")
                end = time.time() + 4
                while time.time() < end and not re.search(r"❯(\d\.)?Yes", self.screen(start)):
                    time.sleep(0.3)
                if re.search(r"❯(\d\.)?Yes", self.screen(start)):
                    moved = True
                    break
            if not moved:
                raise SystemExit("확인 창에서 Yes를 고르지 못했습니다.")
            self.proc.write("\r")
            since = self.mark()

    def ready(self, settle: float = 15.0) -> None:
        """확인 창을 넘기고 플러그인 초기화(명령 등록)가 끝날 때까지 기다린다. 시작 중 입력은 버려진다."""
        self.accept_dialogs()
        time.sleep(settle)

    def turn(self, prompt: str, timeout: float = 150.0) -> int:
        """프롬프트를 보내고 턴이 끝날 때까지 기다린다(M1이 그리는 'N초 동안 작업' 줄 기준)."""
        m = self.send(prompt)
        if not self.wait_for("동안 작업", m, timeout):
            raise SystemExit(f"턴이 끝나지 않았습니다: {prompt[:40]}")
        return m

    def close(self) -> None:
        try:
            self.send("/exit")
            time.sleep(3)
        except EOFError:
            pass
        if self.proc.isalive():
            self.proc.terminate(force=True)
        self.log_path.write_text(self.text(), encoding="utf-8")
        with self.lock:
            raw = ANSI.sub("", "".join(self.raw))
        self.log_path.with_suffix(".raw.log").write_text(raw, encoding="utf-8")

    def debug_lines(self, *needles: str) -> list[str]:
        """debug 로그에서 모든 needle을 포함한 줄."""
        if not self.debug_path.exists():
            return []
        with open(self.debug_path, encoding="utf-8", errors="replace") as f:
            return [line.rstrip() for line in f if all(n in line for n in needles)]

    def __enter__(self) -> "Session":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


class StoreGuard:
    """시나리오가 플러그인 store에 남기는 변경을 되돌린다.

    `global_keys`는 시작 값을 기억했다가 그대로 복원하고(없던 키는 삭제), `projects`의 프로젝트 키(`p/{pid}/…`)는 지운다.
    """

    def __init__(self, projects: Iterable[Path] = (), global_keys: Iterable[str] = ()) -> None:
        self.path = find_store(required=False)
        self.pids = [project_id(p) for p in projects]
        self.keys = list(global_keys)
        self.saved: dict[str, object] = {}

    def _load(self) -> dict[str, object]:
        if not self.path or not self.path.exists():
            return {}
        with open(self.path, encoding="utf-8") as f:
            return json.load(f)

    def _save(self, data: dict[str, object]) -> None:
        if not self.path:
            return
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)

    def seed(self, key: str, value: object) -> None:
        if not self.path:
            return
        data = self._load()
        data[key] = value
        self._save(data)

    def __enter__(self) -> "StoreGuard":
        if self.path and self.path.exists():
            data = self._load()
            self.saved = {k: data[k] for k in self.keys if k in data}
        return self

    def __exit__(self, *exc: object) -> None:
        if not self.path or not self.path.exists():
            return
        data = self._load()
        for key in self.keys:
            if key in self.saved:
                data[key] = self.saved[key]
            else:
                data.pop(key, None)
        for key in [k for k in data if any(k.startswith(f"p/{pid}/") for pid in self.pids)]:
            del data[key]
        self._save(data)


class DevServer:
    """`fixtures/devsite`를 localhost로 띄운다. 페이지는 console.error 1건과 잡히지 않은 예외 1건을 낸다."""

    def __init__(self, port: int = 8765) -> None:
        self.port = port
        self.url = f"http://localhost:{port}/"
        self.proc: subprocess.Popen[bytes] | None = None

    def __enter__(self) -> "DevServer":
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "http.server", str(self.port), "--bind", "127.0.0.1", "--directory", str(FIXTURES / "devsite")],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        end = time.time() + 10
        while time.time() < end:
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{self.port}/", timeout=1)
                return self
            except OSError:
                time.sleep(0.3)
        raise SystemExit("dev 서버가 응답하지 않습니다.")

    def __exit__(self, *exc: object) -> None:
        if self.proc is not None:
            self.proc.terminate()
            self.proc.wait(timeout=10)
