-- X予約投稿機能のスキーマ。LIFE HUB(todoアプリ)と同じSupabaseプロジェクトに追加する想定。
-- set_server_updated_at() は 001_transactions.sql で既に作成済みなら再作成不要だが、
-- create or replace なので単独実行しても安全。

create or replace function public.set_server_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.server_updated_at = now();
  return new;
end;
$function$;

-- ============================================================
-- 1. X アカウント接続情報（アクセストークン・リフレッシュトークン）
-- ============================================================
-- 重要: このテーブルには RLS を有効にしたうえで **ポリシーを一切作らない**。
-- そうすると anon / authenticated ロール（＝ブラウザ）からは1行も読めず、
-- service_role キーを持つサーバー関数だけがアクセスできる。
-- Xのトークンは第三者に渡ると本人になりすまして投稿できてしまうため、
-- 他のテーブルのように「本人なら読める」ポリシーを付けてはいけない。
create table if not exists public.x_accounts (
  user_id uuid primary key,
  x_user_id text not null,
  username text not null,
  access_token text not null,
  refresh_token text not null,
  -- access_token の失効時刻。既定で2時間。publishDue が期限前に自動更新する。
  expires_at timestamptz not null,
  scope text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.x_accounts enable row level security;

-- ブラウザ側は「Xと連携済みか / どのアカウントか」だけ知れれば十分。
-- テーブルを直接読ませずに済むよう、トークン列を含まない SECURITY DEFINER 関数で返す。
create or replace function public.my_x_account()
returns table (x_user_id text, username text, connected_at timestamptz)
language sql
security definer
set search_path = public
as $function$
  select x_user_id, username, created_at
  from public.x_accounts
  where user_id = auth.uid();
$function$;
revoke all on function public.my_x_account() from public;
grant execute on function public.my_x_account() to authenticated;

-- ============================================================
-- 2. 予約投稿
-- ============================================================
-- status の遷移:
--   draft      … AIが生成しただけ / 下書き保存。scheduled_at は未設定でもよい
--   scheduled  … 予約確定。scheduled_at 必須。publishDue の対象になる
--   publishing … publishDue が処理中（多重投稿防止のロック代わり）
--   posted     … 投稿成功。posted_tweet_ids に結果が入る
--   failed     … 規定回数リトライしても失敗
--   canceled   … ユーザーが取り消し
create table if not exists public.scheduled_posts (
  id uuid primary key,
  user_id uuid not null,
  status text not null default 'draft'
    check (status in ('draft','scheduled','publishing','posted','failed','canceled')),
  scheduled_at timestamptz,
  -- スレッド(連投)を表現するため、本文は常に配列で持つ。
  -- 単発投稿は要素1つ。 [{ "text": "...", "media": [{"path":"...","mime":"image/png"}] }, ...]
  segments jsonb not null default '[]'::jsonb,
  -- 繰り返し予約のルール。null なら単発。
  -- { "freq":"daily"|"weekly"|"monthly", "interval":1, "byWeekday":[1,3],
  --   "time":"09:00", "timeZone":"Asia/Tokyo", "until":"2026-12-31" }
  repeat_rule jsonb,
  -- 繰り返しの「テンプレート行」から生成された実体行は、親のidをここに持つ
  repeat_parent_id uuid references public.scheduled_posts(id) on delete cascade,
  posted_tweet_ids text[],
  error_message text,
  attempt_count int not null default 0,
  -- publishing 状態のまま固まった行を復旧するための目印
  locked_at timestamptz,
  -- AI生成時のお題（再生成や履歴確認用）
  ai_prompt text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now()
);

create index if not exists scheduled_posts_user_id_idx on public.scheduled_posts (user_id);
-- publishDue が「期限到来した予約」を引くためのインデックス
create index if not exists scheduled_posts_due_idx
  on public.scheduled_posts (status, scheduled_at)
  where status = 'scheduled';
create index if not exists scheduled_posts_repeat_parent_idx
  on public.scheduled_posts (repeat_parent_id);

alter table public.scheduled_posts enable row level security;
drop policy if exists "user manages own scheduled posts" on public.scheduled_posts;
create policy "user manages own scheduled posts" on public.scheduled_posts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists scheduled_posts_set_server_updated_at on public.scheduled_posts;
create trigger scheduled_posts_set_server_updated_at
  before insert or update on public.scheduled_posts
  for each row execute function set_server_updated_at();

-- ============================================================
-- 3. 添付画像の置き場（Supabase Storage）
-- ============================================================
-- 予約時刻にブラウザが閉じていても publishDue が画像を読めるよう、
-- 画像は IndexedDB ではなく Storage に置く。バケットは非公開。
insert into storage.buckets (id, name, public)
values ('x-post-media', 'x-post-media', false)
on conflict (id) do nothing;

-- 自分の user_id 配下のフォルダ (<user_id>/xxx.png) のみ読み書きできる
drop policy if exists "user manages own x post media" on storage.objects;
create policy "user manages own x post media" on storage.objects
  for all to authenticated
  using (bucket_id = 'x-post-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'x-post-media' and (storage.foldername(name))[1] = auth.uid()::text);
