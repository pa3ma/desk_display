// 予定の絞り込みと通知判定。CalEvent = { id, title, startMs, endMs, allDay }
const KEY = 'desk.notified';
const KEEP_MS = 24 * 3600e3;

export function upcomingEvents(events, nowMs, limit = 2) {
  return events
    .filter((e) => e.endMs > nowMs)
    .sort((a, b) => (a.allDay - b.allDay) || (a.startMs - b.startMs))
    .slice(0, limit);
}

export function notifiedKey(event) {
  return `${event.id}@${event.startMs}`;
}

export function dueNotifications(events, nowMs, leadMs, notified) {
  return events.filter(
    (e) => !e.allDay && e.startMs - leadMs <= nowMs && nowMs < e.startMs && !notified.has(notifiedKey(e)),
  );
}

export function loadNotified(storage, nowMs) {
  try {
    const raw = JSON.parse(storage.getItem(KEY));
    if (!Array.isArray(raw)) return new Set();
    return new Set(
      raw.filter((key) => {
        if (typeof key !== 'string') return false;
        const startMs = Number(key.slice(key.lastIndexOf('@') + 1));
        return Number.isFinite(startMs) && nowMs - startMs <= KEEP_MS;
      }),
    );
  } catch {
    return new Set();
  }
}

export function saveNotified(storage, set) {
  try { storage.setItem(KEY, JSON.stringify([...set])); } catch { /* 保存できなくても続行 */ }
}
