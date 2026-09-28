// Nhận lead tự động từ Facebook Lead Ads (form trên quảng cáo) → tạo lead mới trong CRM (vào hàng chờ "Chưa giao").
// Hướng dẫn cài đặt: xem README.md, mục "Tự động nhận lead Facebook Lead Ads".
//
// Biến môi trường cần đặt (supabase secrets set ...):
//   FB_VERIFY_TOKEN   chuỗi tự đặt, nhập giống hệt ở Meta Webhooks
//   FB_APP_SECRET     App Secret của Meta App (để kiểm tra chữ ký, chống giả mạo)
//   FB_PAGE_TOKEN     Page Access Token dài hạn có quyền leads_retrieval
// SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY được Supabase tự cung cấp.
import { createClient } from 'npm:@supabase/supabase-js@2';

const GRAPH = 'https://graph.facebook.com/v21.0';
const env = (k: string) => Deno.env.get(k) ?? '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

async function validSignature(body: string, header: string | null) {
  if (!header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env('FB_APP_SECRET')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
  const given = header.slice(7);
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

function normalizePhone(p: string) {
  let s = p.replace(/[^\d+]/g, '');
  if (s.startsWith('+84')) s = '0' + s.slice(3);
  else if (s.startsWith('84') && s.length === 11) s = '0' + s.slice(2);
  return s;
}

function guessNeed(text: string) {
  const t = text.toLowerCase();
  if (t.includes('pick')) return 'Pickleball';
  if (t.includes('bóng') || t.includes('football') || t.includes('futsal')) return 'Bóng đá';
  if (t.includes('cầu lông') || t.includes('badminton')) return 'Cầu lông';
  if (t.includes('chạy') || t.includes('run')) return 'Chạy bộ';
  if (t.includes('hội thao')) return 'Hội thao';
  return null;
}

async function handleLead(leadgenId: string) {
  const res = await fetch(`${GRAPH}/${leadgenId}?fields=created_time,field_data,ad_name,campaign_name,form_id&access_token=${env('FB_PAGE_TOKEN')}`);
  const lead = await res.json();
  if (!res.ok) throw new Error(`Graph API: ${JSON.stringify(lead.error ?? lead)}`);

  const f: Record<string, string> = {};
  for (const x of lead.field_data ?? []) f[x.name] = (x.values ?? []).join(', ');
  const pick = (...keys: string[]) => keys.map((k) => f[k]).find(Boolean) ?? '';

  const name = pick('full_name', 'họ_và_tên', 'ho_ten', 'name') || [f.first_name, f.last_name].filter(Boolean).join(' ') || 'Lead Facebook';
  const known = new Set(['full_name', 'họ_và_tên', 'ho_ten', 'name', 'first_name', 'last_name', 'phone_number', 'email', 'company_name', 'city']);
  const extra = Object.entries(f).filter(([k]) => !known.has(k)).map(([k, v]) => `${k}: ${v}`);
  const notes = [
    lead.campaign_name && `Chiến dịch: ${lead.campaign_name}`,
    lead.ad_name && `Quảng cáo: ${lead.ad_name}`,
    ...extra,
  ].filter(Boolean).join('\n');

  const { data, error } = await db.from('leads').upsert({
    external_id: `fb:${leadgenId}`,
    name,
    phone: normalizePhone(pick('phone_number')) || null,
    email: pick('email') || null,
    company: pick('company_name') || null,
    region: pick('city') || null,
    source: 'Facebook Lead Form',
    need: guessNeed(Object.values(f).join(' ') + ' ' + (lead.campaign_name ?? '')),
    notes,
    stage: 'new',
    next_followup: new Date().toISOString().slice(0, 10),
    created_at: lead.created_time ?? new Date().toISOString(),
  }, { onConflict: 'external_id', ignoreDuplicates: true }).select('id');
  if (error) throw error;
  if (data?.[0]) await db.from('activities').insert({ lead_id: data[0].id, type: 'create', content: 'Lead tự động từ Facebook Lead Ads' });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === env('FB_VERIFY_TOKEN');
    return ok ? new Response(url.searchParams.get('hub.challenge')) : new Response('Forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.text();
  if (!(await validSignature(body, req.headers.get('x-hub-signature-256')))) return new Response('Bad signature', { status: 401 });

  const payload = JSON.parse(body);
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen') continue;
      try {
        await handleLead(change.value.leadgen_id);
      } catch (e) {
        console.error('Lỗi xử lý lead', change.value?.leadgen_id, e);
      }
    }
  }
  return new Response('OK');
});
