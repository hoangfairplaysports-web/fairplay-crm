import { html, useState, useMemo } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import * as U from './util.js';
import { Modal, Select, salesPeople } from './ui.js';

export function EventStatusPill({ status }) {
  return html`<span class="pill" style=${`--c:${U.EVENT_STATUS_COLOR[status] || '#64748b'}`}>${U.EVENT_STATUS[status] || status}</span>`;
}

// Nhãn hạn: "Còn 5 ngày" / "Quá 3 ngày" cho giải chưa xong
function DateBadge({ e }) {
  if (!e.event_date || !U.ACTIVE_EVENT.has(e.status)) return null;
  const d = U.daysBetween(U.todayStr(), e.event_date);
  if (d < 0) return html`<span class="badge bad">Quá ${-d} ngày</span>`;
  if (d <= 14) return html`<span class="badge warn">${d === 0 ? 'Hôm nay' : 'Còn ' + d + ' ngày'}</span>`;
  return null;
}

const statusOpts = Object.entries(U.EVENT_STATUS).map(([value, label]) => ({ value, label }));
const phaseOpts = Object.entries(U.EVENT_PHASE).map(([value, label]) => ({ value, label }));

// Lưu giải + ghi lịch sử vào khách hàng khi đổi trạng thái
export async function saveEvent(ctx, row, patch) {
  if (patch.status === 'completed' && !('phase' in patch)) patch = { ...patch, phase: 'done' };
  const saved = await ctx.saveRow('events', row?.id, patch);
  if (!row) await ctx.store.addActivity({ customer_id: saved.customer_id, type: 'note', content: `🏆 Tạo giải "${saved.name}" – ${U.EVENT_STATUS[saved.status]}` });
  else if (patch.status && patch.status !== row.status)
    await ctx.store.addActivity({ customer_id: saved.customer_id, type: 'stage', content: `🏆 ${saved.name}: ${U.EVENT_STATUS[row.status]} → ${U.EVENT_STATUS[patch.status]}` });
  return saved;
}

