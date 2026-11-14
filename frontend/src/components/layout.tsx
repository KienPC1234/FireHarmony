import { NavLink, Outlet } from "react-router-dom";
import { Suspense } from "react";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNav } from "@/lib/nav";
import { useLang, type Lang } from "@/lib/i18n";
import { ErrorBoundary } from "@/components/error-boundary";

function LangToggle() {
  const { lang, setLang } = useLang();
  const btn = (l: Lang, label: string) => (
    <button
      key={l}
      onClick={() => setLang(l)}
      aria-pressed={lang === l}
      className={cn("rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
        lang === l ? "bg-orange-600 text-white" : "text-muted-foreground hover:bg-accent")}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-1 rounded-full border px-1 py-0.5" role="group" aria-label="Language / Ngôn ngữ">
      {btn("vi", "VI")}
      {btn("en", "EN")}
    </div>
  );
}

export function Layout() {
  const { nav } = useNav();
  const { t } = useLang();
  return (
    <div className="bg-aurora min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <span className="glow-border flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-red-700 text-white">
            <Flame className="h-5 w-5" />
          </span>
          <div>
            <p className="text-gradient text-base font-extrabold leading-tight">FIRMS Fire Calendar</p>
            <p className="text-xs text-muted-foreground">{t("header.sub")}</p>
          </div>
          <nav className="ml-auto flex items-center gap-1" aria-label="Primary">
            {nav.flatMap((g) => g.items).map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn("flex items-center gap-1.5 rounded-full px-3 py-2 text-sm transition-colors hover:bg-accent",
                    isActive && "bg-accent font-semibold text-foreground shadow-sm")
                }
              >
                <Icon className="h-4 w-4 text-orange-500" aria-hidden="true" />
                <span className="hidden sm:inline">{label}</span>
              </NavLink>
            ))}
            <LangToggle />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <ErrorBoundary>
          <Suspense fallback={<p>Loading…</p>}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
      <footer className="border-t">
        <p className="mx-auto max-w-7xl px-4 py-4 text-xs text-muted-foreground">
          {t("footer.text")}
        </p>
      </footer>
    </div>
  );
}
