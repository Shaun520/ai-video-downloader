-- 0002: 补充表权限（service_role / anon / authenticated 均可按 RLS 访问）
-- 在 Supabase 控制台 SQL Editor 中执行本脚本即可

-- users / orders 表权限
grant select, insert, update, delete on public.users to service_role;
grant select, update on public.users to authenticated;
grant select on public.users to anon;

grant select, insert, update, delete on public.orders to service_role;
grant select, insert on public.orders to authenticated;
grant select on public.orders to anon;

-- 为后续新增表建立默认授权（可选，避免以后重复手补）
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant select, update on tables to authenticated;
alter default privileges in schema public grant select on tables to anon;