import type {
  AnalysisReport,
  ExternalDependencyObservation,
  UrlUsageStatus,
} from '../analysis/types';

export type DependencyMapNodeKind =
  | 'entry'
  | 'macro'
  | 'missing'
  | 'external'
  | 'dynamic-url'
  | 'commented-urls';
export type DependencyMapEdgeKind = 'local-import' | 'missing-import' | 'external-url';

export interface DependencyMapNode {
  id: string;
  label: string;
  detail: string;
  kind: DependencyMapNodeKind;
  depth: number;
  externalStatus?: UrlUsageStatus;
  observationIds?: string[];
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
    externalDestinations: number;
    externalDestinationsInUse: number;
    externalDestinationsUseUnknown: number;
    externalDestinationsNotInUse: number;
    dynamicUrls: number;
    dynamicUrlsInUse: number;
    dynamicUrlsUseUnknown: number;
    commentedUrls: number;
  };
}

export interface DependencyMapOptions {
  showCommentedUrls?: boolean;
}

export interface DependencyMapFocus {
  nodeIds: string[];
  edgeIds: string[];
}

export function dependencyMapEdgeId(edge: DependencyMapEdge): string {
  return JSON.stringify([edge.from, edge.to, edge.kind]);
}

export function collectDependencyMapFocus(
  model: DependencyMapModel,
  focusedNodeId: string,
): DependencyMapFocus {
  if (!model.nodes.some((node) => node.id === focusedNodeId)) {
    return { nodeIds: [], edgeIds: [] };
  }
  const outgoing = new Map<string, DependencyMapEdge[]>();
  const incoming = new Map<string, DependencyMapEdge[]>();
  for (const edge of model.edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
  }

  const nodeIds = new Set([focusedNodeId]);
  const edgeIds = new Set<string>();
  const traverse = (
    adjacency: Map<string, DependencyMapEdge[]>,
    nextNodeId: (edge: DependencyMapEdge) => string,
  ): void => {
    const stack = [focusedNodeId];
    const expanded = new Set<string>();
    while (stack.length > 0) {
      const nodeId = stack.pop();
      if (!nodeId || expanded.has(nodeId)) continue;
      expanded.add(nodeId);
      for (const edge of adjacency.get(nodeId) ?? []) {
        edgeIds.add(dependencyMapEdgeId(edge));
        const nextId = nextNodeId(edge);
        nodeIds.add(nextId);
        if (!expanded.has(nextId)) stack.push(nextId);
      }
    }
  };
  traverse(outgoing, (edge) => edge.to);
  traverse(incoming, (edge) => edge.from);

  return {
    nodeIds: [...nodeIds].sort(),
    edgeIds: [...edgeIds].sort(),
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
  options: DependencyMapOptions = {},
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

  const externalByFileAndDestination = new Map<string, {
    fileId: string;
    destination: string;
    protocols: Set<ExternalDependencyObservation['protocol']>;
    observationIds: string[];
    usages: Set<ExternalDependencyObservation['usage']>;
  }>();
  for (const observation of report.observationLedger) {
    if (
      observation.kind !== 'external-dependency'
      || !depthByFileId.has(observation.sourceReference.fileId)
    ) continue;
    const key = JSON.stringify([observation.sourceReference.fileId, observation.destination]);
    const relationship = externalByFileAndDestination.get(key) ?? {
      fileId: observation.sourceReference.fileId,
      destination: observation.destination,
      protocols: new Set<ExternalDependencyObservation['protocol']>(),
      observationIds: [],
      usages: new Set<ExternalDependencyObservation['usage']>(),
    };
    relationship.protocols.add(observation.protocol);
    relationship.observationIds.push(observation.id);
    relationship.usages.add(observation.usage);
    externalByFileAndDestination.set(key, relationship);
  }

  const protocolsByDestination = new Map<string, Set<ExternalDependencyObservation['protocol']>>();
  const usagesByDestination = new Map<string, Set<ExternalDependencyObservation['usage']>>();
  const observationIdsByDestination = new Map<string, string[]>();
  const depthByDestination = new Map<string, number>();
  for (const relationship of externalByFileAndDestination.values()) {
    const protocols = protocolsByDestination.get(relationship.destination)
      ?? new Set<ExternalDependencyObservation['protocol']>();
    for (const protocol of relationship.protocols) protocols.add(protocol);
    protocolsByDestination.set(relationship.destination, protocols);
    const usages = usagesByDestination.get(relationship.destination)
      ?? new Set<ExternalDependencyObservation['usage']>();
    for (const usage of relationship.usages) usages.add(usage);
    usagesByDestination.set(relationship.destination, usages);
    observationIdsByDestination.set(
      relationship.destination,
      [
        ...(observationIdsByDestination.get(relationship.destination) ?? []),
        ...relationship.observationIds,
      ],
    );
    const candidateDepth = (depthByFileId.get(relationship.fileId) ?? 0) + 1;
    depthByDestination.set(
      relationship.destination,
      Math.max(
        depthByDestination.get(relationship.destination) ?? candidateDepth,
        candidateDepth,
      ),
    );
    edges.push({
      from: `file:${relationship.fileId}`,
      to: `external:${relationship.destination}`,
      kind: 'external-url',
    });
  }
  for (const [destination, protocols] of protocolsByDestination) {
    const usages = usagesByDestination.get(destination)
      ?? new Set<ExternalDependencyObservation['usage']>();
    const externalStatus: UrlUsageStatus = usages.has('in-use')
      ? 'in-use'
      : usages.has('use-unknown')
        ? 'use-unknown'
        : 'not-in-use';
    const occurrenceCount = observationIdsByDestination.get(destination)?.length ?? 0;
    const usageLabel = externalStatus === 'in-use'
      ? 'In Use'
      : externalStatus === 'use-unknown'
        ? 'Use Unknown'
        : 'Not In Use';
    nodes.push({
      id: `external:${destination}`,
      label: destination,
      detail: `${usageLabel} · ${[...protocols].sort().map((protocol) => protocol.toUpperCase()).join('/')} · ${occurrenceCount} ${occurrenceCount === 1 ? 'occurrence' : 'occurrences'}`,
      kind: 'external',
      depth: depthByDestination.get(destination) ?? 1,
      externalStatus,
      observationIds: observationIdsByDestination.get(destination) ?? [],
    });
  }

  for (const observation of report.observationLedger) {
    if (
      observation.kind !== 'dynamic-url'
      || !depthByFileId.has(observation.sourceReference.fileId)
    ) continue;
    const nodeId = `dynamic-url:${observation.id}`;
    nodes.push({
      id: nodeId,
      label: 'Dynamic URL',
      detail: `${observation.usage === 'in-use' ? 'In Use' : 'Use Unknown'}${observation.protocol ? ` · ${observation.protocol.toUpperCase()}` : ''}`,
      kind: 'dynamic-url',
      depth: (depthByFileId.get(observation.sourceReference.fileId) ?? 0) + 1,
      externalStatus: observation.usage,
      observationIds: [observation.id],
    });
    edges.push({
      from: `file:${observation.sourceReference.fileId}`,
      to: nodeId,
      kind: 'external-url',
    });
  }

  const commented = report.observationLedger.filter((observation) =>
    observation.kind === 'commented-url'
    && depthByFileId.has(observation.sourceReference.fileId));
  if (options.showCommentedUrls && commented.length > 0) {
    const commentedByFileId = new Map<string, typeof commented>();
    for (const observation of commented) {
      const fileId = observation.sourceReference.fileId;
      commentedByFileId.set(
        fileId,
        [...(commentedByFileId.get(fileId) ?? []), observation],
      );
    }
    for (const [fileId, observations] of [...commentedByFileId].sort(
      ([leftFileId], [rightFileId]) => leftFileId.localeCompare(rightFileId),
    )) {
      const nodeId = `commented-urls:${fileId}`;
      nodes.push({
        id: nodeId,
        label: `Commented URLs · ${fileById.get(fileId)?.path ?? fileId}`,
        detail: `Not In Use · ${observations.length} ${observations.length === 1 ? 'occurrence' : 'occurrences'}`,
        kind: 'commented-urls',
        depth: (depthByFileId.get(fileId) ?? 0) + 1,
        externalStatus: 'not-in-use',
        observationIds: observations.map((observation) => observation.id),
      });
      edges.push({
        from: `file:${fileId}`,
        to: nodeId,
        kind: 'external-url',
      });
    }
  }

  const kindOrder: Record<DependencyMapNodeKind, number> = {
    entry: 0,
    macro: 1,
    missing: 2,
    external: 3,
    'dynamic-url': 4,
    'commented-urls': 5,
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
      dependencies: nodes.filter((node) =>
        node.kind !== 'entry' && node.kind !== 'commented-urls').length,
      macros: nodes.filter((node) => node.kind === 'entry' || node.kind === 'macro').length,
      missing: nodes.filter((node) => node.kind === 'missing').length,
      externalDestinations: nodes.filter((node) => node.kind === 'external').length,
      externalDestinationsInUse: nodes.filter((node) =>
        node.kind === 'external'
        && node.externalStatus === 'in-use').length,
      externalDestinationsUseUnknown: nodes.filter((node) =>
        node.kind === 'external'
        && node.externalStatus === 'use-unknown').length,
      externalDestinationsNotInUse: nodes.filter((node) =>
        node.kind === 'external'
        && node.externalStatus === 'not-in-use').length,
      dynamicUrls: nodes.filter((node) => node.kind === 'dynamic-url').length,
      dynamicUrlsInUse: nodes.filter((node) =>
        node.kind === 'dynamic-url' && node.externalStatus === 'in-use').length,
      dynamicUrlsUseUnknown: nodes.filter((node) =>
        node.kind === 'dynamic-url' && node.externalStatus === 'use-unknown').length,
      commentedUrls: commented.length,
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

function wrapLabel(value: string, maxCharacters = 28): string[] {
  const remaining = [...value];
  const lines: string[] = [];
  const minimumBreak = Math.floor(maxCharacters * 0.55);
  while (remaining.length > maxCharacters) {
    let breakAt = maxCharacters;
    for (let index = maxCharacters; index >= minimumBreak; index -= 1) {
      if (/[._/-]/.test(remaining[index - 1] ?? '')) {
        breakAt = index;
        break;
      }
    }
    lines.push(remaining.splice(0, breakAt).join(''));
  }
  lines.push(remaining.join(''));
  return lines;
}

interface PositionedNode extends DependencyMapNode {
  x: number;
  y: number;
}

function isUrlNode(node: DependencyMapNode): boolean {
  return node.kind === 'external'
    || node.kind === 'dynamic-url'
    || node.kind === 'commented-urls';
}

interface PathPoint {
  x: number;
  y: number;
}

function distance(left: PathPoint, right: PathPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function pointToward(from: PathPoint, to: PathPoint, amount: number): PathPoint {
  const segmentLength = distance(from, to);
  if (segmentLength === 0) return from;
  const ratio = amount / segmentLength;
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
  };
}

function lineCommand(from: PathPoint, to: PathPoint): string {
  if (from.y === to.y) return `H ${to.x}`;
  if (from.x === to.x) return `V ${to.y}`;
  return `L ${to.x} ${to.y}`;
}

function roundedOrthogonalPath(points: PathPoint[], radius = 12): string {
  const simplified: PathPoint[] = [];
  for (const point of points) {
    const last = simplified.at(-1);
    if (last?.x === point.x && last.y === point.y) continue;
    while (simplified.length >= 2) {
      const beforeLast = simplified.at(-2)!;
      const candidate = simplified.at(-1)!;
      const isCollinear = (
        beforeLast.x === candidate.x && candidate.x === point.x
      ) || (
        beforeLast.y === candidate.y && candidate.y === point.y
      );
      if (!isCollinear) break;
      simplified.pop();
    }
    simplified.push(point);
  }
  if (simplified.length < 2) return '';
  let current = simplified[0]!;
  let path = `M ${current.x} ${current.y}`;
  for (let index = 1; index < simplified.length - 1; index += 1) {
    const previous = simplified[index - 1]!;
    const corner = simplified[index]!;
    const next = simplified[index + 1]!;
    const cornerRadius = Math.min(
      radius,
      distance(previous, corner) / 2,
      distance(corner, next) / 2,
    );
    const beforeCorner = pointToward(corner, previous, cornerRadius);
    const afterCorner = pointToward(corner, next, cornerRadius);
    path += ` ${lineCommand(current, beforeCorner)} Q ${corner.x} ${corner.y} ${afterCorner.x} ${afterCorner.y}`;
    current = afterCorner;
  }
  path += ` ${lineCommand(current, simplified.at(-1)!)}`;
  return path;
}

export function renderDependencyMapSvg(model: DependencyMapModel): string {
  const nodeWidth = 240;
  const wrappedLabels = new Map(model.nodes.map((node) => [node.id, wrapLabel(node.label)]));
  const maximumLabelLines = Math.max(
    1,
    ...[...wrappedLabels.values()].map((lines) => lines.length),
  );
  const nodeHeight = 44 + maximumLabelLines * 15;
  const horizontalGap = 112;
  const verticalGap = 26;
  const peerStagger = 30;
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
  const height = Math.max(240, marginY * 2 + contentHeight);
  const positioned: PositionedNode[] = [];
  const xByDepth = new Map<number, number>();
  let nextLayerX = marginX;

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const layer = layers.get(depth) ?? [];
    xByDepth.set(depth, nextLayerX);
    nextLayerX += nodeWidth
      + Math.max(0, layer.length - 1) * peerStagger
      + horizontalGap;
  }
  const width = nextLayerX - horizontalGap + marginX;

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const layer = layers.get(depth) ?? [];
    const layerHeight = layer.length * nodeHeight + Math.max(0, layer.length - 1) * verticalGap;
    const top = marginY + (contentHeight - layerHeight) / 2;
    layer.forEach((node, index) => {
      positioned.push({
        ...node,
        x: (xByDepth.get(depth) ?? marginX) + index * peerStagger,
        y: top + index * (nodeHeight + verticalGap),
      });
    });
  }

  const positionById = new Map(positioned.map((node) => [node.id, node]));
  const outgoingByNodeId = new Map<string, DependencyMapEdge[]>();
  const incomingByNodeId = new Map<string, DependencyMapEdge[]>();
  for (const edge of model.edges) {
    if (!positionById.has(edge.from) || !positionById.has(edge.to)) continue;
    outgoingByNodeId.set(
      edge.from,
      [...(outgoingByNodeId.get(edge.from) ?? []), edge],
    );
    incomingByNodeId.set(
      edge.to,
      [...(incomingByNodeId.get(edge.to) ?? []), edge],
    );
  }
  const portYs = (
    groupedEdges: Map<string, DependencyMapEdge[]>,
    relatedNodeId: (edge: DependencyMapEdge) => string,
  ): Map<string, number> => {
    const result = new Map<string, number>();
    for (const [nodeId, incidentEdges] of groupedEdges) {
      const node = positionById.get(nodeId);
      if (!node) continue;
      incidentEdges.sort((left, right) => {
        const leftNode = positionById.get(relatedNodeId(left));
        const rightNode = positionById.get(relatedNodeId(right));
        return (leftNode?.y ?? 0) - (rightNode?.y ?? 0)
          || (leftNode?.x ?? 0) - (rightNode?.x ?? 0)
          || dependencyMapEdgeId(left).localeCompare(dependencyMapEdgeId(right));
      });
      const availableSpan = Math.max(0, nodeHeight - 28);
      const portSpan = Math.min(availableSpan, (incidentEdges.length - 1) * 12);
      const portStep = incidentEdges.length > 1
        ? portSpan / (incidentEdges.length - 1)
        : 0;
      const firstPortY = node.y + nodeHeight / 2 - portSpan / 2;
      incidentEdges.forEach((edge, index) => {
        result.set(dependencyMapEdgeId(edge), firstPortY + index * portStep);
      });
    }
    return result;
  };
  const outgoingPortYByEdgeId = portYs(outgoingByNodeId, (edge) => edge.to);
  const incomingPortYByEdgeId = portYs(incomingByNodeId, (edge) => edge.from);
  const markerId = `dependency-map-arrow-${model.entryFileId.replace(/[^a-z0-9_-]/gi, '-')}`;
  let skipLevelEdgeIndex = 0;
  let cycleEdgeIndex = 0;
  const paths = model.edges.flatMap((edge) => {
    const from = positionById.get(edge.from);
    const to = positionById.get(edge.to);
    if (!from || !to) return [];
    const edgeId = dependencyMapEdgeId(edge);
    const edgeAttributes = `data-dependency-edge-id="${escapeXml(edgeId)}" data-dependency-edge-from="${escapeXml(edge.from)}" data-dependency-edge-to="${escapeXml(edge.to)}"`;
    const fromCenterY = outgoingPortYByEdgeId.get(edgeId) ?? from.y + nodeHeight / 2;
    const toCenterY = incomingPortYByEdgeId.get(edgeId) ?? to.y + nodeHeight / 2;
    if (to.x > from.x) {
      const startX = from.x + nodeWidth;
      const endX = to.x;
      if (to.depth - from.depth > 1) {
        const laneY = Math.max(
          8,
          Math.min(from.y, to.y) - 18 - (skipLevelEdgeIndex % 3) * 9,
        );
        skipLevelEdgeIndex += 1;
        const turnDistance = Math.min(64, Math.max(42, (endX - startX) * 0.16));
        const path = roundedOrthogonalPath([
          { x: startX, y: fromCenterY },
          { x: startX + turnDistance, y: fromCenterY },
          { x: startX + turnDistance, y: laneY },
          { x: endX - turnDistance, y: laneY },
          { x: endX - turnDistance, y: toCenterY },
          { x: endX, y: toCenterY },
        ]);
        return [`<path class="dependency-map-edge ${edge.kind} skip-level" ${edgeAttributes} d="${path}" marker-end="url(#${markerId})" />`];
      }
      const middleX = (startX + endX) / 2;
      const path = roundedOrthogonalPath([
        { x: startX, y: fromCenterY },
        { x: middleX, y: fromCenterY },
        { x: middleX, y: toCenterY },
        { x: endX, y: toCenterY },
      ]);
      return [`<path class="dependency-map-edge ${edge.kind}" ${edgeAttributes} d="${path}" marker-end="url(#${markerId})" />`];
    }
    if (to.x === from.x) {
      const sideX = from.x + nodeWidth + 38;
      const path = roundedOrthogonalPath([
        { x: from.x + nodeWidth, y: fromCenterY },
        { x: sideX, y: fromCenterY },
        { x: sideX, y: toCenterY },
        { x: to.x + nodeWidth, y: toCenterY },
      ]);
      return [`<path class="dependency-map-edge ${edge.kind} cycle" ${edgeAttributes} d="${path}" marker-end="url(#${markerId})" />`];
    }
    const startX = from.x;
    const endX = to.x + nodeWidth;
    const laneY = Math.max(
      8,
      Math.min(from.y, to.y) - 22 - (cycleEdgeIndex % 3) * 10,
    );
    cycleEdgeIndex += 1;
    const turnDistance = Math.min(54, Math.max(36, (startX - endX) * 0.24));
    const path = roundedOrthogonalPath([
      { x: startX, y: fromCenterY },
      { x: startX - turnDistance, y: fromCenterY },
      { x: startX - turnDistance, y: laneY },
      { x: endX + turnDistance, y: laneY },
      { x: endX + turnDistance, y: toCenterY },
      { x: endX, y: toCenterY },
    ]);
    return [`<path class="dependency-map-edge ${edge.kind} cycle" ${edgeAttributes} d="${path}" marker-end="url(#${markerId})" />`];
  }).join('');
  const nodeMarkup = positioned.map((node) => {
    const labelLines = wrappedLabels.get(node.id) ?? [node.label];
    const actionHint = isUrlNode(node)
      ? ' — URL dependency classification is beta; activate to focus related routes and show source details'
      : ' — activate to focus related routes';
    return `
    <g class="dependency-map-node ${node.kind}${node.externalStatus ? ` ${node.externalStatus}` : ''}" transform="translate(${node.x} ${node.y})" data-dependency-node-id="${escapeXml(node.id)}"${isUrlNode(node) ? ` data-dependency-url-node="${escapeXml(node.id)}"` : ''} role="button" tabindex="0" aria-pressed="false">
      <title>${escapeXml(`${node.label} — ${node.detail}${actionHint}`)}</title>
      <rect width="${nodeWidth}" height="${nodeHeight}" rx="9" />
      <text x="15" y="23">
        ${labelLines.map((line, index) => `<tspan class="dependency-map-node-label dependency-map-node-label-line" x="15" dy="${index === 0 ? 0 : 15}">${escapeXml(line)}</tspan>`).join('')}
        <tspan class="dependency-map-node-detail" x="15" dy="19">${escapeXml(node.detail)}</tspan>
      </text>
      ${isUrlNode(node)
        ? `<g class="dependency-map-beta-ribbon" transform="translate(${nodeWidth - 29} 7) rotate(28)" aria-hidden="true">
            <rect x="-27" y="-8" width="54" height="16" rx="3" />
            <text x="0" y="3">BETA</text>
          </g>`
        : ''}
    </g>`;
  }).join('');

  return `<svg class="dependency-map-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Dependency map with directed links from importing macros to local dependencies, missing dependencies, and external destinations">
    <defs>
      <marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" />
      </marker>
    </defs>
    <g class="dependency-map-edges">${paths}</g>
    <g class="dependency-map-nodes">${nodeMarkup}</g>
  </svg>`;
}
