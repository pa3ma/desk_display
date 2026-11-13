import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jstDayStart, weekDays, eventsByDay } from '../src/core/week.js';

const at = (iso) => Date.parse(iso);
const D = 86400000;
const DAY0 = at('2026-11-12T00:00:00+09:00');
const ev = (id, start, end, allDay = false) => ({ id, title: id, startMs: at(start), endMs: at(end), allDay });
const ids = (list) => list.map((e) => e.id);

test('jstDayStart: 日本時間の0時に切り下げる', () => {
  assert.equal(jstDayStart(at('2026-11-12T23:59:59+09:00')), DAY0);
  assert.equal(jstDayStart(DAY0), DAY0);
  assert.equal(jstDayStart(at('2026-11-12T15:00:00Z')), DAY0 + D);
  assert.equal(jstDayStart(at('2026-11-12T14:59:59Z')), DAY0);
});

test('weekDays: 今日から7日が連続する', () => {
  const days = weekDays(at('2026-11-12T14:05:00+09:00'));
  assert.equal(days.length, 7);
  assert.equal(days[0].startMs, DAY0);
  days.forEach((d, i) => {
    assert.equal(d.endMs - d.startMs, D);
    if (i > 0) assert.equal(d.startMs, days[i - 1].endMs);
  });
});

test('eventsByDay: 時刻付きの予定は当日にだけ入る', () => {
  const days = weekDays(DAY0);
  const r = eventsByDay([ev('a', '2026-11-12T10:00:00+09:00', '2026-11-12T11:00:00+09:00')], days);
  assert.equal(r.length, 7);
  assert.deepEqual(ids(r[0].timed), ['a']);
  assert.deepEqual(r.slice(1).flatMap((d) => [...d.timed, ...d.allDay]), []);
});

test('eventsByDay: 0時ちょうどに終わる予定と終日予定は翌日に出ない', () => {
  const days = weekDays(DAY0);
  const r = eventsByDay([
    ev('late', '2026-11-12T23:00:00+09:00', '2026-11-13T00:00:00+09:00'),
    ev('holiday', '2026-11-12T00:00:00+09:00', '2026-11-13T00:00:00+09:00', true),
  ], days);
  assert.deepEqual(ids(r[0].timed), ['late']);
  assert.deepEqual(ids(r[0].allDay), ['holiday']);
  assert.deepEqual([...r[1].timed, ...r[1].allDay], []);
});

test('eventsByDay: 複数日にまたがる予定は各日に入る', () => {
  const days = weekDays(DAY0);
  const r = eventsByDay([
    ev('night', '2026-11-12T22:00:00+09:00', '2026-11-13T02:00:00+09:00'),
    ev('trip', '2026-11-14T00:00:00+09:00', '2026-11-17T00:00:00+09:00', true),
  ], days);
  assert.deepEqual(ids(r[0].timed), ['night']);
  assert.deepEqual(ids(r[1].timed), ['night']);
  assert.deepEqual([2, 3, 4].map((i) => ids(r[i].allDay)), [['trip'], ['trip'], ['trip']]);
  assert.deepEqual(ids(r[5].allDay), []);
});

test('eventsByDay: 範囲外の予定は入らない。時刻付きは開始順。入力を変更しない', () => {
  const days = weekDays(DAY0);
  const input = [
    ev('b', '2026-11-12T15:00:00+09:00', '2026-11-12T16:00:00+09:00'),
    ev('far', '2026-11-20T10:00:00+09:00', '2026-11-20T11:00:00+09:00'),
    ev('a', '2026-11-12T09:00:00+09:00', '2026-11-12T10:00:00+09:00'),
    ev('past', '2026-11-11T09:00:00+09:00', '2026-11-11T10:00:00+09:00'),
  ];
  const before = JSON.stringify(input);
  const r = eventsByDay(input, days);
  assert.deepEqual(ids(r[0].timed), ['a', 'b']);
  assert.equal(r.flatMap((d) => d.timed).some((e) => e.id === 'far' || e.id === 'past'), false);
  assert.equal(JSON.stringify(input), before);
});
