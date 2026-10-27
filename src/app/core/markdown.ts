import DOMPurify from 'dompurify';
import { Marked, Tokens } from 'marked';

/**
 * Release notes (GitHub Markdown) to HTML: the whole of GitHub Flavored Markdown (tables, task
 * lists, strikethrough, nested lists, quotes, code blocks, images, autolinks), plus the alerts of
 * GitHub (« > [!NOTE] », « > [!WARNING] »…). The HTML is then cleaned by DOMPurify: nothing from
 * the notes can run a script or reach the page outside its box.
 *
 * Headings are shifted down two levels (the page has its h1 / h2), links open in a new tab, a link
 * to a pull request or an issue reads « #38 » as on GitHub.
 */
const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    heading({ tokens, depth }: Tokens.Heading): string {
      const n = Math.min(depth + 2, 6);
      return `<h${n}>${this.parser.parseInline(tokens)}</h${n}>\n`;
    },
    // Wide tables scroll inside the card
    table(token: Tokens.Table): string {
      const cell = (c: Tokens.TableCell, tag: 'th' | 'td') =>
        `<${tag}${c.align ? ` style="text-align:${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</${tag}>`;
      const head = `<tr>${token.header.map((c) => cell(c, 'th')).join('')}</tr>`;
      const body = token.rows.map((r) => `<tr>${r.map((c) => cell(c, 'td')).join('')}</tr>`).join('');
      return `<div class="tb-md-table"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>\n`;
    },
  },
});

/** GitHub alerts: the first line of a quote. */
const ALERTS: Record<string, string> = { NOTE: 'Remarque', TIP: 'Astuce', IMPORTANT: 'Important', WARNING: 'Attention', CAUTION: 'Prudence' };

let hooked = false;

function hook(): void {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      if (/^https?:/i.test(href)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
        // A bare link to a pull request / an issue: « #38 », as GitHub shows it
        const m = /^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:pull|issues)\/(\d+)\/?$/.exec(href);
        if (m && node.textContent === href) node.textContent = `#${m[1]}`;
      }
    }
    if (node.tagName === 'IMG') {
      node.setAttribute('loading', 'lazy');
      node.setAttribute('decoding', 'async');
    }
    // Task lists: the boxes show, they are not edited here
    if (node.tagName === 'INPUT') node.setAttribute('disabled', '');
  });
}

/** Quotes starting with [!NOTE], [!WARNING]… become the coloured boxes of GitHub. */
function alerts(html: string): string {
  return html.replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:<br>|<br\/>|\s)*/gi, (_m, kind: string) => {
    const k = kind.toUpperCase();
    return `<blockquote class="tb-md-alert tb-md-alert-${k.toLowerCase()}"><p class="tb-md-alert-title">${ALERTS[k]}</p><p>`;
  });
}

const cache = new Map<string, string>();

export function markdownToHtml(text: string | null | undefined): string {
  if (!text || !text.trim()) return '<p class="tb-muted">Pas de notes de version.</p>';
  const known = cache.get(text);
  if (known != null) return known;
  hook();
  const raw = alerts(marked.parse(text.replace(/\r/g, ''), { async: false }));
  const html = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'iframe'],
  });
  if (cache.size > 200) cache.clear();
  cache.set(text, html);
  return html;
}
