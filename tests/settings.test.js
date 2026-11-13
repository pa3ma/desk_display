import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, loadSettings, saveSettings, toDurations } from '../src/core/settings.js';
import { fakeStorage } from './helpers.js';

test('DEFAULTS は仕様の既定値', () => {
  assert.deepEqual(DEFAULTS, {
    latitude: null, longitude: null, relayUrl: '', workMin: 25, shortBreakMin: 5,
    longBreakMin: 15, cyclesBeforeLong: 4, notifyLeadMin: 10, dimAfterMin: 5,
    nightEnabled: true, nightStart: '22:00', nightEnd: '07:00',
    plugEnabled: false, plugLow: 35, plugHigh: 80,
  });
});

test('loadSettings: 保存なし・壊れたJSONは既定値', () => {
  assert.deepEqual(loadSettings(fakeStorage()), DEFAULTS);
  assert.deepEqual(loadSettings(fakeStorage({ 'desk.settings': '{oops' })), DEFAULTS);
});

test('loadSettings: 欠けた項目と不正な値だけ既定値で補う', () => {
  const storage = fakeStorage({ 'desk.settings': JSON.stringify({ workMin: 50, shortBreakMin: -3, latitude: 35.68, longitude: 139.76 }) });
  assert.deepEqual(loadSettings(storage), { ...DEFAULTS, workMin: 50, latitude: 35.68, longitude: 139.76 });
});

test('loadSettings: 緯度だけ保存されていたら場所は未設定に戻す', () => {
  const storage = fakeStorage({ 'desk.settings': JSON.stringify({ latitude: 35.68 }) });
  assert.deepEqual(loadSettings(storage), DEFAULTS);
});

test('saveSettings: 範囲外の緯度はエラーになり保存しない', () => {
  const storage = fakeStorage();
  const r = saveSettings(storage, { ...DEFAULTS, latitude: 91, longitude: 139 });
  assert.equal(r.ok, false); assert.ok(r.errors.latitude);
  assert.equal(storage.getItem('desk.settings'), null);
});

test('saveSettings: 文字列の数値は数に直して保存する', () => {
  const storage = fakeStorage();
  const r = saveSettings(storage, {
    latitude: '35.68', longitude: '139.76', relayUrl: '  ', workMin: '30', shortBreakMin: '5',
    longBreakMin: '15', cyclesBeforeLong: '4', notifyLeadMin: '10', dimAfterMin: '5',
    nightEnabled: true, nightStart: '22:00', nightEnd: '07:00', plugEnabled: false, plugLow: '35', plugHigh: '80',
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.settings, { ...DEFAULTS, latitude: 35.68, longitude: 139.76, workMin: 30 });
  assert.deepEqual(loadSettings(storage), r.settings);
});

test('saveSettings: 緯度経度は両方空なら未設定として保存できる', () => {
  const r = saveSettings(fakeStorage(), { ...DEFAULTS, latitude: '', longitude: '' });
  assert.equal(r.ok, true);
  assert.equal(r.settings.latitude, null);
});

test('saveSettings: 緯度だけ入力はエラー', () => {
  const r = saveSettings(fakeStorage(), { ...DEFAULTS, latitude: '35', longitude: '' });
  assert.equal(r.ok, false); assert.ok(r.errors.longitude);
});

test('saveSettings: 分数は1〜180の整数、回数は1〜10', () => {
  const r = saveSettings(fakeStorage(), { ...DEFAULTS, workMin: '0', shortBreakMin: '2.5', longBreakMin: '181', cyclesBeforeLong: '11', notifyLeadMin: 'abc' });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['cyclesBeforeLong', 'longBreakMin', 'notifyLeadMin', 'shortBreakMin', 'workMin']);
});

test('saveSettings: script.google.com 以外の中継URLは拒否', () => {
  assert.ok(saveSettings(fakeStorage(), { ...DEFAULTS, relayUrl: 'https://evil.example/exec' }).errors.relayUrl);
  assert.ok(saveSettings(fakeStorage(), { ...DEFAULTS, relayUrl: 'http://script.google.com/x' }).errors.relayUrl);
  assert.equal(saveSettings(fakeStorage(), { ...DEFAULTS, relayUrl: ' https://script.google.com/macros/s/abc/exec?token=t ' }).settings.relayUrl,
    'https://script.google.com/macros/s/abc/exec?token=t');
});

test('toDurations: 分をミリ秒に直す', () => {
  assert.deepEqual(toDurations(DEFAULTS), { workMs: 1500000, shortBreakMs: 300000, longBreakMs: 900000, cyclesBeforeLong: 4 });
});

test('saveSettings: プラグの下限は20〜50、上限は60〜90、夜間の時刻は HH:MM', () => {
  const r = saveSettings(fakeStorage(), { ...DEFAULTS, plugLow: '19', plugHigh: '95', nightStart: '25:00', nightEnd: '7:00' });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['nightEnd', 'nightStart', 'plugHigh', 'plugLow']);
  assert.equal(saveSettings(fakeStorage(), { ...DEFAULTS, plugLow: '20', plugHigh: '90', nightStart: '00:00', nightEnd: '23:59' }).ok, true);
});

test('saveSettings: チェックボックスの値を真偽値に直す', () => {
  const on = saveSettings(fakeStorage(), { ...DEFAULTS, nightEnabled: 'on', plugEnabled: true }).settings;
  assert.equal(on.nightEnabled, true); assert.equal(on.plugEnabled, true);
  const off = saveSettings(fakeStorage(), { ...DEFAULTS, nightEnabled: undefined, plugEnabled: false }).settings;
  assert.equal(off.nightEnabled, false); assert.equal(off.plugEnabled, false);
});

test('loadSettings: v1 形式の保存データは新しい項目を既定値で補う', () => {
  const v1 = { latitude: 35.68, longitude: 139.76, relayUrl: '', workMin: 30, shortBreakMin: 5, longBreakMin: 15, cyclesBeforeLong: 4, notifyLeadMin: 10, dimAfterMin: 5 };
  assert.deepEqual(loadSettings(fakeStorage({ 'desk.settings': JSON.stringify(v1) })), { ...DEFAULTS, ...v1 });
});

test('loadSettings: 保存済みの false は false のまま読む', () => {
  const storage = fakeStorage();
  saveSettings(storage, { ...DEFAULTS, nightEnabled: false, plugEnabled: true });
  const s = loadSettings(storage);
  assert.equal(s.nightEnabled, false); assert.equal(s.plugEnabled, true);
});
