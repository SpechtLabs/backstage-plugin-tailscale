import {
  RELATION_HAS_MEMBER,
  parseEntityRef,
  stringifyEntityRef,
  type Entity,
} from '@backstage/catalog-model';
import type { JsonObject, JsonValue } from '@backstage/types';
import { buildTailnetGraph } from './graph';
import { HujsonWriter } from './hujson';
import type {
  Principal,
  Lines,
  CatalogEdge,
  GrantRule,
  SshRule,
  TagRule,
  NodeAttrRule,
  ApproverRule,
  GroupView,
  HostView,
  TestRule,
  DestinationClass,
  DestinationView,
  Diagnostic,
  Span,
  PolicyView,
  CompiledOverview,
} from '@spechtlabs/backstage-plugin-tailscale-common';
import {
  ANNOTATION_DEVICE_REASON,
  ANNOTATION_TAILNET_GROUP,
  ANNOTATION_TAILNET_LOGIN,
  asList,
  isTailscale,
  validateTailscaleSpec,
  type AutoApproversSpec,
  type GrantSpec,
  type NodeAttrSpec,
  type PolicySpec,
  type SshSpec,
  type TagSpec,
  type TailscaleEntity,
  type TailscaleSpec,
  type TestSpec,
} from '@spechtlabs/backstage-plugin-tailscale-common';
import {
  formatPort,
  parsePort,
  portCovers,
  type PortRange,
} from '@spechtlabs/backstage-plugin-tailscale-common';

// --- the catalog's people ----------------------------------------------------

interface GroupInfo {
  ref: string;
  name: string;
  title?: string;
  description?: string;
  memberRefs: string[];
  annotated: boolean;
}

interface UserInfo {
  ref: string;
  login?: string;
  title?: string;
}

const titleOf = (e: Entity) =>
  ((e.spec?.profile as JsonObject | undefined)?.displayName as
    | string
    | undefined) ??
  e.metadata.title ??
  e.metadata.name;

class Directory {
  readonly groups = new Map<string, GroupInfo>(); // by tailnet name
  readonly groupsByRef = new Map<string, GroupInfo>();
  readonly users = new Map<string, UserInfo>(); // by ref
  readonly usersByLogin = new Map<string, UserInfo>();

  constructor(entities: Entity[]) {
    for (const e of entities) {
      const ref = stringifyEntityRef(e);
      if (e.kind === 'User') {
        const login = e.metadata.annotations?.[ANNOTATION_TAILNET_LOGIN];
        const user = { ref, login, title: titleOf(e) };
        this.users.set(ref, user);
        if (login) this.usersByLogin.set(login, user);
      }
    }
    for (const e of entities) {
      if (e.kind !== 'Group') continue;
      const ref = stringifyEntityRef(e);
      const annotation = e.metadata.annotations?.[ANNOTATION_TAILNET_GROUP];
      const group: GroupInfo = {
        ref,
        name: annotation ?? `group:${e.metadata.name}`,
        title: titleOf(e),
        description: e.metadata.description,
        memberRefs: (e.relations ?? [])
          .filter(r => r.type === RELATION_HAS_MEMBER)
          .map(r => r.targetRef)
          .sort(),
        annotated: !!annotation,
      };
      this.groupsByRef.set(ref, group);
      // An annotation wins over a Group that merely has the same name.
      if (annotation || !this.groups.has(group.name)) {
        if (!this.groups.get(group.name)?.annotated) {
          this.groups.set(group.name, group);
        }
      }
    }
  }
}

// --- one policy --------------------------------------------------------------

const ADDRESS =
  /^(\d{1,3}(\.\d{1,3}){3}(\/\d+)?|[0-9a-f]*:[0-9a-f:]*(\/\d+)?)$/i;

const byName = (a: Entity, b: Entity) =>
  a.metadata.name.localeCompare(b.metadata.name);

const refOf = (e: Entity) => stringifyEntityRef(e);

function stringsIn(value: JsonValue | undefined, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(v => stringsIn(v, out));
  else if (value && typeof value === 'object') {
    Object.values(value).forEach(v => stringsIn(v, out));
  }
  return out;
}

const unique = (refs: string[]) =>
  [...new Set(refs.map(r => parseEntityRef(r).name))].sort();

/** component:default/backstage -> component:backstage */
export function shortRef(ref: string): string {
  const { kind, namespace, name } = parseEntityRef(ref);
  return namespace === 'default' ? `${kind}:${name}` : ref;
}

