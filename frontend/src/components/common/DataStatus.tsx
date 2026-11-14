import { CheckCircle2, AlertTriangle, HelpCircle, XCircle, Sparkles, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

export type ScientificDataState =
  | "observed"      // NASA FIRMS verified satellite observation
  | "estimated"     // Model-calibrated activity index (e.g., k-ratio / SensorFormer)
  | "synthetic"     // Artificially generated verification benchmark
  | "unknown"       // Insufficient evidence or cloud obscured (never zero)
  | "unavailable"   // Model or dataset artifact missing
  | "error";        // Network or processing failure

interface DataStatusProps {
  state: ScientificDataState;
  method?: string;
  className?: string;
  compact?: boolean;
  onRetry?: () => void;
}

export function DataStatus({ state, method, className, compact = false, onRetry }: DataStatusProps) {
  const { lang } = useLang();
  const vi = lang === "vi";

  const config = {
    observed: {
      label: vi ? "Dữ liệu quan sát NASA" : "NASA Observed",
      description: vi
        ? "Phát hiện điểm nóng từ vệ tinh NASA FIRMS đã xác thực"
        : "Verified satellite hotspot detections from NASA FIRMS archives",
      badgeClass: "bg-emerald-950/60 text-emerald-300 border-emerald-500/40",
      icon: CheckCircle2,
      iconColor: "text-emerald-400",
    },
    estimated: {
      label: vi ? "Ước lượng mô hình" : "Model Estimated",
      description: vi
        ? `Giá trị hiệu chỉnh chuẩn hóa (${method || "k-ratio"})`
        : `Harmonized activity index (${method || "k-ratio"})`,
      badgeClass: "bg-purple-950/60 text-purple-300 border-purple-500/40",
      icon: Sparkles,
      iconColor: "text-purple-400",
    },
    synthetic: {
      label: vi ? "Dữ liệu mô phỏng" : "Synthetic Sample",
      description: vi
        ? "Tập dữ liệu tạo để kiểm thử, không phản ánh hiện tượng thực tế"
        : "Artificially generated benchmark; not physical observation",
      badgeClass: "bg-sky-950/60 text-sky-300 border-sky-500/40",
      icon: Database,
      iconColor: "text-sky-400",
    },
    unknown: {
      label: vi ? "Chưa đủ bằng chứng" : "Insufficient Evidence",
      description: vi
        ? "Mây mù che phủ hoặc thiếu lượt vệ tinh bay qua (không tương đương 0)"
        : "Cloud obscuration or orbital coverage gap; does not denote zero fires",
      badgeClass: "bg-slate-900 text-slate-300 border-slate-700",
      icon: HelpCircle,
      iconColor: "text-slate-400",
    },
    unavailable: {
      label: vi ? "Chưa khả dụng" : "Model Unavailable",
      description: vi
        ? "Mô hình hoặc tập dữ liệu yêu cầu chưa được triển khai"
        : "Requested model artifact or dataset partition is currently unavailable",
      badgeClass: "bg-amber-950/60 text-amber-300 border-amber-500/40",
      icon: AlertTriangle,
      iconColor: "text-amber-400",
    },
    error: {
      label: vi ? "Lỗi xử lý" : "Processing Error",
      description: vi
        ? "Không thể tải hoặc xử lý dữ liệu"
        : "Failed to fetch or process telemetry stream",
      badgeClass: "bg-rose-950/60 text-rose-300 border-rose-500/40",
      icon: XCircle,
      iconColor: "text-rose-400",
    },
  }[state];

  const Icon = config.icon;

  if (compact) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold font-mono border tracking-wide",
          config.badgeClass,
          className,
        )}
        title={config.description}
      >
        <Icon className={cn("h-3 w-3", config.iconColor)} />
        <span>{config.label}</span>
      </span>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border p-3 text-xs",
        config.badgeClass,
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <Icon className={cn("h-4 w-4 shrink-0", config.iconColor)} />
        <div>
          <div className="font-bold tracking-wide">{config.label}</div>
          <div className="text-slate-300/90 text-xs font-sans">{config.description}</div>
        </div>
      </div>
      {state === "error" && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-rose-800/60 hover:bg-rose-700 px-2.5 py-1 text-xs font-semibold text-white transition"
        >
          {vi ? "Thử lại" : "Retry"}
        </button>
      )}
    </div>
  );
}
