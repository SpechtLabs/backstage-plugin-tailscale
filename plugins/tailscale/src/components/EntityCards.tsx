import type { ReactNode } from 'react';
import {
  InfoCard,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';
import { useApi } from '@backstage/frontend-plugin-api';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { useEntity } from '@backstage/plugin-catalog-react';
import OutIcon from '@material-ui/icons/CallMade';
import InIcon from '@material-ui/icons/CallReceived';
import SshIcon from '@material-ui/icons/Lock';
import TagIcon from '@material-ui/icons/LocalOffer';
import ApproveIcon from '@material-ui/icons/DoneAll';
import AttrIcon from '@material-ui/icons/Tune';
import TestIcon from '@material-ui/icons/PlaylistAddCheck';
import RuleIcon from '@material-ui/icons/Policy';
import FileIcon from '@material-ui/icons/Description';
import ErrorIcon from '@material-ui/icons/Error';
import WarningIcon from '@material-ui/icons/Warning';
import { Link as RouterLink } from 'react-router-dom';
import {
  tailscaleApiRef,
  type EntityAccess,
  type GrantRule,
  type PolicyView,
  type SshRule,
} from '../api';
import { CodeView, excerpt } from './CodeView';
import {
  Capabilities,
  Chip,
  Chips,
  Empty,
  EntityLink,
  LineLink,
  Ports,
  entityName,
  plural,
  useAsync,
  useConsolePath,
  useOverview,
} from './primitives';
import {
  ApproverRow,
  GrantRow,
  GroupCard,
  NodeAttrRow,
  SshActionBadge,
  SshRow,
  TagRow,
  TestGroup,
} from './rules';
import '../tailscale.css';

function Part(props: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="ts-entity-section">
      <h4>
        {props.icon}
        {props.title}
      </h4>
      {props.children}
    </div>
  );
}

function CompactGrant(props: {
  grant: GrantRule;
  side: 'src' | 'dst';
  policy: string;
}) {
  const g = props.grant;
  return (
    <div className="ts-compact">
      <div className="ts-stack" style={{ gap: 4 }}>
        <span className="ts-row" style={{ gap: 6 }}>
          <Chips list={g[props.side]} titled />
          <Ports ip={g.ip} />
        </span>
        <span className="ts-small ts-muted">{g.title ?? 'Grant'}</span>
        {g.app ? <Capabilities app={g.app} /> : null}
      </div>
      <div className="ts-row" style={{ alignItems: 'flex-start' }}>
        {g.entityRef ? (
          <EntityLink className="ts-line-link" entityRef={g.entityRef}>
            {entityName(g.entityRef)}
          </EntityLink>
        ) : null}
        <LineLink lines={g.lines} policy={props.policy} />
      </div>
    </div>
  );
}

function CompactSsh(props: {
  rule: SshRule;
  side: 'src' | 'dst';
  policy: string;
}) {
  const s = props.rule;
  return (
    <div className="ts-compact">
      <div className="ts-stack" style={{ gap: 4 }}>
        <span className="ts-row" style={{ gap: 6 }}>
          <Chips list={s[props.side]} titled />
          <span className="ts-small ts-muted">as</span>
          <span className="ts-mono ts-small">{s.users.join(', ')}</span>
        </span>
        <span className="ts-small ts-muted">{s.title ?? 'SSH rule'}</span>
      </div>
      <div className="ts-row" style={{ alignItems: 'flex-start' }}>
        <SshActionBadge rule={s} />
        <LineLink lines={s.lines} policy={props.policy} />
      </div>
    </div>
  );
}

