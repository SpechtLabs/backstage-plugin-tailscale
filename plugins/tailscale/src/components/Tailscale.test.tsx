import { fireEvent, screen, within } from '@testing-library/react';
import {
  renderInTestApp,
  TestApiProvider,
} from '@backstage/frontend-test-utils';
import {
  EntityProvider,
  entityRouteRef,
} from '@backstage/plugin-catalog-react';
import type { Entity } from '@backstage/catalog-model';
import {
  tailscaleApiRef,
  type EntityAccess,
  type GrantRule,
  type Overview,
  type Principal,
} from '../api';
import { rootRouteRef } from '../routes';
import { PolicyConsole } from './PolicyConsole';
import { EntityTailscaleCard, TailscaleEntityCard } from './EntityCards';
import { tokenize } from './CodeView';

const p = (
  name: string,
  kind: Principal['kind'],
  extra: Partial<Principal> = {},
): Principal => ({
  value: name,
  name,
  kind,
  ...extra,
});
const admins = p('group:admins', 'group', {
  entityRef: 'group:default/tailnet-admins',
  title: 'Tailnet admins',
});
const server = p('tag:server', 'tag', {
  entityRef: 'tailscale:default/tag-server',
  title: 'Servers',
});

const text = `// Example tailnet
{
	"groups": {
		"group:admins": [
			"ada@github",
		],
	},
	"grants": [
		// Admins use the web UI
		{
			"src": ["group:admins"],
			"dst": ["svc:web"],
			"ip":  ["tcp:443"],
		},
		// From the catalog: server-api
		{
			"src": ["tag:agent"],
			"dst": ["tag:server"],
			"ip":  ["tcp:8080"],
		},
	],
}
`;

const declared: GrantRule = {
  id: 'tailscale:default/grant-admins',
  entityRef: 'tailscale:default/grant-admins',
  title: 'Admins use the web UI',
  origin: 'entity',
  src: [admins],
  dst: [p('svc:web', 'service')],
  ip: ['tcp:443'],
  lines: [9, 14],
};
const fromCatalog: GrantRule = {
  id: 'catalog:tag:server|tcp:8080',
  title: 'From the catalog: server-api',
  description: 'Consumed by agent.',
  origin: 'catalog',
  src: [p('tag:agent', 'tag')],
  dst: [server],
  ip: ['tcp:8080'],
  lines: [15, 20],
  edges: [
    {
      consumer: 'component:default/agent',
      api: 'api:default/server-api',
      providers: ['component:default/server'],
      via: 'consumesApi',
      src: ['tag:agent'],
      dst: ['tag:server'],
      ports: ['tcp:8080'],
    },
    {
      consumer: 'api:default/server-api',
      api: 'api:default/server-api',
      providers: ['component:default/server'],
      via: 'tailnet-allow',
      src: ['group:admins'],
      dst: ['tag:server'],
      ports: ['tcp:8080'],
    },
  ],
};

