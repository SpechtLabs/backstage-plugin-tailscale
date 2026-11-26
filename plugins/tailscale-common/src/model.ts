import type { Entity } from '@backstage/catalog-model';
import type { JsonObject, JsonValue } from '@backstage/types';
import { parsePort } from './ports';

/**
 * kind: Tailscale. One entity per piece of a tailnet policy file, and one
 * for the policy itself. Every piece names the policy it belongs to in
 * spec.target; the plugin renders each policy from its pieces.
 *
 *   apiVersion: specht-labs.de/v1alpha1
 *   kind: Tailscale
 *   metadata:
 *     name: grant-metrics
 *     title: Agents push metrics
 *   spec:
 *     type: grant
 *     target: tailscale:my-tailnet
 *     owner: group:platform
 *     src: [tag:monitoring-agent]
 *     dst: [svc:metrics]
 *     ip: [tcp:443]
 *
 * spec.type     what it is, and which section of the policy it renders to:
 *   policy        the policy: hosts, settings, the catalog's grants, and
 *                 where its file is published (spec.publish)
 *   grant         one entry of "grants"
 *   ssh           one entry of "ssh"
 *   tag           one tag of "tagOwners"
 *   nodeAttr      one entry of "nodeAttrs" (its target is spec.nodes)
 *   autoApprovers part of "autoApprovers": routes, services, exitNode
 *   test          entries of "tests" and "sshTests"
 *
 * Users and groups are not Tailscale entities: a group:<name> is the
 * Backstage Group whose specht-labs.de/tailnet-group annotation names it,
 * and its members are that Group's Users (specht-labs.de/tailnet-login).
 *
 * Every other field is the Tailscale field of the same name, written as in
 * a policy file.
 */
export const TAILSCALE_API_VERSION = 'specht-labs.de/v1alpha1';
export const TAILSCALE_KIND = 'Tailscale';

export const TAILSCALE_TYPES = [
  'policy',
  'grant',
  'ssh',
  'tag',
  'nodeAttr',
  'autoApprovers',
  'test',
] as const;
export type TailscaleType = (typeof TAILSCALE_TYPES)[number];

/** A piece -> its policy, and back. */
export const RELATION_PART_OF_POLICY = 'partOfPolicy';
export const RELATION_HAS_POLICY_PART = 'hasPolicyPart';
/** A piece -> the catalog entities it is about (spec.appliesTo), and back. */
export const RELATION_APPLIES_TO = 'appliesTo';
export const RELATION_APPLIED_BY = 'tailscaleAppliedBy';

/** On a Group: the tailnet group it is (group:admins). */
export const ANNOTATION_TAILNET_GROUP = 'specht-labs.de/tailnet-group';
/** On a User: their Tailscale login (alice@github). */
export const ANNOTATION_TAILNET_LOGIN = 'specht-labs.de/tailnet-login';
/**
 * On a Tailscale tag entity: why traffic is addressed to devices carrying
 * the tag rather than to a Tailscale Service, when that isn't evident (a
 * peer mesh or a capability target is).
 */
export const ANNOTATION_DEVICE_REASON = 'specht-labs.de/tailnet-device-reason';

type Common = {
  type: TailscaleType;
  /** The policy this belongs to: a Tailscale entity of type policy. */
  target?: string;
  owner: string;
  system?: string;
  /** Catalog entities this is about: they list it on their pages. */
  appliesTo?: string[];
};

export type PolicySpec = Common & {
  type: 'policy';
  /** The tailnet's name, for display: example.ts.net. */
  tailnet?: string;
  hosts?: { [alias: string]: string };
  /**
   * Render a grant for every Component that consumes an API across the
   * tailnet (the specht-labs.de/tailnet-* annotations).
   */
  catalogGrants?: boolean;
  /** Other top-level policy keys, rendered as they are. */
  settings?: JsonObject;
  /** Where the rendered file goes, and how. */
  publish?: PublishSpec;
};

/**
 * spec.publish: the repository and path the policy file is written to.
 * flow pullRequest keeps one pull request open from pullRequestBranch into
 * branch; push commits to branch directly. branch defaults to the
 * repository's default branch. The repository must be one Backstage's
 * tailscale.allowedRepos lists.
 */
export type PublishSpec = {
  repo: string;
  path: string;
  flow?: 'pullRequest' | 'push';
  branch?: string;
  pullRequestBranch?: string;
};

export type GrantSpec = Common & {
  type: 'grant';
  src: string[];
  dst: string[];
  ip?: string[];
  app?: { [capability: string]: JsonObject[] };
  via?: string[];
  srcPosture?: string[];
};

export type SshSpec = Common & {
  type: 'ssh';
  action: 'accept' | 'check';
  src: string[];
  dst: string[];
  users: string[];
  checkPeriod?: string;
  acceptEnv?: string[];
  recorder?: string[];
  enforceRecorder?: boolean;
};

