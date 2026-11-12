# Fire HD 8 卓上スマートディスプレイ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fire HD 8（第12世代）の全画面ブラウザで動く、ポモドーロ・時計・天気・Googleカレンダー表示のダッシュボードWebアプリを作る。

**Architecture:** ビルド工程のない静的Webアプリ（HTML/CSS/ES Modules）。ロジック（タイマー状態機械、予定の通知判定、天気の変換、キャッシュ）は DOM に依存しない純粋なモジュールにして `node --test` で検証し、DOM 操作は薄い `ui/` 層に閉じ込める。カレンダーはユーザーのGoogleアカウントに置く Apps Script の中継からJSONで受け取る。

**Tech Stack:** HTML / CSS / JavaScript (ES Modules、依存パッケージなし)、Node.js 22 の組み込みテストランナー、Google Apps Script、Open-Meteo API、GitHub Pages。画面確認は Playwright (Python) + Chrome。

**Spec:** `docs/superpowers/specs/2026-11-12-fire-hd8-smart-display-design.md`

## Global Constraints

- npm パッケージを追加しない（`package.json` は `"type": "module"` と `scripts.test` のみ）。
- 画面は 1280×800（横置き）を基準にし、800×1280 でも崩れないこと。
- 表示言語は日本語。タイムゾーンは `Asia/Tokyo` 固定。
- 既定値: 作業25分、休憩5分、長休憩15分、4回ごとに長休憩、予定通知は10分前、天気と予定の更新間隔は30分、無操作5分で減光。
- 秘密情報（中継URLとトークン）はリポジトリ・ログ・画面に出さない。設定は端末の `localStorage` に保存する。
- 天気・予定の取得が失敗しても、タイマーと時計は止めない。前回値を最終更新時刻つきで表示する。
- `localStorage` のキーは接頭辞 `desk.` を付ける（`desk.timer`, `desk.settings`, `desk.cache.weather`, `desk.cache.calendar`, `desk.notified`）。
- コミットはタスクごと。コミットメッセージ末尾の帰属行はセッションの指定に従う。

## Review Focus

1. タイマー作動中にページが再読み込み／端末が再起動される → 残り時間が正しく復元される（Task 1）。
2. 端末がスリープして複数フェーズ分の時間が過ぎた → フェーズを何周も自動で進めず、次のフェーズで停止して待つ。通知音は鳴らさない（Task 1）。
3. 中継がJSON以外（トークン誤りのエラー、Googleのログイン画面のHTML）を返す → 失敗として扱い、前回のキャッシュを保つ（Task 3, 4）。
4. 予定通知が再読み込みのたびに繰り返し鳴る／既に始まった予定や終日予定で鳴る → 1予定につき1回だけ、開始前の時間帯にのみ鳴る（Task 2）。
5. ブラウザの自動再生制限で、最初のタッチまで音が出ない → 音が未許可の間は画面に「タップして通知音を有効にする」を表示し、音が出なくても画面の色変化で通知する（Task 6）。

## File Structure

```
index.html              画面の骨組み（ホーム/タイマー/設定の3画面）
styles.css              レイアウトと配色、減光
package.json            type:module、test スクリプト
src/core/timer.js       ポモドーロ状態機械
src/core/schedule.js    予定の絞り込みと通知判定
src/core/settings.js    設定の既定値・読み書き・検証
src/services/cache.js   取得＋キャッシュ＋失敗時フォールバック
src/services/weather.js Open-Meteo のURL組み立てと変換、天気コードの日本語化
src/services/calendar.js 中継レスポンスの検証と変換
src/ui/format.js        時刻・残り時間・日付の表示用文字列
src/ui/views.js         各画面の描画（DOM操作）
src/ui/notify.js        通知音（Web Audio）と画面の色変化、音の許可状態
src/ui/dim.js           無操作時の減光
src/app.js              組み立てと1秒ごとの主ループ
relay/Code.gs           Apps Script のカレンダー中継
tests/*.test.js         node --test
tools/screenshot.py     Playwright で 1280×800 / 800×1280 のPNGを出力
docs/device-setup.md    実機セットアップと確認の手順書
```

