import { html, render, useState, useEffect, useMemo, useCallback, useRef } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import { createStore } from './store.js';
import * as U from './util.js';
import { Modal, StagePill, FollowBadge, LastTouch, ContactButtons, Select, salesPeople, Section, FollowupInput, InlineText, initials } from './ui.js';
import { CustomersView, CustomerDrawer, CareView, CareToday, ConvertLeadModal } from './customers.js';
import { TABLES } from './store.js';
import { TournamentsView, TournamentModal, EventStatusPill } from './tournaments.js';
import { DeployView } from './deploy.js';

let store;

// ---------------------------------------------------------------------------
// Khung ứng dụng
// ---------------------------------------------------------------------------
const VIEWS = [
  { id: 'today', label: 'Hôm nay', icon: '☀️' },
  { id: 'list', label: 'Danh sách', icon: '📋' },
  { id: 'pipeline', label: 'Pipeline', icon: '🗂️' },
  { id: 'tournaments', label: 'Giải đấu', icon: '🏆' },
  { id: 'deploy', label: 'Triển khai giải', icon: '🚀' },
  { id: 'customers', label: 'Khách hàng', icon: '🏢' },
  { id: 'care', label: 'Chăm sóc', icon: '🎁' },
  { id: 'reports', label: 'Báo cáo', icon: '📊' },
  { id: 'settings', label: 'Cài đặt', icon: '⚙️', admin: true },
];

