import type { Entity } from '@backstage/catalog-model';
import { parse } from 'jsonc-parser';
import { accessFor } from './access';
import { compileAll } from './compile';
import { CATALOG_FIELDS } from './plugin';
import {
  isTailscale,
  validateTailscaleSpec,
} from '@spechtlabs/backstage-plugin-tailscale-common';

const ts = (name: string, spec: Record<string, unknown>, title?: string) =>
  ({
    apiVersion: 'specht-labs.de/v1alpha1',
    kind: 'Tailscale',
    metadata: { name, namespace: 'default', title },
    spec: { target: 'tailscale:tailnet', owner: 'group:ops', ...spec },
    relations: [],
  } as Entity);

const user = (name: string, login?: string, groups: string[] = []) =>
  ({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'User',
    metadata: {
      name,
      namespace: 'default',
      annotations: login ? { 'specht-labs.de/tailnet-login': login } : {},
    },
    spec: { profile: { displayName: name.toUpperCase() }, memberOf: groups },
    relations: groups.map(g => ({
      type: 'memberOf',
      targetRef: `group:default/${g}`,
    })),
  } as Entity);

const group = (name: string, tailnet: string, members: string[]) =>
  ({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Group',
    metadata: {
      name,
      namespace: 'default',
      annotations: { 'specht-labs.de/tailnet-group': tailnet },
    },
    spec: { type: 'tailnet-group', children: [] },
    relations: members.map(m => ({
      type: 'hasMember',
      targetRef: `user:default/${m}`,
    })),
  } as Entity);

const component = (
  name: string,
  annotations: Record<string, string>,
  relations: Array<[string, string]> = [],
) =>
  ({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name, namespace: 'default', annotations },
    spec: {},
    relations: relations.map(([type, targetRef]) => ({ type, targetRef })),
  } as Entity);

const api = (
  name: string,
  annotations: Record<string, string>,
  providedBy: string,
) =>
  ({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'API',
    metadata: { name, namespace: 'default', annotations },
    spec: {},
    relations: [{ type: 'apiProvidedBy', targetRef: providedBy }],
  } as Entity);

function catalog(extra: Entity[] = []) {
  return [
    {
      ...ts(
        'tailnet',
        {
          type: 'policy',
          target: undefined,
          tailnet: 'example.ts.net',
          catalogGrants: true,
          hosts: { nas: '100.64.0.1' },
          settings: { randomizeClientPort: true },
        },
        'Example tailnet',
      ),
    },
    user('ada', 'ada@github', ['admins']),
    user('bob', 'bob@github', ['admins']),
    group('admins', 'group:admins', ['ada', 'bob']),
    ts(
      'tag-server',
      {
        type: 'tag',
        tag: 'tag:server',
        owners: ['group:admins'],
        appliesTo: ['resource:box'],
      },
      'Servers',
    ),
    ts('tag-agent', {
      type: 'tag',
      tag: 'tag:agent',
      owners: ['group:admins', 'tag:server'],
    }),
    ts(
      'grant-admins',
      {
        type: 'grant',
        src: ['group:admins'],
        dst: ['svc:web'],
        ip: ['tcp:443'],
      },
      'Admins use the web UI',
    ),
    ts('grant-idp', {
      type: 'grant',
      src: ['user:ada'],
      dst: ['tag:server'],
      ip: ['tcp:443'],
      app: { 'tailscale.com/cap/tsidp': [{ users: ['group:admins'] }] },
    }),
    ts('ssh-admins', {
      type: 'ssh',
      action: 'check',
      checkPeriod: '8h',
      src: ['group:admins'],
      dst: ['tag:server'],
      users: ['root'],
    }),
    ts('attr-funnel', {
      type: 'nodeAttr',
      nodes: ['tag:server'],
      attr: ['funnel'],
    }),
    ts(
      'approve-web',
      { type: 'autoApprovers', services: { 'svc:web': ['tag:server'] } },
      'The server serves svc:web',
    ),
    ts('approve-web-too', {
      type: 'autoApprovers',
      services: { 'svc:web': ['tag:agent'] },
    }),
    ts('test-reach', {
      type: 'test',
      tests: [
        { src: 'user:ada', proto: 'tcp', accept: ['nas:443', 'tag:server:22'] },
        { src: 'tag:agent', deny: ['nas:22'] },
      ],
      sshTests: { src: 'user:bob', dst: ['tag:server'], check: ['root'] },
    }),
    // The agent consumes the server's API across the tailnet.
    component('agent', { 'specht-labs.de/tailnet-src': 'tag:agent' }, [
      ['consumesApi', 'api:default/server-api'],
    ]),
    component('server', {}, [['providesApi', 'api:default/server-api']]),
    api(
      'server-api',
      {
        'specht-labs.de/tailnet-dst': 'tag:server',
        'specht-labs.de/tailnet-ports': 'tcp:8080',
      },
      'component:default/server',
    ),
    ...extra,
  ];
}

