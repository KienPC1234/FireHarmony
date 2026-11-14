import type { HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

/** Placeholder block shown while data loads, so a page does not go blank. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />
}
