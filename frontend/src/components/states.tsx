import { AlertTriangle, Inbox, Loader2 } from "lucide-react"
import type { HTMLAttributes } from "react"

import { describeError } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function Loading({ label }: { label?: string }) {
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
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
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
          <p className="font-medium">{"Something went wrong"}</p>
          <p className="text-sm text-muted-foreground">{describeError(error)}</p>
          {onRetry && (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={onRetry}
              className="h-auto p-0 text-sm"
            >
              {"Try again"}
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
      <span className="grid h-11 w-11 place-items-center rounded-full border border-primary/25 bg-primary/10 shadow-[0_0_28px_-8px_hsl(var(--primary)/.6)]">
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
