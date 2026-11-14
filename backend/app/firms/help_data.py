"""Dedicated Help & User-Operation Guide knowledge base for the Tool Agent.

Kept separate from FIRMS numeric datasets so the AI agent can load
step-by-step UI operation instructions on demand via `get_help_guide`.
"""
from __future__ import annotations

HELP_TOPICS: dict[str, dict] = {
    "overview": {
        "title": "Tổng quan hệ thống & chế độ sử dụng",
        "routes": [
            {"label": "Calendar & Map", "path": "/calendar"},
            {"label": "Ask AI (Investigator)", "path": "/investigator"},
            {"label": "Evidence", "path": "/evidence"},
            {"label": "Lab & X-Ray Backtest", "path": "/lab?tab=xray"},
            {"label": "Methods", "path": "/methods"},
            {"label": "Guide", "path": "/guide"},
        ],
        "steps": [
            "1. Chế độ Khám phá (Explore): giao diện gọn cho người dùng phổ thông xem bản đồ điểm nóng, lịch bất thường và tóm tắt dễ hiểu.",
            "2. Chế độ Nghiên cứu (Research): mở khóa mô hình hiệu chỉnh (STAT, HTS, STAN), bộ lọc QA/SNPP/FRP, trang Evidence và Lab/X-Ray.",
            "3. Tất cả giá trị hiển thị là chỉ số hoạt động điểm nóng (hotspot detections / sensor-adjusted index), KHÔNG phải số đám cháy thực.",
        ],
    },
    "fetch_live": {
        "title": "Cách chọn vùng & tải dữ liệu NASA FIRMS trực tiếp",
        "routes": [
            {"label": "Mở Calendar & Map", "path": "/calendar"},
        ],
        "steps": [
            "1. Trên trang Calendar (/calendar), chọn vùng mẫu (Vietnam, Amazon, Australia) hoặc mở bản đồ để vẽ vùng tùy chỉnh bằng nút Draw / Box, hoặc nhập tọa độ minLon,minLat,maxLon,maxLat qua Lat/Lon Input.",
            "2. Vùng chọn nên gọn (tối đa 35° × 35°, ưu tiên các vùng rừng có nguy cơ cháy cao) để tránh bị API NASA FIRMS từ chối.",
            "3. Chọn Start date và End date (tối đa 14 ngày cho mỗi lần tải NASA FIRMS) rồi bấm nút 'Fetch NASA FIRMS data'.",
            "4. Hệ thống hiển thị số bản ghi đã lấy được và lưu cache (live:<id>) để các lần xem lại không phải tải lại từ đầu.",
        ],
    },
    "timeline": {
        "title": "Cách dùng Timeline & mở rộng khoảng ngày",
        "routes": [
            {"label": "Mở Calendar & Map", "path": "/calendar"},
        ],
        "steps": [
            "1. Thanh Timeline hiển thị từng ngày trong khoảng đang xem. Ngày có chấm cam là ngày có điểm nóng được phát hiện; ngày không sáng là ngày chưa có dữ liệu hoặc không có phát hiện.",
            "2. Bấm vào một ngày chưa có dữ liệu trên Timeline: hệ thống sẽ hỏi xác nhận có muốn tải bổ sung dữ liệu NASA FIRMS cho ngày đó không.",
            "3. Dùng menu mở rộng (Expand left / Expand right) và nhập số ngày nằm trong giới hạn cho phép để lấy thêm dữ liệu về quá khứ hoặc tới hiện tại (hệ thống tự ẩn hướng mở rộng bất khả thi như vượt quá hôm nay).",
        ],
    },
    "filters": {
        "title": "Bộ lọc QA, Platform, Source, Day/Night & Min FRP",
        "routes": [
            {"label": "Mở Calendar (Research)", "path": "/calendar"},
        ],
        "steps": [
            "1. QA Filter: 'all' (tất cả), 'nominal' (loại confidence thấp), 'high' (chỉ giữ điểm tin cậy cao).",
            "2. Platform Filter: 'all' (MODIS + mọi vệ tinh VIIRS) hoặc 'snpp' (chỉ VIIRS Suomi-NPP).",
            "3. Các bộ lọc bổ sung trên sidebar: Source (MODIS/VIIRS), Day/Night (ngày/đêm), và Min FRP (lọc theo công suất bức xạ cháy tối thiểu MW).",
            "4. Lưu ý: Khi bật bộ lọc tùy chỉnh hoặc dùng dữ liệu live/upload/raw, hệ thống tự động dùng phương pháp 'stat' (Seasonal Ratio k).",
        ],
    },
    "map": {
        "title": "Cách đọc Bản đồ điểm nóng & cụm cam",
        "routes": [
            {"label": "Mở Bản đồ", "path": "/calendar"},
        ],
        "steps": [
            "1. Lớp nền bản đồ hỗ trợ Satellite, Dark Canvas và Topography.",
            "2. Chấm xanh lục là điểm quan sát VIIRS (375 m), chấm xám/xanh dương là điểm MODIS (1 km).",
            "3. Vòng/cụm màu cam (Hotspot clusters) gom nhóm các điểm nóng gần nhau để dễ quan sát, KHÔNG phải ranh giới diện tích đám cháy thực.",
            "4. Trên lưới lịch tháng×năm: màu xanh lam là thấp hơn trung vị lịch sử (z < 0), màu cam/đỏ là cao hơn trung vị (z > 0).",
        ],
    },
    "models": {
        "title": "Phương pháp chuẩn hóa STAT, HTS & STAN",
        "routes": [
            {"label": "Mở Methods", "path": "/methods"},
            {"label": "Mở Lab & X-Ray", "path": "/lab?tab=xray"},
        ],
        "steps": [
            "1. STAT (Seasonal Ratio k): tính tỷ lệ k = MODIS / VIIRS theo từng tháng trên dữ liệu đối chiếu từ 2012 trở đi, rồi quy đổi MODIS trước 2012 bằng 1/k.",
            "2. HTS & STAN: mô hình học máy/spatio-temporal được đánh giá trên bộ dữ liệu mẫu lịch sử chuẩn (AOI Vietnam, Amazon, Australia).",
            "3. Với dữ liệu live (live:*), upload CSV (upload:*) hoặc raw chưa huấn luyện riêng, hệ thống luôn dùng STAT để đảm bảo tính minh bạch và không bị lỗi không tương thích mô hình.",
        ],
    },
    "export": {
        "title": "Xuất CSV & kiểm tra bằng chứng (Evidence / X-Ray)",
        "routes": [
            {"label": "Mở Evidence", "path": "/evidence"},
            {"label": "Mở Lab & X-Ray", "path": "/lab?tab=xray"},
        ],
        "steps": [
            "1. Bấm nút Download trên trang Calendar để tải về tệp `harmonized_hotspots.csv` chứa dữ liệu đã chuẩn hóa theo bộ lọc hiện tại.",
            "2. Trang Evidence (/evidence) cho biết chi tiết từng tháng: số ô quan sát trực tiếp (VIIRS), số ô ước lượng (MODIS/k), tỷ lệ coverage và ngày còn thiếu.",
            "3. Trang Lab & X-Ray (/lab?tab=xray) cho phép xem backtest sai số MAE/WAPE giữa các phương pháp và mô phỏng tác động của bộ lọc.",
        ],
    },
}

