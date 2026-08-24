# X フォロー整理ツール

2つの機能を持つ個人用Webアプリ。

| 機能 | 動く場所 | 外部通信 |
| --- | --- | --- |
| 非相互フォロー整理 | ブラウザ内で完結 | なし |
| 予約投稿（AI下書き・自動投稿） | サーバー（Vercel + Supabase） | Supabase / Anthropic / X API |

非相互フォロー整理は今まで通り、アーカイブZIPをブラウザ内だけで解析します。
予約投稿は「ブラウザを閉じていても時間になったら投稿される」必要があるため、サーバー側で動きます。

## 開発

```bash
npm install
npm run dev            # 画面のみ（/api/* は動かない）
npx vercel dev         # /api/* も含めて動かす場合
npm test               # ユニットテスト
npm run test:e2e       # Playwright E2E
npm run build          # デプロイ用ビルド
npm run build:artifact # Claude Artifact用の単一HTML（予約投稿は含まれない）
```

---

# 予約投稿のセットアップ

初回だけ、以下の4つを順に設定します。

## 1. X（Twitter）側

X API は 2026年2月から**従量課金制**になり、無料枠はありません。

| 項目 | 料金 |
| --- | --- |
| 投稿1件 | $0.015 |
| **URLを含む投稿1件** | **$0.200** |
| 画像のメタデータ（代替テキスト） | $0.005 |

1. https://console.x.com で開発者登録し、appを作る
2. 開発者コンソール（https://console.x.com）でクレジットを購入する（残高が尽きると投稿が失敗する）
   - **自動リチャージ**（金額としきい値）と **Spend cap**（1請求サイクルの上限）を必ず自分で設定する
3. app の **User authentication settings** を開き、以下を設定する
   - App permissions: **Read and write**
   - Type of App: **Web App**（＝confidential client。client secretが発行される。
     Native App / Single Page App を選ぶとsecretが出ず、この実装は動かない）
   - Callback URI: `https://<あなたのVercelドメイン>/x-callback`
     - **完全一致**で判定される（プロトコル・末尾スラッシュ含む）。1つのappに最大10個まで登録できる
     - ローカル検証用には `http://127.0.0.1:3000/x-callback`（`vercel dev`）を追加する。
       **`localhost` は不可**で、Xが許可するのは `http://127.0.0.1` だけ。
       ブラウザも `localhost` ではなく `127.0.0.1` で開くこと（origin が一致しないと弾かれる）
   - Website URL: 任意
4. **Client ID** と **Client Secret** を控える

> スコープは `tweet.read tweet.write users.read media.write offline.access` を使います。
> `offline.access` がないとリフレッシュトークンが発行されず、2時間で投稿できなくなります。

## 2. Supabase 側

LIFE HUB（todoアプリ）と同じプロジェクトに相乗りできます。

1. SQL Editor で `supabase/sql/001_x_scheduler.sql` を実行する
   - `x_accounts`（Xのトークン置き場）、`scheduled_posts`（予約）、Storageバケット `x-post-media` が作られる
   - `x_accounts` は **RLSを有効にしてポリシーを1つも作らない**設計です。ブラウザからは1行も読めず、
     service_roleキーを持つサーバー関数だけが触れます（トークンが漏れると本人になりすまして投稿されるため）
2. Authentication → Providers で **Google** を有効にする
3. Authentication → URL Configuration の Redirect URLs に以下を追加する
   - `https://<あなたのVercelドメイン>/**`
   - `http://127.0.0.1:3000/**`
   - `http://localhost:5173/**`
4. Project Settings → API から **Project URL**、**anon key**、**service_role key** を控える

## 3. Vercel 側

