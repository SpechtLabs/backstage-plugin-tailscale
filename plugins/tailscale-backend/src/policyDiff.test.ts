import type { Entity } from '@backstage/catalog-model';
import { diffPolicies, relate, servicePorts } from './policyDiff';

const changes = (diff: ReturnType<typeof diffPolicies>) =>
  Object.fromEntries(
    diff
      .filter(d => d.onlyApplied.length || d.onlyRendered.length)
      .map(d => [
        d.section,
        { applied: d.onlyApplied, rendered: d.onlyRendered },
      ]),
  );

describe('diffPolicies', () => {
  it('compares what grants allow, not how they are written', () => {
    const applied = {
      grants: [
        {
          src: ['tag:a', 'tag:b'],
          dst: ['svc:web'],
          ip: ['tcp:443', 'tcp:80'],
        },
      ],
    };
    const rendered = {
      grants: [
        { src: ['tag:b'], dst: ['svc:web'], ip: ['tcp:80', 'tcp:443'] },
        { src: ['tag:a'], dst: ['svc:web'], ip: ['tcp:443'] },
        { src: ['tag:a'], dst: ['svc:web'], ip: ['tcp:80'] },
      ],
    };
    expect(changes(diffPolicies(applied, rendered))).toEqual({});
  });

  it('takes "*" to a Service as the ports the Service has', () => {
    const ports = new Map([['svc:hass', ['tcp:443', 'tcp:8123']]]);
    const applied = {
      grants: [{ src: ['group:hass'], dst: ['svc:hass'], ip: ['*'] }],
    };
    const rendered = {
      grants: [
        { src: ['group:hass'], dst: ['svc:hass'], ip: ['tcp:443', 'tcp:8123'] },
      ],
    };
    expect(changes(diffPolicies(applied, rendered, ports))).toEqual({});
    // Without knowing the Service's ports, "*" is "*".
    expect(changes(diffPolicies(applied, rendered))).toEqual({
      grants: {
        applied: ['group:hass -> svc:hass *'],
        rendered: [
          'group:hass -> svc:hass tcp:443',
          'group:hass -> svc:hass tcp:8123',
        ],
      },
    });
  });

  it('says what differs, section by section', () => {
    const applied = {
      groups: { 'group:admins': ['a@github'] },
      tagOwners: { 'tag:x': ['group:admins'] },
      autoApprovers: { services: { 'svc:web': ['tag:x'] } },
      grants: [
        {
          src: ['group:admins'],
          dst: ['tag:idp'],
          ip: ['tcp:443'],
          app: { 'example.com/cap/idp': [{ b: 1, a: 2 }] },
        },
      ],
      tests: [
        {
          src: 'a@github',
          proto: 'tcp',
          accept: ['host:443'],
          deny: ['host:22'],
        },
      ],
      randomizeClientPort: true,
    };
    const rendered = {
      groups: { 'group:admins': ['a@github', 'b@github'] },
      tagOwners: { 'tag:x': ['group:admins'] },
      autoApprovers: { services: { 'svc:web': ['tag:y'] } },
      grants: [
        {
          src: ['group:admins'],
          dst: ['tag:idp'],
          ip: ['tcp:443'],
          app: { 'example.com/cap/idp': [{ a: 2, b: 1 }] },
        },
      ],
      tests: [{ src: 'a@github', proto: 'tcp', accept: ['host:443'] }],
    };
    expect(changes(diffPolicies(applied, rendered))).toEqual({
      groups: { applied: [], rendered: ['group:admins has b@github'] },
      autoApprovers: {
        applied: ['svc:web served by tag:x'],
        rendered: ['svc:web served by tag:y'],
      },
      tests: { applied: ['a@github tcp deny host:22'], rendered: [] },
      settings: { applied: ['randomizeClientPort: true'], rendered: [] },
    });
  });
});

describe('relate and servicePorts', () => {
  const entities = () =>
    [
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Component',
        metadata: { name: 'server', namespace: 'default' },
        spec: { providesApis: ['web'], dependsOn: ['resource:box'] },
      },
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Component',
        metadata: { name: 'client', namespace: 'default' },
        spec: { consumesApis: ['api:web'] },
      },
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'API',
        metadata: {
          name: 'web',
          namespace: 'default',
          annotations: {
            'specht-labs.de/tailnet-dst': 'svc:web',
            'specht-labs.de/tailnet-ports': 'tcp:443, tcp:80',
          },
        },
        spec: {},
      },
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'User',
        metadata: { name: 'ada', namespace: 'default' },
        spec: { memberOf: ['admins'] },
      },
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Group',
        metadata: { name: 'admins', namespace: 'default' },
        spec: {},
      },
      {
        apiVersion: 'specht-labs.de/v1alpha1',
        kind: 'Tailscale',
        metadata: { name: 'tag-web', namespace: 'default' },
        spec: {
          type: 'tag',
          target: 'tailscale:tailnet',
          owner: 'group:admins',
          tag: 'tag:web',
          owners: ['group:admins'],
        },
      },
    ] as Entity[];

  it('adds the relations the catalog would', () => {
    const list = entities();
    relate(list);
    const rel = (name: string) =>
      list
        .find(e => e.metadata.name === name)!
        .relations!.map(r => `${r.type} ${r.targetRef}`);
    expect(rel('server')).toEqual([
      'providesApi api:default/web',
      'dependsOn resource:default/box',
    ]);
    expect(rel('client')).toEqual(['consumesApi api:default/web']);
    expect(rel('web')).toEqual([
      'apiProvidedBy component:default/server',
      'apiConsumedBy component:default/client',
    ]);
    expect(rel('admins')).toEqual([
      'hasMember user:default/ada',
      'ownerOf tailscale:default/tag-web',
    ]);
    expect(rel('tag-web')).toEqual([
      'ownedBy group:default/admins',
      'partOfPolicy tailscale:default/tailnet',
    ]);
  });

  it("knows a Service's ports from its APIs", () => {
    expect(servicePorts(entities())).toEqual(
      new Map([['svc:web', ['tcp:443', 'tcp:80']]]),
    );
  });
});
