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
WON = {'Đã hoàn thành', 'Đang thực hiện'}


def canonical(name):
    return CUSTOMER_MAP.get(name.strip().lower(), name.strip())


def parse_date(v):
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    m = re.search(r'(\d{1,2})/(\d{1,2})/(\d{4})', txt(v))
    return f'{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}' if m and 2000 < int(m.group(3)) < 2100 else ''


def deals(ws):
    """Trả về (customers, leads): giải đã làm → khách hàng + giải; deal chưa chốt → lead."""
    stage_map = {'Đang đàm phán': 'negotiating', 'Chưa bắt đầu': 'consulting', 'Bị chặn': 'negotiating'}
    customers, leads = {}, []
    today = dt.date.today().isoformat()
    rows = [r for r in ws.iter_rows(min_row=3, values_only=True) if txt(r[0])]
    for r in rows:
        name, status, owner, phase, pic, due, sport, note, plan, extra = (list(r) + [None] * 10)[:10]
        name, status = txt(name), fix_d(txt(status))
        notes = []
        for label, v in (('Ghi chú', note), ('Phương án', plan), ('Khác', extra)):
            v = txt(v) if not isinstance(v, dt.datetime) else v.strftime('%d/%m/%Y')
            if v:
                notes.append(f'{label}: {v}')
        cname = canonical(name)
        if status in WON:
            d = parse_date(due)
            if not d and txt(due):
                notes.insert(0, f'Thời gian: {txt(due)}')
            c = customers.setdefault(cname, {'name': cname, 'customer_type': 'Doanh nghiệp', 'owner_name': '', 'notes': '[Nhập từ Excel cũ]', 'contacts': [], 'events': []})
            if txt(pic) or txt(owner):
                c['owner_name'] = txt(pic) or txt(owner)
            c['events'].append({'name': name, 'sport': need_of(sport), 'event_date': d or None,
                                'status': 'upcoming' if d and d > today else 'done', 'notes': '\n'.join(notes)})
            continue
        if status == 'Bị chặn':
            notes.insert(0, '⚠ Trạng thái cũ: Bị chặn / tạm dừng')
        notes.append('[Nhập từ Excel cũ – sheet DS Giải đấu]')
        leads.append({
            'name': name, 'company': cname, 'customer_type': 'Doanh nghiệp', 'source': 'Khác', 'need': need_of(sport),
            'event_time': due.strftime('%d/%m/%Y') if isinstance(due, dt.datetime) else txt(due),
            'stage': stage_map.get(status, 'consulting'), 'assignee_name': txt(pic) or txt(owner),
            'notes': '\n'.join(notes), 'customer_name': cname,
        })
    for c in customers.values():
        dates = sorted(e['event_date'] for e in c['events'] if e['event_date'])
        if dates:
            c['last_care_at'] = dates[-1] + 'T09:00:00'
    for l in leads:
        if l['customer_name'] not in customers:
            l['customer_name'] = ''
    return list(customers.values()), leads


def main(src, dst):
    wb = openpyxl.load_workbook(src, data_only=True)
    customers, deal_leads = deals(wb['DS Giải đấu'])
    leads = fb_leads(wb['DS KH ads FB']) + deal_leads
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump({'customers': customers, 'leads': leads}, f, ensure_ascii=False, indent=1)
    names = sorted({r['assignee_name'] for r in leads if r.get('assignee_name')} | {c['owner_name'] for c in customers if c['owner_name']})
    print(f'Đã xuất {len(customers)} khách hàng ({sum(len(c["events"]) for c in customers)} giải) + {len(leads)} lead → {dst}')
    for c in sorted(customers, key=lambda c: -len(c['events'])):
        print(f'  {c["name"]}: {len(c["events"])} giải · phụ trách: {c["owner_name"] or "—"}')
    print('Tên nhân viên cần khớp trong CRM:', ', '.join(names))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
