https://thangvuxuan638-lab.github.io/kientrmag/




# AGRI ERP · Web + HMI qua Firebase

Hệ thống 2 phần dùng chung 1 Firebase Realtime Database:

| Phần | Đường dẫn | Chạy bằng |
|---|---|---|
| **Web ERP** | `ERP_HMI/web/` | trình duyệt (không cần cài gì) |
| **HMI SCADA** | `HMI_DoAmDat/hmi_shtc30_3kenh.py` (+ `firebase_sync.py`) | Python + PyQt5 |

Firebase project: `ktma-f2871`
Database: `https://ktma-f2871-default-rtdb.asia-southeast1.firebasedatabase.app`

Web ERP dùng giao diện sáng (white card, xanh dương chủ đạo) nhưng nội dung bám
theo HMI nhà trồng: giám sát **nhiệt độ & độ ẩm không khí (SHTC30)** và điều
khiển 3 thiết bị — **bơm phun sương (CH1), quạt làm mát (CH2), đèn halogen sưởi
ấm (CH3)** — kèm quản lý kho vật tư, mùa vụ, đơn hàng.

---

## 1. Bật quyền cho database (bắt buộc)

Nếu mọi request trả `Permission denied (401)` là do rules mặc định chỉ cho phép
người đã đăng nhập.

Firebase Console → **Realtime Database** → tab **Rules** → dán:

```json
{
  "rules": {
    "hmi": {
      "$device": {
        ".read": true,
        ".write": true,
        "logs": { ".indexOn": ["ts"] },
        "history": { ".indexOn": ["ts"] }
      }
    }
  }
}
```

`.indexOn` giúp truy vấn `logs`/`history` theo `ts` (bấm **Sao chép** trong
**Cài đặt → Rules mẫu** rồi dán vào Console → **Publish**).

Bấm **Publish**. Tải lại trang web — góc trái sidebar phải chuyển sang chấm **xanh**.

> ⚠ Rules này mở công khai cho người biết URL. Chỉ dùng trong LAN/nhà kính hoặc
> khi đang thử nghiệm. Khi đưa lên Internet: bật Authentication và đổi thành
> `".read": "auth != null", ".write": "auth != null"`.

---

## 2. Chạy web ERP

Cách nhanh nhất — mở trực tiếp `ERP_HMI/web/index.html`.

Hoặc chạy HTTP server (khuyến nghị):

```powershell
cd ERP_HMI\web
python -m http.server 8080
# mở http://127.0.0.1:8080
```

Chưa có Firebase? Bấm **Cài đặt → Dùng dữ liệu DEMO** để chạy thử toàn bộ chức
năng với dữ liệu mẫu sinh tự động, lưu trong trình duyệt (localStorage). Nếu
chưa cấu hình URL, app tự bật DEMO và tự tạo dữ liệu mẫu ở lần chạy đầu.

### Các trang

- **Dashboard** — 4 thẻ KPI (nhiệt độ, độ ẩm, quạt, bơm), **Digital Twin nhà
  trồng** dạng isometric (bồn rau, bồn nước, quạt tường, 2 đèn halogen, cảm biến
  SHTC30) có hiệu ứng quay quạt / phun sương / đèn sáng theo trạng thái thật,
  System Health, điều khiển từ xa (AUTO/MANUAL, 3 công tắc, E-STOP), phân bố
  tải và cảnh báo gần đây. Cập nhật 2 giây/lần.
- **Giám sát** — bảng telemetry (thời gian, nhiệt độ, độ ẩm, quạt, bơm, đèn,
  chế độ, trạng thái), tìm kiếm theo trạng thái, xuất CSV.
- **Cảnh báo** — thống kê tổng / chưa ACK / nhiệt độ cao / đã ACK, lọc theo
  nhiệt độ, sưởi ấm, độ ẩm, hệ thống; ACK từng mục hoặc tất cả.
- **Thiết bị** — SHTC30, relay 3 kênh (bơm / quạt / đèn, slave 255), HMI Bridge,
  Firebase RTDB; bảng kênh relay bật/tắt trực tiếp.
- **Báo cáo** — trung bình/min/max nhiệt độ & độ ẩm, thời gian hoạt động, tỉ lệ
  ON của quạt / bơm / đèn, đồ thị 2 trục kèm đường ngưỡng, xuất CSV/JSON.
