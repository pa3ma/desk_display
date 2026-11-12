// 組み立てと主ループ。ロジックは core/ と services/ にあり、ここは配線だけ。
import { createTimer } from './core/timer.js';
import { loadSettings, saveSettings, toDurations } from './core/settings.js';
import { dueNotifications, notifiedKey, loadNotified, saveNotified } from './core/schedule.js';
import { createCachedSource } from './services/cache.js';
import { loadWeather } from './services/weather.js';
import { loadCalendar } from './services/calendar.js';
import { createNotifier } from './ui/notify.js';
import { createDimmer } from './ui/dim.js';
import { renderHome, renderTimer, renderSettings, readSettingsForm } from './ui/views.js';
import { formatEventTime } from './ui/format.js';

const REFRESH_MS = 30 * 60000;
const FLASH_MS = 1600;
const TOAST_MS = 60000;
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
    timeMs: base + i * H, tempC: 16 - Math.abs(14 - (i % 24)) * 0.6, code: codes[i % codes.length], pop: (i * 7) % 90,
  }));
  return {
    settings: { ...loadSettings(memoryStorage()), latitude: 35.68, longitude: 139.76, relayUrl: 'https://script.google.com/demo' },
    timerState: { phase: 'work', status: 'running', endsAt: DEMO_NOW + 18 * 60000 + 42000, remainingMs: 0, completedWork: 2 },
    weather: { data: { current: { tempC: 16.4, code: 2 }, hours, tomorrow: { code: 63, maxC: 13.1, minC: 9.9 } }, updatedAt: DEMO_NOW - 5 * 60000, error: false },
    calendar: {
      data: [
        { id: 'd1', title: '設計レビュー', startMs: DEMO_NOW + 25 * 60000, endMs: DEMO_NOW + 85 * 60000, allDay: false },
        { id: 'd2', title: '部品の受け取り（長い題名は末尾を省略して表示します）', startMs: base + 34 * H, endMs: base + 35 * H, allDay: false },
      ],
      updatedAt: DEMO_NOW - 5 * 60000, error: false,
    },
  };
}

const demoState = demo ? demoData() : null;
const now = demo ? () => DEMO_NOW : () => Date.now();
const storage = demo ? memoryStorage({ 'desk.timer': JSON.stringify(demoState.timerState) }) : deviceStorage();

let settings = demo ? demoState.settings : loadSettings(storage);
const timer = createTimer({ now, durations: toDurations(settings), storage });

const weatherSource = demo
  ? { refresh: async () => demoState.weather, current: () => demoState.weather }
  : createCachedSource({ key: 'desk.cache.weather', load: () => loadWeather(settings), storage, now });
const calendarSource = demo
  ? { refresh: async () => demoState.calendar, current: () => demoState.calendar }
  : createCachedSource({ key: 'desk.cache.calendar', load: () => loadCalendar(settings), storage, now });

const notified = loadNotified(storage, now());

// ---- 通知 ----
let flashTimeout = 0;
function flash(kind) {
  document.body.dataset.flash = kind;
  clearTimeout(flashTimeout);
  flashTimeout = setTimeout(() => { delete document.body.dataset.flash; }, FLASH_MS);
}
const notifier = createNotifier({
  audioContextFactory: () => new (window.AudioContext || window.webkitAudioContext)(),
  flash,
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
function updateSoundHint() { soundHint.hidden = notifier.isUnlocked(); }

// ---- 減光 ----
const dimmer = createDimmer({
  now,
  afterMs: settings.dimAfterMin * 60000,
  onChange: (dimmed) => document.body.classList.toggle('dim', dimmed),
});

document.addEventListener('pointerdown', () => {
  dimmer.touch();
  if (!notifier.isUnlocked()) { notifier.unlock(); updateSoundHint(); }
  requestWakeLock();
}, true);

// ---- 画面を消さない（対応ブラウザのみ。失敗しても無視） ----
let wakeLock = null;
async function requestWakeLock() {
  if (wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { requestWakeLock(); frame(); refreshIfDue(); }
});

// ---- 画面の切り替え（#home / #timer / #settings） ----
function currentScreen() {
  const name = location.hash.replace('#', '');
  return name === 'timer' || name === 'settings' ? name : 'home';
}
function applyScreen() {
  const screen = currentScreen();
  document.body.dataset.screen = screen;
  if (screen === 'settings') renderSettings(document, { values: settings });
  frame();
}
window.addEventListener('hashchange', applyScreen);

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
  dimmer.setAfter(settings.dimAfterMin * 60000);
  location.hash = '#home';
  refreshAll();
});

// ---- データの更新 ----
let lastRefresh = 0;
async function refreshAll() {
  lastRefresh = now();
  await Promise.all([weatherSource.refresh(), calendarSource.refresh()]);
  frame();
}
function refreshIfDue() {
  if (now() - lastRefresh >= REFRESH_MS) refreshAll();
}
window.addEventListener('online', refreshAll);

// ---- 1秒ごとの処理 ----
function phaseTotalMs(phase) {
  const d = toDurations(settings);
  return phase === 'work' ? d.workMs : phase === 'short_break' ? d.shortBreakMs : d.longBreakMs;
}

function frame() {
  const nowMs = now();

  for (const change of timer.tick()) {
    if (!change.stale) notifier.notify(change.from === 'work' ? 'work_end' : 'break_end');
  }

  const calendar = calendarSource.current();
  const due = dueNotifications(calendar.data ?? [], nowMs, settings.notifyLeadMin * 60000, notified);
  if (due.length > 0) {
    for (const e of due) notified.add(notifiedKey(e));
    saveNotified(storage, notified);
    notifier.notify('event');
    showToast(`まもなく ${formatEventTime(due[0], nowMs)} ${due[0].title}`);
  }

  const snap = timer.snapshot();
  document.body.dataset.phase = snap.status === 'idle' ? 'idle' : snap.phase;
  dimmer.hold(snap.status === 'running');
  dimmer.tick();

  const screen = document.body.dataset.screen;
  if (screen === 'home') {
    renderHome(document, { nowMs, weather: weatherSource.current(), calendar, timer: snap, totalMs: phaseTotalMs(snap.phase), settings });
  } else if (screen === 'timer') {
    renderTimer(document, { timer: snap, cycles: settings.cyclesBeforeLong });
  }
}

updateSoundHint();
applyScreen();
if (!demo) {
  refreshAll();
  setInterval(() => { frame(); refreshIfDue(); }, 1000);
}