describe('compileAll', () => {
  const overview = compileAll(catalog(), 'https://backstage.example');
  const [policy] = overview.policies;
  const file = parse(policy.text, [], { allowTrailingComma: true });

  it('renders a policy file Tailscale can read', () => {
    const errors: unknown[] = [];
    parse(policy.text, errors as any, { allowTrailingComma: true });
    expect(errors).toEqual([]);
    expect(policy.diagnostics).toEqual([]);
    expect(policy.text).toMatch(
      /^\/\/ Example tailnet \(example\.ts\.net\)\. Rendered by Backstage/,
    );
    expect(policy.text).toContain(
      '// https://backstage.example/catalog/default/tailscale/tailnet',
    );
  });

  it('takes the groups and their members from the catalog', () => {
    expect(file.groups).toEqual({
      'group:admins': ['ada@github', 'bob@github'],
    });
    expect(policy.groups[0]).toMatchObject({
      entityRef: 'group:default/admins',
      usage: 5,
    });
  });

  it('renders every section from its entities', () => {
    expect(file.hosts).toEqual({ nas: '100.64.0.1' });
    expect(file.tagOwners).toEqual({
      'tag:agent': ['group:admins', 'tag:server'],
      'tag:server': ['group:admins'],
    });
    expect(file.nodeAttrs).toEqual([
      { target: ['tag:server'], attr: ['funnel'] },
    ]);
    expect(file.autoApprovers).toEqual({
      services: { 'svc:web': ['tag:server', 'tag:agent'] },
    });
    expect(file.ssh).toEqual([
      {
        action: 'check',
        checkPeriod: '8h',
        src: ['group:admins'],
        dst: ['tag:server'],
        users: ['root'],
      },
    ]);
    expect(file.tests).toEqual([
      { src: 'ada@github', proto: 'tcp', accept: ['nas:443', 'tag:server:22'] },
      { src: 'tag:agent', deny: ['nas:22'] },
    ]);
    expect(file.sshTests).toEqual([
      { src: 'bob@github', dst: ['tag:server'], check: ['root'] },
    ]);
    expect(file.randomizeClientPort).toBe(true);
  });

  it('resolves users, and adds a grant for each API consumed across the tailnet', () => {
    expect(file.grants).toEqual([
      { src: ['group:admins'], dst: ['svc:web'], ip: ['tcp:443'] },
      {
        src: ['ada@github'],
        dst: ['tag:server'],
        ip: ['tcp:443'],
        app: { 'tailscale.com/cap/tsidp': [{ users: ['group:admins'] }] },
      },
      { src: ['tag:agent'], dst: ['tag:server'], ip: ['tcp:8080'] },
    ]);
    const fromCatalog = policy.grants[2];
    expect(fromCatalog).toMatchObject({
      origin: 'catalog',
      title: 'From the catalog: server-api',
      description: 'Consumed by agent.',
    });
    expect(fromCatalog.edges!.map(e => e.consumer)).toEqual([
      'component:default/agent',
    ]);
  });

  it('gives no catalog grant to what a grant entity names', () => {
    const covered = compileAll(
      catalog([
        ts('grant-agents', {
          type: 'grant',
          src: ['tag:agent'],
          dst: ['tag:server'],
          ip: ['tcp:8000-9000'],
        }),
      ]),
    ).policies[0];
    expect(covered.grants.filter(g => g.origin === 'catalog')).toEqual([]);
    expect(covered.catalog.covered).toMatchObject([
      {
        consumer: 'component:default/agent',
        coveredBy: ['tailscale:default/grant-agents'],
      },
    ]);
  });

  it('keeps catalog grants that only a "*" destination covers', () => {
    const broad = compileAll(
      catalog([
        ts('grant-agents', {
          type: 'grant',
          src: ['tag:agent'],
          dst: ['*'],
          ip: ['*'],
        }),
      ]),
    ).policies[0];
    expect(
      broad.grants.filter(g => g.origin === 'catalog').map(g => g.id),
    ).toEqual(['catalog:tag:agent>tag:server|tcp:8080']);
  });

  it('grants what an API allows, as its client tag, merged by source', () => {
    const allowed = compileAll(
      catalog([
        api(
          'web-ui',
          {
            'specht-labs.de/tailnet-dst': 'svc:web',
            'specht-labs.de/tailnet-ports': 'tcp:443',
            'specht-labs.de/tailnet-allow': 'group:admins, autogroup:member',
          },
          'component:default/server',
        ),
        api(
          'web-sync',
          {
            'specht-labs.de/tailnet-dst': 'svc:web',
            'specht-labs.de/tailnet-ports': 'tcp:6690',
            'specht-labs.de/tailnet-allow': 'group:admins, autogroup:member',
          },
          'component:default/server',
        ),
        api(
          'idp',
          {
            'specht-labs.de/tailnet-dst': 'tag:server',
            'specht-labs.de/tailnet-ports': 'tcp:443',
            'specht-labs.de/tailnet-client-tag': 'tag:agent',
          },
          'component:default/server',
        ),
        // No tailnet-src: it reaches idp as the API's client tag.
        component('portal', {}, [['consumesApi', 'api:default/idp']]),
      ]),
    ).policies[0];
    const fromCatalog = allowed.grants.filter(g => g.origin === 'catalog');
    expect(
      fromCatalog.map(g => [
        g.src.map(p => p.name),
        g.dst.map(p => p.name),
        g.ip,
      ]),
    ).toEqual([
      // 443 and 6690 to svc:web: one grant, the ports in order.
      [
        ['autogroup:member', 'group:admins'],
        ['svc:web'],
        ['tcp:443', 'tcp:6690'],
      ],
      [['tag:agent'], ['tag:server'], ['tcp:443', 'tcp:8080']],
    ]);
    expect(fromCatalog[0].description).toBe(
      'Used by group:admins, autogroup:member (tailnet-allow).',
    );
    expect(
      fromCatalog[1].edges!.find(e => e.api === 'api:default/idp'),
    ).toMatchObject({
      consumer: 'component:default/portal',
      via: 'consumesApi',
      src: ['tag:agent'],
    });
    expect(allowed.catalog.missingSource).toEqual([]);
    expect(allowed.diagnostics).toEqual([]);
  });

  it('says which tailnet annotations it cannot read', () => {
    const bad = compileAll(
      catalog([
        api(
          'odd',
          {
            'specht-labs.de/tailnet-dst': 'svc:web',
            'specht-labs.de/tailnet-ports': 'tcp:443',
            'specht-labs.de/tailnet-allow': 'everyone',
            'specht-labs.de/tailnet-client-tag': 'agent',
          },
          'component:default/server',
        ),
        api(
          'half',
          { 'specht-labs.de/tailnet-allow': 'group:admins' },
          'component:default/server',
        ),
      ]),
    ).policies[0];
    expect(bad.catalog.invalid.map(f => `${f.entity}: ${f.message}`)).toEqual([
      'api:default/odd: specht-labs.de/tailnet-allow: only groups, users, autogroups and tags, not everyone',
      'api:default/odd: specht-labs.de/tailnet-client-tag: one tag:…, not agent',
      'api:default/half: the tailnet annotations need specht-labs.de/tailnet-dst',
    ]);
  });

  it('knows which lines each entity rendered to', () => {
    const lines = policy.text.split('\n');
    const span = policy.spans.find(
      s => s.entityRef === 'tailscale:default/grant-admins',
    )!;
    const text = lines.slice(span.lines[0] - 1, span.lines[1]).join('\n');
    expect(text).toContain('// Admins use the web UI');
    expect(text).toContain('"svc:web"');
    expect(text.trim().endsWith('},')).toBe(true);
    // Both approvers of svc:web point at the one line that has it.
    const approvers = policy.autoApprovers.map(a => a.lines);
    expect(approvers[0]).toEqual(approvers[1]);
    expect(policy.parts.find(p => p.name === 'test-reach')!.lines).toHaveLength(
      3,
    );
  });

  it('says what does not resolve', () => {
    const broken = compileAll(
      catalog([
        user('eve'),
        group('sre', 'group:sre', ['eve']),
        ts('grant-broken', {
          type: 'grant',
          src: ['group:nobody', 'svc:web'],
          dst: ['tag:unknown', 'somewhere'],
          ip: ['*'],
        }),
        ts('tag-dup', {
          type: 'tag',
          tag: 'tag:server',
          owners: ['group:admins'],
        }),
        ts('grant-elsewhere', {
          type: 'grant',
          target: 'tailscale:other',
          src: ['*'],
          dst: ['*'],
          ip: ['*'],
        }),
      ]),
    );
    expect(
      broken.policies[0].diagnostics.map(d => `${d.entityRef}: ${d.message}`),
    ).toEqual([
      'tailscale:default/tag-server: tag:server is already declared by tailscale:default/tag-dup',
      'tailscale:default/grant-broken: src: group:nobody is no group: no Backstage Group has specht-labs.de/tailnet-group: group:nobody',
      'tailscale:default/grant-broken: src: svc:web is a Service; Services are destinations',
      'tailscale:default/grant-broken: dst: tag:unknown is not declared: no Tailscale tag entity in this policy has tag: tag:unknown',
      'tailscale:default/grant-broken: dst: somewhere is neither a host of this policy nor a selector',
      'user:default/eve: user:default/eve is in group:sre but has no specht-labs.de/tailnet-login annotation',
    ]);
    expect(broken.orphans).toEqual([
      {
        severity: 'error',
        entityRef: 'tailscale:default/grant-elsewhere',
        message:
          'its target tailscale:other is not a Tailscale policy in the catalog',
      },
    ]);
  });
});