- **Kết nối** — chẩn đoán toàn tuyến ERP Web → Firebase → HMI → Modbus: sơ đồ
  trạng thái từng chặng, heartbeat / uptime / phiên bản HMI, RTT và biểu đồ độ
  trễ, thẻ **ACK lệnh & cấu hình** (seq, thời điểm, kết quả), bảng **so sánh
  ngưỡng** ERP ↔ HMI, nhật ký HMI (INFO/OK/WARN/ERROR/REMOTE) và dòng sự kiện.
  Nút **Làm mới**, **Kiểm tra**, **Đồng bộ ngưỡng**, **Về AUTO**, **E-STOP**.
- **Cài đặt** — URL/secret/thiết bị, **ngưỡng AUTO** (RH 40/45 %RH, quạt
  32/30 °C, sưởi 22/25 °C), **watchdog** bơm 600 s / đèn 1800 s, **failsafe**
  1 chu kỳ, âm thanh.

Mở thẳng một trang bằng hash: `index.html#monitor`, `#alerts`, `#devices`,
`#connection`, `#reports`, `#settings`.

---

## 3. Chạy HMI có đồng bộ

```powershell
cd HMI_DoAmDat
python hmi_shtc30_3kenh.py
```

Ngưỡng mặc định (khớp `hmi_config.json`): bơm RH **< 40 / ≥ 45 %RH**, quạt
**> 32 / < 30 °C**, đèn sưởi **< 22 / ≥ 25 °C**; relay slave `255`, kênh
CH1 bơm · CH2 quạt · CH3 đèn halogen.

Trong khung **☁ ĐỒNG BỘ FIREBASE (ERP)** (cột trái):

1. `Realtime DB URL` đã điền sẵn project của bạn.
2. `Mã thiết bị`: `vuon-1` (đổi nếu có nhiều khu).
3. Bấm **☁ BẬT ĐỒNG BỘ** → nhãn bên dưới hiện `trực tuyến`.

HMI đẩy dữ liệu **2 giây/lần**, độc lập với kết nối Modbus: rút dây RS485 thì dữ
liệu vẫn lên Firebase (giá trị cũ), khi Modbus có lại thì tự cập nhật.

Mỗi chu kỳ HMI còn ghi **heartbeat** (`status`), **log** phát sinh, **mẫu lịch sử**
20 giây/lần và **ACK** ngay sau khi thực thi lệnh/áp dụng ngưỡng — nhờ vậy web
hiển thị được độ trễ, thời gian chạy, kết quả từng lệnh và phát hiện cấu hình
lệch. Trạng thái được lưu vào `hmi_config.json` nên mở lại app vẫn nhớ URL,
thiết bị và mốc chống replay (`last_control_ts`, `last_config_ts`).

Thử nhanh không cần mở app:

```powershell
python firebase_sync.py https://ktma-f2871-default-rtdb.asia-southeast1.firebasedatabase.app
```

---

## 4. Cấu trúc dữ liệu trên Firebase

```
hmi/vuon-1/
  live          { humidity, temp, pump, fan, lamp, mode, estop, sensor_ok,
                  modbus_connected, rh_on, rh_off, fan_on, fan_off,
                  heat_on, heat_off, pump_max_s, heat_max_s,
                  failsafe_cycles, uptime_s, ts }
  status        { online, ts, version, device, mode, estop, modbus_connected,
                  sensor_ok, uptime_s, latency_ms, interval_s }
  control       { pump?, fan?, lamp?, mode?, estop?, by, ts, seq }  ← web ghi, HMI đọc
  command_ack   { seq, by, ok, message, applied{...}, ts }          ← HMI ghi
  config        { rh_on, rh_off, fan_on, fan_off, heat_on, heat_off,
                  pump_max_s, heat_max_s, failsafe_cycles, by, ts, seq }
                                                                   ← web ghi, HMI đọc
  config_ack    { seq, by, ok, message, applied{...}, ts }          ← HMI ghi
  logs/<id>     { level, msg, ts }        level ∈ INFO|OK|WARN|ERROR|REMOTE
  history/<id>  { humidity, temp, pump, fan, lamp, mode, estop,
                  sensor_ok, ts }         mẫu 20 s, giữ 900 mẫu
```

- `humidity` = độ ẩm không khí **%RH**, `temp` = nhiệt độ **°C** (SHTC30).
- `rh_on / rh_off` = ngưỡng bơm, `fan_on / fan_off` = ngưỡng quạt,
  `heat_on / heat_off` = ngưỡng đèn sưởi — tất cả đều nằm trong `live` để web
  đối chiếu với `config` (bảng **So sánh cấu hình**).
