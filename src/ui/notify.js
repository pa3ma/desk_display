// 通知音（Web Audio）と画面の色変化。
// ブラウザは最初のタッチまで音を出せないため、unlock() が成功するまでは色変化だけで知らせる。
const PATTERNS = {
  work_end: [[660, 0], [880, 0.22], [1100, 0.44]],
  break_end: [[880, 0], [660, 0.25]],
  event: [[990, 0], [990, 0.3]],
};
const TONE_SEC = 0.18;

export function createNotifier({ audioContextFactory, flash }) {
  let ctx = null;

  function tone(freq, offsetSec, volume) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = ctx.currentTime + offsetSec;
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + TONE_SEC);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + TONE_SEC + 0.02);
  }

  return {
    // 利用者のタッチ操作の中から呼ぶ
    unlock() {
      try {
        if (!ctx) ctx = audioContextFactory();
        if (ctx.state === 'suspended') ctx.resume();
        tone(880, 0, 0.05); // 音が出ることを利用者に知らせる短い確認音
      } catch {
        ctx = null;
      }
    },
    isUnlocked() {
      return ctx !== null;
    },
    notify(kind) {
      flash(kind);
      if (!ctx) return;
      try {
        if (ctx.state === 'suspended') ctx.resume();
        for (const [freq, offset] of PATTERNS[kind] ?? PATTERNS.event) tone(freq, offset, 0.4);
      } catch { /* 音が出なくても色変化で通知済み */ }
    },
  };
}
