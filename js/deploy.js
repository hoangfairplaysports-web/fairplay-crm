// Triển khai giải: giải đã chốt / ký HĐ → nhập báo giá → checklist (bên Fairplay Checklist),
// theo dõi hợp đồng, khách thanh toán, trả nhà cung cấp, phát sinh, nghiệm thu, hồ sơ.
// Dùng chung bảng ev_* với Fairplay Checklist. Phần tiền chỉ Admin thấy (RLS).
import { html, useState, useEffect, useMemo } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import { Modal } from './ui.js';
import * as U from './util.js';
import { parseQuote, generateChecklist, tasksForItem, defaultPayments, eventHealth, money, addDays, PHASES, fold } from './ev-core.js';
import { parseAcceptance, matchAcceptance, acceptanceItems, eventProfit, PAYEE, DEFAULTS } from './finance-core.js';
import { canDeleteEvent, deleteEvent } from './past-import.js';
import { parsePriceSheet, rankLines, autoPick, itemQty } from './supplier-core.js';

const CHECKLIST_URL = 'https://hoangfairplaysports-web.github.io/fairplay-checklist/#events';
const EV_STATUS = { preparing: 'Đang chuẩn bị', running: 'Đang diễn ra', done: 'Đã xong', cancelled: 'Đã huỷ' };
const SUP_STATUS = { unpaid: 'Chưa trả', partial: 'Trả một phần', paid: 'Đã trả', none: 'Không qua NCC' };
const ACC = { pending: 'Chưa nghiệm thu', ok: 'Đạt', issue: 'Có vấn đề' };
const today = () => U.todayStr();
const n = (v) => (v === '' || v == null ? null : Number(v));
const uuid = () => crypto.randomUUID();

async function loadXlsx() {
  const m = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
  return m.default || m;
}
const ok = ({ data, error }) => {
  if (error) throw new Error(/row-level security|permission/i.test(error.message) ? 'Bạn không có quyền thao tác này' : error.message);
  return data;
};

// ---------------------------------------------------------------------------
export function DeployView({ ctx }) {
  const { store, isAdmin, notify } = ctx;
  const fin = ctx.canFinance; // xem tiền, giá nhập, lợi nhuận
  const sb = store.sb;
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('active');
  const [openId, setOpenId] = useState(null);
  const [importing, setImporting] = useState(false);

  async function load() {
    try {
      const [events, tasks, items, payments, suppliers, members, prices] = await Promise.all([
        sb.from(fin ? 'ev_events' : 'ev_events_public').select('*').order('event_date').then(ok),
        sb.from('ev_tasks').select('id, event_id, status, due_date, phase').then(ok),
        fin ? sb.from('ev_items').select('*').order('sort').then(ok) : [],
        fin ? sb.from('ev_payments').select('*').order('sort').then(ok) : [],
        fin ? sb.from('ev_suppliers').select('*').order('name').then(ok) : [],
        sb.from('cl_members').select('id, full_name, role, active').then(ok).catch(() => []),
        fin ? sb.from('ev_supplier_prices').select('*').order('sort').then(ok).catch(() => []) : [],
      ]);
      setData({ events, tasks, items, payments, suppliers, members, prices });
    } catch (e) {
      notify(e.message, 'err');
      setData({ events: [], tasks: [], items: [], payments: [], suppliers: [], members: [], prices: [] });
    }
  }
  useEffect(() => {
    if (sb) load();
  }, []);

  if (!sb) return html`<div class="page"><div class="empty">Mục Triển khai giải chỉ chạy ở bản thật (đã kết nối Supabase).</div></div>`;
  if (!data) return html`<div class="splash">Đang tải…</div>`;
  const t = today();
  const evs = data.events.filter((e) => (tab === 'active' ? !['done', 'cancelled'].includes(e.status) : tab === 'done' ? ['done', 'cancelled'].includes(e.status) : true));
  const open = data.events.find((e) => e.id === openId);
  const totals = data.events.filter((e) => e.status !== 'cancelled').map((e) => eventHealth(e, data, t));
  const warnN = totals.filter((h) => h.warn.length).length;

  return html`<div class="page wide">
    <div class="page-head">
      <div><h1>🚀 Triển khai giải</h1><div class="muted">Giải đã chốt / ký hợp đồng. Nhập báo giá → tự tạo checklist bên Fairplay Checklist + bảng theo dõi tiền.</div></div>
      <div class="row">
        <div class="seg">${[['active', 'Đang triển khai'], ['done', 'Đã xong'], ...(fin ? [['suppliers', 'Nhà cung cấp']] : [])].map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${l}</button>`)}</div>
        ${isAdmin && fin && html`<button class="btn primary" onClick=${() => setImporting(true)}>⬆ Nhập báo giá</button>`}
      </div>
    </div>
    ${fin && tab !== 'suppliers' && html`<div class="kpis">
      <div class="kpi info"><b>${data.events.filter((e) => !['done', 'cancelled'].includes(e.status)).length}</b><span>Giải đang triển khai</span></div>
      <div class=${'kpi ' + (warnN ? 'bad' : 'good')}><b>${warnN}</b><span>Giải cần chú ý</span></div>
      <div class="kpi"><b>${money(totals.reduce((a, h) => a + h.dueIn - h.paidIn, 0))}</b><span>Khách còn phải trả</span></div>
      <div class="kpi warn"><b>${money(totals.reduce((a, h) => a + Math.max(0, h.cost - h.paidOut), 0))}</b><span>Còn phải trả NCC</span></div>
    </div>`}
    ${tab === 'suppliers' ? html`<${Suppliers} ctx=${ctx} data=${data} reload=${load} />` : html`
      ${!evs.length && html`<div class="empty">${tab === 'active' ? 'Chưa có giải nào. Bấm "⬆ Nhập báo giá" khi giải đã chốt / ký hợp đồng.' : 'Chưa có giải đã xong.'}</div>`}
      ${evs.length > 0 && html`<div class="table-wrap"><table class="table leads">
        <thead><tr><th>Giải</th><th>Ngày</th><th>Hợp đồng</th><th>Checklist</th>${fin && html`<th class="num">Khách đã trả</th><th class="num">Đã trả NCC</th>`}<th>Cần chú ý</th></tr></thead>
        <tbody>${evs.map((e) => {
          const h = eventHealth(e, data, t);
          const d = e.event_date ? U.daysBetween(t, e.event_date) : null;
          return html`<tr onClick=${() => setOpenId(e.id)}>
            <td data-l="Giải"><b>${e.name}</b><div class="muted small">${[e.client_name, e.venue].filter(Boolean).join(' · ')}</div></td>
            <td data-l="Ngày" class="nowrap">${e.event_date ? U.fmtDate(e.event_date) : '—'}${d != null && d >= 0 && html`<div class=${'small ' + (d <= 7 ? 'stale' : 'muted')}>còn ${d} ngày</div>`}</td>
            <td data-l="Hợp đồng">${e.contract_signed_at ? html`<span class="badge ok">Đã ký ${U.fmtDate(e.contract_signed_at)}</span>`
              : e.contract_deadline && e.contract_deadline < t ? html`<span class="badge bad">Quá hạn ký</span>` : html`<span class="badge warn">Chưa ký${e.contract_deadline ? ' · hạn ' + U.fmtDate(e.contract_deadline) : ''}</span>`}</td>
            <td data-l="Checklist">${h.done}/${h.tasks} (${h.pct}%)${h.overdue ? html` <span class="badge bad">${h.overdue} quá hạn</span>` : ''}</td>
            ${fin && html`<td data-l="Khách đã trả" class="num">${money(h.paidIn)}<div class="muted small">/ ${money(h.dueIn)}</div></td>
              <td data-l="Đã trả NCC" class="num">${money(h.paidOut)}<div class="muted small">/ ${money(h.cost)}</div></td>`}
            <td data-l="Cần chú ý">${h.warn.map((w) => html`<span class="badge bad">${w}</span> `)}</td>
          </tr>`;
        })}</tbody>
      </table></div>`}`}
    ${importing && html`<${ImportQuote} ctx=${ctx} data=${data} onClose=${() => setImporting(false)} onDone=${async (id) => { setImporting(false); await load(); if (id) setOpenId(id); }} />`}
    ${open && html`<${DeployDrawer} ctx=${ctx} ev=${open} data=${data} reload=${load} onClose=${() => setOpenId(null)} key=${open.id} />`}
  </div>`;
}

// ---------------------------------------------------------------------------
// Nhập báo giá → tạo giải
// ---------------------------------------------------------------------------
function ImportQuote({ ctx, data, onClose, onDone }) {
  const { store, customers, notify } = ctx;
  const sb = store.sb;
  const [file, setFile] = useState(null);
  const [quotes, setQuotes] = useState(null);
  const [forms, setForms] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const staff = data.members.filter((m) => m.active !== false && m.role !== 'bod');
  const admin = data.members.find((m) => m.role === 'admin');

  async function onFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    setErr('');
    try {
      const XLSX = await loadXlsx();
      const wb = XLSX.read(await f.arrayBuffer());
      const qs = parseQuote(wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) })));
      if (!qs.length) return setErr('Không đọc được hạng mục nào. File cần theo mẫu báo giá Fairplay (cột STT · Nội dung · Bao gồm · Số lượng · ĐVT · Đơn giá · Thành tiền).');
      setFile(f);
      setQuotes(qs);
      setForms(qs.map((q) => {
        const title = (q.title || '').replace(/^bá?o giá chi phí\s*/i, '').trim();
        const cust = customers.find((c) => q.client && fold(c.name).includes(fold(q.client)));
        return {
          include: true, name: [title || 'Giải', qs.length > 1 ? `— ${q.sheet}` : ''].join(' ').trim(), client_name: cust?.name || '',
          customer_id: cust?.id || '', event_date: '', venue: '', sport: /pickleball/i.test(title) ? 'Pickleball' : '', pm_id: admin?.id || '',
          contract_signed_at: today(), contract_deadline: '', client_contact: q.client || '', pay1: 70,
          optionsChosen: Object.fromEntries(q.items.map((it, i) => [i, !it.is_option])),
        };
      }));
    } catch (x) {
      setErr('Không đọc được file: ' + x.message);
    }
  }
  const upd = (i, patch) => setForms(forms.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  async function create() {
    const chosen = forms.map((f, i) => ({ f, q: quotes[i] })).filter((x) => x.f.include);
    if (chosen.some(({ f }) => !f.event_date)) return setErr('Nhập ngày tổ chức cho từng giải để tính hạn chót checklist.');
    setErr('');
    let firstId = null;
    try {
      for (const { f, q } of chosen) {
        setBusy(`Đang tạo "${f.name}"…`);
        const evId = uuid();
        firstId = firstId || evId;
        const items = q.items.map((it, i) => ({
          id: uuid(), event_id: evId, section: it.section || null, grp: it.grp || null, name: it.name, detail: it.detail || null, qty: it.qty, unit: it.unit || null,
          unit_price: it.unit_price, days: it.days || null, amount: it.amount, note: it.note || null, is_option: it.is_option, chosen: !!f.optionsChosen[i], sort: i,
        }));
        const total = q.totals.total || q.totals.items_sum;
        const p1 = Number(f.pay1) || 70;
        const pays = defaultPayments(total, f.event_date).map((p, i) => ({
          ...p, id: uuid(), event_id: evId,
          label: i === 0 ? `Đợt 1 — cọc ${p1}%` : `Đợt 2 — ${100 - p1}% còn lại`, percent: i === 0 ? p1 : 100 - p1,
          amount: i === 0 ? Math.round((total * p1) / 100) : total - Math.round((total * p1) / 100),
        }));
        const gen = generateChecklist({ items: items.map((it) => ({ ...it, ref: it.id })), eventDate: f.event_date, today: today(), payments: pays });
        const tasks = gen.map((t) => ({
          id: uuid(), event_id: evId, phase: t.phase, category: t.category, title: t.title, detail: t.detail || null, pic_id: f.pm_id || null,
          offset_days: t.offset_days, due_date: t.due_date, note: t.note || null, item_id: t.item_ref, sort: t.sort,
          status: t.kind === 'contract' && f.contract_signed_at ? 'done' : 'todo',
        }));
        ok(await sb.from('ev_events').insert({
          id: evId, name: f.name, client_name: f.client_name || null, customer_id: f.customer_id || null, sport: f.sport || null, venue: f.venue || null,
          event_date: f.event_date, pm_id: f.pm_id || null, client_contact: f.client_contact || null,
          contract_signed_at: f.contract_signed_at || null, contract_deadline: f.contract_deadline || null,
          quote_subtotal: q.totals.subtotal ?? null, quote_fee: q.totals.fee ?? null, quote_vat: q.totals.vat ?? null, quote_total: total || null,
          source_file: `${file.name} › ${q.sheet}`,
        }));
        ok(await sb.from('ev_items').insert(items));
        ok(await sb.from('ev_payments').insert(pays.map(({ offset_days, ...p }) => p)));
        for (let i = 0; i < tasks.length; i += 200) ok(await sb.from('ev_tasks').insert(tasks.slice(i, i + 200)));
        // Lưu file báo giá gốc
        const path = `${evId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
        const up = await sb.storage.from('ev-files').upload(path, file);
        if (!up.error) await sb.from('ev_files').insert({ event_id: evId, kind: 'quote', name: file.name, path, size: file.size });
      }
      notify(`Đã tạo ${chosen.length} giải — checklist đã có bên Fairplay Checklist`);
      onDone(firstId);
    } catch (x) {
      setErr(x.message);
    }
    setBusy('');
  }

  return html`<${Modal} title="Nhập báo giá — tạo giải triển khai" onClose=${onClose} wide>
    <div class="form">
      <p class="muted">Chọn file báo giá Excel (mẫu Fairplay). Mỗi sheet giải = 1 giải riêng. Sheet "Checklist" cũ trong file sẽ được bỏ qua.</p>
      <input id="q-file" type="file" accept=".xlsx,.xls" onChange=${onFile} />
      ${quotes && forms.map((f, i) => {
        const q = quotes[i];
        const opts = q.items.map((it, j) => ({ it, j })).filter(({ it }) => it.is_option);
        return html`<fieldset class="fs" key=${i}>
          <legend><label class="inline-check"><input type="checkbox" checked=${f.include} onChange=${(e) => upd(i, { include: e.target.checked })} /> Sheet "${q.sheet}" — ${q.items.length} hạng mục · tổng ${money(q.totals.total || q.totals.items_sum)}</label></legend>
          ${f.include && html`
            <div class="grid2">
              <label>Tên giải<input value=${f.name} onInput=${(e) => upd(i, { name: e.target.value })} /></label>
              <label>Ngày tổ chức *<input type="date" value=${f.event_date} onInput=${(e) => upd(i, { event_date: e.target.value })} /></label>
              <label>Khách hàng (CRM)<select value=${f.customer_id} onChange=${(e) => { const c = customers.find((x) => x.id === e.target.value); upd(i, { customer_id: e.target.value, client_name: c?.name || f.client_name }); }}>
                <option value="">— Chọn khách hàng —</option>${customers.map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select></label>
              <label>Địa điểm<input value=${f.venue} onInput=${(e) => upd(i, { venue: e.target.value })} placeholder="Sân, thành phố" /></label>
              <label>PM phụ trách (nhận checklist)<select value=${f.pm_id} onChange=${(e) => upd(i, { pm_id: e.target.value })}><option value="">—</option>${staff.map((m) => html`<option value=${m.id}>${m.full_name}</option>`)}</select></label>
              <label>Đầu mối phía khách<input value=${f.client_contact} onInput=${(e) => upd(i, { client_contact: e.target.value })} placeholder="Tên — SĐT" /></label>
              <label>Ngày ký hợp đồng<input type="date" value=${f.contract_signed_at} onInput=${(e) => upd(i, { contract_signed_at: e.target.value })} /></label>
              <label>Hạn ký HĐ (nếu chưa ký)<input type="date" value=${f.contract_deadline} onInput=${(e) => upd(i, { contract_deadline: e.target.value })} /></label>
              <label>Đợt 1 (cọc) %<input type="number" min="0" max="100" value=${f.pay1} onInput=${(e) => upd(i, { pay1: e.target.value })} /></label>
            </div>
            ${opts.length > 0 && html`<div><b class="small">Hạng mục Option — tick những mục khách đã chọn:</b>
              <div class="chips">${opts.map(({ it, j }) => html`<button type="button" class=${'chip ' + (f.optionsChosen[j] ? 'on' : '')} onClick=${() => upd(i, { optionsChosen: { ...f.optionsChosen, [j]: !f.optionsChosen[j] } })}>${it.name} · ${money(it.amount)}</button>`)}</div></div>`}`}
        </fieldset>`;
      })}
      ${err && html`<div class="err">${err}</div>`}
      ${quotes && html`<div class="row end"><button class="btn" onClick=${onClose}>Huỷ</button><button class="btn primary" disabled=${!!busy} onClick=${create}>${busy || 'Tạo giải & checklist'}</button></div>`}
    </div>
  </${Modal}>`;
}

