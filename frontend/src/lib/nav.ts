import {
  CalendarDays,
  FileCheck2,
  FlaskConical,
  House,
  MessagesSquare,
  Satellite,
} from "lucide-react";
import { useLang } from "@/lib/i18n";

export type NavItem = {
  to: string;
  label: string;
  icon: typeof House;
  end?: boolean;
  hint?: string;
};

export function useNav() {
  const { t } = useLang();
  const nav = [
    {
      label: "Intelligence Lab",
      items: [
        {
          to: "/",
          icon: House,
          end: true,
          label: t("nav.overview"),
          hint: "Product positioning & 30-second problem overview",
        },
        {
          to: "/calendar",
          icon: CalendarDays,
          label: t("nav.calendar"),
          hint: "Activity heatmap & monthly detail drawer",
        },
        {
          to: "/lab",
          icon: Satellite,
          label: t("nav.lab"),
          hint: "Sensor X-Ray, Blind Replay, and Satellite Simulator",
        },
        {
          to: "/evidence",
          icon: FileCheck2,
          label: t("nav.evidence"),
          hint: "Observation & ingestion integrity ledger",
        },
        {
          to: "/investigator",
          icon: MessagesSquare,
          label: t("nav.investigator"),
          hint: "Scientific evidence-grounded analysis",
        },
        {
          to: "/methods",
          icon: FlaskConical,
          label: t("nav.methods"),
          hint: "Pipeline, models, benchmark & limitations",
        },
      ],
    },
  ];
  return { nav, flat: nav.flatMap((g) => g.items) };
}

export const PREFETCH: Record<string, () => Promise<unknown>> = {
  "/": () => import("@/pages/home"),
  "/calendar": () => import("@/pages/calendar"),
  "/lab": () => import("@/pages/lab"),
  "/xray": () => import("@/pages/lab"),
  "/evidence": () => import("@/pages/evidence"),
  "/investigator": () => import("@/pages/investigator"),
  "/ask": () => import("@/pages/investigator"),
  "/methods": () => import("@/pages/methods"),
  "/method": () => import("@/pages/methods"),
  "/about": () => import("@/pages/methods"),
};
