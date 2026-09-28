import { html, useState, useEffect, useMemo, useRef } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import * as U from './util.js';
import { Modal, Select, salesPeople, Section, FollowupInput, CARE_CHIPS, ContactButtons, StagePill } from './ui.js';

// ---------------------------------------------------------------------------
// Thành phần nhỏ
// ---------------------------------------------------------------------------
export function TierPill({ n, settings }) {
  const t = U.customerTier(n, settings);
  return html`<span class="pill" style=${`--c:${t.color}`}>${t.label}</span>`;
}

export function CareBadge({ c, settings }) {
  if (!c.next_care) return html`<span class="badge warn">Chưa hẹn</span>`;
  const f = U.customerFlags(c, settings);
  return html`<span class=${'badge ' + (f.overdue ? 'bad' : f.dueToday ? 'warn' : 'ok')} title=${U.fmtDate(c.next_care)}>${U.relDay(c.next_care)}</span>`;
}

function LastCare({ c, settings }) {
  const d = U.daysSince(c.last_care_at);
  const stale = U.customerFlags(c, settings).stale;
  return html`<span class=${stale ? 'stale' : 'muted'} title=${U.fmtDateTime(c.last_care_at)}>${d === 0 ? 'Hôm nay' : d + ' ngày trước'}${stale ? ' ⚠' : ''}</span>`;
}

export const contactsOf = (ctx, cid) =>
  ctx.contacts.filter((k) => k.customer_id === cid).sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0) || a.name.localeCompare(b.name, 'vi'));
export const primaryContact = (ctx, cid) => contactsOf(ctx, cid)[0];
const eventsOf = (ctx, cid) =>
  ctx.events.filter((e) => e.customer_id === cid).sort((a, b) => (b.event_date || '').localeCompare(a.event_date || ''));
const asLead = (k, c) => ({ ...k, company: c?.name });

function occasionKey(settings, occasion, date) {
  const y = (date || U.todayStr()).slice(0, 4);
  const o = (settings.occasions || []).find((x) => x.label === occasion);
  if (o) return `${o.key}-${y}`;
  if (occasion === 'Tri ân khách thân thiết') return 'loyal';
  if (occasion === 'Tri ân khách VIP') return 'vip';
  return 'other-' + U.uid().slice(0, 8);
}

// ---------------------------------------------------------------------------
// Danh sách khách hàng
// ---------------------------------------------------------------------------
export function CustomersView({ ctx }) {
  const { customers, events, profiles, people, settings, user, openCustomer } = ctx;
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const [tier, setTier] = useState('');
  const [flag, setFlag] = useState('');
  const [sort, setSort] = useState('care');
  const [showNew, setShowNew] = useState(false);

  const rows = useMemo(() => {
    const fq = U.fold(q);
    return customers
      .map((c) => {
        const evs = eventsOf(ctx, c.id).filter((e) => e.status !== 'cancelled');
        const pc = primaryContact(ctx, c.id);
        return { c, evs, n: evs.length, pc, tier: U.customerTier(evs.length, settings).id, f: U.customerFlags(c, settings) };
      })
      .filter((r) => {
        if (owner === '_none' ? r.c.owner_id : owner && r.c.owner_id !== owner) return false;
        if (tier && r.tier !== tier) return false;
        if (flag && !r.f[flag]) return false;
        if (fq) {
          const ks = ctx.contacts.filter((k) => k.customer_id === r.c.id);
          const hay = U.fold([r.c.name, r.c.industry, r.c.notes, ...ks.map((k) => k.name + ' ' + (k.phone || '') + ' ' + (k.email || ''))].join(' '));
          if (!hay.includes(fq)) return false;
        }
        return true;
      })
      .sort(
        {
          care: (a, b) => (a.c.next_care || '9999').localeCompare(b.c.next_care || '9999'),
          events: (a, b) => b.n - a.n,
          recent: (a, b) => (b.evs[0]?.event_date || '').localeCompare(a.evs[0]?.event_date || ''),
          stale: (a, b) => a.c.last_care_at.localeCompare(b.c.last_care_at),
          name: (a, b) => a.c.name.localeCompare(b.c.name, 'vi'),
        }[sort]
      );
  }, [customers, events, ctx.contacts, q, owner, tier, flag, sort, settings]);

  function exportCsv() {
    U.csvDownload(`fairplay-khach-hang-${U.todayStr()}.csv`, [
      ['Khách hàng', 'Loại', 'Ngành', 'Khu vực', 'Hạng', 'Số giải', 'Giải gần nhất', 'Ngày', 'Đầu mối chính', 'Chức vụ', 'SĐT', 'Email', 'Phụ trách', 'Chăm sóc tiếp', 'Liên hệ cuối'],
      ...rows.map((r) => [r.c.name, r.c.customer_type, r.c.industry, r.c.region, U.customerTier(r.n, settings).label, r.n, r.evs[0]?.name, U.fmtDate(r.evs[0]?.event_date),
        r.pc?.name, r.pc?.title, r.pc?.phone, r.pc?.email, people[r.c.owner_id]?.full_name, U.fmtDate(r.c.next_care), U.fmtDate(r.c.last_care_at)]),
    ]);
  }

  return html`<div class="page">
    <div class="page-head"><h1>Khách hàng <span class="count">${rows.length}</span></h1>
      <div class="row"><button class="btn" onClick=${exportCsv}>⬇ Xuất CSV</button><button class="btn primary" onClick=${() => setShowNew(true)}>＋ Khách hàng</button></div>
    </div>
    <div class="filters">
      <input class="search" placeholder="Tìm tên khách, đầu mối, SĐT…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <${Select} value=${owner} onChange=${setOwner} placeholder="Mọi người phụ trách" options=${[{ value: user.id, label: 'Của tôi' }, { value: '_none', label: 'Chưa giao' }, ...salesPeople(profiles).filter((p) => p.id !== user.id).map((p) => ({ value: p.id, label: p.full_name }))]} />
      <${Select} value=${tier} onChange=${setTier} placeholder="Mọi hạng" options=${[{ value: 'vip', label: 'VIP' }, { value: 'loyal', label: 'Thân thiết' }, { value: 'one', label: 'Đã tổ chức 1 giải' }, { value: 'prospect', label: 'Tiềm năng' }]} />
      <${Select} value=${flag} onChange=${setFlag} placeholder="Mọi tình trạng" options=${[{ value: 'due', label: 'Đến hạn chăm sóc' }, { value: 'stale', label: `Lâu không liên hệ (≥ ${settings.care_stale_days} ngày)` }, { value: 'noCare', label: 'Chưa hẹn chăm sóc' }]} />
      <${Select} value=${sort} onChange=${setSort} options=${[{ value: 'care', label: 'Sắp xếp: Lịch chăm sóc' }, { value: 'events', label: 'Sắp xếp: Nhiều giải nhất' }, { value: 'recent', label: 'Sắp xếp: Giải gần nhất' }, { value: 'stale', label: 'Sắp xếp: Lâu chưa liên hệ' }, { value: 'name', label: 'Sắp xếp: Tên A–Z' }]} />
    </div>
    <div class="table-wrap"><table class="table leads">
      <thead><tr><th>Khách hàng</th><th>Hạng</th><th>Số giải</th><th>Giải gần nhất</th><th>Đầu mối chính</th><th>Phụ trách</th><th>Chăm sóc tiếp</th><th>Liên hệ cuối</th><th></th></tr></thead>
      <tbody>${rows.map((r) => html`<tr key=${r.c.id} onClick=${() => openCustomer(r.c.id)}>
        <td data-l="Khách hàng"><b>${r.c.name}</b><div class="muted small">${[r.c.customer_type, r.c.region].filter(Boolean).join(' · ')}</div></td>
        <td data-l="Hạng"><${TierPill} n=${r.n} settings=${settings} /></td>
        <td data-l="Số giải" class="num">${r.n}</td>
        <td data-l="Giải gần nhất" class="small">${r.evs[0] ? html`${r.evs[0].name}<div class="muted">${U.fmtDate(r.evs[0].event_date)}</div>` : html`<span class="muted">—</span>`}</td>
        <td data-l="Đầu mối">${r.pc ? html`${r.pc.name}<div class="muted small">${r.pc.title || ''}</div>` : html`<span class="badge warn">Chưa có</span>`}</td>
        <td data-l="Phụ trách">${people[r.c.owner_id]?.full_name || html`<span class="badge info">Chưa giao</span>`}</td>
        <td data-l="Chăm sóc tiếp"><${CareBadge} c=${r.c} settings=${settings} /></td>
        <td data-l="Liên hệ cuối"><${LastCare} c=${r.c} settings=${settings} /></td>
        <td>${r.pc && html`<${ContactButtons} ctx=${ctx} lead=${asLead(r.pc, r.c)} compact onLogged=${() => openCustomer(r.c.id)} />`}</td>
      </tr>`)}</tbody>
    </table></div>
    ${rows.length === 0 && html`<div class="empty">Chưa có khách hàng phù hợp.</div>`}
    ${showNew && html`<${CustomerModal} ctx=${ctx} onClose=${() => setShowNew(false)} onSaved=${(c) => openCustomer(c.id)} />`}
  </div>`;
}

