import {
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useApi, useRouteRef } from '@backstage/frontend-plugin-api';
import { parseEntityRef } from '@backstage/catalog-model';
import { entityRouteRef } from '@backstage/plugin-catalog-react';
import GroupIcon from '@material-ui/icons/People';
import UserIcon from '@material-ui/icons/Person';
import TagIcon from '@material-ui/icons/LocalOffer';
import ServiceIcon from '@material-ui/icons/Dns';
import AutogroupIcon from '@material-ui/icons/GroupWork';
import HostIcon from '@material-ui/icons/Computer';
import AddressIcon from '@material-ui/icons/Language';
import AnyIcon from '@material-ui/icons/AllInclusive';
import IpsetIcon from '@material-ui/icons/ViewList';
import CapabilityIcon from '@material-ui/icons/VpnKey';
import ChevronIcon from '@material-ui/icons/ChevronRight';
import {
  tailscaleApiRef,
  type App,
  type Lines,
  type Overview,
  type Principal,
  type PrincipalKind,
} from '../api';
import { rootRouteRef } from '../routes';

// --- data -------------------------------------------------------------------

export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{
    value?: T;
    error?: Error;
    loading: boolean;
  }>({ loading: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true }));
    run().then(
      value => live && setState({ value, loading: false }),
      error => live && setState({ error, loading: false }),
    );
    return () => {
      live = false;
    };
  }, [run]);
  return state;
}

export function useOverview() {
  const api = useApi(tailscaleApiRef);
  return useAsync<Overview>(() => api.getOverview(), [api]);
}

// --- links ------------------------------------------------------------------

/** The catalog page of an entity. */
export function useEntityPath() {
  const entityRoute = useRouteRef(entityRouteRef);
  return (ref: string) => {
    const { kind, namespace, name } = parseEntityRef(ref);
    return entityRoute
      ? entityRoute({ kind: kind.toLowerCase(), namespace, name })
      : `/catalog/${namespace}/${kind.toLowerCase()}/${name}`;
  };
}

/** A place on the Tailscale page: a section, a search, lines of the file. */
export function useConsolePath() {
  const root = useRouteRef(rootRouteRef);
  return (params: Record<string, string | undefined>) => {
    const search = new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => !!e[1]),
    );
    const base = root?.() ?? '/tailscale';
    return `${base}${search.size ? `?${search}` : ''}`;
  };
}

export const entityName = (ref: string) => parseEntityRef(ref).name;

export function EntityLink(props: {
  entityRef: string;
  children?: ReactNode;
  className?: string;
  title?: string;
}) {
  const path = useEntityPath();
  return (
    <RouterLink
      to={path(props.entityRef)}
      className={props.className}
      title={props.title}
    >
      {props.children ?? entityName(props.entityRef)}
    </RouterLink>
  );
}

/** "L120–134": opens the rendered file at those lines. */
export function LineLink(props: { lines?: Lines; policy?: string }) {
  const path = useConsolePath();
  if (!props.lines) return null;
  const [from, to] = props.lines;
  return (
    <RouterLink
      className="ts-line-link"
      title="Show in the policy file"
      to={path({
        section: 'file',
        policy: props.policy,
        lines: `${from}-${to}`,
      })}
    >
      L{from}
      {to !== from ? `–${to}` : ''}
    </RouterLink>
  );
}

// --- selectors --------------------------------------------------------------

const ICONS: Record<PrincipalKind, ComponentType<{ fontSize?: 'inherit' }>> = {
  group: GroupIcon,
  user: UserIcon,
  tag: TagIcon,
  service: ServiceIcon,
  autogroup: AutogroupIcon,
  host: HostIcon,
  address: AddressIcon,
  any: AnyIcon,
  ipset: IpsetIcon,
};

const KIND_LABEL: Record<PrincipalKind, string> = {
  group: 'Group',
  user: 'User',
  tag: 'Tag',
  service: 'Tailscale Service',
  autogroup: 'Autogroup',
  host: 'Host',
  address: 'Address',
  any: 'Everything',
  ipset: 'IP set',
};

export function kindOf(name: string): PrincipalKind {
  if (name === '*') return 'any';
  const prefix = name.split(':')[0];
  const kinds: Record<string, PrincipalKind> = {
    group: 'group',
    tag: 'tag',
    svc: 'service',
    autogroup: 'autogroup',
    ipset: 'ipset',
    user: 'user',
  };
  if (kinds[prefix]) return kinds[prefix];
  if (name.includes('@')) return 'user';
  return /^[\d.:/a-f]+$/i.test(name) ? 'address' : 'host';
}

