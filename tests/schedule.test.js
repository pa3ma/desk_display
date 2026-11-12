import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upcomingEvents, dueNotifications, notifiedKey, loadNotified, saveNotified } from '../src/core/schedule.js';
import { fakeStorage } from './helpers.js';

const H = 3600e3;
const ev = (id, startMs, endMs, allDay = false) => ({ id, title: id, startMs, endMs, allDay });

test('upcomingEvents: 終了済みを除き、開始時刻順に limit 件', () => {
  const events = [ev('far', 5 * H, 6 * H), ev('done', 0, 1 * H), ev('next', 3 * H, 4 * H), ev('ongoing', 1 * H, 3 * H)];
  assert.deepEqual(upcomingEvents(events, 2 * H).map((e) => e.id), ['ongoing', 'next']);
  assert.deepEqual(upcomingEvents(events, 2 * H, 3).map((e) => e.id), ['ongoing', 'next', 'far']);
});

test('upcomingEvents: ちょうど終了時刻の予定は除く', () => {
  assert.deepEqual(upcomingEvents([ev('a', 0, 1 * H)], 1 * H), []);
});

test('upcomingEvents: 終日予定は当日中は残り、時刻付きの後ろに並ぶ', () => {
  const events = [ev('allday', 0, 24 * H, true), ev('timed', 10 * H, 11 * H)];
  assert.deepEqual(upcomingEvents(events, 9 * H).map((e) => e.id), ['timed', 'allday']);
  assert.deepEqual(upcomingEvents(events, 12 * H).map((e) => e.id), ['allday']);
  assert.deepEqual(upcomingEvents(events, 24 * H), []);
});

test('dueNotifications: 開始10分前から開始までの間だけ返す', () => {
  const e = { id: 'a', title: '会議', startMs: 600000, endMs: 900000, allDay: false };
  assert.deepEqual(dueNotifications([e], -1, 600000, new Set()), []);
  assert.deepEqual(dueNotifications([e], 0, 600000, new Set()), [e]);
  assert.deepEqual(dueNotifications([e], 599999, 600000, new Set()), [e]);
  assert.deepEqual(dueNotifications([e], 600000, 600000, new Set()), []);
});

test('dueNotifications: 通知済みと終日予定は返さない', () => {
  const timed = ev('a', 600000, 900000);
  const allDay = ev('b', 600000, 600000 + 24 * H, true);
  assert.deepEqual(dueNotifications([timed, allDay], 300000, 600000, new Set([notifiedKey(timed)])), []);
  assert.deepEqual(dueNotifications([timed, allDay], 300000, 600000, new Set()), [timed]);
});

test('同じ id でも開始時刻が変われば別の通知になる', () => {
  assert.notEqual(notifiedKey({ id: 'a', startMs: 1 }), notifiedKey({ id: 'a', startMs: 2 }));
});

test('saveNotified → loadNotified で往復し、開始から24時間を過ぎたキーは捨てる', () => {
  const storage = fakeStorage();
  const old = ev('old', 0, H), recent = ev('x@y', 30 * H, 31 * H);
  saveNotified(storage, new Set([notifiedKey(old), notifiedKey(recent)]));
  assert.deepEqual([...loadNotified(storage, 10 * H)].sort(), [notifiedKey(old), notifiedKey(recent)].sort());
  assert.deepEqual([...loadNotified(storage, 24 * H + 1)], [notifiedKey(recent)]);
});

test('loadNotified: 壊れたデータは空集合', () => {
  assert.equal(loadNotified(fakeStorage({ 'desk.notified': '{oops' }), 0).size, 0);
  assert.equal(loadNotified(fakeStorage({ 'desk.notified': '{"a":1}' }), 0).size, 0);
  assert.equal(loadNotified(fakeStorage(), 0).size, 0);
});
