export const STAGES = [
  { id: 'new', label: 'Mới', color: '#64748b' },
  { id: 'contacted', label: 'Đã liên hệ', color: '#0ea5e9' },
  { id: 'consulting', label: 'Đang tư vấn', color: '#6366f1' },
  { id: 'quoted', label: 'Đã gửi báo giá', color: '#d97706' },
  { id: 'negotiating', label: 'Đàm phán', color: '#db2777' },
  { id: 'won', label: 'Chốt', color: '#16a34a' },
  { id: 'lost', label: 'Thất bại', color: '#9ca3af' },
];
export const OPEN_STAGES = ['new', 'contacted', 'consulting', 'quoted', 'negotiating'];
export const isOpen = (stage) => OPEN_STAGES.includes(stage);
export const stageOf = (id) => STAGES.find((s) => s.id === id) || STAGES[0];

export const ACTIVITY_TYPES = [
  { id: 'call', label: 'Gọi điện', icon: '📞' },
  { id: 'zalo', label: 'Zalo', icon: '💬' },
  { id: 'email', label: 'Email', icon: '✉️' },
  { id: 'meeting', label: 'Gặp / Họp', icon: '🤝' },
  { id: 'quote', label: 'Gửi báo giá / Profile', icon: '📄' },
  { id: 'note', label: 'Ghi chú', icon: '📝' },
];
const SYSTEM_TYPES = { stage: { label: 'Đổi giai đoạn', icon: '➡️' }, assign: { label: 'Giao lead', icon: '👤' }, create: { label: 'Tạo mới', icon: '✨' } };
export const activityType = (id) => ACTIVITY_TYPES.find((t) => t.id === id) || SYSTEM_TYPES[id] || { label: id, icon: '•' };

export const ROLES = { admin: 'Admin', manager: 'Trưởng KD', sales: 'Sale' };

export const DEFAULT_SETTINGS = {
  stale_days: 7,
  sources: ['Facebook Ads (tin nhắn)', 'Facebook Lead Form', 'Zalo', 'Website', 'Telesale', 'LinkedIn', 'Giới thiệu', 'Khách cũ', 'Khác'],
  needs: ['Pickleball', 'Bóng đá', 'Cầu lông', 'Hội thao', 'Chạy bộ', 'Tennis', 'Khác'],
  regions: ['Hà Nội', 'TP.HCM', 'Đà Nẵng', 'Hải Phòng', 'Tỉnh khác'],
  customer_types: ['Doanh nghiệp', 'Cá nhân / CLB', 'Trường học', 'Cơ quan nhà nước'],
  lost_reasons: ['Không phản hồi', 'Giá cao', 'Chọn đơn vị khác', 'Tự tổ chức', 'Hoãn / huỷ sự kiện', 'Không đúng nhu cầu', 'Khác'],
  email_subject: 'Fairplay Sports – Giải pháp tổ chức giải {nhu_cau}',
  email_body:
    'Chào anh/chị {ten},\n\nEm là {nhan_vien} từ Fairplay Sports – đơn vị chuyên tổ chức giải đấu thể thao doanh nghiệp.\n\nEm gửi anh/chị hồ sơ năng lực và một số giải bên em đã triển khai. Anh/chị cho em xin thời gian trao đổi ngắn để em tư vấn phương án phù hợp nhất nhé.\n\nTrân trọng,\n{nhan_vien}\nFairplay Sports',
  zalo_template:
    'Chào anh/chị {ten}, em là {nhan_vien} từ Fairplay Sports. Em gửi anh/chị thông tin về dịch vụ tổ chức giải {nhu_cau} ạ.',
  email_client: 'gmail',
  care_stale_days: 60,
  loyal_threshold: 2,
  vip_threshold: 4,
  season_days: 90,
  // date: "MM-DD" (lặp hằng năm) hoặc "YYYY-MM-DD" (lễ âm lịch — cập nhật mỗi năm)
  occasions: [
    { key: 'tet', label: 'Tết Nguyên Đán', date: '2027-02-06', before: 45, for: 'all' },
    { key: 'trungthu', label: 'Trung thu', date: '2027-09-15', before: 21, for: 'all' },
    { key: '8-3', label: 'Quốc tế Phụ nữ 8/3', date: '03-08', before: 14, for: 'female' },
    { key: '20-10', label: 'Phụ nữ Việt Nam 20/10', date: '10-20', before: 14, for: 'female' },
    { key: 'birthday', label: 'Sinh nhật đầu mối', date: '', before: 7, for: 'birthday' },
  ],
};

