// relay/Code.gs（Google Apps Script）を、Google のサービスを差し替えて読み込み、検証する
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const SOURCE = readFileSync(new URL('../relay/Code.gs', import.meta.url), 'utf8');
const TOKEN = 'a'.repeat(32);
const NOW = Date.parse('2026-11-12T14:05:00+09:00');
let gas, props, fetches, calendarCalls, fetchReply, events;

function load() {
  props = new Map([['TOKEN', TOKEN]]);
  fetches = []; calendarCalls = []; events = [];
  fetchReply = { code: 200, body: JSON.stringify({ statusCode: 100, body: {}, message: 'success' }) };
  const context = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null),
      setProperty: (k, v) => { props.set(k, String(v)); },
    }) },
    CalendarApp: { getDefaultCalendar: () => ({ getEvents: (start, end) => { calendarCalls.push([start.getTime(), end.getTime()]); return events; } }) },
    UrlFetchApp: { fetch: (url, options) => {
      fetches.push({ url, options });
      if (fetchReply.throws) throw new Error('network');
      return { getResponseCode: () => fetchReply.code, getContentText: () => fetchReply.body };
    } },
    Utilities: {
      computeHmacSha256Signature: (value, key) => [...crypto.createHmac('sha256', key).update(value).digest()].map((b) => (b > 127 ? b - 256 : b)),
      base64Encode: (bytes) => Buffer.from(bytes.map((b) => (b + 256) % 256)).toString('base64'),
      getUuid: () => 'nonce-1',
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
  };
  vm.createContext(context);
  vm.runInContext(SOURCE, context);
  context.nowMs_ = () => NOW;
  return context;
}
const call = (parameter) => JSON.parse(gas.doGet({ parameter }).text);
const withPlug = () => { props.set('SWITCHBOT_TOKEN', 'sb-token'); props.set('SWITCHBOT_SECRET', 'sb-secret'); props.set('SWITCHBOT_DEVICE_ID', 'AABBCCDDEEFF'); };
beforeEach(() => { gas = load(); });

test('トークンが違う・未設定・短い場合は unauthorized で、何も呼ばない', () => {
  withPlug();
  assert.deepEqual(call({ token: 'wrong', action: 'plug', state: 'on' }), { error: 'unauthorized' });
  assert.deepEqual(call({}), { error: 'unauthorized' });
  props.set('TOKEN', 'short');
  assert.deepEqual(call({ token: 'short' }), { error: 'unauthorized' });
  props.delete('TOKEN');
  assert.deepEqual(call({ token: '' }), { error: 'unauthorized' });
  assert.equal(fetches.length + calendarCalls.length, 0);
});

test('action なしは、今日0時（日本時間）から7日間の予定を返す', () => {
  const mk = (id, title, s, e, allDay) => ({ getId: () => id, getTitle: () => title, getStartTime: () => new Date(s), getEndTime: () => new Date(e), isAllDayEvent: () => allDay });
  events = [mk('e1', '会議', NOW + 3600e3, NOW + 7200e3, false)];
  const out = call({ token: TOKEN });
  const start = Date.parse('2026-11-12T00:00:00+09:00');
  assert.deepEqual(calendarCalls, [[start, start + 7 * 86400e3]]);
  assert.deepEqual(out, [{ id: 'e1', title: '会議', start: new Date(NOW + 3600e3).toISOString(), end: new Date(NOW + 7200e3).toISOString(), allDay: false }]);
  assert.equal(fetches.length, 0);
});

test('plug on: 登録済みデバイスへ turnOn を署名付きで送り、最終連絡時刻を記録する', () => {
  withPlug();
  assert.deepEqual(call({ token: TOKEN, action: 'plug', state: 'on' }), { ok: true, state: 'on' });
  assert.equal(fetches.length, 1);
  const { url, options } = fetches[0];
  assert.equal(url, 'https://api.switch-bot.com/v1.1/devices/AABBCCDDEEFF/commands');
  assert.equal(options.method, 'post');
  assert.deepEqual(JSON.parse(options.payload), { command: 'turnOn', parameter: 'default', commandType: 'command' });
  const expected = crypto.createHmac('sha256', 'sb-secret').update(`sb-token${NOW}nonce-1`).digest('base64').toUpperCase();
  assert.equal(options.headers.sign, expected);
  assert.equal(options.headers.Authorization, 'sb-token');
  assert.equal(options.headers.t, String(NOW));
  assert.equal(options.headers.nonce, 'nonce-1');
  assert.equal(props.get('LAST_SEEN'), String(NOW));
});

test('plug off は turnOff を送る', () => {
  withPlug();
  assert.deepEqual(call({ token: TOKEN, action: 'plug', state: 'off' }), { ok: true, state: 'off' });
  assert.equal(JSON.parse(fetches[0].options.payload).command, 'turnOff');
});

test('plug: on/off 以外は bad_request、未設定は plug_not_configured で、どちらも送信しない', () => {
  withPlug();
  assert.deepEqual(call({ token: TOKEN, action: 'plug', state: 'toggle' }), { error: 'bad_request' });
  props.delete('SWITCHBOT_SECRET');
  assert.deepEqual(call({ token: TOKEN, action: 'plug', state: 'on' }), { error: 'plug_not_configured' });
  assert.equal(fetches.length, 0);
});

