#!/usr/bin/env node
/*
 * Publishes every package whose version isn't on npm yet, dependencies
 * first. `yarn pack` makes the tarball: it replaces the workspace: ranges
 * between our packages with real versions and runs each package's prepack.
 * npm publishes it, through npm's trusted publishing in GitHub Actions (the
 * job's OIDC token, no npm token) and with provenance. Tags each release and
 * makes a GitHub release of it (with gh), its notes from the CHANGELOG.
 *
 *   node scripts/publish.mjs [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
// Provenance needs the OIDC token GitHub Actions provides.
const provenance = process.env.GITHUB_ACTIONS === 'true';
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });

const packages = readdirSync('plugins').map(dir => {
  const manifest = JSON.parse(
    readFileSync(join('plugins', dir, 'package.json'), 'utf8'),
  );
  return { dir: join('plugins', dir), ...manifest };
});
const ours = new Set(packages.map(p => p.name));
const dependsOn = p =>
  Object.keys({ ...p.dependencies, ...p.peerDependencies }).filter(d =>
    ours.has(d),
  );

// Dependencies first.
const order = [];
const visit = (p, seen = new Set()) => {
  if (order.includes(p) || seen.has(p.name)) return;
  seen.add(p.name);
  dependsOn(p).forEach(d =>
    visit(
      packages.find(x => x.name === d),
      seen,
    ),
  );
  order.push(p);
};
packages.filter(p => !p.private).forEach(p => visit(p));

/** This version's section of the package's CHANGELOG, and where it is. */
const notes = p => {
  const npm = `https://www.npmjs.com/package/${p.name}/v/${p.version}`;
  let section = '';
  try {
    const changelog = readFileSync(join(p.dir, 'CHANGELOG.md'), 'utf8');
    const start = changelog.indexOf(`## ${p.version}`);
    if (start >= 0) {
      const rest = changelog.slice(start + `## ${p.version}`.length);
      const end = rest.search(/\n## /);
      section = (end >= 0 ? rest.slice(0, end) : rest).trim();
    }
  } catch {
    // No changelog yet: the first release.
  }
  return `${section || 'First release.'}\n\n${npm}`;
};

const published = async (name, version) => {
  const res = await fetch(
    `https://registry.npmjs.org/${name.replace('/', '%2f')}/${version}`,
  );
  return res.ok;
};

for (const p of order) {
  if (await published(p.name, p.version)) {
    console.log(`${p.name}@${p.version} is on npm already`);
    continue;
  }
  console.log(`Publishing ${p.name}@${p.version}${dryRun ? ' (dry run)' : ''}`);
  const tarball = resolve(
    `${p.name.replace(/^@/, '').replace('/', '-')}-${p.version}.tgz`,
  );
  run('yarn', ['pack', '--out', tarball], { cwd: p.dir });
  const args = ['publish', tarball, '--access', 'public'];
  if (provenance) args.push('--provenance');
  if (dryRun) args.push('--dry-run');
  run('npm', args);
  rmSync(tarball);
  if (dryRun) continue;
  const tag = `${p.name}@${p.version}`;
  run('git', ['tag', tag]);
  run('git', ['push', 'origin', tag]);
  run('gh', ['release', 'create', tag, '--title', tag, '--notes', notes(p)]);
}