function AccessView(props: { access: EntityAccess }) {
  const a = props.access;
  const policy = a.policy.name;
  const consolePath = useConsolePath();
  const nothing =
    !a.outbound.length &&
    !a.inbound.length &&
    !a.sshInto.length &&
    !a.sshFrom.length &&
    !a.approvals.length &&
    !a.nodeAttrs.length;
  const source = a.identities.find(i => i.source);
  return (
    <div className="ts">
      {a.identities.length ? (
        <div className="ts-row" style={{ marginBottom: 14 }}>
          <span className="ts-small ts-muted">
            On {a.policy.tailnet ?? a.policy.title ?? policy} as
          </span>
          {a.identities.map(i => (
            <span key={i.name} title={i.via}>
              <Chip principal={i.name} />
            </span>
          ))}
          {source ? (
            <RouterLink
              className="ts-small ts-link"
              to={consolePath({ section: 'preview', policy, who: source.name })}
            >
              Preview access
            </RouterLink>
          ) : null}
        </div>
      ) : null}

      {a.outbound.length ? (
        <Part
          icon={<OutIcon fontSize="inherit" />}
          title={`Reaches · ${a.outbound.length}`}
        >
          {a.outbound.map(g => (
            <CompactGrant key={g.id} grant={g} side="dst" policy={policy} />
          ))}
        </Part>
      ) : null}
      {a.inbound.length ? (
        <Part
          icon={<InIcon fontSize="inherit" />}
          title={`Reached by · ${a.inbound.length}`}
        >
          {a.inbound.map(g => (
            <CompactGrant key={g.id} grant={g} side="src" policy={policy} />
          ))}
        </Part>
      ) : null}
      {a.sshInto.length ? (
        <Part icon={<SshIcon fontSize="inherit" />} title="SSH into it">
          {a.sshInto.map(s => (
            <CompactSsh key={s.id} rule={s} side="src" policy={policy} />
          ))}
        </Part>
      ) : null}
      {a.sshFrom.length ? (
        <Part icon={<SshIcon fontSize="inherit" />} title="SSH from it">
          {a.sshFrom.map(s => (
            <CompactSsh key={s.id} rule={s} side="dst" policy={policy} />
          ))}
        </Part>
      ) : null}
      {a.approvals.length ? (
        <Part icon={<ApproveIcon fontSize="inherit" />} title="Auto-approved">
          {a.approvals.map(r => (
            <div key={r.id} className="ts-compact">
              <span className="ts-row" style={{ gap: 6 }}>
                <Chips list={r.approvers} />
                <span className="ts-small ts-muted">may serve</span>
                <Chip principal={r.target} />
              </span>
              <LineLink lines={r.lines} policy={policy} />
            </div>
          ))}
        </Part>
      ) : null}
      {a.nodeAttrs.length ? (
        <Part icon={<AttrIcon fontSize="inherit" />} title="Node attributes">
          {a.nodeAttrs.map(n => (
            <div key={n.id} className="ts-compact">
              <span className="ts-row" style={{ gap: 6 }}>
                {n.attr.map(x => (
                  <span key={x} className="ts-chip ts-chip-cap">
                    {x}
                  </span>
                ))}
                <span className="ts-small ts-muted">{n.title}</span>
              </span>
              <LineLink lines={n.lines} policy={policy} />
            </div>
          ))}
        </Part>
      ) : null}
      {a.tags.length ? (
        <Part icon={<TagIcon fontSize="inherit" />} title="Tags">
          <span className="ts-chips">
            {a.tags.map(t => (
              <Chip
                key={t.tag}
                principal={{
                  value: t.tag,
                  name: t.tag,
                  kind: 'tag',
                  entityRef: t.entityRef,
                  title: t.title,
                }}
                titled
              />
            ))}
          </span>
        </Part>
      ) : null}
      {a.owns.length ? (
        <Part
          icon={<TagIcon fontSize="inherit" />}
          title={`May tag devices with · ${a.owns.length}`}
        >
          <span className="ts-chips">
            {a.owns.map(t => (
              <Chip
                key={t.tag}
                principal={{
                  value: t.tag,
                  name: t.tag,
                  kind: 'tag',
                  entityRef: t.entityRef,
                  title: t.title,
                }}
              />
            ))}
          </span>
        </Part>
      ) : null}
      {a.tests.length ? (
        <Part icon={<TestIcon fontSize="inherit" />} title="Tested">
          <span className="ts-small ts-muted">
            {plural(a.tests.length, 'test')} in{' '}
            {[...new Set(a.tests.map(t => t.entityRef).filter(Boolean))].map(
              (ref, i) => (
                <span key={ref}>
                  {i ? ', ' : ''}
                  <EntityLink entityRef={ref!} />
                </span>
              ),
            )}
          </span>
        </Part>
      ) : null}
      {a.appliesTo.length ? (
        <Part
          icon={<RuleIcon fontSize="inherit" />}
          title="Tailscale entities about it"
        >
          <span className="ts-small">
            {a.appliesTo.map((ref, i) => (
              <span key={ref}>
                {i ? ', ' : ''}
                <EntityLink entityRef={ref} />
              </span>
            ))}
          </span>
        </Part>
      ) : null}
      {nothing && !a.tags.length && !a.owns.length ? (
        <Empty>No grant or SSH rule names it.</Empty>
      ) : null}
    </div>
  );
}

/**
 * On a Component, API, Resource, Group or User page: how it shows up on the
 * tailnet, what it reaches and who reaches it.
 */
export function EntityTailscaleCard() {
  const { entity } = useEntity();
  const api = useApi(tailscaleApiRef);
  const ref = stringifyEntityRef(entity);
  const { value, error, loading } = useAsync(
    () => api.getAccess(ref),
    [api, ref],
  );
  const consolePath = useConsolePath();

  if (loading && !value)
    return (
      <InfoCard title="Tailscale">
        <Progress />
      </InfoCard>
    );
  if (error) return <ResponseErrorPanel error={error} />;
  // Off the tailnet: no card.
  if (!value?.length) return null;
  return (
    <>
      {value.map(access => (
        <InfoCard
          key={access.policy.entityRef}
          title="Tailscale"
          subheader={access.policy.tailnet ?? access.policy.title}
          deepLink={{
            title: 'Open the policy',
            link: consolePath({ policy: access.policy.name }),
          }}
        >
          <AccessView access={access} />
        </InfoCard>
      ))}
    </>
  );
}

