import { CONFIG } from './config.js';
import { DEFAULT_SETTINGS, addDays, isOpen, normalizePhone, uid } from './util.js';

export async function createStore() {
  if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) return createSupabaseStore();
  return createDemoStore();
}

const LEAD_FIELDS = [
  'name', 'company', 'customer_type', 'phone', 'email', 'facebook', 'source', 'need', 'region', 'headcount', 'event_time',
  'stage', 'lost_reason', 'assignee_id', 'next_followup', 'notes', 'created_at', 'last_activity_at',
];
function cleanLead(d) {
  const out = {};
  for (const k of LEAD_FIELDS) if (k in d) out[k] = d[k] === '' ? null : d[k];
  if ('phone' in out) out.phone = normalizePhone(out.phone) || null;
  if ('headcount' in out) out.headcount = out.headcount == null ? null : parseInt(out.headcount, 10) || null;
  return out;
}

function translateError(msg) {
  if (/Invalid login credentials/i.test(msg)) return 'Sai email hoặc mật khẩu';
  if (/Email not confirmed/i.test(msg)) return 'Email chưa được xác nhận';
  if (/row-level security/i.test(msg)) return 'Bạn không có quyền thực hiện thao tác này';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Mất kết nối mạng, thử lại sau';
  return msg;
}

// ---------------------------------------------------------------------------
// Supabase (dữ liệu thật)
// ---------------------------------------------------------------------------
async function createSupabaseStore() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  const chk = ({ data, error }) => {
    if (error) throw new Error(translateError(error.message));
    return data;
  };
  const profileOf = async (user) =>
    user ? chk(await sb.from('profiles').select('*').eq('id', user.id).maybeSingle()) : null;

  return {
    mode: 'live',
    async getUser() {
      const { data } = await sb.auth.getSession();
      return profileOf(data.session?.user);
    },
    async signIn(email, password) {
      chk(await sb.auth.signInWithPassword({ email: email.trim(), password }));
      return this.getUser();
    },
    async signOut() {
      await sb.auth.signOut();
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((event) => setTimeout(() => cb(event), 0));
      return () => data.subscription.unsubscribe();
    },
    async changePassword(password) {
      chk(await sb.auth.updateUser({ password }));
    },
    async resetPassword(email) {
      chk(await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname }));
    },
    async listProfiles() {
      return chk(await sb.from('profiles').select('*').order('full_name'));
    },
    async updateProfile(id, patch) {
      return chk(await sb.from('profiles').update(patch).eq('id', id).select().single());
    },
    async listLeads() {
      const all = [];
      for (let from = 0; ; from += 1000) {
        const rows = chk(await sb.from('leads').select('*').order('created_at', { ascending: false }).range(from, from + 999));
        all.push(...rows);
        if (rows.length < 1000) break;
      }
      return all;
    },
    async createLead(d) {
      return chk(await sb.from('leads').insert(cleanLead(d)).select().single());
    },
    async updateLead(id, patch) {
      return chk(await sb.from('leads').update(cleanLead(patch)).eq('id', id).select().single());
    },
    async deleteLead(id) {
      chk(await sb.from('leads').delete().eq('id', id));
    },
    async listActivities(leadId) {
      return chk(await sb.from('activities').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }));
    },
    async addActivity(a) {
      return chk(await sb.from('activities').insert({ lead_id: a.lead_id, type: a.type, content: a.content }).select().single());
    },
    async getSettings() {
      const s = chk(await sb.from('settings').select('*').eq('id', 1).maybeSingle()) || {};
      return mergeSettings(s);
    },
    async updateSettings(patch) {
      return mergeSettings(chk(await sb.from('settings').update(patch).eq('id', 1).select().single()));
    },
    async importLeads(rows) {
      let n = 0;
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200).map(cleanLead);
        chk(await sb.from('leads').insert(chunk));
        n += chunk.length;
      }
      return n;
    },
  };
}

function mergeSettings(s) {
  const out = { ...DEFAULT_SETTINGS };
  for (const [k, v] of Object.entries(s || {})) if (v != null && v !== '') out[k] = v;
  return out;
}

// ---------------------------------------------------------------------------
// Demo (dữ liệu mẫu, lưu localStorage của trình duyệt)
// ---------------------------------------------------------------------------
const DEMO_KEY = 'fpcrm_demo_v1';

