// Bảng giá nhà cung cấp: đọc file Excel "Báo giá tổng hợp hạng mục cung cấp" và khớp hạng mục giải với dòng giá.
import { fold } from './ev-core.js';

const txt = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
// "30.000 đ" → 30000; "1.500.000 - 2.000.000" → [1500000, 2000000]
export function parsePrice(v) {
  if (v == null || v === '') return [null, null];
  if (typeof v === 'number') return [v, null];
  const nums = String(v).split(/\s*[-–~]\s*/).map((s) => Number(s.replace(/[^\d]/g, ''))).filter((n) => n > 0);
  if (!nums.length) return [null, null];
  return [nums[0], nums.length > 1 ? nums[nums.length - 1] : null];
}

// Tên NCC đoán từ dòng tiêu đề: "Chi phí hạng mục C Ninh - Fairplay chốt", "Báo giá tổng hợp hạng mục các NCC - SK Hà Minh anh"
export function guessVendor(title) {
  const t = txt(title);
  let m = t.match(/hạng mục\s+(.+?)\s*-\s*fairplay/i);
  if (m) return m[1];
  m = t.match(/NCC\s*-\s*(.+)$/i) || t.match(/-\s*([^-]+)$/);
  return m ? m[1].trim() : '';
}

const HEAD = {
  stt: /^stt$/, group: /^mon$/, item: /^(hang muc|noi dung)$/, detail: /^chi tiet$/, qty: /^so luong$/, unit: /^(dvt|don vi tinh)$/, price: /^don gia$/, note: /^(ghi chu|chu thich)$/,
};
export function parsePriceSheet(rows, sheetName) {
  const h = rows.findIndex((r) => (r || []).some((c) => /^stt$|^mon$/.test(fold(c))) && (r || []).some((c) => /^don gia$/.test(fold(c))));
  if (h < 0) return null;
  const head = rows[h].map((c) => fold(c));
  const col = Object.fromEntries(Object.entries(HEAD).map(([k, re]) => [k, head.findIndex((c) => re.test(c))]));
  const title = rows.slice(0, h).map((r) => (r || []).map(txt).filter(Boolean).join(' ')).filter((s) => s && !/cong ty cp|dia chi|^tel|email|website/i.test(fold(s))).pop() || '';
  const body = rows.slice(h + 1).filter((r) => (r || []).some((c) => txt(c)));
  // Cột "Hạng mục" thưa (VD chỉ ghi môn ở dòng đầu nhóm) → là nhóm, cột "Chi tiết" mới là tên hạng mục
  let groupCol = col.group;
  let itemCol = col.item;
  let detailCol = col.detail;
  if (groupCol < 0 && itemCol >= 0 && detailCol >= 0) {
    const filled = body.filter((r) => txt(r[itemCol])).length;
    if (filled < body.length * 0.5) {
      groupCol = itemCol;
      itemCol = detailCol;
      detailCol = -1;
    }
  }
  const lines = [];
  let grp = '';
  for (const r of body) {
    const g = (i) => (i >= 0 ? txt(r[i]) : '');
    if (groupCol >= 0 && g(groupCol)) grp = g(groupCol);
    const item = g(itemCol);
    if (!item) continue;
    const [price, price_max] = parsePrice(col.price >= 0 ? r[col.price] : null);
    lines.push({ grp: grp || null, item, detail: g(detailCol) || null, unit: g(col.unit).replace(/(?<![mM])\d+$/, '') || null, price, price_max, note: g(col.note) || null, sort: lines.length });
  }
  const category = txt(sheetName).replace(/^hạng mục\s*/i, '');
  return { sheet: sheetName, title, vendor: guessVendor(title), category: category ? category[0].toUpperCase() + category.slice(1) : '', lines };
}

// ---------------------------------------------------------------------------
// Khớp hạng mục của giải với dòng giá của NCC
// ---------------------------------------------------------------------------
const STOP = new Set(['va', 'cho', 'cua', 'cac', 'nhung', 'tai', 'theo', 'khu', 'vuc', 'loai', 'gom', 'bao', 'chiec', 'cai', 'bo', 'nguoi', 'nhan', 'su', 'giai', 'dau', 'to', 'chuc', 'su', 'kien', 'x', 'm']);
const words = (s) => fold(s).replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w));
const UNIT_KEYS = ['buoi', 'ngay', 'tran', 'hop', 'qua', 'm2'];
export function scoreLine(it, l) {
  const a = new Set(words(`${it.name} ${it.name}`));
  const ad = new Set(words(it.detail || ''));
  const b = words(`${l.item} ${l.grp || ''}`);
  const bd = words(l.detail || '');
  let s = 0;
  for (const w of new Set(b)) s += a.has(w) ? 3 : ad.has(w) ? 1 : 0;
  for (const w of new Set(bd)) s += a.has(w) || ad.has(w) ? 0.5 : 0;
  const iu = fold(`${it.unit || ''} ${it.detail || ''} ${it.name}`);
  const lu = fold(l.unit || '');
  for (const k of UNIT_KEYS) if (lu.includes(k) && iu.includes(k)) s += 1.5;
  if (/dieu hanh/.test(fold(l.item)) !== /dieu hanh/.test(fold(`${it.name} ${it.detail || ''}`))) s -= 1;
  return s;
}
export function rankLines(it, lines) {
  return lines.map((l) => ({ l, s: scoreLine(it, l) })).sort((x, y) => y.s - x.s || x.l.sort - y.l.sort);
}
// Một dòng khớp rõ ràng (điểm cao, vượt dòng thứ hai) → tự điền luôn, không cần hỏi
export function autoPick(it, lines) {
  const r = rankLines(it, lines).filter((x) => x.l.price != null);
  if (!r.length || r[0].s < 3) return null;
  if (r[1] && r[1].s >= r[0].s - 1) return null;
  return r[0].l;
}
export const itemQty = (it) => Number(it.accept_qty ?? it.qty) || 1;
