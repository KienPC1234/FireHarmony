/**
 * Cloudflare Turnstile loader + widget controller (no React, no dependency).
 *
 * The widget is rendered once per gate with `execution: "execute"` and
 * `appearance: "interaction-only"`: it stays invisible while Cloudflare can
 * verify silently and only shows a checkbox when it really needs a human.
 * Tokens are single-use, so every call to `solve()` resets and re-executes the
 * widget to fetch a fresh one.
 */

export interface TurnstileConfig {
  enabled: boolean;
  site_key: string;
}

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SOLVE_TIMEOUT_MS = 25_000;
const SCRIPT_TIMEOUT_MS = 8_000;

let loader: Promise<TurnstileApi | null> | null = null;

/** Load the Turnstile script once; resolves `null` when it cannot load. */
export function loadTurnstile(): Promise<TurnstileApi | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loader) {
    const promise = new Promise<TurnstileApi | null>((resolve) => {
      let settled = false;
      const script = document.createElement("script");
      const finish = (api: TurnstileApi | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        // Drop a broken tag so the next send can retry cleanly.
        if (!api) script.remove();
        resolve(api);
      };
      // A stalled CDN/extension must not leave `solve()` hanging forever.
      const timer = window.setTimeout(() => finish(window.turnstile ?? null), SCRIPT_TIMEOUT_MS);
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.dataset.turnstile = "1";
      script.addEventListener("load", () => finish(window.turnstile ?? null), { once: true });
      script.addEventListener("error", () => finish(null), { once: true });
      document.head.appendChild(script);
    });
    // On failure, clear the memo so a later send retries instead of staying
    // broken for the whole page session (transient CDN/ad-block hiccups).
    loader = promise.then((api) => {
      if (!api) loader = null;
      return api;
    });
  }
  return loader;
}

export interface TurnstileHandle {
  /** Resolve a fresh token, or "" when the check could not complete. */
  solve: () => Promise<string>;
  dispose: () => void;
}

export async function createTurnstile(
  container: HTMLElement,
  siteKey: string,
  onError?: (code: string) => void,
): Promise<TurnstileHandle | null> {
  const api = await loadTurnstile();
  if (!api) return null;

  let widgetId: string | null = null;
  let pending: ((token: string) => void) | null = null;

  const settle = (token: string) => {
    const resolve = pending;
    pending = null;
    resolve?.(token);
  };

  const ensureWidget = () => {
    if (widgetId) return widgetId;
    widgetId = api.render(container, {
      sitekey: siteKey,
      execution: "execute",
      appearance: "interaction-only",
      theme: "dark",
      retry: "auto",
      callback: (token: string) => settle(token),
      "error-callback": (code?: string) => {
        onError?.(String(code ?? "unknown"));
        settle("");
      },
      "timeout-callback": () => settle(""),
      "expired-callback": () => settle(""),
    });
    return widgetId;
  };

  return {
    solve: () =>
      new Promise<string>((resolve) => {
        let timedOut = false;
        const timer = window.setTimeout(() => {
          timedOut = true;
          settle("");
        }, SOLVE_TIMEOUT_MS);
        pending = (token) => {
          window.clearTimeout(timer);
          resolve(timedOut ? "" : token);
        };
        try {
          const id = ensureWidget();
          api.reset(id);
          api.execute(id);
        } catch {
          settle("");
        }
      }),
    dispose: () => {
      if (!widgetId) return;
      try {
        api.remove(widgetId);
      } catch {
        // Widget may already be gone after a hot reload.
      }
      widgetId = null;
    },
  };
}
