"""ブラウザでの通し確認。使い方: python3 tools/e2e.py
通信はすべて差し替える（天気はテスト用データ、中継は模擬応答）。時計も差し替えて早送りする。"""
import json
import pathlib
import subprocess
import sys
import time
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8766
URL = f"http://127.0.0.1:{PORT}/"
FIXTURE = json.loads((ROOT / "tests/fixtures/open-meteo.json").read_text(encoding="utf-8"))
failures = []
count = {"n": 0}

BASE_SETTINGS = {
    "latitude": 35.68, "longitude": 139.76,
    "relayUrl": "https://script.google.com/macros/s/x/exec?token=t",
    "workMin": 25, "shortBreakMin": 5, "longBreakMin": 15, "cyclesBeforeLong": 4,
    "notifyLeadMin": 10, "dimAfterMin": 5,
    "nightEnabled": True, "nightStart": "22:00", "nightEnd": "07:00",
    "plugEnabled": False, "plugLow": 35, "plugHigh": 80,
}
# 2026-11-12 は木曜。時刻は UTC（日本時間 -9時間）
EVENTS = [
    {"id": "e1", "title": "設計レビュー", "start": "2026-11-12T01:15:00.000Z", "end": "2026-11-12T02:00:00.000Z", "allDay": False},
    {"id": "e2", "title": "部品の受け取り", "start": "2026-11-12T01:15:00.000Z", "end": "2026-11-12T01:30:00.000Z", "allDay": False},
    {"id": "e3", "title": "歯医者", "start": "2026-11-14T06:00:00.000Z", "end": "2026-11-14T07:00:00.000Z", "allDay": False},
    {"id": "e4", "title": "出張", "start": "2026-11-15T15:00:00.000Z", "end": "2026-11-16T15:00:00.000Z", "allDay": True},
]
BATTERY_MOCK = """
(() => {
  const target = new EventTarget();
  const battery = { level: %s, charging: %s,
    addEventListener: (t, f) => target.addEventListener(t, f),
    removeEventListener: (t, f) => target.removeEventListener(t, f) };
  navigator.getBattery = () => Promise.resolve(battery);
  window.__battery = (level, charging) => {
    battery.level = level; battery.charging = charging;
    target.dispatchEvent(new Event('levelchange')); target.dispatchEvent(new Event('chargingchange'));
  };
})();
"""
NO_BATTERY = "delete Navigator.prototype.getBattery; try { delete navigator.getBattery; } catch (e) {}"