// ---------------------------------------------------------------------------
// Danh sách giải đấu (thay sheet "DS Giải đấu")
// ---------------------------------------------------------------------------
export function TournamentsView({ ctx }) {
  const { events, customers, profiles, people, settings, user, openCustomer, openEvent, notify } = ctx;
  const [tab, setTab] = useState('active');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState('');
  const [pic, setPic] = useState('');
  const [sport, setSport] = useState('');
  const cus = Object.fromEntries(customers.map((c) => [c.id, c]));

  const rows = useMemo(() => {
    const fq = U.fold(q);
    return events
      .filter((e) => {
        if (tab === 'active' && !U.ACTIVE_EVENT.has(e.status)) return false;
        if (tab === 'completed' && e.status !== 'completed') return false;
        if (status && e.status !== status) return false;
        if (phase && e.phase !== phase) return false;
        if (pic === '_none' ? e.pic_id : pic && e.pic_id !== pic) return false;
        if (sport && e.sport !== sport) return false;
        if (fq && !U.fold([e.name, cus[e.customer_id]?.name, e.notes, e.next_action, e.venue].join(' ')).includes(fq)) return false;
        return true;
      })
      .sort((a, b) =>
        tab === 'completed'
          ? (b.event_date || '').localeCompare(a.event_date || '')
          : (a.event_date || '9999').localeCompare(b.event_date || '9999') || (b.updated_at || '').localeCompare(a.updated_at || '')
      );
  }, [events, customers, tab, q, status, phase, pic, sport]);

  const counts = Object.keys(U.EVENT_STATUS).map((k) => ({ k, n: events.filter((e) => e.status === k).length }));

  async function quick(e, patch, msg) {
    try {
      await saveEvent(ctx, e, patch);
      notify(msg);
    } catch (err) {
      notify(err.message, 'err');
    }
  }

  function exportCsv() {
    U.csvDownload(`fairplay-giai-dau-${U.todayStr()}.csv`, [
      ['Giải đấu', 'Khách hàng', 'Trạng thái', 'Giai đoạn', 'PIC', 'Ngày', 'Môn', 'Quy mô', 'Địa điểm', 'Tình hình', 'Phương án / Việc tiếp theo', 'Link'],
      ...rows.map((e) => [e.name, cus[e.customer_id]?.name, U.EVENT_STATUS[e.status], U.EVENT_PHASE[e.phase] || '', people[e.pic_id]?.full_name,
        U.eventWhen(e), e.sport, e.headcount, e.venue, e.notes, e.next_action, e.link]),
    ]);
  }

  return html`<div class="page wide">
    <div class="page-head">
      <h1>Giải đấu <span class="count">${rows.length}</span></h1>
      <div class="row">
        <div class="seg">
          <button class=${tab === 'active' ? 'on' : ''} onClick=${() => setTab('active')}>Đang chạy</button>
          <button class=${tab === 'completed' ? 'on' : ''} onClick=${() => setTab('completed')}>Đã hoàn thành</button>
          <button class=${tab === 'all' ? 'on' : ''} onClick=${() => setTab('all')}>Tất cả</button>
        </div>
        <button class="btn" onClick=${exportCsv}>⬇ Xuất CSV</button>
        <button class="btn primary" onClick=${() => openEvent({})}>＋ Giải đấu</button>
      </div>
    </div>
    <div class="status-chips">
      ${counts.map((c) => html`<button class=${'schip' + (status === c.k ? ' on' : '')} style=${`--c:${U.EVENT_STATUS_COLOR[c.k]}`}
        onClick=${() => { setStatus(status === c.k ? '' : c.k); setTab('all'); }}>${U.EVENT_STATUS[c.k]} <b>${c.n}</b></button>`)}
    </div>
    <div class="filters">
      <input class="search" placeholder="Tìm tên giải, khách hàng, ghi chú, phương án…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <${Select} value=${status} onChange=${setStatus} placeholder="Mọi trạng thái" options=${statusOpts} />
      <${Select} value=${phase} onChange=${setPhase} placeholder="Mọi giai đoạn" options=${phaseOpts} />
      <${Select} value=${pic} onChange=${setPic} placeholder="Mọi PIC" options=${[{ value: user.id, label: 'Của tôi' }, { value: '_none', label: 'Chưa có PIC' }, ...salesPeople(profiles).filter((p) => p.id !== user.id).map((p) => ({ value: p.id, label: p.full_name }))]} />
      <${Select} value=${sport} onChange=${setSport} placeholder="Mọi môn" options=${settings.needs} />
    </div>
    <div class="table-wrap"><table class="table leads tourn">
      <thead><tr><th>Giải đấu</th><th>Trạng thái</th><th>Giai đoạn</th><th>PIC</th><th>Ngày</th><th>Môn</th><th>Tình hình</th><th>Phương án / Việc tiếp theo</th><th></th></tr></thead>
      <tbody>${rows.map((e) => html`<tr key=${e.id} onClick=${() => openEvent(e)}>
        <td data-l="Giải đấu"><b>${e.name}</b>
          ${cus[e.customer_id] && cus[e.customer_id].name !== e.name && html`<div><button class="link small" onClick=${(ev) => { ev.stopPropagation(); openCustomer(e.customer_id); }}>${cus[e.customer_id].name}</button></div>`}</td>
        <td data-l="Trạng thái" onClick=${(ev) => ev.stopPropagation()}>
          <select class="pill-select" style=${`--c:${U.EVENT_STATUS_COLOR[e.status]}`} value=${e.status} onChange=${(ev) => quick(e, { status: ev.target.value }, 'Đã cập nhật trạng thái')}>
            ${statusOpts.map((o) => html`<option value=${o.value}>${o.label}</option>`)}</select></td>
        <td data-l="Giai đoạn" onClick=${(ev) => ev.stopPropagation()}>
          <${Select} value=${e.phase || ''} placeholder="—" options=${phaseOpts} onChange=${(v) => quick(e, { phase: v || null }, 'Đã cập nhật giai đoạn')} /></td>
        <td data-l="PIC" onClick=${(ev) => ev.stopPropagation()}>
          <${Select} value=${e.pic_id || ''} placeholder="—" options=${salesPeople(profiles).map((p) => ({ value: p.id, label: p.full_name }))} onChange=${(v) => quick(e, { pic_id: v || null }, 'Đã cập nhật PIC')} /></td>
        <td data-l="Ngày" class="nowrap">${U.eventWhen(e) || html`<span class="muted">—</span>`} <${DateBadge} e=${e} /></td>
        <td data-l="Môn">${e.sport || ''}</td>
        <td data-l="Tình hình"><div class="clamp">${e.notes || ''}</div></td>
        <td data-l="Phương án"><div class="clamp strong">${e.next_action || ''}</div></td>
        <td>${e.link && html`<a href=${e.link} target="_blank" rel="noopener" title="Mở checklist / tài liệu" onClick=${(ev) => ev.stopPropagation()}>🔗</a>`}</td>
      </tr>`)}</tbody>
    </table></div>
    ${rows.length === 0 && html`<div class="empty">Không có giải phù hợp.</div>`}
  </div>`;
}

