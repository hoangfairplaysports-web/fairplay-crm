-- =====================================================================
-- Migration 07 - Bảng giá nhà cung cấp
-- Mỗi NCC có danh sách hạng mục + đơn giá; chọn NCC ở tab "Hạng mục & NCC" là tự điền giá nhập.
-- Quyền như danh bạ NCC: xem = người có quyền tài chính, sửa = Admin / Kế toán. Chạy lại nhiều lần an toàn.
-- =====================================================================
alter table public.ev_suppliers add column if not exists region text;   -- Miền Bắc / Miền Nam / Cả nước

create table if not exists public.ev_supplier_prices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.ev_suppliers (id) on delete cascade,
  category text,        -- Trọng tài, In ấn - sân khấu, Media, Đồ thi đấu…
  grp text,             -- nhóm con trong bảng giá (VD môn: Bóng đá, Pickleball)
  item text not null,   -- tên hạng mục
  detail text,
  unit text,
  price numeric,        -- đơn giá (giá thấp nếu là khoảng giá)
  price_max numeric,    -- giá cao nếu NCC báo khoảng giá
  note text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ev_supplier_prices_supplier_idx on public.ev_supplier_prices (supplier_id, sort);

alter table public.ev_supplier_prices enable row level security;
drop policy if exists ev_supplier_prices_fin_select on public.ev_supplier_prices;
drop policy if exists ev_supplier_prices_fin_insert on public.ev_supplier_prices;
drop policy if exists ev_supplier_prices_fin_update on public.ev_supplier_prices;
drop policy if exists ev_supplier_prices_fin_delete on public.ev_supplier_prices;
create policy ev_supplier_prices_fin_select on public.ev_supplier_prices for select to authenticated using (public.can_see_finance());
create policy ev_supplier_prices_fin_insert on public.ev_supplier_prices for insert to authenticated with check (public.can_edit_finance());
create policy ev_supplier_prices_fin_update on public.ev_supplier_prices for update to authenticated using (public.can_edit_finance()) with check (public.can_edit_finance());
create policy ev_supplier_prices_fin_delete on public.ev_supplier_prices for delete to authenticated using (public.can_edit_finance());
grant select, insert, update, delete on public.ev_supplier_prices to authenticated;