- Web vẫn đọc được dữ liệu cũ dùng khóa `moisture` (tự fallback), nhưng HMI mới
  chỉ ghi `humidity`.

### Điều khiển thiết bị từ xa hoạt động thế nào

1. Web tạo `seq = Date.now()` và ghi `hmi/vuon-1/control = { pump: false,
   fan: true, lamp: true, mode: "MANUAL", by: "web-erp", ts: seq, seq }`.
2. HMI đọc mỗi ~2 giây. Lệnh được nhận nếu `seq` mới và `ts` lớn hơn mốc đã xử
   lý; lệnh lặp hoặc cũ hơn 300 giây bị bỏ qua (chống replay khi HMI tắt lâu).
3. HMI thực thi qua Modbus rồi ghi `command_ack = { seq, ok, message,
   applied{...} }` đúng `seq` đó.
4. Web so khớp `seq` khi nhận ACK, hiện **HMI đã xác nhận** / **Từ chối**, áp
   giá trị `applied` lên dashboard. Không thấy ACK sau 12 giây → báo **Không
   phản hồi** kèm gợi ý kiểm tra.
5. Nếu HMI đang **không** kết nối Modbus, nó trả ACK `ok=false` để web biết lệnh
   không chạy thay vì âm thầm bỏ qua.
6. **E-STOP**: web gửi `estop:true`; HMI khóa mọi lệnh, tắt 3 tải và bật banner
   đỏ trên toàn bộ trang web cho tới khi được giải phóng.

### Đồng bộ ngưỡng & watchdog

Nút **Đồng bộ cấu hình** ghi `config` kèm `seq`; HMI kiểm tra ràng buộc
(`rh_on < rh_off`, `fan_on > fan_off`, `heat_on < heat_off`, `heat_off < fan_off`,
watchdog 30–7200 s, failsafe 1–999), áp dụng rồi trả `config_ack`. Nếu vi phạm,
HMI từ chối kèm lý do và giữ nguyên ngưỡng cũ. Web đối chiếu `applied` với giá
trị đang nhập và hiện **Khớp cấu hình** hoặc **N giá trị lệch** kèm bảng chi
tiết từng dòng.

---

## 5. Lỗi thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `Bị chặn quyền (401/403)` | Rules chưa mở | Làm mục 1 |
| Chấm đỏ, `Không kết nối được Firebase` | Sai URL / mất mạng | Kiểm tra URL trong Cài đặt |
| Dashboard đứng ở giá trị cũ | HMI chưa bật đồng bộ | Bấm ☁ BẬT ĐỒNG BỘ trên HMI |
| Bấm BẬT bơm/quạt/đèn mà không chạy | HMI chưa kết nối Modbus | Xem log HMI: “chưa kết nối Modbus → bỏ qua” |
| ACK kẹt ở `Chưa có ACK` / `Không phản hồi` | HMI chưa bật đồng bộ, sai mã thiết bị, hoặc rules chặn ghi | Mở trang **Kết nối** xem chặng nào đỏ; đối chiếu `by`/`seq` |
| Bảng so sánh báo **N giá trị lệch** | Cấu hình ERP khác HMI (chưa đồng bộ hoặc HMI từ chối) | Bấm **Đồng bộ cấu hình**; nếu HMI từ chối, xem lý do trong nhật ký HMI |
| Không bấm được công tắc | Đang ở chế độ AUTO hoặc E-STOP | Chuyển MANUAL, giải phóng E-STOP |
| Số liệu không đổi dù HMI chạy | Sai `Mã thiết bị` | Hai bên phải cùng mã (`vuon-1`) |
| Cột RH/T hiện `--` | HMI cũ chỉ ghi `moisture`/`ec` | Cập nhật HMI mới (ghi `humidity`) |
| Cảnh báo tăng liên tục | Ngưỡng chưa khớp thực tế | Chỉnh ở **Cài đặt → Ngưỡng điều khiển** |

---

## 6. Bảo mật (khi mở ra Internet)

1. Bật **Authentication → Email/Password**, tạo tài khoản admin.
2. Rules:
   ```json
   {
     "rules": {
       "hmi": { ".read": "auth != null", ".write": "auth != null" }
     }
   }
   ```
3. Thêm màn hình đăng nhập vào web (dùng Firebase Auth JS SDK) trước khi cho
   phép đọc/ghi.