// ---------------------------------------------------------------------------
// Chi tiết khách hàng
// ---------------------------------------------------------------------------
export function CustomerDrawer({ ctx, customer: c, onClose }) {
  const { settings, people, profiles, isMgr, leads, gifts, logCare, saveRow, removeRow, notify, store, openLead, startNewLead } = ctx;
  const [acts, setActs] = useState(null);
  const [type, setType] = useState('call');
  const [content, setContent] = useState('');
  const [nc, setNc] = useState(c.next_care && c.next_care >= U.todayStr() ? c.next_care : U.addDays(30));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null);
  const noteRef = useRef();

  useEffect(() => {
    store.listActivities({ customer_id: c.id }).then(setActs, (e) => notify(e.message, 'err'));
  }, [c.id, c.last_care_at]);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && !document.querySelector('.overlay') && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  const ks = contactsOf(ctx, c.id);
  const evs = eventsOf(ctx, c.id);
  const n = evs.filter((e) => e.status !== 'cancelled').length;
  const cLeads = leads.filter((l) => l.customer_id === c.id);
  const cGifts = gifts.filter((g) => g.customer_id === c.id).sort((a, b) => (b.gift_date || b.created_at).localeCompare(a.gift_date || a.created_at));
  const sug = U.careSuggestions({ ...ctx, customers: [c] });

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!content.trim() && nc === c.next_care) return setErr('Nhập nội dung chăm sóc');
    if (!nc) return setErr('Hẹn ngày chăm sóc tiếp theo');
    setBusy(true);
    try {
      await logCare(c, { type, content, next_care: nc });
      setContent('');
      notify('Đã lưu');
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  const pc = ks[0];
  return html`<div class="drawer-overlay" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
    <aside class="drawer" role="dialog" aria-label=${c.name}>
      <div class="drawer-head">
        <div>
          <h2>${c.name}</h2>
          <div class="muted">${[c.customer_type, c.industry, c.region].filter(Boolean).join(' · ')}</div>
          <div class="lrow-sub"><${TierPill} n=${n} settings=${settings} /> <span class="tag">${n} giải</span> <${CareBadge} c=${c} settings=${settings} /> <span class="muted">${people[c.owner_id]?.full_name || 'Chưa giao'}</span></div>
        </div>
        <button class="x" onClick=${onClose} aria-label="Đóng">×</button>
      </div>
      <div class="drawer-body">
        ${sug.season.map((s) => html`<div class="suggest">🗓 <b>Mùa giải:</b> "${s.event.name}" tổ chức ${U.fmtDate(s.event.event_date)} — còn ${s.gap} ngày tới kỷ niệm. Liên hệ đề xuất giải năm nay.
          <button class="btn sm" onClick=${() => startNewLead(newLeadFor(ctx, c, s.event.sport))}>Tạo cơ hội mới</button></div>`)}
        ${sug.thanks.map((s) => html`<div class="suggest">🙏 <b>Tri ân sau giải</b> "${s.event.name}" (${U.fmtDate(s.event.event_date)}): gửi lời cảm ơn / quà, xin feedback.
          <button class="btn sm" onClick=${() => setModal({ t: 'gift', preset: { occasion: 'Tri ân sau giải', occasion_key: s.key } })}>Ghi nhận</button></div>`)}
        ${sug.loyal.map((s) => html`<div class="suggest">🎁 <b>${s.label}</b> — đã tổ chức ${s.n} giải cùng Fairplay.
          <button class="btn sm" onClick=${() => setModal({ t: 'gift', preset: { occasion: s.label, occasion_key: s.key } })}>Ghi nhận quà</button></div>`)}

        ${pc ? html`<div><div class="muted small">Đầu mối chính: <b>${pc.name}</b>${pc.title ? ' · ' + pc.title : ''}</div>
            <${ContactButtons} ctx=${ctx} lead=${asLead(pc, c)} onLogged=${(t) => { setType(t); setTimeout(() => noteRef.current?.focus(), 50); }} /></div>`
          : html`<div class="dupwarn">Chưa có đầu mối liên hệ. <button class="link" onClick=${() => setModal({ t: 'contact' })}>Thêm đầu mối</button></div>`}

        <form class="logbox" onSubmit=${submit}>
          <div class="chips">${U.ACTIVITY_TYPES.map((t) => html`<button type="button" class=${'chip' + (type === t.id ? ' on' : '')} onClick=${() => setType(t.id)}>${t.icon} ${t.label}</button>`)}</div>
          <textarea ref=${noteRef} rows="3" placeholder="Nội dung chăm sóc: hỏi thăm, kế hoạch sắp tới của khách, nhu cầu mới…" value=${content} onInput=${(e) => setContent(e.target.value)} />
          <${FollowupInput} label="Hẹn chăm sóc tiếp theo *" value=${nc} onChange=${setNc} chips=${CARE_CHIPS} />
          ${err && html`<div class="err">${err}</div>`}
          <div class="row end"><button class="btn primary" disabled=${busy}>${busy ? 'Đang lưu…' : 'Lưu chăm sóc'}</button></div>
        </form>

        <div class="section-head"><h3>Đầu mối (${ks.length})</h3><button class="link" onClick=${() => setModal({ t: 'contact' })}>＋ Thêm</button></div>
        ${ks.length === 0 ? html`<div class="empty">Chưa có đầu mối</div>` : html`<div class="minilist">${ks.map((k) => html`<div class="mini" key=${k.id}>
          <div class="mini-main" onClick=${() => setModal({ t: 'contact', row: k })}>
            <b>${k.is_primary ? '★ ' : ''}${k.name}</b> <span class="muted small">${[k.title, k.gender].filter(Boolean).join(' · ')}</span>
            <div class="muted small">${[k.phone, k.email, k.birthday && '🎂 ' + U.fmtDate(k.birthday).slice(0, 5)].filter(Boolean).join(' · ')}</div>
          </div>
          <${ContactButtons} ctx=${ctx} lead=${asLead(k, c)} compact />
        </div>`)}</div>`}

        <div class="section-head"><h3>Giải đã tổ chức (${n})</h3><button class="link" onClick=${() => setModal({ t: 'event' })}>＋ Thêm giải</button></div>
        ${evs.length === 0 ? html`<div class="empty">Chưa có giải nào</div>` : html`<div class="minilist">${evs.map((e) => html`<div class="mini click" key=${e.id} onClick=${() => setModal({ t: 'event', row: e })}>
          <div class="mini-main"><b>${e.name}</b>
            <div class="muted small">${[U.fmtDate(e.event_date), e.sport, e.headcount && e.headcount + ' người', e.venue].filter(Boolean).join(' · ')}</div></div>
          <span class=${'badge ' + (e.status === 'done' ? 'ok' : e.status === 'upcoming' ? 'info' : '')}>${U.EVENT_STATUS[e.status]}</span>
        </div>`)}</div>`}

        <div class="section-head"><h3>Cơ hội / Lead (${cLeads.length})</h3><button class="link" onClick=${() => startNewLead(newLeadFor(ctx, c))}>＋ Cơ hội mới</button></div>
        ${cLeads.length > 0 && html`<div class="minilist">${cLeads.map((l) => html`<div class="mini click" key=${l.id} onClick=${() => openLead(l.id)}>
          <div class="mini-main"><b>${l.need || 'Nhu cầu chưa rõ'}</b> <span class="muted small">· ${l.name} · ${U.fmtDate(l.created_at)}</span></div><${StagePill} stage=${l.stage} /></div>`)}</div>`}

        <div class="section-head"><h3>Quà tặng (${cGifts.length})</h3><button class="link" onClick=${() => setModal({ t: 'gift' })}>＋ Ghi nhận quà</button></div>
        ${cGifts.length > 0 && html`<div class="minilist">${cGifts.map((g) => html`<div class="mini click" key=${g.id} onClick=${() => setModal({ t: 'gift', row: g })}>
          <div class="mini-main"><b>${g.occasion}</b> <span class="muted small">· ${ctx.contacts.find((k) => k.id === g.contact_id)?.name || 'Cả đơn vị'}</span>
            <div class="muted small">${[g.gift, U.fmtDate(g.gift_date)].filter(Boolean).join(' · ')}</div></div>
          <span class=${'badge ' + (g.status === 'given' ? 'ok' : g.status === 'planned' ? 'warn' : '')}>${U.GIFT_STATUS[g.status]}</span></div>`)}</div>`}

        <div class="section-head"><h3>Thông tin</h3><button class="link" onClick=${() => setModal({ t: 'customer' })}>✎ Sửa</button></div>
        <dl class="infolist">
          <dt>Phụ trách</dt><dd>${isMgr
            ? html`<${Select} value=${c.owner_id || ''} placeholder="— Chưa giao —" options=${salesPeople(profiles).map((p) => ({ value: p.id, label: p.full_name }))}
                onChange=${async (v) => { try { await saveRow('customers', c.id, { owner_id: v || null }); await store.addActivity({ customer_id: c.id, type: 'assign', content: v ? `Giao cho ${people[v]?.full_name}` : 'Bỏ giao' }); notify('Đã cập nhật người phụ trách'); } catch (e) { notify(e.message, 'err'); } }} />`
            : people[c.owner_id]?.full_name || 'Chưa giao'}</dd>
          <dt>Địa chỉ</dt><dd>${c.address || '—'}</dd>
          <dt>Liên hệ cuối</dt><dd><${LastCare} c=${c} settings=${settings} /></dd>
          ${c.notes && html`<dt>Ghi chú</dt><dd class="pre">${c.notes}</dd>`}
        </dl>

        <div class="section-head"><h3>Lịch sử chăm sóc</h3></div>
        ${acts === null ? html`<div class="muted">Đang tải…</div>` : acts.length === 0 ? html`<div class="empty">Chưa có</div>` : html`<ol class="timeline">
          ${acts.map((a) => { const t = U.activityType(a.type); return html`<li class=${'t-' + a.type}><span class="t-ic">${t.icon}</span>
            <div><div class="t-head"><b>${t.label}</b><span class="muted small">${people[a.created_by]?.full_name || 'Hệ thống'} · ${U.fmtDateTime(a.created_at)}</span></div>
            ${a.content && html`<div class="pre">${a.content}</div>`}</div></li>`; })}
        </ol>`}
        ${isMgr && html`<div class="danger-zone"><button class="link danger" onClick=${async () => { if (confirm(`Xoá vĩnh viễn khách hàng "${c.name}" cùng đầu mối, giải đấu, quà tặng?`)) { try { await removeRow('customers', c.id); onClose(); notify('Đã xoá'); } catch (e) { notify(e.message, 'err'); } } }}>Xoá khách hàng</button></div>`}
      </div>
    </aside>
    ${modal?.t === 'contact' && html`<${ContactModal} ctx=${ctx} customer=${c} row=${modal.row} onClose=${() => setModal(null)} />`}
    ${modal?.t === 'event' && html`<${EventModal} ctx=${ctx} customer=${c} row=${modal.row} onClose=${() => setModal(null)} />`}
    ${modal?.t === 'gift' && html`<${GiftModal} ctx=${ctx} customer=${c} row=${modal.row} preset=${modal.preset} onClose=${() => setModal(null)} />`}
    ${modal?.t === 'customer' && html`<${CustomerModal} ctx=${ctx} row=${c} onClose=${() => setModal(null)} />`}
  </div>`;
}

