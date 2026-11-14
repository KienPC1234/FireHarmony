import { beforeEach, describe, expect, it } from "vitest";
import {
  getTourPrefs,
  resolveTourPage,
  saveTourGlobalOptOut,
  saveTourPageStatus,
  shouldPromptTour,
} from "./tour";

describe("tour preferences and routing", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("maps route pathnames to tour page ids", () => {
    expect(resolveTourPage("/")).toBe("home");
    expect(resolveTourPage("/calendar")).toBe("calendar");
    expect(resolveTourPage("/lab")).toBe("lab");
    expect(resolveTourPage("/xray")).toBe("xray");
    expect(resolveTourPage("/evidence")).toBe("evidence");
    expect(resolveTourPage("/investigator")).toBe("investigator");
    expect(resolveTourPage("/ask")).toBe("investigator");
    expect(resolveTourPage("/methods")).toBe("methods");
    expect(resolveTourPage("/method")).toBe("methods");
    expect(resolveTourPage("/guide")).toBe("guide");
    expect(resolveTourPage("/about")).toBe("about");
  });

  it("prompts once per page and persists user choice", () => {
    expect(shouldPromptTour("home")).toBe(true);
    expect(shouldPromptTour("calendar")).toBe(true);

    saveTourPageStatus("home", "dismissed");
    expect(shouldPromptTour("home")).toBe(false);
    expect(shouldPromptTour("calendar")).toBe(true);
    expect(getTourPrefs().pages.home).toBe("dismissed");

    saveTourPageStatus("calendar", "completed");
    expect(shouldPromptTour("calendar")).toBe(false);
  });

  it("respects global opt-out across all pages", () => {
    expect(shouldPromptTour("lab")).toBe(true);
    saveTourGlobalOptOut(true);
    expect(shouldPromptTour("lab")).toBe(false);
    expect(shouldPromptTour("xray")).toBe(false);
    expect(getTourPrefs().globalOptOut).toBe(true);
  });
});
