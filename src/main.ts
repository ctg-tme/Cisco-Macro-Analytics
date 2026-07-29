import './style-entry';
import manifest from '../manifest.json';
import { analyzeMacroSet } from './analysis/analyzeMacroSet';
import { buildIncludedMacroSet } from './analysis/macroSetSelection';
import {
  buildSchemaCoverage,
  type ReferenceSchemaCoverage,
  type SchemaCoverage,
  type SchemaVersionAnalysis,
  type SchemaVersionIdentity,
  type VersionSchemaCoverage,
} from './analysis/schemaCoverage';
import type {
  AnalysisObservation,
  AnalysisReport,
  ApiKind,
  ApiReference,
  Finding,
  MacroFile,
  SourceReference,
  XapiBindingRoute,
} from './analysis/types';
import { calculateAndroidContainerReadiness } from './presentation/androidContainerReadiness';
import {
  buildDependencyMap,
  collectDependencyMapFocus,
  renderDependencyMapSvg,
  type DependencyMapModel,
} from './presentation/dependencyMap';
import { groupFindingsByMacro } from './presentation/findingGroups';
import { buildSourceSnippet } from './presentation/sourceSnippet';
import {
  groupReferences,
  groupReferencesByMacro,
  type ReferenceGroup,
} from './presentation/referenceGroups';
import {
  isWinterActive,
  loadThemeMode,
  parseThemeMode,
  resolvesToDarkTheme,
  saveThemeMode,
  type ThemeMode,
} from './presentation/theme';
import {
  connectToEndpoint,
  getEndpointBroadcastName,
  getEndpointMacros,
  normalizeEndpointHost,
  type EndpointMacro,
  type EndpointXapi,
} from './endpoint/device';
import {
  loadRecentEndpoints,
  saveRecentEndpoint,
  type RecentEndpoint,
} from './endpoint/recentDevices';
import {
  groupAndroidContainerIssuesByMacro,
  type AndroidContainerIssueGroup,
  type AndroidContainerIssueReason,
} from './presentation/androidContainerIssueGroups';
import { summarizeMacroSyntax } from './analytics/macroSummary';
import {
  initializeProductTelemetry,
  trackEndpointConnected,
  trackMacroAnalysisCompleted,
  trackManualMacrosLoaded,
} from './analytics/productTelemetry';
import {
  loadVerifiedSchema,
  type CatalogSnapshot,
  type VerifiedSchema,
} from './schemaCatalog';
import { DEFAULT_RULE_PACK, resolveEffectiveRulePack } from './analysis/rulePack';
import {
  buildAnalysisSession,
  deriveAnalysisSessionPresentation,
  type AnalysisSessionPresentation,
  type AnalysisSessionResult,
  type AnalysisSessionSchema,
} from './analysis/analysisSession';
import { importAnalysisSessionJson } from './analysis/analysisSessionImportClient';
import { summarizeSubscriptions } from './analysis/subscriptionAnalytics';
import { createAnalysisExportBlob } from './export/analysisExportClient';
import {
  defaultAnalysisExportName,
  normalizeAnalysisExportName,
} from './export/analysisExportName';

interface SchemaCatalog {
  schemaVersion: string;
  selectionPolicy: string;
  snapshots: CatalogSnapshot[];
  quarantined: Array<{ filename: string; reason: string }>;
}

interface MacroSelection {
  file: MacroFile;
  included: boolean;
  byteSize: number;
  active?: boolean;
}

interface EndpointSession {
  host: string;
  broadcastName: string;
  macroCount: number;
  xapi: EndpointXapi;
}

type FindingFilter = 'all' | 'needs-review' | 'recommendation' | 'unknown';
type FindingScope = { fileId: string };

const rulePack = DEFAULT_RULE_PACK;
const effectiveRulePack = resolveEffectiveRulePack(rulePack);

const state: {
  catalog?: SchemaCatalog;
  files: MacroSelection[];
  analysis?: AnalysisSessionResult;
  analysisError?: string;
  analysisImportError?: string;
  importedAnalysisName?: string;
  endpoint?: EndpointSession;
  recentEndpoints: RecentEndpoint[];
  findingFilter: FindingFilter;
  findingScope?: FindingScope;
  dismissedIssueLocations: Map<string, Set<string>>;
  referenceSearch: string;
  referenceKind: 'all' | ApiKind;
} = {
  files: [],
  recentEndpoints: loadRecentEndpoints(),
  findingFilter: 'all',
  dismissedIssueLocations: new Map(),
  referenceSearch: '',
  referenceKind: 'all',
};

const systemColorScheme = window.matchMedia('(prefers-color-scheme: dark)');

function applyThemeMode(mode: ThemeMode): void {
  const dark = resolvesToDarkTheme(mode, systemColorScheme.matches);
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.dataset.cdsTheme = dark ? 'magnetic-dark' : 'magnetic-light';
}

let themeMode = loadThemeMode();
applyThemeMode(themeMode);

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

const elements = {
  body: document.body,
  appVersion: byId<HTMLElement>('app-version'),
  currentYear: byId<HTMLElement>('current-year'),
  themeSelect: byId<HTMLSelectElement>('theme-select'),
  winterSnowfall: byId<HTMLDivElement>('winter-snowfall'),
  aboutButton: byId<HTMLButtonElement>('about-button'),
  privacyButton: byId<HTMLButtonElement>('privacy-button'),
  aboutDialog: byId<HTMLDialogElement>('about-dialog'),
  privacyDialog: byId<HTMLDialogElement>('privacy-dialog'),
  endpointButton: byId<HTMLButtonElement>('endpoint-button'),
  endpointButtonLabel: byId<HTMLSpanElement>('endpoint-button-label'),
  endpointDialog: byId<HTMLDialogElement>('endpoint-dialog'),
  endpointDisconnectDialog: byId<HTMLDialogElement>('endpoint-disconnect-dialog'),
  endpointForm: byId<HTMLFormElement>('endpoint-form'),
  recentEndpoints: byId<HTMLDivElement>('recent-endpoints'),
  recentEndpointList: byId<HTMLDivElement>('recent-endpoint-list'),
  endpointHost: byId<HTMLInputElement>('endpoint-host'),
  endpointUsername: byId<HTMLInputElement>('endpoint-username'),
  endpointPassword: byId<HTMLInputElement>('endpoint-password'),
  endpointError: byId<HTMLDivElement>('endpoint-error'),
  endpointCertificateLink: byId<HTMLAnchorElement>('endpoint-certificate-link'),
  endpointConnectSubmit: byId<HTMLButtonElement>('endpoint-connect-submit'),
  endpointDisconnectConfirm: byId<HTMLButtonElement>('endpoint-disconnect-confirm'),
  analysisPurgeDialog: byId<HTMLDialogElement>('analysis-purge-dialog'),
  analysisPurgeMessage: byId<HTMLParagraphElement>('analysis-purge-message'),
  analysisPurgeConfirm: byId<HTMLButtonElement>('analysis-purge-confirm'),
  catalogStatus: byId<HTMLSpanElement>('catalog-status'),
  analysisScopeCount: byId<HTMLParagraphElement>('analysis-scope-count'),
  scopeVersionCount: byId<HTMLSpanElement>('scope-version-count'),
  fileInput: byId<HTMLInputElement>('file-input'),
  analysisImportInput: byId<HTMLInputElement>('analysis-import-input'),
  analysisImportButton: byId<HTMLButtonElement>('analysis-import-button'),
  dropZone: byId<HTMLLabelElement>('drop-zone'),
  manualSourceActions: byId<HTMLDivElement>('manual-source-actions'),
  sourceDivider: byId<HTMLDivElement>('source-divider'),
  sourceGuidance: byId<HTMLParagraphElement>('source-guidance'),
  endpointSource: byId<HTMLDivElement>('endpoint-source'),
  endpointSourceName: byId<HTMLElement>('endpoint-source-name'),
  endpointSourceDetail: byId<HTMLParagraphElement>('endpoint-source-detail'),
  endpointConnectedBadge: byId<HTMLSpanElement>('endpoint-connected-badge'),
  uploadTitle: byId<HTMLHeadingElement>('upload-title'),
  demoButton: byId<HTMLButtonElement>('demo-button'),
  clearButton: byId<HTMLButtonElement>('clear-button'),
  fileCount: byId<HTMLSpanElement>('file-count'),
  macroListSummary: byId<HTMLDivElement>('macro-list-summary'),
  macroListSummaryTitle: byId<HTMLElement>('macro-list-summary-title'),
  macroListSummaryDetail: byId<HTMLParagraphElement>('macro-list-summary-detail'),
  macroListButton: byId<HTMLButtonElement>('macro-list-button'),
  macroListDialog: byId<HTMLDialogElement>('macro-list-dialog'),
  macroListDialogContext: byId<HTMLParagraphElement>('macro-list-dialog-context'),
  macroSelectionCount: byId<HTMLSpanElement>('macro-selection-count'),
  macroSelectAll: byId<HTMLButtonElement>('macro-select-all'),
  macroClearAll: byId<HTMLButtonElement>('macro-clear-all'),
  fileListWrap: byId<HTMLDivElement>('file-list-wrap'),
  fileList: byId<HTMLUListElement>('file-list'),
  analyzeButton: byId<HTMLButtonElement>('analyze-button'),
  readinessMessage: byId<HTMLParagraphElement>('readiness-message'),
  analysisProgress: byId<HTMLDivElement>('analysis-progress'),
  analysisProgressTrack: byId<HTMLDivElement>('analysis-progress-track'),
  analysisProgressFill: byId<HTMLElement>('analysis-progress-fill'),
  analysisProgressValue: byId<HTMLElement>('analysis-progress-value'),
  results: byId<HTMLElement>('results'),
  resultContext: byId<HTMLParagraphElement>('result-context'),
  exportButton: byId<HTMLButtonElement>('export-button'),
  exportDialog: byId<HTMLDialogElement>('export-dialog'),
  exportName: byId<HTMLInputElement>('export-name'),
  exportAnalysisButton: byId<HTMLButtonElement>('export-analysis-button'),
  exportAnalysisStatus: byId<HTMLElement>('export-analysis-status'),
  relationshipsTabCount: byId<HTMLSpanElement>('relationships-tab-count'),
  issuesTabCount: byId<HTMLSpanElement>('issues-tab-count'),
  androidContainerTabCount: byId<HTMLSpanElement>('android-container-tab-count'),
  xapiTabCount: byId<HTMLSpanElement>('xapi-tab-count'),
  macroOverviewList: byId<HTMLDivElement>('macro-overview-list'),
  macroRelationships: byId<HTMLDivElement>('macro-relationships'),
  dependencyMapDialog: byId<HTMLDialogElement>('dependency-map-dialog'),
  dependencyMapTitle: byId<HTMLHeadingElement>('dependency-map-title'),
  dependencyMapContext: byId<HTMLParagraphElement>('dependency-map-context'),
  dependencyMapSummary: byId<HTMLDivElement>('dependency-map-summary'),
  dependencyMapCanvas: byId<HTMLDivElement>('dependency-map-canvas'),
  dependencyMapShowComments: byId<HTMLInputElement>('dependency-map-show-comments'),
  dependencyMapDownload: byId<HTMLButtonElement>('dependency-map-download'),
  dependencyMapDownloadLabel: byId<HTMLSpanElement>('dependency-map-download-label'),
  dependencyMapZoomOut: byId<HTMLButtonElement>('dependency-map-zoom-out'),
  dependencyMapFit: byId<HTMLButtonElement>('dependency-map-fit'),
  dependencyMapZoomIn: byId<HTMLButtonElement>('dependency-map-zoom-in'),
  dependencyMapZoomValue: byId<HTMLOutputElement>('dependency-map-zoom-value'),
  dependencyUrlInspector: byId<HTMLElement>('dependency-url-inspector'),
  dependencyUrlInspectorTitle: byId<HTMLHeadingElement>('dependency-url-inspector-title'),
  dependencyUrlInspectorContent: byId<HTMLDivElement>('dependency-url-inspector-content'),
  dependencyUrlInspectorClose: byId<HTMLButtonElement>('dependency-url-inspector-close'),
  dependencyUrlPrevious: byId<HTMLButtonElement>('dependency-url-previous'),
  dependencyUrlNext: byId<HTMLButtonElement>('dependency-url-next'),
  dependencyUrlPosition: byId<HTMLSpanElement>('dependency-url-position'),
  androidContainerReadinessDetail: byId<HTMLDivElement>('android-container-readiness-detail'),
  androidContainerIssueSummary: byId<HTMLDivElement>('android-container-issue-summary'),
  androidContainerIssueList: byId<HTMLDivElement>('android-container-issue-list'),
  coverageContent: byId<HTMLDivElement>('coverage-content'),
  findingFilters: byId<HTMLDivElement>('finding-filters'),
  findingList: byId<HTMLDivElement>('finding-list'),
  xapiSearch: byId<HTMLInputElement>('xapi-search'),
  xapiKindFilter: byId<HTMLSelectElement>('xapi-kind-filter'),
  referenceList: byId<HTMLDivElement>('reference-list'),
};

elements.appVersion.textContent = `v${manifest.Version}`;
elements.currentYear.textContent = String(new Date().getFullYear());

elements.themeSelect.value = themeMode;

function applySeasonalPresentation(): void {
  const previewOverride = new URLSearchParams(window.location.search).get('winter') === 'true';
  const winterActive = isWinterActive(new Date(), previewOverride);
  elements.body.classList.toggle('winter-theme', winterActive);
  elements.winterSnowfall.hidden = !winterActive;
  const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog');

  if (winterActive) {
    const snowflakes = Array.from({ length: 18 }, () => {
      const snowflake = document.createElement('span');
      snowflake.textContent = '❄';
      return snowflake;
    });
    elements.winterSnowfall.replaceChildren(...snowflakes);

    for (const dialog of dialogs) {
      const modalSnowfall = document.createElement('div');
      modalSnowfall.className = 'winter-modal-snowfall';
      modalSnowfall.ariaHidden = 'true';
      modalSnowfall.replaceChildren(...Array.from({ length: 10 }, () => {
        const snowflake = document.createElement('span');
        snowflake.textContent = '❄';
        return snowflake;
      }));
      dialog.querySelector('.winter-modal-snowfall')?.remove();
      dialog.append(modalSnowfall);
    }
  } else {
    for (const dialog of dialogs) {
      dialog.querySelector('.winter-modal-snowfall')?.remove();
    }
  }
}

applySeasonalPresentation();

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function updateReadiness(): void {
  const messages: string[] = [];
  if (state.files.length === 0) messages.push('add a macro file');
  if (state.files.length > 0 && !state.files.some((selection) => selection.included)) {
    messages.push('include at least one file in analysis');
  }
  if (!state.catalog) messages.push('wait for the RoomOS schema catalog');
  elements.analyzeButton.disabled = messages.length > 0;
  const hasError = Boolean(state.analysisError || state.analysisImportError);
  elements.readinessMessage.setAttribute('role', hasError ? 'alert' : 'status');
  elements.readinessMessage.classList.toggle('error', hasError);
  if (state.analysisError) {
    elements.readinessMessage.textContent = `Analysis failed: ${state.analysisError} Select “Analyze macro” to retry.`;
  } else if (state.analysisImportError) {
    elements.readinessMessage.textContent = `Import failed: ${state.analysisImportError}`;
  } else if (state.importedAnalysisName && state.analysis) {
    elements.readinessMessage.textContent =
      `Imported ${state.importedAnalysisName}. Results re-rendered without analyzing macros again.`;
  } else {
    elements.readinessMessage.textContent = messages.length > 0
      ? `${messages.join(' and ').replace(/^./, (letter) => letter.toUpperCase())}.`
      : `Ready to compare against ${state.catalog?.snapshots.length ?? 0} validated RoomOS versions.`;
  }
}

