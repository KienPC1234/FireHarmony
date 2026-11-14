import { useEffect, useState } from "react";
import { api, describeError } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "bot"; text: string; via?: string };

export function AskPage() {
  const { t, lang } = useLang();
  const SUGS = lang === "vi" ? [
    "Thuật toán harmonization hoạt động thế nào?",
    "Độ chính xác của calendar ra sao?",
    "Giai đoạn nào bất thường?",
  ] : [
    "How does the harmonization algorithm work?",
    "How accurate is the calendar?",
    "Which periods are anomalous?",
  ];
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sugs, setSugs] = useState<string[]>(SUGS);
  const [mode, setMode] = useState<"rule" | "llm">("llm");
  const [llm, setLlm] = useState<{ llm_available: boolean; model: string } | null>(null);
  const [aoi, setAoi] = useState("vietnam");
  const [dsrc, setDsrc] = useState("sample");

  useEffect(() => {
    api.llmStatus().then(setLlm).catch(() => setLlm(null));
  }, []);

  async function send(q: string) {
    const question = q.trim();
    if (!question || loading) return;
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setLoading(true);
    try {
      if (mode === "llm") {
        const r = await api.askLlm(question, { aoi, data: dsrc });
        setMsgs((m) => [...m, {
          role: "bot", text: r.answer,
          via: `${r.llm_used ? `LLM ${r.model}` : "rule-based (Ollama offline)"} · ${aoi}/${dsrc}`,
        }]);
        if (r.suggestions?.length) setSugs(r.suggestions);
      } else {
        const r = await api.ask(question, { aoi, data: dsrc });
        setMsgs((m) => [...m, { role: "bot", text: r.answer, via: `rule-based · ${aoi}/${dsrc}` }]);
        if (r.suggestions?.length) setSugs(r.suggestions);
      }
    } catch (e) {
      setMsgs((m) => [...m, { role: "bot", text: describeError(e) }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">{t("ask.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("ask.desc")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-full border px-1 py-0.5" role="group" aria-label="Answer mode">
          {(["rule", "llm"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
              className={cn("rounded-full px-3 py-1 text-xs font-semibold",
                mode === m ? "bg-orange-600 text-white" : "text-muted-foreground hover:bg-accent")}>
              {m === "rule" ? (lang === "vi" ? "Theo quy tắc" : "Rule-based") : "LLM (Ollama)"}
            </button>
          ))}
        </div>
        <span className="font-mono text-xs text-muted-foreground" role="status">
          {llm ? (llm.llm_available ? `Ollama ✓ ${llm.model}` : "Ollama offline → rule-based") : "…"}
        </span>
        <label className="ml-auto text-xs">AOI
          <select value={aoi} onChange={(e) => setAoi(e.target.value)} className="ml-1 rounded border px-2 py-1">
            {["vietnam", "amazon", "australia"].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="text-xs">data
          <select value={dsrc} onChange={(e) => setDsrc(e.target.value)} className="ml-1 rounded border px-2 py-1">
            <option value="sample">sample</option>
            <option value="raw">raw</option>
          </select>
        </label>
      </div>
      <div className="space-y-2 rounded-lg border p-4" role="log" aria-live="polite" aria-label="Conversation">
        {msgs.length === 0 && <p className="text-sm text-muted-foreground">{t("ask.empty")}</p>}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            <span className={`inline-block max-w-[90%] rounded px-3 py-2 text-sm ${m.role === "user" ? "bg-orange-600 text-white" : "bg-accent"}`}>
              {m.text}
            </span>
            {m.via && <p className="mt-1 font-mono text-[10px] text-muted-foreground">via {m.via} · số liệu verified từ API</p>}
          </div>
        ))}
        {loading && <p className="text-sm text-muted-foreground">{t("ask.thinking")}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {sugs.map((s) => (
          <button key={s} className="rounded border px-2 py-1 text-xs" onClick={() => send(s)}>{s}</button>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} aria-label="Question"
          placeholder={t("ask.placeholder")} className="flex-1 rounded border px-3 py-2" />
        <button className="rounded bg-orange-600 px-4 py-2 text-white" type="submit">{t("ask.send")}</button>
      </form>
    </div>
  );
}
