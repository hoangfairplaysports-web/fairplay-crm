import { CONFIG } from './config.js';
import { DEFAULT_SETTINGS, addDays, isOpen, normalizePhone, uid } from './util.js';

export async function createStore() {
  if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) return createSupabaseStore();
  return createDemoStore();
}

const FIELDS = {
  leads: ['name', 'company', 'customer_type', 'phone', 'email', 'facebook', 'source', 'need', 'region', 'headcount', 'event_time',
    'stage', 'lost_reason', 'assignee_id', 'next_followup', 'notes', 'created_at', 'last_activity_at', 'customer_id'],
  customers: ['name', 'customer_type', 'industry', 'region', 'address', 'notes', 'owner_id', 'next_care', 'last_care_at', 'created_at'],
  contacts: ['customer_id', 'name', 'title', 'gender', 'phone', 'email', 'facebook', 'birthday', 'is_primary', 'notes'],
  events: ['customer_id', 'lead_id', 'name', 'sport', 'event_date', 'date_text', 'venue', 'headcount', 'status', 'phase', 'pic_id', 'notes', 'next_action', 'link'],
  gifts: ['customer_id', 'contact_id', 'occasion', 'occasion_key', 'gift', 'gift_date', 'status', 'notes'],
};
export const TABLES = ['customers', 'contacts', 'events', 'gifts'];
function clean(table, d) {
  const out = {};
  for (const k of FIELDS[table]) if (k in d) out[k] = d[k] === '' ? null : d[k];
  if ('phone' in out) out.phone = normalizePhone(out.phone) || null;
  if ('headcount' in out) out.headcount = out.headcount == null ? null : parseInt(out.headcount, 10) || null;
  return out;
}
const cleanLead = (d) => clean('leads', d);

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
    async adminUser(body) {
      const { data, error } = await sb.functions.invoke('admin-users', { body });
      if (error) {
        let msg = error.message;
        try {
          msg = (await error.context.json()).error || msg;
        } catch {}
        throw new Error(translateError(msg));
      }
      return data;
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
    async listActivities(filter) {
      const [k, v] = Object.entries(filter)[0];
      return chk(await sb.from('activities').select('*').eq(k, v).order('created_at', { ascending: false }));
    },
    async addActivity(a) {
      return chk(await sb.from('activities').insert({ lead_id: a.lead_id || null, customer_id: a.customer_id || null, type: a.type, content: a.content }).select().single());
    },
    async list(table) {
      const all = [];
      for (let from = 0; ; from += 1000) {
        const rows = chk(await sb.from(table).select('*').order('created_at', { ascending: false }).range(from, from + 999));
        all.push(...rows);
        if (rows.length < 1000) break;
      }
      return all;
    },
    async insert(table, row) {
      return chk(await sb.from(table).insert(clean(table, row)).select().single());
    },
    async update(table, id, patch) {
      return chk(await sb.from(table).update(clean(table, patch)).eq('id', id).select().single());
    },
    async remove(table, id) {
      chk(await sb.from(table).delete().eq('id', id));
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
const DEMO_KEY = 'fpcrm_demo_v3';

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
    async adminUser({ action, full_name, email, role }) {
      if (action !== 'create') return { ok: true };
      return { profile: await this.addProfile({ full_name, email, role }) };
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
      if (!isMgr()) lead.assignee_id = db.customers.find((c) => c.id === lead.customer_id)?.owner_id || null;
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
    async listActivities(filter) {
      need();
      const [k, v] = Object.entries(filter)[0];
      return copy(db.activities.filter((a) => a[k] === v)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async addActivity(a) {
      need();
      const act = { id: uid(), lead_id: a.lead_id || null, customer_id: a.customer_id || null, type: a.type, content: a.content, created_by: me().id, created_at: new Date().toISOString() };
      db.activities.push(act);
      const lead = db.leads.find((l) => l.id === a.lead_id);
      if (lead) lead.last_activity_at = act.created_at;
      const cus = db.customers.find((c) => c.id === a.customer_id);
      if (cus) cus.last_care_at = act.created_at;
      save();
      return copy(act);
    },
    async list(table) {
      need();
      return copy(db[table]).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    },
    async insert(table, row) {
      need();
      const now = new Date().toISOString();
      const r = { id: uid(), created_at: now, ...clean(table, row), created_by: me().id };
      if (table === 'customers') {
        r.last_care_at = r.last_care_at || now;
        r.updated_at = now;
        if (!isMgr()) r.owner_id = me().id;
      }
      if (table === 'events') { r.status = r.status || 'negotiating'; r.updated_at = now; }
      if (table === 'gifts') r.status = r.status || 'planned';
      db[table].push(r);
      save();
      return copy(r);
    },
    async update(table, id, patch) {
      need();
      const r = db[table].find((x) => x.id === id);
      const p = clean(table, patch);
      if (table === 'customers' && 'owner_id' in p && p.owner_id !== r.owner_id && !isMgr())
        throw new Error('Chỉ Trưởng KD hoặc Admin được giao người phụ trách khách hàng');
      Object.assign(r, p, ['customers', 'events'].includes(table) ? { updated_at: new Date().toISOString() } : {});
      save();
      return copy(r);
    },
    async remove(table, id) {
      if (!isMgr()) throw new Error('Chỉ Trưởng KD hoặc Admin được xoá');
      db[table] = db[table].filter((x) => x.id !== id);
      if (table === 'customers') {
        for (const t of ['contacts', 'events', 'gifts']) db[t] = db[t].filter((x) => x.customer_id !== id);
        db.activities = db.activities.filter((a) => a.customer_id !== id);
        for (const l of db.leads) if (l.customer_id === id) l.customer_id = null;
      }
      save();
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
  // Khách hàng mẫu (hư cấu)
  const C = (id, name, customer_type, region, owner_id, nextCare, careAgo) => ({
    id, name, customer_type, region, owner_id, industry: '', address: '', notes: '',
    next_care: nextCare == null ? null : addDays(nextCare), last_care_at: ago(careAgo), created_at: ago(400), updated_at: ago(careAgo), created_by: owner_id,
  });
  const customers = [
    C('C1', 'Công ty Bảo hiểm An Khang', 'Doanh nghiệp', 'Hà Nội', 'hoang', 5, 5),
    C('C2', 'Công ty Chứng khoán Demo', 'Doanh nghiệp', 'TP.HCM', 'hoang', null, 8),
    C('C3', 'Ngân hàng Demo Xanh', 'Doanh nghiệp', 'Hà Nội', 'minh', 14, 20),
    C('C4', 'Tập đoàn Công nghệ Demo', 'Doanh nghiệp', 'Hà Nội', 'vu', -6, 40),
    C('C5', 'Trường Quốc tế Demo', 'Trường học', 'Hà Nội', 'trang', null, 120),
    C('C6', 'Công ty CP Logistics Sao Việt', 'Doanh nghiệp', 'Hà Nội', 'hoang', 1, 3),
    C('C7', 'Hội doanh nhân trẻ Demo', 'Cá nhân / CLB', 'Hà Nội', 'minh', 3, 2),
    C('C8', 'Công ty Thép Demo', 'Doanh nghiệp', 'Tỉnh khác', 'hieu', 7, 10),
  ];
  const bday = (inDays) => '1988' + addDays(inDays).slice(4);
  const K = (id, customer_id, name, title, gender, i, birthday, is_primary = true) => ({
    id, customer_id, name, title, gender, phone: '091' + String(2000000 + i * 1234567).slice(-7), email: `dauMoi${i}@example.com`.toLowerCase(),
    facebook: '', birthday, is_primary, notes: '', created_at: ago(300),
  });
  const contacts = [
    K('K1', 'C1', 'Bùi Thanh Hương', 'Trưởng phòng HCNS', 'Nữ', 1, bday(5)),
    K('K2', 'C1', 'Lê Văn Bình', 'Chủ tịch Công đoàn', 'Nam', 2, null, false),
    K('K3', 'C2', 'Tạ Thị Hồng', 'Phó phòng Nhân sự', 'Nữ', 3, bday(40)),
    K('K4', 'C3', 'Trần Quốc Việt', 'Giám đốc Khối Văn hoá', 'Nam', 4, bday(120)),
    K('K5', 'C3', 'Nguyễn Minh Thư', 'Chuyên viên Công đoàn', 'Nữ', 5, null, false),
    K('K6', 'C4', 'Đinh Thu Trang', 'HR Manager', 'Nữ', 6, null),
    K('K7', 'C5', 'Phạm Hải Nam', 'Phó Hiệu trưởng', 'Nam', 7, null),
  ];
  const E = (id, customer_id, name, sport, days, headcount, status = 'completed', lead_id = null, x = {}) => ({
    id, customer_id, lead_id, name, sport, event_date: days == null ? null : addDays(days), date_text: '', venue: 'Sân demo', headcount, status,
    phase: status === 'completed' ? 'done' : 'before', pic_id: x.pic || null, notes: x.notes || '', next_action: x.next || '', link: '',
    created_at: ago(Math.max(0, -(days || 0)) + 30), updated_at: ago(2),
  });
  const events = [
    E('E1', 'C1', 'Giải Pickleball An Khang 2025', 'Pickleball', -340, 64),
    E('E2', 'C1', 'Giải Cầu lông An Khang mở rộng', 'Cầu lông', 22, 96, 'in_progress', 'L8', { pic: 'hoang', notes: 'Đã cọc sân, đang book cúp & huy chương', next: 'Chốt danh sách VĐV trước 10/10' }),
    E('E3', 'C2', 'Giải Bóng đá Chứng khoán Demo 2026', 'Bóng đá', -8, 150, 'completed', 'L14', { pic: 'hoang', notes: 'Đã nghiệm thu, còn 30% chưa thanh toán', next: 'Kế toán đòi nốt 30%' }),
    E('E10', 'C6', 'Giải Bóng đá Logistics Sao Việt', 'Bóng đá', 40, 120, 'negotiating', 'L1', { pic: 'hoang', notes: 'Đã gửi báo giá & profile, khách đang so sánh 2 đơn vị', next: 'Remind khách thứ 5 tuần này' }),
    E('E11', 'C7', 'Giải Pickleball Doanh nhân trẻ', 'Pickleball', 70, 128, 'negotiating', 'L13', { pic: 'minh', notes: 'Khách chốt format, chờ duyệt ngân sách', next: 'Gửi lại bản kế hoạch chi tiết' }),
    E('E12', 'C8', 'Hội thao Thép Demo 2027', 'Hội thao', null, 500, 'blocked', 'L11', { pic: 'hieu', notes: 'Khách đang chờ lãnh đạo chốt ngày', next: 'Hỏi lại sau họp HĐQT' }),
    E('E4', 'C3', 'Hội thao Ngân hàng Xanh 2023', 'Hội thao', -1050, 400),
    E('E5', 'C3', 'Giải Pickleball Ngân hàng Xanh 2024', 'Pickleball', -700, 80),
    E('E6', 'C3', 'Giải Bóng đá Ngân hàng Xanh 2025', 'Bóng đá', -320, 160),
    E('E7', 'C3', 'Giải Pickleball mùa xuân 2026', 'Pickleball', -200, 72),
    E('E8', 'C4', 'Giải Pickleball Công nghệ Demo 2025', 'Pickleball', -300, 48),
    E('E9', 'C5', 'Giải Bóng đá học sinh 2025', 'Bóng đá', -560, 220),
  ];
  const gifts = [
    { id: 'G1', customer_id: 'C3', contact_id: 'K4', occasion: 'Tết Nguyên Đán', occasion_key: 'tet-2026', gift: 'Hộp quà Tết cao cấp', gift_date: addDays(-230), status: 'given', notes: '', created_at: ago(230), created_by: 'minh' },
    { id: 'G2', customer_id: 'C3', contact_id: 'K4', occasion: 'Khách thân thiết', occasion_key: 'loyal', gift: 'Vợt Pickleball khắc tên', gift_date: addDays(-600), status: 'given', notes: '', created_at: ago(600), created_by: 'minh' },
  ];
  leads.find((l) => l.id === 'L8').customer_id = 'C1';
  leads.find((l) => l.id === 'L14').customer_id = 'C2';
  leads.find((l) => l.id === 'L1').customer_id = 'C6';
  leads.find((l) => l.id === 'L13').customer_id = 'C7';
  leads.find((l) => l.id === 'L11').customer_id = 'C8';
  for (const c of customers)
    activities.push({ id: uid(), lead_id: null, customer_id: c.id, type: 'call', content: 'Gọi hỏi thăm, cập nhật kế hoạch hoạt động nội bộ', created_by: c.owner_id, created_at: c.last_care_at });
  return { profiles, leads, activities, customers, contacts, events, gifts, settings: {}, currentUserId: null };
}
