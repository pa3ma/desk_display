import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { weatherUrl, parseForecast, nextHours, weatherLabel, loadWeather } from '../src/services/weather.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/open-meteo.json', import.meta.url), 'utf8'));
const BASE = Date.parse('2026-11-12T00:00:00+09:00');
const H = 3600e3;

test('weatherUrl: 緯度経度と必要な変数、unixtime、Asia/Tokyo を含む', () => {
  const url = new URL(weatherUrl({ latitude: 35.68, longitude: 139.76 }));
  assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
  const q = url.searchParams;
  assert.equal(q.get('latitude'), '35.68');
  assert.equal(q.get('longitude'), '139.76');
  assert.equal(q.get('current'), 'temperature_2m,weather_code');
  assert.equal(q.get('hourly'), 'temperature_2m,weather_code,precipitation_probability');
  assert.equal(q.get('daily'), 'weather_code,temperature_2m_max,temperature_2m_min');
  assert.equal(q.get('timezone'), 'Asia/Tokyo');
  assert.equal(q.get('timeformat'), 'unixtime');
  assert.equal(q.get('forecast_days'), '2');
});

test('parseForecast: 現在・時間ごと・明日を取り出す（時刻はミリ秒）', () => {
  const f = parseForecast(fixture());
  assert.deepEqual(f.current, { tempC: 14.3, code: 2 });
  assert.equal(f.hours.length, 48);
  assert.deepEqual(f.hours[0], { timeMs: BASE, tempC: 10, code: 1, pop: 0 });
  assert.deepEqual(f.hours[25], { timeMs: BASE + 25 * H, tempC: 10.5, code: 61, pop: 50 });
  assert.deepEqual(f.tomorrow, { code: 63, maxC: 13.1, minC: 9.9 });
});

test('nextHours: now より前の時間帯は含めず、先頭6件', () => {
  const f = parseForecast(fixture());
  const hours = nextHours(f, BASE + 2.5 * H);
  assert.deepEqual(hours.map((h) => (h.timeMs - BASE) / H), [3, 4, 5, 6, 7, 8]);
  assert.equal(nextHours(f, BASE + 46.5 * H).length, 1);
  assert.deepEqual(nextHours(f, BASE + 100 * H), []);
});

test('parseForecast: {error:true} と hourly 欠落は throw', () => {
  assert.throws(() => parseForecast({ error: true, reason: 'bad' }));
  const noHourly = fixture(); delete noHourly.hourly;
  assert.throws(() => parseForecast(noHourly));
  const oneDay = fixture(); oneDay.daily.time.pop(); oneDay.daily.weather_code.pop();
  assert.throws(() => parseForecast(oneDay));
  assert.throws(() => parseForecast(null));
});

test('parseForecast: 降水確率が null の時間帯は pop:null で通す', () => {
  const j = fixture(); j.hourly.precipitation_probability[0] = null;
  assert.equal(parseForecast(j).hours[0].pop, null);
});

test('weatherLabel: 0→快晴、63→雨、95→雷雨、未知→不明', () => {
  assert.deepEqual(weatherLabel(0), { text: '快晴', icon: '☀️' });
  assert.equal(weatherLabel(2).text, '晴れ時々くもり');
  assert.equal(weatherLabel(63).text, '雨');
  assert.equal(weatherLabel(81).text, 'にわか雨');
  assert.equal(weatherLabel(95).text, '雷雨');
  assert.deepEqual(weatherLabel(1234), { text: '不明', icon: '❔' });
});

test('loadWeather: 緯度経度が null なら fetch せず throw', async () => {
  let called = false;
  await assert.rejects(loadWeather({ latitude: null, longitude: null }, async () => { called = true; }));
  assert.equal(called, false);
});

test('loadWeather: 取得して変換する。HTTPエラーは throw', async () => {
  let asked;
  const ok = async (url) => { asked = url; return { ok: true, json: async () => fixture() }; };
  const f = await loadWeather({ latitude: 35.68, longitude: 139.76 }, ok);
  assert.equal(f.current.tempC, 14.3);
  assert.equal(asked, weatherUrl({ latitude: 35.68, longitude: 139.76 }));
  await assert.rejects(loadWeather({ latitude: 1, longitude: 2 }, async () => ({ ok: false, status: 500, json: async () => ({}) })));
});
