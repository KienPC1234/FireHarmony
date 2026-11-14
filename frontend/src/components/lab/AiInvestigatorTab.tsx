import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { compact } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { MarkdownView } from "@/components/markdown";
import { Kpi, Section } from "./LabWidgets";

interface AiInvestigatorTabProps {
  question: string;
  setQuestion: (q: string) => void;
  invest: Awaited<ReturnType<typeof api.investigate>> | null;
  busy: boolean;
  onRun: () => void;
}

export function AiInvestigatorTab({
  question,
  setQuestion,
  invest,
  busy,
  onRun,
}: AiInvestigatorTabProps) {
  const { lang } = useLang();
  const vi = lang === "vi";

  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr] animate-fade-in">
      <Section
        title={vi ? "Điều tra dị thường có dẫn chứng" : "Grounded Anomaly Investigation"}
        subtitle={vi ? "Công cụ tính toán trước, AI giải thích theo bằng chứng" : "Deterministic audit tools first, AI explains"}
      >
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {[
            vi ? "Vì sao tháng này bất thường?" : "Why is this month anomalous?",
            vi ? "Coverage tháng này đủ không?" : "Is coverage sufficient?",
            vi ? "Bỏ VIIRS thì mất gì?" : "What do we lose without VIIRS?",
          ].map((s) => (
            <button
              key={s}
              onClick={() => setQuestion(s)}
              className="rounded-full border border-border/70 bg-slate-900/80 px-2.5 py-1 text-xs text-slate-300 hover:border-cyan-500/40 hover:text-white transition"
            >
              {s}
            </button>
          ))}
        </div>

        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-border/70 bg-slate-950 p-3 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
          aria-label="Investigator question"
        />

        <button
          onClick={onRun}
          disabled={busy}
          className="mt-2.5 inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-cyan-500 shadow-sm disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          <span>{vi ? "Bắt đầu điều tra" : "Investigate"}</span>
        </button>

        {invest && (
          <div className="mt-4 space-y-3.5">
            {/* Rendered Markdown View */}
            <div className="rounded-xl border border-cyan-500/30 bg-slate-950/80 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2 text-xs font-bold text-cyan-400">
                <Sparkles className="h-4 w-4" />
                <span>{vi ? "Đánh giá của điều tra viên AI" : "Investigator Assessment"}</span>
              </div>
              <MarkdownView content={invest.answer} />
            </div>

            <div className="flex flex-wrap gap-1.5 pt-1">
              {invest.tools_used.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 font-mono text-xs text-sky-300"
                >
                  tool: {t}
                </span>
              ))}
              <span className="rounded-full border border-border/60 bg-slate-900 px-2.5 py-0.5 font-mono text-xs text-slate-400">
                llm_used={String(invest.llm_used)}
              </span>
            </div>

            {invest.evidence && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 pt-1">
                <Kpi
                  label={vi ? "Tổng chỉ số hoạt động" : "Total Activity"}
                  value={compact(Number(invest.evidence.total_activity_index))}
                />
                <Kpi
                  label={vi ? "Ô thực trắc" : "Observed"}
                  value={compact(Number(invest.evidence.observed_cells))}
                  tone="good"
                />
                <Kpi
                  label={vi ? "Ô ước tính" : "Estimated"}
                  value={compact(Number(invest.evidence.estimated_cells))}
                  tone="warn"
                />
                <Kpi label={vi ? "Chỉ số Z" : "Z-Score"} value={String(invest.evidence.z ?? "-")} />
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title={vi ? "Giới hạn & Trích dẫn" : "Limitations & Citations"}>
        {invest ? (
          <div className="space-y-3">
            <ul className="space-y-2 text-xs text-slate-300">
              {invest.limitations.map((l) => (
                <li key={l} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <span>{l}</span>
                </li>
              ))}
            </ul>

            {invest.citations.length > 0 && (
              <div className="space-y-1.5 border-t border-border/40 pt-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  {vi ? "Nguồn trích dẫn & Nguồn gốc" : "Citations & Provenance"}
                </p>
                {invest.citations.map((c) => (
                  <p key={c} className="break-all rounded-lg border border-border/60 bg-slate-950 p-2 font-mono text-xs text-slate-300">
                    {c}
                  </p>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            {vi
              ? "Bấm 'Bắt đầu điều tra' để hiển thị danh sách công cụ tính toán, bằng chứng dữ liệu và các giới hạn kỹ thuật."
              : "Run an investigation to audit the underlying tool calls, evidence ledger, and limitations."}
          </p>
        )}
      </Section>
    </div>
  );
}