describe('destinations', () => {
  const tag = (name: string, annotations: Record<string, string> = {}) => ({
    ...ts(`tag-${name}`, {
      type: 'tag',
      tag: `tag:${name}`,
      owners: ['group:admins'],
    }),
    metadata: { name: `tag-${name}`, namespace: 'default', annotations },
  });
  const grant = (name: string, spec: Record<string, unknown>) =>
    ts(name, { type: 'grant', ...spec });

  const compiled = compileAll(
    catalog([
      tag('ceph'),
      tag('ceph-client'),
      tag('idp'),
      tag('nas'),
      tag('box', {
        'specht-labs.de/tailnet-device-reason': 'NFS v3 needs the device',
      }),
      grant('grant-ceph-peers', {
        src: ['tag:ceph'],
        dst: ['tag:ceph'],
        ip: ['tcp:6789'],
      }),
      grant('grant-ceph-clients', {
        src: ['tag:ceph-client'],
        dst: ['tag:ceph'],
        ip: ['tcp:6789'],
      }),
      grant('grant-idp-admin', {
        src: ['group:admins'],
        dst: ['tag:idp'],
        ip: ['*'],
        app: { 'tailscale.com/cap/tsidp': [{ allow_admin_ui: true }] },
      }),
      grant('grant-nas', {
        src: ['tag:agent'],
        dst: ['tag:nas'],
        ip: ['tcp:2049'],
      }),
      grant('grant-box', {
        src: ['tag:agent'],
        dst: ['tag:box'],
        ip: ['tcp:111'],
      }),
      grant('grant-web-all', {
        src: ['group:admins'],
        dst: ['svc:web'],
        ip: ['*'],
      }),
      grant('grant-self', {
        src: ['autogroup:member'],
        dst: ['autogroup:self'],
        ip: ['5252'],
      }),
      ts('approve-nas', {
        type: 'autoApprovers',
        services: { 'svc:files': ['tag:nas'] },
      }),
    ]),
  ).policies[0];
  const classOf = (name: string) =>
    compiled.destinations.find(d => d.name === name);

  it('says what each destination is', () => {
    expect(
      compiled.destinations.map(
        d => `${d.name} ${d.class}${d.reason ? ` (${d.reason})` : ''}`,
      ),
    ).toEqual([
      'svc:web service',
      'tag:ceph mesh',
      'tag:idp capability',
      'tag:server capability',
      'autogroup:self autogroup',
      'tag:box device (NFS v3 needs the device)',
      'tag:nas device',
    ]);
    expect(classOf('tag:nas')).toMatchObject({
      serves: ['svc:files'],
      grants: ['tailscale:default/grant-nas'],
    });
  });

  it('warns about a device without a reason, and about "*" where ports belong', () => {
    const warnings = compiled.diagnostics
      .filter(d => d.severity === 'warning')
      .map(d => `${d.entityRef}: ${d.message}`);
    expect(warnings).toEqual([
      'tailscale:default/grant-idp-admin: carries tailscale.com/cap/tsidp on every port: name the port the app listens on',
      "tailscale:default/grant-web-all: reaches every port of svc:web: name the ports. On some hosts a Service's address passes every port through to the device, not just those it serves",
      'tailscale:default/tag-nas: tag:nas is reached as a device, not a Service (tailscale:default/grant-nas), though it serves svc:files: move the traffic to a Service, or say why on its tag entity (specht-labs.de/tailnet-device-reason)',
    ]);
  });
});