// ---------------------------------------------------------------------------
// Chi tiết 1 giải
// ---------------------------------------------------------------------------
function DeployDrawer({ ctx, ev, data, reload, onClose }) {
  const { isAdmin } = ctx;
  const fin = ctx.canFinance;
  const [tab, setTab] = useState('overview');
  const [importAcc, setImportAcc] = useState(false);
  const h = eventHealth(ev, data, today());
  const TABS = [['overview', 'Tổng quan'], ...(fin ? [['pay', 'Thu tiền khách'], ['items', 'Hạng mục & NCC'], ['extra', 'Phát sinh'], ['accept', 'Nghiệm thu'], ['profit', 'Lợi nhuận'], ['files', 'Hồ sơ']] : [])];
  return html`<div class="drawer-overlay" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
    <aside class="drawer wide-drawer">
      <div class="drawer-head"><div><h2>${ev.name}</h2><div class="muted">${[ev.client_name, ev.venue, ev.event_date && U.fmtDate(ev.event_date)].filter(Boolean).join(' · ')}</div>
        <div class="row" style="margin-top:6px">${h.warn.map((w) => html`<span class="badge bad">${w}</span>`)}
          ${ctx.canEditMoney && html`<button class="btn sm" onClick=${() => setImportAcc(true)}>⬆ Nhập file nghiệm thu</button>`}
          ${canDeleteEvent(ctx, ev) && html`<button class="btn sm danger" onClick=${async () => {
            if (!confirm(`Xoá giải "${ev.name}" cùng toàn bộ hạng mục, thanh toán, checklist và hồ sơ? Không khôi phục được.`)) return;
            try { await deleteEvent(ctx, ev); ctx.notify('Đã xoá giải'); onClose(); reload(); } catch (x) { ctx.notify(x.message, 'err'); }
          }}>🗑 Xoá giải</button>`}</div></div>
        <button class="x" onClick=${onClose}>×</button></div>
      <div class="seg" style="margin:0 18px">${TABS.map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${l}</button>`)}</div>
      <div class="drawer-body">
        ${tab === 'overview' && html`<${Overview} ctx=${ctx} ev=${ev} data=${data} h=${h} reload=${reload} />`}
        ${tab === 'pay' && html`<${Payments} ctx=${ctx} ev=${ev} data=${data} h=${h} reload=${reload} />`}
        ${tab === 'items' && html`<${Items} ctx=${ctx} ev=${ev} data=${data} reload=${reload} />`}
        ${tab === 'extra' && html`<${Extras} ctx=${ctx} ev=${ev} data=${data} reload=${reload} />`}
        ${tab === 'accept' && html`<${Acceptance} ctx=${ctx} ev=${ev} data=${data} reload=${reload} />`}
        ${tab === 'profit' && html`<${ProfitTab} ctx=${ctx} ev=${ev} data=${data} reload=${reload} onImport=${() => setImportAcc(true)} />`}
        ${tab === 'files' && html`<${Files} ctx=${ctx} ev=${ev} />`}
      </div>
    </aside>
    ${importAcc && html`<${ImportAcceptance} ctx=${ctx} ev=${ev} data=${data} onClose=${() => setImportAcc(false)} onDone=${async () => { setImportAcc(false); await reload(); setTab('profit'); }} />`}
  </div>`;
}

function useSave(ctx, reload) {
  return async (table, id, patch, msg) => {
    try {
      ok(await ctx.store.sb.from(table).update(patch).eq('id', id));
      if (msg) ctx.notify(msg);
      await reload();
    } catch (e) {
      ctx.notify(e.message, 'err');
    }
  };
}

function Overview({ ctx, ev, data, h, reload }) {
  const save = useSave(ctx, reload);
  const { isAdmin } = ctx;
  const fin = ctx.canFinance;
  // Cùng công thức với tab Lợi nhuận (doanh thu chưa VAT gồm phí quản lý, trừ hạng mục không sử dụng)
  const pr = fin ? eventProfit(ev, data.items.filter((i) => i.event_id === ev.id), data.payments.filter((p) => p.event_id === ev.id)) : null;
  const [f, setF] = useState(ev);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pm = data.members.find((m) => m.id === ev.pm_id);
  const staff = data.members.filter((m) => m.active !== false && m.role !== 'bod');
  return html`<div class="form">
    <div class="kpis">
      <div class="kpi info"><b>${h.pct}%</b><span>Checklist (${h.done}/${h.tasks})${h.overdue ? ` · ${h.overdue} quá hạn` : ''}</span></div>
      ${fin && html`<div class="kpi"><b>${money(ev.quote_total)}</b><span>Giá trị báo giá${h.extras ? ` + phát sinh ${money(h.extras)}` : ''}</span></div>
        <div class="kpi good"><b>${money(h.paidIn)}</b><span>Khách đã trả / ${money(h.dueIn)}</span></div>
        <div class="kpi warn"><b>${money(h.paidOut)}</b><span>Đã trả NCC / ${money(h.cost)}</span></div>
        ${h.cost > 0 && html`<div class=${'kpi ' + (pr.margin < 0.25 ? 'warn' : 'good')}><b>${money(pr.gross)}</b><span>Lãi gộp ước tính (chưa VAT) · biên ${pct(pr.margin)}</span></div>`}`}
    </div>
    <p><a class="btn" href=${CHECKLIST_URL} target="_blank" rel="noopener">📋 Mở checklist giải trong Fairplay Checklist ↗</a></p>
    ${isAdmin ? html`<div class="grid2">
      <label>Tên giải<input value=${f.name} onInput=${set('name')} /></label>
      <label>Trạng thái<select value=${f.status} onChange=${set('status')}>${Object.entries(EV_STATUS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
      <label>Ngày tổ chức<input type="date" value=${f.event_date || ''} onInput=${set('event_date')} /></label>
      <label>Địa điểm<input value=${f.venue || ''} onInput=${set('venue')} /></label>
      <label>Khách hàng<input value=${f.client_name || ''} onInput=${set('client_name')} /></label>
      <label>Đầu mối phía khách<input value=${f.client_contact || ''} onInput=${set('client_contact')} /></label>
      <label>PM<select value=${f.pm_id || ''} onChange=${set('pm_id')}><option value="">—</option>${staff.map((m) => html`<option value=${m.id}>${m.full_name}</option>`)}</select></label>
      <label>Ngày ký hợp đồng<input type="date" value=${f.contract_signed_at || ''} onInput=${set('contract_signed_at')} /></label>
      <label>Hạn ký HĐ<input type="date" value=${f.contract_deadline || ''} onInput=${set('contract_deadline')} /></label>
      <label>Ghi chú hợp đồng<input value=${f.contract_note || ''} onInput=${set('contract_note')} placeholder="VD: chờ khách đóng dấu" /></label>
    </div>
    <label>Ghi chú<textarea rows="2" value=${f.notes || ''} onInput=${set('notes')}></textarea></label>
    <div class="row end"><button class="btn primary" onClick=${() => {
      const patch = {};
      for (const k of ['name', 'status', 'event_date', 'venue', 'client_name', 'client_contact', 'pm_id', 'contract_signed_at', 'contract_deadline', 'contract_note', 'notes']) patch[k] = f[k] === '' ? null : f[k];
      if (patch.event_date && patch.event_date !== ev.event_date) shiftTasks(ctx, ev.id, patch.event_date);
      save('ev_events', ev.id, patch, 'Đã lưu');
    }}>Lưu</button></div>
    ${ev.event_date !== f.event_date && f.event_date && html`<p class="note">Đổi ngày tổ chức: hạn chót các việc chưa xong trong checklist sẽ được dời theo mốc D khi bấm Lưu.</p>`}
    <p class="muted small">Nguồn: ${ev.source_file || '—'}</p>`
    : html`<dl class="infolist"><dt>PM</dt><dd>${pm?.full_name || '—'}</dd><dt>Hợp đồng</dt><dd>${ev.contract_signed_at ? 'Đã ký ' + U.fmtDate(ev.contract_signed_at) : 'Chưa ký'}</dd></dl>`}
  </div>`;
}

// Đổi ngày giải → dời hạn các việc chưa xong theo mốc D
async function shiftTasks(ctx, eventId, newDate) {
  const sb = ctx.store.sb;
  const { data } = await sb.from('ev_tasks').select('id, offset_days, status').eq('event_id', eventId).neq('status', 'done').not('offset_days', 'is', null);
  await Promise.all((data || []).map((t) => sb.from('ev_tasks').update({ due_date: addDays(newDate, t.offset_days) }).eq('id', t.id)));
  ctx.notify(`Đã dời hạn ${data?.length || 0} việc theo ngày giải mới`);
}

function Payments({ ctx, ev, data, h, reload }) {
  const sb = ctx.store.sb;
  const rows = data.payments.filter((p) => p.event_id === ev.id);
  const save = useSave(ctx, reload);
  const t = today();
  async function add() {
    ok(await sb.from('ev_payments').insert({ event_id: ev.id, label: `Đợt ${rows.length + 1}`, amount: 0, sort: rows.length }));
    reload();
  }
  return html`<div class="form">
    <p class="muted">Giá trị cần thu: <b>${money(ev.quote_total)}</b>${h.extras ? html` + phát sinh <b>${money(h.extras)}</b> (chưa VAT/phí)` : ''} · Đã thu <b>${money(h.paidIn)}</b></p>
    ${rows.map((p) => {
      const late = p.status !== 'paid' && p.due_date && p.due_date < t;
      const soon = p.status !== 'paid' && p.due_date && p.due_date >= t && p.due_date <= addDays(t, 3);
      return html`<div class=${'card-sec' + (late ? ' late' : '')} key=${p.id}>
        <div class="row between"><b>${p.label}</b>
          <span class=${'badge ' + (p.status === 'paid' ? 'ok' : late ? 'bad' : soon ? 'warn' : '')}>${p.status === 'paid' ? '✓ Đã thu' : late ? 'Quá hạn' : soon ? 'Sắp đến hạn — nhắc khách' : p.status === 'partial' ? 'Thu một phần' : 'Chưa thu'}</span></div>
        <div class="grid3">
          <label>Số tiền<input type="number" value=${p.amount ?? ''} onChange=${(e) => save('ev_payments', p.id, { amount: n(e.target.value) })} /></label>
          <label>Hạn thanh toán<input type="date" value=${p.due_date || ''} onChange=${(e) => save('ev_payments', p.id, { due_date: e.target.value || null })} /></label>
          <label>Điều kiện<input value=${p.due_rule || ''} onChange=${(e) => save('ev_payments', p.id, { due_rule: e.target.value })} /></label>
          <label>Đã thu<input type="number" value=${p.paid_amount ?? 0} onChange=${(e) => {
            const v = n(e.target.value) || 0;
            save('ev_payments', p.id, { paid_amount: v, status: v <= 0 ? 'unpaid' : v >= (p.amount || 0) ? 'paid' : 'partial', paid_at: v > 0 ? p.paid_at || t : null }, 'Đã cập nhật');
          }} /></label>
          <label>Ngày thu<input type="date" value=${p.paid_at || ''} onChange=${(e) => save('ev_payments', p.id, { paid_at: e.target.value || null })} /></label>
          <label>Ghi chú<input value=${p.note || ''} onChange=${(e) => save('ev_payments', p.id, { note: e.target.value })} /></label>
        </div>
        <div class="row">
          ${p.status !== 'paid' && html`<button class="btn sm" onClick=${() => save('ev_payments', p.id, { last_reminded: t }, 'Đã ghi nhận nhắc khách hôm nay')}>📞 Đã nhắc khách</button>`}
          ${p.last_reminded && html`<span class="muted small">Nhắc gần nhất: ${U.fmtDate(p.last_reminded)}</span>`}
          ${p.status !== 'paid' && html`<button class="btn sm" onClick=${() => save('ev_payments', p.id, { paid_amount: p.amount, status: 'paid', paid_at: t }, 'Đã thu đủ')}>✓ Đã thu đủ</button>`}
        </div>
      </div>`;
    })}
    <button class="btn" onClick=${add}>+ Thêm đợt thanh toán</button>
  </div>`;
}

function Items({ ctx, ev, data, reload }) {
  const sb = ctx.store.sb;
  const save = useSave(ctx, reload);
  const [showOpt, setShowOpt] = useState(false);
  const items = data.items.filter((i) => i.event_id === ev.id && (showOpt || i.chosen)).sort((a, b) => (a.is_extra - b.is_extra) || (a.sort - b.sort));
  const sups = data.suppliers;
  const t = today();
  const [picker, setPicker] = useState(null);
  const [other, setOther] = useState(null);
  const linesOf = (sid) => (data.prices || []).filter((p) => p.supplier_id === sid);
  const groups = supplierGroups(sups);
  // Chọn NCC → tự điền giá nhập theo bảng giá (khớp rõ thì điền luôn, nhiều lựa chọn thì hỏi); giá vẫn sửa tay được
  async function pickSupplier(it, sid) {
    if (sid === '__other') return setOther(it.id);
    setOther(null);
    if (!sid) return save('ev_items', it.id, { supplier_id: null });
    const lines = linesOf(sid);
    if (!lines.length) return save('ev_items', it.id, { supplier_id: sid }, 'Đã chọn NCC (NCC này chưa có bảng giá, nhập giá tay)');
    const a = it.cost_amount == null ? autoPick(it, lines) : null;
    if (a) {
      const q = itemQty(it);
      return save('ev_items', it.id, { supplier_id: sid, cost_amount: Math.round(a.price * q), accept_unit_cost: a.price },
        `Giá nhập ${money(a.price)} × ${q} = ${money(a.price * q)} theo bảng giá "${a.item}". Sửa được nếu khác.`);
    }
    await save('ev_items', it.id, { supplier_id: sid });
    setPicker({ itId: it.id, sid });
  }
  async function addOther(it, raw) {
    const name = raw.trim();
    if (!name) return setOther(null);
    try {
      let sup = sups.find((x) => fold(x.name) === fold(name));
      if (!sup) {
        sup = ok(await sb.from('ev_suppliers').insert({ name, region: ev.region || null }).select().single());
        ctx.notify(`Đã thêm "${name}" vào danh bạ nhà cung cấp`);
      }
      setOther(null);
      await save('ev_items', it.id, { supplier_id: sup.id });
    } catch (x) {
      ctx.notify(x.message, 'err');
    }
  }
  async function choose(it, chosen) {
    await save('ev_items', it.id, { chosen });
    if (chosen && ev.event_date) {
      const { data: existing } = await sb.from('ev_tasks').select('title').eq('event_id', ev.id);
      const tasks = tasksForItem(it, ev.event_date, t, (existing || []).map((x) => x.title));
      if (tasks.length) {
        ok(await sb.from('ev_tasks').insert(tasks.map((x, i) => ({ ...x, event_id: ev.id, item_id: it.id, pic_id: ev.pm_id, sort: 5000 + i }))));
        ctx.notify(`Đã thêm ${tasks.length} việc vào checklist`);
      }
    }
  }
  return html`<div>
    <div class="row between"><p class="muted">Ghi nhà cung cấp, giá nhập và tiến độ trả tiền cho từng hạng mục. Hạng mục do Fairplay tự làm chọn "Không qua NCC".</p>
      <label class="inline-check"><input type="checkbox" checked=${showOpt} onChange=${(e) => setShowOpt(e.target.checked)} /> Hiện cả Option khách chưa chọn</label></div>
    <div class="table-wrap"><table class="table compact items">
      <thead><tr><th>Hạng mục</th><th class="num">SL</th><th class="num">Báo giá</th><th>Nhà cung cấp</th><th class="num">Giá nhập</th><th class="num">Đã trả NCC</th><th>Hạn trả</th><th>Trạng thái</th><th>Vướng mắc</th></tr></thead>
      <tbody>${items.map((it) => {
        const late = it.supplier_status !== 'paid' && it.supplier_status !== 'none' && it.supplier_due && it.supplier_due < t;
        return html`<tr key=${it.id} class=${it.chosen ? '' : 'muted'}>
          <td><b>${it.name}</b>${it.is_extra && html` <span class="badge warn">Phát sinh</span>`}${it.not_used && html` <span class="badge">Không dùng</span>`}${it.is_option && html` <label class="inline-check small"><input type="checkbox" checked=${it.chosen} onChange=${(e) => choose(it, e.target.checked)} /> Option${it.chosen ? ' (đã chọn)' : ''}</label>`}<div class="muted small clamp">${it.detail || ''}</div></td>
          <td class="num">${it.qty ?? ''} ${it.unit || ''}</td>
          <td class="num">${money(it.amount)}</td>
          <td><select class="w-sup" value=${it.supplier_id || ''} onChange=${(e) => pickSupplier(it, e.target.value)}>
              <option value="">- Chọn NCC -</option>
              ${groups.map(([g, list]) => html`<optgroup label=${g}>${list.map((x) => html`<option value=${x.id}>${x.name}${linesOf(x.id).length ? '' : ' (chưa có giá)'}</option>`)}</optgroup>`)}
              <option value="__other">＋ Khác (nhập tên mới)…</option>
            </select>
            ${other === it.id && html`<input class="w-sup" autofocus placeholder="Tên NCC mới, Enter để lưu" onKeyDown=${(e) => { if (e.key === 'Enter') addOther(it, e.target.value); if (e.key === 'Escape') setOther(null); }} onBlur=${(e) => addOther(it, e.target.value)} />`}</td>
          <td class="num"><div class="cost-cell"><input class="w-num" type="number" value=${it.cost_amount ?? ''} onChange=${(e) => save('ev_items', it.id, { cost_amount: n(e.target.value) })} />
            ${it.supplier_id && linesOf(it.supplier_id).length > 0 && html`<button class="link" title="Chọn giá từ bảng giá NCC" onClick=${() => setPicker({ itId: it.id, sid: it.supplier_id })}>💲</button>`}</div></td>
          <td class="num"><input class="w-num" type="number" value=${it.supplier_paid ?? 0} onChange=${(e) => {
            const v = n(e.target.value) || 0;
            save('ev_items', it.id, { supplier_paid: v, supplier_status: v <= 0 ? 'unpaid' : it.cost_amount && v >= it.cost_amount ? 'paid' : 'partial' });
          }} /></td>
          <td><input class="w-date" type="date" value=${it.supplier_due || ''} onChange=${(e) => save('ev_items', it.id, { supplier_due: e.target.value || null })} /></td>
          <td><select class=${late ? 'bad-sel' : ''} value=${it.supplier_status} onChange=${(e) => save('ev_items', it.id, { supplier_status: e.target.value, ...(e.target.value === 'paid' && it.cost_amount ? { supplier_paid: it.cost_amount } : {}) })}>${Object.entries(SUP_STATUS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>${late && html`<div class="stale small">Quá hạn</div>`}</td>
          <td><input value=${it.supplier_issue || ''} placeholder="Khó khăn khi trả…" onChange=${(e) => save('ev_items', it.id, { supplier_issue: e.target.value || null })} /></td>
        </tr>`;
      })}</tbody>
    </table></div>
    <p class="muted small">Chọn nhà cung cấp là giá nhập tự điền theo bảng giá (đơn giá × số lượng); nhiều dòng giá gần giống thì chọn dòng đúng. Bấm 💲 để chọn lại, hoặc sửa thẳng ô Giá nhập.
      NCC mới: chọn "＋ Khác". Bảng giá, SĐT, số tài khoản sửa ở tab "Nhà cung cấp" trên trang Triển khai giải.</p>
    ${picker && html`<${PricePicker} it=${data.items.find((x) => x.id === picker.itId)} sup=${sups.find((x) => x.id === picker.sid)} lines=${linesOf(picker.sid)}
      onClose=${() => setPicker(null)} onApply=${async (l, q, price) => { const it = data.items.find((x) => x.id === picker.itId); setPicker(null);
        await save('ev_items', it.id, { supplier_id: picker.sid, cost_amount: Math.round(price * q), accept_unit_cost: price }, `Giá nhập ${money(price)} × ${q} = ${money(price * q)}`); }} />`}
  </div>`;
}

function Extras({ ctx, ev, data, reload }) {
  const sb = ctx.store.sb;
  const extras = data.items.filter((i) => i.event_id === ev.id && i.is_extra);
  const [f, setF] = useState({ name: '', detail: '', qty: 1, unit: '', unit_price: '', extra_by: '', extra_date: today() });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const amount = (Number(f.qty) || 0) * (Number(f.unit_price) || 0);
  async function add(e) {
    e.preventDefault();
    if (!f.name.trim()) return;
    try {
      const it = { id: uuid(), event_id: ev.id, name: f.name.trim(), detail: f.detail || null, qty: n(f.qty), unit: f.unit || null, unit_price: n(f.unit_price), amount,
        is_extra: true, chosen: true, extra_by: f.extra_by || null, extra_date: f.extra_date || null, sort: 9000 + extras.length };
      ok(await sb.from('ev_items').insert(it));
      const { data: existing } = await sb.from('ev_tasks').select('title').eq('event_id', ev.id);
      const tasks = ev.event_date ? tasksForItem(it, ev.event_date, today(), (existing || []).map((x) => x.title)) : [];
      if (tasks.length) ok(await sb.from('ev_tasks').insert(tasks.map((x, i) => ({ ...x, event_id: ev.id, item_id: it.id, pic_id: ev.pm_id, sort: 8000 + i }))));
      ctx.notify(`Đã thêm phát sinh${tasks.length ? ` + ${tasks.length} việc vào checklist` : ''}`);
      setF({ ...f, name: '', detail: '', unit_price: '' });
      reload();
    } catch (x) {
      ctx.notify(x.message, 'err');
    }
  }
  const last = data.payments.filter((p) => p.event_id === ev.id).sort((a, b) => b.sort - a.sort)[0];
  const sum = extras.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  return html`<div class="form">
    <p class="muted">Hạng mục khách yêu cầu thêm sau khi ký hợp đồng (VD thêm nhóm nhảy). Mỗi phát sinh tự thêm việc vào checklist và nằm trong danh sách nghiệm thu.</p>
    ${extras.length ? html`<div class="table-wrap"><table class="table compact">
      <thead><tr><th>Phát sinh</th><th class="num">SL</th><th class="num">Thành tiền</th><th>Yêu cầu bởi</th><th>Ngày</th></tr></thead>
      <tbody>${extras.map((x) => html`<tr><td><b>${x.name}</b><div class="muted small">${x.detail || ''}</div></td><td class="num">${x.qty ?? ''} ${x.unit || ''}</td><td class="num">${money(x.amount)}</td><td>${x.extra_by || ''}</td><td>${x.extra_date ? U.fmtDate(x.extra_date) : ''}</td></tr>`)}
        <tr><td><b>Tổng phát sinh</b></td><td></td><td class="num"><b>${money(sum)}</b></td><td colspan="2">
          ${last && sum > 0 && html`<button class="btn sm" onClick=${async () => { ok(await sb.from('ev_payments').update({ amount: (Number(last.amount) || 0) + sum, note: [last.note, `Đã cộng phát sinh ${money(sum)}`].filter(Boolean).join(' · ') }).eq('id', last.id)); ctx.notify('Đã cộng phát sinh vào ' + last.label); reload(); }}>Cộng vào ${last.label}</button>`}</td></tr>
      </tbody></table></div>` : html`<div class="empty">Chưa có phát sinh.</div>`}
    <form class="card-sec form" onSubmit=${add}>
      <h3>+ Thêm phát sinh</h3>
      <div class="grid2">
        <label>Hạng mục *<input value=${f.name} onInput=${set('name')} placeholder="VD: Nhóm nhảy khai mạc" /></label>
        <label>Mô tả<input value=${f.detail} onInput=${set('detail')} /></label>
      </div>
      <div class="grid3">
        <label>Số lượng<input type="number" value=${f.qty} onInput=${set('qty')} /></label>
        <label>ĐVT<input value=${f.unit} onInput=${set('unit')} placeholder="tiết mục, người…" /></label>
        <label>Đơn giá<input type="number" value=${f.unit_price} onInput=${set('unit_price')} /></label>
        <label>Yêu cầu bởi<input value=${f.extra_by} onInput=${set('extra_by')} placeholder="VD: Anh Nguyên (SVTECH)" /></label>
        <label>Ngày yêu cầu<input type="date" value=${f.extra_date} onInput=${set('extra_date')} /></label>
        <label>Thành tiền<input readonly value=${money(amount)} /></label>
      </div>
      <div class="row end"><button class="btn primary">Thêm phát sinh</button></div>
    </form>
  </div>`;
}

function Acceptance({ ctx, ev, data, reload }) {
  const save = useSave(ctx, reload);
  const items = data.items.filter((i) => i.event_id === ev.id && i.chosen);
  const okN = items.filter((i) => i.accept_status === 'ok').length;
  const issue = items.filter((i) => i.accept_status === 'issue').length;
  return html`<div class="form">
    <div class="row between">
      <p><b>${okN}/${items.length}</b> hạng mục đạt${issue ? html` · <span class="stale">${issue} có vấn đề</span>` : ''}</p>
      <label class="inline-check">Ngày ký biên bản nghiệm thu <input type="date" value=${ev.accepted_at || ''} onChange=${(e) => save('ev_events', ev.id, { accepted_at: e.target.value || null }, 'Đã lưu')} /></label>
    </div>
    <div class="table-wrap"><table class="table compact">
      <thead><tr><th>Hạng mục</th><th class="num">SL báo giá</th><th class="num">SL thực tế</th><th>Kết quả</th><th>Ghi chú</th></tr></thead>
      <tbody>${items.map((it) => html`<tr key=${it.id}>
        <td><b>${it.name}</b>${it.is_extra && html` <span class="badge warn">Phát sinh</span>`}</td>
        <td class="num">${it.qty ?? ''} ${it.unit || ''}</td>
        <td class="num"><input class="w-num" type="number" value=${it.accept_qty ?? ''} placeholder=${it.qty ?? ''} onChange=${(e) => save('ev_items', it.id, { accept_qty: n(e.target.value) })} /></td>
        <td><select value=${it.accept_status} onChange=${(e) => save('ev_items', it.id, { accept_status: e.target.value })}>${Object.entries(ACC).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></td>
        <td><input value=${it.accept_note || ''} onChange=${(e) => save('ev_items', it.id, { accept_note: e.target.value || null })} placeholder="VD: thiếu 1 standee" /></td>
      </tr>`)}</tbody>
    </table></div>
    <div class="row">
      <button class="btn" onClick=${async () => { for (const it of items.filter((x) => x.accept_status === 'pending')) await ctx.store.sb.from('ev_items').update({ accept_status: 'ok' }).eq('id', it.id); ctx.notify('Đã đánh dấu đạt các mục còn lại'); reload(); }}>✓ Đánh dấu đạt tất cả mục còn lại</button>
      <span class="muted small">Đính kèm biên bản ký ở tab Hồ sơ.</span>
    </div>
  </div>`;
}

function Files({ ctx, ev }) {
  const sb = ctx.store.sb;
  const [files, setFiles] = useState(null);
  const [kind, setKind] = useState('contract');
  const [busy, setBusy] = useState(false);
  const KIND = { quote: 'Báo giá', contract: 'Hợp đồng', acceptance: 'Biên bản nghiệm thu', other: 'Khác' };
  async function load() {
    setFiles(ok(await sb.from('ev_files').select('*').eq('event_id', ev.id).order('uploaded_at', { ascending: false })));
  }
  useEffect(() => {
    load();
  }, []);
  async function upload(e) {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) return ctx.notify('File tối đa 20MB', 'err');
    setBusy(true);
    try {
      const path = `${ev.id}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, '_')}`;
      const up = await sb.storage.from('ev-files').upload(path, f);
      if (up.error) throw up.error;
      ok(await sb.from('ev_files').insert({ event_id: ev.id, kind, name: f.name, path, size: f.size }));
      ctx.notify('Đã tải lên');
      load();
    } catch (x) {
      ctx.notify(x.message, 'err');
    }
    setBusy(false);
    e.target.value = '';
  }
  async function open(f) {
    const { data, error } = await sb.storage.from('ev-files').createSignedUrl(f.path, 300, { download: f.name });
    if (error) return ctx.notify(error.message, 'err');
    window.open(data.signedUrl, '_blank', 'noopener');
  }
  async function remove(f) {
    await sb.storage.from('ev-files').remove([f.path]);
    await sb.from('ev_files').delete().eq('id', f.id);
    load();
  }
  return html`<div class="form">
    <div class="row"><select value=${kind} onChange=${(e) => setKind(e.target.value)}>${Object.entries(KIND).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
      <input type="file" disabled=${busy} onChange=${upload} /> ${busy && html`<span class="muted">Đang tải lên…</span>`}</div>
    ${files === null ? html`<p class="muted">Đang tải…</p>` : !files.length ? html`<div class="empty">Chưa có file.</div>` : html`<div class="minilist">${files.map((f) => html`<div class="mini">
      <div class="mini-main" onClick=${() => open(f)}><b>${f.name}</b><div class="muted small">${KIND[f.kind]} · ${U.fmtDateTime(f.uploaded_at)} · ${Math.round((f.size || 0) / 1024)} KB</div></div>
      <button class="btn sm" onClick=${() => open(f)}>Tải về</button>
      <button class="link danger" onClick=${() => remove(f)}>Xoá</button>
    </div>`)}</div>`}
  </div>`;
}

const REGIONS = ['Miền Bắc', 'Miền Nam', 'Cả nước'];
// NCC chia nhóm theo miền cho ô chọn
function supplierGroups(sups) {
  const by = {};
  for (const x of sups) (by[x.region || 'Khác'] ||= []).push(x);
  return [...REGIONS, 'Khác'].filter((g) => by[g]).map((g) => [g, by[g].sort((a, b) => a.name.localeCompare(b.name, 'vi'))]);
}
const priceText = (l) => (l.price == null ? 'chưa có giá' : money(l.price) + (l.price_max ? ' - ' + money(l.price_max) : ''));

// Chọn dòng giá của NCC cho 1 hạng mục: dòng khớp nhất lên đầu, sửa được số lượng và đơn giá
function PricePicker({ it, sup, lines, onApply, onClose }) {
  const ranked = rankLines(it, lines);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(ranked.find((x) => x.l.price != null)?.l || ranked[0]?.l);
  const [qty, setQty] = useState(itemQty(it));
  const [price, setPrice] = useState(sel?.price ?? '');
  const f = fold(q);
  const shown = ranked.filter(({ l }) => !f || fold(`${l.item} ${l.detail || ''} ${l.grp || ''} ${l.category || ''}`).includes(f));
  const pick = (l) => {
    setSel(l);
    setPrice(l.price ?? '');
  };
  return html`<${Modal} title=${`Bảng giá ${sup?.name || ''} · ${it.name}`} onClose=${onClose} wide>
    <div class="form">
      <p class="muted small">${it.detail || ''}${it.qty ? ` · báo giá khách: ${it.qty} ${it.unit || ''}` : ''}. Dòng khớp nhất xếp đầu.</p>
      <input type="search" placeholder="Tìm trong bảng giá…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="table-wrap" style="max-height:45vh;overflow:auto"><table class="table compact">
        <thead><tr><th></th><th>Hạng mục NCC</th><th>ĐVT</th><th class="num">Đơn giá</th></tr></thead>
        <tbody>${shown.map(({ l }) => html`<tr key=${l.id} class=${'click' + (sel?.id === l.id ? ' on-row' : '')} onClick=${() => pick(l)}>
          <td><input type="radio" checked=${sel?.id === l.id} /></td>
          <td><b>${l.item}</b>${l.grp ? html` <span class="muted small">· ${l.grp}</span>` : ''}<div class="muted small">${[l.category, l.detail, l.note].filter(Boolean).join(' · ')}</div></td>
          <td class="small">${l.unit || ''}</td><td class="num">${priceText(l)}</td></tr>`)}</tbody>
      </table></div>
      <div class="grid3">
        <label>Số lượng<input type="number" step="any" value=${qty} onInput=${(e) => setQty(e.target.value)} /></label>
        <label>Đơn giá nhập (sửa được)<input type="number" value=${price} onInput=${(e) => setPrice(e.target.value)} /></label>
        <div><span class="muted small">Giá nhập</span><div><b>${money((Number(qty) || 0) * (Number(price) || 0))}</b></div></div>
      </div>
      ${sel?.price_max ? html`<p class="note">NCC báo khoảng giá ${priceText(sel)}: đang lấy giá thấp, sửa nếu đã chốt giá khác.</p>` : ''}
      <div class="row end"><button class="btn" onClick=${onClose}>Huỷ</button>
        <button class="btn primary" disabled=${!sel || price === '' || price == null} onClick=${() => onApply(sel, Number(qty) || 1, Number(price) || 0)}>Áp dụng</button></div>
    </div>
  <//>`;
}

