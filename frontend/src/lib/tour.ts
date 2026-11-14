import { driver, type Driver, type DriveStep } from "driver.js";
import type { Lang } from "@/lib/i18n";

export type TourPageId =
  | "home"
  | "calendar"
  | "lab"
  | "xray"
  | "evidence"
  | "investigator"
  | "methods"
  | "guide"
  | "about";

export type TourPageStatus = "accepted" | "dismissed" | "completed";

export interface TourPrefs {
  globalOptOut?: boolean;
  pages: Partial<Record<TourPageId, TourPageStatus>>;
}

const STORAGE_KEY = "fh_tour_prefs_v1";

export const TOUR_START_EVENT = "fh:start-tour";

export function triggerCurrentPageTour(): void {
  window.dispatchEvent(new CustomEvent(TOUR_START_EVENT));
}

let activeDriver: Driver | null = null;

export function resolveTourPage(pathname: string): TourPageId {
  const seg = pathname.split("/").filter(Boolean)[0] ?? "";
  switch (seg) {
    case "calendar":
      return "calendar";
    case "lab":
      return "lab";
    case "xray":
      return "xray";
    case "evidence":
      return "evidence";
    case "investigator":
    case "ask":
      return "investigator";
    case "methods":
    case "method":
      return "methods";
    case "guide":
      return "guide";
    case "about":
      return "about";
    default:
      return "home";
  }
}

export function getTourPrefs(): TourPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { pages: {} };
    const parsed = JSON.parse(raw) as Partial<TourPrefs>;
    return {
      globalOptOut: Boolean(parsed.globalOptOut),
      pages: parsed.pages && typeof parsed.pages === "object" ? parsed.pages : {},
    };
  } catch {
    return { pages: {} };
  }
}

function writeTourPrefs(prefs: TourPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota or private mode restrictions
  }
}

export function saveTourPageStatus(page: TourPageId, status: TourPageStatus): void {
  const prefs = getTourPrefs();
  prefs.pages[page] = status;
  writeTourPrefs(prefs);
}

export function saveTourGlobalOptOut(optOut: boolean): void {
  const prefs = getTourPrefs();
  prefs.globalOptOut = optOut;
  writeTourPrefs(prefs);
}

export function shouldPromptTour(page: TourPageId): boolean {
  const prefs = getTourPrefs();
  if (prefs.globalOptOut) return false;
  return !prefs.pages[page];
}

export function destroyActiveTour(): void {
  if (activeDriver) {
    activeDriver.destroy();
    activeDriver = null;
  }
}

interface BilingualStep {
  element?: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  title: { vi: string; en: string };
  description: { vi: string; en: string };
}

const COMMON_HEADER_STEPS: BilingualStep[] = [
  {
    element: '[data-tour="header-mode-toggle"]',
    side: "bottom",
    align: "end",
    title: {
      vi: "Chuyển chế độ Explore / Research",
      en: "Explore / Research Mode Switch",
    },
    description: {
      vi: "Explore dành cho xem nhanh bản đồ và AI; chuyển sang Research để mở thêm Sensor Lab, X-Ray, Evidence Ledger và Methods.",
      en: "Explore focuses on map & AI; switch to Research to unlock Sensor Lab, X-Ray, Evidence Ledger, and Methods.",
    },
  },
  {
    element: '[data-tour="header-tour-btn"]',
    side: "bottom",
    align: "end",
    title: {
      vi: "Nút mở lại hướng dẫn",
      en: "Replay Tour Button",
    },
    description: {
      vi: "Bất kỳ lúc nào muốn xem lại hướng dẫn cho trang đang mở, bạn chỉ cần nhấn nút này.",
      en: "Click this button anytime to replay the step-by-step tour for the current page.",
    },
  },
];

