import {
  RELATION_MEMBER_OF,
  RELATION_PROVIDES_API,
  stringifyEntityRef,
  type Entity,
} from '@backstage/catalog-model';
import type {
  CompiledOverview,
  EntityAccess,
  Identity,
  PolicyView,
  Principal,
} from '@spechtlabs/backstage-plugin-tailscale-common';
import { ANNOTATION_DST, ANNOTATION_SRC } from './graph';
import {
  ANNOTATION_TAILNET_GROUP,
  ANNOTATION_TAILNET_LOGIN,
  isTailscale,
} from '@spechtlabs/backstage-plugin-tailscale-common';

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const relationTargets = (entity: Entity, type: string) =>
  (entity.relations ?? []).filter(r => r.type === type).map(r => r.targetRef);

function identitiesOf(
  entity: Entity,
  policy: PolicyView,
  byRef: Map<string, Entity>,
): Identity[] {
  const ref = stringifyEntityRef(entity);
  const out = new Map<string, Identity>();
  const add = (
    name: string,
    source: boolean,
    destination: boolean,
    via: string,
  ) => {
    const existing = out.get(name);
    if (existing) {
      existing.source ||= source;
      existing.destination ||= destination;
    } else {
      out.set(name, { name, source, destination, via });
    }
  };
  const annotations = entity.metadata.annotations ?? {};

  if (isTailscale(entity) && entity.spec.type === 'tag') {
    add(entity.spec.tag as string, true, true, 'this tag');
  }
  for (const tag of policy.tags) {
    if (tag.appliesTo.includes(ref)) {
      add(tag.tag, true, true, `carries ${tag.tag}`);
    }
  }
  for (const tag of list(annotations[ANNOTATION_SRC])) {
    add(tag, true, false, ANNOTATION_SRC);
  }
  for (const dst of list(annotations[ANNOTATION_DST])) {
    add(dst, false, true, ANNOTATION_DST);
  }
  for (const api of relationTargets(entity, RELATION_PROVIDES_API)) {
    const annotation = byRef.get(api)?.metadata.annotations?.[ANNOTATION_DST];
    for (const dst of list(annotation))
      add(dst, false, true, `provides ${api}`);
  }
  // A device whose tag may serve a Tailscale Service is reached through it.
  for (const approval of policy.autoApprovers) {
    if (approval.kind !== 'service') continue;
    const by = approval.approvers.find(p => out.has(p.name));
    if (by) add(approval.target, false, true, `serves it as ${by.name}`);
  }
  if (entity.kind === 'Group') {
    const group = policy.groups.find(g => g.entityRef === ref);
    if (group) add(group.name, true, false, 'this group');
    else if (annotations[ANNOTATION_TAILNET_GROUP]) {
      add(annotations[ANNOTATION_TAILNET_GROUP], true, false, 'this group');
    }
  }
  if (entity.kind === 'User') {
    const login = annotations[ANNOTATION_TAILNET_LOGIN];
    if (login) add(login, true, true, 'their login');
    for (const groupRef of relationTargets(entity, RELATION_MEMBER_OF)) {
      const group = policy.groups.find(g => g.entityRef === groupRef);
      if (group) add(group.name, true, false, `member of ${group.name}`);
    }
  }
  return [...out.values()];
}

/**
 * Everything in the policies that concerns one catalog entity: its tags and
 * Services, the grants and SSH rules it is a source or destination of, and
 * the rules that name it.
 */
export function accessFor(
  entity: Entity,
  overview: CompiledOverview,
  byRef: Map<string, Entity>,
): EntityAccess[] {
  const ref = stringifyEntityRef(entity);
  const relatedRules = new Set(
    (entity.relations ?? [])
      .filter(r => r.type === 'tailscaleAppliedBy')
      .map(r => r.targetRef),
  );

  return overview.policies
    .map(policy => {
      const identities = identitiesOf(entity, policy, byRef);
      const sources = new Set(
        identities.filter(i => i.source).map(i => i.name),
      );
      const destinations = new Set(
        identities.filter(i => i.destination).map(i => i.name),
      );
      const hits = (principals: Principal[] | undefined, names: Set<string>) =>
        (principals ?? []).some(p => names.has(p.name) || p.entityRef === ref);

      return {
        policy: {
          entityRef: policy.entityRef,
          name: policy.name,
          title: policy.title,
          tailnet: policy.tailnet,
        },
        identities,
        outbound: policy.grants.filter(g => hits(g.src, sources)),
        inbound: policy.grants.filter(g => hits(g.dst, destinations)),
        sshInto: policy.ssh.filter(s => hits(s.dst, destinations)),
        sshFrom: policy.ssh.filter(s => hits(s.src, sources)),
        tags: policy.tags.filter(
          t => sources.has(t.tag) || destinations.has(t.tag),
        ),
        owns: policy.tags.filter(t => hits(t.owners, sources)),
        nodeAttrs: policy.nodeAttrs.filter(n => hits(n.nodes, sources)),
        // What it may serve; and, for what offers a Service, who serves it.
        approvals: policy.autoApprovers.filter(
          a =>
            hits(a.approvers, sources) ||
            identities.some(
              i => i.name === a.target && !i.via.startsWith('serves'),
            ),
        ),
        tests: policy.tests.filter(
          t => hits([t.src], sources) || hits(t.dst, destinations),
        ),
        appliesTo: [...relatedRules].filter(r =>
          policy.parts.some(p => p.entityRef === r),
        ),
      };
    })
    .filter(
      a =>
        a.identities.length ||
        a.appliesTo.length ||
        a.outbound.length ||
        a.inbound.length,
    );
}