function Suppliers({ ctx, data, reload }) {
  const sb = ctx.store.sb;
  const canEdit = ctx.canEditMoney;
  const [f, setF] = useState(null);
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState('');
  async function save(e) {
    e.preventDefault();
    if (!f.name?.trim()) return;
    try {
      const row = { name: f.name.trim(), region: f.region || null, category: f.category || null, contact: f.contact || null, phone: f.phone || null, bank: f.bank || null, note: f.note || null };
      if (f.id) ok(await sb.from('ev_suppliers').update(row).eq('id', f.id));
      else ok(await sb.from('ev_suppliers').insert(row));
      setF(null);
      reload();
    } catch (x) {
      ctx.notify(x.message, 'err');
    }
  }
  const owe = (s) => data.items.filter((i) => i.supplier_id === s.id && i.supplier_status !== 'paid').reduce((a, i) => a + Math.max(0, (Number(i.cost_amount) || 0) - (Number(i.supplier_paid) || 0)), 0);
  const nPrice = (s) => (data.prices || []).filter((p) => p.supplier_id === s.id).length;
  const fq = fold(q);
  const list = data.suppliers.filter((s) => !fq || fold(`${s.name} ${s.category || ''} ${s.region || ''}`).includes(fq));
  return html`<div>
    <div class="row between"><p class="muted">Danh bạ và bảng giá nhà cung cấp dùng lại cho mọi giải. Chọn NCC ở tab "Hạng mục & NCC" của giải là tự điền giá nhập.</p>
      <div class="row"><input type="search" placeholder="Tìm NCC…" value=${q} onInput=${(e) => setQ(e.target.value)} />
        ${canEdit && html`<button class="btn" onClick=${() => setImporting(true)}>⬆ Nhập bảng giá Excel</button><button class="btn primary" onClick=${() => setF({})}>+ Nhà cung cấp</button>`}</div></div>
    <div class="table-wrap"><table class="table leads">
      <thead><tr><th>Tên</th><th>Miền</th><th>Mảng</th><th class="num">Bảng giá</th><th>Liên hệ</th><th>Tài khoản</th><th class="num">Còn nợ</th></tr></thead>
      <tbody>${list.map((s) => html`<tr class="click" key=${s.id} onClick=${() => setF(s)}><td><b>${s.name}</b><div class="muted small">${s.note || ''}</div></td><td class="small">${s.region || '-'}</td><td class="small">${s.category || ''}</td>
        <td class="num">${nPrice(s) ? nPrice(s) + ' dòng' : html`<span class="muted">-</span>`}</td><td class="small">${[s.contact, s.phone].filter(Boolean).join(' · ')}</td><td class="small">${s.bank || ''}</td><td class="num">${owe(s) ? money(owe(s)) : '-'}</td></tr>`)}</tbody>
    </table></div>
    ${f && html`<${Modal} title=${f.id ? 'Nhà cung cấp: ' + f.name : 'Thêm nhà cung cấp'} onClose=${() => setF(null)} wide>
      <form class="form" onSubmit=${save}>
        <div class="grid3">
          <label>Tên *<input value=${f.name || ''} disabled=${!canEdit} onInput=${(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Miền<select value=${f.region || ''} disabled=${!canEdit} onChange=${(e) => setF({ ...f, region: e.target.value })}><option value="">-</option>${REGIONS.map((r) => html`<option value=${r}>${r}</option>`)}</select></label>
          <label>Mảng<input value=${f.category || ''} disabled=${!canEdit} onInput=${(e) => setF({ ...f, category: e.target.value })} placeholder="In ấn, trọng tài, âm thanh…" /></label>
          <label>Người liên hệ<input value=${f.contact || ''} disabled=${!canEdit} onInput=${(e) => setF({ ...f, contact: e.target.value })} /></label>
          <label>SĐT<input value=${f.phone || ''} disabled=${!canEdit} onInput=${(e) => setF({ ...f, phone: e.target.value })} /></label>
          <label>Số tài khoản / ngân hàng<input value=${f.bank || ''} disabled=${!canEdit} onInput=${(e) => setF({ ...f, bank: e.target.value })} /></label>
        </div>
        <label>Ghi chú<input value=${f.note || ''} disabled=${!canEdit} onInput=${(e) => setF({ ...f, note: e.target.value })} /></label>
        ${canEdit && html`<div class="row end"><button type="button" class="btn" onClick=${() => setF(null)}>Đóng</button><button class="btn primary">Lưu thông tin</button></div>`}
      </form>
      ${f.id && html`<${PriceList} ctx=${ctx} sup=${f} lines=${(data.prices || []).filter((p) => p.supplier_id === f.id)} canEdit=${canEdit} reload=${reload} />`}
    </${Modal}>`}
    ${importing && html`<${ImportPrices} ctx=${ctx} data=${data} onClose=${() => setImporting(false)} onDone=${() => { setImporting(false); reload(); }} />`}
  </div>`;
}

// Bảng giá của 1 NCC: sửa trực tiếp, lưu khi rời ô
function PriceList({ ctx, sup, lines, canEdit, reload }) {
  const sb = ctx.store.sb;
  const upd = async (id, patch) => {
    try {
      ok(await sb.from('ev_supplier_prices').update(patch).eq('id', id));
      reload();
    } catch (x) {
      ctx.notify(x.message, 'err');
    }
  };
  const add = async () => {
    try {
      ok(await sb.from('ev_supplier_prices').insert({ supplier_id: sup.id, item: 'Hạng mục mới', category: sup.category || null, sort: lines.length }));
      reload();
    } catch (x) {
      ctx.notify(x.message, 'err');
    }
  };
  const num = (v) => (v === '' ? null : Number(String(v).replace(/[^\d]/g, '')) || null);
  return html`<div class="section-head"><h3>Bảng giá (${lines.length} dòng)</h3>${canEdit && html`<button class="link" onClick=${add}>＋ Thêm dòng</button>`}</div>
    ${lines.length === 0 ? html`<div class="empty">Chưa có bảng giá. Nhập từ file Excel hoặc thêm từng dòng.</div>` : html`<div class="table-wrap" style="max-height:50vh;overflow:auto"><table class="table compact">
      <thead><tr><th>Nhóm</th><th>Hạng mục</th><th>Chi tiết</th><th>ĐVT</th><th class="num">Đơn giá</th><th class="num">Giá cao (nếu khoảng)</th><th></th></tr></thead>
      <tbody>${lines.map((l) => html`<tr key=${l.id}>
        <td><input class="w-num" value=${l.grp || ''} disabled=${!canEdit} onChange=${(e) => upd(l.id, { grp: e.target.value || null })} /></td>
        <td><input value=${l.item} disabled=${!canEdit} onChange=${(e) => upd(l.id, { item: e.target.value || 'Hạng mục' })} /></td>
        <td><input value=${l.detail || ''} disabled=${!canEdit} onChange=${(e) => upd(l.id, { detail: e.target.value || null })} /></td>
        <td><input class="short" value=${l.unit || ''} disabled=${!canEdit} onChange=${(e) => upd(l.id, { unit: e.target.value || null })} /></td>
        <td class="num"><input class="w-num" type="number" value=${l.price ?? ''} disabled=${!canEdit} onChange=${(e) => upd(l.id, { price: num(e.target.value) })} /></td>
        <td class="num"><input class="w-num" type="number" value=${l.price_max ?? ''} disabled=${!canEdit} onChange=${(e) => upd(l.id, { price_max: num(e.target.value) })} /></td>
        <td>${canEdit && html`<button class="link danger" onClick=${async () => { if (confirm('Xoá dòng giá này?')) { ok(await sb.from('ev_supplier_prices').delete().eq('id', l.id)); reload(); } }}>Xoá</button>`}</td>
      </tr>`)}</tbody></table></div>`}`;
}

// Nhập file "Báo giá tổng hợp hạng mục cung cấp": mỗi sheet là bảng giá của 1 NCC
function ImportPrices({ ctx, data, onClose, onDone }) {
  const sb = ctx.store.sb;
  const [sheets, setSheets] = useState(null);
  const [region, setRegion] = useState('Miền Bắc');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  async function onFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const XLSX = await loadXlsx();
      const wb = XLSX.read(await file.arrayBuffer());
      const list = wb.SheetNames.map((n) => parsePriceSheet(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }), n)).filter((x) => x && x.lines.length);
      if (!list.length) return setErr('Không thấy bảng giá (cần dòng tiêu đề có STT / Nội dung / Đơn giá).');
      if (/nam/i.test(fold(file.name))) setRegion('Miền Nam');
      setSheets(list.map((x) => {
        const match = data.suppliers.find((s) => x.vendor && fold(s.name) === fold(x.vendor));
        return { ...x, include: true, name: x.vendor || '', supplier_id: match?.id || '', mode: 'replace' };
      }));
      setErr('');
    } catch (x) {
      setErr('Không đọc được file: ' + x.message);
    }
  }
  const upd = (i, patch) => setSheets(sheets.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  async function run() {
    const list = sheets.filter((x) => x.include);
    if (list.some((x) => !x.supplier_id && !x.name.trim())) return setErr('Đặt tên NCC cho từng sheet (hoặc chọn NCC có sẵn).');
    try {
      for (const x of list) {
        setBusy(`Đang nhập ${x.sheet}…`);
        let sid = x.supplier_id;
        if (!sid) sid = ok(await sb.from('ev_suppliers').insert({ name: x.name.trim(), region, category: x.category || null }).select().single()).id;
        if (x.mode === 'replace') ok(await sb.from('ev_supplier_prices').delete().eq('supplier_id', sid).eq('category', x.category));
        ok(await sb.from('ev_supplier_prices').insert(x.lines.map((l, i) => ({ ...l, supplier_id: sid, category: x.category || null, sort: i }))));
      }
      ctx.notify(`Đã nhập bảng giá ${list.length} sheet`);
      onDone();
    } catch (x) {
      setErr(x.message);
    }
    setBusy('');
  }
  return html`<${Modal} title="Nhập bảng giá nhà cung cấp" onClose=${onClose} wide>
    <div class="form">
      <p class="muted">Mỗi sheet là bảng giá của 1 NCC (dòng tiêu đề có STT, Nội dung / Hạng mục, ĐVT, Đơn giá). Tên NCC được đoán từ tiêu đề, sửa lại nếu sai. Chọn NCC có sẵn thì bảng giá cùng mảng sẽ được thay mới.</p>
      <div class="row"><input type="file" accept=".xlsx,.xls" onChange=${onFile} />
        <label class="inline-check">Miền <select value=${region} onChange=${(e) => setRegion(e.target.value)}>${REGIONS.map((r) => html`<option value=${r}>${r}</option>`)}</select></label></div>
      ${sheets && sheets.map((x, i) => html`<fieldset class="fs" key=${i}>
        <legend><label class="inline-check"><input type="checkbox" checked=${x.include} onChange=${(e) => upd(i, { include: e.target.checked })} /> Sheet "${x.sheet}" · ${x.lines.length} dòng giá</label></legend>
        ${x.include && html`<div class="grid3">
          <label>NCC có sẵn<select value=${x.supplier_id} onChange=${(e) => upd(i, { supplier_id: e.target.value })}><option value="">- Tạo NCC mới -</option>${data.suppliers.map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>
          ${!x.supplier_id && html`<label>Tên NCC mới *<input value=${x.name} onInput=${(e) => upd(i, { name: e.target.value })} placeholder="VD: SK Hà Minh Anh" /></label>`}
          <label>Mảng<input value=${x.category} onInput=${(e) => upd(i, { category: e.target.value })} /></label>
        </div>
        <p class="muted small">${x.title}</p>
        <div class="muted small">${x.lines.slice(0, 6).map((l) => `${l.item} (${l.unit || '-'}) ${priceText(l)}`).join(' · ')}${x.lines.length > 6 ? ' …' : ''}</div>`}
      </fieldset>`)}
      ${err && html`<div class="err">${err}</div>`}
      ${sheets && html`<div class="row end"><button class="btn" onClick=${onClose}>Huỷ</button><button class="btn primary" disabled=${!!busy} onClick=${run}>${busy || 'Nhập bảng giá'}</button></div>`}
    </div>
  <//>`;
}