function App() {
  const [user, setUser] = useState(undefined);
  const [profiles, setProfiles] = useState([]);
  const [leads, setLeads] = useState(null);
  const [settings, setSettings] = useState(U.DEFAULT_SETTINGS);
  const [view, setView] = useState(() => location.hash.replace('#/', '') || 'today');
  const [listPreset, setListPreset] = useState(null);
  const [openLeadId, setOpenLeadId] = useState(null);
  const [openCustomerId, setOpenCustomerId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [convertLead, setConvertLead] = useState(null);
  const [eventModal, setEventModal] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [events, setEvents] = useState([]);
  const [gifts, setGifts] = useState([]);
  const setters = { customers: setCustomers, contacts: setContacts, events: setEvents, gifts: setGifts };
  const [showPw, setShowPw] = useState(false);
  const [toast, setToast] = useState(null);
  const lastLoad = useRef(0);

  const notify = useCallback((msg, type = 'ok') => setToast({ msg, type, k: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const reload = useCallback(async () => {
    try {
      const [p, l, s, ...rest] = await Promise.all([store.listProfiles(), store.listLeads(), store.getSettings(), ...TABLES.map((t) => store.list(t))]);
      TABLES.forEach((t, i) => setters[t](rest[i]));
      setProfiles(p);
      setLeads(l);
      setSettings(s);
      lastLoad.current = Date.now();
    } catch (e) {
      notify(e.message, 'err');
    }
  }, []);

  useEffect(() => {
    store.getUser().then(setUser, () => setUser(null));
    return store.onAuthChange((ev) => {
      if (ev === 'PASSWORD_RECOVERY') setShowPw(true);
      if (ev === 'SIGNED_OUT') setUser(null);
    });
  }, []);
  useEffect(() => {
    if (user?.active) reload();
  }, [user?.id, user?.role]);
  useEffect(() => {
    const onHash = () => setView(location.hash.replace('#/', '') || 'today');
    const onFocus = () => user && Date.now() - lastLoad.current > 60000 && reload();
    addEventListener('hashchange', onHash);
    addEventListener('focus', onFocus);
    return () => {
      removeEventListener('hashchange', onHash);
      removeEventListener('focus', onFocus);
    };
  }, [user]);

  if (user === undefined) return html`<div class="splash">Đang tải…</div>`;
  if (!user) return html`<${Login} onLogin=${setUser} />`;
  if (user.crm_access === false)
    return html`<div class="splash">Tài khoản này chỉ dùng cho Fairplay Checklist, chưa được cấp quyền vào CRM.<br /><button class="btn" onClick=${() => store.signOut().then(() => setUser(null))}>Đăng xuất</button></div>`;
  if (!user.active)
    return html`<div class="splash">Tài khoản đã bị khoá. Liên hệ Admin.<br /><button class="btn" onClick=${() => store.signOut().then(() => setUser(null))}>Đăng xuất</button></div>`;

  const isMgr = ['admin', 'manager'].includes(user.role);
  const isAdmin = user.role === 'admin';
  const people = Object.fromEntries(profiles.map((p) => [p.id, p]));
  const go = (v, preset) => {
    setListPreset(preset || null);
    location.hash = '#/' + v;
    setView(v);
  };

  const replaceLead = (l) => setLeads((ls) => ls.map((x) => (x.id === l.id ? l : x)));

  // Cập nhật lead + tự ghi lịch sử khi đổi giai đoạn / người phụ trách
  async function updateLead(lead, patch) {
    const updated = await store.updateLead(lead.id, patch);
    const logs = [];
    if (patch.stage && patch.stage !== lead.stage)
      logs.push({
        type: 'stage',
        content: `${U.stageOf(lead.stage).label} → ${U.stageOf(patch.stage).label}` + (patch.stage === 'lost' ? ` (Lý do: ${patch.lost_reason})` : ''),
      });
    if ('assignee_id' in patch && (patch.assignee_id || null) !== (lead.assignee_id || null))
      logs.push({ type: 'assign', content: patch.assignee_id ? `Giao cho ${people[patch.assignee_id]?.full_name || '?'}` : 'Bỏ giao, đưa về hàng chờ' });
    for (const a of logs) await store.addActivity({ lead_id: lead.id, ...a });
    if (logs.length) updated.last_activity_at = new Date().toISOString();
    replaceLead(updated);
    if (patch.stage === 'won' && lead.stage !== 'won') setConvertLead(updated);
    return updated;
  }

  async function saveRow(table, id, data) {
    const row = id ? await store.update(table, id, data) : await store.insert(table, data);
    setters[table]((xs) => (id ? xs.map((x) => (x.id === id ? row : x)) : [row, ...xs]));
    return row;
  }

  async function removeRow(table, id) {
    await store.remove(table, id);
    setters[table]((xs) => xs.filter((x) => x.id !== id));
    if (table === 'customers') {
      for (const t of ['contacts', 'events', 'gifts']) setters[t]((xs) => xs.filter((x) => x.customer_id !== id));
      setLeads((ls) => ls.map((l) => (l.customer_id === id ? { ...l, customer_id: null } : l)));
      setOpenCustomerId(null);
    }
  }

  async function logCare(c, { type, content, next_care }) {
    let cur = c;
    if ((next_care || null) !== (c.next_care || null)) cur = await saveRow('customers', c.id, { next_care: next_care || null });
    if (content && content.trim()) {
      await store.addActivity({ customer_id: c.id, type, content: content.trim() });
      cur = { ...cur, last_care_at: new Date().toISOString() };
      setCustomers((xs) => xs.map((x) => (x.id === c.id ? cur : x)));
    }
    return cur;
  }

  async function logActivity(lead, { type, content, stage, next_followup, lost_reason }) {
    const patch = {};
    if (stage && stage !== lead.stage) patch.stage = stage;
    if (stage === 'lost') patch.lost_reason = lost_reason;
    const finalStage = stage || lead.stage;
    const fu = U.isOpen(finalStage) ? next_followup || null : null;
    if (fu !== (lead.next_followup || null)) patch.next_followup = fu;
    let cur = lead;
    if (Object.keys(patch).length) cur = await updateLead(lead, patch);
    if (content && content.trim()) {
      await store.addActivity({ lead_id: lead.id, type, content: content.trim() });
      cur = { ...cur, last_activity_at: new Date().toISOString() };
      replaceLead(cur);
    }
    return cur;
  }

  async function createLead(data, firstNote) {
    const lead = await store.createLead(data);
    await store.addActivity({ lead_id: lead.id, type: 'create', content: `Lead từ ${lead.source || 'chưa rõ nguồn'}` });
    if (firstNote?.trim()) await store.addActivity({ lead_id: lead.id, type: 'note', content: firstNote.trim() });
    setLeads((ls) => [lead, ...ls]);
    return lead;
  }

  async function bulkAssign(ids, assigneeId) {
    for (const id of ids) {
      const l = leads.find((x) => x.id === id);
      if (l && (l.assignee_id || null) !== (assigneeId || null)) await updateLead(l, { assignee_id: assigneeId || null });
    }
  }

  async function bulkStage(ids, stage, lost_reason) {
    for (const id of ids) {
      const l = leads.find((x) => x.id === id);
      if (l && l.stage !== stage)
        await updateLead(l, { stage, ...(stage === 'lost' ? { lost_reason } : {}), ...(U.isOpen(stage) ? {} : { next_followup: null }) });
    }
  }

  async function deleteLead(lead) {
    await store.deleteLead(lead.id);
    setLeads((ls) => ls.filter((x) => x.id !== lead.id));
    setOpenLeadId(null);
  }

  const ctx = {
    user, isMgr, isAdmin, profiles, people, leads: leads || [], settings, notify, go, listPreset,
    openLead: setOpenLeadId, updateLead, logActivity, createLead, bulkAssign, bulkStage, deleteLead, reload,
    setSettings, setProfiles, store,
    customers, contacts, events, gifts, saveRow, removeRow, logCare,
    openCustomer: (id) => { setOpenLeadId(null); setOpenCustomerId(id); },
    startNewLead: (init) => setShowNew(init || true),
    startConvert: setConvertLead,
    openEvent: (x) => setEventModal(x && x.id ? { row: x } : { init: x || {} }),
  };
  ctx.openLead = (id) => { setOpenCustomerId(null); setOpenLeadId(id); };
  const views = VIEWS.filter((v) => !v.admin || isAdmin);
  const openLead = leads?.find((l) => l.id === openLeadId);
  const openCustomer = customers.find((c) => c.id === openCustomerId);

  return html`
    ${store.mode === 'demo' && html`<${DemoBar} user=${user} profiles=${profiles} onSwitch=${async (id) => setUser(await store.switchUser(id))} onReset=${async () => { await store.resetDemo(); reload(); notify('Đã khôi phục dữ liệu mẫu'); }} />`}
    <header class="topbar">
      <div class="brand"><img src="assets/logo-mark.png" alt="Fairplay Sports" /><span class="wordmark"><b>FAIRPLAY</b><small>SPORTS · CRM</small></span></div>
      <nav class="tabs">
        ${views.map((v) => html`<a href=${'#/' + v.id} class=${view === v.id ? 'on' : ''} onClick=${(e) => { e.preventDefault(); go(v.id); }}><span class="ic">${v.icon}</span><span>${v.label}</span></a>`)}
      </nav>
      <div class="top-actions">
        <button class="btn primary" onClick=${() => setShowNew(true)}>＋ <span class="hide-sm">Lead mới</span></button>
        <${UserMenu} user=${user} onPw=${() => setShowPw(true)} onLogout=${async () => { await store.signOut(); setUser(null); }} />
      </div>
    </header>
    <main class="main">
      ${leads === null
        ? html`<div class="splash">Đang tải dữ liệu…</div>`
        : view === 'list' ? html`<${ListView} ctx=${ctx} key=${JSON.stringify(listPreset)} />`
        : view === 'pipeline' ? html`<${PipelineView} ctx=${ctx} />`
        : view === 'reports' ? html`<${ReportsView} ctx=${ctx} />`
        : view === 'customers' ? html`<${CustomersView} ctx=${ctx} />`
        : view === 'tournaments' ? html`<${TournamentsView} ctx=${ctx} />`
        : view === 'deploy' ? html`<${DeployView} ctx=${ctx} />`
        : view === 'care' ? html`<${CareView} ctx=${ctx} />`
        : view === 'settings' && isAdmin ? html`<${SettingsView} ctx=${ctx} />`
        : html`<${TodayView} ctx=${ctx} />`}
    </main>
    ${openLead && html`<${LeadDrawer} ctx=${ctx} lead=${openLead} onClose=${() => setOpenLeadId(null)} key=${openLead.id} />`}
    ${openCustomer && html`<${CustomerDrawer} ctx=${ctx} customer=${openCustomer} onClose=${() => setOpenCustomerId(null)} key=${openCustomer.id} />`}
    ${showNew && html`<${NewLeadModal} ctx=${ctx} initial=${showNew === true ? null : showNew} onClose=${() => setShowNew(false)} />`}
    ${convertLead && html`<${ConvertLeadModal} ctx=${ctx} lead=${convertLead} onClose=${() => setConvertLead(null)} />`}
    ${eventModal && html`<${TournamentModal} ctx=${ctx} row=${eventModal.row && events.find((e) => e.id === eventModal.row.id)} init=${eventModal.init} onClose=${() => setEventModal(null)} />`}
    ${showPw && html`<${PasswordModal} onClose=${() => setShowPw(false)} notify=${notify} />`}
    ${toast && html`<div class=${'toast ' + toast.type} key=${toast.k}>${toast.msg}</div>`}
  `;
}

function DemoBar({ user, profiles, onSwitch, onReset }) {
  return html`<div class="demobar">
    <span><b>DEMO</b> · dữ liệu mẫu, chỉ lưu trên trình duyệt này. Xem với vai trò:</span>
    <select value=${user.id} onChange=${(e) => onSwitch(e.target.value)}>
      ${profiles.filter((p) => p.active).map((p) => html`<option value=${p.id}>${p.full_name} — ${U.ROLES[p.role]}</option>`)}
    </select>
    <button class="link" onClick=${onReset}>Khôi phục dữ liệu mẫu</button>
  </div>`;
}

function UserMenu({ user, onPw, onLogout }) {
  const [open, setOpen] = useState(false);
  return html`<div class="usermenu">
    <button class="avatar" title=${user.full_name} onClick=${() => setOpen(!open)}>${initials(user.full_name)}</button>
    ${open && html`<div class="menu" onMouseLeave=${() => setOpen(false)}>
      <div class="menu-head"><b>${user.full_name}</b><small>${user.email} · ${U.ROLES[user.role]}</small></div>
      ${store.mode === 'live' && html`<button onClick=${() => { setOpen(false); onPw(); }}>Đổi mật khẩu</button>`}
      <button onClick=${onLogout}>Đăng xuất</button>
    </div>`}
  </div>`;
}

// ---------------------------------------------------------------------------
// Đăng nhập
// ---------------------------------------------------------------------------
function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [demoUsers, setDemoUsers] = useState([]);
  useEffect(() => {
    if (store.mode === 'demo') store.listProfiles().then(setDemoUsers);
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      onLogin(await store.signIn(email, pw));
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }
  async function forgot() {
    if (!email) return setErr('Nhập email trước rồi bấm "Quên mật khẩu"');
    try {
      await store.resetPassword(email);
      setErr('Đã gửi email đặt lại mật khẩu, kiểm tra hộp thư.');
    } catch (e) {
      setErr(e.message);
    }
  }

  return html`<div class="login">
    <div class="login-card">
      <img class="brand-logo" src="assets/logo.png" alt="Fairplay Sports" />
      <p class="muted">CRM Phòng Kinh doanh — lead, giải đấu & chăm sóc khách hàng</p>
      ${store.mode === 'demo'
        ? html`<p class="note">Đang chạy <b>chế độ demo</b>. Chọn một tài khoản để xem thử theo từng vai trò:</p>
            <div class="demo-users">
              ${demoUsers.map((p) => html`<button class="btn" onClick=${async () => onLogin(await store.signIn(p.email))}><b>${p.full_name}</b><small>${U.ROLES[p.role]}</small></button>`)}
            </div>`
        : html`<form onSubmit=${submit} class="form">
            <label>Email<input type="email" required value=${email} onInput=${(e) => setEmail(e.target.value)} autocomplete="username" /></label>
            <label>Mật khẩu<input type="password" required value=${pw} onInput=${(e) => setPw(e.target.value)} autocomplete="current-password" /></label>
            ${err && html`<div class="err">${err}</div>`}
            <button class="btn primary block" disabled=${busy}>${busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
            <button type="button" class="link" onClick=${forgot}>Quên mật khẩu?</button>
          </form>`}
    </div>
  </div>`;
}

function PasswordModal({ onClose, notify }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  async function submit(e) {
    e.preventDefault();
    if (pw.length < 8) return setErr('Mật khẩu tối thiểu 8 ký tự');
    if (pw !== pw2) return setErr('Hai mật khẩu không khớp');
    try {
      await store.changePassword(pw);
      notify('Đã đổi mật khẩu');
      onClose();
    } catch (e) {
      setErr(e.message);
    }
  }
  return html`<${Modal} title="Đặt mật khẩu mới" onClose=${onClose}>
    <form class="form" onSubmit=${submit}>
      <label>Mật khẩu mới<input type="password" value=${pw} onInput=${(e) => setPw(e.target.value)} autocomplete="new-password" /></label>
      <label>Nhập lại<input type="password" value=${pw2} onInput=${(e) => setPw2(e.target.value)} autocomplete="new-password" /></label>
      ${err && html`<div class="err">${err}</div>`}
      <div class="row end"><button class="btn primary">Lưu</button></div>
    </form>
  <//>`;
}

// ---------------------------------------------------------------------------
// Thành phần dùng chung
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Hôm nay
// ---------------------------------------------------------------------------
function TodayView({ ctx }) {
  const { leads, user, isMgr, settings, people, profiles, openLead, go } = ctx;
  const [scope, setScope] = useState(isMgr ? 'all' : 'mine');
  const pool = scope === 'mine' ? leads.filter((l) => l.assignee_id === user.id) : leads;
  const withFlags = pool.map((l) => ({ l, f: U.leadFlags(l, settings) }));
  const pick = (k) => withFlags.filter((x) => x.f[k]).map((x) => x.l);
  const overdue = pick('overdue').sort((a, b) => a.next_followup.localeCompare(b.next_followup));
  const today = pick('dueToday');
  const stale = pick('stale').filter((l) => !overdue.includes(l) && !today.includes(l)).sort((a, b) => a.last_activity_at.localeCompare(b.last_activity_at));
  const noFu = pick('noFollowup').filter((l) => l.assignee_id);
  const unassigned = leads.filter((l) => U.isOpen(l.stage) && !l.assignee_id);

  const cards = [
    { k: 'overdue', label: 'Quá hạn follow-up', n: overdue.length, cls: 'bad' },
    { k: 'dueToday', label: 'Cần liên hệ hôm nay', n: today.length, cls: 'warn' },
    { k: 'stale', label: `Bỏ quên ≥ ${settings.stale_days} ngày`, n: stale.length, cls: 'bad' },
    { k: 'noFollowup', label: 'Chưa hẹn follow-up', n: noFu.length, cls: '' },
    ...(isMgr ? [{ k: 'unassigned', label: 'Chờ giao người', n: unassigned.length, cls: 'info' }] : []),
  ];

  return html`<div class="page">
    <div class="page-head">
      <div><h1>Chào ${user.full_name} 👋</h1><p class="muted">${new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
      <div class="seg">
        <button class=${scope === 'mine' ? 'on' : ''} onClick=${() => setScope('mine')}>Lead của tôi</button>
        <button class=${scope === 'all' ? 'on' : ''} onClick=${() => setScope('all')}>Cả phòng</button>
      </div>
    </div>
    <div class="kpis">
      ${cards.map((c) => html`<button class=${'kpi ' + c.cls} onClick=${() => go('list', { flag: c.k, mine: scope === 'mine' && c.k !== 'unassigned' })}><b>${c.n}</b><span>${c.label}</span></button>`)}
    </div>
    ${isMgr && unassigned.length > 0 && html`<${Section} title="Lead mới chờ giao" count=${unassigned.length} hint="Chọn người phụ trách ngay tại đây">
      ${unassigned.slice(0, 10).map((l) => html`<${AssignRow} ctx=${ctx} lead=${l} key=${l.id} />`)}
      ${unassigned.length > 10 && html`<button class="link more" onClick=${() => go('list', { flag: 'unassigned' })}>Xem tất cả ${unassigned.length} lead →</button>`}
    <//>`}
    <${Section} title="Quá hạn" count=${overdue.length} tone="bad" empty="Không có lead quá hạn 🎉">
      ${overdue.slice(0, 15).map((l) => html`<${LeadRow} ctx=${ctx} lead=${l} key=${l.id} />`)}
    <//>
    <${Section} title="Hôm nay" count=${today.length} tone="warn" empty="Không có lịch follow-up hôm nay">
      ${today.map((l) => html`<${LeadRow} ctx=${ctx} lead=${l} key=${l.id} />`)}
    <//>
    <${Section} title="Bị bỏ quên" count=${stale.length} tone="bad" hint=${`Không có tương tác từ ${settings.stale_days} ngày trở lên`} empty="Không có lead bị bỏ quên">
      ${stale.slice(0, 15).map((l) => html`<${LeadRow} ctx=${ctx} lead=${l} key=${l.id} />`)}
      ${stale.length > 15 && html`<button class="link more" onClick=${() => go('list', { flag: 'stale', mine: scope === 'mine' })}>Xem tất cả ${stale.length} lead →</button>`}
    <//>
    <${CareToday} ctx=${ctx} scope=${scope} />
    ${isMgr && html`<${TeamTable} ctx=${ctx} />`}
  </div>`;
}

function LeadRow({ ctx, lead }) {
  const { people, settings, openLead } = ctx;
  return html`<div class="lrow" onClick=${() => openLead(lead.id)}>
    <div class="lrow-main">
      <b>${lead.name}</b>${lead.company && lead.company !== lead.name && html`<span class="muted"> · ${lead.company}</span>`}
      <div class="lrow-sub"><${StagePill} stage=${lead.stage} /> ${lead.need && html`<span class="tag">${lead.need}</span>`} <span class="muted">${people[lead.assignee_id]?.full_name || 'Chưa giao'}</span></div>
    </div>
    <div class="lrow-meta"><${FollowBadge} lead=${lead} settings=${settings} /><small><${LastTouch} lead=${lead} settings=${settings} /></small></div>
    <${ContactButtons} ctx=${ctx} lead=${lead} compact onLogged=${() => openLead(lead.id)} />
  </div>`;
}

function AssignRow({ ctx, lead }) {
  const { profiles, updateLead, notify, openLead } = ctx;
  return html`<div class="lrow" onClick=${() => openLead(lead.id)}>
    <div class="lrow-main">
      <b>${lead.name}</b>${lead.company && lead.company !== lead.name && html`<span class="muted"> · ${lead.company}</span>`}
      <div class="lrow-sub">${lead.need && html`<span class="tag">${lead.need}</span>`} <span class="muted">${lead.source || ''} · ${U.fmtDate(lead.created_at)}</span></div>
    </div>
    <div onClick=${(e) => e.stopPropagation()}>
      <${Select} value="" placeholder="Giao cho…" options=${salesPeople(profiles).map((p) => ({ value: p.id, label: p.full_name }))}
        onChange=${async (v) => { if (!v) return; try { await updateLead(lead, { assignee_id: v, next_followup: lead.next_followup || U.todayStr() }); notify('Đã giao lead'); } catch (e) { notify(e.message, 'err'); } }} />
    </div>
  </div>`;
}

function TeamTable({ ctx }) {
  const { leads, profiles, settings, go } = ctx;
  const month = U.todayStr().slice(0, 7);
  const rows = salesPeople(profiles).map((p) => {
    const mine = leads.filter((l) => l.assignee_id === p.id);
    const f = mine.map((l) => U.leadFlags(l, settings));
    return {
      p,
      open: f.filter((x) => x.open).length,
      overdue: f.filter((x) => x.overdue).length,
      stale: f.filter((x) => x.stale).length,
      noFu: f.filter((x) => x.noFollowup).length,
      wonMonth: mine.filter((l) => l.stage === 'won' && (l.updated_at || '').slice(0, 7) === month).length,
      newMonth: mine.filter((l) => l.created_at.slice(0, 7) === month).length,
    };
  }).filter((r) => r.open || r.wonMonth || r.newMonth);
  return html`<section class="section">
    <div class="section-head"><h2>Tình hình theo nhân viên</h2><small class="muted">Số đỏ = cần nhắc nhở</small></div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Nhân viên</th><th>Đang xử lý</th><th>Quá hạn</th><th>Bỏ quên</th><th>Chưa hẹn</th><th>Lead mới tháng này</th><th>Chốt tháng này</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr>
        <td><b>${r.p.full_name}</b></td><td>${r.open}</td>
        <td class=${r.overdue ? 'num bad' : 'num'}>${r.overdue}</td>
        <td class=${r.stale ? 'num bad' : 'num'}>${r.stale}</td>
        <td class=${r.noFu ? 'num warn' : 'num'}>${r.noFu}</td>
        <td>${r.newMonth}</td><td class="num good">${r.wonMonth}</td>
      </tr>`)}</tbody>
    </table></div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Danh sách
// ---------------------------------------------------------------------------
const FLAG_LABELS = { overdue: 'Quá hạn', dueToday: 'Hôm nay', stale: 'Bỏ quên', noFollowup: 'Chưa hẹn follow-up', unassigned: 'Chưa giao' };

function ListView({ ctx }) {
  const { leads, profiles, people, settings, user, isMgr, openLead, listPreset, bulkAssign, bulkStage, notify } = ctx;
  const [bulkTo, setBulkTo] = useState('');
  const [q, setQ] = useState('');
  const [stage, setStage] = useState(listPreset?.flag ? 'open' : '');
  const [assignee, setAssignee] = useState(listPreset?.mine ? user.id : listPreset?.flag === 'unassigned' ? '_none' : '');
  const [source, setSource] = useState('');
  const [need, setNeed] = useState('');
  const [flag, setFlag] = useState(listPreset?.flag && listPreset.flag !== 'unassigned' ? listPreset.flag : '');
  const [sort, setSort] = useState('created');
  const [limit, setLimit] = useState(100);
  const [sel, setSel] = useState(new Set());

  const filtered = useMemo(() => {
    const fq = U.fold(q);
    const digits = q.replace(/\D/g, '');
    let r = leads.filter((l) => {
      if (stage === 'open' ? !U.isOpen(l.stage) : stage && l.stage !== stage) return false;
      if (assignee === '_none' ? l.assignee_id : assignee && l.assignee_id !== assignee) return false;
      if (source && l.source !== source) return false;
      if (need && l.need !== need) return false;
      if (flag && !U.leadFlags(l, settings)[flag]) return false;
      if (fq) {
        const hay = U.fold([l.name, l.company, l.email, l.facebook, l.notes, l.event_time].join(' '));
        if (!hay.includes(fq) && !(digits.length >= 3 && String(l.phone || '').includes(digits))) return false;
      }
      return true;
    });
    const by = {
      created: (a, b) => b.created_at.localeCompare(a.created_at),
      followup: (a, b) => (a.next_followup || '9999').localeCompare(b.next_followup || '9999'),
      touch: (a, b) => a.last_activity_at.localeCompare(b.last_activity_at),
      name: (a, b) => a.name.localeCompare(b.name, 'vi'),
    }[sort];
    return r.sort(by);
  }, [leads, q, stage, assignee, source, need, flag, sort, settings]);

  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSel = filtered.length > 0 && filtered.slice(0, limit).every((l) => sel.has(l.id));

  function exportCsv() {
    U.csvDownload(`fairplay-leads-${U.todayStr()}.csv`, [
      ['Tên', 'Công ty', 'Loại KH', 'SĐT', 'Email', 'Facebook', 'Nguồn', 'Nhu cầu', 'Khu vực', 'Quy mô', 'Thời gian dự kiến', 'Giai đoạn', 'Lý do thất bại', 'Phụ trách', 'Follow-up', 'Tương tác cuối', 'Ngày tạo', 'Ghi chú'],
      ...filtered.map((l) => [l.name, l.company, l.customer_type, l.phone, l.email, l.facebook, l.source, l.need, l.region, l.headcount, l.event_time,
        U.stageOf(l.stage).label, l.lost_reason, people[l.assignee_id]?.full_name, U.fmtDate(l.next_followup), U.fmtDate(l.last_activity_at), U.fmtDate(l.created_at), l.notes]),
    ]);
  }

  const clear = () => { setQ(''); setStage(''); setAssignee(''); setSource(''); setNeed(''); setFlag(''); };

  return html`<div class="page">
    <div class="page-head"><h1>Danh sách lead <span class="count">${filtered.length}</span></h1>
      <button class="btn" onClick=${exportCsv}>⬇ Xuất CSV</button></div>
    <div class="filters">
      <input class="search" placeholder="Tìm tên, công ty, SĐT, email, ghi chú…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <${Select} value=${stage} onChange=${setStage} placeholder="Mọi giai đoạn" options=${[{ value: 'open', label: 'Đang mở (chưa chốt)' }, ...U.STAGES.map((s) => ({ value: s.id, label: s.label }))]} />
      <${Select} value=${assignee} onChange=${setAssignee} placeholder="Mọi người phụ trách" options=${[{ value: user.id, label: 'Của tôi' }, { value: '_none', label: 'Chưa giao' }, ...salesPeople(profiles).filter((p) => p.id !== user.id).map((p) => ({ value: p.id, label: p.full_name }))]} />
      <${Select} value=${flag} onChange=${setFlag} placeholder="Mọi tình trạng" options=${Object.entries(FLAG_LABELS).filter(([k]) => k !== 'unassigned').map(([value, label]) => ({ value, label }))} />
      <${Select} value=${need} onChange=${setNeed} placeholder="Mọi nhu cầu" options=${settings.needs} />
      <${Select} value=${source} onChange=${setSource} placeholder="Mọi nguồn" options=${settings.sources} />
      <${Select} value=${sort} onChange=${setSort} options=${[{ value: 'created', label: 'Sắp xếp: Mới tạo' }, { value: 'followup', label: 'Sắp xếp: Follow-up gần nhất' }, { value: 'touch', label: 'Sắp xếp: Lâu chưa tương tác' }, { value: 'name', label: 'Sắp xếp: Tên A–Z' }]} />
      <button class="link" onClick=${clear}>Xoá lọc</button>
    </div>
    ${isMgr && sel.size > 0 && html`<div class="bulkbar">
      <b>Đã chọn ${sel.size}</b>
      <${Select} value="" placeholder="Giao cho…" options=${[...salesPeople(profiles).map((p) => ({ value: p.id, label: p.full_name })), { value: '_none', label: '— Bỏ giao —' }]}
        onChange=${async (v) => { if (!v) return; try { await bulkAssign([...sel], v === '_none' ? null : v); notify(`Đã giao ${sel.size} lead`); setSel(new Set()); } catch (e) { notify(e.message, 'err'); } }} />
      <${Select} value=${bulkTo} onChange=${setBulkTo} placeholder="Chuyển giai đoạn…" options=${U.STAGES.map((s) => ({ value: s.id, label: s.label }))} />
      ${bulkTo === 'lost' && html`<${Select} value="" placeholder="Lý do thất bại…" options=${settings.lost_reasons}
        onChange=${async (r) => { if (!r) return; try { await bulkStage([...sel], 'lost', r); notify(`Đã chuyển ${sel.size} lead sang Thất bại`); setSel(new Set()); setBulkTo(''); } catch (e) { notify(e.message, 'err'); } }} />`}
      ${bulkTo && bulkTo !== 'lost' && html`<button class="btn" onClick=${async () => { try { await bulkStage([...sel], bulkTo); notify(`Đã chuyển ${sel.size} lead`); setSel(new Set()); setBulkTo(''); } catch (e) { notify(e.message, 'err'); } }}>Áp dụng</button>`}
      <button class="link" onClick=${() => setSel(new Set())}>Bỏ chọn</button>
    </div>`}
    <div class="table-wrap"><table class="table leads">
      <thead><tr>
        ${isMgr && html`<th class="chk"><input type="checkbox" checked=${allSel} onChange=${() => setSel(allSel ? new Set() : new Set(filtered.slice(0, limit).map((l) => l.id)))} /></th>`}
        <th>Khách hàng</th><th>SĐT</th><th>Nhu cầu</th><th>Nguồn</th><th>Giai đoạn</th><th>Phụ trách</th><th>Follow-up</th><th>Tương tác cuối</th><th></th>
      </tr></thead>
      <tbody>
        ${filtered.slice(0, limit).map((l) => html`<tr key=${l.id} onClick=${() => openLead(l.id)} class=${sel.has(l.id) ? 'sel' : ''}>
          ${isMgr && html`<td class="chk" onClick=${(e) => e.stopPropagation()}><input type="checkbox" checked=${sel.has(l.id)} onChange=${() => toggle(l.id)} /></td>`}
          <td data-l="Khách hàng"><b>${l.name}</b>${l.company && l.company !== l.name && html`<div class="muted small">${l.company}</div>`}</td>
          <td data-l="SĐT">${l.phone || html`<span class="muted">—</span>`}</td>
          <td data-l="Nhu cầu">${l.need || ''}</td>
          <td data-l="Nguồn" class="small">${l.source || ''}</td>
          <td data-l="Giai đoạn"><${StagePill} stage=${l.stage} /></td>
          <td data-l="Phụ trách">${people[l.assignee_id]?.full_name || html`<span class="badge info">Chưa giao</span>`}</td>
          <td data-l="Follow-up"><${FollowBadge} lead=${l} settings=${settings} /></td>
          <td data-l="Tương tác"><${LastTouch} lead=${l} settings=${settings} /></td>
          <td><${ContactButtons} ctx=${ctx} lead=${l} compact onLogged=${() => openLead(l.id)} /></td>
        </tr>`)}
      </tbody>
    </table></div>
    ${filtered.length === 0 && html`<div class="empty">Không có lead phù hợp bộ lọc.</div>`}
    ${filtered.length > limit && html`<div class="center"><button class="btn" onClick=${() => setLimit(limit + 100)}>Xem thêm (${filtered.length - limit})</button></div>`}
  </div>`;
}

// ---------------------------------------------------------------------------
// Pipeline (Kanban)
// ---------------------------------------------------------------------------
function PipelineView({ ctx }) {
  const { leads, user, profiles, people, settings, openLead, need } = ctx;
  const [who, setWho] = useState('');
  const [needF, setNeedF] = useState('');
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [move, setMove] = useState(null);
  const pool = leads.filter((l) => (!who || (who === '_none' ? !l.assignee_id : l.assignee_id === who)) && (!needF || l.need === needF));
  const since = U.addDays(-60);

  return html`<div class="page wide">
    <div class="page-head"><h1>Pipeline</h1>
      <div class="filters inline">
        <${Select} value=${who} onChange=${setWho} placeholder="Cả phòng" options=${[{ value: user.id, label: 'Của tôi' }, { value: '_none', label: 'Chưa giao' }, ...salesPeople(profiles).filter((p) => p.id !== user.id).map((p) => ({ value: p.id, label: p.full_name }))]} />
        <${Select} value=${needF} onChange=${setNeedF} placeholder="Mọi nhu cầu" options=${settings.needs} />
      </div>
    </div>
    <p class="muted small hint-drag">Kéo thẻ sang cột khác để chuyển giai đoạn. Cột Chốt / Thất bại hiển thị 60 ngày gần nhất.</p>
    <div class="board">
      ${U.STAGES.map((s) => {
        let items = pool.filter((l) => l.stage === s.id);
        if (!U.isOpen(s.id)) items = items.filter((l) => (l.updated_at || l.created_at).slice(0, 10) >= since);
        items.sort((a, b) => (a.next_followup || '9999').localeCompare(b.next_followup || '9999'));
        return html`<div class=${'col' + (over === s.id ? ' over' : '')} key=${s.id}
          onDragOver=${(e) => { e.preventDefault(); setOver(s.id); }}
          onDragLeave=${() => setOver(null)}
          onDrop=${(e) => { e.preventDefault(); setOver(null); const l = leads.find((x) => x.id === drag); if (l && l.stage !== s.id) setMove({ lead: l, stage: s.id }); setDrag(null); }}>
          <div class="col-head" style=${`--c:${s.color}`}><span>${s.label}</span><b>${items.length}</b></div>
          <div class="col-body">
            ${items.slice(0, 60).map((l) => html`<div class="card" key=${l.id} draggable="true" onDragStart=${() => setDrag(l.id)} onClick=${() => openLead(l.id)}>
              <b>${l.name}</b>
              ${l.company && l.company !== l.name && html`<div class="muted small">${l.company}</div>`}
              <div class="card-foot">
                ${l.need && html`<span class="tag">${l.need}</span>`}
                <${FollowBadge} lead=${l} settings=${settings} />
                <span class="mini-av" title=${people[l.assignee_id]?.full_name || 'Chưa giao'}>${l.assignee_id ? initials(people[l.assignee_id]?.full_name) : '?'}</span>
              </div>
            </div>`)}
            ${items.length > 60 && html`<div class="muted small center">+${items.length - 60} lead nữa</div>`}
          </div>
        </div>`;
      })}
    </div>
    ${move && html`<${StageModal} ctx=${ctx} lead=${move.lead} stage=${move.stage} onClose=${() => setMove(null)} />`}
  </div>`;
}

function StageModal({ ctx, lead, stage, onClose }) {
  const { settings, logActivity, notify } = ctx;
  const [fu, setFu] = useState(lead.next_followup && lead.next_followup >= U.todayStr() ? lead.next_followup : U.addDays(2));
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const open = U.isOpen(stage);
  async function submit(e) {
    e.preventDefault();
    if (open && !fu) return setErr('Cần hẹn ngày follow-up tiếp theo');
    if (stage === 'lost' && !reason) return setErr('Chọn lý do thất bại');
    try {
      await logActivity(lead, { type: 'note', content: note, stage, next_followup: fu, lost_reason: reason });
      notify(`Đã chuyển sang "${U.stageOf(stage).label}"`);
      onClose();
    } catch (e) {
      setErr(e.message);
    }
  }
  return html`<${Modal} title=${`${lead.name}: ${U.stageOf(lead.stage).label} → ${U.stageOf(stage).label}`} onClose=${onClose}>
    <form class="form" onSubmit=${submit}>
      ${open && html`<${FollowupInput} value=${fu} onChange=${setFu} />`}
      ${stage === 'lost' && html`<label>Lý do thất bại *<${Select} value=${reason} onChange=${setReason} placeholder="Chọn lý do" options=${settings.lost_reasons} /></label>`}
      ${stage === 'won' && html`<p class="note">🎉 Chúc mừng! Lead sẽ không còn nhắc follow-up. Nhớ bàn giao thông tin cho bộ phận vận hành & kế toán.</p>`}
      <label>Ghi chú (không bắt buộc)<textarea rows="3" value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="VD: Khách đồng ý báo giá, hẹn ký HĐ tuần sau" /></label>
      ${err && html`<div class="err">${err}</div>`}
      <div class="row end"><button type="button" class="btn" onClick=${onClose}>Huỷ</button><button class="btn primary">Xác nhận</button></div>
    </form>
  <//>`;
}

// ---------------------------------------------------------------------------
// Chi tiết lead
// ---------------------------------------------------------------------------
function LeadDrawer({ ctx, lead, onClose }) {
  const { people, settings, isMgr, profiles, logActivity, updateLead, deleteLead, notify, leads, openLead, customers, openCustomer, startConvert } = ctx;
  const cus = customers.find((c) => c.id === lead.customer_id);
  const [acts, setActs] = useState(null);
  const [type, setType] = useState('call');
  const [content, setContent] = useState('');
  const [stage, setStage] = useState(lead.stage);
  const [fu, setFu] = useState(lead.next_followup && lead.next_followup >= U.todayStr() ? lead.next_followup : U.addDays(2));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const noteRef = useRef();

  const loadActs = () => store.listActivities(lead.id).then(setActs, (e) => notify(e.message, 'err'));
  useEffect(() => {
    loadActs();
    setStage(lead.stage);
  }, [lead.id, lead.last_activity_at, lead.stage]);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && !document.querySelector('.overlay') && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  const finalOpen = U.isOpen(stage);
  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!content.trim() && stage === lead.stage && fu === lead.next_followup) return setErr('Nhập nội dung trao đổi');
    if (finalOpen && !fu) return setErr('Cần hẹn ngày follow-up tiếp theo');
    if (finalOpen && fu < U.todayStr()) return setErr('Ngày follow-up phải từ hôm nay trở đi');
    if (stage === 'lost' && !reason) return setErr('Chọn lý do thất bại');
    setBusy(true);
    try {
      await logActivity(lead, { type, content, stage, next_followup: fu, lost_reason: reason });
      setContent('');
      notify('Đã lưu tương tác');
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  const startLog = (t) => {
    setType(t);
    setTimeout(() => noteRef.current?.focus(), 50);
  };

  const dups = U.findDuplicates(leads, lead, lead.id);

  return html`<div class="drawer-overlay" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
    <aside class="drawer" role="dialog" aria-label=${lead.name}>
      <div class="drawer-head">
        <div>
          <h2>${lead.name}</h2>
          <div class="muted">${[lead.company !== lead.name && lead.company, lead.customer_type].filter(Boolean).join(' · ')}</div>
          <div class="lrow-sub"><${StagePill} stage=${lead.stage} /> ${lead.need && html`<span class="tag">${lead.need}</span>`} <${FollowBadge} lead=${lead} settings=${settings} /></div>
        </div>
        <button class="x" onClick=${onClose} aria-label="Đóng">×</button>
      </div>
      <div class="drawer-body">
        ${dups.length > 0 && html`<div class="dupwarn">⚠ Có thể trùng với: ${dups.slice(0, 3).map((d) => html`<button class="link" onClick=${() => openLead(d.id)}>${d.name}${d.company ? ' (' + d.company + ')' : ''}</button> `)}</div>`}
        ${lead.stage === 'won' && !lead.customer_id && html`<div class="suggest">🎉 Lead đã chốt nhưng chưa lưu vào <b>Khách hàng</b> — lưu để theo dõi giải, chăm sóc & tặng quà về sau. <button class="btn sm" onClick=${() => startConvert(lead)}>Lưu vào khách hàng</button></div>`}
        ${cus && html`<div class="note">🏢 Thuộc khách hàng <button class="link" onClick=${() => openCustomer(cus.id)}>${cus.name}</button></div>`}
        ${ctx.events.filter((e) => e.lead_id === lead.id).map((e) => html`<div class="mini click" key=${e.id} onClick=${() => ctx.openEvent(e)}><div class="mini-main">🏆 <b>${e.name}</b> <span class="muted small">${U.eventWhen(e)}</span>${e.next_action && html`<div class="small">➡ ${e.next_action}</div>`}</div><${EventStatusPill} status=${e.status} /></div>`)}
        ${['quoted', 'negotiating'].includes(lead.stage) && !ctx.events.some((e) => e.lead_id === lead.id) && html`<div class="suggest">🏆 Đang báo giá / đàm phán — tạo <b>giải đấu</b> để theo dõi như sheet "DS Giải đấu". <button class="btn sm" onClick=${() => ctx.openEvent({ lead })}>Tạo giải đấu</button></div>`}
        <${ContactButtons} ctx=${ctx} lead=${lead} onLogged=${startLog} />

        <form class="logbox" onSubmit=${submit}>
          <div class="chips">
            ${U.ACTIVITY_TYPES.map((t) => html`<button type="button" class=${'chip' + (type === t.id ? ' on' : '')} onClick=${() => setType(t.id)}>${t.icon} ${t.label}</button>`)}
          </div>
          <textarea ref=${noteRef} rows="3" placeholder="Nội dung trao đổi: khách nói gì, cần gì, bước tiếp theo…" value=${content} onInput=${(e) => setContent(e.target.value)} />
          <div class="grid2">
            <label>Giai đoạn<${Select} value=${stage} onChange=${setStage} options=${U.STAGES.map((s) => ({ value: s.id, label: s.label }))} /></label>
            ${stage === 'lost'
              ? html`<label>Lý do thất bại *<${Select} value=${reason} onChange=${setReason} placeholder="Chọn lý do" options=${settings.lost_reasons} /></label>`
              : finalOpen ? html`<div />` : html`<div />`}
          </div>
          ${finalOpen && html`<${FollowupInput} value=${fu} onChange=${setFu} />`}
          ${err && html`<div class="err">${err}</div>`}
          <div class="row end"><button class="btn primary" disabled=${busy}>${busy ? 'Đang lưu…' : 'Lưu tương tác'}</button></div>
        </form>

        <div class="section-head"><h3>Thông tin</h3><button class="link" onClick=${() => setEdit(!edit)}>${edit ? 'Đóng' : '✎ Sửa'}</button></div>
        ${edit
          ? html`<${LeadForm} ctx=${ctx} initial=${lead} submitLabel="Lưu thay đổi" onCancel=${() => setEdit(false)}
              onSubmit=${async (data) => { await updateLead(lead, data); notify('Đã cập nhật'); setEdit(false); }} />`
          : html`<dl class="infolist">
              <dt>Điện thoại</dt><dd>${lead.phone || '—'}</dd>
              <dt>Email</dt><dd>${lead.email || '—'}</dd>
              ${lead.facebook && html`<dt>Facebook</dt><dd>${/^https?:/.test(lead.facebook) ? html`<a href=${lead.facebook} target="_blank" rel="noopener">${lead.facebook}</a>` : lead.facebook}</dd>`}
              <dt>Nguồn</dt><dd>${lead.source || '—'}</dd>
              <dt>Khu vực</dt><dd>${lead.region || '—'}</dd>
              <dt>Quy mô</dt><dd>${lead.headcount ? lead.headcount + ' người' : '—'}</dd>
              <dt>Thời gian dự kiến</dt><dd>${lead.event_time || '—'}</dd>
              <dt>Phụ trách</dt><dd>${isMgr
                ? html`<${Select} value=${lead.assignee_id || ''} placeholder="— Chưa giao —" options=${salesPeople(profiles).map((p) => ({ value: p.id, label: p.full_name }))}
                    onChange=${async (v) => { try { await updateLead(lead, { assignee_id: v || null }); notify('Đã cập nhật người phụ trách'); } catch (e) { notify(e.message, 'err'); } }} />`
                : people[lead.assignee_id]?.full_name || 'Chưa giao (chờ Trưởng KD)'}</dd>
              ${lead.stage === 'lost' && html`<dt>Lý do thất bại</dt><dd>${lead.lost_reason}</dd>`}
              <dt>Ngày tạo</dt><dd>${U.fmtDate(lead.created_at)} · ${people[lead.created_by]?.full_name || ''}</dd>
              ${lead.notes && html`<dt>Ghi chú</dt><dd class="pre">${lead.notes}</dd>`}
            </dl>`}

        <div class="section-head"><h3>Lịch sử tương tác</h3></div>
        ${acts === null ? html`<div class="muted">Đang tải…</div>` : acts.length === 0 ? html`<div class="empty">Chưa có tương tác</div>` : html`<ol class="timeline">
          ${acts.map((a) => { const t = U.activityType(a.type); return html`<li class=${'t-' + a.type}>
            <span class="t-ic">${t.icon}</span>
            <div><div class="t-head"><b>${t.label}</b><span class="muted small">${people[a.created_by]?.full_name || 'Hệ thống'} · ${U.fmtDateTime(a.created_at)}</span></div>
            ${a.content && html`<div class="pre">${a.content}</div>`}</div>
          </li>`; })}
        </ol>`}
        ${isMgr && html`<div class="danger-zone"><button class="link danger" onClick=${async () => { if (confirm(`Xoá vĩnh viễn lead "${lead.name}" và toàn bộ lịch sử?`)) { try { await deleteLead(lead); notify('Đã xoá lead'); } catch (e) { notify(e.message, 'err'); } } }}>Xoá lead</button></div>`}
      </div>
    </aside>
  </div>`;
}

function LeadForm({ ctx, initial = {}, onSubmit, onCancel, submitLabel, withNote, dupCheck }) {
  const { settings, profiles, isMgr, leads, openLead } = ctx;
  const [d, setD] = useState({
    name: '', company: '', customer_type: '', phone: '', email: '', facebook: '', source: '', need: '', region: '',
    headcount: '', event_time: '', notes: '', ...initial,
  });
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [force, setForce] = useState(false);
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: typeof v === 'string' ? v : v.target.value }));
  const dups = dupCheck ? U.findDuplicates(leads, d, initial.id) : [];

  async function submit(e) {
    e.preventDefault();
    if (!d.name.trim()) return setErr('Nhập tên khách hàng');
    if (!d.phone && !d.email && !d.facebook) return setErr('Cần ít nhất SĐT, email hoặc Facebook để follow-up');
    if (dups.length && !force) return setErr('Lead này có thể đã tồn tại — kiểm tra lại hoặc bấm "Vẫn tạo mới"');
    setBusy(true);
    setErr('');
    try {
      const { id, created_at, created_by, updated_at, last_activity_at, stage, lost_reason, ...rest } = d;
      await onSubmit({ ...rest, name: d.name.trim() }, note);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  return html`<form class="form" onSubmit=${submit}>
    <div class="grid2">
      <label>Tên người liên hệ *<input value=${d.name} onInput=${set('name')} autofocus /></label>
      <label>Công ty / Đơn vị<input value=${d.company || ''} onInput=${set('company')} /></label>
      <label>Số điện thoại<input type="tel" value=${d.phone || ''} onInput=${set('phone')} placeholder="09xx xxx xxx" /></label>
      <label>Email<input type="email" value=${d.email || ''} onInput=${set('email')} /></label>
    </div>
    <label>Facebook <span class="muted small">(link hồ sơ / Messenger, hoặc tên FB nếu khách nhắn qua Page)</span><input value=${d.facebook || ''} onInput=${set('facebook')} placeholder="https://facebook.com/..." /></label>
    ${dups.length > 0 && html`<div class="dupwarn">⚠ Trùng SĐT/email/tên với: ${dups.slice(0, 3).map((x) => html`<button type="button" class="link" onClick=${() => openLead(x.id)}>${x.name}${x.company ? ' (' + x.company + ')' : ''}</button> `)}
      <label class="inline-check"><input type="checkbox" checked=${force} onChange=${(e) => setForce(e.target.checked)} /> Vẫn tạo mới</label></div>`}
    <div class="grid3">
      <label>Nguồn<${Select} value=${d.source} onChange=${set('source')} placeholder="Chọn" options=${settings.sources} /></label>
      <label>Nhu cầu<${Select} value=${d.need} onChange=${set('need')} placeholder="Chọn" options=${settings.needs} /></label>
      <label>Loại khách<${Select} value=${d.customer_type} onChange=${set('customer_type')} placeholder="Chọn" options=${settings.customer_types} /></label>
      <label>Khu vực<${Select} value=${d.region} onChange=${set('region')} placeholder="Chọn" options=${settings.regions} /></label>
      <label>Quy mô (người)<input type="number" min="0" value=${d.headcount ?? ''} onInput=${set('headcount')} /></label>
      <label>Thời gian dự kiến<input value=${d.event_time || ''} onInput=${set('event_time')} placeholder="VD: Tháng 11/2026" /></label>
    </div>
    <label>Thuộc khách hàng cũ <span class="muted small">(nếu là khách đã từng tổ chức giải)</span>
      <${Select} value=${d.customer_id || ''} onChange=${set('customer_id')} placeholder="— Khách mới —" options=${ctx.customers.slice().sort((a, b) => a.name.localeCompare(b.name, 'vi')).map((c) => ({ value: c.id, label: c.name }))} /></label>
    ${withNote && isMgr && html`<label>Giao cho<${Select} value=${d.assignee_id || ''} onChange=${set('assignee_id')} placeholder="— Để vào hàng chờ —" options=${salesPeople(profiles).map((p) => ({ value: p.id, label: p.full_name }))} /></label>`}
    ${withNote && !isMgr && html`<p class="note">${d.customer_id ? 'Lead của khách cũ sẽ tự giao cho người đang phụ trách khách hàng đó.' : 'Lead mới sẽ vào hàng chờ, Trưởng KD sẽ giao người phụ trách.'}</p>`}
    ${withNote && html`<${FollowupInput} label="Hẹn liên hệ đầu tiên" value=${d.next_followup} onChange=${set('next_followup')} />`}
    <label>Ghi chú chung<textarea rows="2" value=${d.notes || ''} onInput=${set('notes')} /></label>
    ${withNote && html`<label>Nội dung trao đổi đầu tiên<textarea rows="2" value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="Khách hỏi gì, qua kênh nào…" /></label>`}
    ${err && html`<div class="err">${err}</div>`}
    <div class="row end">${onCancel && html`<button type="button" class="btn" onClick=${onCancel}>Huỷ</button>`}<button class="btn primary" disabled=${busy}>${busy ? 'Đang lưu…' : submitLabel}</button></div>
  </form>`;
}

function NewLeadModal({ ctx, onClose, initial }) {
  const { createLead, notify, openLead } = ctx;
  const cus = initial?.customer_id && ctx.customers.find((c) => c.id === initial.customer_id);
  return html`<${Modal} title=${cus ? `Cơ hội mới · ${cus.name}` : 'Thêm lead mới'} onClose=${onClose} wide>
    <${LeadForm} ctx=${ctx} withNote dupCheck=${!cus} submitLabel="Tạo lead" initial=${{ next_followup: U.todayStr(), ...(initial || {}) }} onCancel=${onClose}
      onSubmit=${async (data, note) => { const l = await createLead(data, note); notify('Đã tạo lead'); onClose(); openLead(l.id); }} />
  <//>`;
}

// ---------------------------------------------------------------------------
// Báo cáo
// ---------------------------------------------------------------------------
function ReportsView({ ctx }) {
  const { leads, profiles, people, settings } = ctx;
  const [period, setPeriod] = useState('90');
  const from = period === 'all' ? '' : period === 'month' ? U.todayStr().slice(0, 8) + '01' : period === 'year' ? U.todayStr().slice(0, 4) + '-01-01' : U.addDays(-Number(period));
  const pool = leads.filter((l) => !from || l.created_at.slice(0, 10) >= from);
  const won = pool.filter((l) => l.stage === 'won').length;
  const lost = pool.filter((l) => l.stage === 'lost').length;
  const closed = won + lost;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');

  const groupBy = (keyFn, labelFn = (k) => k || 'Chưa rõ') => {
    const m = new Map();
    for (const l of pool) {
      const k = keyFn(l) || '';
      const r = m.get(k) || { k, label: labelFn(k), total: 0, won: 0, lost: 0, open: 0 };
      r.total++;
      if (l.stage === 'won') r.won++;
      else if (l.stage === 'lost') r.lost++;
      else r.open++;
      m.set(k, r);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  };
  const bySource = groupBy((l) => l.source);
  const byNeed = groupBy((l) => l.need);
  const byPerson = groupBy((l) => l.assignee_id, (k) => people[k]?.full_name || 'Chưa giao');
  const reasons = groupBy((l) => (l.stage === 'lost' ? l.lost_reason : null)).filter((r) => r.k);
  const funnel = U.STAGES.map((s) => ({ s, n: pool.filter((l) => l.stage === s.id).length }));
  const maxF = Math.max(1, ...funnel.map((f) => f.n));

  const Table = ({ title, rows }) => html`<section class="section card-sec">
    <h2>${title}</h2>
    <div class="table-wrap"><table class="table compact">
      <thead><tr><th></th><th>Lead</th><th>Đang mở</th><th>Chốt</th><th>Thất bại</th><th>Tỉ lệ chốt*</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr><td>${r.label}</td><td>${r.total}</td><td>${r.open}</td><td class="num good">${r.won}</td><td>${r.lost}</td><td><b>${pct(r.won, r.won + r.lost)}</b></td></tr>`)}</tbody>
    </table></div>
  </section>`;

  return html`<div class="page">
    <div class="page-head"><h1>Báo cáo</h1>
      <${Select} value=${period} onChange=${setPeriod} options=${[{ value: 'month', label: 'Tháng này' }, { value: '30', label: '30 ngày qua' }, { value: '90', label: '90 ngày qua' }, { value: 'year', label: 'Năm nay' }, { value: 'all', label: 'Toàn bộ' }]} />
    </div>
    <div class="kpis">
      <div class="kpi"><b>${pool.length}</b><span>Lead mới</span></div>
      <div class="kpi"><b>${pool.length - closed}</b><span>Đang xử lý</span></div>
      <div class="kpi good"><b>${won}</b><span>Đã chốt</span></div>
      <div class="kpi"><b>${lost}</b><span>Thất bại</span></div>
      <div class="kpi info"><b>${pct(won, closed)}</b><span>Tỉ lệ chốt*</span></div>
    </div>
    <p class="muted small">* Tỉ lệ chốt = Chốt ÷ (Chốt + Thất bại), tính trên lead tạo trong kỳ.</p>
    <section class="section card-sec"><h2>Phễu theo giai đoạn</h2>
      <div class="funnel">${funnel.map((f) => html`<div class="frow"><span>${f.s.label}</span><div class="fbar"><i style=${`width:${(f.n / maxF) * 100}%;background:${f.s.color}`}></i></div><b>${f.n}</b></div>`)}</div>
    </section>
    <div class="grid-rep">
      <${Table} title="Theo nhân viên" rows=${byPerson} />
      <${Table} title="Theo nguồn lead" rows=${bySource} />
      <${Table} title="Theo nhu cầu" rows=${byNeed} />
      <section class="section card-sec"><h2>Lý do thất bại</h2>
        ${reasons.length === 0 ? html`<div class="empty">Chưa có dữ liệu</div>` : html`<div class="funnel">${reasons.map((r) => html`<div class="frow"><span>${r.label}</span><div class="fbar"><i style=${`width:${(r.total / reasons[0].total) * 100}%`}></i></div><b>${r.total}</b></div>`)}</div>`}
      </section>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Cài đặt (Admin)
// ---------------------------------------------------------------------------
function SettingsView({ ctx }) {
  const { profiles, setProfiles, settings, setSettings, notify, user } = ctx;
  const [s, setS] = useState(settings);
  const listKeys = [['sources', 'Nguồn lead'], ['needs', 'Nhu cầu / bộ môn'], ['customer_types', 'Loại khách hàng'], ['regions', 'Khu vực'], ['lost_reasons', 'Lý do thất bại']];

  async function saveProfile(p, patch) {
    if (p.id === user.id && (patch.role && patch.role !== 'admin' || patch.active === false)) return notify('Không thể tự hạ quyền / khoá chính mình', 'err');
    try {
      const u = await store.updateProfile(p.id, patch);
      setProfiles((ps) => ps.map((x) => (x.id === u.id ? u : x)));
      notify('Đã cập nhật thành viên');
    } catch (e) {
      notify(e.message, 'err');
    }
  }
  async function resetPw(p) {
    const pw = prompt(`Mật khẩu tạm mới cho ${p.full_name} (tối thiểu 8 ký tự):`, genPassword());
    if (!pw) return;
    try {
      await store.adminUser({ action: 'reset_password', user_id: p.id, password: pw });
      notify(`Đã đặt lại mật khẩu cho ${p.full_name} — gửi mật khẩu tạm cho họ`);
    } catch (e) {
      notify(e.message, 'err');
    }
  }

  async function saveSettings() {
    try {
      const num = (v, d) => Math.max(1, parseInt(v, 10) || d);
      const patch = {
        care_stale_days: num(s.care_stale_days, 60), loyal_threshold: num(s.loyal_threshold, 2), vip_threshold: num(s.vip_threshold, 4), season_days: num(s.season_days, 90),
        occasions: (s.occasions || []).filter((o) => o.label && (o.for === 'birthday' || o.date)).map((o) => ({ ...o, before: num(o.before, 14), key: o.key || U.fold(o.label).replace(/[^a-z0-9]+/g, '-') })),
        stale_days: Math.max(1, parseInt(s.stale_days, 10) || 7), email_subject: s.email_subject, email_body: s.email_body, zalo_template: s.zalo_template, email_client: s.email_client };
      for (const [k] of listKeys) patch[k] = s[k];
      setSettings(await store.updateSettings(patch));
      notify('Đã lưu cài đặt');
    } catch (e) {
      notify(e.message, 'err');
    }
  }

  return html`<div class="page">
    <div class="page-head"><h1>Cài đặt</h1></div>
    <section class="section card-sec">
      <h2>Thành viên & phân quyền</h2>
      <p class="muted small"><b>Admin</b>: toàn quyền, cài đặt. <b>Trưởng KD</b>: giao lead, xoá lead, xem báo cáo đội. <b>Sale</b>: xem/sửa mọi lead, ghi tương tác; lead do sale tạo vào hàng chờ.</p>
      <div class="table-wrap"><table class="table compact">
        <thead><tr><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Hoạt động</th><th></th></tr></thead>
        <tbody>${profiles.map((p) => html`<tr key=${p.id}>
          <td><${InlineText} value=${p.full_name} onSave=${(v) => saveProfile(p, { full_name: v })} /></td>
          <td class="small">${p.email}</td>
          <td><${Select} value=${p.role} onChange=${(v) => saveProfile(p, { role: v })} options=${Object.entries(U.ROLES).map(([value, label]) => ({ value, label }))} /></td>
          <td><input type="checkbox" checked=${p.active} onChange=${(e) => saveProfile(p, { active: e.target.checked })} /></td>
          <td>${p.id !== user.id && html`<button class="link small" onClick=${() => resetPw(p)}>Đặt lại mật khẩu</button>`}</td>
        </tr>`)}</tbody>
      </table></div>
      <${AddMember} ctx=${ctx} />
    </section>

    <section class="section card-sec">
      <h2>Quy tắc follow-up</h2>
      <label class="inline">Cảnh báo "bỏ quên" khi lead không có tương tác sau
        <input type="number" min="1" class="short" value=${s.stale_days} onInput=${(e) => setS({ ...s, stale_days: e.target.value })} /> ngày</label>
    </section>

    <section class="section card-sec">
      <h2>Chăm sóc khách hàng cũ</h2>
      <label class="inline">Cảnh báo "lâu không liên hệ" sau
        <input type="number" min="1" class="short" value=${s.care_stale_days} onInput=${(e) => setS({ ...s, care_stale_days: e.target.value })} /> ngày</label>
      <label class="inline">Khách <b>Thân thiết</b> từ
        <input type="number" min="1" class="short" value=${s.loyal_threshold} onInput=${(e) => setS({ ...s, loyal_threshold: e.target.value })} /> giải; <b>VIP</b> từ
        <input type="number" min="1" class="short" value=${s.vip_threshold} onInput=${(e) => setS({ ...s, vip_threshold: e.target.value })} /> giải</label>
      <label class="inline">Nhắc "mùa giải" trước ngày kỷ niệm giải năm trước
        <input type="number" min="1" class="short" value=${s.season_days} onInput=${(e) => setS({ ...s, season_days: e.target.value })} /> ngày</label>
    </section>

    <section class="section card-sec">
      <h2>Dịp tặng quà</h2>
      <p class="muted small">Ngày dạng <code>MM-DD</code> lặp lại hằng năm (VD <code>10-20</code>). Lễ âm lịch (Tết, Trung thu) nhập ngày dương cụ thể <code>YYYY-MM-DD</code> và cập nhật mỗi năm.</p>
      <div class="table-wrap"><table class="table compact">
        <thead><tr><th>Dịp</th><th>Ngày</th><th>Nhắc trước (ngày)</th><th>Tặng cho</th><th></th></tr></thead>
        <tbody>${(s.occasions || []).map((o, i) => {
          const upd = (k) => (e) => { const occ = [...s.occasions]; occ[i] = { ...o, [k]: typeof e === 'string' ? e : e.target.value }; setS({ ...s, occasions: occ }); };
          return html`<tr key=${i}>
            <td><input value=${o.label} onInput=${upd('label')} /></td>
            <td>${o.for === 'birthday' ? html`<span class="muted small">Theo ngày sinh</span>` : html`<input class="w-date" value=${o.date} onInput=${upd('date')} placeholder="MM-DD" />`}</td>
            <td><input type="number" min="1" class="short" value=${o.before} onInput=${upd('before')} /></td>
            <td><${Select} value=${o.for} onChange=${upd('for')} options=${Object.entries(U.OCCASION_FOR).map(([value, label]) => ({ value, label }))} /></td>
            <td><button class="link danger" onClick=${() => setS({ ...s, occasions: s.occasions.filter((_, j) => j !== i) })}>Xoá</button></td>
          </tr>`; })}</tbody>
      </table></div>
      <button class="link" onClick=${() => setS({ ...s, occasions: [...(s.occasions || []), { key: '', label: '', date: '', before: 14, for: 'all' }] })}>＋ Thêm dịp</button>
    </section>

    <section class="section card-sec">
      <h2>Danh mục lựa chọn</h2>
      <p class="muted small">Mỗi dòng một giá trị.</p>
      <div class="grid-rep">${listKeys.map(([k, label]) => html`<label>${label}<textarea rows="6" value=${(s[k] || []).join('\n')} onInput=${(e) => setS({ ...s, [k]: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} /></label>`)}</div>
    </section>

    <section class="section card-sec">
      <h2>Mẫu tin nhắn</h2>
      <p class="muted small">Biến dùng được: <code>{ten}</code> <code>{cong_ty}</code> <code>{nhu_cau}</code> <code>{nhan_vien}</code></p>
      <label>Mở email bằng<${Select} value=${s.email_client} onChange=${(v) => setS({ ...s, email_client: v })} options=${[{ value: 'gmail', label: 'Gmail trên web' }, { value: 'mailto', label: 'Ứng dụng email mặc định (Outlook, Mail…)' }]} /></label>
      <label>Tiêu đề email<input value=${s.email_subject} onInput=${(e) => setS({ ...s, email_subject: e.target.value })} /></label>
      <label>Nội dung email<textarea rows="7" value=${s.email_body} onInput=${(e) => setS({ ...s, email_body: e.target.value })} /></label>
      <label>Tin nhắn Zalo (tự copy khi bấm nút Zalo)<textarea rows="3" value=${s.zalo_template} onInput=${(e) => setS({ ...s, zalo_template: e.target.value })} /></label>
    </section>
    <div class="row end sticky-save"><button class="btn primary" onClick=${saveSettings}>Lưu cài đặt</button></div>

    <${ImportSection} ctx=${ctx} />
  </div>`;
}

const genPassword = () => {
  const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = crypto.getRandomValues(new Uint32Array(10));
  return 'Fp-' + [...a].map((x) => c[x % c.length]).join('');
};

function AddMember({ ctx }) {
  const { setProfiles, notify } = ctx;
  const [open, setOpen] = useState(false);
  const [d, setD] = useState({ full_name: '', email: '', role: 'sales', password: genPassword() });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: typeof v === 'string' ? v : v.target.value }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { profile } = await store.adminUser({ action: 'create', ...d, email: d.email.trim() });
      setProfiles((ps) => [...ps.filter((p) => p.id !== profile.id), profile]);
      setDone({ ...d });
      setD({ full_name: '', email: '', role: 'sales', password: genPassword() });
      notify('Đã tạo tài khoản');
    } catch (err) {
      notify(err.message, 'err');
    }
    setBusy(false);
  }
  if (!open) return html`<div class="row"><button class="btn primary" onClick=${() => setOpen(true)}>＋ Thêm nhân viên</button></div>`;
  return html`<form class="form addmember" onSubmit=${submit}>
    <div class="grid2">
      <label>Họ tên *<input required value=${d.full_name} onInput=${set('full_name')} placeholder="VD: Nguyễn Văn Minh" /></label>
      <label>Email đăng nhập *<input required type="email" value=${d.email} onInput=${set('email')} /></label>
      <label>Vai trò<${Select} value=${d.role} onChange=${set('role')} options=${Object.entries(U.ROLES).map(([value, label]) => ({ value, label }))} /></label>
      <label>Mật khẩu tạm *<input required minlength="8" value=${d.password} onInput=${set('password')} /></label>
    </div>
    <div class="row end"><button type="button" class="btn" onClick=${() => { setOpen(false); setDone(null); }}>Đóng</button><button class="btn primary" disabled=${busy}>${busy ? 'Đang tạo…' : 'Tạo tài khoản'}</button></div>
    ${done && html`<div class="note">✅ Đã tạo tài khoản cho <b>${done.full_name}</b>. Gửi cho nhân viên:<br />
      Link: <code>${location.origin + location.pathname}</code><br />Email: <code>${done.email}</code> · Mật khẩu tạm: <code>${done.password}</code><br />
      <small>Nhân viên nên đổi mật khẩu sau lần đăng nhập đầu (menu avatar → Đổi mật khẩu).</small></div>`}
  </form>`;
}

function ImportSection({ ctx }) {
  const { profiles, notify, reload } = ctx;
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const byName = Object.fromEntries(profiles.map((p) => [U.fold(p.full_name), p.id]));
  const stageByLabel = Object.fromEntries(U.STAGES.flatMap((s) => [[s.id, s.id], [U.fold(s.label), s.id]]));
  const iso = (v) => (v ? new Date(v).toISOString() : undefined);

  const mapLead = (r) => {
    const created = iso(r.created_at);
    return {
      name: r.name, company: r.company, customer_type: r.customer_type, phone: r.phone, email: r.email, facebook: r.facebook, source: r.source,
      need: r.need, region: r.region, headcount: r.headcount, event_time: r.event_time,
      stage: stageByLabel[U.fold(r.stage)] || 'new', lost_reason: r.lost_reason,
      assignee_id: byName[U.fold(r.assignee_name)] || null, next_followup: r.next_followup || null, notes: r.notes,
      ...(created ? { created_at: created, last_activity_at: created } : {}),
      _assignee: r.assignee_name, _customer: r.customer_name,
    };
  };

  async function onFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    try {
      if (/\.json$/i.test(f.name)) {
        const b = JSON.parse(text);
        setData({ customers: b.customers || [], leads: (b.leads || []).filter((r) => r.name).map(mapLead) });
      } else setData({ customers: [], leads: U.csvParse(text).filter((r) => r.name).map(mapLead) });
    } catch (err) {
      notify('File không đúng định dạng: ' + err.message, 'err');
    }
  }
  const unmatched = data
    ? [...new Set([...data.leads.filter((r) => r._assignee && !r.assignee_id).map((r) => r._assignee), ...data.customers.filter((c) => c.owner_name && !byName[U.fold(c.owner_name)]).map((c) => c.owner_name),
        ...data.customers.flatMap((c) => c.events || []).filter((e) => e.pic_name && !byName[U.fold(e.pic_name)]).map((e) => e.pic_name)])]
    : [];

  async function run() {
    setBusy(true);
    try {
      const cusId = {};
      let nk = 0, ne = 0;
      for (const [i, c] of data.customers.entries()) {
        setProgress(`Khách hàng ${i + 1}/${data.customers.length}`);
        const { contacts = [], events = [], owner_name, ...fields } = c;
        const row = await store.insert('customers', { ...fields, owner_id: byName[U.fold(owner_name)] || null, last_care_at: iso(c.last_care_at) });
        cusId[U.fold(c.name)] = row.id;
        for (const k of contacts) { await store.insert('contacts', { ...k, customer_id: row.id }); nk++; }
        for (const { pic_name, ...ev } of events) { await store.insert('events', { ...ev, pic_id: byName[U.fold(pic_name)] || null, customer_id: row.id }); ne++; }
      }
      setProgress('Đang nhập lead…');
      const n = await store.importLeads(data.leads.map(({ _assignee, _customer, ...r }) => ({ ...r, customer_id: cusId[U.fold(_customer)] || null })));
      notify(`Đã nhập ${data.customers.length} khách hàng, ${ne} giải, ${nk} đầu mối, ${n} lead`);
      setData(null);
      await reload();
    } catch (e) {
      notify(e.message, 'err');
    }
    setProgress('');
    setBusy(false);
  }
  function template() {
    U.csvDownload('mau-nhap-lead.csv', [U.IMPORT_COLUMNS, ['Nguyễn Văn A', 'Công ty ABC', 'Doanh nghiệp', '0901234567', 'a@abc.vn', '', 'Telesale', 'Pickleball', 'Hà Nội', '80', 'Tháng 12/2026', 'Đã liên hệ', '', 'Minh', '2026-10-05', 'Ghi chú', '2026-09-20']]);
  }

  return html`<section class="section card-sec">
    <h2>Nhập dữ liệu</h2>
    <p class="muted small"><b>CSV</b>: danh sách lead (<button class="link" onClick=${template}>tải file mẫu</button>). <b>JSON</b>: gói dữ liệu đầy đủ (khách hàng + đầu mối + giải + lead) do <code>tools/convert_excel.py</code> tạo ra từ Excel cũ.
      Tên người phụ trách phải khớp họ tên thành viên ở trên.</p>
    <input type="file" accept=".csv,.json,text/csv,application/json" onChange=${onFile} />
    ${data && html`<div class="note">
      Sẵn sàng nhập <b>${data.customers.length}</b> khách hàng (${data.customers.reduce((a, c) => a + (c.events?.length || 0), 0)} giải) và <b>${data.leads.length}</b> lead.
      ${unmatched.length > 0 && html`<div class="err">Không tìm thấy thành viên: ${unmatched.join(', ')} — phần việc của họ sẽ ở trạng thái "Chưa giao". Tạo/đổi tên thành viên trước nếu muốn giao đúng người.</div>`}
      <div class="row"><button class="btn primary" disabled=${busy} onClick=${run}>${busy ? progress || 'Đang nhập…' : 'Nhập ngay'}</button><button class="btn" disabled=${busy} onClick=${() => setData(null)}>Huỷ</button></div>
    </div>`}
  </section>`;
}

// ---------------------------------------------------------------------------
(async () => {
  try {
    store = await createStore();
    render(html`<${App} />`, document.getElementById('app'));
  } catch (e) {
    document.getElementById('app').innerHTML = `<div class="splash">Không khởi động được ứng dụng: ${e.message}</div>`;
  }
})();
