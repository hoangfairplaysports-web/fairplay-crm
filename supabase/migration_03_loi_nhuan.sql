-- =====================================================================
-- Migration 03 - Lợi nhuận giải đấu + Lợi nhuận tháng + quyền tài chính
-- Chạy trong Supabase SQL Editor (dán toàn bộ → Run). Chạy lại nhiều lần vẫn an toàn.
-- Chỉ THÊM bảng / cột / hàm; quyền đọc tiền của các bảng ev_* chuyển từ "Admin" sang "người có quyền tài chính".
-- Cần chạy SAU các migration Triển khai giải (03 → 05) của repo fairplay-checklist.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Quyền tài chính: chỉ người được bật finance_access mới xem tiền, giá nhập, lợi nhuận
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists finance_access boolean not null default false;

create or replace function public.can_see_finance() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select finance_access from public.profiles where id = auth.uid() and active), false)
$$;
grant execute on function public.can_see_finance() to authenticated;

-- Người dùng không tự bật được quyền tài chính cho mình (chỉ chạy SQL / Admin bật)
create or replace function public.profiles_finance_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and new.finance_access is distinct from old.finance_access and not public.can_see_finance() then
    new.finance_access := old.finance_access;
  end if;
  return new;
end $$;
drop trigger if exists profiles_finance_guard on public.profiles;
create trigger profiles_finance_guard before update on public.profiles for each row execute function public.profiles_finance_guard();

-- Bật cho Admin (Ngọc Hoàng) và anh Tuấn Minh. KIỂM TRA LẠI họ tên trước khi chạy:
--   select id, full_name, email, role from public.profiles;
update public.profiles set finance_access = true
where full_name in ('Ngọc Hoàng', 'MR Tuấn minh') and finance_access = false;

-- ---------------------------------------------------------------------
-- 2. Cột mới cho tính lãi
-- ---------------------------------------------------------------------
-- Cấp giải: tỉ lệ phí quản lý, VAT, thuế TNCN công ty chịu thay CTV
alter table public.ev_events add column if not exists fee_rate numeric;          -- trống = lấy từ báo giá, mặc định 10%
alter table public.ev_events add column if not exists vat_rate numeric;          -- trống = 8%
alter table public.ev_events add column if not exists pit_on boolean not null default false;  -- công ty chịu thuế TNCN thay CTV
alter table public.ev_events add column if not exists pit_rate numeric;          -- trống = 10%
alter table public.ev_events add column if not exists pit_threshold numeric;     -- trống = 2.000.000 / lần trả / người
alter table public.ev_events add column if not exists acceptance_imported_at timestamptz;

-- Cấp hạng mục: số liệu theo nghiệm thu (giữ nguyên số báo giá gốc)
alter table public.ev_items add column if not exists not_used boolean not null default false;  -- hạng mục không sử dụng: trừ khỏi doanh thu
alter table public.ev_items add column if not exists accept_amount numeric;      -- thành tiền theo nghiệm thu (trống = theo báo giá)
alter table public.ev_items add column if not exists accept_unit_cost numeric;   -- đơn giá trả NCC theo nghiệm thu
alter table public.ev_items add column if not exists payee_type text;            -- ctv | invoice | self
alter table public.ev_items drop constraint if exists ev_items_payee_type_check;
alter table public.ev_items add constraint ev_items_payee_type_check check (payee_type is null or payee_type in ('ctv', 'invoice', 'self'));

-- ---------------------------------------------------------------------
-- 3. Chi phí cố định theo tháng (nhân sự, BH, văn phòng, quảng cáo, khác, thuế TNDN)
-- ---------------------------------------------------------------------
create table if not exists public.fin_months (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),   -- 2026-08
  data jsonb not null default '{}'::jsonb,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.fin_months enable row level security;
drop policy if exists fin_months_finance on public.fin_months;
create policy fin_months_finance on public.fin_months for all to authenticated
  using (public.can_see_finance()) with check (public.can_see_finance());
grant select, insert, update, delete on public.fin_months to authenticated;

-- ---------------------------------------------------------------------
-- 4. Tiền của Triển khai giải: ĐỌC = người có quyền tài chính; SỬA = Admin (như cũ)
--    (trước đây cả đọc và sửa đều theo ev_is_admin())
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['ev_items', 'ev_payments', 'ev_suppliers', 'ev_files'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('drop policy if exists %I on public.%I', t || '_fin_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_see_finance())', t || '_fin_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.ev_is_admin())', t || '_admin_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.ev_is_admin()) with check (public.ev_is_admin())', t || '_admin_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.ev_is_admin())', t || '_admin_delete', t);
  end loop;
end $$;

-- Bảng giải gốc (có cột tiền): đọc = quyền tài chính; nhân viên xem qua view ev_events_public (không có cột tiền)
drop policy if exists ev_events_select on public.ev_events;
drop policy if exists ev_events_write on public.ev_events;
drop policy if exists ev_events_admin_insert on public.ev_events;
drop policy if exists ev_events_admin_update on public.ev_events;
drop policy if exists ev_events_admin_delete on public.ev_events;
create policy ev_events_select on public.ev_events for select to authenticated using (public.can_see_finance());
create policy ev_events_admin_insert on public.ev_events for insert to authenticated with check (public.ev_is_admin());
create policy ev_events_admin_update on public.ev_events for update to authenticated using (public.ev_is_admin()) with check (public.ev_is_admin());
create policy ev_events_admin_delete on public.ev_events for delete to authenticated using (public.ev_is_admin());

-- Kho file hồ sơ (hợp đồng, báo giá, nghiệm thu): đọc = quyền tài chính, ghi = Admin
drop policy if exists ev_files_admin on storage.objects;
drop policy if exists ev_files_fin_read on storage.objects;
drop policy if exists ev_files_admin_write on storage.objects;
drop policy if exists ev_files_admin_change on storage.objects;
drop policy if exists ev_files_admin_remove on storage.objects;
create policy ev_files_fin_read on storage.objects for select to authenticated
  using (bucket_id = 'ev-files' and public.can_see_finance());
create policy ev_files_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'ev-files' and public.ev_is_admin());
create policy ev_files_admin_change on storage.objects for update to authenticated
  using (bucket_id = 'ev-files' and public.ev_is_admin()) with check (bucket_id = 'ev-files' and public.ev_is_admin());
create policy ev_files_admin_remove on storage.objects for delete to authenticated
  using (bucket_id = 'ev-files' and public.ev_is_admin());

-- Kiểm tra sau khi chạy:
--   select full_name, role, finance_access from public.profiles order by finance_access desc;
