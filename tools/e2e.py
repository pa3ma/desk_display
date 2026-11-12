"""ブラウザでの通し確認。使い方: python3 tools/e2e.py
通信は差し替える（天気はテスト用データ、失敗の再現は遮断）。"""
import pathlib
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8766
URL = f"http://127.0.0.1:{PORT}/"
FIXTURE = (ROOT / "tests/fixtures/open-meteo.json").read_text(encoding="utf-8")
failures = []


def check(name, cond, detail=""):
    print(("ok   " if cond else "FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


def run(page):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.text.startswith("[desk]") else None)
    weather_ok = {"value": True}

    def weather(route):
        if weather_ok["value"]:
            route.fulfill(status=200, content_type="application/json", body=FIXTURE)
        else:
            route.abort()

    page.route("https://api.open-meteo.com/**", weather)
    page.clock.install(time="2026-11-12T10:00:00+09:00")
    page.goto(URL)
    page.wait_for_timeout(300)

    check("初回: 場所の入力を促す", "設定で場所を入力してください" in page.inner_text("#w-message"))
    check("初回: カレンダー接続を促す", "設定でカレンダーを接続してください" in page.inner_text("#c-message"))
    check("初回: 通知音の案内が出ている", page.is_visible("#sound-hint"))
    check("時計は日本時間", page.inner_text("#home-clock") == "10:00", page.inner_text("#home-clock"))

    page.click("#home-clock")
    check("タップ後: 通知音の案内が消える", not page.is_visible("#sound-hint"))

    page.click("#home .corner-link")
    page.fill("[name=latitude]", "95")
    page.fill("[name=longitude]", "139.76")
    page.click("#settings-form button[type=submit]")
    check("設定: 範囲外の緯度でエラー表示", "緯度" in page.inner_text("[data-error=latitude]"))
    check("設定: エラー時は入力が残る", page.input_value("[name=latitude]") == "95")
    check("設定: エラー時は画面が変わらない", page.evaluate("document.body.dataset.screen") == "settings")

    page.fill("[name=latitude]", "35.68")
    page.fill("[name=workMin]", "1")
    page.click("#settings-form button[type=submit]")
    page.wait_for_timeout(300)
    check("設定: 保存後はホームへ戻る", page.evaluate("document.body.dataset.screen") == "home")
    check("天気: 取得して表示", page.inner_text("#w-temp") == "14°", page.inner_text("#w-temp"))
    check("天気: これから先の6時間", page.locator("#w-hours li").count() == 6)
    check("天気: 最初は11時", page.inner_text("#w-hours li:first-child .h-time") == "11時")

    weather_ok["value"] = False
    page.clock.fast_forward("31:00")
    page.wait_for_timeout(300)
    check("天気: 取得失敗でも前回値を表示", page.inner_text("#w-temp") == "14°")
    check("天気: 更新できない旨を表示", "更新できません" in page.inner_text("#w-status"), page.inner_text("#w-status"))
    weather_ok["value"] = True

    check("減光: 31分放置で暗くなっている", page.evaluate("document.body.classList.contains('dim')"))
    page.mouse.click(300, 200)  # 最初のタッチは明るさを戻すだけ
    page.click("#home-timer")
    page.wait_for_function("document.body.dataset.screen === 'timer'")
    check("タイマー: 待機中は1分", page.inner_text("#t-remaining") == "01:00", page.inner_text("#t-remaining"))
    page.click("#t-toggle")
    check("タイマー: 開始で作業の色", page.evaluate("document.body.dataset.phase") == "work")
    check("タイマー: ボタンが一時停止に", page.inner_text("#t-toggle") == "一時停止")

    page.clock.fast_forward("00:20")
    page.reload()
    page.wait_for_timeout(300)
    check("再読み込み: 走行中のまま復元", page.inner_text("#t-remaining") == "00:40", page.inner_text("#t-remaining"))
    check("再読み込み: タイマー画面のまま", page.evaluate("document.body.dataset.screen") == "timer")

    page.clock.run_for(41000)
    check("作業終了: 休憩に切り替わる", page.evaluate("document.body.dataset.phase") == "short_break")
    check("作業終了: 丸が1つ埋まる", page.locator("#t-rounds li.done").count() == 1)
    check("作業終了: 休憩は5分から数える", page.inner_text("#t-remaining").startswith("04:5"), page.inner_text("#t-remaining"))

    page.click("#t-toggle")
    page.click("#t-reset")
    check("リセット: 待機に戻る", page.evaluate("document.body.dataset.phase") == "idle")
    page.clock.run_for(5 * 60000 + 1000)
    check("減光: 5分無操作で暗くなる", page.evaluate("document.body.classList.contains('dim')"))
    page.mouse.click(400, 400)
    check("減光: タッチで戻る", not page.evaluate("document.body.classList.contains('dim')"))
    check("減光解除のタッチでボタンは押されない", page.evaluate("document.body.dataset.phase") == "idle")

    check("ページのエラーなし", not errors, "; ".join(errors))


SETTINGS = (
    '{"latitude":35.68,"longitude":139.76,"relayUrl":"https://script.google.com/macros/s/x/exec?token=t",'
    '"workMin":25,"shortBreakMin":5,"longBreakMin":15,"cyclesBeforeLong":4,"notifyLeadMin":10,"dimAfterMin":5}'
)
EVENTS = (
    '[{"id":"e1","title":"設計レビュー","start":"2026-11-12T01:15:00.000Z","end":"2026-11-12T02:00:00.000Z","allDay":false},'
    '{"id":"e2","title":"部品の受け取り","start":"2026-11-12T01:15:00.000Z","end":"2026-11-12T01:30:00.000Z","allDay":false}]'
)


def seeded_page(browser, extra_storage=None, **context_args):
    """設定済みの端末を再現したページを作る（10:00 開始、通信は差し替え）"""
    context = browser.new_context(viewport={"width": 1280, "height": 800}, **context_args)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.text.startswith("[desk]") else None)
    state = {"weather": "ok", "relay": "ok"}

    def weather(route):
        if state["weather"] == "ok":
            route.fulfill(status=200, content_type="application/json", body=FIXTURE)
        else:
            route.abort()

    def relay(route):
        if state["relay"] == "ok":
            route.fulfill(status=200, content_type="application/json", body=EVENTS)
        elif state["relay"] == "html":
            route.fulfill(status=200, content_type="text/html", body="<html>ログイン</html>")
        else:
            route.abort()

    page.route("https://api.open-meteo.com/**", weather)
    page.route("https://script.google.com/**", relay)
    storage = {"desk.settings": SETTINGS, **(extra_storage or {})}
    for key, value in storage.items():
        page.add_init_script(
            f"if (!localStorage.getItem({key!r})) localStorage.setItem({key!r}, {value!r});"
        )
    page.clock.install(time="2026-11-12T10:00:00+09:00")
    return page, state, errors


