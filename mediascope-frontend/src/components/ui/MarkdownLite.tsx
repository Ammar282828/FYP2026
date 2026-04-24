/**
 * MarkdownLite — minimal markdown renderer for Gemini AI output.
 *
 * Supports: headings (#, ##, ###), bullet lists (- *), numbered lists,
 * bold (**text**), italic (*text*), inline code (`code`), and paragraphs
 * separated by blank lines. Anything fancier (tables, code blocks, links)
 * passes through as text — good enough for the analytical summaries we
 * generate without pulling in the full react-markdown dependency tree.
 */
import React from 'react';

interface Props {
  source: string;
  className?: string;
}

function renderInline(text: string): React.ReactNode[] {
  // Tokenize **bold**, *italic*, `code`. We do a sequential scan rather than
  // a single regex so the parts compose properly in JSX.
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  let buf = '';
  const flush = () => {
    if (buf) {
      out.push(buf);
      buf = '';
    }
  };
  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        flush();
        out.push(<strong key={`b${key++}`}>{text.slice(i + 2, end)}</strong>);
        i = end + 2;
        continue;
      }
    }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        flush();
        out.push(
          <code
            key={`c${key++}`}
            style={{
              background: 'var(--bg-tertiary)',
              padding: '1px 4px',
              borderRadius: 3,
              fontSize: '0.9em',
            }}
          >
            {text.slice(i + 1, end)}
          </code>
        );
        i = end + 1;
        continue;
      }
    }
    if (text[i] === '*' && text[i + 1] !== ' ' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1);
      if (end !== -1) {
        flush();
        out.push(<em key={`i${key++}`}>{text.slice(i + 1, end)}</em>);
        i = end + 1;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  flush();
  return out;
}

const MarkdownLite: React.FC<Props> = ({ source, className }) => {
  const lines = (source || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let listBuf: string[] = [];
  let listOrdered = false;
  let key = 0;

  const flushList = () => {
    if (!listBuf.length) return;
    const items = listBuf.map((it, i) => <li key={i}>{renderInline(it)}</li>);
    blocks.push(
      listOrdered
        ? <ol key={`l${key++}`}>{items}</ol>
        : <ul key={`l${key++}`}>{items}</ul>
    );
    listBuf = [];
  };

  let paraBuf: string[] = [];
  const flushPara = () => {
    if (!paraBuf.length) return;
    blocks.push(
      <p key={`p${key++}`} style={{ margin: '0 0 0.75em' }}>
        {renderInline(paraBuf.join(' '))}
      </p>
    );
    paraBuf = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushList();
      flushPara();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushList(); flushPara();
      const level = heading[1].length;
      const Tag = (`h${level + 2}` as 'h3' | 'h4' | 'h5'); // map ###->h5 etc.
      blocks.push(
        React.createElement(Tag, { key: `h${key++}`, style: { margin: '0.5em 0 0.25em' } }, renderInline(heading[2]))
      );
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flushPara();
      if (listOrdered && listBuf.length) flushList();
      listOrdered = false;
      listBuf.push(bullet[1]);
      continue;
    }
    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (numbered) {
      flushPara();
      if (!listOrdered && listBuf.length) flushList();
      listOrdered = true;
      listBuf.push(numbered[1]);
      continue;
    }
    flushList();
    paraBuf.push(line);
  }
  flushList();
  flushPara();

  return <div className={className}>{blocks}</div>;
};

export default MarkdownLite;
