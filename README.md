# Design Copycat AI

Nền tảng tạo ảnh marketing bằng AI theo mô hình **trả trước bằng điểm**: khách đăng ký tài
khoản → thanh toán bằng thẻ qua **Stripe** → nhận điểm → dùng điểm để tạo ảnh.

> **Bản quốc tế.** Toàn bộ giao diện phía khách hàng viết bằng **tiếng Anh**, giá niêm yết
> bằng **USD**, thu tiền qua **Stripe Checkout**. Riêng **trang Quản trị giữ nguyên tiếng
> Việt** — đó là khu vực nội bộ, người vận hành là người Việt.
>
> Ranh giới này là quy ước của dự án, không phải ngẫu nhiên:
>
> | Nơi | Ngôn ngữ |
> |---|---|
> | Trang giới thiệu, Studio, Ví điểm, Mua điểm, Chính sách, Affiliate | Tiếng Anh |
> | Thông báo lỗi API trả cho khách, mail đặt lại mật khẩu | Tiếng Anh |
> | Trang Quản trị (`/quan-tri`), log khởi động, chú thích trong mã nguồn | Tiếng Việt |
>
> Hai bộ hàm định dạng riêng trong [lib/format.ts](lib/format.ts) giữ ranh giới đó:
> `formatNumber`/`formatDateTime`/`STATUS_LABEL` cho khách, `formatNumberVi`/
> `formatDateTimeVi`/`STATUS_LABEL_VI` cho quản trị.

Trước đây ứng dụng chỉ có phần web gọi thẳng API Kie.ai bằng key nhúng sẵn trong mã nguồn.
Bản này bổ sung backend, cơ sở dữ liệu và toàn bộ luồng kinh doanh; API key của nhà cung cấp
nằm trên server, trình duyệt không còn nhìn thấy.

---

## 1. Chạy dự án

### Yêu cầu
- Node.js 20 trở lên
- MySQL 8 hoặc MariaDB 10.4 trở lên đang chạy

### Các bước

```bash
npm install

# Tạo file cấu hình rồi mở ra điền thông tin thật
cp .env.example .env

npm run dev
```

`npm run dev` chạy song song hai tiến trình:
- **web** — Vite tại http://localhost:3000 (mở trang này)
- **api** — Express tại http://localhost:4000

Vite chuyển tiếp `/api` và `/files` sang Express nên trình duyệt coi hai bên cùng một origin,
cookie đăng nhập hoạt động bình thường.

### Những mục **bắt buộc** điền trong `.env`

| Biến | Ý nghĩa |
|---|---|
| `DB_HOST` `DB_USER` `DB_PASSWORD` `DB_NAME` | Kết nối MySQL. Server tự tạo database và bảng khi khởi động. |
| `JWT_SECRET` | Chuỗi ngẫu nhiên dài. Sinh bằng `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ADMIN_EMAILS` | Email được quyền admin, cách nhau bằng dấu phẩy |
| `KIE_API_KEY` | API key Kie.ai của bạn |
| `STRIPE_SECRET_KEY` | Khoá bí mật Stripe (`sk_test_…` khi thử, `sk_live_…` khi bán thật) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret của endpoint webhook (`whsec_…`) |
| `APP_URL` | Stripe dựng link quay-về từ đây — để sai là khách trả tiền xong bị ném về localhost |

Chưa cấu hình `STRIPE_WEBHOOK_SECRET` thì hệ thống vẫn cộng điểm được (server tự hỏi thẳng
Stripe mỗi lần khách mở trang đơn), nhưng chậm hơn và không có nhật ký sự kiện. Server in
cảnh báo cho từng mục còn thiếu khi khởi động.

### Chạy thật (một tiến trình duy nhất)

```bash
npm run build   # build web ra thư mục dist/
npm start       # Express phục vụ cả API lẫn web tĩnh tại cổng PORT
```

---

## 1b. Deploy lên VPS

### Thứ tự bắt buộc

```bash
git clone https://github.com/schhung1822/copycat.git
cd copycat

cp .env.example .env && nano .env      # điền DB, JWT_SECRET, ADMIN_EMAILS, KIE_API_KEY...

npm install                            # KHÔNG dùng --omit=dev ở bước này (cần vite để build)
npm run build                          # BẮT BUỘC — thiếu bước này web sẽ không hiện

npm i -g pm2
pm2 start npm --name copycat -- start
pm2 save && pm2 startup                # để tự chạy lại sau khi VPS khởi động lại
```

Chạy `npm start` trực tiếp trong SSH thì tiến trình sẽ **chết ngay khi bạn đóng terminal** —
đây là nguyên nhân 502 phổ biến nhất. Luôn dùng pm2 (hoặc systemd).

### Cấu hình nginx

Cổng trong `proxy_pass` phải **trùng với `PORT` trong `.env`** (mặc định 4000):

```nginx
server {
    listen 80;
    server_name tenmien-cua-ban.com;

    client_max_body_size 50M;          # ảnh gửi lên dạng base64, mặc định 1M của nginx là không đủ

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 300s;       # tạo ảnh 4K có thể mất vài phút
    }
}
```

Sau đó bật HTTPS: `sudo certbot --nginx -d tenmien-cua-ban.com`.

Khi đã có HTTPS thì đặt trong `.env`:

```env
NODE_ENV=production
APP_URL=https://tenmien-cua-ban.com
HOST=127.0.0.1
```

> `NODE_ENV=production` bật cờ `secure` cho cookie đăng nhập, nghĩa là cookie **chỉ hoạt động
> qua HTTPS**. Nếu site còn chạy HTTP thuần, cứ để `NODE_ENV=development` cho tới khi cài xong
> SSL. (Ứng dụng có sẵn cơ chế dự phòng bằng header `Authorization` nên vẫn đăng nhập được,
> nhưng cứ cấu hình đúng thì hơn.)

### ⚠️ Trên VPS đừng chạy `npm run dev`

`npm run dev` là chế độ phát triển: nó bật **hai** tiến trình (Vite ở cổng 3000 + API ở cổng
4000), tự nạp lại khi sửa mã, và chậm hơn nhiều. Trên máy chủ thật chỉ chạy `npm start` —
một tiến trình duy nhất ở cổng `PORT`, phục vụ cả API lẫn giao diện đã build.

