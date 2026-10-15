/** Save `text` as a file through a transient anchor — the browser-only way to "download" generated content. */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the click a tick to start before revoking the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copy `text` to the clipboard; resolves false when the API is unavailable or denied. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