const overview: Overview = {
  renderedAt: new Date().toISOString(),
  orphans: [],
  publish: {
    'tailscale:default/tailnet': {
      repo: 'o/r',
      path: 'policy.hujson',
      flow: 'pullRequest',
      pullRequestBranch: 'backstage/tailscale',
      last: {
        at: new Date().toISOString(),
        outcome: 'opened',
        url: 'https://github.com/o/r/pull/1',
      },
    },
  },
  policies: [
    {
      entityRef: 'tailscale:default/tailnet',
      name: 'tailnet',
      title: 'Example tailnet',
      tailnet: 'example.ts.net',
      owner: 'group:ops',
      renderedAt: new Date().toISOString(),
      text,
      spans: [
        {
          entityRef: 'group:default/tailnet-admins',
          section: 'groups',
          lines: [3, 5],
        },
        {
          entityRef: 'tailscale:default/grant-admins',
          section: 'grants',
          lines: [9, 14],
        },
      ],
      parts: [
        {
          entityRef: 'tailscale:default/grant-admins',
          type: 'grant',
          name: 'grant-admins',
          title: 'Admins use the web UI',
          lines: [[9, 14]],
        },
        {
          entityRef: 'tailscale:default/tailnet',
          type: 'policy',
          name: 'tailnet',
          lines: [],
        },
      ],
      groups: [
        {
          name: 'group:admins',
          entityRef: 'group:default/tailnet-admins',
          title: 'Tailnet admins',
          members: [
            {
              entityRef: 'user:default/ada',
              login: 'ada@github',
              title: 'Ada',
            },
          ],
          usage: 2,
          lines: [4, 6],
        },
      ],
      hosts: [{ name: 'nas', address: '100.64.0.1' }],
      tags: [
        {
          id: 'tailscale:default/tag-server',
          entityRef: 'tailscale:default/tag-server',
          title: 'Servers',
          tag: 'tag:server',
          owners: [admins],
          appliesTo: ['resource:default/box'],
          usage: 2,
        },
      ],
      grants: [declared, fromCatalog],
      ssh: [
        {
          id: 'tailscale:default/ssh-admins',
          entityRef: 'tailscale:default/ssh-admins',
          title: 'Admins are root in check mode',
          action: 'check',
          checkPeriod: '8h',
          src: [admins],
          dst: [server],
          users: ['root'],
        },
      ],
      nodeAttrs: [],
      autoApprovers: [
        {
          id: 'tailscale:default/approve-web#service/svc:web',
          entityRef: 'tailscale:default/approve-web',
          title: 'The server serves svc:web',
          kind: 'service',
          target: 'svc:web',
          approvers: [server],
        },
      ],
      tests: [
        {
          id: 'tailscale:default/test-reach#tests/0',
          entityRef: 'tailscale:default/test-reach',
          title: 'Ada reaches the NAS',
          kind: 'acl',
          src: p('ada@github', 'user'),
          proto: 'tcp',
          accept: ['nas:443'],
          deny: ['nas:22'],
          check: [],
        },
      ],
      settings: [],
      catalog: {
        enabled: true,
        covered: [],
        local: [],
        missingSource: [],
        invalid: [],
      },
      destinations: [
        {
          name: 'svc:web',
          class: 'service',
          grants: [declared.id],
          serves: [],
        },
        {
          name: 'tag:server',
          class: 'device',
          entityRef: 'tailscale:default/tag-server',
          grants: [fromCatalog.id],
          serves: ['svc:web'],
        },
      ],
      diagnostics: [
        {
          severity: 'error',
          message: 'tag:nope is not declared',
          entityRef: 'tailscale:default/grant-admins',
        },
      ],
    },
  ],
};

const access: EntityAccess = {
  policy: {
    entityRef: 'tailscale:default/tailnet',
    name: 'tailnet',
    tailnet: 'example.ts.net',
  },
  identities: [
    {
      name: 'tag:server',
      source: true,
      destination: true,
      via: 'carries tag:server',
    },
  ],
  outbound: [],
  inbound: [fromCatalog],
  sshInto: overview.policies[0].ssh,
  sshFrom: [],
  tags: overview.policies[0].tags,
  owns: [],
  nodeAttrs: [],
  approvals: overview.policies[0].autoApprovers,
  tests: [],
  appliesTo: ['tailscale:default/tag-server'],
};

const api = {
  getOverview: jest.fn(async () => overview),
  getAccess: jest.fn(async (): Promise<EntityAccess[]> => [access]),
};

const render = (element: JSX.Element, route = '/') =>
  renderInTestApp(
    <TestApiProvider apis={[[tailscaleApiRef, api]]}>
      {element}
    </TestApiProvider>,
    {
      initialRouteEntries: [route],
      mountedRoutes: {
        '/catalog/:namespace/:kind/:name': entityRouteRef,
        '/tailscale': rootRouteRef,
      },
    },
  );

