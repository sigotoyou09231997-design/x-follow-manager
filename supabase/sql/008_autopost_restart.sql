-- スマホの画面の「投稿役を再起動する」を、Mac に伝えるための依頼を置く表。
-- 005_autopost.sql を実行済みの前提で、同じプロジェクトに追加する。
--
-- 006_autopost_pause.sql と同じ考え方で、既存の表には列を足さず別の表にしてある。
-- この SQL を流す前に新しい版をデプロイしても、止まるのは「再起動」ボタンだけ
-- （「まだ用意されていません」と出る）。文の保存や自動投稿そのものには影響しない。
--
-- 画面が requested_at を入れる → Mac の見張り（poster/remote/）が1分ごとに見に来て、投稿役を入れ替え、
-- handled_at と result（何をしたか）を書き戻す。依頼は1人に1行（新しい依頼が古い依頼を置き換える）。
--
-- requested_at … 依頼した時刻
-- handled_at   … Mac が処理した時刻。null のあいだは「依頼中」
-- result       … Mac が書き戻した結果（画面に「Yay: 再起動しました」などと出す）
--
-- ブラウザからは直接触らない（api/autopost.ts が本人確認のうえで読み書きする）ので、
-- autopost_channels と同じく「RLSを有効にしてポリシーを1つも作らない」＝ service_role キーだけが入れる。
create table if not exists public.autopost_restart (
  user_id uuid primary key,
  requested_at timestamptz,
  handled_at timestamptz,
  result text
);
alter table public.autopost_restart enable row level security;
