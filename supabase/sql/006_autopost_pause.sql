-- 掲示板・Yay の自動投稿を、画面から「止める／再開する」ための印を置く表。
-- 005_autopost.sql を実行済みの前提で、同じプロジェクトに追加する。
--
-- autopost_channels に列を足さず、別の表にしてある。列を足すと、SQL を流す前に新しい版をデプロイした
-- 瞬間に「文の読み書き」まで列が無くて落ちる。別の表なら、表が無いあいだは止める機能だけが
-- 「まだ用意されていません」になり、文の保存や投稿はこれまでどおり動く。
--
-- paused … true のあいだ、Mac の投稿役は新しい投稿をしない（プロセスは動いたまま。再開は画面から）
-- paused_at … 止めた時刻（画面に「◯時から停止中」と出すため）
--
-- ブラウザからは直接触らない（api/autopost.ts が本人確認のうえで読み書きする）ので、
-- autopost_channels と同じく「RLSを有効にしてポリシーを1つも作らない」＝ service_role キーだけが入れる。
create table if not exists public.autopost_pause (
  user_id uuid not null,
  channel text not null check (channel in ('discord', 'yay')),
  paused boolean not null default false,
  paused_at timestamptz,
  primary key (user_id, channel)
);
alter table public.autopost_pause enable row level security;