export type TagSpec = Common & {
  type: 'tag';
  tag: string;
  owners: string[];
};

export type NodeAttrSpec = Common & {
  type: 'nodeAttr';
  /** The nodeAttr's "target" (spec.target is the policy). */
  nodes: string[];
  attr?: string[];
  app?: JsonObject;
  ipPool?: string[];
};

export type AutoApproversSpec = Common & {
  type: 'autoApprovers';
  routes?: { [cidr: string]: string[] };
  services?: { [service: string]: string[] };
  exitNode?: string[];
};

export type AclTest = {
  src: string;
  proto?: string;
  srcPostureAttrs?: JsonObject;
  accept?: string[];
  deny?: string[];
};
export type SshTest = {
  src: string;
  dst: string[];
  accept?: string[];
  check?: string[];
  deny?: string[];
};

export type TestSpec = Common & {
  type: 'test';
  /** One test or a list of them. */
  tests?: AclTest | AclTest[];
  sshTests?: SshTest | SshTest[];
};

export type TailscaleSpec =
  | PolicySpec
  | GrantSpec
  | SshSpec
  | TagSpec
  | NodeAttrSpec
  | AutoApproversSpec
  | TestSpec;

export type TailscaleEntity<S extends TailscaleSpec = TailscaleSpec> =
  Entity & { spec: S & JsonObject };

export function isTailscale(entity: Entity): entity is TailscaleEntity {
  return (
    entity.apiVersion === TAILSCALE_API_VERSION &&
    entity.kind === TAILSCALE_KIND
  );
}

export function isTailscaleOfType<T extends TailscaleType>(
  entity: Entity,
  type: T,
): entity is TailscaleEntity<Extract<TailscaleSpec, { type: T }>> {
  return isTailscale(entity) && entity.spec.type === type;
}

/** tests / sshTests: one or many. */
export function asList<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// --- validation -------------------------------------------------------------
// Shapes only: what refers to what (tags, groups, hosts, the policy) is
// checked when a policy is put together, where the whole catalog is known.

const TAG = /^tag:[A-Za-z0-9][A-Za-z0-9-]*$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const CAPABILITY = /^[a-z0-9.-]+\/cap\/[a-z0-9-]+$/;

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(v => typeof v === 'string' && v !== '');

const isObject = (value: unknown): value is JsonObject =>
  !!value && typeof value === 'object' && !Array.isArray(value);

class Checker {
  readonly errors: string[] = [];

  constructor(readonly spec: Record<string, JsonValue | undefined>) {}

  list(field: string, { required = false }: { required?: boolean } = {}) {
    const nonEmpty = required;
    const value = this.spec[field];
    if (value === undefined) {
      if (required) this.errors.push(`spec.${field} is required`);
      return [] as string[];
    }
    if (!isStringList(value)) {
      this.errors.push(`spec.${field} must be a list of strings`);
      return [];
    }
    if (nonEmpty && !value.length) {
      this.errors.push(`spec.${field} needs at least one entry`);
    }
    return value;
  }

  string(field: string, required = false) {
    const value = this.spec[field];
    if (value === undefined) {
      if (required) this.errors.push(`spec.${field} is required`);
      return undefined;
    }
    if (typeof value !== 'string' || !value) {
      this.errors.push(`spec.${field} must be a string`);
      return undefined;
    }
    return value;
  }

  object(field: string) {
    const value = this.spec[field];
    if (value === undefined) return undefined;
    if (!isObject(value)) {
      this.errors.push(`spec.${field} must be an object`);
      return undefined;
    }
    return value;
  }

  /** { key: [string, ...] } */
  listMap(field: string) {
    const value = this.object(field);
    for (const [key, entry] of Object.entries(value ?? {})) {
      if (!isStringList(entry) || !entry.length) {
        this.errors.push(`spec.${field}.${key} must be a non-empty list`);
      }
    }
    return value;
  }

  ports(field: string) {
    const bad = this.list(field).filter(p => !parsePort(p));
    if (bad.length) {
      this.errors.push(`spec.${field}: not ports: ${bad.join(', ')}`);
    }
  }

  app(field: string, { listValues }: { listValues: boolean }) {
    const app = this.object(field);
    for (const [name, values] of Object.entries(app ?? {})) {
      if (!CAPABILITY.test(name)) {
        this.errors.push(
          `spec.${field}: ${name} is not a capability (<domain>/cap/<name>)`,
        );
      }
      if (
        listValues &&
        (!Array.isArray(values) || !values.length || !values.every(isObject))
      ) {
        this.errors.push(`spec.${field}.${name} must be a list of objects`);
      }
    }
  }
}

