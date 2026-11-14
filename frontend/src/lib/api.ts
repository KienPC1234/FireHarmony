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
 * Sentinel message for "the request hit the Anubis bot-guard challenge page
 * instead of the API" (HTTP 200 + HTML, so `res.ok` is true). Callers map it
 * to a localized "reload and re-solve" hint; it is never shown raw.
 */
export const BOT_GUARD_CHALLENGE = "BOT_GUARD_CHALLENGE";

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

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Proxies and gateways answer with HTML/plain text on 502/504; keep that
    // body so the caller still sees status + text instead of a SyntaxError.
    if (!res.ok) return text;
    throw new ApiError(res.status, "Malformed JSON response from the API", text);
  }
}

async function request<T>(path: string, init?: RequestInitWithTimeout): Promise<T> {
  let res: Response;
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: extSignal, ...rest } = init ?? {};
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onExtAbort = () => controller.abort();
  if (extSignal) {
    if (extSignal.aborted) {
      clearTimeout(timeoutId);
      throw new ApiError(408, "Request cancelled.", extSignal.reason);
    }
    extSignal.addEventListener("abort", onExtAbort, { once: true });
  }
  try {
    res = await fetch(`${BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) },
    });
  } catch (e: unknown) {
    const isAbort = (e as { name?: string })?.name === "AbortError";
    if (isAbort) {
      if (extSignal?.aborted) throw new ApiError(408, "Request cancelled.", e);
      throw new ApiError(
        408,
        `Request timed out after ${Math.round(timeoutMs / 1000)}s. Try switching to sample data or narrower bounds.`,
        e,
      );
    }
    throw new ApiError(0, "Cannot reach the API. Is the backend running on :8000?", e);
  } finally {
    clearTimeout(timeoutId);
    extSignal?.removeEventListener("abort", onExtAbort);
  }
  const body = await readBody(res);
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`, body);
  return body as T;
}

const get = <T,>(path: string, timeoutMs?: number, signal?: AbortSignal) =>
  request<T>(path, { method: "GET", timeoutMs, signal });

const CACHE_TTL_MS = 5 * 60 * 1000;
const responseCache = new Map<string, { ts: number; value: unknown }>();
const inflightRequests = new Map<string, Promise<unknown>>();

function cachedGet<T>(path: string, timeoutMs?: number, signal?: AbortSignal): Promise<T> {
  const now = Date.now();
  const hit = responseCache.get(path);
  if (hit && now - hit.ts < CACHE_TTL_MS) {
    return Promise.resolve(hit.value as T);
  }
  const existing = inflightRequests.get(path);
  if (existing && !signal) {
    return existing as Promise<T>;
  }
  const p = get<T>(path, timeoutMs, signal).then((val) => {
    responseCache.set(path, { ts: Date.now(), value: val });
    return val;
  }).finally(() => {
    if (inflightRequests.get(path) === p) {
      inflightRequests.delete(path);
    }
  });
  if (!signal) inflightRequests.set(path, p);
  return p;
}

export function clearApiCache(): void {
  responseCache.clear();
  inflightRequests.clear();
}

