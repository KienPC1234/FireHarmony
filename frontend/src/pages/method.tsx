import { useEffect, useState } from "react";
import { api, describeError } from "@/lib/api";

export function MethodPage() {
  const [dl, setDl] = useState<{ has_torch: boolean; models: Array<Record<string, string>> } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.dlInfo().then(setDl).catch((e) => setErr(describeError(e)));
  }, []);
  return (
    <div className="prose max-w-3xl">
      <h1>Method: harmonization + deep learning</h1>
      <ol>
        <li><b>Standardize:</b> FIRMS CSV → one Pydantic schema (MODIS C6.1 + VIIRS V2), deterministic QA flags (geometry, confidence, FRP sanity). Bad rows are quarantined, never silently dropped.</li>
        <li><b>Grid:</b> daily 0.05° cells (~5 km), per-sensor count + FRP sums. Missing sensor = 0, not NaN; pre-2012 cells are MODIS-only by history.</li>
        <li><b>Calibrate (statistics):</b> per-month efficiency ratio k = median(MODIS/VIIRS) on overlap cell-days (fallback 0.35 from literature); quantile-map VIIRS FRP onto MODIS climatology.</li>
        <li><b>Calibrate (deep learning ★):</b> MLP residual <code>CrossSensorCalibrator</code> (6→32→32→1, 2.3k params, Huber loss) corrects the blend from VIIRS count/FRP + climatology + month + lat. Conv1d autoencoder <code>FireSeasonAE</code> scores unusual 12-month season shapes by reconstruction MAE.</li>
        <li><b>Calendar:</b> month × year matrix of harmonized counts; anomaly z = (value − median_same_month) / MAD — robust so one mega-fire year cannot drag the baseline.</li>
      </ol>
      <h2>Why VIIRS ≠ MODIS</h2>
      <p>1 km vs 375 m pixels, different sensitivities and overpass times. Raw counts overstate recent years; the calendar above is the first view where the sensor of origin no longer matters.</p>
      <h2>Models on this server</h2>
      {err ? <p>{err}</p> : dl ? <pre>{JSON.stringify(dl, null, 2)}</pre> : <p>Loading…</p>}
    </div>
  );
}
