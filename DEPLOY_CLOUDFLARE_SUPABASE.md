# Hướng Dẫn Deploy AutoFillForm Studio lên Cloudflare Workers & Supabase (Gói 0đ, 24/7)

Dự án đã được chuyển đổi từ Python/Flask (Render — hay bị sleep sau 15 phút) sang kiến trúc **Edge Native 24/7**:
- **Frontend**: Static HTML/CSS/JS build ra thư mục `./dist` và phục vụ qua **Cloudflare Workers Static Assets** (`[assets]`).
- **Backend API & Cron**: **Cloudflare Workers (Hono + TypeScript)** với `[triggers] crons = ["* * * * *"]` giúp tự động chạy lịch điền rải giờ (Spread Mode) 24/7 ngay cả khi bạn tắt máy tính.
- **Database**: **Supabase PostgreSQL** kết nối qua HTTPS REST (`@supabase/supabase-js`) tương thích 100% với Edge V8 Isolates.

---

## Phần 1: Tạo Database Supabase (Gói Free 0đ)

1. Truy cập [Supabase Dashboard](https://supabase.com/dashboard) và đăng nhập (có thể dùng tài khoản GitHub).
2. Bấm **New project**, chọn Organization, đặt tên project (ví dụ `autofillform-studio`), đặt mật khẩu Database (lưu lại nếu cần), chọn Region gần Việt Nam nhất (ví dụ **Southeast Asia (Singapore)**) -> **Create new project**.
3. Đợi ~1–2 phút để Supabase khởi tạo xong. Ở menu bên trái, bấm **SQL Editor** -> **New query**.
4. Mở file `supabase/schema.sql` trong repo này, copy toàn bộ nội dung dán vào SQL Editor và bấm **Run** (hoặc `Ctrl + Enter`).
   - Kiểm tra kết quả hiện `Success. No rows returned` là đã tạo xong 3 bảng: `public.campaigns`, `public.campaign_items`, `public.saved_forms`.
5. Lấy 3 thông số kết nối API:
   - Vào **Project Settings** (biểu tượng bánh răng góc dưới trái) -> **API** (hoặc **Data API** / **API Keys**):
     - **Project URL** -> chính là `SUPABASE_URL` (dạng `https://xxxx.supabase.co`)
     - **anon / public key** -> chính là `SUPABASE_ANON_KEY`
     - **service_role / secret key** -> chính là `SUPABASE_SERVICE_ROLE_KEY` *(tuyệt đối giữ bí mật, chỉ điền vào Cloudflare Secrets hoặc `.dev.vars`)*

---

## Phần 2: Chạy thử Local với Wrangler (Tùy chọn)

1. Copy file `.env.example` thành `.dev.vars` ở thư mục gốc dự án:
   ```bash
   cp .env.example .dev.vars
   ```
2. Điền `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (và `GROQ_API_KEY` nếu có) vào `.dev.vars`.
3. Chạy kiểm tra TypeScript, build `./dist` và bật server local:
   ```bash
   npm install
   npm run typecheck
   npm run dev
   ```
4. Mở trình duyệt vào `http://127.0.0.1:8787` và kiểm tra `/api/health` trả về `"supabase_configured": true`.

---

## Phần 3: Nối GitHub vào Cloudflare Dashboard & Deploy

1. Truy cập [Cloudflare Dashboard](https://dash.cloudflare.com/) -> chọn **Workers & Pages** ở menu trái.
2. Bấm nút **Create** -> chuyển sang tab **Workers** (hoặc chọn **Continue with GitHub** / **Connect to Git**).
3. Kết nối tài khoản GitHub của bạn và chọn repository **`lnm59205/AutoFillForm`**.
4. Cấu hình mục **Build configuration**:
   - **Project / Worker name**: `autofillform-studio` (khớp `name` trong `wrangler.toml`)
   - **Production branch**: `main`
   - **Build command**: `npm run build`
   - **Deploy command**: `npx wrangler deploy`
   - *(Nếu giao diện hỏi Build output directory, chọn `./dist` — `wrangler.toml` đã tự khai báo `[assets] directory = "./dist"` và `main = "src/index.ts"`)*
5. Cấu hình **Variables and Secrets** trước khi Deploy (hoặc vào Worker -> **Settings** -> **Variables and Secrets** sau khi tạo):
   - `SUPABASE_URL` *(Text hoặc Secret)*: Project URL từ Bước 1.5
   - `SUPABASE_ANON_KEY` *(Secret)*: anon public key
   - `SUPABASE_SERVICE_ROLE_KEY` *(Secret — bắt buộc)*: service_role key để Worker đọc/ghi bảng có bật RLS
   - `GROQ_API_KEY` *(Secret — tùy chọn)*: Groq API key của riêng bạn
   - Bấm **Save and Deploy** (hoặc **Deploy**).
6. Chờ Cloudflare build (~30–60 giây). Sau khi xong, bạn sẽ nhận URL dạng `https://autofillform-studio.<subdomain>.workers.dev`.
7. Kiểm tra hoạt động:
   - Mở `https://autofillform-studio.<subdomain>.workers.dev/api/health` -> kết quả phải hiển thị:
     ```json
     {"ok":true,"runtime":"cloudflare-workers-hono","supabase_configured":true}
     ```
   - Kiểm tra Cron Trigger tại Worker -> **Settings** -> **Triggers** -> **Cron Triggers**: đảm bảo lịch `* * * * *` đã được kích hoạt để chạy rải giờ 24/7.

> **Lưu ý về Cloudflare Pages vs Workers:** Dự án dùng **Cloudflare Workers + Static Assets** (`wrangler.toml`) thay vì Pages thuần vì Workers hỗ trợ sẵn **Cron Triggers (`* * * * *`)** trên gói 0đ để tự động gửi form theo lịch rải giờ khi bạn đóng trình duyệt. Nếu bạn lỡ tạo dưới dạng Cloudflare Pages thuần, hãy tạo lại bằng nút **Workers & Pages -> Create -> Import a repository** với `Deploy command: npx wrangler deploy`.

---

## Phần 4: Gắn Tên Miền Riêng trên Cloudflare DNS

1. Đưa tên miền của bạn về Cloudflare (nếu chưa có):
   - Tại Cloudflare Dashboard -> **Add a domain**, nhập tên miền (ví dụ `autofillform.vn`), chọn gói **Free (0đ)**, rồi trỏ 2 **Nameservers** tại nhà cung cấp tên miền (Tentenn, PA, Namecheap, Porkbun...) sang 2 Nameservers mà Cloudflare cung cấp.
2. Gắn Custom Domain trực tiếp vào Worker:
   - Vào **Workers & Pages** -> chọn Worker **`autofillform-studio`**.
   - Chọn tab **Settings** -> **Domains & Routes** -> bấm **+ Add** -> chọn **Custom domain**.
   - Nhập tên miền (ví dụ `form.tenmiencuaban.com` hoặc `tenmiencuaban.com`) -> bấm **Add domain**.
3. Cloudflare sẽ **tự động tạo bản ghi DNS và cấp chứng chỉ SSL/TLS (HTTPS)** trong khoảng 1–3 phút.
4. Vào **SSL/TLS** -> **Overview**, đảm bảo chế độ mã hóa là **Full** hoặc **Full (strict)** để tránh lỗi vòng lặp chuyển hướng.

---

## Xử Lý Sự Cố Nhanh

| Hiện tượng | Nguyên nhân | Cách khắc phục |
|---|---|---|
| `/api/health` báo `"supabase_configured": false` | Chưa thêm `SUPABASE_URL` hoặc key vào Worker Secrets | Worker -> Settings -> Variables and Secrets -> thêm đủ `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` -> Deploy lại |
| Lỗi RLS / không lưu được chiến dịch vào Supabase | Dùng nhầm `anon` key cho `SUPABASE_SERVICE_ROLE_KEY` | Kiểm tra lại `service_role` key trong Supabase Project Settings -> API |
| Bấm Run rải giờ xong đóng tab vẫn không gửi tiếp | Cron Trigger chưa chạy hoặc bảng `campaign_items` chưa tạo | Chạy lại `supabase/schema.sql` và kiểm tra Worker -> Triggers -> Cron `* * * * *` |
