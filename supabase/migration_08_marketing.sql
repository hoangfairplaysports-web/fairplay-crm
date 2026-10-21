-- =====================================================================
-- Migration 08 - Vai trò Marketing
--   Tìm khách mới: làm đầy đủ với doanh nghiệp mình phụ trách, xem danh sách chung để lọc trùng.
--   Lead: chỉ xem lead từ kênh Marketing (Facebook Ads, Lead Form, Website) + lead do mình tạo / được giao;
--         chỉ sửa lead của mình (VD lead tạo từ brief). Không giao, không xoá.
--   Khách hàng, giải đấu: chỉ xem; đầu mối (SĐT, email) của khách cũ bị ẩn; quà tặng ẩn.
--   Tiền (Triển khai giải, Lợi nhuận) đã ẩn sẵn vì không có quyền tài chính.
-- Chạy lại nhiều lần an toàn.
-- =====================================================================
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'manager', 'sales', 'accountant', 'marketing'));

create or replace function public.is_mkt() returns boolean
language sql stable as $$ select coalesce(public.my_role() = 'marketing', false) $$;

create or replace function public.mkt_source(src text) returns boolean
language sql immutable as $$ select coalesce(src ilike 'facebook%' or src = 'Website', false) $$;

-- Doanh nghiệp tiềm năng (p_status có giá trị) thì Marketing được thấy đầu mối và lịch sử
create or replace function public.is_prospect(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p_status is not null from public.customers where id = cid), false)
$$;

-- Lead
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated using (
  public.is_member() and (not public.is_mkt() or public.mkt_source(source) or created_by = auth.uid() or assignee_id = auth.uid()));
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using (public.is_member() and (not public.is_mkt() or created_by = auth.uid() or assignee_id = auth.uid()))
  with check (public.is_member() and (not public.is_mkt() or created_by = auth.uid() or assignee_id = auth.uid()));

-- Lịch sử tương tác: Marketing chỉ thấy lịch sử của lead mình thấy và của doanh nghiệp tiềm năng
drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select to authenticated using (
  public.is_member() and (not public.is_mkt()
    or (lead_id is not null and exists (select 1 from public.leads l where l.id = lead_id))
    or (customer_id is not null and public.is_prospect(customer_id))));
drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities for insert to authenticated with check (
  public.is_member() and created_by = auth.uid() and (not public.is_mkt()
    or (lead_id is not null and exists (select 1 from public.leads l where l.id = lead_id and (l.created_by = auth.uid() or l.assignee_id = auth.uid())))
    or (customer_id is not null and public.is_prospect(customer_id))));

-- Khách hàng: Marketing xem tất cả (lọc trùng), chỉ sửa doanh nghiệp tiềm năng mình phụ trách
drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers for update to authenticated
  using (public.is_member() and (not public.is_mkt() or (p_status is not null and owner_id = auth.uid())))
  with check (public.is_member() and (not public.is_mkt() or p_status is not null));
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert to authenticated
  with check (public.is_member() and (not public.is_mkt() or p_status is not null));

-- Đầu mối: Marketing chỉ thấy / sửa người liên hệ của doanh nghiệp tiềm năng
drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts for select to authenticated
  using (public.is_member() and (not public.is_mkt() or public.is_prospect(customer_id)));
drop policy if exists contacts_insert on public.contacts;
create policy contacts_insert on public.contacts for insert to authenticated
  with check (public.is_member() and (not public.is_mkt() or public.is_prospect(customer_id)));
drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts for update to authenticated
  using (public.is_member() and (not public.is_mkt() or public.is_prospect(customer_id)))
  with check (public.is_member() and (not public.is_mkt() or public.is_prospect(customer_id)));

-- Giải đấu (CRM): Marketing chỉ xem
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated with check (public.is_member() and not public.is_mkt());
drop policy if exists events_update on public.events;
create policy events_update on public.events for update to authenticated
  using (public.is_member() and not public.is_mkt()) with check (public.is_member() and not public.is_mkt());

-- Quà tặng: ẩn với Marketing
drop policy if exists gifts_select on public.gifts;
create policy gifts_select on public.gifts for select to authenticated using (public.is_member() and not public.is_mkt());
drop policy if exists gifts_insert on public.gifts;
create policy gifts_insert on public.gifts for insert to authenticated with check (public.is_member() and not public.is_mkt());
drop policy if exists gifts_update on public.gifts;
create policy gifts_update on public.gifts for update to authenticated
  using (public.is_member() and not public.is_mkt()) with check (public.is_member() and not public.is_mkt());
