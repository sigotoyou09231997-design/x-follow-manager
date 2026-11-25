-- X（くり返し）が投稿する X アカウントの連携を、本アカウントの連携（x_accounts）とは別に持つ表。
-- 011_x_repeat.sql を実行済みの前提。足すだけで、消す・作り替える操作は無い。
--
-- なぜ別にするか: 2026-11-25、X（くり返し）が本アカウント（x_accounts の連携）にそのまま投稿してしまった。
-- 本人は別のアカウントに出したかった。投稿先のアカウントを専用に連携し、それが無ければ投稿しない。
--
-- x_accounts と同じく、RLS を有効にしてポリシーを1つも作らない＝ service_role キー（サーバー）だけが入れる。
-- トークンはブラウザに一切渡さない（画面には username だけを返す）。
create table if not exists public.x_repeat_accounts (
  user_id uuid primary key,
  x_user_id text not null,
  username text not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  updated_at timestamptz not null default now()
);
alter table public.x_repeat_accounts enable row level security;
