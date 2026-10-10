-- X の「自動運転」（過去の投稿を読んで文体を学び、AIが新しい投稿を前もって予約に並べる）の保存先。
-- 001_x_scheduler.sql（予約投稿）を実行済みの前提で、同じプロジェクトに追加する。
--
-- 作る投稿そのものは、ふつうの予約と同じ scheduled_posts に入る（予約一覧・投稿・編集・削除をそのまま使う）。
-- この表には、設定・読み込んだ自分の過去の投稿・AIがまとめた文体・今月の使用状況を置く。

-- ============================================================
-- 1. 自動運転の設定と状態（1人1行）
-- ============================================================
-- enabled … ON の人だけ、毎分の実行（publishDue）が先の枠を補充する
-- settings … { postsPerDay, windowStart, windowEnd, timeZone, horizonDays, monthlyBudgetYen, quality }
-- history … 読み込んだ自分の投稿 [{ id, text, at, likes, reposts }]（新しい順・最大400件）
-- profile … AIがまとめた「この人らしさ」{ summary, voice, themes, avoid }
-- slots … 作成済みの枠の印 ['2026-10-10#0', ...]。消された予約の枠を作り直さないために覚えておく
-- usage … 今月の使用状況（見積もり）{ month, yen, posts, generations }。月の上限の判定に使う
--
-- ブラウザからは直接触らない（api/xAutopilot.ts が本人確認のうえで読み書きする）ので、
-- x_accounts と同じく「RLSを有効にしてポリシーを1つも作らない」＝ service_role キーだけが入れる。
create table if not exists public.x_autopilot (
  user_id uuid primary key,
  enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  history jsonb not null default '[]'::jsonb,
  history_fetched_at timestamptz,
  profile jsonb,
  profile_built_at timestamptz,
  slots jsonb not null default '[]'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.x_autopilot enable row level security;

-- ============================================================
-- 2. 同じ枠を二重に作らないための索引
-- ============================================================
-- 自動運転が作った予約には ai_prompt に 'autopilot:<日付>#<番号>' が入る。
-- 画面からの「ON」と毎分の補充が同時に走っても、同じ枠の予約が2つできないようにする
-- （あとから入れようとした側は重複として弾かれ、何もせずに終わる）。
-- 対象は、予約中・投稿処理中・投稿済みだけ。取り消した予約（canceled）は数えないので、
-- 「OFF にして取り消し → もう一度 ON」で同じ枠を作り直せる。
create unique index if not exists scheduled_posts_autopilot_slot_idx
  on public.scheduled_posts (user_id, ai_prompt)
  where ai_prompt like 'autopilot:%' and status in ('scheduled', 'publishing', 'posted');
