-- X のくり返し投稿（自動投稿タブの「X（くり返し）」。決めた文を、決めた間隔で X へ投稿する）を使えるようにする。
-- 005_autopost.sql・006_autopost_pause.sql を実行済みの前提。消す・作り替える操作は無い（投稿先の決まりを広げ、列を1つ足すだけ）。
--
-- 投稿はサーバー（publishDue の毎分の実行。api/_lib/xRepeat.ts）がする。Mac の投稿役は使わない。
-- 文・止める・状態（status）は、ディスコード・Yay と同じ表・同じ形で持つ。投稿先の名前は 'xrepeat'
-- （X の自動運転＝AI が文を作るほう、とは別物なので、名前をぶつけない）。

-- 1. 投稿先に 'xrepeat' を入れられるようにする（文の表と、止める表の両方）
alter table public.autopost_channels drop constraint if exists autopost_channels_channel_check;
alter table public.autopost_channels
  add constraint autopost_channels_channel_check check (channel in ('discord', 'yay', 'xrepeat'));

alter table public.autopost_pause drop constraint if exists autopost_pause_channel_check;
alter table public.autopost_pause
  add constraint autopost_pause_channel_check check (channel in ('discord', 'yay', 'xrepeat'));

-- 2. 投稿先ごとの設定。いまは xrepeat の間隔だけ（{"intervalMinutes": 60}）。無ければ画面・サーバーとも既定の60分
alter table public.autopost_channels add column if not exists settings jsonb;
