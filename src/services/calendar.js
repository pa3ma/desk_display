// カレンダー中継（Apps Script）の応答を CalEvent に直す。
// 応答: [{ id, title, start, end, allDay }]、エラー時は { error }
export function parseRelay(json) {
  if (!Array.isArray(json)) throw new Error('カレンダー中継の応答が配列ではありません');
  return json.map((item) => {
    const startMs = Date.parse(item?.start);
    const endMs = Date.parse(item?.end);
    const valid =
      item && typeof item.id === 'string' && item.id !== '' && typeof item.title === 'string' &&
      typeof item.allDay === 'boolean' && Number.isFinite(startMs) && Number.isFinite(endMs);
    if (!valid) throw new Error('カレンダー中継の予定データの形式が想定と違います');
    return { id: item.id, title: item.title.trim() || '（無題）', startMs, endMs, allDay: item.allDay };
  });
}

export async function loadCalendar(settings, fetchFn = fetch) {
  if (!settings.relayUrl) throw new Error('カレンダーが未接続です');
  // URL にはトークンが含まれるため、エラーメッセージやログに URL を入れない
  const res = await fetchFn(settings.relayUrl);
  if (!res.ok) throw new Error(`予定の取得に失敗しました (HTTP ${res.status})`);
  return parseRelay(await res.json());
}
