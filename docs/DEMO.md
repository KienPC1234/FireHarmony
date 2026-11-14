# Demo script — 2 minutes, 4 clicks

Server chạy sẵn (`make demo` → http://127.0.0.1:8000). Không cần mạng ngoài
sample offline; bản đồ cần tiles OSM.

## 0:00–0:20 — Vấn đề (Home)
MODIS 1 km (2000–) vs VIIRS 375 m (2012–): VIIRS thấy gấp ~3 lần.
So sánh trực tiếp = sai. App harmonize XUÔI về độ nhạy VIIRS:
giữ VIIRS ở ô nào nó bay qua, upscale MODIS-era bằng 1/k (ghi nhãn ước lượng).

## 0:20–0:50 — Bản đồ + vùng (Calendar)
Bấm **Vẽ vùng quan tâm**, kéo chuột quanh Tây Nguyên → calendar tính lại ngay.
Chấm cam = ô ngày harmonized. Đổi chip **amazon** → mùa cháy Jul–Oct;
**australia** → Dec–Feb. Màu ô = anomaly z so cùng tháng lịch sử.

## 0:50–1:20 — Bằng chứng (Calendar tiếp)
Chỉ vào bảng: **2019-02/03 z≈24** (Vietnam), Amazon **2019-08**, Úc **2019-12/2020-01**
(Black Summer) — toàn sự kiện cháy thật. Tỷ lệ năm sau/trước 2012 ≈ 1.14:
không còn bước nhảy kỷ nguyên (công thức cộng cũ cho 2.2x — đã sửa, có test guard).

## 1:20–1:45 — AI giải thích (Hỏi đáp AI)
Hỏi: “Độ chính xác ra sao?” → đáp bằng số live (era ratio, k đo được 168 tháng,
spike cấy). Mọi số đều tính từ dữ liệu, không bịa.

## 1:45–2:00 — Mang về (Calendar)
**Download harmonized CSV** + **brief .md 1 trang** cho emergency manager
(top anomaly, latest vs history, outlook seasonal-naive + limits).
