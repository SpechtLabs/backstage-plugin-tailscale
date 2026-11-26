/* eslint-disable no-console */
/**
 * backstage-tailscale-diff: renders a tailnet policy from local catalog files,
 * the way Backstage would, and compares it with a policy file, so a change
 * can be checked before it is pushed.
 *
 *   backstage-tailscale-diff [--policy <name>] [--out <file>] [--json <file>] \
 *     <policy.hujson> <catalog dir>...
 *
 * --out writes the rendered policy file, --json what Backstage's
 * /api/tailscale/overview would serve.
 *
 * Every catalog dir is read in full (git's tracked and untracked files,
 * ignored ones skipped): each YAML document with a backstage.io or
 * specht-labs.de apiVersion is an entity. The relations the catalog adds are
 * rebuilt from the specs. Exits 1 when the files differ or the policy has
 * errors, 2 on bad arguments.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { stringifyEntityRef, type Entity } from '@backstage/catalog-model';
import { parse, type ParseError } from 'jsonc-parser';
import yaml from 'yaml';
import { compileAll } from './compile';
import { diffPolicies, relate, servicePorts } from './policyDiff';

const ENTITY = /^apiVersion:\s*(backstage\.io|specht-labs\.de)\//m;

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(
    'usage: backstage-tailscale-diff [--policy <name>] [--out <file>] [--json <file>] <policy.hujson> <catalog dir>...',
  );
  process.exit(2);
}

function filesIn(dir: string): string[] {
  const listed = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return listed
    .split('\n')
    .filter(f => /\.ya?ml$/.test(f))
    .map(f => path.join(dir, f))
    .filter(f => fs.existsSync(f));
}

function load(dirs: string[]): Entity[] {
  const entities = new Map<string, Entity>();
  for (const dir of dirs) {
    for (const file of filesIn(dir)) {
      const text = fs.readFileSync(file, 'utf8');
      if (!ENTITY.test(text)) continue;
      for (const doc of yaml.parseAllDocuments(text)) {
        if (doc.errors.length) {
          console.warn(
            `skipped a document in ${file}: ${doc.errors[0].message}`,
          );
          continue;
        }
        const entity = doc.toJS() as Entity;
        if (!entity?.kind || !entity.metadata?.name) continue;
        if (!/^(backstage\.io|specht-labs\.de)\//.test(entity.apiVersion ?? ''))
          continue;
        if (entity.kind === 'Location') continue;
        entity.metadata.namespace ??= 'default';
        entity.relations = [];
        const ref = stringifyEntityRef(entity);
        if (entities.has(ref)) {
          console.warn(`${ref} is defined twice; keeping the first (${file})`);
          continue;
        }
        entities.set(ref, entity);
      }
    }
  }
  return [...entities.values()];
}

function readPolicy(file: string) {
  const errors: ParseError[] = [];
  const policy = parse(fs.readFileSync(file, 'utf8'), errors, {
    allowTrailingComma: true,
  });
  if (errors.length) usage(`${file} doesn't parse as HuJSON`);
  return policy;
}

async function main() {
  const args = process.argv.slice(2);
  // yarn workspace runs scripts in the package's directory.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const at = (p: string) => path.resolve(cwd, p);
  let name: string | undefined;
  let out: string | undefined;
  let json: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--policy') name = args[++i];
    else if (args[i] === '--out') out = at(args[++i]);
    else if (args[i] === '--json') json = at(args[++i]);
    else if (args[i] === '--help' || args[i] === '-h') usage();
    else positional.push(at(args[i]));
  }
  const [appliedFile, ...dirs] = positional;
  if (!appliedFile || !dirs.length) usage();
  for (const p of [appliedFile, ...dirs]) {
    if (!fs.existsSync(p)) usage(`${p} doesn't exist`);
  }
  const notDirs = dirs.filter(d => !fs.statSync(d).isDirectory());
  if (notDirs.length) usage(`not a directory: ${notDirs.join(', ')}`);

  const entities = load(dirs);
  relate(entities);
  const overview = compileAll(entities);
  const policy = name
    ? overview.policies.find(p => p.name === name)
    : overview.policies[0];
  if (!policy) {
    usage(
      `no policy ${name ?? ''} among ${
        overview.policies.map(p => p.name).join(', ') || 'none'
      }`,
    );
  }
  if (out) fs.writeFileSync(out, policy.text);
  if (json) fs.writeFileSync(json, JSON.stringify(overview, null, 2));

  console.log(
    `${policy.title ?? policy.name}: ${entities.length} entities, ${
      policy.parts.length
    } parts, ${policy.text.split('\n').length - 1} lines${
      out ? ` -> ${out}` : ''
    }`,
  );
  const label: Record<string, string> = {
    service: 'Services',
    mesh: 'peer meshes',
    capability: 'capability targets',
    autogroup: 'autogroups',
    device: 'devices',
    any: 'everything',
  };
  for (const cls of Object.keys(label)) {
    const names = policy.destinations
      .filter(d => d.class === cls)
      .map(d => (d.reason ? `${d.name} (${d.reason})` : d.name));
    if (names.length) console.log(`  ${label[cls]}: ${names.join(', ')}`);
  }
  const problems = [...overview.orphans, ...policy.diagnostics];
  for (const d of problems) {
    console.log(
      `  ${d.severity}: ${d.entityRef ? `${d.entityRef}: ` : ''}${d.message}`,
    );
  }

  const diff = diffPolicies(
    readPolicy(appliedFile),
    parse(policy.text, [], { allowTrailingComma: true }),
    servicePorts(entities),
  );
  let differences = 0;
  for (const section of diff) {
    const n = section.onlyApplied.length + section.onlyRendered.length;
    differences += n;
    if (!n) continue;
    console.log(`\n${section.section}:`);
    for (const x of section.onlyApplied)
      console.log(`  - ${x}   (only in ${path.basename(appliedFile)})`);
    for (const x of section.onlyRendered)
      console.log(`  + ${x}   (only rendered)`);
  }
  console.log(
    differences
      ? `\n${differences} differences`
      : `\nNo differences: the rendered policy allows what ${path.basename(
          appliedFile,
        )} allows.`,
  );
  const errors = problems.filter(d => d.severity === 'error').length;
  process.exit(differences || errors ? 1 : 0);
}

main().catch(error => {
  console.error(error);
  process.exit(2);
});
