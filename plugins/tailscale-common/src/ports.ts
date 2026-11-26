/**
 * The `ip` entries of a Tailscale grant: `*`, `443`, `1000-2000`,
 * `tcp:443`, `udp:*`. A bare port (or `*`) means every protocol.
 */
export interface PortRange {
  proto: string; // 'tcp', 'udp', ... or '*' for every protocol
  from: number;
  to: number;
}

const ANY = { from: 0, to: 65535 };

export function parsePort(entry: string): PortRange | undefined {
  const text = entry.trim();
  const match = /^(?:([a-z]+):)?(\*|\d+(?:-\d+)?)$/.exec(text);
  if (!match) return undefined;
  const proto = match[1] ?? '*';
  if (match[2] === '*') return { proto, ...ANY };
  const [from, to = from] = match[2].split('-').map(Number);
  if (from > to || to > 65535) return undefined;
  return { proto, from, to };
}

export function isWildcardPort(range: PortRange): boolean {
  return range.from === ANY.from && range.to === ANY.to;
}

/** Whether `outer` allows everything `inner` does. */
export function portCovers(outer: PortRange, inner: PortRange): boolean {
  const proto = outer.proto === '*' || outer.proto === inner.proto;
  return proto && outer.from <= inner.from && outer.to >= inner.to;
}

export function formatPort(range: PortRange): string {
  let ports = `${range.from}-${range.to}`;
  if (isWildcardPort(range)) ports = '*';
  else if (range.from === range.to) ports = `${range.from}`;
  return range.proto === '*' ? ports : `${range.proto}:${ports}`;
}
