// 取得＋キャッシュ。失敗しても前回の値を返し、呼び出し側を止めない。
// Result = { data, updatedAt, error }
export function createCachedSource({ key, load, storage, now }) {
  let last = null;

  function stored() {
    try {
      const raw = JSON.parse(storage.getItem(key));
      if (raw && typeof raw === 'object' && Number.isFinite(raw.updatedAt) && 'data' in raw) {
        return { data: raw.data, updatedAt: raw.updatedAt };
      }
    } catch { /* 壊れた保存データは未取得として扱う */ }
    return { data: null, updatedAt: null };
  }

  return {
    async refresh() {
      try {
        const data = await load();
        const entry = { data, updatedAt: now() };
        try { storage.setItem(key, JSON.stringify(entry)); } catch { /* 保存失敗は無視 */ }
        last = { ...entry, error: false };
      } catch {
        last = { ...stored(), error: true };
      }
      return last;
    },
    current() {
      return last ?? { ...stored(), error: false };
    },
  };
}
