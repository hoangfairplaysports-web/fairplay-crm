// Triển khai giải: giải đã chốt / ký HĐ → nhập báo giá → checklist (bên Fairplay Checklist),
// theo dõi hợp đồng, khách thanh toán, trả nhà cung cấp, phát sinh, nghiệm thu, hồ sơ.
// Dùng chung bảng ev_* với Fairplay Checklist. Phần tiền chỉ Admin thấy (RLS).
import { html, useState, useEffect, useMemo } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import { Modal } from './ui.js';
import * as U from './util.js';
import { parseQuote, generateChecklist, tasksForItem, defaultPayments, eventHealth, money, addDays, PHASES, fold } from './ev-core.js';

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
  const sb = store.sb;
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('active');
  const [openId, setOpenId] = useState(null);
  const [importing, setImporting] = useState(false);

  async function load() {
    try {
      const [events, tasks, items, payments, suppliers, members] = await Promise.all([
        sb.from(isAdmin ? 'ev_events' : 'ev_events_public').select('*').order('event_date').then(ok),
        sb.from('ev_tasks').select('id, event_id, status, due_date, phase').then(ok),
        isAdmin ? sb.from('ev_items').select('*').order('sort').then(ok) : [],
        isAdmin ? sb.from('ev_payments').select('*').order('sort').then(ok) : [],
        isAdmin ? sb.from('ev_suppliers').select('*').order('name').then(ok) : [],
        sb.from('cl_members').select('id, full_name, role, active').then(ok).catch(() => []),
      ]);
      setData({ events, tasks, items, payments, suppliers, members });
    } catch (e) {
      notify(e.message, 'err');
      setData({ events: [], tasks: [], items: [], payments: [], suppliers: [], members: [] });
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
        <div class="seg">${[['active', 'Đang triển khai'], ['done', 'Đã xong'], ...(isAdmin ? [['suppliers', 'Nhà cung cấp']] : [])].map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${l}</button>`)}</div>
        ${isAdmin && html`<button class="btn primary" onClick=${() => setImporting(true)}>⬆ Nhập báo giá</button>`}
      </div>
    </div>
    ${isAdmin && tab !== 'suppliers' && html`<div class="kpis">
      <div class="kpi info"><b>${data.events.filter((e) => !['done', 'cancelled'].includes(e.status)).length}</b><span>Giải đang triển khai</span></div>
      <div class=${'kpi ' + (warnN ? 'bad' : 'good')}><b>${warnN}</b><span>Giải cần chú ý</span></div>
      <div class="kpi"><b>${money(totals.reduce((a, h) => a + h.dueIn - h.paidIn, 0))}</b><span>Khách còn phải trả</span></div>
      <div class="kpi warn"><b>${money(totals.reduce((a, h) => a + Math.max(0, h.cost - h.paidOut), 0))}</b><span>Còn phải trả NCC</span></div>
    </div>`}
    ${tab === 'suppliers' ? html`<${Suppliers} ctx=${ctx} data=${data} reload=${load} />` : html`
      ${!evs.length && html`<div class="empty">${tab === 'active' ? 'Chưa có giải nào. Bấm "⬆ Nhập báo giá" khi giải đã chốt / ký hợp đồng.' : 'Chưa có giải đã xong.'}</div>`}
      ${evs.length > 0 && html`<div class="table-wrap"><table class="table leads">
        <thead><tr><th>Giải</th><th>Ngày</th><th>Hợp đồng</th><th>Checklist</th>${isAdmin && html`<th class="num">Khách đã trả</th><th class="num">Đã trả NCC</th>`}<th>Cần chú ý</th></tr></thead>
        <tbody>${evs.map((e) => {
          const h = eventHealth(e, data, t);
          const d = e.event_date ? U.daysBetween(t, e.event_date) : null;
          return html`<tr onClick=${() => setOpenId(e.id)}>
            <td data-l="Giải"><b>${e.name}</b><div class="muted small">${[e.client_name, e.venue].filter(Boolean).join(' · ')}</div></td>
            <td data-l="Ngày" class="nowrap">${e.event_date ? U.fmtDate(e.event_date) : '—'}${d != null && d >= 0 && html`<div class=${'small ' + (d <= 7 ? 'stale' : 'muted')}>còn ${d} ngày</div>`}</td>
            <td data-l="Hợp đồng">${e.contract_signed_at ? html`<span class="badge ok">Đã ký ${U.fmtDate(e.contract_signed_at)}</span>`
              : e.contract_deadline && e.contract_deadline < t ? html`<span class="badge bad">Quá hạn ký</span>` : html`<span class="badge warn">Chưa ký${e.contract_deadline ? ' · hạn ' + U.fmtDate(e.contract_deadline) : ''}</span>`}</td>
            <td data-l="Checklist">${h.done}/${h.tasks} (${h.pct}%)${h.overdue ? html` <span class="badge bad">${h.overdue} quá hạn</span>` : ''}</td>
            ${isAdmin && html`<td data-l="Khách đã trả" class="num">${money(h.paidIn)}<div class="muted small">/ ${money(h.dueIn)}</div></td>
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
  const [tab, setTab] = useState('overview');
  const h = eventHealth(ev, data, today());
  const TABS = [['overview', 'Tổng quan'], ...(isAdmin ? [['pay', 'Thu tiền khách'], ['items', 'Hạng mục & NCC'], ['extra', 'Phát sinh'], ['accept', 'Nghiệm thu'], ['files', 'Hồ sơ']] : [])];
  return html`<div class="drawer-overlay" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
    <aside class="drawer wide-drawer">
      <div class="drawer-head"><div><h2>${ev.name}</h2><div class="muted">${[ev.client_name, ev.venue, ev.event_date && U.fmtDate(ev.event_date)].filter(Boolean).join(' · ')}</div>
        <div class="row" style="margin-top:6px">${h.warn.map((w) => html`<span class="badge bad">${w}</span>`)}</div></div>
        <button class="x" onClick=${onClose}>×</button></div>
      <div class="seg" style="margin:0 18px">${TABS.map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${l}</button>`)}</div>
      <div class="drawer-body">
        ${tab === 'overview' && html`<${Overview} ctx=${ctx} ev=${ev} data=${data} h=${h} reload=${reload} />`}
        ${tab === 'pay' && html`<${Payments} ctx=${ctx} ev=${ev} data=${data} h=${h} reload=${reload} />`}
        ${tab === 'items' && html`<${Items} ctx=${ctx} ev=${ev} data=${data} reload=${reload} />`}
        ${tab === 'extra' && html`<${Extras} ctx=${ctx} ev=${ev} data=${data} reload=${reload} />`}
        ${tab === 'accept' && html`<${Acceptance} ctx=${ctx} ev=${ev} data=${data} reload=${reload} />`}
        ${tab === 'files' && html`<${Files} ctx=${ctx} ev=${ev} />`}
      </div>
    </aside>
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
  const [f, setF] = useState(ev);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pm = data.members.find((m) => m.id === ev.pm_id);
  const staff = data.members.filter((m) => m.active !== false && m.role !== 'bod');
  return html`<div class="form">
    <div class="kpis">
      <div class="kpi info"><b>${h.pct}%</b><span>Checklist (${h.done}/${h.tasks})${h.overdue ? ` · ${h.overdue} quá hạn` : ''}</span></div>
      ${isAdmin && html`<div class="kpi"><b>${money(ev.quote_total)}</b><span>Giá trị báo giá${h.extras ? ` + phát sinh ${money(h.extras)}` : ''}</span></div>
        <div class="kpi good"><b>${money(h.paidIn)}</b><span>Khách đã trả / ${money(h.dueIn)}</span></div>
        <div class="kpi warn"><b>${money(h.paidOut)}</b><span>Đã trả NCC / ${money(h.cost)}</span></div>
        ${h.cost > 0 && html`<div class="kpi"><b>${money((ev.quote_subtotal || h.contract) + h.extras - h.cost)}</b><span>Lãi gộp ước tính (chưa VAT)</span></div>`}`}
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
  const items = data.items.filter((i) => i.event_id === ev.id && !i.is_extra && (showOpt || i.chosen));
  const sups = data.suppliers;
  const t = today();
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
          <td><b>${it.name}</b>${it.is_option && html` <label class="inline-check small"><input type="checkbox" checked=${it.chosen} onChange=${(e) => choose(it, e.target.checked)} /> Option${it.chosen ? ' (đã chọn)' : ''}</label>`}<div class="muted small clamp">${it.detail || ''}</div></td>
          <td class="num">${it.qty ?? ''} ${it.unit || ''}</td>
          <td class="num">${money(it.amount)}</td>
          <td><select value=${it.supplier_id || ''} onChange=${(e) => save('ev_items', it.id, { supplier_id: e.target.value || null })}><option value="">—</option>${sups.map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></td>
          <td class="num"><input class="w-num" type="number" value=${it.cost_amount ?? ''} onChange=${(e) => save('ev_items', it.id, { cost_amount: n(e.target.value) })} /></td>
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
    <p class="muted small">Chưa có nhà cung cấp trong danh sách? Thêm ở tab "Nhà cung cấp" trên trang Triển khai giải.</p>
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

function Suppliers({ ctx, data, reload }) {
  const sb = ctx.store.sb;
  const [f, setF] = useState(null);
  async function save(e) {
    e.preventDefault();
    if (!f.name?.trim()) return;
    try {
      const row = { name: f.name.trim(), category: f.category || null, contact: f.contact || null, phone: f.phone || null, bank: f.bank || null, note: f.note || null };
      if (f.id) ok(await sb.from('ev_suppliers').update(row).eq('id', f.id));
      else ok(await sb.from('ev_suppliers').insert(row));
      setF(null);
      reload();
    } catch (x) {
      ctx.notify(x.message, 'err');
    }
  }
  const owe = (s) => data.items.filter((i) => i.supplier_id === s.id && i.supplier_status !== 'paid').reduce((a, i) => a + Math.max(0, (Number(i.cost_amount) || 0) - (Number(i.supplier_paid) || 0)), 0);
  return html`<div>
    <div class="row between"><p class="muted">Danh bạ nhà cung cấp dùng lại cho mọi giải.</p><button class="btn primary" onClick=${() => setF({})}>+ Nhà cung cấp</button></div>
    <div class="table-wrap"><table class="table leads">
      <thead><tr><th>Tên</th><th>Mảng</th><th>Liên hệ</th><th>Tài khoản</th><th class="num">Còn nợ</th></tr></thead>
      <tbody>${data.suppliers.map((s) => html`<tr onClick=${() => setF(s)}><td><b>${s.name}</b><div class="muted small">${s.note || ''}</div></td><td>${s.category || ''}</td><td>${[s.contact, s.phone].filter(Boolean).join(' · ')}</td><td class="small">${s.bank || ''}</td><td class="num">${money(owe(s))}</td></tr>`)}</tbody>
    </table></div>
    ${f && html`<${Modal} title=${f.id ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'} onClose=${() => setF(null)}>
      <form class="form" onSubmit=${save}>
        <label>Tên *<input value=${f.name || ''} onInput=${(e) => setF({ ...f, name: e.target.value })} /></label>
        <div class="grid2"><label>Mảng<input value=${f.category || ''} onInput=${(e) => setF({ ...f, category: e.target.value })} placeholder="In ấn, trọng tài, âm thanh…" /></label>
          <label>Người liên hệ<input value=${f.contact || ''} onInput=${(e) => setF({ ...f, contact: e.target.value })} /></label>
          <label>SĐT<input value=${f.phone || ''} onInput=${(e) => setF({ ...f, phone: e.target.value })} /></label>
          <label>Số tài khoản / ngân hàng<input value=${f.bank || ''} onInput=${(e) => setF({ ...f, bank: e.target.value })} /></label></div>
        <label>Ghi chú<input value=${f.note || ''} onInput=${(e) => setF({ ...f, note: e.target.value })} /></label>
        <div class="row end"><button type="button" class="btn" onClick=${() => setF(null)}>Huỷ</button><button class="btn primary">Lưu</button></div>
      </form>
    </${Modal}>`}
  </div>`;
}