describe('PolicyConsole', () => {
  it('opens on the overview: stats, the access map and what needs fixing', async () => {
    await render(<PolicyConsole overview={overview} />);
    expect(
      screen.getByRole('heading', { name: 'Example tailnet' }),
    ).toBeInTheDocument();
    expect(screen.getByText('example.ts.net')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Pull request in o/r' }),
    ).toHaveAttribute('href', 'https://github.com/o/r/pull/1');
    expect(screen.getByRole('img', { name: /Access map/ })).toBeInTheDocument();
    expect(screen.getByText('tag:nope is not declared')).toBeInTheDocument();
    expect(
      screen.getByText('1 grant from 1 API consumption and 1 tailnet-allow'),
    ).toBeInTheDocument();
  });

  it('says where the file is pushed, or why it is not published', async () => {
    const pushed: Overview = {
      ...overview,
      publish: {
        'tailscale:default/tailnet': {
          ...overview.publish['tailscale:default/tailnet'],
          flow: 'push',
          last: {
            at: new Date().toISOString(),
            outcome: 'pushed',
            url: 'https://github.com/o/r/commit/abc',
          },
        },
      },
    };
    const { unmount } = await render(<PolicyConsole overview={pushed} />);
    expect(screen.getByRole('link', { name: 'Pushes to o/r' })).toHaveAttribute(
      'href',
      'https://github.com/o/r/commit/abc',
    );
    unmount();
    const refused: Overview = {
      ...overview,
      publish: {
        'tailscale:default/tailnet': {
          ...overview.publish['tailscale:default/tailnet'],
          problem: "o/r is not in Backstage's tailscale.allowedRepos",
        },
      },
    };
    await render(<PolicyConsole overview={refused} />);
    expect(
      screen.getByText(
        /Not published: o\/r is not in Backstage's tailscale.allowedRepos/,
      ),
    ).toBeInTheDocument();
  });

  it('lists the grants, filters them, and tells declared from catalog ones', async () => {
    await render(
      <PolicyConsole overview={overview} />,
      '/tailscale?section=grants',
    );
    const grants = screen.getAllByTestId('grant');
    expect(grants).toHaveLength(2);
    expect(within(grants[1]).getByText('From the catalog')).toBeInTheDocument();
    // The selector links to its Backstage Group.
    expect(
      screen.getAllByRole('link', { name: /group:admins/ })[0],
    ).toHaveAttribute('href', '/catalog/default/group/tailnet-admins');
    // ...the grant to its entity and its lines in the file.
    expect(screen.getByRole('link', { name: 'grant-admins' })).toHaveAttribute(
      'href',
      '/catalog/default/tailscale/grant-admins',
    );
    expect(screen.getByRole('link', { name: 'L9–14' })).toHaveAttribute(
      'href',
      '/tailscale?section=file&policy=tailnet&lines=9-14',
    );

    expect(within(grants[1]).getByText('allows')).toBeInTheDocument();
    expect(within(grants[1]).getByText('consumes')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter'), {
      target: { value: 'tcp:8080' },
    });
    expect(screen.getAllByTestId('grant')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Filter'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('Origin'), {
      target: { value: 'entity' },
    });
    const [only] = screen.getAllByTestId('grant');
    expect(screen.getAllByTestId('grant')).toHaveLength(1);
    expect(
      within(only).queryByText('From the catalog'),
    ).not.toBeInTheDocument();
  });

  it('shows SSH rules, groups, tags and tests', async () => {
    const { unmount } = await render(
      <PolicyConsole overview={overview} />,
      '/tailscale?section=ssh',
    );
    expect(screen.getByText('Check · 8h')).toBeInTheDocument();
    unmount();
    await render(
      <PolicyConsole overview={overview} />,
      '/tailscale?section=groups',
    );
    expect(screen.getByText('ada@github')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tags/ }));
    expect(
      within(screen.getByTestId('tag')).getByText('Servers'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Tests/ }));
    expect(screen.getByText('can reach')).toBeInTheDocument();
    expect(screen.getByText('nas:22')).toBeInTheDocument();
  });

  it('previews what someone can reach, through their groups', async () => {
    await render(
      <PolicyConsole overview={overview} />,
      '/tailscale?section=preview&who=ada@github',
    );
    expect(screen.getByText('1 of 2 network grants apply')).toBeInTheDocument();
    expect(screen.getByText('Admins use the web UI')).toBeInTheDocument();
    expect(screen.getByText('1 rules apply')).toBeInTheDocument();
  });

  it('shows the file, and the lines an entity renders to', async () => {
    await render(
      <PolicyConsole overview={overview} />,
      '/tailscale?section=file&focus=tailscale:default/grant-admins',
    );
    const highlighted = document.querySelectorAll('.ts-code-line-on');
    expect([...highlighted].map(l => l.getAttribute('data-line'))).toEqual([
      '9',
      '10',
      '11',
      '12',
      '13',
      '14',
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Clear selection/ }));
    expect(document.querySelectorAll('.ts-code-line-on')).toHaveLength(0);
  });
});

