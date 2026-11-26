import { useMemo, useState } from 'react';
import type {
  DestinationClass,
  DestinationView,
  GrantRule,
  PrincipalKind,
} from '../api';
import { kindOf } from './primitives';

const COLOUR: Record<PrincipalKind, string> = {
  group: 'var(--ts-group)',
  user: 'var(--ts-user)',
  tag: 'var(--ts-tag)',
  service: 'var(--ts-service)',
  autogroup: 'var(--ts-neutral)',
  host: 'var(--ts-neutral)',
  address: 'var(--ts-neutral)',
  ipset: 'var(--ts-neutral)',
  any: 'var(--ts-any)',
};

/** Destination classes, in the order the map lists them. */
export const CLASSES: Array<{
  id: DestinationClass;
  label: string;
  hint: string;
}> = [
  {
    id: 'service',
    label: 'Services',
    hint: 'Tailscale Services: reached wherever they are served',
  },
  {
    id: 'mesh',
    label: 'Peer meshes',
    hint: 'Tags that reach themselves: every member at its own address',
  },
  {
    id: 'capability',
    label: 'Capability targets',
    hint: 'Apps that read capabilities matched on their own address',
  },
  {
    id: 'autogroup',
    label: 'Autogroups',
    hint: "Each user's own devices, the internet through exit nodes, …",
  },
  {
    id: 'device',
    label: 'Devices',
    hint: 'Reached at their own address, for a reason their tag entity gives',
  },
  {
    id: 'any',
    label: 'Everything',
    hint: 'Break-glass: every device on every port',
  },
];

const ROW = 30;
const HEADING = 26;
const NODE_HEIGHT = 22;
const TOP = 34;
const WIDTH = 980;
const CHAR_WIDTH = 7.3;

type Layer = 'network' | 'capability';

interface Node {
  name: string;
  kind: PrincipalKind;
  y: number;
  width: number;
  /** A device destination without a declared reason. */
  unexplained?: boolean;
}

interface Edge {
  src: string;
  dst: string;
  layer: Layer;
  ports: Set<string>;
  caps: Set<string>;
  catalog: boolean;
}

/** Unhovered, capability lines a little stronger: they're dashed. */
const restingOpacity = (capability: boolean) => (capability ? 0.7 : 0.55);

const width = (name: string) =>
  Math.max(80, (name === '*' ? 10 : name.length) * CHAR_WIDTH + 34);

/**
 * Who reaches what: every grant's sources on the left, its destinations on
 * the right, grouped by what they are (Services, peer meshes, capability
 * targets, …). Grants that carry capabilities are a layer of their own:
 * dashed, labelled with the capability, and kept out of the network trace.
 * Hovering a selector traces it; clicking it filters the grants.
 */