const post = <T,>(path: string, body?: unknown, timeoutMs?: number, signal?: AbortSignal) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}), timeoutMs, signal });

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
    platform_mix?: Record<string, Record<string, number>>;
    anomaly_n_years?: unknown;
    anomaly_reason?: unknown;
    anomaly_eligibility?: unknown;
    anomaly_baseline?: unknown;
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
  monthly?: Record<string, unknown>;
  filters?: Record<string, unknown>;
  validation_unit?: string;
  spatial_validation?: unknown;
  anomaly_n_years?: unknown;
  anomaly_reason?: unknown;
  anomaly_eligibility?: unknown;
  anomaly_baseline?: unknown;
  empty_filter?: boolean;
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
  from_date?: string | null;
  to_date?: string | null;
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
  months_with_both_sensors?: number;
  k_by_month?: Record<string, number | null>;
  ratio_mode?: string;
  calendar?: unknown;
}
export interface SimResponse {
  aoi: string; data: string; year: number;
  validation_unit: string; note: string;
  platforms_present?: string[];
  coverage?: unknown;
  simulations: SimRow[];
}
export interface BlindSpotDay {
  day: number; date: string;
  modis_requested: boolean | null;
  viirs_requested: boolean | null;
  modis_detections: number;
  viirs_detections: number;
  status: string;
  clear_sky_verified?: boolean | null;
}
export interface BlindSpotCoverage {
  partial?: boolean | null;
  nrt?: boolean | null;
  coverage_class?: string;
  coverage_status?: string;
  coverage_ratio?: number | null;
  paired_days?: number | null;
  days_in_month?: number | null;
  missing_days?: number[];
  sparse_detections?: boolean;
}
export interface BlindSpotResponse {
  aoi: string; data: string; ym: string;
  coverage_class: string;
  /** Month-level ledger entry (partial/NRT flags); null when unknown. */
  coverage?: BlindSpotCoverage | null;
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
  aoi_month?: string;
  res_deg?: number;
  k_used?: unknown;
}
export interface CrossResponse {
  available: boolean; reason?: string;
  n?: number; pearson?: number | null; spearman?: number | null;
  caveat?: string;
  joined?: Array<{ ym: string; activity_index: number; burned_area: number }>;
}