---

### Task 1: ポモドーロ状態機械

**Files:**
- Create: `package.json`, `.gitignore`, `src/core/timer.js`
- Test: `tests/timer.test.js`

**Interfaces:**
- Produces:
  - `createTimer({ now, durations, storage }) -> timer`
    - `now: () => number`（ミリ秒）
    - `durations: { workMs, shortBreakMs, longBreakMs, cyclesBeforeLong }`
    - `storage: { getItem(key), setItem(key, value) }`（キー `desk.timer`）
  - `timer.start()`, `timer.pause()`, `timer.reset()`, `timer.skip()`
  - `timer.tick() -> Array<{ type: 'phase_changed', from, to, stale: boolean }>`
  - `timer.snapshot() -> { phase: 'work'|'short_break'|'long_break', status: 'idle'|'running'|'paused', remainingMs: number, completedWork: number }`
  - `timer.setDurations(durations)`（次のフェーズから反映）

- [ ] **Step 1: リポジトリを初期化する**

`git init`、`package.json`（`{"type":"module","private":true,"scripts":{"test":"node --test tests/"}}`）、`.gitignore`（`node_modules/`, `out/`）。

- [ ] **Step 2: 失敗するテストを書く**

`tests/timer.test.js`。共通の準備として、`let t = 0; const now = () => t;`、`Map` を包んだ偽の storage、`durations = { workMs: 25*60e3, shortBreakMs: 5*60e3, longBreakMs: 15*60e3, cyclesBeforeLong: 4 }` を使う。

```js
test('初期状態は作業・待機・残り25分', () => {
  assert.deepEqual(timer.snapshot(), { phase: 'work', status: 'idle', remainingMs: 1500000, completedWork: 0 });
});
test('25分経過で休憩に入り、自動で走り続ける', () => {
  timer.start(); t = 1500000;
  assert.deepEqual(timer.tick(), [{ type: 'phase_changed', from: 'work', to: 'short_break', stale: false }]);
  assert.deepEqual(timer.snapshot(), { phase: 'short_break', status: 'running', remainingMs: 300000, completedWork: 1 });
});
test('次のフェーズは前のフェーズの終了時刻から数える', () => {
  timer.start(); t = 1500000 + 2000; timer.tick();
  assert.equal(timer.snapshot().remainingMs, 298000);
});
test('4回目の作業のあとは長休憩、その後は completedWork が0に戻る', () => { /* work→short×3、4回目の work 終了で to:'long_break'、long_break 終了で phase:'work', completedWork:0 */ });
test('一時停止中は残り時間が減らず、再開で続きから', () => {
  timer.start(); t = 60000; timer.pause(); t = 999999;
  assert.equal(timer.snapshot().remainingMs, 1440000);
  timer.start(); t += 1000;
  assert.equal(timer.snapshot().remainingMs, 1439000);
});
test('reset は現在のフェーズを待機・満了時間に戻す', () => { /* running 中に reset → status:'idle', remainingMs: フェーズの全時間, phase と completedWork は不変 */ });
test('skip は次のフェーズへ進み待機にする', () => { /* work で skip → phase:'short_break', status:'idle', completedWork:1 */ });
test('再読み込み後に走行中の残り時間を復元する', () => {
  timer.start(); t = 600000;
  const restored = createTimer({ now, durations, storage });
  assert.deepEqual(restored.snapshot(), { phase: 'work', status: 'running', remainingMs: 900000, completedWork: 0 });
});
test('終了から60秒を超えて過ぎていたら、次のフェーズで待機し stale を立てる', () => {
  timer.start(); t = 1500000 + 2 * 3600e3;
  assert.deepEqual(timer.tick(), [{ type: 'phase_changed', from: 'work', to: 'short_break', stale: true }]);
  assert.deepEqual(timer.snapshot(), { phase: 'short_break', status: 'idle', remainingMs: 300000, completedWork: 1 });
});
test('保存データが壊れていたら初期状態で始める', () => {
  storage.setItem('desk.timer', '{not json');
  assert.equal(createTimer({ now, durations, storage }).snapshot().status, 'idle');
});
test('時計が巻き戻っても残り時間はフェーズの全時間を超えない', () => {
  timer.start(); t = -5000;
  assert.equal(timer.snapshot().remainingMs, 1500000);
});
```

