import {
  RELATION_API_PROVIDED_BY,
  RELATION_CONSUMES_API,
  RELATION_DEPENDS_ON,
  stringifyEntityRef,
  type Entity,
} from '@backstage/catalog-model';
import {
  isWildcardPort,
  parsePort,
  type Finding,
  type LocalEdge,
  type PortRange,
} from '@spechtlabs/backstage-plugin-tailscale-common';

/**
 * The annotations that put catalog entities on the tailnet, and from which
 * the policy's catalog grants are made:
 *
 *   API        tailnet-dst         where it is reached: tag:… or svc:…
 *              tailnet-ports       on which ports: tcp:443, 3493, …
 *              tailnet-allow       who else may use it: groups, users,
 *                                  autogroups, tags (people, and devices
 *                                  that aren't Components)
 *              tailnet-client-tag  the tag its consumers reach it as, when
 *                                  that is an attribute of using it
 *                                  (tag:tsidp-client) rather than of the
 *                                  consumer
 *   Component  tailnet-src         the tags its traffic comes from (its
 *                                  egress proxy's, its host's)
 *
 * A Component that consumes an API with tailnet-dst, from outside the
 * provider's cluster, is a tailnet edge: src -> dst on those ports. So is
 * everything an API's tailnet-allow names.
 */
export const ANNOTATION_SRC = 'specht-labs.de/tailnet-src';
export const ANNOTATION_DST = 'specht-labs.de/tailnet-dst';
export const ANNOTATION_PORTS = 'specht-labs.de/tailnet-ports';
export const ANNOTATION_ALLOW = 'specht-labs.de/tailnet-allow';
export const ANNOTATION_CLIENT_TAG = 'specht-labs.de/tailnet-client-tag';

const TAG = /^tag:[A-Za-z0-9-]+$/;
const DST_SELECTOR = /^(tag|svc):[a-z0-9-]+$/;
const ALLOWED = /^((group|tag|autogroup|user):[^\s,]+|[^\s,@:]+@[^\s,]+)$/;

export interface TailnetEdge {
  /** The consuming Component; for tailnet-allow, the API itself. */
  consumer: string;
  api: string;
  providers: string[];
  /** consumesApi, or the API's tailnet-allow. */
  via: 'consumesApi' | 'tailnet-allow';
  src: string[];
  dst: string[];
  ports: PortRange[];
}

