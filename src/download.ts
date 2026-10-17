// Adapted from SantaClaas/flashcut (src/lib/download.ts).

/** How long the file's URL stays valid. Some browsers cancel a download whose URL is revoked at once. */
const URL_LIFETIME_MILLISECONDS = 60_000;

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), URL_LIFETIME_MILLISECONDS);
}
