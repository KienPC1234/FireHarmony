/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "vi" | "en";

const STRINGS = {
  vi: {
    "nav.home": "Trang chủ",
    "nav.calendar": "Calendar cháy",
    "nav.xray": "X-Ray sensor",
    "nav.ask": "Hỏi đáp AI",
    "nav.method": "Phương pháp & ML",
    "nav.about": "Dữ liệu",
    "header.sub": "MODIS + VIIRS · một calendar duy nhất",
    "footer.text": "FIRMS Fire Calendar · NASA Space Apps 2026 · Dữ liệu: NASA FIRMS (MODIS C6.1 + VIIRS 375 m) · Mẫu tổng hợp offline — dữ liệu thật cần MAP_KEY miễn phí.",
    "common.loading": "Đang tải…",
    "common.synthetic": "SYNTHETIC DEMO (không phải quan trắc thật)",
    "common.detections": "lượt hotspot",
    "home.kicker": "NASA Space Apps 2026 · Lửa & Rừng",
    "home.title": "Một calendar cháy duy nhất cho hai thế hệ vệ tinh",
    "home.desc": "MODIS 1 km (2000–) thấy ít, VIIRS 375 m (2012–) thấy gấp ~3 lần. Cộng trực tiếp sẽ dựng bước nhảy giả năm 2012. App dùng chỉ số hoạt động đã chỉnh sensor, kiểm tra nhất quán nội bộ era-ratio ≈ 1.1. Lưu ý: mẫu demo là dữ liệu tổng hợp, không phải sự kiện cháy thật đã kiểm chứng.",
    "home.open": "Mở calendar",
    "home.ask": "Hỏi đáp AI",
    "home.stat_rows": "dòng hotspot tổng hợp (3 AOI)",
    "home.stat_years": "năm 2001–2025",
    "home.stat_raw": "file FIRMS thật đã kéo",
    "home.why": "Vì sao 2 sensor không so được trực tiếp?",
    "home.z_note": "z tính bằng đơn vị MAD robust (1.4826×MAD) — một năm cháy lớn không kéo lệch baseline.",
    "home.pipeline": "Pipeline 5 bước",
    "home.aois": "3 vùng cháy demo",
    "home.aoi_note": "CSV + brief sẵn trên trang calendar",
    "home.upload": "Dùng CSV FIRMS của bạn",
    "home.upload_desc": "Tải từ FIRMS Area API rồi upload (tối đa 5000 dòng, xử lý tại chỗ).",
    "home.harmonize": "Harmonize",
    "home.uploadwarn": "Lưu ý: chỉ 5000 dòng đầu được phân tích phía client và trường CSV có dấu ngoặc kép chưa được hỗ trợ đầy đủ.",
    "home.step1t": "Chuẩn hóa",
    "home.step1d": "Mọi dòng FIRMS về một schema, gắn cờ QA, loại hàng lỗi có báo cáo.",
    "home.step2t": "Lưới ngày",
    "home.step2d": "Gộp theo ô 0.05° × ngày × sensor: count + tổng FRP.",
    "home.step3t": "Tỷ lệ k",
    "home.step3d": "k = MODIS/VIIRS từ tổng tháng AOI — activity-ratio thực nghiệm, chưa phải hiệu chuẩn đã kiểm chứng.",
    "home.step4t": "Chỉ số đã chỉnh sensor",
    "home.step4d": "Giữ VIIRS nơi ghi nhận ≥1 detection; ô chỉ-MODIS upscale 1/k, nhãn ESTIMATE.",
    "home.step5t": "Calendar",
    "home.step5d": "Ma trận tháng × năm + anomaly z robust + CSV/brief (tháng thiếu = no data).",
    "cal.title": "Burning-activity calendar",
    "cal.apply": "Áp dụng",
    "cal.bbox": "Vùng quan tâm (minLon,minLat,maxLon,maxLat)",
    "cal.csv": "Tải harmonized CSV",
    "cal.brief": "Tải brief 1 trang (.md)",
    "cal.latest": "Tháng mới nhất",
    "cal.vs_median": "vs median lịch sử cùng tháng",
    "cal.clima": "Climatology theo tháng (median vs năm mới nhất)",
    "cal.yearly": "Tổng năm (chỉ số hoạt động, không phải số vụ cháy)",
    "cal.critical": "Tháng bất thường (|z| ≥ 2, đơn vị MAD)",
    "cal.empty": "Không có hotspot nào trong vùng này.",
    "cal.loading": "Đang harmonize…",
    "cal.nodata": "no data",
    "cal.outlook": "Xu hướng khí hậu (không phải dự báo)",
    "cal.outlook_note": "Đây là khí hậu học, không phải dự đoán — xem FIRMS NRT để nowcast.",
    "cal.cells": "ô ngày",
    "cal.fullmonths": "Tháng đủ dữ liệu",
    "cal.partial": "thiếu",
    "cal.partialmonths": "Tháng thiếu (ghi rõ số ngày)",
    "map.draw": "Vẽ vùng quan tâm",
    "map.drawing": "Đang vẽ: kéo chuột trên bản đồ…",
    "map.note": "Chấm cam = ô ngày đã chỉnh sensor (tối đa 800 điểm). Tooltip ghi rõ observed / estimated.",
    "ask.title": "Hỏi đáp về harmonization",
    "ask.desc": "Trợ lý offline theo quy tắc (không phải LLM): mọi con số đều tính live từ dữ liệu (không bịa).",
    "ask.placeholder": "VD: Độ chính xác của calendar ra sao?",
    "ask.send": "Hỏi",
    "ask.thinking": "Đang tính toán…",
    "ask.empty": "Chưa có câu hỏi — bấm gợi ý bên dưới để bắt đầu.",
    "method.title": "Phương pháp: harmonize + ML thử nghiệm",
    "method.sub": "stat là đường mặc định đã kiểm chứng; ml_hgb_v1 / ts_win12_v1 chạy từ artifact đã lưu huấn luyện trên mẫu tổng hợp, chọn qua ?method=, chưa kiểm chứng trên dữ liệu NASA thật.",
    "method.models": "Mô hình trên server này (thử nghiệm)",
    "method.honesty": "Trung thực số liệu",
    "about.title": "Dữ liệu & giới hạn",
    "about.sub": "Challenge: Harmonization of MODIS and VIIRS Hot Spots (NASA Space Apps 2026).",
    "about.src": "Nguồn",
    "about.on_server": "Có gì trên server",
    "about.limits": "Đầu ra & giới hạn",
  },
  en: {
    "nav.home": "Home",
    "nav.calendar": "Fire calendar",
    "nav.xray": "Sensor X-Ray",
    "nav.ask": "Q&A AI",
    "nav.method": "Method & ML",
    "nav.about": "Data",
    "header.sub": "MODIS + VIIRS · one single calendar",
    "footer.text": "FIRMS Fire Calendar · NASA Space Apps 2026 · Data: NASA FIRMS (MODIS C6.1 + VIIRS 375 m) · Offline synthetic sample — real data needs a free MAP_KEY.",
    "common.loading": "Loading…",
    "common.synthetic": "SYNTHETIC DEMO (not observed)",
    "common.detections": "hotspot detections",
    "home.kicker": "NASA Space Apps 2026 · Fire & Forests",
    "home.title": "One fire calendar for two satellite generations",
    "home.desc": "MODIS 1 km (2000–) sees less, VIIRS 375 m (2012–) sees ~3x more. Summing them fakes a 2012 step. The app uses a sensor-adjusted activity index with internal era-consistency ≈ 1.1. Note: the demo sample is synthetic, not verified real fire events.",
    "home.open": "Open calendar",
    "home.ask": "Q&A AI",
    "home.stat_rows": "synthetic hotspot rows (3 AOIs)",
    "home.stat_years": "years 2001–2025",
    "home.stat_raw": "real FIRMS files pulled",
    "home.why": "Why can't 2 sensors be compared directly?",
    "home.z_note": "z in robust MAD units (1.4826×MAD) — one big fire year can't drag the baseline.",
    "home.pipeline": "5-step pipeline",
    "home.aois": "3 demo fire regions",
    "home.aoi_note": "CSV + brief ready on the calendar page",
    "home.upload": "Use your own FIRMS CSV",
    "home.upload_desc": "Download from the FIRMS Area API, then upload (max 5000 rows, processed locally).",
    "home.harmonize": "Harmonize",
    "home.uploadwarn": "Note: only the first 5000 rows are parsed client-side and quoted CSV fields are not fully supported.",
    "home.step1t": "Standardize",
    "home.step1d": "All FIRMS rows into one schema, QA flags, bad rows rejected with report.",
    "home.step2t": "Daily grid",
    "home.step2d": "Aggregate by 0.05° cell × day × sensor: count + FRP sums.",
    "home.step3t": "Ratio k",
    "home.step3d": "k = MODIS/VIIRS from AOI monthly totals — an empirical activity ratio, not a validated calibration.",
    "home.step4t": "Sensor-adjusted index",
    "home.step4d": "Keep VIIRS where ≥1 detection recorded; MODIS-only cells upscaled 1/k, labeled ESTIMATE.",
    "home.step5t": "Calendar",
    "home.step5d": "Month × year matrix + robust z anomaly + CSV/brief (missing months = no data).",
    "cal.title": "Burning-activity calendar",
    "cal.apply": "Apply",
    "cal.bbox": "Area of interest (minLon,minLat,maxLon,maxLat)",
    "cal.csv": "Download harmonized CSV",
    "cal.brief": "Download 1-page brief (.md)",
    "cal.latest": "Latest month",
    "cal.vs_median": "vs same-month historical median",
    "cal.clima": "Monthly climatology (median vs latest year)",
    "cal.yearly": "Yearly totals (activity index, not fire counts)",
    "cal.critical": "Anomalous months (|z| ≥ 2, MAD units)",
    "cal.empty": "No hotspots in this area.",
    "cal.loading": "Harmonizing…",
    "cal.nodata": "no data",
    "cal.outlook": "Climatology outlook (not a forecast)",
    "cal.outlook_note": "This is climatology, not a prediction — see FIRMS NRT for nowcasts.",
    "cal.cells": "daily cells",
    "cal.fullmonths": "Full months",
    "cal.partial": "partial",
    "cal.partialmonths": "Partial month (day count shown)",
    "map.draw": "Draw area of interest",
    "map.drawing": "Drawing: drag on the map…",
    "map.note": "Orange dots = sensor-adjusted daily cells (max 800). Tooltips state observed / estimated.",
    "ask.title": "Harmonization Q&A",
    "ask.desc": "Offline rule-based assistant (not an LLM): every number is computed live from the data.",
    "ask.placeholder": "E.g.: How accurate is the calendar?",
    "ask.send": "Ask",
    "ask.thinking": "Computing…",
    "ask.empty": "No questions yet — click a suggestion below to start.",
    "method.title": "Method: harmonize + experimental ML",
    "method.sub": "stat is the default validated path; ml_hgb_v1 / ts_win12_v1 run from persisted artifacts trained on the synthetic sample, selectable via ?method=, not validated on real NASA data.",
    "method.models": "Models on this server (experimental)",
    "method.honesty": "Honest numbers",
    "about.title": "Data & limits",
    "about.sub": "Challenge: Harmonization of MODIS and VIIRS Hot Spots (NASA Space Apps 2026).",
    "about.src": "Sources",
    "about.on_server": "What's on the server",
    "about.limits": "Outputs & limits",
  },
} as const;

export type I18nKey = keyof (typeof STRINGS)["vi"];

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: I18nKey) => string }>({
  lang: "vi",
  setLang: () => undefined,
  t: (k) => k,
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const s = localStorage.getItem("firms-lang");
      return s === "en" ? "en" : "vi";
    } catch {
      return "vi";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("firms-lang", lang);
    } catch { /* ignore */ }
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const t = useCallback((k: I18nKey) => (STRINGS[lang] as Record<string, string>)[k] ?? k, [lang]);
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useLang() {
  return useContext(Ctx);
}
