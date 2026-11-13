// 設定の既定値・読み書き・検証。値は端末の localStorage にだけ保存する。
import { isTimeText } from './reminders.js';

const KEY = 'desk.settings';
const RELAY_PREFIX = 'https://script.google.com/';

export const DEFAULTS = Object.freeze({
  latitude: null, longitude: null, relayUrl: '', workMin: 25, shortBreakMin: 5,
  longBreakMin: 15, cyclesBeforeLong: 4, notifyLeadMin: 10, dimAfterMin: 5,
  nightEnabled: true, nightStart: '22:00', nightEnd: '07:00',
  plugEnabled: false, plugLow: 35, plugHigh: 80,
});

const MINUTE_FIELDS = ['workMin', 'shortBreakMin', 'longBreakMin', 'notifyLeadMin', 'dimAfterMin'];

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}
const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const intInRange = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
// チェックボックス（'on'／未定義）と保存済みの真偽値の両方を受ける
const toBool = (v) => v === true || v === 'on' || v === 'true';

// 入力を検証し、{ settings, errors } を返す
function validate(input) {
  const settings = { ...DEFAULTS };
  const errors = {};

  const latBlank = isBlank(input.latitude), lonBlank = isBlank(input.longitude);
  if (!(latBlank && lonBlank)) {
    const lat = toNumber(input.latitude), lon = toNumber(input.longitude);
    if (!(lat >= -90 && lat <= 90)) errors.latitude = '緯度は -90〜90 の数値で入力してください';
    else settings.latitude = lat;
    if (!(lon >= -180 && lon <= 180)) errors.longitude = '経度は -180〜180 の数値で入力してください';
    else settings.longitude = lon;
  }

  const relayUrl = typeof input.relayUrl === 'string' ? input.relayUrl.trim() : '';
  if (relayUrl !== '' && !relayUrl.startsWith(RELAY_PREFIX)) {
    errors.relayUrl = `${RELAY_PREFIX} で始まるURLを入力してください`;
  } else settings.relayUrl = relayUrl;

  for (const field of MINUTE_FIELDS) {
    const n = toNumber(input[field]);
    if (!intInRange(n, 1, 180)) errors[field] = '1〜180 の整数で入力してください';
    else settings[field] = n;
  }
  const cycles = toNumber(input.cyclesBeforeLong);
  if (!intInRange(cycles, 1, 10)) errors.cyclesBeforeLong = '1〜10 の整数で入力してください';
  else settings.cyclesBeforeLong = cycles;

  for (const field of ['nightStart', 'nightEnd']) {
    if (!isTimeText(input[field])) errors[field] = '時刻は 22:00 の形で入力してください';
    else settings[field] = input[field];
  }
  settings.nightEnabled = toBool(input.nightEnabled);

  const low = toNumber(input.plugLow), high = toNumber(input.plugHigh);
  if (!intInRange(low, 20, 50)) errors.plugLow = '20〜50 の整数で入力してください';
  else settings.plugLow = low;
  if (!intInRange(high, 60, 90)) errors.plugHigh = '60〜90 の整数で入力してください';
  else settings.plugHigh = high;
  settings.plugEnabled = toBool(input.plugEnabled);

  return { settings, errors };
}

export function loadSettings(storage) {
  let raw;
  try { raw = JSON.parse(storage.getItem(KEY)); } catch { raw = null; }
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
  // 不正な項目だけ既定値に戻す（validate は不正な項目を既定値のまま残す）
  const { settings, errors } = validate({ ...DEFAULTS, ...raw });
  if (errors.latitude || errors.longitude) { settings.latitude = null; settings.longitude = null; }
  return settings;
}

export function saveSettings(storage, input) {
  const { settings, errors } = validate(input);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  storage.setItem(KEY, JSON.stringify(settings));
  return { ok: true, settings };
}

export function toDurations(settings) {
  return {
    workMs: settings.workMin * 60000,
    shortBreakMs: settings.shortBreakMin * 60000,
    longBreakMs: settings.longBreakMin * 60000,
    cyclesBeforeLong: settings.cyclesBeforeLong,
  };
}
