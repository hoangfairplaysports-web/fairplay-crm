// Lợi nhuận giải đấu: đọc file nghiệm thu, khớp hạng mục, tính lãi từng giải và từng tháng.
// Hàm thuần (không dùng trình duyệt) để kiểm thử được bằng Node. Logic khớp file "Fairplay_Tinh_Lai_Giai_Dau.xlsx".
import { fold } from './ev-core.js';

const txt = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
const num = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[^\d,.-]/g, '');
  if (!/\d/.test(s)) return null;
  const n = Number(s.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const ROMAN = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)\.?$/;
const pctIn = (label) => {
  const m = String(label).match(/(\d+(?:[.,]\d+)?)\s*%/);
  return m ? Number(m[1].replace(',', '.')) / 100 : null;
};

export const DEFAULTS = { fee_rate: 0.1, vat_rate: 0.08, pit_rate: 0.1, pit_threshold: 2000000 };
export const PAYEE = { ctv: 'Cá nhân (CTV)', invoice: 'Có hóa đơn', self: 'Tự làm / ưu đãi' };

// ---------------------------------------------------------------------------
// 1. Đọc file nghiệm thu (mẫu Fairplay): trả về hạng mục theo nhóm + các dòng tổng cuối file
// ---------------------------------------------------------------------------
export function parseAcceptance(rows) {
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const r = (rows[i] || []).map((c) => fold(c));
    if (r.includes('stt') && r.some((c) => c.startsWith('noi dung'))) {
      h = i;
      break;
    }
  }
  if (h < 0) return null;
  const top = rows[h].map((c) => fold(c));
  const col = (test) => top.findIndex((c) => c && test(c));
  const C = {
    stt: col((c) => c === 'stt'),
    nd: col((c) => c.startsWith('noi dung')),
    bg: col((c) => c.startsWith('bao gom')),
    sl: col((c) => c.startsWith('so luong')),
    dvt: col((c) => c === 'dvt' || c.startsWith('don vi')),
    dg: col((c) => c.startsWith('don gia')),
    tt: col((c) => c.startsWith('thanh tien')),
    cost: col((c) => c.startsWith('cost') || c.includes('nha cung cap')),
    note: col((c) => c.startsWith('chu thich') || c.startsWith('ghi chu')),
  };
  if (C.nd < 0 || C.tt < 0) return null;
  // Tổng chi phí NCC của dòng: cột ngay sau cột Cost (không tiêu đề)
  C.costTotal = C.cost >= 0 ? C.cost + 1 : -1;

  const items = [];
  const totals = {};
  let group = { name: '', kind: 'contract' };
  let lastNd = '';
  let empty = 0;
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const g = (k) => (C[k] >= 0 ? r[C[k]] : null);
    if (!r.some((c) => txt(c))) {
      if (++empty > 15) break;
      continue;
    }
    empty = 0;
    const stt = txt(g('stt'));
    const nd = txt(g('nd'));
    const bg = txt(g('bg'));
    const label = fold(nd || stt);
    // Dòng tổng / phí / VAT / thanh toán cuối file
    if (/^(tong|phi quan ly|vat|thue|da thanh toan|con lai|chiet khau|giam gia)/.test(label)) {
      const v = num(g('tt'));
      if (/^tong theo hop dong/.test(label)) totals.contract = v;
      else if (/^tong da bao gom/.test(label)) totals.items = v;
      else if (/^phi quan ly/.test(label)) {
        totals.fee = v;
        totals.fee_rate = pctIn(nd);
      } else if (/^tong cong/.test(label)) totals.revenue = v;
      else if (/^(vat|thue)/.test(label)) {
        totals.vat = v;
        totals.vat_rate = pctIn(nd);
      } else if (/^tong chi phi giai/.test(label)) totals.total = v;
      else if (/^da thanh toan/.test(label)) totals.paid = (totals.paid || 0) + (v || 0);
      else if (/^con lai/.test(label)) totals.remaining = v;
      // Cột tổng NCC ở dòng tổng cuối file (để đối chiếu)
      const cv = num(r[C.costTotal]);
      if (/^tong da bao gom/.test(label) && cv != null) totals.cost = cv;
      if (/^con lai/.test(label)) break;
      continue;
    }
    if (ROMAN.test(fold(stt))) {
      const n = fold(nd);
      group = { name: nd || stt, roman: stt, kind: /phat sinh/.test(n) ? 'extra' : /khong su dung/.test(n) ? 'unused' : 'contract' };
      lastNd = '';
      continue;
    }
    if (!nd && !bg) continue;
    if (nd) lastNd = nd;
    const qty = num(g('sl'));
    const price = num(g('dg'));
    let amount = num(g('tt'));
    if (amount == null && qty != null && price != null) amount = qty * price;
    const unitCost = num(g('cost'));
    // Ưu tiên cột tổng NCC; chỉ khi trống mới lấy Số lượng x đơn giá Cost (VD "Đồ ăn nhẹ" nhập theo tổng)
    let cost = num(r[C.costTotal]);
    if (cost == null && unitCost != null) cost = (qty ?? 1) * unitCost;
    items.push({
      group: group.name, groupKind: group.kind, roman: group.roman || '',
      name: nd || lastNd || bg.slice(0, 60), detail: bg, isSub: !nd, parent: nd ? '' : lastNd,
      qty, unit: txt(g('dvt')), unit_price: price, amount, unit_cost: unitCost, cost, note: txt(g('note')), row: i + 1,
    });
  }
  return { items, totals, fee_rate: totals.fee_rate ?? null, vat_rate: totals.vat_rate ?? null };
}

