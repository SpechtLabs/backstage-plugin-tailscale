import type { JsonObject } from '@backstage/types';
import type { PublishSpec, TailscaleType } from './model';

/*
 * What the tailscale backend serves (GET /api/tailscale/overview and
 * /access) and the frontend shows.
 */

export interface LocalEdge {
  consumer: string;
  api: string;
  providers: string[];
  cluster: string;
}

export interface Finding {
  entity: string;
  message: string;
}

export type PrincipalKind =
  | 'any'
  | 'group'
  | 'user'
  | 'tag'
  | 'service'
  | 'autogroup'
  | 'host'
  | 'address'
  | 'ipset';

/** A source, destination, owner or approver. */
export interface Principal {
  /** As the entity writes it. */
  value: string;
  /** As the policy file has it. */
  name: string;
  kind: PrincipalKind;
  /** The catalog entity behind it: a Group, a User, a tag's entity. */
  entityRef?: string;
  title?: string;
}

/** Lines in the rendered file, 1-based and inclusive. */
export type Lines = [number, number];

export interface Rule {
  id: string;
  /** The Tailscale entity it comes from; none for catalog grants. */
  entityRef?: string;
  title?: string;
  description?: string;
  lines?: Lines;
}

export interface CatalogEdge {
  /** The consuming Component; for tailnet-allow, the API. */
  consumer: string;
  api: string;
  providers: string[];
  via: 'consumesApi' | 'tailnet-allow';
  src: string[];
  dst: string[];
  ports: string[];
}

export interface GrantRule extends Rule {
  origin: 'entity' | 'catalog';
  src: Principal[];
  dst: Principal[];
  ip: string[];
  app?: Record<string, JsonObject[]>;
  via?: Principal[];
  srcPosture?: string[];
  /** For catalog grants: the API consumptions it is made of. */
  edges?: CatalogEdge[];
}

export interface SshRule extends Rule {
  action: 'accept' | 'check';
  src: Principal[];
  dst: Principal[];
  users: string[];
  checkPeriod?: string;
  acceptEnv?: string[];
  recorder?: Principal[];
  enforceRecorder?: boolean;
}

export interface TagRule extends Rule {
  tag: string;
  owners: Principal[];
  appliesTo: string[];
  /** How many rules name it. */
  usage: number;
}

export interface NodeAttrRule extends Rule {
  nodes: Principal[];
  attr: string[];
  app?: JsonObject;
  ipPool?: string[];
}

export interface ApproverRule extends Rule {
  kind: 'service' | 'route' | 'exitNode';
  /** svc:<name>, a CIDR, or "exit node". */
  target: string;
  approvers: Principal[];
}

export interface Member {
  login?: string;
  entityRef: string;
  title?: string;
}

export interface GroupView {
  name: string;
  entityRef: string;
  title?: string;
  description?: string;
  members: Member[];
  usage: number;
  lines?: Lines;
}

export interface HostView {
  name: string;
  address: string;
  lines?: Lines;
}

export interface TestRule extends Rule {
  kind: 'acl' | 'ssh';
  src: Principal;
  proto?: string;
  /** sshTests: the machines it connects to. */
  dst?: Principal[];
  accept: string[];
  deny: string[];
  /** sshTests: users that need check mode. */
  check: string[];
}

/**
 * What a grant destination is. A Service is what a destination should be;
 * the rest are devices, for a reason: a peer mesh (a tag that reaches
 * itself: every member is reached at its own address), a capability target
 * (an app reading capabilities matched on its own address), autogroups,
 * everything (a break-glass grant), or a reason declared on the tag entity.
 */
export type DestinationClass =
  | 'service'
  | 'mesh'
  | 'capability'
  | 'autogroup'
  | 'any'
  | 'device';

export interface DestinationView {
  name: string;
  class: DestinationClass;
  /** Declared on the tag entity (specht-labs.de/tailnet-device-reason). */
  reason?: string;
  /** The tag's entity, for tags. */
  entityRef?: string;
  /** The grants that reach it. */
  grants: string[];
  /** The Services a tag may serve (auto approvers). */
  serves: string[];
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  entityRef?: string;
}

export interface PartSummary {
  entityRef: string;
  type: TailscaleType;
  name: string;
  title?: string;
  description?: string;
  lines: Lines[];
}

export interface Span {
  entityRef: string;
  section: string;
  lines: Lines;
}

export interface CoveredEdge extends CatalogEdge {
  coveredBy: string[];
}

export interface PolicyView {
  entityRef: string;
  name: string;
  title?: string;
  description?: string;
  tailnet?: string;
  owner?: string;
  /** Where its file is published: the policy's spec.publish. */
  publish?: PublishSpec;
  renderedAt: string;
  /** The policy file. */
  text: string;
  spans: Span[];
  parts: PartSummary[];
  groups: GroupView[];
  hosts: HostView[];
  tags: TagRule[];
  grants: GrantRule[];
  ssh: SshRule[];
  nodeAttrs: NodeAttrRule[];
  autoApprovers: ApproverRule[];
  tests: TestRule[];
  settings: string[];
  catalog: {
    enabled: boolean;
    /** Consumptions another grant already allows: no grant of their own. */
    covered: CoveredEdge[];
    /** Consumer and provider share a cluster: not on the tailnet. */
    local: LocalEdge[];
    missingSource: Finding[];
    invalid: Finding[];
  };
  destinations: DestinationView[];
  diagnostics: Diagnostic[];
}

export interface CompiledOverview {
  renderedAt: string;
  policies: PolicyView[];
  /** Tailscale entities whose policy isn't in the catalog. */
  orphans: Diagnostic[];
}

/** How an entity shows up on the tailnet, and why. */
export interface Identity {
  name: string;
  /** Traffic it sends carries it (a tag, a group, a login)... */
  source: boolean;
  /** ...or traffic to it is addressed to it (a tag, a Service). */
  destination: boolean;
  /** Where that comes from: an annotation, a tag entity, an API. */
  via: string;
}

/** One policy, as far as one entity is concerned. */
export interface EntityAccess {
  policy: { entityRef: string; name: string; title?: string; tailnet?: string };
  identities: Identity[];
  /** Grants it is a source of: what it can reach. */
  outbound: GrantRule[];
  /** Grants it is a destination of: who can reach it. */
  inbound: GrantRule[];
  /** SSH rules into it, and from it. */
  sshInto: SshRule[];
  sshFrom: SshRule[];
  /** Tags it carries. */
  tags: TagRule[];
  /** Tags it may give devices. */
  owns: TagRule[];
  nodeAttrs: NodeAttrRule[];
  /** What it may advertise without approval. */
  approvals: ApproverRule[];
  tests: TestRule[];
  /** Rules that name it in spec.appliesTo, of any type. */
  appliesTo: string[];
}

/** Where a policy's file is published, and how the last run went. */
export interface PublishStatus {
  repo: string;
  path: string;
  flow: 'pullRequest' | 'push';
  /** The branch the file lands on; the repository's default if unset. */
  branch?: string;
  /** pullRequest: the branch Backstage owns and force-pushes. */
  pullRequestBranch: string;
  /** Why it isn't published, if it isn't. */
  problem?: string;
  last?: { at: string; outcome: string; url?: string; error?: string };
}

/** GET /api/tailscale/overview */
export type Overview = CompiledOverview & {
  /** By policy entity ref. */
  publish: Record<string, PublishStatus>;
};
