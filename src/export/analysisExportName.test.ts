import { describe, expect, it } from 'vitest';
import {
  defaultAnalysisExportName,
  normalizeAnalysisExportName,
} from './analysisExportName';

describe('analysis export names', () => {
  it('defaults a manual analysis name from its analysis date', () => {
    expect(defaultAnalysisExportName({
      generatedAt: '2026-07-29T14:00:00.000Z',
    })).toBe('macro_analysis_2026-07-29');
  });

  it('includes a filesystem-safe endpoint name when one supplied the Macro Set', () => {
    expect(defaultAnalysisExportName({
      generatedAt: '2026-07-29T14:00:00.000Z',
      endpointName: 'Board Room / East',
    })).toBe('macro_analysis_Board_Room_East_2026-07-29');
  });

  it('normalizes an edited report name and removes a repeated ZIP extension', () => {
    expect(normalizeAnalysisExportName(
      '  Quarterly Room Review.zip  ',
      'macro_analysis_2026-07-29',
    )).toBe('Quarterly_Room_Review');
    expect(normalizeAnalysisExportName(
      '***.zip',
      'macro_analysis_2026-07-29',
    )).toBe('macro_analysis_2026-07-29');
  });
});