// ---------------------------------------------------------------------------
// 2. Khớp dòng nghiệm thu với ev_items của giải (theo tên không dấu, rồi "Bao gồm", đơn giá)
//    → { matches: [{acc, item, action}], unmatched: [acc], leftover: [ev_items không có trong nghiệm thu] }
//    action: 'update' (khớp hạng mục có sẵn) · 'create' (phát sinh mới) · 'unused' (đánh dấu không sử dụng) · 'skip'
// ---------------------------------------------------------------------------
export function matchAcceptance(accItems, evItems) {
  const used = new Set();
  const score = (a, it) => {
    const nameA = fold(a.name);
    const nameI = fold(it.name);
    let s = 0;
    if (nameA && nameA === nameI) s += 4;
    else if (nameA && nameI && (nameA.includes(nameI) || nameI.includes(nameA))) s += 2;
    const dA = fold(a.detail);
    const dI = fold(it.detail);
    if (dA && dI && (dA === dI || dA.startsWith(dI.slice(0, 24)) || dI.startsWith(dA.slice(0, 24)))) s += 2;
    if (a.unit_price != null && Number(it.unit_price) === a.unit_price) s += 1;
    if (a.amount != null && Number(it.amount) === a.amount) s += 0.5;
    if (!!it.is_extra === (a.groupKind === 'extra')) s += 0.5;
    return s;
  };
  const matches = [];
  const unmatched = [];
  const pick = (a, pool) => {
    let best = null;
    let bestS = 0;
    for (const it of pool) {
      const s = score(a, it);
      if (s > bestS) {
        best = it;
        bestS = s;
      }
    }
    // Cần khớp tên (≥ 4) hoặc gần đúng tên + mô tả (≥ 4)
    return best && bestS >= 4 ? { best, bestS } : null;
  };
  // Lượt 1: hạng mục hợp đồng + phát sinh
  for (const a of accItems.filter((x) => x.groupKind !== 'unused')) {
    const r = pick(a, evItems.filter((it) => !used.has(it.id)));
    if (r) {
      used.add(r.best.id);
      matches.push({ acc: a, item: r.best, action: 'update', score: r.bestS });
    } else if (a.groupKind === 'extra') matches.push({ acc: a, item: null, action: 'create' });
    else unmatched.push(a);
  }
  // Lượt 2: "Các hạng mục không sử dụng" trừ chính hạng mục trong hợp đồng (file ghi 2 lần: ở nhóm gốc và ở nhóm này)
  //  → khớp vào hạng mục cùng tên, kể cả hạng mục vừa khớp ở lượt 1, rồi đánh dấu không sử dụng
  for (const a of accItems.filter((x) => x.groupKind === 'unused')) {
    const taken = new Set(matches.filter((m) => m.action === 'unused').map((m) => m.item.id));
    const r = pick(a, evItems.filter((it) => !it.is_extra && !taken.has(it.id)));
    if (r) {
      used.add(r.best.id);
      matches.push({ acc: a, item: r.best, action: 'unused', score: r.bestS });
    } else unmatched.push(a);
  }
  const leftover = evItems.filter((it) => !used.has(it.id) && it.chosen && !it.not_used);
  return { matches, unmatched, leftover };
}

