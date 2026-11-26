import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import PreviewIcon from '@material-ui/icons/Visibility';
import type { GrantRule, PolicyView, Principal, SshRule } from '../api';
import {
  Capabilities,
  Chip,
  Chips,
  Empty,
  LineLink,
  Ports,
  kindOf,
} from './primitives';
import { SshActionBadge } from './rules';

type Mode = 'from' | 'to';

/** Everyone and everything the policy names, for the picker. */
function candidates(policy: PolicyView, mode: Mode) {
  const names = new Map<string, string | undefined>();
  const add = (name: string, title?: string) => {
    if (name !== '*' && !names.has(name)) names.set(name, title);
  };
  if (mode === 'from') {
    for (const g of policy.groups) {
      for (const m of g.members) if (m.login) add(m.login, m.title);
    }
    for (const g of policy.groups) add(g.name, g.title);
    for (const t of policy.tags) add(t.tag, t.title);
    for (const r of [...policy.grants, ...policy.ssh])
      r.src.forEach(p => add(p.name, p.title));
  } else {
    for (const r of [...policy.grants, ...policy.ssh])
      r.dst.forEach(p => add(p.name, p.title));
    for (const t of policy.tags) add(t.tag, t.title);
    for (const h of policy.hosts) add(h.name, h.address);
  }
  const rank = {
    user: 0,
    group: 1,
    autogroup: 2,
    tag: 3,
    service: 4,
    host: 5,
    address: 6,
    ipset: 7,
    any: 8,
  };
  return [...names.entries()].sort(
    ([a], [b]) => rank[kindOf(a)] - rank[kindOf(b)] || a.localeCompare(b),
  );
}

/** What `name` is, as far as selectors go: a user is also their groups. */
function identities(policy: PolicyView, name: string, mode: Mode) {
  const out = new Set([name, '*']);
  const kind = kindOf(name);
  if (mode === 'from') {
    if (kind === 'user') {
      out.add('autogroup:member');
      for (const g of policy.groups) {
        if (g.members.some(m => m.login === name)) out.add(g.name);
      }
    }
    if (kind === 'group') out.add('autogroup:member');
    if (kind === 'tag') out.add('autogroup:tagged');
  }
  return out;
}

function GrantTable(props: {
  title: string;
  summary: string;
  grants: GrantRule[];
  mode: Mode;
  via: (r: GrantRule) => Principal[];
  policy: string;
  empty: string;
}) {
  const { mode } = props;
  return (
    <div className="ts-card">
      <div className="ts-card-head">
        <div>
          <h3>{props.title}</h3>
          <p>{props.summary}</p>
        </div>
      </div>
      {props.grants.length ? (
        <table className="ts-table">
          <thead>
            <tr>
              <th>{mode === 'from' ? 'Destination' : 'Source'}</th>
              <th>Ports</th>
              <th>Because of</th>
              <th aria-label="Line" />
            </tr>
          </thead>
          <tbody>
            {props.grants.map(g => (
              <tr key={g.id}>
                <td>
                  <Chips list={mode === 'from' ? g.dst : g.src} titled />
                  <Capabilities app={g.app} />
                </td>
                <td>
                  <Ports ip={g.ip} />
                </td>
                <td>
                  <div className="ts-small">{g.title ?? 'Grant'}</div>
                  <div className="ts-small ts-muted ts-row" style={{ gap: 4 }}>
                    as <Chips list={props.via(g)} />
                  </div>
                </td>
                <td>
                  <LineLink lines={g.lines} policy={props.policy} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty icon={<PreviewIcon />}>{props.empty}</Empty>
      )}
    </div>
  );
}

/**
 * Preview access: pick a user, group or tag and see what the policy lets it
 * reach; or pick a destination and see who reaches it.
 */
export function Preview(props: { policy: PolicyView }) {
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get('mode') === 'to' ? 'to' : 'from';
  const options = useMemo(
    () => candidates(props.policy, mode),
    [props.policy, mode],
  );
  const who = params.get('who') ?? options[0]?.[0] ?? '';

  const set = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) p.set(k, v);
    setParams(p, { replace: true });
  };

  const ids = identities(props.policy, who, mode);
  const side = (r: { src: { name: string }[]; dst: { name: string }[] }) =>
    (mode === 'from' ? r.src : r.dst).some(p => ids.has(p.name));
  const grants = props.policy.grants.filter(side);
  // Capability grants say what an app lets them do, not what they reach:
  // kept apart from network access.
  const network = grants.filter(g => !g.app);
  const capabilities = grants.filter(g => g.app);
  const ssh = props.policy.ssh.filter(side);
  const via = (r: GrantRule | SshRule) =>
    (mode === 'from' ? r.src : r.dst).filter(p => ids.has(p.name));

  return (
    <div>
      <div className="ts-row" style={{ marginBottom: 16 }}>
        <select
          className="ts-select"
          aria-label="Direction"
          style={{ minWidth: 0 }}
          value={mode}
          onChange={e => set({ mode: e.target.value, who: '' })}
        >
          <option value="from">What can … reach?</option>
          <option value="to">Who can reach …?</option>
        </select>
        <select
          className="ts-select"
          aria-label={mode === 'from' ? 'Source' : 'Destination'}
          value={who}
          onChange={e => set({ who: e.target.value })}
        >
          {options.map(([name, title]) => (
            <option key={name} value={name}>
              {name}
              {title && title !== name ? `  ·  ${title}` : ''}
            </option>
          ))}
        </select>
        {mode === 'from' && ids.size > 2 ? (
          <span className="ts-small ts-muted ts-row">
            as
            <Chips list={[...ids].filter(i => i !== '*' && i !== who)} />
          </span>
        ) : null}
      </div>

      <GrantTable
        title={mode === 'from' ? 'Can reach' : 'Reached by'}
        summary={`${network.length} of ${
          props.policy.grants.filter(g => !g.app).length
        } network grants apply`}
        grants={network}
        mode={mode}
        via={via}
        policy={props.policy.name}
        empty="No grant applies."
      />
      {capabilities.length ? (
        <GrantTable
          title="Capabilities"
          summary="Grants that carry application capabilities: what an app (tsidp, the Tailscale web UI, …) lets them do, on the ports named."
          grants={capabilities}
          mode={mode}
          via={via}
          policy={props.policy.name}
          empty=""
        />
      ) : null}

      <div className="ts-card">
        <div className="ts-card-head">
          <div>
            <h3>Tailscale SSH</h3>
            <p>
              {ssh.length ? `${ssh.length} rules apply` : 'No SSH rule applies'}
            </p>
          </div>
        </div>
        {ssh.length ? (
          <table className="ts-table">
            <thead>
              <tr>
                <th>{mode === 'from' ? 'Into' : 'From'}</th>
                <th>As</th>
                <th>Mode</th>
                <th aria-label="Line" />
              </tr>
            </thead>
            <tbody>
              {ssh.map(s => (
                <tr key={s.id}>
                  <td>
                    <Chips list={mode === 'from' ? s.dst : s.src} titled />
                  </td>
                  <td className="ts-mono">{s.users.join(', ')}</td>
                  <td>
                    <SshActionBadge rule={s} />
                  </td>
                  <td>
                    <LineLink lines={s.lines} policy={props.policy.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
      {who ? (
        <p className="ts-small ts-muted" style={{ marginTop: 12 }}>
          Previews the grants and SSH rules for <Chip principal={who} />: what
          names it, its groups, its autogroups and “everything”. Tailscale also
          applies device posture and the tests run when the policy is saved.
        </p>
      ) : null}
    </div>
  );
}
