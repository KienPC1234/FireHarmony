/** Typed client for the FIRMS harmonization backend. */
const BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * First raw-data aggregation parses every FIRMS CSV for an AOI (Vietnam is
 * ~3.4M rows) and measured ~150s cold on this machine. Sample data answers in <1s. A single
 * 35s timeout made every raw view abort on a fresh machine, so raw requests
 * get their own budget; the backend caches the result afterwards.
 */
export const DEFAULT_TIMEOUT_MS = 35_000;
export const RAW_TIMEOUT_MS = 240_000;
const dataTimeout = (data?: string) => (data === "raw" ? RAW_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);

type RequestInitWithTimeout = RequestInit & { timeoutMs?: number };

async function request<T>(path: string, init?: RequestInitWithTimeout): Promise<T> {
  let res: Response;
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init ?? {};
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    res = await fetch(`${BASE}${path}`, {
      ...rest,
      signal: rest.signal ?? controller.signal,
      headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) },
    });
  } catch (e: unknown) {
    const isAbort = (e as { name?: string })?.name === "AbortError";
    if (isAbort) {
      throw new ApiError(
        408,
        `Request timed out after ${Math.round(timeoutMs / 1000)}s. Try switching to sample data or narrower bounds.`,
        e,
      );
    }
    throw new ApiError(0, "Cannot reach the API. Is the backend running on :8000?", e);
  } finally {
    clearTimeout(timeoutId);
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`, body);
  return body as T;
}

const get = <T,>(path: string, timeoutMs?: number) =>
  request<T>(path, { method: "GET", timeoutMs });
const post = <T,>(path: string, body?: unknown, timeoutMs?: number) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}), timeoutMs });

export interface CalendarResponse {
  daily_cells: number;
  ratios: Record<string, number>;
  calendar: {
    years: number[];
    months: number[];
    matrix: Array<Array<number | null>>;
    anomalies: Array<Array<number | null>>;
    row_totals: number[];
    col_medians: Array<number | null>;
    coverage?: number[][];
    eligible_mask?: boolean[][];
    z_unit?: string;
    completeness?: Record<string, {
      days: number;
      detection_days?: number;
      span: [string, string];
      partial: boolean | null;
      coverage_status?: "verified" | "unknown";
      coverage_ratio?: number | null;
      observed_days?: number | null;
      missing_days?: number[];
      sparse_detections?: boolean;
    }>;
  };
  critical_periods: Array<{ year: number; month: number; count: number; z: number; label: string }>;
  latest: { date: string; month: number; month_total: number; hist_median: number; hist_years?: number; ratio: number | null; verdict: string } | null;
  forecast: { year: number; month: number; median: number; p25: number; p75: number; n_years: number; method: string } | null;
  aoi?: string;
  data?: string;
  data_source?: string;
  dataset?: string;
  method_id?: string;
  effective_method?: string;
  ml_meta?: Record<string, unknown> | null;
  coverage?: Record<string, unknown>;
  platform_mix?: Record<string, Record<string, number>>;
  calibration?: {
    _calibration_status?: string;
    _n_months?: number;
    _fallback_rel_iqr?: number;
    _calibration_window?: [string, string] | null;
    [key: string]: unknown;
  };
  qa?: { clean: number; rejected: number; qa_counts: Record<string, number> };
  bbox?: string | null;
  daily: Array<Record<string, number | string | null>>;
  from_date?: string | null;
  to_date?: string | null;
  geometry_hash?: string;
  summary?: CalendarSummary;
  ms?: number;
}

export interface CalendarSummary {
  modis_detections: number;
  viirs_detections: number;
  sensor_detections_total: number;
  harmonized_total: number;
  paired_cells: number;
  modis_only_cells: number;
  viirs_only_cells: number;
  estimated_cells: number;
  estimated_index: number | null;
  n_daily_cells_total: number;
  n_daily_cells_returned: number;
  period: { from: string | null; to: string | null };
  source_scope: "nasa_firms_observed" | "synthetic_demo_not_observed" | "user_upload_unverified";
  data_source: string;
  method: string;
  method_id?: string;
  effective_method?: string;
  filter_hash: string;
  filters: Record<string, string>;
  note: string;
}

export interface MapCellsResponse {
  aoi: string;
  data: string;
  ym: string;
  zoom: number;
  bbox: string | null;
  geometry_hash: string;
  method_id?: string;
  effective_method?: string;
  cells: Array<{
    cell_id: string; lat: number; lon: number;
    modis_count: number; viirs_count: number;
    harmonized_count: number; days: number; estimate_type: string;
  }>;
  returned: number;
  total: number;
  preview: boolean;
  aggregation_level: string;
  aggregation_note: string;
  capped_at: number;
  filter_hash?: string;
  source_scope?: string;
}

export interface SimRow {
  sensor_config: string;
  allowed_platforms: string[];
  year: number;
  year_total: number;
  delta_vs_all: number | null;
  months: Record<string, number | null>;
  k_measured_months: number;
  months_total: number;
  k_fallback: number;
  viirs_available: boolean;
  modis_available: boolean;
  observed_cells: number;
  estimated_cells: number;
  n_cells: number;
  dropped_cells: number;
}
export interface SimResponse {
  aoi: string; data: string; year: number;
  validation_unit: string; note: string;
  platforms_present?: string[];
  simulations: SimRow[];
}
export interface BlindSpotDay {
  day: number; date: string;
  modis_requested: boolean | null;
  viirs_requested: boolean | null;
  modis_detections: number;
  viirs_detections: number;
  status: string;
}
export interface BlindSpotResponse {
  aoi: string; data: string; ym: string;
  coverage_class: string;
  paired_coverage_ratio: number | null;
  coverage_metric?: string;
  observation_footprint?: string;
  eligibility_threshold?: number;
  status_counts: Record<string, number>;
  days: BlindSpotDay[];
  note: string;
}
export interface SpatialResponse {
  validation_kind: string; claim: string;
  coarse_cells: number; co_observed_cells: number;
  pearson: number | null; spearman: number | null;
  top_decile_jaccard: number | null;
  modis_only_coarse_cells: number;
  modis_detections: number; viirs_detections: number;
  mae_coarse_cell: number | null;
}
export interface CrossResponse {
  available: boolean; reason?: string;
  n?: number; pearson?: number | null; spearman?: number | null;
  caveat?: string;
  joined?: Array<{ ym: string; activity_index: number; burned_area: number }>;
}

export interface Aoi { id: string; label: string }

export interface AskResponse {
  answer: string;
  facts: Record<string, number | string | number[] | null>;
  suggestions: string[];
}

export interface MetricRow {
  mae: number;
  wape: number;
  bias: number;
  n: number;
}
export interface ComparisonRow {
  method_a: string;
  method_b: string;
  delta_mae: number;
  ci95: [number, number];
  prob_a_better: number;
  n: number;
  unit?: string;
}
export interface BacktestResponse {
  aoi: string;
  data: string;
  data_source?: string;
  evaluation_version?: string;
  dataset_sha256?: string;
  metrics: Record<string, MetricRow>;
  pooled_metrics?: Record<string, MetricRow>;
  headline?: {
    scope: string;
    aois: string[];
    n_eval: number;
    metrics: Record<string, MetricRow>;
    why?: string;
  } | null;
  comparisons?: Record<string, ComparisonRow>;
  hgb_residual_enabled?: boolean;
  hgb_gate?: Record<string, unknown> | null;
  sf_lite?: {
    method_id: string;
    deployed: boolean;
    params: number;
    metrics: MetricRow;
    headline?: MetricRow | null;
    per_aoi?: Record<string, MetricRow>;
    comparisons?: Record<string, ComparisonRow>;
    coverage80?: number;
    median_interval_width?: number;
    mean_interval_width?: number;
    quantile_crossings?: number;
    mean_gain_vs_b2?: number;
    b2_mae?: number;
    artifact_verified?: boolean;
    ablation?: Record<string, MetricRow & { coverage80?: number; median_width?: number; mean_interval_width?: number; median_interval_width?: number }>;
  } | null;
  sf_lite_comparison?: ComparisonRow | null;
  sf_lite_deployed?: boolean;
  hts?: {
    method_id: string;
    n_test: number;
    b2_mae: number;
    hts_mae: number;
    mean_gain_vs_b2: number;
    metrics?: MetricRow;
    b2_metrics?: MetricRow;
    headline?: MetricRow | null;
    per_aoi?: Record<string, MetricRow & { b2_mae?: number; hts_mae?: number }>;
    comparisons?: Record<string, ComparisonRow>;
    gate?: { rule: string; passed: boolean };
    status?: string;
    deployed?: boolean;
  } | null;
  hts_comparison?: ComparisonRow | null;
  hts_candidate?: boolean;
  spatial?: {
    method_id: string;
    retrospective: boolean;
    requires_neighbour_viirs: boolean;
    n_test: number;
    headline: MetricRow;
    b2_headline: MetricRow;
    hts_headline: MetricRow;
    safe_headline: MetricRow;
    per_aoi?: Record<string, Record<string, MetricRow>>;
    comparisons?: Record<string, ComparisonRow>;
    spatial_holdout?: { held_tiles: number; spatial_mae: number; hts_mae: number };
    rolling?: Record<string, { pred: number; hts: number; b2: number }>;
  } | null;
  spatial_comparison?: ComparisonRow | null;
  spatial_retrospective?: boolean;
  stan?: {
    method_id: string;
    variant: string;
    retrospective: boolean;
    uses_neighbour_viirs_same_month: boolean;
    params: number;
    metrics: MetricRow;
    hts_metrics: MetricRow;
    official?: {
      n: number;
      metrics: MetricRow;
      hts_metrics: MetricRow;
      b2_metrics: MetricRow;
      headline: MetricRow;
      hts_headline: MetricRow;
      b2_headline: MetricRow;
      per_aoi?: Record<string, Record<string, MetricRow>>;
      comparisons?: Record<string, ComparisonRow>;
    };
  } | null;
  stan_official?: Record<string, unknown> | null;
  stan_candidate?: boolean;
  evaluated?: boolean;
  scored_years?: number[];
  candidate_holdout_years?: number[];
  n_eval?: number;
  n_eval_intersection?: number;
  train_years: number[];
  test_years: number[];
  months: Array<{
    year: number;
    month: number;
    modis: number;
    viirs_ref: number;
    ml_pred: number;
    ts_pred: number | null;
    sf_pred?: number | null;
    b2_pred: number;
  }>;
}

export interface UploadDatasetResponse {
  dataset_id: string;
  rows: number;
  clean: number;
  rejected: number;
  errors?: Array<Record<string, unknown>>;
  calendar_url: string;
}

export const api = {
  health: () => get<{ status: string; torch: boolean }>("/api/health"),
  schema: () => get<{ fields: string[] }>("/api/firms/schema"),
  sample: (limit = 200, aoi = "vietnam") => get<{ count: number; records: Record<string, unknown>[] }>(`/api/firms/sample?limit=${limit}&aoi=${aoi}`),
  aois: () => get<{ aois: Aoi[] }>("/api/firms/aois"),
  dataStatus: () => get<{ datasets: Array<{ aoi: string; sample_rows: number; sample_bytes: number; raw_ready?: boolean; dataset_ready?: boolean; raw_files?: number }>; raw_count: number; raw_files: Array<{ file: string; bytes: number }> }>("/api/firms/data-status"),
  htsStatus: () => get<{ trained: boolean; candidate?: boolean; served?: boolean; n_test?: number; hts_mae?: number; b2_mae?: number; mean_gain_vs_b2?: number; per_aoi?: Record<string, MetricRow>; comparisons?: Record<string, ComparisonRow>; gate?: { rule: string; passed: boolean }; series?: Record<string, unknown> }>("/api/firms/hts-status"),
  stanStatus: () => get<{ trained: boolean; candidate?: boolean; served?: boolean; safe?: Record<string, unknown>; retrospective?: Record<string, unknown> }>("/api/firms/stan-status"),
  spatialStatus: () => get<{ trained: boolean; candidate?: boolean; served?: boolean; retrospective?: boolean; requires_neighbour_viirs?: boolean; headline?: MetricRow; b2_headline?: MetricRow; hts_headline?: MetricRow; safe_headline?: MetricRow; per_aoi?: Record<string, Record<string, MetricRow>>; comparisons?: Record<string, ComparisonRow>; spatial_holdout?: { held_tiles: number; spatial_mae: number; hts_mae: number } }>("/api/firms/spatial-status"),
  calendar: (
    limit = 25000, bbox?: string, aoi = "vietnam", data = "sample",
    method = "stat", dataset?: string, qa_min = "all", platform_set = "all",
    geometry?: string, from_date?: string, to_date?: string,
  ) =>
    get<CalendarResponse>(`/api/firms/calendar?limit=${limit}&aoi=${aoi}&data=${data}&method=${method}&qa_min=${qa_min}&platform_set=${platform_set}${bbox ? `&bbox=${encodeURIComponent(bbox)}` : ""}${dataset ? `&dataset=${encodeURIComponent(dataset)}` : ""}${geometry ? `&geometry=${encodeURIComponent(geometry)}` : ""}${from_date ? `&from_date=${from_date}` : ""}${to_date ? `&to_date=${to_date}` : ""}`, dataTimeout(data)),
  mapCells: (
    ym: string, bbox?: string, aoi = "vietnam", data = "sample",
    method = "stat", dataset?: string, qa_min = "all", platform_set = "all",
    geometry?: string, zoom = 6, from_date?: string, to_date?: string,
  ) =>
    get<MapCellsResponse>(`/api/firms/map-cells?ym=${ym}&aoi=${aoi}&data=${data}&method=${method}&qa_min=${qa_min}&platform_set=${platform_set}&zoom=${zoom}${bbox ? `&bbox=${encodeURIComponent(bbox)}` : ""}${dataset ? `&dataset=${encodeURIComponent(dataset)}` : ""}${geometry ? `&geometry=${encodeURIComponent(geometry)}` : ""}${from_date ? `&from_date=${from_date}` : ""}${to_date ? `&to_date=${to_date}` : ""}`, dataTimeout(data)),
  harmonize: (records: Record<string, unknown>[]) =>
    post<CalendarResponse>("/api/firms/harmonize", { records }),
  validate: (records: Record<string, unknown>[]) =>
    post<{ clean: number; rejected: number; qa_counts: Record<string, number> }>(
      "/api/firms/validate", { records },
    ),
  ask: (question: string, opts?: { aoi?: string; data?: string; bbox?: string; method?: string; qa_min?: string; platform_set?: string }) =>
    post<AskResponse>("/api/firms/ask", { question, ...opts }, dataTimeout(opts?.data)),
  askLlm: (question: string, opts?: { aoi?: string; data?: string; bbox?: string; method?: string; qa_min?: string; platform_set?: string }) =>
    post<AskResponse & { llm_used: boolean; model?: string; provider?: string; reason?: string }>(
      "/api/firms/ask-llm", { question, ...opts }, dataTimeout(opts?.data)),
  evidence: (aoi: string, data: string, method: string, year: number, month: number, qa_min = "all", platform_set = "all") =>
    get<Record<string, unknown>>(
      `/api/firms/evidence?aoi=${aoi}&data=${data}&method=${method}&year=${year}&month=${month}&qa_min=${qa_min}&platform_set=${platform_set}`, dataTimeout(data)),
  explainMonth: (body: { aoi: string; data: string; method: string; year: number; month: number; question?: string; qa_min?: string; platform_set?: string; use_llm?: boolean }) =>
    post<{ answer: string; llm_used: boolean; model?: string; evidence: Record<string, unknown>; suggestions: string[] }>(
      "/api/firms/explain-month", body, dataTimeout(body.data)),
  simulate: (aoi: string, data: string, year: number, sensors?: string[]) =>
    get<SimResponse>(
      `/api/firms/simulate?aoi=${aoi}&data=${data}&year=${year}${sensors?.length ? `&sensors=${encodeURIComponent(sensors.join(","))}` : ""}`, dataTimeout(data)),
  blindSpots: (aoi: string, data: string, year: number, month: number) =>
    get<BlindSpotResponse>(
      `/api/firms/blind-spots?aoi=${aoi}&data=${data}&year=${year}&month=${month}`, dataTimeout(data)),
  investigate: (body: { question: string; aoi: string; data: string; method?: string; year?: number; month?: number; use_llm?: boolean }) =>
    post<{ answer: string; llm_used: boolean; tools_used: string[]; evidence: Record<string, unknown> | null; limitations: string[]; suggestions: string[]; citations: string[] }>(
      "/api/firms/investigate", body, dataTimeout(body.data)),
  investigateStream: async (
    body: { question: string; aoi: string; data: string; method?: string; year?: number; month?: number; use_llm?: boolean },
    callbacks: {
      onMeta?: (meta: {
        tools_used: string[];
        evidence: Record<string, unknown> | null;
        facts: Record<string, unknown>;
        suggestions: string[];
        limitations: string[];
        citations: string[];
      }) => void;
      onDelta?: (delta: string, llm_used?: boolean) => void;
      onDone?: (full_answer: string) => void;
      onError?: (error: Error) => void;
    },
    signal?: AbortSignal,
  ) => {
    try {
      const res = await fetch(`${BASE}/api/firms/investigate-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
      if (!res.body) throw new Error("No readable stream response");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const block of lines) {
          const trimmed = block.trim();
          if (!trimmed) continue;
          let eventType = "message";
          let dataStr = "";
          for (const line of trimmed.split("\n")) {
            if (line.startsWith("event: ")) eventType = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataStr = line.slice(6).trim();
          }
          if (!dataStr) continue;
          try {
            const parsed = JSON.parse(dataStr);
            if (eventType === "meta" && callbacks.onMeta) {
              callbacks.onMeta(parsed);
            } else if (eventType === "delta" && callbacks.onDelta) {
              callbacks.onDelta(parsed.delta ?? "", parsed.llm_used);
            } else if (eventType === "done" && callbacks.onDone) {
              callbacks.onDone(parsed.full_answer ?? "");
            }
          } catch {
            // Partial chunk
          }
        }
      }
    } catch (err: unknown) {
      const e = err as { name?: string } | null;
      if (e?.name === "AbortError") return;
      if (callbacks.onError) callbacks.onError(err as Error);
      else throw err;
    }
  },
  spatialCheck: (aoi: string, data: string, year: number, month: number) =>
    get<SpatialResponse>(
      `/api/firms/spatial-check?aoi=${aoi}&data=${data}&year=${year}&month=${month}`, dataTimeout(data)),
  crossValidate: (body: { aoi: string; data: string; series: Array<{ year: number; month: number; burned_area: number }> }) =>
    post<CrossResponse>("/api/firms/cross-validate", body, dataTimeout(body.data)),
  coverage: (aoi = "vietnam", data = "sample") =>
    get<Record<string, unknown>>(`/api/firms/coverage?aoi=${aoi}&data=${data}`, dataTimeout(data)),
  qaSummary: (aoi: string, data: string) =>
    get<{ sampled_rows: number; by_confidence: Record<string, number>; by_satellite: Record<string, number>; warnings: string[] }>(
      `/api/firms/qa-summary?aoi=${aoi}&data=${data}`, dataTimeout(data)),
  llmStatus: () => get<{ llm_available: boolean; provider: string; model: string; models: string[] }>(
    "/api/firms/llm-status"),
  briefUrl: (bbox?: string, aoi = "vietnam", data = "sample", method = "stat", dataset?: string, qa_min = "all", platform_set = "all") =>
    `${BASE}/api/firms/brief?aoi=${aoi}&data=${data}&method=${method}&qa_min=${qa_min}&platform_set=${platform_set}${bbox ? `&bbox=${encodeURIComponent(bbox)}` : ""}${dataset ? `&dataset=${encodeURIComponent(dataset)}` : ""}`,
  dlInfo: () => get<{ has_torch: boolean; models: Array<Record<string, string>> }>("/api/firms/dl-info"),
  exportDetectionsUrl: (
    bbox?: string, aoi = "vietnam", data = "sample", dataset?: string,
    qa_min = "all", platform_set = "all", geometry?: string,
    from_date?: string, to_date?: string,
  ) => `${BASE}/api/firms/export-detections?aoi=${aoi}&data=${data}&qa_min=${qa_min}&platform_set=${platform_set}${bbox ? `&bbox=${encodeURIComponent(bbox)}` : ""}${dataset ? `&dataset=${encodeURIComponent(dataset)}` : ""}${geometry ? `&geometry=${encodeURIComponent(geometry)}` : ""}${from_date ? `&from_date=${from_date}` : ""}${to_date ? `&to_date=${to_date}` : ""}`,
  exportUrl: (
    limit = 25000, bbox?: string, aoi = "vietnam", data = "sample",
    method = "stat", dataset?: string, qa_min = "all", platform_set = "all",
    geometry?: string, from_date?: string, to_date?: string,
  ) => `${BASE}/api/firms/export?limit=${limit}&aoi=${aoi}&data=${data}&method=${method}&qa_min=${qa_min}&platform_set=${platform_set}${bbox ? `&bbox=${encodeURIComponent(bbox)}` : ""}${dataset ? `&dataset=${encodeURIComponent(dataset)}` : ""}${geometry ? `&geometry=${encodeURIComponent(geometry)}` : ""}${from_date ? `&from_date=${from_date}` : ""}${to_date ? `&to_date=${to_date}` : ""}`,
  uploadDataset: async (file: File): Promise<UploadDatasetResponse> => {
    const form = new FormData();
    form.append("file", file);
    let res: Response;
    try {
      res = await fetch(`${BASE}/api/firms/upload-dataset`, { method: "POST", body: form });
    } catch (e) {
      throw new ApiError(0, "Cannot reach the API. Is the backend running on :8000?", e);
    }
    const text = await res.text();
    const body = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`, body);
    return body as UploadDatasetResponse;
  },
  xray: (aoi = "vietnam", data = "sample") =>
    get<{ aoi: string; data_source: string; units: string; backtest_metrics: Record<string, Record<string, number>> | null; ml_trained: boolean; ts_trained: boolean; ts_meta: Record<string, unknown> | null; months: Array<{ year: number; month: number; modis_raw: number; viirs_ref: number; adjusted_stat: number; adjusted_calendar: number | null; k_used: number }> }>(
      `/api/firms/xray?aoi=${aoi}&data=${data}`, dataTimeout(data)),
  backtest: (aoi = "vietnam", data = "sample") =>
    get<BacktestResponse>(
      `/api/firms/backtest?aoi=${aoi}&data=${data}`, dataTimeout(data)),
};

export function describeError(e: unknown): string {
  if (e instanceof ApiError) return typeof e.detail === "string" ? e.detail : e.message;
  return e instanceof Error ? e.message : String(e);
}