// Dòng nghiệm thu → hạng mục để tính lãi ngay từ file (xem trước, kiểm thử): dòng "không sử dụng" gạch hạng mục gốc cùng tên
export function acceptanceItems(acc) {
  const list = acc.items.filter((a) => a.groupKind !== 'unused').map((a, i) => ({
    id: 'r' + i, ...a, section: a.group, is_extra: a.groupKind === 'extra', chosen: true,
    accept_amount: a.amount, cost_amount: a.cost, accept_unit_cost: a.unit_cost,
  }));
  const m = matchAcceptance(acc.items.filter((a) => a.groupKind === 'unused'), list);
  for (const x of m.matches) if (x.item) x.item.not_used = true;
  return list;
}

// ---------------------------------------------------------------------------
// 3. Lãi 1 giải. items: ev_items của giải (hoặc dòng đã đọc). Dùng chung cho tab Lợi nhuận, Tổng quan, Lợi nhuận tháng.
//    Doanh thu chưa VAT = tổng thành tiền hạng mục đang dùng (kể cả phát sinh, trừ không sử dụng) + phí quản lý
//    Lãi gộp = Doanh thu chưa VAT - chi phí NCC - thuế TNCN công ty chịu thay CTV
// ---------------------------------------------------------------------------
export const itemRevenue = (it) => Number(it.accept_amount ?? it.amount) || 0;
export const itemActive = (it) => it.chosen !== false && !it.not_used;
export function eventProfit(ev = {}, items = [], payments = []) {
  // Phí quản lý: tỉ lệ lưu ở giải → tỉ lệ từ báo giá (phí / tổng hạng mục) → mặc định 10%
  const quoteRate = num(ev.quote_fee) && num(ev.quote_subtotal) ? Math.round((num(ev.quote_fee) / num(ev.quote_subtotal)) * 10000) / 10000 : null;
  const feeRate = num(ev.fee_rate) ?? quoteRate ?? DEFAULTS.fee_rate;
  const vatRate = num(ev.vat_rate) ?? DEFAULTS.vat_rate;
  const pitRate = num(ev.pit_rate) ?? DEFAULTS.pit_rate;
  const pitThreshold = num(ev.pit_threshold) ?? DEFAULTS.pit_threshold;
  const act = items.filter(itemActive);
  const itemsSum = act.reduce((a, it) => a + itemRevenue(it), 0);
  const fee = itemsSum * feeRate;
  const revenue = itemsSum + fee;
  const vat = revenue * vatRate;
  const cost = act.reduce((a, it) => a + (Number(it.cost_amount ?? it.cost) || 0), 0);
  const pitOf = (it) => {
    if (!ev.pit_on || it.payee_type !== 'ctv') return 0;
    const unit = num(it.accept_unit_cost ?? it.unit_cost) ?? (Number(it.cost_amount ?? it.cost) || 0) / (Number(it.accept_qty ?? it.qty) || 1);
    return unit >= pitThreshold ? (Number(it.cost_amount ?? it.cost) || 0) * pitRate : 0;
  };
  const pit = act.reduce((a, it) => a + pitOf(it), 0);
  const gross = revenue - cost - pit;
  // Theo nhóm (thành tiền hạng mục, chưa phí quản lý); phát sinh gom 1 nhóm riêng
  const groups = [];
  for (const it of act) {
    const key = it.is_extra ? 'Các hạng mục phát sinh' : it.section || it.group || 'Khác';
    let g = groups.find((x) => x.name === key);
    if (!g) groups.push((g = { name: key, extra: !!it.is_extra, revenue: 0, cost: 0, n: 0 }));
    g.revenue += itemRevenue(it);
    g.cost += Number(it.cost_amount ?? it.cost) || 0;
    g.n++;
  }
  for (const g of groups) {
    g.profit = g.revenue - g.cost;
    g.margin = g.revenue ? g.profit / g.revenue : 0;
  }
  groups.sort((a, b) => a.extra - b.extra);
  const extra = groups.find((g) => g.extra) || null;
  const paid = payments.reduce((a, p) => a + (Number(p.paid_amount) || 0), 0);
  const missingCost = act.filter((it) => it.cost_amount == null && it.cost == null && itemRevenue(it) > 0).length;
  const margin = revenue ? gross / revenue : 0;
  const warn = [];
  const pc = (v) => (v * 100).toFixed(1).replace('.', ',') + '%';
  if (revenue && margin < 0.25) warn.push(`Biên lãi gộp của giải chỉ ${pc(margin)} (dưới 25%)`);
  if (extra && extra.revenue && extra.margin < 0.25) warn.push(`Biên lãi nhóm phát sinh chỉ ${pc(extra.margin)} (dưới 25%)`);
  return {
    feeRate, vatRate, itemsSum, fee, revenue, vat, total: revenue + vat, cost, pit, gross, margin,
    markup: cost ? gross / cost : 0, groups, extra, paid, owed: revenue + vat - paid, missingCost, warn,
  };
}

