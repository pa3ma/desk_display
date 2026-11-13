// 取得の間隔と時間切れ。
const INTERVAL_MS = 30 * 60000;
const RETRY_MS = 60000;

// 連続して失敗した回数から、次に取得するまでの待ち時間を決める
export function nextRefreshDelay(failures) {
  if (failures <= 0) return INTERVAL_MS;
  return Math.min(INTERVAL_MS, RETRY_MS * 2 ** Math.min(failures - 1, 10));
}

// 返ってこない通信を ms で打ち切る fetch を作る。
// 時間の上限は、応答の到着だけでなく本文（json）を読み終えるまでにかける。
// 本文の読み込みが止まると、呼び出し側が「処理中」のまま固まるため。
export function withTimeout(fetchFn, ms) {
  return async (url, options = {}) => {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('時間切れ')); }, ms);
    });
    deadline.catch(() => {}); // 使われなかった時間切れを未処理の失敗にしない
    try {
      const res = await Promise.race([fetchFn(url, { ...options, signal: controller.signal }), deadline]);
      return {
        ok: res.ok,
        status: res.status,
        json: () => Promise.race([res.json(), deadline]).finally(() => clearTimeout(timer)),
      };
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
  };
}
