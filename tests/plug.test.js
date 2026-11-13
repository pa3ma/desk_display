import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relayUrlFor, sendPlug, sendHeartbeat } from '../src/services/plug.js';

const settings = { relayUrl: 'https://script.google.com/macros/s/a/exec?token=t' };
const reply = (body, ok = true) => async (url) => { reply.url = url; return { ok, status: ok ? 200 : 500, json: async () => body }; };

test('relayUrlFor: 既存の token を保ったままクエリを足す', () => {
  const q = new URL(relayUrlFor(settings.relayUrl, { action: 'plug', state: 'on' })).searchParams;
  assert.equal(q.get('token'), 't'); assert.equal(q.get('action'), 'plug'); assert.equal(q.get('state'), 'on');
});

test('sendPlug: 中継が同じ状態で ok を返したときだけ成功', async () => {
  assert.equal(await sendPlug(settings, 'on', reply({ ok: true, state: 'on' })), true);
  assert.equal(new URL(reply.url).searchParams.get('state'), 'on');
  assert.equal(await sendPlug(settings, 'on', reply({ ok: true, state: 'off' })), false);
});

test('sendPlug: 古い中継の配列・エラー応答・HTTPエラー・例外は失敗', async () => {
  assert.equal(await sendPlug(settings, 'on', reply([])), false);
  assert.equal(await sendPlug(settings, 'on', reply({ error: 'plug_failed' })), false);
  assert.equal(await sendPlug(settings, 'on', reply({ ok: true, state: 'on' }, false)), false);
  assert.equal(await sendPlug(settings, 'on', async () => { throw new Error('offline'); }), false);
  assert.equal(await sendPlug(settings, 'on', reply(null)), false);
});

test('sendPlug: 中継URLが空、または状態が on/off 以外なら通信しない', async () => {
  let called = false;
  const f = async () => { called = true; return { ok: true, json: async () => ({ ok: true, state: 'on' }) }; };
  assert.equal(await sendPlug({ relayUrl: '' }, 'on', f), false);
  assert.equal(await sendPlug(settings, 'toggle', f), false);
  assert.equal(called, false);
});

test('sendHeartbeat: ok のときだけ成功', async () => {
  assert.equal(await sendHeartbeat(settings, reply({ ok: true })), true);
  assert.equal(new URL(reply.url).searchParams.get('action'), 'heartbeat');
  assert.equal(await sendHeartbeat(settings, reply([])), false);
  assert.equal(await sendHeartbeat({ relayUrl: '' }, reply({ ok: true })), false);
});