export function newLeadFor(ctx, c, need) {
  const pc = primaryContact(ctx, c.id);
  return {
    customer_id: c.id, company: c.name, customer_type: c.customer_type || '', region: c.region || '', source: 'Khách cũ', need: need || '',
    name: pc?.name || '', phone: pc?.phone || '', email: pc?.email || '', facebook: pc?.facebook || '',
  };
}

// ---------------------------------------------------------------------------
// Form: khách hàng / đầu mối / giải / quà
// ---------------------------------------------------------------------------
function useForm(init) {
  const [d, setD] = useState(init);
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: v && v.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }));
  return [d, set, setD];
}

function FormModal({ title, onClose, onSubmit, onDelete, children, wide }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await onSubmit();
      onClose();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }
  return html`<${Modal} title=${title} onClose=${onClose} wide=${wide}>
    <form class="form" onSubmit=${submit}>
      ${children}
      ${err && html`<div class="err">${err}</div>`}
      <div class="row end">
        ${onDelete && html`<button type="button" class="link danger" style="margin-right:auto" onClick=${async () => { if (confirm('Xoá mục này?')) { try { await onDelete(); onClose(); } catch (e) { setErr(e.message); } } }}>Xoá</button>`}
        <button type="button" class="btn" onClick=${onClose}>Huỷ</button><button class="btn primary" disabled=${busy}>${busy ? 'Đang lưu…' : 'Lưu'}</button>
      </div>
    </form>
  <//>`;
}

