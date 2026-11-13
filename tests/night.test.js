import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNight } from '../src/core/night.js';

const at = (hhmm, day = '2026-11-12') => Date.parse(`${day}T${hhmm}:00+09:00`);

test('isNight: 日付をまたぐ範囲（22:00〜07:00）', () => {
  assert.equal(isNight(at('21:59'), '22:00', '07:00'), false);
  assert.equal(isNight(at('22:00'), '22:00', '07:00'), true);
  assert.equal(isNight(at('23:59'), '22:00', '07:00'), true);
  assert.equal(isNight(at('00:00', '2026-11-13'), '22:00', '07:00'), true);
  assert.equal(isNight(at('06:59', '2026-11-13'), '22:00', '07:00'), true);
  assert.equal(isNight(at('07:00', '2026-11-13'), '22:00', '07:00'), false);
  assert.equal(isNight(at('12:00'), '22:00', '07:00'), false);
});

test('isNight: 同じ日の中の範囲（01:00〜05:00）', () => {
  assert.equal(isNight(at('00:59'), '01:00', '05:00'), false);
  assert.equal(isNight(at('03:00'), '01:00', '05:00'), true);
  assert.equal(isNight(at('05:00'), '01:00', '05:00'), false);
});

test('isNight: 開始と終了が同じなら常に false。不正な時刻も false', () => {
  assert.equal(isNight(at('08:00'), '08:00', '08:00'), false);
  assert.equal(isNight(at('20:00'), '08:00', '08:00'), false);
  assert.equal(isNight(at('23:00'), 'xx', '07:00'), false);
});

test('isNight: UTC で渡しても日本時間で判定する', () => {
  assert.equal(isNight(Date.parse('2026-11-12T13:30:00Z'), '22:00', '07:00'), true); // 22:30 JST
  assert.equal(isNight(Date.parse('2026-11-12T23:30:00Z'), '22:00', '07:00'), false); // 08:30 JST
});