const VALIDATORS: { [T in TailscaleType]: (c: Checker) => void } = {
  policy: c => {
    c.string('tailnet');
    const hosts = c.object('hosts');
    for (const [alias, address] of Object.entries(hosts ?? {})) {
      if (typeof address !== 'string') {
        c.errors.push(`spec.hosts.${alias} must be an address`);
      }
    }
    c.object('settings');
    const publish = c.object('publish');
    if (publish) {
      const text = (key: string) =>
        publish[key] === undefined || typeof publish[key] === 'string';
      if (typeof publish.repo !== 'string' || !REPO.test(publish.repo)) {
        c.errors.push('spec.publish.repo must be owner/name');
      }
      if (typeof publish.path !== 'string' || !publish.path) {
        c.errors.push('spec.publish.path is required');
      }
      if (!['pullRequest', 'push', undefined].includes(publish.flow as any)) {
        c.errors.push(
          `spec.publish.flow must be pullRequest or push, not ${String(
            publish.flow,
          )}`,
        );
      }
      if (!text('branch') || !text('pullRequestBranch')) {
        c.errors.push('spec.publish branches must be strings');
      }
    }
  },
  grant: c => {
    c.list('src', { required: true });
    c.list('dst', { required: true });
    c.ports('ip');
    c.app('app', { listValues: true });
    c.list('via');
    c.list('srcPosture');
  },
  ssh: c => {
    const action = c.string('action', true);
    if (action && action !== 'accept' && action !== 'check') {
      c.errors.push(`spec.action must be accept or check, not ${action}`);
    }
    c.list('src', { required: true });
    c.list('dst', { required: true });
    c.list('users', { required: true });
    c.string('checkPeriod');
    c.list('acceptEnv');
    c.list('recorder');
  },
  tag: c => {
    const tag = c.string('tag', true);
    if (tag && !TAG.test(tag)) {
      c.errors.push(`spec.tag must be tag:<name>, not ${tag}`);
    }
    c.list('owners', { required: true });
  },
  nodeAttr: c => {
    c.list('nodes', { required: true });
    const attr = c.list('attr');
    const app = c.object('app');
    c.list('ipPool');
    if (!attr.length && !app) {
      c.errors.push('spec.attr or spec.app is required');
    }
    c.app('app', { listValues: true });
  },
  autoApprovers: c => {
    const routes = c.listMap('routes');
    const services = c.listMap('services');
    const exitNode = c.list('exitNode');
    for (const service of Object.keys(services ?? {})) {
      if (!/^svc:[a-z0-9-]+$/.test(service)) {
        c.errors.push(`spec.services: ${service} is not svc:<name>`);
      }
    }
    if (!routes && !services && !exitNode.length) {
      c.errors.push('spec.routes, spec.services or spec.exitNode is required');
    }
  },
  test: c => {
    const errors = c.errors;
    const check = (
      field: string,
      fn: (test: JsonObject, at: string) => void,
    ) => {
      const value = c.spec[field];
      if (value === undefined) return 0;
      const list = Array.isArray(value) ? value : [value];
      list.forEach((test, i) => {
        const at = Array.isArray(value)
          ? `spec.${field}[${i}]`
          : `spec.${field}`;
        if (!isObject(test)) errors.push(`${at} must be an object`);
        else fn(test, at);
      });
      return list.length;
    };
    const strings = (test: JsonObject, at: string, keys: string[]) => {
      for (const key of keys) {
        if (test[key] !== undefined && !isStringList(test[key])) {
          errors.push(`${at}.${key} must be a list of strings`);
        }
      }
    };
    const acl = check('tests', (test, at) => {
      if (typeof test.src !== 'string') errors.push(`${at}.src is required`);
      strings(test, at, ['accept', 'deny']);
      if (!test.accept && !test.deny) {
        errors.push(`${at} needs accept or deny`);
      }
    });
    const ssh = check('sshTests', (test, at) => {
      if (typeof test.src !== 'string') errors.push(`${at}.src is required`);
      if (!isStringList(test.dst)) errors.push(`${at}.dst is required`);
      strings(test, at, ['accept', 'check', 'deny']);
    });
    if (!acl && !ssh) errors.push('spec.tests or spec.sshTests is required');
  },
};

/** What is wrong with a Tailscale entity's spec, as messages. */
export function validateTailscaleSpec(spec: unknown): string[] {
  if (!isObject(spec)) return ['spec is required'];
  const type = spec.type as TailscaleType;
  if (!TAILSCALE_TYPES.includes(type)) {
    return [
      `spec.type must be one of ${TAILSCALE_TYPES.join(', ')}, not ${String(
        spec.type,
      )}`,
    ];
  }
  const checker = new Checker(spec);
  if (type !== 'policy') checker.string('target', true);
  checker.string('owner', true);
  checker.string('system');
  checker.list('appliesTo');
  VALIDATORS[type](checker);
  return checker.errors;
}