- [ ] **Step 3: 失敗を確認する**

Run: `npm test` / Expected: FAIL（`src/core/timer.js` が存在しない）

- [ ] **Step 4: `src/core/timer.js` を実装する**

保持する状態は `{ phase, status, endsAt, remainingMs, completedWork }`。走行中は `endsAt` を正とし、`start/pause/reset/skip/tick` で状態が変わるたびに `desk.timer` へ JSON で保存する。`tick()` は1回の呼び出しで最大1回だけ遷移する。stale の境界は `now - endsAt > 60000`。

- [ ] **Step 5: 成功を確認する**

Run: `npm test` / Expected: PASS（11件）

- [ ] **Step 6: Commit** — `feat: pomodoro timer state machine`

---

### Task 2: 予定の絞り込みと通知判定

**Files:**
- Create: `src/core/schedule.js`
- Test: `tests/schedule.test.js`

**Interfaces:**
- Consumes: 予定の型 `CalEvent = { id: string, title: string, startMs: number, endMs: number, allDay: boolean }`（Task 4 が作る）
- Produces:
  - `upcomingEvents(events: CalEvent[], nowMs: number, limit = 2) -> CalEvent[]`
  - `dueNotifications(events: CalEvent[], nowMs: number, leadMs: number, notified: Set<string>) -> CalEvent[]`
  - `notifiedKey(event: CalEvent) -> string`（`` `${id}@${startMs}` ``）
  - `loadNotified(storage, nowMs) -> Set<string>`, `saveNotified(storage, set)`（キー `desk.notified`、開始から24時間を過ぎたキーは読み込み時に捨てる）

- [ ] **Step 1: 失敗するテストを書く**

```js
test('upcomingEvents: 終了済みを除き、開始時刻順に limit 件', () => { /* 終了済み1、進行中1、未来2 → 進行中と直近の未来 */ });
test('upcomingEvents: 終日予定は当日中は残り、時刻付きの後ろに並ぶ', () => {});
test('dueNotifications: 開始10分前から開始までの間だけ返す', () => {
  const ev = { id: 'a', title: '会議', startMs: 600000, endMs: 900000, allDay: false };
  assert.deepEqual(dueNotifications([ev], -1, 600000, new Set()), []);
  assert.deepEqual(dueNotifications([ev], 0, 600000, new Set()), [ev]);
  assert.deepEqual(dueNotifications([ev], 599999, 600000, new Set()), [ev]);
  assert.deepEqual(dueNotifications([ev], 600000, 600000, new Set()), []);
});
test('dueNotifications: 通知済みと終日予定は返さない', () => {});
test('同じ id でも開始時刻が変われば別の通知になる', () => {
  assert.notEqual(notifiedKey({ id: 'a', startMs: 1 }), notifiedKey({ id: 'a', startMs: 2 }));
});
test('loadNotified: 壊れたデータは空集合、古いキーは捨てる', () => {});
```

- [ ] **Step 2: 失敗を確認する** — Run: `npm test` / Expected: FAIL
- [ ] **Step 3: `src/core/schedule.js` を実装する**
- [ ] **Step 4: 成功を確認する** — Run: `npm test` / Expected: PASS
- [ ] **Step 5: Commit** — `feat: event filtering and notification rules`

---

### Task 3: 設定とキャッシュ付き取得

**Files:**
- Create: `src/core/settings.js`, `src/services/cache.js`
- Test: `tests/settings.test.js`, `tests/cache.test.js`

