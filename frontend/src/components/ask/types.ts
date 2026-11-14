import { Flame, Layers, Scale } from "lucide-react";

export interface Msg {
  role: "user" | "bot";
  text: string;
  via?: string;
  evidence?: Record<string, unknown>;
}

export interface QuestionCategory {
  titleVi: string;
  titleEn: string;
  icon: typeof Flame;
  questions: Array<{ qVi: string; qEn: string }>;
}

export const QUESTION_CATEGORIES: QuestionCategory[] = [
  {
    titleVi: "Chuẩn hóa cảm biến",
    titleEn: "Sensor Harmonization",
    icon: Scale,
    questions: [
      {
        qVi: "Tại sao không thể cộng trực tiếp dữ liệu MODIS và VIIRS?",
        qEn: "Why cannot MODIS and VIIRS counts be summed directly?",
      },
      {
        qVi: "Hệ số k-ratio và cơ chế upscale 1/k hoạt động ra sao?",
        qEn: "How does the k-ratio scaling and 1/k upscale mechanism operate?",
      },
      {
        qVi: "Điều gì xảy ra với chuỗi thời gian nếu không áp dụng chuẩn hóa?",
        qEn: "What happens to the time-series without harmonization?",
      },
    ],
  },
  {
    titleVi: "Dị thường & Khí hậu học",
    titleEn: "Anomalies & Climatology",
    icon: Flame,
    questions: [
      {
        qVi: "MAD Robust Z-Score bảo vệ baseline khỏi năm cực đoan thế nào?",
        qEn: "How does the MAD robust Z-Score protect baseline from fire extremes?",
      },
      {
        qVi: "Ý nghĩa của ngưỡng |z| >= 2 trong quản lý cháy rừng?",
        qEn: "What is the operational meaning of threshold |z| >= 2?",
      },
      {
        qVi: "Tại sao calendar thể hiện chỉ số hoạt động thay vì số vụ cháy thật?",
        qEn: "Why does the calendar show an activity index rather than confirmed fires?",
      },
    ],
  },
  {
    titleVi: "Quỹ đạo & Độ phủ",
    titleEn: "Orbits & Coverage Gaps",
    icon: Layers,
    questions: [
      {
        qVi: "Làm sao phân biệt giữa 'không cháy' và 'không quan sát được'?",
        qEn: "How do we distinguish between 'no fire' and 'unobserved'?",
      },
      {
        qVi: "VIIRS Tandem và Interleaved khác gì MODIS 10:30/13:30?",
        qEn: "How does VIIRS Tandem / Interleaved differ from MODIS 10:30/13:30?",
      },
      {
        qVi: "Tại sao độ phủ yêu cầu ghép đôi (paired >= 90%) là thiết yếu?",
        qEn: "Why is paired coverage (paired >= 90%) essential for valid comparison?",
      },
    ],
  },
];

export const AOI_LABELS: Record<string, string> = {
  vietnam: "Vietnam (Central Highlands / Mekong)",
  amazon: "Amazon (Southern Basin)",
  australia: "Australia (Southeast Black Summer)",
};