Chạy `npm run dev` nhiều lần rồi đóng terminal sẽ để lại một đống tiến trình mồ côi giữ cổng.
Khi đó Vite tự nhảy sang 3001, 3002... còn API thì báo "Cổng 4000 đang bị chiếm", và nginx
vẫn trỏ vào cổng cũ đang bị một tiến trình treo giữ → **502**.

### Dọn sạch tiến trình cũ rồi chạy lại

```bash
# 1. Xem đang có gì chiếm cổng
pm2 list
ss -tlnp | grep -E ':(3000|3001|3002|4000)'

# 2. Dọn hết
pm2 delete all
pkill -f "server/src/index.ts"
pkill -f "tsx watch"
pkill -f vite

# 3. Xác nhận đã sạch — lệnh này không in ra gì là đúng
ss -tlnp | grep -E ':(3000|4000)'

# 4. Chạy đúng chế độ production
npm install
npm run build
pm2 start npm --name copycat -- start
pm2 save

# 5. Kiểm tra
pm2 logs copycat --lines 30
curl -i http://127.0.0.1:4000/api/health
```

### Tạo ảnh báo "Authentication failed" / không kết nối được nhà cung cấp AI

Nghĩa là Kie.ai từ chối `KIE_API_KEY`. Kiểm tra chính cái key đó bằng lệnh sau, chạy ngay trong
thư mục dự án trên VPS (đọc thẳng từ `.env` nên không sợ chép nhầm):

```bash
cd /var/www/copycat
KEY=$(grep -E '^KIE_API_KEY=' .env | cut -d= -f2- | tr -d "\"'\r ")
echo "Độ dài key: ${#KEY}"

curl -s -X POST https://kieai.redpandaai.co/api/file-base64-upload \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"base64Data":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=","uploadPath":"images"}'
```

| Kết quả | Nghĩa là | Cách xử lý |
|---|---|---|
| `{"success":true,...}` kèm URL | Key tốt, lỗi nằm ở chỗ server chưa nạp lại `.env` | `pm2 restart copycat` rồi thử lại |
| `code: 401` | Key sai hoặc đã bị thu hồi | Vào kie.ai lấy key mới, dán lại vào `.env`, `pm2 restart copycat` |
| Độ dài key bằng 0 | Dòng `KIE_API_KEY=` trống hoặc sai tên biến | Kiểm tra lại `.env`, tên biến phải viết đúng, không có dấu cách trước dấu `=` |

Hay gặp nhất: dán key vào `nano` bị **xuống dòng giữa chừng** nên key bị cắt cụt — dòng
"Độ dài key" ở trên sẽ cho thấy ngay.

> **Đừng đổi `KIE_UPLOAD_URL` sang `api.kie.ai`.** Tài liệu Kie.ai ghi endpoint upload là
> `https://api.kie.ai/api/file-base64-upload`, nhưng địa chỉ đó trả về **404** (đã kiểm chứng).
> Endpoint upload thật nằm ở host riêng `kieai.redpandaai.co`, đúng như giá trị mặc định.

### Gặp lỗi 502 Bad Gateway — kiểm tra theo thứ tự

502 luôn có nghĩa là **nginx chạy bình thường nhưng không gọi được vào tiến trình Node**.
Nginx không phải thủ phạm, hãy soi tiến trình Node trước:

```bash
# 1. Node còn sống không?
pm2 list
pm2 logs copycat --lines 50        # ĐÂY LÀ CHỖ QUAN TRỌNG NHẤT — lỗi thật nằm ở đây

# 2. Có thật sự đang nghe ở cổng đó không?
ss -tlnp | grep node

# 3. Gọi thẳng vào Node, bỏ qua nginx
curl -i http://127.0.0.1:4000/api/health
```

| Kết quả bước 3 | Nghĩa là | Cách xử lý |
|---|---|---|
| `{"ok":true,...}` | Node ổn, lỗi nằm ở nginx | Sửa cổng trong `proxy_pass` cho khớp `PORT`; `nginx -t && systemctl reload nginx` |
| `Connection refused` | Node không chạy hoặc sai cổng | Xem `pm2 logs`, đối chiếu `PORT` trong `.env` |
| Treo, không trả lời | Node bị chặn bởi tường lửa nội bộ | Trên CentOS/RHEL: `setsebool -P httpd_can_network_connect 1` |

Các nguyên nhân hay gặp nhất, theo thứ tự:

1. **Tiến trình đã chết** — chạy `npm start` trong SSH rồi đóng terminal. Dùng pm2.
2. **Không kết nối được MySQL** — sai `DB_PASSWORD`, hoặc MySQL chưa chạy. Server sẽ thoát ngay
   khi khởi động và in rõ lý do trong `pm2 logs`.
3. **Cổng lệch nhau** — nginx trỏ vào 3000 nhưng `PORT=4000` (hoặc ngược lại).
4. **Thiếu `.env`** — server dùng giá trị mặc định, không nối được DB rồi thoát.
5. **Cài thiếu package** — nếu đã lỡ chạy `npm install --omit=dev`, chạy lại `npm install`.

Toàn bộ lỗi khởi động đều được in bằng tiếng Việt kèm hướng khắc phục, nên `pm2 logs copycat`
gần như luôn chỉ thẳng ra vấn đề.

---

## 2. Tài khoản admin

Quyền admin **chỉ điều khiển bằng `.env`**, không sửa được từ giao diện:

```env
ADMIN_EMAILS=admin@nextgenholdings.nl,sep@congty.com
```

Mỗi lần khởi động, server đồng bộ lại cột `role`: email có trong danh sách được nâng lên
admin, email bị gỡ khỏi danh sách bị hạ xuống user. Mọi request cũng kiểm tra lại theo `.env`
nên dữ liệu trong DB có bị sửa tay cũng không leo thang quyền được.

Muốn tạo sẵn tài khoản admin ngay lần chạy đầu, điền thêm:

```env
ADMIN_BOOTSTRAP_EMAIL=admin@nextgenholdings.nl
ADMIN_BOOTSTRAP_PASSWORD=mat-khau-manh
```

Admin vào mục **Quản trị** trên thanh điều hướng, gồm 4 tab:

