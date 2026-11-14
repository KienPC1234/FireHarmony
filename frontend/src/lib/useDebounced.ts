import { useEffect, useState } from "react"

/**
 * Debounce a rapidly changing value.
 *
 * A search box that fires a request per keystroke is both wasteful and jumpy;
 * a short delay makes it feel like the page is keeping up rather than lagging.
 */
export function useDebounced<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return settled
}
