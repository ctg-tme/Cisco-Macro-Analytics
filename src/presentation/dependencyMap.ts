import type {
  AnalysisReport,
  ExternalDomainObservation,
} from '../analysis/types';

export type DependencyMapNodeKind = 'entry' | 'macro' | 'missing' | 'external';
export type DependencyMapEdgeKind = 'local-import' | 'missing-import' | 'external-url';

export interface DependencyMapNode {
  id: string;
  label: string;
  detail: string;
  kind: DependencyMapNodeKind;
  depth: number;
  externalStatus?: 'in-use' | 'not-in-use' | 'mixed';
}

export interface DependencyMapEdge {
  from: string;
  to: string;
  kind: DependencyMapEdgeKind;
}

export interface DependencyMapModel {
  entryFileId: string;
  nodes: DependencyMapNode[];
  edges: DependencyMapEdge[];
  counts: {
    dependencies: number;
    macros: number;
    missing: number;
    externalDomains: number;
    externalDomainsInUse: number;
    externalDomainsNotInUse: number;
  };
}

function uniqueEdges(edges: DependencyMapEdge[]): DependencyMapEdge[] {
  return [...new Map(edges.map((edge) => [
    JSON.stringify([edge.from, edge.to, edge.kind]),
    edge,
  ])).values()];
}

function hasDependencyRoute(
  outgoing: Map<string, string[]>,
  startFileId: string,
  targetFileId: string,
  reachableFileIds: Set<string>,
): boolean {
  const stack = [startFileId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const fileId = stack.pop();
    if (!fileId || visited.has(fileId)) continue;
    if (fileId === targetFileId) return true;
    visited.add(fileId);
    for (const dependencyFileId of outgoing.get(fileId) ?? []) {
      if (reachableFileIds.has(dependencyFileId)) stack.push(dependencyFileId);
    }
  }
  return false;
}

function promoteAcyclicDependencyDepths(
  depthByFileId: Map<string, number>,
  outgoing: Map<string, string[]>,
): void {
  const reachableFileIds = new Set(depthByFileId.keys());
  const acyclicEdges = [...outgoing].flatMap(([importerFileId, dependencyFileIds]) =>
    dependencyFileIds
      .filter((dependencyFileId) =>
        reachableFileIds.has(importerFileId)
        && reachableFileIds.has(dependencyFileId)
        && !hasDependencyRoute(
          outgoing,
          dependencyFileId,
          importerFileId,
          reachableFileIds,
        ))
      .map((dependencyFileId) => ({ importerFileId, dependencyFileId })));

  for (let pass = 0; pass < reachableFileIds.size; pass += 1) {
    let changed = false;
    for (const edge of acyclicEdges) {
      const candidateDepth = (depthByFileId.get(edge.importerFileId) ?? 0) + 1;
      if (candidateDepth <= (depthByFileId.get(edge.dependencyFileId) ?? 0)) continue;
      depthByFileId.set(edge.dependencyFileId, candidateDepth);
      changed = true;
    }
    if (!changed) break;
  }
}