// ---------------------------------------------------------------------------
// Lợi nhuận: nhập file nghiệm thu + tab Lợi nhuận (chỉ người có quyền tài chính)
// ---------------------------------------------------------------------------
const pct = (v) => (v == null || !Number.isFinite(v) ? '-' : (v * 100).toFixed(1).replace('.', ',') + '%');
const ACTION = { update: 'Khớp', create: 'Tạo phát sinh mới', unused: 'Không sử dụng' };

// Mô phỏng trạng thái hạng mục sau khi lưu (để xem trước lãi đúng như sẽ lưu)
function applyAcceptance(evItems, res, manual, leftUnused) {
  const out = evItems.map((it) => ({ ...it }));
  const byId = Object.fromEntries(out.map((it) => [it.id, it]));
  const fill = (it, a) => Object.assign(it, { section: it.section || a.group || null, cost_amount: a.cost ?? null, accept_unit_cost: a.unit_cost ?? null, accept_amount: a.amount ?? null, accept_qty: a.qty ?? null, accept_status: 'ok' });
  const neu = (a, extra) => ({ id: uuid(), section: a.group, name: a.name, detail: a.detail || null, qty: a.qty, unit: a.unit || null, unit_price: a.unit_price, amount: a.amount,
    accept_amount: a.amount, accept_qty: a.qty, cost_amount: a.cost ?? null, accept_unit_cost: a.unit_cost ?? null, is_extra: extra, chosen: true, accept_status: 'ok', note: a.note || null, _new: true });
  for (const m of res.matches) {
    if (m.action === 'update') fill(byId[m.item.id], m.acc);
    else if (m.action === 'unused') Object.assign(byId[m.item.id], { not_used: true, accept_note: 'Không sử dụng (theo nghiệm thu)' });
    else if (m.action === 'create') out.push(neu(m.acc, true));
  }
  res.unmatched.forEach((a, i) => {
    const c = manual[i] || 'skip';
    if (c === 'create') out.push(neu(a, a.groupKind === 'extra'));
    else if (c !== 'skip' && byId[c]) a.groupKind === 'unused' ? Object.assign(byId[c], { not_used: true }) : fill(byId[c], a);
  });
  for (const id of leftUnused) if (byId[id]) byId[id].not_used = true;
  return out;
}

