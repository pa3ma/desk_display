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

test('withTimeout: 時間内に返れば結果をそのまま返す', async () => {
  const f = withTimeout(async (url) => `ok:${url}`, 1000);
  assert.equal(await f('u'), 'ok:u');
});

test('withTimeout: 返ってこない取得は時間切れで失敗し、中断の合図を送る', async () => {
  let aborted = false;
  const hang = (url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
  });
  await assert.rejects(withTimeout(hang, 20)('u'));
  assert.equal(aborted, true);
});
