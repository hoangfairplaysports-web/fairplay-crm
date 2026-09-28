// Admin tạo tài khoản nhân viên / đặt lại mật khẩu ngay trong CRM.
// Chỉ người đang đăng nhập với vai trò Admin (và còn hoạt động) mới gọi được.
// SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY do Supabase tự cung cấp cho Edge Function.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Xác thực người gọi
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return json({ error: 'Phiên đăng nhập hết hạn, hãy đăng nhập lại' }, 401);
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', who.user.id).maybeSingle();
  if (!me || me.role !== 'admin' || !me.active) return json({ error: 'Chỉ Admin được quản lý tài khoản' }, 403);

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Dữ liệu không hợp lệ' }, 400);
  }

  if (body.action === 'create') {
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const full_name = String(body.full_name ?? '').trim();
    const role = ['admin', 'manager', 'sales'].includes(body.role) ? body.role : 'sales';
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Email không hợp lệ' }, 400);
    if (password.length < 8) return json({ error: 'Mật khẩu tạm tối thiểu 8 ký tự' }, 400);
    if (!full_name) return json({ error: 'Nhập họ tên' }, 400);

    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name },
    });
    if (error) return json({ error: /already/i.test(error.message) ? 'Email này đã có tài khoản' : error.message }, 400);
    // Trigger handle_new_user đã tạo profile (mặc định sales) — cập nhật họ tên & vai trò
    const { data: profile, error: pErr } = await admin.from('profiles')
      .update({ full_name, role, email }).eq('id', data.user.id).select().single();
    if (pErr) return json({ error: pErr.message }, 400);
    return json({ profile });
  }

  if (body.action === 'reset_password') {
    const password = String(body.password ?? '');
    if (password.length < 8) return json({ error: 'Mật khẩu tạm tối thiểu 8 ký tự' }, 400);
    const { error } = await admin.auth.admin.updateUserById(String(body.user_id), { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: 'Hành động không hợp lệ' }, 400);
});
