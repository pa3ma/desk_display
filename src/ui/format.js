// 表示用の文字列。端末のタイムゾーン設定に関係なく日本時間で整形する。
const TZ = 'Asia/Tokyo';
const JST_OFFSET_MS = 9 * 3600e3;
const DAY_MS = 86400e3;

const clockFmt = new Intl.DateTimeFormat('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const partsFmt = new Intl.DateTimeFormat('ja-JP', { timeZone: TZ, month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', hourCycle: 'h23' });

function parts(ms) {
  const out = {};
  for (const p of partsFmt.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}
const pad2 = (n) => String(n).padStart(2, '0');
const jstDay = (ms) => Math.floor((ms + JST_OFFSET_MS) / DAY_MS);

export function formatClock(ms) {
  const p = {};
  for (const part of clockFmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  return `${pad2(Number(p.hour))}:${pad2(Number(p.minute))}`;
}

export function formatDate(ms) {
  const p = parts(ms);
  return `${p.month}月${p.day}日（${p.weekday}）`;
}

export function formatHour(ms) {
  return `${Number(parts(ms).hour)}時`;
}

export function formatRemaining(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  return `${pad2(Math.floor(totalSec / 60))}:${pad2(totalSec % 60)}`;
}

export function formatEventTime(event, nowMs) {
  const diff = jstDay(event.startMs) - jstDay(nowMs);
  const time = event.allDay ? '終日' : formatClock(event.startMs);
  if (diff <= 0) return time;
  if (diff === 1) return `明日 ${time}`;
  const p = parts(event.startMs);
  return `${p.month}/${p.day} ${time}`;
}

export function formatUpdated(ms) {
  return ms === null || ms === undefined ? '未取得' : `${formatClock(ms)} 更新`;
}

export function phaseLabel(phase) {
  return phase === 'work' ? '作業' : phase === 'short_break' ? '休憩' : '長休憩';
}
