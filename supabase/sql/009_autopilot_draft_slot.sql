-- X の自動運転: 「確認待ち」（status = 'draft'）の予約も、同じ枠に1本までにする。
-- 007 の索引は、予約中・処理中・投稿済みだけを数えていた。確認してから投稿する設定（既定）では、並べる投稿が
-- まず draft で入るので、同時に2つの実行が同じ枠を作っても弾けるよう、draft も数える。
-- これを流さなくても動く（枠の二重作成は、アプリ側の調べで防いでいる。索引は、同時実行のときの最後の砦）。
drop index if exists public.scheduled_posts_autopilot_slot_idx;
create unique index if not exists scheduled_posts_autopilot_slot_idx
  on public.scheduled_posts (user_id, ai_prompt)
  where ai_prompt like 'autopilot:%' and status in ('scheduled', 'draft', 'publishing', 'posted');