describe('accessFor', () => {
  const entities = catalog();
  const overview = compileAll(entities);
  const byRef = new Map(
    entities.map(e => [
      `${e.kind.toLowerCase()}:default/${e.metadata.name}`,
      e,
    ]),
  );

  it('shows a Component what it reaches and who reaches it', () => {
    const [agent] = accessFor(
      byRef.get('component:default/agent')!,
      overview,
      byRef,
    );
    expect(agent.identities).toEqual([
      {
        name: 'tag:agent',
        source: true,
        destination: false,
        via: 'specht-labs.de/tailnet-src',
      },
      // tag:agent may serve svc:web (approve-web-too).
      {
        name: 'svc:web',
        source: false,
        destination: true,
        via: 'serves it as tag:agent',
      },
    ]);
    expect(agent.outbound.map(g => g.origin)).toEqual(['catalog']);
    const [server] = accessFor(
      byRef.get('component:default/server')!,
      overview,
      byRef,
    );
    expect(server.inbound.map(g => g.dst[0].name)).toEqual([
      'svc:web',
      'tag:server',
      'tag:server',
    ]);
  });

  it('shows a User their groups, grants and SSH access', () => {
    const [ada] = accessFor(byRef.get('user:default/ada')!, overview, byRef);
    expect(ada.identities.map(i => i.name)).toEqual([
      'ada@github',
      'group:admins',
    ]);
    expect(ada.outbound.map(g => g.id)).toEqual([
      'tailscale:default/grant-admins',
      'tailscale:default/grant-idp',
    ]);
    expect(ada.sshFrom.map(s => s.id)).toEqual([
      'tailscale:default/ssh-admins',
    ]);
  });

  it('shows what carries a tag through appliesTo', () => {
    const box = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Resource',
      metadata: { name: 'box', namespace: 'default' },
    } as Entity;
    const [access] = accessFor(box, overview, byRef);
    expect(access.identities.map(i => i.via)).toEqual([
      'carries tag:server',
      'serves it as tag:server',
    ]);
    // ...so who reaches svc:web reaches it.
    expect(access.inbound.map(g => g.id)).toContain(
      'tailscale:default/grant-admins',
    );
    expect(access.sshInto.map(s => s.id)).toEqual([
      'tailscale:default/ssh-admins',
    ]);
    expect(access.approvals.map(a => a.target)).toEqual(['svc:web']);
  });
});