export interface TailnetGraph {
  edges: TailnetEdge[];
  /** Consumer and provider share a cluster: pod network, not the tailnet. */
  local: LocalEdge[];
  /** Crosses the tailnet, but the consumer has no tailnet-src. */
  missingSource: Finding[];
  /** Annotations that are malformed or not allowed. */
  invalid: Finding[];
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function targets(entity: Entity, type: string): string[] {
  return (entity.relations ?? [])
    .filter(r => r.type === type)
    .map(r => r.targetRef);
}

interface TailnetApi {
  dst: string[];
  ports: PortRange[];
  allow: string[];
  clientTag?: string;
}

function readApi(api: Entity, invalid: Finding[]): TailnetApi | undefined {
  const entity = stringifyEntityRef(api);
  const annotations = api.metadata.annotations ?? {};
  const problems: string[] = [];
  const dst = list(annotations[ANNOTATION_DST]);
  const portEntries = list(annotations[ANNOTATION_PORTS]);
  const allow = list(annotations[ANNOTATION_ALLOW]);
  const clientTag = annotations[ANNOTATION_CLIENT_TAG]?.trim();

  const badDst = dst.filter(d => !DST_SELECTOR.test(d));
  if (badDst.length) {
    problems.push(
      `${ANNOTATION_DST}: only tag:… and svc:… allowed, not ${badDst.join(
        ', ',
      )}`,
    );
  }
  const ports = portEntries.map(parsePort);
  const badPorts = portEntries.filter(
    (_, i) => !ports[i] || isWildcardPort(ports[i]!),
  );
  if (!portEntries.length) {
    problems.push(`${ANNOTATION_DST} needs ${ANNOTATION_PORTS} next to it`);
  } else if (badPorts.length) {
    problems.push(
      `${ANNOTATION_PORTS}: needs concrete ports, not ${badPorts.join(', ')}`,
    );
  }
  const badAllow = allow.filter(a => !ALLOWED.test(a));
  if (badAllow.length) {
    problems.push(
      `${ANNOTATION_ALLOW}: only groups, users, autogroups and tags, not ${badAllow.join(
        ', ',
      )}`,
    );
  }
  if (clientTag !== undefined && !TAG.test(clientTag)) {
    problems.push(`${ANNOTATION_CLIENT_TAG}: one tag:…, not ${clientTag}`);
  }
  for (const message of problems) invalid.push({ entity, message });
  if (problems.length) return undefined;
  return { dst, ports: ports as PortRange[], allow, clientTag };
}

/**
 * Reads the tailnet edges out of the catalog. `entities` must hold the
 * Components and APIs (with relations) and the kubernetes-cluster
 * Resources.
 */
export function buildTailnetGraph(entities: Entity[]): TailnetGraph {
  const byRef = new Map(entities.map(e => [stringifyEntityRef(e), e]));
  const clusters = new Set(
    entities
      .filter(
        e => e.kind === 'Resource' && e.spec?.type === 'kubernetes-cluster',
      )
      .map(e => stringifyEntityRef(e)),
  );
  const clustersOf = (ref: string) => {
    const entity = byRef.get(ref);
    return entity
      ? targets(entity, RELATION_DEPENDS_ON).filter(t => clusters.has(t))
      : [];
  };
  const providersOf = (apiRef: string) =>
    byRef.get(apiRef)
      ? targets(byRef.get(apiRef)!, RELATION_API_PROVIDED_BY)
      : [];

  const graph: TailnetGraph = {
    edges: [],
    local: [],
    missingSource: [],
    invalid: [],
  };

  const tailnetApis = new Map<string, TailnetApi>();
  for (const api of entities.filter(e => e.kind === 'API')) {
    const annotations = api.metadata.annotations ?? {};
    const annotated = [
      ANNOTATION_DST,
      ANNOTATION_PORTS,
      ANNOTATION_ALLOW,
      ANNOTATION_CLIENT_TAG,
    ].some(a => annotations[a]);
    if (!annotated) continue;
    const ref = stringifyEntityRef(api);
    if (!annotations[ANNOTATION_DST]) {
      graph.invalid.push({
        entity: ref,
        message: `the tailnet annotations need ${ANNOTATION_DST}`,
      });
      continue;
    }
    const read = readApi(api, graph.invalid);
    if (!read) continue;
    tailnetApis.set(ref, read);
    if (read.allow.length) {
      graph.edges.push({
        consumer: ref,
        api: ref,
        providers: providersOf(ref),
        via: 'tailnet-allow',
        src: read.allow,
        dst: read.dst,
        ports: read.ports,
      });
    }
  }

  for (const component of entities.filter(e => e.kind === 'Component')) {
    const consumer = stringifyEntityRef(component);
    const src = list(component.metadata.annotations?.[ANNOTATION_SRC]);
    const badSrc = src.filter(s => !TAG.test(s));
    if (badSrc.length) {
      graph.invalid.push({
        entity: consumer,
        message: `${ANNOTATION_SRC}: only tag:… allowed, not ${badSrc.join(
          ', ',
        )}`,
      });
      continue;
    }
    const srcClusters = clustersOf(consumer);

    for (const apiRef of targets(component, RELATION_CONSUMES_API)) {
      const api = tailnetApis.get(apiRef);
      if (!api) continue;
      const providers = providersOf(apiRef);
      const dstClusters = [...new Set(providers.flatMap(clustersOf))];
      const shared = srcClusters.find(c => dstClusters.includes(c));
      if (shared && providers.every(p => clustersOf(p).includes(shared))) {
        graph.local.push({ consumer, api: apiRef, providers, cluster: shared });
        continue;
      }
      const from = api.clientTag ? [api.clientTag] : src;
      if (!from.length) {
        graph.missingSource.push({
          entity: consumer,
          message: `consumes ${apiRef} across the tailnet, but has no ${ANNOTATION_SRC}`,
        });
        continue;
      }
      graph.edges.push({
        consumer,
        api: apiRef,
        providers,
        via: 'consumesApi',
        src: from,
        dst: api.dst,
        ports: api.ports,
      });
    }
  }

  return graph;
}
