import { NavLink, Outlet } from "react-router-dom";
import { Suspense } from "react";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNav } from "@/lib/nav";
import { ErrorBoundary } from "@/components/error-boundary";

export function Layout() {
  const { nav } = useNav();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-600 text-white">
            <Flame className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-bold leading-tight">FIRMS Fire Calendar</p>
            <p className="text-xs text-muted-foreground">MODIS + VIIRS harmonized hot spots</p>
          </div>
          <nav className="ml-auto flex gap-1" aria-label="Primary">
            {nav.flatMap((g) => g.items).map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn("rounded-md px-3 py-2 text-sm hover:bg-accent",
                    isActive && "bg-accent font-semibold")
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <ErrorBoundary>
          <Suspense fallback={<p>Loading…</p>}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
