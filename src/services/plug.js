// 中継（Apps Script）へのプラグ指示と生存連絡。
// 中継URLにはトークンが含まれるため、エラーやログに URL を出さない。
export function relayUrlFor(relayUrl, params) {
  const url = new URL(relayUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function ask(settings, params, fetchFn) {
  if (!settings.relayUrl) return null;
  try {
    const res = await fetchFn(relayUrlFor(settings.relayUrl, params));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// 中継が「その状態にした」と答えたときだけ true。古い中継（予定の配列を返す）は成功扱いにしない
export async function sendPlug(settings, state, fetchFn = fetch) {
  if (state !== 'on' && state !== 'off') return false;
  const body = await ask(settings, { action: 'plug', state }, fetchFn);
  return Boolean(body) && !Array.isArray(body) && body.ok === true && body.state === state;
}

export async function sendHeartbeat(settings, fetchFn = fetch) {
  const body = await ask(settings, { action: 'heartbeat' }, fetchFn);
  return Boolean(body) && !Array.isArray(body) && body.ok === true;
}
