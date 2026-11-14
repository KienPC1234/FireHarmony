/**
 * Download a generated file.
 *
 * The object URL used to be revoked immediately after `a.click()`. In some
 * browsers the download has not started by then, and revoking the URL cancels
 * it, so the reader got no file at all. Revoking on the next tick, after the
 * click has been processed, keeps the download working and still frees the
 * memory.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.style.display = "none"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Give the browser a moment to start the download before the URL goes away.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
