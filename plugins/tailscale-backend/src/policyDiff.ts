import {
  parseEntityRef,
  stringifyEntityRef,
  type Entity,
} from '@backstage/catalog-model';
import { ANNOTATION_DST, ANNOTATION_PORTS } from './graph';
import {
  isTailscale,
  tailscaleRelations,
} from '@spechtlabs/backstage-plugin-tailscale-common';

/**
 * Comparing a rendered policy with another policy file (the one that gets
 * applied), section by section, by what each section allows rather than by
 * its text: grants are expanded to single (src, dst, ip, app) atoms, so the
 * same access split or merged differently compares equal.
 */

type Json = any;

export interface SectionDiff {
  section: string;
  /** In the other file (the applied one) only. */
  onlyApplied: string[];
  /** In the rendered one only. */
  onlyRendered: string[];
}

/**
 * Adds the relations the catalog would: consumesApi, providesApi with
 * apiProvidedBy on the API, dependsOn, memberOf with hasMember on the Group,
 * and what the Tailscale processor emits. For entities read from files.
 */
export function relate(entities: Entity[]): void {
  const byRef = new Map(entities.map(e => [stringifyEntityRef(e), e]));
  const ref = (value: string, kind: string) =>
    stringifyEntityRef(
      parseEntityRef(value, { defaultKind: kind, defaultNamespace: 'default' }),
    );
  const add = (from: string, type: string, to: string) => {
    const entity = byRef.get(from);
    if (entity) (entity.relations ??= []).push({ type, targetRef: to });
  };
  for (const entity of entities) {
    const self = stringifyEntityRef(entity);
    const spec = (entity.spec ?? {}) as Record<string, any>;
    for (const api of spec.consumesApis ?? []) {
      add(self, 'consumesApi', ref(api, 'API'));
      add(ref(api, 'API'), 'apiConsumedBy', self);
    }
    for (const api of spec.providesApis ?? []) {
      add(self, 'providesApi', ref(api, 'API'));
      add(ref(api, 'API'), 'apiProvidedBy', self);
    }
    for (const dep of spec.dependsOn ?? []) {
      add(self, 'dependsOn', ref(dep, 'Component'));
    }
    if (entity.kind === 'User') {
      for (const group of spec.memberOf ?? []) {
        add(self, 'memberOf', ref(group, 'Group'));
        add(ref(group, 'Group'), 'hasMember', self);
      }
    }
    if (isTailscale(entity)) {
      for (const r of tailscaleRelations(entity)) {
        add(stringifyEntityRef(r.source), r.type, stringifyEntityRef(r.target));
      }
    }
  }
}

/**
 * Every Tailscale Service's ports, as the catalog's APIs list them: a grant
 * to a Service on "*" reaches these, since a Service offers only the ports
 * it serves (not on every host: see the policy README's NAS caveat).
 */
export function servicePorts(entities: Entity[]): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  for (const api of entities.filter(e => e.kind === 'API')) {
    const annotations = api.metadata.annotations ?? {};
    const split = (v?: string) =>
      (v ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    const ports = split(annotations[ANNOTATION_PORTS]);
    for (const dst of split(annotations[ANNOTATION_DST])) {
      if (!dst.startsWith('svc:')) continue;
      const set = out.get(dst) ?? new Set<string>();
      ports.forEach(p => set.add(p));
      out.set(dst, set);
    }
  }
  return new Map([...out].map(([svc, set]) => [svc, [...set].sort()]));
}

const canonical = (value: Json): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

function grantAtoms(policy: Json, ports: Map<string, string[]>): Set<string> {
  const atoms = new Set<string>();
  for (const grant of policy.grants ?? []) {
    const app = grant.app ? ` app ${canonical(grant.app)}` : '';
    const extra = [
      grant.via ? ` via ${canonical(grant.via)}` : '',
      grant.srcPosture ? ` posture ${canonical(grant.srcPosture)}` : '',
    ].join('');
    for (const src of grant.src ?? []) {
      for (const dst of grant.dst ?? []) {
        const ips: string[] = grant.ip ?? ['(none)'];
        for (const ip of ips) {
          // "*" to a Service: the ports the Service has.
          const expanded =
            ip === '*' && ports.get(dst)?.length ? ports.get(dst)! : [ip];
          for (const port of expanded) {
            atoms.add(`${src} -> ${dst} ${port}${app}${extra}`);
          }
        }
      }
    }
  }
  return atoms;
}

const entries = (object: Json, label = (k: string, v: string) => `${k} ${v}`) =>
  new Set(
    Object.entries(object ?? {}).flatMap(([key, values]) =>
      (Array.isArray(values) ? values : [values]).map(v =>
        label(key, typeof v === 'string' ? v : canonical(v)),
      ),
    ),
  );

function testAtoms(tests: Json[] | undefined, ssh: boolean): Set<string> {
  const out = new Set<string>();
  for (const t of tests ?? []) {
    const head = ssh
      ? `${t.src} -> ${canonical(t.dst)}`
      : `${t.src}${t.proto ? ` ${t.proto}` : ''}`;
    for (const kind of ['accept', 'deny', 'check']) {
      for (const target of t[kind] ?? []) out.add(`${head} ${kind} ${target}`);
    }
  }
  return out;
}

const items = (list: Json[] | undefined) =>
  new Set((list ?? []).map(canonical));

function settings(policy: Json): Set<string> {
  const known = new Set([
    'groups',
    'hosts',
    'tagOwners',
    'nodeAttrs',
    'autoApprovers',
    'ssh',
    'grants',
    'acls',
    'tests',
    'sshTests',
  ]);
  return new Set(
    Object.keys(policy ?? {})
      .filter(k => !known.has(k))
      .map(k => `${k}: ${canonical(policy[k])}`),
  );
}

/** What each section of two policy files allows, and where they differ. */
export function diffPolicies(
  applied: Json,
  rendered: Json,
  ports: Map<string, string[]> = new Map(),
): SectionDiff[] {
  const sections: Array<[string, (p: Json) => Set<string>]> = [
    ['grants', p => grantAtoms(p, ports)],
    ['groups', p => entries(p.groups, (k, v) => `${k} has ${v}`)],
    ['hosts', p => entries(p.hosts, (k, v) => `${k} = ${v}`)],
    ['tagOwners', p => entries(p.tagOwners, (k, v) => `${k} owned by ${v}`)],
    ['nodeAttrs', p => items(p.nodeAttrs)],
    [
      'autoApprovers',
      p =>
        new Set([
          ...entries(
            p.autoApprovers?.services,
            (k, v) => `${k} served by ${v}`,
          ),
          ...entries(p.autoApprovers?.routes, (k, v) => `${k} routed by ${v}`),
          ...(p.autoApprovers?.exitNode ?? []).map(
            (v: string) => `exit node ${v}`,
          ),
        ]),
    ],
    ['ssh', p => items(p.ssh)],
    ['tests', p => testAtoms(p.tests, false)],
    ['sshTests', p => testAtoms(p.sshTests, true)],
    ['settings', settings],
  ];
  return sections.map(([section, atoms]) => {
    const a = atoms(applied ?? {});
    const r = atoms(rendered ?? {});
    return {
      section,
      onlyApplied: [...a].filter(x => !r.has(x)).sort(),
      onlyRendered: [...r].filter(x => !a.has(x)).sort(),
    };
  });
}
