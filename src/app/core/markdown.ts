/**
 * Release notes (GitHub Markdown) to HTML (Markdown.kt of the JSF interface). The text is escaped
 * first and only a few constructs are turned back into tags (headings, lists, bold, code, links
 * to http(s) URLs), so nothing from the notes can inject markup or script.
 */
const TITLE = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const BOLD = /\*\*(.+?)\*\*/g;
const CODE = /`([^`]+)`/g;
const LINK = /\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g;
const BARE_URL = /(?<!href=")(?<!">)\bhttps?:\/\/[^\s<]+/g;

export function markdownToHtml(text: string | null | undefined): string {
  if (!text || !text.trim()) return '<p class="tb-muted">Pas de notes de version.</p>';
  let html = '';
  let list = false;
  const paragraph: string[] = [];
  const closeParagraph = () => {
    if (paragraph.length) html += `<p>${paragraph.join('<br/>')}</p>`;
    paragraph.length = 0;
  };
  const closeList = () => {
    if (list) html += '</ul>';
    list = false;
  };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const title = TITLE.exec(raw.trim());
    const bullet = BULLET.exec(raw);
    if (!raw.trim()) {
      closeParagraph();
      closeList();
    } else if (title) {
      closeParagraph();
      closeList();
      // h3 at most: the page already has its h1 / h2.
      const n = Math.min(title[1].length + 2, 6);
      html += `<h${n}>${inline(escape(title[2]))}</h${n}>`;
    } else if (bullet) {
      closeParagraph();
      if (!list) html += '<ul>';
      list = true;
      html += `<li>${inline(escape(bullet[1]))}</li>`;
    } else {
      closeList();
      paragraph.push(inline(escape(raw.trimEnd())));
    }
  }
  closeParagraph();
  closeList();
  return html;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inline(s: string): string {
  return s
    .replace(CODE, '<code>$1</code>')
    .replace(BOLD, '<strong>$1</strong>')
    .replace(LINK, (_m, text: string, url: string) => link(url, text))
    .replace(BARE_URL, (url) => link(url, shorten(url)));
}

function link(url: string, text: string): string {
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
}

/** « #38 » rather than the whole URL, as GitHub shows it. */
function shorten(url: string): string {
  const m = /^https:\/\/github\.com\/[^/]+\/[^/]+\/(pull|issues)\/(\d+)$/.exec(url);
  return m ? `#${m[2]}` : url;
}