class PolicyCompiler {
  readonly diagnostics: Diagnostic[] = [];
  private readonly usedGroups = new Map<string, number>();
  private readonly tagUsage = new Map<string, number>();
  private readonly tagEntities = new Map<string, TailscaleEntity<TagSpec>>();
  private readonly hosts: Record<string, string>;
  private readonly ipsets: Set<string>;

  constructor(
    private readonly dir: Directory,
    private readonly policy: TailscaleEntity<PolicySpec>,
    private readonly parts: TailscaleEntity[],
  ) {
    this.hosts = policy.spec.hosts ?? {};
    this.ipsets = new Set(
      Object.keys((policy.spec.settings?.ipsets as JsonObject) ?? {}),
    );
    for (const tag of this.of<TagSpec>('tag')) {
      const existing = this.tagEntities.get(tag.spec.tag);
      if (existing) {
        this.error(
          `${tag.spec.tag} is already declared by ${refOf(existing)}`,
          tag,
        );
      } else {
        this.tagEntities.set(tag.spec.tag, tag);
      }
    }
  }

  of<S extends TailscaleSpec>(type: S['type']): TailscaleEntity<S>[] {
    return this.parts
      .filter(p => p.spec.type === type)
      .sort(byName) as TailscaleEntity<S>[];
  }

  error(message: string, entity?: Entity | string) {
    this.diagnostics.push({
      severity: 'error',
      message,
      entityRef: typeof entity === 'string' ? entity : entity && refOf(entity),
    });
  }

  warn(message: string, entity?: Entity | string) {
    this.diagnostics.push({
      severity: 'warning',
      message,
      entityRef: typeof entity === 'string' ? entity : entity && refOf(entity),
    });
  }

  private useGroup(name: string) {
    this.usedGroups.set(name, (this.usedGroups.get(name) ?? 0) + 1);
  }

  /** What a source, destination, owner or approver stands for. */
  resolve(value: string, where: Entity | string, field: string): Principal {
    const fail = (message: string): Principal => {
      this.error(`${field}: ${message}`, where);
      return { value, name: value, kind: 'host' };
    };
    if (value === '*') return { value, name: '*', kind: 'any' };

    if (value.startsWith('group:')) {
      const group = value.includes('/')
        ? this.dir.groupsByRef.get(
            stringifyEntityRef(
              parseEntityRef(value, { defaultNamespace: 'default' }),
            ),
          )
        : this.dir.groups.get(value) ??
          this.dir.groupsByRef.get(`group:default/${value.slice(6)}`);
      if (!group) {
        return fail(
          `${value} is no group: no Backstage Group has ${ANNOTATION_TAILNET_GROUP}: ${value}`,
        );
      }
      this.useGroup(group.name);
      return {
        value,
        name: group.name,
        kind: 'group',
        entityRef: group.ref,
        title: group.title,
      };
    }

    if (value.startsWith('user:')) {
      const ref = stringifyEntityRef(
        parseEntityRef(value, { defaultNamespace: 'default' }),
      );
      const user = this.dir.users.get(ref);
      if (!user) return fail(`${value} is not a User in the catalog`);
      if (!user.login) {
        return fail(`${value} has no ${ANNOTATION_TAILNET_LOGIN} annotation`);
      }
      return {
        value,
        name: user.login,
        kind: 'user',
        entityRef: user.ref,
        title: user.title,
      };
    }

    if (value.startsWith('tag:')) {
      const tag = this.tagEntities.get(value);
      this.tagUsage.set(value, (this.tagUsage.get(value) ?? 0) + 1);
      if (!tag) {
        this.error(
          `${field}: ${value} is not declared: no Tailscale tag entity in this policy has tag: ${value}`,
          where,
        );
      }
      return {
        value,
        name: value,
        kind: 'tag',
        entityRef: tag && refOf(tag),
        title: tag?.metadata.title,
      };
    }

    if (value.startsWith('svc:'))
      return { value, name: value, kind: 'service' };
    if (value.startsWith('autogroup:')) {
      return { value, name: value, kind: 'autogroup' };
    }
    if (value.startsWith('ipset:')) {
      if (!this.ipsets.has(value)) {
        return fail(`${value} is not in the policy's settings.ipsets`);
      }
      return { value, name: value, kind: 'ipset' };
    }
    if (value.includes('@')) {
      const user = this.dir.usersByLogin.get(value);
      return {
        value,
        name: value,
        kind: 'user',
        entityRef: user?.ref,
        title: user?.title,
      };
    }
    if (ADDRESS.test(value)) return { value, name: value, kind: 'address' };
    if (value in this.hosts) {
      return { value, name: value, kind: 'host', title: this.hosts[value] };
    }
    return fail(`${value} is neither a host of this policy nor a selector`);
  }

