import { Bot, CheckCircle2, Send, Sparkles, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { MarkdownView } from "@/components/markdown";
import { Msg } from "./types";

interface AskChatViewProps {
  messages: Msg[];
  busy: boolean;
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
}

export function AskChatView({
  messages,
  busy,
  input,
  setInput,
  onSubmit,
}: AskChatViewProps) {
  const { lang } = useLang();
  const vi = lang === "vi";

  return (
    <div className="flex flex-col h-[650px] rounded-2xl border border-border/80 bg-slate-950/90 shadow-card backdrop-blur overflow-hidden animate-fade-in">
      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m, i) => {
          const isUser = m.role === "user";
          return (
            <div
              key={i}
              className={cn("flex gap-3 items-start", isUser ? "flex-row-reverse" : "flex-row")}
            >
              {/* Avatar */}
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border text-xs shadow-sm",
                  isUser
                    ? "border-cyan-500/50 bg-cyan-600/20 text-cyan-300"
                    : "border-orange-500/50 bg-orange-600/20 text-orange-300",
                )}
              >
                {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
              </div>

              {/* Message Bubble */}
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-sm",
                  isUser
                    ? "bg-cyan-600/15 border border-cyan-500/40 text-slate-100 rounded-tr-none"
                    : "bg-slate-900/90 border border-border/70 text-slate-200 rounded-tl-none",
                )}
              >
                {!isUser ? (
                  <MarkdownView content={m.text} />
                ) : (
                  <p className="whitespace-pre-wrap">{m.text}</p>
                )}

                {/* Grounding Attribution Pill */}
                {m.via && (
                  <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center justify-between text-xs text-slate-400 font-mono">
                    <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                      <CheckCircle2 className="h-3 w-3" />
                      <span>{vi ? "Dữ liệu đối chứng thời gian thực" : "Deterministic Grounded"}</span>
                    </span>
                    <span className="bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/60">
                      {m.via}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {busy && (
          <div className="flex gap-3 items-center text-xs text-slate-400 animate-pulse">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-950/40 text-cyan-400">
              <Bot className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-slate-900/80 px-3.5 py-2">
              <Sparkles className="h-3.5 w-3.5 text-cyan-400 animate-spin" />
              <span>{vi ? "Đang trích xuất dữ liệu và suy luận..." : "Synthesizing verified response..."}</span>
            </div>
          </div>
        )}
      </div>

      {/* Input Field Form */}
      <form
        onSubmit={onSubmit}
        className="p-3 border-t border-border/70 bg-slate-900/90 backdrop-blur flex items-center gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            vi
              ? "Đặt câu hỏi về chuẩn hóa cảm biến, dị thường hoặc độ phủ vệ tinh..."
              : "Ask about sensor harmonization, anomaly detection, or orbital coverage..."
          }
          className="flex-1 rounded-xl border border-border/80 bg-slate-950/90 px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-md transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send className="h-3.5 w-3.5" />
          <span className="hidden sm:inline ml-1.5">{vi ? "Gửi" : "Send"}</span>
        </button>
      </form>
    </div>
  );
}
