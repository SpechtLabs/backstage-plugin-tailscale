import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Content,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { useEntity } from '@backstage/plugin-catalog-react';
import PolicyIcon from '@material-ui/icons/Policy';
import OverviewIcon from '@material-ui/icons/Dashboard';
import GrantIcon from '@material-ui/icons/CallMerge';
import SshIcon from '@material-ui/icons/Lock';
import PreviewIcon from '@material-ui/icons/Visibility';
import GroupIcon from '@material-ui/icons/People';
import TagIcon from '@material-ui/icons/LocalOffer';
import HostIcon from '@material-ui/icons/Computer';
import AttrIcon from '@material-ui/icons/Tune';
import ApproveIcon from '@material-ui/icons/DoneAll';
import TestIcon from '@material-ui/icons/PlaylistAddCheck';
import FileIcon from '@material-ui/icons/Description';
import SearchIcon from '@material-ui/icons/Search';
import DownloadIcon from '@material-ui/icons/GetApp';
import CopyIcon from '@material-ui/icons/FileCopy';
import ErrorIcon from '@material-ui/icons/Error';
import WarningIcon from '@material-ui/icons/Warning';
import HealthyIcon from '@material-ui/icons/VerifiedUser';
import CatalogIcon from '@material-ui/icons/AccountTree';
import PullRequestIcon from '@material-ui/icons/CallSplit';
import OwnerIcon from '@material-ui/icons/Group';
import ClockIcon from '@material-ui/icons/Schedule';
import PushIcon from '@material-ui/icons/Publish';
import type {
  Diagnostic,
  PublishStatus,
  Overview,
  PolicyView,
  TailscaleType,
  TestRule,
} from '../api';
import { AccessMap } from './AccessMap';
import { CodeView } from './CodeView';
import { Preview } from './Preview';
import {
  Empty,
  EntityLink,
  LineLink,
  entityName,
  matches,
  plural,
  since,
  useOverview,
} from './primitives';
import {
  ApproverRow,
  FlowHeader,
  GrantRow,
  GroupCard,
  NodeAttrRow,
  SshRow,
  TagRow,
  TestGroup,
} from './rules';
import '../tailscale.css';

type Section =
  | 'overview'
  | 'grants'
  | 'ssh'
  | 'preview'
  | 'groups'
  | 'tags'
  | 'hosts'
  | 'nodeAttrs'
  | 'autoApprovers'
  | 'tests'
  | 'file';

const SECTIONS: Array<{
  heading?: string;
  id: Section;
  label: string;
  icon: ReactNode;
  count?: (p: PolicyView) => number;
}> = [
  {
    id: 'overview',
    label: 'Overview',
    icon: <OverviewIcon fontSize="inherit" />,
  },
  {
    heading: 'Access',
    id: 'grants',
    label: 'Grants',
    icon: <GrantIcon fontSize="inherit" />,
    count: p => p.grants.length,
  },
  {
    id: 'ssh',
    label: 'Tailscale SSH',
    icon: <SshIcon fontSize="inherit" />,
    count: p => p.ssh.length,
  },
  {
    id: 'preview',
    label: 'Preview access',
    icon: <PreviewIcon fontSize="inherit" />,
  },
  {
    heading: 'Identity',
    id: 'groups',
    label: 'Groups',
    icon: <GroupIcon fontSize="inherit" />,
    count: p => p.groups.length,
  },
  {
    id: 'tags',
    label: 'Tags',
    icon: <TagIcon fontSize="inherit" />,
    count: p => p.tags.length,
  },
  {
    id: 'hosts',
    label: 'Hosts',
    icon: <HostIcon fontSize="inherit" />,
    count: p => p.hosts.length,
  },
  {
    heading: 'Devices',
    id: 'nodeAttrs',
    label: 'Node attributes',
    icon: <AttrIcon fontSize="inherit" />,
    count: p => p.nodeAttrs.length,
  },
  {
    id: 'autoApprovers',
    label: 'Auto approvers',
    icon: <ApproveIcon fontSize="inherit" />,
    count: p => p.autoApprovers.length,
  },
  {
    heading: 'Verify',
    id: 'tests',
    label: 'Tests',
    icon: <TestIcon fontSize="inherit" />,
    count: p => p.tests.length,
  },
  { id: 'file', label: 'Policy file', icon: <FileIcon fontSize="inherit" /> },
];

