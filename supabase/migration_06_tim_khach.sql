-- =====================================================================
-- Migration 06 - Tìm khách hàng mới (training "Cả team cùng tìm khách hàng mới")
-- Doanh nghiệp tiềm năng dùng chung bảng customers (lọc trùng một chỗ), người liên hệ dùng contacts,
-- chuỗi 14 ngày lưu ở prospect_touches. Checklist đọc số liệu qua hàm cl_crm_stats().
-- Chỉ THÊM cột / bảng / hàm. Chạy lại nhiều lần an toàn.
-- =====================================================================

-- 1. Doanh nghiệp tiềm năng (cột thêm vào customers; p_status trống = khách hàng thường)
alter table public.customers add column if not exists tier text;
alter table public.customers add column if not exists staff_size int;
alter table public.customers add column if not exists website text;
alter table public.customers add column if not exists linkedin text;
alter table public.customers add column if not exists north_office boolean;
alter table public.customers add column if not exists p_source text;
alter table public.customers add column if not exists signal text;
alter table public.customers add column if not exists signal_date date;
alter table public.customers add column if not exists event_season text;
alter table public.customers add column if not exists budget_month text;
alter table public.customers add column if not exists p_status text;
alter table public.customers add column if not exists p_added_at timestamptz;
alter table public.customers add column if not exists first_touch_at timestamptz;
alter table public.customers add column if not exists replied_at timestamptz;
alter table public.customers add column if not exists meeting_at timestamptz;
alter table public.customers add column if not exists brief_at timestamptz;
alter table public.customers add column if not exists recall_month date;
alter table public.customers add column if not exists unfit_reason text;
alter table public.customers add column if not exists do_not_contact boolean not null default false;
alter table public.customers drop constraint if exists customers_tier_check;
alter table public.customers add constraint customers_tier_check check (tier is null or tier in ('A', 'B', 'C'));
alter table public.customers drop constraint if exists customers_p_status_check;
alter table public.customers add constraint customers_p_status_check
  check (p_status is null or p_status in ('new', 'touching', 'replied', 'meeting', 'brief', 'recall', 'unfit'));
create index if not exists customers_p_status_idx on public.customers (p_status) where p_status is not null;

-- 2. Người liên hệ: vai trò 1-2-3, LinkedIn, nguồn thông tin, chuỗi 14 ngày
alter table public.contacts add column if not exists role_level smallint;
alter table public.contacts add column if not exists linkedin text;
alter table public.contacts add column if not exists li_connected boolean not null default false;
alter table public.contacts add column if not exists info_source text;
alter table public.contacts add column if not exists seq_started_at timestamptz;
alter table public.contacts add column if not exists seq_status text;
alter table public.contacts add column if not exists replied_at timestamptz;
alter table public.contacts add column if not exists do_not_contact boolean not null default false;
alter table public.contacts drop constraint if exists contacts_role_level_check;
alter table public.contacts add constraint contacts_role_level_check check (role_level is null or role_level in (1, 2, 3));
alter table public.contacts drop constraint if exists contacts_seq_status_check;
alter table public.contacts add constraint contacts_seq_status_check check (seq_status is null or seq_status in ('running', 'stopped', 'done'));