// ---------------------------------------------------------------------------
// Form thêm / sửa giải đấu
// ---------------------------------------------------------------------------
function guessCustomer(ctx, lead) {
  if (!lead) return '';
  return lead.customer_id || ctx.customers.find((c) => lead.company && U.fold(c.name) === U.fold(lead.company))?.id || '';
}

export function TournamentModal({ ctx, row, init = {}, onClose }) {
  const { settings, profiles, customers, isMgr, removeRow, notify, user, updateLead, leads } = ctx;
  const lead = init.lead || (row?.lead_id && leads.find((l) => l.id === row.lead_id)) || null;
  const fixedCustomer = row?.customer_id || init.customer_id || '';
  const guessed = fixedCustomer || guessCustomer(ctx, lead);
  const [d, setD] = useState(() => ({
    name: lead ? `Giải ${lead.need || ''} ${lead.company || lead.name}`.replace(/\s+/g, ' ').trim() : '',
    status: lead ? (lead.stage === 'won' ? 'in_progress' : 'negotiating') : 'negotiating',
    phase: 'before', pic_id: lead?.assignee_id || user.id, event_date: '', date_text: lead?.event_time || '',
    sport: lead?.need || '', headcount: lead?.headcount || '', venue: '', notes: '', next_action: '', link: '',
    ...(row || {}),
    customer_id: guessed, newCustomer: guessed ? '' : lead ? lead.company || lead.name : '', cmode: guessed || !lead ? 'existing' : 'new',
  }));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: v && v.target ? v.target.value : v }));

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!d.name.trim()) return setErr('Nhập tên giải');
    if (d.cmode === 'existing' && !d.customer_id) return setErr('Chọn khách hàng (hoặc tạo khách hàng mới)');
    if (d.cmode === 'new' && !d.newCustomer.trim()) return setErr('Nhập tên khách hàng mới');
    setBusy(true);
    try {
      let customerId = d.customer_id;
      if (d.cmode === 'new') {
        const c = await ctx.saveRow('customers', null, { name: d.newCustomer.trim(), customer_type: lead?.customer_type || 'Doanh nghiệp', region: lead?.region || '', owner_id: d.pic_id || null });
        await ctx.store.addActivity({ customer_id: c.id, type: 'create', content: 'Tạo khách hàng từ giải đấu' });
        customerId = c.id;
      }
      const { cmode, newCustomer, id, created_at, created_by, updated_at, ...rest } = d;
      await saveEvent(ctx, row, { ...rest, customer_id: customerId, name: d.name.trim(), event_date: d.event_date || null, pic_id: d.pic_id || null, phase: d.phase || null, lead_id: row?.lead_id || lead?.id || null });
      if (lead && !lead.customer_id) await updateLead(lead, { customer_id: customerId });
      notify(row ? 'Đã lưu giải' : 'Đã tạo giải');
      onClose();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  const cusName = customers.find((c) => c.id === fixedCustomer)?.name;
  return html`<${Modal} title=${row ? 'Sửa giải đấu' : 'Thêm giải đấu'} onClose=${onClose} wide>
    <form class="form" onSubmit=${submit}>
      <label>Tên giải *<input value=${d.name} onInput=${set('name')} autofocus placeholder="VD: Giải Pickleball MSB Hà Nội 2026" /></label>
      ${fixedCustomer
        ? html`<div class="muted">Khách hàng: <b>${cusName}</b></div>`
        : html`<div class="grid2">
            <label>Khách hàng *
              <div class="seg"><button type="button" class=${d.cmode === 'existing' ? 'on' : ''} onClick=${() => set('cmode')('existing')}>Đã có</button><button type="button" class=${d.cmode === 'new' ? 'on' : ''} onClick=${() => set('cmode')('new')}>＋ Khách mới</button></div></label>
            ${d.cmode === 'existing'
              ? html`<label>Chọn khách hàng<${Select} value=${d.customer_id} onChange=${set('customer_id')} placeholder="Chọn…" options=${customers.slice().sort((a, b) => a.name.localeCompare(b.name, 'vi')).map((c) => ({ value: c.id, label: c.name }))} /></label>`
              : html`<label>Tên khách hàng mới<input value=${d.newCustomer} onInput=${set('newCustomer')} placeholder="Tên đơn vị" /></label>`}
          </div>`}
      <div class="grid3">
        <label>Trạng thái<${Select} value=${d.status} onChange=${set('status')} options=${statusOpts} /></label>
        <label>Giai đoạn<${Select} value=${d.phase || ''} onChange=${set('phase')} placeholder="—" options=${phaseOpts} /></label>
        <label>PIC<${Select} value=${d.pic_id || ''} onChange=${set('pic_id')} placeholder="—" options=${salesPeople(profiles).map((p) => ({ value: p.id, label: p.full_name }))} /></label>
        <label>Ngày tổ chức<input type="date" value=${d.event_date || ''} onInput=${set('event_date')} /></label>
        <label>Hoặc thời gian dự kiến<input value=${d.date_text || ''} onInput=${set('date_text')} placeholder="VD: Tháng 6, 20–21/6" /></label>
        <label>Môn<${Select} value=${d.sport || ''} onChange=${set('sport')} placeholder="Chọn" options=${settings.needs} /></label>
        <label>Quy mô (VĐV)<input type="number" min="0" value=${d.headcount ?? ''} onInput=${set('headcount')} /></label>
        <label>Địa điểm / sân<input value=${d.venue || ''} onInput=${set('venue')} /></label>
        <label>Link checklist / tài liệu<input type="url" value=${d.link || ''} onInput=${set('link')} placeholder="https://docs.google.com/…" /></label>
      </div>
      <label>Tình hình / ghi chú<textarea rows="3" value=${d.notes || ''} onInput=${set('notes')} placeholder="VD: Đã gửi báo giá, khách đổi sang tháng 7…" /></label>
      <label>Phương án / việc tiếp theo<textarea rows="2" value=${d.next_action || ''} onInput=${set('next_action')} placeholder="VD: 1 tuần nữa remind khách chốt đặt sân" /></label>
      ${lead && html`<div class="muted small">Gắn với lead: <b>${lead.name}</b></div>`}
      ${err && html`<div class="err">${err}</div>`}
      <div class="row end">
        ${row && isMgr && html`<button type="button" class="link danger" style="margin-right:auto" onClick=${async () => { if (confirm(`Xoá giải "${row.name}"?`)) { try { await removeRow('events', row.id); notify('Đã xoá giải'); onClose(); } catch (e) { setErr(e.message); } } }}>Xoá giải</button>`}
        <button type="button" class="btn" onClick=${onClose}>Huỷ</button><button class="btn primary" disabled=${busy}>${busy ? 'Đang lưu…' : 'Lưu'}</button>
      </div>
    </form>
  <//>`;
}