function uniqueFileId(path: string, used: Set<string>): string {
  const base = path.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'macro';
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function updateMacroListSummary(): void {
  const fileCount = state.files.length;
  const includedFiles = state.files.filter((selection) => selection.included);
  const includedCount = includedFiles.length;
  const includedBytes = includedFiles.reduce((sum, selection) => sum + selection.byteSize, 0);
  const connected = Boolean(state.endpoint);

  elements.macroListSummary.hidden = fileCount === 0;
  elements.fileListWrap.hidden = fileCount === 0;
  elements.macroListSummaryTitle.textContent = connected
    ? `${fileCount} endpoint ${fileCount === 1 ? 'macro' : 'macros'}`
    : `${fileCount} uploaded ${fileCount === 1 ? 'file' : 'files'}`;
  elements.macroListSummaryDetail.textContent =
    `${includedCount} of ${fileCount} included · ${formatBytes(includedBytes)} included`;
  elements.macroSelectionCount.textContent = `${includedCount} of ${fileCount} included`;
  elements.macroSelectAll.disabled = fileCount === 0 || includedCount === fileCount;
  elements.macroClearAll.disabled = includedCount === 0;
  elements.macroListButton.textContent = connected ? 'Review endpoint macros' : 'Review macro files';
  elements.macroListDialogContext.textContent = connected
    ? `Choose which of the ${fileCount} macros retrieved from ${state.endpoint?.broadcastName ?? 'the connected endpoint'} (${state.endpoint?.host ?? 'unknown address'}) to include in analysis.`
    : `Choose which of the ${fileCount} uploaded files to include in analysis. Unchecked files are excluded entirely.`;
}

function renderFiles(): void {
  const endpoint = state.endpoint;
  const connected = Boolean(endpoint);
  elements.fileCount.textContent = `${state.files.length} ${state.files.length === 1 ? 'file' : 'files'}`;
  elements.clearButton.disabled = connected || state.files.length === 0;
  elements.clearButton.hidden = connected || state.files.length === 0;
  updateMacroListSummary();
  elements.fileList.setAttribute(
    'aria-label',
    connected ? 'Endpoint macro files' : 'Uploaded macro files',
  );
  elements.fileList.innerHTML = state.files.map((selection, index) => {
    return `
    <li class="file-item">
      <div class="file-row">
        <div class="file-main">
          <span class="file-icon">JS</span>
          <span class="file-name" title="${escapeHtml(selection.file.path)}">
            ${escapeHtml(selection.file.path)}
            <small>${formatBytes(selection.byteSize)}</small>
          </span>
        </div>
        <div class="file-state-badges">
          ${selection.active === undefined ? '' : `<span class="active-badge ${selection.active ? 'active' : 'inactive'}">${selection.active ? 'Active' : 'Inactive'}</span>`}
        </div>
        <label class="inclusion-toggle"><input type="checkbox" data-inclusion-index="${index}" ${selection.included ? 'checked' : ''} /><span>Include in analysis</span></label>
      </div>
    </li>
  `;
  }).join('');
  elements.fileList.querySelectorAll<HTMLInputElement>('[data-inclusion-index]').forEach((input) => {
    input.addEventListener('change', async () => {
      const selection = state.files[Number(input.dataset.inclusionIndex)];
      if (!selection || selection.included === input.checked) return;
      const previousValue = selection.included;
      if (!await confirmAnalysisPurge({
        message: 'Changing the included Macro Set will permanently clear the current analyzed results from this browser.',
        confirmLabel: 'Change Macro Set',
      })) {
        input.checked = previousValue;
        return;
      }
      selection.included = input.checked;
      resetAnalysis();
      renderFiles();
      updateMacroListSummary();
      updateReadiness();
    });
  });
  elements.fileInput.disabled = connected;
  elements.dropZone.hidden = connected;
  elements.sourceDivider.hidden = connected;
  elements.manualSourceActions.hidden = connected;
  elements.uploadTitle.textContent = connected ? 'Endpoint macro set' : 'Add macro files';
  elements.sourceGuidance.textContent = connected
    ? 'Macros were retrieved from the connected endpoint. Disconnect to upload files from this computer instead.'
    : 'Choose one source for the macro set.';
  elements.endpointSource.classList.toggle('is-connected', connected);
  elements.endpointConnectedBadge.hidden = !connected;
  elements.endpointButton.classList.toggle('is-connected', connected);
  elements.endpointButtonLabel.textContent = connected ? 'Disconnect endpoint' : 'Connect endpoint';
  elements.endpointButton.title = connected
    ? `Disconnect from ${endpoint?.host ?? 'endpoint'}`
    : 'Connect directly to a RoomOS endpoint';
  elements.endpointButton.setAttribute(
    'aria-label',
    connected ? `Disconnect endpoint ${endpoint?.host ?? ''}`.trim() : 'Connect endpoint',
  );
  if (endpoint) {
    elements.endpointSourceName.textContent = endpoint.broadcastName;
    elements.endpointSourceDetail.textContent =
      `${endpoint.host} · ${endpoint.macroCount} ${endpoint.macroCount === 1 ? 'macro' : 'macros'} retrieved with source content. Endpoint source remains in browser memory only.`;
  } else {
    elements.endpointSourceName.textContent = 'Connect to a RoomOS endpoint';
    elements.endpointSourceDetail.textContent =
      'Retrieve every macro with source content directly into this browser. Endpoint source remains in browser memory only.';
  }
  updateReadiness();
}

function resetAnalysis(): void {
  state.analysis = undefined;
  state.analysisError = undefined;
  state.analysisImportError = undefined;
  state.importedAnalysisName = undefined;
  state.dismissedIssueLocations.clear();
  elements.results.hidden = true;
}

interface AnalysisPurgeWarning {
  message: string;
  confirmLabel: string;
}

function confirmAnalysisPurge(warning: AnalysisPurgeWarning): Promise<boolean> {
  if (!state.analysis) return Promise.resolve(true);

  elements.analysisPurgeMessage.textContent = warning.message;
  elements.analysisPurgeConfirm.textContent = warning.confirmLabel;
  elements.analysisPurgeDialog.returnValue = '';
  elements.analysisPurgeDialog.showModal();

  return new Promise((resolve) => {
    elements.analysisPurgeDialog.addEventListener(
      'close',
      () => resolve(elements.analysisPurgeDialog.returnValue === 'confirm'),
      { once: true },
    );
  });
}

async function setAllMacrosIncluded(included: boolean): Promise<void> {
  if (!await confirmAnalysisPurge({
    message: 'Changing the included Macro Set will permanently clear the current analyzed results from this browser.',
    confirmLabel: 'Change Macro Set',
  })) return;
  state.files.forEach((selection) => {
    selection.included = included;
  });
  resetAnalysis();
  renderFiles();
}

async function addBrowserFiles(fileList: FileList | File[]): Promise<void> {
  if (state.endpoint) return;
  const browserFiles = [...fileList]
    .filter((file) => file.name.endsWith('.js') || file.name.endsWith('.mjs') || file.type === 'text/javascript');
  if (browserFiles.length === 0) return;
  if (!await confirmAnalysisPurge({
    message: 'Adding files will permanently clear the current analyzed results from this browser.',
    confirmLabel: 'Add files',
  })) return;
  const used = new Set(state.files.map((selection) => selection.file.id));
  const additions = await Promise.all(browserFiles.map(async (file) => {
    const browserFile = file as File & { webkitRelativePath?: string };
    const path = browserFile.webkitRelativePath || file.name;
    return {
      file: { id: uniqueFileId(path, used), path, source: await file.text() },
      included: true,
      byteSize: file.size,
    } satisfies MacroSelection;
  }));
  state.files = [...state.files, ...additions]
    .sort((left, right) => left.file.path.localeCompare(right.file.path));
  resetAnalysis();
  renderFiles();
  if (additions.length > 0) {
    trackManualMacrosLoaded();
    elements.macroListDialog.showModal();
  }
}

async function loadExample(): Promise<void> {
  if (state.endpoint) return;
  if (!await confirmAnalysisPurge({
    message: 'Loading the Dependency Example will permanently clear the current analyzed results from this browser.',
    confirmLabel: 'Load example',
  })) return;
  const { dependencyMapExampleFiles } = await import('./examples/dependencyMapExample');
  state.files = dependencyMapExampleFiles.map((file) => ({
    file: { ...file },
    included: true,
    byteSize: new Blob([file.source]).size,
  }));
  resetAnalysis();
  renderFiles();
}

function endpointMacroSelections(macros: EndpointMacro[]): MacroSelection[] {
  const used = new Set<string>();
  return macros.map((macro) => {
    const path = /\.(?:js|mjs)$/i.test(macro.name) ? macro.name : `${macro.name}.js`;
    return {
      file: {
        id: uniqueFileId(path, used),
        path,
        source: macro.content,
        ...(macro.active === undefined ? {} : { active: macro.active }),
      },
      included: true,
      byteSize: new Blob([macro.content]).size,
      ...(macro.active === undefined ? {} : { active: macro.active }),
    };
  });
}

function clearEndpointDialogError(): void {
  elements.endpointError.hidden = true;
  elements.endpointError.textContent = '';
  elements.endpointCertificateLink.hidden = true;
  elements.endpointCertificateLink.removeAttribute('href');
}

function renderRecentEndpoints(): void {
  elements.recentEndpoints.hidden = state.recentEndpoints.length === 0;
  const buttons = state.recentEndpoints.map((endpoint) => {
    const button = document.createElement('button');
    button.className = 'recent-endpoint';
    button.type = 'button';
    button.setAttribute('aria-label', `Use ${endpoint.broadcastName}, ${endpoint.host}`);

    const name = document.createElement('strong');
    name.textContent = endpoint.broadcastName;
    const host = document.createElement('span');
    host.textContent = endpoint.host;
    button.append(name, host);
    button.addEventListener('click', () => {
      clearEndpointDialogError();
      elements.endpointHost.value = endpoint.host;
      elements.endpointUsername.focus();
    });
    return button;
  });
  elements.recentEndpointList.replaceChildren(...buttons);
}

function showEndpointDialogError(message: string, certificateHost?: string): void {
  elements.endpointError.textContent = message;
  elements.endpointError.hidden = false;
  if (certificateHost) {
    elements.endpointCertificateLink.href = `https://${certificateHost}`;
    elements.endpointCertificateLink.hidden = false;
  }
}

function openEndpointDialog(): void {
  clearEndpointDialogError();
  elements.endpointDialog.showModal();
  elements.endpointHost.focus();
}

async function connectEndpoint(): Promise<void> {
  if (state.endpoint) return;
  if (!await confirmAnalysisPurge({
    message: 'Connecting an Endpoint will permanently clear the current analyzed results from this browser.',
    confirmLabel: 'Connect endpoint',
  })) return;
  clearEndpointDialogError();

  let host = '';
  const credentials = {
    host: '',
    username: elements.endpointUsername.value.trim(),
    password: elements.endpointPassword.value,
  };
  let xapi: EndpointXapi | undefined;
  let socketReady = false;
  let broadcastName = '';
  let macros: EndpointMacro[] | undefined;

  try {
    host = normalizeEndpointHost(elements.endpointHost.value);
    credentials.host = host;
    if (!credentials.username || !credentials.password) {
      throw new Error('Enter the endpoint username and password.');
    }

    elements.endpointConnectSubmit.disabled = true;
    elements.endpointConnectSubmit.textContent = 'Connecting…';
    xapi = await connectToEndpoint(credentials);
    socketReady = true;
    elements.endpointConnectSubmit.textContent = 'Reading device name…';
    broadcastName = await getEndpointBroadcastName(xapi);
    state.recentEndpoints = saveRecentEndpoint({ host, broadcastName });
    renderRecentEndpoints();
    elements.endpointConnectSubmit.textContent = 'Retrieving macros…';
    macros = await getEndpointMacros(xapi);
  } catch (error) {
    xapi?.close();
    showEndpointDialogError(
      error instanceof Error ? error.message : 'Unable to connect to the endpoint.',
      host && !socketReady ? host : undefined,
    );
  } finally {
    credentials.password = '';
    elements.endpointPassword.value = '';
    elements.endpointConnectSubmit.disabled = false;
    elements.endpointConnectSubmit.textContent = 'Connect and review macros';
  }

  if (!xapi || !macros) return;

  state.endpoint = {
    host,
    broadcastName,
    macroCount: macros.length,
    xapi,
  };
  state.files = endpointMacroSelections(macros);
  resetAnalysis();
  renderFiles();
  elements.endpointDialog.close();
  elements.macroListDialog.showModal();
  trackEndpointConnected();
}

function disconnectEndpoint(): void {
  const endpoint = state.endpoint;
  if (!endpoint) return;
  endpoint.xapi.close();
  state.endpoint = undefined;
  state.files = [];
  resetAnalysis();
  elements.endpointHost.value = '';
  elements.endpointUsername.value = '';
  elements.endpointPassword.value = '';
  elements.endpointDisconnectDialog.close();
  renderFiles();
}

async function loadCatalog(): Promise<void> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}schemas/catalog.json`);
    if (!response.ok) throw new Error(`Catalog request failed with ${response.status}`);
    const catalog = await response.json() as SchemaCatalog;
    if (!Array.isArray(catalog.snapshots) || catalog.snapshots.length === 0) {
      throw new Error('No validated RoomOS versions were found.');
    }
    if (catalog.snapshots.some((snapshot) => !snapshot.lastUpdated || !snapshot.sha256)) {
      throw new Error('A RoomOS schema snapshot is missing reproducibility metadata.');
    }
    state.catalog = catalog;
    elements.catalogStatus.innerHTML = `<span class="status-dot"></span>${catalog.snapshots.length} RoomOS versions available`;
    elements.analysisScopeCount.textContent = `${catalog.snapshots.length} validated schema snapshots will be checked.`;
    elements.scopeVersionCount.textContent = String(catalog.snapshots.length);
  } catch (error) {
    state.catalog = undefined;
    elements.catalogStatus.innerHTML = '<span class="status-dot pending"></span>RoomOS versions unavailable';
    elements.analysisScopeCount.textContent = error instanceof Error ? error.message : 'Could not load RoomOS versions.';
    elements.scopeVersionCount.textContent = '!';
  }
  updateReadiness();
}

async function loadSchema(snapshot: CatalogSnapshot): Promise<VerifiedSchema> {
  return loadVerifiedSchema(
    snapshot,
    `${import.meta.env.BASE_URL}schemas/`,
  );
}

function summaryCard(label: string, value: number | string, detail = '', attention = false): string {
  return `<span class="summary-card ${attention ? 'attention' : ''}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</span>`;
}

function versionChip(version: VersionSchemaCoverage | SchemaVersionIdentity, className = ''): string {
  const statusClass = className || ('status' in version
    ? version.status === 'parent-warning'
      ? 'warning'
      : version.status === 'missing'
        ? 'missing'
        : ''
    : '');
  const counts = 'exactPathCount' in version
    ? ` · ${version.exactPathCount} exact${version.parentPathCount ? ` · ${version.parentPathCount} parent` : ''}${version.missingPathCount ? ` · ${version.missingPathCount} missing` : ''}`
    : '';
  const label = version.label.replace(/^RoomOS\s+/i, '');
  return `<span class="version-chip ${statusClass}" title="${escapeHtml(`${version.label} · ${version.sha256.slice(0, 12)}…${counts}`)}">${escapeHtml(label)}</span>`;
}

