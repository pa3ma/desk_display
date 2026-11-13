// バー式タイマーの目盛り。残り時間が減ると右端から消えていく。
// 戻り値は左から順の各目盛りの濃さ（0〜1）。消えかけの目盛りは残りの割合になる。
export function barSegments(remainingMs, totalMs, count = 20) {
  if (!(totalMs > 0)) return Array(count).fill(0);
  const lit = Math.max(0, Math.min(1, remainingMs / totalMs)) * count;
  return Array.from({ length: count }, (_, i) => Math.max(0, Math.min(1, lit - i)));
}

// 残り10%以下（終了が近い）
export function isBarLow(remainingMs, totalMs) {
  return totalMs > 0 && remainingMs > 0 && remainingMs <= totalMs * 0.1;
}
