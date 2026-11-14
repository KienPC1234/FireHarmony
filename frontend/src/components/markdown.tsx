import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownViewProps {
  content: string;
  className?: string;
}

export function MarkdownView({ content, className }: MarkdownViewProps) {
  if (!content) return null;

  return (
    <div className={cn("text-xs md:text-sm text-slate-200 space-y-2 leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ ...props }) => (
            <h1 className="text-base font-extrabold text-white mt-3 mb-1.5" {...props} />
          ),
          h2: ({ ...props }) => (
            <h2 className="text-sm font-bold text-white mt-3 mb-1" {...props} />
          ),
          h3: ({ ...props }) => (
            <h3 className="text-xs font-bold text-cyan-300 mt-2 mb-1" {...props} />
          ),
          p: ({ ...props }) => (
            <p className="my-1 text-slate-200 leading-relaxed" {...props} />
          ),
          ul: ({ ...props }) => (
            <ul className="my-1.5 list-disc pl-5 space-y-0.5 text-slate-300" {...props} />
          ),
          ol: ({ ...props }) => (
            <ol className="my-1.5 list-decimal pl-5 space-y-0.5 text-slate-300" {...props} />
          ),
          li: ({ ...props }) => <li className="leading-relaxed" {...props} />,
          strong: ({ ...props }) => (
            <strong className="font-semibold text-white" {...props} />
          ),
          code: ({ className, children, ...props }) => {
            const isInline = !className;
            return isInline ? (
              <code
                className="rounded bg-slate-800/90 px-1.5 py-0.5 font-mono text-xs text-cyan-300 border border-slate-700/60"
                {...props}
              >
                {children}
              </code>
            ) : (
              <pre className="my-2.5 overflow-x-auto rounded-lg border border-slate-700/80 bg-slate-950 p-3 font-mono text-xs text-slate-200">
                <code className={className} {...props}>
                  {children}
                </code>
              </pre>
            );
          },
          blockquote: ({ ...props }) => (
            <blockquote
              className="my-2 border-l-2 border-cyan-500 bg-cyan-950/20 px-3 py-1.5 text-xs text-slate-300 rounded-r"
              {...props}
            />
          ),
          a: ({ ...props }) => (
            <a
              className="text-cyan-400 underline underline-offset-2 hover:text-cyan-300"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),
          table: ({ ...props }) => (
            <div className="my-2.5 overflow-x-auto rounded-lg border border-slate-700/70">
              <table className="w-full text-left text-xs border-collapse" {...props} />
            </div>
          ),
          th: ({ ...props }) => (
            <th className="bg-slate-900 p-2 font-semibold text-slate-200 border-b border-slate-700" {...props} />
          ),
          td: ({ ...props }) => (
            <td className="p-2 border-b border-slate-800 text-slate-300 font-mono" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
