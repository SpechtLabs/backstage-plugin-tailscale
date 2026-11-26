/**
 * The Tailscale backend plugin: renders tailnet policies from the catalog,
 * serves them under /api/tailscale, and publishes them to GitHub.
 *
 * @packageDocumentation
 */
export { tailscalePlugin as default } from './plugin';
export { compileAll } from './compile';
export { accessFor } from './access';
export { diffPolicies, relate, servicePorts } from './policyDiff';
export type { SectionDiff } from './policyDiff';
