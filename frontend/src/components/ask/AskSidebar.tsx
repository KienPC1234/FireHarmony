import { BookOpen, Calendar, CheckCircle2, Globe, Scale } from "lucide-react";
import { Link } from "react-router-dom";
import { useLang } from "@/lib/i18n";
import { AOI_LABELS, QUESTION_CATEGORIES } from "./types";

interface AskSidebarProps {
  aoi: string;
  setAoi: (aoi: string) => void;
  method: string;
  setMethod: (m: string) => void;
  evidence: Record<string, unknown> | null;
  onSelectPrompt: (q: string) => void;
}

export function AskSidebar({
  aoi,
  setAoi,
  method,
  setMethod,
  evidence,
  onSelectPrompt,
}: AskSidebarProps) {
  const { lang } = useLang();
  const vi = lang === "vi";

  return (
    <aside className="space-y-4">
      {/* Target AOI & Settings Card */}
      <div className="rounded-2xl border border-border/80 bg-slate-950/80 p-4 shadow-card backdrop-blur space-y-3">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
          <span className="flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-cyan-400" />
            <span>{vi ? "Khu vực hiệu chuẩn" : "Calibrated Region"}</span>
          </span>
          <span className="font-mono text-xs text-cyan-400">
            {vi ? "Ngữ cảnh trực tiếp" : "Live Context"}
          </span>
        </div>

        <select
          value={aoi}
          onChange={(e) => setAoi(e.target.value)}
          className="w-full rounded-xl border border-border/80 bg-slate-900/90 p-2.5 text-xs font-medium text-white focus:border-cyan-500 focus:outline-none"
        >
          {Object.entries(AOI_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>

        <div className="space-y-1.5 pt-1">
          <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
            <Scale className="h-3 w-3 text-cyan-400" />
            <span>{vi ? "Phương pháp hiệu chỉnh" : "Harmonization Method"}</span>
          </label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="w-full rounded-xl border border-border/80 bg-slate-900/90 p-2 text-xs font-medium text-white focus:border-cyan-500 focus:outline-none"
          >
            <option value="stat">{vi ? "Tỷ lệ mùa vụ (Baseline thống kê)" : "Seasonal Ratio (Statistical baseline)"}</option>
            <option value="ml">{vi ? "Phần dư HGB (Mô hình ML neo B2)" : "Residual HGB (B2-anchored ML)"}</option>
            <option value="ts">{vi ? "Pooled Transformer (Chú ý thời gian)" : "Pooled Transformer (Temporal attention)"}</option>
          </select>
        </div>

        {evidence && (
          <div className="space-y-2 border-t border-border/50 pt-3 text-xs">
            <div className="flex items-center justify-between font-mono text-xs text-slate-400">
              <span>{vi ? "Dữ liệu kiểm chứng" : "Verified Evidence"}</span>
              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                <span>{vi ? "Có căn cứ" : "Grounded"}</span>
              </span>
            </div>
            <div className="rounded-xl border border-border/60 bg-slate-900/50 p-2.5 font-mono text-xs space-y-1 text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-500">{vi ? "Tổng ô:" : "Total Cells:"}</span>
                <span className="text-slate-200">{String(evidence.total_activity_index ?? "-")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{vi ? "Mã phương pháp:" : "Method ID:"}</span>
                <span className="text-cyan-400">{String(evidence.effective_method ?? method)}</span>
              </div>
            </div>
            <Link
              to={`/calendar?aoi=${aoi}`}
              className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 font-semibold transition"
            >
              <Calendar className="h-3 w-3" />
              <span>{vi ? "Xem Calendar ma trận" : "Open Fire Calendar"}</span>
            </Link>
          </div>
        )}
      </div>

      {/* Categorized Scientific Question Library */}
      <div className="rounded-2xl border border-border/80 bg-slate-950/80 p-4 shadow-card backdrop-blur space-y-3">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-border/40 pb-2">
          <BookOpen className="h-3.5 w-3.5 text-cyan-400" />
          <span>{vi ? "Thư viện câu hỏi khoa học" : "Scientific Prompt Library"}</span>
        </div>

        <div className="space-y-3">
          {QUESTION_CATEGORIES.map((cat, idx) => {
            const Icon = cat.icon;
            return (
              <div key={idx} className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
                  <Icon className="h-3 w-3 text-orange-400" />
                  <span>{vi ? cat.titleVi : cat.titleEn}</span>
                </div>
                <div className="space-y-1">
                  {cat.questions.map((q, qIdx) => {
                    const text = vi ? q.qVi : q.qEn;
                    return (
                      <button
                        key={qIdx}
                        type="button"
                        onClick={() => onSelectPrompt(text)}
                        className="w-full text-left rounded-lg p-2 text-xs text-slate-400 hover:text-cyan-200 hover:bg-slate-900/80 transition border border-transparent hover:border-cyan-500/30"
                      >
                        {text}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