describe('validateTailscaleSpec', () => {
  it('accepts every type', () => {
    for (const entity of catalog().filter(isTailscale)) {
      expect([
        entity.metadata.name,
        validateTailscaleSpec(entity.spec),
      ]).toEqual([entity.metadata.name, []]);
    }
  });

  it('says what is wrong', () => {
    expect(validateTailscaleSpec({ type: 'acl' })).toEqual([
      'spec.type must be one of policy, grant, ssh, tag, nodeAttr, autoApprovers, test, not acl',
    ]);
    expect(
      validateTailscaleSpec({
        type: 'grant',
        src: 'group:x',
        ip: ['nope'],
        app: { 'not a cap': {} },
      }),
    ).toEqual([
      'spec.target is required',
      'spec.owner is required',
      'spec.src must be a list of strings',
      'spec.dst is required',
      'spec.ip: not ports: nope',
      'spec.app: not a cap is not a capability (<domain>/cap/<name>)',
      'spec.app.not a cap must be a list of objects',
    ]);
    expect(
      validateTailscaleSpec({
        type: 'ssh',
        target: 'x',
        owner: 'group:x',
        action: 'allow',
        src: [],
        dst: ['*'],
        users: ['root'],
      }),
    ).toEqual([
      'spec.action must be accept or check, not allow',
      'spec.src needs at least one entry',
    ]);
    expect(
      validateTailscaleSpec({
        type: 'tag',
        target: 'x',
        owner: 'group:x',
        tag: 'server',
        owners: [],
      }),
    ).toEqual([
      'spec.tag must be tag:<name>, not server',
      'spec.owners needs at least one entry',
    ]);
    expect(
      validateTailscaleSpec({
        type: 'test',
        target: 'x',
        owner: 'group:x',
        tests: [{ proto: 'tcp' }],
      }),
    ).toEqual([
      'spec.tests[0].src is required',
      'spec.tests[0] needs accept or deny',
    ]);
    expect(
      validateTailscaleSpec({
        type: 'autoApprovers',
        target: 'x',
        owner: 'group:x',
        services: { web: ['tag:a'] },
      }),
    ).toEqual(['spec.services: web is not svc:<name>']);
  });
});

describe('spec.publish', () => {
  const policy = (publish: unknown) =>
    validateTailscaleSpec({ type: 'policy', owner: 'group:x', publish });
  it('takes a repository, a path and a flow', () => {
    expect(policy({ repo: 'o/r', path: 'policy.hujson' })).toEqual([]);
    expect(
      policy({
        repo: 'o/r',
        path: 'tailscale/policy.hujson',
        flow: 'push',
        branch: 'main',
      }),
    ).toEqual([]);
    expect(policy({ repo: 'https://github.com/o/r', flow: 'merge' })).toEqual([
      'spec.publish.repo must be owner/name',
      'spec.publish.path is required',
      'spec.publish.flow must be pullRequest or push, not merge',
    ]);
  });
});

describe('CATALOG_FIELDS', () => {
  it('fetches enough of an entity to recognise and read it', () => {
    const pick = (entity: any) =>
      Object.fromEntries(
        Object.entries(entity).filter(([key]) =>
          CATALOG_FIELDS.some(f => f.split('.')[0] === key),
        ),
      );
    const fetched = pick(catalog()[4]) as Entity;
    expect(isTailscale(fetched)).toBe(true);
    expect(validateTailscaleSpec(fetched.spec)).toEqual([]);
  });
});
