import type { MouseEvent } from "react";
/** Page-local navigation through long research results. Does not modify the URL
 * filters, network requests, experiment state, or browser history.
 */
interface SectionItem {
  id: string;
  label: string;
}

export function SectionQuickNav({ title, items }: { title: string; items: SectionItem[] }) {
  const onAnchorClick = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const section = document.getElementById(id);
    if (section) {
      event.preventDefault();
      section.scrollIntoView({ behavior: "auto", block: "start" });
    }
    // Native disclosure is keyboard/assistive-tech operable, with no custom
    // JS state and no stale visible dropdown after anchor navigation.
    event.currentTarget.closest("details")?.removeAttribute("open");
  };

  return (
    <nav aria-label={title}
      className="sticky top-0 z-20 -mx-1 rounded-xl border border-slate-800/90 bg-[#0B1220]/95 px-3 py-2 shadow-lg backdrop-blur-md">
      <details data-testid="section-quicknav-mobile" className="sm:hidden">
        <summary className="min-h-[40px] cursor-pointer rounded-lg border border-slate-700/70 bg-[#121E31] px-3 py-2 text-xs font-semibold text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
          {title} ({items.length})
        </summary>
        <div className="mt-2 grid min-w-0 gap-1.5" role="group">
          {items.map((item, index) => (
            <a key={item.id} href={"#" + item.id}
              onClick={(event) => onAnchorClick(event, item.id)}
              className="flex min-h-[40px] min-w-0 items-center gap-2 rounded-lg border border-slate-700/70 bg-[#121E31] px-3 py-2 text-left text-xs font-semibold text-slate-200 hover:border-cyan-500/50 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
              <span aria-hidden="true" className="shrink-0 font-mono text-[11px] text-cyan-400">{String(index + 1).padStart(2, "0")}</span>
              <span className="min-w-0 break-words">{item.label}</span>
            </a>
          ))}
        </div>
      </details>
      <div className="hidden items-center gap-3 sm:flex">
        <span className="hidden shrink-0 text-[11px] font-bold uppercase tracking-widest text-slate-500 sm:inline">
          {title}
        </span>
        <div className="flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto pb-0.5" role="group">
          {items.map((item, index) => (
            <a key={item.id} href={"#" + item.id}
              onClick={(event) => onAnchorClick(event, item.id)}
              className="flex min-h-[36px] shrink-0 snap-start items-center gap-2 rounded-lg border border-slate-700/70 bg-[#121E31] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-cyan-500/50 hover:bg-cyan-500/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400">
              <span aria-hidden="true" className="font-mono text-[11px] text-cyan-400">{String(index + 1).padStart(2, "0")}</span>
              {item.label}
            </a>
          ))}
        </div>
      </div>
    </nav>
  );
}
