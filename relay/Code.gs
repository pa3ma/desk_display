/**
 * 卓上ディスプレイ用の中継（Google Apps Script）
 *
 * できること:
 *  1. 自分の既定カレンダーの「今日から7日間」の予定を JSON で返す。
 *     返すのは 題名・開始・終了・終日かどうか だけ（説明・場所・参加者は返さない）。
 *  2. 登録した1台の SwitchBot プラグを入れる／切る（タブレットの充電制御用）。
 *  3. アプリからの連絡が30分途絶えたら、プラグを自動で入れる（電池切れ防止）。
 *
 * デプロイ手順（初回）:
 *  1. https://script.google.com で新しいプロジェクトを作り、このファイルの内容を貼り付ける。
 *  2. 「プロジェクトの設定」→「スクリプト プロパティ」に TOKEN を追加する。
 *     値は 32 文字以上の推測できない文字列にする（パスワード生成ツール等で作る）。
 *  3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *     実行するユーザー: 自分 / アクセスできるユーザー: 全員
 *  4. 表示された URL の末尾に ?token=（TOKEN の値）を付けたものが「中継URL」。
 *     この URL を知っている人は予定を読め、プラグを操作できるので、他人に見せない。
 *     漏れた場合は TOKEN を変更すれば、古い URL は使えなくなる。
 *
 * コードを更新したとき:
 *  「デプロイ」→「デプロイを管理」→ 鉛筆 → バージョン「新バージョン」→「デプロイ」。URL は変わらない。
 *
 * 充電の自動制御を使うとき（任意）:
 *  1. スクリプト プロパティに次の3つを追加する。
 *     SWITCHBOT_TOKEN / SWITCHBOT_SECRET … SwitchBot アプリの開発者向けオプションで取得
 *     SWITCHBOT_DEVICE_ID … プラグのデバイスID
 *  2. 左の時計アイコン「トリガー」→「トリガーを追加」
 *     実行する関数: failSafe / イベントのソース: 時間主導型 / 分ベースのタイマー / 15分おき
 */
var WINDOW_DAYS = 7;
var FAIL_SAFE_MS = 30 * 60 * 1000;
var JST_OFFSET_MS = 9 * 60 * 60 * 1000;
var DAY_MS = 24 * 60 * 60 * 1000;
var SWITCHBOT_API = 'https://api.switch-bot.com/v1.1';

function nowMs_() {
  return new Date().getTime();
}

function props_() {
  return PropertiesService.getScriptProperties();
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  var expected = props_().getProperty('TOKEN');
  if (!expected || expected.length < 32 || params.token !== expected) {
    return json_({ error: 'unauthorized' });
  }
  var action = params.action || 'events';
  if (action === 'events') return json_(listEvents_());
  if (action === 'heartbeat') {
    markSeen_();
    return json_({ ok: true });
  }
  if (action === 'plug') {
    if (params.state !== 'on' && params.state !== 'off') return json_({ error: 'bad_request' });
    if (!plugConfig_()) return json_({ error: 'plug_not_configured' });
    markSeen_();
    return json_(setPlug_(params.state) ? { ok: true, state: params.state } : { error: 'plug_failed' });
  }
  return json_({ error: 'bad_request' });
}

/** 今日の0時（日本時間）から WINDOW_DAYS 日間 */
function weekWindow_(nowMs) {
  var startMs = Math.floor((nowMs + JST_OFFSET_MS) / DAY_MS) * DAY_MS - JST_OFFSET_MS;
  return { start: new Date(startMs), end: new Date(startMs + WINDOW_DAYS * DAY_MS) };
}

function listEvents_() {
  var range = weekWindow_(nowMs_());
  return CalendarApp.getDefaultCalendar().getEvents(range.start, range.end).map(function (ev) {
    return {
      id: ev.getId(),
      title: ev.getTitle(),
      start: ev.getStartTime().toISOString(),
      end: ev.getEndTime().toISOString(),
      allDay: ev.isAllDayEvent()
    };
  });
}

function markSeen_() {
  props_().setProperty('LAST_SEEN', String(nowMs_()));
}

/** SwitchBot の設定がそろっていれば返す。なければ null */
function plugConfig_() {
  var p = props_();
  var config = {
    token: p.getProperty('SWITCHBOT_TOKEN'),
    secret: p.getProperty('SWITCHBOT_SECRET'),
    deviceId: p.getProperty('SWITCHBOT_DEVICE_ID')
  };
  return config.token && config.secret && config.deviceId ? config : null;
}

/** SwitchBot API v1.1 の認証ヘッダー。sign = Base64(HMAC-SHA256(token + t + nonce, secret)) を大文字にしたもの */
function switchBotHeaders_(token, secret, t, nonce) {
  var signature = Utilities.computeHmacSha256Signature(token + t + nonce, secret);
  return {
    Authorization: token,
    sign: Utilities.base64Encode(signature).toUpperCase(),
    t: String(t),
    nonce: nonce
  };
}

/** 登録済みの1台だけを入れる／切る。成功したら true */
function setPlug_(state) {
  var config = plugConfig_();
  if (!config) return false;
  try {
    var response = UrlFetchApp.fetch(SWITCHBOT_API + '/devices/' + encodeURIComponent(config.deviceId) + '/commands', {
      method: 'post',
      contentType: 'application/json',
      headers: switchBotHeaders_(config.token, config.secret, nowMs_(), Utilities.getUuid()),
      payload: JSON.stringify({ command: state === 'on' ? 'turnOn' : 'turnOff', parameter: 'default', commandType: 'command' }),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) return false;
    return JSON.parse(response.getContentText()).statusCode === 100;
  } catch (err) {
    return false;
  }
}

function shouldFailSafe(lastSeenMs, nowMs) {
  if (typeof lastSeenMs !== 'number' || !isFinite(lastSeenMs)) return true;
  return nowMs - lastSeenMs > FAIL_SAFE_MS;
}

/** 時間主導トリガー（15分おき）から呼ぶ。アプリからの連絡が途絶えていたらプラグを入れる */
function failSafe() {
  if (!plugConfig_()) return;
  var raw = props_().getProperty('LAST_SEEN');
  var lastSeen = raw === null ? NaN : Number(raw);
  if (shouldFailSafe(lastSeen, nowMs_())) setPlug_('on');
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
