import { html, useState, useEffect } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import * as U from './util.js';

export { html };

export const initials = (n) => {
  const w = String(n || '?').replace(/\(.*?\)/g, '').replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length > 1 ? w.slice(-2).map((x) => x[0]).join('') : w[0].slice(0, 2)).toUpperCase();
};

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  return html`<div class="overlay" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
    <div class=${'modal' + (wide ? ' wide' : '')} role="dialog" aria-label=${title}>
      <div class="modal-head"><h3>${title}</h3><button class="x" onClick=${onClose} aria-label="Đóng">×</button></div>
      <div class="modal-body">${children}</div>
    </div>
  </div>`;
}

export const StagePill = ({ stage }) => {
  const s = U.stageOf(stage);
  return html`<span class="pill" style=${`--c:${s.color}`}>${s.label}</span>`;
};

export function FollowBadge({ lead, settings }) {
  const f = U.leadFlags(lead, settings);
  if (!f.open) return html`<span class="muted">—</span>`;
  if (!lead.next_followup) return html`<span class="badge warn">Chưa hẹn</span>`;
  const cls = f.overdue ? 'bad' : f.dueToday ? 'warn' : 'ok';
  return html`<span class=${'badge ' + cls} title=${U.fmtDate(lead.next_followup)}>${U.relDay(lead.next_followup)}</span>`;
}

export function LastTouch({ lead, settings }) {
  const d = U.daysSince(lead.last_activity_at);
  const stale = U.leadFlags(lead, settings).stale;
  return html`<span class=${stale ? 'stale' : 'muted'} title=${U.fmtDateTime(lead.last_activity_at)}>${d === 0 ? 'Hôm nay' : d + ' ngày trước'}${stale ? ' ⚠' : ''}</span>`;
}

export function ContactButtons({ ctx, lead, onLogged, compact }) {
  const { settings, user, notify } = ctx;
  const phone = U.normalizePhone(lead.phone);
  const act = (type) => onLogged && onLogged(type);
  async function zalo() {
    const msg = U.fillTemplate(settings.zalo_template, lead, user);
    try {
      await navigator.clipboard.writeText(msg);
      notify('Đã copy tin nhắn mẫu — dán vào Zalo');
    } catch {}
    act('zalo');
  }
  return html`<div class=${'contact' + (compact ? ' compact' : '')} onClick=${(e) => e.stopPropagation()}>
    <a class=${'cbtn' + (phone ? '' : ' dis')} href=${phone ? 'tel:' + phone : undefined} onClick=${() => phone && act('call')} title="Gọi">📞${!compact && ' Gọi'}</a>
    <a class=${'cbtn' + (phone ? '' : ' dis')} href=${phone ? 'https://zalo.me/' + phone : undefined} target="_blank" rel="noopener" onClick=${() => phone && zalo()} title="Zalo">💬${!compact && ' Zalo'}</a>
    ${/^https?:\/\//.test(lead.facebook || '') && html`<a class="cbtn" href=${lead.facebook} target="_blank" rel="noopener" onClick=${() => act('note')} title="Facebook / Messenger">📘${!compact && ' Facebook'}</a>`}
    <a class=${'cbtn' + (lead.email ? '' : ' dis')} href=${lead.email ? U.emailLink(lead, settings, user) : undefined} target="_blank" rel="noopener" onClick=${() => lead.email && act('email')} title="Email">✉️${!compact && ' Email'}</a>
  </div>`;
}

export function Select({ value, onChange, options, placeholder, disabled }) {
  return html`<select value=${value || ''} disabled=${disabled} onChange=${(e) => onChange(e.target.value)}>
    ${placeholder != null && html`<option value="">${placeholder}</option>`}
    ${options.map((o) => (typeof o === 'string' ? html`<option value=${o}>${o}</option>` : html`<option value=${o.value}>${o.label}</option>`))}
    ${value && !options.some((o) => (typeof o === 'string' ? o : o.value) === value) && html`<option value=${value}>${value}</option>`}
  </select>`;
}

export const salesPeople = (profiles) => profiles.filter((p) => p.active && p.crm_access !== false);

export function Section({ title, count, tone, hint, empty, children }) {
  return html`<section class="section">
    <div class="section-head"><h2>${title} <span class=${'count ' + (tone || '')}>${count}</span></h2>${hint && html`<small class="muted">${hint}</small>`}</div>
    ${count === 0 && empty ? html`<div class="empty">${empty}</div>` : html`<div class="rows">${children}</div>`}
  </section>`;
}

const FU_CHIPS = [[1, '+1 ngày'], [3, '+3 ngày'], [7, '+1 tuần'], [14, '+2 tuần']];
export const CARE_CHIPS = [[7, '+1 tuần'], [30, '+1 tháng'], [90, '+3 tháng'], [180, '+6 tháng']];
export function FollowupInput({ value, onChange, label = 'Hẹn follow-up tiếp theo *', chips = FU_CHIPS }) {
  return html`<label>${label}
    <div class="fu">
      <input type="date" value=${value || ''} min=${U.todayStr()} onInput=${(e) => onChange(e.target.value)} />
      ${chips.map(([n, t]) => html`<button type="button" class=${'chip' + (value === U.addDays(n) ? ' on' : '')} onClick=${() => onChange(U.addDays(n))}>${t}</button>`)}
    </div>
  </label>`;
}

export function InlineText({ value, onSave }) {
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);
  return html`<input class="inline-input" value=${v} onInput=${(e) => setV(e.target.value)} onBlur=${() => v.trim() && v !== value && onSave(v.trim())} />`;
}

