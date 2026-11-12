// 取得＋キャッシュ。失敗しても前回の値を返し、呼び出し側を止めない。
// Result = { data, updatedAt, error }
// validate: データの形を確かめる関数。通らない値は保存済み・取得結果のどちらも使わない。
export function createCachedSource({ key, load, storage, now, validate = () => true }) {
  let last = null;

  function stored() {
    try {
      const raw = JSON.parse(storage.getItem(key));
      if (raw && typeof raw === 'object' && Number.isFinite(raw.updatedAt) && 'data' in raw && validate(raw.data)) {
        return { data: raw.data, updatedAt: raw.updatedAt };
      }
    } catch { /* 壊れた保存データは未取得として扱う */ }
    return { data: null, updatedAt: null };
  }

  return {
    async refresh() {
      try {
        const data = await load();
        if (!validate(data)) throw new Error('取得したデータの形式が想定と違います');
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
