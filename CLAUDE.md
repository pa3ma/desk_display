# 卓上ディスプレイ（Fire HD 8 用）— 引き継ぎメモ

Fire HD 8（第12世代、Fire OS 8.3.3.8）の全画面ブラウザで動く、依存なしの静的Webアプリ。
概要は README.md、実機の手順は docs/device-setup.md、設計と計画は docs/superpowers/ にある。

## コマンド
- `npm test` … 単体テスト（Node.js 22 以上、137件）
- `python3 tools/e2e.py` … ブラウザの通し確認（Playwright + Chrome、126項目）
- `python3 tools/screenshot.py` … 5画面×2方向を out/ に出力
- `python3 -m http.server 8000` → `http://localhost:8000/?demo=1`

## 決まりごと
- npm パッケージを足さない。判定は src/core・src/services の純粋関数に置き、先に失敗するテストを書く。
- 日付はすべて Asia/Tokyo。秘密情報（中継URLのトークン、SwitchBot の鍵）をリポジトリ・ログ・画面に出さない。
- 充電の自動制御は「迷ったらプラグを入れる」側に倒す。

## 現状（2026-11-13）
- ブランチ `feat/dashboard` に v1 と v2 を実装済み。独立レビューの重要な指摘は修正済み。`main` へは未統合、GitHub へは未公開。
- 実機では未確認: docs/device-setup.md のチェック項目1〜21（電池の残量を読めるか、SwitchBot API でプラグが動くか、Apps Script のトリガー、ブラウザから中継を読めるか）。
- SwitchBot の署名は Base64 を大文字にして送っている。手順書6-2で `plug_failed` が出たら、relay/Code.gs の `switchBotHeaders_` の `.toUpperCase()` を外して試す。

## 先送りした小さな指摘
1. 縦置きの週間画面で「ほか n 件」が見切れることがある
2. 数日にまたがる時刻付き予定が、途中の日にも最終日の終了時刻で出る
3. failSafe トリガーの入れ忘れに気づく仕組みがない
4. 23:51〜23:59 のリマインダーは0時以降の受付時間がなくなる
5. `:has()` 非対応の WebView では天気の「明日」の線が出ない
6. tools/__pycache__ がコミットされている（.gitignore に追加する）
7. 中継が v1 のままだと「7日間の予定はありません」の文言が合わない
8. 設計書 v2 §2.2 が「題名は1行」のまま（実装は3行まで折り返し）
