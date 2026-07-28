import { describe, expect, it, vi } from 'vitest';
import { createProductTelemetry, isLoopbackHostname } from './productTelemetry';

function mockSdk() {
  return {
    init: vi.fn(),
    trackEvent: vi.fn().mockResolvedValue(undefined),
  };
}

describe('Aptabase Product Telemetry', () => {
  it('uses the debug pool only on loopback hosts', () => {
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('::1')).toBe(true);
    expect(isLoopbackHostname('macro-analyzer.localhost')).toBe(true);
    expect(isLoopbackHostname('ctg-tme.github.io')).toBe(false);
  });

  it('is a safe no-op when the app key is missing', () => {
    const sdk = mockSdk();
    const telemetry = createProductTelemetry({
      appKey: '',
      appVersion: '0.3.0-BETA',
      hostname: 'localhost',
      sdk,
    });

    expect(telemetry.initialize()).toBe(false);
    telemetry.trackEndpointConnected();
    telemetry.trackManualMacrosLoaded();
    telemetry.trackMacroAnalysisCompleted({
      macroCount: 2,
      macrosWithImportSyntax: 1,
      macrosWithExportSyntax: 1,
      macrosWithImportOrExportSyntax: 2,
    }, 'manual');

    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.trackEvent).not.toHaveBeenCalled();
  });

  it('initializes debug telemetry locally and sends only allowlisted fields', () => {
    const sdk = mockSdk();
    const telemetry = createProductTelemetry({
      appKey: 'A-US-test',
      appVersion: '0.3.0-BETA',
      hostname: '127.0.0.1',
      sdk,
    });

    telemetry.trackEndpointConnected();
    telemetry.trackManualMacrosLoaded();
    telemetry.trackMacroAnalysisCompleted({
      macroCount: 4,
      macrosWithImportSyntax: 2,
      macrosWithExportSyntax: 1,
      macrosWithImportOrExportSyntax: 2,
    }, 'endpoint');

    expect(sdk.init).toHaveBeenCalledOnce();
    expect(sdk.init).toHaveBeenCalledWith('A-US-test', {
      appVersion: '0.3.0-BETA',
      isDebug: true,
    });
    expect(sdk.trackEvent.mock.calls).toEqual([
      ['endpoint_connected', undefined],
      ['manual_macros_loaded', undefined],
      ['macro_analysis_completed', {
        inputSource: 'endpoint',
        macroCount: 4,
        macrosWithImportSyntax: 2,
        macrosWithExportSyntax: 1,
        macrosWithImportOrExportSyntax: 2,
      }],
    ]);
  });

  it('uses the public pool outside local development', () => {
    const sdk = mockSdk();
    createProductTelemetry({
      appKey: 'A-US-test',
      appVersion: '0.3.0-BETA',
      hostname: 'ctg-tme.github.io',
      sdk,
    }).initialize();

    expect(sdk.init).toHaveBeenCalledWith('A-US-test', {
      appVersion: '0.3.0-BETA',
      isDebug: false,
    });
  });
});