HELP_TOPICS_EN: dict[str, dict] = {
    "overview": {
        "title": "System Overview & Operating Modes",
        "routes": [
            {"label": "Calendar & Map", "path": "/calendar"},
            {"label": "Ask AI (Investigator)", "path": "/investigator"},
            {"label": "Evidence", "path": "/evidence"},
            {"label": "Lab & X-Ray Backtest", "path": "/lab?tab=xray"},
            {"label": "Methods", "path": "/methods"},
            {"label": "Guide", "path": "/guide"},
        ],
        "steps": [
            "1. Explore mode: streamlined interface for general users to inspect the hotspot map, anomaly calendar, and plain-language summaries.",
            "2. Research mode: unlocks calibration models (STAT, HTS, STAN), QA/SNPP/FRP filters, Evidence, and Lab/X-Ray backtest tools.",
            "3. All values represent hotspot detections / sensor-adjusted activity index, NEVER confirmed ground fire counts.",
        ],
    },
    "fetch_live": {
        "title": "Select Region & Fetch Live NASA FIRMS Data",
        "routes": [
            {"label": "Open Calendar & Map", "path": "/calendar"},
        ],
        "steps": [
            "1. On Calendar (/calendar), pick a preset AOI (Vietnam, Amazon, Australia) or open the map to draw a custom box with Draw / Box, or enter minLon,minLat,maxLon,maxLat via Lat/Lon Input.",
            "2. Keep the selected region compact (max 35° × 35°, ideally high-fire-risk forest areas) to avoid NASA FIRMS API rejection.",
            "3. Pick Start date and End date (max 14 days per fetch) and click 'Fetch NASA FIRMS data'.",
            "4. The app reports how many detections were fetched and caches the result (live:<id>) for reuse.",
        ],
    },
    "timeline": {
        "title": "Using the Timeline & Expanding Date Ranges",
        "routes": [
            {"label": "Open Calendar & Map", "path": "/calendar"},
        ],
        "steps": [
            "1. The Timeline shows each day in the active range. Days with an orange dot have hotspot detections; dim days are missing or had zero detections.",
            "2. Click any missing day on the Timeline to confirm and fetch NASA FIRMS data for that specific date.",
            "3. Use the Expand left / Expand right action to fetch additional days within the allowed past/present bounds (impossible directions like future dates are hidden automatically).",
        ],
    },
    "filters": {
        "title": "QA, Platform, Source, Day/Night & Min FRP Filters",
        "routes": [
            {"label": "Open Calendar (Research)", "path": "/calendar"},
        ],
        "steps": [
            "1. QA Filter: 'all' (all detections), 'nominal' (excludes low confidence), 'high' (high confidence only).",
            "2. Platform Filter: 'all' (MODIS + all VIIRS) or 'snpp' (VIIRS Suomi-NPP only).",
            "3. Additional sidebar filters: Source (MODIS/VIIRS), Day/Night, and Min FRP (minimum Fire Radiative Power in MW).",
            "4. Note: When custom filters or live/upload/raw datasets are active, the pipeline automatically uses method 'stat' (Seasonal Ratio k).",
        ],
    },
    "map": {
        "title": "Reading the Hotspot Map & Orange Clusters",
        "routes": [
            {"label": "Open Map", "path": "/calendar"},
        ],
        "steps": [
            "1. Map base layers support Satellite, Dark Canvas, and Topography.",
            "2. Cyan dots are VIIRS (375 m) detections; grey/blue dots are MODIS (1 km) detections.",
            "3. Orange rings (Hotspot clusters) group nearby detections for visual clarity and are NOT burned-area perimeters.",
            "4. On the month×year calendar grid: blue indicates below historical median (z < 0) and orange/red indicates above median (z > 0).",
        ],
    },
    "models": {
        "title": "Harmonization Methods: STAT, HTS & STAN",
        "routes": [
            {"label": "Open Methods", "path": "/methods"},
            {"label": "Open Lab & X-Ray", "path": "/lab?tab=xray"},
        ],
        "steps": [
            "1. STAT (Seasonal Ratio k): computes k = MODIS / VIIRS per month on paired post-2012 data and scales pre-2012 MODIS by 1/k.",
            "2. HTS & STAN: ML/spatio-temporal models evaluated on the standardized historical AOI archives (Vietnam, Amazon, Australia).",
            "3. For live (live:*), uploaded (upload:*), or raw datasets, the system always uses STAT to avoid model mismatch errors.",
        ],
    },
    "export": {
        "title": "Exporting CSV & Inspecting Evidence / X-Ray",
        "routes": [
            {"label": "Open Evidence", "path": "/evidence"},
            {"label": "Open Lab & X-Ray", "path": "/lab?tab=xray"},
        ],
        "steps": [
            "1. Click Download on the Calendar page to export `harmonized_hotspots.csv` matching your active filters.",
            "2. Evidence (/evidence) details each month: observed VIIRS cells, estimated MODIS/k cells, paired coverage ratio, and missing days.",
            "3. Lab & X-Ray (/lab?tab=xray) shows backtest MAE/WAPE parity across methods and simulates filter impacts.",
        ],
    },
}


