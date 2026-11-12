// ポモドーロの状態機械。DOM にも実時計にも依存しない。
const KEY = 'desk.timer';
const PHASES = ['work', 'short_break', 'long_break'];
const STATUSES = ['idle', 'running', 'paused'];
const STALE_MS = 60000;

export function createTimer({ now, durations, storage }) {
  let d = durations;
  const phaseMs = (phase) =>
    phase === 'work' ? d.workMs : phase === 'short_break' ? d.shortBreakMs : d.longBreakMs;
  const clamp = (ms, phase) => Math.max(0, Math.min(ms, phaseMs(phase)));

  let s = load() ?? initial();

  function initial() {
    return { phase: 'work', status: 'idle', endsAt: null, remainingMs: d.workMs, completedWork: 0 };
  }

  function load() {
    try {
      const raw = JSON.parse(storage.getItem(KEY));
      if (!raw || !PHASES.includes(raw.phase) || !STATUSES.includes(raw.status)) return null;
      if (!Number.isInteger(raw.completedWork) || raw.completedWork < 0) return null;
      if (raw.status === 'running' && !Number.isFinite(raw.endsAt)) return null;
      if (raw.status !== 'running' && !Number.isFinite(raw.remainingMs)) return null;
      return {
        phase: raw.phase,
        status: raw.status,
        endsAt: raw.status === 'running' ? raw.endsAt : null,
        remainingMs: raw.status === 'idle' ? phaseMs(raw.phase) : clamp(raw.remainingMs ?? 0, raw.phase),
        completedWork: raw.completedWork,
      };
    } catch {
      return null;
    }
  }

  function save() {
    try { storage.setItem(KEY, JSON.stringify(s)); } catch { /* 保存できなくても動作は続ける */ }
  }

  function remaining() {
    return s.status === 'running' ? clamp(s.endsAt - now(), s.phase) : s.remainingMs;
  }

  // 次のフェーズへ進める（走行状態は呼び出し側が決める）
  function advance() {
    if (s.phase === 'work') {
      s.completedWork += 1;
      s.phase = s.completedWork >= d.cyclesBeforeLong ? 'long_break' : 'short_break';
    } else {
      if (s.phase === 'long_break') s.completedWork = 0;
      s.phase = 'work';
    }
  }

  function toIdle() {
    s.status = 'idle'; s.endsAt = null; s.remainingMs = phaseMs(s.phase);
  }

  return {
    start() {
      if (s.status === 'running') return;
      s.endsAt = now() + s.remainingMs; s.status = 'running'; save();
    },
    pause() {
      if (s.status !== 'running') return;
      s.remainingMs = remaining(); s.status = 'paused'; s.endsAt = null; save();
    },
    reset() { toIdle(); save(); },
    skip() { advance(); toIdle(); save(); },
    tick() {
      if (s.status !== 'running' || now() < s.endsAt) return [];
      const prevEnd = s.endsAt;
      const from = s.phase;
      advance();
      const stale = now() - prevEnd > STALE_MS;
      if (stale) toIdle();
      else { s.endsAt = prevEnd + phaseMs(s.phase); s.remainingMs = phaseMs(s.phase); }
      save();
      return [{ type: 'phase_changed', from, to: s.phase, stale }];
    },
    snapshot() {
      return { phase: s.phase, status: s.status, remainingMs: remaining(), completedWork: s.completedWork };
    },
    setDurations(next) {
      d = next;
      if (s.status === 'idle') { s.remainingMs = phaseMs(s.phase); save(); }
    },
  };
}
