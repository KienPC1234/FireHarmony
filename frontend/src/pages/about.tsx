import { Link } from "react-router-dom";
import { ExternalLink, FlaskConical, Info, Landmark, ShieldAlert, Siren } from "lucide-react";
import { useLang } from "@/lib/i18n";

const FIRMS_URL = "https://earthdata.nasa.gov/data/tools/firms";

export function AboutPage() {
  const { t } = useLang();

  const audiences = [
    {
      icon: Siren,
      title: t("about.em_title"),
      desc: t("about.em_desc"),
    },
    {
      icon: FlaskConical,
      title: t("about.sci_title"),
      desc: t("about.sci_desc"),
    },
    {
      icon: Landmark,
      title: t("about.land_title"),
      desc: t("about.land_desc"),
    },
  ];

  const limits = [t("about.limit1"), t("about.limit2"), t("about.limit3")];

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 space-y-8 max-w-7xl mx-auto w-full pb-24">
      <div data-enter className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 shadow-sm space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-1 text-xs font-semibold text-cyan-300">
          <Info className="h-4 w-4" />
          <span>{t("about.badge")}</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
          {t("about.title")}
        </h1>
        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-3xl">
          {t("about.sub")}
        </p>
      </div>

      <section data-tour="about-mission" className="space-y-4">
        <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
          {t("about.audience_title")}
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {audiences.map((a) => (
            <div key={a.title} className="rounded-2xl border border-slate-800 bg-[#111C2E] p-5 space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-950/40 text-cyan-300">
                <a.icon className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-white text-base">{a.title}</h3>
              <p className="text-xs text-slate-300 leading-relaxed">{a.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#111C2E] p-6 shadow-sm space-y-3">
        <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
          {t("about.data_title")}
        </h2>
        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
          {t("about.data_desc")}
        </p>
        <a
          href={FIRMS_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:underline"
        >
          <span>{t("about.firms_link_label")}</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </section>

      <section data-tour="about-disclaimer" className="rounded-2xl border border-amber-500/30 bg-amber-950/10 p-6 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300">
          <ShieldAlert className="h-4 w-4" />
          <span>{t("about.limits_title")}</span>
        </div>
        <ul className="space-y-2 text-xs text-slate-300 leading-relaxed list-disc list-inside">
          {limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            to="/methods"
            className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-orange-500 transition min-h-[40px]"
          >
            <span>{t("about.cta_methods")}</span>
          </Link>
          <Link
            to="/calendar?aoi=vietnam"
            className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-950/40 px-5 py-2.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/50 transition min-h-[40px]"
          >
            <span>{t("about.cta_calendar")}</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
