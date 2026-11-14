import { Link } from "react-router-dom";
import {
  CalendarDays,
  ExternalLink,
  FileCheck2,
  FlaskConical,
  MessagesSquare,
  Satellite,
  ShieldCheck,
} from "lucide-react";
import { useLang } from "@/lib/i18n";

export function Footer() {
  const { t } = useLang();

  return (
    <footer className="border-t border-slate-800 bg-[#080E18] text-slate-400 text-xs shrink-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Top Section: Team Brand & Mission */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 pb-6 border-b border-slate-800/80">
          <div className="space-y-2 max-w-md">
            <div className="flex items-center gap-2">
              <span className="font-bold text-white text-base tracking-tight">FireHarmony</span>
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-mono font-bold text-cyan-300">
                {t("footer.team_name")}
              </span>
            </div>
            <p className="text-slate-300 leading-relaxed font-sans text-xs">
              {t("footer.mission_desc")}
            </p>
          </div>

          {/* Quick Nav Links */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 text-xs">
            <div className="space-y-2">
              <span className="font-bold text-white uppercase tracking-wider text-[11px] block font-mono">
                {t("footer.col_platform")}
              </span>
              <ul className="space-y-1.5 font-sans">
                <li>
                  <Link to="/calendar" className="hover:text-cyan-300 transition flex items-center gap-1.5">
                    <CalendarDays className="h-3 w-3" />
                    <span>{t("footer.nav_calendar")}</span>
                  </Link>
                </li>
                <li>
                  <Link to="/lab" className="hover:text-cyan-300 transition flex items-center gap-1.5">
                    <Satellite className="h-3 w-3" />
                    <span>{t("footer.nav_lab")}</span>
                  </Link>
                </li>
                <li>
                  <Link to="/evidence" className="hover:text-cyan-300 transition flex items-center gap-1.5">
                    <FileCheck2 className="h-3 w-3" />
                    <span>{t("footer.nav_evidence")}</span>
                  </Link>
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <span className="font-bold text-white uppercase tracking-wider text-[11px] block font-mono">
                {t("footer.col_science")}
              </span>
              <ul className="space-y-1.5 font-sans">
                <li>
                  <Link to="/investigator" className="hover:text-cyan-300 transition flex items-center gap-1.5">
                    <MessagesSquare className="h-3 w-3" />
                    <span>{t("footer.nav_investigator")}</span>
                  </Link>
                </li>
                <li>
                  <Link to="/methods" className="hover:text-cyan-300 transition flex items-center gap-1.5">
                    <FlaskConical className="h-3 w-3" />
                    <span>{t("footer.nav_methods")}</span>
                  </Link>
                </li>
                <li>
                  <Link to="/methods#benchmark" className="hover:text-cyan-300 transition flex items-center gap-1.5">
                    <ShieldCheck className="h-3 w-3" />
                    <span>{t("footer.nav_benchmark")}</span>
                  </Link>
                </li>
              </ul>
            </div>

            <div className="space-y-2 col-span-2 sm:col-span-1">
              <span className="font-bold text-white uppercase tracking-wider text-[11px] block font-mono">
                {t("footer.col_provenance")}
              </span>
              <ul className="space-y-1.5 font-sans">
                <li>
                  <a
                    href="https://earthdata.nasa.gov/data/tools/firms"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-cyan-300 transition inline-flex items-center gap-1"
                  >
                    <span>{t("footer.nasa_firms")}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>
                  <span className="text-slate-400 font-mono text-[11px]">{t("footer.modis_range")}</span>
                </li>
                <li>
                  <span className="text-slate-400 font-mono text-[11px]">{t("footer.viirs_range")}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Middle Section: Scientific Disclaimer & Model Status */}
        <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4 space-y-2 text-[11px] font-mono leading-relaxed">
          <div className="flex items-center justify-between flex-wrap gap-2 text-slate-300 font-bold border-b border-slate-800/60 pb-1.5 font-sans">
            <span className="flex items-center gap-1.5 text-cyan-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>{t("footer.statement_title")}</span>
            </span>
            <span className="text-slate-400 font-mono text-[10px]">
              {t("footer.statement_engine")}
            </span>
          </div>
          <p className="text-slate-400 font-sans">
            {t("footer.statement_body")}
          </p>
        </div>

        {/* Bottom Section: Copyright & Team Credits */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-slate-400 font-mono pt-2">
          <div>
            <span>{t("footer.copyright")}</span>
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span>{t("footer.license")}</span>
            <span>·</span>
            <span>{t("footer.api_status")}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
