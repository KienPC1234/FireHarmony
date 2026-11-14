import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Suspense, useEffect, useState } from "react";
import {
  CalendarDays,
  Check,
  Copy,
  Database,
  FileCheck2,
  FlaskConical,
  House,
  Menu,
  MessagesSquare,
  Satellite,
  X,
  Compass,
  Microscope,
  ScanEye,
  ArrowUpRight,
  PanelLeftClose,
  PanelLeftOpen,
  BookOpen,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang, type Lang } from "@/lib/i18n";
import { useResearchContext } from "@/lib/researchContext";
import { ErrorBoundary } from "@/components/error-boundary";
import { Footer } from "@/components/Footer";
import { TourController } from "@/components/TourController";
import { triggerCurrentPageTour } from "@/lib/tour";
import "@/styles/fireharmony-visual.css";

function NasaInsignia() {
  return (
    <div className="flex items-center gap-1.5 shrink-0 select-none">
      <svg
        viewBox="0 0 120 100"
        className="h-6 w-8 shrink-0 drop-shadow-sm"
        aria-label="NASA Meatball Insignia"
      >
        <circle cx="60" cy="50" r="48" fill="#0B3D91" />
        <ellipse
          cx="60"
          cy="50"
          rx="52"
          ry="18"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="3.5"
          transform="rotate(-25 60 50)"
        />
        <path
          d="M20 70 L60 20 L75 55 L95 18"
          fill="none"
          stroke="#FC3D21"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text
          x="60"
          y="58"
          textAnchor="middle"
          fill="#FFFFFF"
          fontSize="24"
          fontWeight="900"
          fontFamily="system-ui, sans-serif"
          letterSpacing="2"
        >
          NASA
        </text>
      </svg>
    </div>
  );
}

function LangToggle() {
  const { lang, setLang } = useLang();
  const btn = (l: Lang, label: string) => (
    <button
      key={l}
      type="button"
      onClick={() => setLang(l)}
      aria-pressed={lang === l}
      className={cn(
        "rounded px-2 py-0.5 text-xs font-semibold transition-colors duration-150 min-h-[26px] min-w-[28px] flex items-center justify-center",
        lang === l
          ? "bg-cyan-500/25 text-cyan-300 font-bold border border-cyan-500/40"
          : "text-slate-400 hover:text-white",
      )}
    >
      {label}
    </button>
  );
  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-slate-900/90 p-0.5 shrink-0"
      role="group"
      aria-label="Language / Ngôn ngữ"
    >
      {btn("vi", "VI")}
      {btn("en", "EN")}
    </div>
  );
}

function ModeToggle() {
  const { mode, setMode } = useResearchContext();
  const { t } = useLang();

  return (
    <div
      data-tour="header-mode-toggle"
      className="hidden xl:flex items-center gap-0.5 rounded-lg border border-slate-800 bg-slate-900/90 p-0.5 shrink-0 text-xs"
      role="group"
      aria-label="Experience Mode / Chế độ trải nghiệm"
    >
      <button
        type="button"
        onClick={() => setMode("explore")}
        aria-pressed={mode === "explore"}
        className={cn(
          "inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium transition min-h-[26px]",
          mode === "explore"
            ? "bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30 shadow-sm"
            : "text-slate-400 hover:text-white",
        )}
      >
        <Compass className="h-3 w-3" />
        <span>{t("nav.explore")}</span>
      </button>

      <button
        type="button"
        onClick={() => setMode("research")}
        aria-pressed={mode === "research"}
        className={cn(
          "inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors duration-150 min-h-[26px]",
          mode === "research"
            ? "bg-sky-500/20 text-sky-200 font-bold border border-sky-400/40 shadow-sm"
            : "text-slate-400 hover:text-white",
        )}
      >
        <Microscope className="h-3 w-3" />
        <span>{t("nav.research")}</span>
      </button>
    </div>
  );
}