describe('capabilities and destination classes', () => {
  const idp: GrantRule = {
    id: 'tailscale:default/grant-idp',
    entityRef: 'tailscale:default/grant-idp',
    title: 'Admins administer the IdP',
    origin: 'entity',
    src: [admins],
    dst: [server],
    ip: ['tcp:443'],
    app: { 'tailscale.com/cap/tsidp': [{ allow_admin_ui: true }] },
  };
  const withCaps: Overview = {
    ...overview,
    policies: [
      {
        ...overview.policies[0],
        grants: [declared, fromCatalog, idp],
        destinations: [
          {
            name: 'svc:web',
            class: 'service',
            grants: [declared.id],
            serves: [],
          },
          {
            name: 'tag:server',
            class: 'capability',
            grants: [fromCatalog.id, idp.id],
            serves: [],
          },
        ],
      },
    ],
  };

  it('draws capability grants as a layer of their own, destinations by class', async () => {
    await render(<PolicyConsole overview={withCaps} />);
    const map = screen.getByRole('img', { name: /Access map/ });
    expect(map.querySelectorAll('[data-layer="capability"]')).toHaveLength(1);
    expect(map.querySelectorAll('[data-layer="network"]')).toHaveLength(2);
    expect(within(map).getByText('tsidp')).toBeInTheDocument();
    expect(within(map).getByText('Services')).toBeInTheDocument();
    expect(within(map).getByText('Capability targets')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Capabilities \(app grants\)/));
    expect(map.querySelectorAll('[data-layer="capability"]')).toHaveLength(0);
  });

  it('keeps capability grants out of what someone can reach', async () => {
    await render(
      <PolicyConsole overview={withCaps} />,
      '/tailscale?section=preview&who=ada@github',
    );
    expect(screen.getByText('1 of 2 network grants apply')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Capabilities' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Admins administer the IdP')).toBeInTheDocument();
  });

  it("says how a tag is reached, and when its entity doesn't say why", async () => {
    await render(
      <PolicyConsole overview={overview} />,
      '/tailscale?section=tags',
    );
    expect(screen.getByText(/its entity doesn't say why/)).toBeInTheDocument();
  });
});

describe('entity cards', () => {
  const withEntity = (entity: Entity, element: JSX.Element) => (
    <EntityProvider entity={entity}>{element}</EntityProvider>
  );

  it('shows a catalog entity how it is on the tailnet', async () => {
    await render(
      withEntity(
        {
          apiVersion: 'backstage.io/v1alpha1',
          kind: 'Resource',
          metadata: { name: 'box', namespace: 'default' },
        },
        <EntityTailscaleCard />,
      ),
    );
    expect(api.getAccess).toHaveBeenCalledWith('resource:default/box');
    expect(await screen.findByText('Reached by · 1')).toBeInTheDocument();
    expect(screen.getByText('SSH into it')).toBeInTheDocument();
    expect(screen.getByText('may serve')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'tag-server' }),
    ).toBeInTheDocument();
  });

  it('renders nothing for an entity off the tailnet', async () => {
    api.getAccess.mockResolvedValueOnce([]);
    await render(
      withEntity(
        {
          apiVersion: 'backstage.io/v1alpha1',
          kind: 'Component',
          metadata: { name: 'x', namespace: 'default' },
        },
        <div data-testid="slot">
          <EntityTailscaleCard />
        </div>,
      ),
    );
    await screen.findByTestId('slot');
    await new Promise(r => setTimeout(r, 0));
    expect(screen.getByTestId('slot')).toBeEmptyDOMElement();
  });

  it('shows a Tailscale entity its rule and its lines in the file', async () => {
    await render(
      withEntity(
        {
          apiVersion: 'specht-labs.de/v1alpha1',
          kind: 'Tailscale',
          metadata: { name: 'grant-admins', namespace: 'default' },
          spec: { type: 'grant' },
        },
        <TailscaleEntityCard />,
      ),
    );
    expect(await screen.findByText('Tailscale grant')).toBeInTheDocument();
    expect(screen.getByText('tag:nope is not declared')).toBeInTheDocument();
    const code = screen.getByRole('region', {
      name: 'What grant-admins renders to',
    });
    expect(within(code).getByText('"svc:web"')).toBeInTheDocument();
    expect(within(code).queryByText('"tag:agent"')).not.toBeInTheDocument();
  });
});

describe('tokenize', () => {
  it('colours keys, selectors and comments', () => {
    expect(tokenize('\t"src": ["group:admins", "*"], // why')).toEqual([
      { text: '\t' },
      { text: '"src"', className: 'ts-t-key' },
      { text: ':', className: 'ts-t-punct' },
      { text: ' ' },
      { text: '[', className: 'ts-t-punct' },
      { text: '"group:admins"', className: 'ts-t-group' },
      { text: ',', className: 'ts-t-punct' },
      { text: ' ' },
      { text: '"*"', className: 'ts-t-any' },
      { text: ']', className: 'ts-t-punct' },
      { text: ',', className: 'ts-t-punct' },
      { text: ' ' },
      { text: '// why', className: 'ts-t-comment' },
    ]);
  });
});
