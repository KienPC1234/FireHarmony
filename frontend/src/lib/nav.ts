import { CalendarDays, FlaskConical, House, Info, MessagesSquare } from "lucide-react";

export type NavItem = { to: string; label: string; icon: typeof House; end?: boolean; hint?: string };

export const NAV: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Fire calendar",
    items: [
      { to: "/", icon: House, end: true, label: "Home", hint: "Upload FIRMS CSV, run harmonization" },
      { to: "/calendar", icon: CalendarDays, label: "Burning calendar", hint: "Month x year matrix + anomalies" },
    { to: "/ask", icon: MessagesSquare, label: "Hỏi đáp AI", hint: "Chat giải thích thuật toán/data/model" },
    ],
  },
  {
    label: "Project",
    items: [
      { to: "/method", icon: FlaskConical, label: "Method & ML", hint: "Harmonization + deep learning" },
      { to: "/about", icon: Info, label: "About & data", hint: "Sources, limits, download" },
    ],
  },
];

export const FLAT_NAV = NAV.flatMap((g) => g.items);

export function useNav() {
  return { nav: NAV, flat: FLAT_NAV };
}

export const PREFETCH: Record<string, () => Promise<unknown>> = {
  "/": () => import("@/pages/home"),
  "/calendar": () => import("@/pages/calendar"),
  "/ask": () => import("@/pages/ask"),
  "/method": () => import("@/pages/method"),
  "/about": () => import("@/pages/about"),
};
