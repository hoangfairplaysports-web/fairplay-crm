"""Chuyển file Excel cũ "Tổng hợp thông tin công việc Fairplay Sports.xlsx" thành CSV để nhập vào CRM.

Chạy:  python3 tools/convert_excel.py "<đường dẫn file xlsx>" import/fairplay-import.json
Lấy 2 sheet: "DS KH ads FB" (lead cá nhân từ quảng cáo) và "DS Giải đấu" (giải đã làm → khách hàng; deal chưa chốt → lead).
File JSON chứa dữ liệu khách hàng thật — KHÔNG commit lên GitHub (thư mục import/ đã được .gitignore).
"""
import json
import datetime as dt
import re
import sys

import openpyxl

COLUMNS = ['name', 'company', 'customer_type', 'phone', 'email', 'facebook', 'source', 'need', 'region', 'headcount',
           'event_time', 'stage', 'lost_reason', 'assignee_name', 'next_followup', 'notes', 'created_at']
REGIONS = {'hà nội': 'Hà Nội', 'hải phòng': 'Hải Phòng', 'đà nẵng': 'Đà Nẵng', 'tp.hcm': 'TP.HCM', 'hcm': 'TP.HCM'}


def txt(v):
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def fix_d(s):
    # File cũ dùng "Ð" (U+00D0, chữ Iceland) lẫn với "Đ" (U+0110) trong dropdown trạng thái
    return s.replace('Ð', 'Đ')


def phone_of(v):
    s = re.sub(r'[^\d]', '', txt(v))
    if len(s) == 9:
        s = '0' + s
    return s if 9 <= len(s) <= 11 else ''


def date_iso(v):
    return v.strftime('%Y-%m-%dT09:00:00') if isinstance(v, (dt.datetime, dt.date)) else ''


def need_of(v):
    s = txt(v).lower()
    if 'pick' in s:
        return 'Pickleball'
    if 'bóng' in s:
        return 'Bóng đá'
    if 'cầu lông' in s:
        return 'Cầu lông'
    if 'hội thao' in s:
        return 'Hội thao'
    return txt(v)


def fb_leads(ws):
    stage_map = {'Chưa liên hệ': 'new', 'Đã liên hệ': 'contacted', 'Đang tư vấn': 'consulting', 'Đã chốt': 'won',
                 'Đã liên hệ nhưng không rep': 'contacted'}
    seen, out = set(), []
    for r in ws.iter_rows(min_row=2, values_only=True):
        _, name, date, channel, region, need, pic, status, note = (list(r) + [None] * 9)[:9]
        name = txt(name)
        if not name or name == 'Tên khách hàng':
            continue
        phone = phone_of(note)
        key = (name.lower(), phone)
        if key in seen:
            continue
        seen.add(key)
        status = fix_d(txt(status))
        notes = [f'Kênh: {txt(channel)}'] if txt(channel) else []
        reg = REGIONS.get(txt(region).lower(), '')
        if txt(region) and not reg:
            notes.append(txt(region))
        if txt(note) and not phone:
            notes.append(txt(note))
        if status == 'Đã liên hệ nhưng không rep':
            notes.append('Đã liên hệ nhưng khách không phản hồi')
        notes.append('[Nhập từ Excel cũ – sheet DS KH ads FB]')
        out.append({
            'name': name, 'customer_type': 'Cá nhân / CLB', 'phone': phone, 'source': 'Facebook Ads (tin nhắn)',
            'need': need_of(need), 'region': reg, 'stage': stage_map.get(status, 'contacted'),
            'assignee_name': txt(pic), 'notes': '\n'.join(notes), 'created_at': date_iso(date),
        })
    return out


# Gộp các dòng trong "DS Giải đấu" về cùng một khách hàng. Kiểm tra lại & sửa nếu gộp sai.
CUSTOMER_MAP = {
    'giải vietcg': 'VIETCG',
    'mbbank cầu lông': 'MB Bank',
    'hội thao vpbanks': 'VPBankS',
    'svtech': 'SVtech', 'svtech lần 02': 'SVtech',
    'g.empire': 'G.Empire',
    'msb đà nẵng': 'MSB', 'msb tphcm': 'MSB', 'msb hà nội': 'MSB',
    'rox - diễn châu, nghệ an': 'ROX', 'rox - hà nội': 'ROX',
    'pickleball tranh cúp nhân tài': 'Nhân Tài Việt',
}
STATUS = {'Đang đàm phán': 'negotiating', 'Chưa bắt đầu': 'not_started', 'Đang thực hiện': 'in_progress',
          'Bị chặn': 'blocked', 'Đã hoàn thành': 'completed'}
