-- =====================================================================
-- Migration 04 - Vai trò Kế toán
-- Kế toán: xem toàn bộ số tiền (giá trị báo giá, thu khách, trả NCC, giá nhập, lợi nhuận)
--          và NHẬP / SỬA được số tiền: thu tiền khách, hạng mục & NCC, phát sinh, nghiệm thu, hồ sơ, chi phí tháng.
-- Không được: vào Cài đặt, tạo / xoá giải, nhập báo giá, sửa thông tin chung của giải, giao việc checklist.
-- Chạy lại nhiều lần an toàn.
-- =====================================================================

-- 1. Thêm vai trò 'accountant'
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'manager', 'sales', 'accountant'));

-- Đổi vai trò sang Kế toán → tự bật quyền tài chính; đổi khỏi Kế toán → tự tắt
create or replace function public.profiles_role_finance() returns trigger
language plpgsql as $$
begin
  if new.role = 'accountant' then
    new.finance_access := true;
  elsif tg_op = 'UPDATE' and old.role = 'accountant' then
    new.finance_access := false;
  end if;
  return new;
end $$;
drop trigger if exists profiles_role_finance on public.profiles;
create trigger profiles_role_finance before insert or update on public.profiles
  for each row execute function public.profiles_role_finance();

-- 2. Ai được nhập / sửa tiền: Admin hoặc Kế toán (còn hoạt động, có quyền tài chính)
create or replace function public.can_edit_finance() returns boolean
language sql stable security definer set search_path = public as $$
  select public.ev_is_admin()
      or coalesce((select role = 'accountant' and finance_access from public.profiles
                   where id = auth.uid() and active and crm_access), false)
$$;
grant execute on function public.can_edit_finance() to authenticated;

-- 3. Bảng tiền: thêm / sửa = Admin hoặc Kế toán; xoá hạng mục, thanh toán, NCC, hồ sơ cũng cho Kế toán
do $$
declare t text;
begin
  foreach t in array array['ev_items', 'ev_payments', 'ev_suppliers', 'ev_files'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_delete', t);
    execute format('drop policy if exists %I on public.%I', t || '_fin_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_fin_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_fin_delete', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_edit_finance())', t || '_fin_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_edit_finance()) with check (public.can_edit_finance())', t || '_fin_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_edit_finance())', t || '_fin_delete', t);
  end loop;
end $$;

-- Kho file hồ sơ (hợp đồng, báo giá, nghiệm thu, chứng từ)
drop policy if exists ev_files_admin_write on storage.objects;
drop policy if exists ev_files_admin_change on storage.objects;
drop policy if exists ev_files_admin_remove on storage.objects;
drop policy if exists ev_files_fin_write on storage.objects;
drop policy if exists ev_files_fin_change on storage.objects;
drop policy if exists ev_files_fin_remove on storage.objects;
create policy ev_files_fin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'ev-files' and public.can_edit_finance());
create policy ev_files_fin_change on storage.objects for update to authenticated
  using (bucket_id = 'ev-files' and public.can_edit_finance()) with check (bucket_id = 'ev-files' and public.can_edit_finance());
create policy ev_files_fin_remove on storage.objects for delete to authenticated
  using (bucket_id = 'ev-files' and public.can_edit_finance());

-- 4. Giải: Kế toán sửa được, nhưng trigger chỉ giữ lại thay đổi ở các cột tiền / nghiệm thu
--    (tạo / xoá giải vẫn chỉ Admin)
drop policy if exists ev_events_admin_update on public.ev_events;
drop policy if exists ev_events_fin_update on public.ev_events;
create policy ev_events_fin_update on public.ev_events for update to authenticated
  using (public.can_edit_finance()) with check (public.can_edit_finance());

create or replace function public.ev_events_accountant_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and not public.ev_is_admin() then
    new.name := old.name; new.client_name := old.client_name; new.customer_id := old.customer_id;
    new.sport := old.sport; new.venue := old.venue; new.event_date := old.event_date; new.end_date := old.end_date;
    new.headcount := old.headcount; new.status := old.status; new.pm_id := old.pm_id;
    new.client_contact := old.client_contact; new.contract_signed_at := old.contract_signed_at;
    new.contract_deadline := old.contract_deadline; new.contract_note := old.contract_note;
    new.source_file := old.source_file; new.notes := old.notes; new.created_by := old.created_by;
  end if;
  return new;
end $$;
drop trigger if exists ev_events_accountant_guard on public.ev_events;
create trigger ev_events_accountant_guard before update on public.ev_events
  for each row execute function public.ev_events_accountant_guard();

-- 5. Thêm phát sinh / chọn Option sẽ tự sinh việc checklist → Kế toán được THÊM việc (không sửa / xoá)
drop policy if exists ev_tasks_fin_insert on public.ev_tasks;
create policy ev_tasks_fin_insert on public.ev_tasks for insert to authenticated with check (public.can_edit_finance());

-- Kiểm tra sau khi chạy:
--   select full_name, role, finance_access from public.profiles order by role;
