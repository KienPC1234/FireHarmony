import { describe, expect, it } from "vitest";

import { cn, compact, formatBytes, num, pct } from "@/lib/utils";

describe("numeric helpers", () => {
  it("joins class names", () => {
    const off = false;
    expect(cn("a", off && "b", "c")).toBe("a c");
  });
  it("formats percents and counts", () => {
    expect(pct(0.237)).toBe("24%");
    expect(pct(null)).toBe("-");
    expect(compact(13500)).toBe("13.5k");
    expect(num(1234567)).toBe("1,234,567");
  });
  it("formats bytes once", () => {
    expect(formatBytes(1500)).toBe("1.5 KB");
    expect(formatBytes(undefined)).toBe("-");
  });
});
