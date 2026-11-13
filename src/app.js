// 組み立てと主ループ。ロジックは core/ と services/ にあり、ここは配線だけ。
import { createTimer } from './core/timer.js';
import { loadSettings, saveSettings, toDurations } from './core/settings.js';
import { dueNotifications, notifiedKey, loadNotified, saveNotified } from './core/schedule.js';
import { validateReminder, loadReminders, saveReminders, dueReminders, reminderKey, MAX_REMINDERS } from './core/reminders.js';
import { jstDayStart } from './core/week.js';
import { isNight } from './core/night.js';
import { plugDecision, loadPowerState, savePowerState, powerTrusted } from './core/power.js';
import { createCachedSource } from './services/cache.js';
import { loadWeather } from './services/weather.js';
import { loadCalendar } from './services/calendar.js';
import { sendPlug, sendHeartbeat } from './services/plug.js';
import { nextRefreshDelay, withTimeout } from './services/refresh.js';
import { createNotifier } from './ui/notify.js';
import { createDimmer } from './ui/dim.js';
import {
  renderHome, renderWeek, renderWeather, renderTimer, renderTabs, renderSettings, readSettingsForm,
  renderPowerStatus, renderReminderList, renderReminderErrors, readReminderForm, resetReminderForm,
} from './ui/views.js';
import { formatEventTime, formatClock } from './ui/format.js';

const FETCH_TIMEOUT_MS = 20000;
const FLASH_MS = 1600;
const TOAST_MS = 60000;
const RETURN_HOME_MS = 2 * 60000;
const NIGHT_DIM_MS = 30000;
const POWER_CHECK_MS = 60000;
const HEARTBEAT_MS = 10 * 60000;
const BATTERY_WAIT_MS = 10000;
const POWER_BUSY_LIMIT_MS = 90000;
const SCREENS = ['home', 'week', 'weather', 'settings', 'timer'];
const demo = new URLSearchParams(location.search).has('demo');

function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}

// localStorage が使えない環境でも止まらないようにする
function deviceStorage() {
  try {
    localStorage.setItem('desk.probe', '1');
    localStorage.removeItem('desk.probe');
    return localStorage;
  } catch {
    return memoryStorage();
  }
}

// ---- デモ表示（?demo=1）: 通信せず、固定の時刻とサンプルで描く。画面確認用 ----
const DEMO_NOW = Date.parse('2026-11-12T14:05:00+09:00');
function demoData() {
  const H = 3600e3;
  const base = Date.parse('2026-11-12T00:00:00+09:00');
  const codes = [2, 2, 3, 61, 61, 3];
  const hours = Array.from({ length: 48 }, (_, i) => ({
    timeMs: base + i * H, tempC: 16 - Math.abs(14 - (i % 24)) * 0.6, code: codes[i % codes.length], pop: (i * 13) % 90,
  }));
  const ev = (id, title, startH, lengthH, allDay = false) => ({ id, title, startMs: base + startH * H, endMs: base + (startH + lengthH) * H, allDay });
  const reminders = [
    { id: 'r1', title: '燃えるゴミ', weekdays: [2, 5], time: '08:00' },
    { id: 'r2', title: '植物の水やり', weekdays: [0, 3, 6], time: '19:30' },
  ];
  return {
    settings: { ...loadSettings(memoryStorage()), latitude: 35.68, longitude: 139.76, relayUrl: 'https://script.google.com/demo', plugEnabled: true },
    timerState: { phase: 'work', status: 'running', endsAt: DEMO_NOW + 18 * 60000 + 42000, remainingMs: 0, completedWork: 2 },
    reminders,
    battery: { level: 62, charging: true },
    weather: { data: { current: { tempC: 16.4, code: 2 }, hours, tomorrow: { code: 63, maxC: 13.1, minC: 9.9 } }, updatedAt: DEMO_NOW - 5 * 60000, error: false },
    calendar: {
      data: [
        ev('d1', '設計レビュー', 14.5, 1),
        ev('d2', '部品の受け取り（長い題名は末尾を省略して表示します）', 34, 1),
        ev('d3', '歯医者', 63, 1),
        ev('d4', '出張', 96, 48, true),
        ev('d5', '定例会議', 106, 1),
        ev('d6', '夜間メンテナンス', 140, 5),
        ev('d7', '週次の振り返り', 155, 1),
      ],
      updatedAt: DEMO_NOW - 5 * 60000, error: false,
    },
  };
}