const schemaChannels = [
  {
    key: 'cloud',
    label: 'Cloud',
    detail: 'Schema name includes a release month',
  },
  {
    key: 'on-premises',
    label: 'On-premises',
    detail: 'Schema name does not include a release month',
  },
] as const;

function versionChannelColumns(
  versions: Array<VersionSchemaCoverage | SchemaVersionIdentity>,
  className = '',
): string {
  return `<div class="version-channel-grid">${schemaChannels.map((channel) => {
    const matches = versions.filter((version) => version.channel === channel.key);
    return `<div class="version-channel">
      <div class="version-channel-heading">
        <div><strong>${channel.label}</strong><small>${channel.detail}</small></div>
        <span>${matches.length}</span>
      </div>
      ${matches.length > 0
        ? `<div class="version-chips">${matches.map((version) => versionChip(version, className)).join('')}</div>`
        : '<span class="version-channel-empty">None</span>'}
    </div>`;
  }).join('')}</div>`;
}

function versionGroup(
  label: string,
  detail: string,
  versions: Array<VersionSchemaCoverage | SchemaVersionIdentity>,
  className = '',
): string {
  if (versions.length === 0) return '';
  return `<div class="version-group ${className}">
    <div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small></div>
    ${versionChannelColumns(versions, className)}
  </div>`;
}

function compatibilityRangeColumns(coverage: SchemaCoverage): string {
  return `<div class="version-channel-grid">${schemaChannels.map((channel) => {
    const boundary = coverage.compatibilityByChannel.find((candidate) => candidate.channel === channel.key);
    const earliest = boundary?.earliestCompatibleVersion;
    const latest = boundary?.latestCompatibleVersion;
    const latestCatalog = boundary?.latestCatalogVersion;
    const reachesLatestSoftware = latest?.id === coverage.latestCatalogVersion?.id;
    const reachesLatestChannelSnapshot = latest?.id === latestCatalog?.id;
    const laterFailures = boundary?.laterIncompatibleVersions.length ?? 0;
    return `<div class="version-channel">
      <div class="version-channel-heading">
        <div><strong>${channel.label}</strong><small>${channel.detail}</small></div>
      </div>
      ${earliest && latest
        ? `<div class="compatibility-range ${earliest.id === latest.id ? 'single' : ''}">
            <div class="compatibility-range-endpoint">
              <span>${earliest.id === latest.id ? 'Only fully represented snapshot' : 'Oldest fully represented'}</span>
              ${versionChip(earliest)}
              ${earliest.id === latest.id && reachesLatestSoftware
                ? '<span class="latest-software-indicator">Latest software</span>'
                : ''}
            </div>
            ${earliest.id === latest.id
              ? ''
              : `<span class="compatibility-range-arrow" aria-hidden="true">→</span>
                <div class="compatibility-range-endpoint">
                  <span>Newest fully represented</span>
                  ${versionChip(latest)}
                  ${reachesLatestSoftware ? '<span class="latest-software-indicator">Latest software</span>' : ''}
                </div>`}
          </div>
          <small>${reachesLatestSoftware
            ? 'Schema availability reaches the latest cataloged software.'
            : reachesLatestChannelSnapshot
              ? `Schema availability reaches the newest ${channel.label} snapshot in the catalog.`
              : `Full schema representation ends before the newest ${channel.label} snapshot${latestCatalog ? `, ${escapeHtml(latestCatalog.release)}` : ''}.`}${laterFailures > 0 ? ` ${laterFailures} newer unavailable ${laterFailures === 1 ? 'snapshot is' : 'snapshots are'} listed below.` : ''}</small>`
        : '<span class="version-channel-empty">No passing snapshot</span>'}
    </div>`;
  }).join('')}</div>`;
}

function unavailableVersionColumns(versions: VersionSchemaCoverage[]): string {
  return `<div class="version-channel-grid unavailable-channel-grid">${schemaChannels.map((channel) => {
    const matches = versions.filter((version) => version.channel === channel.key);
    return `<div class="version-channel">
      <div class="version-channel-heading">
        <div><strong>${channel.label}</strong><small>${channel.detail}</small></div>
        <span>${matches.length}</span>
      </div>
      ${matches.length > 0
        ? `<div class="unavailable-version-list">${matches.map((version) => `
          <article class="unavailable-version">
            <div class="unavailable-version-heading">
              ${versionChip(version, 'missing')}
              <strong>${version.missingPathCount} missing</strong>
            </div>
            <ul class="missing-reference-list">${version.missingReferences.map((reference) => `
              <li><span>${escapeHtml(reference.kind)}</span><code>${escapeHtml(reference.path)}</code></li>
            `).join('')}</ul>
          </article>
        `).join('')}</div>`
        : '<span class="version-channel-empty">None</span>'}
    </div>`;
  }).join('')}</div>`;
}

function macroDependencyImpactCount(
  report: AnalysisReport,
  fileId: string,
): number {
  const visibleFindingIds = new Set(report.findings.map((finding) => finding.id));
  return new Set(report.findingImpacts
    .filter((impact) =>
      visibleFindingIds.has(impact.findingId)
      && impact.impact === 'dependency'
      && impact.entryMacroId === fileId)
    .map((impact) => impact.findingId)).size;
}

function renderMacroRelationshipRow(
  report: AnalysisReport,
  fileId: string,
  cycle = false,
): string {
  const file = report.fileInventory.find((candidate) => candidate.fileId === fileId);
  if (!file) return '';
  const dependencyImpactCount = file.roles.includes('Entry')
    ? macroDependencyImpactCount(report, fileId)
    : 0;
  const dependencyCount = file.roles.includes('Entry')
    ? buildDependencyMap(report, fileId).counts.dependencies
    : 0;
  const dependencyMapLabel = dependencyCount > 0
    ? `Open Dependency map for ${file.path}: ${dependencyCount} ${dependencyCount === 1 ? 'dependency' : 'dependencies'}`
    : `Dependency map unavailable for ${file.path}: no dependencies`;
  return `<div class="macro-relationship-row">
    <span class="file-icon">JS</span>
    <span class="macro-relationship-name">
      <strong>${escapeHtml(file.path)}</strong>
      <small>${escapeHtml(file.analysisState)}${cycle ? ' · cycle' : ''}</small>
    </span>
    <span class="macro-relationship-badges">
      ${file.roles.includes('Entry') ? '<span class="role-badge entry">Entry</span>' : ''}
      ${file.roles.includes('Dependency') ? '<span class="role-badge dependency">Dependency</span>' : ''}
      ${file.activeState === 'Unknown' ? '' : `<span class="active-badge ${file.activeState.toLowerCase()}">${escapeHtml(file.activeState)}</span>`}
    </span>
    <span class="macro-impact-links">
      ${file.roles.includes('Entry')
        ? `<button class="dependency-map-button" type="button" data-dependency-map-entry="${escapeHtml(file.fileId)}" aria-label="${escapeHtml(dependencyMapLabel)}"${dependencyCount === 0 ? ' disabled' : ''}>
            <span>Dependency map</span>
            ${dependencyCount > 0 ? `<span class="dependency-map-button-count" aria-hidden="true">${dependencyCount}</span>` : ''}
          </button>`
        : ''}
      ${dependencyImpactCount > 0
        ? `<button type="button" data-finding-scope="dependency" data-finding-file="${escapeHtml(file.fileId)}">${dependencyImpactCount} dependency ${dependencyImpactCount === 1 ? 'impact' : 'impacts'}</button>`
        : ''}
    </span>
  </div>`;
}

function renderMacroDependencyTree(
  report: AnalysisReport,
  importerFileId: string,
  ancestors = new Set<string>(),
): string {
  const dependencies = [...new Set(report.directDependencyGraph
    .filter((edge) => edge.importerFileId === importerFileId)
    .map((edge) => edge.dependencyFileId))]
    .sort((left, right) => sourcePath(left).localeCompare(sourcePath(right)));
  const missing = report.unresolvedDependencyEdges
    .filter((edge) => edge.importerFileIds.includes(importerFileId))
    .sort((left, right) => left.normalizedExpectedPath.localeCompare(right.normalizedExpectedPath));
  if (dependencies.length === 0 && missing.length === 0) return '';

  const nextAncestors = new Set(ancestors).add(importerFileId);
  return `<ul class="macro-dependency-tree">
    ${dependencies.map((dependencyFileId) => {
      const cycle = nextAncestors.has(dependencyFileId);
      return `<li class="macro-relationship-node">
        ${renderMacroRelationshipRow(report, dependencyFileId, cycle)}
        ${cycle ? '' : renderMacroDependencyTree(report, dependencyFileId, nextAncestors)}
      </li>`;
    }).join('')}
    ${missing.map((edge) => `<li class="macro-relationship-node missing">
      <div class="macro-relationship-row">
        <span class="file-icon">?</span>
        <span class="macro-relationship-name"><strong>${escapeHtml(edge.normalizedExpectedPath)}</strong><small>Not evaluated</small></span>
        <span class="macro-relationship-badges"><span class="role-badge dependency">Missing dependency</span></span>
      </div>
    </li>`).join('')}
  </ul>`;
}

function bindFindingScopeControls(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>('[data-finding-scope]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!state.analysis) return;
      state.findingScope = {
        fileId: button.dataset.findingFile ?? '',
      };
      state.findingFilter = 'all';
      renderFindings(deriveAnalysisSessionPresentation(state.analysis).displayReport);
      activateResultTab('issues');
      elements.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

type UrlEvidenceObservation = Extract<
  AnalysisObservation,
  { kind: 'external-dependency' | 'dynamic-url' | 'commented-url' }
>;

interface DependencyMapView {
  report: AnalysisReport;
  entryFileId: string;
  model?: DependencyMapModel;
  selectedObservationIds: string[];
  selectedOccurrenceIndex: number;
  focusedNodeId?: string;
  zoom: number;
  zoomMode: 'fit' | 'manual';
}

let dependencyMapView: DependencyMapView | undefined;
const dependencyMapMinimumZoom = 0.15;
const dependencyMapMaximumZoom = 2;
const dependencyMapZoomStep = 0.1;
interface DependencyMapPan {
  pointerId: number;
  originX: number;
  originY: number;
  scrollLeft: number;
  scrollTop: number;
  moved: boolean;
}
interface DependencyMapZoomAnchor {
  clientX: number;
  clientY: number;
}
let dependencyMapPan: DependencyMapPan | undefined;
let suppressDependencyMapCanvasClick = false;

function urlUsageLabel(usage: UrlEvidenceObservation['usage']): string {
  return usage === 'in-use'
    ? 'In Use'
    : usage === 'use-unknown'
      ? 'Use Unknown'
      : 'Not In Use';
}

function setDependencyMapZoom(
  requestedZoom: number,
  zoomMode: DependencyMapView['zoomMode'],
  anchor?: DependencyMapZoomAnchor,
): void {
  if (!dependencyMapView) return;
  const svg = elements.dependencyMapCanvas.querySelector<SVGSVGElement>(
    '.dependency-map-svg',
  );
  if (!svg) return;
  const naturalWidth = Number(svg.getAttribute('width'));
  const naturalHeight = Number(svg.getAttribute('height'));
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) return;

  const zoom = Math.min(
    dependencyMapMaximumZoom,
    Math.max(dependencyMapMinimumZoom, requestedZoom),
  );
  const canvas = elements.dependencyMapCanvas;
  const canvasRect = canvas.getBoundingClientRect();
  const anchorOffsetX = anchor
    ? Math.max(0, Math.min(canvas.clientWidth, anchor.clientX - canvasRect.left))
    : canvas.clientWidth / 2;
  const anchorOffsetY = anchor
    ? Math.max(0, Math.min(canvas.clientHeight, anchor.clientY - canvasRect.top))
    : canvas.clientHeight / 2;
  const horizontalAnchor = canvas.scrollWidth > 0
    ? (canvas.scrollLeft + anchorOffsetX) / canvas.scrollWidth
    : 0.5;
  const verticalAnchor = canvas.scrollHeight > 0
    ? (canvas.scrollTop + anchorOffsetY) / canvas.scrollHeight
    : 0.5;

  dependencyMapView.zoom = zoom;
  dependencyMapView.zoomMode = zoomMode;
  svg.style.width = `${naturalWidth * zoom}px`;
  svg.style.height = `${naturalHeight * zoom}px`;
  elements.dependencyMapZoomValue.value = `${Math.round(zoom * 100)}%`;
  elements.dependencyMapZoomOut.disabled = zoom <= dependencyMapMinimumZoom;
  elements.dependencyMapZoomIn.disabled = zoom >= dependencyMapMaximumZoom;
  elements.dependencyMapFit.classList.toggle('is-active', zoomMode === 'fit');
  elements.dependencyMapFit.setAttribute(
    'aria-pressed',
    String(zoomMode === 'fit'),
  );

  canvas.scrollLeft = Math.max(
    0,
    horizontalAnchor * canvas.scrollWidth - anchorOffsetX,
  );
  canvas.scrollTop = Math.max(
    0,
    verticalAnchor * canvas.scrollHeight - anchorOffsetY,
  );
}

function fitDependencyMap(): void {
  if (!dependencyMapView) return;
  const svg = elements.dependencyMapCanvas.querySelector<SVGSVGElement>(
    '.dependency-map-svg',
  );
  if (!svg) return;
  const naturalWidth = Number(svg.getAttribute('width'));
  const naturalHeight = Number(svg.getAttribute('height'));
  const availableWidth = elements.dependencyMapCanvas.clientWidth - 24;
  const availableHeight = elements.dependencyMapCanvas.clientHeight - 24;
  if (
    !Number.isFinite(naturalWidth)
    || !Number.isFinite(naturalHeight)
    || availableWidth <= 0
    || availableHeight <= 0
  ) return;
  setDependencyMapZoom(
    Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight),
    'fit',
  );
}

function refreshDependencyMapZoom(): void {
  window.requestAnimationFrame(() => {
    if (!dependencyMapView) return;
    if (dependencyMapView.zoomMode === 'fit') fitDependencyMap();
    else setDependencyMapZoom(dependencyMapView.zoom, 'manual');
  });
}

const dependencyMapExportStyleProperties = [
  'color',
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'filter',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'text-anchor',
] as const;

function inlineDependencyMapSvgStyles(
  sourceSvg: SVGSVGElement,
  clonedSvg: SVGSVGElement,
): void {
  const sourceElements = [
    sourceSvg,
    ...sourceSvg.querySelectorAll<SVGElement>('*'),
  ];
  const clonedElements = [
    clonedSvg,
    ...clonedSvg.querySelectorAll<SVGElement>('*'),
  ];
  sourceElements.forEach((sourceElement, index) => {
    const clonedElement = clonedElements[index];
    if (!clonedElement) return;
    const computedStyle = window.getComputedStyle(sourceElement);
    for (const property of dependencyMapExportStyleProperties) {
      clonedElement.style.setProperty(
        property,
        computedStyle.getPropertyValue(property),
      );
    }
  });
}