export function CustomerModal({ ctx, row, onClose, onSaved }) {
  const { settings, isMgr, profiles, saveRow, notify, store } = ctx;
  const [d, set] = useForm({ name: '', customer_type: 'Doanh nghiệp', industry: '', region: '', address: '', notes: '', owner_id: '', next_care: U.addDays(30), ...row, k_name: '', k_title: '', k_phone: '', k_email: '', k_gender: '' });
  const dup = !row && d.name.trim() && ctx.customers.find((c) => U.fold(c.name) === U.fold(d.name));
  return html`<${FormModal} title=${row ? 'Sửa khách hàng' : 'Thêm khách hàng'} onClose=${onClose} wide
    onSubmit=${async () => {
      if (!d.name.trim()) throw new Error('Nhập tên khách hàng');
      const { k_name, k_title, k_phone, k_email, k_gender, ...data } = d;
      const c = await saveRow('customers', row?.id, { ...data, name: d.name.trim() });
      if (!row) {
        await store.addActivity({ customer_id: c.id, type: 'create', content: 'Tạo khách hàng' });
        if (k_name.trim()) await saveRow('contacts', null, { customer_id: c.id, name: k_name.trim(), title: k_title, phone: k_phone, email: k_email, gender: k_gender, is_primary: true });
      }
      notify(row ? 'Đã cập nhật' : 'Đã tạo khách hàng');
      onSaved && onSaved(c);
    }}>
    <div class="grid2">
      <label>Tên đơn vị *<input value=${d.name} onInput=${set('name')} autofocus /></label>
      <label>Ngành nghề<input value=${d.industry || ''} onInput=${set('industry')} placeholder="Ngân hàng, BĐS, CNTT…" /></label>
    </div>
    ${dup && html`<div class="dupwarn">⚠ Đã có khách hàng "${dup.name}"</div>`}
    <div class="grid3">
      <label>Loại khách<${Select} value=${d.customer_type} onChange=${set('customer_type')} placeholder="Chọn" options=${settings.customer_types} /></label>
      <label>Khu vực<${Select} value=${d.region} onChange=${set('region')} placeholder="Chọn" options=${settings.regions} /></label>
      ${isMgr ? html`<label>Phụ trách<${Select} value=${d.owner_id} onChange=${set('owner_id')} placeholder="— Chưa giao —" options=${salesPeople(profiles).map((p) => ({ value: p.id, label: p.full_name }))} /></label>` : html`<div />`}
    </div>
    <label>Địa chỉ<input value=${d.address || ''} onInput=${set('address')} /></label>
    ${!row && html`<fieldset class="fs"><legend>Đầu mối chính (tuỳ chọn)</legend>
      <div class="grid3">
        <label>Họ tên<input value=${d.k_name} onInput=${set('k_name')} /></label>
        <label>Chức vụ<input value=${d.k_title} onInput=${set('k_title')} /></label>
        <label>Giới tính<${Select} value=${d.k_gender} onChange=${set('k_gender')} placeholder="—" options=${['Nam', 'Nữ']} /></label>
        <label>SĐT<input type="tel" value=${d.k_phone} onInput=${set('k_phone')} /></label>
        <label>Email<input type="email" value=${d.k_email} onInput=${set('k_email')} /></label>
      </div></fieldset>`}
    ${!row && html`<${FollowupInput} label="Hẹn chăm sóc đầu tiên" value=${d.next_care} onChange=${set('next_care')} chips=${CARE_CHIPS} />`}
    <label>Ghi chú<textarea rows="2" value=${d.notes || ''} onInput=${set('notes')} /></label>
  <//>`;
}

