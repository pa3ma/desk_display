// 電池の残量からプラグを入れるか切るかを決める。
// last は「最後に成功した指示」{ state: 'on'|'off', atMs }。同じ指示は繰り返さないが、
// 5分たっても充電状態が指示と食い違っていれば、効いていないとみなして送り直す。
const KEY = 'desk.power';
const RESEND_MS = 5 * 60000;

export function plugDecision({ level, charging, low, high, last, nowMs }) {
  if (typeof level !== 'number' || !Number.isFinite(level)) return null;
  const want = level <= low ? 'on' : level >= high ? 'off' : null;
  if (want === null) return null;
  if (!last || last.state !== want) return want;
  const contradicts = want === 'on' ? charging === false : charging === true;
  return contradicts && nowMs - last.atMs >= RESEND_MS ? want : null;
}

export function loadPowerState(storage) {
  try {
    const raw = JSON.parse(storage.getItem(KEY));
    if (raw && (raw.state === 'on' || raw.state === 'off') && Number.isFinite(raw.atMs)) {
      return { state: raw.state, atMs: raw.atMs };
    }
  } catch { /* 壊れた記録は無いものとして扱う */ }
  return null;
}

export function savePowerState(storage, last) {
  try { storage.setItem(KEY, JSON.stringify(last)); } catch { /* 保存できなくても続行 */ }
}
