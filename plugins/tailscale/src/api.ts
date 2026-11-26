import {
  createApiRef,
  type DiscoveryApi,
  type FetchApi,
} from '@backstage/frontend-plugin-api';
import type {
  EntityAccess,
  Overview,
} from '@spechtlabs/backstage-plugin-tailscale-common';

/*
 * What the tailscale backend serves: the types live in the common package,
 * shared with the backend.
 */
export type {
  ApproverRule,
  CatalogEdge,
  DestinationClass,
  DestinationView,
  Diagnostic,
  EntityAccess,
  Finding,
  GrantRule,
  GroupView,
  HostView,
  Identity,
  Lines,
  Member,
  NodeAttrRule,
  Overview,
  PartSummary,
  PolicyView,
  Principal,
  PrincipalKind,
  PublishSpec,
  PublishStatus,
  Rule,
  SshRule,
  Span,
  TagRule,
  TailscaleType,
  TestRule,
} from '@spechtlabs/backstage-plugin-tailscale-common';

/** A grant's application capabilities: name to values. */
export type App = Record<string, unknown[]>;

/** @public */
export interface TailscaleApi {
  getOverview(): Promise<Overview>;
  getAccess(entityRef: string): Promise<EntityAccess[]>;
}

/** @public */
export const tailscaleApiRef = createApiRef<TailscaleApi>().with({
  id: 'plugin.tailscale',
  pluginId: 'tailscale',
});

/**
 * Keeps the overview for a minute: the page, the policy tab and every entity
 * card read it, and the backend renders it from the whole catalog.
 */
/** @public */
export class TailscaleClient implements TailscaleApi {
  private cached?: { at: number; overview: Promise<Overview> };

  constructor(
    private readonly deps: { discoveryApi: DiscoveryApi; fetchApi: FetchApi },
  ) {}

  getOverview(): Promise<Overview> {
    if (this.cached && Date.now() - this.cached.at < 60_000) {
      return this.cached.overview;
    }
    const overview = this.get<Overview>('/overview');
    this.cached = { at: Date.now(), overview };
    overview.catch(() => {
      if (this.cached?.overview === overview) this.cached = undefined;
    });
    return overview;
  }

  getAccess(entityRef: string): Promise<EntityAccess[]> {
    return this.get(`/access?entity=${encodeURIComponent(entityRef)}`);
  }

  private async get<T>(path: string): Promise<T> {
    const base = await this.deps.discoveryApi.getBaseUrl('tailscale');
    const response = await this.deps.fetchApi.fetch(`${base}${path}`);
    if (!response.ok) {
      throw new Error(`Tailscale: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }
}
