// 夜間の判定（日本時間）。start・end は 'HH:MM'。
import { isTimeText } from './reminders.js';

const JST_OFFSET_MS = 9 * 3600e3;
const toMinutes = (text) => { const [h, m] = text.split(':').map(Number); return h * 60 + m; };

export function isNight(nowMs, start, end) {
  if (!isTimeText(start) || !isTimeText(end)) return false;
  const s = toMinutes(start), e = toMinutes(end);
  if (s === e) return false;
  const d = new Date(nowMs + JST_OFFSET_MS);
  const now = d.getUTCHours() * 60 + d.getUTCMinutes();
  return s < e ? now >= s && now < e : now >= s || now < e; // s > e は日付をまたぐ
}
