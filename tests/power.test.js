import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plugDecision, loadPowerState, savePowerState, powerTrusted, STALE_MS, MAX_OFF_RESENDS } from '../src/core/power.js';
import { fakeStorage } from './helpers.js';

const NOW = 1_000_000_000;
const MIN = 60000;
const d = (over) => plugDecision({ level: 50, charging: null, low: 35, high: 80, last: null, nowMs: NOW, ...over });

test('下限以下で、まだ「入」を送っていなければ on', () => {
  assert.equal(d({ level: 35 }), 'on');
  assert.equal(d({ level: 10, last: { state: 'off', atMs: NOW - MIN } }), 'on');
});

test('「入」を送った直後は繰り返さない', () => {
  assert.equal(d({ level: 35, last: { state: 'on', atMs: NOW - MIN }, charging: false }), null);
});

test('「入」から5分たっても充電が始まらなければ送り直す', () => {
  assert.equal(d({ level: 30, last: { state: 'on', atMs: NOW - 6 * MIN }, charging: false }), 'on');
  assert.equal(d({ level: 30, last: { state: 'on', atMs: NOW - 6 * MIN }, charging: true }), null);
  assert.equal(d({ level: 30, last: { state: 'on', atMs: NOW - 6 * MIN }, charging: null }), null);
});

test('上限以上で、まだ「切」を送っていなければ off', () => {
  assert.equal(d({ level: 80, last: { state: 'on', atMs: NOW - MIN } }), 'off');
  assert.equal(d({ level: 100 }), 'off');
});

test('「切」から5分たっても充電が続いていれば送り直す', () => {
  assert.equal(d({ level: 85, last: { state: 'off', atMs: NOW - MIN }, charging: true }), null);
  assert.equal(d({ level: 85, last: { state: 'off', atMs: NOW - 6 * MIN }, charging: true }), 'off');
  assert.equal(d({ level: 85, last: { state: 'off', atMs: NOW - 6 * MIN }, charging: false }), null);
});

test('下限と上限の間では何もしない。残量が不明なら何もしない', () => {
  assert.equal(d({ level: 36 }), null);
  assert.equal(d({ level: 79, last: { state: 'on', atMs: NOW - 60 * MIN }, charging: true }), null);
  assert.equal(d({ level: null }), null);
  assert.equal(d({ level: NaN }), null);
});

test('loadPowerState / savePowerState: 往復し、壊れたデータは null', () => {
  const storage = fakeStorage();
  assert.equal(loadPowerState(storage), null);
  savePowerState(storage, { state: 'on', atMs: 5 });
  assert.deepEqual(loadPowerState(storage), { state: 'on', atMs: 5 });
  assert.equal(loadPowerState(fakeStorage({ 'desk.power': '{"state":"maybe","atMs":1}' })), null);
  assert.equal(loadPowerState(fakeStorage({ 'desk.power': 'x' })), null);
});

test('powerTrusted: 切った後に電池の値が60分変わらなければ信用しない', () => {
  const t = (over) => powerTrusted({ nowMs: NOW, lastBatteryEventMs: NOW, last: { state: 'off', atMs: NOW }, offResends: 0, ...over });
  assert.equal(STALE_MS, 60 * MIN);
  assert.equal(t({ lastBatteryEventMs: NOW - 60 * MIN }), true);
  assert.equal(t({ lastBatteryEventMs: NOW - 60 * MIN - 1 }), false);
});

test('powerTrusted: 入れている間は、値が変わらなくても信用する（満充電で止まることがあるため）', () => {
  assert.equal(powerTrusted({ nowMs: NOW, lastBatteryEventMs: NOW - 5 * 60 * MIN, last: { state: 'on', atMs: NOW }, offResends: 0 }), true);
  assert.equal(powerTrusted({ nowMs: NOW, lastBatteryEventMs: NOW - 5 * 60 * MIN, last: null, offResends: 0 }), true);
});

test('powerTrusted: 切る指示を送り直しても充電中のままなら、2回で信用しない', () => {
  assert.equal(MAX_OFF_RESENDS, 2);
  const t = (n) => powerTrusted({ nowMs: NOW, lastBatteryEventMs: NOW, last: { state: 'off', atMs: NOW }, offResends: n });
  assert.equal(t(1), true);
  assert.equal(t(2), false);
});