function ContactModal({ ctx, customer, row, onClose }) {
  const { saveRow, removeRow, isMgr, notify } = ctx;
  const others = ctx.contacts.filter((k) => k.customer_id === customer.id && k.id !== row?.id);
  const [d, set] = useForm({ name: '', title: '', gender: '', phone: '', email: '', facebook: '', birthday: '', notes: '', is_primary: !others.some((k) => k.is_primary), ...row });
  return html`<${FormModal} title=${(row ? 'Sửa đầu mối' : 'Thêm đầu mối') + ' · ' + customer.name} onClose=${onClose} wide
    onDelete=${row && isMgr ? async () => { await removeRow('contacts', row.id); notify('Đã xoá'); } : null}
    onSubmit=${async () => {
      if (!d.name.trim()) throw new Error('Nhập họ tên');
      const { id, created_at, ...data } = d;
      await saveRow('contacts', row?.id, { ...data, customer_id: customer.id, name: d.name.trim(), birthday: d.birthday || null });
      if (d.is_primary) for (const k of others.filter((k) => k.is_primary)) await saveRow('contacts', k.id, { is_primary: false });
      notify('Đã lưu đầu mối');
    }}>
    <div class="grid3">
      <label>Họ tên *<input value=${d.name} onInput=${set('name')} autofocus /></label>
      <label>Chức vụ<input value=${d.title || ''} onInput=${set('title')} placeholder="Trưởng phòng HCNS…" /></label>
      <label>Giới tính<${Select} value=${d.gender} onChange=${set('gender')} placeholder="—" options=${['Nam', 'Nữ']} /></label>
      <label>SĐT<input type="tel" value=${d.phone || ''} onInput=${set('phone')} /></label>
      <label>Email<input type="email" value=${d.email || ''} onInput=${set('email')} /></label>
      <label>Ngày sinh<input type="date" value=${d.birthday || ''} onInput=${set('birthday')} /></label>
    </div>
    <label>Facebook<input value=${d.facebook || ''} onInput=${set('facebook')} placeholder="https://facebook.com/..." /></label>
    <label class="inline-check"><input type="checkbox" checked=${d.is_primary} onChange=${set('is_primary')} /> Đầu mối chính (nhận quà dịp lễ, liên hệ mặc định)</label>
    <label>Ghi chú<textarea rows="2" value=${d.notes || ''} onInput=${set('notes')} placeholder="Sở thích, lưu ý khi làm việc…" /></label>
  <//>`;
}

function EventModal({ ctx, customer, row, onClose, lead }) {
  const { settings, saveRow, removeRow, isMgr, notify, store } = ctx;
  const [d, set] = useForm({ name: '', sport: '', event_date: '', venue: '', headcount: '', status: 'done', notes: '', ...row });
  return html`<${FormModal} title=${(row ? 'Sửa giải' : 'Thêm giải') + ' · ' + customer.name} onClose=${onClose}
    onDelete=${row && isMgr ? async () => { await removeRow('events', row.id); notify('Đã xoá'); } : null}
    onSubmit=${async () => {
      if (!d.name.trim()) throw new Error('Nhập tên giải');
      const { id, created_at, created_by, ...data } = d;
      await saveRow('events', row?.id, { ...data, customer_id: customer.id, name: d.name.trim(), event_date: d.event_date || null });
      if (!row) await store.addActivity({ customer_id: customer.id, type: 'note', content: `Ghi nhận giải: ${d.name.trim()}${d.event_date ? ' (' + U.fmtDate(d.event_date) + ')' : ''}` });
      notify('Đã lưu giải');
    }}>
    <label>Tên giải *<input value=${d.name} onInput=${set('name')} autofocus placeholder="VD: Giải Pickleball Ngân hàng X 2026" /></label>
    <div class="grid2">
      <label>Bộ môn<${Select} value=${d.sport} onChange=${set('sport')} placeholder="Chọn" options=${settings.needs} /></label>
      <label>Ngày tổ chức<input type="date" value=${d.event_date || ''} onInput=${set('event_date')} /></label>
      <label>Trạng thái<${Select} value=${d.status} onChange=${set('status')} options=${Object.entries(U.EVENT_STATUS).map(([value, label]) => ({ value, label }))} /></label>
      <label>Quy mô (VĐV)<input type="number" min="0" value=${d.headcount ?? ''} onInput=${set('headcount')} /></label>
    </div>
    <label>Địa điểm<input value=${d.venue || ''} onInput=${set('venue')} /></label>
    <label>Ghi chú<textarea rows="2" value=${d.notes || ''} onInput=${set('notes')} placeholder="Điểm khách hài lòng / chưa hài lòng, bài học…" /></label>
  <//>`;
}