// ---------------------------------------------------------------------------
// 4. Lợi nhuận tháng
// ---------------------------------------------------------------------------
export const FIXED_DEFAULTS = { staff: [], ins_rate: 0.215, office_per_person: 1000000, ads: 0, others: [], cit_rate: 0.2 };
// BH công ty đóng cho 1 người: số nhập tay (ins_amount) nếu có, không thì lương gross x tỉ lệ BH
export const insOf = (s, rate) => {
  if (!s.insured) return 0;
  if (s.ins_amount != null && s.ins_amount !== '') return Number(String(s.ins_amount).replace(/[^\d.-]/g, '')) || 0;
  return (Number(s.salary) || 0) * (Number(rate) || 0);
};
export function fixedCosts(f = {}) {
  const d = { ...FIXED_DEFAULTS, ...f };
  const staff = (d.staff || []).filter((s) => txt(s.name) || Number(s.salary));
  const salary = staff.reduce((a, s) => a + (Number(s.salary) || 0), 0);
  const insurance = staff.reduce((a, s) => a + insOf(s, d.ins_rate), 0);
  const office = staff.filter((s) => txt(s.name)).length * (Number(d.office_per_person) || 0);
  const ads = Number(d.ads) || 0;
  const others = (d.others || []).reduce((a, o) => a + (Number(o.amount) || 0), 0);
  return { salary, insurance, office, ads, others, total: salary + insurance + office + ads + others, people: staff.length };
}
// eventsP: [{ revenue, gross, owed, ... }] - kết quả eventProfit của các giải trong tháng
export function monthProfit(eventsP, fixed = {}) {
  const fc = fixedCosts(fixed);
  const revenue = eventsP.reduce((a, e) => a + e.revenue, 0);
  const gross = eventsP.reduce((a, e) => a + e.gross, 0);
  const count = eventsP.filter((e) => e.revenue > 0).length;
  const avgMargin = revenue ? gross / revenue : 0;
  const net = gross - fc.total;
  const citRate = Number(fixed.cit_rate ?? FIXED_DEFAULTS.cit_rate) || 0;
  const cit = Math.max(0, net) * citRate;
  const breakEven = avgMargin ? fc.total / avgMargin : 0;
  return {
    revenue, gross, count, avgMargin, fixed: fc, net, netMargin: revenue ? net / revenue : 0, citRate, cit, afterTax: net - cit,
    breakEven, eventsToBreakEven: count && revenue ? breakEven / (revenue / count) : 0,
  };
}
