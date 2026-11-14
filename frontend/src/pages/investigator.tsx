import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  FileCheck2,
  MessagesSquare,
  Satellite,
  Send,
} from "lucide-react";
import { api, describeError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { GlobalContextBar } from "@/components/GlobalContextBar";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  finding?: string;
  evidenceText?: string;
  uncertainty?: string;
  actions?: Array<{ label: string; to: string }>;
  rawText?: string;
  citations?: string[];
  via?: string;
  isStreaming?: boolean;
}

export function InvestigatorPage() {
  const { lang, t } = useLang();
  const vi = lang === "vi";

  const [sp] = useSearchParams();
  const aoi = sp.get("aoi") || "vietnam";
  const data = sp.get("data") || "sample";
  const ymParam = sp.get("ym") || "2025-03";

  const [yearStr, monthStr] = ymParam.split("-");
  const year = parseInt(yearStr, 10) || 2025;
  const month = parseInt(monthStr, 10) || 3;
  const method = "stat"; // SensorFormer anchor-only (residual gate OFF)

  // 3 context-driven prompt chips
  const promptChips = [
    {
      id: "anomalous",
      label: vi ? "Vì sao tháng này bất thường?" : "Why is this month anomalous?",
      query: vi
        ? `Vì sao tháng ${ymParam} tại khu vực ${aoi} được xếp loại là bất thường trên calendar?`
        : `Why is ${ymParam} in ${aoi} classified as an anomalous fire month?`,
    },
    {
      id: "transition",
      label: vi ? "Bước nhảy 2012 do sensor hay do cháy?" : "2012 jump: sensor or real fire?",
      query: vi
        ? "Bước nhảy số điểm nóng năm 2012 là do đám cháy gia tăng hay do sự chuyển đổi từ MODIS sang VIIRS?"
        : "Is the 2012 surge in hotspots caused by actual wildfire expansion or the MODIS to VIIRS transition?",
    },
    {
      id: "coverage",
      label: vi ? "Tháng nào thiếu dữ liệu đối chiếu?" : "Which months lack paired coverage?",
      query: vi
        ? `Những giai đoạn nào tại ${aoi} chưa đủ độ phủ đối chiếu song song giữa hai cảm biến?`
        : `Which periods in ${aoi} have insufficient paired observation coverage?`,
    },
  ];

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "intro",
      role: "assistant",
      finding: vi
        ? "Chào mừng đến với AI Scientific Investigator. Mọi số liệu và suy luận ở đây được gắn chặt với dữ liệu quan sát MODIS và VIIRS đã kiểm chứng, không tự sinh số liệu giả."
        : "Welcome to the AI Scientific Investigator. All findings and figures are grounded in verified MODIS and VIIRS telemetry without hallucinated values.",
      evidenceText: `${aoi.toUpperCase()} · ${ymParam} · Data: ${data.toUpperCase()} · Method: ${method.toUpperCase()}`,
      uncertainty: vi
        ? "Điểm nóng là phát hiện nhiệt vệ tinh, không đồng nhất trực tiếp với số vụ cháy hay diện tích cháy thực tế."
        : "Hotspots represent thermal detections, not individual ground fires or total burned area.",
      actions: [
        { label: vi ? "Xem trong Calendar" : "View in Calendar", to: `/calendar?aoi=${aoi}&data=${data}` },
        { label: vi ? "Kiểm tra bằng chứng" : "Inspect Evidence", to: `/evidence?aoi=${aoi}&data=${data}&ym=${ymParam}` },
      ],
      via: "Deterministic Grounding Engine",
    },
  ]);

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

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

    try {
      await api.investigateStream(
        {
          question: q,
          aoi,
          data,
          method,
          year,
          month,
          use_llm: false,
        },
        {
          onMeta: (meta) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botMsgId
                  ? {
                      ...msg,
                      evidenceText: meta.evidence
                        ? vi
                          ? `Dẫn xuất từ ${Object.keys(meta.evidence).length} trường dữ liệu kiểm toán qua công cụ [${meta.tools_used.join(", ")}].`
                          : `Derived from ${Object.keys(meta.evidence).length} audit fields via tools [${meta.tools_used.join(", ")}].`
                        : vi
                        ? `Xác thực từ dữ liệu viễn thám chuẩn hóa.`
                        : `Verified from standardized telemetry observations.`,
                      uncertainty: meta.limitations?.length ? meta.limitations.join(" ") : undefined,
                      actions: [
                        { label: vi ? "Xem trong Calendar" : "View in Calendar", to: `/calendar?aoi=${aoi}&data=${data}` },
                        { label: vi ? "Đối soát trong Sensor Lab" : "Sensor Lab", to: `/lab?tab=xray&aoi=${aoi}&data=${data}` },
                        { label: vi ? "Xem sổ chứng cứ" : "Evidence Ledger", to: `/evidence?aoi=${aoi}&data=${data}&ym=${ymParam}` },
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
                      isStreaming: false,
                    }
                  : msg,
              ),
            );
          },
          onError: (err) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botMsgId
                  ? {
                      ...msg,
                      rawText: vi
                        ? `Lỗi kết nối phân tích: ${describeError(err)}.`
                        : `Analysis connection note: ${describeError(err)}.`,
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
          msg.id === botMsgId
            ? {
                ...msg,
                rawText: vi
                  ? `Hệ thống phân tích: ${describeError(err)}. Nhấp vào các liên kết bên phải để xem trực tiếp số liệu tính toán.`
                  : `Analysis engine note: ${describeError(err)}. Use the evidence stack on the right to inspect computed metrics directly.`,
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
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto w-full space-y-6 pb-24">
      {/* 1. Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-[#111C2E] p-4 sm:p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-950/60 shadow-sm">
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
          to={`/evidence?aoi=${aoi}&data=${data}&ym=${ymParam}`}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-200 transition min-h-[40px]"
        >
          <FileCheck2 className="h-4 w-4 text-cyan-400" />
          <span>{t("ai.month_evidence")}</span>
        </Link>
      </div>

      {/* 2. Global Context Bar */}
      <GlobalContextBar />

      {/* 3. Main 2-Panel Layout (Chat 60% vs Evidence Stack 40%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Chat Stream & Prompts (7 cols on lg = ~60%) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Context-driven Prompt Chips (Exactly 3) */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-400 px-1">
              {t("ai.context_inquiries")}
            </span>
            <div className="flex flex-wrap gap-2">
              {promptChips.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy}
                  onClick={() => handleSend(p.query)}
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-cyan-500/40 hover:text-white transition disabled:opacity-50 min-h-[38px] text-left"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Conversation Stream Container */}
          <div className="rounded-2xl border border-slate-800 bg-[#111C2E] p-4 sm:p-5 shadow-sm space-y-4 min-h-[460px] max-h-[580px] overflow-y-auto">
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
                    <span className="font-bold text-slate-400 uppercase">
                      {isUser ? t("ai.user_query") : t("ai.bot_name")}
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

                  {m.finding && (
                    <div className="space-y-1">
                      <div className="font-bold text-white text-sm">
                        {t("ai.finding_heading")}
                      </div>
                      <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
                        {m.finding}
                        {m.isStreaming && (
                          <span className="inline-block w-1.5 h-3.5 ml-1 bg-cyan-400 animate-pulse align-middle" />
                        )}
                      </p>
                    </div>
                  )}

                  {m.evidenceText && (
                    <div className="space-y-1 pt-2 border-t border-slate-800">
                      <div className="font-bold text-cyan-300 text-xs">
                        {t("ai.evidence_heading")}
                      </div>
                      <p className="font-mono text-xs text-slate-300 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                        {m.evidenceText}
                      </p>
                    </div>
                  )}

                  {m.uncertainty && (
                    <div className="space-y-1 pt-2 border-t border-slate-800">
                      <div className="font-bold text-amber-300 text-xs">
                        {t("ai.uncertainty_heading")}
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

          {/* Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2"
          >
            <input
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
          </form>
        </div>

        {/* Right Column: Active Evidence Stack (5 cols on lg = ~40%) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-[#111C2E] p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileCheck2 className="h-4 w-4 text-cyan-400" />
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                  {t("ai.evidence_ledger_title")}
                </h2>
              </div>
              <span className="font-mono text-xs text-slate-400">
                {ymParam}
              </span>
            </div>

            {/* Context Facts Summary */}
            <div className="space-y-3 font-mono text-xs">
              <div className="flex justify-between items-center py-1.5 border-b border-slate-800/60">
                <span className="text-slate-400 font-sans">{t("ai.study_area")}</span>
                <span className="text-white font-bold">{aoi.toUpperCase()}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-slate-800/60">
                <span className="text-slate-400 font-sans">{t("ai.data_feed")}</span>
                <span className="text-amber-300 font-bold">{data.toUpperCase()}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-slate-800/60">
                <span className="text-slate-400 font-sans">{t("ai.harmonization")}</span>
                <span className="text-purple-300 font-bold">{method.toUpperCase()} Baseline</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-slate-800/60">
                <span className="text-slate-400 font-sans">{t("ai.integrity_status")}</span>
                <span className="text-emerald-400 font-bold">Standard Archive</span>
              </div>
            </div>

            {/* Quick Diagnostic Insights */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2 text-xs">
              <span className="font-bold text-white block">
                {t("ai.reasoning_title")}
              </span>
              <ul className="space-y-1.5 text-slate-300 list-disc pl-4 leading-relaxed">
                <li>{t("ai.rule1")}</li>
                <li>{t("ai.rule2")}</li>
                <li>{t("ai.rule3")}</li>
              </ul>
            </div>

            {/* Direct Deep Link Actions */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <Link
                to={`/calendar?aoi=${aoi}&data=${data}`}
                className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900/80 p-3 text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-white transition min-h-[44px]"
              >
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-cyan-400" />
                  <span>{t("ai.inspect_calendar")}</span>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-500" />
              </Link>

              <Link
                to={`/lab?tab=xray&aoi=${aoi}&data=${data}`}
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
