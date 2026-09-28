# Fairplay CRM

CRM quản lý lead & follow-up cho Phòng Kinh doanh Fairplay Sports.

- **Giao diện**: web tĩnh, host miễn phí trên GitHub Pages (`https://<tài-khoản>.github.io/fairplay-crm/`)
- **Dữ liệu + đăng nhập + phân quyền**: Supabase (gói Free)
- Chưa điền cấu hình Supabase → app tự chạy **chế độ DEMO** với dữ liệu mẫu hư cấu.

## Tính năng

| Màn hình | Nội dung |
|---|---|
| **Hôm nay** | Lead quá hạn, cần liên hệ hôm nay, bị bỏ quên (≥ N ngày không tương tác), chưa hẹn follow-up. Trưởng KD thấy thêm hàng chờ giao lead + bảng tình hình từng nhân viên |
| **Danh sách** | Tìm kiếm (không dấu, theo SĐT), lọc theo giai đoạn / người / nguồn / nhu cầu / tình trạng, giao hàng loạt, xuất CSV |
| **Pipeline** | Kanban 7 cột, kéo thả để chuyển giai đoạn (bắt buộc hẹn follow-up; Thất bại bắt buộc có lý do) |
| **Chi tiết lead** | Nút Gọi / Zalo (tự copy tin nhắn mẫu) / Email (mẫu soạn sẵn) / Facebook; ghi tương tác; lịch sử đầy đủ; cảnh báo trùng |
| **Báo cáo** | Phễu, tỉ lệ chốt theo nhân viên / nguồn / nhu cầu, lý do thất bại |
| **Cài đặt** (Admin) | Thành viên & vai trò, số ngày "bỏ quên", danh mục, mẫu email/Zalo, nhập CSV |

**Phân quyền**

| | Sale | Trưởng KD | Admin |
|---|:-:|:-:|:-:|
| Xem & sửa mọi lead, ghi tương tác | ✓ | ✓ | ✓ |
| Tạo lead | ✓ (vào hàng chờ) | ✓ | ✓ |
| Giao / đổi người phụ trách | | ✓ | ✓ |
| Xoá lead | | ✓ | ✓ |
| Cài đặt, thành viên, nhập dữ liệu | | | ✓ |

Quyền được kiểm soát ở tầng cơ sở dữ liệu (Row Level Security), không chỉ ẩn trên giao diện.

---

## Cài đặt (làm 1 lần, khoảng 20 phút)

### Bước 1 — Tạo Supabase
1. Vào https://supabase.com → **Start your project** → đăng nhập bằng GitHub.
2. **New project**: tên `fairplay-crm`, đặt Database Password (lưu lại), Region **Southeast Asia (Singapore)** → Create.
3. Vào **SQL Editor → New query**, dán toàn bộ nội dung file `supabase/schema.sql` → **Run**.
4. Vào **Authentication → Sign In / Providers → Email**: **tắt** "Allow new users to sign up" (chỉ Admin được tạo tài khoản).
5. Vào **Authentication → URL Configuration**: Site URL = địa chỉ GitHub Pages của app (Bước 3).

### Bước 2 — Tạo tài khoản
1. **Authentication → Users → Add user → Create new user**, tick **Auto Confirm User**.
2. **Tài khoản đầu tiên tạo sẽ tự động là Admin** → tạo tài khoản của anh/chị trước.
3. Tạo tiếp tài khoản cho từng nhân viên (mặc định là Sale). Vào app → Cài đặt để đặt họ tên & vai trò (Trưởng KD…).

### Bước 3 — Kết nối & đưa lên GitHub Pages
1. Supabase → **Project Settings → API**: copy **Project URL** và **anon public key** vào `js/config.js`.
2. Đẩy code lên repo GitHub `fairplay-crm`.
3. Repo → **Settings → Pages** → Source: *Deploy from a branch*, Branch: `main` / `(root)` → Save. Sau 1–2 phút app chạy tại `https://<tài-khoản>.github.io/fairplay-crm/`.

> Anon key là khoá công khai theo thiết kế của Supabase; dữ liệu được bảo vệ bởi phân quyền. **Không bao giờ** đưa `service_role` key vào code.

### Bước 4 — Chuyển dữ liệu từ Excel cũ
```bash
python3 tools/convert_excel.py "../Tổng hợp thông tin công việc Fairplay Sports.xlsx" import/leads.csv
```
Sau đó đăng nhập Admin → **Cài đặt → Nhập dữ liệu từ file CSV** → chọn `import/leads.csv`.
Tên trong cột `assignee_name` (Hoàng, Minh, Vũ, Trang, Hiếu, Tuấn Minh) phải trùng họ tên thành viên trong CRM để giao đúng người.
File CSV chứa dữ liệu khách thật và đã được `.gitignore` — không đưa lên GitHub.

---

## Tự động nhận lead Facebook Lead Ads (tuỳ chọn)

Chỉ áp dụng cho quảng cáo dạng **Lead Form** (khách điền form ngay trên Facebook). Lead từ **tin nhắn inbox** thì nhập tay bằng nút "＋ Lead mới" (có kiểm tra trùng).

1. Cài Supabase CLI, rồi trong thư mục dự án:
   ```bash
   supabase login
   supabase link --project-ref <mã-project>
   supabase functions deploy fb-leads --no-verify-jwt
   ```
   Địa chỉ webhook: `https://<mã-project>.supabase.co/functions/v1/fb-leads`
2. https://developers.facebook.com → **Create App** (loại Business) → thêm sản phẩm **Webhooks** → chọn object **Page** → Subscribe field **leadgen**, Callback URL như trên, Verify token là chuỗi tự đặt.
3. Lấy **Page Access Token dài hạn** có quyền `leads_retrieval`, `pages_manage_metadata`, `pages_show_list` (qua Graph API Explorer), rồi đăng ký app với Page:
   `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen`
4. Đặt biến bí mật:
   ```bash
   supabase secrets set FB_VERIFY_TOKEN=... FB_APP_SECRET=... FB_PAGE_TOKEN=...
   ```
5. Kiểm tra bằng **Lead Ads Testing Tool** của Meta → lead xuất hiện trong mục "Chờ giao" của Trưởng KD.

Lưu ý: app ở chế độ Development chỉ nhận lead từ người có vai trò trong app; để chạy thật cần chuyển Live (có thể Meta yêu cầu xác minh doanh nghiệp).

## Zalo
- Hiện tại: nút Zalo mở khung chat với SĐT của khách và tự copy tin nhắn mẫu để dán.
- Gửi Zalo tự động từ CRM cần **Zalo OA đã xác thực + dịch vụ ZNS** (tính phí theo tin) — để giai đoạn sau.

## Cấu trúc
```
index.html            trang chính
css/app.css           giao diện
js/app.js             màn hình (Preact + htm, không cần build)
js/store.js           kết nối dữ liệu (Supabase / Demo)
js/util.js            hằng số, hàm tiện ích
js/config.js          cấu hình Supabase
supabase/schema.sql   bảng dữ liệu + phân quyền
supabase/functions/   webhook Facebook Lead Ads
tools/convert_excel.py  chuyển Excel cũ → CSV
```
