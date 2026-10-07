-- 掲示板・Yay の自動投稿（Mac で動く投稿役）の「投稿する文」と「動いている知らせ」を置く表。
-- 001_x_scheduler.sql を実行済みの前提で、同じプロジェクトに追加する。
--
-- 以前は別アプリ（ch-post-editor）が Vercel Blob に置いていたもの。X のアプリに一本化するため、
-- 他の表と同じ Supabase へ移した。

-- ============================================================
-- 1. 投稿先ごとの文と状態
-- ============================================================
-- channel … 'discord'（discord-ch.site の募集掲示板）/ 'yay'（yay.space）
-- messages … いま回している文（順番に投稿される）。discord は最大10、yay は1つ
-- archive … 差し替えで外れた前の文（新しい順ではなく古い順で持つ。画面側で逆にして見せる）
-- version … 文を保存するたびに +1。別の端末で先に保存されていたら上書きしないための目印
-- status … Mac の投稿役が数分おきに報告する {lastPost, today, at}
--
-- ブラウザからは直接触らない（api/autopost.ts が本人確認のうえで読み書きする）ので、
-- x_accounts と同じく「RLSを有効にしてポリシーを1つも作らない」＝ service_role キーだけが入れる。
create table if not exists public.autopost_channels (
  user_id uuid not null,
  channel text not null check (channel in ('discord', 'yay')),
  messages jsonb not null default '[]'::jsonb,
  archive jsonb not null default '[]'::jsonb,
  version integer not null default 0,
  saved_at timestamptz,
  status jsonb,
  primary key (user_id, channel)
);
alter table public.autopost_channels enable row level security;

-- ============================================================
-- 2. Mac の投稿役が使う合鍵
-- ============================================================
-- Mac の投稿役は Google ログインできないので、画面のログインとは別に「合鍵」で文を読み・状態を報告する。
-- 合鍵そのものは保存せず、sha256 の値だけを持つ（この表が漏れても合鍵は分からない）。
-- 合鍵でできるのは「文を読む」「状態を報告する」だけで、文の書き換えはできない。
create table if not exists public.autopost_poster_keys (
  token_hash text primary key,
  user_id uuid not null,
  note text,
  created_at timestamptz not null default now()
);
alter table public.autopost_poster_keys enable row level security;