export const EVENT_STATUS = { upcoming: 'Sắp diễn ra', done: 'Đã tổ chức', cancelled: 'Đã huỷ' };
export const GIFT_STATUS = { planned: 'Đã lên kế hoạch', given: 'Đã tặng', skipped: 'Bỏ qua' };
export const OCCASION_FOR = { all: 'Tất cả đầu mối chính', female: 'Đầu mối nữ', birthday: 'Theo ngày sinh' };

export const countEvents = (events, customerId) => events.filter((e) => e.customer_id === customerId && e.status !== 'cancelled').length;

export function customerTier(n, s) {
  if (n >= s.vip_threshold) return { id: 'vip', label: 'VIP', color: '#7c3aed' };
  if (n >= s.loyal_threshold) return { id: 'loyal', label: 'Thân thiết', color: '#16a34a' };
  if (n >= 1) return { id: 'one', label: 'Đã tổ chức 1 giải', color: '#0ea5e9' };
  return { id: 'prospect', label: 'Tiềm năng', color: '#64748b' };
}

export function customerFlags(c, settings) {
  const t = todayStr();
  return {
    overdue: !!c.next_care && c.next_care < t,
    dueToday: c.next_care === t,
    due: !!c.next_care && c.next_care <= t,
    stale: !!c.last_care_at && daysSince(c.last_care_at) >= settings.care_stale_days,
    noCare: !c.next_care,
  };
}

