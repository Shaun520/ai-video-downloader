-- =====================================================================
-- 0003: video_transcripts 表 —— 字幕/转写结果缓存
-- 用途：避免 summarize / chat / mindmap / subtitle 四个入口对同一视频
--       重复提取（抖音走 ASR 转写，重复一次 ≈ 12s + 一次计费）。
--       正缓存（有字幕）7 天有效；负缓存（无字幕/转写失败）1 天有效。
-- 在 Supabase 控制台 → SQL Editor → New query 中整段粘贴并运行（Run）
-- =====================================================================

create table if not exists public.video_transcripts (
  url text primary key,                                    -- 规范化后的视频链接（缓存键）
  has_subtitle boolean not null default false,
  language text not null default '',
  subtitle_type text not null default 'none'
    check (subtitle_type in ('manual', 'auto', 'none')),
  segments jsonb not null default '[]'::jsonb,             -- [{start, end, text}]
  full_text text not null default '',                      -- 完整字幕/转写文本
  created_at timestamptz not null default now()
);

-- ---------- RLS：登录用户可读/写共享缓存（视频本身是公开内容） ----------
alter table public.video_transcripts enable row level security;

drop policy if exists "video_transcripts_select_auth" on public.video_transcripts;
create policy "video_transcripts_select_auth" on public.video_transcripts
  for select using (auth.uid() is not null);

drop policy if exists "video_transcripts_insert_auth" on public.video_transcripts;
create policy "video_transcripts_insert_auth" on public.video_transcripts
  for insert with check (auth.uid() is not null);

drop policy if exists "video_transcripts_update_auth" on public.video_transcripts;
create policy "video_transcripts_update_auth" on public.video_transcripts
  for update using (auth.uid() is not null);

drop policy if exists "video_transcripts_delete_auth" on public.video_transcripts;
create policy "video_transcripts_delete_auth" on public.video_transcripts
  for delete using (auth.uid() is not null);

-- ---------- 表权限 ----------
grant select, insert, update, delete on public.video_transcripts to service_role;
grant select, insert, update, delete on public.video_transcripts to authenticated;
grant select on public.video_transcripts to anon;