def check(name, cond, detail=""):
    count["n"] += 1
    print(("ok   " if cond else "FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


def body_has(page, cls):
    return page.evaluate(f"document.body.classList.contains('{cls}')")


def screen(page):
    return page.evaluate("document.body.dataset.screen")


def go(page, tab):
    if body_has(page, "dim"):
        page.mouse.click(640, 300)  # 暗くなっていたら、最初のタッチで明るさを戻す
    page.click(f"#tabs [data-tab={tab}]")
    page.wait_for_function(f"document.body.dataset.screen === '{tab}'")


def new_page(browser, *, start="2026-11-12T10:00:00+09:00", settings=None, storage=None, events=None,
             weather=None, battery="none", **context_args):
    """端末を再現したページを作る。settings=None なら未設定（初回起動）の状態。"""
    context = browser.new_context(viewport={"width": 1280, "height": 800}, **context_args)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.text.startswith("[desk]") else None)
    state = {"weather": "ok", "relay": "ok", "plugReply": "ok", "plug": [], "heartbeat": 0,
             "events": events if events is not None else EVENTS, "weatherBody": weather or FIXTURE}

    def on_weather(route):
        if state["weather"] == "ok":
            route.fulfill(status=200, content_type="application/json", body=json.dumps(state["weatherBody"]))
        else:
            route.abort()

    def on_relay(route):
        query = parse_qs(urlparse(route.request.url).query)
        action = query.get("action", ["events"])[0]
        if state["relay"] == "down":
            route.abort()
            return
        if state["relay"] == "html":
            route.fulfill(status=200, content_type="text/html", body="<html>ログイン</html>")
            return
        if action == "plug":
            wanted = query.get("state", [""])[0]
            state["plug"].append(wanted)
            body = {"ok": True, "state": wanted} if state["plugReply"] == "ok" else state["events"]
        elif action == "heartbeat":
            state["heartbeat"] += 1
            body = {"ok": True}
        else:
            body = state["events"]
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

    page.route("https://api.open-meteo.com/**", on_weather)
    page.route("https://script.google.com/**", on_relay)
    seed = dict(storage or {})
    if settings is not None:
        seed["desk.settings"] = json.dumps({**BASE_SETTINGS, **settings})
    for key, value in seed.items():
        page.add_init_script(f"if (!localStorage.getItem({key!r})) localStorage.setItem({key!r}, {value!r});")
    if battery == "none":
        page.add_init_script(NO_BATTERY)
    else:
        level, charging = battery
        page.add_init_script(BATTERY_MOCK % (level, "true" if charging else "false"))
    page.clock.install(time=start)
    return page, state, errors


def open_app(page, fragment=""):
    page.goto(URL + fragment)
    page.wait_for_timeout(300)


def lit(page, bar):
    return page.evaluate(f"[...document.querySelectorAll('{bar} i')].filter((i) => Number(i.style.opacity) > 0).length")


# ------------------------------------------------------------------ 初回起動から設定、タイマーまで
def run_first_use(browser):
    page, state, errors = new_page(browser)
    open_app(page)
    check("初回: 場所の入力を促す", "設定で場所を入力してください" in page.inner_text("#hw-message"))
    check("初回: カレンダー接続を促す", "設定でカレンダーを接続してください" in page.inner_text("#c-message"))
    check("初回: 通知音の案内が出ている", page.is_visible("#sound-hint"))
    check("時計は日本時間", page.inner_text("#home-clock") == "10:00", page.inner_text("#home-clock"))
    check("ホームのバーは20目盛りすべて点灯", lit(page, "#home-bar") == 20, str(lit(page, "#home-bar")))

    page.click("#home-clock")
    check("タップ後: 通知音の案内が消える", not page.is_visible("#sound-hint"))

    go(page, "settings")
    page.fill("[name=latitude]", "95")
    page.fill("[name=longitude]", "139.76")
    page.click("#settings-form button[type=submit]")
    check("設定: 範囲外の緯度でエラー表示", "緯度" in page.inner_text("[data-error=latitude]"))
    check("設定: エラー時は入力が残る", page.input_value("[name=latitude]") == "95")
    check("設定: エラー時は画面が変わらない", screen(page) == "settings")

    page.fill("[name=latitude]", "35.68")
    page.fill("[name=workMin]", "1")
    page.click("#settings-form button[type=submit]")
    page.wait_for_function("document.body.dataset.screen === 'home'")
    page.wait_for_timeout(300)
    page.clock.run_for(1000)
    check("ホーム: 今の天気を表示", page.inner_text("#hw-temp") == "14°", page.inner_text("#hw-temp"))

    go(page, "weather")
    check("天気: これから24時間を1時間ごとに表示", page.locator("#w-hours li").count() == 24, str(page.locator("#w-hours li").count()))
    check("天気: 最初は11時", page.inner_text("#w-hours li:first-child .h-time") == "11時")
    check("天気: 日付が変わるセルに「明日」の印", page.locator("#w-hours li .h-day").count() == 1
          and "0時" in page.inner_text("#w-hours li:has(.h-day)"))

    state["weather"] = "down"
    go(page, "home")
    page.clock.fast_forward("31:00")
    page.wait_for_timeout(300)
    page.clock.run_for(1000)
    check("減光: 31分放置で暗くなっている", body_has(page, "dim"))
    page.mouse.click(300, 200)  # 最初のタッチは明るさを戻すだけ
    check("減光: タッチで戻る", not body_has(page, "dim"))
    check("天気: 取得失敗でも前回値を表示", page.inner_text("#hw-temp") == "14°")
    go(page, "weather")
    check("天気: 更新できない旨を表示", "更新できません" in page.inner_text("#w-status"), page.inner_text("#w-status"))
    state["weather"] = "ok"

    go(page, "home")
    page.click("#home-timer")
    page.wait_for_function("document.body.dataset.screen === 'timer'")
    check("タイマー: 待機中は1分", page.inner_text("#t-remaining") == "01:00", page.inner_text("#t-remaining"))
    check("タイマー: 待機中はバーが20目盛り", lit(page, "#timer-bar") == 20)
    page.click("#t-toggle")
    check("タイマー: 開始で作業の色", page.evaluate("document.body.dataset.phase") == "work")
    check("タイマー: ボタンが一時停止に", page.inner_text("#t-toggle") == "一時停止")

    page.clock.run_for(30000)
    n = lit(page, "#timer-bar")
    check("バー: 半分経過で点灯は10目盛り前後", 9 <= n <= 11, str(n))
    check("バー: まだ終了間近の色ではない", page.get_attribute("#timer-bar", "data-low") != "true")

    page.clock.fast_forward("00:02")
    page.reload()
    page.wait_for_timeout(300)
    check("再読み込み: 走行中のまま復元", page.inner_text("#t-remaining") == "00:28", page.inner_text("#t-remaining"))
    check("再読み込み: タイマー画面のまま", screen(page) == "timer")

    page.clock.run_for(23000)
    check("バー: 残り10%以下で終了間近の色", page.get_attribute("#timer-bar", "data-low") == "true")
    check("バー: 残り5秒で点灯は2目盛り以下", lit(page, "#timer-bar") <= 2, str(lit(page, "#timer-bar")))
    check("作業中は2分以上たってもタイマー画面のまま", screen(page) == "timer")

    page.clock.run_for(6000)
    check("作業終了: 休憩に切り替わる", page.evaluate("document.body.dataset.phase") == "short_break")
    check("作業終了: 丸が1つ埋まる", page.locator("#t-rounds li.done").count() == 1)
    check("作業終了: 休憩は5分から数える", page.inner_text("#t-remaining").startswith("04:5"), page.inner_text("#t-remaining"))

    page.click("#t-toggle")
    check("一時停止: バーが薄くなる", page.get_attribute("#timer-bar", "data-paused") == "true")
    page.click("#t-reset")
    check("リセット: 待機に戻る", page.evaluate("document.body.dataset.phase") == "idle")
    page.clock.run_for(121000)
    check("待機中のタイマー画面は2分でホームに戻る", screen(page) == "home", screen(page))
    page.clock.run_for(3 * 60000 + 5000)
    check("減光: 5分無操作で暗くなる", body_has(page, "dim"))
    page.mouse.click(400, 300)
    check("減光解除のタッチでボタンは押されない", page.evaluate("document.body.dataset.phase") == "idle" and screen(page) == "home")
    check("初回起動まわり: ページのエラーなし", not errors, "; ".join(errors))
    page.context.close()


# ------------------------------------------------------------------ タブと週間カレンダー
def run_tabs_and_week(browser):
    page, state, errors = new_page(browser, settings={})
    open_app(page)
    check("タブ: ホームが選択状態", page.get_attribute("#tabs [data-tab=home]", "aria-current") == "page")
    go(page, "week")
    check("タブ: 週間が選択状態", page.get_attribute("#tabs [data-tab=week]", "aria-current") == "page"
          and page.get_attribute("#tabs [data-tab=home]", "aria-current") is None)
    days = page.locator("#week-days > li")
    check("週間: 7日分の列がある", days.count() == 7, str(days.count()))
    check("週間: 今日の列に印と見出し", days.nth(0).get_attribute("data-today") == "true" and "木" in days.nth(0).inner_text())
    check("週間: 今日の予定が今日の列に出る", "設計レビュー" in days.nth(0).inner_text() and "10:15" in days.nth(0).inner_text())
    check("週間: 2日後の予定がその列に出る", "歯医者" in days.nth(2).inner_text() and "歯医者" not in days.nth(1).inner_text(), days.nth(2).inner_text())
    check("週間: 終日予定がその日の列にだけ出る", "出張" in days.nth(4).inner_text() and "出張" not in days.nth(5).inner_text()
          and "出張" not in days.nth(3).inner_text())

    page.clock.run_for(119000)
    check("自動復帰: 2分たつ前は週間のまま", screen(page) == "week")
    page.clock.run_for(2000)
    check("自動復帰: 2分でホームに戻る", screen(page) == "home")

    go(page, "weather")
    page.clock.run_for(60000)
    page.mouse.click(640, 300)
    page.clock.run_for(100000)
    check("自動復帰: 操作すると数え直す", screen(page) == "weather")
    go(page, "settings")
    page.clock.run_for(4 * 60000)
    check("自動復帰: 設定画面からは戻らない", screen(page) == "settings")
    check("タブまわり: ページのエラーなし", not errors, "; ".join(errors))
    page.context.close()


# ------------------------------------------------------------------ 予定の通知（v1 レビュー指摘の確認を引き継ぐ）
def run_notifications(browser):
    page, state, errors = new_page(browser, settings={})
    open_app(page)
    check("予定: 中継から取得してホームに表示", "設計レビュー" in page.inner_text("#c-events"), page.inner_text("#c-events"))
    page.clock.run_for(4 * 60000 + 58000)
    check("通知前: まだ帯は出ていない", not page.is_visible("#toast"))
    page.clock.run_for(2500)
    check("通知: 開始10分前に帯が出る", page.is_visible("#toast"))
    check("通知: 同時刻の予定は両方とも帯に出る",
          "設計レビュー" in page.inner_text("#toast") and "部品の受け取り" in page.inner_text("#toast"), page.inner_text("#toast"))
    check("通知: 明滅している", page.evaluate("document.body.dataset.flash") == "event")
    page.clock.run_for(30000)
    check("通知: 5分以上放置していても暗くならない", not body_has(page, "dim"))
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
    page.mouse.click(300, 200)
    check("中継がHTMLを返しても前回の予定を保つ", "歯医者" in page.inner_text("#c-events"), page.inner_text("#c-events"))
    check("中継の失敗を表示する", "更新できません" in page.inner_text("#c-status"), page.inner_text("#c-status"))
    check("通知まわり: ページのエラーなし", not errors, "; ".join(errors))
    page.context.close()


# ------------------------------------------------------------------ 定期リマインダー
def run_reminders(browser):
    page, state, errors = new_page(browser, settings={}, events=[])
    open_app(page)
    go(page, "settings")
    page.click("#rem-form button[type=submit]")
    check("リマインダー: 題名なしはエラー", page.inner_text("[data-rem-error=title]") != "")
    check("リマインダー: 曜日なしはエラー", page.inner_text("[data-rem-error=weekdays]") != "")
    page.fill("#rem-form [name=title]", "ゴミ出し")
    page.check("#rem-form [name=weekday][value='4']")
    page.check("#rem-form [name=weekday][value='2']")
    page.fill("#rem-form [name=time]", "10:20")
    page.click("#rem-form button[type=submit]")
    check("リマインダー: 追加すると一覧に出る", "ゴミ出し" in page.inner_text("#rem-list") and "10:20" in page.inner_text("#rem-list"), page.inner_text("#rem-list"))
    check("リマインダー: 追加後は入力欄が空に戻る", page.input_value("#rem-form [name=title]") == "")

    go(page, "week")
    days = page.locator("#week-days > li")
    check("リマインダー: 週間の木曜（今日）に出る", "ゴミ出し" in days.nth(0).inner_text())
    check("リマインダー: 週間の火曜にも出て、金曜には出ない", "ゴミ出し" in days.nth(5).inner_text() and "ゴミ出し" not in days.nth(1).inner_text())

    go(page, "home")
    page.clock.run_for(19 * 60000)
    check("リマインダー: 時刻の前は鳴らない", not page.is_visible("#toast"))
    page.clock.run_for(61000)
    check("リマインダー: 時刻になると帯が出る", page.is_visible("#toast") and "ゴミ出し" in page.inner_text("#toast"), page.inner_text("#toast"))
    check("リマインダー: 放置していても暗くならない", not body_has(page, "dim"))

    page.reload()
    page.wait_for_timeout(300)
    page.clock.run_for(3000)
    check("リマインダー: 再読み込みしても繰り返さない", not page.is_visible("#toast"))

    go(page, "settings")
    page.click("#rem-list button")
    check("リマインダー: 削除すると一覧から消える", "ゴミ出し" not in page.inner_text("#rem-list"))
    go(page, "week")
    check("リマインダー: 削除すると週間からも消える", "ゴミ出し" not in page.inner_text("#week-days"))
    check("リマインダーまわり: ページのエラーなし", not errors, "; ".join(errors))
    page.context.close()


# ------------------------------------------------------------------ 雨の予告と夜間
def run_rain_and_night(browser):
    rainy = json.loads(json.dumps(FIXTURE))
    rainy["hourly"]["precipitation_probability"][12] = 80  # 12時
    page, state, errors = new_page(browser, settings={}, weather=rainy, events=[])
    open_app(page)
    page.clock.run_for(1000)
    check("雨の予告: 3時間以内の雨をホームに表示", page.is_visible("#home-rain") and "12時" in page.inner_text("#home-rain")
          and "80%" in page.inner_text("#home-rain"), page.inner_text("#home-rain"))
    page.context.close()

    page, state, errors = new_page(browser, settings={}, events=[])
    open_app(page)
    page.clock.run_for(1000)
    check("雨の予告: 雨がなければ表示しない", not page.is_visible("#home-rain"))
    page.context.close()

    late = [{"id": "n1", "title": "夜の予定", "start": "2026-11-12T14:15:00.000Z", "end": "2026-11-12T15:00:00.000Z", "allDay": False}]
    page, state, errors = new_page(browser, start="2026-11-12T23:00:00+09:00", settings={}, events=late)
    open_app(page)
    page.clock.run_for(25000)
    check("夜間: 30秒たつ前は明るい", not body_has(page, "dim"))
    page.clock.run_for(10000)
    check("夜間: 無操作30秒で暗くなる", body_has(page, "dim") and body_has(page, "night"))
    page.clock.run_for(4 * 60000 + 26000)
    check("夜間: 通知のときは明るさが戻る", page.is_visible("#toast") and not body_has(page, "dim"), page.inner_text("#toast"))
    check("夜間まわり: ページのエラーなし", not errors, "; ".join(errors))
    page.context.close()

    page, state, errors = new_page(browser, start="2026-11-12T23:00:00+09:00", settings={"nightEnabled": False}, events=[])
    open_app(page)
    page.clock.run_for(60000)
    check("夜間: 無効にすると30秒では暗くならない", not body_has(page, "dim") and not body_has(page, "night"))
    page.context.close()


# ------------------------------------------------------------------ 電源管理
def run_power(browser):
    page, state, errors = new_page(browser, settings={"plugEnabled": True}, events=[], battery=(0.30, False))
    open_app(page)
    page.clock.run_for(2000)
    page.wait_for_timeout(200)
    check("電源: 残量をホームに表示", page.is_visible("#home-battery") and "30%" in page.inner_text("#home-battery"), page.inner_text("#home-battery"))
    check("電源: 下限以下で「入」を1回送る", state["plug"] == ["on"], str(state["plug"]))
    page.evaluate("window.__battery(0.31, true)")
    page.clock.run_for(3 * 60000)
    page.wait_for_timeout(200)
    check("電源: 充電が始まれば繰り返さない", state["plug"] == ["on"], str(state["plug"]))
    page.evaluate("window.__battery(0.85, true)")
    page.clock.run_for(2000)
    page.wait_for_timeout(200)
    check("電源: 上限以上で「切」を送る", state["plug"] == ["on", "off"], str(state["plug"]))
    page.clock.run_for(6 * 60000)
    page.wait_for_timeout(200)
    check("電源: 切ったのに充電が続いていれば5分後に送り直す", state["plug"] == ["on", "off", "off"], str(state["plug"]))
    page.evaluate("window.__battery(0.85, false)")  # プラグが切れて充電が止まった
    for _ in range(11):
        page.clock.run_for(60000)
        page.wait_for_timeout(30)
    check("電源: 充電が止まれば送り直しをやめる", state["plug"] == ["on", "off", "off"], str(state["plug"]))
    check("電源: 指示がない間は10分ごとに生存連絡を送る", state["heartbeat"] >= 1, str(state["heartbeat"]))
    go(page, "settings")
    check("電源: 設定画面に最後の指示を表示", "切" in page.inner_text("#power-status"), page.inner_text("#power-status"))
    check("電源まわり: ページのエラーなし", not errors, "; ".join(errors))
    page.context.close()

    # 古い中継（plug を知らず、予定の配列を返す）では成功扱いにせず、やり直す
    page, state, errors = new_page(browser, settings={"plugEnabled": True}, events=[], battery=(0.20, False))
    state["plugReply"] = "array"
    open_app(page)
    page.clock.run_for(2000)
    page.wait_for_timeout(200)
    first = len(state["plug"])
    page.clock.run_for(2 * 60000 + 2000)
    page.wait_for_timeout(200)
    check("電源: 中継が成功を返さない間は送り直す", first >= 1 and len(state["plug"]) > first, f"{first} → {len(state['plug'])}")
    go(page, "settings")
    check("電源: 届いていない旨を設定画面に表示", "届いていません" in page.inner_text("#power-status"), page.inner_text("#power-status"))
    state["plugReply"] = "ok"
    page.clock.run_for(61000)
    page.wait_for_timeout(200)
    page.evaluate("window.__battery(0.21, true)")
    settled = len(state["plug"])
    page.clock.run_for(3 * 60000)
    page.wait_for_timeout(200)
    check("電源: 成功したら送り直しをやめる", len(state["plug"]) == settled, f"{settled} → {len(state['plug'])}")
    page.context.close()

    # 無効のとき・電池を読めないとき
    page, state, errors = new_page(browser, settings={"plugEnabled": False}, events=[], battery=(0.20, False))
    open_app(page)
    page.clock.run_for(3 * 60000)
    page.wait_for_timeout(200)
    check("電源: 無効なら指示も生存連絡も送らない", state["plug"] == [] and state["heartbeat"] == 0, str(state["plug"]))
    page.context.close()

    page, state, errors = new_page(browser, settings={"plugEnabled": True}, events=[], battery="none")
    open_app(page)
    page.clock.run_for(3 * 60000)
    page.wait_for_timeout(200)
    check("電源: 電池を読めない端末では指示を送らない", state["plug"] == [], str(state["plug"]))
    check("電源: 電池を読めない端末では残量を表示しない", not page.is_visible("#home-battery"))
    go(page, "settings")
    check("電源: 読めない旨を設定画面に表示", "読めない" in page.inner_text("#power-status"), page.inner_text("#power-status"))
    check("電源（読めない場合）: ページのエラーなし", not errors, "; ".join(errors))
    page.context.close()


# ------------------------------------------------------------------ 復旧とタッチ（v1 レビュー指摘の確認を引き継ぐ）
def run_recovery_and_touch(browser):
    bad = {"desk.cache.calendar": '{"data":{"oops":1},"updatedAt":1}', "desk.cache.weather": '{"data":{"x":1},"updatedAt":1}',
           "desk.reminders": '{"oops":1}', "desk.power": "x"}
    page, state, errors = new_page(browser, settings={}, storage=bad)
    state["weather"] = "down"
    state["relay"] = "down"
    open_app(page)
    check("壊れた保存データでも時計が出る", page.inner_text("#home-clock") == "10:00", page.inner_text("#home-clock"))
    page.clock.run_for(2000)
    check("壊れた保存データでもタイマー表示が出る", page.inner_text("#bar-time") == "25:00", page.inner_text("#bar-time"))
    check("起動時に通信できない: 天気は取得できない旨を表示", "取得できません" in page.inner_text("#hw-message"), page.inner_text("#hw-message"))
    go(page, "week")
    check("起動時に通信できない: 週間は取得できない旨を表示", "取得できません" in page.inner_text("#week-message"), page.inner_text("#week-message"))
    go(page, "home")
    state["weather"] = "ok"
    state["relay"] = "ok"
    page.clock.run_for(61000)
    page.wait_for_timeout(300)
    page.clock.run_for(1000)
    check("通信が戻ると1分ほどで天気が出る", page.inner_text("#hw-temp") == "14°", page.inner_text("#hw-temp"))
    check("通信が戻ると1分ほどで予定が出る", "設計レビュー" in page.inner_text("#c-events"), page.inner_text("#c-events"))
    check("復旧まわり: ページのエラーなし", not errors, "; ".join(errors))
    page.context.close()

    page, state, errors = new_page(browser, settings={}, has_touch=True)
    open_app(page)
    check("タッチ: 最初は案内が出ている", page.is_visible("#sound-hint"))
    page.tap("#sound-hint")
    page.wait_for_timeout(300)
    check("タッチ: 案内をタップすると消える", not page.is_visible("#sound-hint"))
    page.tap("#tabs [data-tab=week]")
    page.wait_for_timeout(200)
    check("タッチ: タブで画面が切り替わる", screen(page) == "week")
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
            for scenario in (run_first_use, run_tabs_and_week, run_notifications, run_reminders,
                             run_rain_and_night, run_power, run_recovery_and_touch):
                scenario(browser)
            browser.close()
    finally:
        server.terminate()
    print(f"\n{count['n']} 項目中 {len(failures)} 件の失敗" if failures else f"\n{count['n']} 項目すべて成功")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
