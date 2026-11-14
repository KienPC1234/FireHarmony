import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Loader2, Send } from "lucide-react";
import { api, describeError } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  evidence?: string;
  limitations?: string;
  actions?: Array<{ label: string; to: string }>;
  isStreaming?: boolean;
}

interface IntegratedAiAssistantProps {
  aoi: string;
  data: string;
  year?: number;
  month?: number;
  method?: string;
}

/**
 * Grounded assistant rendered inside a container (dock tab or sheet).
 * It fills the parent height; answers come only from the backend investigate tool.
 */
export function IntegratedAiAssistant({ aoi, data, year, month, method = "stat" }: IntegratedAiAssistantProps) {
  const { t, lang } = useLang();
  const vi = lang === "vi";
  const hasMonth = year !== undefined && month !== undefined;
  const ym = hasMonth ? `${year}-${String(month).padStart(2, "0")}` : null;
  const isSynthetic = data !== "raw";

  const suggestions = [
    ...(ym
      ? [
          {
            id: "month",
            label: t("ai.chip_why_unusual", { ym }),
            query: vi
              ? `Tháng ${ym} tại ${aoi} có bất thường so với trung vị lịch sử không, và bằng chứng là gì?`
              : `Is ${ym} in ${aoi} anomalous relative to the historical median, and what is the evidence?`,
          },
        ]
      : []),
    {
      id: "transition",
      label: t("ai.chip_transition"),
      query: vi
        ? "Bước nhảy số điểm nóng năm 2012 có liên quan đến việc chuyển từ MODIS sang VIIRS không?"
        : "Is the 2012 rise in hotspot counts related to the MODIS to VIIRS transition?",
    },
    {
      id: "coverage",
      label: t("ai.chip_coverage"),
      query: vi
        ? `Những giai đoạn nào tại ${aoi} chưa đủ quan sát song song giữa hai cảm biến?`
        : `Which periods in ${aoi} lack paired observations from both sensors?`,
    },
  ];

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  const send = async (queryText?: string) => {
    const question = (queryText ?? input).trim();
    if (!question || busy) return;
    const stamp = Date.now();
    const botId = `a-${stamp}`;
    setMessages((prev) => [
      ...prev,
      { id: `u-${stamp}`, role: "user", text: question },
      { id: botId, role: "assistant", text: "", isStreaming: true },
    ]);
    setInput("");
    setBusy(true);
    try {
      await api.investigateStream(
        { question, aoi, data, method, year, month, use_llm: false },
        {
          onMeta: (meta) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botId
                  ? {
                      ...msg,
                      evidence:
                        meta.tools_used.length > 0
                          ? vi
                            ? `Nguồn tính toán: ${meta.tools_used.join(", ")}`
                            : `Computed by: ${meta.tools_used.join(", ")}`
                          : undefined,
                      limitations: meta.limitations?.length ? meta.limitations.join(" ") : undefined,
                      actions: [
                        {
                          label: t("ai.inspect_evidence"),
                          to: `/evidence?aoi=${aoi}&data=${data}${ym ? `&ym=${ym}` : ""}`,
                        },
                        { label: t("ai.compare_sensor"), to: `/lab?tab=xray&aoi=${aoi}&data=${data}` },
                      ],
                    }
                  : msg,
              ),
            );
          },
          onDelta: (delta) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botId
                  ? {
                      ...msg,
                      text: msg.text + delta,
                    }
                  : msg,
              ),
            );
          },
          onDone: (full) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botId
                  ? {
                      ...msg,
                      text: full || msg.text,
                      isStreaming: false,
                    }
                  : msg,
              ),
            );
          },
          onError: (err) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botId
                  ? {
                      ...msg,
                      text: vi
                        ? `Lỗi kết nối phân tích: ${describeError(err)}`
                        : `Analysis error: ${describeError(err)}`,
                      isStreaming: false,
                    }
                  : msg,
              ),
            );
          },
        },
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === botId
            ? {
                ...msg,
                text: vi
                  ? `Không lấy được câu trả lời: ${describeError(err)}. Hãy thử lại sau.`
                  : `Could not get an answer: ${describeError(err)}. Please retry.`,
                isStreaming: false,
              }
            : msg,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col text-sm">
      <div className="shrink-0 border-b border-slate-800 px-4 py-3">
        <p className="text-xs text-slate-400">{t("ai.asking_about")}</p>
        <p className="mt-0.5 font-semibold text-white capitalize">
          {aoi} · {ym ?? t("ai.full_record")}
        </p>
        <p className={cn("mt-1 text-xs", isSynthetic ? "text-sky-300" : "text-emerald-300")}>
          {isSynthetic
            ? t("ai.sample_notice")
            : t("ai.observed_notice")}
        </p>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && !busy && (
          <div className="space-y-2">
            <p className="text-xs text-slate-400">
              {vi
                ? "Câu trả lời chỉ dùng số liệu backend tính được. Chọn một câu hỏi gợi ý:"
                : "Answers use only figures computed by the backend. Pick a suggested question:"}
            </p>
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => send(s.query)}
                className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2.5 text-left text-sm text-slate-200 transition hover:border-cyan-500/50 hover:text-white"
              >
                <span>{s.label}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-500" />
              </button>
            ))}
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[90%] rounded-lg bg-cyan-700/80 px-3 py-2 text-sm text-white">{m.text}</p>
            </div>
          ) : (
            <div key={m.id} className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/70 p-3">
              <p className="whitespace-pre-line leading-relaxed text-slate-100">
                {m.text}
                {m.isStreaming && (
                  <span className="inline-block w-1.5 h-3.5 ml-1 bg-cyan-400 animate-pulse align-middle" />
                )}
              </p>
              {m.isStreaming && !m.text && (
                <div className="flex items-center gap-2 text-xs font-mono text-cyan-300 py-1">
                  <div className="h-3 w-3 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                  <span>{t("ai.streaming_deduction")}</span>
                </div>
              )}
              {m.evidence && <p className="font-mono text-xs text-cyan-300">{m.evidence}</p>}
              {m.limitations && (
                <p className="border-l-2 border-amber-500/50 pl-2 text-xs leading-snug text-amber-200/90">
                  {m.limitations}
                </p>
              )}
              {m.actions && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {m.actions.map((a) => (
                    <Link
                      key={a.to}
                      to={a.to}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-slate-500 hover:text-white"
                    >
                      {a.label}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ),
        )}

        {busy && (
          <div className="flex items-center gap-2 text-xs text-cyan-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("ai.retrieving_figures")}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex shrink-0 items-center gap-2 border-t border-slate-800 p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("ai.input_placeholder_short")}
          disabled={busy}
          className="min-h-[40px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || busy}
          aria-label={t("ai.btn_send")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-600 text-white transition hover:bg-cyan-500 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
