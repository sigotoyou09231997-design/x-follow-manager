-- アプリの更新をロック画面へ通知（Web Push）するためのテーブル。
-- 001_x_scheduler.sql を実行済みの前提で、同じプロジェクトに追加する。

-- ============================================================
-- 1. 端末ごとのプッシュ購読情報
-- ============================================================
-- 「通知を受け取る」を押した端末ぶんだけ行が増える。ブラウザ側（src/lib/push.ts）が
-- 自分の行を作り、api/checkAppUpdate.ts が service_role キーで全件読んで送信する。
--
-- x_accounts と違い、ここは本人が読み書きできてよい（入っているのはブラウザが発行した
-- 送信先URLと公開鍵で、これだけでは本人になりすませない）。ただし他人の行は見せない。
create table if not exists public.push_subscriptions (
  id uuid primary key,
  user_id uuid not null,
  -- 同じ端末が再購読したときに行を増やさないための目印。
  device_id text not null,
  -- ブラウザが発行する送信先。端末＋ブラウザで一意。
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "user manages own push_subscriptions" on public.push_subscriptions;
create policy "user manages own push_subscriptions" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- 2. 最後に見たデプロイのバージョン
-- ============================================================
-- api/checkAppUpdate.ts が本番サイトの /version.json（vite.config.ts の
-- writeVersionFile が毎デプロイ出力する）と突き合わせ、変わっていれば通知する。
-- 1行しか持たない（id は常に 'singleton'）。
--
-- ブラウザからは一切触らないので、x_accounts と同じく
-- 「RLSを有効にしてポリシーを1つも作らない」＝ service_role キーだけがアクセスできる。
create table if not exists public.app_version_state (
  id text primary key,
  version text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_version_state enable row level security;