| Tab | Nội dung |
|---|---|
| Tổng quan | Doanh thu, chi phí vốn, lợi nhuận gộp, số khách, tỉ lệ ảnh thành công, biểu đồ theo ngày, hiệu quả từng model, top khách hàng |
| Đơn nạp | Lọc theo trạng thái, tìm theo mã đơn/email, duyệt tay, huỷ đơn |
| Khách hàng | Xem và sửa hồ sơ, mật khẩu; cộng–trừ điểm theo từng nguồn; cấp gói tháng tay (di sản) |
| Bảng giá & gói điểm | Sửa trực tiếp giá vốn, số điểm thu, slug model, giá gói điểm, điểm thưởng |

### Sửa thông tin khách hàng

Nút **Sửa** ở tab Khách hàng mở form gồm:

| Nhóm | Trường |
|---|---|
| Hồ sơ | Họ tên, số điện thoại, email (cũng là tên đăng nhập), trạng thái hoạt động / khoá |
| Gói &amp; hạn mức | Ngày hết hạn gói, hạn mức mỗi tháng, thời điểm cấp lại hạn mức |
| Bảo mật | Đặt lại mật khẩu (tối thiểu 8 ký tự) |

Nút **Điểm** cộng/trừ điểm và **bắt buộc chọn nguồn**, vì hai nguồn không thay thế cho nhau
được — hạn mức tháng bị xoá khi sang chu kỳ mới, còn điểm mua thêm là tiền thật khách đã trả:

- **Điểm mua thêm** (mặc định) — không hết hạn. Dùng cho đền bù, khuyến mãi.
- **Hạn mức tháng** — không cộng vượt quá hạn mức của gói, vì phần dư sẽ biến mất không dấu
  vết ở chu kỳ sau và con số "600.000 / 500.000" trên màn hình khách là vô nghĩa.

Mọi thay đổi số dư đều ghi một dòng vào sổ cái `token_transactions` kèm lý do, kể cả khi hạ
hạn mức tháng làm số dư bị kéo xuống theo — nếu không, tổng sổ cái sẽ lệch với số dư thật.

### Tặng điểm cho khách

Nút **Điểm** ở tab Khách hàng cộng (hoặc trừ) điểm thẳng vào ví, **không qua đơn chuyển
khoản**. Dùng khi khách trả tiền ngoài luồng (thu tiền mặt, hợp đồng riêng), khi tặng điểm dùng
thử, hoặc khi cần bù cho khách sau sự cố. Chọn nguồn `purchased` — điểm không hết hạn, đúng thứ
khách mong đợi.

Muốn tặng điểm cho **mọi tài khoản đăng ký mới**, sửa `free_tokens_on_signup` trong bảng
`settings` (mặc định `0`).

### Cấp gói tháng cho khách (đã ngừng bán)

