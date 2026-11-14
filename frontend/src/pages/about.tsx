import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { Loading } from "@/components/states";

export function AboutPage() {
  const { t, lang } = useLang();
  const [status, setStatus] = useState<{ datasets: Array<{ aoi: string; sample_rows: number; sample_bytes: number }>; raw_count: number; raw_files: Array<{ file: string; bytes: number }> } | null>(null);
  useEffect(() => {
    api.dataStatus().then(setStatus).catch(() => undefined);
  }, []);
  return (
    <div className="animate-fade-up mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">{t("about.title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("about.sub")}</p>
        <p className="mt-2 inline-block rounded bg-amber-100 px-2 py-1 font-mono text-xs text-amber-900">{t("common.synthetic")}</p>
      </div>
      <div className="card-glow rounded-lg border bg-card p-4">
        <h2 className="font-bold">{t("about.src")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {lang === "vi"
            ? "NASA FIRMS active-fire CSV (MODIS C6.1 NRT/SP + VIIRS 375 m NRT/SP) qua FIRMS Area API. Key miễn phí tại firms.modaps.eosdis.nasa.gov/api/area → make fetch AOI_BBOX=... DAYS=5 (không commit key)."
            : "NASA FIRMS active-fire CSV (MODIS C6.1 NRT/SP + VIIRS 375 m NRT/SP) via the FIRMS Area API. Free key at firms.modaps.eosdis.nasa.gov/api/area → make fetch AOI_BBOX=... DAYS=5 (never commit the key)."}
        </p>
      </div>
      <div className="card-glow rounded-lg border bg-card p-4">
        <h2 className="font-bold">{t("about.on_server")}</h2>
        {!status ? <Loading label={t("common.loading")} /> : (
          <ul className="mt-2 space-y-1 font-mono text-xs">
            {status.datasets.map((d) => (
              <li key={d.aoi}>📦 {d.aoi}: {d.sample_rows.toLocaleString()} sample rows ({(d.sample_bytes / 1024).toFixed(0)} KB)</li>
            ))}
            <li>🛰️ {status.raw_count} real FIRMS files (raw/)</li>
            {status.raw_files.slice(0, 6).map((f) => <li key={f.file} className="pl-4 text-muted-foreground">↳ {f.file} ({(f.bytes / 1024).toFixed(0)} KB)</li>)}
          </ul>
        )}
      </div>
      <div className="card-glow rounded-lg border bg-card p-4">
        <h2 className="font-bold">{t("about.limits")}</h2>
        <ul className="list-disc pl-6 text-sm text-muted-foreground">
          <li>{lang === "vi" ? "Calendar tháng × năm, anomaly z (MAD), top critical, latest-vs-history (baseline loại năm hiện tại), outlook climatology." : "Month × year calendar, z anomaly (MAD), top critical, latest-vs-history (current year excluded), climatology outlook."}</li>
          <li>Download: <Link className="underline" to="/calendar">harmonized CSV + brief .md</Link>.</li>
          <li>{lang === "vi" ? "Tháng thiếu = null (no data), không dùng cho anomaly/forecast. Pre-2012 là upscale ước lượng; bias giờ bay/mây chưa khử." : "Missing months = null (no data), excluded from anomaly/forecast. Pre-2012 is estimated upscale; overpass/cloud bias remains."}</li>
          <li>{lang === "vi" ? "Outlook là khí hậu học, không phải dự báo. FIRMS active-fire không được làm căn cứ duy nhất cho quyết định sinh mạng/tài sản." : "Outlook is climatology, not a forecast. FIRMS active-fire must not be the sole basis for life/property decisions."}</li>
        </ul>
      </div>
    </div>
  );
}
