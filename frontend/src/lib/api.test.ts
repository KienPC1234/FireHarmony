import { afterEach, describe, expect, it, vi } from "vitest";
import { api, describeError, ApiError } from "@/lib/api";

describe("describeError", () => {
  it("formats ApiError", () => {
    expect(describeError(new ApiError(404, "404 Not Found"))).toContain("404");
  });
  it("passes through Error", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });
});

describe("non-JSON responses", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a plain-text error body instead of throwing SyntaxError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("<html>502 Bad Gateway</html>", { status: 502, statusText: "Bad Gateway" })));

    const err = await api.health().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).detail).toContain("Bad Gateway");
    expect(describeError(err)).toContain("502");
  });
});