**Interfaces:**
- Produces:
  - `DEFAULTS = { latitude: null, longitude: null, relayUrl: '', workMin: 25, shortBreakMin: 5, longBreakMin: 15, cyclesBeforeLong: 4, notifyLeadMin: 10, dimAfterMin: 5 }`
  - `loadSettings(storage) -> Settings`（キー `desk.settings`。欠けた項目・不正な値は既定値で補う）
  - `saveSettings(storage, input) -> { ok: true, settings } | { ok: false, errors: { [field]: string } }`
    - 検証: 緯度 -90〜90、経度 -180〜180、各分数は 1〜180 の整数、`cyclesBeforeLong` は 1〜10、`relayUrl` は空か `https://script.google.com/` で始まる
  - `toDurations(settings) -> { workMs, shortBreakMs, longBreakMs, cyclesBeforeLong }`
  - `createCachedSource({ key, load, storage, now }) -> { refresh(): Promise<Result>, current(): Result }`
    - `load: () => Promise<data>`（失敗時は throw）
    - `Result = { data: any|null, updatedAt: number|null, error: boolean }`
    - 成功時は `{data, updatedAt: now()}` を保存して返す。失敗時は保存済みの値に `error: true` を付けて返す。保存がなければ `{ data: null, updatedAt: null, error: true }`。

- [ ] **Step 1: 失敗するテストを書く**

```js
test('loadSettings: 保存なし・壊れたJSONは既定値', () => {});
test('saveSettings: 範囲外の緯度はエラーになり保存しない', () => {
  const r = saveSettings(storage, { ...DEFAULTS, latitude: 91, longitude: 139 });
  assert.equal(r.ok, false); assert.ok(r.errors.latitude);
  assert.equal(storage.getItem('desk.settings'), null);
});
test('saveSettings: 文字列の数値は数に直して保存する', () => { /* フォーム入力は文字列で届く。'35.68' → 35.68 */ });
test('saveSettings: script.google.com 以外の中継URLは拒否', () => {});
test('toDurations: 分をミリ秒に直す', () => {});
test('cache: 成功したら保存し、次回の失敗時に前回値を error:true で返す', async () => {});
test('cache: 保存がなく失敗したら data:null', async () => {});
test('cache: current() は取得せず保存済みの値を返す', () => {});
```

- [ ] **Step 2: 失敗を確認する** — Run: `npm test` / Expected: FAIL
- [ ] **Step 3: 2ファイルを実装する**
- [ ] **Step 4: 成功を確認する** — Run: `npm test` / Expected: PASS
- [ ] **Step 5: Commit** — `feat: settings validation and cached data source`

---

### Task 4: 天気とカレンダーの取得・変換、中継スクリプト

**Files:**
- Create: `src/services/weather.js`, `src/services/calendar.js`, `relay/Code.gs`
- Test: `tests/weather.test.js`, `tests/calendar.test.js`, `tests/fixtures/open-meteo.json`

**Interfaces:**
- Produces:
  - `weatherUrl({ latitude, longitude }) -> string`
    `https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code,precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FTokyo&timeformat=unixtime&forecast_days=2`
  - `parseForecast(json, nowMs) -> { current: { tempC, code }, hours: Array<{ timeMs, tempC, code, pop }>, tomorrow: { code, maxC, minC } }`
    - `hours` は `nowMs` 以降の先頭6件。`json.error === true` や必須の配列が欠けていれば throw。
  - `weatherLabel(code) -> { text: string, icon: string }`（下表。未知のコードは `{ text: '不明', icon: '❔' }`）
  - `loadWeather(settings, fetchFn = fetch) -> Promise<Forecast>`（緯度経度が未設定なら throw）
  - `parseRelay(json) -> CalEvent[]`（配列でない、または要素に `id/title/start/end/allDay` が欠ければ throw。`start/end` は ISO 文字列 → ミリ秒）
  - `loadCalendar(settings, fetchFn = fetch) -> Promise<CalEvent[]>`（`relayUrl` が空なら throw。`response.ok` でない、または JSON として読めなければ throw）
  - 中継の応答形式: `[{ "id": "...", "title": "...", "start": "2026-11-12T10:00:00.000Z", "end": "...", "allDay": false }]`、エラー時は `{ "error": "unauthorized" }`

天気コードの対応: 0 快晴☀️ / 1 晴れ🌤️ / 2 晴れ時々くもり⛅ / 3 くもり☁️ / 45,48 霧🌫️ / 51,53,55,56,57 霧雨🌦️ / 61,63,65,66,67 雨🌧️ / 71,73,75,77 雪🌨️ / 80,81,82 にわか雨🌦️ / 85,86 にわか雪🌨️ / 95,96,97,99 雷雨⛈️

