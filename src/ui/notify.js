// 通知音（Web Audio）と画面の色変化。
// ブラウザは最初のタッチまで音を出せないため、unlock() が成功するまでは色変化だけで知らせる。
const PATTERNS = {
  work_end: [[660, 0], [880, 0.22], [1100, 0.44]],
  break_end: [[880, 0], [660, 0.25]],
  event: [[990, 0], [990, 0.3]],
};
const TONE_SEC = 0.18;
const TONE_TAIL_SEC = 0.02;
// タイマーの終了音は、確実に気付けるよう、音型を繰り返して全体でこの長さにする
const LONG_SEC = 7;
const LONG_REPEATS = 7;
const LONG_KINDS = new Set(['work_end', 'break_end']);

// 鳴らす音の一覧 [周波数, 開始までの秒] を作る
function schedule(kind) {
  const pattern = PATTERNS[kind] ?? PATTERNS.event;
  if (!LONG_KINDS.has(kind)) return pattern;
  const patternSec = pattern[pattern.length - 1][1] + TONE_SEC + TONE_TAIL_SEC;
  const period = (LONG_SEC - patternSec) / (LONG_REPEATS - 1); // 最後の音型がちょうど LONG_SEC で終わる
  const tones = [];
  for (let i = 0; i < LONG_REPEATS; i++) {
    for (const [freq, offset] of pattern) tones.push([freq, i * period + offset]);
  }
  return tones;
}

export function createNotifier({ audioContextFactory, flash, onStateChange = () => {} }) {
  let ctx = null;
  let playing = null; // 鳴っている通知の出口。切り離すと、予約済みの音もまとめて止まる

  function tone(freq, offsetSec, volume, output) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = ctx.currentTime + offsetSec;
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + TONE_SEC);
    osc.connect(gain);
    gain.connect(output);
    osc.start(t0);
    osc.stop(t0 + TONE_SEC + TONE_TAIL_SEC);
  }

  function silence() {
    if (!playing) return;
    try { playing.disconnect(); } catch { /* すでに切れている */ }
    playing = null;
  }

  return {
    // 利用者のタッチ操作の中から呼ぶ
    // 音が実際に出せる状態（running）になるまで、タッチのたびに呼んでよい
    unlock() {
      try {
        if (!ctx) {
          ctx = audioContextFactory();
          ctx.onstatechange = () => onStateChange();
        }
        if (ctx.state !== 'running') {
          const pending = ctx.resume();
          if (pending && pending.catch) pending.catch(() => {});
        }
        tone(880, 0, 0.3, ctx.destination); // 音が出ることを利用者に知らせる確認音
      } catch {
        ctx = null;
      }
    },
    isUnlocked() {
      return ctx !== null && ctx.state === 'running';
    },
    // 鳴っている通知音を止める（画面に触れたときに呼ぶ）
    silence,
    notify(kind) {
      flash(kind);
      if (!ctx) return;
      try {
        if (ctx.state !== 'running') {
          const pending = ctx.resume();
          if (pending && pending.catch) pending.catch(() => {});
        }
        silence();
        const output = ctx.createGain();
        output.connect(ctx.destination);
        playing = output;
        for (const [freq, offset] of schedule(kind)) tone(freq, offset, 0.4, output);
      } catch { /* 音が出なくても色変化で通知済み */ }
    },
  };
}
