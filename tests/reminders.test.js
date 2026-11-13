import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReminder, loadReminders, saveReminders, remindersOn, reminderTimeMs, reminderKey, dueReminders } from '../src/core/reminders.js';
import { loadNotified, saveNotified } from '../src/core/schedule.js';
import { fakeStorage } from './helpers.js';

const at = (iso) => Date.parse(iso);
const THU = at('2026-11-12T00:00:00+09:00'); // 木曜
const rem = (id, weekdays, time, title = id) => ({ id, title, weekdays, time });

test('validateReminder: 正常系。曜日は重複を除いて昇順、題名は前後の空白を除く', () => {
  const r = validateReminder({ title: '  ゴミ出し ', weekdays: [4, 2, 4], time: '08:00' });
  assert.equal(r.ok, true);
  assert.equal(r.reminder.title, 'ゴミ出し');
  assert.deepEqual(r.reminder.weekdays, [2, 4]);
  assert.equal(r.reminder.time, '08:00');
  assert.ok(typeof r.reminder.id === 'string' && r.reminder.id.length > 0);
  assert.equal(validateReminder({ id: 'keep', title: 'a', weekdays: ['1'], time: '23:59' }).reminder.id, 'keep');
  assert.deepEqual(validateReminder({ title: 'a', weekdays: ['1', '3'], time: '00:00' }).reminder.weekdays, [1, 3]);
});

test('validateReminder: 題名・曜日・時刻の誤りを項目ごとに返す', () => {
  assert.ok(validateReminder({ title: '   ', weekdays: [1], time: '08:00' }).errors.title);
  assert.ok(validateReminder({ title: 'あ'.repeat(31), weekdays: [1], time: '08:00' }).errors.title);
  assert.equal(validateReminder({ title: 'あ'.repeat(30), weekdays: [1], time: '08:00' }).ok, true);
  assert.ok(validateReminder({ title: 'a', weekdays: [], time: '08:00' }).errors.weekdays);
  assert.ok(validateReminder({ title: 'a', weekdays: [7], time: '08:00' }).errors.weekdays);
  for (const time of ['24:00', '7:5', 'ab:cd', '', '12:60']) {
    assert.ok(validateReminder({ title: 'a', weekdays: [1], time }).errors.time, time);
  }
});

test('dueReminders: 指定時刻から10分以内だけ対象', () => {
  const r = rem('g', [4], '08:00');
  const due = (iso) => dueReminders([r], at(iso), new Set()).length;
  assert.equal(due('2026-11-12T07:59:59+09:00'), 0);
  assert.equal(due('2026-11-12T08:00:00+09:00'), 1);
  assert.equal(due('2026-11-12T08:09:59+09:00'), 1);
  assert.equal(due('2026-11-12T08:10:00+09:00'), 0);
});

test('dueReminders: 曜日が違う日は鳴らない', () => {
  assert.equal(dueReminders([rem('f', [5], '08:00')], at('2026-11-12T08:00:00+09:00'), new Set()).length, 0);
  assert.equal(dueReminders([rem('f', [5], '08:00')], at('2026-11-13T08:00:00+09:00'), new Set()).length, 1);
});

test('dueReminders: 通知済みは返さない。翌週はキーが変わるので返る。再読み込みしても繰り返さない', () => {
  const r = rem('g', [4], '08:00');
  const now = at('2026-11-12T08:01:00+09:00');
  const storage = fakeStorage();
  const notified = new Set([reminderKey(r, THU)]);
  assert.equal(dueReminders([r], now, notified).length, 0);
  saveNotified(storage, notified);
  assert.equal(dueReminders([r], now + 60000, loadNotified(storage, now + 60000)).length, 0);
  assert.equal(dueReminders([r], now + 7 * 86400000, notified).length, 1);
  assert.notEqual(reminderKey(r, THU), reminderKey(r, THU + 7 * 86400000));
});

test('reminderTimeMs / remindersOn: その日の曜日のものを時刻順に', () => {
  assert.equal(reminderTimeMs(rem('a', [4], '08:30'), THU), at('2026-11-12T08:30:00+09:00'));
  const list = [rem('late', [4], '20:00'), rem('other', [1], '07:00'), rem('early', [4, 5], '06:30')];
  assert.deepEqual(remindersOn(list, THU).map((r) => r.id), ['early', 'late']);
  assert.deepEqual(remindersOn(list, THU + 86400000).map((r) => r.id), ['early']);
});

test('loadReminders: 保存なし・壊れたJSON・配列でない場合は空。壊れた要素だけ捨てる', () => {
  assert.deepEqual(loadReminders(fakeStorage()), []);
  assert.deepEqual(loadReminders(fakeStorage({ 'desk.reminders': '{oops' })), []);
  assert.deepEqual(loadReminders(fakeStorage({ 'desk.reminders': '{"a":1}' })), []);
  const mixed = JSON.stringify([rem('ok', [1], '08:00'), { id: 'bad', title: '', weekdays: [1], time: '08:00' }, null, rem('ok2', [0, 6], '21:15')]);
  assert.deepEqual(loadReminders(fakeStorage({ 'desk.reminders': mixed })).map((r) => r.id), ['ok', 'ok2']);
});

test('saveReminders: 20件まで保存でき、21件は保存しない', () => {
  const storage = fakeStorage();
  const make = (n) => Array.from({ length: n }, (_, i) => rem(`r${i}`, [1], '08:00'));
  assert.equal(saveReminders(storage, make(20)).ok, true);
  assert.equal(loadReminders(storage).length, 20);
  assert.equal(saveReminders(storage, make(21)).ok, false);
  assert.equal(loadReminders(storage).length, 20);
});
