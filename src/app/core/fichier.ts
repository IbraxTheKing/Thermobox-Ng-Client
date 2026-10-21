/**
 * Hands a file to the user: the share sheet where there is one (phones: save to Files, send by
 * mail…), a download otherwise.
 */
export async function donnerFichier(nom: string, contenu: BlobPart, type: string): Promise<void> {
  const blob = new Blob([contenu], { type });
  const fichier = new File([blob], nom, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (matchMedia('(pointer: coarse)').matches && nav.canShare?.({ files: [fichier] })) {
    try {
      await nav.share({ files: [fichier], title: nom });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(blob);
  lien.download = nom;
  document.body.appendChild(lien);
  lien.click();
  setTimeout(() => {
    URL.revokeObjectURL(lien.href);
    lien.remove();
  }, 1000);
}
