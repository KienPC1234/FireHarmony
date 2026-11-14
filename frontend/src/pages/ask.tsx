import { useState } from "react";
import { api, describeError } from "@/lib/api";

type Msg = { role: "user" | "bot"; text: string };

export function AskPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sugs, setSugs] = useState<string[]>([
    "Thuật toán harmonization hoạt động thế nào?",
    "Độ chính xác của calendar ra sao?",
    "Giai đoạn nào cháy mạnh bất thường?",
  ]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || loading) return;
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setLoading(true);
    try {
      const r = await api.ask(question);
      setMsgs((m) => [...m, { role: "bot", text: r.answer }]);
      if (r.suggestions?.length) setSugs(r.suggestions);
    } catch (e) {
      setMsgs((m) => [...m, { role: "bot", text: describeError(e) }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">Hỏi đáp về harmonization</h1>
      <p className="text-sm text-muted-foreground">
        Trợ lý offline: mọi con số đều tính live từ dữ liệu (không bịa).
        Hỏi về thuật toán, dữ liệu, độ chính xác, anomaly, mô hình DL.
      </p>
      <div className="space-y-2 rounded-lg border p-4" role="log" aria-live="polite" aria-label="Hội thoại">
        {msgs.length === 0 && <p className="text-sm text-muted-foreground">Chưa có câu hỏi — bấm gợi ý bên dưới để bắt đầu.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            <span className={`inline-block max-w-[90%] rounded px-3 py-2 text-sm ${m.role === "user" ? "bg-orange-600 text-white" : "bg-accent"}`}>
              {m.text}
            </span>
          </div>
        ))}
        {loading && <p className="text-sm text-muted-foreground">Đang tính toán…</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {sugs.map((s) => (
          <button key={s} className="rounded border px-2 py-1 text-xs" onClick={() => send(s)}>{s}</button>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} aria-label="Câu hỏi"
          placeholder="VD: Độ chính xác của calendar ra sao?" className="flex-1 rounded border px-3 py-2" />
        <button className="rounded bg-orange-600 px-4 py-2 text-white" type="submit">Hỏi</button>
      </form>
    </div>
  );
}
