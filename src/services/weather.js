// Open-Meteo の取得と変換。APIキー不要（非商用）。
const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

export function weatherUrl({ latitude, longitude }) {
  const q = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,weather_code',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'Asia/Tokyo',
    timeformat: 'unixtime',
    forecast_days: '2',
  });
  return `${ENDPOINT}?${q}`;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
function need(cond, what) {
  if (!cond) throw new Error(`天気データの形式が想定と違います: ${what}`);
}

// Forecast = { current:{tempC,code}, hours:[{timeMs,tempC,code,pop}], tomorrow:{code,maxC,minC} }
export function parseForecast(json) {
  need(json && typeof json === 'object' && json.error !== true, 'error');
  const { current, hourly, daily } = json;
  need(current && isNum(current.temperature_2m) && isNum(current.weather_code), 'current');
  need(hourly && Array.isArray(hourly.time) && hourly.time.length > 0, 'hourly.time');
  for (const k of ['temperature_2m', 'weather_code', 'precipitation_probability']) {
    need(Array.isArray(hourly[k]) && hourly[k].length === hourly.time.length, `hourly.${k}`);
  }
  need(daily && Array.isArray(daily.time) && daily.time.length >= 2, 'daily.time');
  for (const k of ['weather_code', 'temperature_2m_max', 'temperature_2m_min']) {
    need(Array.isArray(daily[k]) && isNum(daily[k][1]), `daily.${k}`);
  }

  const hours = [];
  hourly.time.forEach((sec, i) => {
    if (!isNum(sec) || !isNum(hourly.temperature_2m[i]) || !isNum(hourly.weather_code[i])) return;
    const pop = hourly.precipitation_probability[i];
    hours.push({
      timeMs: sec * 1000,
      tempC: hourly.temperature_2m[i],
      code: hourly.weather_code[i],
      pop: isNum(pop) ? pop : null,
    });
  });

  return {
    current: { tempC: current.temperature_2m, code: current.weather_code },
    hours,
    tomorrow: {
      code: daily.weather_code[1],
      maxC: daily.temperature_2m_max[1],
      minC: daily.temperature_2m_min[1],
    },
  };
}

// 表示の時点でこれから先の時間帯を選ぶ（取得は30分ごとなので、取得時に絞ると古くなる）
export function nextHours(forecast, nowMs, count = 6) {
  return forecast.hours.filter((h) => h.timeMs >= nowMs).slice(0, count);
}

const LABELS = [
  [[0], '快晴', '☀️'],
  [[1], '晴れ', '🌤️'],
  [[2], '晴れ時々くもり', '⛅'],
  [[3], 'くもり', '☁️'],
  [[45, 48], '霧', '🌫️'],
  [[51, 53, 55, 56, 57], '霧雨', '🌦️'],
  [[61, 63, 65, 66, 67], '雨', '🌧️'],
  [[71, 73, 75, 77], '雪', '🌨️'],
  [[80, 81, 82], 'にわか雨', '🌦️'],
  [[85, 86], 'にわか雪', '🌨️'],
  [[95, 96, 97, 99], '雷雨', '⛈️'],
];

export function weatherLabel(code) {
  const hit = LABELS.find(([codes]) => codes.includes(code));
  return hit ? { text: hit[1], icon: hit[2] } : { text: '不明', icon: '❔' };
}

// 雨・雪として知らせる天気コード（霧雨、雨、雪、にわか雨、にわか雪、雷雨）
const WET_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 97, 99]);

// これから withinMs 以内に雨が降りそうな最初の時間帯。なければ null
export function rainNotice(forecast, nowMs, { withinMs = 3 * 3600e3, minPop = 50 } = {}) {
  const hit = forecast.hours.find((h) =>
    h.timeMs >= nowMs && h.timeMs < nowMs + withinMs &&
    (WET_CODES.has(h.code) || (h.pop !== null && h.pop >= minPop)));
  if (!hit) return null;
  return { timeMs: hit.timeMs, pop: hit.pop, text: WET_CODES.has(hit.code) ? weatherLabel(hit.code).text : '雨' };
}

export async function loadWeather(settings, fetchFn = fetch) {
  if (settings.latitude === null || settings.longitude === null) throw new Error('場所が未設定です');
  const res = await fetchFn(weatherUrl(settings));
  if (!res.ok) throw new Error(`天気の取得に失敗しました (HTTP ${res.status})`);
  return parseForecast(await res.json());
}