- [ ] **Step 1: フィクスチャを作る**

`tests/fixtures/open-meteo.json` に、上のURLの応答形（`current: { time, interval, temperature_2m, weather_code }`、`hourly: { time: [unix秒…48件], temperature_2m, weather_code, precipitation_probability }`、`daily: { time: [2件], weather_code, temperature_2m_max, temperature_2m_min }`）を手書きする。

- [ ] **Step 2: 失敗するテストを書く**

```js
test('weatherUrl: 緯度経度と必要な変数、unixtime、Asia/Tokyo を含む', () => {});
test('parseForecast: 現在・今後6時間・明日を取り出す（時刻はミリ秒）', () => {});
test('parseForecast: now より前の時間帯は hours に含めない', () => {});
test('parseForecast: {error:true} と hourly 欠落は throw', () => {});
test('weatherLabel: 0→快晴、63→雨、95→雷雨、未知→不明', () => {});
test('parseRelay: 正常な配列を CalEvent に直す', () => {});
test('parseRelay: {error:"unauthorized"} は throw', () => {});
test('loadCalendar: HTMLが返ってきたら throw（Googleのログイン画面）', async () => {
  const fetchFn = async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  await assert.rejects(loadCalendar({ relayUrl: 'https://script.google.com/x' }, fetchFn));
});
test('loadCalendar: relayUrl が空なら fetch せず throw', async () => {});
test('loadWeather: 緯度経度が null なら fetch せず throw', async () => {});
```

- [ ] **Step 3: 失敗を確認する** — Run: `npm test` / Expected: FAIL
- [ ] **Step 4: `weather.js` と `calendar.js` を実装する**
- [ ] **Step 5: 成功を確認する** — Run: `npm test` / Expected: PASS

- [ ] **Step 6: `relay/Code.gs` を書く**

`doGet(e)`: スクリプトプロパティ `TOKEN` と `e.parameter.token` が一致しなければ `{error:'unauthorized'}` を返す。一致すれば `CalendarApp.getDefaultCalendar().getEvents(now, now + 48時間)` を上の応答形式に直して `ContentService.createTextOutput(JSON.stringify(...)).setMimeType(ContentService.MimeType.JSON)` で返す。`id` は `event.getId()`、終日は `event.isAllDayEvent()`。予定の説明・参加者・場所は返さない。ファイル冒頭に、デプロイ手順（ウェブアプリ、実行ユーザー=自分、アクセス=全員、`TOKEN` は32文字以上の乱数）をコメントで書く。

- [ ] **Step 7: Commit** — `feat: weather and calendar services, calendar relay script`

---

### Task 5: 表示用の文字列

**Files:**
- Create: `src/ui/format.js`
- Test: `tests/format.test.js`

**Interfaces:**
- Produces（すべて `Asia/Tokyo` で整形。`Intl.DateTimeFormat` に `timeZone` を明示する）:
  - `formatClock(ms) -> '14:05'`
  - `formatDate(ms) -> '11月12日（木）'`
  - `formatRemaining(ms) -> '24:59'`（秒は切り上げ、0未満は `'00:00'`、60分以上は `'90:00'` のように分を伸ばす）
  - `formatEventTime(event, nowMs) -> '10:00'` / 明日なら `'明日 10:00'` / 終日なら `'終日'`
  - `formatUpdated(ms|null) -> '14:05 更新'` / null なら `'未取得'`
  - `phaseLabel(phase) -> '作業' | '休憩' | '長休憩'`

- [ ] **Step 1: 失敗するテストを書く** — 上の例をそのまま assert する。`formatRemaining(1499001) === '25:00'`、`formatRemaining(1000) === '00:01'`、`formatRemaining(0) === '00:00'`、UTC 15:00 が `formatDate` で翌日になることを含める。
- [ ] **Step 2: 失敗を確認する** — Run: `npm test` / Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 成功を確認する** — Run: `npm test` / Expected: PASS
- [ ] **Step 5: Commit** — `feat: display formatting helpers`