export function AccessMap(props: {
  grants: GrantRule[];
  destinations?: DestinationView[];
  onSelect?: (name: string) => void;
}) {
  const [hover, setHover] = useState<string>();
  const [layers, setLayers] = useState<Record<Layer, boolean>>({
    network: true,
    capability: true,
  });

  const all = useMemo(() => {
    const pairs = new Map<string, Edge>();
    for (const g of props.grants) {
      const layer: Layer = g.app ? 'capability' : 'network';
      for (const s of g.src) {
        for (const d of g.dst) {
          const key = `${layer}\u0000${s.name}\u0000${d.name}`;
          const edge = pairs.get(key) ?? {
            src: s.name,
            dst: d.name,
            layer,
            ports: new Set<string>(),
            caps: new Set<string>(),
            catalog: false,
          };
          g.ip.forEach(p => edge.ports.add(p));
          Object.keys(g.app ?? {}).forEach(c =>
            edge.caps.add(c.split('/cap/')[1] ?? c),
          );
          edge.catalog ||= g.origin === 'catalog';
          pairs.set(key, edge);
        }
      }
    }
    return [...pairs.values()];
  }, [props.grants]);

  const { sources, destinations, headings, edges, height } = useMemo(() => {
    const visible = all.filter(e => layers[e.layer]);
    const rank: Record<string, number> = {
      group: 0,
      user: 1,
      autogroup: 2,
      tag: 3,
      service: 4,
      host: 5,
      address: 6,
      ipset: 7,
      any: 8,
    };
    const left = [...new Set(visible.map(e => e.src))]
      .sort((a, b) => rank[kindOf(a)] - rank[kindOf(b)] || a.localeCompare(b))
      .map(
        (name, i): Node => ({
          name,
          kind: kindOf(name),
          y: TOP + i * ROW,
          width: width(name),
        }),
      );

    const info = new Map((props.destinations ?? []).map(d => [d.name, d]));
    const classOf = (name: string): DestinationClass =>
      info.get(name)?.class ?? (name.startsWith('svc:') ? 'service' : 'device');
    const names = [...new Set(visible.map(e => e.dst))];
    const right: Node[] = [];
    const heads: Array<{ y: number; label: string; hint: string }> = [];
    let y = TOP;
    for (const cls of CLASSES) {
      const inClass = names.filter(n => classOf(n) === cls.id).sort();
      if (!inClass.length) continue;
      heads.push({ y: y + 15, label: cls.label, hint: cls.hint });
      y += HEADING;
      for (const name of inClass) {
        const d = info.get(name);
        right.push({
          name,
          kind: kindOf(name),
          y,
          width: width(name),
          unexplained:
            cls.id === 'device' && name.startsWith('tag:') && !d?.reason,
        });
        y += ROW;
      }
    }
    return {
      sources: left,
      destinations: right,
      headings: heads,
      edges: visible,
      height: Math.max(TOP + left.length * ROW, y) + 4,
    };
  }, [all, layers, props.destinations]);

  const hasCaps = all.some(e => e.layer === 'capability');
  if (!all.length) return null;
  const leftWidth = Math.max(80, ...sources.map(n => n.width));
  const rightX = WIDTH - Math.max(80, ...destinations.map(n => n.width));
  const at = (nodes: Node[], name: string) => nodes.find(n => n.name === name)!;
  const touches = (e: Edge) => !hover || e.src === hover || e.dst === hover;
  const lit = new Set(
    edges.filter(e => hover && touches(e)).flatMap(e => [e.src, e.dst]),
  );

  // One label per destination: what the capability grants to it carry.
  const capabilityLabels = destinations.flatMap(n => {
    const caps = edges.filter(
      e => e.layer === 'capability' && e.dst === n.name,
    );
    if (!caps.length) return [];
    const names = [...new Set(caps.flatMap(e => [...e.caps]))].join(', ');
    return [
      {
        dst: n.name,
        y: n.y - 3,
        text: caps.length > 1 ? `${names} ×${caps.length}` : names,
      },
    ];
  });

  const nodeView = (n: Node, side: 'left' | 'right') => {
    const x = side === 'left' ? leftWidth - n.width : rightX;
    const dim = hover && !lit.has(n.name);
    const colour = COLOUR[n.kind];
    return (
      <g
        key={`${side}:${n.name}`}
        className={`ts-map-node${dim ? ' ts-map-dim' : ''}`}
        transform={`translate(${x}, ${n.y})`}
        onMouseEnter={() => setHover(n.name)}
        onMouseLeave={() => setHover(undefined)}
        onClick={() => props.onSelect?.(n.name)}
        role="button"
        aria-label={n.name}
      >
        <rect
          width={n.width}
          height={NODE_HEIGHT}
          rx={6}
          style={{
            fill: `color-mix(in srgb, ${colour} 10%, var(--bui-bg-neutral-1))`,
            stroke: n.unexplained
              ? 'var(--ts-check)'
              : `color-mix(in srgb, ${colour} 40%, transparent)`,
            strokeDasharray: n.unexplained ? '3 2' : undefined,
          }}
        />
        <circle cx={11} cy={NODE_HEIGHT / 2} r={3.5} style={{ fill: colour }} />
        <text x={22} y={15} style={{ fill: colour }}>
          {n.name === '*' ? 'everything' : n.name}
        </text>
        {n.unexplained ? (
          <title>{`${n.name} is reached as a device and its tag entity doesn't say why`}</title>
        ) : null}
      </g>
    );
  };

  const toggle = (layer: Layer, label: string, sample: JSX.Element) => (
    <label className="ts-map-layer">
      <input
        type="checkbox"
        checked={layers[layer]}
        onChange={e => setLayers(l => ({ ...l, [layer]: e.target.checked }))}
      />
      <svg width="26" height="10" aria-hidden>
        {sample}
      </svg>
      {label}
    </label>
  );

  return (
    <div>
      {hasCaps ? (
        <div className="ts-row ts-small ts-map-layers">
          {toggle(
            'network',
            'Network access',
            <line
              x1="0"
              y1="5"
              x2="26"
              y2="5"
              style={{ stroke: 'var(--ts-neutral)', strokeWidth: 2 }}
            />,
          )}
          {toggle(
            'capability',
            'Capabilities (app grants)',
            <line
              x1="0"
              y1="5"
              x2="26"
              y2="5"
              style={{
                stroke: 'var(--ts-cap)',
                strokeWidth: 2,
                strokeDasharray: '4 3',
              }}
            />,
          )}
        </div>
      ) : null}
      <svg
        className="ts-map"
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-label="Access map: sources and the destinations their grants reach"
      >
        <text className="ts-map-heading" x={0} y={14}>
          Sources
        </text>
        <text className="ts-map-heading" x={WIDTH} y={14} textAnchor="end">
          Destinations
        </text>
        {headings.map(h => (
          <text
            key={h.label}
            className="ts-map-class"
            x={WIDTH}
            y={h.y}
            textAnchor="end"
          >
            {h.label}
            <title>{h.hint}</title>
          </text>
        ))}
        {edges.map(e => {
          const from = at(sources, e.src);
          const to = at(destinations, e.dst);
          const x1 = leftWidth;
          const y1 = from.y + NODE_HEIGHT / 2;
          const x2 = rightX;
          const y2 = to.y + NODE_HEIGHT / 2;
          const mid = (x1 + x2) / 2;
          const on = hover && touches(e);
          const cap = e.layer === 'capability';
          const ports = [...e.ports].join(', ') || 'no ports';
          return (
            <g key={`${e.layer}:${e.src}->${e.dst}`} data-layer={e.layer}>
              <path
                d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                className={`ts-map-edge${hover && !on ? ' ts-map-dim' : ''}${
                  on ? ' ts-map-on' : ''
                }`}
                style={{
                  stroke: cap ? 'var(--ts-cap)' : COLOUR[kindOf(e.src)],
                  strokeDasharray: cap ? '5 4' : undefined,
                  opacity: hover ? undefined : restingOpacity(cap),
                }}
              >
                <title>
                  {cap
                    ? `${e.src} → ${e.dst}: capabilities ${[...e.caps].join(
                        ', ',
                      )} (on ${ports})`
                    : `${e.src} → ${e.dst}: ${ports}${
                        e.catalog ? ' · from the catalog' : ''
                      }`}
                </title>
              </path>
            </g>
          );
        })}
        {capabilityLabels.map(l => (
          <text
            key={l.dst}
            className={`ts-map-cap${
              hover && !lit.has(l.dst) ? ' ts-map-dim' : ''
            }`}
            x={rightX - 6}
            y={l.y}
            textAnchor="end"
          >
            {l.text}
          </text>
        ))}
        {sources.map(n => nodeView(n, 'left'))}
        {destinations.map(n => nodeView(n, 'right'))}
      </svg>
    </div>
  );
}
