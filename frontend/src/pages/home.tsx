import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, Download, MessagesSquare } from "lucide-react";
import { api, describeError, type Aoi } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { ErrorState, Loading } from "@/components/states";
import { AnomalyFigure, PipelineFigure, PixelFigure } from "@/components/figures";

export function HomePage() {
  const { t } = useLang();
  const STEPS = [
    { icon: "📥", title: t("home.step1t"), desc: t("home.step1d") },
    { icon: "🗺️", title: t("home.step2t"), desc: t("home.step2d") },
    { icon: "⚖️", title: t("home.step3t"), desc: t("home.step3d") },
    { icon: "🔥", title: t("home.step4t"), desc: t("home.step4d") },
    { icon: "📅", title: t("home.step5t"), desc: t("home.step5d") },
  ];
  const [health, setHealth] = useState<string>("…");
  const [aois, setAois] = useState<Aoi[]>([]);
  const [stats, setStats] = useState<{ rows: number; raw: number } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.health().then((h) => setHealth(`${h.status} · torch=${h.torch}`)).catch((e) => setHealth(describeError(e)));
    api.aois().then((r) => setAois(r.aois)).catch(setError);
    api.dataStatus()
      .then((s) => setStats({ rows: s.datasets.reduce((a, d) => a + d.sample_rows, 0), raw: s.raw_count }))
      .catch(() => undefined);
  }, []);

  async function onUpload() {
    if (!file) return;
    const text = await file.text();
    const [header, ...lines] = text.trim().split("\n");
    const cols = header.split(",").map((c) => c.trim().toLowerCase());
    const records = lines.slice(0, 5000).map((ln) => {
      const cells = ln.split(",");
      return Object.fromEntries(cols.map((c, i) => [c, cells[i]?.trim()]));
    });
    try {
      const v = await api.validate(records);
      const h = await api.harmonize(records);
      setResult(`Clean ${v.clean}, rejected ${v.rejected}. Cells ${h.daily_cells}. ` +
        `Critical: ${h.critical_periods.slice(0, 3).map((p) => `${p.year}-${p.month}(z=${p.z})`).join(", ") || "none"}`);
    } catch (e) {
      setResult(describeError(e));
    }
  }

  if (error) return <ErrorState error={error} />;
  return (
    <div className="animate-fade-up space-y-10">
      <section className="bg-grid relative overflow-hidden rounded-2xl border p-8 md:p-12">
        <div className="relative max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-widest text-orange-500">{t("home.kicker")}</p>
          <h1 className="text-gradient mt-2 text-4xl font-extrabold md:text-5xl">{t("home.title")}</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">{t("home.desc")}</p>
          <p className="mt-2 inline-block rounded bg-amber-100 px-2 py-1 font-mono text-xs text-amber-900">{t("common.synthetic")}</p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link className="glow-border inline-flex items-center gap-1 rounded-full bg-orange-600 px-5 py-2.5 font-semibold text-white" to="/calendar">
              <CalendarDays className="h-4 w-4" /> {t("home.open")} <ArrowRight className="h-4 w-4" />
            </Link>
            <Link className="inline-flex items-center gap-1 rounded-full border px-5 py-2.5" to="/ask">
              <MessagesSquare className="h-4 w-4" /> {t("home.ask")}
            </Link>
            <span className="ml-auto font-mono text-xs text-muted-foreground">API: {health}</span>
          </div>
          <div className="mt-6 flex flex-wrap gap-6">
            {[
              [stats ? stats.rows.toLocaleString() : "…", t("home.stat_rows")],
              ["25", t("home.stat_years")],
              [stats ? String(stats.raw) : "…", t("home.stat_raw")],
            ].map(([v, l]) => (
              <div key={l}>
                <p className="tabular-nums text-2xl font-extrabold text-orange-500">{v}</p>
                <p className="text-xs text-muted-foreground">{l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">{t("home.why")}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="card-glow rounded-lg border bg-card p-4"><PixelFigure /></div>
          <div className="card-glow rounded-lg border bg-card p-4"><AnomalyFigure />
            <p className="mt-2 text-xs text-muted-foreground">{t("home.z_note")}</p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">{t("home.pipeline")}</h2>
        <PipelineFigure steps={STEPS} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">{t("home.aois")}</h2>
        {aois.length === 0 ? <Loading label={t("common.loading")} /> : (
        <div className="grid gap-3 md:grid-cols-3">
          {aois.map((a) => (
            <Link key={a.id} to={`/calendar?aoi=${a.id}`}
              className="card-glow group rounded-lg border bg-card p-4 transition-shadow hover:shadow-lg">
              <p className="font-mono text-xs uppercase text-orange-500">{a.id}</p>
              <p className="mt-1 text-sm font-semibold group-hover:underline">{a.label}</p>
              <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Download className="h-3 w-3" /> {t("home.aoi_note")}
              </p>
            </Link>
          ))}
        </div>
        )}
      </section>

      <section className="card-glow rounded-lg border bg-card p-4">
        <h2 className="font-bold">{t("home.upload")}</h2>
        <p className="text-sm text-muted-foreground">{t("home.upload_desc")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input type="file" accept=".csv" aria-label="FIRMS CSV"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button className="rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white" onClick={onUpload}>{t("home.harmonize")}</button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("home.uploadwarn")}</p>
        {result && <p className="mt-3 text-sm" role="status">{result}</p>}
      </section>
    </div>
  );
}