---

### Task 6: 画面と組み立て

**Files:**
- Create: `index.html`, `styles.css`, `src/ui/views.js`, `src/ui/notify.js`, `src/ui/dim.js`, `src/app.js`, `tools/screenshot.py`
- Test: `tests/notify.test.js`（許可状態のロジックのみ）、画面はスクリーンショットで目視

**Interfaces:**
- Consumes: Task 1〜5 の全関数（各タスクの Interfaces を参照）
- Produces:
  - `renderHome(root, { nowMs, weather: Result, calendar: Result, timer: snapshot })`
  - `renderTimer(root, { timer: snapshot })`
  - `renderSettings(root, { settings, errors })`
  - `createNotifier({ audioContextFactory, flash }) -> { unlock(), isUnlocked(), notify(kind: 'work_end'|'break_end'|'event') }`
    - `notify` は常に `flash(kind)` を呼ぶ。音は `isUnlocked()` のときだけ鳴らす。
  - `createDimmer({ now, afterMs, onChange }) -> { touch(), tick() }`（`afterMs` 無操作で `onChange(true)`、`touch()` で `onChange(false)`）
  - URL のクエリ `?demo=1` のとき、`app.js` は取得を行わず固定のサンプルデータと固定時刻で描画する（スクリーンショット用）。

画面の決定事項:
- ホーム: 左に大きな時刻と日付、右に天気カード（現在の気温とアイコン、今後6時間、明日）、下に予定カード（最大2件）とタイマーの小カード（フェーズと残り時間、タップでタイマー画面へ）。各カードの隅に `formatUpdated` を小さく表示し、`error: true` なら「更新できません」を添える。
- タイマー: 中央に残り時間（画面高の約30%の文字）、フェーズ名、`completedWork` を丸4つで表示。ボタンは「開始／一時停止」「リセット」「スキップ」「戻る」。タッチ領域は 64px 以上。
- 背景色はフェーズで変える（作業=濃い赤系、休憩=濃い緑系、待機=濃いグレー）。通知時は1.5秒の明滅。
- 音が未許可の間、画面下部に「タップして通知音を有効にする」を表示。最初のタッチで `unlock()` を呼び、表示を消す。
- 設定: 歯車ボタンから開く。保存時に `saveSettings` のエラーを各入力欄の下に出す。中継URLの入力欄は `type="password"`。
- 緯度経度が未設定なら天気カードに「設定で場所を入力してください」、中継URLが空なら予定カードに「設定でカレンダーを接続してください」。
- 主ループ（1秒ごと）: `timer.tick()` の結果で `stale` でない遷移があれば通知（作業終了=`work_end`、休憩終了=`break_end`）。`dueNotifications` の結果を通知して `saveNotified`。30分ごとと起動時に天気・予定を `refresh()`。`navigator.wakeLock` があれば要求する（失敗は無視）。
- 減光は `body.dim` クラスで黒の半透明オーバーレイを重ねる。タイマー走行中は減光しない。

- [ ] **Step 1: `tests/notify.test.js` を書く**

```js
test('unlock 前は音を鳴らさず flash だけ呼ぶ', () => {});
test('unlock 後は音と flash の両方', () => {});
test('audioContextFactory が throw しても notify は例外を出さず flash を呼ぶ', () => {});
test('dimmer: afterMs 経過で true、touch で false、連続して同じ値は通知しない', () => {});
```

- [ ] **Step 2: 失敗を確認する** — Run: `npm test` / Expected: FAIL
- [ ] **Step 3: `notify.js` と `dim.js` を実装し、テストを通す** — Run: `npm test` / Expected: PASS
- [ ] **Step 4: `index.html`、`styles.css`、`views.js`、`app.js` を実装する**

- [ ] **Step 5: `tools/screenshot.py` を書いて画面を出力する**

`python3 -m http.server` をサブプロセスで起動し、Playwright（`channel="chrome"`）で `/?demo=1`（ホーム）、`/?demo=1#timer`、`/?demo=1#settings` を 1280×800 と 800×1280 で開き、`out/home-1280x800.png` など6枚を保存する。ブラウザのコンソールエラーがあれば標準出力に出して終了コード1。

