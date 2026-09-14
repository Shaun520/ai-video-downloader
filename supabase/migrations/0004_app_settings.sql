-- =====================================================================
-- 0004: app_settings 表 —— 全站 AI 模型配置
-- 用途：admin 后台「模型配置」页写入，apps/web 运行时读取即时生效。
--       LLM（视频总结/思维导图/AI 问答）在 DeepSeek 官方与 DashScope 间切换，
--       模型名自由填写；ASR（抖音自动字幕）选择 paraformer 系列模型。
--       仅 service_role 可访问（禁用 anon/authenticated），API Key 仍走环境变量。
-- 在 Supabase 控制台 → SQL Editor → New query 中整段粘贴并运行（Run）
-- =====================================================================

create table if not exists public.app_settings (
  key text primary key,                            -- 如 llm.provider / llm.model / asr.model
  value jsonb not null default '{}'::jsonb,        -- 配置值（字符串/对象均可）
  updated_at timestamptz not null default now()
);

-- ---------- RLS：不建任何 policy，仅 service_role（绕过 RLS）可访问 ----------
alter table public.app_settings enable row level security;

grant select, insert, update, delete on public.app_settings to service_role;

-- ---------- 写入默认配置（已存在则不覆盖） ----------
insert into public.app_settings (key, value) values
  ('llm.provider', '"deepseek"'),
  ('llm.model', '"deepseek-chat"'),
  ('asr.model', '"paraformer-v2"')
on conflict (key) do nothing;