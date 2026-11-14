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
    { icon: "🤖", title: "ML (thử nghiệm)", desc: lang === "vi" ? "ml_b2res_v4 (residual trên B2 + gate blocked-CV) và ts_logratio_pool_v2 (pooled 3 AOI + log-ratio) — artifact NASA raw đã lưu; bảng unified eval nằm trong model card." : "ml_b2res_v4 (B2-residual + blocked-CV gate) and ts_logratio_pool_v2 (pooled 3-AOI log-ratio) — persisted NASA-raw artifacts; the unified evaluation table is in the model card." },
  ];
  const [dl, setDl] = useState<{ has_torch: boolean; status?: string; models: Array<Record<string, string>> } | null>(null);
  const [hgb, setHgb] = useState<Record<string, unknown> | null>(null);
  const [tsm, setTsm] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.dlInfo().then(setDl).catch((e) => setErr(describeError(e)));
    fetch("/api/firms/ml-status?aoi=vietnam&data=raw").then((r) => r.json()).then(setHgb).catch(() => undefined);
    fetch("/api/firms/ts-status?aoi=vietnam&data=raw").then((r) => r.json()).then(setTsm).catch(() => undefined);
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
                <b>HGB calibrator (ml_b2res_v4, sklearn)</b> · PERSISTED, ?method=ml<br />
                unified MAE {String((hgb as { unified_eval?: { metrics?: { hgb_b2res_v4?: { mae?: number } } } }).unified_eval?.metrics?.hgb_b2res_v4?.mae?.toFixed(1) ?? "?")}
                {" "}· n={(hgb as { unified_eval?: { n_eval?: number } }).unified_eval?.n_eval ?? "?"}
                {" "}· gate: {(hgb as { residual_enabled?: boolean }).residual_enabled
                  ? "residual ON"
                  : `ABSTAINS → serves ${String((hgb as { fallback_baseline?: string }).fallback_baseline ?? "baseline")}`}<br />
                best on this sample: {String((hgb as { unified_eval?: { best_method?: string } }).unified_eval?.best_method ?? "?")} · xem /xray
              </li>
            )}
            {tsm && (tsm as { trained?: boolean }).trained !== false && (
              <li className="rounded border border-amber-500 p-2 font-mono text-xs">
                <b>SeasonTransformer (ts_logratio_pool_v2, {(tsm as { params?: number }).params} params)</b> · PERSISTED, ?method=ts<br />
                pooled 3 AOI + AOI-embedding + log-ratio target · unified MAE {String((tsm as { unified_eval?: { metrics?: { ts_logratio_pool_v2?: { mae?: number } } } }).unified_eval?.metrics?.ts_logratio_pool_v2?.mae?.toFixed(1) ?? "?")}
                {" "}· seed range {JSON.stringify((tsm as { unified_eval?: { ts_unified_seed_mae_range?: number[] } }).unified_eval?.ts_unified_seed_mae_range ?? (tsm as { seed_mae_range?: number[] }).seed_mae_range ?? [])}<br />
                honest: pooled beats B1 but loses to B2 on every AOI; full-month pool 1782 vs B2 1061 · xem /xray
              </li>
            )}
          </ul>
        ) : <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
      </div>
      <div className="card-glow rounded-lg border bg-card p-4">
        <h2 className="font-bold">{t("method.honesty")}</h2>
        <ul className="list-disc pl-6 text-sm text-muted-foreground">
          <li>{lang === "vi"
            ? "stat là mặc định; ml/ts là artifact NASA raw đã lưu. Unified eval (2025, n=36): HGB-gated 1263 thắng pooled, B2 868 thắng việt nam, B2 1255 thắng amazon, B1 1666 thắng australia; TS 1798 thua B2. Không có model nào thắng mọi vùng."
            : "stat is the default; ml/ts are persisted NASA-raw artifacts. Unified eval (2025, n=36): gated HGB 1263 wins pooled, B2 868 wins vietnam, B2 1255 wins amazon, B1 1666 wins australia; TS 1798 loses to B2. No model wins every region."}</li>
          <li>{lang === "vi"
            ? "Gate HGB tự abstain khi blocked CV không thấy gain ≥2%, win đa số fold và không regress fold mới nhất; metadata ghi rõ fallback."
            : "The HGB gate abstains unless blocked CV shows ≥2% gain, a majority of folds, and no regression on the latest fold; metadata records the fallback."}</li>
          <li>Leave-one-year-out anomaly baseline; coverage comes from the request ledger, not detection days.</li>
          <li>MODIS-only cells are estimates (coverage unknown); upscaled FRP is null. <Link className="underline" to="/ask">{t("nav.ask")}</Link>.</li>
        </ul>
      </div>
    </div>
  );
}
