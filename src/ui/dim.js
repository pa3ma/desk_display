// 無操作が続いたら減光を知らせる。hold(true) の間（タイマー走行中など）は減光しない。
export function createDimmer({ now, afterMs, onChange }) {
  let lastTouch = now();
  let dimmed = false;
  let held = false;
  let after = afterMs;

  function set(value) {
    if (dimmed === value) return;
    dimmed = value;
    onChange(value);
  }

  return {
    touch() { lastTouch = now(); set(false); },
    hold(value) { held = value; if (held) { lastTouch = now(); set(false); } },
    setAfter(ms) { after = ms; },
    tick() {
      if (held) { lastTouch = now(); return; }
      if (now() - lastTouch >= after) set(true);
    },
  };
}