export interface Aoi {
  id: string;
  label: string;
  bbox?: string | null;
  months?: number;
  coverage_class?: string;
  dataset_ready?: boolean;
}

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
  primary_method_id?: string;
  primary_gate?: Record<string, unknown> | null;
  pooled_full_month?: unknown;
  excluded_months?: unknown;
  coverage_class?: string;
  coverage?: unknown;
  n_test_full?: number;
  note?: string;
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
    stan_pred: number | null;
    hts_pred: number | null;
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
  health: () => get<{ status: string; torch: boolean; service?: string; uptime_s?: number; primary_method_id?: string; baseline_method_id?: string; methods_available?: string[] }>("/api/health"),
  progress: (aoi = "vietnam", data = "raw") =>
    get<{ aoi: string; data: string; stage: string; percent: number; detail: string }>(`/api/firms/progress?aoi=${aoi}&data=${data}`),
  schema: () => get<{ fields: string[] }>("/api/firms/schema"),
  sample: (limit = 200, aoi = "vietnam") => get<{ count: number; records: Record<string, unknown>[] }>(`/api/firms/sample?limit=${limit}&aoi=${aoi}`),
  aois: () => cachedGet<{ aois: Aoi[] }>("/api/firms/aois"),
  /** CLAIM-024: register a custom AOI in the server registry.
   * POST /api/firms/aois {id?, label, bbox:[minLon,minLat,maxLon,maxLat]}
   * -> {id, label, bbox:"x0,y0,x1,y1"} (400 invalid, 409 duplicate).
   * Clears the shared GET cache so a fresh GET /aois sees the entry. */
  createAoi: async (label: string, bbox: [number, number, number, number], id?: string) => {
    const created = await post<{ id: string; label: string; bbox: string }>(
      "/api/firms/aois", id ? { id, label, bbox } : { label, bbox });
    clearApiCache();
    return created;
  },
  deleteAoi: async (aoiId: string): Promise<{ ok: boolean; deleted: string }> => {
    const res = await request<{ ok: boolean; deleted: string }>(
      `/api/firms/aois/${encodeURIComponent(aoiId)}`,
      { method: "DELETE" },
    );
    clearApiCache();
    return res;
  },
  fetchLiveFirms: async (params: {
    bbox: [number, number, number, number];
    days?: number;
    end_date?: string | null;
    from_date?: string | null;
    to_date?: string | null;
    aoi?: string | null;
    use_sample?: boolean;
  }): Promise<{
    ok: boolean;
    dataset: string;
    rows: number;
    sample_rows?: number;
    live_rows?: number;
    sources_fetched: string[];
    bbox: number[];
    requested_range?: [string, string];
    date_range: [string | null, string | null];
    cached?: boolean;
    cache_hits?: number;
    network_fetches?: number;
    warnings: string[];
  }> => {
    const res = await post<{
      ok: boolean;
      dataset: string;
      rows: number;
      sources_fetched: string[];
      bbox: number[];
      requested_range?: [string, string];
      date_range: [string | null, string | null];
      cached?: boolean;
      cache_hits?: number;
      network_fetches?: number;
      warnings: string[];
    }>("/api/firms/fetch-live", params, RAW_TIMEOUT_MS);
    clearApiCache();
    return res;
  },
  dataStatus: () => cachedGet<{ datasets: Array<{ aoi: string; sample_rows: number; sample_bytes: number; raw_ready?: boolean; dataset_ready?: boolean; raw_files?: number; date_range?: [string, string] | null; full_months?: number }> ; raw_count: number; raw_files: Array<{ file: string; bytes: number }> }>("/api/firms/data-status"),
  htsStatus: () => cachedGet<{ trained: boolean; candidate?: boolean; served?: boolean; n_test?: number; hts_mae?: number; b2_mae?: number; mean_gain_vs_b2?: number; per_aoi?: Record<string, MetricRow>; comparisons?: Record<string, ComparisonRow>; gate?: { rule: string; passed: boolean }; series?: Record<string, unknown> }>("/api/firms/hts-status"),
  stanStatus: () => cachedGet<{ trained: boolean; candidate?: boolean; served?: boolean; safe?: Record<string, unknown>; retrospective?: Record<string, unknown> }>("/api/firms/stan-status"),
  calendar: (
    limit = 25000, bbox?: string, aoi = "vietnam", data = "raw",
    method = "stat", dataset?: string, qa_min = "all", platform_set = "all",
    geometry?: string, from_date?: string, to_date?: string,
    source_type = "all", signal?: AbortSignal,
    daynight = "all", min_frp = 0,
  ) =>
    cachedGet<CalendarResponse>(`/api/firms/calendar?limit=${limit}&aoi=${aoi}&data=${data}&method=${method}&qa_min=${qa_min}&platform_set=${platform_set}&source_type=${source_type}${daynight && daynight !== "all" ? `&daynight=${daynight}` : ""}${min_frp > 0 ? `&min_frp=${min_frp}` : ""}${bbox ? `&bbox=${encodeURIComponent(bbox)}` : ""}${dataset ? `&dataset=${encodeURIComponent(dataset)}` : ""}${geometry ? `&geometry=${encodeURIComponent(geometry)}` : ""}${from_date ? `&from_date=${from_date}` : ""}${to_date ? `&to_date=${to_date}` : ""}`, dataTimeout(data), signal),
  mapCells: (
    ym: string, bbox?: string, aoi = "vietnam", data = "raw",
    method = "stat", dataset?: string, qa_min = "all", platform_set = "all",
    geometry?: string, zoom = 6, from_date?: string, to_date?: string,
    source_type = "all", signal?: AbortSignal, max_cells?: number,
    daynight = "all", min_frp = 0,
  ) =>
    cachedGet<MapCellsResponse>(`/api/firms/map-cells?ym=${ym}&aoi=${aoi}&data=${data}&method=${method}&qa_min=${qa_min}&platform_set=${platform_set}&source_type=${source_type}&zoom=${zoom}${daynight && daynight !== "all" ? `&daynight=${daynight}` : ""}${min_frp > 0 ? `&min_frp=${min_frp}` : ""}${bbox ? `&bbox=${encodeURIComponent(bbox)}` : ""}${dataset ? `&dataset=${encodeURIComponent(dataset)}` : ""}${geometry ? `&geometry=${encodeURIComponent(geometry)}` : ""}${from_date ? `&from_date=${from_date}` : ""}${to_date ? `&to_date=${to_date}` : ""}${max_cells != null ? `&max_cells=${max_cells}` : ""}`, dataTimeout(data), signal),
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
  /**
   * P2-07 filter-threading contract. `/evidence` is AOI-month scoped: besides
   * aoi/data/method/year/month/qa_min/platform_set the server only honors a
   * custom `bbox`. `geometry`, `dataset`, `from_date`/`to_date` and
   * `source_type` are accepted here for call-site uniformity but are NOT
   * forwarded, because the card would otherwise imply per-filter evidence
   * the backend never computed. The same applies to `simulate`,
   * `blindSpots` and `spatialCheck` below, which have no bbox parameter
   * server-side at all — their cards always quote the whole AOI.
   */
  evidence: (aoi: string, data: string, method: string, year: number, month: number, qa_min = "all", platform_set = "all", filters?: { bbox?: string; geometry?: string; dataset?: string; from_date?: string; to_date?: string; source_type?: string }) =>
    cachedGet<Record<string, unknown>>(
      `/api/firms/evidence?aoi=${aoi}&data=${data}&method=${method}&year=${year}&month=${month}&qa_min=${qa_min}&platform_set=${platform_set}${filters?.bbox ? `&bbox=${encodeURIComponent(filters.bbox)}` : ""}${filters?.dataset ? `&dataset=${encodeURIComponent(filters.dataset)}` : ""}`, dataTimeout(data)),
  explainMonth: (body: { aoi: string; data: string; method: string; year: number; month: number; question?: string; qa_min?: string; platform_set?: string; use_llm?: boolean; bbox?: string }) =>
    post<{ answer: string; llm_used: boolean; model?: string; evidence: Record<string, unknown>; suggestions: string[] }>(
      "/api/firms/explain-month", body, dataTimeout(body.data)),
  simulate: (aoi: string, data: string, year: number, sensors?: string[], qa_min = "all", platform_set = "all") =>
    cachedGet<SimResponse>(
      `/api/firms/simulate?aoi=${aoi}&data=${data}&year=${year}&qa_min=${qa_min}&platform_set=${platform_set}${sensors?.length ? `&sensors=${encodeURIComponent(sensors.join(","))}` : ""}`, dataTimeout(data)),
  blindSpots: (aoi: string, data: string, year: number, month: number, qa_min = "all", platform_set = "all", dataset?: string) =>
    cachedGet<BlindSpotResponse>(
      `/api/firms/blind-spots?aoi=${aoi}&data=${data}&year=${year}&month=${month}&qa_min=${qa_min}&platform_set=${platform_set}${dataset ? `&dataset=${encodeURIComponent(dataset)}` : ""}`, dataTimeout(data)),
  investigate: (body: { question: string; aoi: string; data: string; method?: string; year?: number; month?: number; use_llm?: boolean; bbox?: string; dataset?: string }) =>
    post<{ answer: string; llm_used: boolean; tools_used: string[]; evidence: Record<string, unknown> | null; limitations: string[]; suggestions: string[]; citations: string[] }>(
      "/api/firms/investigate", body, dataTimeout(body.data)),
  investigateStream: async (
    body: { question: string; aoi: string; data: string; method?: string; year?: number; month?: number; use_llm?: boolean; qa_min?: string; platform_set?: string; bbox?: string; dataset?: string; mode?: string; lang?: string },
    callbacks: {
      onStatus?: (status: { stage: string; detail: string }) => void;
      onTool?: (tool: { name: string; args?: Record<string, unknown>; summary?: string }) => void;
      onMeta?: (meta: {
        tools_used: string[];
        tool_calls?: Array<{ name: string; args?: Record<string, unknown>; summary?: string }>;
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
      if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try {
          const errJson = await res.json();
          const d = errJson?.detail;
          if (typeof d === "string") msg = d;
          else if (d && typeof d.message === "string") msg = d.message;
        } catch {
          // keep status text
        }
        throw new ApiError(res.status, msg);
      }
      if (!res.body) throw new Error("No readable stream response");

      // Anubis answers cookie-less browsers with HTTP 200 + the HTML
      // challenge page (not SSE). Without this check the parser below
      // silently swallows it and the chat ends with an empty answer.
      const streamType = res.headers.get("content-type") ?? "";
      if (!streamType.includes("text/event-stream")) {
        throw new ApiError(419, BOT_GUARD_CHALLENGE);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      const dispatchBlock = (block: string) => {
        const trimmed = block.trim();
        if (!trimmed) return;
        let eventType = "message";
        const dataLines: string[] = [];
        for (const line of trimmed.split(/\r?\n/)) {
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        const dataStr = dataLines.join("\n");
        if (!dataStr) return;
        const parsed = JSON.parse(dataStr);
        if (eventType === "status" && callbacks.onStatus) {
          callbacks.onStatus(parsed);
        } else if (eventType === "tool" && callbacks.onTool) {
          callbacks.onTool(parsed);
        } else if (eventType === "meta" && callbacks.onMeta) {
          callbacks.onMeta(parsed);
        } else if (eventType === "delta" && callbacks.onDelta) {
          callbacks.onDelta(parsed.delta ?? "", parsed.llm_used);
        } else if (eventType === "error") {
          finished = true;
          const errObj = new ApiError(Number(parsed.status) || 500, String(parsed.message || "Stream error"));
          if (callbacks.onError) callbacks.onError(errObj);
          else throw errObj;
        } else if (eventType === "done" && callbacks.onDone) {
          finished = true;
          callbacks.onDone(parsed.full_answer ?? "");
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
        }
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = done ? "" : (blocks.pop() ?? "");
        for (const block of blocks) {
          try {
            dispatchBlock(block);
          } catch (e) {
            if (e instanceof ApiError) throw e;
          }
        }
        if (done) {
          if (buffer.trim()) {
            try {
              dispatchBlock(buffer);
            } catch (e) {
              if (e instanceof ApiError) throw e;
            }
          }
          if (!finished && callbacks.onDone) {
            callbacks.onDone("");
          }
          break;
        }
      }
    } catch (err: unknown) {
      const e = err as { name?: string } | null;
      if (e?.name === "AbortError") return;
      if (callbacks.onError) callbacks.onError(err as Error);
      else throw err;
    }
  },
  spatialCheck: (aoi: string, data: string, year: number, month: number, res_deg?: number, signal?: AbortSignal, dataset?: string) =>
    cachedGet<SpatialResponse>(
      `/api/firms/spatial-check?aoi=${aoi}&data=${data}&year=${year}&month=${month}${res_deg != null ? `&res_deg=${res_deg}` : ""}${dataset ? `&dataset=${encodeURIComponent(dataset)}` : ""}`, dataTimeout(data), signal),
  crossValidate: (body: { aoi: string; data: string; series: Array<{ year: number; month: number; burned_area: number }> }) =>
    post<CrossResponse>("/api/firms/cross-validate", body, dataTimeout(body.data)),
  coverage: (aoi = "vietnam", data = "raw") =>
    cachedGet<Record<string, unknown>>(`/api/firms/coverage?aoi=${aoi}&data=${data}`, dataTimeout(data)),
  qaSummary: (aoi: string, data: string) =>
    cachedGet<{ sampled_rows: number; by_confidence: Record<string, number>; by_satellite: Record<string, number>; warnings: string[] }>(
      `/api/firms/qa-summary?aoi=${aoi}&data=${data}`, dataTimeout(data)),
  llmStatus: () => cachedGet<{ llm_available: boolean; provider: string; model: string; models: string[] }>(
    "/api/firms/llm-status"),
  briefUrl: (bbox?: string, aoi = "vietnam", data = "raw", method = "stat", dataset?: string, qa_min = "all", platform_set = "all", source_type = "all") =>
    `${BASE}/api/firms/brief?aoi=${aoi}&data=${data}&method=${method}&qa_min=${qa_min}&platform_set=${platform_set}&source_type=${source_type}${bbox ? `&bbox=${encodeURIComponent(bbox)}` : ""}${dataset ? `&dataset=${encodeURIComponent(dataset)}` : ""}`,
  dlInfo: () => cachedGet<{ has_torch: boolean; models: Array<Record<string, string>> }>("/api/firms/dl-info"),
  exportDetectionsUrl: (
    bbox?: string, aoi = "vietnam", data = "raw", dataset?: string,
    qa_min = "all", platform_set = "all", geometry?: string,
    from_date?: string, to_date?: string, source_type = "all", limit?: number,
  ) => `${BASE}/api/firms/export-detections?aoi=${aoi}&data=${data}&qa_min=${qa_min}&platform_set=${platform_set}&source_type=${source_type}${bbox ? `&bbox=${encodeURIComponent(bbox)}` : ""}${dataset ? `&dataset=${encodeURIComponent(dataset)}` : ""}${geometry ? `&geometry=${encodeURIComponent(geometry)}` : ""}${from_date ? `&from_date=${from_date}` : ""}${to_date ? `&to_date=${to_date}` : ""}${limit != null ? `&limit=${limit}` : ""}`,
  exportUrl: (
    limit = 25000, bbox?: string, aoi = "vietnam", data = "raw",
    method = "stat", dataset?: string, qa_min = "all", platform_set = "all",
    geometry?: string, from_date?: string, to_date?: string, source_type = "all",
  ) => `${BASE}/api/firms/export?limit=${limit}&aoi=${aoi}&data=${data}&method=${method}&qa_min=${qa_min}&platform_set=${platform_set}&source_type=${source_type}${bbox ? `&bbox=${encodeURIComponent(bbox)}` : ""}${dataset ? `&dataset=${encodeURIComponent(dataset)}` : ""}${geometry ? `&geometry=${encodeURIComponent(geometry)}` : ""}${from_date ? `&from_date=${from_date}` : ""}${to_date ? `&to_date=${to_date}` : ""}`,
  uploadDataset: async (file: File): Promise<UploadDatasetResponse> => {
    const form = new FormData();
    form.append("file", file);
    let res: Response;
    try {
      res = await fetch(`${BASE}/api/firms/upload-dataset`, { method: "POST", body: form });
    } catch (e) {
      throw new ApiError(0, "Cannot reach the API. Is the backend running on :8000?", e);
    }
    const body = await readBody(res);
    if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`, body);
    clearApiCache();
    return body as UploadDatasetResponse;
  },
  /** P2-15: admin ingest of a real FIRMS CSV (`POST /api/firms/ingest`).
   * New raw files change every cached card, so the shared GET cache is
   * cleared on success — a stale calendar after ingest is a truth bug. */
  ingest: async (file: File, aoi = "vietnam", source = "upload"): Promise<{
    file: string; bytes: number; sha256: string; aoi: string; source: string;
    rows: number; clean: number; rejected: number;
    errors: Array<Record<string, unknown>>;
  }> => {
    const form = new FormData();
    form.append("file", file);
    let res: Response;
    try {
      res = await fetch(`${BASE}/api/firms/ingest?aoi=${encodeURIComponent(aoi)}&source=${encodeURIComponent(source)}`, { method: "POST", body: form });
    } catch (e) {
      throw new ApiError(0, "Cannot reach the API. Is the backend running on :8000?", e);
    }
    const body = await readBody(res);
    if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`, body);
    clearApiCache();
    return body as {
      file: string; bytes: number; sha256: string; aoi: string; source: string;
      rows: number; clean: number; rejected: number;
      errors: Array<Record<string, unknown>>;
    };
  },
  xray: (aoi = "vietnam", data = "raw", dataset?: string) =>
    cachedGet<{ aoi: string; data_source: string; units: string; backtest_metrics: Record<string, Record<string, number>> | null; stan_trained: boolean; hts_trained: boolean; primary_method_id?: string; primary_gate?: Record<string, unknown>; months: Array<{ year: number; month: number; modis_raw: number; viirs_ref: number; adjusted_stat: number; adjusted_calendar: number | null; k_used: number }>; daily?: Array<{ date: string; modis_raw: number; viirs_ref: number; adjusted_stat: number; k_used: number; mean_frp: number | null }> }>(
      `/api/firms/xray?aoi=${aoi}&data=${data}${dataset ? `&dataset=${encodeURIComponent(dataset)}` : ""}`, dataTimeout(data)),
  backtest: (aoi = "vietnam", data = "raw", test_years?: number, signal?: AbortSignal) =>
    cachedGet<BacktestResponse>(
      `/api/firms/backtest?aoi=${aoi}&data=${data}${test_years != null ? `&test_years=${test_years}` : ""}`, dataTimeout(data), signal),
  /** Download a CSV export as a file instead of navigating to the URL, so a
   * backend 502/timeout surfaces as an inline error instead of a blank page. */
  downloadFile: async (url: string, filename: string, timeoutMs = RAW_TIMEOUT_MS): Promise<void> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url.startsWith("http") ? url : `${BASE}${url}`, { signal: controller.signal });
    } catch (e: unknown) {
      // P2-15: an abort is a server-side timeout, not a dead backend. Report
      // which one so the UI does not tell the user to restart :8000 when the
      // export simply needed a narrower range.
      if ((e as { name?: string })?.name === "AbortError") {
        throw new ApiError(0, `Download timed out after ${Math.round(timeoutMs / 1000)}s. Try a narrower date range or the sample feed.`, e);
      }
      throw new ApiError(0, "Cannot reach the API. Is the backend running on :8000?", e);
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) {
      const text = (await res.text()).slice(0, 2000);
      throw new ApiError(res.status, `${res.status} ${res.statusText}`, text);
    }
    try {
      // Contract de-frag: surface export metadata when the server exposes it.
      // CORS must explicitly expose X-* headers; missing headers are fine.
      res.headers.get("X-Row-Count");
      res.headers.get("X-Filter-Hash");
    } catch {
      // Ignore: headers simply aren't visible without CORS exposure.
    }
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
    }
  },
};

