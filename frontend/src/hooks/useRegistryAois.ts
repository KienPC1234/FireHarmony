import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AOI_BBOX } from "@/hooks/useCalendarData";

export interface RegistryAoi {
  id: string;
  label: string;
  bbox?: string | null;
  months?: number;
  coverage_class?: string;
  dataset_ready?: boolean;
}

export const DEFAULT_REGISTRY_AOIS: RegistryAoi[] = [
  { id: "vietnam", label: "Vietnam", bbox: AOI_BBOX.vietnam, dataset_ready: true },
  { id: "amazon", label: "Amazon", bbox: AOI_BBOX.amazon, dataset_ready: true },
  { id: "australia", label: "Australia", bbox: AOI_BBOX.australia, dataset_ready: true },
];

let cachedRegistryAois: RegistryAoi[] | null = null;
let inflightRegistryAois: Promise<RegistryAoi[]> | null = null;

function fetchRegistryAois(): Promise<RegistryAoi[]> {
  if (cachedRegistryAois) return Promise.resolve(cachedRegistryAois);
  if (inflightRegistryAois) return inflightRegistryAois;
  const p: Promise<RegistryAoi[]> = api
    .aois()
    .then((res): RegistryAoi[] => {
      const list = Array.isArray(res?.aois) && res.aois.length > 0 ? res.aois : DEFAULT_REGISTRY_AOIS;
      cachedRegistryAois = list;
      return list;
    })
    .catch(() => DEFAULT_REGISTRY_AOIS)
    .finally(() => {
      inflightRegistryAois = null;
    });
  inflightRegistryAois = p;
  return p;
}

/**
 * Loads preset + custom AOIs from `GET /api/firms/aois` (backed by
 * `backend/data/firms/aois.json`) with immediate fallback to the 3 default
 * presets so SSR, unit tests, and first paint render without flicker.
 */
export function useRegistryAois() {
  const [aois, setAois] = useState<RegistryAoi[]>(() => cachedRegistryAois ?? DEFAULT_REGISTRY_AOIS);

  useEffect(() => {
    let alive = true;
    fetchRegistryAois().then((list) => {
      if (alive) setAois(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const aoiBboxMap: Record<string, string> = { ...AOI_BBOX };
  for (const item of aois) {
    if (item.bbox) aoiBboxMap[item.id] = item.bbox;
  }

  return { aois, aoiBboxMap };
}

export function formatAoiShortLabel(item: RegistryAoi, t: (key: string) => string): string {
  if (item.id === "vietnam") return t("aoi.vietnam_short");
  if (item.id === "amazon") return t("aoi.amazon_short");
  if (item.id === "australia") return t("aoi.australia_short");
  return item.label || item.id;
}
