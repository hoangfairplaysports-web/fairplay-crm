// 🎯 Tìm khách mới: doanh nghiệp tiềm năng, người liên hệ, chuỗi 14 ngày, mẫu tin nhắn, báo cáo phễu.
// Mỗi người chỉ xem số liệu của mình; Admin / Trưởng KD xem cả team.
import { html, useState, useEffect, useMemo } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import { Modal, Select, Section } from './ui.js';
import * as U from './util.js';
import {
  P_STATUS, P_SOURCES, TIERS, ROLE_LEVELS, CHANNELS, SEQUENCE, templatesOf, fillTpl, industryOf, isEnglish, defaultOwner,
  needContacts, findCompanyDup, planTouches, touchLabel, pendingTouch, weekRange, funnel, templateStats, parseProspectRows,
} from './prospect-core.js';

const today = () => U.todayStr();
const monthStr = (d = today()) => d.slice(0, 7);
const addMonths = (n, d = today()) => {
  const x = new Date(d.slice(0, 7) + '-01T00:00:00');
  x.setMonth(x.getMonth() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`;
};
const monthLabel = (d) => (d ? `${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const nowIso = () => new Date().toISOString();
const num = (n) => String(n ?? 0).replace('.', ',');

export function StatusPill({ s }) {
  const st = P_STATUS[s] || P_STATUS.new;
  return html`<span class=${'badge ' + st.cls}>${st.label}</span>`;
}
const TierPill = ({ t }) => (t ? html`<span class=${'tier-pill t' + t}>${t}</span>` : html`<span class="tier-pill">?</span>`);

// Dữ liệu dùng chung cho mục Tìm khách mới
function useP(ctx) {
  const prospects = ctx.customers.filter((c) => c.p_status);
  const touches = ctx.prospect_touches || [];
  return { prospects, touches, contactsOf: (id) => ctx.contacts.filter((k) => k.customer_id === id) };
}

// Ghi nhận hành động: cập nhật doanh nghiệp + ghi lịch sử
async function setStatus(ctx, c, status, extra = {}, note) {
  const patch = { p_status: status, ...extra };
  const t = nowIso();
  if (status === 'replied' && !c.replied_at) patch.replied_at = t;
  if (status === 'meeting') { patch.meeting_at = c.meeting_at || t; patch.replied_at = c.replied_at || t; }
  if (status === 'brief') { patch.brief_at = c.brief_at || t; patch.replied_at = c.replied_at || t; }
  const row = await ctx.saveRow('customers', c.id, patch);
  await ctx.store.addActivity({ customer_id: c.id, type: 'prospect', content: `Trạng thái: ${P_STATUS[status].label}${note ? ' - ' + note : ''}` });
  // Có phản hồi trở đi, hẹn lại, không phù hợp: dừng mọi chuỗi đang chạy của doanh nghiệp
  if (status !== 'touching' && status !== 'new') await stopSequences(ctx, c.id);
  return row;
}
async function stopSequences(ctx, customerId) {
  for (const k of ctx.contacts.filter((x) => x.customer_id === customerId && x.seq_status === 'running')) await ctx.saveRow('contacts', k.id, { seq_status: 'stopped' });
}

// Hết chuỗi mà chưa ai phản hồi → Hẹn lại sau 3 tháng (slide 20)
async function autoRecall(ctx, c) {
  const ks = ctx.contacts.filter((x) => x.customer_id === c.id);
  const running = ks.some((k) => k.seq_status === 'running');
  const open = (ctx.prospect_touches || []).some((t) => t.customer_id === c.id && pendingTouch(t));
  if (c.p_status === 'touching' && !running && !open && ks.some((k) => k.seq_status === 'done'))
    return setStatus(ctx, c, 'recall', { recall_month: addMonths(3) }, 'hết chuỗi 14 ngày không phản hồi, gọi lại sau 3 tháng');
  return c;
}

export async function markTouch(ctx, t, { note = '', skip = false } = {}) {
  const c = ctx.customers.find((x) => x.id === t.customer_id);
  const k = ctx.contacts.find((x) => x.id === t.contact_id);
  await ctx.saveRow('prospect_touches', t.id, skip ? { skipped: true, note: note || null } : { done_at: nowIso(), done_by: ctx.user.id, note: note || null });
  if (!skip) {
    const ch = CHANNELS[t.channel];
    await ctx.store.addActivity({ customer_id: t.customer_id, type: t.channel === 'call' ? 'call' : t.channel, content: `Lần chạm ${t.step}/5 · ${k?.name || ''} · ${ch?.label || ''} (mẫu ${t.template_key})${note ? '\n' + note : ''}` });
  }
  let cur = c;
  if (!skip && c && !c.first_touch_at) cur = await ctx.saveRow('customers', c.id, { first_touch_at: nowIso(), ...(c.p_status === 'new' ? { p_status: 'touching' } : {}) });
  const all = ctx.prospect_touches || [];
  const rest = all.filter((x) => x.contact_id === t.contact_id && x.id !== t.id && pendingTouch(x));
  if (k && !rest.length && k.seq_status === 'running') {
    // Hết chuỗi của người này; nếu cả doanh nghiệp không còn chuỗi nào và chưa ai trả lời → Hẹn lại sau 3 tháng
    const others = ctx.contacts.some((x) => x.customer_id === t.customer_id && x.id !== k.id && x.seq_status === 'running')
      || all.some((x) => x.customer_id === t.customer_id && x.contact_id !== k.id && pendingTouch(x));
    if (!others && cur && (cur.p_status === 'touching' || (c.p_status === 'new' && !skip)))
      cur = await setStatus(ctx, { ...c, ...cur }, 'recall', { recall_month: addMonths(3) }, 'hết chuỗi 14 ngày không phản hồi, gọi lại sau 3 tháng');
    await ctx.saveRow('contacts', k.id, { seq_status: 'done' });
  }
  return cur;
}

async function startSequence(ctx, c, k) {
  if (c.do_not_contact || k.do_not_contact) throw new Error('Đã đánh dấu Không liên hệ');
  for (const t of (ctx.prospect_touches || []).filter((x) => x.contact_id === k.id && pendingTouch(x))) await ctx.removeRow('prospect_touches', t.id);
  for (const t of planTouches({ customer: c, contact: k, english: isEnglish(ctx.settings, c) })) await ctx.saveRow('prospect_touches', null, t);
  await ctx.saveRow('contacts', k.id, { seq_started_at: nowIso(), seq_status: 'running' });
  if (c.p_status === 'new' || c.p_status === 'recall') await ctx.saveRow('customers', c.id, { p_status: 'touching' });
  await ctx.store.addActivity({ customer_id: c.id, type: 'prospect', content: `Bắt đầu chuỗi 14 ngày với ${k.name}` });
}

// ---------------------------------------------------------------------------
// Trang chính
// ---------------------------------------------------------------------------
export function ProspectView({ ctx }) {
  const { user, isMgr, profiles, people, settings } = ctx;
  const { prospects, touches } = useP(ctx);
  const [tab, setTab] = useState('today');
  const [who, setWho] = useState(isMgr ? '' : user.id);
  const [openId, setOpenId] = useState(ctx.listPreset?.open || null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    for (const c of prospects) if (c.p_status === 'touching') autoRecall(ctx, c).catch(() => {});
  }, []);
  const open = prospects.find((c) => c.id === openId) || (openId && ctx.customers.find((c) => c.id === openId));
  const owners = [...new Set([...(settings.industries || []).flatMap((i) => i.owners || []), ...prospects.map((c) => c.owner_id)])].filter((id) => people[id]);
  const TABS = [['today', 'Việc hôm nay'], ['list', 'Danh sách doanh nghiệp'], ['report', 'Báo cáo'], ['templates', 'Mẫu tin nhắn'], ...(ctx.isAdmin ? [['setup', 'Cài đặt']] : [])];
  return html`<div class="page wide">
    <div class="page-head">
      <div><h1>🎯 Tìm khách mới</h1><div class="muted">Chọn ngành → lập hồ sơ → tìm 2-3 người → chạm 5 lần trong 14 ngày → hẹn và chuyển.</div></div>
      <div class="row">
        ${isMgr && html`<select value=${who} onChange=${(e) => setWho(e.target.value)}><option value="">Cả team</option>${owners.map((id) => html`<option value=${id}>${people[id].full_name}</option>`)}</select>`}
        <button class="btn primary" onClick=${() => setAdding(true)}>＋ Thêm doanh nghiệp</button>
        ${isMgr && html`<button class="btn" onClick=${() => setImporting(true)}>⬆ Nhập Excel</button>`}
      </div>
    </div>
    <${WeekStrip} ctx=${ctx} who=${who} />
    <div class="seg" style="margin-bottom:14px">${TABS.map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${l}</button>`)}</div>
    ${tab === 'today' && html`<${TodayList} ctx=${ctx} who=${who} onOpen=${setOpenId} />`}
    ${tab === 'list' && html`<${CompanyList} ctx=${ctx} who=${who} onOpen=${setOpenId} />`}
    ${tab === 'report' && html`<${FunnelReport} ctx=${ctx} who=${who} />`}
    ${tab === 'templates' && html`<${TemplateLib} ctx=${ctx} />`}
    ${tab === 'setup' && ctx.isAdmin && html`<${ProspectSetup} ctx=${ctx} />`}
    ${open && html`<${ProspectDrawer} ctx=${ctx} c=${open} onClose=${() => setOpenId(null)} key=${open.id} />`}
    ${adding && html`<${CompanyModal} ctx=${ctx} onClose=${() => setAdding(false)} onSaved=${(c) => setOpenId(c.id)} />`}
    ${importing && html`<${ImportModal} ctx=${ctx} onClose=${() => setImporting(false)} />`}
  </div>`;
}

// Số tuần này so với chỉ tiêu (của mình; quản lý xem theo người đã chọn hoặc cả team)
function WeekStrip({ ctx, who }) {
  const { prospects, touches } = useP(ctx);
  const [from, to] = weekRange();
  const pool = prospects.concat(ctx.customers.filter((c) => !c.p_status && c.first_touch_at));
  const mine = (c) => !who || c.owner_id === who;
  const f = funnel({ customers: pool.filter(mine), contacts: ctx.contacts, touches }, from, to, () => 'x').x || {};
  const tg = who ? ctx.settings.prospect_targets?.[who] || {} : Object.values(ctx.settings.prospect_targets || {}).reduce((a, t) => ({ companies: (a.companies || 0) + (Number(t.companies) || 0), meetings: (a.meetings || 0) + (Number(t.meetings) || 0) }), {});
  const overdue = touches.filter((t) => pendingTouch(t) && t.due_date < today() && mine(ctx.customers.find((c) => c.id === t.customer_id) || {})).length;
  const cell = (v, l, target, cls = '') => html`<div class=${'kpi ' + cls}><b>${v ?? 0}${target ? html`<small class="muted"> / ${num(target)}</small>` : ''}</b><span>${l}</span></div>`;
  return html`<div class="kpis">
    ${cell(f.companies, 'Doanh nghiệp mới vào chuỗi (tuần này)', tg.companies, tg.companies && (f.companies || 0) >= tg.companies ? 'good' : 'info')}
    ${cell(f.sequences, 'Người vào chuỗi')}
    ${cell(f.touches, 'Lần chạm đã gửi')}
    ${cell(f.replies, 'Có phản hồi')}
    ${cell(f.meetings, 'Cuộc hẹn', tg.meetings, tg.meetings && (f.meetings || 0) >= tg.meetings ? 'good' : '')}
    ${cell(f.briefs, 'Có brief')}
    ${cell(overdue, 'Lần chạm quá hạn', null, overdue ? 'bad' : '')}
  </div>`;
}

// ---------------------------------------------------------------------------
// Việc hôm nay: lần chạm đến hạn, hẹn lại đến tháng, doanh nghiệp chưa đủ người
// ---------------------------------------------------------------------------
export function TodayList({ ctx, who, onOpen, compact }) {
  const { prospects, touches } = useP(ctx);
  const [copy, setCopy] = useState(null);
  const [done, setDone] = useState(null);
  const mine = (c) => c && (!who || c.owner_id === who);
  const byId = Object.fromEntries(ctx.customers.map((c) => [c.id, c]));
  const kById = Object.fromEntries(ctx.contacts.map((k) => [k.id, k]));
  const due = touches.filter((t) => pendingTouch(t) && t.due_date <= today() && mine(byId[t.customer_id]) && kById[t.contact_id]?.seq_status === 'running')
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.step - b.step);
  const recall = prospects.filter((c) => mine(c) && c.p_status === 'recall' && c.recall_month && c.recall_month.slice(0, 7) <= monthStr());
  const needPeople = prospects.filter((c) => mine(c) && ['new', 'touching'].includes(c.p_status) && c.tier !== 'C' && !c.do_not_contact
    && ctx.contacts.filter((k) => k.customer_id === c.id).length < needContacts(c));
  const noTier = prospects.filter((c) => mine(c) && c.p_status === 'new' && !c.tier);
  const row = (t) => {
    const c = byId[t.customer_id];
    const k = kById[t.contact_id];
    const late = t.due_date < today();
    return html`<div class="mini" key=${t.id}>
      <div class="mini-main click" onClick=${() => onOpen(c.id)}>
        <b>${CHANNELS[t.channel]?.icon} Lần ${t.step}/5 · ${k?.name}</b> <span class="muted small">${k?.title || ''} · ${c.name}</span>
        <div class="small ${late ? 'stale' : 'muted'}">${touchLabel(t)} · mẫu ${t.template_key} · ${late ? 'quá hạn từ ' + U.fmtDate(t.due_date) : 'hôm nay'}${!compact ? ' · ' + (ctx.people[c.owner_id]?.full_name || '') : ''}</div>
      </div>
      <button class="btn sm" onClick=${() => setCopy({ t, c, k })}>📋 Mẫu ${t.template_key}</button>
      <button class="btn sm primary" onClick=${() => setDone({ t, c, k })}>✓ Đã chạm</button>
    </div>`;
  };
  return html`<div>
    <${Section} title="Lần chạm đến hạn" count=${due.length} tone=${due.some((t) => t.due_date < today()) ? 'bad' : 'warn'} empty="Không có lần chạm nào đến hạn 🎉">
      <div class="minilist">${(compact ? due.slice(0, 8) : due).map(row)}</div>
    <//>
    ${!compact && html`
      <${Section} title="Hẹn lại đến tháng" count=${recall.length} hint="Gọi lại hỏi kế hoạch, hoặc bắt đầu chuỗi mới" empty="Không có">
        <div class="minilist">${recall.map((c) => html`<div class="mini click" key=${c.id} onClick=${() => onOpen(c.id)}><div class="mini-main"><b>${c.name}</b> <span class="muted small">hẹn lại ${monthLabel(c.recall_month)}</span></div><${StatusPill} s=${c.p_status} /></div>`)}</div>
      <//>
      <${Section} title="Cần tìm thêm người liên hệ" count=${needPeople.length} hint="Mức A cần 3 người, mức B cần 2 người" empty="Đủ người">
        <div class="minilist">${needPeople.slice(0, 20).map((c) => html`<div class="mini click" key=${c.id} onClick=${() => onOpen(c.id)}><div class="mini-main"><${TierPill} t=${c.tier} /> <b>${c.name}</b> <span class="muted small">${c.industry || ''} · có ${ctx.contacts.filter((k) => k.customer_id === c.id).length}/${needContacts(c)} người</span></div></div>`)}</div>
      <//>
      ${noTier.length > 0 && html`<${Section} title="Chưa gắn mức A/B/C" count=${noTier.length} hint="Lọc trùng, kiểm tra văn phòng miền Bắc, gắn mức trước khi tiếp cận">
        <div class="minilist">${noTier.slice(0, 20).map((c) => html`<div class="mini click" key=${c.id} onClick=${() => onOpen(c.id)}><div class="mini-main"><b>${c.name}</b> <span class="muted small">${c.industry || ''}</span></div></div>`)}</div>
      <//>`}
    `}
    ${copy && html`<${CopyModal} ctx=${ctx} ...${copy} onClose=${() => setCopy(null)} />`}
    ${done && html`<${DoneModal} ctx=${ctx} ...${done} onClose=${() => setDone(null)} />`}
  </div>`;
}

// ---------------------------------------------------------------------------
// Danh sách doanh nghiệp
// ---------------------------------------------------------------------------
function CompanyList({ ctx, who, onOpen }) {
  const { prospects, touches } = useP(ctx);
  const [q, setQ] = useState('');
  const [ind, setInd] = useState('');
  const [tier, setTier] = useState('');
  const [st, setSt] = useState('');
  const rows = useMemo(() => {
    const f = U.fold(q);
    return prospects.filter((c) => (!who || c.owner_id === who) && (!ind || c.industry === ind) && (!tier || (tier === '-' ? !c.tier : c.tier === tier)) && (!st || c.p_status === st)
      && (!f || U.fold(c.name + ' ' + (c.notes || '')).includes(f)))
      .map((c) => {
        const ts = touches.filter((t) => t.customer_id === c.id);
        const next = ts.filter(pendingTouch).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
        const last = ts.filter((t) => t.done_at).sort((a, b) => b.done_at.localeCompare(a.done_at))[0];
        return { c, n: ctx.contacts.filter((k) => k.customer_id === c.id).length, next, last, steps: ts.filter((t) => t.done_at).length };
      })
      .sort((a, b) => (a.next?.due_date || '9').localeCompare(b.next?.due_date || '9') || a.c.name.localeCompare(b.c.name));
  }, [prospects, touches, ctx.contacts, q, ind, tier, st, who]);
  return html`<div>
    <div class="filters">
      <input type="search" placeholder="Tìm doanh nghiệp…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <select value=${ind} onChange=${(e) => setInd(e.target.value)}><option value="">Mọi ngành</option>${(ctx.settings.industries || []).map((i) => html`<option value=${i.name}>${i.name}</option>`)}</select>
      <select value=${tier} onChange=${(e) => setTier(e.target.value)}><option value="">Mọi mức</option><option value="A">Mức A</option><option value="B">Mức B</option><option value="C">Mức C</option><option value="-">Chưa gắn mức</option></select>
      <select value=${st} onChange=${(e) => setSt(e.target.value)}><option value="">Mọi trạng thái</option>${Object.entries(P_STATUS).map(([k, s]) => html`<option value=${k}>${s.label}</option>`)}</select>
      <span class="muted small">${rows.length} doanh nghiệp</span>
    </div>
    <div class="table-wrap"><table class="table compact">
      <thead><tr><th>Doanh nghiệp</th><th>Người liên hệ</th><th>Trạng thái</th><th>Lần chạm gần nhất</th><th>Việc tiếp theo</th><th>Phụ trách</th></tr></thead>
      <tbody>${rows.map(({ c, n, next, last, steps }) => html`<tr class="click" key=${c.id} onClick=${() => onOpen(c.id)}>
        <td><${TierPill} t=${c.tier} /> <b>${c.name}</b>${c.do_not_contact && html` <span class="badge bad">Không liên hệ</span>`}<div class="muted small">${[c.industry, c.staff_size && c.staff_size + ' NS'].filter(Boolean).join(' · ')}</div></td>
        <td class=${n < needContacts(c) && c.tier !== 'C' ? 'stale' : ''}>${n}/${needContacts(c)}</td>
        <td><${StatusPill} s=${c.p_status} />${c.p_status === 'touching' && html` <span class="muted small">${steps} lần</span>`}${c.p_status === 'recall' && c.recall_month && html` <span class="muted small">${monthLabel(c.recall_month)}</span>`}</td>
        <td class="small">${last ? `${CHANNELS[last.channel]?.icon} ${U.fmtDate(last.done_at)}` : '-'}</td>
        <td class="small ${next && next.due_date < today() ? 'stale' : ''}">${next ? `Lần ${next.step} · ${U.fmtDate(next.due_date)}` : '-'}</td>
        <td class="small">${ctx.people[c.owner_id]?.full_name || '-'}</td>
      </tr>`)}</tbody>
    </table></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Chi tiết 1 doanh nghiệp
// ---------------------------------------------------------------------------
function ProspectDrawer({ ctx, c, onClose }) {
  const { settings, people, isMgr, user, saveRow, notify, store } = ctx;
  const { touches, contactsOf } = useP(ctx);
  const [acts, setActs] = useState(null);
  const [modal, setModal] = useState(null);
  const ks = contactsOf(c.id).sort((a, b) => (a.role_level || 9) - (b.role_level || 9));
  const canEdit = isMgr || c.owner_id === user.id;
  useEffect(() => {
    store.listActivities({ customer_id: c.id }).then(setActs, () => setActs([]));
  }, [c.id, c.updated_at, touches.length]);
  const save = async (patch, msg) => {
    try {
      await saveRow('customers', c.id, patch);
      if (msg) notify(msg);
    } catch (e) {
      notify(e.message, 'err');
    }
  };
  const act = async (fn) => {
    try {
      await fn();
    } catch (e) {
      notify(e.message, 'err');
    }
  };
  const ind = industryOf(settings, c.industry);
  const suggested = ind?.owners?.length && !ind.owners.includes(c.owner_id) ? ind.owners[0] : null;
  const ownerOpts = [...new Set([...(settings.industries || []).flatMap((i) => i.owners || []), c.owner_id])].filter((id) => people[id]);
  return html`<div class="drawer-overlay" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
    <aside class="drawer wide-drawer" role="dialog" aria-label=${c.name}>
      <div class="drawer-head">
        <div>
          <h2><${TierPill} t=${c.tier} /> ${c.name}</h2>
          <div class="muted">${[c.industry, c.staff_size && c.staff_size + ' nhân sự', c.region].filter(Boolean).join(' · ')}</div>
          <div class="row" style="margin-top:6px"><${StatusPill} s=${c.p_status} /> <span class="muted small">Phụ trách: ${people[c.owner_id]?.full_name || 'chưa giao'}</span>
            ${c.do_not_contact && html`<span class="badge bad">Không liên hệ</span>`}</div>
        </div>
        <button class="x" onClick=${onClose} aria-label="Đóng">×</button>
      </div>
      <div class="drawer-body">
        ${!canEdit && html`<p class="note">Doanh nghiệp này do ${people[c.owner_id]?.full_name || 'người khác'} phụ trách. Bạn chỉ xem.</p>`}
        ${canEdit && suggested && html`<div class="suggest">Ngành "${c.industry}" do <b>${people[suggested]?.full_name}</b> phụ trách.
          <button class="btn sm" onClick=${() => act(async () => { await saveRow('customers', c.id, { owner_id: suggested }); await store.addActivity({ customer_id: c.id, type: 'assign', content: `Chuyển cho ${people[suggested]?.full_name} (phụ trách ngành)` }); notify('Đã chuyển'); onClose(); })}>Chuyển cho ${people[suggested]?.full_name}</button></div>`}

        ${canEdit && html`<div class="status-actions">
          <span class="muted small">Cập nhật trạng thái:</span>
          ${['replied', 'meeting', 'brief'].map((s) => html`<button class=${'btn sm' + (c.p_status === s ? ' on' : '')} onClick=${() => setModal({ t: 'status', s })}>${P_STATUS[s].label}</button>`)}
          <button class="btn sm" onClick=${() => setModal({ t: 'status', s: 'recall' })}>Hẹn lại</button>
          <button class="btn sm" onClick=${() => setModal({ t: 'status', s: 'unfit' })}>Không phù hợp</button>
          ${['replied', 'meeting', 'brief', 'recall', 'unfit'].includes(c.p_status) && html`<button class="link small" onClick=${() => act(() => setStatus(ctx, c, ctx.contacts.some((k) => k.customer_id === c.id && k.seq_started_at) ? 'touching' : 'new', {}, 'mở lại'))}>Mở lại</button>`}
        </div>`}
        ${c.p_status === 'brief' && html`<div class="suggest">📝 Đã có brief. Tạo lead để chuyển sang Pipeline (báo giá, chốt).
          <button class="btn sm primary" onClick=${() => ctx.startNewLead({ customer_id: c.id, company: c.name, customer_type: 'Doanh nghiệp', region: c.region || '', source: 'Tìm khách mới', name: ks.find((k) => k.replied_at)?.name || ks[0]?.name || '', phone: ks[0]?.phone || '', email: ks.find((k) => k.replied_at)?.email || ks[0]?.email || '' })}>＋ Tạo lead</button></div>`}
        ${c.p_status === 'recall' && html`<p class="muted small">Hẹn lại tháng <b>${monthLabel(c.recall_month)}</b>.</p>`}
        ${c.p_status === 'unfit' && c.unfit_reason && html`<p class="muted small">Lý do không phù hợp: ${c.unfit_reason}</p>`}

        <div class="section-head"><h3>Người liên hệ (${ks.length}/${needContacts(c)})</h3>${canEdit && html`<button class="link" onClick=${() => setModal({ t: 'contact' })}>＋ Thêm người</button>`}</div>
        ${ks.length === 0 ? html`<div class="empty">Chưa có người liên hệ. Tìm 2-3 người theo 3 vai trò trên LinkedIn.</div>`
          : ks.map((k) => html`<${ContactCard} ctx=${ctx} c=${c} k=${k} canEdit=${canEdit} onEdit=${() => setModal({ t: 'contact', row: k })} key=${k.id} />`)}

        <div class="section-head"><h3>Hồ sơ doanh nghiệp</h3>${canEdit && html`<button class="link" onClick=${() => setModal({ t: 'company' })}>✎ Sửa</button>`}</div>
        <dl class="infolist">
          <dt>Ngành · mức</dt><dd>${c.industry || '-'} · ${c.tier ? 'Mức ' + c.tier : 'chưa gắn mức'}</dd>
          <dt>Quy mô</dt><dd>${c.staff_size ? c.staff_size + ' nhân sự' : '-'}${c.north_office === false ? ' · không có văn phòng miền Bắc' : c.north_office ? ' · có văn phòng miền Bắc' : ''}</dd>
          <dt>Website</dt><dd>${c.website ? html`<a href=${/^https?:/.test(c.website) ? c.website : 'https://' + c.website} target="_blank" rel="noopener">${c.website}</a>` : '-'}${c.linkedin ? html` · <a href=${c.linkedin} target="_blank" rel="noopener">LinkedIn</a>` : ''}</dd>
          <dt>Nguồn</dt><dd>${c.p_source || '-'}</dd>
          <dt>Dấu hiệu</dt><dd>${c.signal ? `${c.signal}${c.signal_date ? ' (' + U.fmtDate(c.signal_date) + ')' : ''}` : '-'}</dd>
          <dt>Hay làm sự kiện</dt><dd>${c.event_season || '-'}${c.budget_month ? ' · chốt ngân sách: ' + c.budget_month : ''}</dd>
          ${c.notes && html`<dt>Ghi chú</dt><dd class="pre">${c.notes}</dd>`}
          <dt>Chuyển phụ trách</dt><dd>${canEdit ? html`<select value=${c.owner_id || ''} onChange=${(e) => e.target.value && act(async () => { await saveRow('customers', c.id, { owner_id: e.target.value }); await store.addActivity({ customer_id: c.id, type: 'assign', content: `Chuyển cho ${people[e.target.value]?.full_name}` }); notify('Đã chuyển'); })}>${ownerOpts.map((id) => html`<option value=${id}>${people[id].full_name}</option>`)}</select>` : people[c.owner_id]?.full_name || '-'}</dd>
          <dt>Không liên hệ</dt><dd><label class="inline-check"><input type="checkbox" disabled=${!canEdit} checked=${!!c.do_not_contact} onChange=${(e) => act(async () => { await save({ do_not_contact: e.target.checked }); if (e.target.checked) { await stopSequences(ctx, c.id); await store.addActivity({ customer_id: c.id, type: 'prospect', content: 'Khách không muốn nhận tin: dừng mọi liên hệ' }); } })} /> Khách không muốn nhận tin (dừng ngay mọi chuỗi)</label></dd>
        </dl>

        <div class="section-head"><h3>Lịch sử</h3></div>
        ${acts === null ? html`<div class="muted">Đang tải…</div>` : acts.length === 0 ? html`<div class="empty">Chưa có</div>` : html`<ol class="timeline">
          ${acts.map((a) => { const t = U.activityType(a.type); return html`<li key=${a.id}><span class="t-ic">${t.icon}</span>
            <div><div class="t-head"><b>${t.label}</b><span class="muted small">${people[a.created_by]?.full_name || ''} · ${U.fmtDateTime(a.created_at)}</span></div>
            ${a.content && html`<div class="pre">${a.content}</div>`}</div></li>`; })}
        </ol>`}
        ${isMgr && html`<div class="danger-zone"><button class="link danger" onClick=${async () => { if (confirm(`Xoá doanh nghiệp "${c.name}" khỏi danh sách tìm khách (cả người liên hệ và lịch sử)?`)) { try { await ctx.removeRow('customers', c.id); onClose(); notify('Đã xoá'); } catch (e) { notify(e.message, 'err'); } } }}>Xoá doanh nghiệp</button></div>`}
      </div>
    </aside>
    ${modal?.t === 'contact' && html`<${ContactModal} ctx=${ctx} c=${c} row=${modal.row} onClose=${() => setModal(null)} />`}
    ${modal?.t === 'company' && html`<${CompanyModal} ctx=${ctx} row=${c} onClose=${() => setModal(null)} />`}
    ${modal?.t === 'status' && html`<${StatusModal} ctx=${ctx} c=${c} s=${modal.s} onClose=${() => setModal(null)} />`}
  </div>`;
}

function ContactCard({ ctx, c, k, canEdit, onEdit }) {
  const ts = (ctx.prospect_touches || []).filter((t) => t.contact_id === k.id).sort((a, b) => a.step - b.step);
  const [copy, setCopy] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const next = ts.find(pendingTouch);
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      ctx.notify(e.message, 'err');
    }
    setBusy(false);
  };
  const t0 = today();
  return html`<div class="card-sec pcontact">
    <div class="row between">
      <div class="click" onClick=${canEdit ? onEdit : null}>
        <b>${k.name}</b> <span class="muted small">${k.title || ''}</span>
        ${k.role_level && html` <span class="badge">${k.role_level}. ${ROLE_LEVELS[k.role_level].label}</span>`}
        ${k.replied_at && html` <span class="badge ok">Đã phản hồi</span>`}
        ${k.do_not_contact && html` <span class="badge bad">Không liên hệ</span>`}
        <div class="muted small">${[k.email, k.phone, k.info_source && 'nguồn: ' + k.info_source].filter(Boolean).join(' · ')}
          ${k.linkedin && html` · <a href=${k.linkedin} target="_blank" rel="noopener" onClick=${(e) => e.stopPropagation()}>LinkedIn</a>`}${k.li_connected ? ' ✓ đã kết nối' : ''}</div>
      </div>
      ${canEdit && html`<div class="row">
        ${!k.seq_status && !k.do_not_contact && !c.do_not_contact && html`<button class="btn sm primary" disabled=${busy} onClick=${() => run(() => startSequence(ctx, c, k).then(() => ctx.notify('Đã lên lịch 5 lần chạm trong 14 ngày')))}>▶ Bắt đầu chuỗi 14 ngày</button>`}
        ${k.seq_status === 'running' && html`<button class="btn sm" disabled=${busy} onClick=${() => run(async () => { await ctx.saveRow('contacts', k.id, { replied_at: new Date().toISOString(), seq_status: 'stopped' }); await setStatus(ctx, c, ['meeting', 'brief'].includes(c.p_status) ? c.p_status : 'replied', {}, k.name + ' trả lời'); ctx.notify('Đã dừng chuỗi, chuyển sang đặt hẹn'); })}>💬 Khách trả lời</button>`}
        ${['stopped', 'done'].includes(k.seq_status) && !k.do_not_contact && html`<button class="link small" disabled=${busy} onClick=${() => run(() => startSequence(ctx, c, k).then(() => ctx.notify('Đã bắt đầu chuỗi mới')))}>Bắt đầu chuỗi mới</button>`}
      </div>`}
    </div>
    ${ts.length > 0 && html`<ol class="seq">${ts.map((t) => {
      const late = pendingTouch(t) && t.due_date < t0;
      const cls = t.done_at ? 'done' : t.skipped ? 'skip' : late ? 'late' : t === next ? 'next' : '';
      return html`<li class=${cls} key=${t.id}>
        <span class="seq-n">${t.done_at ? '✓' : t.skipped ? '–' : t.step}</span>
        <div class="seq-b"><b>Ngày ${t.day_no} · ${CHANNELS[t.channel]?.icon} ${CHANNELS[t.channel]?.label}</b> <span class="muted small">${touchLabel(t)} · mẫu ${t.template_key}</span>
          <div class="small ${late ? 'stale' : 'muted'}">${t.done_at ? `Đã chạm ${U.fmtDate(t.done_at)} · ${ctx.people[t.done_by]?.full_name || ''}` : t.skipped ? 'Bỏ qua' : `Hạn ${U.fmtDate(t.due_date)}${late ? ' (quá hạn)' : ''}`}${t.note ? ' · ' + t.note : ''}</div></div>
        ${canEdit && pendingTouch(t) && k.seq_status === 'running' && html`<div class="row">
          <button class="btn sm" onClick=${() => setCopy({ t, c, k })}>📋 Mẫu</button>
          <button class="btn sm primary" onClick=${() => setDone({ t, c, k })}>✓ Đã chạm</button>
        </div>`}
      </li>`;
    })}</ol>`}
    ${copy && html`<${CopyModal} ctx=${ctx} ...${copy} onClose=${() => setCopy(null)} />`}
    ${done && html`<${DoneModal} ctx=${ctx} ...${done} onClose=${() => setDone(null)} />`}
  </div>`;
}

// Mẫu tin nhắn đã điền sẵn, sửa rồi copy
function CopyModal({ ctx, t, c, k, onClose }) {
  const tpls = templatesOf(ctx.settings);
  const [key, setKey] = useState(t?.template_key || 'A');
  const [lang, setLang] = useState(isEnglish(ctx.settings, c) ? 'en' : 'vi');
  const tp = tpls.find((x) => x.key === key) || tpls[0];
  const raw = tp[lang] || tp.vi || tp.en || '';
  const [text, setText] = useState(fillTpl(raw, { contact: k, company: c, me: ctx.user }));
  useEffect(() => setText(fillTpl(tp[lang] || tp.vi || tp.en || '', { contact: k, company: c, me: ctx.user })), [key, lang]);
  const left = (text.match(/\[[^\]]+\]/g) || []).length;
  return html`<${Modal} title=${`Mẫu ${tp.key}: ${tp.title}`} onClose=${onClose} wide>
    <div class="form">
      <div class="row">
        <select value=${key} onChange=${(e) => setKey(e.target.value)}>${tpls.map((x) => html`<option value=${x.key}>Mẫu ${x.key}. ${x.title}</option>`)}</select>
        <div class="seg"><button class=${lang === 'vi' ? 'on' : ''} disabled=${!tp.vi} onClick=${() => setLang('vi')}>Tiếng Việt</button><button class=${lang === 'en' ? 'on' : ''} disabled=${!tp.en} onClick=${() => setLang('en')}>English</button></div>
      </div>
      <textarea rows="12" value=${text} onInput=${(e) => setText(e.target.value)} />
      ${left > 0 && html`<p class="note">Còn ${left} chỗ [ngoặc vuông] cần tự thay, nhất là câu riêng cho công ty này. Không bán ở tin đầu tiên.</p>`}
      <div class="row end">
        <button class="btn" onClick=${onClose}>Đóng</button>
        <button class="btn primary" onClick=${async () => { try { await navigator.clipboard.writeText(text); ctx.notify('Đã copy, dán vào LinkedIn / email để gửi'); } catch { ctx.notify('Không copy được, hãy bôi đen và copy tay', 'err'); } }}>📋 Copy</button>
      </div>
    </div>
  <//>`;
}

// Ghi nhận đã chạm (hoặc bỏ qua)
function DoneModal({ ctx, t, c, k, onClose }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (skip) => {
    setBusy(true);
    try {
      await markTouch(ctx, t, { note, skip });
      ctx.notify(skip ? 'Đã bỏ qua lần chạm' : `Đã ghi lần chạm ${t.step}/5`);
      onClose();
    } catch (e) {
      ctx.notify(e.message, 'err');
    }
    setBusy(false);
  };
  return html`<${Modal} title=${`Lần chạm ${t.step}/5 · ${k?.name}`} onClose=${onClose}>
    <div class="form">
      <p class="muted">${CHANNELS[t.channel]?.icon} ${touchLabel(t)} (mẫu ${t.template_key}) · ${c.name}</p>
      <label>Ghi chú (khách nói gì, đã gửi tài liệu gì…)<textarea rows="3" value=${note} onInput=${(e) => setNote(e.target.value)} /></label>
      <p class="muted small">Khách đã trả lời? Đóng cửa sổ này và bấm "💬 Khách trả lời" ở thẻ người liên hệ để dừng chuỗi.</p>
      <div class="row end">
        <button class="link" disabled=${busy} onClick=${() => go(true)}>Bỏ qua lần này</button>
        <button class="btn primary" disabled=${busy} onClick=${() => go(false)}>✓ Đã chạm</button>
      </div>
    </div>
  <//>`;
}

function StatusModal({ ctx, c, s, onClose }) {
  const [note, setNote] = useState('');
  const [month, setMonth] = useState(addMonths(3).slice(0, 7));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const REASONS = ['Quy mô quá nhỏ', 'Không có văn phòng miền Bắc', 'Đã có đơn vị cố định', 'Không có nhu cầu thể thao', 'Khác'];
  async function save() {
    setBusy(true);
    try {
      if (s === 'unfit' && !reason) throw new Error('Chọn lý do');
      const extra = s === 'recall' ? { recall_month: month + '-01' } : s === 'unfit' ? { unfit_reason: [reason, note].filter(Boolean).join(': ') } : {};
      await setStatus(ctx, c, s, extra, s === 'recall' ? `gọi lại tháng ${month.slice(5)}/${month.slice(0, 4)}${note ? ', ' + note : ''}` : s === 'unfit' ? reason : note);
      ctx.notify('Đã cập nhật: ' + P_STATUS[s].label);
      onClose();
    } catch (e) {
      ctx.notify(e.message, 'err');
    }
    setBusy(false);
  }
  return html`<${Modal} title=${P_STATUS[s].label + ' · ' + c.name} onClose=${onClose}>
    <div class="form">
      ${s === 'recall' && html`<label>Gọi lại vào tháng<input type="month" value=${month} onInput=${(e) => setMonth(e.target.value)} /></label>
        <p class="muted small">Khách "chưa có ngân sách": hỏi tháng chốt ngân sách và hẹn đúng tháng đó.</p>`}
      ${s === 'unfit' && html`<label>Lý do *<${Select} value=${reason} onChange=${setReason} placeholder="Chọn lý do" options=${REASONS} /></label>`}
      ${s === 'meeting' && html`<p class="muted small">Ghi ngày giờ hẹn, ai tham gia. Khách mức A: mời Hoàng hoặc Minh vào cùng.</p>`}
      ${s === 'brief' && html`<p class="muted small">Sau khi lưu, bấm "＋ Tạo lead" để chuyển sang Pipeline và làm báo giá.</p>`}
      <label>Ghi chú<textarea rows="3" value=${note} onInput=${(e) => setNote(e.target.value)} placeholder=${s === 'meeting' ? 'VD: 15h thứ 5 (24/10), gọi Google Meet với chị Lan - HR' : ''} /></label>
      <p class="muted small">Mọi chuỗi đang chạy của doanh nghiệp này sẽ dừng.</p>
      <div class="row end"><button class="btn" onClick=${onClose}>Huỷ</button><button class="btn primary" disabled=${busy} onClick=${save}>Lưu</button></div>
    </div>
  <//>`;
}

// ---------------------------------------------------------------------------
// Thêm / sửa doanh nghiệp, người liên hệ
// ---------------------------------------------------------------------------
function CompanyModal({ ctx, row, onClose, onSaved }) {
  const { settings, isMgr, user, people, saveRow, notify, store } = ctx;
  const [d, setD] = useState({ name: '', industry: '', tier: '', staff_size: '', website: '', linkedin: '', north_office: true, region: 'Hà Nội', p_source: 'Danh sách', signal: '', signal_date: '', event_season: '', budget_month: '', notes: '', owner_id: '', ...row });
  const set = (k) => (e) => {
    const v = e && e.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setD((x) => ({ ...x, [k]: v }));
  };
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const dups = (d.name || d.website) ? findCompanyDup(ctx.customers, d, row?.id) : [];
  const owner = d.owner_id || (row ? row.owner_id : defaultOwner(settings, d.industry) || user.id);
  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!d.name.trim()) return setErr('Nhập tên doanh nghiệp');
    if (!row && dups.length) return setErr('Doanh nghiệp này đã có trong CRM, mở bản đã có thay vì tạo mới');
    setBusy(true);
    try {
      const { id, created_at, updated_at, ...data } = d;
      const payload = { ...data, name: d.name.trim(), tier: d.tier || null, signal_date: d.signal_date || null, staff_size: d.staff_size || null };
      if (!row) Object.assign(payload, { customer_type: 'Doanh nghiệp', p_status: 'new', p_added_at: new Date().toISOString(), last_care_at: new Date().toISOString(), owner_id: owner });
      let c = await saveRow('customers', row?.id, payload);
      if (!row) {
        await store.addActivity({ customer_id: c.id, type: 'prospect', content: `Thêm vào danh sách tìm khách (nguồn: ${d.p_source || '-'})` });
        // Người thường tạo thì CRM gán cho chính họ; nếu ngành do người khác phụ trách thì chuyển luôn
        if (!isMgr && owner !== user.id && c.owner_id === user.id) c = await saveRow('customers', c.id, { owner_id: owner });
      }
      notify(row ? 'Đã lưu' : `Đã thêm, phụ trách: ${people[c.owner_id]?.full_name || '-'}`);
      onClose();
      onSaved && onSaved(c);
    } catch (x) {
      setErr(x.message);
    }
    setBusy(false);
  }
  return html`<${Modal} title=${row ? 'Sửa hồ sơ doanh nghiệp' : 'Thêm doanh nghiệp tiềm năng'} onClose=${onClose} wide>
    <form class="form" onSubmit=${submit}>
      <div class="grid2">
        <label>Tên doanh nghiệp *<input value=${d.name} onInput=${set('name')} autofocus /></label>
        <label>Website<input value=${d.website || ''} onInput=${set('website')} placeholder="vd: sotatek.com" /></label>
      </div>
      ${dups.length > 0 && html`<div class="dupwarn">⚠ Đã có trong CRM: ${dups.map((x) => html`<b>${x.name}</b> (${x.p_status ? 'tiềm năng, ' + P_STATUS[x.p_status].label : 'khách hàng'}, phụ trách ${people[x.owner_id]?.full_name || 'chưa giao'}) `)}</div>`}
      <div class="grid3">
        <label>Ngành<select value=${d.industry || ''} onChange=${set('industry')}><option value="">- Chọn ngành -</option>${(settings.industries || []).map((i) => html`<option value=${i.name}>${i.name}</option>`)}${d.industry && !industryOf(settings, d.industry) ? html`<option value=${d.industry}>${d.industry}</option>` : ''}</select></label>
        <label>Mức<select value=${d.tier || ''} onChange=${set('tier')}><option value="">Chưa gắn</option>${Object.keys(TIERS).map((t) => html`<option value=${t}>Mức ${t}</option>`)}</select></label>
        <label>Quy mô (nhân sự)<input type="number" value=${d.staff_size || ''} onInput=${set('staff_size')} /></label>
        <label>LinkedIn công ty<input value=${d.linkedin || ''} onInput=${set('linkedin')} /></label>
        <label>Nguồn<${Select} value=${d.p_source} onChange=${set('p_source')} options=${P_SOURCES} /></label>
        <label>Khu vực<${Select} value=${d.region} onChange=${set('region')} placeholder="Chọn" options=${settings.regions} /></label>
      </div>
      ${d.tier && html`<p class="muted small">Mức ${d.tier}: ${TIERS[d.tier].hint}</p>`}
      <label class="inline-check"><input type="checkbox" checked=${d.north_office !== false} onChange=${set('north_office')} /> Có văn phòng hoặc nhà máy ở miền Bắc</label>
      <div class="grid3">
        <label>Dấu hiệu<input value=${d.signal || ''} onInput=${set('signal')} placeholder="Kỷ niệm 20 năm, mở nhà máy mới…" /></label>
        <label>Ngày của dấu hiệu<input type="date" value=${d.signal_date || ''} onInput=${set('signal_date')} /></label>
        <label>Hay làm sự kiện<input value=${d.event_season || ''} onInput=${set('event_season')} placeholder="Cuối năm, kỷ niệm thành lập…" /></label>
        <label>Tháng chốt ngân sách<input value=${d.budget_month || ''} onInput=${set('budget_month')} placeholder="VD: tháng 11" /></label>
        ${!row && html`<label>Phụ trách<select value=${owner} onChange=${set('owner_id')}>${[...new Set([user.id, ...(settings.industries || []).flatMap((i) => i.owners || [])])].filter((id) => people[id]).map((id) => html`<option value=${id}>${people[id].full_name}</option>`)}</select></label>`}
      </div>
      <label>Ghi chú<textarea rows="2" value=${d.notes || ''} onInput=${set('notes')} /></label>
      ${err && html`<div class="err">${err}</div>`}
      <div class="row end"><button type="button" class="btn" onClick=${onClose}>Huỷ</button><button class="btn primary" disabled=${busy}>${busy ? 'Đang lưu…' : 'Lưu'}</button></div>
    </form>
  <//>`;
}