Run: `python3 tools/screenshot.py` / Expected: 6枚のPNGが `out/` にでき、コンソールエラーなしで終了コード0

- [ ] **Step 6: PNGを目視で確認する**

確認点: 文字の重なり・はみ出しがない、時刻とタイマーが離れても読める大きさ、ボタンが64px以上、縦置きでも崩れない。問題があれば直して Step 5 をやり直す。

- [ ] **Step 7: 全テストを通す** — Run: `npm test` / Expected: PASS
- [ ] **Step 8: Commit** — `feat: dashboard screens and app wiring`

---

### Task 7: 公開と実機セットアップの手順書

**Files:**
- Create: `docs/device-setup.md`, `README.md`

**Interfaces:**
- Consumes: `relay/Code.gs`、公開URL

- [ ] **Step 1: `README.md` を書く** — 目的、`npm test`、`python3 tools/screenshot.py`、`?demo=1` の説明、公開方法（GitHub Pages、リポジトリに秘密情報が入らない理由）。

- [ ] **Step 2: `docs/device-setup.md` を書く**

章立てと、各章の合格条件:
1. **軽量化（実施済みの記録）**: Fire OS 8.3.3.8、Fire Toolbox で不要アプリ停止、Custom Launcher（Launcher Hijack 方式、Nova）。ユーザー補助のサービスでオンにした項目。更新後に設定が戻ったときの再実行手順。
2. **カレンダー中継のデプロイ**: `relay/Code.gs` を Apps Script に貼る → `TOKEN` を設定 → ウェブアプリとしてデプロイ → PCのブラウザで `…/exec?token=…` を開く。合格: 予定のJSONが出る。トークンを変えると `{"error":"unauthorized"}` になる。
3. **Webアプリの公開**: GitHub Pages を有効化。合格: PCのブラウザで公開URLが開き、設定画面で緯度経度と中継URLを入れると天気と予定が出る。**ここで、ブラウザから中継を読めるか（クロスオリジン）を確かめる。** 読めない場合の対処（予定カードは「更新できません」表示のまま他は動く。対処は別途相談）を書く。
4. **キオスク表示**: 候補アプリの要件は、(a) 指定URLを全画面で開く、(b) 端末の起動時に自動で開く、(c) 画面を消さない、(d) 音の自動再生を許可できる。OSSの候補を先に試し、要件を満たさなければ Fully Kiosk Browser を使う。選んだアプリ名と設定値を記録する欄を設ける。
5. **電源**: 常時給電の注意と、スマートプラグ等での間欠充電の設定例。採用した方式を記録する欄。
6. **実機確認チェックリスト**: 起動時の自動表示／タイマー25分→休憩で音と色が変わる（確認用に作業1分へ設定変更）／予定10分前の通知／Wi-Fiを切ってもタイマーが動き、天気が前回値と更新時刻で表示される／再起動後にタイマーの残り時間が復元される／5分無操作で減光し、タッチで戻る／24時間連続表示で固まらない。

- [ ] **Step 3: Commit** — `docs: device setup and verification checklist`

---

## Self-Review 結果

- **Spec coverage:** §3 の機能（ポモドーロ=T1,T6／時計・日付=T5,T6／天気=T3,T4,T6／カレンダー表示と通知=T2,T4,T6／通知音と色=T6／カード型ホームとタイマー画面=T6／減光=T6）、§6 エラー処理（T3,T4,T6）、§7 運用（T7）、§9 フェーズ1の検証（各タスクのテスト、T6 のスクリーンショット）、フェーズ2（T7 のチェックリスト）。フェーズ0は実機で進行中のため計画外。
- **未確定事項の扱い:** クロスオリジンで中継を読めるかは T7 の3章で実機確認する。キオスク表示アプリと充電方式は T7 で要件と記録欄を定め、選定は実機で行う。
- **Type consistency:** `CalEvent`、`Result`、`snapshot` の形はタスク間で一致。`dueNotifications` の `leadMs` は `settings.notifyLeadMin * 60000` を `app.js` で渡す。
