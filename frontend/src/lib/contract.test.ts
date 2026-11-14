import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  clearApiCache,
  getPlatformMix,
  type CalendarResponse,
} from "@/lib/api";

afterEach(() => {
  clearApiCache();
  vi.unstubAllGlobals();
});

/** Stub fetch with a JSON body and capture every requested URL. */
function stubJson(body: unknown): string[] {
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      seen.push(String(input));
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return seen;
}

describe("contract_frag client params", () => {
  it("contract_frag_mapCells_forwards_max_cells_when_set_and_omits_when_undefined", async () => {
    let seen = stubJson({ cells: [], returned: 0, total: 0 });
    await api.mapCells(
      "2019-03", undefined, "vietnam", "sample", "stat",
      undefined, "all", "all", undefined, 6,
      undefined, undefined, "all", undefined, 5,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("max_cells=5");

    clearApiCache();
    seen = stubJson({ cells: [], returned: 0, total: 0 });
    await api.mapCells(
      "2019-03", undefined, "vietnam", "sample", "stat",
      undefined, "all", "all", undefined, 6,
      undefined, undefined, "all", undefined, undefined,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain("max_cells");
  });

  it("contract_frag_backtest_forwards_test_years_when_set_and_omits_when_undefined", async () => {
    let seen = stubJson({ months: [] });
    await api.backtest("vietnam", "sample", 3);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("test_years=3");

    clearApiCache();
    seen = stubJson({ months: [] });
    await api.backtest("vietnam", "sample", undefined);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain("test_years");
  });

  it("contract_frag_spatialCheck_forwards_res_deg_when_set_and_omits_when_undefined", async () => {
    let seen = stubJson({});
    await api.spatialCheck("vietnam", "sample", 2019, 3, 0.5);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("res_deg=0.5");

    clearApiCache();
    seen = stubJson({});
    await api.spatialCheck("vietnam", "sample", 2019, 3, undefined);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain("res_deg");
  });

  it("contract_frag_exportDetectionsUrl_forwards_limit_when_set_and_omits_when_undefined", () => {
    const withLimit = api.exportDetectionsUrl(
      undefined, "vietnam", "sample", undefined, "all", "all",
      undefined, undefined, undefined, "all", 1000,
    );
    expect(withLimit).toContain("limit=1000");

    const withoutLimit = api.exportDetectionsUrl(
      undefined, "vietnam", "sample", undefined, "all", "all",
      undefined, undefined, undefined, "all", undefined,
    );
    expect(withoutLimit).not.toContain("limit");
  });
});

describe("contract_frag platform mix", () => {
  const nested = { "2019": { NPP: 10, MODIS: 5 } };
  const top = { "2019": { NPP: 1 } };
  const of = (calendar: unknown, extra?: Record<string, unknown>) =>
    ({ calendar, ...extra }) as unknown as CalendarResponse;

  it("contract_frag_getPlatformMix_prefers_calendar_platform_mix_then_top_level_fallback", () => {
    expect(getPlatformMix(of({ platform_mix: nested }, { platform_mix: top }))).toEqual(nested);
    expect(getPlatformMix(of({}, { platform_mix: top }))).toEqual(top);
    expect(getPlatformMix(of({}))).toBeUndefined();
  });

  it("contract_frag_CalendarResponse_monthly_filters_optional", () => {
    // Type-level lock by assignment: this compiles only while monthly/filters
    // stay optional on CalendarResponse.
    const minimal: CalendarResponse = of({}) as CalendarResponse;
    const monthly: Record<string, unknown> | undefined = minimal.monthly;
    const filters: Record<string, unknown> | undefined = minimal.filters;
    expect(monthly).toBeUndefined();
    expect(filters).toBeUndefined();

    const full: CalendarResponse = {
      ...minimal,
      monthly: { "2019-03": { harmonized: 12 } },
      filters: { qa_min: "all" },
    };
    expect(full.monthly).toEqual({ "2019-03": { harmonized: 12 } });
    expect(full.filters).toEqual({ qa_min: "all" });
  });
});
