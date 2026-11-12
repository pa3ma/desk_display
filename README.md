# 卓上ディスプレイ（Fire HD 8 用）

使わなくなった Fire HD 8（第12世代）を、時計・天気・Googleカレンダーの予定・ポモドーロタイマーを表示する卓上の専用端末にするための Web アプリです。

- ビルド不要の静的サイト（HTML / CSS / JavaScript）。依存パッケージはありません。
- 天気は [Open-Meteo](https://open-meteo.com/)（APIキー不要・非商用）から取得します。
- 予定は、自分の Google アカウントに置く中継スクリプト（`relay/Code.gs`）から取得します。
- 緯度経度や中継URLは端末の画面で入力し、その端末の中にだけ保存します。**このリポジトリに秘密情報は入りません。**

設計と計画は `docs/superpowers/` にあります。実機のセットアップは [`docs/device-setup.md`](docs/device-setup.md) を見てください。

## 画面

| ホーム | タイマー |
|---|---|
| 時刻・日付、天気（現在・6時間・明日）、直近の予定2件、タイマーの進み具合 | 残り時間、フェーズ、完了した作業回数、開始／一時停止・リセット・スキップ |

画面全体の地色がタイマーの状態を表します（待機=藍、作業=赤、休憩=緑）。

## 開発

```
npm test                      # ロジックの自動テスト（Node.js 22 以上）
python3 tools/e2e.py          # ブラウザでの通し確認（Playwright と Chrome が必要）
python3 tools/screenshot.py   # 画面を out/ に PNG 出力（横置き・縦置き）
python3 -m http.server 8000   # 手元で開く → http://localhost:8000/
```

`http://localhost:8000/?demo=1` を開くと、通信せずに固定のサンプルで表示します。`file://` で直接開くと動きません（ES Modules の制約）。

## 公開

GitHub Pages など、静的ファイルを配信できる場所に置けば動きます。手順は `docs/device-setup.md` の「3. Webアプリの公開」にあります。

## 構成

```
src/core/      タイマーの状態機械、予定の通知判定、設定の検証（DOM に依存しない）
src/services/  天気・カレンダーの取得と変換、キャッシュ
src/ui/        表示用の文字列、画面の描画、通知音、減光
src/app.js     組み立てと1秒ごとの処理
relay/Code.gs  カレンダー中継（Google Apps Script）
```