const demoState = demo ? demoData() : null;
const now = demo ? () => DEMO_NOW : () => Date.now();
const storage = demo
  ? memoryStorage({ 'desk.timer': JSON.stringify(demoState.timerState), 'desk.reminders': JSON.stringify(demoState.reminders) })
  : deviceStorage();

let settings = demo ? demoState.settings : loadSettings(storage);
let reminders = loadReminders(storage);
const timer = createTimer({ now, durations: toDurations(settings), storage });

const timedFetch = withTimeout((url, options) => fetch(url, options), FETCH_TIMEOUT_MS);

const weatherSource = demo
  ? { refresh: async () => demoState.weather, current: () => demoState.weather }
  : createCachedSource({
    key: 'desk.cache.weather', storage, now,
    load: () => loadWeather(settings, timedFetch),
    validate: (d) => Boolean(d && d.current && Array.isArray(d.hours) && d.tomorrow),
  });
const calendarSource = demo
  ? { refresh: async () => demoState.calendar, current: () => demoState.calendar }
  : createCachedSource({
    key: 'desk.cache.calendar', storage, now,
    load: () => loadCalendar(settings, timedFetch),
    validate: Array.isArray,
  });

let notified = loadNotified(storage, now());

// ---- 通知 ----
let flashTimeout = 0;
function flash(kind) {
  dimmer.touch(); // 暗くなっていたら明るさを戻してから知らせる
  document.body.dataset.flash = kind;
  clearTimeout(flashTimeout);
  flashTimeout = setTimeout(() => { delete document.body.dataset.flash; }, FLASH_MS);
}
const notifier = createNotifier({
  audioContextFactory: () => new (window.AudioContext || window.webkitAudioContext)(),
  flash,
  onStateChange: () => updateSoundHint(),
});

const toast = document.getElementById('toast');
let toastTimeout = 0;
function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.hidden = true; }, TOAST_MS);
}
toast.addEventListener('click', () => { toast.hidden = true; });

const soundHint = document.getElementById('sound-hint');
function updateSoundHint() { soundHint.hidden = demo || notifier.isUnlocked(); }

// ---- 減光と、操作がないときのホームへの復帰 ----
const dimmer = createDimmer({
  now,
  afterMs: settings.dimAfterMin * 60000,
  onChange: (dimmed) => document.body.classList.toggle('dim', dimmed),
});

let lastInteraction = now();
for (const type of ['pointerdown', 'keydown', 'input']) {
  document.addEventListener(type, () => { dimmer.touch(); lastInteraction = now(); }, true);
}
// 音の許可は「指を離した」操作でないと通らないブラウザがあるため click で行う。
// 実際に音が出せる状態になるまで、タッチのたびに試す。
document.addEventListener('click', () => {
  if (!notifier.isUnlocked()) { notifier.unlock(); updateSoundHint(); }
  requestWakeLock();
}, true);

// ---- 画面を消さない（対応ブラウザのみ。失敗しても無視） ----
let wakeLock = null;
let wakeLockPending = false;
async function requestWakeLock() {
  if (wakeLock || wakeLockPending || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  wakeLockPending = true;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { wakeLock = null; }
  wakeLockPending = false;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { requestWakeLock(); frame(); refreshDue(); }
});