-- 3. Lần chạm của chuỗi 14 ngày (ngày 1, 2, 5, 8, 14)
create table if not exists public.prospect_touches (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  step smallint not null,
  day_no smallint not null,
  channel text not null,
  template_key text,
  due_date date not null,
  done_at timestamptz,
  done_by uuid references public.profiles (id) on delete set null,
  skipped boolean not null default false,
  note text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists prospect_touches_due_idx on public.prospect_touches (due_date) where done_at is null and not skipped;
create index if not exists prospect_touches_customer_idx on public.prospect_touches (customer_id);
alter table public.prospect_touches enable row level security;
drop policy if exists prospect_touches_select on public.prospect_touches;
create policy prospect_touches_select on public.prospect_touches for select to authenticated using (public.is_member());
drop policy if exists prospect_touches_insert on public.prospect_touches;
create policy prospect_touches_insert on public.prospect_touches for insert to authenticated with check (public.is_member());
drop policy if exists prospect_touches_update on public.prospect_touches;
create policy prospect_touches_update on public.prospect_touches for update to authenticated using (public.is_member()) with check (public.is_member());
drop policy if exists prospect_touches_delete on public.prospect_touches;
create policy prospect_touches_delete on public.prospect_touches for delete to authenticated using (public.is_member());
grant select, insert, update, delete on public.prospect_touches to authenticated;

-- 4. Cài đặt: ngành + người phụ trách, mẫu tin nhắn, chỉ tiêu
alter table public.settings add column if not exists industries jsonb;
alter table public.settings add column if not exists msg_templates jsonb;
alter table public.settings add column if not exists prospect_targets jsonb;

-- 5. Người đang phụ trách doanh nghiệp TIỀM NĂNG được tự chuyển cho người phụ trách ngành khác
--    (khách hàng thường vẫn chỉ Trưởng KD / Admin được giao)
create or replace function public.customers_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and not public.is_manager() then
    if tg_op = 'INSERT' then
      new.owner_id := auth.uid();
    elsif new.owner_id is distinct from old.owner_id
      and not (old.p_status is not null and old.owner_id = auth.uid()) then
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

-- 6. Số liệu tiếp cận cho Fairplay Checklist (KPI tự đếm, báo cáo ngày, tab Tuần này)
--    Mỗi người chỉ xem số của mình; Admin / BOD của Checklist và Admin / Trưởng KD của CRM xem tất cả.
alter table public.cl_kpis add column if not exists crm_metric text;

create or replace function public.cl_crm_stats(p_from date, p_to date)
returns table (person_id uuid, day date, metric text, n bigint)
language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as uid,
           (coalesce(public.cl_is_viewer(), false) or coalesce(public.is_manager(), false)) as see_all
  ),
  rows as (
    select c.owner_id as person_id, (c.first_touch_at at time zone 'Asia/Ho_Chi_Minh')::date as day, 'new_companies'::text as metric
      from public.customers c where c.first_touch_at is not null
    union all
    select c.owner_id, (c.replied_at at time zone 'Asia/Ho_Chi_Minh')::date, 'replies' from public.customers c where c.replied_at is not null
    union all
    select c.owner_id, (c.meeting_at at time zone 'Asia/Ho_Chi_Minh')::date, 'meetings' from public.customers c where c.meeting_at is not null
    union all
    select c.owner_id, (c.brief_at at time zone 'Asia/Ho_Chi_Minh')::date, 'briefs' from public.customers c where c.brief_at is not null
    union all
    select c.owner_id, (c.p_added_at at time zone 'Asia/Ho_Chi_Minh')::date, 'added' from public.customers c where c.p_added_at is not null
    union all
    select c.owner_id, (k.seq_started_at at time zone 'Asia/Ho_Chi_Minh')::date, 'sequences'
      from public.contacts k join public.customers c on c.id = k.customer_id where k.seq_started_at is not null
    union all
    select t.done_by, (t.done_at at time zone 'Asia/Ho_Chi_Minh')::date, 'touches' from public.prospect_touches t where t.done_at is not null
    union all
    -- Lần chạm đến hạn (tính cho người phụ trách doanh nghiệp) và số làm đúng hạn
    select c.owner_id, t.due_date, 'touch_due'
      from public.prospect_touches t join public.customers c on c.id = t.customer_id
     where not t.skipped and (t.due_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date or t.done_at is not null)
    union all
    select c.owner_id, t.due_date, 'touch_ontime'
      from public.prospect_touches t join public.customers c on c.id = t.customer_id
     where t.done_at is not null and not t.skipped and (t.done_at at time zone 'Asia/Ho_Chi_Minh')::date <= t.due_date
  )
  select r.person_id, r.day, r.metric, count(*)::bigint
    from rows r, me
   where r.person_id is not null and r.day between p_from and p_to
     and (me.see_all or r.person_id = me.uid)
   group by 1, 2, 3
$$;
grant execute on function public.cl_crm_stats(date, date) to authenticated;
