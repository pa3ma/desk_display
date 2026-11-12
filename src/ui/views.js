// 画面の描画。値が変わった所だけ DOM を触る（1秒ごとに呼ばれるため）。
// 予定の題名など外から来た文字列は textContent でだけ入れる。
import { formatClock, formatDate, formatRemaining, formatEventTime, formatUpdated, formatHour, phaseLabel } from './format.js';
import { weatherLabel, nextHours } from '../services/weather.js';
import { upcomingEvents } from '../core/schedule.js';

const byId = (root, id) => root.getElementById(id);

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

// key が変わったときだけ子要素を作り直す
function setChildren(el, key, build) {
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.replaceChildren(...build());
}

function span(root, className, text) {
  const el = root.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

function statusLine(result) {
  return formatUpdated(result.updatedAt) + (result.error ? '（更新できません）' : '');
}

function renderWeather(root, { nowMs, weather, settings }) {
  const body = byId(root, 'w-body');
  const message = byId(root, 'w-message');
  const status = byId(root, 'w-status');
  const forecast = weather.data;

  if (settings.latitude === null || !forecast) {
    body.hidden = true;
    setText(status, '');
    setText(message,
      settings.latitude === null ? '設定で場所を入力してください'
        : weather.error ? '天気を取得できません。Wi-Fiを確認してください'
          : '天気を取得しています');
    return;
  }

  body.hidden = false;
  setText(message, '');
  setText(status, statusLine(weather));

  const now = weatherLabel(forecast.current.code);
  setText(byId(root, 'w-icon'), now.icon);
  setText(byId(root, 'w-temp'), `${Math.round(forecast.current.tempC)}°`);
  setText(byId(root, 'w-text'), now.text);

  const hours = nextHours(forecast, nowMs);
  setChildren(byId(root, 'w-hours'), `${weather.updatedAt}:${hours.map((h) => h.timeMs).join()}`, () =>
    hours.map((h) => {
      const li = root.createElement('li');
      li.append(
        span(root, 'h-time', formatHour(h.timeMs)),
        span(root, 'h-icon', weatherLabel(h.code).icon),
        span(root, 'h-temp', `${Math.round(h.tempC)}°`),
        span(root, 'h-pop', h.pop === null ? '' : `${Math.round(h.pop)}%`),
      );
      return li;
    }));

  const t = forecast.tomorrow;
  const tl = weatherLabel(t.code);
  setText(byId(root, 'w-tomorrow'), `明日は${tl.text} ${tl.icon}　最高 ${Math.round(t.maxC)}° / 最低 ${Math.round(t.minC)}°`);
}

function renderAgenda(root, { nowMs, calendar, settings }) {
  const list = byId(root, 'c-events');
  const message = byId(root, 'c-message');
  const status = byId(root, 'c-status');

  if (!settings.relayUrl || !calendar.data) {
    setChildren(list, 'none', () => []);
    setText(status, '');
    setText(message,
      !settings.relayUrl ? '設定でカレンダーを接続してください'
        : calendar.error ? '予定を取得できません。Wi-Fiと中継URLを確認してください'
          : '予定を取得しています');
    return;
  }

  const events = upcomingEvents(calendar.data, nowMs, 2);
  const rows = events.map((e) => [formatEventTime(e, nowMs), e.title]);
  setChildren(list, JSON.stringify(rows), () =>
    rows.map(([time, title]) => {
      const li = root.createElement('li');
      li.append(span(root, 'e-time', time), span(root, 'e-title', title));
      return li;
    }));
  setText(message, events.length === 0 ? 'このあと48時間の予定はありません' : '');
  setText(status, statusLine(calendar));
}

export function renderHome(root, state) {
  const { nowMs, timer, totalMs } = state;
  setText(byId(root, 'home-date'), formatDate(nowMs));
  setText(byId(root, 'home-clock'), formatClock(nowMs));
  renderWeather(root, state);
  renderAgenda(root, state);

  const label = phaseLabel(timer.phase);
  setText(byId(root, 'strip-phase'),
    timer.status === 'running' ? label : timer.status === 'paused' ? `${label}（一時停止中）` : `${label}を始める`);
  setText(byId(root, 'strip-time'), formatRemaining(timer.remainingMs));
  const done = totalMs > 0 ? Math.min(1, Math.max(0, 1 - timer.remainingMs / totalMs)) : 0;
  byId(root, 'strip-fill').style.width = `${(done * 100).toFixed(1)}%`;
}

export function renderTimer(root, { timer, cycles }) {
  const label = phaseLabel(timer.phase);
  setText(byId(root, 't-phase'), timer.status === 'paused' ? `${label}（一時停止中）` : label);
  setText(byId(root, 't-remaining'), formatRemaining(timer.remainingMs));
  setText(byId(root, 't-toggle'), timer.status === 'running' ? '一時停止' : timer.status === 'paused' ? '再開' : '開始');

  const rounds = byId(root, 't-rounds');
  rounds.setAttribute('aria-label', `作業 ${cycles} 回のうち ${Math.min(timer.completedWork, cycles)} 回完了`);
  setChildren(rounds, `${cycles}:${timer.completedWork}`, () =>
    Array.from({ length: cycles }, (_, i) => {
      const li = root.createElement('li');
      if (i < timer.completedWork) li.className = 'done';
      return li;
    }));
}

const FIELDS = ['latitude', 'longitude', 'relayUrl', 'notifyLeadMin', 'workMin', 'shortBreakMin', 'longBreakMin', 'cyclesBeforeLong', 'dimAfterMin'];

// values: 入力欄に入れる値（保存済みの設定、または検証に失敗した入力そのまま）
export function renderSettings(root, { values, errors = {} }) {
  const form = byId(root, 'settings-form');
  for (const name of FIELDS) {
    const v = values[name];
    form.elements[name].value = v === null || v === undefined ? '' : String(v);
    setText(form.querySelector(`[data-error="${name}"]`), errors[name] ?? '');
  }
}

export function readSettingsForm(root) {
  const form = byId(root, 'settings-form');
  return Object.fromEntries(FIELDS.map((name) => [name, form.elements[name].value]));
}
