// 取得の間隔と時間切れ。
const INTERVAL_MS = 30 * 60000;
const RETRY_MS = 60000;

// 連続して失敗した回数から、次に取得するまでの待ち時間を決める
export function nextRefreshDelay(failures) {
  if (failures <= 0) return INTERVAL_MS;
  return Math.min(INTERVAL_MS, RETRY_MS * 2 ** Math.min(failures - 1, 10));
}

// 返ってこない通信を ms で打ち切る fetch を作る
export function withTimeout(fetchFn, ms) {
  return async (url, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetchFn(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}