  resolveAll(values: string[] | undefined, where: Entity, field: string) {
    return (values ?? []).map(v => this.resolve(v, where, field));
  }

  /** Groups named inside capability values (tsidp's users) count as used. */
  private scanApp(app: JsonValue | undefined) {
    for (const s of stringsIn(app)) {
      if (s.startsWith('group:') && this.dir.groups.has(s)) this.useGroup(s);
    }
  }

  private meta(e: Entity) {
    return {
      entityRef: refOf(e),
      title: e.metadata.title,
      description: e.metadata.description,
    };
  }

  compile(catalogEntities: Entity[], baseUrl?: string): PolicyView {
    const tags: TagRule[] = this.of<TagSpec>('tag')
      .filter(t => this.tagEntities.get(t.spec.tag) === t)
      .map(t => ({
        id: refOf(t),
        ...this.meta(t),
        tag: t.spec.tag,
        owners: this.resolveAll(t.spec.owners, t, 'owners'),
        appliesTo: (t.spec.appliesTo ?? []).map(r =>
          stringifyEntityRef(
            parseEntityRef(r, {
              defaultKind: 'component',
              defaultNamespace: t.metadata.namespace ?? 'default',
            }),
          ),
        ),
        usage: 0,
      }));

    const grants: GrantRule[] = this.of<GrantSpec>('grant').map(g => {
      const src = this.resolveAll(g.spec.src, g, 'src');
      for (const s of src) {
        if (s.kind === 'service') {
          this.error(
            `src: ${s.value} is a Service; Services are destinations`,
            g,
          );
        }
      }
      if (!g.spec.ip?.length && !g.spec.app) {
        this.error('a grant needs ip, app or both', g);
      }
      this.scanApp(g.spec.app as JsonValue);
      return {
        id: refOf(g),
        ...this.meta(g),
        origin: 'entity' as const,
        src,
        dst: this.resolveAll(g.spec.dst, g, 'dst'),
        ip: g.spec.ip ?? [],
        app: g.spec.app,
        via: g.spec.via && this.resolveAll(g.spec.via, g, 'via'),
        srcPosture: g.spec.srcPosture,
      };
    });

    const ssh: SshRule[] = this.of<SshSpec>('ssh').map(s => ({
      id: refOf(s),
      ...this.meta(s),
      action: s.spec.action,
      src: this.resolveAll(s.spec.src, s, 'src'),
      dst: this.resolveAll(s.spec.dst, s, 'dst'),
      users: s.spec.users,
      checkPeriod: s.spec.checkPeriod,
      acceptEnv: s.spec.acceptEnv,
      recorder:
        s.spec.recorder && this.resolveAll(s.spec.recorder, s, 'recorder'),
      enforceRecorder: s.spec.enforceRecorder,
    }));

    const nodeAttrs: NodeAttrRule[] = this.of<NodeAttrSpec>('nodeAttr').map(
      n => {
        this.scanApp(n.spec.app);
        return {
          id: refOf(n),
          ...this.meta(n),
          nodes: this.resolveAll(n.spec.nodes, n, 'nodes'),
          attr: n.spec.attr ?? [],
          app: n.spec.app,
          ipPool: n.spec.ipPool,
        };
      },
    );

    const autoApprovers: ApproverRule[] = this.of<AutoApproversSpec>(
      'autoApprovers',
    ).flatMap(a => {
      const rules: ApproverRule[] = [];
      const add = (
        kind: ApproverRule['kind'],
        target: string,
        list: string[],
      ) =>
        rules.push({
          id: `${refOf(a)}#${kind}/${target}`,
          ...this.meta(a),
          kind,
          target,
          approvers: this.resolveAll(list, a, `${kind} ${target}`),
        });
      for (const [svc, list] of Object.entries(a.spec.services ?? {})) {
        add('service', svc, list);
      }
      for (const [cidr, list] of Object.entries(a.spec.routes ?? {})) {
        add('route', cidr, list);
      }
      if (a.spec.exitNode?.length)
        add('exitNode', 'exit node', a.spec.exitNode);
      return rules;
    });

    const tests: TestRule[] = this.of<TestSpec>('test').flatMap(t => {
      const destination = (entry: string, field: string) => {
        const at = entry.lastIndexOf(':');
        if (at <= 0) return entry;
        const target = this.resolve(entry.slice(0, at), t, field);
        return `${target.name}${entry.slice(at)}`;
      };
      const acl = asList(t.spec.tests).map(
        (test, i): TestRule => ({
          id: `${refOf(t)}#tests/${i}`,
          ...this.meta(t),
          kind: 'acl',
          src: this.resolve(test.src, t, 'tests src'),
          proto: test.proto,
          accept: (test.accept ?? []).map(d => destination(d, 'tests accept')),
          deny: (test.deny ?? []).map(d => destination(d, 'tests deny')),
          check: [],
        }),
      );
      const sshTests = asList(t.spec.sshTests).map(
        (test, i): TestRule => ({
          id: `${refOf(t)}#sshTests/${i}`,
          ...this.meta(t),
          kind: 'ssh',
          src: this.resolve(test.src, t, 'sshTests src'),
          dst: this.resolveAll(test.dst, t, 'sshTests dst'),
          accept: test.accept ?? [],
          deny: test.deny ?? [],
          check: test.check ?? [],
        }),
      );
      return [...acl, ...sshTests];
    });

    const catalog = this.catalogGrants(catalogEntities, grants);
    grants.push(...catalog.grants);
    this.checkPorts(grants);

    // A tag no rule names is fine: devices carry it, operators mint it.
    for (const tag of tags) tag.usage = this.tagUsage.get(tag.tag) ?? 0;

    // Every tailnet group, and any other Backstage Group a rule names.
    const groups: GroupView[] = [...this.dir.groups.values()]
      .filter(g => g.annotated || this.usedGroups.has(g.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(g => ({
        name: g.name,
        entityRef: g.ref,
        title: g.title,
        description: g.description,
        usage: this.usedGroups.get(g.name) ?? 0,
        members: g.memberRefs.map(ref => {
          const user = this.dir.users.get(ref);
          if (!user?.login) {
            this.error(
              `${ref} is in ${g.name} but has no ${ANNOTATION_TAILNET_LOGIN} annotation`,
              ref,
            );
          }
          return { entityRef: ref, login: user?.login, title: user?.title };
        }),
      }));

    const hosts: HostView[] = Object.entries(this.hosts).map(
      ([name, address]) => ({ name, address }),
    );

    const settings = this.policy.spec.settings ?? {};
    const reserved = new Set([
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
    for (const key of Object.keys(settings)) {
      if (reserved.has(key)) {
        this.error(
          `settings.${key}: ${key} comes from Tailscale entities, not settings`,
          this.policy,
        );
      }
    }

    const view: PolicyView = {
      entityRef: refOf(this.policy),
      name: this.policy.metadata.name,
      title: this.policy.metadata.title,
      description: this.policy.metadata.description,
      tailnet: this.policy.spec.tailnet,
      owner: this.policy.spec.owner,
      publish: this.policy.spec.publish,
      renderedAt: new Date().toISOString(),
      text: '',
      spans: [],
      parts: [],
      groups,
      hosts,
      tags,
      grants,
      ssh,
      nodeAttrs,
      autoApprovers,
      tests,
      settings: Object.keys(settings).filter(k => !reserved.has(k)),
      catalog: catalog.info,
      destinations: this.destinations(grants, autoApprovers),
      diagnostics: this.diagnostics,
    };
    render(view, settings, baseUrl, this.parts.length + 1);
    view.parts = [this.policy, ...this.parts]
      .map(p => {
        const ref = refOf(p);
        return {
          entityRef: ref,
          type: (p as TailscaleEntity).spec.type,
          name: p.metadata.name,
          title: p.metadata.title,
          description: p.metadata.description,
          lines: view.spans.filter(s => s.entityRef === ref).map(s => s.lines),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return view;
  }

  /**
   * Ports that say less than they could: a grant with capabilities on every
   * port, and a grant to a Service on every port.
   */
  private checkPorts(grants: GrantRule[]) {
    for (const g of grants.filter(x => x.ip.includes('*'))) {
      const where = g.entityRef ?? g.edges?.[0]?.api;
      if (g.app) {
        this.warn(
          `carries ${Object.keys(g.app).join(
            ', ',
          )} on every port: name the port the app listens on`,
          where,
        );
      }
      const services = g.dst.filter(d => d.kind === 'service').map(d => d.name);
      if (services.length) {
        this.warn(
          `reaches every port of ${services.join(
            ', ',
          )}: name the ports. On some hosts a Service's address passes every port through to the device, not just those it serves`,
          where,
        );
      }
    }
  }

  /** Every grant destination, and what it is; a device without a reason is a problem. */
  private destinations(
    grants: GrantRule[],
    approvers: ApproverRule[],
  ): DestinationView[] {
    const views = new Map<string, DestinationView>();
    for (const g of grants) {
      for (const d of g.dst) {
        const view = views.get(d.name) ?? {
          name: d.name,
          class: 'device' as DestinationClass,
          entityRef: d.kind === 'tag' ? d.entityRef : undefined,
          grants: [],
          serves: [],
        };
        view.grants.push(g.id);
        views.set(d.name, view);
      }
    }
    const reachedBy = (name: string) =>
      grants.filter(g => g.dst.some(d => d.name === name));
    for (const view of views.values()) {
      const tag = view.name.startsWith('tag:')
        ? this.tagEntities.get(view.name)
        : undefined;
      view.reason =
        tag?.metadata.annotations?.[ANNOTATION_DEVICE_REASON]?.trim() ||
        undefined;
      view.serves = approvers
        .filter(
          a =>
            a.kind === 'service' && a.approvers.some(p => p.name === view.name),
        )
        .map(a => a.target);
      const grantsTo = reachedBy(view.name);
      if (view.name === '*') view.class = 'any';
      else if (view.name.startsWith('svc:')) view.class = 'service';
      else if (view.name.startsWith('autogroup:')) view.class = 'autogroup';
      else if (
        grants.some(
          g =>
            g.src.some(s => s.name === view.name) &&
            g.dst.some(d => d.name === view.name),
        )
      ) {
        view.class = 'mesh';
      } else if (grantsTo.some(g => g.app)) view.class = 'capability';
      else view.class = 'device';

      if (
        view.class === 'device' &&
        view.entityRef && // an undeclared tag is an error already
        !view.reason
      ) {
        const by = grantsTo.map(g => g.entityRef ?? g.title ?? g.id);
        this.warn(
          `${view.name} is reached as a device, not a Service (${by.join(
            ', ',
          )})${
            view.serves.length
              ? `, though it serves ${view.serves.join(', ')}`
              : ''
          }: move the traffic to a Service, or say why on its tag entity (${ANNOTATION_DEVICE_REASON})`,
          view.entityRef,
        );
      }
    }
    const order: DestinationClass[] = [
      'service',
      'mesh',
      'capability',
      'autogroup',
      'device',
      'any',
    ];
    return [...views.values()].sort(
      (a, b) =>
        order.indexOf(a.class) - order.indexOf(b.class) ||
        a.name.localeCompare(b.name),
    );
  }

  /**
   * Grants from the catalog: a Component consuming an API across the
   * tailnet, and whoever an API's tailnet-allow names. Flows to the same
   * destination and ports share a grant; grants with the same sources and
   * destinations are then merged. A flow an entity grant already allows by
   * name gets none; one only a "*" destination allows still gets its own,
   * so the policy doesn't hang on a break-glass grant.
   */
  private catalogGrants(entities: Entity[], declared: GrantRule[]) {
    const info: PolicyView['catalog'] = {
      enabled: !!this.policy.spec.catalogGrants,
      covered: [],
      local: [],
      missingSource: [],
      invalid: [],
    };
    if (!info.enabled) return { grants: [] as GrantRule[], info };

    const graph = buildTailnetGraph(entities);
    info.local = graph.local;
    info.missingSource = graph.missingSource;
    info.invalid = graph.invalid;

    const coveredBy = (src: string, dst: string, port: PortRange) =>
      declared
        .filter(
          g =>
            g.src.some(
              s =>
                s.name === src ||
                s.name === '*' ||
                (s.name === 'autogroup:tagged' && src.startsWith('tag:')),
            ) &&
            g.dst.some(d => d.name === dst) &&
            g.ip.some(p => {
              const range = parsePort(p);
              return range && portCovers(range, port);
            }),
        )
        .map(g => g.id);

    // Same destination and ports: one grant, every source.
    const byPorts = new Map<
      string,
      { dst: string[]; ip: string[]; edges: CatalogEdge[] }
    >();
    for (const edge of graph.edges) {
      const view: CatalogEdge = {
        consumer: edge.consumer,
        api: edge.api,
        providers: edge.providers,
        via: edge.via,
        src: edge.src,
        dst: edge.dst,
        ports: edge.ports.map(formatPort),
      };
      const flows = edge.src.flatMap(s =>
        edge.dst.flatMap(d => edge.ports.map(p => coveredBy(s, d, p))),
      );
      if (flows.every(ids => ids.length)) {
        info.covered.push({ ...view, coveredBy: [...new Set(flows.flat())] });
        continue;
      }
      const dst = [...edge.dst].sort();
      const ip = view.ports.slice().sort();
      const key = `${dst.join(',')}|${ip.join(',')}`;
      const entry = byPorts.get(key) ?? { dst, ip, edges: [] };
      entry.edges.push(view);
      byPorts.set(key, entry);
    }

    // Same sources and destination: one grant, every port.
    const merged = new Map<
      string,
      { src: string[]; dst: string[]; ip: string[]; edges: CatalogEdge[] }
    >();
    for (const entry of byPorts.values()) {
      const src = [...new Set(entry.edges.flatMap(e => e.src))].sort();
      const key = `${src.join(',')}>${entry.dst.join(',')}`;
      const into = merged.get(key) ?? {
        src,
        dst: entry.dst,
        ip: [],
        edges: [],
      };
      into.ip = [...new Set([...into.ip, ...entry.ip])].sort(byPort);
      for (const e of entry.edges) {
        if (!into.edges.includes(e)) into.edges.push(e);
      }
      merged.set(key, into);
    }

    const grants = [...merged.values()]
      .sort(
        (a, b) =>
          a.dst.join(',').localeCompare(b.dst.join(',')) ||
          a.src.join(',').localeCompare(b.src.join(',')),
      )
      .map((entry): GrantRule => {
        const consumers = entry.edges.filter(e => e.via === 'consumesApi');
        const allowed = entry.edges.filter(e => e.via === 'tailnet-allow');
        const said = [
          consumers.length
            ? `Consumed by ${unique(consumers.map(e => e.consumer)).join(
                ', ',
              )}.`
            : '',
          allowed.length
            ? `Used by ${[...new Set(allowed.flatMap(e => e.src))].join(
                ', ',
              )} (tailnet-allow).`
            : '',
        ];
        return {
          id: `catalog:${entry.src.join(',')}>${entry.dst.join(
            ',',
          )}|${entry.ip.join(',')}`,
          origin: 'catalog',
          title: `From the catalog: ${unique(entry.edges.map(e => e.api)).join(
            ', ',
          )}`,
          description: said.filter(Boolean).join(' '),
          src: entry.src.map(s => {
            const edge = entry.edges.find(e => e.src.includes(s))!;
            return this.resolve(
              s,
              edge.consumer,
              edge.via === 'consumesApi'
                ? 'specht-labs.de/tailnet-src'
                : 'specht-labs.de/tailnet-allow',
            );
          }),
          dst: entry.dst.map(d =>
            this.resolve(d, entry.edges[0].api, 'specht-labs.de/tailnet-dst'),
          ),
          ip: entry.ip,
          edges: entry.edges,
        };
      });
    return { grants, info };
  }
}

/** tcp:443 before tcp:5001 before tcp:6690: by number, not text. */
function byPort(a: string, b: string) {
  const pa = parsePort(a);
  const pb = parsePort(b);
  return (
    (pa?.proto ?? '').localeCompare(pb?.proto ?? '') ||
    (pa?.from ?? 0) - (pb?.from ?? 0)
  );
}

// --- rendering ---------------------------------------------------------------

const names = (list: Principal[] | undefined) => list?.map(p => p.name);

function render(
  view: PolicyView,
  settings: JsonObject,
  baseUrl: string | undefined,
  entityCount: number,
) {
  const w = new HujsonWriter();
  const spans: Span[] = [];
  const mark = (
    rule: { entityRef?: string; lines?: Lines },
    section: string,
    lines: Lines,
  ) => {
    rule.lines = lines;
    if (rule.entityRef)
      spans.push({ entityRef: rule.entityRef, section, lines });
  };
  // One comment per entity, above the first of its items.
  let commented: string | undefined;
  const comment = (
    rule: { entityRef?: string; title?: string; description?: string },
    depth: number,
  ) => {
    if (rule.entityRef && rule.entityRef === commented) return;
    commented = rule.entityRef;
    w.comment(
      [rule.title, rule.description].filter(Boolean).join('\n\n'),
      depth,
    );
  };
  const item = (
    rule: {
      entityRef?: string;
      title?: string;
      description?: string;
      lines?: Lines;
    },
    section: string,
    key: string | undefined,
    value: any,
    depth = 2,
  ) => {
    const from = w.next;
    comment(rule, depth);
    const [, to] = w.value(key, value, depth);
    mark(rule, section, [from, to]);
  };

  const policyUrl =
    baseUrl &&
    `${baseUrl}/catalog/${parseEntityRef(view.entityRef).namespace}/tailscale/${
      view.name
    }`;
  w.comment(
    `${view.title ?? view.name}${view.tailnet ? ` (${view.tailnet})` : ''}. ` +
      `Rendered by Backstage from ${entityCount} Tailscale entities and the ` +
      `catalog's users and groups; change those, not this file.`,
    0,
  );
  if (policyUrl) w.raw(`// ${policyUrl}`);
  w.raw('{');

  const section = (key: string, open: '{' | '[', body: () => void) => {
    commented = undefined;
    w.blank();
    w.raw(`${JSON.stringify(key)}: ${open}`, 1);
    body();
    w.raw(open === '{' ? '},' : '],', 1);
  };

  if (view.groups.length) {
    section('groups', '{', () => {
      for (const group of view.groups) {
        const from = w.next;
        w.comment(group.title ?? group.description, 2);
        w.raw(`${JSON.stringify(group.name)}: [`, 2);
        for (const member of group.members) {
          const line = w.next;
          w.raw(`${JSON.stringify(member.login ?? member.entityRef)},`, 3);
          spans.push({
            entityRef: member.entityRef,
            section: 'groups',
            lines: [line, line],
          });
        }
        w.raw('],', 2);
        group.lines = [from, w.next - 1];
        spans.push({
          entityRef: group.entityRef,
          section: 'groups',
          lines: group.lines,
        });
      }
    });
  }

  if (view.hosts.length) {
    section('hosts', '{', () => {
      const width = Math.max(
        ...view.hosts.map(h => JSON.stringify(h.name).length),
      );
      for (const host of view.hosts) {
        const line = w.next;
        w.raw(
          `${`${JSON.stringify(host.name)}:`.padEnd(width + 2)}${JSON.stringify(
            host.address,
          )},`,
          2,
        );
        host.lines = [line, line];
        spans.push({
          entityRef: view.entityRef,
          section: 'hosts',
          lines: host.lines,
        });
      }
    });
  }

  if (view.tags.length) {
    section('tagOwners', '{', () => {
      for (const tag of view.tags)
        item(tag, 'tagOwners', tag.tag, names(tag.owners));
    });
  }

  if (view.nodeAttrs.length) {
    section('nodeAttrs', '[', () => {
      for (const n of view.nodeAttrs) {
        item(n, 'nodeAttrs', undefined, {
          target: names(n.nodes),
          attr: n.attr.length ? n.attr : undefined,
          app: n.app,
          ipPool: n.ipPool,
        });
      }
    });
  }

  if (view.autoApprovers.length) {
    section('autoApprovers', '{', () => {
      const groupsOf = (kind: ApproverRule['kind']) => {
        const merged = new Map<
          string,
          { rules: ApproverRule[]; approvers: string[] }
        >();
        for (const rule of view.autoApprovers.filter(r => r.kind === kind)) {
          const entry = merged.get(rule.target) ?? { rules: [], approvers: [] };
          entry.rules.push(rule);
          for (const a of rule.approvers) {
            if (!entry.approvers.includes(a.name)) entry.approvers.push(a.name);
          }
          merged.set(rule.target, entry);
        }
        return merged;
      };
      // Entity by entity; a target two entities approve is written once,
      // with both's approvers.
      const block = (key: string, kind: 'service' | 'route') => {
        const merged = groupsOf(kind);
        if (!merged.size) return;
        w.raw(`${JSON.stringify(key)}: {`, 2);
        const written = new Map<string, Lines>();
        for (const rule of view.autoApprovers.filter(r => r.kind === kind)) {
          const done = written.get(rule.target);
          if (done) {
            mark(rule, 'autoApprovers', done);
            continue;
          }
          const from = w.next;
          comment(rule, 3);
          const [, to] = w.value(
            rule.target,
            merged.get(rule.target)!.approvers,
            3,
          );
          written.set(rule.target, [from, to]);
          mark(rule, 'autoApprovers', [from, to]);
        }
        w.raw('},', 2);
      };
      block('routes', 'route');
      block('services', 'service');
      const exit = groupsOf('exitNode').get('exit node');
      if (exit) {
        const from = w.next;
        const [, to] = w.value('exitNode', exit.approvers, 2);
        for (const r of exit.rules) mark(r, 'autoApprovers', [from, to]);
      }
    });
  }

  if (view.ssh.length) {
    section('ssh', '[', () => {
      for (const s of view.ssh) {
        item(s, 'ssh', undefined, {
          action: s.action,
          checkPeriod: s.checkPeriod,
          src: names(s.src),
          dst: names(s.dst),
          users: s.users,
          acceptEnv: s.acceptEnv,
          recorder: names(s.recorder),
          enforceRecorder: s.enforceRecorder,
        });
      }
    });
  }

  if (view.grants.length) {
    section('grants', '[', () => {
      for (const g of view.grants) {
        item(g, 'grants', undefined, {
          src: names(g.src),
          dst: names(g.dst),
          ip: g.ip.length ? g.ip : undefined,
          via: names(g.via),
          srcPosture: g.srcPosture,
          app: g.app,
        });
      }
    });
  }

  const testsOf = (kind: TestRule['kind']) =>
    view.tests.filter(t => t.kind === kind);
  if (testsOf('acl').length) {
    section('tests', '[', () => {
      for (const t of testsOf('acl')) {
        item(t, 'tests', undefined, {
          src: t.src.name,
          proto: t.proto,
          accept: t.accept.length ? t.accept : undefined,
          deny: t.deny.length ? t.deny : undefined,
        });
      }
    });
  }
  if (testsOf('ssh').length) {
    section('sshTests', '[', () => {
      for (const t of testsOf('ssh')) {
        item(t, 'sshTests', undefined, {
          src: t.src.name,
          dst: names(t.dst),
          accept: t.accept.length ? t.accept : undefined,
          check: t.check.length ? t.check : undefined,
          deny: t.deny.length ? t.deny : undefined,
        });
      }
    });
  }

  for (const key of view.settings) {
    w.blank();
    const [from, to] = w.value(key, settings[key] as any, 1);
    spans.push({ entityRef: view.entityRef, section: key, lines: [from, to] });
  }
  w.raw('}');

  view.text = w.toString();
  view.spans = spans;
}

// --- everything --------------------------------------------------------------

/**
 * Puts every policy in the catalog together. `entities` holds the Tailscale
 * entities, the Groups and Users, and (for catalog grants) the Components,
 * APIs and kubernetes-cluster Resources, with their relations.
 */
export function compileAll(
  entities: Entity[],
  baseUrl?: string,
): CompiledOverview {
  const dir = new Directory(entities);
  const tailscale = entities.filter(isTailscale).filter(e => {
    // The catalog refuses invalid ones; this guards against a stale cache.
    return validateTailscaleSpec(e.spec).length === 0;
  });
  const policies = tailscale.filter(
    (e): e is TailscaleEntity<PolicySpec> => e.spec.type === 'policy',
  );
  const byRef = new Map(policies.map(p => [refOf(p), p]));
  const parts = new Map<string, TailscaleEntity[]>(
    policies.map(p => [refOf(p), []]),
  );
  const orphans: Diagnostic[] = [];

  for (const part of tailscale.filter(e => e.spec.type !== 'policy')) {
    const target = stringifyEntityRef(
      parseEntityRef(part.spec.target!, {
        defaultKind: 'tailscale',
        defaultNamespace: part.metadata.namespace ?? 'default',
      }),
    );
    if (!byRef.has(target)) {
      orphans.push({
        severity: 'error',
        entityRef: refOf(part),
        message: `its target ${part.spec.target} is not a Tailscale policy in the catalog`,
      });
      continue;
    }
    parts.get(target)!.push(part);
  }

  return {
    renderedAt: new Date().toISOString(),
    orphans,
    policies: policies
      .sort(byName)
      .map(p =>
        new PolicyCompiler(dir, p, parts.get(refOf(p))!).compile(
          entities,
          baseUrl,
        ),
      ),
  };
}