def run_notifications(browser):
    """予定の通知まわり（レビュー指摘 C1・I5・フォーカス3,4）"""
    page, state, errors = seeded_page(browser)
    page.goto(URL)
    page.wait_for_timeout(300)
    check("予定: 中継から取得して表示", "設計レビュー" in page.inner_text("#c-events"), page.inner_text("#c-events"))

    page.clock.run_for(4 * 60000 + 58000)
    check("通知前: まだ帯は出ていない", not page.is_visible("#toast"))
    page.clock.run_for(2500)
    check("通知: 開始10分前に帯が出る", page.is_visible("#toast"))
    check("通知: 同時刻の予定は両方とも帯に出る",
          "設計レビュー" in page.inner_text("#toast") and "部品の受け取り" in page.inner_text("#toast"),
          page.inner_text("#toast"))
    check("通知: 明滅している", page.evaluate("document.body.dataset.flash") == "event")
    page.clock.run_for(30000)
    check("通知: 5分以上放置していても暗くならない", not page.evaluate("document.body.classList.contains('dim')"))
    page.clock.run_for(40000)
    check("通知: 帯は60秒で消える", not page.is_visible("#toast"))

    page.reload()
    page.wait_for_timeout(300)
    page.clock.run_for(3000)
    check("再読み込み: 同じ予定を二度は通知しない", not page.is_visible("#toast"))

    state["relay"] = "html"
    page.clock.run_for(31 * 60000)
    page.wait_for_timeout(300)
    page.clock.run_for(1000)
    check("中継がHTMLを返しても前回の予定を保つ", "設計レビュー" in page.inner_text("#c-events"), page.inner_text("#c-events"))
    check("中継の失敗を表示する", "更新できません" in page.inner_text("#c-status"), page.inner_text("#c-status"))
    check("通知まわり: ページのエラーなし", not errors, "; ".join(errors))
    page.context.close()


def run_recovery(browser):
    """壊れた保存データと、起動時に通信できない場合（レビュー指摘 I2・I5）"""
    bad = {"desk.cache.calendar": '{"data":{"oops":1},"updatedAt":1}', "desk.cache.weather": '{"data":{"x":1},"updatedAt":1}'}
    page, state, errors = seeded_page(browser, extra_storage=bad)
    state["weather"] = "down"
    state["relay"] = "down"
    page.goto(URL)
    page.wait_for_timeout(300)
    check("壊れた保存データでも時計が出る", page.inner_text("#home-clock") == "10:00", page.inner_text("#home-clock"))
    page.clock.run_for(2000)
    check("壊れた保存データでも時計が進み続ける", page.inner_text("#strip-time") == "25:00", page.inner_text("#strip-time"))
    check("起動時に通信できない: 天気は取得できない旨を表示", "取得できません" in page.inner_text("#w-message"), page.inner_text("#w-message"))

    state["weather"] = "ok"
    state["relay"] = "ok"
    page.clock.run_for(61000)
    page.wait_for_timeout(300)
    page.clock.run_for(1000)
    check("通信が戻ると1分ほどで天気が出る", page.inner_text("#w-temp") == "14°", page.inner_text("#w-temp"))
    check("通信が戻ると1分ほどで予定が出る", "設計レビュー" in page.inner_text("#c-events"), page.inner_text("#c-events"))
    check("復旧まわり: ページのエラーなし", not errors, "; ".join(errors))
    page.context.close()


def run_touch(browser):
    """タッチ操作で通知音の案内が正しく消える（レビュー指摘 I1）"""
    page, state, errors = seeded_page(browser, has_touch=True)
    page.goto(URL)
    page.wait_for_timeout(300)
    check("タッチ: 最初は案内が出ている", page.is_visible("#sound-hint"))
    page.tap("#sound-hint")
    page.wait_for_timeout(300)
    check("タッチ: 案内をタップすると消える", not page.is_visible("#sound-hint"))
    page.context.close()


def main() -> int:
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        time.sleep(1)
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome")
            page = browser.new_page(viewport={"width": 1280, "height": 800})
            run(page)
            run_notifications(browser)
            run_recovery(browser)
            run_touch(browser)
            browser.close()
    finally:
        server.terminate()
    print(f"\n{len(failures)} 件の失敗" if failures else "\nすべて成功")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
