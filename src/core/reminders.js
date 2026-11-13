// 定期リマインダー（毎週○曜日の○時）。端末の localStorage にだけ保存する。
// Reminder = { id, title, weekdays: number[] (0=日〜6=土), time: 'HH:MM' }
import { jstDayStart, jstWeekday } from './week.js';

const KEY = 'desk.reminders';
export const MAX_REMINDERS = 20;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTimeText(value) {
  return typeof value === 'string' && TIME_RE.test(value);
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function validateReminder(input) {
  const errors = {};
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  const length = [...title].length;
  if (length < 1 || length > 30) errors.title = '題名は1〜30文字で入力してください';

  const raw = Array.isArray(input?.weekdays) ? input.weekdays.map(Number) : [];
  const weekdays = [...new Set(raw)].sort((a, b) => a - b);
  if (weekdays.length === 0 || weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    errors.weekdays = '曜日を1つ以上選んでください';
  }

  if (!isTimeText(input?.time)) errors.time = '時刻は 08:00 の形で入力してください';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const id = typeof input.id === 'string' && input.id !== '' ? input.id : newId();
  return { ok: true, reminder: { id, title, weekdays, time: input.time } };
}

export function loadReminders(storage) {
  let raw;
  try { raw = JSON.parse(storage.getItem(KEY)); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const list = [];
  for (const item of raw) {
    if (!item || typeof item.id !== 'string' || item.id === '') continue;
    const checked = validateReminder(item);
    if (checked.ok) list.push(checked.reminder);
  }
  return list.slice(0, MAX_REMINDERS);
}

export function saveReminders(storage, list) {
  if (list.length > MAX_REMINDERS) return { ok: false };
  try {
    storage.setItem(KEY, JSON.stringify(list));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function reminderTimeMs(reminder, dayStartMs) {
  const [h, m] = reminder.time.split(':').map(Number);
  return dayStartMs + (h * 60 + m) * 60000;
}

export function remindersOn(reminders, dayStartMs) {
  const weekday = jstWeekday(dayStartMs);
  return reminders.filter((r) => r.weekdays.includes(weekday)).sort((a, b) => a.time.localeCompare(b.time));
}

// 通知済みの記録に使うキー。末尾を「@数値」にして、v1 の古い記録の掃除がそのまま効くようにする
export function reminderKey(reminder, dayStartMs) {
  return `rem:${reminder.id}@${dayStartMs}`;
}

export function dueReminders(reminders, nowMs, notified, windowMs = 600000) {
  const day = jstDayStart(nowMs);
  return remindersOn(reminders, day).filter((r) => {
    const t = reminderTimeMs(r, day);
    return t <= nowMs && nowMs < t + windowMs && !notified.has(reminderKey(r, day));
  });
}