test('plug: SwitchBot がエラーを返す・HTTPエラー・通信失敗・JSONでない応答は plug_failed', () => {
  withPlug();
  fetchReply = { code: 200, body: JSON.stringify({ statusCode: 190, message: 'wrong deviceId' }) };
  assert.deepEqual(call({ token: TOKEN, action: 'plug', state: 'on' }), { error: 'plug_failed' });
  fetchReply = { code: 401, body: '{"message":"Unauthorized"}' };
  assert.deepEqual(call({ token: TOKEN, action: 'plug', state: 'on' }), { error: 'plug_failed' });
  fetchReply = { throws: true };
  assert.deepEqual(call({ token: TOKEN, action: 'plug', state: 'on' }), { error: 'plug_failed' });
  fetchReply = { code: 200, body: '<html>' };
  assert.deepEqual(call({ token: TOKEN, action: 'plug', state: 'on' }), { error: 'plug_failed' });
});

test('plug: URL で別のデバイスや命令を指定しても無視する', () => {
  withPlug();
  call({ token: TOKEN, action: 'plug', state: 'on', deviceId: 'EVIL', device: 'EVIL', command: 'unlock' });
  assert.equal(fetches[0].url, 'https://api.switch-bot.com/v1.1/devices/AABBCCDDEEFF/commands');
  assert.equal(JSON.parse(fetches[0].options.payload).command, 'turnOn');
});

test('heartbeat: ok を返し、最終連絡時刻だけ更新する', () => {
  withPlug();
  assert.deepEqual(call({ token: TOKEN, action: 'heartbeat' }), { ok: true });
  assert.equal(props.get('LAST_SEEN'), String(NOW));
  assert.equal(fetches.length + calendarCalls.length, 0);
});

test('知らない action は bad_request', () => {
  assert.deepEqual(call({ token: TOKEN, action: 'reboot' }), { error: 'bad_request' });
});

test('shouldFailSafe: 30分を超えて連絡がなければ true。記録がなければ true', () => {
  const M30 = 30 * 60000;
  assert.equal(gas.shouldFailSafe(NOW - M30, NOW), false);
  assert.equal(gas.shouldFailSafe(NOW - M30 - 1, NOW), true);
  assert.equal(gas.shouldFailSafe(NaN, NOW), true);
  assert.equal(gas.shouldFailSafe(null, NOW), true);
});

test('failSafe: 連絡が途絶えていたら turnOn を1回送る', () => {
  withPlug();
  props.set('LAST_SEEN', String(NOW - 31 * 60000));
  gas.failSafe({ triggerUid: 'x' });
  assert.equal(fetches.length, 1);
  assert.equal(JSON.parse(fetches[0].options.payload).command, 'turnOn');
  assert.equal(props.get('LAST_SEEN'), String(NOW - 31 * 60000)); // 安全策は「連絡があった」ことにしない
});

test('failSafe: 連絡が続いている・SwitchBot 未設定なら何もしない', () => {
  withPlug();
  props.set('LAST_SEEN', String(NOW - 5 * 60000));
  gas.failSafe();
  assert.equal(fetches.length, 0);
  props.delete('SWITCHBOT_TOKEN'); props.set('LAST_SEEN', String(NOW - 99 * 60000));
  gas.failSafe();
  assert.equal(fetches.length, 0);
});

test('listSwitchBotDevices: 自分のデバイスの名前・ID・種類を返す（編集画面から実行して確認する用）', () => {
  withPlug();
  fetchReply = { code: 200, body: JSON.stringify({ statusCode: 100, body: { deviceList: [
    { deviceId: 'AABBCCDDEEFF', deviceName: '充電用プラグ', deviceType: 'Plug Mini (JP)' },
    { deviceId: '112233445566', deviceName: '温湿度計', deviceType: 'Meter' },
  ] } }) };
  const logged = [];
  gas.console = { log: (...a) => logged.push(a.join(' ')) };
  const list = gas.listSwitchBotDevices();
  assert.deepEqual(JSON.parse(JSON.stringify(list)), [
    { id: 'AABBCCDDEEFF', name: '充電用プラグ', type: 'Plug Mini (JP)' },
    { id: '112233445566', name: '温湿度計', type: 'Meter' },
  ]);
  assert.equal(fetches[0].url, 'https://api.switch-bot.com/v1.1/devices');
  assert.equal(fetches[0].options.method, 'get');
  assert.ok(logged.some((line) => line.includes('AABBCCDDEEFF') && line.includes('充電用プラグ')));
  assert.ok(!logged.some((line) => line.includes('sb-secret') || line.includes('sb-token')));
});

test('listSwitchBotDevices: トークンとシークレットが未設定なら案内を出して空を返す', () => {
  const logged = [];
  gas.console = { log: (...a) => logged.push(a.join(' ')) };
  assert.equal(gas.listSwitchBotDevices().length, 0);
  assert.equal(fetches.length, 0);
  assert.ok(logged.some((line) => line.includes('SWITCHBOT_TOKEN')));
});