// Ngày diễn ra gần nhất của một dịp (giữ hiển thị thêm 7 ngày sau lễ để kịp ghi nhận "đã tặng")
export function nextOccurrence(dateStr, graceDays = 7) {
  const floor = addDays(-graceDays);
  if (/^\d{2}-\d{2}$/.test(dateStr || '')) {
    const y = +todayStr().slice(0, 4);
    const d = `${y}-${dateStr}`;
    return d >= floor ? d : `${y + 1}-${dateStr}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return dateStr >= floor ? dateStr : null;
  return null;
}

// Danh sách việc tặng quà cần làm: [{key, occasion, date, customer, contact}]
export function giftTasks({ customers, contacts, events, gifts, settings }, horizonExtra = 0) {
  const t = todayStr();
  const done = new Set(gifts.map((g) => g.occasion_key + '|' + (g.contact_id || g.customer_id)));
  const active = new Set(events.filter((e) => e.status !== 'cancelled').map((e) => e.customer_id));
  const cus = Object.fromEntries(customers.map((c) => [c.id, c]));
  const out = [];
  for (const o of settings.occasions || []) {
    if (o.for === 'birthday') {
      for (const k of contacts) {
        if (!k.birthday || !cus[k.customer_id]) continue;
        const d = nextOccurrence(k.birthday.slice(5));
        if (!d || daysBetween(t, d) > o.before + horizonExtra) continue;
        const key = `${o.key}-${d.slice(0, 4)}`;
        out.push({ key, occasion: o.label, date: d, customer: cus[k.customer_id], contact: k, done: done.has(key + '|' + k.id) });
      }
      continue;
    }
    const d = nextOccurrence(o.date);
    if (!d || daysBetween(t, d) > o.before + horizonExtra) continue;
    const key = `${o.key}-${d.slice(0, 4)}`;
    for (const k of contacts) {
      if (!active.has(k.customer_id) || !cus[k.customer_id]) continue;
      if (o.for === 'female' ? k.gender !== 'Nữ' : !k.is_primary) continue;
      out.push({ key, occasion: o.label, date: d, customer: cus[k.customer_id], contact: k, done: done.has(key + '|' + k.id) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// Gợi ý chăm sóc đặc thù: khách thân thiết/VIP chưa có quà tri ân, tri ân sau giải, mùa giải năm trước
export function careSuggestions({ customers, events, gifts, leads, settings }) {
  const t = todayStr();
  const giftKeys = new Set(gifts.map((g) => g.customer_id + '|' + g.occasion_key));
  const byCus = {};
  for (const e of events) if (e.status !== 'cancelled') (byCus[e.customer_id] ||= []).push(e);
  const loyal = [], thanks = [], season = [];
  for (const c of customers) {
    const evs = (byCus[c.id] || []).slice().sort((a, b) => (b.event_date || '').localeCompare(a.event_date || ''));
    const n = evs.length;
    if (n >= settings.vip_threshold && !giftKeys.has(c.id + '|vip')) loyal.push({ customer: c, n, key: 'vip', label: 'Tri ân khách VIP' });
    else if (n >= settings.loyal_threshold && !giftKeys.has(c.id + '|loyal') && !giftKeys.has(c.id + '|vip'))
      loyal.push({ customer: c, n, key: 'loyal', label: 'Tri ân khách thân thiết' });
    for (const e of evs)
      if (e.status === 'done' && e.event_date && e.event_date <= t && daysBetween(e.event_date, t) <= 21 && !giftKeys.has(c.id + '|thanks-' + e.id))
        thanks.push({ customer: c, event: e, key: 'thanks-' + e.id });
    const hasUpcoming = evs.some((e) => e.status === 'upcoming' && (e.event_date || '9999') >= t);
    const hasOpenLead = leads.some((l) => l.customer_id === c.id && isOpen(l.stage));
    if (!hasUpcoming && !hasOpenLead) {
      for (const e of evs) {
        if (!e.event_date) continue;
        const y = +t.slice(0, 4);
        const anniv = [y, y + 1].map((yy) => yy + e.event_date.slice(4)).find((d) => d >= t);
        const gap = daysBetween(t, anniv);
        if (gap <= settings.season_days && e.event_date < addDays(-180)) {
          season.push({ customer: c, event: e, anniv, gap });
          break;
        }
      }
    }
  }
  season.sort((a, b) => a.gap - b.gap);
  return { loyal, thanks, season };
}

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => ymd(new Date());
export function addDays(n, from) {
  const d = from ? new Date(from + 'T00:00:00') : new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
}
const parseD = (s) => (s.length === 10 ? new Date(s + 'T00:00:00') : new Date(s));
export const fmtDate = (s) => (s ? parseD(s).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
export const fmtDateTime = (s) =>
  s ? parseD(s).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
export const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 86400000);
export const daysSince = (iso) => Math.max(0, Math.floor((Date.now() - parseD(iso).getTime()) / 86400000));

export function relDay(date) {
  if (!date) return '';
  const d = daysBetween(todayStr(), date);
  if (d === 0) return 'Hôm nay';
  if (d === 1) return 'Ngày mai';
  if (d === -1) return 'Hôm qua';
  return d < 0 ? `Quá ${-d} ngày` : `Còn ${d} ngày`;
}

export function normalizePhone(p) {
  if (!p) return '';
  let s = String(p).replace(/[^\d+]/g, '');
  if (s.startsWith('+84')) s = '0' + s.slice(3);
  else if (s.startsWith('84') && s.length === 11) s = '0' + s.slice(2);
  if (/^\d{9}$/.test(s)) s = '0' + s;
  return s;
}

export const fold = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();

export function leadFlags(lead, settings) {
  const open = isOpen(lead.stage);
  const t = todayStr();
  return {
    open,
    overdue: open && !!lead.next_followup && lead.next_followup < t,
    dueToday: open && lead.next_followup === t,
    noFollowup: open && !lead.next_followup,
    stale: open && !!lead.last_activity_at && daysSince(lead.last_activity_at) >= settings.stale_days,
    unassigned: open && !lead.assignee_id,
  };
}

export const fillTemplate = (tpl, lead, me) =>
  String(tpl || '')
    .replace(/\{ten\}/g, lead.name || '')
    .replace(/\{cong_ty\}/g, lead.company || '')
    .replace(/\{nhu_cau\}/g, lead.need || '')
    .replace(/\{nhan_vien\}/g, me?.full_name || '');

export function emailLink(lead, settings, me) {
  const su = fillTemplate(settings.email_subject, lead, me);
  const body = fillTemplate(settings.email_body, lead, me);
  const e = encodeURIComponent;
  if (settings.email_client === 'gmail')
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${e(lead.email || '')}&su=${e(su)}&body=${e(body)}`;
  return `mailto:${lead.email || ''}?subject=${e(su)}&body=${e(body)}`;
}

export function findDuplicates(leads, { phone, email, facebook, name, company }, excludeId) {
  const p = normalizePhone(phone);
  const e = fold(email);
  const fb = /^https?:/.test(facebook || '') ? fold(facebook).replace(/\/+$/, '') : '';
  const nc = name && company ? fold(name) + '|' + fold(company) : '';
  return leads.filter(
    (l) =>
      l.id !== excludeId &&
      ((p && p.length >= 9 && normalizePhone(l.phone) === p) ||
        (e && fold(l.email) === e) ||
        (fb && fold(l.facebook).replace(/\/+$/, '') === fb) ||
        (nc && fold(l.name) + '|' + fold(l.company) === nc))
  );
}

export const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

export function csvParse(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((v) => v.trim() !== ''));
  if (!head) return [];
  const keys = head.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

export function csvDownload(filename, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const text = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const IMPORT_COLUMNS = [
  'name', 'company', 'customer_type', 'phone', 'email', 'facebook', 'source', 'need', 'region', 'headcount',
  'event_time', 'stage', 'lost_reason', 'assignee_name', 'next_followup', 'notes', 'created_at',
];
