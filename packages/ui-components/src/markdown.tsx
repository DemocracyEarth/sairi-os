import type { JSX, ReactNode } from 'react';

/**
 * A deliberately tiny markdown subset.
 *
 * The whole point is what it CANNOT do. It never produces raw HTML, never calls
 * `dangerouslySetInnerHTML`, and never emits an element type that is not in the
 * list below. Markdown arrives from the model, so the renderer is part of the
 * trust boundary, not a convenience.
 *
 * Supported: `#`/`##`/`###` headings, paragraphs, `-` lists, `**bold**`,
 * `` `code` `` and `[label](url)` where the URL is http(s).
 * Everything else renders as literal text.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function safeHref(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    // Only http(s). This rejects javascript:, data:, file: and vbscript:.
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;
  for (const part of text.split(INLINE)) {
    if (!part) continue;
    const key = `${keyPrefix}-${index}`;
    index += 1;

    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      nodes.push(<strong key={key}>{part.slice(2, -2)}</strong>);
      continue;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      nodes.push(<code key={key}>{part.slice(1, -1)}</code>);
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = safeHref(link[2] ?? '');
      if (href) {
        nodes.push(
          <a key={key} href={href} rel="noopener noreferrer nofollow" target="_blank">
            {link[1]}
          </a>,
        );
      } else {
        // An unsafe scheme degrades to literal text rather than disappearing,
        // so the user can see what the agent tried to link to.
        nodes.push(<span key={key}>{part}</span>);
      }
      continue;
    }
    nodes.push(<span key={key}>{part}</span>);
  }
  return nodes;
}

/** Renders the supported markdown subset to React elements. Never returns HTML. */
export function renderMarkdown(source: string): JSX.Element {
  const blocks: JSX.Element[] = [];
  const lines = source.replaceAll('\r\n', '\n').split('\n');

  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(' ');
    blocks.push(<p key={`p-${blocks.length}`}>{renderInline(text, `p${blocks.length}`)}</p>);
    paragraph = [];
  };

  const flushList = (): void => {
    if (list.length === 0) return;
    const items = list;
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {items.map((item, i) => (
          <li key={`li-${i}`}>{renderInline(item, `l${blocks.length}-${i}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]?.length ?? 1;
      const content = renderInline(heading[2] ?? '', `h${blocks.length}`);
      const key = `h-${blocks.length}`;
      // Explicit switch rather than a computed tag name: the element type is
      // never derived from model input.
      if (level === 1) blocks.push(<h1 key={key}>{content}</h1>);
      else if (level === 2) blocks.push(<h2 key={key}>{content}</h2>);
      else blocks.push(<h3 key={key}>{content}</h3>);
      continue;
    }

    const listItem = /^\s*[-*]\s+(.*)$/.exec(line);
    if (listItem) {
      flushParagraph();
      list.push(listItem[1] ?? '');
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();

  return <div className="sairi-markdown">{blocks}</div>;
}
