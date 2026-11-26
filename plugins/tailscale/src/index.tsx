import {
  ApiBlueprint,
  PageBlueprint,
  createFrontendPlugin,
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/frontend-plugin-api';
import {
  EntityCardBlueprint,
  EntityContentBlueprint,
} from '@backstage/plugin-catalog-react/alpha';
import PolicyIcon from '@material-ui/icons/Policy';
import { TailscaleClient, tailscaleApiRef } from './api';
import { rootRouteRef } from './routes';

const isTailscale = (kind: string) => kind.toLowerCase() === 'tailscale';

/**
 * Tailscale policies from the catalog (the tailscale backend plugin):
 *
 *  - /tailscale, every policy section by section, its access map, a preview
 *    of who reaches what, and the rendered policy file;
 *  - a Policy tab on each policy entity, with the same;
 *  - on a Tailscale entity's page, the rule it is and the lines it renders
 *    to;
 *  - on Component, API, Resource, Group and User pages, how the entity is
 *    on the tailnet: what it reaches, who reaches it, SSH, tags.
 */
export const tailscalePlugin = createFrontendPlugin({
  pluginId: 'tailscale',
  routes: { root: rootRouteRef },
  extensions: [
    ApiBlueprint.make({
      params: defineParams =>
        defineParams({
          api: tailscaleApiRef,
          deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
          factory: deps => new TailscaleClient(deps),
        }),
    }),
    PageBlueprint.make({
      params: {
        path: '/tailscale',
        title: 'Tailscale',
        icon: <PolicyIcon />,
        routeRef: rootRouteRef,
        loader: () =>
          import('./components/PolicyConsole').then(m => <m.TailscalePage />),
      },
    }),
    EntityContentBlueprint.make({
      name: 'policy',
      params: {
        path: 'policy',
        title: 'Policy',
        filter: entity =>
          isTailscale(entity.kind) && entity.spec?.type === 'policy',
        loader: () =>
          import('./components/PolicyConsole').then(m => <m.PolicyTab />),
      },
    }),
    EntityCardBlueprint.make({
      name: 'rule',
      params: {
        type: 'content',
        filter: entity =>
          isTailscale(entity.kind) && entity.spec?.type !== 'policy',
        loader: () =>
          import('./components/EntityCards').then(m => (
            <m.TailscaleEntityCard />
          )),
      },
    }),
    EntityCardBlueprint.make({
      name: 'access',
      params: {
        type: 'content',
        // The card renders nothing for entities off the tailnet.
        filter: entity =>
          ['component', 'api', 'resource', 'group', 'user'].includes(
            entity.kind.toLowerCase(),
          ),
        loader: () =>
          import('./components/EntityCards').then(m => (
            <m.EntityTailscaleCard />
          )),
      },
    }),
  ],
});

export default tailscalePlugin;
export { tailscaleApiRef, TailscaleClient } from './api';
export type { TailscaleApi } from './api';
