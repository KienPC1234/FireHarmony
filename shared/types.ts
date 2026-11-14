/**
 * Shared Type Contract for Flame in Freefall / AlphaCentauriAB
 * NASA Space Apps Challenge 2026
 *
 * Core Principle: Sourced data, traceable results, no fabricated physics, stable demo.
 */

export type Category = "prevention" | "detection" | "suppression" | "adjacent"
export type FuelPhase = "solid" | "liquid" | "gas" | "aerosol" | "unknown"
export type GravityRegime = "microgravity" | "normal" | "partial" | "unknown"
export type DataStatus = "verified" | "metadata_only" | "needs_review"
export type ReviewStatus = "verified" | "needs_review" | "unknown"

export interface Investigation {
  id: string
  title: string
  investigation_group?: string
  category: Category
  fuel_phase: FuelPhase
  gravity_regime: GravityRegime
  objective: string | null
  summary?: string | null
  oxygen_percent: number | null
  pressure_kpa: number | null
  airflow_m_s: number | null
  sample_geometry: string | null
  measurements: string[]
  verified_findings: string[]
  source_refs: string[]
  data_status: DataStatus
  last_reviewed_at: string | null
  relevance_score?: number
  relevance_reasons?: string[]
}

export interface EvidenceRecord {
  evidence_id: string
  investigation_id: string
  field_path: string
  assertion: string | null
  source_id: string
  source_url: string | null
  locator: string | null
  original_text: string | null
  review_status: ReviewStatus
  reviewer: string | null
}

export interface InvestigationDetailResponse {
  investigation: Investigation
  evidence: EvidenceRecord[]
}

export interface InvestigationListResponse {
  items: Investigation[]
  total: int_or_number
  page: int_or_number
  page_size: int_or_number
  filters: {
    q?: string
    category?: string
    fuel_phase?: string
    sort?: string
  }
}

type int_or_number = number

export interface CompareRequest {
  ids: string[]
}

export interface ComparisonField {
  key: string
  label: string
  unit?: string | null
  values: Record<string, string | number | null>
  data_status: Record<string, DataStatus | ReviewStatus>
  sources: Record<string, string>
}

export interface CompareResponse {
  fields: ComparisonField[]
  studies: Investigation[]
  comparability_notes: string[]
}

export interface Citation {
  id: string
  title: string
  url: string
  locator?: string | null
  snippet?: string | null
}

export interface AskRequestPayload {
  question: string
  selected_ids?: string[]
  context?: string
}

export interface AskResponsePayload {
  answer: string
  citations: Citation[]
  limitations: string[]
  request_id: string
}

export interface InsightItem {
  id: string
  title: string
  category: Category
  finding: string
  evidence_level: "verified" | "derived" | "observational"
  source_refs: string[]
  applicable_scenarios: string[]
  known_gaps: string[]
}

export interface InsightsResponse {
  items: InsightItem[]
  total: number
}

export interface HealthResponse {
  status: string
  dataset_version: string
  ai_available: boolean
  documents: number
  index: boolean
}
