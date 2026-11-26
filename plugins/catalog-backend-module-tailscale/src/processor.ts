import { createBackendModule } from '@backstage/backend-plugin-api';
import type { Entity } from '@backstage/catalog-model';
import {
  catalogProcessingExtensionPoint,
  processingResult,
  type CatalogProcessor,
  type CatalogProcessorEmit,
  type LocationSpec,
} from '@backstage/plugin-catalog-node';
import {
  isTailscale,
  tailscaleRelations,
  validateTailscaleSpec,
} from '@spechtlabs/backstage-plugin-tailscale-common';

/** Validates Tailscale entities and relates them to what they name. */
export class TailscaleEntityProcessor implements CatalogProcessor {
  getProcessorName() {
    return 'TailscaleEntityProcessor';
  }

  async validateEntityKind(entity: Entity): Promise<boolean> {
    if (!isTailscale(entity)) return false;
    const errors = validateTailscaleSpec(entity.spec);
    if (errors.length) {
      throw new Error(
        `Invalid Tailscale ${String(
          entity.spec?.type ?? 'entity',
        )}: ${errors.join('; ')}`,
      );
    }
    return true;
  }

  async postProcessEntity(
    entity: Entity,
    _location: LocationSpec,
    emit: CatalogProcessorEmit,
  ): Promise<Entity> {
    if (!isTailscale(entity)) return entity;
    for (const relation of tailscaleRelations(entity)) {
      emit(processingResult.relation(relation));
    }
    return entity;
  }
}

/**
 * Registers kind: Tailscale with the catalog: validation, and the relations
 * to each entity's policy, owner, system and the entities it applies to.
 *
 * @public
 */
export const catalogModuleTailscale = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'tailscale-kind',
  register(reg) {
    reg.registerInit({
      deps: { catalog: catalogProcessingExtensionPoint },
      async init({ catalog }) {
        catalog.addProcessor(new TailscaleEntityProcessor());
      },
    });
  },
});
