import type { LoggerService } from '@backstage/backend-plugin-api';
import { publishPolicy, type PublishTarget } from './publish';

/**
 * A small in-memory GitHub: refs, commits with their files, pull requests.
 * Like the real one, it closes a pull request when its head branch is moved
 * to the base branch's commit (no commits left to merge).
 */
function fakeGitHub() {
  let id = 0;
  const files = new Map<string, Record<string, string>>([['c0', {}]]);
  const trees = new Map<string, Record<string, string>>([['t-c0', {}]]);
  const refs = new Map<string, string>([['main', 'c0']]);
  const pulls: Array<{
    number: number;
    head: string;
    state: string;
    title: string;
    body: string;
  }> = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const setRef = (branch: string, sha: string) => {
    refs.set(branch, sha);
    for (const pr of pulls) {
      if (
        pr.head === branch &&
        pr.state === 'open' &&
        sha === refs.get('main')
      ) {
        pr.state = 'closed';
      }
    }
  };

  const fetch = async (url: string, init: RequestInit = {}) => {
    const { pathname, searchParams } = new URL(url);
    const path = pathname.replace('/repos/o/r', '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    // The route's captured parameter, if the method and path match.
    const route = (verb: string, pattern: RegExp) =>
      method === verb ? path.match(pattern)?.[1] : undefined;

    if (method === 'GET' && path === '')
      return json({ default_branch: 'main' });
    if (method === 'GET' && path === '/pulls') {
      const head = searchParams.get('head')!.split(':')[1];
      return json(
        pulls
          .filter(p => p.head === head && p.state === 'open')
          .map(p => ({
            number: p.number,
            html_url: `https://github.com/o/r/pull/${p.number}`,
          })),
      );
    }
    const p1 = route('GET', /^\/contents\/(.+)$/);
    if (p1 !== undefined) {
      const sha = refs.get(searchParams.get('ref')!);
      const text = sha && files.get(sha)?.[p1];
      if (text === undefined || text === '')
        return json({ message: 'Not Found' }, 404);
      return json({
        sha: `blob-${text.length}`,
        content: Buffer.from(text).toString('base64'),
      });
    }
    const p2 = route('GET', /^\/git\/ref\/heads\/(.+)$/);
    if (p2 !== undefined) {
      return json({ object: { sha: refs.get(p2) } });
    }
    const p3 = route('GET', /^\/git\/commits\/(.+)$/);
    if (p3 !== undefined) {
      return json({ tree: { sha: `t-${p3}` } });
    }
    if (method === 'POST' && path === '/git/trees') {
      const tree = `t${++id}`;
      const next = { ...trees.get(body.base_tree) };
      for (const entry of body.tree) next[entry.path] = entry.content;
      trees.set(tree, next);
      return json({ sha: tree }, 201);
    }
    if (method === 'POST' && path === '/git/commits') {
      const commit = `c${++id}`;
      files.set(commit, trees.get(body.tree)!);
      trees.set(`t-${commit}`, trees.get(body.tree)!);
      return json({ sha: commit }, 201);
    }
    const p4 = route('PATCH', /^\/git\/refs\/heads\/(.+)$/);
    if (p4 !== undefined) {
      if (!refs.has(p4))
        return json({ message: 'Reference does not exist' }, 422);
      setRef(p4, body.sha);
      return json({});
    }
    if (method === 'POST' && path === '/git/refs') {
      setRef(body.ref.replace('refs/heads/', ''), body.sha);
      return json({}, 201);
    }
    if (method === 'POST' && path === '/pulls') {
      const pr = {
        number: pulls.length + 1,
        head: body.head,
        state: 'open',
        title: body.title,
        body: body.body,
      };
      pulls.push(pr);
      return json(
        { html_url: `https://github.com/o/r/pull/${pr.number}` },
        201,
      );
    }
    const p5 = route('PATCH', /^\/pulls\/(\d+)$/);
    if (p5 !== undefined) {
      Object.assign(pulls[Number(p5) - 1], body);
      return json({});
    }
    throw new Error(`unexpected ${method} ${pathname}`);
  };
  return { fetch, refs, files, pulls };
}

describe('publishPolicy', () => {
  const target: PublishTarget = {
    repo: 'o/r',
    path: 'tailscale/policy.hujson',
    flow: 'pullRequest',
    pullRequestBranch: 'backstage/tailscale',
  };
  const credentials = {
    getCredentials: async () => ({
      token: 't',
      headers: {},
      type: 'app' as const,
    }),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  } as unknown as LoggerService;
  const publish = (text: string, to: PublishTarget = target) =>
    publishPolicy(
      credentials,
      to,
      { policyText: text, title: 'title', body: `body ${text}` },
      logger,
    );

  let github: ReturnType<typeof fakeGitHub>;
  beforeEach(() => {
    github = fakeGitHub();
    jest.spyOn(global, 'fetch').mockImplementation(github.fetch as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('opens one pull request and keeps it open across changes', async () => {
    await expect(publish('v1')).resolves.toEqual({
      outcome: 'opened',
      url: 'https://github.com/o/r/pull/1',
    });
    await expect(publish('v2')).resolves.toEqual({
      outcome: 'updated',
      url: 'https://github.com/o/r/pull/1',
    });
    await expect(publish('v2')).resolves.toEqual({
      outcome: 'updated',
      url: 'https://github.com/o/r/pull/1',
    });

    expect(github.pulls.map(p => [p.number, p.state, p.body])).toEqual([
      [1, 'open', 'body v2'],
    ]);
    const head = github.refs.get(target.pullRequestBranch)!;
    expect(github.files.get(head)![target.path]).toBe('v2');
  });

  it('pushes straight to the branch with flow push', async () => {
    const push: PublishTarget = { ...target, flow: 'push' };
    const pushed = await publish('v1', push);
    expect(pushed).toMatchObject({ outcome: 'pushed' });
    const main = github.refs.get('main')!;
    expect(github.files.get(main)![target.path]).toBe('v1');
    expect(github.pulls).toEqual([]);
    await expect(publish('v1', push)).resolves.toEqual({
      outcome: 'up-to-date',
    });
    expect(github.refs.get('main')).toBe(main);
  });

  it('closes the pull request once the base branch has the policy', async () => {
    await publish('v1');
    github.files.set('c0', { [target.path]: 'v1' });
    await expect(publish('v1')).resolves.toEqual({ outcome: 'up-to-date' });
    expect(github.pulls[0].state).toBe('closed');
  });
});
