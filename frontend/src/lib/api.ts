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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (e) {
    throw new ApiError(0, "Cannot reach the API. Is the backend running on :8000?", e);
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`, body);
  return body as T;
}

const get = <T,>(path: string) => request<T>(path, { method: "GET" });
const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });

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
  qa?: { clean: number; rejected: number; qa_counts: Record<string, number> };
  bbox?: string | null;
  daily: Array<Record<string, number | string | null>>;
  ms?: number;
}

export interface Aoi { id: string; label: string }

export interface AskResponse {
  answer: string;
  facts: Record<string, number | string | number[] | null>;
  suggestions: string[];
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
  dataStatus: () => get<{ datasets: Array<{ aoi: string; sample_rows: number; sample_bytes: number }>; raw_count: number; raw_files: Array<{ file: string; bytes: number }> }>("/api/firms/data-status"),
  calendar: (limit = 25000, bbox?: string, aoi = "vietnam", data = "sample", method = "stat", dataset?: string) =>
    get<CalendarResponse>(`/api/firms/calendar?limit=${limit}&aoi=${aoi}&data=${data}&method=${method}${bbox ? `&bbox=${encodeURIComponent(bbox)}` : ""}${dataset ? `&dataset=${encodeURIComponent(dataset)}` : ""}`),
  harmonize: (records: Record<string, unknown>[]) =>
    post<CalendarResponse>("/api/firms/harmonize", { records }),
  validate: (records: Record<string, unknown>[]) =>
    post<{ clean: number; rejected: number; qa_counts: Record<string, number> }>(
      "/api/firms/validate", { records },
    ),
  ask: (question: string, opts?: { aoi?: string; data?: string; bbox?: string }) =>
    post<AskResponse>("/api/firms/ask", { question, ...opts }),
  askLlm: (question: string, opts?: { aoi?: string; data?: string; bbox?: string }) =>
    post<AskResponse & { llm_used: boolean; model?: string; provider?: string; reason?: string }>(
      "/api/firms/ask-llm", { question, ...opts }),
  llmStatus: () => get<{ llm_available: boolean; provider: string; model: string; models: string[] }>(
    "/api/firms/llm-status"),
  briefUrl: (bbox?: string, aoi = "vietnam", data = "sample", method = "stat", dataset?: string) =>
    `${BASE}/api/firms/brief?aoi=${aoi}&data=${data}&method=${method}${bbox ? `&bbox=${encodeURIComponent(bbox)}` : ""}${dataset ? `&dataset=${encodeURIComponent(dataset)}` : ""}`,
  dlInfo: () => get<{ has_torch: boolean; models: Array<Record<string, string>> }>("/api/firms/dl-info"),
  exportUrl: (limit = 25000, bbox?: string, aoi = "vietnam", data = "sample", method = "stat", dataset?: string) => `${BASE}/api/firms/export?limit=${limit}&aoi=${aoi}&data=${data}&method=${method}${bbox ? `&bbox=${encodeURIComponent(bbox)}` : ""}${dataset ? `&dataset=${encodeURIComponent(dataset)}` : ""}`,
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
      `/api/firms/xray?aoi=${aoi}&data=${data}`),
  backtest: (aoi = "vietnam", data = "sample") =>
    get<{ metrics: Record<string, Record<string, number>>; train_years: number[]; test_years: number[]; months: Array<{ year: number; month: number; modis: number; viirs_ref: number; ml_pred: number; ts_pred: number | null }> }>(
      `/api/firms/backtest?aoi=${aoi}&data=${data}`),
};

export function describeError(e: unknown): string {
  if (e instanceof ApiError) return typeof e.detail === "string" ? e.detail : e.message;
  return e instanceof Error ? e.message : String(e);
}