// ---- 電池と充電の自動制御 ----
// 方針: 迷ったら「プラグを入れる」側に倒す。電池の値を信用できないときは自動制御をやめ、
// プラグを入れてから生存連絡も止める（中継の安全策が、入れたままにする）。
let battery = demo ? demoState.battery : null; // { level: 0〜100, charging }
let batteryUnavailable = false;
let lastBatteryEventMs = now();                 // 電池の値が最後に変わった時刻
let powerLast = loadPowerState(storage);        // 最後に成功した指示
let powerFailed = false;                        // 最後の指示が中継に届かなかった
let powerBusy = false;
let powerBusySince = 0;
let offResends = 0;                             // 「切」を送り直しても充電中のままだった回数
let powerSuspended = false;                     // 値を信用できないため自動制御を止めた
let suspendOnSent = false;                      // 止めたときの「入」が届いた
let nextPowerCheckAt = 0;
let nextHeartbeatAt = 0;

function startBattery() {
  if (demo) return;
  if (typeof navigator.getBattery !== 'function') { batteryUnavailable = true; return; }
  // 返事がないまま時間がたったら、読めないものとして扱う（後で値が届けば戻す）
  setTimeout(() => { if (battery === null) batteryUnavailable = true; }, BATTERY_WAIT_MS);
  navigator.getBattery().then((manager) => {
    const read = () => {
      const level = Number(manager.level);
      if (!Number.isFinite(level) || level < 0 || level > 1) {
        battery = null;
        batteryUnavailable = true;
        return;
      }
      const next = { level: Math.round(level * 100), charging: Boolean(manager.charging) };
      if (!battery || battery.level !== next.level || battery.charging !== next.charging) lastBatteryEventMs = now();
      if (next.charging === false) offResends = 0; // 切れて充電が止まった
      battery = next;
      batteryUnavailable = false;
      evaluatePower();
    };
    manager.addEventListener('levelchange', read);
    manager.addEventListener('chargingchange', read);
    read();
  }).catch(() => { batteryUnavailable = true; });
}

function powerActive() {
  return !demo && settings.plugEnabled && settings.relayUrl !== '' && battery !== null && !batteryUnavailable;
}

// 中継への指示。成功したら true
async function command(state) {
  if (powerBusy && now() - powerBusySince < POWER_BUSY_LIMIT_MS) return false;
  powerBusy = true;
  powerBusySince = now();
  let ok = false;
  try { ok = await sendPlug(settings, state, timedFetch); } catch { ok = false; }
  powerBusy = false;
  powerFailed = !ok;
  if (ok) {
    powerLast = { state, atMs: now() };
    savePowerState(storage, powerLast);
    nextHeartbeatAt = now() + HEARTBEAT_MS; // 指示も生存連絡を兼ねる
  }
  return ok;
}

async function evaluatePower() {
  nextPowerCheckAt = now() + POWER_CHECK_MS;
  if (!powerActive()) return;
  if (powerSuspended) {
    if (!suspendOnSent) suspendOnSent = await command('on');
    return;
  }
  if (!powerTrusted({ nowMs: now(), lastBatteryEventMs, last: powerLast, offResends })) {
    powerSuspended = true;
    suspendOnSent = await command('on');
    return;
  }
  const decision = plugDecision({
    level: battery.level, charging: battery.charging, low: settings.plugLow, high: settings.plugHigh,
    last: powerLast, nowMs: now(),
  });
  if (decision === null) return;
  const resend = powerLast !== null && powerLast.state === decision;
  if (await command(decision)) offResends = decision === 'off' && resend ? offResends + 1 : 0;
}

// 生存連絡は、画面が表示されていて、電池の値を信用できるときだけ送る。
// 画面が隠れて電池の値が止まっている間に生存連絡だけ続くと、中継の安全策が働かなくなるため。
async function powerTick() {
  if (!powerActive()) return;
  if (now() >= nextPowerCheckAt) evaluatePower();
  if (powerSuspended || document.visibilityState !== 'visible') return;
  if (!powerTrusted({ nowMs: now(), lastBatteryEventMs, last: powerLast, offResends })) return;
  if (now() >= nextHeartbeatAt) {
    nextHeartbeatAt = now() + HEARTBEAT_MS;
    sendHeartbeat(settings, timedFetch);
  }
}