const PAGE_STEPS: Record<TourPageId, BilingualStep[]> = {
  home: [
    {
      element: '[data-tour="home-hero"]',
      side: "bottom",
      align: "start",
      title: {
        vi: "Chào mừng đến với FireHarmony",
        en: "Welcome to FireHarmony",
      },
      description: {
        vi: "Đây là trạm điều phối chính. Bạn có thể mở ngay Lịch cháy 25 năm hoặc vào Sensor Lab để kiểm tra độ lệch giữa MODIS và VIIRS.",
        en: "This is the mission overview. Jump straight into the 25-year Fire Calendar or open the Sensor Lab to inspect MODIS vs VIIRS drift.",
      },
    },
    {
      element: '[data-tour="home-kpis"]',
      side: "top",
      align: "center",
      title: {
        vi: "Chỉ số dữ liệu trực quan",
        en: "Telemetry Summary Ribbon",
      },
      description: {
        vi: "Hiển thị phạm vi năm dữ liệu, số vùng sinh thái (AOI) sẵn sàng, cặp vệ tinh MODIS/VIIRS và trạng thái nguồn dữ liệu.",
        en: "Shows active year coverage, ready AOI regions, MODIS/VIIRS constellation status, and data provenance.",
      },
    },
    {
      element: '[data-tour="home-orbits"]',
      side: "top",
      align: "center",
      title: {
        vi: "Kiến trúc quỹ đạo vệ tinh",
        en: "Orbital Constellation Architecture",
      },
      description: {
        vi: "Giải thích trực quan lý do MODIS (1000m) và VIIRS (375m) tạo bước nhảy giả năm 2012 nếu không đồng bộ hóa.",
        en: "Visualizes why MODIS (1000m) and VIIRS (375m) create an artificial 2012 surge without harmonization.",
      },
    },
    {
      element: '[data-tour="home-cards"]',
      side: "top",
      align: "center",
      title: {
        vi: "Lối tắt vào từng công cụ",
        en: "Quick Tool Entry Cards",
      },
      description: {
        vi: "Chọn Lịch cháy để xem bản đồ & timeline, Sensor Lab để chạy mô hình STAN/B2, hoặc AI Investigator để hỏi đáp kèm dẫn chứng.",
        en: "Open Fire Calendar for map & timeline, Sensor Lab for STAN/B2 models, or AI Investigator for evidence-backed Q&A.",
      },
    },
    {
      element: '[data-fh-rail]',
      side: "right",
      align: "start",
      title: {
        vi: "Thanh điều hướng bên trái",
        en: "Workspace Navigation Rail",
      },
      description: {
        vi: "Chuyển nhanh giữa các trang và bật chế độ Research ở góc trên để mở thêm Sensor Lab, X-Ray, Evidence và Methods.",
        en: "Switch pages quickly and toggle Research mode in the header to unlock Sensor Lab, X-Ray, Evidence, and Methods.",
      },
    },
    ...COMMON_HEADER_STEPS,
  ],
  calendar: [
    {
      element: '[data-tour="calendar-world-presets"]',
      side: "bottom",
      align: "center",
      title: {
        vi: "Chọn nhanh vùng rừng trọng điểm",
        en: "Quick Forest Hotspot Presets",
      },
      description: {
        vi: "Chọn nhanh vùng rừng nhiều điểm cháy (Tây Nguyên Việt Nam, Amazon Mato Grosso, Đông Nam Úc) hoặc các điểm nóng toàn cầu để tải dữ liệu ngay.",
        en: "Pick a focused forest hotspot preset (Vietnam Central Highlands, Amazon Mato Grosso, SE Australia) or global live region to fetch immediately.",
      },
    },
    {
      element: '[data-tour="calendar-world-guide"]',
      side: "bottom",
      align: "center",
      title: {
        vi: "Quy trình 3 bước trên bản đồ",
        en: "3-Step Map Workflow",
      },
      description: {
        vi: "Bước 1 chọn hoặc khoanh vùng trên bản đồ, Bước 2 chọn khoảng ngày Fetch NASA FIRMS, Bước 3 tua Timeline và hỏi AI.",
        en: "Step 1 pick or draw a region, Step 2 choose date range & Fetch NASA FIRMS, Step 3 scrub the Timeline & ask AI.",
      },
    },
    {
      element: '[data-tour="calendar-actions"]',
      side: "bottom",
      align: "start",
      title: {
        vi: "Menu Thao tác & Tải dữ liệu NASA FIRMS",
        en: "Actions & Live NASA FIRMS Fetch",
      },
      description: {
        vi: "Mở menu Actions để chọn khoảng ngày (5d, 10d, 30d), tải dữ liệu Live FIRMS mới nhất, lưu vùng AOI hoặc xuất CSV.",
        en: "Open Actions to pick date windows (5d, 10d, 30d), fetch live NASA FIRMS detections, save AOIs, or export CSV.",
      },
    },
    {
      element: '[data-tour="calendar-tabs"]',
      side: "bottom",
      align: "center",
      title: {
        vi: "Chuyển chế độ Bản đồ / Ma trận",
        en: "Map / Matrix View Switcher",
      },
      description: {
        vi: "Xem điểm cháy trực tiếp trên bản đồ GIS hoặc chuyển sang bảng Ma trận Năm × Tháng để soi bất thường theo mùa.",
        en: "Explore hotspots on the GIS map or switch to the Year x Month matrix to spot seasonal anomalies.",
      },
    },
    {
      element: '.leaflet-container',
      side: "left",
      align: "center",
      title: {
        vi: "Bản đồ vệ tinh & Khoanh vùng AOI",
        en: "Satellite Map & AOI Drawing",
      },
      description: {
        vi: "Dùng thanh công cụ trên bản đồ để đổi nền (Satellite/Dark/Topography), vẽ đa giác, vẽ hộp Box hoặc nhập tọa độ Lat/Lon rồi Fetch.",
        en: "Use map tools to switch basemaps, draw polygons or bounding boxes, or enter Lat/Lon coordinates to fetch live hotspots.",
      },
    },
    {
      element: '[data-ui-review="calendar-scrubber"]',
      side: "top",
      align: "center",
      title: {
        vi: "Thanh Timeline & Mở rộng trái/phải",
        en: "Timeline Scrubber & Range Extension",
      },
      description: {
        vi: "Phát tự động theo từng ngày/tháng, chọn nhanh từng mốc thời gian hoặc bấm nút mở rộng trái/phải để tải thêm dữ liệu.",
        en: "Play day-by-day or month-by-month, jump to any frame, or extend left/right to fetch adjacent date windows.",
      },
    },
    {
      element: 'aside[aria-label="Fire activity inspector"]',
      side: "left",
      align: "center",
      title: {
        vi: "Bảng Inspector & Bộ lọc cảm biến",
        en: "Inspector Dock & Sensor Filters",
      },
      description: {
        vi: "Chuyển nhanh vùng AOI, đổi nguồn dữ liệu (NASA Observed / Synthetic Demo), lọc theo cảm biến, ngày/đêm hoặc ngưỡng FRP.",
        en: "Switch AOI, toggle data feed (NASA Observed / Synthetic Demo), or filter by sensor, day/night, and FRP threshold.",
      },
    },
    {
      element: '[data-tour="calendar-ai-btn"]',
      side: "bottom",
      align: "end",
      title: {
        vi: "Bảng Inspector & Ask AI",
        en: "Inspector Dock & Ask AI",
      },
      description: {
        vi: "Mở panel bên phải để xem chi tiết tháng đang chọn, lọc cảm biến/FRP hoặc hỏi AI ngay trên vùng đang xem.",
        en: "Open the right dock to inspect the selected period, filter sensors/FRP, or ask AI about the active region.",
      },
    },
    ...COMMON_HEADER_STEPS,
  ],
  lab: [
    {
      element: '[data-tour="global-context-bar"]',
      side: "bottom",
      align: "center",
      title: {
        vi: "Thanh ngữ cảnh vùng & nguồn dữ liệu",
        en: "Global Context Bar",
      },
      description: {
        vi: "Chọn vùng AOI chuẩn hoặc Custom Live Region. Mọi thí nghiệm bên dưới đều chạy theo vùng và dataset này.",
        en: "Select a benchmark AOI or Custom Live Region. All experiments below run against this active context.",
      },
    },
    {
      element: '[data-tour="lab-groups"]',
      side: "bottom",
      align: "center",
      title: {
        vi: "Nhóm nhiệm vụ thí nghiệm",
        en: "Experiment Task Groups",
      },
      description: {
        vi: "Chọn mục tiêu: kiểm tra sai số cảm biến, đối chiếu phương pháp đồng bộ hay soi X-Ray theo chuỗi thời gian.",
        en: "Pick your goal: sensor drift checks, harmonization method comparison, or X-Ray time-series inspection.",
      },
    },
    {
      element: '[data-tour="lab-tabs"]',
      side: "bottom",
      align: "start",
      title: {
        vi: "3 Chế độ thí nghiệm trong Lab",
        en: "Three Lab Experiment Modes",
      },
      description: {
        vi: "Chuyển giữa Sensor Replay (so sánh MODIS vs VIIRS), Method Lab (đối chiếu STAN & B2) và X-Ray Perspective.",
        en: "Switch between Sensor Replay (MODIS vs VIIRS), Method Lab (STAN vs B2), and X-Ray Perspective.",
      },
    },
    {
      element: '#lab-protocol',
      side: "bottom",
      align: "center",
      title: {
        vi: "Giao thức thí nghiệm (Protocol)",
        en: "Experiment Protocol",
      },
      description: {
        vi: "Tóm tắt câu hỏi nghiên cứu và cách đọc kết quả cho tab bạn đang mở.",
        en: "Summarizes the research question and how to interpret results for the active tab.",
      },
    },
    {
      element: '#lab-filters',
      side: "right",
      align: "start",
      title: {
        vi: "Bảng tham số & nút Chạy thí nghiệm",
        en: "Experiment Controls & Run Button",
      },
      description: {
        vi: "Chọn năm, tháng, tập cảm biến (MODIS/VIIRS) rồi nhấn Run để tái lập kết quả trên khu vực bên phải.",
        en: "Pick year, month, and active sensors (MODIS/VIIRS), then click Run to compute results on the right.",
      },
    },
    {
      element: '[data-tour="lab-workspace"]',
      side: "top",
      align: "center",
      title: {
        vi: "Khu vực mô phỏng & biểu đồ",
        en: "Simulation & Chart Workspace",
      },
      description: {
        vi: "Nhấn Run / Chạy để tính toán và quan sát chuỗi thời gian đồng bộ hóa, phần dư và chỉ số sai số.",
        en: "Run the experiment to inspect harmonized time series, residuals, and calibration error metrics.",
      },
    },
    ...COMMON_HEADER_STEPS,
  ],
  xray: [
    {
      element: '[data-tour="xray-tabs"]',
      side: "bottom",
      align: "start",
      title: {
        vi: "3 Góc nhìn X-Ray",
        en: "Three X-Ray Perspectives",
      },
      description: {
        vi: "Chọn Timeline & Residual (theo ngày hoặc tháng), Transition Illusion (ảo giác bước nhảy 2012) hoặc Backtest Leaderboard.",
        en: "Choose Timeline & Residual (daily or monthly), Transition Illusion (the 2012 step artifact), or Backtest Leaderboard.",
      },
    },
    {
      element: '[data-tour="global-context-bar"]',
      side: "bottom",
      align: "center",
      title: {
        vi: "Đồng bộ vùng dữ liệu",
        en: "Shared Region Context",
      },
      description: {
        vi: "Bạn có thể soi dữ liệu vùng chuẩn hoặc dữ liệu Live FIRMS vừa fetch từ Calendar.",
        en: "Inspect benchmark regions or live NASA FIRMS datasets fetched from the Calendar.",
      },
    },
    {
      element: '[data-tour="xray-cockpit"]',
      side: "top",
      align: "center",
      title: {
        vi: "Bảng điều khiển & Biểu đồ chẩn đoán",
        en: "Diagnostic Sidebar & Charts",
      },
      description: {
        vi: "Cột trái hiển thị trạng thái huấn luyện STAN/HTS và nút chuyển vùng; bên phải vẽ trực quan sai khác giữa quan sát thô và mô hình.",
        en: "Left sidebar shows STAN/HTS training status and region controls; right panel plots raw vs harmonized trajectories.",
      },
    },
    ...COMMON_HEADER_STEPS,
  ],
  evidence: [
    {
      element: '[data-tour="global-context-bar"]',
      side: "bottom",
      align: "center",
      title: {
        vi: "Chọn vùng cần kiểm toán",
        en: "Select Region to Audit",
      },
      description: {
        vi: "Evidence Ledger kiểm tra mức độ đủ điều kiện khoa học cho từng AOI hoặc vùng Custom bạn vừa tải.",
        en: "Evidence Ledger audits scientific eligibility for each benchmark AOI or custom fetched region.",
      },
    },
    {
      element: '#evidence-verdict',
      side: "bottom",
      align: "center",
      title: {
        vi: "Kết luận thẩm định (Verdict)",
        en: "Audit Verdict Banner",
      },
      description: {
        vi: "Cho biết dữ liệu hiện tại đạt ELIGIBLE, PARTIAL hay chưa đủ điều kiện suy luận xu hướng dài hạn.",
        en: "Indicates whether the dataset is ELIGIBLE, PARTIAL, or insufficient for long-term trend claims.",
      },
    },
    {
      element: '#evidence-scope',
      side: "top",
      align: "center",
      title: {
        vi: "Phạm vi & độ phủ dữ liệu",
        en: "Coverage & Scope",
      },
      description: {
        vi: "Kiểm tra số ngày có quan sát, khoảng thời gian MODIS/VIIRS và trạng thái sẵn sàng của dataset.",
        en: "Check observed day counts, MODIS/VIIRS span, and dataset readiness.",
      },
    },
    {
      element: '#evidence-matrix',
      side: "top",
      align: "center",
      title: {
        vi: "Ma trận kiểm chứng từng chỉ số",
        en: "Verification Matrix",
      },
      description: {
        vi: "Đối chiếu độ phủ ngày, mật độ vệ tinh và sai số hiệu chuẩn để đảm bảo minh bạch trước khi trích dẫn.",
        en: "Cross-checks day coverage, sensor density, and calibration error for transparent scientific reporting.",
      },
    },
    {
      element: '#evidence-limits',
      side: "top",
      align: "center",
      title: {
        vi: "Giới hạn diễn giải khoa học",
        en: "Scientific Interpretation Limits",
      },
      description: {
        vi: "Nêu rõ những kết luận không được suy diễn quá mức từ dữ liệu vệ tinh hiện tại.",
        en: "Lists claims that must not be over-extrapolated from the current satellite observations.",
      },
    },
    ...COMMON_HEADER_STEPS,
  ],
  investigator: [
    {
      element: '[data-tour="ai-context"]',
      side: "bottom",
      align: "center",
      title: {
        vi: "Ngữ cảnh hỏi đáp AI",
        en: "AI Investigation Context",
      },
      description: {
        vi: "AI chỉ trả lời dựa trên dữ liệu thực tế của vùng và khoảng thời gian bạn chọn ở đây, tránh suy đoán vô căn cứ.",
        en: "The AI grounds every answer in the active region and period shown here, avoiding unsupported speculation.",
      },
    },
    {
      element: '[data-tour="ai-prompts"]',
      side: "bottom",
      align: "start",
      title: {
        vi: "Câu hỏi gợi ý nhanh",
        en: "Suggested Research Prompts",
      },
      description: {
        vi: "Nhấn vào một câu hỏi mẫu để AI tự động tổng hợp nhận định, bằng chứng số liệu và độ bất định.",
        en: "Click a sample prompt to generate structured findings, numerical evidence, and uncertainty notes.",
      },
    },
    {
      element: '[data-tour="ai-input-form"]',
      side: "top",
      align: "center",
      title: {
        vi: "Nhập câu hỏi của bạn",
        en: "Ask Your Question",
      },
      description: {
        vi: "Gõ câu hỏi bằng tiếng Việt hoặc tiếng Anh rồi nhấn Gửi để nhận phân tích kèm liên kết đối chiếu.",
        en: "Type a question in Vietnamese or English and send to receive an evidence-linked analysis.",
      },
    },
    {
      element: '#ai-telemetry',
      side: "left",
      align: "start",
      title: {
        vi: "Bảng Telemetry đối chiếu",
        en: "Grounding Telemetry Stack",
      },
      description: {
        vi: "Hiển thị số liệu gốc từ API để bạn tự kiểm chứng mọi con số mà AI trích dẫn trong câu trả lời.",
        en: "Displays live API telemetry so you can independently verify every number cited by the AI.",
      },
    },
    ...COMMON_HEADER_STEPS,
  ],
  methods: [
    {
      element: '[data-tour="methods-header"]',
      side: "bottom",
      align: "center",
      title: {
        vi: "Phương pháp & Công thức toán học",
        en: "Methodology & Math Formulations",
      },
      description: {
        vi: "Trình bày chi tiết cách FireHarmony khử bước nhảy MODIS -> VIIRS bằng B2 Seasonal Anchor và STAN Safe v1.",
        en: "Explains how FireHarmony removes the MODIS -> VIIRS transition step using B2 Seasonal Anchor and STAN Safe v1.",
      },
    },
    {
      element: '[data-tour="methods-nav"]',
      side: "bottom",
      align: "center",
      title: {
        vi: "Thanh chuyển mục phương pháp",
        en: "Methodology Section Switcher",
      },
      description: {
        vi: "Chuyển nhanh giữa Nguồn dữ liệu, Pipeline đồng bộ, Công thức KaTeX, Holdout Benchmark và Giới hạn mô hình.",
        en: "Jump between Data Sources, Pipeline, KaTeX Math, Holdout Benchmark, and Model Limits.",
      },
    },
    {
      element: '[data-tour="methods-body"]',
      side: "top",
      align: "center",
      title: {
        vi: "Kiến trúc mô hình & Giới hạn khoa học",
        en: "Model Architecture & Scientific Limits",
      },
      description: {
        vi: "Cuộn xuống để xem công thức KaTeX, sơ đồ pipeline và quy tắc bảo toàn ngày không có ảnh chụp (unknown).",
        en: "Scroll to inspect KaTeX equations, pipeline diagrams, and strict preservation of unobserved days as unknown.",
      },
    },
    ...COMMON_HEADER_STEPS,
  ],
  guide: [
    {
      element: '#start60',
      side: "bottom",
      align: "center",
      title: {
        vi: "Bắt đầu trong 60 giây",
        en: "60-Second Quick Start",
      },
      description: {
        vi: "Tóm tắt 3 bước nhanh nhất để đi từ bản đồ Lịch cháy đến kiểm chứng trong Lab và Evidence.",
        en: "Three-step walkthrough from the Fire Calendar map to Lab and Evidence verification.",
      },
    },
    {
      element: '#calendar',
      side: "top",
      align: "center",
      title: {
        vi: "Hướng dẫn đọc Lịch cháy & Live Fetch",
        en: "Calendar & Live Fetch Guide",
      },
      description: {
        vi: "Giải thích ý nghĩa màu sắc điểm nóng, z-score bất thường và cách tải dữ liệu NASA FIRMS theo vùng tự chọn.",
        en: "Explains hotspot colors, anomaly z-scores, and fetching custom-region live NASA FIRMS data.",
      },
    },
    {
      element: '#labev',
      side: "top",
      align: "center",
      title: {
        vi: "Sử dụng Sensor Lab & Evidence Ledger",
        en: "Using Sensor Lab & Evidence Ledger",
      },
      description: {
        vi: "Hướng dẫn quy trình kiểm chứng chéo giữa biểu đồ mô phỏng và sổ bằng chứng khoa học.",
        en: "Walks through cross-checking simulation charts against the scientific evidence ledger.",
      },
    },
    {
      element: '#aicsv',
      side: "top",
      align: "center",
      title: {
        vi: "Hỏi AI & Tải CSV tự chọn",
        en: "AI Investigator & CSV Upload",
      },
      description: {
        vi: "Cách đặt câu hỏi có dẫn chứng và nạp dữ liệu FIRMS CSV của riêng bạn để phân tích.",
        en: "How to ask grounded questions and ingest your own FIRMS CSV files for analysis.",
      },
    },
    {
      element: '#fix',
      side: "top",
      align: "center",
      title: {
        vi: "Xử lý sự cố thường gặp",
        en: "Troubleshooting",
      },
      description: {
        vi: "Tổng hợp các lỗi phổ biến (vùng quá lớn, thiếu dữ liệu raw, API key) và cách khắc phục ngay.",
        en: "Common issues (oversized bbox, missing raw data, API key limits) and how to resolve them.",
      },
    },
    ...COMMON_HEADER_STEPS,
  ],
  about: [
    {
      element: '[data-tour="about-mission"]',
      side: "bottom",
      align: "center",
      title: {
        vi: "Giới thiệu dự án & Team AlphaCentauriAB",
        en: "Project Mission & Team AlphaCentauriAB",
      },
      description: {
        vi: "Thông tin bài thi NASA Space Apps Challenge 2026 và mục tiêu đồng bộ dữ liệu cháy rừng đa thập kỷ.",
        en: "Overview of our NASA Space Apps Challenge 2026 entry for multi-decadal wildfire harmonization.",
      },
    },
    {
      element: '[data-tour="about-disclaimer"]',
      side: "top",
      align: "center",
      title: {
        vi: "Tuyên bố miễn trừ & Chuẩn khoa học",
        en: "Scientific Disclaimer",
      },
      description: {
        vi: "Làm rõ sự khác biệt giữa tín hiệu điểm nóng vệ tinh (FRP) và diện tích cháy thực địa.",
        en: "Clarifies the distinction between satellite thermal hotspots (FRP) and ground-truth burned area.",
      },
    },
    ...COMMON_HEADER_STEPS,
  ],
};

