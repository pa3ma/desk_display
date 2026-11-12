/**
 * Google カレンダー中継（卓上スマートディスプレイ用）
 *
 * 自分の既定カレンダーの「今から48時間以内」の予定だけを JSON で返します。
 * 返すのは 題名・開始・終了・終日かどうか だけで、説明・場所・参加者は返しません。
 *
 * デプロイ手順:
 *  1. https://script.google.com で新しいプロジェクトを作り、このファイルの内容を貼り付ける。
 *  2. 「プロジェクトの設定」→「スクリプト プロパティ」に TOKEN を追加する。
 *     値は 32 文字以上の推測できない文字列にする（パスワード生成ツール等で作る）。
 *  3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *     実行するユーザー: 自分 / アクセスできるユーザー: 全員
 *  4. 表示された URL の末尾に ?token=（TOKEN の値）を付けたものが「中継URL」。
 *     この URL を知っている人は予定の題名と時刻を読めるので、他人に見せない。
 *     漏れた場合は TOKEN を変更すれば、古い URL は使えなくなる。
 */
var WINDOW_HOURS = 48;

function doGet(e) {
  var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  var given = e && e.parameter ? e.parameter.token : '';
  if (!expected || expected.length < 32 || given !== expected) {
    return json_({ error: 'unauthorized' });
  }
  var now = new Date();
  var until = new Date(now.getTime() + WINDOW_HOURS * 3600 * 1000);
  var events = CalendarApp.getDefaultCalendar().getEvents(now, until).map(function (ev) {
    return {
      id: ev.getId(),
      title: ev.getTitle(),
      start: ev.getStartTime().toISOString(),
      end: ev.getEndTime().toISOString(),
      allDay: ev.isAllDayEvent()
    };
  });
  return json_(events);
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
