import { init, trackEvent } from '@aptabase/web';
import manifest from '../../manifest.json';
import type { MacroTelemetrySummary } from './macroSummary';

export type MacroInputSource = 'endpoint' | 'manual';

interface AptabaseAdapter {
  init: typeof init;
  trackEvent: typeof trackEvent;
}

interface ProductTelemetryOptions {
  appKey?: string;
  appVersion: string;
  hostname: string;
  sdk?: AptabaseAdapter;
}

export interface ProductTelemetry {
  initialize(): boolean;
  trackEndpointConnected(): void;
  trackManualMacrosLoaded(): void;
  trackMacroAnalysisCompleted(
    summary: MacroTelemetrySummary,
    inputSource: MacroInputSource,
  ): void;
}

export function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.endsWith('.localhost');
}

export function createProductTelemetry({
  appKey,
  appVersion,
  hostname,
  sdk = { init, trackEvent },
}: ProductTelemetryOptions): ProductTelemetry {
  const configuredKey = appKey?.trim() ?? '';
  let initialized = false;
  let enabled = false;

  function initialize(): boolean {
    if (initialized) return enabled;
    initialized = true;
    if (!configuredKey) return false;

    try {
      sdk.init(configuredKey, {
        appVersion,
        isDebug: isLoopbackHostname(hostname),
      });
      enabled = true;
    } catch {
      console.warn('Aptabase Product Telemetry is unavailable.');
    }
    return enabled;
  }

  function send(
    eventName: 'endpoint_connected' | 'manual_macros_loaded' | 'macro_analysis_completed',
    properties?: Record<string, string | number>,
  ): void {
    if (!initialize()) return;
    void sdk.trackEvent(eventName, properties).catch(() => {
      console.warn('Aptabase Product Telemetry could not send an event.');
    });
  }

  return {
    initialize,
    trackEndpointConnected() {
      send('endpoint_connected');
    },
    trackManualMacrosLoaded() {
      send('manual_macros_loaded');
    },
    trackMacroAnalysisCompleted(summary, inputSource) {
      send('macro_analysis_completed', {
        inputSource,
        macroCount: summary.macroCount,
        macrosWithImportSyntax: summary.macrosWithImportSyntax,
        macrosWithExportSyntax: summary.macrosWithExportSyntax,
        macrosWithImportOrExportSyntax: summary.macrosWithImportOrExportSyntax,
      });
    },
  };
}

const browserTelemetry = createProductTelemetry({
  appKey: import.meta.env.VITE_APTABASE_APP_KEY,
  appVersion: manifest.Version,
  hostname: typeof window === 'undefined' ? '' : window.location.hostname,
});

export const initializeProductTelemetry = (): boolean => browserTelemetry.initialize();
export const trackEndpointConnected = (): void => browserTelemetry.trackEndpointConnected();
export const trackManualMacrosLoaded = (): void => browserTelemetry.trackManualMacrosLoaded();
export const trackMacroAnalysisCompleted = (
  summary: MacroTelemetrySummary,
  inputSource: MacroInputSource,
): void => browserTelemetry.trackMacroAnalysisCompleted(summary, inputSource);
