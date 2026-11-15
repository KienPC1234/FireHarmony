import { useEffect, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  Gauge,
  MessagesSquare,
  Radio,
  Satellite,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { api, describeError, readErrorCode, ApiError, BOT_GUARD_CHALLENGE } from "@/lib/api";
import { applyCustomRegionParams, backendMethod, useResearchContext, type CalibMethod } from "@/lib/researchContext";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { GlobalContextBar } from "@/components/GlobalContextBar";
import { CustomLiveRegionPanel } from "@/components/CustomLiveRegionPanel";
import { SectionQuickNav } from "@/components/common/SectionQuickNav";
import { TurnstileGate, type TurnstileGateHandle } from "@/components/common/TurnstileGate";
import { ReasoningPipelineIllustration } from "@/components/illustrations";
import { MarkdownView } from "@/components/markdown";

interface ToolCallEntry {
  name: string;
  args?: Record<string, unknown>;
  summary?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  finding?: string;
  evidenceText?: string;
  uncertainty?: string;
  actions?: Array<{ label: string; to: string }>;
  toolCalls?: ToolCallEntry[];
  rawText?: string;
  citations?: string[];
  via?: string;
  isStreaming?: boolean;
}

interface TelemetryState {
  zScore: number | null;
  pairedCoverageRatio: number | null;
  kRatio: number | null;
  coDays: number | null;
  coverageClass: string | null;
}

export function InvestigatorPage() {
  const { t, lang } = useLang();
  const { mode } = useResearchContext();

  const [sp, setSp] = useSearchParams();
  const aoi = sp.get("aoi") || "vietnam";
  const data = sp.get("data") || "raw";
  const dataset = sp.get("dataset") || undefined;
  const bbox = sp.get("bbox") || undefined;
  const ymParam = sp.get("ym") || "2025-03";
  const sharedQuery = (() => {
    const p = new URLSearchParams(sp);
    p.set("aoi", aoi);
    p.set("data", data);
    p.set("ym", ymParam);
    return p.toString();
  })();

  const [yearStr, monthStr] = ymParam.split("-");
  const year = parseInt(yearStr, 10) || 2025;
  const month = parseInt(monthStr, 10) || 3;
  const rawMethod = sp.get("method");
  const method = data !== "raw"
    ? "stat"
    : rawMethod && ["stat", "hts", "stan"].includes(rawMethod)
    ? rawMethod
    : backendMethod((rawMethod as CalibMethod) || "stan");
  // Same filter keys as /calendar so telemetry quotes the same cells.
  const qaMin = sp.get("qa_min") || "all";
  const platformSet = sp.get("platform_set") || "all";
  const filterQuery = `qa_min=${qaMin}&platform_set=${platformSet}`;

  const [telemetry, setTelemetry] = useState<TelemetryState | null>(null);
  const [showArchIllustration, setShowArchIllustration] = useState(false);

  useEffect(() => {
    let active = true;
    // Never display telemetry from the previous AOI/month while reloading.
    setTelemetry(null);
    Promise.allSettled([
      api.calendar(25000, undefined, aoi, data, method, undefined, qaMin, platformSet),
      api.blindSpots(aoi, data, year, month, qaMin, platformSet),
    ]).then(([calRes, spotRes]) => {
      if (!active) return;
      let zScore: number | null = null;
      let kRatio: number | null = null;
      if (calRes.status === "fulfilled") {
        const cal = calRes.value;
        const yIdx = cal.calendar.years.indexOf(year);
        const mIdx = cal.calendar.months.indexOf(month);
        if (yIdx >= 0 && mIdx >= 0 && cal.calendar.anomalies[yIdx]?.[mIdx] !== undefined) {
          zScore = cal.calendar.anomalies[yIdx][mIdx];
        }
        const measuredRatio = cal.ratios?.[String(month)];
        kRatio = typeof measuredRatio === "number" && Number.isFinite(measuredRatio)
          ? measuredRatio : null;
      }
      let pairedCoverageRatio: number | null = null;
      let coDays: number | null = null;
      let coverageClass: string | null = null;
      if (spotRes.status === "fulfilled") {
        const spData = spotRes.value;
        pairedCoverageRatio = spData.paired_coverage_ratio;
        coverageClass = spData.coverage_class;
        coDays = spData.status_counts?.both ?? spData.status_counts?.co_observed ?? null;
      }
      setTelemetry({ zScore, pairedCoverageRatio, kRatio, coDays, coverageClass });
    });
    return () => {
      active = false;
    };
  }, [aoi, data, method, year, month, qaMin, platformSet]);

  const promptChips = [
    {
      id: "help-fetch",
      tag: "HELP GUIDE",
      label: t("ai.chip_help_fetch"),
      query: t("ai.query_help_fetch"),
    },
    {
      id: "help-map",
      tag: "UI OPERATIONS",
      label: t("ai.chip_help_map_filters"),
      query: t("ai.query_help_map_filters"),
    },
    {
      id: "help-export",
      tag: "EXPORT & EVIDENCE",
      label: t("ai.chip_help_export"),
      query: t("ai.query_help_export"),
    },
    {
      id: "anomalous",
      tag: "ANOMALY ISOLATION",
      label: t("ai.chip_anomaly"),
      query: t("ai.query_anomaly", { ym: ymParam, aoi: aoi.toUpperCase() }),
    },
    {
      id: "transition",
      tag: "SENSOR DRIFT 2012",
      label: t("ai.chip_transition"),
      query: t("ai.query_transition"),
    },
    {
      id: "coverage",
      tag: "DATA INTEGRITY",
      label: t("ai.chip_coverage"),
      query: t("ai.query_coverage", { aoi: aoi.toUpperCase() }),
    },
  ];

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "intro",
      role: "assistant",
      finding: t("ai.intro_finding"),
      evidenceText: `${aoi.toUpperCase()} · ${ymParam} · Data: ${data.toUpperCase()} · Method: ${method.toUpperCase()}`,
      uncertainty: t("ai.intro_uncertainty"),
      actions: [
        { label: t("ai.view_calendar_btn"), to: `/calendar?aoi=${aoi}&data=${data}&${filterQuery}` },
        { label: t("ai.view_evidence_btn"), to: `/evidence?aoi=${aoi}&data=${data}&ym=${ymParam}&${filterQuery}` },
      ],
      via: "Deterministic Grounding Engine",
    },
  ]);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const streamCtl = useRef<AbortController | null>(null);
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

  // Abort an in-flight stream when leaving the page.
  useEffect(() => () => {
    streamCtl.current?.abort();
  }, []);

  const handleCancel = () => {
    streamCtl.current?.abort();
  };

  const handleSend = async (queryText?: string) => {
    const q = (queryText || input).trim();
    if (!q || busy) return;

    const userMsgId = `user-${Date.now()}`;
    const botMsgId = `bot-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", rawText: q },
      {
        id: botMsgId,
        role: "assistant",
        finding: "",
        isStreaming: true,
        via: "Scientific Grounding Stream",
      },
    ]);
    if (!queryText) setInput("");
    setBusy(true);
    const ctl = new AbortController();
    streamCtl.current = ctl;

    const isLiveOrRaw =
      data === "raw" ||
      Boolean(dataset && (dataset.startsWith("live:") || dataset.startsWith("upload:")));
    const effectiveMethod =
      isLiveOrRaw && (method === "hts" || method === "stan") ? "stat" : method;
    try {
      const turnstileToken = (await turnstileRef.current?.solve()) ?? "";
      if (turnstileRef.current?.enabled && !turnstileToken) {
        // Do not burn a request the backend must reject with 403.
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMsgId
              ? { ...msg, rawText: t("turnstile.retry"), isStreaming: false }
              : msg,
          ),
        );
        return;
      }
      await api.investigateStream(
        {
          question: q,
          aoi,
          data,
          method: effectiveMethod,
          year,
          month,
          use_llm: true,
          qa_min: qaMin,
          platform_set: platformSet,
          bbox,
          dataset,
          mode,
          lang,
          turnstile_token: turnstileToken || undefined,
        },
        {
          onStatus: (st) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botMsgId ? { ...msg, via: st.detail } : msg,
              ),
            );
          },
          onTool: (tool) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botMsgId
                  ? { ...msg, toolCalls: [...(msg.toolCalls || []), tool] }
                  : msg,
              ),
            );
          },
          onMeta: (meta) => {
            const dsParam = dataset ? `&dataset=${encodeURIComponent(dataset)}` : "";
            const bboxParam = bbox ? `&bbox=${encodeURIComponent(bbox)}` : "";
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botMsgId
                  ? {
                      ...msg,
                      toolCalls: meta.tool_calls?.length ? meta.tool_calls : msg.toolCalls,
                      evidenceText: meta.evidence
                        ? t("ai.derived_fields", {
                            count: Object.keys(meta.evidence).length,
                            tools: meta.tools_used.join(", "),
                          })
                        : t("ai.derived_verified"),
                      uncertainty: meta.limitations?.length ? meta.limitations.join(" ") : undefined,
                      actions: [
                        { label: t("ai.view_calendar_btn"), to: `/calendar?aoi=${aoi}&data=${data}${dsParam}${bboxParam}` },
                        { label: t("ai.view_lab_btn"), to: `/lab?tab=xray&aoi=${aoi}&data=${data}${dsParam}${bboxParam}` },
                        { label: t("ai.view_evidence_btn"), to: `/evidence?aoi=${aoi}&data=${data}&ym=${ymParam}${dsParam}${bboxParam}` },
                      ],
                    }
                  : msg,
              ),
            );
          },
          onDelta: (delta) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botMsgId
                  ? {
                      ...msg,
                      finding: (msg.finding || "") + delta,
                    }
                  : msg,
              ),
            );
          },
          onDone: (fullAnswer) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botMsgId
                  ? {
                      ...msg,
                      finding: fullAnswer || msg.finding,
                      via: "Tool Agent · gemma4:cloud",
                      isStreaming: false,
                    }
                  : msg,
              ),
            );
          },
          onError: (err) => {
            if ((err as { name?: string })?.name === "AbortError") return;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botMsgId
                  ? {
                      ...msg,
                      rawText: chatErrorText(err, (detail) => t("ai.conn_error", { err: detail })),
                      isStreaming: false,
                    }
                  : msg,
              ),
            );
          },
        },
        ctl.signal,
      );
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMsgId ? { ...msg, isStreaming: false } : msg,
          ),
        );
      } else {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMsgId
              ? {
                  ...msg,
                  rawText: chatErrorText(err, (detail) => t("ai.engine_note", { err: detail })),
                  isStreaming: false,
                }
              : msg,
          ),
        );
      }
    } finally {
      if (streamCtl.current === ctl) streamCtl.current = null;
      setBusy(false);
    }
  };

  const zVal = telemetry?.zScore ?? null;
  const isExtreme = zVal !== null && zVal >= 2.0;
  const isElevated = zVal !== null && zVal >= 1.0 && zVal < 2.0;
  const gaugeColor = zVal === null
    ? "bg-slate-500"
    : isExtreme
    ? "bg-rose-500"
    : isElevated
    ? "bg-amber-500"
    : "bg-emerald-500";
  const gaugeTextColor = zVal === null
    ? "text-slate-300"
    : isExtreme
    ? "text-rose-400"
    : isElevated
    ? "text-amber-400"
    : "text-emerald-400";

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto w-full space-y-6 pb-24">
      {/* 1. Top Header Banner */}
      <div data-enter className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-[#111C2E] p-4 sm:p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-950/60 shadow-sm">
            <MessagesSquare className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                {t("ai.title")}
              </h1>
              <span className="font-mono text-xs font-semibold uppercase px-2.5 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                {t("ai.badge")}
              </span>
            </div>
            <p className="text-xs text-slate-300">
              {t("ai.desc")}
            </p>
          </div>
        </div>

        {/* Action Link to Evidence */}
        <Link
          to={`/evidence?${sharedQuery}`}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-200 transition min-h-[40px]"
        >
          <FileCheck2 className="h-4 w-4 text-cyan-400" />
          <span>{t("ai.month_evidence")}</span>
        </Link>
      </div>

      {/* 2. Global Context Bar */}
      <div data-tour="ai-context">
        <GlobalContextBar />
      </div>
      {aoi === "custom" && (
        <CustomLiveRegionPanel
          bbox={bbox}
          geometry={sp.get("geometry")}
          dataset={dataset}
          fromDateProp={sp.get("from_date")}
          toDateProp={sp.get("to_date")}
          onLoaded={(payload) => setSp((prev) => applyCustomRegionParams(prev, payload), { replace: true })}
        />
      )}
      <SectionQuickNav title={t("ai.title")}
        items={[
          { id: "ai-questions", label: t("ai.chip_anomaly") },
          { id: "ai-conversation", label: t("ai.title") },
          { id: "ai-telemetry", label: t("ai.telemetry_nav") },
        ]}
      />

      {/* 3. Main 2-Panel Layout (Chat 60% vs Grounding Telemetry Stack 40%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Chat Stream & Interactive Scenarios (7 cols on lg = ~58%) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Context-driven Inquiries: Visual Cards */}
          <div id="ai-questions" data-tour="ai-prompts" className="scroll-mt-16 space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {t("ai.context_inquiries")}
              </span>
              <span className="text-xs font-mono text-cyan-400">3 Presets</span>
            </div>

            <div className="flex snap-x gap-2.5 overflow-x-auto sm:grid sm:grid-cols-3">
              {promptChips.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy}
                  onClick={() => handleSend(p.query)}
                  className="rounded-xl border border-slate-700/80 bg-slate-900/90 hover:border-cyan-500/50 hover:bg-slate-850 p-3 text-left transition disabled:opacity-50 min-h-[72px] flex flex-col justify-between group"
                >
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-400 group-hover:text-cyan-300">
                    {p.tag}
                  </span>
                  <span className="text-xs font-medium text-slate-200 group-hover:text-white leading-snug line-clamp-2">
                    {p.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Conversation Stream Container */}
          <div id="ai-conversation" role="log" aria-label={t("ai.title")}
            className="scroll-mt-16 rounded-2xl border border-slate-800 bg-[#111C2E] p-4 sm:p-5 shadow-sm space-y-4 min-h-[360px] max-h-[580px] overflow-y-auto">
            {messages.map((m) => {
              const isUser = m.role === "user";
              return (
                <div
                  key={m.id}
                  className={cn(
                    "rounded-xl p-4 space-y-3 text-xs leading-relaxed",
                    isUser
                      ? "ml-8 sm:ml-12 border border-cyan-500/30 bg-cyan-950/20 text-cyan-100"
                      : "mr-4 sm:mr-8 border border-slate-800 bg-slate-900/80 text-slate-200",
                  )}
                >
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-xs font-mono">
                    <span className="font-bold text-slate-400 uppercase flex items-center gap-1.5">
                      {isUser ? (
                        <>
                          <Radio className="h-3.5 w-3.5 text-cyan-400" />
                          <span>{t("ai.user_query")}</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                          <span>{t("ai.bot_name")}</span>
                        </>
                      )}
                    </span>
                    {m.via && <span className="text-cyan-400">{m.via}</span>}
                  </div>

                  {m.rawText && <p className="text-sm text-slate-200">{m.rawText}</p>}

                  {/* 4-Part Structured Response Template */}
                  {m.isStreaming && !m.finding && (
                    <div className="flex items-center gap-2 text-cyan-300 text-xs font-mono py-2">
                      <div className="h-3.5 w-3.5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                      <span>{t("ai.streaming_status")}</span>
                    </div>
                  )}

                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold text-emerald-300">
                        <Wrench className="h-3.5 w-3.5 text-emerald-400" />
                        <span>{t("ai.tools_called_heading")}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {m.toolCalls.map((tc, idx) => {
                          const argStr =
                            tc.args && Object.keys(tc.args).length > 0
                              ? `(${Object.entries(tc.args)
                                  .map(([k, v]) => `${k}=${String(v)}`)
                                  .join(", ")})`
                              : "()";
                          return (
                            <span
                              key={`${tc.name}-${idx}`}
                              title={tc.summary || tc.name}
                              className="inline-flex flex-wrap items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-950/40 px-2.5 py-1 text-[11px] font-mono text-emerald-200"
                            >
                              <span className="font-semibold text-emerald-300">{`${tc.name}${argStr}`}</span>
                              {tc.summary && (
                                <span className="text-emerald-200/80">
                                  · {tc.summary}
                                </span>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {m.finding && (
                    <div className="space-y-1.5">
                      <div className="font-bold text-white text-sm flex items-center gap-2">
                        <span>{t("ai.finding_heading")}</span>
                      </div>
                      <MarkdownView content={m.finding} className="text-xs sm:text-sm text-slate-200" />
                      {m.isStreaming && (
                        <span className="inline-block w-1.5 h-3.5 bg-cyan-400 animate-pulse align-middle" />
                      )}
                    </div>
                  )}

                  {m.evidenceText && (
                    <div className="space-y-1 pt-2 border-t border-slate-800">
                      <div className="font-bold text-cyan-300 text-xs flex items-center gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
                        <span>{t("ai.evidence_heading")}</span>
                      </div>
                      <p className="font-mono text-xs text-slate-300 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                        {m.evidenceText}
                      </p>
                    </div>
                  )}

                  {m.uncertainty && (
                    <div className="space-y-1 pt-2 border-t border-slate-800">
                      <div className="font-bold text-amber-300 text-xs flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-amber-400" />
                        <span>{t("ai.uncertainty_heading")}</span>
                      </div>
                      <p className="text-slate-400 text-xs leading-relaxed">{m.uncertainty}</p>
                    </div>
                  )}

                  {m.actions && m.actions.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-slate-800">
                      <div className="font-bold text-slate-300 text-xs">
                        {t("ai.actions_heading")}
                      </div>
                      <div className="flex flex-wrap gap-2 pt-0.5">
                        {m.actions.map((act) => (
                          <Link
                            key={act.to}
                            to={act.to}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-slate-700 hover:text-white transition min-h-[34px]"
                          >
                            <span>{act.label}</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Input Bar — Turnstile only renders on public/tunnelled traffic */}
          <TurnstileGate ref={turnstileRef} className="flex justify-center px-1 pb-1" />
          <form
            data-tour="ai-input-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="sticky bottom-2 z-10 flex items-center gap-2 rounded-xl border border-slate-800 bg-[#0B1220]/95 p-2 shadow-xl backdrop-blur-md"
          >
            <input
              aria-label={t("ai.input_placeholder")}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("ai.input_placeholder")}
              disabled={busy}
              className="flex-1 rounded-xl border border-slate-700 bg-[#111C2E] px-4 py-3 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none min-h-[44px]"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-orange-600 hover:bg-orange-500 px-5 py-3 text-xs font-bold text-white shadow-sm transition disabled:opacity-50 min-h-[44px]"
            >
              <span>{t("ai.btn_send")}</span>
              <Send className="h-4 w-4" />
            </button>
            {busy && (
              <button
                type="button"
                onClick={handleCancel}
                className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-xs font-bold text-slate-200 hover:text-white transition min-h-[44px]"
              >
                {t("common.cancel")}
              </button>
            )}
          </form>
        </div>

        {/* Right Column: Live Telemetry & Scientific Grounding Stack (5 cols on lg = ~42%) */}
        <div id="ai-telemetry" className="lg:col-span-5 min-w-0 space-y-4 scroll-mt-16">
          {/* Card 1: Monthly Anomaly Meter & Telemetry Gauge */}
          <div className="rounded-2xl border border-slate-800 bg-[#111C2E] p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-cyan-400" />
                <h2 className="text-xs font-mono font-bold text-white uppercase tracking-wider">
                  {t("ai.telemetry_inspector_title")}
                </h2>
              </div>
              <span className="font-mono text-xs text-cyan-400 bg-cyan-950/40 border border-cyan-500/30 px-2 py-0.5 rounded">
                {ymParam}
              </span>
            </div>

            {/* Anomaly Gauge Section */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300 font-medium">
                  {t("ai.anomaly_meter_title")}
                </span>
                <span className={cn("text-xs font-mono font-bold", gaugeTextColor)}>
                  {zVal !== null ? `Z = ${zVal > 0 ? "+" : ""}${zVal.toFixed(2)}` : "Z = N/A"}
                </span>
              </div>

              {/* Gauge Bar */}
              <div className="space-y-1.5">
                <div className="h-3 w-full rounded-full bg-slate-800 overflow-hidden flex">
                  <div className="h-full bg-emerald-500/30 border-r border-slate-700 w-1/3" title="Normal: -2 to +1" />
                  <div className="h-full bg-amber-500/30 border-r border-slate-700 w-1/3" title="Elevated: +1 to +2" />
                  <div className="h-full bg-rose-500/30 w-1/3" title="Extreme: > +2" />
                </div>
                {/* Visual marker position */}
                <div className="flex justify-between text-[10px] font-mono text-slate-400 px-0.5">
                  <span>-2.0</span>
                  <span>+1.0</span>
                  <span>+2.0</span>
                  <span>+4.0</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <div className={cn("h-2.5 w-2.5 rounded-full shrink-0", gaugeColor)} />
                <span className="text-xs text-slate-300 font-mono">
                  {zVal === null
                    ? t("common.unknown")
                    : isExtreme
                    ? t("ai.anomaly_extreme")
                    : isElevated
                    ? t("ai.anomaly_elevated")
                    : t("ai.anomaly_normal")}
                </span>
              </div>
            </div>

            {/* Numerical Facts */}
            <div className="space-y-2.5 font-mono text-xs">
              <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                <span className="text-slate-400 font-sans">{t("ai.study_area")}</span>
                <span className="text-white font-bold">{aoi.toUpperCase()}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                <span className="text-slate-400 font-sans">{t("ai.k_ratio_label")}</span>
                <span className="text-cyan-300 font-bold">
                  {telemetry?.kRatio !== null && telemetry?.kRatio !== undefined
                    ? telemetry.kRatio.toFixed(2) + "x"
                    : t("common.unknown")}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                <span className="text-slate-400 font-sans">{t("ai.co_days_label")}</span>
                <span className="text-teal-300 font-bold">
                  {telemetry?.coDays !== null && telemetry?.coDays !== undefined
                    ? `${telemetry.coDays} days`
                    : t("common.unknown")}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                <span className="text-slate-400 font-sans">{t("ai.integrity_status")}</span>
                <span className="text-emerald-400 font-bold">
                  {telemetry?.coverageClass
                    ? telemetry.coverageClass.toUpperCase()
                    : t("common.unknown")}
                </span>
              </div>
            </div>

            {/* Constellation Orbit Status */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 block">
                {t("ai.active_constellation")}
              </span>
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                <div className="rounded border border-blue-500/30 bg-blue-950/20 px-2.5 py-1.5 text-blue-300">
                  Terra (10:30 LT)
                </div>
                <div className="rounded border border-blue-500/30 bg-blue-950/20 px-2.5 py-1.5 text-blue-300">
                  Aqua (13:30 LT)
                </div>
                <div className="rounded border border-teal-500/30 bg-teal-950/20 px-2.5 py-1.5 text-teal-300">
                  S-NPP (13:30 LT)
                </div>
                <div className="rounded border border-teal-500/30 bg-teal-950/20 px-2.5 py-1.5 text-teal-300">
                  NOAA-20 / 21
                </div>
              </div>
            </div>

            {/* Grounding Architecture Diagram Toggle */}
            <div className="pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowArchIllustration(!showArchIllustration)}
                className="w-full flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/80 p-3 text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-white transition"
              >
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-cyan-400" />
                  <span>{t("ai.grounding_architecture")}</span>
                </div>
                {showArchIllustration ? (
                  <ChevronUp className="h-4 w-4 text-slate-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                )}
              </button>

              {showArchIllustration && (
                <div className="mt-3">
                  <ReasoningPipelineIllustration />
                </div>
              )}
            </div>

            {/* Direct Deep Link Actions */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <Link
                to={`/calendar?${sharedQuery}`}
                className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/80 p-3 text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-white transition min-h-[44px]"
              >
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-cyan-400" />
                  <span>{t("ai.inspect_calendar")}</span>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-500" />
              </Link>

              <Link
                to={`/lab?tab=xray&${sharedQuery}&${filterQuery}`}
                className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/80 p-3 text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-white transition min-h-[44px]"
              >
                <div className="flex items-center gap-2">
                  <Satellite className="h-4 w-4 text-orange-400" />
                  <span>{t("ai.compare_sensor")}</span>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-500" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
