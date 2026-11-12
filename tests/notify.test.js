import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier } from '../src/ui/notify.js';
import { createDimmer } from '../src/ui/dim.js';

// 鳴らした音の回数だけ数える偽の AudioContext
function fakeAudio() {
  const log = { tones: 0, resumed: 0 };
  const node = () => ({ connect() {}, start() { log.tones++; }, stop() {},
    frequency: { value: 0 }, type: '',
    gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } });
  const factory = () => ({ currentTime: 0, state: 'running', destination: {},
    createOscillator: node, createGain: node, resume() { log.resumed++; return Promise.resolve(); } });
  return { log, factory };
}

test('unlock 前は音を鳴らさず flash だけ呼ぶ', () => {
  const { log, factory } = fakeAudio(); const flashes = [];
  const n = createNotifier({ audioContextFactory: factory, flash: (k) => flashes.push(k) });
  assert.equal(n.isUnlocked(), false);
  n.notify('work_end');
  assert.deepEqual(flashes, ['work_end']);
  assert.equal(log.tones, 0);
});

test('unlock 後は音と flash の両方', () => {
  const { log, factory } = fakeAudio(); const flashes = [];
  const n = createNotifier({ audioContextFactory: factory, flash: (k) => flashes.push(k) });
  n.unlock();
  assert.equal(n.isUnlocked(), true);
  const before = log.tones;
  n.notify('event');
  assert.deepEqual(flashes, ['event']);
  assert.ok(log.tones > before);
});

test('audioContextFactory が throw しても unlock と notify は例外を出さず flash を呼ぶ', () => {
  const flashes = [];
  const n = createNotifier({ audioContextFactory: () => { throw new Error('no audio'); }, flash: (k) => flashes.push(k) });
  n.unlock();
  assert.equal(n.isUnlocked(), false);
  n.notify('break_end');
  assert.deepEqual(flashes, ['break_end']);
});

test('dimmer: afterMs 経過で true、touch で false、連続して同じ値は通知しない', () => {
  let t = 0; const changes = [];
  const d = createDimmer({ now: () => t, afterMs: 300000, onChange: (v) => changes.push(v) });
  t = 299999; d.tick(); assert.deepEqual(changes, []);
  t = 300000; d.tick(); d.tick(); assert.deepEqual(changes, [true]);
  d.touch(); d.touch(); assert.deepEqual(changes, [true, false]);
  t = 599999; d.tick(); assert.deepEqual(changes, [true, false]);
  t = 600000; d.tick(); assert.deepEqual(changes, [true, false, true]);
});

test('dimmer: hold(true) の間は減光せず、解除後に数え直す', () => {
  let t = 0; const changes = [];
  const d = createDimmer({ now: () => t, afterMs: 1000, onChange: (v) => changes.push(v) });
  d.hold(true); t = 5000; d.tick(); assert.deepEqual(changes, []);
  d.hold(false); d.tick(); assert.deepEqual(changes, []);
  t = 6000; d.tick(); assert.deepEqual(changes, [true]);
});
