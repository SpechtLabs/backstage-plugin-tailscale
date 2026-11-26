/**
 * A small HuJSON printer in the style of Tailscale's own policy files: tabs,
 * trailing commas, short lists on one line, comments above what they
 * describe. It counts lines as it goes, so every rendered item knows where
 * it is in the file.
 */

type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json | undefined };

const WIDTH = 100;

const isScalar = (v: Json): boolean => v === null || typeof v !== 'object';

function inline(value: Json): string | undefined {
  if (isScalar(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (!value.every(isScalar)) return undefined;
    return `[${value.map(v => JSON.stringify(v)).join(', ')}]`;
  }
  return undefined;
}

/** Wraps prose into // comment lines. */
export function commentLines(text: string, width = 78): string[] {
  const out: string[] = [];
  for (const paragraph of text.trim().split(/\n\s*\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + word.length + 1 > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) out.push(line);
  }
  return out.map(l => `// ${l}`);
}

export class HujsonWriter {
  private readonly lines: string[] = [];

  /** The 1-based number of the next line written. */
  get next() {
    return this.lines.length + 1;
  }

  raw(line: string, depth = 0) {
    this.lines.push(`${'\t'.repeat(depth)}${line}`);
  }

  blank() {
    if (this.lines.length && this.lines[this.lines.length - 1].trim() !== '{') {
      this.lines.push('');
    }
  }

  comment(text: string | undefined, depth: number) {
    if (!text?.trim()) return;
    for (const line of commentLines(text)) this.raw(line, depth);
  }

  /**
   * Writes `"key": value,` (or `value,` without a key) at depth, and
   * returns the lines it took.
   */
  value(key: string | undefined, value: Json, depth: number): [number, number] {
    const from = this.next;
    const prefix = key === undefined ? '' : `${JSON.stringify(key)}: `;
    const short = inline(value);
    const pad = depth * 4;
    if (short !== undefined && pad + prefix.length + short.length < WIDTH) {
      this.raw(`${prefix}${short},`, depth);
      return [from, from];
    }
    if (Array.isArray(value)) {
      this.raw(`${prefix}[`, depth);
      for (const item of value) this.value(undefined, item, depth + 1);
      this.raw('],', depth);
    } else {
      const object = value as { [key: string]: Json | undefined };
      this.raw(`${prefix}{`, depth);
      // Line keys up when they are all short scalars, as Tailscale does.
      const entries = Object.entries(object).filter(
        (e): e is [string, Json] => e[1] !== undefined,
      );
      const align = entries.every(([, v]) => inline(v) !== undefined)
        ? Math.max(...entries.map(([k]) => JSON.stringify(k).length))
        : 0;
      const inner = (depth + 1) * 4;
      for (const [k, v] of entries) {
        const keyText = `${JSON.stringify(k)}:`.padEnd(align + 2);
        if (align && inner + keyText.length + inline(v)!.length < WIDTH) {
          this.raw(`${keyText}${inline(v)},`, depth + 1);
        } else {
          this.value(k, v, depth + 1);
        }
      }
      this.raw('},', depth);
    }
    return [from, this.next - 1];
  }

  toString() {
    return `${this.lines.join('\n')}\n`;
  }
}
