import { describe, expect, it } from "vitest"

import { compact, formatBytes, num, pct, splitCitations } from "@/lib/utils"

describe("splitCitations", () => {
  it("splits text around a citation", () => {
    const parts = splitCitations("The rate was 1.8 mm/s [NTRS-20180005168].")
    expect(parts).toHaveLength(3)
    expect(parts[0]).toEqual({ type: "text", value: "The rate was 1.8 mm/s " })
    expect(parts[1]).toEqual({
      type: "citation",
      value: "[NTRS-20180005168]",
      docId: "NTRS-20180005168",
    })
    expect(parts[2]).toEqual({ type: "text", value: "." })
  })

  it("handles two citations in one answer", () => {
    const parts = splitCitations("a [NTRS-1] b [PSI-2] c")
    const citations = parts.filter((p) => p.type === "citation")
    expect(citations.map((c) => c.docId)).toEqual(["NTRS-1", "PSI-2"])
  })

  it("leaves text without citations alone", () => {
    expect(splitCitations("no citations here")).toEqual([
      { type: "text", value: "no citations here" },
    ])
  })

  it("does not treat a bracketed number or an unknown prefix as a citation", () => {
    expect(splitCitations("the value [42] stays").every((p) => p.type === "text")).toBe(true)
    expect(splitCitations("see [OTHER-1]").every((p) => p.type === "text")).toBe(true)
  })

  it("returns nothing for an empty answer", () => {
    expect(splitCitations("")).toEqual([])
  })
})

describe("the number formatters", () => {
  it("shows a dash for a missing value", () => {
    expect(pct(null)).toBe("—")
    expect(pct(undefined)).toBe("—")
    expect(pct(Number.NaN)).toBe("—")
    expect(num(null)).toBe("—")
    expect(formatBytes(null)).toBe("—")
  })

  it("turns a fraction into a percentage", () => {
    expect(pct(0.5)).toBe("50%")
    expect(pct(0.1234, 1)).toBe("12.3%")
  })

  it("attaches the byte unit once", () => {
    // compact(13.5e12) + " B" used to produce "13.5T B".
    expect(formatBytes(13.5e12)).toBe("13.5 TB")
    expect(formatBytes(512)).toBe("512 B")
  })

  it("shortens large numbers and leaves small ones alone", () => {
    expect(compact(1500)).toBe("1.5k")
    expect(compact(2_500_000)).toBe("2.5M")
    expect(compact(42)).toBe("42")
  })
})
