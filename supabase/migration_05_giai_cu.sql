-- =====================================================================
-- Migration 05 - Nhập giải đã triển khai (giải cũ) + xoá giải
-- Kế toán được TẠO giải (nhập giải cũ ở Lợi nhuận tháng, không tạo checklist)
-- và XOÁ giải do chính mình nhập. Admin xoá được mọi giải. Chạy lại nhiều lần an toàn.
-- =====================================================================
drop policy if exists ev_events_admin_insert on public.ev_events;
drop policy if exists ev_events_fin_insert on public.ev_events;
create policy ev_events_fin_insert on public.ev_events for insert to authenticated
  with check (public.can_edit_finance());

drop policy if exists ev_events_admin_delete on public.ev_events;
drop policy if exists ev_events_fin_delete on public.ev_events;
create policy ev_events_fin_delete on public.ev_events for delete to authenticated
  using (public.ev_is_admin() or (public.can_edit_finance() and created_by = auth.uid()));
