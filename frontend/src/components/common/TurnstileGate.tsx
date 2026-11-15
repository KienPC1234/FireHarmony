import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { createTurnstile, type TurnstileHandle } from "@/lib/turnstile";

export interface TurnstileGateHandle {
  /** True when this viewer must pass the check (public/tunnelled traffic). */
  readonly enabled: boolean;
  /** Fresh single-use token, or "" when disabled or the check failed. */
  solve: () => Promise<string>;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Inline Cloudflare Turnstile gate for the AI and upload controls.
 *
 * Invisible while Cloudflare can verify silently (`interaction-only`); it only
 * shows a checkbox when a human is actually needed. The backend decides
 * whether the check applies, so direct `127.0.0.1:8000` usage (dev, e2e,
 * prewarm) renders nothing and sends no token.
 *
 * `solve()` stands on its own: if it is called before the config request or
 * the Cloudflare script has finished, it waits for both. Parents can safely
 * submit on the first click and trust `enabled` afterwards.
 */
export const TurnstileGate = forwardRef<TurnstileGateHandle, { className?: string }>(
  function TurnstileGate({ className }, ref) {
    const { t } = useLang();
    const hostRef = useRef<HTMLDivElement | null>(null);
    const handleRef = useRef<TurnstileHandle | null>(null);
    const readyRef = useRef<Promise<TurnstileHandle | null> | null>(null);
    const siteKeyRef = useRef<string>("");
    const configRef = useRef<Promise<void> | null>(null);
    const [siteKey, setSiteKey] = useState<string>("");
    const [blocked, setBlocked] = useState(false);

    useEffect(() => {
      let alive = true;
      configRef.current = api
        .captchaConfig()
        .then((cfg) => {
          if (alive && cfg.enabled && cfg.site_key) {
            siteKeyRef.current = cfg.site_key;
            setSiteKey(cfg.site_key);
          }
        })
        .catch(() => {
          // Config unreachable: leave the gate off. The backend is the source
          // of truth and will answer 403 `turnstile_required` if it disagrees.
        });
      return () => {
        alive = false;
        configRef.current = null;
      };
    }, []);

    useEffect(() => {
      if (!siteKey || !hostRef.current) return;
      let alive = true;
      const ready = createTurnstile(hostRef.current, siteKey, () => {
        if (alive) setBlocked(true);
      }).then((handle) => {
        if (alive) {
          handleRef.current = handle;
          // Script blocked/unreachable: show the adblock/VPN hint immediately;
          // clear it if a retry eventually loads the widget.
          setBlocked(!handle);
        } else {
          handle?.dispose();
        }
        return handle;
      });
      readyRef.current = ready;
      return () => {
        alive = false;
        readyRef.current = null;
        handleRef.current?.dispose();
        handleRef.current = null;
      };
    }, [siteKey]);

    useImperativeHandle(
      ref,
      () => ({
        get enabled() {
          return Boolean(siteKeyRef.current);
        },
        solve: async () => {
          // 1. Wait for /api/firms/captcha-config if it is still in flight.
          if (!siteKeyRef.current) {
            const pending = configRef.current;
            if (pending) await pending;
            else {
              await sleep(50);
              if (configRef.current) await configRef.current;
            }
          }
          if (!siteKeyRef.current) return "";

          // 2. Wait for the render effect to register the widget factory.
          const deadline = Date.now() + 3000;
          while (!readyRef.current && Date.now() < deadline) await sleep(50);
          if (!readyRef.current) return "";

          const handle = handleRef.current ?? (await readyRef.current);
          return handle ? handle.solve() : "";
        },
      }),
      [],
    );

    if (!siteKey) return null;
    return (
      <div className={className}>
        <div ref={hostRef} data-turnstile-gate="1" aria-label={t("turnstile.label")} />
        {blocked && (
          <p className="text-[11px] leading-snug text-amber-300">{t("turnstile.blocked")}</p>
        )}
      </div>
    );
  },
);
