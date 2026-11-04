-- X の自動運転が書いた文の記録（あとで分析するため）。007_x_autopilot.sql を実行済みの前提で追加する。
--
-- AI が1本書くたびに1行（検査に落ちて書き直した案も、1案ごとに1行）。
--   kind     … 'auto'（自動運転の補充）／'preview'（試し書き）／'compose'（言葉から書く）／'revise'（整える）
--   quality  … 'standard' | 'saver' | 'cheapest'、model … 実際に呼んだモデル名
--   text     … 書かれた文（本文が空だったときは空文字）
--   problems … 検査に落ちた理由 ['長すぎる', ...]（通った案は空の配列）
--   attempt  … その生成の中で何案目か（0 が最初）
--   context  … 材料・元の文・指示・予定時刻など、kind ごとの付随情報
--   yen      … この1案の費用の見積もり（円）
--
-- 採用したか・取り消したかは、この表には持たない。同じ本文が scheduled_posts にあるかで
-- あとから突き合わせる（本人の操作のたびに、ここを書き換えなくて済む）。
--
-- ブラウザからは直接触らない（x_autopilot と同じ）。RLS を有効にしてポリシーを作らない＝service_role だけが入れる。
create table if not exists public.x_autopilot_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  created_at timestamptz not null default now(),
  kind text not null,
  quality text not null,
  model text not null,
  text text not null default '',
  problems jsonb not null default '[]'::jsonb,
  attempt integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  yen numeric not null default 0,
  context jsonb not null default '{}'::jsonb
);
alter table public.x_autopilot_generations enable row level security;
create index if not exists x_autopilot_generations_user_idx
  on public.x_autopilot_generations (user_id, created_at desc);
