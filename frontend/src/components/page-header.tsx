import type { ReactNode } from "react"

/**
 * One page header for the whole dashboard.
 *
 * The pages used to each invent their own heading block, so the type scale
 * drifted between them. A single component keeps the hierarchy identical
 * everywhere: optional eyebrow, one h1, one description, optional actions.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string
  title: string
  description?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="space-y-3">
      {eyebrow && (
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-primary">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary))]" />
          {eyebrow}
        </p>
      )}
      <h1 className="text-gradient text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h1>
      {description && (
        <p className="max-w-3xl text-pretty text-muted-foreground">{description}</p>
      )}
      {children}
    </header>
  )
}