function ContactModal({ ctx, c, row, onClose }) {
  const [d, setD] = useState({ name: '', title: '', role_level: '', linkedin: '', li_connected: false, email: '', phone: '', info_source: 'LinkedIn', gender: '', notes: '', do_not_contact: false, ...row });
  const set = (k) => (e) => {
    const v = e && e.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setD((x) => ({ ...x, [k]: v }));
  };
  const [err, setErr] = useState('');
  async function submit(e) {
    e.preventDefault();
    try {
      if (!d.name.trim()) throw new Error('Nhập họ tên');
      if (!d.info_source) throw new Error('Ghi nguồn của thông tin liên hệ');
      const { id, created_at, ...data } = d;
      const others = ctx.contacts.filter((k) => k.customer_id === c.id && k.id !== row?.id);
      await ctx.saveRow('contacts', row?.id, { ...data, customer_id: c.id, name: d.name.trim(), role_level: d.role_level ? Number(d.role_level) : null, is_primary: row ? row.is_primary : !others.length });
      if (d.do_not_contact && row?.seq_status === 'running') await ctx.saveRow('contacts', row.id, { seq_status: 'stopped' });
      ctx.notify('Đã lưu người liên hệ');
      onClose();
    } catch (x) {
      setErr(x.message);
    }
  }
  return html`<${Modal} title=${(row ? 'Sửa' : 'Thêm') + ' người liên hệ · ' + c.name} onClose=${onClose} wide>
    <form class="form" onSubmit=${submit}>
      <div class="grid3">
        <label>Họ tên *<input value=${d.name} onInput=${set('name')} autofocus /></label>
        <label>Chức danh<input value=${d.title || ''} onInput=${set('title')} placeholder="Chuyên viên C&B…" /></label>
        <label>Vai trò<select value=${d.role_level || ''} onChange=${set('role_level')}><option value="">-</option>${Object.entries(ROLE_LEVELS).map(([k, r]) => html`<option value=${k}>${k}. ${r.label}</option>`)}</select></label>
      </div>
      ${d.role_level && html`<p class="muted small">${ROLE_LEVELS[d.role_level].hint}. ${d.role_level == 1 ? 'Nhắn người này trước.' : d.role_level == 2 ? 'Kết nối LinkedIn cùng lúc với người số 1.' : 'Để Hoàng hoặc Minh gặp khi đã có brief.'}</p>`}
      <div class="grid3">
        <label>Link LinkedIn<input value=${d.linkedin || ''} onInput=${set('linkedin')} /></label>
        <label>Email công việc<input type="email" value=${d.email || ''} onInput=${set('email')} /></label>
        <label>SĐT<input type="tel" value=${d.phone || ''} onInput=${set('phone')} /></label>
        <label>Nguồn thông tin *<${Select} value=${d.info_source} onChange=${set('info_source')} options=${['LinkedIn', 'Website công ty', 'Tin tuyển dụng', 'Tổng đài', 'Khách tự đưa', 'Khách cũ giới thiệu', 'Sự kiện']} /></label>
      </div>
      <label class="inline-check"><input type="checkbox" checked=${d.li_connected} onChange=${set('li_connected')} /> Đã kết nối LinkedIn</label>
      <label class="inline-check"><input type="checkbox" checked=${d.do_not_contact} onChange=${set('do_not_contact')} /> Không muốn nhận tin (không liên hệ nữa)</label>
      <label>Ghi chú<textarea rows="2" value=${d.notes || ''} onInput=${set('notes')} placeholder="Bài viết gần đây, sở thích, khách nói gì…" /></label>
      <p class="muted small">Chỉ dùng thông tin công việc được công khai hoặc do khách tự đưa. Không mua danh sách.</p>
      ${err && html`<div class="err">${err}</div>`}
      <div class="row end">
        ${row && ctx.isMgr && html`<button type="button" class="link danger" style="margin-right:auto" onClick=${async () => { if (confirm('Xoá người liên hệ này?')) { await ctx.removeRow('contacts', row.id); onClose(); } }}>Xoá</button>`}
        <button type="button" class="btn" onClick=${onClose}>Huỷ</button><button class="btn primary">Lưu</button>
      </div>
    </form>
  <//>`;
}

