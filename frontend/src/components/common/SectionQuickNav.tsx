/** Page-local navigation through long research results. Does not modify the URL
 * filters, network requests, experiment state, or browser history.
 */
interface SectionItem {
  id: string;
  label: string;
}

export function SectionQuickNav({ title, items }: { title: string; items: SectionItem[] }) {
  return (
    <nav aria-label={title}
      className="sticky top-0 z-20 -mx-1 rounded-xl border border-slate-800/90 bg-[#0B1220]/95 px-3 py-2 shadow-lg backdrop-blur-md">
      <div className="flex items-center gap-3">
        <span className="hidden shrink-0 text-[11px] font-bold uppercase tracking-widest text-slate-500 sm:inline">
          {title}
        </span>
        <div className="flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto pb-0.5" role="group">
          {items.map((item, index) => (
            <a key={item.id} href={"#" + item.id}
              onClick={(event) => {
                const section = document.getElementById(item.id);
                if (section) {
                  event.preventDefault();
                  section.scrollIntoView({ behavior: "auto", block: "start" });
                }
              }}
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
