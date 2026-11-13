import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRefreshDelay, withTimeout } from '../src/services/refresh.js';

test('nextRefreshDelay: 成功後は30分、失敗後は1分から倍々で最大30分', () => {
  assert.equal(nextRefreshDelay(0), 30 * 60000);
  assert.equal(nextRefreshDelay(1), 60000);
  assert.equal(nextRefreshDelay(2), 120000);
  assert.equal(nextRefreshDelay(5), 16 * 60000);
  assert.equal(nextRefreshDelay(6), 30 * 60000);
  assert.equal(nextRefreshDelay(60), 30 * 60000);
});

test('withTimeout: 時間内に返れば、本文もそのまま読める', async () => {
  const f = withTimeout(async (url) => ({ ok: true, status: 200, json: async () => `ok:${url}` }), 1000);
  const res = await f('u');
  assert.equal(res.ok, true); assert.equal(res.status, 200);
  assert.equal(await res.json(), 'ok:u');
});

test('withTimeout: 本文の読み込みが止まっても時間切れで失敗する', async () => {
  const stall = async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) });
  const res = await withTimeout(stall, 30)('u');
  await assert.rejects(res.json());
});

test('withTimeout: 応答そのものが返らず、中断の合図も無視されても時間切れで失敗する', async () => {
  await assert.rejects(withTimeout(() => new Promise(() => {}), 30)('u'));
});

test('withTimeout: 返ってこない取得は時間切れで失敗し、中断の合図を送る', async () => {
  let aborted = false;
  const hang = (url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
  });
  await assert.rejects(withTimeout(hang, 20)('u'));
  assert.equal(aborted, true);
});