PHASE = {'Trước sự kiện': 'before', 'Ngày': 'eventday', 'Đang diễn ra': 'ongoing', 'Sau sự kiện': 'after', 'Hoàn thành': 'done'}
WON = {'in_progress', 'completed'}


def canonical(name):
    return CUSTOMER_MAP.get(name.strip().lower(), name.strip())


def parse_date(v):
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    m = re.search(r'(\d{1,2})/(\d{1,2})/(\d{4})', txt(v))
    return f'{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}' if m and 2000 < int(m.group(3)) < 2100 else ''


def deals(ws):
    """Mỗi dòng "DS Giải đấu" → 1 giải đấu (giữ nguyên trạng thái, giai đoạn, PIC, ghi chú, phương án), gộp theo khách hàng."""
    customers = {}
    for r in ws.iter_rows(min_row=3, values_only=True):
        name, status, owner, phase, pic, due, sport, note, plan, extra = (list(r) + [None] * 10)[:10]
        name = txt(name)
        if not name:
            continue
        st = STATUS.get(fix_d(txt(status)), 'negotiating')
        d = parse_date(due)
        extra_s = txt(extra) if not isinstance(extra, dt.datetime) else extra.strftime('%d/%m/%Y')
        link = extra_s if extra_s.startswith('http') else (re.search(r'https?://\S+', extra_s).group(0) if 'http' in extra_s else '')
        plan_s = plan.strftime('%d/%m/%Y') if isinstance(plan, dt.datetime) else txt(plan)
        notes = txt(note)
        if extra_s and extra_s != link:
            notes = (notes + '\n' + extra_s).strip()
        cname = canonical(name)
        c = customers.setdefault(cname, {'name': cname, 'customer_type': 'Doanh nghiệp', 'owner_name': '', 'notes': '[Nhập từ Excel cũ]', 'contacts': [], 'events': []})
        who = txt(pic) or txt(owner)
        if who and (st in WON or not c['owner_name']):
            c['owner_name'] = who
        c['events'].append({
            'name': name, 'status': st, 'phase': PHASE.get(txt(phase)), 'pic_name': who, 'sport': need_of(sport),
            'event_date': d or None, 'date_text': '' if isinstance(due, dt.datetime) else txt(due),
            'notes': notes, 'next_action': plan_s, 'link': link,
        })
    for c in customers.values():
        dates = sorted(e['event_date'] for e in c['events'] if e['event_date'] and e['status'] in WON)
        if dates:
            c['last_care_at'] = dates[-1] + 'T09:00:00'
    return list(customers.values())


def main(src, dst):
    wb = openpyxl.load_workbook(src, data_only=True)
    customers = deals(wb['DS Giải đấu'])
    leads = fb_leads(wb['DS KH ads FB'])
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump({'customers': customers, 'leads': leads}, f, ensure_ascii=False, indent=1)
    names = sorted({r['assignee_name'] for r in leads if r.get('assignee_name')} | {c['owner_name'] for c in customers if c['owner_name']}
                   | {e['pic_name'] for c in customers for e in c['events'] if e['pic_name']})
    evs = [e for c in customers for e in c['events']]
    print(f'Đã xuất {len(customers)} khách hàng, {len(evs)} giải đấu, {len(leads)} lead → {dst}')
    from collections import Counter
    print('Trạng thái giải:', dict(Counter(e['status'] for e in evs)))
    for c in sorted(customers, key=lambda c: -len(c['events']))[:8]:
        print(f'  {c["name"]}: {len(c["events"])} giải · phụ trách: {c["owner_name"] or "—"}')
    print('Tên nhân viên cần khớp trong CRM:', ', '.join(names))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
