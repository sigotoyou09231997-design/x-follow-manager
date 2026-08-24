-- アプリの更新を検知してプッシュ通知するcronジョブ。
-- 002_publish_cron.sql と同じ仕組み（pg_cron から Vercel Functions を叩く）で、
-- こちらは2分おきに /api/checkAppUpdate を呼ぶ。
--
-- 実行前に下の <> 部分を自分の値に置き換えること。
-- 002 を実行済みなら pg_cron / pg_net の作成と publish_due_secret は共通なので、
-- URL用のシークレットだけ追加すればよい。

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://<あなたのVercelドメイン>/api/checkAppUpdate', 'check_app_update_url');
-- CRON_SECRET は 002 で 'publish_due_secret' として登録済みならそれを使い回すので、
-- 下の1行は 002 を実行していない場合だけ必要。
-- select vault.create_secret('<CRON_SECRETと同じ値>', 'publish_due_secret');

select cron.schedule(
  'check-app-update',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'check_app_update_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'publish_due_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- 確認用:
--   select * from cron.job;
--   select * from public.app_version_state;
--   select id, status_code, content, created from net._http_response order by created desc limit 10;
