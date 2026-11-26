import type { ReactNode } from 'react';
import ArrowIcon from '@material-ui/icons/ArrowForward';
import AcceptIcon from '@material-ui/icons/CheckCircle';
import DenyIcon from '@material-ui/icons/Cancel';
import CheckIcon from '@material-ui/icons/Schedule';
import LockIcon from '@material-ui/icons/Lock';
import CatalogIcon from '@material-ui/icons/AccountTree';
import ChevronIcon from '@material-ui/icons/ChevronRight';
import type {
  ApproverRule,
  DestinationClass,
  DestinationView,
  GrantRule,
  GroupView,
  NodeAttrRule,
  SshRule,
  TagRule,
  TestRule,
} from '../api';
import {
  Avatar,
  Capabilities,
  Chip,
  Chips,
  EntityLink,
  LineLink,
  Ports,
  entityName,
  plural,
} from './primitives';

/** Where a rule comes from: its entity, and its lines in the file. */
function Origin(props: {
  entityRef?: string;
  lines?: [number, number];
  policy?: string;
  children?: ReactNode;
}) {
  return (
    <div className="ts-rule-side">
      {props.children}
      {props.entityRef ? (
        <EntityLink
          className="ts-line-link"
          entityRef={props.entityRef}
          title="The Tailscale entity this comes from"
        >
          {entityName(props.entityRef)}
        </EntityLink>
      ) : null}
      <LineLink lines={props.lines} policy={props.policy} />
    </div>
  );
}

function Heading(props: {
  title?: string;
  description?: string;
  fallback: string;
}) {
  return (
    <div>
      <div className="ts-rule-title">{props.title ?? props.fallback}</div>
      {props.description ? (
        <div className="ts-rule-description">{props.description}</div>
      ) : null}
    </div>
  );
}

/** Column headings over a list of rules, instead of labels in each. */
export function FlowHeader(props: {
  from?: string;
  to?: string;
  right?: string;
}) {
  return (
    <div className="ts-flow ts-flow-head" aria-hidden>
      <div className="ts-flow-label">{props.from ?? 'Source'}</div>
      <div />
      <div className="ts-flow-label">{props.to ?? 'Destination'}</div>
      <div className="ts-flow-ports ts-flow-label">
        {props.right ?? 'Ports'}
      </div>
    </div>
  );
}

function Flow(props: {
  from: ReactNode;
  to: ReactNode;
  fromLabel?: string;
  toLabel?: string;
  right?: ReactNode;
  rightLabel?: string;
}) {
  return (
    <div className="ts-flow">
      <div>
        <div className="ts-flow-label">{props.fromLabel ?? 'Source'}</div>
        {props.from}
      </div>
      <div className="ts-flow-arrow" aria-hidden>
        <ArrowIcon fontSize="inherit" />
      </div>
      <div>
        <div className="ts-flow-label">{props.toLabel ?? 'Destination'}</div>
        {props.to}
      </div>
      <div className="ts-flow-ports">
        {props.right ? (
          <>
            <div className="ts-flow-label">{props.rightLabel ?? 'Ports'}</div>
            {props.right}
          </>
        ) : null}
      </div>
    </div>
  );
}

