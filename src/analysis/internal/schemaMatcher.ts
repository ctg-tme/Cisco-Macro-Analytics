import type {
  AnalysisTarget,
  ApiAvailability,
  Finding,
  SchemaObject,
  SchemaEvidence,
  SchemaParameter,
  SchemaParameterSummary,
  SchemaSnapshot,
} from '../types';
import type { ExtractedReference } from './parser';

export interface SchemaMatchResult {
  availability: ApiAvailability;
  schemaObject?: SchemaObject;
  schemaEvidence: SchemaEvidence;
  findingSpecs: FindingSpec[];
}

export interface FindingSpec {
  code: string;
  title: string;
  message: string;
  evidence: Finding['evidence'];
  priority: Finding['priority'];
  basis?: string;
  limitations?: string[];
  recommendedAction?: string;
  details?: Record<string, unknown>;
}

function allowedRoles(schemaObject: SchemaObject, operation: ExtractedReference['operation']): string[] {
  if (operation === 'get' && schemaObject.type === 'Configuration') {
    return schemaObject.attributes?.read ?? schemaObject.attributes?.role ?? [];
  }
  return schemaObject.attributes?.role ?? [];
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function parameterSpace(parameter: SchemaParameter): Record<string, unknown> {
  return parameter.valuespace ?? { ...parameter };
}

function attributeSpace(schemaObject: SchemaObject): Record<string, unknown> {
  return schemaObject.attributes?.valuespace ?? schemaObject.attributes?.valueSpace ?? {};
}

function allowedValues(space: Record<string, unknown>): Array<string | number | boolean> | undefined {
  const values = space.Values ?? space.values;
  if (!Array.isArray(values)) return undefined;
  const primitives = values.filter((value): value is string | number | boolean =>
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean',
  );
  return primitives.length > 0 ? primitives : undefined;
}

function summarizeSpace(space: Record<string, unknown>): Omit<SchemaParameterSummary, 'name' | 'required'> {
  const type = space.type ?? space.Type;
  return {
    ...(typeof type === 'string' ? { type } : {}),
    ...(numberValue(space.Min ?? space.minimum) !== undefined ? { minimum: numberValue(space.Min ?? space.minimum) } : {}),
    ...(numberValue(space.Max ?? space.maximum) !== undefined ? { maximum: numberValue(space.Max ?? space.maximum) } : {}),
    ...(allowedValues(space) ? { allowedValues: allowedValues(space) } : {}),
  };
}

function summarizeParameters(schemaObject: SchemaObject): SchemaParameterSummary[] {
  return (schemaObject.attributes?.params ?? []).map((parameter) => ({
    name: parameter.name,
    required: parameter.required === true,
    ...summarizeSpace(parameterSpace(parameter)),
  }));
}

function documentationUrl(reference: ExtractedReference, path = reference.path): string {
  return `https://roomos.cisco.com/xapi/${reference.kind}.${path.replaceAll(' ', '.')}/`;
}

function schemaPath(schemaObject: SchemaObject): string {
  return schemaObject.normPath ?? schemaObject.path;
}

function samePathIgnoringCase(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function targetContext(target: AnalysisTarget): Partial<{
  release: string;
  productModel: string;
  operatingMode: 'Native' | 'MTR';
  runtimeRole: 'Admin' | 'Integrator' | 'User';
}> {
  return target.kind === 'declared' ? target : target.partial ?? {};
}

function absentSchemaEvidence(reference: ExtractedReference): SchemaEvidence {
  return {
    existsInSnapshot: false,
    matchKind: 'none',
    documentationUrl: documentationUrl(reference),
    product: { status: 'not-declared', supportedProducts: [] },
    operatingMode: { status: 'not-declared', supportsMtr: null, basis: 'path-not-found' },
    role: { status: 'not-declared', allowedRoles: [] },
    parameters: [],
  };
}

const teamsUnavailableStatePattern = /(?:^|;)(?:MicrosoftTeamsInstalled|MicrosoftTeamsInCall)(?:;|$)/;

interface MtrSchemaConventions {
  extensionKinds: Set<string>;
  commandUnavailableDenylist: boolean;
  hasMtrEvidence: boolean;
}

const mtrConventionCache = new WeakMap<SchemaSnapshot, MtrSchemaConventions>();

function mtrSchemaConventions(snapshot: SchemaSnapshot): MtrSchemaConventions {
  const cached = mtrConventionCache.get(snapshot);
  if (cached) return cached;
  const extensionKinds = new Set(
    snapshot.objects
      .filter((object) => object.attributes?.include_for_extension === 'mtr')
      .map((object) => object.type),
  );
  const commandUnavailableDenylist = snapshot.objects.some((object) => {
    if (object.type !== 'Command') return false;
    const unavailableStates = object.attributes?.unavailableStates;
    return typeof unavailableStates === 'string'
      && teamsUnavailableStatePattern.test(unavailableStates);
  });
  const conventions = {
    extensionKinds,
    commandUnavailableDenylist,
    hasMtrEvidence: extensionKinds.size > 0 || commandUnavailableDenylist,
  };
  mtrConventionCache.set(snapshot, conventions);
  return conventions;
}

function operatingModeEvidence(
  objects: SchemaObject[],
  snapshot: SchemaSnapshot,
): Pick<
  SchemaEvidence['operatingMode'],
  'supportsMtr' | 'basis'
> {
  const conventions = mtrSchemaConventions(snapshot);
  if (!conventions.hasMtrEvidence) {
    return { supportsMtr: false, basis: 'missing-metadata' };
  }
  const classifications = objects.map((object) => {
    const hasExtensionMarker = object.attributes?.include_for_extension === 'mtr';
    const unavailableStates = object.attributes?.unavailableStates;
    const hasTeamsUnavailableState = typeof unavailableStates === 'string'
      && teamsUnavailableStatePattern.test(unavailableStates);
    if (object.type === 'Command'
      && conventions.extensionKinds.has('Command')
      && conventions.commandUnavailableDenylist) {
      return { supportsMtr: null, basis: 'conflicting-metadata' as const };
    }
    if (object.type === 'Command' && conventions.extensionKinds.has('Command')) {
      return { supportsMtr: hasExtensionMarker, basis: 'extension-marker' as const };
    }
    if (object.type === 'Command' && conventions.commandUnavailableDenylist) {
      return {
        supportsMtr: !hasTeamsUnavailableState,
        basis: 'teams-unavailable-state' as const,
      };
    }
    if ((object.type === 'Configuration' || object.type === 'Status')
      && conventions.extensionKinds.has(object.type)) {
      return { supportsMtr: hasExtensionMarker, basis: 'extension-marker' as const };
    }
    if (object.type === 'Event' && conventions.hasMtrEvidence) {
      return { supportsMtr: true as const, basis: 'feature-dependent-event' as const };
    }
    return { supportsMtr: null, basis: 'missing-metadata' as const };
  });
  const supportValues = [...new Set(classifications.map((classification) => classification.supportsMtr))];
  if (supportValues.length !== 1) {
    return { supportsMtr: null, basis: 'conflicting-metadata' };
  }
  if (supportValues[0] === null && classifications.some((classification) =>
    classification.basis === 'conflicting-metadata')) {
    return { supportsMtr: null, basis: 'conflicting-metadata' };
  }
  return classifications[0] ?? { supportsMtr: null, basis: 'missing-metadata' };
}

function buildSchemaEvidence(
  reference: ExtractedReference,
  schemaObject: SchemaObject,
  target: AnalysisTarget,
  snapshot: SchemaSnapshot,
  match: {
    kind: 'exact' | 'parent';
    descendants?: SchemaObject[];
    objects?: SchemaObject[];
  },
): SchemaEvidence {
  const context = targetContext(target);
  const matchedObjects = match.objects ?? [schemaObject];
  const applicableObjects = context.productModel
    ? matchedObjects.filter((object) =>
        (object.products ?? []).length === 0 || object.products?.includes(context.productModel!))
    : matchedObjects;
  const evidenceObjects = applicableObjects.length > 0 ? applicableObjects : matchedObjects;
  const products = [...new Set(matchedObjects.flatMap((object) => object.products ?? []))].sort();
  const roles = [...new Set(evidenceObjects.flatMap((object) => allowedRoles(object, reference.operation)))].sort();
  const modeEvidence = operatingModeEvidence(evidenceObjects, snapshot);
  const productStatus: SchemaEvidence['product']['status'] = products.length === 0
    ? 'not-restricted'
    : !context.productModel
      ? 'not-declared'
      : products.includes(context.productModel)
        ? 'supported'
        : 'not-supported';
  const modeStatus: SchemaEvidence['operatingMode']['status'] = !context.operatingMode
    ? 'not-declared'
    : context.operatingMode === 'Native' || modeEvidence.supportsMtr === true
      ? 'supported'
      : modeEvidence.supportsMtr === false
        ? 'not-supported'
        : 'unknown';
  const roleStatus: SchemaEvidence['role']['status'] = roles.length === 0
    ? 'not-restricted'
    : !context.runtimeRole
      ? 'not-declared'
      : roles.includes(context.runtimeRole)
        ? 'supported'
        : 'not-supported';
  const configConstraint = reference.kind === 'Configuration'
    ? summarizeSpace(attributeSpace(schemaObject))
    : undefined;
  return {
    existsInSnapshot: true,
    matchKind: match.kind,
    ...(match.kind === 'exact' && schemaObject.id !== undefined ? { snapshotObjectId: schemaObject.id } : {}),
    ...(match.kind === 'parent' && match.descendants ? {
      descendantCount: match.descendants.length,
      descendantPaths: [...new Set(match.descendants.map((object) => object.normPath ?? object.path))]
        .sort()
        .slice(0, 12),
    } : {}),
    documentationUrl: documentationUrl(reference, schemaPath(schemaObject)),
    product: {
      status: productStatus,
      ...(context.productModel ? { declaredProduct: context.productModel } : {}),
      supportedProducts: products,
    },
    operatingMode: {
      status: modeStatus,
      ...(context.operatingMode ? { declaredMode: context.operatingMode } : {}),
      ...modeEvidence,
    },
    role: {
      status: roleStatus,
      ...(context.runtimeRole ? { declaredRole: context.runtimeRole } : {}),
      allowedRoles: roles,
    },
    parameters: summarizeParameters(schemaObject),
    ...(configConstraint && Object.keys(configConstraint).length > 0 ? { valueConstraint: configConstraint } : {}),
  };
}

function supportsParentPath(reference: ExtractedReference): boolean {
  if (reference.kind === 'Status') return reference.operation === 'get' || reference.operation === 'subscribe';
  if (reference.kind === 'Configuration') return reference.operation === 'get' || reference.operation === 'subscribe';
  return reference.kind === 'Event' && reference.operation === 'subscribe';
}

function descendantObjects(reference: ExtractedReference, snapshot: SchemaSnapshot): SchemaObject[] {
  if (!supportsParentPath(reference)) return [];
  const prefix = `${reference.path} `;
  return snapshot.objects.filter((object) =>
    object.type === reference.kind && (object.normPath ?? object.path).startsWith(prefix),
  );
}

function aggregateParentObject(reference: ExtractedReference, descendants: SchemaObject[]): SchemaObject {
  const roles = [...new Set(descendants.flatMap((object) => allowedRoles(object, reference.operation)))].sort();
  const products = [...new Set(descendants.flatMap((object) => object.products ?? []))].sort();
  return {
    type: reference.kind,
    path: reference.path,
    normPath: reference.path,
    products,
    attributes: {
      role: roles,
    },
  };
}

function validateLiteral(
  value: unknown,
  space: Record<string, unknown>,
  label: string,
): FindingSpec[] {
  if (value === undefined) return [];
  const findings: FindingSpec[] = [];
  const minimum = numberValue(space.Min ?? space.minimum);
  const maximum = numberValue(space.Max ?? space.maximum);
  const numeric = numberValue(value);
  if (numeric !== undefined && ((minimum !== undefined && numeric < minimum) || (maximum !== undefined && numeric > maximum))) {
    findings.push({
      code: 'schema.literal-out-of-range',
      title: `${label} is outside the schema range`,
      message: 'A statically known argument value is outside the range declared by the selected schema.',
      evidence: 'potential-risk',
      priority: 'required',
      details: { label, minimum, maximum },
    });
  }
  const values = (space.Values ?? space.values) as unknown;
  if (Array.isArray(values) && !values.some((candidate) => candidate === value)) {
    findings.push({
      code: 'schema.literal-not-allowed',
      title: `${label} is not an allowed schema value`,
      message: 'A statically known argument value is not in the value set declared by the selected schema.',
      evidence: 'potential-risk',
      priority: 'required',
      details: { label, allowedValues: values },
    });
  }
  return findings;
}

function validateArguments(reference: ExtractedReference, schemaObject: SchemaObject): FindingSpec[] {
  if (reference.kind === 'Configuration' && reference.operation === 'set') {
    return validateLiteral(reference.literalValue, attributeSpace(schemaObject), reference.path);
  }
  if (reference.kind !== 'Command') return [];

  const parameters = schemaObject.attributes?.params ?? [];
  const findings: FindingSpec[] = [];
  const knownNames = new Set(parameters.map((parameter) => parameter.name));
  const suppliedNames = new Set(reference.knownArgumentNames);
  for (const parameter of parameters) {
    if (parameter.required && reference.argumentCoverage === 'complete' && !suppliedNames.has(parameter.name)) {
      findings.push({
        code: 'schema.required-parameter-missing',
        title: `Required parameter ${parameter.name} is missing`,
        message: `${reference.path} requires the ${parameter.name} parameter in the selected schema.`,
        evidence: 'potential-risk',
        priority: 'required',
        details: { parameter: parameter.name },
      });
    }
    if (parameter.name in reference.literalArguments) {
      findings.push(...validateLiteral(
        reference.literalArguments[parameter.name],
        parameterSpace(parameter),
        parameter.name,
      ));
    }
  }
  for (const name of Object.keys(reference.literalArguments)) {
    if (!knownNames.has(name)) {
      findings.push({
        code: 'schema.unknown-parameter',
        title: `Parameter ${name} is not declared`,
        message: `${reference.path} does not declare a ${name} parameter in the selected schema.`,
        evidence: 'potential-risk',
        priority: 'required',
        details: { parameter: name },
      });
    }
  }
  return findings;
}

export function matchSchema(
  reference: ExtractedReference,
  target: AnalysisTarget,
  snapshot: SchemaSnapshot,
): SchemaMatchResult {
  const context = targetContext(target);
  const caseExactSchemaObjects = snapshot.objects.filter((object) =>
    object.type === reference.kind && schemaPath(object) === reference.path,
  );
  const caseInsensitiveSchemaObjects = caseExactSchemaObjects.length > 0
    ? []
    : snapshot.objects.filter((object) =>
        object.type === reference.kind && samePathIgnoringCase(schemaPath(object), reference.path));
  const hasUniqueCanonicalPath = new Set(caseInsensitiveSchemaObjects.map(schemaPath)).size === 1;
  const exactSchemaObjects = caseExactSchemaObjects.length > 0
    ? caseExactSchemaObjects
    : hasUniqueCanonicalPath
      ? caseInsensitiveSchemaObjects
      : [];
  const exactSchemaObject = exactSchemaObjects[0];
  const pathCasingMismatch = caseExactSchemaObjects.length === 0 && exactSchemaObject !== undefined;
  const descendants = exactSchemaObject ? [] : descendantObjects(reference, snapshot);
  if (!exactSchemaObject && descendants.length === 0) {
    return {
      availability: target.kind === 'declared'
        ? 'not-in-declared-schema'
        : 'unknown-in-exploratory-analysis',
      schemaEvidence: absentSchemaEvidence(reference),
      findingSpecs: target.kind === 'declared' ? [{
        code: 'schema.api-not-available',
        title: `${reference.kind} is not in the selected RoomOS schema`,
        message: `${reference.path} is not present in schema snapshot ${snapshot.id}.`,
        evidence: 'potential-risk',
        priority: 'required',
      }] : [],
    };
  }
  const isParentPath = !exactSchemaObject;
  const schemaObject = exactSchemaObject ?? aggregateParentObject(reference, descendants);
  const schemaEvidence = buildSchemaEvidence(reference, schemaObject, target, snapshot, {
    kind: isParentPath ? 'parent' : 'exact',
    ...(isParentPath ? { descendants } : {}),
    objects: isParentPath ? descendants : exactSchemaObjects,
  });
  const findingSpecs: FindingSpec[] = target.kind === 'exploratory'
    ? []
    : isParentPath
    ? [{
        code: 'schema.parent-path-match',
        title: `${reference.path} is a parent xAPI path`,
        message: `${reference.path} is not a complete leaf path. The selected schema contains ${descendants.length} descendant ${reference.kind.toLowerCase()} paths beneath it.`,
        evidence: 'observed-finding' as const,
        priority: 'informational' as const,
        limitations: ['This confirms a parent-to-descendant schema relationship. The values returned by an endpoint still depend on its product, configuration, physical I/O, and runtime state.'],
        recommendedAction: 'No change is required when reading or subscribing to the entire branch is intentional. Use a descendant path when the macro needs one specific value.',
        details: {
          descendantCount: descendants.length,
          descendantPaths: schemaEvidence.descendantPaths,
        },
      }]
    : validateArguments(reference, schemaObject);
  if (pathCasingMismatch) {
    const canonicalPath = schemaPath(exactSchemaObject);
    findingSpecs.push({
      code: 'schema.path-casing-mismatch',
      title: 'An xAPI path uses noncanonical casing',
      message: `The selected schema spells this xAPI path ${canonicalPath}.`,
      evidence: 'observed-finding',
      priority: 'advisory',
      basis: `The submitted spelling differs from canonical path ${canonicalPath} in schema snapshot ${snapshot.id}.`,
      limitations: ['This confirms a case-only difference between the submitted source and pinned schema; it does not describe observed endpoint behavior.'],
      recommendedAction: `Use the schema spelling ${canonicalPath} so the source matches the canonical xAPI path.`,
      details: {
        schemaPath: canonicalPath,
      },
    });
  }
  if (schemaEvidence.product.status === 'not-supported') {
    findingSpecs.push({
        code: 'schema.product-restriction',
        title: `${reference.path} is not listed for this product`,
        message: `The API exists in the selected schema but is not listed for ${context.productModel}.`,
        evidence: 'potential-risk',
        priority: 'required',
    });
  }
  if (schemaEvidence.operatingMode.status === 'not-supported') {
    const snapshotHasNoContainerMetadata =
      schemaEvidence.operatingMode.basis === 'missing-metadata';
    findingSpecs.push({
        code: 'schema.operating-mode-restriction',
        title: `${reference.path} is not listed for the Android Container`,
        message: snapshotHasNoContainerMetadata
          ? 'The selected schema contains no Android Container availability metadata, so this RoomOS release is treated as not supporting the Android Container.'
          : 'The API exists in the selected schema but is not marked as available to the Android Container.',
        evidence: 'potential-risk',
        priority: 'required',
        basis: `Operating-mode metadata basis: ${schemaEvidence.operatingMode.basis}.`,
    });
  }
  if (schemaEvidence.operatingMode.status === 'unknown') {
    findingSpecs.push({
      code: 'schema.operating-mode-unknown',
      title: `${reference.path} Android Container availability is unknown`,
      message: 'The API exists in the selected schema, but the applicable schema evidence does not establish Android Container availability.',
      evidence: 'unknown',
      priority: 'advisory',
      basis: `Operating-mode metadata basis: ${schemaEvidence.operatingMode.basis}.`,
      limitations: ['Unknown is retained when a metadata-bearing snapshot has no applicable convention for this xAPI kind or when product variants conflict.'],
      recommendedAction: 'Verify the path on the intended Android Container deployment or consult product-specific documentation.',
    });
  }
  if (schemaEvidence.role.status === 'not-supported') {
    findingSpecs.push({
        code: 'schema.runtime-role-restriction',
        title: `${reference.path} is not available to ${context.runtimeRole}`,
        message: `The API exists in the selected schema but requires one of these roles: ${schemaEvidence.role.allowedRoles.join(', ')}.`,
        evidence: 'potential-risk',
        priority: 'required',
    });
  }
  const completeTarget = Boolean(context.productModel && context.operatingMode && context.runtimeRole);
  const availability: ApiAvailability = target.kind === 'exploratory'
    ? 'unknown-in-exploratory-analysis'
    : schemaEvidence.product.status === 'not-supported'
    ? 'unavailable-for-product'
    : schemaEvidence.operatingMode.status === 'not-supported'
      ? 'unavailable-for-mode'
      : schemaEvidence.operatingMode.status === 'unknown'
        ? 'unknown-for-mode'
      : schemaEvidence.role.status === 'not-supported'
        ? 'unavailable-for-role'
        : completeTarget
          ? 'available-in-declared-schema'
          : 'available-in-selected-schema';
  return {
    availability,
    ...(exactSchemaObject ? { schemaObject: exactSchemaObject } : {}),
    schemaEvidence,
    findingSpecs,
  };
}
