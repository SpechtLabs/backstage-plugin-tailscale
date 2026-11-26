import { parseEntityRef } from '@backstage/catalog-model';
import type { PolicyView } from '@spechtlabs/backstage-plugin-tailscale-common';
import { shortRef } from './compile';

/** The policy's sections and how many entries each has. */
export function sectionCounts(policy: PolicyView) {
  const tests = policy.tests.filter(t => t.kind === 'acl').length;
  return [
    ['Groups', policy.groups.length],
    ['Hosts', policy.hosts.length],
    ['Tags', policy.tags.length],
    ['Node attributes', policy.nodeAttrs.length],
    ['Auto approvers', policy.autoApprovers.length],
    ['SSH rules', policy.ssh.length],
    ['Grants', policy.grants.length],
    ['Tests', tests],
    ['SSH tests', policy.tests.length - tests],
  ] as const;
}

export function pullRequestTitle(policy: PolicyView) {
  const grants = policy.grants.length;
  return `feat(tailscale): render ${
    policy.tailnet ?? policy.name
  } (${grants} grants, ${policy.ssh.length} SSH rules, ${
    policy.tests.length
  } tests)`;
}

/** The pull request's description: what is in the file, and from where. */
export function pullRequestBody(policy: PolicyView, baseUrl?: string) {
  const link = (ref: string) => {
    const { kind, namespace, name } = parseEntityRef(ref);
    const text = `\`${shortRef(ref)}\``;
    return baseUrl
      ? `[${text}](${baseUrl}/catalog/${namespace}/${kind.toLowerCase()}/${name})`
      : text;
  };
  const errors = policy.diagnostics.filter(d => d.severity === 'error');
  const warnings = policy.diagnostics.filter(d => d.severity === 'warning');
  const lines = [
    `The tailnet policy for **${policy.title ?? policy.name}**${
      policy.tailnet ? ` (\`${policy.tailnet}\`)` : ''
    }, as Backstage renders it from ${link(policy.entityRef)} and its ${
      policy.parts.length - 1
    } parts.`,
    '',
    '| Section | Entries |',
    '|---|---:|',
    ...sectionCounts(policy).map(([name, count]) => `| ${name} | ${count} |`),
    '',
  ];
  const catalogGrants = policy.grants.filter(g => g.origin === 'catalog');
  if (catalogGrants.length) {
    lines.push(
      `${catalogGrants.length} grants come from Components that consume an API across the tailnet; ${policy.catalog.covered.length} more consumptions are already allowed by a grant entity.`,
      '',
    );
  }
  if (errors.length || warnings.length) {
    lines.push('### Problems', '');
    for (const d of [...errors, ...warnings]) {
      lines.push(
        `- ${d.severity === 'error' ? '**Error**' : 'Warning'}: ${
          d.entityRef ? `${link(d.entityRef)}: ` : ''
        }${d.message}`,
      );
    }
    lines.push('');
  }
  lines.push(
    'Change the entities in the catalog, not this file: Backstage keeps this pull request up to date.',
  );
  return lines.join('\n');
}
