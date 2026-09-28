-- =====================================================================
-- Fairplay CRM — cấu trúc dữ liệu + phân quyền
-- Chạy 1 lần trong Supabase: SQL Editor → New query → dán toàn bộ → Run
-- =====================================================================

-- ---------- Thành viên ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  full_name text,
  role text not null default 'sales' check (role in ('admin', 'manager', 'sales')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Tài khoản đầu tiên tạo ra tự động là admin, các tài khoản sau là sales
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles) then 'sales' else 'admin' end
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_member() returns boolean
language sql stable as $$ select public.my_role() is not null $$;

create or replace function public.is_manager() returns boolean
language sql stable as $$ select coalesce(public.my_role() in ('admin', 'manager'), false) $$;

-- ---------- Lead ----------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  customer_type text,
  phone text,
  email text,
  facebook text,
  source text,
  need text,
  region text,
  headcount int,
  event_time text,
  stage text not null default 'new'
    check (stage in ('new', 'contacted', 'consulting', 'quoted', 'negotiating', 'won', 'lost')),
  lost_reason text,
  assignee_id uuid references public.profiles (id) on delete set null,
  next_followup date,
  last_activity_at timestamptz not null default now(),
  notes text,
  external_id text unique,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.leads add column if not exists facebook text;
create index if not exists leads_phone_idx on public.leads (phone);
create index if not exists leads_assignee_idx on public.leads (assignee_id);

-- Luật nghiệp vụ: chỉ Trưởng KD/Admin được giao lead; thất bại phải có lý do
create or replace function public.leads_guard() returns trigger
language plpgsql as $$
begin
  new.phone := nullif(regexp_replace(coalesce(new.phone, ''), '[^0-9+]', '', 'g'), '');
  if auth.uid() is not null and not public.is_manager() then
    if tg_op = 'INSERT' then
      -- Lead của khách cũ → tự giao cho người phụ trách khách đó; còn lại vào hàng chờ
      new.assignee_id := case when new.customer_id is null then null
        else (select owner_id from public.customers where id = new.customer_id) end;
    elsif new.assignee_id is distinct from old.assignee_id then
      raise exception 'Chỉ Trưởng KD hoặc Admin được giao lead';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if new.stage = 'lost' and coalesce(trim(new.lost_reason), '') = '' then
    raise exception 'Cần ghi lý do thất bại';
  end if;
  return new;
end $$;

drop trigger if exists leads_guard on public.leads;
create trigger leads_guard before insert or update on public.leads
  for each row execute function public.leads_guard();

-- ---------- Lịch sử tương tác ----------
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  type text not null default 'note',
  content text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists activities_lead_idx on public.activities (lead_id, created_at desc);

create or replace function public.touch_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.leads set last_activity_at = new.created_at where id = new.lead_id;
  return new;
end $$;

drop trigger if exists activities_touch on public.activities;
create trigger activities_touch after insert on public.activities
  for each row execute function public.touch_lead();

-- ---------- Cài đặt chung ----------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  stale_days int not null default 7,
  sources jsonb,
  needs jsonb,
  regions jsonb,
  customer_types jsonb,
  lost_reasons jsonb,
  email_subject text,
  email_body text,
  zalo_template text,
  email_client text default 'gmail'
);
insert into public.settings (id) values (1) on conflict do nothing;

-- ---------- Phân quyền (Row Level Security) ----------
alter table public.profiles enable row level security;
alter table public.leads enable row level security;
alter table public.activities enable row level security;
alter table public.settings enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_member());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- Cả phòng KD xem và sửa được mọi lead; chỉ Trưởng KD/Admin được xoá
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated using (public.is_member());
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert to authenticated with check (public.is_member());
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using (public.is_member()) with check (public.is_member());
drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated using (public.is_manager());

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select to authenticated using (public.is_member());
drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities for insert to authenticated
  with check (public.is_member() and created_by = auth.uid());
drop policy if exists activities_delete on public.activities;
create policy activities_delete on public.activities for delete to authenticated using (public.is_manager());

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated using (public.is_member());
drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- =====================================================================
-- KHÁCH HÀNG & CHĂM SÓC (phần mở rộng — chạy lại cả file cũng an toàn)
-- =====================================================================

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  customer_type text,
  industry text,
  region text,
  address text,
  notes text,
  owner_id uuid references public.profiles (id) on delete set null,
  next_care date,
  last_care_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  name text not null,
  title text,
  gender text,
  phone text,
  email text,
  facebook text,
  birthday date,
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists contacts_customer_idx on public.contacts (customer_id);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  name text not null,
  sport text,
  event_date date,
  venue text,
  headcount int,
  status text not null default 'done' check (status in ('upcoming', 'done', 'cancelled')),
  notes text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists events_customer_idx on public.events (customer_id);

create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  occasion text not null,
  occasion_key text,
  gift text,
  gift_date date,
  status text not null default 'planned' check (status in ('planned', 'given', 'skipped')),
  notes text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists gifts_customer_idx on public.gifts (customer_id);

alter table public.leads add column if not exists customer_id uuid references public.customers (id) on delete set null;
alter table public.activities alter column lead_id drop not null;
alter table public.activities add column if not exists customer_id uuid references public.customers (id) on delete cascade;
create index if not exists activities_customer_idx on public.activities (customer_id, created_at desc);

alter table public.settings add column if not exists care_stale_days int not null default 60;
alter table public.settings add column if not exists loyal_threshold int not null default 2;
alter table public.settings add column if not exists vip_threshold int not null default 4;
alter table public.settings add column if not exists season_days int not null default 90;
alter table public.settings add column if not exists occasions jsonb;

-- Ghi tương tác vào khách hàng → cập nhật "lần chăm sóc cuối"
create or replace function public.touch_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.lead_id is not null then
    update public.leads set last_activity_at = new.created_at where id = new.lead_id;
  end if;
  if new.customer_id is not null then
    update public.customers set last_care_at = new.created_at where id = new.customer_id;
  end if;
  return new;
end $$;

-- Chỉ Trưởng KD/Admin được đổi người phụ trách khách hàng
create or replace function public.customers_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and not public.is_manager() then
    if tg_op = 'INSERT' then
      new.owner_id := auth.uid();
    elsif new.owner_id is distinct from old.owner_id then
      raise exception 'Chỉ Trưởng KD hoặc Admin được giao người phụ trách khách hàng';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists customers_guard on public.customers;
create trigger customers_guard before insert or update on public.customers
  for each row execute function public.customers_guard();

create or replace function public.contacts_clean() returns trigger
language plpgsql as $$
begin
  new.phone := nullif(regexp_replace(coalesce(new.phone, ''), '[^0-9+]', '', 'g'), '');
  return new;
end $$;
drop trigger if exists contacts_clean on public.contacts;
create trigger contacts_clean before insert or update on public.contacts
  for each row execute function public.contacts_clean();

-- Phân quyền: cả phòng KD xem/thêm/sửa; chỉ Trưởng KD/Admin được xoá
do $$
declare t text;
begin
  foreach t in array array['customers', 'contacts', 'events', 'gifts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member())', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_member())', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_member()) with check (public.is_member())', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_manager())', t || '_delete', t);
  end loop;
end $$;
