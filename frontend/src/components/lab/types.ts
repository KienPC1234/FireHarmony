import { Eye, Link2, Radar, RotateCcw, Satellite, ScanEye } from "lucide-react";

export type Tab = "xray" | "replay" | "simulator" | "blindspots" | "spatial" | "cross";

export interface SensorSpec {
  id: string;
  label: string;
  sub: string;
  orbit: string;
  res: string;
  tone: "amber" | "orange" | "sky" | "violet";
  accentColor: string;
}

export const SENSORS: SensorSpec[] = [
  {
    id: "MODIS",
    label: "MODIS (Terra & Aqua)",
    sub: "Terra 10:30 + Aqua 13:30 LT · 2000-present",
    orbit: "Sun-synchronous polar 705 km",
    res: "1000 m (thermal)",
    tone: "amber",
    accentColor: "#f59e0b",
  },
  {
    id: "SNPP",
    label: "VIIRS (Suomi NPP)",
    sub: "Primary baseline · 13:30 LT ascending · 2012-present",
    orbit: "Afternoon orbit 824 km",
    res: "375 m (I-band active fire)",
    tone: "orange",
    accentColor: "#f97316",
  },
  {
    id: "NOAA-20",
    label: "VIIRS (NOAA-20 / JPSS-1)",
    sub: "Half-orbit separation from SNPP · 2017-present",
    orbit: "Constellation tandem 824 km",
    res: "375 m (I-band active fire)",
    tone: "sky",
    accentColor: "#0ea5e9",
  },
  {
    id: "NOAA-21",
    label: "VIIRS (NOAA-21 / JPSS-2)",
    sub: "Next-generation constellation · 2022-present",
    orbit: "Constellation interleaved 824 km",
    res: "375 m (I-band active fire)",
    tone: "violet",
    accentColor: "#8b5cf6",
  },
];

export const TABS: Array<{
  id: Tab;
  label: string;
  labelVi: string;
  hint: string;
  hintVi: string;
  icon: typeof Satellite;
}> = [
  {
    id: "xray",
    label: "Sensor X-Ray",
    labelVi: "Sensor X-Ray",
    icon: ScanEye,
    hint: "Dissect sensor discrepancies, 2012 transition illusion, and holdout benchmark",
    hintVi: "Giải phẫu độ lệch sensor, bước nhảy 2012 và ma trận holdout",
  },
  {
    id: "replay",
    label: "Test a Model",
    labelVi: "Thử mô hình",
    icon: RotateCcw,
    hint: "Pick STAN, HTS or the B2 baseline; VIIRS is hidden until Reveal, then audit the prediction month by month.",
    hintVi: "Chọn STAN, HTS hoặc baseline B2; VIIRS bị ẩn đến khi bấm Reveal, sau đó kiểm tra dự đoán từng tháng.",
  },
  {
    id: "simulator",
    label: "Mission Simulator",
    labelVi: "Mô phỏng vệ tinh",
    icon: Satellite,
    hint: "Simulate sensor dropouts and recalculate the fire calendar",
    hintVi: "Bỏ bớt cảm biến, tính lại calendar và đánh giá độ suy giảm",
  },
  {
    id: "blindspots",
    label: "Blind Spots",
    labelVi: "Điểm mù quan trắc",
    icon: Eye,
    hint: "Audit daily requested vs observed tiles",
    hintVi: "Kiểm toán ngày nào được quan sát và ngày nào trống",
  },
  {
    id: "spatial",
    label: "Spatial Co-Observation",
    labelVi: "Đồng bộ không gian",
    icon: Radar,
    hint: "Co-observation spatial overlap between sensors",
    hintVi: "Đồng bộ không gian tại các ô mà cả 2 cảm biến cùng thấy",
  },
  {
    id: "cross",
    label: "Cross-dataset (Burned Area)",
    labelVi: "Đối chiếu diện tích cháy",
    icon: Link2,
    hint: "Correlate activity index with external burned area series",
    hintVi: "Đối chiếu tương quan với chuỗi diện tích cháy (burned area)",
  },
];

export type TaskGroupId = "compare" | "simulate" | "validate";

export interface TaskGroup {
  id: TaskGroupId;
  label: string;
  labelVi: string;
  desc: string;
  descVi: string;
  tabs: Tab[];
}

export const TASK_GROUPS: TaskGroup[] = [
  {
    id: "compare",
    label: "Compare Sensors",
    labelVi: "So sánh cảm biến",
    desc: "Inspect optical discrepancies and evaluate models on blind holdout tests.",
    descVi: "Giải phẫu sai khác quang học và kiểm chứng mô hình trên tập kiểm thử giấu kín.",
    tabs: ["xray", "replay"],
  },
  {
    id: "simulate",
    label: "Test Observation Choices",
    labelVi: "Thử nghiệm quan trắc",
    desc: "Simulate satellite constellation changes and inspect observation blind spots.",
    descVi: "Mô phỏng thay đổi cấu hình vệ tinh và kiểm tra các điểm mù quan sát.",
    tabs: ["simulator", "blindspots"],
  },
  {
    id: "validate",
    label: "Validate Evidence",
    labelVi: "Kiểm chứng dữ liệu",
    desc: "Check spatial co-observation overlap and external burned area correlation.",
    descVi: "Kiểm tra độ phủ đồng bộ không gian và đối chiếu tương quan diện tích cháy.",
    tabs: ["spatial", "cross"],
  },
];

export const PRESETS: Array<{
  id: string;
  name: { vi: string; en: string };
  region: { vi: string; en: string };
  coords: string;
}> = [
  {
    id: "vietnam",
    name: { vi: "Việt Nam", en: "Vietnam" },
    region: { vi: "Tây Nguyên & Duyên hải Nam Trung Bộ", en: "Central Highlands & South Central Coast" },
    coords: "104°E - 109°E",
  },
  {
    id: "amazon",
    name: { vi: "Amazon", en: "Amazon" },
    region: { vi: "Nam bồn địa Amazon / Cerrado", en: "Southern Amazon Basin / Cerrado" },
    coords: "70°W - 50°W",
  },
  {
    id: "australia",
    name: { vi: "Úc (Australia)", en: "Australia" },
    region: { vi: "Đông Nam Úc (Black Summer)", en: "Southeast Australia (Black Summer)" },
    coords: "113°E - 153°E",
  },
];
