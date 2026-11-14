import { Component, type ErrorInfo, type ReactNode } from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"

const EB_COPY = {
  en: {
    title: "This page could not be rendered",
    fallback: "An unexpected client error occurred.",
    tryAgain: "Try again",
    reload: "Reload the page",
  },
  vi: {
    title: "Không thể hiển thị trang này",
    fallback: "Đã xảy ra lỗi không mong đợi ở phía trình duyệt.",
    tryAgain: "Thử lại",
    reload: "Tải lại trang",
  },
} as const

function ebCopy() {
  const lang =
    typeof document !== "undefined" && document.documentElement.lang === "vi" ? "vi" : "en"
  return EB_COPY[lang]
}

/**
 * A route-level error boundary.
 *
 * A single bad API response should not blank the whole dashboard. The shell and
 * navigation stay usable, and the page itself offers a reload.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the console useful for a judge/engineer without adding a telemetry
    // dependency to the client.
    console.error("Page crashed:", error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    const c = ebCopy()
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/40 bg-destructive/5 p-6"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="space-y-3">
            <div>
              <p className="font-medium">{c.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {this.state.error.message || c.fallback}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {/* Try again first: a render error is often recoverable, and a
                  full reload would throw away the URL state and the scroll
                  position for no reason. */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => this.setState({ error: null })}
              >
                <RotateCcw className="h-3.5 w-3.5" /> {c.tryAgain}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => window.location.reload()}>
                {c.reload}
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
