// Nhập giải ĐÃ triển khai (giải cũ) cho Lợi nhuận tháng: tạo giải + hạng mục + thanh toán từ file nghiệm thu hoặc báo giá,
// KHÔNG tạo checklist. Admin và Kế toán dùng được.
import { html, useState } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import { Modal } from './ui.js';
import { parseQuote, money, fold } from './ev-core.js';
import { parseAcceptance, acceptanceItems, eventProfit } from './finance-core.js';

const uuid = () => crypto.randomUUID();
const ok = ({ data, error }) => {
  if (error) throw new Error(/row-level security|permission/i.test(error.message) ? 'Bạn không có quyền thao tác này' : error.message);
  return data;
};
const num = (v) => (v === '' || v == null ? 0 : Number(String(v).replace(/[^\d-]/g, '')) || 0);
async function loadXlsx() {
  const m = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
  return m.default || m;
}

// Đọc file: sheet có cột chi phí NCC = file nghiệm thu, còn lại thử đọc như báo giá
export function readPastFile(sheets, fileName) {
  const out = [];
  const rest = [];
  for (const s of sheets) {
    let acc = null;
    try {
      acc = parseAcceptance(s.rows);
    } catch {
      acc = null;
    }
    // File nghiệm thu: có cột Cost NCC, hoặc có nhóm "phát sinh" / "không sử dụng", hoặc tiêu đề ghi "nghiệm thu".
    // (Không đọc như báo giá, nếu không các dòng "Đã thanh toán", "Còn lại", số tài khoản bị tính thành hạng mục.)
    const head = s.rows.slice(0, 20).flat().filter((c) => typeof c === 'string').map(fold).join(' ');
    const accLike = acc && acc.items.length && (acc.items.some((a) => a.cost != null) || acc.items.some((a) => a.groupKind !== 'contract') || /nghiem thu|quyet toan/.test(head));
    if (accLike) {
      const items = acceptanceItems(acc);
      const draft = { fee_rate: acc.fee_rate, vat_rate: acc.vat_rate };
      const p = eventProfit(draft, items, []);
      out.push({ mode: 'acc', sheet: s.name, acc, items, total: acc.totals.total || p.total, revenue: p.revenue, cost: p.cost, noCost: !items.some((a) => a.cost != null) });
    } else rest.push(s);
  }
  if (rest.length) {
    let qs = [];
    try {
      qs = parseQuote(rest);
    } catch {
      qs = [];
    }
    for (const q of qs) {
      if (!q.items.length) continue;
      out.push({ mode: 'quote', sheet: q.sheet, q, items: q.items, total: q.totals.total || q.totals.items_sum, title: q.title, client: q.client });
    }
  }
  const base = fileName.replace(/\.[^.]+$/, '').replace(/fairplay(\s*sports)?/gi, '').replace(/b[aá]o gi[aá]|nghi[eệ]m thu/gi, '')
    .replace(/[_\s-]*v\d+$/i, '').replace(/[_]+/g, ' ').replace(/^[\s-]+|[\s-]+$/g, '').replace(/\s+/g, ' ') || 'Giải';
  const title = (t) => {
    const v = (t || '').replace(/^bá?o giá chi phí\s*/i, '').trim();
    return v && !/^ngày|^\d|^[ivx]+\.|b[aá]o gi[aá]/i.test(v) ? v : base;
  };
  return out.map((x) => ({ ...x, name: title(x.title) + (out.length > 1 ? ` - ${x.sheet}` : '') }));
}

