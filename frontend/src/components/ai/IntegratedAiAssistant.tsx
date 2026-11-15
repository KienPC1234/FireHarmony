import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Loader2, Send, Wrench } from "lucide-react";
import { api, describeError, readErrorCode, ApiError, BOT_GUARD_CHALLENGE } from "@/lib/api";
import { TurnstileGate, type TurnstileGateHandle } from "@/components/common/TurnstileGate";
import { useLang } from "@/lib/i18n";
import { useResearchContext } from "@/lib/researchContext";
import { cn } from "@/lib/utils";
import { MarkdownView } from "@/components/markdown";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  evidence?: string;
  limitations?: string;
  toolCalls?: Array<{ name: string; args?: Record<string, unknown>; summary?: string }>;
  actions?: Array<{ label: string; to: string }>;
  isStreaming?: boolean;
}

interface IntegratedAiAssistantProps {
  aoi: string;
  data: string;
  year?: number;
  month?: number;
  method?: string;
  dataset?: string;
  bbox?: string | null;
}

/**
 * Grounded assistant rendered inside a container (dock tab or sheet).
 * It fills the parent height; answers come only from the backend investigate tool.
 */
export function IntegratedAiAssistant({
  aoi,
  data,
  year,
  month,
  method = "stat",
  dataset,
  bbox,
}: IntegratedAiAssistantProps) {
  const { t, lang } = useLang();
  const { mode } = useResearchContext();
  const [sp] = useSearchParams();
  const effectiveDataset = dataset ?? sp.get("dataset") ?? undefined;
  const effectiveBbox = (bbox ?? sp.get("bbox")) || undefined;
  const hasMonth = year !== undefined && month !== undefined;
  const ym = hasMonth ? `${year}-${String(month).padStart(2, "0")}` : null;
  const isSynthetic = data !== "raw";

  const suggestions = mode === "explore"
    ? [
        ...(ym
          ? [
              {
                id: "month",
                label: t("ai.chip_why_unusual", { ym }),
                query: t("ai.query_month", { ym, aoi }),
              },
            ]
          : []),
        {
          id: "project",
          label: t("ai.chip_explore_project"),
          query: t("ai.query_explore_project"),
        },
        {
          id: "numbers",
          label: t("ai.chip_explore_numbers"),
          query: t("ai.query_explore_numbers", { aoi }),
        },
        {
          id: "satellite",
          label: t("ai.chip_explore_satellite"),
          query: t("ai.query_explore_satellite"),
        },
      ]
    : [
        ...(ym
          ? [
              {
                id: "month",
                label: t("ai.chip_why_unusual", { ym }),
                query: t("ai.query_month", { ym, aoi }),
              },
            ]
          : []),
        {
          id: "transition",
          label: t("ai.chip_transition"),
          query: t("ai.query_transition"),
        },
        {
          id: "coverage",
          label: t("ai.chip_coverage"),
          query: t("ai.query_coverage", { aoi }),
        },
        {
          id: "calibration",
          label: t("ai.chip_research_calibration"),
          query: t("ai.query_research_calibration"),
        },
        {
          id: "filters",
          label: t("ai.chip_research_filters"),
          query: t("ai.query_research_filters", { aoi }),
        },
      ];

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const turnstileRef = useRef<TurnstileGateHandle>(null);

  /** Human-check failures read as "finish the checkbox", not a raw 403. */
  const chatErrorText = (err: unknown, fallback: (detail: string) => string) => {
    const code = readErrorCode(err);
    if (code === "turnstile_unavailable") return t("turnstile.unavailable");
    if (typeof code === "string" && code.startsWith("turnstile_")) {
      return t("turnstile.retry");
    }
    if (err instanceof ApiError && err.message === BOT_GUARD_CHALLENGE) {
      return t("ai.botguard_expired");
    }
    return fallback(describeError(err));
  };

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
    const isLiveOrRaw =
      data === "raw" ||
      Boolean(effectiveDataset && (effectiveDataset.startsWith("live:") || effectiveDataset.startsWith("upload:")));
    const effectiveMethod =
      isLiveOrRaw && (method === "hts" || method === "stan") ? "stat" : method;
    setInput("");
    setBusy(true);
    try {
      const turnstileToken = (await turnstileRef.current?.solve()) ?? "";
      if (turnstileRef.current?.enabled && !turnstileToken) {
        // Do not burn a request the backend must reject with 403.
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botId
              ? { ...msg, text: t("turnstile.retry"), isStreaming: false }
              : msg,
          ),
        );
        return;
      }
      await api.investigateStream(
        {
          question,
          aoi,
          data,
          method: effectiveMethod,
          year,
          month,
          dataset: effectiveDataset,
          bbox: effectiveBbox,
          mode,
          lang,
          use_llm: true,
          turnstile_token: turnstileToken || undefined,
        },
        {
          onTool: (tool) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botId
                  ? { ...msg, toolCalls: [...(msg.toolCalls || []), tool] }
                  : msg,
              ),
            );
          },
          onMeta: (meta) => {
            const dsParam = effectiveDataset ? `&dataset=${encodeURIComponent(effectiveDataset)}` : "";
            const bboxParam = effectiveBbox ? `&bbox=${encodeURIComponent(effectiveBbox)}` : "";
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botId
                  ? {
                      ...msg,
                      toolCalls: meta.tool_calls?.length ? meta.tool_calls : msg.toolCalls,
                      evidence:
                        meta.tools_used.length > 0
                          ? t("ai.computed_by", { tools: meta.tools_used.join(", ") })
                          : undefined,
                      limitations: meta.limitations?.length ? meta.limitations.join(" ") : undefined,
                      actions: [
                        {
                          label: t("ai.inspect_evidence"),
                          to: `/evidence?aoi=${aoi}&data=${data}${ym ? `&ym=${ym}` : ""}${dsParam}${bboxParam}`,
                        },
                        {
                          label: t("ai.compare_sensor"),
                          to: `/lab?tab=xray&aoi=${aoi}&data=${data}${ym ? `&ym=${ym}` : ""}${dsParam}${bboxParam}`,
                        },
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
                      text: chatErrorText(err, (detail) => t("ai.error_analysis", { error: detail })),
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
                text: chatErrorText(err, (detail) => t("ai.error_could_not_get", { error: detail })),
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
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-slate-400">
                {t("ai.pick_suggested")}
              </p>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                  mode === "explore"
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                    : "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
                )}
              >
                {mode === "explore" ? t("ai.mode_explore_badge") : t("ai.mode_research_badge")}
              </span>
            </div>
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
              {m.toolCalls && m.toolCalls.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pb-1">
                  <Wrench className="h-3 w-3 text-emerald-400 shrink-0" />
                  {m.toolCalls.map((tc, idx) => (
                    <span
                      key={`${tc.name}-${idx}`}
                      title={tc.summary || tc.name}
                      className="rounded border border-emerald-500/30 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-mono text-emerald-200"
                    >
                      {tc.name}
                    </span>
                  ))}
                </div>
              )}
              {m.text && <MarkdownView content={m.text} className="text-xs sm:text-sm text-slate-100" />}
              {m.isStreaming && m.text && (
                <span className="inline-block w-1.5 h-3.5 bg-cyan-400 animate-pulse align-middle" />
              )}
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

      <TurnstileGate ref={turnstileRef} className="flex shrink-0 justify-center px-3 pb-1" />
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