async function downloadDependencyMapPng(): Promise<void> {
  if (!dependencyMapView) return;
  const sourceSvg = elements.dependencyMapCanvas.querySelector<SVGSVGElement>(
    '.dependency-map-svg',
  );
  if (!sourceSvg) return;
  const naturalWidth = Number(sourceSvg.getAttribute('width'));
  const naturalHeight = Number(sourceSvg.getAttribute('height'));
  if (
    !Number.isFinite(naturalWidth)
    || !Number.isFinite(naturalHeight)
    || naturalWidth <= 0
    || naturalHeight <= 0
  ) return;

  elements.dependencyMapDownload.disabled = true;
  elements.dependencyMapDownloadLabel.textContent = 'Preparing…';
  await yieldToBrowser();
  try {
    const clonedSvg = sourceSvg.cloneNode(true) as SVGSVGElement;
    inlineDependencyMapSvgStyles(sourceSvg, clonedSvg);
    clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clonedSvg.setAttribute('width', String(naturalWidth));
    clonedSvg.setAttribute('height', String(naturalHeight));
    clonedSvg.style.width = `${naturalWidth}px`;
    clonedSvg.style.height = `${naturalHeight}px`;

    const serializedSvg = new XMLSerializer().serializeToString(clonedSvg);
    const sourceUrl =
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serializedSvg)}`;
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The dependency map image could not be rendered.'));
      image.src = sourceUrl;
    });

    const maximumPixelCount = 24_000_000;
    const exportScale = Math.min(
      2,
      Math.sqrt(maximumPixelCount / (naturalWidth * naturalHeight)),
    );
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = Math.max(1, Math.round(naturalWidth * exportScale));
    exportCanvas.height = Math.max(1, Math.round(naturalHeight * exportScale));
    const context = exportCanvas.getContext('2d');
    if (!context) throw new Error('The dependency map image canvas is unavailable.');
    context.fillStyle = window.getComputedStyle(elements.dependencyMapCanvas)
      .backgroundColor;
    context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    context.drawImage(image, 0, 0, exportCanvas.width, exportCanvas.height);

    const png = await new Promise<Blob>((resolve, reject) => {
      exportCanvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('The dependency map PNG could not be created.'));
      }, 'image/png');
    });
    const url = URL.createObjectURL(png);
    const fileName = sourcePath(dependencyMapView.entryFileId)
      .replace(/\.[^./\\]+$/, '')
      .replace(/[^a-z0-9._-]+/gi, '_');
    const link = document.createElement('a');
    link.href = url;
    link.download = `dependency-map-${fileName || 'entry-macro'}.png`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    elements.dependencyMapDownloadLabel.textContent = 'Downloaded';
  } catch {
    elements.dependencyMapDownloadLabel.textContent = 'Download failed';
  } finally {
    elements.dependencyMapDownload.disabled = false;
    window.setTimeout(() => {
      elements.dependencyMapDownloadLabel.textContent = 'Download PNG';
    }, 1400);
  }
}

function setDependencyMapFocus(nodeId?: string): void {
  if (!dependencyMapView) return;
  const svg = elements.dependencyMapCanvas.querySelector<SVGSVGElement>(
    '.dependency-map-svg',
  );
  if (!svg) return;
  const nodes = [
    ...svg.querySelectorAll<SVGGElement>('[data-dependency-node-id]'),
  ];
  const edges = [
    ...svg.querySelectorAll<SVGPathElement>('[data-dependency-edge-from]'),
  ];
  const focusedNodeExists = nodeId
    ? nodes.some((node) => node.dataset.dependencyNodeId === nodeId)
    : false;
  const focusedNodeId = focusedNodeExists ? nodeId : undefined;
  const focus = focusedNodeId && dependencyMapView.model
    ? collectDependencyMapFocus(dependencyMapView.model, focusedNodeId)
    : { nodeIds: [], edgeIds: [] };
  const connectedNodeIds = new Set(focus.nodeIds);
  const focusedEdgeIds = new Set(focus.edgeIds);

  for (const edge of edges) {
    const isConnected = Boolean(
      focusedNodeId
      && focusedEdgeIds.has(edge.dataset.dependencyEdgeId ?? ''),
    );
    edge.classList.toggle('is-focused', isConnected);
    edge.classList.toggle('is-dimmed', Boolean(focusedNodeId && !isConnected));
  }
  for (const node of nodes) {
    const candidateId = node.dataset.dependencyNodeId ?? '';
    const isSelected = candidateId === focusedNodeId;
    node.classList.toggle('is-selected', isSelected);
    node.classList.toggle(
      'is-connected',
      Boolean(focusedNodeId && !isSelected && connectedNodeIds.has(candidateId)),
    );
    node.classList.toggle(
      'is-dimmed',
      Boolean(focusedNodeId && !connectedNodeIds.has(candidateId)),
    );
    node.setAttribute('aria-pressed', String(isSelected));
  }
  dependencyMapView.focusedNodeId = focusedNodeId;
}

function clearDependencyUrlSelection(): void {
  if (!dependencyMapView) return;
  dependencyMapView.selectedObservationIds = [];
  dependencyMapView.selectedOccurrenceIndex = 0;
  const wasVisible = !elements.dependencyUrlInspector.hidden;
  elements.dependencyUrlInspector.hidden = true;
  if (wasVisible) refreshDependencyMapZoom();
}

function renderUrlEvidenceInspector(): void {
  if (!dependencyMapView || dependencyMapView.selectedObservationIds.length === 0) {
    const wasVisible = !elements.dependencyUrlInspector.hidden;
    elements.dependencyUrlInspector.hidden = true;
    if (wasVisible) refreshDependencyMapZoom();
    return;
  }
  const observations = new Map(
    dependencyMapView.report.observationLedger.map((observation) => [
      observation.id,
      observation,
    ]),
  );
  const observation = observations.get(
    dependencyMapView.selectedObservationIds[dependencyMapView.selectedOccurrenceIndex] ?? '',
  );
  if (
    !observation
    || !['external-dependency', 'dynamic-url', 'commented-url'].includes(observation.kind)
  ) {
    elements.dependencyUrlInspector.hidden = true;
    return;
  }
  const urlObservation = observation as UrlEvidenceObservation;
  const destination = urlObservation.kind === 'dynamic-url'
    ? 'Dynamic URL'
    : urlObservation.destination;
  const protocol = urlObservation.protocol
    ? ` · ${urlObservation.protocol.toUpperCase()}`
    : '';
  const position = urlObservation.sourceReference.range.start;
  const routes = urlObservation.usageExplanation.provenanceRoutes ?? [];
  const routeMarkup = routes.length > 0
    ? routes.map((route, routeIndex) => `
      <div class="dependency-url-route">
        <strong>Provenance route ${routeIndex + 1}</strong>
        <ol>${route.hops.map((hop) => `
          <li>
            ${escapeHtml(hop.label ? `${hop.transformation} · ${hop.label}` : hop.transformation)}
            — ${escapeHtml(sourcePath(hop.sourceReference.fileId))}:${hop.sourceReference.range.start.line}
          </li>`).join('')}</ol>
      </div>`).join('')
    : '<p>No executable provenance route is expected for this occurrence.</p>';

  elements.dependencyUrlInspectorTitle.textContent = destination;
  elements.dependencyUrlInspectorContent.innerHTML = `
    <div class="dependency-url-inspector-status ${urlObservation.usage}">
      ${urlUsageLabel(urlObservation.usage)}
    </div>
    <p class="dependency-url-location">${escapeHtml(sourcePath(urlObservation.sourceReference.fileId))}:${position.line}:${position.column}${escapeHtml(protocol)}</p>
    <p>${escapeHtml(urlObservation.usageExplanation.summary)}</p>
    ${renderSourcePreview(urlObservation.sourceReference)
      || '<p>The source region is unavailable because this analysis was imported without source files.</p>'}
    ${routeMarkup}
  `;
  const total = dependencyMapView.selectedObservationIds.length;
  elements.dependencyUrlPosition.textContent =
    `${dependencyMapView.selectedOccurrenceIndex + 1} of ${total}`;
  elements.dependencyUrlPrevious.disabled = total < 2;
  elements.dependencyUrlNext.disabled = total < 2;
  const wasHidden = elements.dependencyUrlInspector.hidden;
  elements.dependencyUrlInspector.hidden = false;
  if (wasHidden) refreshDependencyMapZoom();
}

function selectDependencyUrlNode(nodeId: string): void {
  if (!dependencyMapView) return;
  const model = buildDependencyMap(
    dependencyMapView.report,
    dependencyMapView.entryFileId,
    { showCommentedUrls: elements.dependencyMapShowComments.checked },
  );
  dependencyMapView.model = model;
  const node = model.nodes.find((candidate) => candidate.id === nodeId);
  if (!node?.observationIds?.length) return;
  const priority = { 'in-use': 0, 'use-unknown': 1, 'not-in-use': 2 };
  const observationById = new Map(
    dependencyMapView.report.observationLedger.map((observation) => [
      observation.id,
      observation,
    ]),
  );
  dependencyMapView.selectedObservationIds = [...node.observationIds].sort((leftId, rightId) => {
    const left = observationById.get(leftId) as UrlEvidenceObservation | undefined;
    const right = observationById.get(rightId) as UrlEvidenceObservation | undefined;
    return (priority[left?.usage ?? 'not-in-use'] - priority[right?.usage ?? 'not-in-use'])
      || (left?.sourceReference.fileId ?? '').localeCompare(right?.sourceReference.fileId ?? '')
      || (left?.sourceReference.range.start.line ?? 0) - (right?.sourceReference.range.start.line ?? 0)
      || (left?.sourceReference.range.start.column ?? 0) - (right?.sourceReference.range.start.column ?? 0);
  });
  dependencyMapView.selectedOccurrenceIndex = 0;
  setDependencyMapFocus(nodeId);
  renderUrlEvidenceInspector();
}

function renderDependencyMapDialog(): void {
  if (!dependencyMapView) return;
  const model = buildDependencyMap(
    dependencyMapView.report,
    dependencyMapView.entryFileId,
    { showCommentedUrls: elements.dependencyMapShowComments.checked },
  );
  dependencyMapView.model = model;
  elements.dependencyMapSummary.innerHTML = `
    <span><strong>${model.counts.macros}</strong> ${model.counts.macros === 1 ? 'macro' : 'macros'}</span>
    <span><strong>${model.counts.missing}</strong> missing</span>
    <span><strong>${model.counts.externalDestinations}</strong> external ${model.counts.externalDestinations === 1 ? 'destination' : 'destinations'}</span>
    <span><strong>${model.counts.externalDestinationsInUse + model.counts.dynamicUrlsInUse}</strong> In Use</span>
    <span><strong>${model.counts.externalDestinationsUseUnknown + model.counts.dynamicUrlsUseUnknown}</strong> Use Unknown</span>
    <span><strong>${model.counts.externalDestinationsNotInUse}</strong> Not In Use</span>
  `;
  elements.dependencyMapCanvas.innerHTML = renderDependencyMapSvg(model);
  elements.dependencyMapCanvas
    .querySelectorAll<SVGGElement>('[data-dependency-node-id]')
    .forEach((node) => {
      const activate = () => {
        if (!dependencyMapView) return;
        const nodeId = node.dataset.dependencyNodeId ?? '';
        if (!nodeId) return;
        if (dependencyMapView.focusedNodeId === nodeId) {
          clearDependencyUrlSelection();
          setDependencyMapFocus();
          return;
        }
        if (node.dataset.dependencyUrlNode) {
          selectDependencyUrlNode(nodeId);
          return;
        }
        clearDependencyUrlSelection();
        setDependencyMapFocus(nodeId);
      };
      node.addEventListener('click', activate);
      node.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
      });
    });
  setDependencyMapFocus(dependencyMapView.focusedNodeId);
  if (
    dependencyMapView.selectedObservationIds.some((id) =>
      model.nodes.some((node) => node.observationIds?.includes(id)))
  ) {
    renderUrlEvidenceInspector();
  } else {
    clearDependencyUrlSelection();
  }
  refreshDependencyMapZoom();
}

function openDependencyMap(report: AnalysisReport, entryFileId: string): void {
  const entry = report.fileInventory.find((file) => file.fileId === entryFileId);
  if (!entry) return;
  dependencyMapView = {
    report,
    entryFileId,
    selectedObservationIds: [],
    selectedOccurrenceIndex: 0,
    zoom: 1,
    zoomMode: 'fit',
  };
  elements.dependencyMapShowComments.checked = false;
  elements.dependencyUrlInspector.hidden = true;
  elements.dependencyMapTitle.textContent = `Dependency map · ${entry.path}`;
  elements.dependencyMapContext.textContent =
    'Arrows point from each macro to its dependencies. Select a block to focus its complete upstream and downstream route, or drag the canvas background to pan. Use + or − to zoom, or hold Command on macOS / Ctrl elsewhere while scrolling to zoom around the pointer. Select a URL block for occurrence-level evidence. URL status priority is In Use, Use Unknown, then Not In Use. In Use proves a supported source path to xAPI or executable XML; it does not claim runtime execution or network access.';
  renderDependencyMapDialog();
  elements.dependencyMapDialog.showModal();
  refreshDependencyMapZoom();
}

elements.dependencyMapShowComments.addEventListener('change', () => {
  renderDependencyMapDialog();
});

elements.dependencyMapZoomOut.addEventListener('click', () => {
  if (!dependencyMapView) return;
  setDependencyMapZoom(
    dependencyMapView.zoom - dependencyMapZoomStep,
    'manual',
  );
});

elements.dependencyMapFit.addEventListener('click', fitDependencyMap);

elements.dependencyMapZoomIn.addEventListener('click', () => {
  if (!dependencyMapView) return;
  setDependencyMapZoom(
    dependencyMapView.zoom + dependencyMapZoomStep,
    'manual',
  );
});

elements.dependencyMapDownload.addEventListener('click', () => {
  void downloadDependencyMapPng();
});

window.addEventListener('keydown', (event) => {
  if (!dependencyMapView || !elements.dependencyMapDialog.open || event.altKey) return;
  const target = event.target;
  if (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
  ) return;
  const zoomDirection = event.key === '+' || event.key === '='
    ? 1
    : event.key === '-' || event.key === '_'
      ? -1
      : 0;
  if (zoomDirection === 0) return;
  event.preventDefault();
  setDependencyMapZoom(
    dependencyMapView.zoom + dependencyMapZoomStep * zoomDirection,
    'manual',
  );
});

elements.dependencyMapCanvas.addEventListener('wheel', (event) => {
  if (!dependencyMapView || !(event.metaKey || event.ctrlKey)) return;
  event.preventDefault();
  const deltaPixels = event.deltaY * (
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? elements.dependencyMapCanvas.clientHeight
        : 1
  );
  setDependencyMapZoom(
    dependencyMapView.zoom * Math.exp(-deltaPixels * 0.0015),
    'manual',
    { clientX: event.clientX, clientY: event.clientY },
  );
}, { passive: false });

elements.dependencyMapCanvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  if (
    event.target instanceof Element
    && event.target.closest('[data-dependency-node-id]')
  ) return;
  dependencyMapPan = {
    pointerId: event.pointerId,
    originX: event.clientX,
    originY: event.clientY,
    scrollLeft: elements.dependencyMapCanvas.scrollLeft,
    scrollTop: elements.dependencyMapCanvas.scrollTop,
    moved: false,
  };
  elements.dependencyMapCanvas.classList.add('is-panning');
  elements.dependencyMapCanvas.setPointerCapture(event.pointerId);
  event.preventDefault();
});

elements.dependencyMapCanvas.addEventListener('pointermove', (event) => {
  const pan = dependencyMapPan;
  if (!pan || pan.pointerId !== event.pointerId) return;
  const horizontalMovement = event.clientX - pan.originX;
  const verticalMovement = event.clientY - pan.originY;
  pan.moved ||= Math.abs(horizontalMovement) > 3 || Math.abs(verticalMovement) > 3;
  elements.dependencyMapCanvas.scrollLeft = pan.scrollLeft - horizontalMovement;
  elements.dependencyMapCanvas.scrollTop = pan.scrollTop - verticalMovement;
  event.preventDefault();
});

function finishDependencyMapPan(event: PointerEvent): void {
  const pan = dependencyMapPan;
  if (!pan || pan.pointerId !== event.pointerId) return;
  if (elements.dependencyMapCanvas.hasPointerCapture(event.pointerId)) {
    elements.dependencyMapCanvas.releasePointerCapture(event.pointerId);
  }
  suppressDependencyMapCanvasClick = pan.moved;
  dependencyMapPan = undefined;
  elements.dependencyMapCanvas.classList.remove('is-panning');
  window.setTimeout(() => {
    suppressDependencyMapCanvasClick = false;
  }, 0);
}

elements.dependencyMapCanvas.addEventListener('pointerup', finishDependencyMapPan);
elements.dependencyMapCanvas.addEventListener('pointercancel', finishDependencyMapPan);

elements.dependencyMapCanvas.addEventListener('click', (event) => {
  if (suppressDependencyMapCanvasClick) return;
  if (
    event.target instanceof Element
    && event.target.closest('[data-dependency-node-id]')
  ) return;
  clearDependencyUrlSelection();
  setDependencyMapFocus();
});

elements.dependencyUrlInspectorClose.addEventListener('click', () => {
  clearDependencyUrlSelection();
  setDependencyMapFocus();
});

elements.dependencyUrlPrevious.addEventListener('click', () => {
  if (!dependencyMapView || dependencyMapView.selectedObservationIds.length < 2) return;
  dependencyMapView.selectedOccurrenceIndex =
    (dependencyMapView.selectedOccurrenceIndex - 1
      + dependencyMapView.selectedObservationIds.length)
    % dependencyMapView.selectedObservationIds.length;
  renderUrlEvidenceInspector();
});

elements.dependencyUrlNext.addEventListener('click', () => {
  if (!dependencyMapView || dependencyMapView.selectedObservationIds.length < 2) return;
  dependencyMapView.selectedOccurrenceIndex =
    (dependencyMapView.selectedOccurrenceIndex + 1)
    % dependencyMapView.selectedObservationIds.length;
  renderUrlEvidenceInspector();
});

function bindDependencyMapControls(container: HTMLElement, report: AnalysisReport): void {
  container.querySelectorAll<HTMLButtonElement>('[data-dependency-map-entry]').forEach((button) => {
    button.addEventListener('click', () => {
      const entryFileId = button.dataset.dependencyMapEntry;
      if (entryFileId) openDependencyMap(report, entryFileId);
    });
  });
}

function renderMacroRelationships(report: AnalysisReport): void {
  const entryFiles = report.fileInventory
    .filter((file) => file.roles.includes('Entry'))
    .sort((left, right) => left.path.localeCompare(right.path));
  const outsideGraph = report.fileInventory
    .filter((file) => file.analysisState === 'Not in analyzed graph')
    .sort((left, right) => left.path.localeCompare(right.path));

  elements.macroRelationships.innerHTML = `
    <p class="macro-relationships-intro">Each Entry Macro starts an analyzed import graph. Open its Dependency map to see supplied macros, missing local imports, and External Destinations classified as In Use, Use Unknown, or Not In Use.</p>
    <div class="macro-entry-list">
      ${entryFiles.map((entry) => `<article class="macro-entry">
        ${renderMacroRelationshipRow(report, entry.fileId)}
        ${renderMacroDependencyTree(report, entry.fileId)}
      </article>`).join('')}
    </div>
    ${outsideGraph.length > 0 ? `<details class="macro-outside-graph">
      <summary>${outsideGraph.length} ${outsideGraph.length === 1 ? 'file is' : 'files are'} outside the analyzed graphs</summary>
      <ul>${outsideGraph.map((file) => `<li>${escapeHtml(file.path)}</li>`).join('')}</ul>
    </details>` : ''}
  `;
  bindFindingScopeControls(elements.macroRelationships);
  bindDependencyMapControls(elements.macroRelationships, report);
}

function schemaCoverageForMacro(
  session: AnalysisSessionResult,
  fileId: string,
): SchemaCoverage {
  const versions = [
    ...session.comparison.compatibleVersions,
    ...session.comparison.incompatibleVersions,
  ];
  const versionsById = new Map(versions.map((version) => [version.id, version]));
  return buildSchemaCoverage(session.schemas.map((schema) => {
    const version = versionsById.get(schema.provenance.schemaId);
    if (!version) {
      throw new Error(`Schema comparison is missing ${schema.provenance.schemaId}.`);
    }
    return {
      version,
      references: schema.report.inventory.references.filter(
        (reference) => reference.source.fileId === fileId,
      ),
    };
  }));
}

function renderOverviewSummaryCards(
  references: ApiReference[],
  groups: ReferenceGroup[],
  coverage: SchemaCoverage,
  subscriptions: AnalysisSessionPresentation['subscriptions'],
  findings: Finding[],
): string {
  const reviewCount = findings.filter((finding) => finding.priority !== 'informational').length;
  const earliestCompatible = coverage.earliestCompatibleVersion;
  const latestCompatible = coverage.latestCompatibleVersion;
  const readiness = calculateAndroidContainerReadiness(references);
  return [
    summaryCard('xAPI references', references.length, 'Total uses found in this macro'),
    summaryCard(
      'Subscriptions',
      subscriptions.totalRegistrations,
      `${subscriptions.uniqueSubscribedPaths} unique subscribed ${subscriptions.uniqueSubscribedPaths === 1 ? 'path' : 'paths'}${subscriptions.duplicateRegistrations > 0 ? ` · ${subscriptions.duplicateRegistrations} duplicate ${subscriptions.duplicateRegistrations === 1 ? 'registration' : 'registrations'}` : ''}`,
      subscriptions.duplicateRegistrations > 0,
    ),
    summaryCard(
      'Schema Range',
      earliestCompatible && latestCompatible
        ? earliestCompatible.id === latestCompatible.id
          ? earliestCompatible.release
          : `${earliestCompatible.release} → ${latestCompatible.release}`
        : groups.length === 0 ? 'Not applicable' : 'None',
      earliestCompatible && latestCompatible
        ? ''
        : groups.length === 0
          ? 'No static xAPI paths to establish a floor'
          : `No passing schema among ${coverage.totalVersions} checked`,
      groups.length > 0 && !earliestCompatible,
    ),
    summaryCard('General Issues', findings.length, '', reviewCount > 0),
    summaryCard(
      'Android Container',
      `${readiness.available} of ${readiness.total} Available`,
      '',
      readiness.issues.length > 0,
    ),
  ].join('');
}

function renderBranchSummary(
  references: ApiReference[],
  groups: ReferenceGroup[],
  subscriptions: AnalysisSessionPresentation['subscriptions'],
): string {
  const kindOrder: ApiKind[] = ['Command', 'Configuration', 'Status', 'Event'];
  const kindLabels: Record<ApiKind, string> = {
    Command: 'Commands',
    Configuration: 'Configurations',
    Status: 'Statuses',
    Event: 'Events',
  };
  const maximum = Math.max(1, ...kindOrder.map((kind) =>
    references.filter((reference) => reference.kind === kind).length,
  ));
  return kindOrder.map((kind) => {
    const total = references.filter((reference) => reference.kind === kind).length;
    const unique = groups.filter((group) => group.kind === kind).length;
    const branchSubscriptions = subscriptions.byBranch[kind];
    const subscriptionDetail = branchSubscriptions.totalRegistrations > 0
      ? ` · ${branchSubscriptions.totalRegistrations} ${branchSubscriptions.totalRegistrations === 1 ? 'subscription' : 'subscriptions'} · ${branchSubscriptions.uniqueSubscribedPaths} subscribed ${branchSubscriptions.uniqueSubscribedPaths === 1 ? 'path' : 'paths'}`
      : '';
    return `<div class="branch-row"><span>${kindLabels[kind]}</span><div class="branch-track"><i style="width:${Math.round((total / maximum) * 100)}%"></i></div><strong>${total} total · ${unique} unique${subscriptionDetail}</strong></div>`;
  }).join('');
}

function renderSchemaSummary(coverage: SchemaCoverage): string {
  if (coverage.totalReferences === 0) {
    return `
      <div class="empty-state compact">No statically resolved xAPI paths were found in this macro, so schema availability does not apply.</div>
      <p class="schema-boundary-note"><strong>No API Availability conclusion is needed.</strong> Schema coverage begins when this macro contains at least one statically resolved xAPI path.</p>
    `;
  }
  return `
    ${coverage.compatibleVersions.length > 0
      ? versionGroup(
        'All xAPI references available',
        `${coverage.compatibleVersions.length} of ${coverage.totalVersions} verified schemas contain every static xAPI reference.`,
        coverage.compatibleVersions,
      )
      : '<div class="empty-state compact">No verified RoomOS version contains every static xAPI path in this macro.</div>'}
    ${coverage.totalReferences > 0
      ? `<div class="version-group compatibility-boundary-group">
          <div>
            <strong>Schema Availability Range</strong>
            <small>Shows the oldest and newest snapshots in each catalog channel that represent every detected static xAPI path. This is schema evidence, not a Compatibility judgment.</small>
          </div>
          ${compatibilityRangeColumns(coverage)}
        </div>`
      : ''}
    <div class="version-legend" aria-label="Schema coverage legend">
      <span><i class="exact"></i>Exact paths</span>
      <span><i class="warning"></i>Available with a parent-path warning</span>
    </div>
    <div class="unavailable-version-group">
      <div>
        <strong>Not available on these versions</strong>
        <small>Each version below is missing at least one static xAPI reference. The missing paths are listed with it.</small>
      </div>
      ${coverage.incompatibleVersions.length > 0
        ? unavailableVersionColumns(coverage.incompatibleVersions)
        : '<div class="all-available-state">Every verified schema contains all static xAPI references.</div>'}
    </div>
    <p class="schema-boundary-note"><strong>Schema absence means unavailable; parent paths remain represented with an amber warning.</strong> Parent paths count when at least one matching descendant exists. Schema coverage does not establish Compatibility, product support, endpoint setup, physical I/O, permissions, or runtime behavior.</p>
  `;
}

function renderOverview(
  session: AnalysisSessionResult,
  analysis: AnalysisSessionPresentation,
): void {
  const report = analysis.displayReport;
  elements.macroOverviewList.innerHTML = report.fileInventory.map((file, index) => {
    const references = report.inventory.references.filter(
      (reference) => reference.source.fileId === file.fileId,
    );
    const groups = groupReferences(references);
    const subscriptions = summarizeSubscriptions(references);
    const coverage = schemaCoverageForMacro(session, file.fileId);
    const findings = report.findings.filter((finding) =>
      finding.sourceFileIds.includes(file.fileId));
    const roles = file.roles.length > 0
      ? file.roles.map((role) => `${role} Macro`).join(' · ')
      : 'Supplied Macro';
    const activeState = file.activeState === 'Unknown' ? '' : ` · ${file.activeState}`;
    return `<details class="macro-overview-section" data-overview-macro="${escapeHtml(file.fileId)}">
      <summary>
        <span class="macro-overview-title-row">
          <span class="macro-overview-heading">
            <span>Macro ${index + 1} of ${report.fileInventory.length}</span>
            <strong>${escapeHtml(file.path)}</strong>
            <small>${escapeHtml(`${roles}${activeState} · ${file.analysisState}`)}</small>
          </span>
          <span class="macro-overview-toggle" aria-hidden="true"></span>
        </span>
        <span class="summary-grid">
          ${renderOverviewSummaryCards(references, groups, coverage, subscriptions, findings)}
        </span>
      </summary>
      <div class="macro-overview-content">
        <div class="overview-grid">
          <section class="result-card">
            <div class="card-heading"><div><p class="card-kicker">Macro contents</p><h3>xAPI usage by type</h3></div></div>
            <div class="branch-summary">${renderBranchSummary(references, groups, subscriptions)}</div>
          </section>
          <section class="result-card">
            <div class="card-heading"><div><p class="card-kicker">RoomOS relationship</p><h3>RoomOS schema availability</h3></div></div>
            <div class="schema-summary">${renderSchemaSummary(coverage)}</div>
          </section>
        </div>
      </div>
    </details>`;
  }).join('');

  const sourceCoverage = report.coverage;
  const newestRelease = report.provenance.schemaSnapshot.release;
  elements.coverageContent.innerHTML = `
    <div class="coverage-grid">
      <div class="coverage-item"><span>Files parsed</span><strong>${sourceCoverage.files.parsed} of ${sourceCoverage.files.reachable}</strong></div>
      <div class="coverage-item"><span>Static paths</span><strong>${sourceCoverage.xapiReferences.staticallyResolved} of ${sourceCoverage.xapiReferences.candidates}</strong></div>
      <div class="coverage-item"><span>Schema snapshots</span><strong>${analysis.coverage.totalVersions} checked</strong></div>
    </div>
    <strong>How to read these results</strong>
    <ul>
      <li>Full representation means every statically resolved xAPI path appears in that schema snapshot; it is not a Compatibility judgment.</li>
      <li>A parent-path warning means the complete path is absent, but at least one descendant of the same xAPI type exists.</li>
      <li>If a static path is absent from a snapshot, it is unavailable for that version, including when the whole xAPI kind is absent.</li>
      <li>Dynamic paths are excluded because the JavaScript determines them at runtime.</li>
      <li>Parameter and literal-value findings use the newest validated snapshot, RoomOS ${escapeHtml(newestRelease)}.</li>
      <li>Schema presence does not establish endpoint configuration, product capabilities, physical I/O, permissions, or observed runtime behavior.</li>
    </ul>
  `;
}

function plainPriority(finding: Finding): { label: string; className: string } {
  if (finding.priority === 'required') return { label: 'Required', className: 'needs-review' };
  if (finding.priority === 'warning') return { label: 'Warning', className: 'warning' };
  if (finding.priority === 'advisory') return { label: 'Advisory', className: 'recommendation' };
  return { label: 'Informational', className: '' };
}

function sourcePath(fileId: string): string {
  return state.files.find((selection) => selection.file.id === fileId)?.file.path
    ?? state.analysis?.schemas[0]?.report.fileInventory.find(
      (file) => file.fileId === fileId,
    )?.path
    ?? fileId;
}

function renderSourcePreview(sourceReference: SourceReference): string {
  const file = state.files.find((selection) => selection.file.id === sourceReference.fileId)?.file;
  if (!file) return '';

  const snippet = buildSourceSnippet(file.source, sourceReference.range);
  const code = snippet.lines.map((line) => `
    <span class="source-code-line ${line.highlighted ? 'highlighted' : ''}">
      <span class="source-code-number" aria-hidden="true">${line.number}</span>
      <span class="source-code-text">${escapeHtml(line.text)}</span>
    </span>`).join('');

  return `<pre aria-label="${escapeHtml(`${file.path}, lines ${snippet.startLine} through ${snippet.endLine}`)}"><code>${code}</code></pre>`;
}

function renderSourceSnippet(sourceReference: SourceReference): string {
  const reportedStart = sourceReference.range.start.line;
  const reportedEnd = sourceReference.range.end.line;
  const reportedLabel = reportedEnd > reportedStart
    ? `lines ${reportedStart}–${reportedEnd}`
    : `line ${reportedStart}`;
  const preview = renderSourcePreview(sourceReference);
  if (!preview) return '';
  return `<details class="source-snippet">
    <summary>View code near ${reportedLabel}</summary>
    ${preview}
  </details>`;
}

function renderSourceOccurrence(reference: ApiReference): string {
  return `<li class="source-occurrence">
    <div class="source-occurrence-heading">
      <span>${escapeHtml(sourcePath(reference.source.fileId))}:${reference.source.range.start.line}:${reference.source.range.start.column}</span>
      <span>${escapeHtml(reference.operation)} · ${escapeHtml(reference.syntax)}</span>
    </div>
    ${renderSourceSnippet(reference.source)}
  </li>`;
}

function findingMatches(finding: Finding): boolean {
  if (state.findingScope && state.analysis) {
    const matchingIds = new Set(
      deriveAnalysisSessionPresentation(state.analysis).primaryReport.findingImpacts
      .filter((impact) =>
        impact.impact === 'dependency'
        && impact.entryMacroId === state.findingScope?.fileId)
      .map((impact) => impact.findingId),
    );
    if (!matchingIds.has(finding.id)) return false;
  }
  if (state.findingFilter === 'all') return true;
  if (state.findingFilter === 'unknown') return finding.evidence === 'unknown';
  if (state.findingFilter === 'needs-review') {
    return finding.priority === 'required' && finding.evidence !== 'unknown';
  }
  return finding.priority === 'advisory';
}

function routesForFinding(report: AnalysisReport, finding: Finding): XapiBindingRoute[] {
  const routes = finding.observationIds.flatMap((id): XapiBindingRoute[] => {
    const observation = report.observationLedger.find((candidate) => candidate.id === id);
    if (!observation) return [];
    if (observation.kind === 'xapi-touchpoint') return observation.bindingRoutes;
    if (observation.kind === 'xapi-root-binding') return [observation.route];
    if (observation.kind === 'xapi-binding-flow') return [observation.route];
    if (observation.kind === 'xapi-flow-frontier') return observation.routes;
    return [];
  });
  const unique = [...new Map(routes.map((route) => [
    route.hops.map((hop) =>
      `${hop.bindingName}:${hop.transformation}:${hop.sourceReference.fileId}:${hop.sourceReference.range.start.line}:${hop.sourceReference.range.start.column}`,
    ).join('>'),
    route,
  ])).values()];
  return unique.filter((route) => {
    const routeKey = route.hops.map((hop) => `${hop.bindingName}:${hop.transformation}`).join('>');
    return !unique.some((candidate) => {
      const candidateKey = candidate.hops
        .map((hop) => `${hop.bindingName}:${hop.transformation}`)
        .join('>');
      return candidate.hops.length > route.hops.length && candidateKey.startsWith(routeKey);
    });
  });
}

function renderFindingRoutes(report: AnalysisReport, finding: Finding): string {
  const routes = routesForFinding(report, finding);
  if (routes.length === 0) return '';
  return `<details class="finding-evidence finding-evidence-collapsible">
    <summary>xAPI binding routes <span>${routes.length}</span></summary>
    <ul class="binding-route-list">${routes.map((route) => `
      <li>
        <code>${route.hops.map((hop) => escapeHtml(hop.bindingName)).join(' → ')}</code>
        <small>${route.hops.map((hop) =>
          `${escapeHtml(hop.transformation)} · ${escapeHtml(sourcePath(hop.sourceReference.fileId))}:${hop.sourceReference.range.start.line}:${hop.sourceReference.range.start.column}`,
        ).join(' → ')}</small>
      </li>`).join('')}
    </ul>
  </details>`;
}

function renderFindingDependencyPaths(report: AnalysisReport, finding: Finding): string {
  const paths = report.findingImpacts
    .filter((impact) => impact.findingId === finding.id && impact.impact === 'dependency')
    .flatMap((impact) => impact.dependencyPath ? [impact.dependencyPath] : []);
  const unique = [...new Map(paths.map((path) => [path.join('>'), path])).values()];
  if (unique.length === 0) return '';
  const missingById = new Map(report.unresolvedDependencyEdges.map((edge) => [
    edge.virtualFileId,
    edge.normalizedExpectedPath,
  ]));
  const label = (fileId: string) => missingById.get(fileId) ?? sourcePath(fileId);
  return `<details class="finding-evidence finding-evidence-collapsible">
    <summary>Dependency paths <span>${unique.length}</span></summary>
    <ul class="dependency-path-list">${unique.map((path) =>
      `<li><code>${path.map((fileId) => escapeHtml(label(fileId))).join(' → ')}</code></li>`).join('')}
    </ul>
  </details>`;
}

function renderCredentialTerms(report: AnalysisReport, finding: Finding): string {
  const observations = finding.observationIds
    .map((id) => report.observationLedger.find((candidate) => candidate.id === id))
    .filter((observation) => observation?.kind === 'credential-indicator');
  const counts = new Map<string, number>();
  for (const observation of observations) {
    if (observation?.kind !== 'credential-indicator') continue;
    counts.set(observation.submittedTerm, (counts.get(observation.submittedTerm) ?? 0) + 1);
  }
  if (counts.size === 0) return '';
  return `<section class="finding-evidence">
    <h5>Detected vocabulary matches</h5>
    <p>These exact source phrases matched the authentication and credential review vocabulary. The match identifies words to review, not a confirmed credential.</p>
    <div class="credential-term-list">${[...counts.entries()].map(([term, count]) =>
      `<span>${escapeHtml(term)} ×${count}</span>`).join('')}</div>
  </section>`;
}

function issueSourceLocationKey(sourceReference: SourceReference): string {
  return [
    sourceReference.fileId,
    sourceReference.range.start.line,
    sourceReference.range.end.line,
  ].join(':');
}

function sourceReviewProgressLabel(
  position: number,
  remainingCount: number,
  dismissedCount: number,
): string {
  if (remainingCount === 0) return `${dismissedCount} dismissed · none remaining`;
  return `${position} of ${remainingCount} remaining${dismissedCount > 0 ? ` · ${dismissedCount} dismissed` : ''}`;
}

function renderIssueSourceReview(
  reviewId: string,
  sourceReferences: SourceReference[],
  sourceReviews: Map<string, SourceReference[]>,
  description: string,
): string {
  if (sourceReferences.length === 0) return '';
  sourceReviews.set(reviewId, sourceReferences);
  const sourceCount = sourceReferences.length;
  const dismissed = state.dismissedIssueLocations.get(reviewId) ?? new Set<string>();
  const remainingReferences = sourceReferences.filter(
    (sourceReference) => !dismissed.has(issueSourceLocationKey(sourceReference)),
  );
  const firstReference = remainingReferences[0];
  const dismissedCount = sourceCount - remainingReferences.length;
  return `<section class="finding-evidence issue-source-review" data-source-review="${escapeHtml(reviewId)}">
    <div class="source-review-heading">
      <div>
        <h5>Review issue locations</h5>
        <p>${description}</p>
      </div>
      <span data-source-review-count aria-live="polite">${sourceReviewProgressLabel(firstReference ? 1 : 0, remainingReferences.length, dismissedCount)}</span>
    </div>
    <div class="source-review-frame" data-source-review-frame${firstReference ? '' : ' hidden'}>
      ${firstReference
        ? `<strong>${escapeHtml(`${sourcePath(firstReference.fileId)} · line ${firstReference.range.start.line}`)}</strong>
          ${renderSourcePreview(firstReference)}`
        : ''}
    </div>
    <div class="source-review-empty" data-source-review-empty${firstReference ? ' hidden' : ''}>
      <strong>All ${sourceCount} ${sourceCount === 1 ? 'issue' : 'issues'} dismissed</strong>
      <p>The analysis result and exported report are unchanged.</p>
    </div>
    <p class="source-review-boundary">Dismissal affects only this local review and resets when you analyze again. It does not change the analysis result or export.</p>
    <div class="source-review-controls">
      <button class="filter-button" type="button" data-source-review-restore${dismissedCount === 0 ? ' hidden' : ''}>Restore dismissed (${dismissedCount})</button>
      <span class="source-review-actions">
        <button class="filter-button" type="button" data-source-review-direction="previous" disabled>Previous location</button>
        <button class="filter-button" type="button" data-source-review-direction="next"${remainingReferences.length <= 1 ? ' disabled' : ''}>Next location</button>
        <button class="filter-button source-review-dismiss" type="button" data-source-review-dismiss${firstReference ? '' : ' disabled'}>Dismiss issue</button>
      </span>
    </div>
  </section>`;
}

function renderFindingSourceEvidence(
  finding: Finding,
  sourceReferences: SourceReference[],
  sourceReviews: Map<string, SourceReference[]>,
): string {
  const description = finding.code === 'source.sensitive-credential-indicator'
    ? `<strong>${sourceReferences.length} source ${sourceReferences.length === 1 ? 'location' : 'locations'}</strong> combine ${finding.observationIds.length} matched phrases. Review them one at a time or dismiss issues that do not need attention.`
    : `<strong>${sourceReferences.length} source ${sourceReferences.length === 1 ? 'location' : 'locations'}</strong> support this Finding. Review them one at a time or dismiss issues that do not need attention.`;
  return renderIssueSourceReview(
    `finding:${finding.id}`,
    sourceReferences,
    sourceReviews,
    description,
  );
}

function bindIssueSourceReviewControls(
  root: HTMLElement,
  sourceReviews: Map<string, SourceReference[]>,
): void {
  root.querySelectorAll<HTMLElement>('[data-source-review]').forEach((review) => {
    const findingId = review.dataset.sourceReview;
    const sourceReferences = findingId ? sourceReviews.get(findingId) : undefined;
    const frame = review.querySelector<HTMLElement>('[data-source-review-frame]');
    const empty = review.querySelector<HTMLElement>('[data-source-review-empty]');
    const count = review.querySelector<HTMLElement>('[data-source-review-count]');
    const dismiss = review.querySelector<HTMLButtonElement>('[data-source-review-dismiss]');
    const restore = review.querySelector<HTMLButtonElement>('[data-source-review-restore]');
    const previous = review.querySelector<HTMLButtonElement>('[data-source-review-direction="previous"]');
    const next = review.querySelector<HTMLButtonElement>('[data-source-review-direction="next"]');
    if (!sourceReferences || !frame || !empty || !count || !dismiss || !restore || !previous || !next) return;

    let currentIndex = 0;
    const remainingReferences = (): SourceReference[] => {
      const dismissed = state.dismissedIssueLocations.get(findingId ?? '');
      return dismissed
        ? sourceReferences.filter(
          (sourceReference) => !dismissed.has(issueSourceLocationKey(sourceReference)),
        )
        : sourceReferences;
    };
    const showSource = (): void => {
      const remaining = remainingReferences();
      currentIndex = Math.min(currentIndex, Math.max(remaining.length - 1, 0));
      const sourceReference = remaining[currentIndex];
      const dismissedCount = sourceReferences.length - remaining.length;
      count.textContent = sourceReviewProgressLabel(
        sourceReference ? currentIndex + 1 : 0,
        remaining.length,
        dismissedCount,
      );
      restore.hidden = dismissedCount === 0;
      restore.textContent = `Restore dismissed (${dismissedCount})`;
      dismiss.disabled = !sourceReference;
      previous.disabled = !sourceReference || currentIndex === 0;
      next.disabled = !sourceReference || currentIndex === remaining.length - 1;

      frame.hidden = !sourceReference;
      empty.hidden = Boolean(sourceReference);
      if (!sourceReference) return;
      frame.innerHTML = `
        <strong>${escapeHtml(`${sourcePath(sourceReference.fileId)} · line ${sourceReference.range.start.line}`)}</strong>
        ${renderSourcePreview(sourceReference)}
      `;
    };

    dismiss.addEventListener('click', () => {
      const sourceReference = remainingReferences()[currentIndex];
      if (!findingId || !sourceReference) return;
      const dismissed = state.dismissedIssueLocations.get(findingId) ?? new Set<string>();
      dismissed.add(issueSourceLocationKey(sourceReference));
      state.dismissedIssueLocations.set(findingId, dismissed);
      showSource();
    });
    restore.addEventListener('click', () => {
      if (!findingId) return;
      state.dismissedIssueLocations.delete(findingId);
      currentIndex = 0;
      showSource();
    });
    previous.addEventListener('click', () => {
      currentIndex -= 1;
      showSource();
    });
    next.addEventListener('click', () => {
      currentIndex += 1;
      showSource();
    });
  });
}

function renderCanonicalFindingReference(finding: Finding): string {
  const reference = finding.relatedXapiReference;
  if (!reference?.complete || !reference.documentationUrl) return '';
  return `<section class="finding-evidence canonical-finding-reference">
    <h5>Canonical xAPI reference</h5>
    <code>${escapeHtml(reference.kind)} ${escapeHtml(reference.normalizedPathSegments.join(' '))} · ${escapeHtml(reference.operation)}</code>
    ${reference.preferredNewStyleExpression
      ? `<small>${escapeHtml(reference.preferredNewStyleExpression)}</small>`
      : ''}
    <a href="${escapeHtml(reference.documentationUrl)}" target="_blank" rel="noreferrer">Open this xAPI in RoomOS documentation ↗</a>
  </section>`;
}

function renderFindingList(report: AnalysisReport): void {
  const findings = report.findings.filter(findingMatches);
  const groups = groupFindingsByMacro(report.fileInventory, findings);
  const sourceReviews = new Map<string, SourceReference[]>();
  const priorityLabels: Record<Finding['priority'], string> = {
    required: 'Required',
    warning: 'Warning',
    advisory: 'Advisory',
    informational: 'Informational',
  };
  const priorityClasses: Record<Finding['priority'], string> = {
    required: 'needs-review',
    warning: 'warning',
    advisory: 'recommendation',
    informational: '',
  };

  function findingCard(finding: Finding, showMacroList: boolean): string {
    const plain = plainPriority(finding);
    const findingObservations = finding.observationIds
      .map((id) => report.observationLedger.find((observation) => observation.id === id))
      .filter((observation) => Boolean(observation));
    const sourceReferences = findingObservations
      .map((observation) => observation?.sourceReference)
      .filter((reference): reference is SourceReference => Boolean(reference));
    const uniqueSources = [...new Map(sourceReferences.map((reference) => [
      `${reference.fileId}:${reference.range.start.line}:${reference.range.start.column}:${reference.range.end.line}:${reference.range.end.column}`,
      reference,
    ])).values()];
    const occurrenceCount = uniqueSources.length;
    const visibleSnippetSources = uniqueSources.filter((reference) =>
      !findingObservations.some((observation) =>
        observation?.kind === 'credential-indicator'
        && observation.location === 'filename'
        && observation.sourceReference.fileId === reference.fileId
        && observation.sourceReference.range.start.line === reference.range.start.line
        && observation.sourceReference.range.start.column === reference.range.start.column
        && observation.sourceReference.range.end.line === reference.range.end.line
        && observation.sourceReference.range.end.column === reference.range.end.column));
    const snippetSources = [...new Map(visibleSnippetSources.map((reference) => [
      `${reference.fileId}:${reference.range.start.line}:${reference.range.end.line}`,
      reference,
    ])).values()];
    const sourceFiles = [...new Set(finding.sourceFileIds.map(sourcePath))].sort();
    const summaryParts = [
      `${occurrenceCount} ${occurrenceCount === 1 ? 'occurrence' : 'occurrences'}`,
      `${finding.affectedEntryMacroIds.length} affected ${finding.affectedEntryMacroIds.length === 1 ? 'Entry Macro' : 'Entry Macros'}`,
      ...(showMacroList ? [`${sourceFiles.length} source ${sourceFiles.length === 1 ? 'macro' : 'macros'}`] : []),
    ];

    return `<details class="finding" data-finding-id="${escapeHtml(finding.id)}">
      <summary>
        <span class="finding-summary-main">
          <span class="finding-tags"><span class="tag ${plain.className}">${plain.label}</span><span class="tag">${escapeHtml(finding.category)}</span></span>
          <strong>${escapeHtml(finding.title)}</strong>
          <small>${summaryParts.map(escapeHtml).join(' · ')}</small>
        </span>
        <span class="reference-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="finding-detail">
        <p>${escapeHtml(finding.summary)}</p>
        <p class="finding-next"><strong>Recommended action:</strong> ${escapeHtml(finding.recommendedAction)}</p>
        ${showMacroList ? `<section class="finding-evidence"><h5>Macros involved</h5><div class="finding-macro-list">${sourceFiles.map((path) => `<span>${escapeHtml(path)}</span>`).join('')}</div></section>` : ''}
        ${renderCredentialTerms(report, finding)}
        ${renderCanonicalFindingReference(finding)}
        ${renderFindingRoutes(report, finding)}
        ${renderFindingDependencyPaths(report, finding)}
        ${renderFindingSourceEvidence(finding, snippetSources, sourceReviews)}
        <details class="finding-rationale">
          <summary>Technical details</summary>
          <div>
            <section><h5>Technical basis</h5><p>${escapeHtml(finding.technicalBasis)}</p></section>
            <section><h5>Limitations</h5>${finding.limitations.map((limitation) => `<p>${escapeHtml(limitation)}</p>`).join('')}</section>
            ${finding.citation ? `<a href="${escapeHtml(finding.citation)}" target="_blank" rel="noreferrer">Open supporting documentation ↗</a>` : ''}
          </div>
        </details>
      </div>
    </details>`;
  }

  function renderMacroFindingSection(group: ReturnType<typeof groupFindingsByMacro>[number]): string {
    const priorityCounts = (Object.keys(priorityLabels) as Finding['priority'][]).flatMap((priority) =>
      group.counts[priority] > 0
        ? [`<span class="tag ${priorityClasses[priority]}">${group.counts[priority]} ${priorityLabels[priority]}</span>`]
        : []);
    return `<details class="macro-finding-section ${group.kind === 'cross-macro' ? 'cross-macro' : ''}" data-finding-group="${escapeHtml(group.key)}">
      <summary>
        <span class="file-icon">${group.kind === 'cross-macro' ? '↔' : 'JS'}</span>
        <span class="macro-finding-heading">
          <strong>${escapeHtml(group.title)}</strong>
          <small>${group.findings.length} ${group.findings.length === 1 ? 'Finding' : 'Findings'}${group.kind === 'cross-macro' ? ` · ${group.fileIds.length} macros involved` : ''}</small>
        </span>
        <span class="macro-priority-counts">${priorityCounts.join('')}</span>
        <span class="reference-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="macro-finding-content">
        ${group.findings.map((finding) => findingCard(finding, group.kind === 'cross-macro')).join('')}
      </div>
    </details>`;
  }

  elements.findingList.innerHTML = groups.length > 0
    ? groups.map(renderMacroFindingSection).join('')
    : '<div class="empty-state compact">No Findings match the current view.</div>';
  bindIssueSourceReviewControls(elements.findingList, sourceReviews);
}

function renderFindings(report: AnalysisReport): void {
  elements.findingFilters.innerHTML = state.findingScope
    ? `<span class="active-finding-filter">Dependency impacts on ${escapeHtml(sourcePath(state.findingScope.fileId))}</span><button class="filter-button" id="clear-finding-scope" type="button">Show all Findings</button>`
    : '<span class="active-finding-filter">All canonical Findings, grouped by source macro</span>';
  elements.findingFilters.querySelector<HTMLButtonElement>('#clear-finding-scope')?.addEventListener('click', () => {
    state.findingScope = undefined;
    renderFindings(report);
  });
  renderFindingList(report);
}

function renderAndroidContainerIssues(report: AnalysisReport): void {
  const readiness = calculateAndroidContainerReadiness(report.inventory.references);
  const referenceGroups = new Map(groupReferences(report.inventory.references).map((group) => [group.key, group]));
  const sourceReviews = new Map<string, SourceReference[]>();
  const issueGroups = groupAndroidContainerIssuesByMacro(
    report.fileInventory,
    report.inventory.references,
    readiness.issues,
  );
  const dynamic = report.coverage.xapiReferences.dynamic;
  const percentage = readiness.percentage ?? 0;
  const unresolved = readiness.unknown + readiness.notFound;
  const scoreClass = readiness.percentage === null
    ? 'unknown'
    : readiness.percentage === 100 && unresolved === 0
      ? 'ready'
      : readiness.percentage === 0
        ? 'blocked'
        : 'partial';
  const readinessSummary = readiness.total === 0
    ? 'No statically resolved xAPI paths were found.'
    : readiness.determined === 0
      ? `The schema conventions do not establish Android Container availability for any of the ${readiness.total} unique xAPI paths.`
      : `${readiness.available} of ${readiness.determined} unique xAPI ${readiness.determined === 1 ? 'path classified' : 'paths classified'} by the schema conventions ${readiness.available === 1 ? 'is' : 'are'} available.${unresolved > 0 ? ` ${unresolved} ${unresolved === 1 ? 'path remains' : 'paths remain'} unresolved.` : ''}`;
  const readinessHeading = readiness.total === 0
    ? 'No schema availability percentage'
    : readiness.determined === 0
      ? 'Availability could not be determined'
      : readiness.unavailable > 0
        ? 'Some paths are explicitly unavailable'
        : unresolved > 0
          ? 'Classified paths are available'
          : 'All detected paths are classified as available';
  elements.androidContainerTabCount.textContent = String(readiness.issues.length);
  elements.androidContainerReadinessDetail.innerHTML = `
    <div class="android-readiness-layout">
      <div class="android-readiness-score ${scoreClass}">
        <strong>${readiness.percentage === null ? '—' : `${readiness.percentage}%`}</strong>
        <span>schema availability</span>
      </div>
      <div class="android-readiness-detail">
        <strong>${readinessHeading}</strong>
        <div class="android-readiness-track" role="progressbar" aria-label="Android Container schema availability" aria-valuemin="0" aria-valuemax="100" ${readiness.percentage === null ? '' : `aria-valuenow="${readiness.percentage}"`}>
          <i class="${scoreClass}" style="width:${percentage}%"></i>
        </div>
        <p>${escapeHtml(readinessSummary)}</p>
        <div class="android-readiness-counts">
          <span class="available"><b>${readiness.available}</b> available</span>
          <span class="unavailable"><b>${readiness.unavailable}</b> explicitly unavailable</span>
          <span class="unknown"><b>${readiness.unknown}</b> availability unknown</span>
          <span class="not-found"><b>${readiness.notFound}</b> not found in RoomOS schema</span>
        </div>
        ${dynamic > 0 ? `<small>${dynamic} dynamic xAPI ${dynamic === 1 ? 'path is' : 'paths are'} excluded because schema availability could not be determined.</small>` : ''}
      </div>
    </div>
    <p class="schema-boundary-note"><strong>This percentage uses the Android Container support rule and Microsoft Teams availability conventions in the newest verified schema, RoomOS ${escapeHtml(report.provenance.schemaSnapshot.release)}.</strong> A schema with no container metadata is treated as not supporting the Android Container. Unknown, not-found, and dynamic paths are excluded. The schema does not provide equivalent general availability metadata for Zoom Rooms, and this result does not verify runtime behavior.</p>
  `;
  elements.androidContainerIssueSummary.innerHTML = `
    <div class="container-issue-stat"><span>Explicitly unavailable</span><strong>${readiness.unavailable}</strong><small>The schema has no container metadata, or its applicable allowlist or denylist excludes the path</small></div>
    <div class="container-issue-stat"><span>Unknown</span><strong>${readiness.unknown}</strong><small>The schema evidence cannot establish container availability</small></div>
    <div class="container-issue-stat"><span>Not found</span><strong>${readiness.notFound}</strong><small>Path is absent from the newest validated RoomOS schema</small></div>
    <div class="container-issue-stat"><span>Dynamic paths</span><strong>${dynamic}</strong><small>Excluded because the path is determined at runtime</small></div>
  `;

  elements.androidContainerIssueList.innerHTML = readiness.issues.length === 0
    ? '<div class="empty-state">No Android Container issues were found for statically resolved xAPI paths in the newest verified RoomOS schema.</div>'
    : issueGroups.map((issueGroup) => {
      const countPresentation: Record<AndroidContainerIssueReason, { label: string; className: string }> = {
        'explicitly-unavailable': { label: 'Explicitly unavailable', className: 'needs-review' },
        'not-found': { label: 'Not found', className: 'not-found' },
        unknown: { label: 'Unknown', className: 'unknown' },
      };
      const issueCounts = (Object.keys(countPresentation) as AndroidContainerIssueReason[])
        .flatMap((reason) => issueGroup.counts[reason] > 0
          ? [`<span class="tag ${countPresentation[reason].className}">${issueGroup.counts[reason]} ${countPresentation[reason].label}</span>`]
          : []);
      return `<details class="macro-finding-section android-issue-section ${issueGroup.kind === 'cross-macro' ? 'cross-macro' : ''}" data-android-issue-group="${escapeHtml(issueGroup.key)}">
        <summary>
          <span class="file-icon">${issueGroup.kind === 'cross-macro' ? '↔' : 'JS'}</span>
          <span class="macro-finding-heading">
            <strong>${escapeHtml(issueGroup.title)}</strong>
            <small>${issueGroup.issues.length} Android ${issueGroup.issues.length === 1 ? 'Issue' : 'Issues'}${issueGroup.kind === 'cross-macro' ? ` · ${issueGroup.fileIds.length} macros involved` : ''}</small>
          </span>
          <span class="macro-priority-counts">${issueCounts.join('')}</span>
          <span class="reference-chevron" aria-hidden="true">⌄</span>
        </summary>
        <div class="macro-finding-content">
          ${issueGroup.issues.map((issue) => renderAndroidContainerIssue(issueGroup, issue)).join('')}
        </div>
      </details>`;
    }).join('');
  bindIssueSourceReviewControls(elements.androidContainerIssueList, sourceReviews);

  function renderAndroidContainerIssue(
    issueGroup: AndroidContainerIssueGroup,
    issue: AndroidContainerIssueGroup['issues'][number],
  ): string {
    const referenceGroup = referenceGroups.get(issue.key);
    if (!referenceGroup) return '';
    const representative = referenceGroup.references[0]!;
    const explicitlyUnavailable = issue.reason === 'explicitly-unavailable';
    const unknown = issue.reason === 'unknown';
    const label = explicitlyUnavailable
      ? 'Explicitly unavailable'
      : unknown
        ? 'Availability unknown'
        : 'Not found in RoomOS schema';
    const explanation = explicitlyUnavailable
      ? representative.schemaEvidence.operatingMode.basis === 'missing-metadata'
        ? 'The newest RoomOS schema contains no Android Container availability metadata, so this release is treated as not supporting the container.'
        : 'The newest RoomOS schema excludes this xAPI path through its applicable extension allowlist or command unavailable-state denylist. Review this dependency for Microsoft Teams Rooms deployments.'
      : unknown
        ? 'The xAPI path exists, but the metadata-bearing snapshot has no applicable convention for this xAPI kind or its product variants conflict. No availability assumption is made.'
        : 'The newest RoomOS schema does not contain this xAPI path, so Android Container availability cannot be established. Check the path and its RoomOS version history.';
    const sourceSummary = issueGroup.kind === 'cross-macro'
      ? `${referenceGroup.references.length} ${referenceGroup.references.length === 1 ? 'use' : 'uses'} across ${new Set(referenceGroup.references.map((reference) => reference.source.fileId)).size} macros`
      : `${referenceGroup.references.length} ${referenceGroup.references.length === 1 ? 'use' : 'uses'}`;
    const sourceReferences = [...new Map(referenceGroup.references.map((reference) => [
      issueSourceLocationKey(reference.source),
      reference.source,
    ])).values()];
    return `<details class="container-issue-card ${issue.reason}">
        <summary>
          <span class="finding-summary-main">
            <span class="finding-tags"><span class="tag reference-kind">${escapeHtml(issue.kind)}</span><span class="tag ${explicitlyUnavailable ? 'needs-review' : unknown ? 'unknown' : 'not-found'}">${escapeHtml(label)}</span></span>
            <strong>${escapeHtml(issue.path)}</strong>
            <small>${escapeHtml(sourceSummary)}</small>
          </span>
          <span class="reference-chevron" aria-hidden="true">⌄</span>
        </summary>
        <div class="container-issue-detail">
          <p>${escapeHtml(explanation)}</p>
          ${renderIssueSourceReview(
            `android:${issueGroup.key}:${issue.key}`,
            sourceReferences,
            sourceReviews,
            `<strong>${sourceReferences.length} source ${sourceReferences.length === 1 ? 'location uses' : 'locations use'}</strong> this xAPI path. Review them one at a time or dismiss issues that do not need attention.`,
          )}
          <a class="roomos-link" href="${escapeHtml(representative.schemaEvidence.documentationUrl)}" target="_blank" rel="noreferrer">Open this xAPI in RoomOS documentation ↗</a>
        </div>
      </details>`;
  }
}

function operationCounts(references: ApiReference[]): string {
  const counts = new Map<string, number>();
  for (const reference of references) {
    counts.set(reference.operation, (counts.get(reference.operation) ?? 0) + 1);
  }
  return [...counts.entries()].map(([operation, count]) => `${operation} ${count}`).join(' · ');
}

function coverageBadge(coverage: ReferenceSchemaCoverage, totalVersions: number): { label: string; className: string } {
  const present = coverage.exactVersions.length + coverage.parentVersions.length;
  if (present === 0) {
    return {
      label: `Not found in ${coverage.missingVersions.length}`,
      className: 'missing',
    };
  }
  if (coverage.parentVersions.length > 0) {
    return { label: `${present}/${totalVersions} versions · parent warning`, className: 'parent' };
  }
  if (coverage.missingVersions.length > 0) {
    return {
      label: `${present}/${totalVersions} versions`,
      className: 'restricted',
    };
  }
  return { label: `All ${totalVersions} versions`, className: 'found' };
}

function referenceVersionGroup(
  label: string,
  detail: string,
  versions: SchemaVersionIdentity[],
  className = '',
): string {
  return `<section class="version-list-section ${className}">
    <div><h4>${escapeHtml(label)} <span>${versions.length}</span></h4><p>${escapeHtml(detail)}</p></div>
    ${versions.length > 0
      ? versionChannelColumns(versions, className)
      : '<small>None</small>'}
  </section>`;
}

function renderReferenceList(analysis: AnalysisSessionPresentation): void {
  const query = state.referenceSearch.trim().toLowerCase();
  const macroGroups = groupReferencesByMacro(
    analysis.primaryReport.fileInventory,
    analysis.primaryReport.inventory.references,
  ).map((macroGroup) => ({
    ...macroGroup,
    referenceGroups: macroGroup.referenceGroups.filter((group) =>
      (state.referenceKind === 'all' || group.kind === state.referenceKind)
      && (!query || `${group.kind} ${group.path}`.toLowerCase().includes(query)),
    ),
  })).filter((macroGroup) => macroGroup.referenceGroups.length > 0);
  if (macroGroups.length === 0) {
    elements.referenceList.innerHTML = '<div class="empty-state">No xAPI references match these filters.</div>';
    return;
  }

  const coverageByKey = new Map(analysis.coverage.references.map((coverage) => [coverage.key, coverage]));
  const renderReferenceCard = (group: ReferenceGroup): string => {
    const coverage = coverageByKey.get(group.key);
    if (!coverage) return '';
    const badge = coverageBadge(coverage, analysis.coverage.totalVersions);
    const syntaxes = [...new Set(group.references.map((reference) => reference.syntax))].join(' + ');
    const documentationUrl = group.references[0]!.schemaEvidence.documentationUrl;
    return `<details class="reference-card">
      <summary>
        <span class="tag reference-kind">${escapeHtml(group.kind)}</span>
        <span class="reference-name"><strong>${escapeHtml(group.path)}</strong><small>${group.references.length} ${group.references.length === 1 ? 'use' : 'uses'} · ${escapeHtml(operationCounts(group.references))} · ${escapeHtml(syntaxes)} syntax</small></span>
        <span class="schema-badge ${badge.className}">${escapeHtml(badge.label)}</span>
        <span class="reference-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="reference-detail">
        <div class="reference-version-coverage">
          ${referenceVersionGroup(
            'Exact path',
            'The complete xAPI path appears in these schemas.',
            coverage.exactVersions,
          )}
          ${coverage.parentVersions.length > 0
            ? referenceVersionGroup(
              'Parent branch',
              'The complete path is absent, but at least one matching descendant exists.',
              coverage.parentVersions,
              'warning',
            )
            : ''}
          ${coverage.missingVersions.length > 0
            ? referenceVersionGroup(
              'Not found',
              'No exact path or matching descendant appears in these schemas.',
              coverage.missingVersions,
              'missing',
            )
            : ''}
        </div>
        ${coverage.parentVersions.length > 0
          ? '<p class="schema-boundary-note compact"><strong>Parent-path warning:</strong> these versions are eligible because at least one node below the referenced branch exists. This is not a complete leaf-path match.</p>'
          : ''}
        <p class="schema-boundary-note compact">Schema presence confirms documented API structure only. It does not verify endpoint setup, product support, connected physical I/O, permissions, or runtime behavior.</p>
        <div class="reference-subgrid single">
          <div><h4>Source occurrences</h4><ul class="occurrence-list">${group.references.map((reference) => `<li><span>${escapeHtml(sourcePath(reference.source.fileId))}:${reference.source.range.start.line}:${reference.source.range.start.column}</span><span>${escapeHtml(reference.operation)} · ${escapeHtml(reference.syntax)}</span></li>`).join('')}</ul></div>
        </div>
        <a class="roomos-link" href="${escapeHtml(documentationUrl)}" target="_blank" rel="noreferrer">Open this xAPI in RoomOS documentation ↗</a>
      </div>
    </details>`;
  };

  const filtersActive = Boolean(query) || state.referenceKind !== 'all';
  elements.referenceList.innerHTML = macroGroups.map((macroGroup) => {
    const visibleUses = macroGroup.referenceGroups.reduce(
      (total, group) => total + group.references.length,
      0,
    );
    return `<details class="macro-reference-section"${filtersActive ? ' open' : ''} data-reference-macro="${escapeHtml(macroGroup.fileId)}">
      <summary>
        <span class="file-icon">JS</span>
        <span class="macro-reference-heading">
          <strong>${escapeHtml(macroGroup.title)}</strong>
          <small>${macroGroup.referenceGroups.length} ${macroGroup.referenceGroups.length === 1 ? 'xAPI' : 'xAPIs'} · ${visibleUses} ${visibleUses === 1 ? 'use' : 'uses'}</small>
        </span>
        <span class="reference-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="macro-reference-content">
        ${macroGroup.referenceGroups.map(renderReferenceCard).join('')}
      </div>
    </details>`;
  }).join('');
}

function activateResultTab(key: string): void {
  document.querySelectorAll<HTMLButtonElement>('[data-result-tab]').forEach((button) =>
    button.setAttribute('aria-selected', String(button.dataset.resultTab === key)),
  );
  document.querySelectorAll<HTMLElement>('.tab-panel').forEach((panel) => {
    panel.hidden = panel.id !== `tab-${key}`;
  });
}

function renderAnalysis(session: AnalysisSessionResult): void {
  const analysis = deriveAnalysisSessionPresentation(session);
  state.analysis = session;
  state.findingFilter = 'all';
  state.findingScope = undefined;
  state.dismissedIssueLocations.clear();
  state.referenceSearch = '';
  state.referenceKind = 'all';
  elements.xapiSearch.value = '';
  elements.xapiKindFilter.value = 'all';
  const groups = analysis.referenceGroups;
  const entryCount = analysis.summary.entryMacros;
  elements.resultContext.textContent = `Compared with all ${analysis.coverage.totalVersions} verified RoomOS schema snapshots`;
  elements.relationshipsTabCount.textContent = String(entryCount);
  elements.issuesTabCount.textContent = String(analysis.displayReport.findings.length);
  elements.xapiTabCount.textContent = String(groups.length);
  renderOverview(session, analysis);
  renderMacroRelationships(analysis.displayReport);
  renderFindings(analysis.displayReport);
  renderAndroidContainerIssues(analysis.primaryReport);
  renderReferenceList(analysis);
  renderFiles();
  activateResultTab('overview');
  elements.results.hidden = false;
  elements.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function importAnalysisFile(file: File): Promise<void> {
  const originalLabel = elements.analysisImportButton.textContent;
  elements.analysisImportButton.disabled = true;
  elements.analysisImportButton.textContent = 'Importing…';
  state.analysisImportError = undefined;
  updateReadiness();
  await yieldToBrowser();
  try {
    const session = await importAnalysisSessionJson(await file.text());
    if (!await confirmAnalysisPurge({
      message: 'Importing this Analysis JSON will permanently clear the current analyzed results from this browser.',
      confirmLabel: 'Import and replace',
    })) return;
    state.files = [];
    state.importedAnalysisName = file.name;
    renderAnalysis(session);
  } catch (error) {
    state.analysisImportError =
      error instanceof Error ? error.message : 'Unknown import failure.';
    updateReadiness();
  } finally {
    elements.analysisImportButton.disabled = false;
    elements.analysisImportButton.textContent = originalLabel;
    elements.analysisImportInput.value = '';
  }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function showAnalysisProgress(current: number, total: number): void {
  const progress = total > 0 ? Math.min(Math.max(current, 0), total) : 0;
  const percentage = total > 0 ? (progress / total) * 100 : 0;
  elements.analysisProgress.hidden = false;
  elements.analysisProgressTrack.setAttribute('aria-valuemax', String(total));
  elements.analysisProgressTrack.setAttribute('aria-valuenow', String(progress));
  elements.analysisProgressFill.style.width = `${percentage}%`;
  elements.analysisProgressValue.textContent = `${progress} of ${total}`;
}

function hideAnalysisProgress(): void {
  elements.analysisProgress.hidden = true;
  elements.analysisProgressTrack.setAttribute('aria-valuemax', '0');
  elements.analysisProgressTrack.setAttribute('aria-valuenow', '0');
  elements.analysisProgressFill.style.width = '0%';
  elements.analysisProgressValue.textContent = '0 of 0';
}

async function runAnalysis(): Promise<void> {
  const catalog = state.catalog;
  if (!catalog) return;
  if (!await confirmAnalysisPurge({
    message: 'Running a new analysis will permanently replace the current analyzed results in this browser.',
    confirmLabel: 'Run new analysis',
  })) return;
  const endpointAtStart = state.endpoint?.xapi;
  const buttonLabel = elements.analyzeButton.querySelector('span');
  state.analysisError = undefined;
  elements.readinessMessage.setAttribute('role', 'status');
  elements.readinessMessage.classList.remove('error');
  elements.analyzeButton.disabled = true;
  if (buttonLabel) buttonLabel.textContent = 'Analyzing…';
  showAnalysisProgress(0, catalog.snapshots.length);
  const analysisTime = new Date().toISOString();
  const macroSet = buildIncludedMacroSet(state.files);

  try {
    const versionAnalyses: SchemaVersionAnalysis[] = [];
    const schemaAnalyses: AnalysisSessionSchema[] = [];
    for (const [index, snapshot] of catalog.snapshots.entries()) {
      if (endpointAtStart && state.endpoint?.xapi !== endpointAtStart) return;
      elements.readinessMessage.textContent = `Checking RoomOS ${snapshot.label} · ${index + 1} of ${catalog.snapshots.length}`;
      showAnalysisProgress(index + 1, catalog.snapshots.length);
      await yieldToBrowser();
      const verifiedSchema = await loadSchema(snapshot);
      const outcome = analyzeMacroSet({
        macroSet,
        target: { kind: 'exploratory', partial: { release: snapshot.release } },
        schemaSnapshot: verifiedSchema.schema,
        rulePack,
        analysisTime,
      });
      if (outcome.kind === 'analysis-failure') throw new Error(outcome.failure.message);
      schemaAnalyses.push({
        provenance: verifiedSchema.provenance,
        report: outcome.report,
      });
      versionAnalyses.push({
        version: {
          id: snapshot.id,
          release: snapshot.release,
          label: `RoomOS ${snapshot.label}`,
          channel: snapshot.channel,
          sha256: snapshot.sha256,
        },
        references: outcome.report.inventory.references,
      });
    }
    if (schemaAnalyses.length === 0) throw new Error('No RoomOS schemas were analyzed.');

    const coverage = buildSchemaCoverage(versionAnalyses);
    const session = buildAnalysisSession({
      generatedAt: analysisTime,
      schemas: schemaAnalyses,
      comparison: coverage,
      effectiveRulePack,
    });
    if (endpointAtStart && state.endpoint?.xapi !== endpointAtStart) return;
    renderAnalysis(session);
    elements.readinessMessage.textContent = `Analysis complete across ${coverage.totalVersions} RoomOS versions.`;
    trackMacroAnalysisCompleted(
      summarizeMacroSyntax(macroSet.files),
      endpointAtStart ? 'endpoint' : 'manual',
    );
  } catch (error) {
    state.analysisError = error instanceof Error ? error.message : 'Unknown analysis failure.';
  } finally {
    hideAnalysisProgress();
    if (buttonLabel) buttonLabel.textContent = 'Analyze macro';
    updateReadiness();
  }
}

async function exportAnalysisJson(): Promise<void> {
  if (!state.analysis) return;
  const session = state.analysis;
  const defaultName = defaultAnalysisExportName({
    generatedAt: session.generatedAt,
    endpointName: state.endpoint?.broadcastName,
  });
  const reportName = normalizeAnalysisExportName(
    elements.exportName.value,
    defaultName,
  );
  elements.exportName.value = reportName;
  elements.exportAnalysisButton.disabled = true;
  elements.exportAnalysisStatus.textContent = 'Preparing…';
  await yieldToBrowser();
  try {
    const blob = await createAnalysisExportBlob(session);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${reportName}.zip`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    elements.exportAnalysisStatus.textContent = 'Exported';
  } catch {
    elements.exportAnalysisStatus.textContent = 'Export failed';
  } finally {
    elements.exportAnalysisButton.disabled = false;
    window.setTimeout(() => {
      elements.exportAnalysisStatus.textContent = 'Download';
    }, 1400);
  }
}

