/**
 * Release notes (GitHub Markdown) to HTML (Markdown.kt of the JSF interface). The text is escaped
 * first and only a few constructs are turned back into tags (headings, lists, bold, code, links
 * to http(s) URLs), so nothing from the notes can inject markup or script.
 */
const TITRE = /^(#{1,6})\s+(.*)$/;
const PUCE = /^\s*[-*+]\s+(.*)$/;
const GRAS = /\*\*(.+?)\*\*/g;
const CODE = /`([^`]+)`/g;
const LIEN = /\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g;
const URL_NUE = /(?<!href=")(?<!">)\bhttps?:\/\/[^\s<]+/g;

export function markdownVersHtml(texte: string | null | undefined): string {
  if (!texte || !texte.trim()) return '<p class="tb-muted">Pas de notes de version.</p>';
  let html = '';
  let liste = false;
  const paragraphe: string[] = [];
  const fermerParagraphe = () => {
    if (paragraphe.length) html += `<p>${paragraphe.join('<br/>')}</p>`;
    paragraphe.length = 0;
  };
  const fermerListe = () => {
    if (liste) html += '</ul>';
    liste = false;
  };
  for (const brute of texte.replace(/\r/g, '').split('\n')) {
    const titre = TITRE.exec(brute.trim());
    const puce = PUCE.exec(brute);
    if (!brute.trim()) {
      fermerParagraphe();
      fermerListe();
    } else if (titre) {
      fermerParagraphe();
      fermerListe();
      // h3 at most: the page already has its h1 / h2.
      const n = Math.min(titre[1].length + 2, 6);
      html += `<h${n}>${enLigne(echapper(titre[2]))}</h${n}>`;
    } else if (puce) {
      fermerParagraphe();
      if (!liste) html += '<ul>';
      liste = true;
      html += `<li>${enLigne(echapper(puce[1]))}</li>`;
    } else {
      fermerListe();
      paragraphe.push(enLigne(echapper(brute.trimEnd())));
    }
  }
  fermerParagraphe();
  fermerListe();
  return html;
}

function echapper(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function enLigne(s: string): string {
  return s
    .replace(CODE, '<code>$1</code>')
    .replace(GRAS, '<strong>$1</strong>')
    .replace(LIEN, (_m, texte: string, url: string) => lien(url, texte))
    .replace(URL_NUE, (url) => lien(url, raccourcir(url)));
}

function lien(url: string, texte: string): string {
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${texte}</a>`;
}

/** « #38 » rather than the whole URL, as GitHub shows it. */
function raccourcir(url: string): string {
  const m = /^https:\/\/github\.com\/[^/]+\/[^/]+\/(pull|issues)\/(\d+)$/.exec(url);
  return m ? `#${m[2]}` : url;
}
