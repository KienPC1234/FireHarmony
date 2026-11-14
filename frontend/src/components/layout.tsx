import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Suspense, useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  Check,
  Copy,
  Database,
  FileCheck2,
  Flame,
  FlaskConical,
  House,
  Menu,
  MessagesSquare,
  Satellite,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang, type Lang } from "@/lib/i18n";
import { ErrorBoundary } from "@/components/error-boundary";

function LangToggle() {
  const { lang, setLang } = useLang();
  const btn = (l: Lang, label: string) => (
    <button
      key={l}
      type="button"
      onClick={() => setLang(l)}
      aria-pressed={lang === l}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition-all min-h-[32px] min-w-[36px]",
        lang === l
          ? "bg-cyan-500/25 text-cyan-300 shadow-sm border border-cyan-500/40"
          : "text-slate-400 hover:text-white hover:bg-white/5",
      )}
    >
      {label}
    </button>
  );
  return (
    <div
      className="flex items-center gap-0.5 rounded-full border border-slate-700 bg-slate-900/90 p-0.5 shrink-0"
      role="group"
      aria-label="Language / Ngôn ngữ"
    >
      {btn("vi", "VI")}
      {btn("en", "EN")}
    </div>
  );
}

export function Layout() {
  const { t, lang } = useLang();
  const vi = lang === "vi";
  const location = useLocation();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const searchParams = new URLSearchParams(location.search);
  const dataParam = searchParams.get("data");

  // Sync context mode: if explicitly data=raw, it's raw.
  const isRawMode = dataParam === "raw";

  // Desktop primary navigation items
  const primaryNav = [
    { to: "/calendar", label: "Fire Calendar", icon: CalendarDays },
    { to: "/lab", label: "Sensor Lab", icon: Satellite },
    { to: "/evidence", label: vi ? "Bằng chứng" : "Evidence", icon: FileCheck2 },
    { to: "/investigator", label: "AI Investigator", icon: MessagesSquare },
    { to: "/methods", label: vi ? "Phương pháp & Dữ liệu" : "Methods & Data", icon: FlaskConical },
  ];

  // Mobile drawer full navigation items
  const mobileNav = [
    {
      to: "/",
      label: vi ? "Tổng quan" : "Overview",
      hint: vi ? "Định vị sản phẩm & vấn đề khác biệt cảm biến" : "Product positioning & sensor gap overview",
      icon: House,
      end: true,
    },
    {
      to: "/calendar",
      label: "Fire Calendar",
      hint: vi ? "Lịch hoạt động cháy đa thập kỷ & bản đồ điểm nóng" : "Multi-decadal fire calendar & hotspot map",
      icon: CalendarDays,
    },
    {
      to: "/lab",
      label: "Sensor Lab",
      hint: vi ? "So sánh cảm biến, mô phỏng quan trắc & kiểm chứng" : "Sensor X-Ray, blind replay & mission simulator",
      icon: Satellite,
    },
    {
      to: "/evidence",
      label: vi ? "Bằng chứng & Toàn vẹn" : "Evidence & Integrity",
      hint: vi ? "Sổ đối chiếu dữ liệu quan trắc MODIS & VIIRS" : "Observation & ingestion integrity ledger",
      icon: FileCheck2,
    },
    {
      to: "/investigator",
      label: "AI Investigator",
      hint: vi ? "Phân tích khoa học có căn cứ, không ảo giác" : "Scientific evidence-grounded query assistant",
      icon: MessagesSquare,
    },
    {
      to: "/methods",
      label: vi ? "Phương pháp & Dữ liệu" : "Methods & Data",
      hint: vi ? "Quy trình hiệu chuẩn, mô hình & giới hạn khoa học" : "Pipeline, models, benchmarks & limitations",
      icon: FlaskConical,
    },
  ];

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Ignore
    }
  };

  const isHome = location.pathname === "/";

  return (
    <div className="min-h-screen bg-[#0B1220] text-slate-100 flex flex-col font-sans antialiased selection:bg-cyan-500/30">
      {/* Sticky Primary Header (64px) */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-[#0B1220]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 h-16">
          {/* Brand Identity */}
          <NavLink to="/" className="flex items-center gap-3 group shrink-0 focus-visible:outline-none">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/40 bg-[#111C2E] shadow-sm transition-transform group-hover:scale-105">
              <Flame className="h-5 w-5 text-orange-400" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-base tracking-tight text-white group-hover:text-cyan-300 transition-colors">
                FireHarmony
              </span>
              <span className="text-xs font-medium text-slate-400">
                {vi ? "Bằng chứng hoạt động cháy vệ tinh" : "Satellite fire evidence"}
              </span>
            </div>
          </NavLink>

          {/* Center Navigation Bar (Desktop) */}
          <nav
            className="hidden lg:flex items-center gap-1.5 rounded-full border border-slate-800 bg-[#111C2E] p-1"
            aria-label="Primary Navigation"
          >
            {primaryNav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all shrink-0 min-h-[36px]",
                    isActive
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold shadow-sm"
                      : "text-slate-300 hover:text-white hover:bg-white/5",
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>

          {/* Right Action & Context Area */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* Active Data Mode Badge */}
            <div
              className={cn(
                "hidden sm:flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-mono border",
                isRawMode
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-300",
              )}
              title={
                isRawMode
                  ? (vi ? "Dữ liệu NASA FIRMS quan trắc thực tế" : "NASA FIRMS Observed Data Active")
                  : (vi ? "Dữ liệu mẫu kiểm thử minh họa" : "Synthetic Demonstration Data Active")
              }
            >
              <Database className="h-3.5 w-3.5" />
              <span>{isRawMode ? (vi ? "NASA quan trắc" : "NASA Observed") : (vi ? "Dữ liệu mẫu" : "Synthetic Feed")}</span>
            </div>

            <LangToggle />

            {/* Context-aware CTA */}
            {isHome ? (
              <NavLink
                to="/calendar"
                className="flex items-center gap-1.5 rounded-xl bg-orange-600 hover:bg-orange-500 px-4 py-2 text-xs font-bold text-white shadow-sm transition active:scale-95 min-h-[40px]"
              >
                <span>{vi ? "Khám phá" : "Explore"}</span>
                <ArrowUpRight className="h-4 w-4" />
              </NavLink>
            ) : (
              <button
                type="button"
                onClick={handleShare}
                title={vi ? "Sao chép liên kết" : "Share URL"}
                className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-200 transition min-h-[40px]"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-emerald-300">{vi ? "Đã chép" : "Copied"}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-slate-300" />
                    <span>{vi ? "Chia sẻ" : "Share"}</span>
                  </>
                )}
              </button>
            )}

            {/* Mobile Menu Toggle Button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:text-white min-h-[44px] min-w-[44px]"
              aria-label="Toggle navigation menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Drawer Navigation (Sheet) */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Drawer content */}
          <div className="relative ml-auto flex h-full w-full max-w-sm flex-col bg-[#0B1220] border-l border-slate-800 p-6 shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between pb-6 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-orange-400" />
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

            <div className="py-4">
              <div className="mb-3 px-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                {vi ? "Điều hướng" : "Navigation"}
              </div>
              <div className="space-y-1.5">
                {mobileNav.map(({ to, label, hint, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      cn(
                        "flex items-start gap-3 rounded-xl p-3 text-sm transition-all min-h-[52px]",
                        isActive
                          ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 font-semibold"
                          : "text-slate-300 hover:bg-slate-800/80 hover:text-white",
                      )
                    }
                  >
                    <Icon className="h-5 w-5 shrink-0 mt-0.5 text-cyan-400" />
                    <div className="flex flex-col">
                      <span className="font-medium text-white">{label}</span>
                      <span className="text-xs text-slate-400">{hint}</span>
                    </div>
                  </NavLink>
                ))}
              </div>
            </div>

            {/* Mobile context summary */}
            <div className="mt-auto pt-6 border-t border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{vi ? "Dữ liệu kích hoạt:" : "Active Data:"}</span>
                <span
                  className={cn(
                    "font-mono px-2 py-0.5 rounded",
                    isRawMode
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-amber-500/15 text-amber-300"
                  )}
                >
                  {isRawMode ? "NASA Observed" : "Synthetic Feed"}
                </span>
              </div>
              <div className="text-xs text-slate-500">
                NASA Space Apps Challenge 2026 · Fire Intelligence Lab
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="mx-auto max-w-7xl flex-1 w-full px-4 py-6">
        <ErrorBoundary>
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-24 text-slate-400 gap-3">
                <Activity className="h-5 w-5 animate-spin text-cyan-400" />
                <span className="text-sm font-mono tracking-wide">{t("common.loading")}</span>
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>

      {/* Scientific Footer */}
      <footer className="border-t border-slate-800 bg-[#070D18] py-8 text-xs text-slate-400">
        <div className="mx-auto max-w-7xl px-4 space-y-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-slate-200 font-bold text-sm">
                <span>FireHarmony</span>
                <span className="text-slate-600 font-normal">|</span>
                <span className="text-cyan-400 font-medium">NASA Space Apps Challenge 2026</span>
              </div>
              <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
                {vi
                  ? "Nghiên cứu Khoa học Trái Đất: Chuẩn hóa chuỗi dữ liệu điểm nóng hoạt động cháy đa thập kỷ cho MODIS C6.1 (1 km) và VIIRS (375 m). Phân tích phát hiện điểm nóng và chỉ số hoạt động đã điều chỉnh theo cảm biến; không đo trực tiếp số vụ cháy hoặc diện tích cháy thực tế."
                  : "Earth Science Research: Multi-decadal active-fire hotspot harmonization for MODIS C6.1 (1 km) and VIIRS (375 m). Analyzes hotspot detections and sensor-adjusted activity indexes; does not measure real fire incidents or burned area."}
              </p>
            </div>

            <div className="flex items-center gap-4 text-xs font-mono shrink-0">
              <NavLink to="/methods" className="text-slate-300 hover:text-cyan-300 underline underline-offset-4">
                {vi ? "Phương pháp" : "Methods"}
              </NavLink>
              <NavLink to="/evidence" className="text-slate-300 hover:text-cyan-300 underline underline-offset-4">
                {vi ? "Sổ bằng chứng" : "Evidence Ledger"}
              </NavLink>
              <a
                href="https://earthdata.nasa.gov/data/tools/firms"
                target="_blank"
                rel="noreferrer"
                className="text-slate-300 hover:text-cyan-300 underline underline-offset-4"
              >
                NASA FIRMS
              </a>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800/60 text-xs text-slate-500 flex flex-wrap justify-between items-center gap-2">
            <span>
              {vi
                ? "Giới hạn: Sản phẩm nghiên cứu phục vụ đánh giá xu hướng lịch sử. Không phục vụ điều phối cứu hỏa hoặc an toàn khẩn cấp."
                : "Disclaimer: Research prototype for historical trend evaluation. Not intended for operational wildfire response or safety dispatch."}
            </span>
            <span>Version: 2026.1 · Open Source</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