export function KindIcon(props: { kind: PrincipalKind }) {
  const Icon = ICONS[props.kind];
  return <Icon fontSize="inherit" />;
}

/**
 * A source, destination, owner or approver. Links to its catalog entity
 * (the Group, the User, the tag's entity) when it has one, else to
 * everything on the page that names it.
 */
export function Chip(props: {
  principal: Principal | string;
  /** Show the catalog title next to the name. */
  titled?: boolean;
  onSelect?: (name: string) => void;
}) {
  const entityPath = useEntityPath();
  const consolePath = useConsolePath();
  const p: Principal =
    typeof props.principal === 'string'
      ? {
          value: props.principal,
          name: props.principal,
          kind: kindOf(props.principal),
        }
      : props.principal;
  const label = p.kind === 'any' ? 'everything' : p.name;
  const tooltip = [
    KIND_LABEL[p.kind],
    p.title && p.title !== p.name ? p.title : undefined,
    p.value !== p.name ? `written as ${p.value}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const content = (
    <>
      <KindIcon kind={p.kind} />
      <span>{label}</span>
      {props.titled && p.title && p.title !== p.name && p.kind !== 'host' ? (
        <span className="ts-chip-title">{p.title}</span>
      ) : null}
    </>
  );
  const className = `ts-chip ts-chip-${p.kind}`;
  if (props.onSelect) {
    return (
      <button
        type="button"
        className={className}
        title={tooltip}
        onClick={() => props.onSelect!(p.name)}
      >
        {content}
      </button>
    );
  }
  const to = p.entityRef
    ? entityPath(p.entityRef)
    : consolePath({ section: 'grants', q: p.name });
  return (
    <RouterLink className={className} title={tooltip} to={to}>
      {content}
    </RouterLink>
  );
}

export function Chips(props: {
  list?: Array<Principal | string>;
  titled?: boolean;
  onSelect?: (name: string) => void;
  empty?: ReactNode;
}) {
  if (!props.list?.length) return <>{props.empty ?? null}</>;
  return (
    <span className="ts-chips">
      {props.list.map(p => (
        <Chip
          key={typeof p === 'string' ? p : `${p.kind}:${p.value}`}
          principal={p}
          titled={props.titled}
          onSelect={props.onSelect}
        />
      ))}
    </span>
  );
}

export function Ports(props: { ip: string[] }) {
  if (!props.ip.length) return null;
  return (
    <span className="ts-chips">
      {props.ip.map(port => (
        <span key={port} className="ts-chip ts-chip-port" title="Ports">
          {port === '*' ? 'all ports' : port}
        </span>
      ))}
    </span>
  );
}

const shortCapability = (name: string) => name.split('/cap/')[1] ?? name;

/** Application capabilities: chips, and their values on request. */
export function Capabilities(props: { app?: App | Record<string, unknown> }) {
  const names = Object.keys(props.app ?? {});
  if (!names.length) return null;
  return (
    <div>
      <span className="ts-chips">
        {names.map(name => (
          <span key={name} className="ts-chip ts-chip-cap" title={name}>
            <CapabilityIcon fontSize="inherit" />
            {shortCapability(name)}
          </span>
        ))}
      </span>
      <details className="ts-details">
        <summary>
          <ChevronIcon fontSize="inherit" />
          What the capabilities carry
        </summary>
        <pre className="ts-json">{JSON.stringify(props.app, null, 2)}</pre>
      </details>
    </div>
  );
}

// --- people -----------------------------------------------------------------

const AVATAR_COLOURS = [
  '#6941c6',
  '#1d64d8',
  '#0e7c6b',
  '#b54708',
  '#c01048',
  '#526077',
];

export function Avatar(props: { name: string }) {
  const initials = props.name
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .map(s => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  let hash = 0;
  for (const c of props.name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      className="ts-avatar"
      style={{ background: AVATAR_COLOURS[hash % AVATAR_COLOURS.length] }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

// --- odds and ends ----------------------------------------------------------

export function since(iso: string) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function Empty(props: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="ts-empty">
      {props.icon}
      {props.children}
    </div>
  );
}

/** Whether a rule mentions the search text anywhere. */
export function matches(query: string, ...values: unknown[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = JSON.stringify(values).toLowerCase();
  return q.split(/\s+/).every(word => haystack.includes(word));
}