export function GrantRow(props: { grant: GrantRule; policy?: string }) {
  const g = props.grant;
  return (
    <div className="ts-rule" data-testid="grant">
      <Heading title={g.title} description={g.description} fallback="Grant" />
      <Origin entityRef={g.entityRef} lines={g.lines} policy={props.policy}>
        {g.origin === 'catalog' ? (
          <span
            className="ts-badge ts-badge-catalog"
            title="Rendered from APIs that Components consume across the tailnet"
          >
            <CatalogIcon fontSize="inherit" />
            From the catalog
          </span>
        ) : null}
      </Origin>
      <Flow
        from={<Chips list={g.src} titled />}
        to={<Chips list={g.dst} titled />}
        right={
          g.ip.length ? (
            <Ports ip={g.ip} />
          ) : (
            <span className="ts-muted ts-small">capabilities only</span>
          )
        }
      />
      {g.app || g.via?.length || g.srcPosture?.length || g.edges?.length ? (
        <div className="ts-extra">
          <Capabilities app={g.app} />
          {g.via?.length ? (
            <span className="ts-row ts-small">
              <span className="ts-muted">via</span>
              <Chips list={g.via} />
            </span>
          ) : null}
          {g.srcPosture?.length ? (
            <span className="ts-row ts-small">
              <span className="ts-muted">posture</span>
              <Chips list={g.srcPosture} />
            </span>
          ) : null}
          {g.edges?.length ? <Consumptions edges={g.edges} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function Consumptions(props: { edges: NonNullable<GrantRule['edges']> }) {
  return (
    <details className="ts-details">
      <summary>
        <ChevronIcon fontSize="inherit" />
        Where in the catalog:{' '}
        {plural(props.edges.length, 'annotation', 'annotations')}
      </summary>
      <ul className="ts-small ts-list">
        {props.edges.map(e => (
          <li key={`${e.via} ${e.consumer} ${e.api}`}>
            {e.via === 'tailnet-allow' ? (
              <>
                <EntityLink entityRef={e.api} />{' '}
                <span className="ts-muted">allows</span> <Chips list={e.src} />
              </>
            ) : (
              <>
                <EntityLink entityRef={e.consumer} /> consumes{' '}
                <EntityLink entityRef={e.api} />
              </>
            )}
            {e.providers.length ? (
              <>
                {' '}
                <span className="ts-muted">from</span>{' '}
                {e.providers.map((p, i) => (
                  <span key={p}>
                    {i ? ', ' : ''}
                    <EntityLink entityRef={p} />
                  </span>
                ))}
              </>
            ) : null}
            <span className="ts-muted">
              {' '}
              · {e.src.join(', ')} → {e.dst.join(', ')} on {e.ports.join(', ')}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function SshActionBadge(props: {
  rule: Pick<SshRule, 'action' | 'checkPeriod'>;
}) {
  if (props.rule.action === 'check') {
    return (
      <span
        className="ts-badge ts-badge-check"
        title="Asks the user to sign in again before the session starts"
      >
        <CheckIcon fontSize="inherit" />
        Check{props.rule.checkPeriod ? ` · ${props.rule.checkPeriod}` : ''}
      </span>
    );
  }
  return (
    <span className="ts-badge ts-badge-accept">
      <AcceptIcon fontSize="inherit" />
      Accept
    </span>
  );
}

export function SshRow(props: { rule: SshRule; policy?: string }) {
  const s = props.rule;
  return (
    <div className="ts-rule" data-testid="ssh">
      <Heading
        title={s.title}
        description={s.description}
        fallback="SSH rule"
      />
      <Origin entityRef={s.entityRef} lines={s.lines} policy={props.policy}>
        <SshActionBadge rule={s} />
      </Origin>
      <Flow
        from={<Chips list={s.src} titled />}
        to={<Chips list={s.dst} titled />}
        rightLabel="As"
        right={
          <span className="ts-chips">
            {s.users.map(u => (
              <span key={u} className="ts-chip ts-chip-port" title="Local user">
                <LockIcon fontSize="inherit" />
                {u}
              </span>
            ))}
          </span>
        }
      />
      {s.acceptEnv?.length || s.recorder?.length ? (
        <div className="ts-extra ts-small">
          {s.acceptEnv?.length ? (
            <span className="ts-row">
              <span className="ts-muted">environment</span>
              <Chips list={s.acceptEnv} />
            </span>
          ) : null}
          {s.recorder?.length ? (
            <span className="ts-row">
              <span className="ts-muted">recorded by</span>
              <Chips list={s.recorder} />
              {s.enforceRecorder ? (
                <span className="ts-badge">required</span>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function NodeAttrRow(props: { rule: NodeAttrRule; policy?: string }) {
  const n = props.rule;
  return (
    <div className="ts-rule" data-testid="node-attr">
      <Heading
        title={n.title}
        description={n.description}
        fallback="Node attribute"
      />
      <Origin entityRef={n.entityRef} lines={n.lines} policy={props.policy} />
      <Flow
        fromLabel="Devices"
        from={<Chips list={n.nodes} titled />}
        toLabel="Get"
        to={
          <span className="ts-chips">
            {n.attr.map(a => (
              <span key={a} className="ts-chip ts-chip-cap">
                {a}
              </span>
            ))}
            {n.ipPool?.map(p => (
              <span key={p} className="ts-chip ts-chip-port" title="IP pool">
                {p}
              </span>
            ))}
          </span>
        }
      />
      {n.app ? (
        <div className="ts-extra">
          <Capabilities app={n.app} />
        </div>
      ) : null}
    </div>
  );
}

export function ApproverRow(props: { rule: ApproverRule; policy?: string }) {
  const a = props.rule;
  const what = {
    service: 'May serve',
    route: 'May advertise the route',
    exitNode: 'May be an exit node',
  }[a.kind];
  return (
    <div className="ts-rule" data-testid="approver">
      <Heading
        title={a.title}
        description={a.description}
        fallback={`${what} ${a.target}`}
      />
      <Origin entityRef={a.entityRef} lines={a.lines} policy={props.policy} />
      <Flow
        fromLabel="Devices"
        from={<Chips list={a.approvers} titled />}
        toLabel={what}
        to={
          a.kind === 'exitNode' ? (
            <span className="ts-badge">exit node</span>
          ) : (
            <Chips list={[a.target]} />
          )
        }
      />
    </div>
  );
}

const ICON = { accept: AcceptIcon, deny: DenyIcon, check: CheckIcon } as const;

function Expectation(props: {
  kind: 'accept' | 'deny' | 'check';
  items: string[];
  ssh: boolean;
}) {
  if (!props.items.length) return null;
  const Icon = ICON[props.kind];
  const label = {
    accept: props.ssh ? 'may log in as' : 'can reach',
    deny: props.ssh ? 'may not log in as' : 'cannot reach',
    check: 'logs in after a check as',
  }[props.kind];
  return (
    <div className={`ts-test ts-test-${props.kind}`}>
      <Icon fontSize="inherit" />
      <div>
        <div className="ts-small ts-muted">{label}</div>
        <span className="ts-chips">
          {props.items.map(item => (
            <span key={item} className={`ts-chip ts-chip-${props.kind}`}>
              {item}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

/** The tests of one entity. */
export function TestGroup(props: { tests: TestRule[]; policy?: string }) {
  const [first] = props.tests;
  const lines: [number, number] | undefined = props.tests.every(t => t.lines)
    ? [
        Math.min(...props.tests.map(t => t.lines![0])),
        Math.max(...props.tests.map(t => t.lines![1])),
      ]
    : undefined;
  return (
    <div className="ts-rule" data-testid="test-group">
      <Heading
        title={first.title}
        description={first.description}
        fallback="Tests"
      />
      <Origin entityRef={first.entityRef} lines={lines} policy={props.policy}>
        <span className="ts-badge">{plural(props.tests.length, 'test')}</span>
      </Origin>
      <div style={{ gridColumn: '1 / -1' }} className="ts-stack">
        {props.tests.map(t => (
          <div key={t.id} className="ts-card" style={{ padding: '10px 12px' }}>
            <div className="ts-row" style={{ marginBottom: 8 }}>
              <span className="ts-badge">
                {t.kind === 'ssh' ? 'SSH test' : `${t.proto ?? 'any'} test`}
              </span>
              <Chip principal={t.src} titled />
              {t.dst?.length ? (
                <>
                  <ArrowIcon fontSize="inherit" className="ts-muted" />
                  <Chips list={t.dst} />
                </>
              ) : null}
            </div>
            <div className="ts-stack" style={{ gap: 8 }}>
              <Expectation
                kind="accept"
                items={t.accept}
                ssh={t.kind === 'ssh'}
              />
              <Expectation kind="check" items={t.check} ssh />
              <Expectation kind="deny" items={t.deny} ssh={t.kind === 'ssh'} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const REACHED_AS: Record<DestinationClass, string> = {
  service: 'a Service',
  mesh: 'a peer mesh: every member at its own address',
  capability:
    'a capability target: an app reads capabilities matched on its address',
  autogroup: 'an autogroup',
  any: 'everything',
  device: 'a device',
};

/** How grants reach a tag, and for a device, why (or that nothing says). */
function ReachedAs(props: { destination: DestinationView }) {
  const d = props.destination;
  const unexplained = d.class === 'device' && !d.reason;
  return (
    <div
      className={`ts-small${unexplained ? ' ts-warning' : ''}`}
      style={{ marginTop: 4 }}
    >
      <span className="ts-muted">Reached as </span>
      {REACHED_AS[d.class]}
      {d.reason ? `: ${d.reason}` : ''}
      {unexplained
        ? ", and its entity doesn't say why (specht-labs.de/tailnet-device-reason)"
        : ''}
    </div>
  );
}

export function TagRow(props: {
  tag: TagRule;
  policy?: string;
  /** How grants reach it, if any do. */
  destination?: DestinationView;
}) {
  const t = props.tag;
  return (
    <tr data-testid="tag">
      <td>
        <Chip
          principal={{
            value: t.tag,
            name: t.tag,
            kind: 'tag',
            entityRef: t.entityRef,
          }}
        />
      </td>
      <td>
        <div className="ts-rule-title">{t.title ?? t.tag}</div>
        {t.description ? (
          <div className="ts-rule-description">{t.description}</div>
        ) : null}
        {props.destination ? (
          <ReachedAs destination={props.destination} />
        ) : null}
        {t.appliesTo.length ? (
          <div className="ts-small" style={{ marginTop: 4 }}>
            <span className="ts-muted">Carried by </span>
            {t.appliesTo.map((ref, i) => (
              <span key={ref}>
                {i ? ', ' : ''}
                <EntityLink entityRef={ref} />
              </span>
            ))}
          </div>
        ) : null}
      </td>
      <td>
        <Chips list={t.owners} />
      </td>
      <td className="ts-small ts-muted" style={{ whiteSpace: 'nowrap' }}>
        {t.usage ? plural(t.usage, 'rule') : 'no rules'}
      </td>
      <td>
        <LineLink lines={t.lines} policy={props.policy} />
      </td>
    </tr>
  );
}

export function GroupCard(props: { group: GroupView; policy?: string }) {
  const g = props.group;
  return (
    <div className="ts-card" data-testid="group">
      <div className="ts-card-head">
        <Chip
          principal={{
            value: g.name,
            name: g.name,
            kind: 'group',
            entityRef: g.entityRef,
          }}
        />
        <div style={{ minWidth: 0 }}>
          <h3>
            <EntityLink entityRef={g.entityRef}>{g.title ?? g.name}</EntityLink>
          </h3>
          {g.description ? <p>{g.description}</p> : null}
        </div>
        <span className="ts-spacer" />
        <span className="ts-small ts-muted" style={{ whiteSpace: 'nowrap' }}>
          {plural(g.usage, 'rule')}
        </span>
        <LineLink lines={g.lines} policy={props.policy} />
      </div>
      <div className="ts-card-body ts-row" style={{ gap: 14 }}>
        {g.members.length ? (
          g.members.map(m => (
            <EntityLink
              key={m.entityRef}
              entityRef={m.entityRef}
              className="ts-person"
            >
              <Avatar name={m.title ?? m.login ?? m.entityRef} />
              <span>
                <span className="ts-person-name">
                  {m.title ?? entityName(m.entityRef)}
                </span>
                <br />
                <span className="ts-person-login ts-mono ts-muted">
                  {m.login ?? 'no tailnet login'}
                </span>
              </span>
            </EntityLink>
          ))
        ) : (
          <span className="ts-muted ts-small">No members</span>
        )}
      </div>
    </div>
  );
}