export function GiftModal({ ctx, customer, row, preset = {}, onClose }) {
  const { settings, saveRow, removeRow, isMgr, notify, store } = ctx;
  const ks = contactsOf(ctx, customer.id);
  const occasionOpts = [...(settings.occasions || []).map((o) => o.label), 'Tri ân sau giải', 'Tri ân khách thân thiết', 'Tri ân khách VIP', 'Khác'];
  const [d, set] = useForm({ occasion: '', contact_id: ks[0]?.id || '', gift: '', gift_date: U.todayStr(), status: 'given', notes: '', ...preset, ...row });
  return html`<${FormModal} title=${(row ? 'Sửa quà tặng' : 'Ghi nhận quà tặng') + ' · ' + customer.name} onClose=${onClose}
    onDelete=${row && isMgr ? async () => { await removeRow('gifts', row.id); notify('Đã xoá'); } : null}
    onSubmit=${async () => {
      if (!d.occasion) throw new Error('Chọn dịp tặng quà');
      const key = row?.occasion_key || preset.occasion_key || occasionKey(settings, d.occasion, d.gift_date);
      const { id, created_at, created_by, ...data } = d;
      await saveRow('gifts', row?.id, { ...data, customer_id: customer.id, contact_id: d.contact_id || null, occasion_key: key, gift_date: d.gift_date || null });
      if (!row && d.status !== 'skipped') {
        const who = ks.find((k) => k.id === d.contact_id)?.name;
        await store.addActivity({ customer_id: customer.id, type: 'note', content: `🎁 ${U.GIFT_STATUS[d.status]}: ${d.occasion}${who ? ' – ' + who : ''}${d.gift ? ' – ' + d.gift : ''}` });
      }
      notify('Đã lưu quà tặng');
    }}>
    <div class="grid2">
      <label>Dịp *<${Select} value=${d.occasion} onChange=${set('occasion')} placeholder="Chọn dịp" options=${occasionOpts} disabled=${!!preset.occasion} /></label>
      <label>Người nhận<${Select} value=${d.contact_id} onChange=${set('contact_id')} placeholder="Cả đơn vị" options=${ks.map((k) => ({ value: k.id, label: k.name + (k.title ? ' – ' + k.title : '') }))} /></label>
      <label>Trạng thái<${Select} value=${d.status} onChange=${set('status')} options=${Object.entries(U.GIFT_STATUS).map(([value, label]) => ({ value, label }))} /></label>
      <label>Ngày tặng<input type="date" value=${d.gift_date || ''} onInput=${set('gift_date')} /></label>
    </div>
    <label>Quà tặng<input value=${d.gift || ''} onInput=${set('gift')} placeholder="VD: Hộp quà Tết, vợt khắc tên, hoa + thiệp…" /></label>
    <label>Ghi chú<textarea rows="2" value=${d.notes || ''} onInput=${set('notes')} /></label>
  <//>`;
}

