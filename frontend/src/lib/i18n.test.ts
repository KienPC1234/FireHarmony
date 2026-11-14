import { describe, expect, it } from "vitest";
import { detectDefaultLang } from "./i18n";

describe("detectDefaultLang", () => {
  it("prefers explicit saved localStorage preference", () => {
    expect(detectDefaultLang("en", "Asia/Ho_Chi_Minh", "vi-VN")).toBe("en");
    expect(detectDefaultLang("vi", "America/New_York", "en-US")).toBe("vi");
  });

  it("infers vi for Vietnam timezones when nothing is saved", () => {
    expect(detectDefaultLang(null, "Asia/Ho_Chi_Minh", "en-US")).toBe("vi");
    expect(detectDefaultLang(undefined, "Asia/Saigon", "en-US")).toBe("vi");
  });

  it("infers en for non-Vietnam timezones when nothing is saved", () => {
    expect(detectDefaultLang(null, "America/Los_Angeles", "vi-VN")).toBe("en");
    expect(detectDefaultLang(null, "Europe/London", "en-GB")).toBe("en");
  });
});