function openExportDialog(): void {
  const session = state.analysis;
  if (!session) return;
  const defaultName = defaultAnalysisExportName({
    generatedAt: session.generatedAt,
    endpointName: state.endpoint?.broadcastName,
  });
  const analysisKey = `${session.generatedAt}|${state.endpoint?.broadcastName ?? ''}`;
  if (elements.exportDialog.dataset.analysisKey !== analysisKey) {
    elements.exportName.value = defaultName;
    elements.exportDialog.dataset.analysisKey = analysisKey;
  }
  elements.exportDialog.showModal();
  elements.exportName.focus();
  elements.exportName.select();
}

elements.themeSelect.addEventListener('change', () => {
  themeMode = parseThemeMode(elements.themeSelect.value);
  applyThemeMode(themeMode);
  saveThemeMode(themeMode);
});
systemColorScheme.addEventListener('change', () => {
  if (themeMode === 'system') applyThemeMode(themeMode);
});
elements.aboutButton.addEventListener('click', () => elements.aboutDialog.showModal());
elements.privacyButton.addEventListener('click', () => elements.privacyDialog.showModal());
elements.macroListButton.addEventListener('click', () => {
  if (state.files.length > 0) elements.macroListDialog.showModal();
});
elements.macroSelectAll.addEventListener('click', () => void setAllMacrosIncluded(true));
elements.macroClearAll.addEventListener('click', () => void setAllMacrosIncluded(false));
elements.endpointButton.addEventListener('click', () => {
  if (state.endpoint) elements.endpointDisconnectDialog.showModal();
  else openEndpointDialog();
});
elements.endpointForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void connectEndpoint();
});
elements.endpointDialog.addEventListener('close', () => {
  elements.endpointPassword.value = '';
  clearEndpointDialogError();
});
elements.endpointDisconnectConfirm.addEventListener('click', disconnectEndpoint);
document.querySelectorAll<HTMLButtonElement>('[data-dialog-close]').forEach((button) =>
  button.addEventListener('click', () => byId<HTMLDialogElement>(button.dataset.dialogClose ?? '').close()),
);
elements.fileInput.addEventListener('change', () => {
  if (elements.fileInput.files) void addBrowserFiles(elements.fileInput.files);
  elements.fileInput.value = '';
});
elements.analysisImportButton.addEventListener(
  'click',
  () => elements.analysisImportInput.click(),
);
elements.analysisImportInput.addEventListener('change', () => {
  const file = elements.analysisImportInput.files?.[0];
  if (file) void importAnalysisFile(file);
});
elements.dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  elements.dropZone.classList.add('is-dragging');
});
elements.dropZone.addEventListener('dragleave', () => elements.dropZone.classList.remove('is-dragging'));
elements.dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  elements.dropZone.classList.remove('is-dragging');
  if (event.dataTransfer?.files) void addBrowserFiles(event.dataTransfer.files);
});
if (import.meta.env.DEV) {
  elements.demoButton.hidden = false;
  elements.demoButton.addEventListener('click', () => void loadExample());
}
elements.clearButton.addEventListener('click', async () => {
  if (state.endpoint) return;
  if (!await confirmAnalysisPurge({
    message: 'Clearing the Macro Set will permanently clear the current analyzed results from this browser.',
    confirmLabel: 'Clear Macro Set',
  })) return;
  state.files = [];
  resetAnalysis();
  renderFiles();
});
elements.analyzeButton.addEventListener('click', () => void runAnalysis());
elements.exportButton.addEventListener('click', openExportDialog);
elements.exportAnalysisButton.addEventListener('click', () => void exportAnalysisJson());
document.querySelectorAll<HTMLButtonElement>('[data-result-tab]').forEach((button) =>
  button.addEventListener('click', () => activateResultTab(button.dataset.resultTab ?? 'overview')),
);
elements.xapiSearch.addEventListener('input', () => {
  state.referenceSearch = elements.xapiSearch.value;
  if (state.analysis) {
    renderReferenceList(deriveAnalysisSessionPresentation(state.analysis));
  }
});
elements.xapiKindFilter.addEventListener('change', () => {
  state.referenceKind = elements.xapiKindFilter.value as typeof state.referenceKind;
  if (state.analysis) {
    renderReferenceList(deriveAnalysisSessionPresentation(state.analysis));
  }
});
window.addEventListener('resize', () => {
  if (elements.dependencyMapDialog.open && dependencyMapView?.zoomMode === 'fit') {
    fitDependencyMap();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (import.meta.env.DEV || !state.analysis) return;
  event.preventDefault();
  event.returnValue = true;
});
window.addEventListener('pagehide', () => state.endpoint?.xapi.close());

initializeProductTelemetry();
renderFiles();
renderRecentEndpoints();
void loadCatalog();
