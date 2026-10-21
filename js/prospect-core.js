// Tìm khách mới: hằng số, chuỗi 14 ngày, mẫu tin nhắn, số liệu phễu (không có giao diện).
import { addDays, fold, todayStr } from './util.js';

export const P_STATUS = {
  new: { label: 'Chưa tiếp cận', cls: '' },
  touching: { label: 'Đang chạm', cls: 'info' },
  replied: { label: 'Có phản hồi', cls: 'warn' },
  meeting: { label: 'Có hẹn', cls: 'ok' },
  brief: { label: 'Có brief', cls: 'ok' },
  recall: { label: 'Hẹn lại', cls: '' },
  unfit: { label: 'Không phù hợp', cls: 'bad' },
};
export const P_SOURCES = ['Danh sách', 'Dấu hiệu', 'Giới thiệu', 'Sự kiện'];
export const TIERS = {
  A: { label: 'A', need: 3, hint: 'Từ 500 nhân sự / nhiều chi nhánh / từng làm hội thao / vừa có dấu hiệu: đủ 5 lần chạm, tìm 3 người, tin nhắn viết riêng' },
  B: { label: 'B', need: 2, hint: '100-500 nhân sự, cùng ngành khách đã làm: đủ 5 lần chạm, tìm 2 người, tin theo mẫu ngành' },
  C: { label: 'C', need: 1, hint: 'Dưới 100 nhân sự / chưa rõ nhu cầu: chỉ kết nối LinkedIn, xem lại sau 3 tháng' },
};
export const ROLE_LEVELS = {
  1: { label: 'Làm trực tiếp', hint: 'C&B, Engagement, Truyền thông nội bộ, Ủy viên công đoàn' },
  2: { label: 'Ảnh hưởng', hint: 'Trưởng phòng Nhân sự, Hành chính, Truyền thông' },
  3: { label: 'Duyệt ngân sách', hint: 'Giám đốc Nhân sự, Chủ tịch Công đoàn, Giám đốc chi nhánh' },
};
export const CHANNELS = { linkedin: { label: 'LinkedIn', icon: '🔗' }, email: { label: 'Email', icon: '✉️' }, call: { label: 'Điện thoại', icon: '📞' } };

// 5 lần chạm trong 14 ngày (slide 20)
export const SEQUENCE = [
  { step: 1, day: 1, channel: 'linkedin', tpl: 'A', label: 'Tương tác 1 bài, gửi lời mời có ghi chú' },
  { step: 2, day: 2, channel: 'email', tpl: 'B', tplEn: 'C', label: 'Email giới thiệu ngắn, hỏi 1 câu về kế hoạch' },
  { step: 3, day: 5, channel: 'email', tpl: 'D', label: 'Gửi case study cùng ngành (LinkedIn hoặc email)' },
  { step: 4, day: 8, channel: 'call', tpl: 'E', label: 'Gọi theo kịch bản, xin 15 phút' },
  { step: 5, day: 14, channel: 'email', tpl: 'F', label: 'Email cuối lịch sự, để ngỏ' },
];