// ---------------------------------------------------------------------------
// Báo cáo phễu (review thứ 6). Người thường chỉ thấy số của mình.
// ---------------------------------------------------------------------------
function FunnelReport({ ctx, who }) {
  const { isMgr, user, people, settings } = ctx;
  const { prospects, touches } = useP(ctx);
  const [range, setRange] = useState('week');
  const [ref, setRef] = useState(today());
  const [from, to] = range === 'week' ? weekRange(ref) : [U.addDays(-83, weekRange()[0]), weekRange()[1]];
  const pool = prospects.concat(ctx.customers.filter((c) => !c.p_status && c.first_touch_at)).filter((c) => (isMgr ? !who || c.owner_id === who : c.owner_id === user.id));
  const data = { customers: pool, contacts: ctx.contacts, touches };
  const byPerson = funnel(data, from, to, (c) => c.owner_id || '-');
  const byInd = funnel(data, from, to, (c) => c.industry || 'Chưa có ngành');
  const weeks = range === 'week' ? 1 : 12;
  const COLS = [['companies', 'DN mới vào chuỗi'], ['sequences', 'Người vào chuỗi'], ['touches', 'Lần chạm'], ['replies', 'Phản hồi'], ['meetings', 'Hẹn'], ['briefs', 'Brief']];
  const pctOn = (r) => (r.due ? Math.round((r.ontime / r.due) * 100) + '%' : '-');
  const table = (title, obj, label, withTarget) => html`<section class="section card-sec"><h2>${title}</h2>
    <div class="table-wrap"><table class="table compact">
      <thead><tr><th>${label}</th>${COLS.map(([, l]) => html`<th class="num">${l}</th>`)}<th class="num">Chạm đúng hạn</th></tr></thead>
      <tbody>${Object.entries(obj).filter(([, r]) => withTarget || Object.values(r).some((v) => v > 0)).sort((a, b) => b[1].companies - a[1].companies).map(([k, r]) => {
        const tg = withTarget ? settings.prospect_targets?.[k] || {} : {};
        return html`<tr key=${k}><td><b>${withTarget ? people[k]?.full_name || '-' : k}</b></td>
          ${COLS.map(([f]) => {
            const t = f === 'companies' ? tg.companies : f === 'meetings' ? tg.meetings : null;
            const goal = t ? Math.round(t * weeks * 10) / 10 : null;
            return html`<td class=${'num' + (goal != null ? (r[f] >= goal ? ' ok-text' : ' stale') : '')}>${r[f]}${goal != null ? html`<span class="muted small"> / ${num(goal)}</span>` : ''}</td>`;
          })}<td class="num">${pctOn(r)}</td></tr>`;
      })}</tbody>
    </table></div></section>`;
  const tstat = templateStats({ contacts: ctx.contacts.filter((k) => pool.some((c) => c.id === k.customer_id)), touches: touches.filter((t) => pool.some((c) => c.id === t.customer_id)) });
  const tpls = templatesOf(settings);
  const needBoss = pool.filter((c) => c.tier === 'A' && ['replied', 'meeting', 'brief'].includes(c.p_status));
  return html`<div>
    <div class="row" style="margin-bottom:10px">
      <div class="seg"><button class=${range === 'week' ? 'on' : ''} onClick=${() => setRange('week')}>Theo tuần</button><button class=${range === '12w' ? 'on' : ''} onClick=${() => setRange('12w')}>12 tuần gần nhất</button></div>
      ${range === 'week' && html`<button class="btn" onClick=${() => setRef(U.addDays(-7, ref))}>‹</button><span class="muted">${U.fmtDate(from)} - ${U.fmtDate(to)}</span><button class="btn" disabled=${to >= today()} onClick=${() => setRef(U.addDays(7, ref))}>›</button>`}
      ${!isMgr && html`<span class="muted small">Bạn đang xem số liệu của mình.</span>`}
    </div>
    ${table('Theo người phụ trách', byPerson, 'Người', true)}
    ${table('Theo ngành', byInd, 'Ngành', false)}
    <section class="section card-sec"><h2>Mẫu tin nhắn nào được phản hồi</h2>
      <div class="table-wrap"><table class="table compact"><thead><tr><th>Mẫu</th><th class="num">Đã gửi</th><th class="num">Phản hồi sau mẫu này</th><th class="num">Tỉ lệ</th></tr></thead>
        <tbody>${tpls.map((t) => { const r = tstat[t.key] || { sent: 0, replies: 0 }; return html`<tr key=${t.key}><td>${t.key}. ${t.title}</td><td class="num">${r.sent}</td><td class="num">${r.replies}</td><td class="num">${r.sent ? Math.round((r.replies / r.sent) * 100) + '%' : '-'}</td></tr>`; })}</tbody>
      </table></div>
      <p class="muted small">Tính từ đầu chương trình. Phản hồi được tính cho lần chạm gần nhất trước khi người đó trả lời.</p>
    </section>
    ${needBoss.length > 0 && html`<section class="section card-sec"><h2>Khách mức A cần Hoàng hoặc Minh vào cùng</h2>
      <div class="minilist">${needBoss.map((c) => html`<div class="mini" key=${c.id}><div class="mini-main"><b>${c.name}</b> <span class="muted small">${people[c.owner_id]?.full_name || ''}</span></div><${StatusPill} s=${c.p_status} /></div>`)}</div></section>`}
  </div>`;
}