export function buildDependencyMap(
  report: AnalysisReport,
  entryFileId: string,
): DependencyMapModel {
  const fileById = new Map(report.fileInventory.map((file) => [file.fileId, file]));
  const outgoing = new Map<string, string[]>();
  for (const edge of report.directDependencyGraph) {
    const dependencies = outgoing.get(edge.importerFileId) ?? [];
    dependencies.push(edge.dependencyFileId);
    outgoing.set(edge.importerFileId, dependencies);
  }

  const depthByFileId = new Map<string, number>([[entryFileId, 0]]);
  const queue = [entryFileId];
  while (queue.length > 0) {
    const importerId = queue.shift();
    if (!importerId) continue;
    const importerDepth = depthByFileId.get(importerId) ?? 0;
    for (const dependencyId of outgoing.get(importerId) ?? []) {
      if (depthByFileId.has(dependencyId)) continue;
      depthByFileId.set(dependencyId, importerDepth + 1);
      queue.push(dependencyId);
    }
  }
  promoteAcyclicDependencyDepths(depthByFileId, outgoing);

  const nodes: DependencyMapNode[] = [...depthByFileId].flatMap(([fileId, depth]) => {
    const file = fileById.get(fileId);
    if (!file) return [];
    return [{
      id: `file:${fileId}`,
      label: file.path,
      detail: fileId === entryFileId ? 'Entry Macro' : 'Macro',
      kind: fileId === entryFileId ? 'entry' : 'macro',
      depth,
    }];
  });
  const edges: DependencyMapEdge[] = report.directDependencyGraph.flatMap((edge) =>
    depthByFileId.has(edge.importerFileId) && depthByFileId.has(edge.dependencyFileId)
      ? [{
          from: `file:${edge.importerFileId}`,
          to: `file:${edge.dependencyFileId}`,
          kind: 'local-import' as const,
        }]
      : []);

  for (const unresolved of report.unresolvedDependencyEdges) {
    const reachableImporters = unresolved.importerFileIds.filter((fileId) =>
      depthByFileId.has(fileId));
    if (reachableImporters.length === 0) continue;
    const nodeId = `missing:${unresolved.virtualFileId}`;
    const depth = Math.max(...reachableImporters.map((fileId) =>
      (depthByFileId.get(fileId) ?? 0) + 1));
    nodes.push({
      id: nodeId,
      label: unresolved.normalizedExpectedPath,
      detail: 'Missing dependency',
      kind: 'missing',
      depth,
    });
    for (const importerId of reachableImporters) {
      edges.push({
        from: `file:${importerId}`,
        to: nodeId,
        kind: 'missing-import',
      });
    }
  }

  const externalByFileAndDomain = new Map<string, {
    fileId: string;
    domain: string;
    protocols: Set<ExternalDomainObservation['protocol']>;
    usages: Set<ExternalDomainObservation['usage']>;
  }>();
  for (const observation of report.observationLedger) {
    if (
      observation.kind !== 'external-domain'
      || !depthByFileId.has(observation.sourceReference.fileId)
    ) continue;
    const key = JSON.stringify([observation.sourceReference.fileId, observation.domain]);
    const relationship = externalByFileAndDomain.get(key) ?? {
      fileId: observation.sourceReference.fileId,
      domain: observation.domain,
      protocols: new Set<ExternalDomainObservation['protocol']>(),
      usages: new Set<ExternalDomainObservation['usage']>(),
    };
    relationship.protocols.add(observation.protocol);
    relationship.usages.add(observation.usage);
    externalByFileAndDomain.set(key, relationship);
  }

  const protocolsByDomain = new Map<string, Set<ExternalDomainObservation['protocol']>>();
  const usagesByDomain = new Map<string, Set<ExternalDomainObservation['usage']>>();
  const depthByDomain = new Map<string, number>();
  for (const relationship of externalByFileAndDomain.values()) {
    const protocols = protocolsByDomain.get(relationship.domain)
      ?? new Set<ExternalDomainObservation['protocol']>();
    for (const protocol of relationship.protocols) protocols.add(protocol);
    protocolsByDomain.set(relationship.domain, protocols);
    const usages = usagesByDomain.get(relationship.domain)
      ?? new Set<ExternalDomainObservation['usage']>();
    for (const usage of relationship.usages) usages.add(usage);
    usagesByDomain.set(relationship.domain, usages);
    const candidateDepth = (depthByFileId.get(relationship.fileId) ?? 0) + 1;
    depthByDomain.set(
      relationship.domain,
      Math.max(depthByDomain.get(relationship.domain) ?? candidateDepth, candidateDepth),
    );
    edges.push({
      from: `file:${relationship.fileId}`,
      to: `external:${relationship.domain}`,
      kind: 'external-url',
    });
  }
  for (const [domain, protocols] of protocolsByDomain) {
    const usages = usagesByDomain.get(domain) ?? new Set<ExternalDomainObservation['usage']>();
    const xapiParameter = usages.has('xapi-parameter')
      || usages.has('xapi-parameter-and-xml-payload');
    const xmlPayload = usages.has('xml-payload')
      || usages.has('xapi-parameter-and-xml-payload');
    const notInUse = usages.has('not-in-use');
    const inUse = xapiParameter || xmlPayload;
    const externalStatus = inUse && notInUse ? 'mixed' : inUse ? 'in-use' : 'not-in-use';
    const usageLabel = inUse && notInUse
      ? 'in use + not in use'
      : xapiParameter && xmlPayload
        ? 'in use · xAPI + XML'
        : xapiParameter
          ? 'in use · xAPI'
          : xmlPayload
            ? 'in use · XML'
            : 'not in use';
    nodes.push({
      id: `external:${domain}`,
      label: domain,
      detail: `${[...protocols].sort().map((protocol) => protocol.toUpperCase()).join('/')} · ${usageLabel}`,
      kind: 'external',
      depth: depthByDomain.get(domain) ?? 1,
      externalStatus,
    });
  }

  const kindOrder: Record<DependencyMapNodeKind, number> = {
    entry: 0,
    macro: 1,
    missing: 2,
    external: 3,
  };
  nodes.sort((left, right) =>
    left.depth - right.depth
    || kindOrder[left.kind] - kindOrder[right.kind]
    || left.label.localeCompare(right.label));

  return {
    entryFileId,
    nodes,
    edges: uniqueEdges(edges).sort((left, right) =>
      left.from.localeCompare(right.from)
      || left.to.localeCompare(right.to)
      || left.kind.localeCompare(right.kind)),
    counts: {
      dependencies: nodes.filter((node) => node.kind !== 'entry').length,
      macros: nodes.filter((node) => node.kind === 'entry' || node.kind === 'macro').length,
      missing: nodes.filter((node) => node.kind === 'missing').length,
      externalDomains: nodes.filter((node) => node.kind === 'external').length,
      externalDomainsInUse: nodes.filter((node) =>
        node.kind === 'external'
        && (node.externalStatus === 'in-use' || node.externalStatus === 'mixed')).length,
      externalDomainsNotInUse: nodes.filter((node) =>
        node.kind === 'external'
        && (node.externalStatus === 'not-in-use' || node.externalStatus === 'mixed')).length,
    },
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function compactLabel(value: string): string {
  if (value.length <= 31) return value;
  return `${value.slice(0, 15)}…${value.slice(-13)}`;
}

interface PositionedNode extends DependencyMapNode {
  x: number;
  y: number;
}

export function renderDependencyMapSvg(model: DependencyMapModel): string {
  const nodeWidth = 220;
  const nodeHeight = 58;
  const horizontalGap = 88;
  const verticalGap = 26;
  const marginX = 32;
  const marginY = 32;
  const maxDepth = Math.max(0, ...model.nodes.map((node) => node.depth));
  const layers = new Map<number, DependencyMapNode[]>();
  for (const node of model.nodes) {
    const layer = layers.get(node.depth) ?? [];
    layer.push(node);
    layers.set(node.depth, layer);
  }
  const maxLayerSize = Math.max(1, ...[...layers.values()].map((layer) => layer.length));
  const contentHeight = maxLayerSize * nodeHeight + (maxLayerSize - 1) * verticalGap;
  const width = marginX * 2 + (maxDepth + 1) * nodeWidth + maxDepth * horizontalGap;
  const height = Math.max(240, marginY * 2 + contentHeight);
  const positioned: PositionedNode[] = [];

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const layer = layers.get(depth) ?? [];
    const layerHeight = layer.length * nodeHeight + Math.max(0, layer.length - 1) * verticalGap;
    const top = marginY + (contentHeight - layerHeight) / 2;
    layer.forEach((node, index) => {
      positioned.push({
        ...node,
        x: marginX + depth * (nodeWidth + horizontalGap),
        y: top + index * (nodeHeight + verticalGap),
      });
    });
  }

  const positionById = new Map(positioned.map((node) => [node.id, node]));
  const markerId = `dependency-map-arrow-${model.entryFileId.replace(/[^a-z0-9_-]/gi, '-')}`;
  let skipLevelEdgeIndex = 0;
  const paths = model.edges.flatMap((edge) => {
    const from = positionById.get(edge.from);
    const to = positionById.get(edge.to);
    if (!from || !to) return [];
    const fromCenterY = from.y + nodeHeight / 2;
    const toCenterY = to.y + nodeHeight / 2;
    if (to.x > from.x) {
      const startX = from.x + nodeWidth;
      const endX = to.x;
      if (to.depth - from.depth > 1) {
        const laneY = Math.max(
          8,
          Math.min(from.y, to.y) - 18 - (skipLevelEdgeIndex % 3) * 9,
        );
        skipLevelEdgeIndex += 1;
        const turnDistance = Math.min(54, Math.max(34, (endX - startX) * 0.16));
        return [`<path class="dependency-map-edge ${edge.kind} skip-level" d="M ${startX} ${fromCenterY} C ${startX + turnDistance} ${fromCenterY}, ${startX + turnDistance} ${laneY}, ${startX + turnDistance * 2} ${laneY} L ${endX - turnDistance * 2} ${laneY} C ${endX - turnDistance} ${laneY}, ${endX - turnDistance} ${toCenterY}, ${endX} ${toCenterY}" marker-end="url(#${markerId})" />`];
      }
      const bend = Math.max(34, (endX - startX) * 0.48);
      return [`<path class="dependency-map-edge ${edge.kind}" d="M ${startX} ${fromCenterY} C ${startX + bend} ${fromCenterY}, ${endX - bend} ${toCenterY}, ${endX} ${toCenterY}" marker-end="url(#${markerId})" />`];
    }
    if (to.x === from.x) {
      const sideX = from.x + nodeWidth + 38;
      return [`<path class="dependency-map-edge ${edge.kind} cycle" d="M ${from.x + nodeWidth} ${fromCenterY} C ${sideX} ${fromCenterY}, ${sideX} ${toCenterY}, ${to.x + nodeWidth} ${toCenterY}" marker-end="url(#${markerId})" />`];
    }
    const startX = from.x;
    const endX = to.x + nodeWidth;
    const bend = Math.max(42, (startX - endX) * 0.36);
    return [`<path class="dependency-map-edge ${edge.kind} cycle" d="M ${startX} ${fromCenterY} C ${startX - bend} ${fromCenterY}, ${endX + bend} ${toCenterY}, ${endX} ${toCenterY}" marker-end="url(#${markerId})" />`];
  }).join('');
  const nodeMarkup = positioned.map((node) => `
    <g class="dependency-map-node ${node.kind}${node.externalStatus ? ` ${node.externalStatus}` : ''}" transform="translate(${node.x} ${node.y})">
      <title>${escapeXml(`${node.label} — ${node.detail}`)}</title>
      <rect width="${nodeWidth}" height="${nodeHeight}" rx="9" />
      <text x="15" y="24">
        <tspan class="dependency-map-node-label">${escapeXml(compactLabel(node.label))}</tspan>
        <tspan class="dependency-map-node-detail" x="15" dy="20">${escapeXml(node.detail)}</tspan>
      </text>
    </g>`).join('');

  return `<svg class="dependency-map-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Dependency map with directed links from importing macros to local dependencies, missing dependencies, and external domains">
    <defs>
      <marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" />
      </marker>
    </defs>
    <g class="dependency-map-edges">${paths}</g>
    <g class="dependency-map-nodes">${nodeMarkup}</g>
  </svg>`;
}
