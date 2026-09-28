-- =====================================================================
-- Giải đấu: mở rộng bảng events theo cột của sheet "DS Giải đấu"
-- (đã gộp vào schema.sql; file này dùng cho project đã chạy schema cũ)
-- =====================================================================
alter table public.events add column if not exists phase text;
alter table public.events add column if not exists pic_id uuid references public.profiles (id) on delete set null;
alter table public.events add column if not exists date_text text;
alter table public.events add column if not exists next_action text;
alter table public.events add column if not exists link text;
alter table public.events add column if not exists updated_at timestamptz not null default now();

alter table public.events drop constraint if exists events_status_check;
update public.events set status = 'in_progress' where status = 'upcoming';
update public.events set status = 'completed' where status = 'done';
alter table public.events alter column status set default 'negotiating';
alter table public.events add constraint events_status_check
  check (status in ('negotiating', 'not_started', 'in_progress', 'blocked', 'completed', 'cancelled'));
alter table public.events drop constraint if exists events_phase_check;
alter table public.events add constraint events_phase_check
  check (phase is null or phase in ('before', 'eventday', 'ongoing', 'after', 'done'));
create index if not exists events_pic_idx on public.events (pic_id);

create or replace function public.events_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events
  for each row execute function public.events_touch();
