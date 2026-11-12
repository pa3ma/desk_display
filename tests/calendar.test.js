import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRelay, loadCalendar } from '../src/services/calendar.js';

const sample = () => [
  { id: 'e1', title: '定例会議', start: '2026-11-12T01:00:00.000Z', end: '2026-11-12T02:00:00.000Z', allDay: false },
  { id: 'e2', title: '休暇', start: '2026-11-12T15:00:00.000Z', end: '2026-11-13T15:00:00.000Z', allDay: true },
];

test('parseRelay: 正常な配列を CalEvent に直す', () => {
  assert.deepEqual(parseRelay(sample()), [
    { id: 'e1', title: '定例会議', startMs: Date.parse('2026-11-12T01:00:00.000Z'), endMs: Date.parse('2026-11-12T02:00:00.000Z'), allDay: false },
    { id: 'e2', title: '休暇', startMs: Date.parse('2026-11-12T15:00:00.000Z'), endMs: Date.parse('2026-11-13T15:00:00.000Z'), allDay: true },
  ]);
  assert.deepEqual(parseRelay([]), []);
});

test('parseRelay: {error:"unauthorized"} は throw', () => {
  assert.throws(() => parseRelay({ error: 'unauthorized' }));
});

test('parseRelay: 項目が欠けた要素や読めない日時は throw', () => {
  const noId = sample(); delete noId[0].id;
  assert.throws(() => parseRelay(noId));
  const badDate = sample(); badDate[0].start = 'あした';
  assert.throws(() => parseRelay(badDate));
  const badAllDay = sample(); badAllDay[0].allDay = 'no';
  assert.throws(() => parseRelay(badAllDay));
});

test('parseRelay: 題名が空の予定は「（無題）」にする', () => {
  const s = sample(); s[0].title = '';
  assert.equal(parseRelay(s)[0].title, '（無題）');
});

test('loadCalendar: HTMLが返ってきたら throw（Googleのログイン画面）', async () => {
  const fetchFn = async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  await assert.rejects(loadCalendar({ relayUrl: 'https://script.google.com/x' }, fetchFn));
});

test('loadCalendar: HTTPエラーは throw', async () => {
  const fetchFn = async () => ({ ok: false, status: 403, json: async () => sample() });
  await assert.rejects(loadCalendar({ relayUrl: 'https://script.google.com/x' }, fetchFn));
});

test('loadCalendar: relayUrl が空なら fetch せず throw', async () => {
  let called = false;
  await assert.rejects(loadCalendar({ relayUrl: '' }, async () => { called = true; }));
  assert.equal(called, false);
});

test('loadCalendar: 中継URLをそのまま取得して変換する', async () => {
  let asked;
  const fetchFn = async (url) => { asked = url; return { ok: true, json: async () => sample() }; };
  const events = await loadCalendar({ relayUrl: 'https://script.google.com/macros/s/a/exec?token=t' }, fetchFn);
  assert.equal(asked, 'https://script.google.com/macros/s/a/exec?token=t');
  assert.equal(events.length, 2);
});