function ImportAcceptance({ ctx, ev, data, onClose, onDone }) {
  const sb = ctx.store.sb;
  const evItems = data.items.filter((i) => i.event_id === ev.id);
  const [file, setFile] = useState(null);
  const [acc, setAcc] = useState(null);
  const [res, setRes] = useState(null);
  const [manual, setManual] = useState({});
  const [leftUnused, setLeftUnused] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  async function onFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    setErr('');
    try {
      const XLSX = await loadXlsx();
      const wb = XLSX.read(await f.arrayBuffer());
      const parsed = wb.SheetNames.map((name) => parseAcceptance(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }))).find((a) => a && a.items.length);
      if (!parsed) return setErr('Không đọc được file. Cần đúng mẫu nghiệm thu Fairplay (cột STT, Nội dung, Bao gồm, Số lượng, ĐVT, Đơn Giá, Thành tiền, Cost phải trả nhà cung cấp).');
      setFile(f);
      setAcc(parsed);
      setRes(matchAcceptance(parsed.items, evItems));
      setManual({});
      setLeftUnused([]);
    } catch (x) {
      setErr('Không đọc được file: ' + x.message);
    }
  }

  const rates = acc ? { ...ev, fee_rate: acc.fee_rate ?? ev.fee_rate, vat_rate: acc.vat_rate ?? ev.vat_rate } : ev;
  const after = res ? applyAcceptance(evItems, res, manual, leftUnused) : [];
  const pv = res ? eventProfit(rates, after) : null;
  const fileRev = acc?.totals?.revenue;
  const usedIds = new Set(res ? res.matches.filter((m) => m.item).map((m) => m.item.id) : []);
  const pickable = evItems.filter((it) => !usedIds.has(it.id));

  async function save() {
    setErr('');
    try {
      const before = Object.fromEntries(evItems.map((it) => [it.id, it]));
      const COLS = ['section', 'cost_amount', 'accept_unit_cost', 'accept_amount', 'accept_qty', 'accept_status', 'not_used', 'accept_note'];
      let i = 0;
      for (const it of after) {
        i++;
        setBusy(`Đang lưu ${i}/${after.length}…`);
        if (it._new) {
          const { _new, ...row } = it;
          ok(await sb.from('ev_items').insert({ ...row, event_id: ev.id, extra_date: row.is_extra ? today() : null, sort: (row.is_extra ? 9000 : 8500) + i }));
          continue;
        }
        const old = before[it.id];
        const patch = {};
        for (const k of COLS) if ((it[k] ?? null) !== (old[k] ?? null)) patch[k] = it[k] ?? null;
        if (Object.keys(patch).length) ok(await sb.from('ev_items').update(patch).eq('id', it.id));
      }
      setBusy('Đang lưu tỉ lệ phí, VAT…');
      ok(await sb.from('ev_events').update({ fee_rate: rates.fee_rate ?? null, vat_rate: rates.vat_rate ?? null, acceptance_imported_at: new Date().toISOString() }).eq('id', ev.id));
      setBusy('Đang lưu file gốc vào Hồ sơ…');
      const path = `${ev.id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
      const up = await sb.storage.from('ev-files').upload(path, file);
      if (!up.error) await sb.from('ev_files').insert({ event_id: ev.id, kind: 'acceptance', name: file.name, path, size: file.size });
      ctx.notify(up.error ? 'Đã lưu nghiệm thu (chưa lưu được file gốc: ' + up.error.message + ')' : 'Đã lưu nghiệm thu và file gốc');
      onDone();
    } catch (x) {
      setErr(x.message);
    }
    setBusy('');
  }

  const cnt = (a) => (res ? res.matches.filter((m) => m.action === a).length : 0);
  return html`<${Modal} title=${'Nhập file nghiệm thu - ' + ev.name} onClose=${onClose} wide>
    <div class="form">
      <p class="muted">Chọn file nghiệm thu Excel (mẫu Fairplay). CRM khớp từng dòng với hạng mục của giải, điền giá nhập (chi phí NCC), số lượng và thành tiền theo nghiệm thu. Chỉ lưu khi bấm xác nhận.</p>
      <input type="file" accept=".xlsx,.xls" onChange=${onFile} />
      ${err && html`<div class="err">${err}</div>`}
      ${res && html`
        <div class="kpis">
          <div class="kpi info"><b>${money(pv.revenue)}</b><span>Doanh thu chưa VAT${fileRev != null ? (Math.round(pv.revenue) === Math.round(fileRev) ? ' · khớp số tổng trong file' : ` · file ghi ${money(fileRev)}`) : ''}</span></div>
          <div class="kpi warn"><b>${money(pv.cost)}</b><span>Chi phí NCC</span></div>
          <div class=${'kpi ' + (pv.margin < 0.25 ? 'bad' : 'good')}><b>${money(pv.gross)}</b><span>Lãi gộp · biên ${pct(pv.margin)}</span></div>
        </div>
        ${fileRev != null && Math.round(pv.revenue) !== Math.round(fileRev) && html`<p class="note">Doanh thu tính ra khác số tổng trong file ${money(Math.abs(pv.revenue - fileRev))}. Kiểm tra các dòng "Không khớp được" và hạng mục báo giá không có trong nghiệm thu bên dưới.</p>`}
        <p><b>${cnt('update')}</b> dòng khớp · <b>${cnt('create')}</b> phát sinh tạo mới · <b>${cnt('unused')}</b> không sử dụng · <b>${res.unmatched.length}</b> không khớp được · phí quản lý ${pct(rates.fee_rate ?? DEFAULTS.fee_rate)}, VAT ${pct(rates.vat_rate ?? DEFAULTS.vat_rate)}</p>
        ${res.unmatched.length > 0 && html`<div class="card-sec"><h3>Không khớp được - chọn hạng mục tương ứng</h3>
          <div class="table-wrap"><table class="table compact"><thead><tr><th>Dòng nghiệm thu</th><th class="num">Thành tiền</th><th class="num">Chi phí NCC</th><th>Xử lý</th></tr></thead>
          <tbody>${res.unmatched.map((a, i) => html`<tr key=${i}><td><b>${a.name}</b> <span class="muted small">(${a.groupKind === 'unused' ? 'không sử dụng' : a.group})</span><div class="muted small clamp">${a.detail}</div></td>
            <td class="num">${money(a.amount)}</td><td class="num">${money(a.cost)}</td>
            <td><select value=${manual[i] || 'skip'} onChange=${(e) => setManual({ ...manual, [i]: e.target.value })}>
              <option value="skip">Bỏ qua</option>
              ${a.groupKind !== 'unused' && html`<option value="create">Tạo hạng mục mới${a.groupKind === 'extra' ? ' (phát sinh)' : ''}</option>`}
              ${pickable.map((it) => html`<option value=${it.id}>${a.groupKind === 'unused' ? 'Đánh dấu không dùng: ' : '= '}${it.name}${it.detail ? ' - ' + it.detail.slice(0, 30) : ''} (${money(it.amount)})</option>`)}
            </select></td></tr>`)}</tbody></table></div></div>`}
        ${res.leftover.length > 0 && html`<div class="card-sec"><h3>Có trong báo giá nhưng không có trong file nghiệm thu (${res.leftover.length})</h3>
          <p class="muted small">Những hạng mục này vẫn được tính doanh thu theo báo giá. Tick nếu thực tế không sử dụng.</p>
          ${res.leftover.map((it) => html`<label class="inline-check" key=${it.id}><input type="checkbox" checked=${leftUnused.includes(it.id)} onChange=${(e) => setLeftUnused(e.target.checked ? [...leftUnused, it.id] : leftUnused.filter((x) => x !== it.id))} /> ${it.name} (${money(it.amount)})</label>`)}</div>`}
        <details><summary>Xem ${res.matches.length} dòng đã khớp / tạo mới</summary>
          <div class="table-wrap"><table class="table compact"><thead><tr><th>Dòng nghiệm thu</th><th>Hạng mục trong CRM</th><th class="num">Thành tiền</th><th class="num">Chi phí NCC</th><th>Xử lý</th></tr></thead>
          <tbody>${res.matches.map((m, i) => html`<tr key=${i}><td>${m.acc.name}<div class="muted small clamp">${m.acc.detail}</div></td><td>${m.item ? m.item.name : '-'}</td>
            <td class="num">${money(m.acc.amount)}</td><td class="num">${money(m.acc.cost)}</td><td><span class=${'badge ' + (m.action === 'create' ? 'warn' : m.action === 'unused' ? '' : 'ok')}>${ACTION[m.action]}</span></td></tr>`)}</tbody></table></div>
        </details>
        <div class="row end"><button class="btn" onClick=${onClose}>Huỷ</button><button class="btn primary" disabled=${!!busy} onClick=${save}>${busy || 'Xác nhận lưu nghiệm thu'}</button></div>`}
    </div>
  </${Modal}>`;
}

function ProfitTab({ ctx, ev, data, reload, onImport }) {
  const save = useSave(ctx, reload);
  const isAdmin = ctx.canEditMoney; // Admin hoặc Kế toán
  const items = data.items.filter((i) => i.event_id === ev.id);
  const p = eventProfit(ev, items, data.payments.filter((x) => x.event_id === ev.id));
  const [showItems, setShowItems] = useState(false);
  const pctIn = (v, key) => {
    const n = Number(String(v).replace(',', '.'));
    if (v === '' || !Number.isFinite(n)) return save('ev_events', ev.id, { [key]: null });
    save('ev_events', ev.id, { [key]: n / 100 }, 'Đã lưu');
  };
  const act = items.filter((i) => i.chosen !== false);
  return html`<div class="form">
    ${!ev.acceptance_imported_at && html`<p class="note">Chưa nhập file nghiệm thu: số liệu đang tính theo báo giá và giá nhập đã điền tay.${isAdmin ? html` <button class="btn sm" onClick=${onImport}>⬆ Nhập file nghiệm thu</button>` : ''}</p>`}
    ${p.warn.map((w) => html`<div class="err">⚠ ${w}</div>`)}
    ${p.missingCost > 0 && html`<p class="note">${p.missingCost} hạng mục chưa có giá nhập (chi phí NCC). Hạng mục Fairplay tự làm hoặc được ưu đãi thì nhập 0.</p>`}
    <div class="kpis">
      <div class="kpi info"><b>${money(p.revenue)}</b><span>Doanh thu chưa VAT (gồm phí quản lý ${pct(p.feeRate)})</span></div>
      <div class="kpi"><b>${money(p.vat)}</b><span>VAT ${pct(p.vatRate)} (thu hộ, không tính vào doanh thu)</span></div>
      <div class="kpi"><b>${money(p.total)}</b><span>Tổng khách trả · đã thu ${money(p.paid)}</span></div>
      <div class="kpi warn"><b>${money(p.cost)}</b><span>Chi phí NCC</span></div>
      ${ev.pit_on && html`<div class="kpi warn"><b>${money(p.pit)}</b><span>Thuế TNCN công ty chịu thay CTV</span></div>`}
      <div class=${'kpi ' + (p.margin < 0.25 ? 'bad' : 'good')}><b>${money(p.gross)}</b><span>Lãi gộp · biên ${pct(p.margin)}</span></div>
      <div class="kpi"><b>${pct(p.markup)}</b><span>Markup (lãi / chi phí), chỉ để so sánh</span></div>
    </div>
    <div class="table-wrap"><table class="table compact">
      <thead><tr><th>Nhóm hạng mục</th><th class="num">Doanh thu</th><th class="num">Chi phí NCC</th><th class="num">Lãi</th><th class="num">Biên lãi</th></tr></thead>
      <tbody>${p.groups.map((g) => html`<tr key=${g.name}><td><b>${g.name}</b>${g.extra && html` <span class="badge warn">Phát sinh</span>`}</td><td class="num">${money(g.revenue)}</td><td class="num">${money(g.cost)}</td>
          <td class="num">${money(g.profit)}</td><td class="num"><span class=${'badge ' + (g.margin < 0.25 ? 'bad' : 'ok')}>${pct(g.margin)}</span></td></tr>`)}
        <tr><td><b>Tổng hạng mục</b></td><td class="num"><b>${money(p.itemsSum)}</b></td><td class="num"><b>${money(p.cost)}</b></td><td class="num"><b>${money(p.itemsSum - p.cost)}</b></td><td></td></tr>
        <tr><td>Phí quản lý ${pct(p.feeRate)}</td><td class="num">${money(p.fee)}</td><td></td><td class="num">${money(p.fee)}</td><td></td></tr>
      </tbody></table></div>
    ${isAdmin && html`<fieldset class="fs"><legend>Thiết lập của giải</legend>
      <div class="grid3">
        <label>Phí quản lý (%)<input type="number" step="0.1" value=${ev.fee_rate != null ? +(ev.fee_rate * 100).toFixed(2) : ''} placeholder=${+(p.feeRate * 100).toFixed(2)} onChange=${(e) => pctIn(e.target.value, 'fee_rate')} /></label>
        <label>VAT (%)<input type="number" step="0.1" value=${ev.vat_rate != null ? +(ev.vat_rate * 100).toFixed(2) : ''} placeholder=${+(p.vatRate * 100).toFixed(2)} onChange=${(e) => pctIn(e.target.value, 'vat_rate')} /></label>
        <label class="inline-check"><input type="checkbox" checked=${!!ev.pit_on} onChange=${(e) => save('ev_events', ev.id, { pit_on: e.target.checked }, 'Đã lưu')} /> Công ty chịu thuế TNCN thay CTV</label>
      </div>
      ${ev.pit_on && html`<div class="grid3">
        <label>Thuế suất TNCN (%)<input type="number" step="0.1" value=${ev.pit_rate != null ? +(ev.pit_rate * 100).toFixed(2) : ''} placeholder=${DEFAULTS.pit_rate * 100} onChange=${(e) => pctIn(e.target.value, 'pit_rate')} /></label>
        <label>Ngưỡng khấu trừ mỗi lần trả / người (đ)<input type="number" value=${ev.pit_threshold ?? ''} placeholder=${DEFAULTS.pit_threshold} onChange=${(e) => save('ev_events', ev.id, { pit_threshold: n(e.target.value) })} /></label>
      </div><p class="muted small">Thuế chỉ tính cho hạng mục có Loại NCC = "Cá nhân (CTV)" và đơn giá trả từ ngưỡng trở lên. Chọn Loại NCC ở bảng hạng mục bên dưới. Cần kế toán xác nhận.</p>`}
    </fieldset>`}
    <button class="link" onClick=${() => setShowItems(!showItems)}>${showItems ? 'Ẩn' : 'Xem'} lãi từng hạng mục (${act.length})</button>
    ${showItems && html`<div class="table-wrap"><table class="table compact">
      <thead><tr><th>Hạng mục</th><th class="num">Thành tiền</th><th class="num">Chi phí NCC</th><th class="num">Lãi</th><th>Loại NCC</th><th>Không dùng</th></tr></thead>
      <tbody>${act.map((it) => {
        const rev = Number(it.accept_amount ?? it.amount) || 0;
        const cost = it.cost_amount;
        return html`<tr key=${it.id} class=${it.not_used ? 'muted' : ''}><td><b>${it.name}</b>${it.is_extra && html` <span class="badge warn">Phát sinh</span>`}<div class="muted small clamp">${it.detail || ''}</div></td>
          <td class="num">${money(rev)}${it.accept_amount != null && Number(it.accept_amount) !== Number(it.amount) && html`<div class="muted small">báo giá ${money(it.amount)}</div>`}</td>
          <td class="num">${cost == null ? html`<span class="stale small">chưa có</span>` : money(cost)}</td>
          <td class="num">${cost == null ? '-' : money(rev - cost)}</td>
          <td>${isAdmin ? html`<select value=${it.payee_type || ''} onChange=${(e) => save('ev_items', it.id, { payee_type: e.target.value || null })}><option value="">-</option>${Object.entries(PAYEE).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>` : PAYEE[it.payee_type] || '-'}</td>
          <td>${isAdmin ? html`<input type="checkbox" checked=${!!it.not_used} onChange=${(e) => save('ev_items', it.id, { not_used: e.target.checked })} />` : it.not_used ? '✓' : ''}</td>
        </tr>`;
      })}</tbody></table></div>`}
    <p class="muted small">Doanh thu chưa VAT = tổng thành tiền hạng mục (theo nghiệm thu nếu có, kể cả phát sinh, trừ hạng mục không sử dụng) + phí quản lý. Lãi gộp = doanh thu chưa VAT - chi phí NCC${ev.pit_on ? ' - thuế TNCN công ty chịu thay CTV' : ''}. Chi phí 0 là hạng mục Fairplay tự làm hoặc được ưu đãi.</p>
  </div>`;
}