function resumePower() {
  powerSuspended = false;
  suspendOnSent = false;
  offResends = 0;
  lastBatteryEventMs = now();
  nextPowerCheckAt = 0;
  nextHeartbeatAt = 0;
}

function powerStatusText() {
  if (batteryUnavailable) return 'この端末では電池の残量を読めないため、自動制御は行いません。プラグは入れたままにしてください。';
  const parts = [battery ? `残量 ${battery.level}%${battery.charging ? '（充電中）' : ''}` : '電池の状態を確認しています'];
  if (!settings.plugEnabled) parts.push('自動制御は無効です');
  else if (!settings.relayUrl) parts.push('Googleカレンダーの中継URLを入れると使えます');
  if (powerSuspended) {
    parts.push('電池の値が変わらないか、充電の状態と合わないため、自動制御を止めました（プラグは入れてあります）。'
      + 'ホームの残量がタブレット本体の表示と合っているか確かめてから「保存する」を押すと再開します');
  }
  if (powerLast) parts.push(`最後の指示: ${powerLast.state === 'on' ? '入' : '切'}（${formatClock(powerLast.atMs)}）`);
  if (powerFailed) parts.push('指示が中継に届いていません。中継の更新と SwitchBot の設定を確認してください');
  return parts.join('　');
}

// ---- 画面の切り替え（#home / #week / #weather / #settings / #timer） ----
function currentScreen() {
  const name = location.hash.replace('#', '');
  return SCREENS.includes(name) ? name : 'home';
}
function applyScreen() {
  const screen = currentScreen();
  document.body.dataset.screen = screen;
  lastInteraction = now();
  renderTabs(document, screen);
  if (screen === 'settings') {
    renderSettings(document, { values: settings });
    renderReminderList(document, reminders);
    renderReminderErrors(document);
  }
  frame();
}
window.addEventListener('hashchange', applyScreen);

function returnHomeIfIdle(screen, snap) {
  const leaves = screen === 'week' || screen === 'weather' || (screen === 'timer' && snap.status === 'idle');
  if (leaves && now() - lastInteraction >= RETURN_HOME_MS) location.hash = '#home';
}

// ---- 操作 ----
document.getElementById('t-toggle').addEventListener('click', () => {
  if (timer.snapshot().status === 'running') timer.pause(); else timer.start();
  frame();
});
document.getElementById('t-reset').addEventListener('click', () => { timer.reset(); frame(); });
document.getElementById('t-skip').addEventListener('click', () => { timer.skip(); frame(); });

document.getElementById('settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = readSettingsForm(document);
  const result = saveSettings(storage, input);
  if (!result.ok) { renderSettings(document, { values: input, errors: result.errors }); return; }
  settings = result.settings;
  timer.setDurations(toDurations(settings));
  resumePower();
  location.hash = '#home';
  refreshAll();
});

document.getElementById('rem-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const checked = validateReminder(readReminderForm(document));
  if (!checked.ok) { renderReminderErrors(document, checked.errors); return; }
  const next = [...reminders, checked.reminder];
  if (next.length > MAX_REMINDERS || !saveReminders(storage, next).ok) {
    renderReminderErrors(document, { title: `登録できるのは${MAX_REMINDERS}件までです` });
    return;
  }
  reminders = next;
  resetReminderForm(document);
  renderReminderErrors(document);
  renderReminderList(document, reminders);
});

document.getElementById('rem-list').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const next = reminders.filter((r) => r.id !== button.dataset.id);
  if (!saveReminders(storage, next).ok) return;
  reminders = next;
  renderReminderList(document, reminders);
});