Nút **Gói** ở tab Khách hàng kích hoạt một gói tháng thẳng cho khách. Gói tháng không còn bán
cho khách nữa (xem [Di sản gói tháng](#di-sản-gói-tháng)); đường này giữ lại để tặng **hạn mức
tháng** cho khách VIP. Chọn gói, số tháng và cách tính thời hạn:

- **Gia hạn** — nối tiếp vào ngày hết hạn hiện tại, giữ nguyên hạn mức của chu kỳ đang dùng dở.
- **Đổi gói** — bỏ hạn cũ, tính lại từ hôm nay và cấp hạn mức mới ngay. Hạn mức thừa của gói cũ
  bị thu hồi (có ghi sổ cái).

Thao tác này chạy qua đúng đường kích hoạt của đơn đã thanh toán nên bảng `subscriptions` và sổ
cái hạn mức giống hệt luồng mua thường; khác duy nhất là `order_id` để `NULL` và **không** cộng
`total_topup_usd_cents` — tiền không vào thì doanh thu không được tính khống.

> Cân nhắc dùng nút **Điểm** thay cho nút này trong hầu hết trường hợp: hạn mức tháng **bị thu
> hồi** khi hết hạn gói và **không cộng dồn** qua chu kỳ, còn điểm tặng thì khách giữ mãi.

Ba thứ **không** sửa được từ giao diện, do thiết kế:

| Không sửa được | Lý do |
|---|---|
| Quyền admin (`role`) | Suy ra từ `ADMIN_EMAILS` ở mỗi lần đọc phiên đăng nhập, ghi vào cột `role` sẽ bị ghi đè |
| Email của tài khoản admin | Đổi ở đây là tự tước quyền mình mà `.env` vẫn ghi email cũ. Sửa `.env` rồi khởi động lại |
| Tự khoá tài khoản đang đăng nhập | Khoá xong chỉ mở lại được bằng cách sửa thẳng cơ sở dữ liệu |

> Tab **Webhook ngân hàng** đã bỏ. Webhook vẫn chạy và vẫn ghi đủ vào bảng `payment_events`;
> khi cần tra một giao dịch thất lạc thì gọi thẳng endpoint (vẫn còn, chỉ không có giao diện):
>
> ```bash
> curl -s -b cookie.txt 'http://localhost:4000/api/admin/payment-events?limit=20'
> ```

---

## 3. Mô hình kinh doanh

Khách **mua điểm và dùng dần**. Không có gói thuê bao, không phí duy trì, không cam kết thời
hạn: tạo tài khoản xong, mua một gói điểm bất kỳ là tạo ảnh được ngay.

> **Gói thuê bao theo tháng đã ngừng bán.** Phần còn lại của mô hình đó trong mã nguồn là có
> chủ đích — xem [Di sản gói tháng](#di-sản-gói-tháng) ở cuối mục này.

### Đơn vị điểm

> **10.000 điểm = $1 giá vốn nhà cung cấp** (tức 1 điểm = $0,0001).

Đây là điểm mấu chốt để mọi con số khớp nhau:

| Khái niệm | Cách tính | Kết quả |
|---|---|---|
| Điểm tiêu hao mỗi ảnh | `api_cost_usd × CREDITS_PER_USD` | GPT 1K = 300 · Pro 4K = 1.200 |
| Gói điểm | khách nhận **một nửa** lượng điểm so với số tiền bỏ ra tính theo giá vốn | $49,99 → **250.000 điểm** |

Bán gấp đôi giá vốn: phần chênh lệch là chi phí duy trì, nhân sự và lợi nhuận. Nói cách
khác, **$1 tiền bán mua được 5.000 điểm**.

### Bảng giá gói điểm

Giá bán làm tròn xuống mốc x9,99 nên đơn giá luôn xấp xỉ $0,0002/điểm.

| Gói | Tên hiện cho khách | Điểm nhận | Giá vốn số điểm |
|---|---|---|---|
| $9,99 | Starter | 50.000 | $5,00 |
| $19,99 | Basic | 100.000 | $10,00 |
| **$49,99** | **Pro** | **250.000** | $25,00 |
| $99,99 | Business | 500.000 | $50,00 |
| $199,99 | Agency | 1.000.000 | $100,00 |

> Tên gói và mô tả gói **hiển thị cho khách** nên phải viết bằng tiếng Anh khi sửa trong
> Quản trị → Bảng giá. Giá nhập bằng **đô-la** (vd `49.99`), hệ thống tự quy sang cent.

Sửa giá và số điểm ở tab **Bảng giá** trong trang Quản trị, hoặc trong `TOKEN_PACKAGES` của
[seed.ts](server/src/seed.ts) nếu muốn đổi bộ mặc định.

### Luồng hoạt động

```
Đăng ký / Đăng nhập
        │
        ▼
Chọn gói điểm ──► Ghi đơn vào DB (mã ORDxxxxxx) ──► Mở phiên Stripe Checkout
        │                                                    │
        │                              khách nhập thẻ ở Stripe│
        │                                                    ▼
        │                     Stripe ──► Webhook checkout.session.completed
        │                        │                           │
        │  (dự phòng) khách mở lại trang đơn ──► hỏi thẳng Stripe
        │  (dự phòng) vòng đối soát định kỳ ────┤
        │                                       ▼
        │                        Cộng điểm vào ví (không hết hạn)
        │                                       │
        └───────────────────────────────────────┤
                                                ▼
                                     Tạo ảnh ──► Trừ điểm
                                                │
                                 ┌──────────────┴──────────────┐
                              thành công                      lỗi
                                 │                             │
                    Tải ảnh về server              Hoàn đúng số điểm đã trừ
```

Ba đường cùng đưa đơn về trạng thái đã trả là **cố ý dư thừa**: webhook là đường chính,
hai đường còn lại cứu các trường hợp webhook trễ hoặc chưa được cấu hình. Cả ba đều đi qua
`markOrderPaid`, vốn khoá dòng đơn bằng `FOR UPDATE` và chỉ cộng điểm cho đơn chưa giao,
nên chạy chồng nhau cũng không cộng điểm hai lần.

### Di sản gói tháng

Trước đây khách **bắt buộc** mua gói thuê bao tháng (kèm hạn mức 500.000
điểm/tháng không cộng dồn) rồi mới được tạo ảnh, và điểm lẻ chỉ là phần mua thêm. Mô hình đó
đã bỏ, nhưng hạ tầng của nó vẫn còn trong mã nguồn vì hai lý do:

1. **Gói đã bán phải chạy hết hạn.** Khách đã trả tiền cho chúng, nên `monthly_tokens` vẫn
   được cấp lại, tiêu và thu hồi đúng như cũ cho tới khi gói cuối cùng hết hạn.
2. **Admin vẫn cấp gói tay được** cho khách VIP ở tab Khách hàng → nút **Gói**.

Vì vậy hệ thống vẫn có **hai nguồn điểm**:

| Nguồn | Nguồn gốc | Hết hạn |
|---|---|---|
| **Điểm đã mua** (`purchased`) | Khách mua gói điểm — nguồn duy nhất của khách mới | Không |
| **Hạn mức tháng** (`monthly`) | Gói tháng cũ hoặc admin cấp tay | **Có** — không cộng dồn, sang chu kỳ mới là mất |

Khi tạo ảnh, hệ thống **trừ hạn mức tháng trước**, cạn mới dùng tới điểm đã mua — phần sắp hết
hạn được tiêu trước. Với khách chỉ mua điểm thì `monthly_tokens` luôn bằng 0 nên mọi thứ chảy
qua nhánh `purchased`, và giao diện ẩn hẳn khái niệm "hạn mức tháng" khỏi mắt họ.

**Đã gỡ hẳn:** bán và gia hạn gói qua chuyển khoản, nâng gói (khấu trừ theo ngày), hàm chặn
`requireSubscription`, và endpoint `/orders/subscription` · `/orders/upgrade` ·
`/orders/upgrade-options`. Bảng `subscriptions`, `subscription_plans` và các cột `monthly_*`
trên `users` **giữ nguyên** — sổ cái `token_transactions` có các dòng `bucket = 'monthly'` tham
chiếu tới chúng, xoá đi là hỏng lịch sử kế toán.

Khi ô **Gói tháng còn hạn** ở trang Tổng quan về 0 và không cần tra doanh thu gói cũ nữa thì
mới gỡ được nốt phần này.

### Điểm quan trọng về tiền và điểm

- **Không có điều kiện gì trước khi mua điểm hay tạo ảnh.** Đăng ký xong là mua được, mua xong
  là tạo được. Hết điểm thì mua thêm — server chỉ chặn đúng một chỗ: không đủ điểm cho lô ảnh
  đang yêu cầu (lỗi 402 `insufficient_tokens`).
- **Điểm đã mua không hết hạn.** Số dư nằm trong `users.token_balance` cho tới khi tiêu hết.
- **Hoàn điểm khi ảnh lỗi trả về đúng nguồn đã trừ.** Phần hạn mức tháng (nếu có) bị chặn không
  cho vượt quá hạn mức của gói, nên ảnh lỗi sau khi đã sang chu kỳ mới không tạo ra điểm khống.
- **Hạn mức tháng của gói cũ được cấp lại ngay lúc khách dùng tới** (lazy), không cần cron. Nhờ
  vậy số liệu luôn đúng kể cả khi server vừa khởi động lại hay dừng vài ngày.
- **Mọi biến động điểm đều được ghi vào bảng `token_transactions`** kèm số dư sau giao dịch.
  Không có đường nào sửa `users.token_balance` mà không ghi sổ.
- **Trừ điểm và cộng điểm chạy trong transaction có khoá dòng** (`SELECT ... FOR UPDATE`),
  nên hai request tạo ảnh song song không thể cùng đọc một số dư cũ rồi trừ đè lên nhau.
- **Ảnh lỗi được hoàn điểm tự động.** Server khởi động lại giữa chừng cũng hoàn điểm cho các
  ảnh đang dở dang, khách không bị treo tiền.
- **Webhook chống cộng trùng** bằng khoá duy nhất `(provider, external_id)` trong bảng
  `payment_events`, cộng với việc chỉ đơn ở trạng thái `pending` mới được cộng điểm. Cổng
  thanh toán bắn lại giao dịch hay admin bấm duyệt hai lần đều không cộng điểm hai lần.
- **Chuyển khoản thiếu tiền không được cộng tự động** — đơn giữ nguyên `pending` để admin xử lý.

---

## 3b. Tiếp thị liên kết (affiliate)

Khách được cấp vai trò **cộng tác viên** sẽ có một link giới thiệu riêng. Ai đăng ký tài khoản
mới từ link đó được ghi nhận là khách của họ, và **mọi đơn khách đó thanh toán** đều sinh ra một
khoản hoa hồng.

### Cách tính

```
lợi nhuận = số tiền khách trả − giá vốn số điểm đã bán − chi phí cố định
hoa hồng  = lợi nhuận × tỉ lệ %          (lợi nhuận ≤ 0 thì hoa hồng = 0)
```

- **Giá vốn số điểm** dựa trên quy ước xuyên suốt hệ thống: 1 điểm = 1đ giá vốn nhà cung cấp.
  Gói `EXTRA_199` bán 199.000đ / 100.000 điểm → giá vốn 100.000đ, lợi nhuận 99.000đ.
- **Chi phí cố định** gồm hai phần cộng lại, cả hai đều chỉnh được: một số tiền cố định mỗi đơn
  (phí cổng thanh toán, phí xử lý) và một tỉ lệ % doanh thu (hạ tầng, nhân sự, marketing). Mặc
  định cả hai bằng 0 — chỉ chủ hệ thống mới biết mỗi đơn thực sự gánh thêm bao nhiêu.
- Với cấu hình mặc định (40%, không chi phí cố định), đơn `EXTRA_199` cho cộng tác viên
  **39.600đ**.

Toàn bộ cách tính được **chụp lại vào từng dòng** trong `affiliate_commissions`. Đổi tỉ lệ về
sau chỉ áp dụng cho đơn phát sinh từ đó trở đi; các khoản đã ghi giữ nguyên con số cũ.

### Điều chỉnh ở đâu

**Quản trị → Affiliate** có ô cấu hình tỉ lệ hoa hồng, hai khoản chi phí cố định, và công tắc
bật/tắt cả chương trình. Ngay dưới form là ví dụ tính trên một gói điểm đang bán thật — do
server tính bằng đúng hàm sẽ ghi vào sổ, nên con số nhìn thấy trước khi lưu không thể lệch với
con số thực tế. Bốn giá trị này nằm trong bảng `settings`
(`affiliate_enabled`, `affiliate_commission_percent`, `affiliate_fixed_cost_vnd`,
`affiliate_fixed_cost_percent`), sửa nóng, không cần khởi động lại.

### Cấp vai trò cộng tác viên

**Quản trị → Khách hàng**, tìm tài khoản rồi bấm nút **Affiliate**. Mã giới thiệu được sinh
ngay lúc cấp.

Vai trò này là một **cờ riêng** (`users.is_affiliate`) chứ không phải một giá trị của cột
`role`: `role` bị đồng bộ lại từ `ADMIN_EMAILS` mỗi lần đọc phiên đăng nhập nên nhét
`'affiliate'` vào đó sẽ bị ghi đè ngay, và tách ra thì một admin vẫn có thể đồng thời là cộng
tác viên.

Thu hồi vai trò **chỉ dừng phát sinh hoa hồng mới**. Các khoản đã ghi vẫn còn nguyên và vẫn
phải chi trả; mã giới thiệu cũng được giữ lại để nếu cấp lại thì mọi link đã phát ra ngoài sống
lại nguyên vẹn.

### Đường đi của một lượt giới thiệu

1. Cộng tác viên chia sẻ link `https://tên-miền/?ref=MÃ` (lấy ở tab **Affiliate** của họ). Link
   được dựng theo **đúng tên miền người đó đang truy cập**, không phải theo `APP_URL` — biến đó
   rất dễ bị bỏ quên ở giá trị mẫu `http://localhost:3000`, và khi đó mọi link phát ra ngoài đều
   chết mà không ai nhận ra cho tới lúc có khách bấm vào.
2. Khách bấm link → mã được cất vào `localStorage` của trình duyệt và **gỡ khỏi thanh địa chỉ**
   ngay (để nguyên thì khách copy link đang xem gửi cho bạn bè, lượt giới thiệu bị tính nhầm
   người). Mã sống **60 ngày**, nên khách không cần đăng ký ngay hôm đó.
3. Khách đăng ký → `users.referred_by` được gán **một lần duy nhất** và không bao giờ đổi.
4. Khách thanh toán đơn → `fulfillOrder` ghi một dòng vào `affiliate_commissions`, **trong cùng
   transaction** với việc cộng điểm. Khoá duy nhất trên `order_id` chặn ghi trùng khi webhook
   bắn lại hoặc bộ đối soát chạy song song.
5. Admin chi trả bằng tay ở ngân hàng rồi bấm **Chốt trả** để đánh dấu đã thanh toán.

Mã sai không chặn được việc đăng ký — khách gõ thiếu một ký tự thì vẫn tạo được tài khoản, chỉ
là không ai được ghi công. Mã của chính mình cũng không tự gán cho mình được.

### Chi trả

Sổ hoa hồng ở **Quản trị → Affiliate** lọc theo trạng thái và theo từng cộng tác viên. Mỗi khoản
có ba trạng thái: `pending` (chờ chi trả) → `paid` (đã trả), hoặc `cancelled` cho đơn bị hoàn
tiền / gian lận. Khoản đã huỷ bị loại khỏi mọi con số tổng hợp nhưng dòng ghi vẫn còn để tra
soát. Nút **Chốt trả** đánh dấu toàn bộ khoản đang chờ của một người — **hệ thống không tự
chuyển tiền**, đây chỉ là ghi nhận.

Cộng tác viên xem báo cáo của mình ở tab **Affiliate**: link giới thiệu, số dư chờ chi trả, danh
sách khách và bảng hoa hồng từng đơn. Email khách hiển thị ở dạng đã che (`ng********@gmail.com`)
— họ nhận ra khách của mình là đủ, không cần cầm cả danh sách email của công ty.

---

## 4. Cơ sở dữ liệu

Toàn bộ định nghĩa nằm trong [server/src/schema.sql](server/src/schema.sql), chạy tự động khi
khởi động (`DB_AUTO_MIGRATE=true`).

| Bảng | Vai trò |
|---|---|
| `users` | Khách hàng, hạn mức tháng, điểm đã mua, ngày hết hạn thuê bao |
| `subscription_plans` | Bảng giá gói tháng — đã ngừng bán, giữ để admin cấp tay |
| `subscriptions` | Lịch sử gói tháng đã bán, giữ để đối soát doanh thu cũ |
| `token_packages` | Các gói điểm lẻ mua thêm |
| `model_pricing` | Bảng giá từng model: giá vốn USD ↔ số điểm thu của khách |
| `orders` | Đơn nạp tiền, có snapshot thông tin gói tại thời điểm đặt |
| `token_transactions` | Sổ cái điểm — mỗi dòng ghi rõ tác động vào nguồn nào (`bucket`) |
| `generations` | Từng lệnh tạo ảnh, kèm chi phí vốn và điểm đã trừ từ mỗi nguồn |
| `payment_events` | Nhật ký webhook ngân hàng, chống xử lý trùng |
| `affiliate_commissions` | Hoa hồng tiếp thị liên kết, mỗi đơn đúng một dòng |
| `settings` | Cấu hình sửa nóng không cần restart |

Số tiền lưu dạng **USD cent**, số nguyên (`BIGINT`): `$49.99` = `4999`. Mọi cột tiền mang
hậu tố `_usd_cents`. Không bao giờ lưu số thực — Stripe cũng nhận `unit_amount` bằng cent nên
hai bên khớp tuyệt đối, và cộng trừ số nguyên thì không có sai số làm tròn tích luỹ trong sổ cái.

> **Nâng cấp từ bản bán bằng VNĐ:** khi khởi động, server tự **đổi tên** các cột `*_vnd` thành
> `*_usd_cents` (xem `migrateMoneyColumnsToUsdCents` trong [db.ts](server/src/db.ts)) nhưng
> **KHÔNG quy đổi giá trị** — không có tỉ giá nào đúng cho mọi dòng, và đoán bừa một con số thì
> mọi báo cáo doanh thu về sau đều sai âm thầm. Server in cảnh báo thật to; hãy đặt lại giá gói
> trong Quản trị → Bảng giá, rồi tự quyết định cách xử lý lịch sử đơn cũ. Các gói điểm định giá
> bằng VNĐ (`EXTRA_*`) được tự động **ngừng bán** để không ai lỡ mua gói 99.000 với giá $990.

### Múi giờ: mọi cột `DATETIME` lưu theo giờ UTC

Kết nối MySQL được đặt `timezone: 'Z'` **và** chạy `SET time_zone = '+00:00'` cho từng
connection (xem [db.ts](server/src/db.ts)). Hai thứ này phải đi cùng nhau:

- `timezone: 'Z'` chỉ nói cho thư viện `mysql2` biết cách quy đổi `Date` của JS ↔ chuỗi.
- `SET time_zone` mới đổi múi giờ của chính MySQL, tức là của `NOW()` và `CURRENT_TIMESTAMP`.

Nếu thiếu vế thứ hai, ngày giờ do ứng dụng ghi là UTC còn ngày giờ do SQL ghi là giờ hệ điều
hành — cùng một cột chứa hai chuẩn. Máy chủ đặt UTC+7 thì `expires_at > NOW()` sai 7 tiếng,
gói hết hạn sớm 7 tiếng và mọi mốc thời gian hiển thị lệch 7 tiếng.

Cùng lý do đó, khi cần MySQL tính toán ngày giờ thì phải `CAST(? AS DATETIME)` chứ đừng viết
`SELECT ? AS started_at`: cột không ép kiểu sẽ trả về **chuỗi**, `mysql2` không nhận ra là ngày
giờ nên bỏ qua `timezone: 'Z'`, và `new Date(chuỗi)` lại đọc theo giờ máy chủ.

> Nếu cơ sở dữ liệu đã chạy từ trước bản sửa này, các cột do SQL ghi (`created_at`, `paid_at`…)
> của **dữ liệu cũ** vẫn đang là giờ hệ điều hành nên hiển thị lệch. Dữ liệu mới thì đúng. Muốn
> nắn lại lịch sử thì chạy `UPDATE <bảng> SET created_at = CONVERT_TZ(created_at, '+07:00', '+00:00')`
> cho từng bảng — nhớ backup trước và chỉ chạy đúng **một lần**.

---

## 5. Bảng giá đã cấu hình sẵn

### Điểm tiêu hao mỗi ảnh

`token_cost = api_cost_usd × CREDITS_PER_USD` (10.000 điểm = $1 giá vốn). Cột cuối tính
trên gói $49,99 (250.000 điểm) nếu chỉ dùng một loại ảnh duy nhất.

| Model | Slug gửi API | Giá vốn (Kie.ai) | Điểm/ảnh | Số ảnh với gói $49,99 |
|---|---|---|---|---|
| GPT Image 2 — 1K | `gpt-image-2-image-to-image` | $0.03 | 300 | ~833 |
| **GPT Image 2 — 2K** | `gpt-image-2-image-to-image` | $0.05 | **500** | ~500 |
| GPT Image 2 — 4K | `gpt-image-2-image-to-image` | $0.08 | 800 | ~312 |
| Nano Banana 2 — 1K | `nano-banana-2` | $0.04 | 400 | ~625 |
| Nano Banana 2 — 2K | `nano-banana-2` | $0.06 | 600 | ~416 |
| Nano Banana 2 — 4K | `nano-banana-2` | $0.09 | 900 | ~277 |
| Nano Banana Pro — 1K/2K | `nano-banana-pro` | $0.09 | 900 | ~277 |
| Nano Banana Pro — 4K | `nano-banana-pro` | $0.12 | 1.200 | ~208 |
| Nano Banana 2 Lite | `nano-banana-2-lite` | *chưa rõ* | — | **đang tắt bán** |

> Bảng trên là **giá trị khởi tạo** trong [seed.ts](server/src/seed.ts), không phải giá đang
> bán. Admin chỉnh `Điểm thu` trong trang Quản trị thì chỉ database đổi — bảng này đứng yên.
> Muốn xem số thật thì vào Quản trị → Bảng giá.

Dòng in đậm là **mốc quy đổi**: model dùng để tính "Tạo được tới N ảnh" trên thẻ gói điểm,
ở cả trang giới thiệu lẫn trang Mua điểm. Đổi mốc ở Quản trị → Bảng giá, cột **Mốc quy đổi**
(radio, chỉ một model được chọn, model đã tắt bán thì không chọn được). Sửa **Điểm thu** của
model đang làm mốc là số ảnh trên thẻ gói đổi theo ngay ở lần tải trang sau.

Logic dùng chung nằm ở [lib/imageEstimate.ts](lib/imageEstimate.ts) — cả hai trang gọi cùng
một hàm nên không bao giờ hiện hai con số khác nhau cho cùng một gói.

**Nano Banana 2 Lite** đã được nối sẵn nhưng để trạng thái tắt: Kie.ai không công bố
giá bản Lite trong tài liệu công khai. Vào Quản trị → Bảng giá điền `Giá vốn (USD)` và
`Điểm thu` theo bảng giá thật rồi tick ô **Bán** để mở bán. Model này không có tuỳ chọn
2K/4K nên giao diện tự ẩn phần chọn chất lượng.

### Mỗi model có bộ tham số riêng

Đây là chỗ dễ sai nhất khi thêm model mới — Kie.ai **không** dùng chung một tên trường
cho ảnh đầu vào:

| Model | Trường ảnh | `resolution` | `output_format` | Tối đa ảnh |
|---|---|---|---|---|
| `nano-banana-pro` | `image_input` | có | có | 8 |
| `nano-banana-2` | `image_input` | có | có | 14 |
| `nano-banana-2-lite` | `image_urls` | **không** | **không** | 10 |
| `google/nano-banana-edit` | `image_urls` | **không** | có | 10 |
| `gpt-image-2-image-to-image` | `input_urls` | có | **không** | 16 |

Đặc tả nằm trong `MODEL_SPECS` ở [providers/kie.ts](server/src/providers/kie.ts), lấy từ
https://docs.kie.ai/llms.txt. Thêm model Kie.ai mới thì thêm một dòng ở đó theo đúng trang
tài liệu của model, rồi thêm dòng giá trong trang Quản trị.

GPT Image 2 còn có ràng buộc riêng giữa tỉ lệ và chất lượng (5:4 và 4:5 chỉ chạy 1K; 1:1
không lên được 4K; tỉ lệ "Tự động" chỉ ra 1K). Hệ thống kiểm tra các ràng buộc này **trước
khi trừ điểm** và báo lỗi cụ thể, thay vì trừ rồi hoàn.

Các model Imagen 4 của Google không được đưa vào vì chúng chỉ sinh ảnh từ chữ, không nhận
ảnh sản phẩm nên không dùng được cho luồng sao chép bố cục của ứng dụng này.

Bảng giá gói điểm nằm ở [mục 3](#3-mô-hình-kinh-doanh).

Dữ liệu này chỉ được nạp **một lần** lúc khởi tạo (`INSERT IGNORE`). Sau đó sửa trong tab
**Bảng giá & gói nạp** của trang Quản trị; server không ghi đè lại.

> **Nâng cấp từ bản cũ:** bảng giá đã qua ba đời đơn vị (100đ giá bán → 1đ giá vốn → $0,0001
> nên các con số lệch nhau khoảng 28 lần. Khi khởi động, server tự quy đổi `token_cost` của
> những model còn giữ đúng giá trị mặc định cũ, và ngừng bán 5 gói điểm đời cũ (Trải nghiệm,
> Creator, Creator Plus, Studio, Agency) vì chúng sai đơn vị. Dòng nào bạn đã tự chỉnh trong
> trang Quản trị thì được giữ nguyên — kiểm tra lại sau khi nâng cấp.
>
> Số dư `token_balance` cũ của khách cũng đang ở đơn vị cũ và **không** được tự quy đổi (không
> có cách quy đổi nào đúng cho mọi trường hợp). Số dư cũ giờ mang giá trị rất nhỏ; nếu có khách
> thật đang giữ điểm, hãy dùng Quản trị → Khách hàng → **Sửa điểm** để cấp bù cho đúng.

Riêng slug model là ngoại lệ: khi khởi động, server tự sửa những slug đã biết chắc là sai
(xem `repairKnownBadModelSlugs` trong [seed.ts](server/src/seed.ts)). Slug nào bạn tự đặt
khác đi sẽ được giữ nguyên.

---

## 6. Cấu hình Stripe

### Bước 1 — lấy khoá API

Vào <https://dashboard.stripe.com/apikeys>, chép **Secret key** vào `STRIPE_SECRET_KEY`.
Dùng `sk_test_…` cho tới khi chạy thông, rồi mới đổi sang `sk_live_…`.

### Bước 2 — tạo endpoint webhook

Dashboard → **Developers → Webhooks → Add endpoint**:

| Ô | Giá trị |
|---|---|
| Endpoint URL | `https://tenmien-cua-ban.com/api/webhooks/stripe` |
| Events | `checkout.session.completed` và `checkout.session.async_payment_succeeded` |

Chép **Signing secret** (`whsec_…`) vào `STRIPE_WEBHOOK_SECRET` rồi khởi động lại server.

Chạy thử ở máy cá nhân thì dùng Stripe CLI, khỏi cần ngrok:

```bash
stripe listen --forward-to localhost:4000/api/webhooks/stripe
```

Lệnh này in ra một `whsec_…` tạm — dán vào `.env` và khởi động lại. Thẻ thử: `4242 4242 4242 4242`,
ngày hết hạn bất kỳ trong tương lai, CVC bất kỳ.

### Ba đường cùng xác nhận một đơn

Cố ý dư thừa, để tiền về mà điểm không vào là chuyện không xảy ra:

| Đường | Khi nào chạy | Cần gì |
|---|---|---|
| Webhook `checkout.session.completed` | Ngay khi Stripe thu xong | `STRIPE_WEBHOOK_SECRET` |
| `syncOrderFromStripe` | Mỗi lần khách mở trang đơn — server hỏi thẳng Stripe | chỉ cần `STRIPE_SECRET_KEY` |
| `fulfillPaidOrders` | Vòng đối soát định kỳ + lúc server khởi động | — |

Cả ba đều đi qua `markOrderPaid`: dòng đơn bị khoá `FOR UPDATE`, và chỉ đơn chưa giao mới
được cộng điểm. Chạy chồng nhau, Stripe bắn lại sự kiện, hay admin bấm duyệt tay thêm một lần
đều **không** cộng điểm hai lần.

Mọi sự kiện đã xác minh chữ ký đều được ghi vào bảng `payment_events` (khoá duy nhất trên
`(provider, external_id)`). Tra một giao dịch thất lạc:

```bash
curl -s -b cookie.txt 'http://localhost:4000/api/admin/payment-events?limit=20'
```

### Vì sao webhook phải nằm trước `express.json()`

Stripe ký trên **đúng chuỗi byte gốc** của request. Chỉ cần đi qua một bước parse rồi
stringify lại là byte đổi (thứ tự khoá, khoảng trắng, escape unicode) và mọi chữ ký hợp lệ
đều trượt. Vì vậy `webhookRouter` được gắn TRƯỚC `express.json()` trong
[index.ts](server/src/index.ts) và tự dùng `express.raw` cho riêng đường dẫn của mình.
Đổi thứ tự hai dòng đó là mọi thanh toán ngừng được ghi nhận.

### Dùng workflow riêng thay cho webhook có sẵn

Nếu bạn đã có hệ thống xử lý thanh toán riêng (n8n, Make, script...), **không cần** gọi API
nào cả. Chỉ cần đổi trạng thái đơn trong database:

```sql
UPDATE orders SET status = 'paid' WHERE code = 'ORDXXXXXX';
```

Server tự phát hiện trong vòng `ORDER_SYNC_INTERVAL_SECONDS` (mặc định 20 giây) rồi làm nốt
phần còn lại: cộng điểm vào ví (hoặc kích hoạt gói tháng nếu là đơn cũ), ghi sổ cái, bù `paid_at`/`paid_source`
cho báo cáo doanh thu. Workflow của bạn **không cần biết gì** về nghiệp vụ điểm.

Cách này an toàn:

- Cột `fulfilled_at` đánh dấu đơn đã giao hàng. Đơn chỉ được xử lý khi `status='paid'` **và**
  `fulfilled_at IS NULL`, kiểm tra lại bên trong `SELECT ... FOR UPDATE`, nên chạy trùng hay
  chạy song song đều không cộng điểm hai lần.
- Đơn `cancelled` không bao giờ được giao hàng, dù có ai đó đổi nhầm.
- Đơn được đánh dấu lúc server đang tắt sẽ được xử lý ngay khi server khởi động lại.

> Đừng tự viết logic cộng điểm trong workflow. Toàn bộ nghiệp vụ (chu kỳ hạn mức tháng, sổ
> cái, gia hạn nối tiếp) chỉ tồn tại một bản duy nhất trong server; viết thêm bản thứ hai là
> nguồn gốc của sai lệch số liệu.

---

## 7. Thêm nhà cung cấp AI mới

Kiến trúc đã tách sẵn cho việc này:

1. Tạo file mới trong [server/src/providers/](server/src/providers/), export một object thoả
   interface `ImageProvider` (xem [types.ts](server/src/providers/types.ts) và
   [kie.ts](server/src/providers/kie.ts) làm mẫu).
2. Đăng ký adapter trong [server/src/providers/index.ts](server/src/providers/index.ts).
3. Vào trang Quản trị → **Bảng giá** → thêm dòng mới với cột `provider` trùng tên adapter.

Không phải sửa route, không phải sửa giao diện — trang tạo ảnh tự đọc danh sách model từ database.

---

## 8. Cấu trúc thư mục

```
├── server/src/
│   ├── index.ts              khởi tạo Express, gắn route, phục vụ file tĩnh
│   ├── env.ts                đọc & kiểm tra .env
│   ├── db.ts                 pool MySQL, transaction, migrate
│   ├── schema.sql            định nghĩa toàn bộ bảng
│   ├── seed.ts               dữ liệu khởi tạo + đồng bộ quyền admin
│   ├── lib/                  auth (JWT, phân quyền), lỗi, kiểm tra dữ liệu vào
│   ├── providers/            adapter nhà cung cấp AI (kie.ts, …)
│   ├── services/             nghiệp vụ: điểm, đơn nạp, tạo ảnh, lưu trữ
│   └── routes/               auth, catalog, orders, wallet, generations, admin, webhooks
│
├── pages/                    các trang React
│   └── admin/                các tab của bảng điều khiển
├── components/               thành phần dùng chung (Layout, BarChart, ui, upload)
├── context/AuthContext.tsx   trạng thái đăng nhập
├── context/ThemeContext.tsx  chế độ sáng / tối
├── lib/                      gọi API, định dạng số/ngày
└── types.ts                  kiểu dữ liệu dùng chung
```

## 8b. Chế độ sáng / tối

Mặc định là **chế độ sáng** (nền ghi dịu). Nút chuyển nằm ở góc phải thanh điều hướng và ở
màn hình đăng nhập; lựa chọn được ghi nhớ trong `localStorage`.

Toàn bộ bảng màu nằm trong khối `<style>` của [index.html](index.html) dưới dạng biến CSS,
ghi theo bộ ba kênh RGB nên Tailwind vẫn dùng được cú pháp độ mờ (`bg-dark-900/50`). Tên biến:

| Nhóm | Vai trò |
|---|---|
| `--s-*` | Bề mặt: nền trang, thẻ, ô nhập, viền (`dark-950` → `dark-600`) |
| `--t-*` | Chữ: `100` rõ nhất → `700` mờ nhất (ánh xạ vào `gray-100`…`gray-700`) |
| `--st-*` | Màu trạng thái: đỏ / xanh lá / vàng / xanh dương / cam |

**Đổi màu chỉ cần sửa biến, không phải sửa class ở từng thành phần.** Đỏ thương hiệu
(`brand-500`) cố định ở cả hai chế độ vì luôn nằm trên nền đặc kèm chữ trắng.

Các cặp màu trạng thái ở chế độ sáng đã được tính độ tương phản WCAG trên nền thẻ và đều đạt
tối thiểu 4,5:1 (mức AA cho chữ nhỏ). Nếu bạn đổi giá trị trong `--st-*` thì phải tính lại.

## 9. Lệnh có sẵn

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Chạy web + API cùng lúc (có tự nạp lại khi sửa mã) |
| `npm run dev:web` | Chỉ chạy giao diện |
| `npm run dev:api` | Chỉ chạy API |
| `npm run build` | Build giao diện ra `dist/` |
| `npm start` | Chạy bản production (một tiến trình phục vụ cả API và web) |
| `npm run lint` | Kiểm tra kiểu TypeScript cho cả frontend và backend |
