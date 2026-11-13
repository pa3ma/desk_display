// 週間カレンダー用の日付計算。日本時間（UTC+9、夏時間なし）で日を区切る。
const JST_OFFSET_MS = 9 * 3600e3;
const DAY_MS = 86400e3;

export function jstDayStart(ms) {
  return Math.floor((ms + JST_OFFSET_MS) / DAY_MS) * DAY_MS - JST_OFFSET_MS;
}

// 日本時間の曜日（0=日〜6=土）
export function jstWeekday(ms) {
  return new Date(ms + JST_OFFSET_MS).getUTCDay();
}

export function weekDays(nowMs, count = 7) {
  const first = jstDayStart(nowMs);
  return Array.from({ length: count }, (_, i) => ({ startMs: first + i * DAY_MS, endMs: first + (i + 1) * DAY_MS }));
}

// 各日にかかる予定を振り分ける。終了時刻ちょうどの日には入れない。
export function eventsByDay(events, days) {
  return days.map((day) => {
    const hits = events.filter((e) => e.startMs < day.endMs && e.endMs > day.startMs);
    return {
      allDay: hits.filter((e) => e.allDay).sort((a, b) => a.title.localeCompare(b.title, 'ja')),
      timed: hits.filter((e) => !e.allDay).sort((a, b) => a.startMs - b.startMs),
    };
  });
}
