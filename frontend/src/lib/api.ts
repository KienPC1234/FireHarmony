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
    matrix: number[][];
    anomalies: number[][];
    row_totals: number[];
    col_medians: number[];
  };
  critical_periods: Array<{ year: number; month: number; count: number; z: number; label: string }>;
  latest: { date: string; month: number; month_total: number; hist_median: number; ratio: number | null; verdict: string } | null;
  bbox?: string | null;
  daily: Array<Record<string, number | string>>;
  ms?: number;
}

export const api = {
  health: () => get<{ status: string; torch: boolean }>("/api/health"),
  schema: () => get<{ fields: string[] }>("/api/firms/schema"),
  sample: (limit = 200) => get<{ count: number; records: Record<string, unknown>[] }>(`/api/firms/sample?limit=${limit}`),
  calendar: (limit = 25000, bbox?: string) =>
    get<CalendarResponse>(`/api/firms/calendar?limit=${limit}${bbox ? `&bbox=${encodeURIComponent(bbox)}` : ""}`),
  harmonize: (records: Record<string, unknown>[]) =>
    post<CalendarResponse>("/api/firms/harmonize", { records }),
  validate: (records: Record<string, unknown>[]) =>
    post<{ clean: number; rejected: number; qa_counts: Record<string, number> }>(
      "/api/firms/validate", { records },
    ),
  dlInfo: () => get<{ has_torch: boolean; models: Array<Record<string, string>> }>("/api/firms/dl-info"),
  exportUrl: (limit = 25000, bbox?: string) => `${BASE}/api/firms/export?limit=${limit}${bbox ? `&bbox=${encodeURIComponent(bbox)}` : ""}`,
};

export function describeError(e: unknown): string {
  if (e instanceof ApiError) return typeof e.detail === "string" ? e.detail : e.message;
  return e instanceof Error ? e.message : String(e);
}
