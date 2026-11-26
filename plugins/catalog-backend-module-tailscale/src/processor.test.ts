import type { Entity } from '@backstage/catalog-model';
import { TailscaleEntityProcessor } from './processor';

const ts = (name: string, spec: Record<string, unknown>) =>
  ({
    apiVersion: 'specht-labs.de/v1alpha1',
    kind: 'Tailscale',
    metadata: { name, namespace: 'default' },
    spec: { target: 'tailscale:tailnet', owner: 'group:ops', ...spec },
  } as Entity);

describe('TailscaleEntityProcessor', () => {
  const processor = new TailscaleEntityProcessor();

  it('validates only its own kind', async () => {
    await expect(
      processor.validateEntityKind({
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'User',
        metadata: { name: 'ada' },
      }),
    ).resolves.toBe(false);
    await expect(
      processor.validateEntityKind(
        ts('tag-server', {
          type: 'tag',
          tag: 'tag:server',
          owners: ['group:admins'],
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      processor.validateEntityKind(ts('bad', { type: 'grant' })),
    ).rejects.toThrow('Invalid Tailscale grant: spec.src is required');
  });

  it('relates a part to its policy, owner and the entities it applies to', async () => {
    const emitted: any[] = [];
    await processor.postProcessEntity(
      ts('tag-server', {
        type: 'tag',
        tag: 'tag:server',
        owners: ['group:admins'],
        system: 'tailnet',
        appliesTo: ['resource:box'],
      }),
      { type: 'url', target: 'https://example.com/tags.yaml' },
      r => emitted.push(r),
    );
    expect(
      emitted.map(
        r =>
          `${r.relation.source.kind}:${r.relation.source.name} ${r.relation.type} ${r.relation.target.kind}:${r.relation.target.name}`,
      ),
    ).toEqual([
      'Tailscale:tag-server ownedBy group:ops',
      'group:ops ownerOf Tailscale:tag-server',
      'Tailscale:tag-server partOf System:tailnet',
      'System:tailnet hasPart Tailscale:tag-server',
      'Tailscale:tag-server partOfPolicy tailscale:tailnet',
      'tailscale:tailnet hasPolicyPart Tailscale:tag-server',
      'Tailscale:tag-server appliesTo resource:box',
      'resource:box tailscaleAppliedBy Tailscale:tag-server',
    ]);
  });
});