// ---- データの更新 ----
// 成功したら30分後、失敗したら1分後から間隔を倍にしながら取り直す
const feeds = [weatherSource, calendarSource].map((source) => ({ source, failures: 0, nextAt: 0, busy: false, again: false }));
async function refreshFeed(feed) {
  if (feed.busy) { feed.again = true; return; }
  feed.busy = true;
  let failed = true;
  try { failed = (await feed.source.refresh()).error; } catch { /* refresh は失敗を値で返すが念のため */ }
  feed.busy = false;
  feed.failures = failed ? feed.failures + 1 : 0;
  feed.nextAt = now() + nextRefreshDelay(feed.failures);
  if (feed.again) { feed.again = false; refreshFeed(feed); }
  frame();
}
function refreshAll() {
  for (const feed of feeds) refreshFeed(feed);
}
function refreshDue() {
  for (const feed of feeds) if (!feed.busy && now() >= feed.nextAt) refreshFeed(feed);
}
window.addEventListener('online', refreshAll);

// ---- 1秒ごとの処理 ----
function phaseTotalMs(phase) {
  const d = toDurations(settings);
  return phase === 'work' ? d.workMs : phase === 'short_break' ? d.shortBreakMs : d.longBreakMs;
}

// 1つの処理が失敗しても、時計とタイマーを止めない
function guarded(step) {
  // 同期処理だけを包む。ここで出る例外に中継URLは含まれない（通信は別経路）
  try { step(); } catch (error) { console.error('[desk]', error); }
}

function remember(keys, nowMs) {
  for (const key of keys) notified.add(key);
  saveNotified(storage, notified);
  notified = loadNotified(storage, nowMs); // 古い記録を落とす
  for (const key of keys) notified.add(key);
}

function frame() {
  const nowMs = now();

  guarded(() => {
    for (const change of timer.tick()) {
      if (!change.stale) notifier.notify(change.from === 'work' ? 'work_end' : 'break_end');
    }
  });

  const calendar = calendarSource.current();
  guarded(() => {
    const due = dueNotifications(calendar.data ?? [], nowMs, settings.notifyLeadMin * 60000, notified);
    if (due.length === 0) return;
    remember(due.map(notifiedKey), nowMs);
    notifier.notify('event');
    showToast(`まもなく ${formatEventTime(due[0], nowMs)} ${due.map((e) => e.title).join('、')}`);
  });

  guarded(() => {
    const due = dueReminders(reminders, nowMs, notified);
    if (due.length === 0) return;
    const day = jstDayStart(nowMs);
    remember(due.map((r) => reminderKey(r, day)), nowMs);
    notifier.notify('event');
    showToast(`🔁 ${due[0].time} ${due.map((r) => r.title).join('、')}`);
  });

  const snap = timer.snapshot();
  guarded(() => {
    document.body.dataset.phase = snap.status === 'idle' ? 'idle' : snap.phase;
    const night = settings.nightEnabled && isNight(nowMs, settings.nightStart, settings.nightEnd);
    document.body.classList.toggle('night', night);
    dimmer.setAfter(night ? NIGHT_DIM_MS : settings.dimAfterMin * 60000);
    dimmer.hold(snap.status === 'running' || !toast.hidden);
    dimmer.tick();
  });

  const screen = document.body.dataset.screen;
  const totalMs = phaseTotalMs(snap.phase);
  if (screen === 'home') {
    guarded(() => renderHome(document, { nowMs, weather: weatherSource.current(), calendar, timer: snap, totalMs, settings, battery }));
  } else if (screen === 'week') {
    guarded(() => renderWeek(document, { nowMs, calendar, reminders, settings }));
  } else if (screen === 'weather') {
    guarded(() => renderWeather(document, { nowMs, weather: weatherSource.current(), settings }));
  } else if (screen === 'timer') {
    guarded(() => renderTimer(document, { timer: snap, cycles: settings.cyclesBeforeLong, totalMs }));
  } else if (screen === 'settings') {
    guarded(() => renderPowerStatus(document, powerStatusText()));
  }
  guarded(() => returnHomeIfIdle(screen, snap));
}

updateSoundHint();
if (!demo) {
  // 最初の描画より先に周期処理を始める（描画が失敗しても時計と再取得が動くように）
  setInterval(() => { frame(); refreshDue(); guarded(powerTick); }, 1000);
  refreshAll();
  requestWakeLock();
  startBattery();
}
applyScreen();
