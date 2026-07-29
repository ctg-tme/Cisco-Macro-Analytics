interface DefaultAnalysisExportNameInput {
  generatedAt: string;
  endpointName?: string;
}

function safeNameSegment(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');
}

export function defaultAnalysisExportName(
  input: DefaultAnalysisExportNameInput,
): string {
  const date = input.generatedAt.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? 'undated';
  const endpointName = safeNameSegment(input.endpointName ?? '');
  return endpointName
    ? `macro_analysis_${endpointName}_${date}`
    : `macro_analysis_${date}`;
}

export function normalizeAnalysisExportName(
  value: string,
  fallback: string,
): string {
  const withoutZip = value.trim().replace(/\.zip$/i, '');
  return safeNameSegment(withoutZip).slice(0, 120)
    || safeNameSegment(fallback).slice(0, 120)
    || 'macro_analysis';
}
