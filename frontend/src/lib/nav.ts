import { CalendarDays, FlaskConical, House, Info, MessagesSquare, ScanEye } from "lucide-react";
import { useLang } from "@/lib/i18n";

export type NavItem = { to: string; label: string; icon: typeof House; end?: boolean; hint?: string };

export function useNav() {
  const { t } = useLang();
  const nav = [
    {
      label: "Fire calendar",
      items: [
        { to: "/", icon: House, end: true, label: t("nav.home"), hint: "Upload FIRMS CSV, run harmonization" },
        { to: "/calendar", icon: CalendarDays, label: t("nav.calendar"), hint: "Month x year matrix + anomalies" },
        { to: "/xray", icon: ScanEye, label: t("nav.xray"), hint: "Before/after + holdout error" },
        { to: "/ask", icon: MessagesSquare, label: t("nav.ask"), hint: "Rule-based explainer" },
      ],
    },
    {
      label: "Project",
      items: [
        { to: "/method", icon: FlaskConical, label: t("nav.method"), hint: "Harmonization + experimental ML" },
        { to: "/about", icon: Info, label: t("nav.about"), hint: "Sources, limits, download" },
      ],
    },
  ];
  return { nav, flat: nav.flatMap((g) => g.items) };
}

export const PREFETCH: Record<string, () => Promise<unknown>> = {
  "/": () => import("@/pages/home"),
  "/calendar": () => import("@/pages/calendar"),
  "/ask": () => import("@/pages/ask"),
  "/xray": () => import("@/pages/xray"),
  "/method": () => import("@/pages/method"),
  "/about": () => import("@/pages/about"),
};
