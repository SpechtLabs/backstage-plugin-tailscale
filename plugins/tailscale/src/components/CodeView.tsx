import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { Lines } from '../api';

type Token = { text: string; className?: string };

const SELECTOR_CLASS: Array<[RegExp, string]> = [
  [/^"group:/, 'ts-t-group'],
  [/^"tag:/, 'ts-t-tag'],
  [/^"svc:/, 'ts-t-service'],
  [/^"autogroup:/, 'ts-t-user'],
  [/^"[^"]+@[^"]+"$/, 'ts-t-user'],
  [/^"\*"$/, 'ts-t-any'],
];

/** HuJSON, one line at a time: our files have no block comments. */
export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    const comment = /^\/\/.*/.exec(rest);
    if (comment) {
      tokens.push({ text: comment[0], className: 'ts-t-comment' });
      break;
    }
    const string = /^"(?:[^"\\]|\\.)*"/.exec(rest);
    if (string) {
      const after = line.slice(i + string[0].length);
      let className = /^\s*:/.test(after) ? 'ts-t-key' : 'ts-t-string';
      if (className === 'ts-t-string') {
        className =
          SELECTOR_CLASS.find(([re]) => re.test(string[0]))?.[1] ?? className;
      }
      tokens.push({ text: string[0], className });
      i += string[0].length;
      continue;
    }
    const number = /^-?\d+(\.\d+)?/.exec(rest);
    if (number) {
      tokens.push({ text: number[0], className: 'ts-t-number' });
      i += number[0].length;
      continue;
    }
    const literal = /^(true|false|null)\b/.exec(rest);
    if (literal) {
      tokens.push({ text: literal[0], className: 'ts-t-literal' });
      i += literal[0].length;
      continue;
    }
    const punct = /^[{}[\]:,]/.exec(rest);
    if (punct) {
      tokens.push({ text: punct[0], className: 'ts-t-punct' });
      i += 1;
      continue;
    }
    const plain = /^[^"/{}[\]:,\d]+|^./.exec(rest)!;
    tokens.push({ text: plain[0] });
    i += plain[0].length;
  }
  return tokens;
}

const inside = (n: number, ranges: Lines[]) =>
  ranges.some(([from, to]) => n >= from && n <= to);

/**
 * A HuJSON file with line numbers. `highlight` marks lines; the first marked
 * line is scrolled into view.
 */
export function CodeView(props: {
  text: string;
  highlight?: Lines[];
  /** First line number (for excerpts). */
  start?: number;
  /** Where a line number links to. */
  lineHref?: (line: number) => string;
  scroll?: boolean;
  label?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const start = props.start ?? 1;
  const highlight = useMemo(() => props.highlight ?? [], [props.highlight]);
  const lines = useMemo(
    () => props.text.replace(/\n$/, '').split('\n').map(tokenize),
    [props.text],
  );

  useEffect(() => {
    const first = highlight[0]?.[0];
    if (!first || !container.current) return;
    const element = container.current.querySelector<HTMLElement>(
      `[data-line="${first}"]`,
    );
    // Not in jsdom.
    element?.scrollIntoView?.({ block: 'center' });
  }, [highlight]);

  return (
    <div
      ref={container}
      className={`ts-code${props.scroll ? ' ts-code-scroll' : ''}`}
      role="region"
      aria-label={props.label ?? 'Policy file'}
    >
      <div className="ts-code-inner">
        {lines.map((tokens, i) => {
          const n = start + i;
          const number: ReactNode = props.lineHref ? (
            <a className="ts-code-number" href={props.lineHref(n)}>
              {n}
            </a>
          ) : (
            <span className="ts-code-number">{n}</span>
          );
          return (
            <div
              key={n}
              data-line={n}
              className={`ts-code-line${
                inside(n, highlight) ? ' ts-code-line-on' : ''
              }`}
            >
              {number}
              <span className="ts-code-text">
                {tokens.map((t, j) =>
                  t.className ? (
                    <span key={j} className={t.className}>
                      {t.text}
                    </span>
                  ) : (
                    t.text
                  ),
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The lines `ranges` cover, with a line of context around each. */
export function excerpt(text: string, ranges: Lines[]) {
  const all = text.split('\n');
  if (!ranges.length) return undefined;
  const from = Math.max(1, Math.min(...ranges.map(r => r[0])));
  const to = Math.min(all.length, Math.max(...ranges.map(r => r[1])));
  return { start: from, text: all.slice(from - 1, to).join('\n') };
}
