import type { LoggerService } from '@backstage/backend-plugin-api';
import type { GithubCredentialsProvider } from '@backstage/integration';

export interface PublishTarget {
  /** owner/name of the repository. */
  repo: string;
  /** Path of the policy file in it. */
  path: string;
  /** pullRequest: one pull request kept open; push: commit to the branch. */
  flow: 'pullRequest' | 'push';
  /** The branch the file lands on; the repository's default if unset. */
  branch?: string;
  /** pullRequest: the branch Backstage owns and force-pushes. */
  pullRequestBranch: string;
}

export interface PublishInput {
  policyText: string;
  title: string;
  body: string;
}

export type PublishResult =
  | { outcome: 'up-to-date' }
  | { outcome: 'opened' | 'updated' | 'pushed'; url: string };

const API = 'https://api.github.com';
// GitHub's limit on a pull request body.
const MAX_BODY = 65000;

class GitHubError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Puts the rendered policy at target.path. With flow pullRequest, one pull
 * request is kept open: its branch always holds a single commit on top of
 * the base branch, so it shows exactly what the catalog would change, and it
 * is closed once the base branch has the file. With flow push, the file is
 * committed to the branch directly.
 */
export async function publishPolicy(
  credentials: GithubCredentialsProvider,
  target: PublishTarget,
  input: PublishInput,
  logger: LoggerService,
): Promise<PublishResult> {
  const { token } = await credentials.getCredentials({
    url: `https://github.com/${target.repo}`,
  });
  if (!token) throw new Error(`No GitHub token for ${target.repo}`);
  const repoPath = `/repos/${target.repo}`;

  const gh = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    if (!response.ok) {
      throw new GitHubError(
        response.status,
        `GitHub ${init.method ?? 'GET'} ${path}: ${
          response.status
        } ${await response.text()}`,
      );
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  };
  const getFile = async (ref: string) => {
    try {
      const file = await gh<{ sha: string; content: string }>(
        `${repoPath}/contents/${target.path}?ref=${encodeURIComponent(ref)}`,
      );
      return Buffer.from(file.content, 'base64').toString('utf8');
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404)
        return undefined;
      throw error;
    }
  };
  /** A commit with the file on top of `branch`'s head. */
  const commitOnto = async (branch: string) => {
    const head = await gh<{ object: { sha: string } }>(
      `${repoPath}/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    const parent = await gh<{ tree: { sha: string } }>(
      `${repoPath}/git/commits/${head.object.sha}`,
    );
    const tree = await gh<{ sha: string }>(`${repoPath}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: parent.tree.sha,
        tree: [
          {
            path: target.path,
            mode: '100644',
            type: 'blob',
            content: input.policyText,
          },
        ],
      }),
    });
    return gh<{ sha: string }>(`${repoPath}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: `${input.title}\n\nRendered by Backstage from the Tailscale entities in its catalog.`,
        tree: tree.sha,
        parents: [head.object.sha],
      }),
    });
  };

  const repo = await gh<{ default_branch: string }>(repoPath);
  const base = target.branch ?? repo.default_branch;

  if (target.flow === 'push') {
    if ((await getFile(base)) === input.policyText) {
      return { outcome: 'up-to-date' };
    }
    const commit = await commitOnto(base);
    // Not forced: if someone pushed in between, this fails and the next
    // run tries again on top of their commit.
    await gh(`${repoPath}/git/refs/heads/${encodeURIComponent(base)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
    logger.info(`Pushed ${target.path} to ${target.repo}@${base}`);
    return {
      outcome: 'pushed',
      url: `https://github.com/${target.repo}/commit/${commit.sha}`,
    };
  }

  const owner = target.repo.split('/')[0];
  const [open] = await gh<Array<{ number: number; html_url: string }>>(
    `${repoPath}/pulls?state=open&head=${owner}:${encodeURIComponent(
      target.pullRequestBranch,
    )}`,
  );

  if ((await getFile(base)) === input.policyText) {
    if (open) {
      await gh(`${repoPath}/pulls/${open.number}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed' }),
      });
      logger.info(`Closed ${open.html_url}: ${base} already has the policy`);
    }
    return { outcome: 'up-to-date' };
  }

  if ((await getFile(target.pullRequestBranch)) !== input.policyText) {
    // One commit on top of the base branch, built first and then pointed
    // to in a single ref update. Resetting the branch to the base and then
    // committing would, for a moment, leave the pull request with no
    // commits, and GitHub closes it for good when that happens.
    const commit = await commitOnto(base);
    try {
      await gh(
        `${repoPath}/git/refs/heads/${encodeURIComponent(
          target.pullRequestBranch,
        )}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ sha: commit.sha, force: true }),
        },
      );
    } catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 422) throw error;
      await gh(`${repoPath}/git/refs`, {
        method: 'POST',
        body: JSON.stringify({
          ref: `refs/heads/${target.pullRequestBranch}`,
          sha: commit.sha,
        }),
      });
    }
  }

  const body =
    input.body.length > MAX_BODY
      ? `${input.body.slice(0, MAX_BODY)}\n\n…(truncated)`
      : input.body;
  if (open) {
    await gh(`${repoPath}/pulls/${open.number}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: input.title, body }),
    });
    return { outcome: 'updated', url: open.html_url };
  }
  const created = await gh<{ html_url: string }>(`${repoPath}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      head: target.pullRequestBranch,
      base,
      body,
    }),
  });
  return { outcome: 'opened', url: created.html_url };
}