// Mẫu A-G (Cẩm nang tiếp cận khách hàng mới, mục 5). [ngoặc vuông] = phần tự thay.
export const DEFAULT_TEMPLATES = [
  { key: 'A', title: 'Ghi chú lời mời LinkedIn', channel: 'linkedin',
    vi: 'Chào chị [Tên], em là [Tên mình] bên Fairplay Sports. Em đọc bài của chị về [chủ đề] và thấy rất hay. Em làm về các giải thể thao nội bộ cho doanh nghiệp, mong được kết nối để học hỏi thêm từ chị ạ.',
    en: "Hi [Name], I'm [My name] from Fairplay Sports. We organise in-house sports tournaments for companies in Hanoi. I enjoyed your post on [topic] and would love to connect." },
  { key: 'B', title: 'Email giới thiệu (tiếng Việt)', channel: 'email',
    vi: 'Tiêu đề: [Tên công ty] - ý tưởng giải thể thao nội bộ cuối năm\n\nChào chị [Tên],\n\nEm là [Tên mình], phụ trách khách hàng doanh nghiệp tại Fairplay Sports. Fairplay chuyên tổ chức giải pickleball, cầu lông, bóng đá và hội thao nội bộ trọn gói, từ sân, trọng tài, truyền thông đến hóa đơn và nghiệm thu.\n\nBên em đã làm giải cho một số [ngành] tại Hà Nội. Em thấy [Tên công ty] [dấu hiệu], nên mạnh dạn gửi chị.\n\nCho em hỏi, năm nay hoặc năm 2027 công ty mình có kế hoạch hoạt động thể thao cho nhân viên không ạ?\n\nEm cảm ơn chị,\n[Tên mình] | Fairplay Sports | [số điện thoại]',
    en: '' },
  { key: 'C', title: 'Email giới thiệu (tiếng Anh)', channel: 'email', vi: '',
    en: "Subject: Team sports day idea for [Company]\n\nHi [Name],\n\nI'm [My name] from Fairplay Sports in Hanoi. We run in-house sports tournaments for companies (pickleball, badminton, football), fully managed from venue and referees to invoicing, with a team that works in English.\n\nWe have worked with several international offices in Hanoi. Is [Company] planning any team or engagement activities for the end of this year or 2027?\n\nBest regards,\n[My name] | Fairplay Sports | [phone]" },
  { key: 'D', title: 'Gửi case study (lần chạm 3)', channel: 'email',
    vi: 'Chào chị [Tên], em gửi chị tham khảo 1 giải bên em vừa làm cho một [ngành] khoảng [số] nhân viên: [link case study hoặc video]. Điểm khách thích nhất là [1 điểm cụ thể, ví dụ: mọi thứ được lo trọn, nhân sự chỉ việc ra sân]. Nếu chị thấy hợp, em xin 15 phút để chia sẻ thêm ạ.',
    en: 'Hi [Name], sharing a tournament we recently ran for a [industry] company of about [number] staff: [case study or video link]. What they liked most was [one specific point]. If it sounds relevant, could I have 15 minutes to share more?' },
  { key: 'E', title: 'Kịch bản gọi điện (lần chạm 4)', channel: 'call',
    vi: 'MỞ ĐẦU (15 giây): "Em chào chị [Tên], em là [Tên mình] bên Fairplay Sports, tuần trước em có gửi email về giải thể thao nội bộ. Chị cho em xin 2 phút được không ạ?"\n\nHỎI ĐỂ HIỂU KHÁCH (không cần đủ 4 câu):\n- Công ty mình thường tổ chức hoạt động cho nhân viên vào dịp nào?\n- Năm trước đã làm hội thao chưa, tự làm hay thuê đơn vị?\n- Nhân viên bên mình hay chơi môn gì?\n- Ngân sách và kế hoạch năm sau thường chốt vào tháng mấy?\n\nCHỐT: "Em xin 15 phút vào [ngày] để gửi chị vài phương án tham khảo được không ạ?" Hoặc: "Tháng mấy em nên gọi lại chị ạ?"\n\nKHI KHÁCH TỪ CHỐI:\n- "Đã có đơn vị rồi": chị cho em gửi hồ sơ để lần sau có thêm lựa chọn so sánh nhé.\n- "Chưa có ngân sách": hỏi tháng chốt ngân sách, ghi Hẹn lại đúng tháng đó.\n- "Không phải chị phụ trách": xin tên người phụ trách, xin phép nhắc tên chị khi liên hệ.',
    en: '' },
  { key: 'F', title: 'Email cuối (ngày 14)', channel: 'email',
    vi: 'Chào chị [Tên], chắc dạo này chị đang bận nên em không làm phiền thêm. Khi nào công ty cần tổ chức giải hoặc hội thao, chị nhắn em một dòng là bên em gửi phương án trong 2 ngày ạ. Chúc chị tuần mới nhiều năng lượng!',
    en: "Hi [Name], I imagine things are busy, so I won't follow up further. Whenever [Company] needs a tournament or sports day, just drop me a line and we'll send options within 2 days. Have a great week!" },
  { key: 'G', title: 'Xin giới thiệu từ khách cũ', channel: 'email',
    vi: 'Chào chị [Tên], cảm ơn chị đã tin tưởng Fairplay cho giải [tên giải]. Bên em đang muốn hỗ trợ thêm các [chi nhánh / công ty trong tập đoàn / công ty bạn]. Chị có quen anh/chị nào phụ trách hoạt động nhân viên ở đó không ạ? Em chỉ xin tên và xin phép nhắc tên chị khi liên hệ.',
    en: '' },
];
export const templatesOf = (settings) => (settings.msg_templates && settings.msg_templates.length ? settings.msg_templates : DEFAULT_TEMPLATES);

