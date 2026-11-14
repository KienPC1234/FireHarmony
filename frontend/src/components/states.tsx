import { AlertTriangle, Inbox, Loader2 } from "lucide-react"
import { useEffect, useState, type HTMLAttributes } from "react"

import { api, describeError } from "@/lib/api"
import { useLang } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function BackendProgressCard({
  aoi,
  data = "raw",
  label,
  hint,
  unit = "s",
  liveScan = false,
}: {
  aoi: string
  data?: string
  label: string
  hint?: string
  unit?: string
  liveScan?: boolean
}) {
  const { t } = useLang()
  const [elapsed, setElapsed] = useState(0)
  const [progress, setProgress] = useState<{ stage: string; percent: number; detail: string; updated_at?: number } | null>(null)

  useEffect(() => {
    let active = true
    let stopPolling = liveScan
    const startedAt = Date.now() / 1000
    setElapsed(0)
    setProgress(null)
    const poll = () => {
      if (stopPolling) return
      api
        .progress(aoi, data === "raw" ? "raw" : "sample")
        .then((p: { stage: string; percent: number; detail: string; updated_at?: number }) => {
          if (!active) return
          if (p.stage === "idle" || p.stage === "done") return
          if (p.updated_at && p.updated_at < startedAt - 2) return
          setProgress(p)
        })
        .catch((err) => {
          const status = (err as { status?: number } | null)?.status
          if (status === 403 || status === 404) {
            stopPolling = true
          }
        })
    }
    if (!liveScan) poll()
    const timerId = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    const pollId = liveScan ? undefined : window.setInterval(poll, 700)
    return () => {
      active = false
      window.clearInterval(timerId)
      if (pollId !== undefined) window.clearInterval(pollId)
    }
  }, [aoi, data, liveScan])

  const stageLabel = liveScan
    ? t("states.stage_live_fetch")
    : progress?.stage === "checking_cache"
      ? t("states.stage_checking_cache")
      : progress?.stage === "aggregating"
        ? t("states.stage_aggregating")
        : progress?.stage === "calibrating"
          ? t("states.stage_calibrating")
          : t("states.stage_connecting")

  const hasRealPct = Boolean(progress && progress.percent > 0 && progress.percent < 100 && progress.stage !== "done")

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full max-w-md rounded-2xl border border-cyan-500/30 bg-[#0B1220]/95 p-5 shadow-2xl space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-400 shrink-0" aria-hidden="true" />
          <span className="text-sm font-semibold text-white truncate">{label}</span>
        </div>
        <span className="font-mono text-xs text-cyan-300 shrink-0">
          {hasRealPct ? `${progress?.percent}% · ` : ""}
          {elapsed} {unit}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
        {hasRealPct ? (
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500"
            style={{ width: `${progress?.percent}%` }}
          />
        ) : (
          <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-[pulse_1.2s_ease-in-out_infinite]" />
        )}
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-cyan-200/90 leading-relaxed">{stageLabel}</p>
        {(progress?.detail || hint) && (
          <p className="text-[11px] text-slate-400 leading-relaxed">{progress?.detail || hint}</p>
        )}
      </div>
    </div>
  )
}

export function Loading({
  label,
  aoi,
  data,
  hint,
  unit,
}: {
  label?: string
  aoi?: string
  data?: string
  hint?: string
  unit?: string
}) {
  const { t } = useLang()
  const resolvedLabel = label ?? t("states.loading")
  if (aoi) {
    return (
      <div className="flex items-center justify-center py-12 px-4">
        <BackendProgressCard
          aoi={aoi}
          data={data}
          label={resolvedLabel}
          hint={hint}
          unit={unit}
        />
      </div>
    )
  }
  // role="status" tells a screen reader that something is loading. Without it
  // the route appears with no content and no announcement, which reads as a
  // blank page rather than as work in progress.
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-3 py-16 text-muted-foreground"
    >
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      <span>{label ?? "Loading…"}</span>
      <span>{resolvedLabel}</span>
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useLang()
  return (
    <Card className="border-destructive/50">
      {/* role="alert" makes a failed request announce itself. A silent
          failure is the same to a screen reader user as an empty page. */}
      <CardContent
        role="alert"
        className="flex items-start gap-3 pt-6"
      >
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
          aria-hidden="true"
        />
        <div className="space-y-2">
          <p className="font-medium">{t("common.error_title")}</p>
          <p className="text-sm text-muted-foreground">{describeError(error)}</p>
          {onRetry && (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={onRetry}
              className="h-auto p-0 text-sm"
            >
              {t("common.retry")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/80 bg-card/40 px-6 py-14 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full border border-primary/25 bg-primary/10 shadow-[0_6px_20px_rgba(2,132,199,0.22)]">
        <Inbox className="h-5 w-5 text-primary" aria-hidden="true" />
      </span>
      <p className="max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
        {message}
      </p>
    </div>
  )
}

/** Card-shaped placeholders for pages that render cards. */
export function LoadingCards({
  count = 6,
  className,
}: {
  count?: number
  className?: string
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="space-y-3 rounded-xl border border-border/70 bg-card p-6 shadow-card"
        >
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
    </div>
  )
}

/** Row-shaped placeholders for list pages. */
export function LoadingRows({
  count = 6,
  className,
  ...props
}: { count?: number } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={className ?? "space-y-2"} {...props}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border/70 p-4">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="mt-2 h-3 w-4/5" />
        </div>
      ))}
    </div>
  )
}
