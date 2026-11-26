import {
  getCompoundEntityRef,
  parseEntityRef,
  RELATION_HAS_PART,
  RELATION_OWNED_BY,
  RELATION_OWNER_OF,
  RELATION_PART_OF,
  type CompoundEntityRef,
} from '@backstage/catalog-model';
import {
  RELATION_APPLIED_BY,
  RELATION_APPLIES_TO,
  RELATION_HAS_POLICY_PART,
  RELATION_PART_OF_POLICY,
  TAILSCALE_KIND,
  type TailscaleEntity,
} from './model';

/** A relation between two entities, as the catalog stores it. */
export interface TailscaleRelation {
  source: CompoundEntityRef;
  type: string;
  target: CompoundEntityRef;
}

/**
 * The relations a Tailscale entity has, both ways: to its owner, its
 * system, its policy (partOfPolicy / hasPolicyPart) and the entities it
 * applies to (appliesTo / tailscaleAppliedBy). The catalog module emits
 * these; tooling that reads entities from files can add them itself.
 */
export function tailscaleRelations(
  entity: TailscaleEntity,
): TailscaleRelation[] {
  const self = getCompoundEntityRef(entity);
  const ref = (value: string, defaultKind: string) =>
    parseEntityRef(value, { defaultKind, defaultNamespace: self.namespace });
  const out: TailscaleRelation[] = [];
  const pair = (
    target: CompoundEntityRef,
    forward: string,
    backward: string,
  ) => {
    out.push({ source: self, type: forward, target });
    out.push({ source: target, type: backward, target: self });
  };
  const { spec } = entity;
  pair(ref(spec.owner, 'Group'), RELATION_OWNED_BY, RELATION_OWNER_OF);
  if (spec.system) {
    pair(ref(spec.system, 'System'), RELATION_PART_OF, RELATION_HAS_PART);
  }
  if (spec.target) {
    pair(
      ref(spec.target, TAILSCALE_KIND),
      RELATION_PART_OF_POLICY,
      RELATION_HAS_POLICY_PART,
    );
  }
  for (const target of spec.appliesTo ?? []) {
    pair(ref(target, 'Component'), RELATION_APPLIES_TO, RELATION_APPLIED_BY);
  }
  return out;
}