const TYPE_LABEL: Record<TailscaleType, string> = {
  policy: 'Policy',
  grant: 'Grants',
  ssh: 'SSH rules',
  tag: 'Tags',
  nodeAttr: 'Node attributes',
  autoApprovers: 'Auto approvers',
  test: 'Tests',
};

function download(policy: PolicyView) {
  const url = URL.createObjectURL(
    new Blob([policy.text], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `${policy.name}.hujson`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Where the file goes, and what the last run did. */
function PublishMeta(props: { publish: PublishStatus }) {
  const p = props.publish;
  const where = `${p.repo}: ${p.path}${p.branch ? ` on ${p.branch}` : ''}`;
  const verb = p.flow === 'push' ? 'Pushes to' : 'Pull request in';
  if (p.problem) {
    return (
      <span title={where} className="ts-warning">
        <WarningIcon fontSize="inherit" />
        Not published: {p.problem}
      </span>
    );
  }
  return (
    <span
      title={`${where}${
        p.last ? ` · last run ${since(p.last.at)}: ${p.last.outcome}` : ''
      }${p.last?.error ? ` (${p.last.error})` : ''}`}
    >
      {p.flow === 'push' ? (
        <PushIcon fontSize="inherit" />
      ) : (
        <PullRequestIcon fontSize="inherit" />
      )}
      {p.last?.url ? (
        <a href={p.last.url} target="_blank" rel="noreferrer">
          {verb} {p.repo}
        </a>
      ) : (
        <>
          {verb} {p.repo}
          {p.last ? ` · ${p.last.outcome}` : ''}
        </>
      )}
    </span>
  );
}

function Hero(props: {
  overview: Overview;
  policy: PolicyView;
  onPolicy: (name: string) => void;
}) {
  const { policy, overview } = props;
  const publish = overview.publish[policy.entityRef];
  const [copied, setCopied] = useState(false);
  return (
    <div className="ts-hero">
      <div
        className="ts-row"
        style={{ alignItems: 'flex-start', gap: 14, flexWrap: 'nowrap' }}
      >
        <span className="ts-hero-mark" aria-hidden>
          <PolicyIcon />
        </span>
        <div>
          <h1>{policy.title ?? policy.name}</h1>
          {policy.tailnet ? (
            <div className="ts-mono ts-muted">{policy.tailnet}</div>
          ) : null}
          {policy.description ? (
            <p className="ts-muted">{policy.description}</p>
          ) : null}
          <div className="ts-meta">
            {policy.owner ? (
              <span>
                <OwnerIcon fontSize="inherit" />
                <EntityLink
                  entityRef={
                    policy.owner.includes(':')
                      ? policy.owner
                      : `group:${policy.owner}`
                  }
                />
              </span>
            ) : null}
            <span>
              <CatalogIcon fontSize="inherit" />
              <EntityLink entityRef={policy.entityRef}>
                {plural(policy.parts.length, 'entity', 'entities')}
              </EntityLink>
            </span>
            <span title={new Date(policy.renderedAt).toLocaleString()}>
              <ClockIcon fontSize="inherit" />
              Rendered {since(policy.renderedAt)}
            </span>
            {publish ? <PublishMeta publish={publish} /> : null}
          </div>
        </div>
      </div>
      <div className="ts-row">
        {overview.policies.length > 1 ? (
          <select
            className="ts-select"
            aria-label="Policy"
            style={{ minWidth: 0 }}
            value={policy.name}
            onChange={e => props.onPolicy(e.target.value)}
          >
            {overview.policies.map(p => (
              <option key={p.entityRef} value={p.name}>
                {p.title ?? p.name}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          className="ts-button"
          onClick={() =>
            navigator.clipboard?.writeText(policy.text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          <CopyIcon fontSize="inherit" />
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          className="ts-button ts-button-primary"
          onClick={() => download(policy)}
        >
          <DownloadIcon fontSize="inherit" />
          Download policy
        </button>
      </div>
    </div>
  );
}

function SectionHeader(props: {
  title: string;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className="ts-row"
      style={{ alignItems: 'flex-end', marginBottom: 16 }}
    >
      <div style={{ flex: 1, minWidth: 260 }}>
        <h2 className="ts-section-title">{props.title}</h2>
        {props.lede ? (
          <p className="ts-section-lede" style={{ margin: 0 }}>
            {props.lede}
          </p>
        ) : null}
      </div>
      {props.children}
    </div>
  );
}

function Search(props: {
  value: string;
  onChange: (q: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="ts-search">
      <SearchIcon fontSize="inherit" />
      <input
        type="search"
        value={props.value}
        placeholder={
          props.placeholder ?? 'Filter: tag:ceph, group:admins, 443 …'
        }
        onChange={e => props.onChange(e.target.value)}
        aria-label="Filter"
      />
    </label>
  );
}

function Problems(props: { diagnostics: Diagnostic[] }) {
  if (!props.diagnostics.length) {
    return (
      <div className="ts-healthy">
        <HealthyIcon fontSize="inherit" />
        Every selector resolves: each group is a Backstage Group, each tag is
        declared, each host is known.
      </div>
    );
  }
  return (
    <div>
      {props.diagnostics.map((d, i) => (
        <div key={i} className={`ts-problem ts-problem-${d.severity}`}>
          {d.severity === 'error' ? (
            <ErrorIcon fontSize="inherit" />
          ) : (
            <WarningIcon fontSize="inherit" />
          )}
          <div>
            {d.entityRef ? (
              <div className="ts-small">
                <EntityLink entityRef={d.entityRef} />
              </div>
            ) : null}
            <div>{d.message}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OverviewSection(props: {
  policy: PolicyView;
  problems: Diagnostic[];
  go: (section: Section, extra?: Record<string, string>) => void;
}) {
  const { policy, go } = props;
  const fromCatalog = policy.grants.filter(g => g.origin === 'catalog').length;
  const catalogEdges = (via: 'consumesApi' | 'tailnet-allow') =>
    policy.grants.flatMap(g => g.edges ?? []).filter(e => e.via === via).length;
  const stats: Array<[Section, number, string, ReactNode]> = [
    [
      'grants',
      policy.grants.length,
      'Grants',
      <GrantIcon fontSize="inherit" />,
    ],
    ['ssh', policy.ssh.length, 'SSH rules', <SshIcon fontSize="inherit" />],
    [
      'groups',
      policy.groups.length,
      'Groups',
      <GroupIcon fontSize="inherit" />,
    ],
    ['tags', policy.tags.length, 'Tags', <TagIcon fontSize="inherit" />],
    [
      'autoApprovers',
      policy.autoApprovers.length,
      'Auto-approved',
      <ApproveIcon fontSize="inherit" />,
    ],
    ['tests', policy.tests.length, 'Tests', <TestIcon fontSize="inherit" />],
  ];
  return (
    <>
      <div className="ts-stats">
        {stats.map(([section, value, label, icon]) => (
          <button
            key={section}
            type="button"
            className="ts-stat"
            onClick={() => go(section)}
          >
            <div className="ts-stat-value">{value}</div>
            <div className="ts-stat-label">
              {icon}
              {label}
            </div>
          </button>
        ))}
      </div>

      <div className="ts-card">
        <div className="ts-card-head">
          <div>
            <h3>Access map</h3>
            <p>
              Every grant: sources on the left, what they reach on the right, by
              what it is. Dashed lines are capability grants. Hover a selector
              to trace it, click it to see its grants.
            </p>
          </div>
        </div>
        <div className="ts-card-body">
          <AccessMap
            grants={policy.grants}
            destinations={policy.destinations}
            onSelect={name => go('grants', { q: name })}
          />
        </div>
      </div>

      <div className="ts-card">
        <div className="ts-card-head">
          <div>
            <h3>Health</h3>
            <p>What the catalog says that the policy can't use.</p>
          </div>
          <span className="ts-spacer" />
          {props.problems.length ? (
            <span className="ts-badge ts-badge-error">
              {plural(props.problems.length, 'problem')}
            </span>
          ) : null}
        </div>
        <Problems diagnostics={props.problems} />
      </div>

      {policy.catalog.enabled ? (
        <div className="ts-card">
          <div className="ts-card-head">
            <div>
              <h3>From the catalog</h3>
              <p>
                Grants made from the services' own annotations: an API's
                specht-labs.de/tailnet-dst and -ports say where it is reached;
                every Component that consumes it across the tailnet reaches it
                as its tailnet-src (or the API's tailnet-client-tag), and
                whoever its tailnet-allow names may use it too.
              </p>
            </div>
          </div>
          <div className="ts-card-body">
            <dl className="ts-kv">
              <dt>Grants</dt>
              <dd>
                <button
                  type="button"
                  className="ts-button"
                  onClick={() => go('grants', { origin: 'catalog' })}
                >
                  {plural(fromCatalog, 'grant')} from{' '}
                  {plural(catalogEdges('consumesApi'), 'API consumption')} and{' '}
                  {plural(catalogEdges('tailnet-allow'), 'tailnet-allow')}
                </button>
              </dd>
              <dt>Already allowed</dt>
              <dd>
                {policy.catalog.covered.length ? (
                  policy.catalog.covered.map(c => (
                    <div key={`${c.consumer}${c.api}`} className="ts-small">
                      <EntityLink entityRef={c.consumer} /> →{' '}
                      <EntityLink entityRef={c.api} />{' '}
                      <span className="ts-muted">by</span>{' '}
                      {c.coveredBy.map(id =>
                        id.startsWith('tailscale:') ? (
                          <EntityLink key={id} entityRef={id} />
                        ) : (
                          id
                        ),
                      )}
                    </div>
                  ))
                ) : (
                  <span className="ts-muted ts-small">
                    No consumption that a grant entity already allows.
                  </span>
                )}
              </dd>
              <dt>Inside a cluster</dt>
              <dd className="ts-small">
                {policy.catalog.local.length ? (
                  <details className="ts-details" style={{ marginTop: 0 }}>
                    <summary>
                      {plural(policy.catalog.local.length, 'consumption')} on
                      the pod network, not the tailnet
                    </summary>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      {policy.catalog.local.map(l => (
                        <li key={`${l.consumer}${l.api}`}>
                          <EntityLink entityRef={l.consumer} /> →{' '}
                          <EntityLink entityRef={l.api} />{' '}
                          <span className="ts-muted">
                            in {entityName(l.cluster)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <span className="ts-muted">None</span>
                )}
              </dd>
            </dl>
          </div>
        </div>
      ) : null}
    </>
  );
}

function List(props: {
  children: ReactNode;
  empty: string;
  icon: ReactNode;
  count: number;
  columns?: { from?: string; to?: string; right?: string };
}) {
  if (!props.count) {
    return (
      <div className="ts-card">
        <Empty icon={props.icon}>{props.empty}</Empty>
      </div>
    );
  }
  return (
    <div className="ts-card">
      {props.columns ? <FlowHeader {...props.columns} /> : null}
      <div className={`ts-rules${props.columns ? ' ts-rules-headed' : ''}`}>
        {props.children}
      </div>
    </div>
  );
}

function FileSection(props: {
  policy: PolicyView;
  lines?: string;
  focus?: string;
  onFocus: (ref?: string) => void;
}) {
  const { policy } = props;
  const highlight = useMemo(() => {
    if (props.focus) {
      return policy.spans
        .filter(s => s.entityRef === props.focus)
        .map(s => s.lines);
    }
    const m = /^(\d+)(?:-(\d+))?$/.exec(props.lines ?? '');
    return m ? [[Number(m[1]), Number(m[2] ?? m[1])] as [number, number]] : [];
  }, [policy, props.focus, props.lines]);
  const byType = useMemo(() => {
    const out = new Map<TailscaleType, typeof policy.parts>();
    for (const part of policy.parts) {
      out.set(part.type, [...(out.get(part.type) ?? []), part]);
    }
    return out;
  }, [policy]);
  const lineCount = policy.text.split('\n').length - 1;
  return (
    <>
      <SectionHeader
        title="Policy file"
        lede={`The tailnet policy file, ${lineCount} lines, exactly as Tailscale gets it. Pick an entity to see what it renders to.`}
      />
      <div className="ts-file">
        <div className="ts-card">
          <div className="ts-card-head">
            <FileIcon fontSize="inherit" />
            <span className="ts-mono">{policy.name}.hujson</span>
            <span className="ts-spacer" />
            {props.focus ? (
              <button
                type="button"
                className="ts-button"
                onClick={() => props.onFocus(undefined)}
              >
                Clear selection
              </button>
            ) : null}
          </div>
          <CodeView
            text={policy.text}
            highlight={highlight}
            scroll
            lineHref={n => `?section=file&policy=${policy.name}&lines=${n}`}
          />
        </div>
        <div className="ts-card ts-outline" aria-label="Entities">
          {[...byType.entries()].map(([type, parts]) => (
            <div key={type}>
              <h4>{TYPE_LABEL[type]}</h4>
              {parts.map(part => (
                <button
                  key={part.entityRef}
                  type="button"
                  aria-pressed={props.focus === part.entityRef}
                  onClick={() => props.onFocus(part.entityRef)}
                  title={part.title}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {part.title ?? part.name}
                  </span>
                  <span className="ts-mono ts-muted" style={{ fontSize: 11 }}>
                    {part.lines[0] ? `L${part.lines[0][0]}` : ''}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** Tests, one block per entity. */
function groupTests(tests: TestRule[]) {
  const out = new Map<string, TestRule[]>();
  for (const t of tests) {
    const key = t.entityRef ?? t.id;
    out.set(key, [...(out.get(key) ?? []), t]);
  }
  return [...out.values()];
}

/** One policy, section by section. */
export function PolicyConsole(props: {
  overview: Overview;
  policyRef?: string;
}) {
  const [params, setParams] = useSearchParams();
  const { overview } = props;
  const policy =
    overview.policies.find(p => p.entityRef === props.policyRef) ??
    overview.policies.find(p => p.name === params.get('policy')) ??
    overview.policies[0];
  const section = (params.get('section') as Section) || 'overview';
  const q = params.get('q') ?? '';
  const origin = params.get('origin');

  const update = (
    next: Record<string, string | undefined>,
    replace = false,
  ) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === '') p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace });
  };
  const go = (s: Section, extra: Record<string, string> = {}) =>
    update({
      section: s,
      q: undefined,
      origin: undefined,
      lines: undefined,
      focus: undefined,
      ...extra,
    });

  if (!policy) {
    return (
      <Empty icon={<PolicyIcon />}>
        No Tailscale policy in the catalog yet. Add an entity of kind Tailscale
        with spec.type: policy.
      </Empty>
    );
  }
  const problems = [...policy.diagnostics, ...overview.orphans];
  const filtered = <T,>(list: T[]) => list.filter(item => matches(q, item));
  const name = policy.name;
  const searchBox = (
    <Search value={q} onChange={value => update({ q: value }, true)} />
  );

  let body: ReactNode;
  switch (section) {
    case 'grants': {
      const grants = filtered(policy.grants).filter(
        g => !origin || g.origin === origin,
      );
      body = (
        <>
          <SectionHeader
            title="Grants"
            lede="Who may reach what, on which ports, with which capabilities. Grants only allow: what no grant names is denied."
          >
            <select
              className="ts-select"
              style={{ minWidth: 0 }}
              aria-label="Origin"
              value={origin ?? ''}
              onChange={e => update({ origin: e.target.value }, true)}
            >
              <option value="">All grants</option>
              <option value="entity">Declared</option>
              <option value="catalog">From the catalog</option>
            </select>
            {searchBox}
          </SectionHeader>
          <List
            count={grants.length}
            icon={<GrantIcon />}
            columns={{}}
            empty="No grant matches."
          >
            {grants.map(g => (
              <GrantRow key={g.id} grant={g} policy={name} />
            ))}
          </List>
        </>
      );
      break;
    }
    case 'ssh': {
      const rules = filtered(policy.ssh);
      body = (
        <>
          <SectionHeader
            title="Tailscale SSH"
            lede="Who may open a shell where, as which local user. Check mode asks for a fresh sign-in first."
          >
            {searchBox}
          </SectionHeader>
          <List
            count={rules.length}
            icon={<SshIcon />}
            columns={{ right: 'As' }}
            empty="No SSH rule matches."
          >
            {rules.map(s => (
              <SshRow key={s.id} rule={s} policy={name} />
            ))}
          </List>
        </>
      );
      break;
    }
    case 'preview':
      body = (
        <>
          <SectionHeader
            title="Preview access"
            lede="What the policy lets someone reach, or who reaches something, rule by rule."
          />
          <Preview policy={policy} />
        </>
      );
      break;
    case 'groups': {
      const groups = filtered(policy.groups);
      body = (
        <>
          <SectionHeader
            title="Groups"
            lede="Backstage Groups with a specht-labs.de/tailnet-group annotation, and their Users' tailnet logins. Change membership in the catalog."
          >
            {searchBox}
          </SectionHeader>
          {groups.length ? (
            groups.map(g => (
              <GroupCard key={g.entityRef} group={g} policy={name} />
            ))
          ) : (
            <div className="ts-card">
              <Empty icon={<GroupIcon />}>No group matches.</Empty>
            </div>
          )}
        </>
      );
      break;
    }
    case 'tags': {
      const tags = filtered(policy.tags);
      body = (
        <>
          <SectionHeader
            title="Tags"
            lede="What a device is or does, and who may give a device the tag."
          >
            {searchBox}
          </SectionHeader>
          <div className="ts-card">
            {tags.length ? (
              <table className="ts-table">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>What it means</th>
                    <th>Owners</th>
                    <th>Used in</th>
                    <th aria-label="Line" />
                  </tr>
                </thead>
                <tbody>
                  {tags.map(t => (
                    <TagRow
                      key={t.id}
                      tag={t}
                      policy={name}
                      destination={policy.destinations.find(
                        d => d.name === t.tag,
                      )}
                    />
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty icon={<TagIcon />}>No tag matches.</Empty>
            )}
          </div>
        </>
      );
      break;
    }
    case 'hosts':
      body = (
        <>
          <SectionHeader
            title="Hosts"
            lede="Names for addresses, from the policy entity. The tests use them to name devices."
          />
          <div className="ts-card">
            {policy.hosts.length ? (
              <table className="ts-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Address</th>
                    <th aria-label="Line" />
                  </tr>
                </thead>
                <tbody>
                  {policy.hosts.map(h => (
                    <tr key={h.name}>
                      <td className="ts-mono">{h.name}</td>
                      <td className="ts-mono ts-muted">{h.address}</td>
                      <td>
                        <LineLink lines={h.lines} policy={name} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty icon={<HostIcon />}>No hosts.</Empty>
            )}
          </div>
        </>
      );
      break;
    case 'nodeAttrs': {
      const rules = filtered(policy.nodeAttrs);
      body = (
        <>
          <SectionHeader
            title="Node attributes"
            lede="Features devices get by tag, or by the group of the user who owns them."
          />
          <List
            count={rules.length}
            icon={<AttrIcon />}
            columns={{ from: 'Devices', to: 'Get', right: ' ' }}
            empty="No node attributes."
          >
            {rules.map(n => (
              <NodeAttrRow key={n.id} rule={n} policy={name} />
            ))}
          </List>
        </>
      );
      break;
    }
    case 'autoApprovers': {
      const rules = filtered(policy.autoApprovers);
      body = (
        <>
          <SectionHeader
            title="Auto approvers"
            lede="The Tailscale Services, routes and exit nodes a device may advertise without approval in the admin console."
          >
            {searchBox}
          </SectionHeader>
          <List
            count={rules.length}
            icon={<ApproveIcon />}
            columns={{ from: 'Devices', to: 'May serve', right: ' ' }}
            empty="No auto approvers."
          >
            {rules.map(a => (
              <ApproverRow key={a.id} rule={a} policy={name} />
            ))}
          </List>
        </>
      );
      break;
    }
    case 'tests': {
      const groups = groupTests(filtered(policy.tests));
      body = (
        <>
          <SectionHeader
            title="Tests"
            lede="Tailscale runs these every time the policy is saved; one that fails rejects the save, and the previous policy stays live."
          >
            {searchBox}
          </SectionHeader>
          <List
            count={groups.length}
            icon={<TestIcon />}
            empty="No test matches."
          >
            {groups.map(tests => (
              <TestGroup key={tests[0].id} tests={tests} policy={name} />
            ))}
          </List>
        </>
      );
      break;
    }
    case 'file':
      body = (
        <FileSection
          policy={policy}
          lines={params.get('lines') ?? undefined}
          focus={params.get('focus') ?? undefined}
          onFocus={ref => update({ focus: ref, lines: undefined }, true)}
        />
      );
      break;
    default:
      body = <OverviewSection policy={policy} problems={problems} go={go} />;
  }

  return (
    <div className="ts">
      <Hero
        overview={overview}
        policy={policy}
        onPolicy={p => update({ policy: p })}
      />
      <div className="ts-shell">
        <nav className="ts-nav" aria-label="Policy sections">
          {SECTIONS.map(s => (
            <div key={s.id} style={{ display: 'contents' }}>
              {s.heading ? (
                <div className="ts-nav-heading">{s.heading}</div>
              ) : null}
              <button
                type="button"
                className="ts-nav-item"
                aria-current={section === s.id ? 'page' : undefined}
                onClick={() => go(s.id)}
              >
                {s.icon}
                {s.label}
                {s.id === 'overview' && problems.length ? (
                  <span className="ts-nav-count ts-nav-count-bad">
                    {problems.length}
                  </span>
                ) : null}
                {s.count ? (
                  <span className="ts-nav-count">{s.count(policy)}</span>
                ) : null}
              </button>
            </div>
          ))}
        </nav>
        <main>{body}</main>
      </div>
    </div>
  );
}

/** /tailscale */
export function TailscalePage() {
  const { value, error, loading } = useOverview();
  return (
    <Content>
      {loading && !value ? <Progress /> : null}
      {error ? <ResponseErrorPanel error={error} /> : null}
      {value ? <PolicyConsole overview={value} /> : null}
    </Content>
  );
}

/** The policy entity's own tab. */
export function PolicyTab() {
  const { entity } = useEntity();
  return <PolicyContent entityRef={stringifyEntityRef(entity)} />;
}

function PolicyContent(props: { entityRef: string }) {
  const { value, error, loading } = useOverview();
  if (loading && !value) return <Progress />;
  if (error) return <ResponseErrorPanel error={error} />;
  return value ? (
    <PolicyConsole overview={value} policyRef={props.entityRef} />
  ) : null;
}