const givenName = (n) => String(n || '').trim().split(/\s+/).pop() || '';
const shortIndustry = (s) => (s || '').split(',')[0].trim().toLowerCase();
export function fillTpl(text, { contact, company, me }) {
  const rep = {
    'Tên': givenName(contact?.name), Name: givenName(contact?.name),
    'Tên mình': givenName(me?.full_name), 'My name': givenName(me?.full_name),
    'Tên công ty': company?.name, Company: company?.name,
    'ngành': shortIndustry(company?.industry), industry: shortIndustry(company?.industry),
    'dấu hiệu': company?.signal, 'số điện thoại': me?.phone, phone: me?.phone,
  };
  let out = String(text || '').replace(/\[([^\]]+)\]/g, (m, k) => (rep[k] ? rep[k] : m));
  // Người nhận là nam: đổi cách xưng "chị" thành "anh"
  // (giữ nguyên "anh/chị" vì đó là nói về người khác)
  if (/^nam$/i.test(contact?.gender || ''))
    out = out.replace(/([Cc])hị(?![\p{L}])/gu, (m, c, off, str) => {
      const prev = str.slice(Math.max(0, off - 4), off);
      return /\p{L}$/u.test(prev) || /anh\/$/i.test(prev) ? m : c === 'C' ? 'Anh' : 'anh';
    });
  return out;
}

export const industryOf = (settings, name) => (settings.industries || []).find((i) => i.name === name);
export const isEnglish = (settings, c) => !!industryOf(settings, c?.industry)?.en;
// Người phụ trách mặc định theo ngành: người đầu tiên trong danh sách owners
export const defaultOwner = (settings, industry) => industryOf(settings, industry)?.owners?.[0] || null;

export const isProspect = (c) => !!c.p_status;
export const needContacts = (c) => TIERS[c.tier]?.need || 2;

