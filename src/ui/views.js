// 画面の描画。値が変わった所だけ DOM を触る（1秒ごとに呼ばれるため）。
// 予定の題名など外から来た文字列は textContent でだけ入れる。
import {
  formatClock, formatDate, formatRemaining, formatEventTime, formatUpdated, formatHour, phaseLabel,
  formatWeekHead, formatRain,
} from './format.js';
import { weatherLabel, nextHours, rainNotice } from '../services/weather.js';
import { upcomingEvents } from '../core/schedule.js';
import { barSegments, isBarLow } from '../core/bar.js';
import { weekDays, eventsByDay, jstDayStart } from '../core/week.js';
import { remindersOn } from '../core/reminders.js';

const BAR_COUNT = 20;
const WEEK_MAX_ROWS = 6;
const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

const byId = (root, id) => root.getElementById(id);

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function setHidden(el, hidden) {
  if (el.hidden !== hidden) el.hidden = hidden;
}

function setAttr(el, name, value) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

// key が変わったときだけ子要素を作り直す
function setChildren(el, key, build) {
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.replaceChildren(...build());
}

function make(root, tag, className, text) {
  const el = root.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function statusLine(result) {
  return formatUpdated(result.updatedAt) + (result.error ? '（更新できません）' : '');
}

function weatherMessage(settings, weather) {
  if (settings.latitude === null) return '設定で場所を入力してください';
  if (!weather.data) return weather.error ? '天気を取得できません。Wi-Fiを確認してください' : '天気を取得しています';
  return '';
}

function calendarMessage(settings, calendar) {
  if (!settings.relayUrl) return '設定でカレンダーを接続してください';
  if (!calendar.data) return calendar.error ? '予定を取得できません。Wi-Fiと中継URLを確認してください' : '予定を取得しています';
  return '';
}

// ---------- バー ----------
export function renderBar(el, { remainingMs, totalMs, status }) {
  if (el.children.length !== BAR_COUNT) {
    el.replaceChildren(...Array.from({ length: BAR_COUNT }, () => make(el.ownerDocument, 'i')));
  }
  const segments = barSegments(remainingMs, totalMs, BAR_COUNT);
  segments.forEach((value, i) => {
    const opacity = value >= 1 ? '1' : value <= 0 ? '0' : value.toFixed(3);
    if (el.children[i].style.opacity !== opacity) el.children[i].style.opacity = opacity;
  });
  setAttr(el, 'data-low', String(isBarLow(remainingMs, totalMs)));
  setAttr(el, 'data-paused', String(status === 'paused'));
}

// ---------- ホーム ----------
export function renderHome(root, state) {
  const { nowMs, timer, totalMs, weather, calendar, settings, battery } = state;
  setText(byId(root, 'home-date'), formatDate(nowMs));
  setText(byId(root, 'home-clock'), formatClock(nowMs));

  // 今の天気と雨の予告
  const message = weatherMessage(settings, weather);
  setText(byId(root, 'hw-message'), message);
  setHidden(byId(root, 'hw-body'), message !== '');
  const rain = byId(root, 'home-rain');
  if (message === '') {
    const now = weatherLabel(weather.data.current.code);
    setText(byId(root, 'hw-icon'), now.icon);
    setText(byId(root, 'hw-temp'), `${Math.round(weather.data.current.tempC)}°`);
    setText(byId(root, 'hw-text'), now.text);
    const notice = rainNotice(weather.data, nowMs);
    setHidden(rain, notice === null);
    if (notice) setText(rain, `☔ ${formatRain(notice)}`);
  } else {
    setHidden(rain, true);
  }

  // 電池
  const batteryEl = byId(root, 'home-battery');
  setHidden(batteryEl, !battery);
  if (battery) setText(batteryEl, `${battery.charging ? '⚡' : '🔋'} ${battery.level}%`);

  // バー
  const label = phaseLabel(timer.phase);
  setText(byId(root, 'bar-phase'),
    timer.status === 'running' ? label : timer.status === 'paused' ? `${label}（一時停止中）` : `${label}を始める`);
  setText(byId(root, 'bar-time'), formatRemaining(timer.remainingMs));
  renderBar(byId(root, 'home-bar'), { remainingMs: timer.remainingMs, totalMs, status: timer.status });

  // 次の予定
  const list = byId(root, 'c-events');
  const calMessage = calendarMessage(settings, calendar);
  if (calMessage !== '') {
    setChildren(list, 'none', () => []);
    setText(byId(root, 'c-status'), '');
    setText(byId(root, 'c-message'), calMessage);
    return;
  }
  const events = upcomingEvents(calendar.data, nowMs, 2);
  const rows = events.map((e) => [formatEventTime(e, nowMs), e.title]);
  setChildren(list, JSON.stringify(rows), () => rows.map(([time, title]) => {
    const li = make(root, 'li');
    li.append(make(root, 'span', 'e-time', time), make(root, 'span', 'e-title', title));
    return li;
  }));
  setText(byId(root, 'c-message'), events.length === 0 ? 'このあと7日間の予定はありません' : '');
  setText(byId(root, 'c-status'), statusLine(calendar));
}

// ---------- 週間 ----------
// 1日分の行: [種類, 時刻の表示, 題名]
function dayRows(bucket, reminders, day) {
  const rows = bucket.allDay.map((e) => ({ kind: 'allday', sort: -1, time: '', title: e.title }));
  for (const e of bucket.timed) {
    const continued = e.startMs < day.startMs;
    rows.push({
      kind: 'timed', sort: continued ? 0 : e.startMs - day.startMs,
      time: continued ? `〜${formatClock(e.endMs)}` : formatClock(e.startMs), title: e.title,
    });
  }
  for (const r of remindersOn(reminders, day.startMs)) {
    const [h, m] = r.time.split(':').map(Number);
    rows.push({ kind: 'reminder', sort: (h * 60 + m) * 60000 + 1, time: `🔁 ${r.time}`, title: r.title });
  }
  return rows.sort((a, b) => a.sort - b.sort);
}

export function renderWeek(root, { nowMs, calendar, reminders, settings }) {
  const message = calendarMessage(settings, calendar);
  setText(byId(root, 'week-message'), message);
  setText(byId(root, 'week-status'), calendar.data ? statusLine(calendar) : '');

  const days = weekDays(nowMs);
  const buckets = eventsByDay(calendar.data ?? [], days);
  const today = jstDayStart(nowMs);
  const model = days.map((day, i) => {
    const rows = dayRows(buckets[i], reminders, day);
    return {
      head: formatWeekHead(day.startMs),
      label: `${WEEKDAY_NAMES[new Date(day.startMs + 9 * 3600e3).getUTCDay()]}曜日`,
      today: day.startMs === today,
      rows: rows.slice(0, rows.length > WEEK_MAX_ROWS ? WEEK_MAX_ROWS - 1 : WEEK_MAX_ROWS),
      more: rows.length > WEEK_MAX_ROWS ? rows.length - (WEEK_MAX_ROWS - 1) : 0,
    };
  });

  setChildren(byId(root, 'week-days'), JSON.stringify(model), () => model.map((day) => {
    const li = make(root, 'li');
    li.dataset.today = String(day.today);
    li.setAttribute('aria-label', day.label);
    const items = make(root, 'ul', 'wd-items');
    for (const row of day.rows) {
      const item = make(root, 'li', `wd-${row.kind}`);
      if (row.time) item.append(make(root, 'span', 'wd-time', row.time));
      item.append(row.title);
      items.append(item);
    }
    if (day.more > 0) items.append(make(root, 'li', 'wd-more', `ほか ${day.more} 件`));
    li.append(make(root, 'p', 'wd-head', day.head), items);
    return li;
  }));
}

// ---------- 24時間の天気 ----------
export function renderWeather(root, { nowMs, weather, settings }) {
  const message = weatherMessage(settings, weather);
  setText(byId(root, 'w-message'), message);
  setHidden(byId(root, 'w-body'), message !== '');
  setText(byId(root, 'w-status'), message === '' ? statusLine(weather) : '');
  if (message !== '') return;

  const now = weatherLabel(weather.data.current.code);
  setText(byId(root, 'w-icon'), now.icon);
  setText(byId(root, 'w-temp'), `${Math.round(weather.data.current.tempC)}°`);
  setText(byId(root, 'w-text'), now.text);

  const hours = nextHours(weather.data, nowMs, 24);
  setChildren(byId(root, 'w-hours'), `${weather.updatedAt}:${hours.map((h) => h.timeMs).join()}`, () =>
    hours.map((h) => {
      const li = make(root, 'li');
      if (jstDayStart(h.timeMs) === h.timeMs) li.append(make(root, 'span', 'h-day', '明日'));
      li.append(
        make(root, 'span', 'h-time', formatHour(h.timeMs)),
        make(root, 'span', 'h-icon', weatherLabel(h.code).icon),
        make(root, 'span', 'h-temp', `${Math.round(h.tempC)}°`),
        make(root, 'span', 'h-pop', h.pop === null ? '' : `${Math.round(h.pop)}%`),
      );
      const bar = make(root, 'span', 'h-popbar');
      bar.style.height = `${h.pop === null ? 0 : Math.max(0, Math.min(100, h.pop)) * 0.35}%`;
      li.append(bar);
      return li;
    }));
}

// ---------- タイマー ----------
export function renderTimer(root, { timer, cycles, totalMs }) {
  const label = phaseLabel(timer.phase);
  setText(byId(root, 't-phase'), timer.status === 'paused' ? `${label}（一時停止中）` : label);
  setText(byId(root, 't-remaining'), formatRemaining(timer.remainingMs));
  setText(byId(root, 't-toggle'), timer.status === 'running' ? '一時停止' : timer.status === 'paused' ? '再開' : '開始');
  renderBar(byId(root, 'timer-bar'), { remainingMs: timer.remainingMs, totalMs, status: timer.status });

  const rounds = byId(root, 't-rounds');
  rounds.setAttribute('aria-label', `作業 ${cycles} 回のうち ${Math.min(timer.completedWork, cycles)} 回完了`);
  setChildren(rounds, `${cycles}:${timer.completedWork}`, () =>
    Array.from({ length: cycles }, (_, i) => {
      const li = make(root, 'li');
      if (i < timer.completedWork) li.className = 'done';
      return li;
    }));
}

// ---------- タブ ----------
export function renderTabs(root, screen) {
  for (const tab of root.querySelectorAll('#tabs [data-tab]')) {
    if (tab.dataset.tab === screen) setAttr(tab, 'aria-current', 'page');
    else if (tab.hasAttribute('aria-current')) tab.removeAttribute('aria-current');
  }
}

// ---------- 設定 ----------
const TEXT_FIELDS = [
  'latitude', 'longitude', 'relayUrl', 'notifyLeadMin', 'workMin', 'shortBreakMin', 'longBreakMin',
  'cyclesBeforeLong', 'dimAfterMin', 'nightStart', 'nightEnd', 'plugLow', 'plugHigh',
];
const CHECK_FIELDS = ['nightEnabled', 'plugEnabled'];

// values: 入力欄に入れる値（保存済みの設定、または検証に失敗した入力そのまま）
export function renderSettings(root, { values, errors = {} }) {
  const form = byId(root, 'settings-form');
  for (const name of TEXT_FIELDS) {
    const v = values[name];
    form.elements[name].value = v === null || v === undefined ? '' : String(v);
    setText(form.querySelector(`[data-error="${name}"]`), errors[name] ?? '');
  }
  for (const name of CHECK_FIELDS) {
    form.elements[name].checked = values[name] === true || values[name] === 'on';
  }
}

export function readSettingsForm(root) {
  const form = byId(root, 'settings-form');
  const values = Object.fromEntries(TEXT_FIELDS.map((name) => [name, form.elements[name].value]));
  for (const name of CHECK_FIELDS) values[name] = form.elements[name].checked ? 'on' : '';
  return values;
}

export function renderPowerStatus(root, text) {
  setText(byId(root, 'power-status'), text);
}

export function renderReminderList(root, reminders) {
  const list = byId(root, 'rem-list');
  setChildren(list, JSON.stringify(reminders), () => {
    if (reminders.length === 0) return [make(root, 'li', 'rem-empty', 'まだ登録されていません')];
    return reminders.map((r) => {
      const li = make(root, 'li');
      const days = r.weekdays.map((d) => WEEKDAY_NAMES[d]).join('・');
      li.append(make(root, 'span', 'rem-text', `${r.time}　${r.title}（${days}）`));
      const remove = make(root, 'button', '', '削除');
      remove.type = 'button';
      remove.dataset.id = r.id;
      remove.setAttribute('aria-label', `${r.title}を削除`);
      li.append(remove);
      return li;
    });
  });
}

export function renderReminderErrors(root, errors = {}) {
  for (const name of ['title', 'weekdays', 'time']) {
    setText(root.querySelector(`[data-rem-error="${name}"]`), errors[name] ?? '');
  }
}

export function readReminderForm(root) {
  const form = byId(root, 'rem-form');
  return {
    title: form.elements.title.value,
    weekdays: [...form.querySelectorAll('[name=weekday]:checked')].map((el) => Number(el.value)),
    time: form.elements.time.value,
  };
}

export function resetReminderForm(root) {
  const form = byId(root, 'rem-form');
  form.elements.title.value = '';
  for (const el of form.querySelectorAll('[name=weekday]')) el.checked = false;
  form.elements.time.value = '08:00';
}
