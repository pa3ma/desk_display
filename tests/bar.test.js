import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barSegments, isBarLow } from '../src/core/bar.js';

test('満了時間なら20目盛りすべて1', () => assert.deepEqual(barSegments(1500000, 1500000), Array(20).fill(1)));
test('半分なら左10目盛りが1、右10目盛りが0', () => {
  assert.deepEqual(barSegments(750000, 1500000), [...Array(10).fill(1), ...Array(10).fill(0)]);
});
test('消えかけの目盛りは残りの割合になる', () => {
  const s = barSegments(1500000 * 0.525, 1500000);
  assert.equal(s[9], 1); assert.ok(Math.abs(s[10] - 0.5) < 1e-9); assert.equal(s[11], 0);
});
test('0以下はすべて0、満了超えはすべて1、totalMs が0以下ならすべて0', () => {
  assert.deepEqual(barSegments(0, 1500000), Array(20).fill(0));
  assert.deepEqual(barSegments(-5, 1500000), Array(20).fill(0));
  assert.deepEqual(barSegments(2000000, 1500000), Array(20).fill(1));
  assert.deepEqual(barSegments(100, 0), Array(20).fill(0));
});
test('count を変えられる', () => assert.equal(barSegments(50, 100, 4).join(), '1,1,0,0'));
test('isBarLow: 10%以下で true、0 と 10%超は false', () => {
  assert.equal(isBarLow(150000, 1500000), true);
  assert.equal(isBarLow(150001, 1500000), false);
  assert.equal(isBarLow(0, 1500000), false);
  assert.equal(isBarLow(10, 0), false);
});