// Lọc trùng: tên (bỏ dấu, bỏ "công ty", "ngân hàng TMCP"...) hoặc tên miền website
const CORP = /\b(cong ty|ctcp|cty|tnhh|co phan|tap doan|ngan hang|tmcp|chi nhanh|viet nam|vietnam|jsc|ltd|co|corp|corporation|group|bank)\b/g;
export const nameKey = (s) => fold(s).replace(CORP, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
export const domainOf = (u) => String(u || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
export function findCompanyDup(customers, { name, website }, excludeId) {
  const k = nameKey(name);
  const d = domainOf(website);
  return customers.filter((c) => c.id !== excludeId && ((k.length >= 3 && nameKey(c.name) === k) || (d && domainOf(c.website) === d)));
}

// Lịch 5 lần chạm từ ngày bắt đầu
export function planTouches({ customer, contact, start = todayStr(), english }) {
  return SEQUENCE.map((s) => ({
    customer_id: customer.id, contact_id: contact.id, step: s.step, day_no: s.day, channel: s.channel,
    template_key: english && s.tplEn ? s.tplEn : s.tpl, due_date: addDays(s.day - 1, start),
  }));
}
export const touchLabel = (t) => SEQUENCE.find((s) => s.step === t.step)?.label || '';
export const pendingTouch = (t) => !t.done_at && !t.skipped;

// Tuần (thứ 2 - CN) chứa ngày ref
export function weekRange(ref = todayStr()) {
  const d = new Date(ref + 'T00:00:00');
  const off = (d.getDay() + 6) % 7;
  const from = addDays(-off, ref);
  return [from, addDays(6, from)];
}
const dayOf = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const inR = (iso, from, to) => {
  const d = iso && iso.length > 10 ? dayOf(iso) : iso;
  return !!d && d >= from && d <= to;
};

// Số liệu phễu trong khoảng [from, to], gom theo key (người phụ trách hoặc ngành)
export function funnel({ customers, contacts, touches }, from, to, keyOf) {
  const out = {};
  const row = (k) => (out[k] ||= { companies: 0, sequences: 0, touches: 0, replies: 0, meetings: 0, briefs: 0, due: 0, ontime: 0, added: 0 });
  const cus = Object.fromEntries(customers.map((c) => [c.id, c]));
  for (const c of customers) {
    if (!c.p_status && !c.first_touch_at) continue;
    const k = keyOf(c);
    if (inR(c.p_added_at, from, to)) row(k).added++;
    if (inR(c.first_touch_at, from, to)) row(k).companies++;
    if (inR(c.replied_at, from, to)) row(k).replies++;
    if (inR(c.meeting_at, from, to)) row(k).meetings++;
    if (inR(c.brief_at, from, to)) row(k).briefs++;
  }
  for (const p of contacts) if (p.seq_started_at && cus[p.customer_id] && inR(p.seq_started_at, from, to)) row(keyOf(cus[p.customer_id])).sequences++;
  const today = todayStr();
  for (const t of touches) {
    const c = cus[t.customer_id];
    if (!c || t.skipped) continue;
    const r = row(keyOf(c));
    if (t.done_at && inR(t.done_at, from, to)) r.touches++;
    if (t.due_date >= from && t.due_date <= to && (t.due_date < today || t.done_at)) {
      r.due++;
      if (t.done_at && dayOf(t.done_at) <= t.due_date) r.ontime++;
    }
  }
  return out;
}

// Mẫu tin nào được phản hồi: gán phản hồi cho lần chạm gần nhất trước lúc người đó trả lời
export function templateStats({ contacts, touches }) {
  const out = {};
  const by = {};
  for (const t of touches) if (t.done_at && t.contact_id) (by[t.contact_id] ||= []).push(t);
  for (const t of touches) if (t.done_at && t.template_key) (out[t.template_key] ||= { sent: 0, replies: 0 }).sent++;
  for (const p of contacts) {
    if (!p.replied_at || !by[p.id]) continue;
    const last = by[p.id].filter((t) => t.done_at <= p.replied_at).sort((a, b) => b.done_at.localeCompare(a.done_at))[0];
    if (last?.template_key) (out[last.template_key] ||= { sent: 0, replies: 0 }).replies++;
  }
  return out;
}

// Nhập danh sách từ Excel: dòng tiêu đề có "Tên doanh nghiệp" / "Doanh nghiệp"
const COLS = {
  name: /^(ten )?(doanh nghiep|cong ty|don vi)/, industry: /^nganh/, tier: /^muc|^tier/, staff_size: /quy mo|nhan su/,
  website: /^website|^web/, linkedin: /linkedin/, p_source: /^nguon/, signal: /dau hieu/, owner: /phu trach/, notes: /ghi chu/, region: /khu vuc|tinh/,
};
export function parseProspectRows(rows) {
  const h = rows.findIndex((r) => (r || []).some((c) => COLS.name.test(fold(c))));
  if (h < 0) return [];
  const head = rows[h].map((c) => fold(c));
  const col = Object.fromEntries(Object.entries(COLS).map(([k, re]) => [k, head.findIndex((c) => re.test(c))]));
  const out = [];
  for (const r of rows.slice(h + 1)) {
    const g = (k) => (col[k] >= 0 && r[col[k]] != null ? String(r[col[k]]).trim() : '');
    if (!g('name')) continue;
    const tier = g('tier').toUpperCase().slice(0, 1);
    out.push({
      name: g('name'), industry: g('industry'), tier: TIERS[tier] ? tier : null, staff_size: parseInt(g('staff_size').replace(/\D/g, ''), 10) || null,
      website: g('website'), linkedin: g('linkedin'), p_source: g('p_source') || 'Danh sách', signal: g('signal'), owner_name: g('owner'), notes: g('notes'), region: g('region'),
    });
  }
  return out;
}