export function ImportPastEvent({ ctx, onClose, onDone }) {
  const { store, customers = [], notify } = ctx;
  const sb = store.sb;
  const [file, setFile] = useState(null);
  const [list, setList] = useState(null);
  const [forms, setForms] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  async function onFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    setErr('');
    try {
      const XLSX = await loadXlsx();
      const wb = XLSX.read(await f.arrayBuffer());
      const sheets = wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) }));
      const l = readPastFile(sheets, f.name);
      if (!l.length) return setErr('Không đọc được hạng mục nào. File cần theo mẫu nghiệm thu hoặc báo giá của Fairplay (cột STT, Nội dung, Số lượng, Đơn giá, Thành tiền).');
      setFile(f);
      setList(l);
      setForms(l.map((x, i) => {
        const cust = x.client && customers.find((c) => fold(c.name).includes(fold(x.client)));
        return { include: i === 0, name: x.name, customer_id: cust?.id || '', client_name: cust?.name || x.client || '', event_date: '', venue: '',
          paid: x.total ? Math.round(x.total) : 0, supPaid: true };
      }));
    } catch (x) {
      setErr('Không đọc được file: ' + x.message);
    }
  }
  const upd = (i, patch) => setForms(forms.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  async function create() {
    const chosen = forms.map((f, i) => ({ f, x: list[i] })).filter((y) => y.f.include);
    if (!chosen.length) return setErr('Chọn ít nhất 1 giải.');
    if (chosen.some(({ f }) => !f.event_date)) return setErr('Nhập ngày tổ chức cho từng giải (để xếp vào đúng tháng).');
    if (chosen.some(({ f }) => !f.name.trim())) return setErr('Nhập tên giải.');
    setErr('');
    const months = [];
    try {
      for (const { f, x } of chosen) {
        setBusy(`Đang lưu "${f.name}"…`);
        const evId = uuid();
        const isAcc = x.mode === 'acc';
        const supFields = (cost) => (cost == null ? { supplier_status: 'unpaid', supplier_paid: 0 }
          : Number(cost) === 0 ? { supplier_status: 'none', supplier_paid: 0 }
          : f.supPaid ? { supplier_status: 'paid', supplier_paid: cost } : { supplier_status: 'unpaid', supplier_paid: 0 });
        const items = isAcc
          ? x.items.map((a, i) => ({
            id: uuid(), event_id: evId, section: a.section || null, name: a.name, detail: a.detail || null, qty: a.qty, unit: a.unit || null,
            unit_price: a.unit_price, amount: a.amount, accept_amount: a.amount, cost_amount: a.cost, accept_unit_cost: a.unit_cost,
            is_extra: !!a.is_extra, chosen: true, not_used: !!a.not_used, accept_status: 'ok', note: a.note || null, sort: i, ...supFields(a.cost),
          }))
          : x.items.map((it, i) => ({
            id: uuid(), event_id: evId, section: it.section || null, grp: it.grp || null, name: it.name, detail: it.detail || null, qty: it.qty, unit: it.unit || null,
            unit_price: it.unit_price, days: it.days || null, amount: it.amount, note: it.note || null, is_option: !!it.is_option, chosen: !it.is_option, sort: i,
          }));
        const t = isAcc ? x.acc.totals : x.q.totals;
        const total = Math.round(x.total || 0);
        const paid = Math.min(num(f.paid), total || num(f.paid));
        ok(await sb.from('ev_events').insert({
          id: evId, name: f.name.trim(), client_name: f.client_name || null, customer_id: f.customer_id || null, venue: f.venue || null,
          event_date: f.event_date, status: 'done',
          quote_subtotal: isAcc ? null : t.subtotal ?? null, quote_fee: t.fee ?? null, quote_vat: t.vat ?? null, quote_total: total || null,
          fee_rate: isAcc ? x.acc.fee_rate : null, vat_rate: isAcc ? x.acc.vat_rate : null,
          accepted_at: isAcc ? f.event_date : null, acceptance_imported_at: isAcc ? new Date().toISOString() : null,
          source_file: `${file.name} › ${x.sheet}`, notes: 'Giải cũ nhập ở Lợi nhuận tháng (không có checklist)',
        }));
        ok(await sb.from('ev_items').insert(items));
        ok(await sb.from('ev_payments').insert({
          id: uuid(), event_id: evId, label: 'Thanh toán', amount: total, due_date: f.event_date, sort: 0,
          paid_amount: paid, status: paid <= 0 ? 'unpaid' : paid >= total ? 'paid' : 'partial', paid_at: paid > 0 ? f.event_date : null,
        }));
        const path = `${evId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
        const up = await sb.storage.from('ev-files').upload(path, file);
        if (!up.error) await sb.from('ev_files').insert({ event_id: evId, kind: isAcc ? 'acceptance' : 'quote', name: file.name, path, size: file.size });
        months.push(f.event_date.slice(0, 7));
      }
      notify(`Đã nhập ${chosen.length} giải đã triển khai`);
      onDone(months[0]);
    } catch (x) {
      setErr(x.message);
    }
    setBusy('');
  }

  return html`<${Modal} title="Nhập giải đã triển khai" onClose=${onClose} wide>
    <div class="form">
      <p class="muted">Dùng cho giải cũ đã tổ chức xong: chỉ tạo số liệu tiền (doanh thu, chi phí NCC, thanh toán) để tính lợi nhuận, <b>không tạo checklist</b>.
        Nên chọn <b>file nghiệm thu</b> (có cột chi phí NCC) để ra lãi đúng ngay. Nếu chỉ có báo giá thì nhập giá nhập sau ở Triển khai giải → tab Hạng mục & NCC.</p>
      <input type="file" accept=".xlsx,.xls" onChange=${onFile} />
      ${list && forms.map((f, i) => {
        const x = list[i];
        return html`<fieldset class="fs" key=${i}>
          <legend><label class="inline-check"><input type="checkbox" checked=${f.include} onChange=${(e) => upd(i, { include: e.target.checked })} />
            Sheet "${x.sheet}" - ${x.mode === 'acc' ? 'file nghiệm thu' : 'báo giá'} · ${x.items.length} hạng mục · khách trả ${money(x.total)}${x.mode === 'acc' && !x.noCost ? ` · chi phí NCC ${money(x.cost)}` : ''}</label></legend>
          ${x.noCost && html`<p class="note">File này không có cột "Cost phải trả nhà cung cấp" nên chưa tính được lãi. Nên dùng bản nghiệm thu có cột Cost, hoặc điền giá nhập sau ở tab Hạng mục & NCC.</p>`}
          ${x.mode === 'acc' && x.acc.totals.paid ? html`<p class="muted small">File ghi khách đã thanh toán ${money(x.acc.totals.paid)}${x.acc.totals.remaining ? `, còn lại ${money(x.acc.totals.remaining)}` : ''}. Sửa ô "Khách đã trả" nếu khác.</p>` : ''}
          ${f.include && html`<div class="grid2">
            <label>Tên giải *<input value=${f.name} onInput=${(e) => upd(i, { name: e.target.value })} /></label>
            <label>Ngày tổ chức *<input type="date" value=${f.event_date} onInput=${(e) => upd(i, { event_date: e.target.value })} /></label>
            <label>Khách hàng (CRM)<select value=${f.customer_id} onChange=${(e) => { const c = customers.find((y) => y.id === e.target.value); upd(i, { customer_id: e.target.value, client_name: c?.name || f.client_name }); }}>
              <option value="">- Chọn khách hàng -</option>${customers.map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select></label>
            <label>Tên khách (nếu chưa có trong CRM)<input value=${f.client_name} onInput=${(e) => upd(i, { client_name: e.target.value })} /></label>
            <label>Địa điểm<input value=${f.venue} onInput=${(e) => upd(i, { venue: e.target.value })} /></label>
            <label>Khách đã trả (đ)<input type="number" value=${f.paid} onInput=${(e) => upd(i, { paid: e.target.value })} /></label>
            ${x.mode === 'acc' && !x.noCost && html`<label class="inline-check"><input type="checkbox" checked=${f.supPaid} onChange=${(e) => upd(i, { supPaid: e.target.checked })} /> Đã trả đủ tiền cho nhà cung cấp</label>`}
          </div>`}
        </fieldset>`;
      })}
      ${err && html`<div class="err">${err}</div>`}
      ${list && html`<div class="row end"><button class="btn" onClick=${onClose}>Huỷ</button><button class="btn primary" disabled=${!!busy} onClick=${create}>${busy || 'Lưu giải'}</button></div>`}
    </div>
  </${Modal}>`;
}

// Xoá giải (kèm hạng mục, thanh toán, checklist, hồ sơ). Admin xoá mọi giải; Kế toán xoá giải do mình nhập.
export const canDeleteEvent = (ctx, ev) => ctx.isAdmin || (ctx.canEditMoney && ev.created_by === ctx.user.id);
export async function deleteEvent(ctx, ev) {
  const sb = ctx.store.sb;
  const { data: files } = await sb.from('ev_files').select('path').eq('event_id', ev.id);
  if (files?.length) await sb.storage.from('ev-files').remove(files.map((f) => f.path));
  const { data, error } = await sb.from('ev_events').delete().eq('id', ev.id).select('id');
  if (error) throw new Error(/row-level security|permission/i.test(error.message) ? 'Bạn không có quyền xoá giải này' : error.message);
  if (!data?.length) throw new Error('Bạn không có quyền xoá giải này');
}
