-- 予約投稿を毎分チェックするcronジョブ。
-- Vercel Cronは Hobbyプランだと1日1回・実行時刻±1時間しか設定できず予約投稿には使えないため、
-- Supabaseの pg_cron から Vercel Functions を叩く方式にする。
--
-- 実行前に下の <> 部分を自分の値に置き換えること。

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- URLとシークレットをDBに直書きしないよう、Vault(暗号化ストア)へ入れて参照する。
-- 既に同じ名前がある場合は insert が失敗するので、その場合は vault.update_secret を使う。
select vault.create_secret('https://<あなたのVercelドメイン>/api/publishDue', 'publish_due_url');
select vault.create_secret('<CRON_SECRETと同じ値>', 'publish_due_secret');

select cron.schedule(
  'publish-due-x-posts',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'publish_due_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'publish_due_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- pg_net はリクエストと応答を net._http_response に貯め続ける。毎分実行だと肥大化するので、
-- 6時間より古い記録を1日1回消す。
select cron.schedule(
  'purge-net-responses',
  '17 4 * * *',
  $$ delete from net._http_response where created < now() - interval '6 hours' $$
);

-- 確認用:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
--   select id, status_code, error_msg, created from net._http_response order by created desc limit 20;
