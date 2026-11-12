import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTimer } from '../src/core/timer.js';
import { fakeStorage } from './helpers.js';

const durations = { workMs: 25 * 60e3, shortBreakMs: 5 * 60e3, longBreakMs: 15 * 60e3, cyclesBeforeLong: 4 };
let t, now, storage, timer;
beforeEach(() => {
  t = 0; now = () => t; storage = fakeStorage();
  timer = createTimer({ now, durations, storage });
});
// 走行中のフェーズを終わらせて tick する
function finishPhase() {
  t += timer.snapshot().remainingMs;
  return timer.tick();
}

test('初期状態は作業・待機・残り25分', () => {
  assert.deepEqual(timer.snapshot(), { phase: 'work', status: 'idle', remainingMs: 1500000, completedWork: 0 });
});

test('25分経過で休憩に入り、自動で走り続ける', () => {
  timer.start(); t = 1500000;
  assert.deepEqual(timer.tick(), [{ type: 'phase_changed', from: 'work', to: 'short_break', stale: false }]);
  assert.deepEqual(timer.snapshot(), { phase: 'short_break', status: 'running', remainingMs: 300000, completedWork: 1 });
});

test('次のフェーズは前のフェーズの終了時刻から数える', () => {
  timer.start(); t = 1500000 + 2000; timer.tick();
  assert.equal(timer.snapshot().remainingMs, 298000);
});

test('4回目の作業のあとは長休憩、その後は completedWork が0に戻る', () => {
  timer.start();
  for (let i = 1; i <= 3; i++) {
    assert.equal(finishPhase()[0].to, 'short_break');
    assert.equal(timer.snapshot().completedWork, i);
    assert.equal(finishPhase()[0].to, 'work');
  }
  assert.deepEqual(finishPhase(), [{ type: 'phase_changed', from: 'work', to: 'long_break', stale: false }]);
  assert.equal(timer.snapshot().remainingMs, 900000);
  assert.equal(timer.snapshot().completedWork, 4);
  assert.deepEqual(finishPhase(), [{ type: 'phase_changed', from: 'long_break', to: 'work', stale: false }]);
  assert.deepEqual(timer.snapshot(), { phase: 'work', status: 'running', remainingMs: 1500000, completedWork: 0 });
});

test('一時停止中は残り時間が減らず、再開で続きから', () => {
  timer.start(); t = 60000; timer.pause(); t = 999999;
  assert.equal(timer.snapshot().remainingMs, 1440000);
  assert.deepEqual(timer.tick(), []);
  timer.start(); t += 1000;
  assert.equal(timer.snapshot().remainingMs, 1439000);
});

test('reset は現在のフェーズを待機・満了時間に戻す', () => {
  timer.start(); finishPhase(); t += 60000;
  timer.reset();
  assert.deepEqual(timer.snapshot(), { phase: 'short_break', status: 'idle', remainingMs: 300000, completedWork: 1 });
});

test('skip は次のフェーズへ進み待機にする', () => {
  timer.start(); t = 1000; timer.skip();
  assert.deepEqual(timer.snapshot(), { phase: 'short_break', status: 'idle', remainingMs: 300000, completedWork: 1 });
});

test('再読み込み後に走行中の残り時間を復元する', () => {
  timer.start(); t = 600000;
  const restored = createTimer({ now, durations, storage });
  assert.deepEqual(restored.snapshot(), { phase: 'work', status: 'running', remainingMs: 900000, completedWork: 0 });
});

test('終了から60秒を超えて過ぎていたら、次のフェーズで待機し stale を立てる', () => {
  timer.start(); t = 1500000 + 2 * 3600e3;
  assert.deepEqual(timer.tick(), [{ type: 'phase_changed', from: 'work', to: 'short_break', stale: true }]);
  assert.deepEqual(timer.snapshot(), { phase: 'short_break', status: 'idle', remainingMs: 300000, completedWork: 1 });
  assert.deepEqual(timer.tick(), []);
});

test('保存データが壊れていたら初期状態で始める', () => {
  storage.setItem('desk.timer', '{not json');
  assert.equal(createTimer({ now, durations, storage }).snapshot().status, 'idle');
  storage.setItem('desk.timer', JSON.stringify({ phase: 'nap', status: 'running', endsAt: 'x' }));
  assert.deepEqual(createTimer({ now, durations, storage }).snapshot(),
    { phase: 'work', status: 'idle', remainingMs: 1500000, completedWork: 0 });
});

test('時計が巻き戻っても残り時間はフェーズの全時間を超えない', () => {
  timer.start(); t = -5000;
  assert.equal(timer.snapshot().remainingMs, 1500000);
});

test('走行中に時間設定を短くしたら、残り時間は新しい長さまでに縮めて数え続ける', () => {
  timer.start(); t = 60000;
  timer.setDurations({ ...durations, workMs: 60000 });
  assert.equal(timer.snapshot().remainingMs, 60000);
  t += 10000;
  assert.equal(timer.snapshot().remainingMs, 50000);
  const restored = createTimer({ now, durations: { ...durations, workMs: 60000 }, storage });
  assert.equal(restored.snapshot().remainingMs, 50000);
});

test('一時停止中に時間設定を短くしたら、残り時間を新しい長さまでに縮める', () => {
  timer.start(); t = 60000; timer.pause();
  timer.setDurations({ ...durations, workMs: 120000 });
  assert.equal(timer.snapshot().remainingMs, 120000);
  timer.start(); t += 1000;
  assert.equal(timer.snapshot().remainingMs, 119000);
});