// ---------------------------------------------------------------------------
// Mẫu tin nhắn (Admin sửa được)
// ---------------------------------------------------------------------------
function TemplateLib({ ctx }) {
  const [tpls, setTpls] = useState(() => JSON.parse(JSON.stringify(templatesOf(ctx.settings))));
  const [dirty, setDirty] = useState(false);
  const edit = ctx.isAdmin;
  const upd = (i, k, v) => {
    setTpls(tpls.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
    setDirty(true);
  };
  return html`<div>
    <p class="muted">Chữ trong [ngoặc vuông] được tự điền khi bấm "📋 Mẫu" ở từng lần chạm: [Tên], [Tên mình], [Tên công ty], [ngành], [dấu hiệu]. Phần còn lại tự viết riêng cho từng khách.
      ${edit ? ' Sửa xong bấm Lưu mẫu.' : ' Muốn sửa mẫu, góp ý trong review thứ 6.'}</p>
    ${tpls.map((t, i) => html`<section class="section card-sec" key=${t.key}>
      <h2>Mẫu ${t.key}. ${edit ? html`<input value=${t.title} onInput=${(e) => upd(i, 'title', e.target.value)} />` : t.title} <span class="muted small">${CHANNELS[t.channel]?.icon} ${CHANNELS[t.channel]?.label}</span></h2>
      <div class="grid2">
        <label>Tiếng Việt<textarea rows="7" readonly=${!edit} value=${t.vi || ''} onInput=${(e) => upd(i, 'vi', e.target.value)} /></label>
        <label>English<textarea rows="7" readonly=${!edit} value=${t.en || ''} onInput=${(e) => upd(i, 'en', e.target.value)} /></label>
      </div>
    </section>`)}
    ${edit && html`<div class="row end sticky-save"><button class="btn primary" disabled=${!dirty} onClick=${async () => { try { ctx.setSettings(await ctx.store.updateSettings({ msg_templates: tpls })); setDirty(false); ctx.notify('Đã lưu mẫu'); } catch (e) { ctx.notify(e.message, 'err'); } }}>Lưu mẫu</button></div>`}
  </div>`;
}

// ---------------------------------------------------------------------------
// Cài đặt (Admin): ngành + người phụ trách, chỉ tiêu tuần
// ---------------------------------------------------------------------------
function ProspectSetup({ ctx }) {
  const { settings, profiles, people } = ctx;
  const [inds, setInds] = useState(() => JSON.parse(JSON.stringify(settings.industries || [])));
  const [tg, setTg] = useState(() => JSON.parse(JSON.stringify(settings.prospect_targets || {})));
  const staff = profiles.filter((p) => p.active && p.role !== 'accountant');
  const ids = [...new Set(inds.flatMap((i) => i.owners || []))];
  const toggle = (i, id) => setInds(inds.map((x, j) => (j === i ? { ...x, owners: (x.owners || []).includes(id) ? x.owners.filter((o) => o !== id) : [...(x.owners || []), id] } : x)));
  async function save() {
    try {
      ctx.setSettings(await ctx.store.updateSettings({ industries: inds.filter((i) => i.name.trim()), prospect_targets: tg }));
      ctx.notify('Đã lưu cài đặt tìm khách');
    } catch (e) {
      ctx.notify(e.message, 'err');
    }
  }
  return html`<div>
    <section class="section card-sec"><h2>Ngành và người phụ trách</h2>
      <p class="muted small">Người đầu tiên được tick là người phụ trách mặc định khi thêm doanh nghiệp của ngành đó. Tick "Tiếng Anh" để chuỗi dùng mẫu tiếng Anh.</p>
      <div class="table-wrap"><table class="table compact"><thead><tr><th>Ngành</th><th>Người phụ trách</th><th>Tiếng Anh</th><th></th></tr></thead>
        <tbody>${inds.map((x, i) => html`<tr key=${i}>
          <td><input value=${x.name} onInput=${(e) => setInds(inds.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} /></td>
          <td><div class="chips">${staff.map((p) => html`<button type="button" class=${'chip' + ((x.owners || []).includes(p.id) ? ' on' : '')} onClick=${() => toggle(i, p.id)}>${(x.owners || [])[0] === p.id ? '★ ' : ''}${p.full_name}</button>`)}</div></td>
          <td><input type="checkbox" checked=${!!x.en} onChange=${(e) => setInds(inds.map((y, j) => (j === i ? { ...y, en: e.target.checked } : y)))} /></td>
          <td><button class="link danger" onClick=${() => setInds(inds.filter((_, j) => j !== i))}>Xoá</button></td></tr>`)}</tbody></table></div>
      <button class="link" onClick=${() => setInds([...inds, { name: '', owners: [], en: false }])}>＋ Thêm ngành</button>
    </section>
    <section class="section card-sec"><h2>Chỉ tiêu mỗi tuần</h2>
      <p class="muted small">Hẹn 1 cuộc / 2 tuần thì nhập 0,5. Checklist tự đếm KPI theo các số này.</p>
      <div class="table-wrap"><table class="table compact"><thead><tr><th>Người</th><th>Doanh nghiệp mới vào chuỗi / tuần</th><th>Cuộc hẹn / tuần</th></tr></thead>
        <tbody>${ids.filter((id) => people[id]).map((id) => html`<tr key=${id}><td>${people[id].full_name}</td>
          <td><input type="number" step="1" class="short" value=${tg[id]?.companies ?? ''} onInput=${(e) => setTg({ ...tg, [id]: { ...tg[id], companies: Number(e.target.value) || 0 } })} /></td>
          <td><input type="number" step="0.5" class="short" value=${tg[id]?.meetings ?? ''} onInput=${(e) => setTg({ ...tg, [id]: { ...tg[id], meetings: Number(String(e.target.value).replace(',', '.')) || 0 } })} /></td></tr>`)}</tbody></table></div>
    </section>
    <div class="row end sticky-save"><button class="btn primary" onClick=${save}>Lưu cài đặt</button></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Nhập danh sách doanh nghiệp từ Excel (Trưởng KD / Admin)
// ---------------------------------------------------------------------------
function ImportModal({ ctx, onClose }) {
  const { settings, profiles, people, saveRow, notify, store } = ctx;
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const byName = Object.fromEntries(profiles.map((p) => [U.fold(p.full_name), p.id]));
  async function onFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const m = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
      const X = m.default || m;
      const wb = X.read(await f.arrayBuffer());
      const all = wb.SheetNames.flatMap((n) => parseProspectRows(X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: null })));
      if (!all.length) return setErr('Không thấy cột "Tên doanh nghiệp". Tải file mẫu để xem cách điền.');
      const seen = [];
      setRows(all.map((r) => {
        const dup = findCompanyDup(ctx.customers.concat(seen), r)[0];
        seen.push({ id: 'n' + seen.length, ...r });
        const owner = byName[U.fold(r.owner_name)] || defaultOwner(settings, r.industry) || ctx.user.id;
        return { ...r, owner_id: owner, dup, include: !dup };
      }));
      setErr('');
    } catch (x) {
      setErr('Không đọc được file: ' + x.message);
    }
  }
  async function template() {
    const m = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
    const X = m.default || m;
    const ws = X.utils.aoa_to_sheet([['Tên doanh nghiệp', 'Ngành', 'Mức', 'Quy mô', 'Website', 'LinkedIn', 'Nguồn', 'Dấu hiệu', 'Phụ trách', 'Ghi chú'],
      ['Ngân hàng ABC', (settings.industries || [])[0]?.name || '', 'A', 1000, 'abc.com.vn', '', 'Danh sách', 'Kỷ niệm 30 năm thành lập', '', '']]);
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Danh sach');
    X.writeFile(wb, 'Mau_danh_sach_tim_khach.xlsx');
  }
  async function run() {
    const list = rows.filter((r) => r.include);
    try {
      for (const [i, r] of list.entries()) {
        setBusy(`Đang nhập ${i + 1}/${list.length}…`);
        const { owner_name, dup, include, ...data } = r;
        const c = await saveRow('customers', null, { ...data, customer_type: 'Doanh nghiệp', region: r.region || 'Hà Nội', p_status: 'new', p_added_at: new Date().toISOString(), last_care_at: new Date().toISOString(), north_office: true });
        await store.addActivity({ customer_id: c.id, type: 'prospect', content: `Nhập từ Excel (nguồn: ${r.p_source})` });
      }
      notify(`Đã nhập ${list.length} doanh nghiệp`);
      onClose();
    } catch (x) {
      setErr(x.message);
    }
    setBusy('');
  }
  return html`<${Modal} title="Nhập danh sách doanh nghiệp từ Excel" onClose=${onClose} wide>
    <div class="form">
      <p class="muted">Cột cần có: <b>Tên doanh nghiệp</b>; thêm nếu có: Ngành, Mức, Quy mô, Website, LinkedIn, Nguồn, Dấu hiệu, Phụ trách, Ghi chú. Phụ trách để trống thì lấy theo ngành. Dòng trùng với CRM tự bỏ tick.
        <button class="link" onClick=${template}>⬇ Tải file mẫu</button></p>
      <input type="file" accept=".xlsx,.xls,.csv" onChange=${onFile} />
      ${rows && html`<div class="table-wrap" style="max-height:50vh;overflow:auto"><table class="table compact">
        <thead><tr><th></th><th>Doanh nghiệp</th><th>Ngành</th><th>Mức</th><th>Phụ trách</th><th>Trùng</th></tr></thead>
        <tbody>${rows.map((r, i) => html`<tr key=${i} class=${r.include ? '' : 'dim'}>
          <td><input type="checkbox" checked=${r.include} onChange=${(e) => setRows(rows.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} /></td>
          <td>${r.name}</td><td class="small">${r.industry}</td><td>${r.tier || '-'}</td>
          <td><select value=${r.owner_id} onChange=${(e) => setRows(rows.map((x, j) => (j === i ? { ...x, owner_id: e.target.value } : x)))}>${profiles.filter((p) => p.active).map((p) => html`<option value=${p.id}>${p.full_name}</option>`)}</select></td>
          <td class="small stale">${r.dup ? r.dup.name : ''}</td></tr>`)}</tbody></table></div>
        <p class="muted small">${rows.filter((r) => r.include).length} dòng sẽ được nhập.</p>`}
      ${err && html`<div class="err">${err}</div>`}
      ${rows && html`<div class="row end"><button class="btn" onClick=${onClose}>Huỷ</button><button class="btn primary" disabled=${!!busy} onClick=${run}>${busy || 'Nhập'}</button></div>`}
    </div>
  <//>`;
}