function isElementVisible(selector: string): boolean {
  const el = document.querySelector(selector);
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function getPageTourSteps(page: TourPageId, lang: Lang): DriveStep[] {
  const rawSteps = PAGE_STEPS[page] ?? PAGE_STEPS.home;
  const resolved: DriveStep[] = [];

  for (const step of rawSteps) {
    if (step.element && !isElementVisible(step.element)) {
      continue;
    }
    resolved.push({
      element: step.element,
      popover: {
        title: step.title[lang],
        description: step.description[lang],
        side: step.side ?? "bottom",
        align: step.align ?? "center",
      },
    });
  }

  return resolved;
}

export function startPageTour(page: TourPageId, lang: Lang, onFinish?: () => void): boolean {
  destroyActiveTour();

  const steps = getPageTourSteps(page, lang);
  if (steps.length === 0) return false;

  const isVi = lang === "vi";
  const instance = driver({
    showProgress: true,
    animate: true,
    allowClose: true,
    smoothScroll: true,
    overlayColor: "rgba(2, 6, 23, 0.72)",
    stagePadding: 8,
    stageRadius: 12,
    popoverClass: "fh-driver-popover",
    nextBtnText: isVi ? "Tiếp theo" : "Next",
    prevBtnText: isVi ? "Quay lại" : "Back",
    doneBtnText: isVi ? "Hoàn tất" : "Done",
    progressText: "{{current}} / {{total}}",
    steps,
    onDestroyed: () => {
      if (activeDriver === instance) {
        activeDriver = null;
      }
      saveTourPageStatus(page, "completed");
      onFinish?.();
    },
  });

  activeDriver = instance;
  instance.drive();
  return true;
}
