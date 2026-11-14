import { describe, expect, it } from "vitest";
import { describeError, ApiError } from "@/lib/api";

describe("describeError", () => {
  it("formats ApiError", () => {
    expect(describeError(new ApiError(404, "404 Not Found"))).toContain("404");
  });
  it("passes through Error", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });
});
