import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, formatDate, formatRemaining, formatEventTime, formatUpdated, formatHour, phaseLabel } from '../src/ui/format.js';

const at = (iso) => Date.parse(iso);

test('formatClock: 日本時間の24時間表記', () => {
  assert.equal(formatClock(at('2026-11-12T14:05:00+09:00')), '14:05');
  assert.equal(formatClock(at('2026-11-12T00:07:00+09:00')), '00:07');
  assert.equal(formatClock(at('2026-11-12T05:05:00Z')), '14:05');
});

test('formatDate: 月日と曜日。UTCで前日でも日本時間の日付', () => {
  assert.equal(formatDate(at('2026-11-12T09:00:00+09:00')), '11月12日（木）');
  assert.equal(formatDate(at('2026-11-12T15:00:00Z')), '11月13日（金）');
});

test('formatRemaining: 秒は切り上げ、分は60を超えても伸ばす', () => {
  assert.equal(formatRemaining(1500000), '25:00');
  assert.equal(formatRemaining(1499001), '25:00');
  assert.equal(formatRemaining(1499000), '24:59');
  assert.equal(formatRemaining(1000), '00:01');
  assert.equal(formatRemaining(1), '00:01');
  assert.equal(formatRemaining(0), '00:00');
  assert.equal(formatRemaining(-500), '00:00');
  assert.equal(formatRemaining(90 * 60000), '90:00');
});

test('formatEventTime: 今日は時刻、明日は「明日」付き、それ以外は日付付き', () => {
  const now = at('2026-11-12T23:30:00+09:00');
  const ev = (start, allDay = false) => ({ id: 'a', title: 't', startMs: at(start), endMs: at(start) + 3600e3, allDay });
  assert.equal(formatEventTime(ev('2026-11-12T23:45:00+09:00'), now), '23:45');
  assert.equal(formatEventTime(ev('2026-11-13T00:15:00+09:00'), now), '明日 00:15');
  assert.equal(formatEventTime(ev('2026-11-14T10:00:00+09:00'), now), '11/14 10:00');
  assert.equal(formatEventTime(ev('2026-11-12T09:00:00+09:00'), now), '09:00');
});

test('formatEventTime: 終日予定は「終日」、明日の終日は「明日 終日」', () => {
  const now = at('2026-11-12T10:00:00+09:00');
  const allDay = (start) => ({ id: 'a', title: 't', startMs: at(start), endMs: at(start) + 86400e3, allDay: true });
  assert.equal(formatEventTime(allDay('2026-11-12T00:00:00+09:00'), now), '終日');
  assert.equal(formatEventTime(allDay('2026-11-13T00:00:00+09:00'), now), '明日 終日');
});

test('formatUpdated / formatHour / phaseLabel', () => {
  assert.equal(formatUpdated(at('2026-11-12T14:05:00+09:00')), '14:05 更新');
  assert.equal(formatUpdated(null), '未取得');
  assert.equal(formatHour(at('2026-11-12T15:00:00+09:00')), '15時');
  assert.equal(formatHour(at('2026-11-13T00:00:00+09:00')), '0時');
  assert.equal(phaseLabel('work'), '作業');
  assert.equal(phaseLabel('short_break'), '休憩');
  assert.equal(phaseLabel('long_break'), '長休憩');
});