export function describeError(e: unknown): string {
  if (e instanceof ApiError) return typeof e.detail === "string" ? e.detail : e.message;
  return e instanceof Error ? e.message : String(e);
}

/**
 * Extract a backend `error_code` from an ApiError. FastAPI wraps it as
 * `{detail: {error_code}}`, while some fixtures/proxies use a top-level
 * `error_code`; check both so callers can tell "server has no raw" apart
 * from "this filter matched no rows" (both surface as 404 `no_raw_data`).
 */
export function readErrorCode(e: unknown): string | undefined {
  const d = (e as ApiError)?.detail as unknown;
  if (d && typeof d === "object") {
    const rec = d as Record<string, unknown>;
    if (typeof rec.error_code === "string") return rec.error_code;
    const inner = rec.detail as Record<string, unknown> | undefined;
    if (inner && typeof inner.error_code === "string") return inner.error_code;
  }
  return undefined;
}

/**
 * Prefer the nested `calendar.platform_mix` (backend canonical location)
 * with fallback to the legacy top-level `platform_mix`. Both stay optional
 * so existing call-sites keep working.
 */
export function getPlatformMix(
  cal: CalendarResponse,
): Record<string, Record<string, number>> | undefined {
  return cal.calendar?.platform_mix ?? cal.platform_mix;
}