1. このディレクトリをVercelにデプロイする
2. 環境変数を設定する（`.env.example` を参照）

   | 変数名 | 値 | 備考 |
   | --- | --- | --- |
   | `SUPABASE_URL` | SupabaseのProject URL | ブラウザへは `/api/config` 経由で配られる |
   | `SUPABASE_ANON_KEY` | Supabaseのanon key | 同上（`VITE_SUPABASE_ANON_KEY` でも可） |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabaseのservice_role key | **サーバー専用。ブラウザには絶対に出さない** |
   | `ANTHROPIC_API_KEY` | AnthropicのAPIキー | サーバー専用 |
   | `X_CLIENT_ID` | XアプリのClient ID | サーバー専用 |
   | `X_CLIENT_SECRET` | XアプリのClient Secret | サーバー専用 |
   | `CRON_SECRET` | 自分で決めるランダムな長い文字列 | サーバー専用 |

   > **接続情報はビルド時ではなく実行時に配ります。**
   > Vercelでは「Sensitive」に設定した変数がビルド時に渡されず、さらにビルドキャッシュの
   > 影響も受けるため、`VITE_` 方式だと「環境変数は正しいのに画面には未設定と出る」という
   > 切り分け不能な状態に陥ります（実際に踏みました）。
   > そのため `api/config.ts` が実行時に `SUPABASE_URL` / `SUPABASE_ANON_KEY` を返し、
   > ブラウザは起動時にそれを取得します。これにより、**環境変数の設定漏れがあっても
   > 画面のコードが最適化で消えることがなくなり**、原因を切り分けられるようになります。
   > （Vercelの仕様上、環境変数の値を変えた後は再デプロイが必要です。ただし値が空でも
   > ビルド結果は変わらないので、再デプロイすれば必ず反映されます。）
   > ここで配るのは公開前提の2つだけで、service_role key や各種シークレットは返しません。
   >
   > 設定漏れの切り分けは `https://<ドメイン>/api/config` を開けば分かります
   > （どれが設定済みかを true/false で返します。値は返しません）。

3. 環境変数はすべて Sensitive にして構いません（実行時にしか使わないため）
4. **保存後、値がちゃんと入っているか `https://<ドメイン>/api/config` で確認する**
   （キーだけ登録されて値が空、という状態になっていても画面上は見分けがつかないため）

> **`api/` 配下の相対importには必ず `.js` 拡張子を付けること。**
> `package.json` が `type: module` なので、Vercel上ではNodeのESM規則が適用され、
> 拡張子なしの相対import（`from './_lib/auth'`）は `FUNCTION_INVOCATION_FAILED` になります。
> npmパッケージは解決できるのに自分のファイルだけ読めない、という紛らわしい症状が出ます。

## 4. 定期実行（毎分のチェック）

**Vercel Cron は使いません。** Hobbyプランは cron が1日1回までで、しかも実行時刻が±1時間ずれるため、
予約投稿には使えません。代わりに Supabase の `pg_cron` から毎分 `/api/publishDue` を呼びます。

1. `supabase/sql/002_publish_cron.sql` の `<>` 部分を自分の値に置き換える
2. SQL Editor で実行する
3. 動作確認

   ```sql
   select * from cron.job;
   select * from cron.job_run_details order by start_time desc limit 20;
   select id, status_code, error_msg, created from net._http_response order by created desc limit 20;
   ```

> Supabase無料プランは1週間アクセスがないとプロジェクトが一時停止します。
> このcronが毎分動いていれば停止しませんが、**一度停止するとcron自身では復帰できません**。

---

## 使い方

1. アプリを開いて **予約投稿** タブ → Googleでログイン
2. 「Xと連携する」でXアカウントを接続
3. 「投稿を作る」で書く（モバイルは下部バー中央の ＋ からも開けます）
   - 自分で書く。スレッド（連投）、画像添付（1投稿4枚まで）、繰り返し予約に対応
   - 同じ画面の **「AIに下書きを作ってもらう」** を開くと、お題から Claude が複数案を生成。
     「本文に使う」でそのまま本文欄に入るので、手直しして日時を付けて予約できます。
     本文を書いてある状態で開くと、その本文もAIへ渡るので「これをもっと短く」といった指示が効きます
   - 案をまとめて貯めておきたいときは「選んだ◯件を下書きに貯める」で下書き保存し、あとから日時を付けます
4. 一覧で「予約中 / 今日の予定 / 次の投稿 / 下書き / 繰り返し / 投稿済み / 失敗」を確認

### 仕組みの要点

- 予約は毎分チェックされ、時刻を過ぎたものから投稿されます
- **繰り返し予約**はテンプレートとして保存され、次の1回分だけが予約として作られます。
  投稿されるたびに次回分が自動で追加されるので、予約が無限に積み上がりません
- **スレッド**は2件目以降を直前の投稿への返信として繋げます。
  途中で失敗した場合、投稿済みの分は取り消せないため、何件目で失敗したかがエラーに残ります
- 一時的なエラー（レート制限・X側の障害）は最大3回まで自動リトライします。
  本文の問題（文字数超過など）はリトライせず「失敗」になります
- Xのリフレッシュトークンは使い捨てで、更新のたびに新しいものに置き換わります

### 制限

- 文字数はXの数え方（日本語1文字=2、英数字=1、URL=23固定）で280までです
- 画像はXの仕様で1投稿4枚まで
- Claude Artifact版では予約投稿は使えません（サーバーが必要なため）
