-- =====================================================================
-- SaveAny Supabase 初始化迁移
-- 用途：users / orders 表 + 新用户自动建 profile + RLS 行级安全
-- 在 Supabase 控制台 → SQL Editor → New query 中整段粘贴并运行（Run）
-- =====================================================================

-- ---------- 1. users 表（业务字段，主键关联 auth.users） ----------
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  is_vip boolean not null default false,
  vip_expire_at timestamptz,
  daily_summary_count integer not null default 0,
  last_summary_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- 2. orders 表 ----------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text unique not null,
  user_id uuid not null references public.users(id) on delete cascade,
  amount integer not null,
  currency text not null default 'cny',
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'canceled', 'refunded')),
  plan_type text not null default 'monthly'
    check (plan_type in ('monthly', 'yearly')),
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_user_id on public.orders(user_id);
create index if not exists idx_orders_order_no on public.orders(order_no);
create index if not exists idx_orders_stripe_session_id on public.orders(stripe_session_id);

-- ---------- 3. 新用户注册时自动创建 profile ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- 4. RLS 行级安全 ----------
alter table public.users enable row level security;
alter table public.orders enable row level security;

-- 用户只能读/改自己的资料
drop policy if exists "users_select_own" on public.users;
create policy "users_select_own" on public.users
  for select using (auth.uid() = id);

drop policy if exists "users_update_own" on public.users;
create policy "users_update_own" on public.users
  for update using (auth.uid() = id);

-- 用户只能看/下自己的订单
drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own" on public.orders
  for select using (auth.uid() = user_id);

drop policy if exists "orders_insert_own" on public.orders;
create policy "orders_insert_own" on public.orders
  for insert with check (auth.uid() = user_id);

-- 说明：service_role 密钥可绕过 RLS，仅用于 Admin/服务端；请勿暴露到前端。