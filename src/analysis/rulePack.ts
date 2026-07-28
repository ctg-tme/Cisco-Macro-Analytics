import {
  CREDENTIAL_VOCABULARY_VERSION,
  RECOGNIZED_MACRO_GLOBALS_VERSION,
} from './internal/sourceFacts';
import type {
  AnalysisRule,
  AnalysisRuleCode,
  EffectiveAnalysisRule,
  EffectiveRulePack,
  ReviewPriority,
  RuleApplicability,
  RulePack,
} from './types';

const RULE_PACK_VERSION = '2.1.0';

function rule(
  code: AnalysisRuleCode,
  title: string,
  priority: ReviewPriority,
  applicability: RuleApplicability = 'target-independent',
  citation?: string,
): EffectiveAnalysisRule {
  return {
    code,
    id: code,
    title,
    enabled: true,
    priority,
    version: RULE_PACK_VERSION,
    applicability,
    ...(citation ? { citation } : {}),
  };
}

export const SUPPORTED_RULES: readonly EffectiveAnalysisRule[] = [
  rule('coverage.parse-failure', 'JavaScript Parse Failure', 'warning'),
  rule('coverage.dynamic-import', 'Dynamic Import Coverage Gap', 'warning'),
  rule('coverage.xapi-flow-frontier', 'xAPI Flow Frontier', 'warning'),
  rule('coverage.missing-dependency', 'Missing Dependency', 'warning'),
  rule(
    'source.commonjs-migration',
    'CommonJS Migration Requirement',
    'required',
    'target-independent',
    'https://roomos.cisco.com/doc/TechDocs/MacroTutorial',
  ),
  rule('source.sensitive-credential-indicator', 'Authentication Vocabulary Review', 'warning'),
  rule('source.nonstandard-xapi-root', 'Nonstandard xAPI Root Binding', 'warning'),
  rule('source.old-style-xapi', 'Old-style xAPI Usage', 'advisory'),
  rule('source.mixed-xapi-syntax', 'Mixed xAPI Syntax', 'advisory'),
  rule('source.xapi-abstraction', 'xAPI Abstraction', 'informational'),
  rule('source.repeated-xapi-reference', 'Repeated xAPI Reference', 'advisory'),
  rule('source.duplicate-subscription', 'Duplicate Subscription Registration', 'advisory'),
  rule('source.linked-cross-macro-xapi-overlap', 'Linked Macro xAPI Overlap', 'advisory'),
  rule('source.separate-cross-macro-xapi-overlap', 'Separate Macro xAPI Overlap', 'informational'),
  rule('schema.api-not-available', 'xAPI Not in Selected Schema', 'required', 'target-dependent'),
  rule('schema.parent-path-match', 'Parent xAPI Path', 'informational', 'target-dependent'),
  rule('schema.path-casing-mismatch', 'Noncanonical xAPI Path Casing', 'advisory', 'target-dependent'),
  rule('schema.required-parameter-missing', 'Required Parameter Missing', 'required', 'target-dependent'),
  rule('schema.unknown-parameter', 'Parameter Not Declared', 'required', 'target-dependent'),
  rule('schema.literal-out-of-range', 'Literal Outside Schema Range', 'required', 'target-dependent'),
  rule('schema.literal-not-allowed', 'Literal Not Allowed by Schema', 'required', 'target-dependent'),
  rule('schema.product-restriction', 'Product Restriction', 'required', 'target-dependent'),
  rule('schema.operating-mode-restriction', 'Operating-mode Restriction', 'required', 'target-dependent'),
  rule('schema.operating-mode-unknown', 'Operating-mode Availability Unknown', 'advisory', 'target-dependent'),
  rule('schema.runtime-role-restriction', 'Runtime-role Restriction', 'required', 'target-dependent'),
];

export const DEFAULT_RULE_PACK: RulePack = {
  id: 'roomos-macro-rules',
  version: RULE_PACK_VERSION,
  rules: SUPPORTED_RULES.map((supported) => ({ ...supported })),
  credentialVocabularyVersion: CREDENTIAL_VOCABULARY_VERSION,
  recognizedMacroGlobalsVersion: RECOGNIZED_MACRO_GLOBALS_VERSION,
};

function configuredCode(ruleInput: AnalysisRule): AnalysisRuleCode | undefined {
  if (ruleInput.code) return ruleInput.code;
  if (ruleInput.kind === 'commonjs-migration' || ruleInput.kind === 'commonjs-deprecation') {
    return 'source.commonjs-migration';
  }
  return undefined;
}

export function resolveEffectiveRulePack(rulePack: RulePack): EffectiveRulePack {
  const overrides = new Map<AnalysisRuleCode, AnalysisRule>();
  for (const configuredRule of rulePack.rules) {
    const code = configuredCode(configuredRule);
    if (code) overrides.set(code, configuredRule);
  }

  return {
    id: rulePack.id,
    version: rulePack.version,
    rules: SUPPORTED_RULES.map((supported) => {
      const override = overrides.get(supported.code);
      if (!override) return { ...supported, version: rulePack.version };
      return {
        ...supported,
        id: override.id,
        title: override.title,
        enabled: override.enabled ?? supported.enabled,
        priority: override.priority ?? supported.priority,
        version: override.version ?? rulePack.version,
        applicability: override.applicability ?? supported.applicability,
        ...(override.citation
          ? { citation: override.citation }
          : supported.citation
            ? { citation: supported.citation }
            : {}),
      };
    }),
    credentialVocabularyVersion:
      rulePack.credentialVocabularyVersion ?? CREDENTIAL_VOCABULARY_VERSION,
    recognizedMacroGlobalsVersion:
      rulePack.recognizedMacroGlobalsVersion ?? RECOGNIZED_MACRO_GLOBALS_VERSION,
  };
}
