import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, describeError } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { AnomalyFigure, PipelineFigure, PixelFigure } from "@/components/figures";

export function MethodPage() {
  const { t, lang } = useLang();
  const STEPS = [
    { icon: "📥", title: lang === "vi" ? "Chuẩn hóa" : "Standardize", desc: lang === "vi" ? "Một schema cho MODIS C6.1 + VIIRS; instrument lạ/type null/acq_time sai bị loại, không tự sửa." : "One schema for MODIS C6.1 + VIIRS; unknown instruments / bad HHMM rejected, never silently fixed." },
    { icon: "🗺️", title: lang === "vi" ? "Lưới ngày + dedup" : "Daily grid + dedup", desc: lang === "vi" ? "Ô 0.05° × ngày × sensor; trùng raw file collapse một key." : "0.05° cell × day × sensor; overlapping raw pulls dedup to one key." },
    { icon: "⚖️", title: "k (activity ratio)", desc: lang === "vi" ? "k = MODIS/VIIRS từ tổng tháng AOI — thực nghiệm, chưa phải hiệu chuẩn kiểm chứng." : "k = MODIS/VIIRS from AOI monthly totals — empirical, not a validated calibration." },
    { icon: "🔥", title: lang === "vi" ? "Chỉ số đã chỉnh sensor" : "Sensor-adjusted index", desc: lang === "vi" ? "Giữ VIIRS nơi ghi nhận; ô chỉ-MODIS upscale 1/k = ESTIMATE, FRP=null." : "Keep VIIRS where recorded; MODIS-only cells 1/k = ESTIMATE, FRP=null." },
    { icon: "🤖", title: "ML (thử nghiệm)", desc: lang === "vi" ? "ml_hgb_v1 + ts_win12_v1 — artifact đã lưu huấn luyện trên mẫu tổng hợp, chọn qua ?method=ml|ts, chưa kiểm chứng trên dữ liệu NASA thật." : "ml_hgb_v1 + ts_win12_v1 — persisted artifacts trained on the synthetic sample, selectable via ?method=ml|ts, not validated on real NASA data." },
  ];
  const [dl, setDl] = useState<{ has_torch: boolean; status?: string; models: Array<Record<string, string>> } | null>(null);
  const [hgb, setHgb] = useState<Record<string, unknown> | null>(null);
  const [tsm, setTsm] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.dlInfo().then(setDl).catch((e) => setErr(describeError(e)));
    fetch("/api/firms/ml-status?aoi=vietnam").then((r) => r.json()).then(setHgb).catch(() => undefined);
    fetch("/api/firms/ts-status?aoi=vietnam").then((r) => r.json()).then(setTsm).catch(() => undefined);
  }, []);
  return (
    <div className="animate-fade-up mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold">{t("method.title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("method.sub")}</p>
      </div>
      <PipelineFigure steps={STEPS} />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="card-glow rounded-lg border bg-card p-4">
          <h2 className="font-bold">VIIRS ≠ MODIS</h2>
          <PixelFigure />
        </div>
        <div className="card-glow rounded-lg border bg-card p-4">
          <h2 className="font-bold">Anomaly z robust</h2>
          <AnomalyFigure />
        </div>
      </div>
      <div className="card-glow rounded-lg border bg-card p-4">
        <h2 className="font-bold">{t("method.models")}</h2>
        {err ? <p className="text-sm text-red-500">{err}</p> : dl ? (
          <ul className="mt-2 space-y-2 text-sm">
            <li>torch: <b>{dl.has_torch ? "yes" : "no — statistical path only"}</b>{dl.status ? ` · ${dl.status}` : ""}</li>
            {dl.models.map((m) => (
              <li key={m.name} className="rounded border p-2 font-mono text-xs">
                <b>{m.name}</b> · {m.kind} · {m.params} params<br />
                in: {m.input} → target: {m.target}
              </li>
            ))}
            {hgb && (hgb as { trained?: boolean }).trained !== false && (
              <li className="rounded border border-green-500 p-2 font-mono text-xs">
                <b>HGB calibrator (ml_hgb_v1, sklearn)</b> · PERSISTED, dùng trong ?method=ml<br />
                holdout MAE {String(((hgb as { metrics?: { ml?: { mae?: number } } }).metrics?.ml?.mae ?? "?"))} ·
                xem /xray để so với baseline
              </li>
            )}
            {tsm && (tsm as { trained?: boolean }).trained !== false && (
              <li className="rounded border border-green-500 p-2 font-mono text-xs">
                <b>SeasonTransformer (ts_win12_v1, {(tsm as { params?: number }).params} params)</b> · PERSISTED, dùng trong ?method=ts<br />
                đọc cửa sổ MODIS 12 tháng → VIIRS tháng cuối · holdout MAE {String(((tsm as { metrics?: { transformer?: { mae?: number } } }).metrics?.transformer?.mae ?? "?"))} ·
                trung thực: ngang/kém seasonal-ratio trên dữ liệu nhỏ — xem /xray
              </li>
            )}
          </ul>
        ) : <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
      </div>
      <div className="card-glow rounded-lg border bg-card p-4">
        <h2 className="font-bold">{t("method.honesty")}</h2>
        <ul className="list-disc pl-6 text-sm text-muted-foreground">
          <li>{lang === "vi"
            ? "stat là đường mặc định đã kiểm chứng; ml_hgb_v1 / ts_win12_v1 chạy từ artifact đã lưu huấn luyện trên mẫu tổng hợp, chọn qua ?method=, chưa kiểm chứng trên dữ liệu NASA thật."
            : "stat is the default validated path; ml_hgb_v1 / ts_win12_v1 run from persisted artifacts trained on the synthetic sample, selectable via ?method=, not validated on real NASA data."}</li>
          <li>Era-ratio ≈ 1.1 (target ~1.0) — internal consistency, not fire accuracy.</li>
          <li>Planted 2019 synthetic spikes caught — pipeline check, not real-fire skill.</li>
          <li>MODIS-only cells are estimates (coverage unknown); upscaled FRP is null. <Link className="underline" to="/ask">{t("nav.ask")}</Link>.</li>
        </ul>
      </div>
    </div>
  );
}