// ---------------------------------------------------------------------------
// Lead Chốt → Khách hàng + giải
// ---------------------------------------------------------------------------
function parseViDate(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

export function ConvertLeadModal({ ctx, lead, onClose }) {
  const { customers, settings, saveRow, updateLead, notify, store, openCustomer } = ctx;
  const guess = lead.customer_id || customers.find((c) => lead.company && U.fold(c.name) === U.fold(lead.company))?.id || '';
  const date = parseViDate(lead.event_time);
  const [d, set] = useForm({
    mode: guess ? 'existing' : 'new', customer_id: guess, name: lead.company || lead.name, customer_type: lead.customer_type || '', region: lead.region || '',
    addContact: !ctx.contacts.some((k) => k.customer_id === guess && ((lead.phone && U.normalizePhone(k.phone) === U.normalizePhone(lead.phone)) || U.fold(k.name) === U.fold(lead.name))),
    k_title: '',
    addEvent: true, e_name: `Giải ${lead.need || ''} ${lead.company || lead.name}`.replace(/\s+/g, ' ').trim(), e_date: date,
    e_status: date && date < U.todayStr() ? 'done' : 'upcoming', e_headcount: lead.headcount || '',
  });
  return html`<${FormModal} title=${`🎉 Chốt "${lead.name}" — lưu vào khách hàng`} onClose=${onClose} wide
    onSubmit=${async () => {
      let c;
      if (d.mode === 'existing') {
        c = customers.find((x) => x.id === d.customer_id);
        if (!c) throw new Error('Chọn khách hàng');
      } else {
        if (!d.name.trim()) throw new Error('Nhập tên khách hàng');
        c = await saveRow('customers', null, { name: d.name.trim(), customer_type: d.customer_type, region: d.region, owner_id: lead.assignee_id, next_care: U.addDays(30) });
        await store.addActivity({ customer_id: c.id, type: 'create', content: `Tạo từ lead "${lead.name}"` });
      }
      if (lead.customer_id !== c.id) await updateLead(lead, { customer_id: c.id });
      if (d.addContact)
        await saveRow('contacts', null, { customer_id: c.id, name: lead.name, title: d.k_title, phone: lead.phone, email: lead.email, facebook: lead.facebook, is_primary: !ctx.contacts.some((k) => k.customer_id === c.id && k.is_primary) });
      if (d.addEvent && d.e_name.trim())
        await saveRow('events', null, { customer_id: c.id, lead_id: lead.id, name: d.e_name.trim(), sport: lead.need, event_date: d.e_date || null, status: d.e_status, headcount: d.e_headcount });
      await store.addActivity({ customer_id: c.id, type: 'note', content: `Chốt lead "${lead.name}"${d.addEvent ? ' – ' + d.e_name : ''}` });
      notify('Đã lưu vào khách hàng');
      openCustomer(c.id);
    }}>
    <div class="seg">
      <button type="button" class=${d.mode === 'existing' ? 'on' : ''} onClick=${() => set('mode')('existing')}>Khách hàng đã có</button>
      <button type="button" class=${d.mode === 'new' ? 'on' : ''} onClick=${() => set('mode')('new')}>Tạo khách hàng mới</button>
    </div>
    ${d.mode === 'existing'
      ? html`<label>Khách hàng<${Select} value=${d.customer_id} onChange=${set('customer_id')} placeholder="Chọn khách hàng" options=${customers.slice().sort((a, b) => a.name.localeCompare(b.name, 'vi')).map((c) => ({ value: c.id, label: c.name }))} /></label>`
      : html`<div class="grid3">
          <label>Tên đơn vị *<input value=${d.name} onInput=${set('name')} /></label>
          <label>Loại khách<${Select} value=${d.customer_type} onChange=${set('customer_type')} placeholder="Chọn" options=${settings.customer_types} /></label>
          <label>Khu vực<${Select} value=${d.region} onChange=${set('region')} placeholder="Chọn" options=${settings.regions} /></label>
        </div>`}
    <label class="inline-check"><input type="checkbox" checked=${d.addContact} onChange=${set('addContact')} /> Lưu <b>${lead.name}</b> làm đầu mối</label>
    ${d.addContact && html`<label>Chức vụ đầu mối<input value=${d.k_title} onInput=${set('k_title')} placeholder="Trưởng phòng HCNS…" /></label>`}
    <label class="inline-check"><input type="checkbox" checked=${d.addEvent} onChange=${set('addEvent')} /> Ghi nhận giải đấu</label>
    ${d.addEvent && html`<div class="grid2">
      <label>Tên giải<input value=${d.e_name} onInput=${set('e_name')} /></label>
      <label>Ngày tổ chức<input type="date" value=${d.e_date} onInput=${set('e_date')} /></label>
      <label>Trạng thái<${Select} value=${d.e_status} onChange=${set('e_status')} options=${Object.entries(U.EVENT_STATUS).map(([value, label]) => ({ value, label }))} /></label>
      <label>Quy mô (VĐV)<input type="number" value=${d.e_headcount} onInput=${set('e_headcount')} /></label>
    </div>`}
  <//>`;
}

// ---------------------------------------------------------------------------
// Chăm sóc & Quà tặng
// ---------------------------------------------------------------------------
export function CareView({ ctx }) {
  const { customers, contacts, events, gifts, leads, settings, user, isMgr, people, openCustomer, startNewLead, saveRow, notify } = ctx;
  const [scope, setScope] = useState(isMgr ? 'all' : 'mine');
  const [horizon, setHorizon] = useState(0);
  const [modal, setModal] = useState(null);
  const mine = (c) => scope === 'all' || c.owner_id === user.id;
  const cs = customers.filter(mine);
  const ids = new Set(cs.map((c) => c.id));

  const due = cs.filter((c) => U.customerFlags(c, settings).due).sort((a, b) => a.next_care.localeCompare(b.next_care));
  const stale = cs.filter((c) => { const f = U.customerFlags(c, settings); return f.stale && !f.due; }).sort((a, b) => a.last_care_at.localeCompare(b.last_care_at));
  const sug = U.careSuggestions({ customers: cs, events, gifts, leads, settings });
  const tasks = U.giftTasks({ customers: cs, contacts, events, gifts, settings }, horizon);
  const giftOf = (t) => gifts.find((g) => g.occasion_key === t.key && g.contact_id === t.contact.id);
  const pendingGifts = tasks.filter((t) => !giftOf(t) || giftOf(t).status === 'planned').length;

  const groups = [];
  for (const t of tasks) {
    const k = t.key + '|' + t.date;
    let g = groups.find((x) => x.k === k);
    if (!g) groups.push((g = { k, occasion: t.occasion, date: t.date, items: [] }));
    g.items.push(t);
  }

  const quickGift = async (customer, key, occasion, contact_id, status) => {
    try {
      await saveRow('gifts', null, { customer_id: customer.id, contact_id, occasion, occasion_key: key, status, gift_date: U.todayStr() });
      notify(status === 'skipped' ? 'Đã bỏ qua' : 'Đã ghi nhận');
    } catch (e) {
      notify(e.message, 'err');
    }
  };

  function exportGifts() {
    U.csvDownload(`fairplay-qua-tang-${U.todayStr()}.csv`, [
      ['Dịp', 'Ngày', 'Khách hàng', 'Đầu mối', 'Chức vụ', 'SĐT', 'Địa chỉ', 'Phụ trách', 'Trạng thái', 'Quà'],
      ...tasks.map((t) => { const g = giftOf(t); return [t.occasion, U.fmtDate(t.date), t.customer.name, t.contact.name, t.contact.title, t.contact.phone, t.customer.address, people[t.customer.owner_id]?.full_name, g ? U.GIFT_STATUS[g.status] : 'Chưa làm', g?.gift]; }),
    ]);
  }

  const CRow = ({ c, children, actions }) => html`<div class="lrow" onClick=${() => openCustomer(c.id)}>
    <div class="lrow-main"><b>${c.name}</b> <span class="muted small">· ${people[c.owner_id]?.full_name || 'Chưa giao'}</span>
      <div class="lrow-sub">${children}</div></div>
    <div class="row" onClick=${(e) => e.stopPropagation()}>${actions}</div>
  </div>`;

  return html`<div class="page">
    <div class="page-head">
      <div><h1>Chăm sóc & Quà tặng</h1><p class="muted">Giữ quan hệ với khách cũ — nguồn giải lặp lại hằng năm</p></div>
      <div class="seg">
        <button class=${scope === 'mine' ? 'on' : ''} onClick=${() => setScope('mine')}>Khách của tôi</button>
        <button class=${scope === 'all' ? 'on' : ''} onClick=${() => setScope('all')}>Cả phòng</button>
      </div>
    </div>
    <div class="kpis">
      <div class="kpi bad"><b>${due.length}</b><span>Đến hạn chăm sóc</span></div>
      <div class="kpi warn"><b>${stale.length}</b><span>Lâu không liên hệ ≥ ${settings.care_stale_days} ngày</span></div>
      <div class="kpi info"><b>${sug.season.length}</b><span>Sắp tới mùa giải</span></div>
      <div class="kpi good"><b>${pendingGifts + sug.loyal.length + sug.thanks.length}</b><span>Việc quà tặng / tri ân</span></div>
    </div>

    <${Section} title="Đến hạn chăm sóc" count=${due.length} tone="bad" empty="Không có khách đến hạn chăm sóc">
      ${due.map((c) => html`<${CRow} c=${c} key=${c.id}><${CareBadge} c=${c} settings=${settings} /> <${TierPill} n=${U.countEvents(events, c.id)} settings=${settings} /> <span class="muted">Liên hệ cuối: <${LastCare} c=${c} settings=${settings} /></span><//>`)}
    <//>

    <${Section} title="Sắp tới mùa giải" count=${sug.season.length} tone="warn" hint=${`Khách từng tổ chức giải vào thời điểm này năm trước (trong ${settings.season_days} ngày tới), chưa có cơ hội mới`} empty="Chưa có">
      ${sug.season.map((s) => html`<${CRow} c=${s.customer} key=${s.customer.id}
          actions=${html`<button class="btn sm" onClick=${() => startNewLead(newLeadFor(ctx, s.customer, s.event.sport))}>＋ Tạo cơ hội</button>`}>
        <span>🗓 "${s.event.name}" — ${U.fmtDate(s.event.event_date)}</span> <span class="badge info">Kỷ niệm còn ${s.gap} ngày</span><//>`)}
    <//>

    <${Section} title="Tri ân sau giải" count=${sug.thanks.length} hint="Giải vừa kết thúc trong 21 ngày: gửi lời cảm ơn / quà, xin feedback" empty="Chưa có">
      ${sug.thanks.map((s) => html`<${CRow} c=${s.customer} key=${s.key}
          actions=${html`<button class="btn sm" onClick=${() => setModal({ customer: s.customer, preset: { occasion: 'Tri ân sau giải', occasion_key: s.key } })}>Ghi nhận</button><button class="link" onClick=${() => quickGift(s.customer, s.key, 'Tri ân sau giải', null, 'skipped')}>Bỏ qua</button>`}>
        <span>🏆 ${s.event.name} · ${U.fmtDate(s.event.event_date)}</span><//>`)}
    <//>

    <${Section} title="Khách thân thiết / VIP cần tri ân" count=${sug.loyal.length} hint=${`Từ ${settings.loyal_threshold} giải trở lên = Thân thiết, từ ${settings.vip_threshold} giải = VIP`} empty="Chưa có">
      ${sug.loyal.map((s) => html`<${CRow} c=${s.customer} key=${s.customer.id + s.key}
          actions=${html`<button class="btn sm" onClick=${() => setModal({ customer: s.customer, preset: { occasion: s.label, occasion_key: s.key } })}>Ghi nhận quà</button><button class="link" onClick=${() => quickGift(s.customer, s.key, s.label, null, 'skipped')}>Bỏ qua</button>`}>
        <${TierPill} n=${s.n} settings=${settings} /> <span>${s.n} giải cùng Fairplay</span><//>`)}
    <//>

    <section class="section">
      <div class="section-head"><h2>Quà dịp lễ & sinh nhật <span class="count">${tasks.length}</span></h2>
        <div class="row"><label class="inline-check small"><input type="checkbox" checked=${horizon > 0} onChange=${(e) => setHorizon(e.target.checked ? 180 : 0)} /> Xem trước 6 tháng</label>
        <button class="btn sm" onClick=${exportGifts}>⬇ Xuất danh sách</button></div></div>
      <p class="muted small">Tự nhắc trước ngày lễ (cài đặt số ngày trong Cài đặt). Tặng đầu mối chính của khách đã tổ chức giải; 8/3 và 20/10 tặng đầu mối nữ; sinh nhật theo ngày sinh đầu mối.</p>
      ${groups.length === 0 ? html`<div class="empty">Chưa có dịp nào sắp tới</div>` : groups.map((g) => html`<div class="gift-group" key=${g.k}>
        <div class="gift-head"><b>${g.occasion}</b> <span class="muted">${U.fmtDate(g.date)} · ${U.relDay(g.date)}</span>
          <span class="count">${g.items.filter((t) => giftOf(t)?.status === 'given' || giftOf(t)?.status === 'skipped').length}/${g.items.length} xong</span></div>
        <div class="rows">${g.items.map((t) => { const gf = giftOf(t); return html`<div class="lrow" key=${t.key + t.contact.id} onClick=${() => openCustomer(t.customer.id)}>
          <div class="lrow-main"><b>${t.contact.name}</b> <span class="muted small">${t.contact.title || ''}</span>
            <div class="lrow-sub"><span>${t.customer.name}</span> <span class="muted">· ${people[t.customer.owner_id]?.full_name || 'Chưa giao'}</span></div></div>
          <div class="row" onClick=${(e) => e.stopPropagation()}>
            ${gf ? html`<span class=${'badge ' + (gf.status === 'given' ? 'ok' : gf.status === 'planned' ? 'warn' : '')}>${U.GIFT_STATUS[gf.status]}${gf.gift ? ': ' + gf.gift : ''}</span>
                ${gf.status === 'planned' && html`<button class="btn sm" onClick=${async () => { await saveRow('gifts', gf.id, { status: 'given', gift_date: U.todayStr() }); notify('Đã tặng'); }}>✓ Đã tặng</button>`}
                <button class="link" onClick=${() => setModal({ customer: t.customer, row: gf })}>Sửa</button>`
              : html`<button class="btn sm" onClick=${() => setModal({ customer: t.customer, preset: { occasion: t.occasion, occasion_key: t.key, contact_id: t.contact.id, status: 'planned', gift_date: t.date } })}>Lên kế hoạch</button>
                <button class="link" onClick=${() => quickGift(t.customer, t.key, t.occasion, t.contact.id, 'skipped')}>Bỏ qua</button>`}
          </div>
        </div>`; })}</div>
      </div>`)}
    </section>

    <${Section} title="Lâu không liên hệ" count=${stale.length} hint=${`Không có tương tác từ ${settings.care_stale_days} ngày trở lên`} empty="Không có">
      ${stale.slice(0, 30).map((c) => html`<${CRow} c=${c} key=${c.id}><span class="stale">Liên hệ cuối ${U.daysSince(c.last_care_at)} ngày trước</span> <${TierPill} n=${U.countEvents(events, c.id)} settings=${settings} /><//>`)}
    <//>
    ${modal && html`<${GiftModal} ctx=${ctx} customer=${modal.customer} row=${modal.row} preset=${modal.preset} onClose=${() => setModal(null)} />`}
  </div>`;
}

// Khối nhắc trên trang "Hôm nay"
export function CareToday({ ctx, scope }) {
  const { customers, settings, user, events, go, openCustomer, people } = ctx;
  const cs = customers.filter((c) => scope === 'all' || c.owner_id === user.id);
  const due = cs.filter((c) => U.customerFlags(c, settings).due).sort((a, b) => a.next_care.localeCompare(b.next_care));
  return html`<${Section} title="Chăm sóc khách cũ" count=${due.length} tone="warn" hint=${html`<button class="link" onClick=${() => go('care')}>Mở trang Chăm sóc & Quà tặng →</button>`} empty="Không có khách đến hạn chăm sóc">
    ${due.slice(0, 10).map((c) => html`<div class="lrow" key=${c.id} onClick=${() => openCustomer(c.id)}>
      <div class="lrow-main"><b>${c.name}</b><div class="lrow-sub"><${TierPill} n=${U.countEvents(events, c.id)} settings=${settings} /> <span class="muted">${people[c.owner_id]?.full_name || 'Chưa giao'}</span></div></div>
      <div class="lrow-meta"><${CareBadge} c=${c} settings=${settings} /><small><${LastCare} c=${c} settings=${settings} /></small></div>
      <span />
    </div>`)}
  <//>`;
}