def get_help_topic(topic: str = "all", lang: str = "vi") -> dict:
    """Return structured help data for a topic or all topics in the requested language."""
    topics_map = HELP_TOPICS_EN if (lang or "").lower().startswith("en") else HELP_TOPICS
    key = (topic or "all").strip().lower()
    if key in topics_map:
        return {"topic": key, **topics_map[key]}
    return {
        "topic": "all",
        "topics": {k: {"title": v["title"], "steps": v["steps"], "routes": v["routes"]}
                   for k, v in topics_map.items()},
    }


def match_help_topic(question: str) -> str | None:
    """Detect if a question is primarily a UI/operation help question."""
    q = question.lower()
    if any(w in q for w in ("fetch", "tải dữ liệu", "lấy dữ liệu", "nasa firms", "vẽ vùng", "bbox", "draw")):
        return "fetch_live"
    if any(w in q for w in ("timeline", "mở rộng", "expand", "ngày thiếu", "khoảng ngày")):
        return "timeline"
    if any(w in q for w in ("lọc", "filter", "qa", "snpp", "frp", "day/night")):
        return "filters"
    if any(w in q for w in ("bản đồ", "chấm", "cụm cam", "cluster", "layer", "màu lịch", "đọc")):
        return "map"
    if any(w in q for w in ("tải csv", "download", "export", "xuất", "evidence", "x-ray", "xray")):
        return "export"
    if any(w in q for w in ("hướng dẫn", "thao tác", "cách dùng", "help", "how to", "how do i")):
        return "overview"
    return None