export function Layout() {
  const { t } = useLang();
  const location = useLocation();
  const { dataFeed, mode, setMode } = useResearchContext();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const isRawMode = dataFeed === "raw";

  // Compact navigation items preventing collision; researchOnly routes appear in Research mode
  const allPrimaryNav = [
    { to: "/", label: t("nav.overview"), icon: House, end: true, researchOnly: false },
    { to: "/calendar", label: t("nav.calendar"), icon: CalendarDays, researchOnly: false },
    { to: "/xray", label: t("nav.xray"), icon: ScanEye, researchOnly: true },
    { to: "/lab", label: t("nav.lab"), icon: Satellite, researchOnly: true },
    { to: "/evidence", label: t("nav.evidence"), icon: FileCheck2, researchOnly: true },
    { to: "/investigator", label: t("nav.investigator"), icon: MessagesSquare, researchOnly: false },
    { to: "/methods", label: t("nav.methods"), icon: FlaskConical, researchOnly: true },
    { to: "/guide", label: t("nav.guide"), icon: BookOpen, researchOnly: false },
  ];
  const primaryNav = mode === "research" ? allPrimaryNav : allPrimaryNav.filter((item) => !item.researchOnly);

  // Left-side mission workspace follows the approved dashboard design.
  // Reuse the existing labels/routes and preserve the current research query.
  const workspaceNav = primaryNav;

  const allMobileNav = [
    {
      to: "/",
      label: t("nav.overview"),
      hint: t("nav.home_hint"),
      icon: House,
      end: true,
      researchOnly: false,
    },
    {
      to: "/calendar",
      label: t("nav.calendar"),
      hint: t("nav.calendar_hint"),
      icon: CalendarDays,
      researchOnly: false,
    },
    {
      to: "/xray",
      label: t("nav.xray"),
      hint: t("nav.lab_hint"),
      icon: ScanEye,
      researchOnly: true,
    },
    {
      to: "/lab",
      label: t("nav.lab"),
      hint: t("nav.lab_hint"),
      icon: Satellite,
      researchOnly: true,
    },
    {
      to: "/evidence",
      label: t("nav.evidence"),
      hint: t("nav.evidence_hint"),
      icon: FileCheck2,
      researchOnly: true,
    },
    {
      to: "/investigator",
      label: t("nav.investigator"),
      hint: t("nav.investigator_hint"),
      icon: MessagesSquare,
      researchOnly: false,
    },
    {
      to: "/methods",
      label: t("nav.methods"),
      hint: t("nav.methods_hint"),
      icon: FlaskConical,
      researchOnly: true,
    },
    {
      to: "/guide",
      label: t("nav.guide"),
      hint: t("nav.guide_hint"),
      icon: BookOpen,
      researchOnly: false,
    },
  ];
  const mobileNav = mode === "research" ? allMobileNav : allMobileNav.filter((item) => !item.researchOnly);

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Ignore
    }
  };

  return (
    <div data-fh-shell="mission" data-fh-mode={mode}
      className="h-screen w-screen bg-[#060B13] text-slate-100 flex flex-col font-sans antialiased selection:bg-cyan-500/30 overflow-hidden">
      {/* Primary Header with Absolute Spacing Discipline */}
      <header data-fh-header className="shrink-0 h-14 border-b border-slate-800 bg-[#0B1220]/95 backdrop-blur-md px-3 sm:px-4 flex items-center justify-between gap-3 z-40">
        {/* Cụm 1 (Trái): Logo & Brand Identity */}
        <NavLink data-fh-brand to={"/" + location.search} className="flex items-center gap-2 group shrink-0 focus-visible:outline-none">
          <span className="fh-brand-insignia"><NasaInsignia /></span>
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-tight text-white group-hover:text-cyan-300 transition-colors">
              FireHarmony
            </span>
            <span className="hidden xl:inline text-[10px] text-slate-400 font-mono leading-none">
              {t("nav.brand_sub")}
            </span>
          </div>
        </NavLink>

        {/* Cụm 2 (Giữa): Navigation Links (Responsive, centered, zero overlapping) */}
        <div className="hidden lg:flex xl:hidden flex-1 items-center justify-center min-w-0 px-2 overflow-x-auto">
          <nav
            className="flex items-center gap-0.5 lg:gap-1 rounded-xl border border-slate-800 bg-slate-900/80 p-0.5 shrink-0"
            aria-label="Primary Navigation"
          >
            {primaryNav.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={`${to}${location.search}`}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 rounded-lg px-2 lg:px-2.5 py-1 text-xs font-semibold transition-colors duration-150 shrink-0 min-h-[28px]",
                    isActive
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                      : "text-slate-300 hover:text-white hover:bg-white/5",
                  )
                }
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Cụm 3 (Phải): Controls & Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Mode Switch (Explore / Research) */}
          <ModeToggle />

          {/* Data Feed Status Badge */}
          <div
            data-fh-feed
            role="status"
            aria-label={isRawMode ? t("common.observed_feed") : t("common.synthetic_feed")}
            className={cn(
              "hidden xl:flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-mono border min-h-[32px]",
              isRawMode
                ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
                : "border-sky-500/40 bg-sky-950/40 text-sky-300",
            )}
            title={
              isRawMode
                ? t("common.observed_desc")
                : t("common.synthetic_desc")
            }
          >
            <Database className="h-3 w-3 shrink-0" />
            <span>
              {isRawMode ? t("common.observed_feed") : t("common.synthetic_feed")}
            </span>
          </div>

          <LangToggle />

          {/* Replay Guided Tour Button */}
          <button
            type="button"
            data-tour="header-tour-btn"
            onClick={triggerCurrentPageTour}
            title={t("tour.replay_title")}
            className="flex items-center gap-1 rounded-lg border border-cyan-500/35 bg-cyan-950/40 hover:bg-cyan-900/50 px-2 py-1 text-xs font-semibold text-cyan-200 transition min-h-[26px]"
          >
            <HelpCircle className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
            <span className="hidden sm:inline">{t("tour.replay_btn")}</span>
          </button>

          {/* Share / Copy URL Action */}
          <button
            type="button"
            onClick={handleShare}
            title={t("common.copy_link")}
            className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 px-2 py-1 text-xs font-semibold text-slate-200 transition min-h-[26px]"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" />
                <span className="hidden sm:inline text-emerald-300">{t("nav.copied")}</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3 text-slate-300" />
                <span className="hidden sm:inline">{t("nav.share")}</span>
              </>
            )}
          </button>

          {/* Mobile Menu Toggle Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden flex items-center justify-center rounded-lg border border-slate-800 bg-slate-900 p-1.5 text-slate-300 hover:text-white min-h-[32px] min-w-[32px]"
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Mobile Drawer Navigation (Sheet) */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-[2000] flex">
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />

          <div data-fh-sheet className="relative ml-auto flex h-full w-full max-w-sm flex-col bg-[#0B1220] border-l border-slate-800 p-6 shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between pb-5 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <NasaInsignia />
                <span className="font-bold text-white text-base">FireHarmony</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg p-2 text-slate-400 hover:text-white min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="py-4 space-y-4">
              <div className="space-y-1.5">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  {t("nav.experience_mode")}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("explore");
                      setMobileMenuOpen(false);
                    }}
                    aria-pressed={mode === "explore"}
                    className={cn(
                      "rounded-lg border p-2 text-xs font-bold text-center min-h-[44px]",
                      mode === "explore"
                        ? "border-cyan-500/60 bg-cyan-950/60 text-cyan-200"
                        : "border-slate-700 bg-slate-900/60 text-slate-300",
                    )}
                  >
                    {t("nav.mode_explore")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("research");
                      setMobileMenuOpen(false);
                    }}
                    aria-pressed={mode === "research"}
                    className={cn(
                      "rounded-lg border p-2 text-xs font-bold text-center min-h-[44px]",
                      mode === "research"
                        ? "border-sky-500/60 bg-sky-950/60 text-sky-200"
                        : "border-slate-700 bg-slate-900/60 text-slate-300",
                    )}
                  >
                    {t("nav.mode_research")}
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <div className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
                  {t("nav.navigation")}
                </div>
                <div className="space-y-2">
                  {mobileNav.map(({ to, label, hint, icon: Icon, end }) => (
                    <NavLink
                      key={to}
                      to={`${to}${location.search}`}
                      end={end}
                      className={({ isActive }) =>
                        cn(
                          "flex items-start gap-3 rounded-xl p-3 transition text-sm min-h-[44px]",
                          isActive
                            ? "border border-cyan-500/40 bg-cyan-950/40 text-cyan-200 font-bold"
                            : "border border-slate-800 bg-slate-900/40 text-slate-300 hover:border-slate-700",
                        )
                      }
                    >
                      <Icon className="h-5 w-5 mt-0.5 text-cyan-400 shrink-0" />
                      <div>
                        <div>{label}</div>
                        <div className="text-xs text-slate-400 font-normal leading-relaxed">{hint}</div>
                      </div>
                    </NavLink>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0 min-w-0">
        <aside data-fh-rail data-fh-collapsed={railCollapsed}
          className="hidden xl:flex w-[224px] shrink-0 flex-col border-r border-slate-800 bg-[#0B1220] px-3 py-4"
          aria-label="Mission workspace">
          <div className="fh-rail-toolbar mb-3 flex items-center justify-between gap-2 px-2 pt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            <span className="fh-rail-heading-text">{t("nav.navigation")}</span>
            <button type="button" className="fh-rail-toggle"
              onClick={() => setRailCollapsed((current) => !current)}
              aria-label={railCollapsed ? t("nav.navigation") : t("common.close_menu")}
              aria-expanded={!railCollapsed}
              aria-controls="fh-mission-rail-nav"
              title={railCollapsed ? t("nav.navigation") : t("common.close_menu")}>
              {railCollapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> :
                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
          <nav id="fh-mission-rail-nav" aria-label="Workspace navigation" className="space-y-1">
            {workspaceNav.map(({ to, label, icon: Icon }) => (
              <NavLink data-fh-rail-item key={to} to={to + location.search} end={to === "/"}
                className={({ isActive }) => cn(
                  "flex min-h-[43px] items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "border-cyan-500/40 bg-cyan-500/10 font-semibold text-cyan-200"
                    : "border-transparent text-slate-400 hover:border-slate-700 hover:bg-white/5 hover:text-slate-100",
                )}>
                <span className="fh-rail-icon"><Icon className="h-4 w-4 shrink-0" aria-hidden="true" /></span>
                <span className={cn("fh-rail-label", railCollapsed && "sr-only")}>{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto space-y-2 rounded-xl border border-slate-700/70 bg-[#111C2E] p-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
              <Satellite className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              NASA FIRMS
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">
              MODIS + VIIRS · {t("nav.calendar")}
            </p>
            <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-300 hover:text-white">
              NASA FIRMS <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        </aside>
      {/* Main Viewport Content Area: Root-level natural scrollbar at screen edge for content pages, full-bleed overflow-hidden for Calendar GIS map */}
      <main data-fh-main data-fh-page={location.pathname.split("/")[1] || "home"}
        className={cn(
          "flex-1 min-h-0 min-w-0 flex flex-col",
          location.pathname.startsWith("/calendar") ? "overflow-hidden" : "overflow-y-auto",
        )}
      >
        <ErrorBoundary>
          <Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center p-12">
                <div className="flex items-center gap-3 text-slate-400 text-sm font-mono">
                  <div className="h-4 w-4 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                  <span>{t("common.loading")}</span>
                </div>
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </ErrorBoundary>

        {/* Global Scientific Footer with Team AlphaCentauriAB */}
        {!location.pathname.startsWith("/calendar") && <Footer />}
      </main>
      </div>
      <TourController />
    </div>
  );
}
