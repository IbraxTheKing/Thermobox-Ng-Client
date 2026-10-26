/**
 * Hands a file to the user: the share sheet where there is one (phones: save to Files, send by
 * mail…), a download otherwise.
 */
export async function downloadFile(name: string, content: BlobPart, type: string): Promise<void> {
  const blob = new Blob([content], { type });
  const file = new File([blob], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (matchMedia('(pointer: coarse)').matches && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 1000);
}