function createDemoStore() {
  let db = load() || seed();
  function load() {
    try {
      return JSON.parse(localStorage.getItem(DEMO_KEY));
    } catch {
      return null;
    }
  }
  function save() {
    try {
      localStorage.setItem(DEMO_KEY, JSON.stringify(db));
    } catch {}
  }
  const me = () => db.profiles.find((p) => p.id === db.currentUserId && p.active) || null;
  const isMgr = () => ['admin', 'manager'].includes(me()?.role);
  const need = () => {
    if (!me()) throw new Error('Bạn chưa đăng nhập');
  };
  const guard = (lead) => {
    if (lead.stage === 'lost' && !String(lead.lost_reason || '').trim()) throw new Error('Cần ghi lý do thất bại');
  };
  const copy = (x) => JSON.parse(JSON.stringify(x));

  return {
    mode: 'demo',
    async getUser() {
      return me() ? copy(me()) : null;
    },
    async signIn(email) {
      const p = db.profiles.find((p) => p.email.toLowerCase() === String(email).trim().toLowerCase());
      if (!p) throw new Error('Không tìm thấy tài khoản demo');
      db.currentUserId = p.id;
      save();
      return copy(p);
    },
    async signOut() {
      db.currentUserId = null;
      save();
    },
    async switchUser(id) {
      db.currentUserId = id;
      save();
      return copy(me());
    },
    async resetDemo() {
      const cur = db.currentUserId;
      db = seed();
      db.currentUserId = cur;
      save();
    },
    onAuthChange() {
      return () => {};
    },
    async changePassword() {},
    async resetPassword() {},
    async listProfiles() {
      return copy(db.profiles);
    },
    async addProfile({ full_name, email, role }) {
      if (me()?.role !== 'admin') throw new Error('Chỉ Admin được thêm thành viên');
      const p = { id: uid(), full_name, email, role, active: true };
      db.profiles.push(p);
      save();
      return copy(p);
    },
    async updateProfile(id, patch) {
      if (me()?.role !== 'admin') throw new Error('Chỉ Admin được sửa thành viên');
      const p = db.profiles.find((p) => p.id === id);
      Object.assign(p, patch);
      save();
      return copy(p);
    },
    async listLeads() {
      need();
      return copy(db.leads).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async createLead(d) {
      need();
      const now = new Date().toISOString();
      const lead = {
        id: uid(), stage: 'new', created_at: now, last_activity_at: now, ...cleanLead(d),
        created_by: me().id, updated_at: now,
      };
      if (!isMgr()) lead.assignee_id = null;
      guard(lead);
      db.leads.push(lead);
      save();
      return copy(lead);
    },
    async updateLead(id, patch) {
      need();
      const lead = db.leads.find((l) => l.id === id);
      const p = cleanLead(patch);
      if ('assignee_id' in p && p.assignee_id !== lead.assignee_id && !isMgr())
        throw new Error('Chỉ Trưởng KD hoặc Admin được giao lead');
      const next = { ...lead, ...p, updated_at: new Date().toISOString() };
      guard(next);
      Object.assign(lead, next);
      save();
      return copy(lead);
    },
    async deleteLead(id) {
      if (!isMgr()) throw new Error('Chỉ Trưởng KD hoặc Admin được xoá lead');
      db.leads = db.leads.filter((l) => l.id !== id);
      db.activities = db.activities.filter((a) => a.lead_id !== id);
      save();
    },
    async listActivities(leadId) {
      need();
      return copy(db.activities.filter((a) => a.lead_id === leadId)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async addActivity(a) {
      need();
      const act = { id: uid(), lead_id: a.lead_id, type: a.type, content: a.content, created_by: me().id, created_at: new Date().toISOString() };
      db.activities.push(act);
      const lead = db.leads.find((l) => l.id === a.lead_id);
      if (lead) lead.last_activity_at = act.created_at;
      save();
      return copy(act);
    },
    async getSettings() {
      return mergeSettings(db.settings);
    },
    async updateSettings(patch) {
      if (me()?.role !== 'admin') throw new Error('Chỉ Admin được đổi cài đặt');
      db.settings = { ...db.settings, ...patch };
      save();
      return mergeSettings(db.settings);
    },
    async importLeads(rows) {
      if (!isMgr()) throw new Error('Không có quyền nhập dữ liệu');
      const now = new Date().toISOString();
      for (const r of rows) {
        const lead = { id: uid(), stage: 'new', created_at: now, last_activity_at: now, ...cleanLead(r), created_by: me().id, updated_at: now };
        if (lead.stage === 'lost' && !lead.lost_reason) lead.lost_reason = 'Khác';
        db.leads.push(lead);
      }
      save();
      return rows.length;
    },
  };
}

function seed() {
  const P = (id, full_name, role) => ({ id, full_name, email: `${id}@demo.fairplay`, role, active: true });
  const profiles = [
    P('admin', 'Giám đốc (Admin)', 'admin'),
    P('hoang', 'Hoàng', 'manager'),
    P('minh', 'Minh', 'sales'),
    P('vu', 'Vũ', 'sales'),
    P('trang', 'Trang', 'sales'),
    P('hieu', 'Hiếu', 'sales'),
  ];
  const ago = (days, h = 9) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(h, 0, 0, 0);
    return d.toISOString();
  };
  // Dữ liệu mẫu hư cấu — không phải khách hàng thật
  const raw = [
    ['Nguyễn Văn An', 'Công ty CP Logistics Sao Việt', 'Doanh nghiệp', 'Telesale', 'Bóng đá', 'Hà Nội', 'negotiating', 'hoang', 1, 3, 120, 'Tháng 11/2026'],
    ['Trần Thu Hà', 'Ngân hàng TMCP Demo', 'Doanh nghiệp', 'Giới thiệu', 'Pickleball', 'Hà Nội', 'quoted', 'minh', 0, 2, 64, '15/11/2026'],
    ['Lê Minh Tuấn', '', 'Cá nhân / CLB', 'Facebook Ads (tin nhắn)', 'Pickleball', 'TP.HCM', 'contacted', 'minh', -2, 9, 32, ''],
    ['Phạm Quỳnh Anh', 'Tập đoàn BĐS Minh Long', 'Doanh nghiệp', 'LinkedIn', 'Hội thao', 'Hà Nội', 'consulting', 'vu', 2, 1, 300, 'Quý 1/2027'],
    ['Đỗ Hoàng Nam', 'CLB Pickleball Cầu Giấy', 'Cá nhân / CLB', 'Facebook Ads (tin nhắn)', 'Pickleball', 'Hà Nội', 'new', null, 0, 0, 48, ''],
    ['Vũ Thị Mai', 'Công ty Phần mềm TechNova', 'Doanh nghiệp', 'Website', 'Pickleball', 'Đà Nẵng', 'consulting', 'trang', -1, 4, 80, 'Tháng 12'],
    ['Hoàng Đức Long', 'Trường THPT Demo', 'Trường học', 'Zalo', 'Bóng đá', 'Hải Phòng', 'contacted', 'hieu', null, 12, 200, ''],
    ['Bùi Thanh Hương', 'Công ty Bảo hiểm An Khang', 'Doanh nghiệp', 'Khách cũ', 'Cầu lông', 'Hà Nội', 'won', 'hoang', null, 5, 96, '20/10/2026'],
    ['Ngô Quang Huy', 'Chuỗi cafe Mộc', 'Doanh nghiệp', 'Facebook Lead Form', 'Pickleball', 'TP.HCM', 'lost', 'vu', null, 20, 40, ''],
    ['Đặng Ngọc Lan', '', 'Cá nhân / CLB', 'Facebook Ads (tin nhắn)', 'Bóng đá', 'Hà Nội', 'new', null, null, 1, 22, ''],
    ['Phan Văn Khoa', 'Công ty Thép Demo', 'Doanh nghiệp', 'Telesale', 'Hội thao', 'Tỉnh khác', 'quoted', 'hieu', -4, 10, 500, 'Tháng 1/2027'],
    ['Lý Thị Thu', 'Công ty Dược Phúc An', 'Doanh nghiệp', 'Facebook Lead Form', 'Pickleball', 'Hà Nội', 'contacted', 'trang', 0, 0, 60, ''],
    ['Mai Anh Dũng', 'Hội doanh nhân trẻ Demo', 'Cá nhân / CLB', 'Giới thiệu', 'Pickleball', 'Hà Nội', 'negotiating', 'minh', 3, 2, 128, '07/12/2026'],
    ['Tạ Thị Hồng', 'Công ty Chứng khoán Demo', 'Doanh nghiệp', 'LinkedIn', 'Bóng đá', 'TP.HCM', 'won', 'hoang', null, 15, 150, '05/10/2026'],
    ['Cao Minh Đức', '', 'Cá nhân / CLB', 'Facebook Ads (tin nhắn)', 'Pickleball', 'Hà Nội', 'contacted', 'minh', null, 25, 16, ''],
  ];
  const lostReasons = { 'Ngô Quang Huy': 'Giá cao' };
  const leads = raw.map(([name, company, customer_type, source, need, region, stage, assignee_id, fu, lastAgo, headcount, event_time], i) => ({
    id: 'L' + (i + 1),
    name, company, customer_type, source, need, region, stage, assignee_id, headcount, event_time,
    phone: '09' + String(10000000 + i * 7654321).slice(-8),
    email: company ? `lienhe${i + 1}@example.com` : '',
    next_followup: fu == null || !isOpen(stage) ? null : addDays(fu),
    lost_reason: lostReasons[name] || null,
    notes: '',
    created_at: ago(lastAgo + 3 + i),
    last_activity_at: ago(lastAgo, 14),
    updated_at: ago(lastAgo, 14),
    created_by: assignee_id || 'minh',
  }));
  const activities = [];
  for (const l of leads) {
    activities.push({ id: uid(), lead_id: l.id, type: 'create', content: `Lead từ ${l.source}`, created_by: l.created_by, created_at: l.created_at });
    if (l.stage !== 'new')
      activities.push({
        id: uid(), lead_id: l.id, type: l.stage === 'quoted' ? 'quote' : 'call',
        content: l.stage === 'quoted' ? 'Đã gửi báo giá + hồ sơ năng lực qua email' : 'Đã gọi, khách quan tâm, hẹn trao đổi thêm',
        created_by: l.assignee_id || 'minh', created_at: l.last_activity_at,
      });
  }
  return { profiles, leads, activities, settings: {}, currentUserId: null };
}