function RuleView(props: { policy: PolicyView; entityRef: string }) {
  const { policy, entityRef } = props;
  const name = policy.name;
  const grants = policy.grants.filter(g => g.entityRef === entityRef);
  const ssh = policy.ssh.filter(s => s.entityRef === entityRef);
  const tags = policy.tags.filter(t => t.entityRef === entityRef);
  const attrs = policy.nodeAttrs.filter(n => n.entityRef === entityRef);
  const approvers = policy.autoApprovers.filter(a => a.entityRef === entityRef);
  const tests = policy.tests.filter(t => t.entityRef === entityRef);
  const groups = policy.groups.filter(g => g.entityRef === entityRef);
  return (
    <div className="ts">
      <div className="ts-card" style={{ border: 0 }}>
        <div className="ts-rules">
          {grants.map(g => (
            <GrantRow key={g.id} grant={g} policy={name} />
          ))}
          {ssh.map(s => (
            <SshRow key={s.id} rule={s} policy={name} />
          ))}
          {attrs.map(n => (
            <NodeAttrRow key={n.id} rule={n} policy={name} />
          ))}
          {approvers.map(a => (
            <ApproverRow key={a.id} rule={a} policy={name} />
          ))}
          {tests.length ? <TestGroup tests={tests} policy={name} /> : null}
        </div>
        {tags.length ? (
          <table className="ts-table">
            <tbody>
              {tags.map(t => (
                <TagRow key={t.id} tag={t} policy={name} />
              ))}
            </tbody>
          </table>
        ) : null}
        {groups.map(g => (
          <GroupCard key={g.entityRef} group={g} policy={name} />
        ))}
      </div>
    </div>
  );
}

/**
 * On a Tailscale entity's page: the rule it is, and the lines it renders to
 * in its policy's file.
 */
export function TailscaleEntityCard() {
  const { entity } = useEntity();
  const ref = stringifyEntityRef(entity);
  const { value, error, loading } = useOverview();
  const consolePath = useConsolePath();
  if (loading && !value)
    return (
      <InfoCard title="Tailscale">
        <Progress />
      </InfoCard>
    );
  if (error) return <ResponseErrorPanel error={error} />;
  const policy = value?.policies.find(p =>
    p.parts.some(part => part.entityRef === ref),
  );
  const orphan = value?.orphans.find(o => o.entityRef === ref);
  if (!policy) {
    return (
      <InfoCard title="Tailscale">
        <div className="ts">
          <Empty>
            {orphan ? orphan.message : 'Not part of a Tailscale policy yet.'}
          </Empty>
        </div>
      </InfoCard>
    );
  }
  const part = policy.parts.find(p => p.entityRef === ref)!;
  const problems = policy.diagnostics.filter(d => d.entityRef === ref);
  const snippet = excerpt(policy.text, part.lines);
  return (
    <>
      {part.type !== 'policy' ? (
        <InfoCard
          title={`Tailscale ${
            {
              grant: 'grant',
              ssh: 'SSH rule',
              tag: 'tag',
              nodeAttr: 'node attribute',
              autoApprovers: 'auto approvers',
              test: 'tests',
              policy: 'policy',
            }[part.type]
          }`}
          subheader={
            <>
              In{' '}
              <EntityLink entityRef={policy.entityRef}>
                {policy.title ?? policy.name}
              </EntityLink>
            </>
          }
          deepLink={{
            title: 'Show in the policy file',
            link: consolePath({
              section: 'file',
              policy: policy.name,
              focus: ref,
            }),
          }}
          noPadding
        >
          {problems.length ? (
            <div className="ts">
              {problems.map((d, i) => (
                <div key={i} className={`ts-problem ts-problem-${d.severity}`}>
                  {d.severity === 'error' ? (
                    <ErrorIcon fontSize="inherit" />
                  ) : (
                    <WarningIcon fontSize="inherit" />
                  )}
                  <div>{d.message}</div>
                </div>
              ))}
            </div>
          ) : null}
          <RuleView policy={policy} entityRef={ref} />
        </InfoCard>
      ) : null}
      {snippet ? (
        <InfoCard
          title="Rendered"
          subheader={`${policy.name}.hujson, ${plural(
            part.lines.reduce((n, [a, b]) => n + b - a + 1, 0),
            'line',
          )}`}
          noPadding
        >
          <div className="ts">
            <CodeView
              text={snippet.text}
              start={snippet.start}
              label={`What ${entity.metadata.name} renders to`}
              lineHref={n =>
                consolePath({
                  section: 'file',
                  policy: policy.name,
                  lines: `${n}`,
                })
              }
            />
          </div>
        </InfoCard>
      ) : (
        <InfoCard title="Rendered">
          <div className="ts">
            <Empty icon={<FileIcon />}>
              Nothing in the file comes from it.
            </Empty>
          </div>
        </InfoCard>
      )}
    </>
  );
}
