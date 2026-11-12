"""デモ表示（?demo=1）の画面を PNG に出力する。使い方: python3 tools/screenshot.py"""
import pathlib
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
PORT = 8765
SCREENS = {"home": "", "timer": "#timer", "settings": "#settings"}
SIZES = [(1280, 800), (800, 1280)]


def main() -> int:
    OUT.mkdir(exist_ok=True)
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    problems = []
    try:
        time.sleep(1)
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome")
            for width, height in SIZES:
                for name, fragment in SCREENS.items():
                    page = browser.new_page(viewport={"width": width, "height": height})
                    page.on("console", lambda m, n=name: problems.append(f"{n}: {m.text}") if m.type == "error" else None)
                    page.on("pageerror", lambda e, n=name: problems.append(f"{n}: {e}"))
                    page.goto(f"http://127.0.0.1:{PORT}/?demo=1{fragment}")
                    page.wait_for_timeout(1200)
                    overflow = page.evaluate(
                        "() => document.documentElement.scrollWidth > window.innerWidth + 1"
                    )
                    if overflow:
                        problems.append(f"{name} {width}x{height}: 横にはみ出しています")
                    path = OUT / f"{name}-{width}x{height}.png"
                    page.screenshot(path=str(path))
                    print(path.relative_to(ROOT))
                    page.close()
            browser.close()
    finally:
        server.terminate()
    for line in problems:
        print("ERROR", line)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
