// Lợi nhuận tháng (chỉ người có quyền tài chính): các giải trong tháng, chi phí cố định, lãi ròng, hòa vốn, biểu đồ 12 tháng.
import { html, useState, useEffect } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import { money } from './ev-core.js';
import { eventProfit, monthProfit, fixedCosts, insOf, FIXED_DEFAULTS } from './finance-core.js';
import * as U from './util.js';
import { ImportPastEvent, canDeleteEvent, deleteEvent } from './past-import.js';

const ok = ({ data, error }) => {
  if (error) throw new Error(/row-level security|permission/i.test(error.message) ? 'Bạn không có quyền xem số liệu tài chính' : error.message);
  return data;
};
const pct = (v) => (v == null || !Number.isFinite(v) ? '-' : (v * 100).toFixed(1).replace('.', ',') + '%');
const thisMonth = () => U.todayStr().slice(0, 7);
const shiftMonth = (m, d) => {
  const [y, mo] = m.split('-').map(Number);
  const t = new Date(y, mo - 1 + d, 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
};
const label = (m) => `${m.slice(5)}/${m.slice(0, 4)}`;
const num = (v) => (v === '' || v == null ? 0 : Number(String(v).replace(/[^\d.,-]/g, '').replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0);
const withDefaults = (d) => ({ ...FIXED_DEFAULTS, ...(d || {}), staff: (d?.staff || []).map((s) => ({ ...s })), others: (d?.others || []).map((o) => ({ ...o })) });

export function ProfitView({ ctx }) {
  const sb = ctx.store.sb;
  const [data, setData] = useState(null);
  const [month, setMonth] = useState(thisMonth());
  const [f, setF] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);

  async function load() {
    try {
      const [events, items, payments, months] = await Promise.all([
        sb.from('ev_events').select('*').order('event_date').then(ok),
        sb.from('ev_items').select('*').then(ok),
        sb.from('ev_payments').select('*').then(ok),
        sb.from('fin_months').select('*').then(ok),
      ]);
      setData({ events, items, payments, months: Object.fromEntries(months.map((m) => [m.month, m.data])) });
    } catch (e) {
      ctx.notify(e.message, 'err');
      setData({ events: [], items: [], payments: [], months: {}, error: e.message });
    }
  }
  useEffect(() => {
    if (sb) load();
  }, []);
  useEffect(() => {
    if (data) {
      setF(withDefaults(data.months[month]));
      setDirty(false);
    }
  }, [month, data]);

  if (!sb) return html`<div class="page"><div class="empty">Trang Lợi nhuận tháng chỉ chạy ở bản thật (đã kết nối Supabase).</div></div>`;
  if (!data || !f) return html`<div class="splash">Đang tải…</div>`;

  const profitOf = (e) => eventProfit(e, data.items.filter((i) => i.event_id === e.id), data.payments.filter((p) => p.event_id === e.id));
  const eventsIn = (m) => data.events.filter((e) => e.event_date && e.event_date.slice(0, 7) === m && e.status !== 'cancelled');
  const rows = eventsIn(month).map((e) => ({ e, p: profitOf(e) }));
  const r = monthProfit(rows.map((x) => x.p), f);
  const fc = fixedCosts(f);
  const set = (patch) => {
    setF({ ...f, ...patch });
    setDirty(true);
  };
  const setStaff = (i, patch) => set({ staff: f.staff.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setOther = (i, patch) => set({ others: f.others.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const prevMonth = Object.keys(data.months).filter((m) => m < month).sort().pop();

  async function save() {
    setBusy(true);
    try {
      const clean = {
        ...f,
        staff: f.staff.filter((s) => (s.name || '').trim() || s.salary).map((s) => ({ name: (s.name || '').trim(), salary: num(s.salary), insured: !!s.insured, ins_amount: s.insured && s.ins_amount !== '' && s.ins_amount != null ? num(s.ins_amount) : null })),
        others: f.others.filter((o) => (o.name || '').trim() || o.amount).map((o) => ({ name: (o.name || '').trim(), amount: num(o.amount) })),
        ins_rate: Number(f.ins_rate) || 0, office_per_person: num(f.office_per_person), ads: num(f.ads), cit_rate: Number(f.cit_rate) || 0,
      };
      ok(await sb.from('fin_months').upsert({ month, data: clean, updated_at: new Date().toISOString() }));
      ctx.notify('Đã lưu chi phí cố định tháng ' + label(month));
      await load();
    } catch (e) {
      ctx.notify(e.message, 'err');
    }
    setBusy(false);
  }

  // 12 tháng gần nhất (kết thúc ở tháng đang xem)
  const months12 = Array.from({ length: 12 }, (_, i) => shiftMonth(month, i - 11));
  const series = months12.map((m) => ({
    m,
    gross: eventsIn(m).reduce((a, e) => a + profitOf(e).gross, 0),
    fixed: m === month ? fc.total : data.months[m] ? fixedCosts(data.months[m]).total : null,
  }));

  async function removeEvent(e) {
    if (!confirm(`Xoá giải "${e.name}" cùng toàn bộ hạng mục, thanh toán, checklist và hồ sơ? Không khôi phục được.`)) return;
    try {
      await deleteEvent(ctx, e);
      ctx.notify('Đã xoá giải');
      load();
    } catch (x) {
      ctx.notify(x.message, 'err');
    }
  }

  return html`<div class="page wide">
    <div class="page-head">
      <div><h1>💰 Lợi nhuận tháng</h1><div class="muted">Lãi gộp các giải trong tháng (theo ngày tổ chức) trừ chi phí cố định. Chỉ người có quyền tài chính thấy trang này.</div></div>
      <div class="row">
        <button class="btn" onClick=${() => setMonth(shiftMonth(month, -1))}>‹</button>
        <input type="month" value=${month} onInput=${(e) => e.target.value && setMonth(e.target.value)} />
        <button class="btn" onClick=${() => setMonth(shiftMonth(month, 1))}>›</button>
        ${ctx.canEditMoney && html`<button class="btn primary" onClick=${() => setImporting(true)}>＋ Nhập giải đã triển khai</button>`}
      </div>
    </div>
    ${data.error && html`<div class="err">${data.error}</div>`}

    <div class="kpis">
      <div class="kpi info"><b>${money(r.revenue)}</b><span>Tổng doanh thu chưa VAT · ${r.count} giải</span></div>
      <div class="kpi good"><b>${money(r.gross)}</b><span>Tổng lãi gộp · biên trung bình ${pct(r.avgMargin)}</span></div>
      <div class="kpi warn"><b>${money(fc.total)}</b><span>Tổng chi phí cố định</span></div>
      <div class=${'kpi ' + (r.net < 0 ? 'bad' : 'good')}><b>${money(r.net)}</b><span>Lãi ròng trước thuế · biên ${pct(r.netMargin)}</span></div>
      <div class="kpi"><b>${money(r.cit)}</b><span>Thuế TNDN ước tính (${pct(r.citRate)})</span></div>
      <div class=${'kpi ' + (r.afterTax < 0 ? 'bad' : 'good')}><b>${money(r.afterTax)}</b><span>Lãi sau thuế (ước tính)</span></div>
      <div class="kpi"><b>${r.avgMargin ? money(r.breakEven) : '-'}</b><span>Doanh thu hòa vốn / tháng</span></div>
      <div class="kpi"><b>${r.count ? r.eventsToBreakEven.toFixed(1).replace('.', ',') : '-'}</b><span>Số giải cần để hòa vốn (theo giải trung bình tháng này)</span></div>
    </div>

    <section class="section card-sec">
      <h2>Các giải trong tháng ${label(month)}</h2>
      ${rows.length ? html`<div class="table-wrap"><table class="table compact">
        <thead><tr><th>Giải</th><th>Ngày</th><th class="num">Doanh thu chưa VAT</th><th class="num">Chi phí NCC</th><th class="num">Lãi gộp</th><th class="num">Biên lãi</th><th class="num">Khách còn nợ</th><th></th></tr></thead>
        <tbody>${rows.map(({ e, p }) => html`<tr key=${e.id}>
          <td><b>${e.name}</b>${!e.acceptance_imported_at && html` <span class="badge warn" title="Số liệu theo báo giá + giá nhập nhập tay">chưa nghiệm thu</span>`}${p.missingCost > 0 && html` <span class="badge bad">${p.missingCost} mục thiếu giá nhập</span>`}</td>
          <td class="nowrap">${U.fmtDate(e.event_date)}</td>
          <td class="num">${money(p.revenue)}</td><td class="num">${money(p.cost + p.pit)}</td><td class="num">${money(p.gross)}</td>
          <td class="num"><span class=${'badge ' + (p.margin < 0.25 ? 'bad' : 'ok')}>${pct(p.margin)}</span></td>
          <td class="num">${p.owed > 0.5 ? money(p.owed) : html`<span class="muted">0đ</span>`}</td>
          <td>${canDeleteEvent(ctx, e) && html`<button class="link danger small" title="Xoá giải" onClick=${() => removeEvent(e)}>Xoá</button>`}</td></tr>`)}
          <tr><td><b>Tổng</b></td><td></td><td class="num"><b>${money(r.revenue)}</b></td><td class="num"><b>${money(rows.reduce((a, x) => a + x.p.cost + x.p.pit, 0))}</b></td><td class="num"><b>${money(r.gross)}</b></td><td class="num"><b>${pct(r.avgMargin)}</b></td><td class="num"><b>${money(rows.reduce((a, x) => a + Math.max(0, x.p.owed), 0))}</b></td><td></td></tr>
        </tbody></table></div>` : html`<div class="empty">Không có giải nào có ngày tổ chức trong tháng ${label(month)}.</div>`}
    </section>

    <section class="section card-sec">
      <div class="row between"><h2>Chi phí cố định tháng ${label(month)}</h2>
        <div class="row">${prevMonth && html`<button class="btn" onClick=${() => { setF(withDefaults(data.months[prevMonth])); setDirty(true); }}>Chép từ tháng trước (${label(prevMonth)})</button>`}
          <button class="btn primary" disabled=${busy || !dirty} onClick=${save}>${busy ? 'Đang lưu…' : dirty ? 'Lưu chi phí tháng' : 'Đã lưu'}</button></div></div>
      ${!data.months[month] && !dirty && html`<p class="note">Tháng này chưa nhập chi phí cố định.${prevMonth ? ' Bấm "Chép từ tháng trước" rồi sửa lại nếu có thay đổi.' : ''}</p>`}
      <div class="table-wrap"><table class="table compact">
        <thead><tr><th>Nhân sự</th><th class="num">Lương gross (đ)</th><th>Đóng BH</th><th class="num">BH công ty đóng</th><th class="num">Văn phòng</th><th></th></tr></thead>
        <tbody>${f.staff.map((s, i) => html`<tr key=${i}>
          <td><input value=${s.name || ''} placeholder="Họ tên / vị trí" onInput=${(e) => setStaff(i, { name: e.target.value })} /></td>
          <td class="num"><input class="w-num" inputmode="numeric" value=${s.salary ?? ''} onInput=${(e) => setStaff(i, { salary: e.target.value })} /></td>
          <td><input type="checkbox" checked=${!!s.insured} onChange=${(e) => setStaff(i, { insured: e.target.checked })} /></td>
          <td class="num">${s.insured ? html`<input class="w-num" type="number" value=${s.ins_amount ?? ''} placeholder=${Math.round(insOf({ ...s, ins_amount: null, salary: num(s.salary) }, f.ins_rate))} title="Để trống = tự tính theo tỉ lệ BH; gõ số = số tiền đóng thực tế" onInput=${(e) => setStaff(i, { ins_amount: e.target.value })} />
            <div class="muted small">${s.ins_amount != null && s.ins_amount !== '' ? 'nhập tay' : 'tự tính ' + pct(Number(f.ins_rate))}</div>` : html`<span class="muted">0đ</span>`}</td>
          <td class="num">${money((s.name || '').trim() ? num(f.office_per_person) : 0)}</td>
          <td><button class="link danger" onClick=${() => set({ staff: f.staff.filter((_, j) => j !== i) })}>Xoá</button></td></tr>`)}
          <tr><td><b>Tổng nhân sự (${fc.people} người)</b></td><td class="num"><b>${money(fc.salary)}</b></td><td></td><td class="num"><b>${money(fc.insurance)}</b></td><td class="num"><b>${money(fc.office)}</b></td><td></td></tr>
        </tbody></table></div>
      <button class="link" onClick=${() => set({ staff: [...f.staff, { name: '', salary: '', insured: false }] })}>+ Thêm nhân sự</button>
      <div class="grid3">
        <label>Tỉ lệ BH công ty đóng (%) <span class="muted small">- dùng khi không nhập tay số tiền</span><input type="number" step="0.1" value=${+(Number(f.ins_rate) * 100).toFixed(2)} onInput=${(e) => set({ ins_rate: Number(e.target.value) / 100 })} /></label>
        <label>Văn phòng mỗi người / tháng (đ)<input inputmode="numeric" value=${f.office_per_person} onInput=${(e) => set({ office_per_person: e.target.value })} /></label>
        <label>Facebook Ads / tháng (đ)<input inputmode="numeric" value=${f.ads} onInput=${(e) => set({ ads: e.target.value })} /></label>
        <label>Thuế suất TNDN (%) <span class="muted small">- cần kế toán xác nhận</span><input type="number" step="0.1" value=${+(Number(f.cit_rate) * 100).toFixed(2)} onInput=${(e) => set({ cit_rate: Number(e.target.value) / 100 })} /></label>
      </div>
      <b class="small">Chi phí khác</b>
      ${f.others.map((o, i) => html`<div class="row" key=${i}><input value=${o.name || ''} placeholder="Tên chi phí" onInput=${(e) => setOther(i, { name: e.target.value })} />
        <input class="w-num" inputmode="numeric" value=${o.amount ?? ''} placeholder="Số tiền" onInput=${(e) => setOther(i, { amount: e.target.value })} />
        <button class="link danger" onClick=${() => set({ others: f.others.filter((_, j) => j !== i) })}>Xoá</button></div>`)}
      <button class="link" onClick=${() => set({ others: [...f.others, { name: '', amount: '' }] })}>+ Thêm chi phí khác</button>
      <p class="muted small">Chi phí cố định = lương ${money(fc.salary)} + BH ${money(fc.insurance)} + văn phòng ${money(fc.office)} + quảng cáo ${money(fc.ads)} + khác ${money(fc.others)} = <b>${money(fc.total)}</b>. Lãi ròng trước thuế = tổng lãi gộp các giải - chi phí cố định. Doanh thu hòa vốn = chi phí cố định / biên lãi gộp trung bình.</p>
    </section>

    <section class="section card-sec">
      <h2>12 tháng gần nhất: lãi gộp và chi phí cố định</h2>
      <${Chart12} series=${series} current=${month} />
    </section>
    ${importing && html`<${ImportPastEvent} ctx=${ctx} onClose=${() => setImporting(false)} onDone=${async (m) => { setImporting(false); await load(); if (m) setMonth(m); }} />`}
  </div>`;
}

// Biểu đồ cột đôi tự vẽ bằng SVG: lãi gộp (xanh) và chi phí cố định (cam) theo tháng
function Chart12({ series, current }) {
  const W = 760, H = 280, L = 64, R = 16, T = 28, B = 46;
  const max = Math.max(1, ...series.flatMap((s) => [s.gross, s.fixed || 0]));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const cw = (W - L - R) / series.length;
  const bw = Math.min(22, cw / 3);
  const short = (v) => (v >= 1e9 ? (v / 1e9).toFixed(1).replace('.', ',') + ' tỷ' : v >= 1e6 ? Math.round(v / 1e6) + ' tr' : Math.round(v).toLocaleString('vi-VN'));
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  return html`<div class="chart12"><svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Lãi gộp và chi phí cố định 12 tháng gần nhất">
    ${ticks.map((t) => html`<g key=${t}><line x1=${L} x2=${W - R} y1=${y(t)} y2=${y(t)} stroke="var(--line)" /><text x=${L - 8} y=${y(t) + 4} text-anchor="end" font-size="11" fill="var(--muted)">${short(t)}</text></g>`)}
    ${series.map((s, i) => {
      const cx = L + cw * i + cw / 2;
      return html`<g key=${s.m}>
        <rect x=${cx - bw - 1} y=${y(s.gross)} width=${bw} height=${y(0) - y(s.gross)} rx="3" fill="var(--brand)"><title>${`Lãi gộp ${label(s.m)}: ${money(s.gross)}`}</title></rect>
        ${s.fixed != null ? html`<rect x=${cx + 1} y=${y(s.fixed)} width=${bw} height=${y(0) - y(s.fixed)} rx="3" fill="#f59e0b"><title>${`Chi phí cố định ${label(s.m)}: ${money(s.fixed)}`}</title></rect>`
          : html`<text x=${cx + 1 + bw / 2} y=${y(0) - 4} text-anchor="middle" font-size="10" fill="var(--muted)">-</text>`}
        <text x=${cx} y=${H - B + 16} text-anchor="middle" font-size="11" font-weight=${s.m === current ? 700 : 400} fill=${s.m === current ? 'var(--text)' : 'var(--muted)'}>${s.m.slice(5)}/${s.m.slice(2, 4)}</text>
      </g>`;
    })}
    <line x1=${L} x2=${W - R} y1=${y(0)} y2=${y(0)} stroke="var(--muted)" />
    <g font-size="12" fill="var(--text)"><rect x=${L} y="6" width="12" height="12" rx="2" fill="var(--brand)" /><text x=${L + 18} y="16">Lãi gộp các giải</text>
      <rect x=${L + 140} y="6" width="12" height="12" rx="2" fill="#f59e0b" /><text x=${L + 158} y="16">Chi phí cố định</text>
      <text x=${L + 280} y="16" fill="var(--muted)">"-" = tháng chưa nhập chi phí</text></g>
  </svg></div>`;
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
