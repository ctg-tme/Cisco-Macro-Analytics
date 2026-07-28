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
  renderDependencyMapSvg,
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
import {
  dependencyMapExampleFiles,
} from './examples/dependencyMapExample';
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
  endpoint?: EndpointSession;
  recentEndpoints: RecentEndpoint[];
  findingFilter: FindingFilter;
  findingScope?: FindingScope;
  referenceSearch: string;
  referenceKind: 'all' | ApiKind;
} = {
  files: [],
  recentEndpoints: loadRecentEndpoints(),
  findingFilter: 'all',
  referenceSearch: '',
  referenceKind: 'all',
};

const systemColorScheme = window.matchMedia('(prefers-color-scheme: dark)');

function applyThemeMode(mode: ThemeMode): void {
  const dark = resolvesToDarkTheme(mode, systemColorScheme.matches);
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.classList.toggle('mds-theme-stable-darkWebex', dark);
  root.classList.toggle('mds-theme-stable-lightWebex', !dark);
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
  catalogStatus: byId<HTMLSpanElement>('catalog-status'),
  analysisScopeCount: byId<HTMLParagraphElement>('analysis-scope-count'),
  scopeVersionCount: byId<HTMLSpanElement>('scope-version-count'),
  fileInput: byId<HTMLInputElement>('file-input'),
  dropZone: byId<HTMLLabelElement>('drop-zone'),
  manualSourceActions: byId<HTMLDivElement>('manual-source-actions'),
  endpointSource: byId<HTMLDivElement>('endpoint-source'),
  endpointSourceName: byId<HTMLElement>('endpoint-source-name'),
  endpointSourceHost: byId<HTMLElement>('endpoint-source-host'),
  endpointSourceCount: byId<HTMLSpanElement>('endpoint-source-count'),
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
  copyButton: byId<HTMLButtonElement>('copy-button'),
  exportButton: byId<HTMLButtonElement>('export-button'),
  relationshipsTabCount: byId<HTMLSpanElement>('relationships-tab-count'),
  issuesTabCount: byId<HTMLSpanElement>('issues-tab-count'),
  androidContainerTabCount: byId<HTMLSpanElement>('android-container-tab-count'),
  xapiTabCount: byId<HTMLSpanElement>('xapi-tab-count'),
  summaryGrid: byId<HTMLDivElement>('summary-grid'),
  macroRelationships: byId<HTMLDivElement>('macro-relationships'),
  dependencyMapDialog: byId<HTMLDialogElement>('dependency-map-dialog'),
  dependencyMapTitle: byId<HTMLHeadingElement>('dependency-map-title'),
  dependencyMapContext: byId<HTMLParagraphElement>('dependency-map-context'),
  dependencyMapSummary: byId<HTMLDivElement>('dependency-map-summary'),
  dependencyMapCanvas: byId<HTMLDivElement>('dependency-map-canvas'),
  androidContainerReadinessDetail: byId<HTMLDivElement>('android-container-readiness-detail'),
  androidContainerIssueSummary: byId<HTMLDivElement>('android-container-issue-summary'),
  androidContainerIssueList: byId<HTMLDivElement>('android-container-issue-list'),
  branchSummary: byId<HTMLDivElement>('branch-summary'),
  schemaSummary: byId<HTMLDivElement>('schema-summary'),
  coverageContent: byId<HTMLDivElement>('coverage-content'),
  findingFilters: byId<HTMLDivElement>('finding-filters'),
  findingList: byId<HTMLDivElement>('finding-list'),
  xapiSearch: byId<HTMLInputElement>('xapi-search'),
  xapiKindFilter: byId<HTMLSelectElement>('xapi-kind-filter'),
  referenceList: byId<HTMLDivElement>('reference-list'),
  rawJson: byId<HTMLElement>('raw-json'),
};

elements.appVersion.textContent = `v${manifest.Version}`;
elements.currentYear.textContent = String(new Date().getFullYear());

elements.themeSelect.value = themeMode;

function applySeasonalPresentation(): void {
  const previewOverride = new URLSearchParams(window.location.search).get('winter') === 'true';
  const winterActive = isWinterActive(new Date(), previewOverride);
  elements.body.classList.toggle('winter-theme', winterActive);
  elements.winterSnowfall.hidden = !winterActive;

  if (winterActive) {
    const snowflakes = Array.from({ length: 18 }, () => {
      const snowflake = document.createElement('span');
      snowflake.textContent = '❄';
      return snowflake;
    });
    elements.winterSnowfall.replaceChildren(...snowflakes);
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
  elements.readinessMessage.setAttribute('role', state.analysisError ? 'alert' : 'status');
  elements.readinessMessage.classList.toggle('error', Boolean(state.analysisError));
  if (state.analysisError) {
    elements.readinessMessage.textContent = `Analysis failed: ${state.analysisError} Select “Analyze macro” to retry.`;
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
    input.addEventListener('change', () => {
      const selection = state.files[Number(input.dataset.inclusionIndex)];
      if (selection) selection.included = input.checked;
      resetAnalysis();
      renderFiles();
      updateMacroListSummary();
      updateReadiness();
    });
  });
  elements.fileInput.disabled = connected;
  elements.dropZone.hidden = connected;
  elements.manualSourceActions.hidden = connected;
  elements.endpointSource.hidden = !connected;
  elements.uploadTitle.textContent = connected ? 'Endpoint macro set' : 'Upload macro files';
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
    elements.endpointSourceHost.textContent = endpoint.host;
    elements.endpointSourceCount.textContent = `${endpoint.macroCount} ${endpoint.macroCount === 1 ? 'macro' : 'macros'}`;
  }
  updateReadiness();
}

function resetAnalysis(): void {
  state.analysis = undefined;
  state.analysisError = undefined;
  elements.results.hidden = true;
}

function setAllMacrosIncluded(included: boolean): void {
  state.files.forEach((selection) => {
    selection.included = included;
  });
  resetAnalysis();
  renderFiles();
}

async function addBrowserFiles(fileList: FileList | File[]): Promise<void> {
  if (state.endpoint) return;
  const used = new Set(state.files.map((selection) => selection.file.id));
  const additions = await Promise.all([...fileList]
    .filter((file) => file.name.endsWith('.js') || file.name.endsWith('.mjs') || file.type === 'text/javascript')
    .map(async (file) => {
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

function loadExample(): void {
  if (state.endpoint) return;
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

function summaryCard(label: string, value: number | string, detail: string, attention = false): string {
  return `<div class="summary-card ${attention ? 'attention' : ''}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`;
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

function openDependencyMap(report: AnalysisReport, entryFileId: string): void {
  const entry = report.fileInventory.find((file) => file.fileId === entryFileId);
  if (!entry) return;
  const model = buildDependencyMap(report, entryFileId);
  elements.dependencyMapTitle.textContent = `Dependency map · ${entry.path}`;
  elements.dependencyMapContext.textContent =
    'Arrows point from each macro to its dependencies. A domain is “in use” when its URL reaches a proven xAPI argument or appears in an XML payload; “not in use” means the URL is present but neither connection is proven. These are source relationships, not runtime execution.';
  elements.dependencyMapSummary.innerHTML = `
    <span><strong>${model.counts.macros}</strong> ${model.counts.macros === 1 ? 'macro' : 'macros'}</span>
    <span><strong>${model.counts.missing}</strong> missing</span>
    <span><strong>${model.counts.externalDomains}</strong> URL ${model.counts.externalDomains === 1 ? 'domain' : 'domains'}</span>
    <span><strong>${model.counts.externalDomainsInUse}</strong> in use</span>
    <span><strong>${model.counts.externalDomainsNotInUse}</strong> not in use</span>
  `;
  elements.dependencyMapCanvas.innerHTML = renderDependencyMapSvg(model);
  elements.dependencyMapDialog.showModal();
}

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
    <p class="macro-relationships-intro">Each Entry Macro starts an analyzed import graph. Open its Dependency map to see supplied macros, missing local imports, and URL domains classified as in use or not in use.</p>
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

function renderOverview(
  report: AnalysisReport,
  groups: ReferenceGroup[],
  coverage: SchemaCoverage,
  subscriptions: AnalysisSessionPresentation['subscriptions'],
): void {
  const reviewCount = report.findings.filter((finding) => finding.priority !== 'informational').length;
  const earliestCompatible = coverage.earliestCompatibleVersion;
  const latestCompatible = coverage.latestCompatibleVersion;
  const reachesLatestSoftware = latestCompatible?.id === coverage.latestCatalogVersion?.id;
  const readiness = calculateAndroidContainerReadiness(report.inventory.references);
  const readinessDetail = readiness.total === 0
    ? 'No static xAPI paths to evaluate'
    : readiness.determined === 0
      ? 'No paths could be classified by the schema conventions'
      : `${readiness.available} of ${readiness.determined} classified ${readiness.determined === 1 ? 'path' : 'paths'} available`;
  elements.summaryGrid.innerHTML = [
    summaryCard('xAPI references', report.inventory.references.length, 'Total uses found in source'),
    summaryCard('Unique xAPI paths', groups.length, 'Distinct static paths across all files'),
    summaryCard(
      'Subscription registrations',
      subscriptions.totalRegistrations,
      `${subscriptions.uniqueSubscribedPaths} unique subscribed ${subscriptions.uniqueSubscribedPaths === 1 ? 'path' : 'paths'}${subscriptions.duplicateRegistrations > 0 ? ` · ${subscriptions.duplicateRegistrations} duplicate ${subscriptions.duplicateRegistrations === 1 ? 'registration' : 'registrations'}` : ''}`,
      subscriptions.duplicateRegistrations > 0,
    ),
    summaryCard(
      'Schema Availability Range',
      earliestCompatible && latestCompatible
        ? earliestCompatible.id === latestCompatible.id
          ? earliestCompatible.release
          : `${earliestCompatible.release} → ${latestCompatible.release}`
        : groups.length === 0 ? 'Not applicable' : 'None',
      earliestCompatible && latestCompatible
        ? reachesLatestSoftware
          ? 'Latest software · derived from xAPI presence'
          : `Newest fully represented snapshot; latest software is ${coverage.latestCatalogVersion?.release ?? 'not cataloged'}`
        : groups.length === 0
          ? 'No static xAPI paths to establish a floor'
          : `No passing schema among ${coverage.totalVersions} checked`,
      groups.length > 0 && !earliestCompatible,
    ),
    summaryCard('Findings to review', reviewCount, `${report.findings.length} canonical Findings`, reviewCount > 0),
    summaryCard(
      'Android Container schema availability',
      readiness.percentage === null ? '—' : `${readiness.percentage}%`,
      readinessDetail,
      readiness.issues.length > 0,
    ),
  ].join('');
  const kindOrder: ApiKind[] = ['Command', 'Configuration', 'Status', 'Event'];
  const kindLabels: Record<ApiKind, string> = {
    Command: 'Commands',
    Configuration: 'Configurations',
    Status: 'Statuses',
    Event: 'Events',
  };
  const maximum = Math.max(1, ...kindOrder.map((kind) =>
    report.inventory.references.filter((reference) => reference.kind === kind).length,
  ));
  elements.branchSummary.innerHTML = kindOrder.map((kind) => {
    const total = report.inventory.references.filter((reference) => reference.kind === kind).length;
    const unique = groups.filter((group) => group.kind === kind).length;
    const branchSubscriptions = subscriptions.byBranch[kind];
    const subscriptionDetail = branchSubscriptions.totalRegistrations > 0
      ? ` · ${branchSubscriptions.totalRegistrations} ${branchSubscriptions.totalRegistrations === 1 ? 'subscription' : 'subscriptions'} · ${branchSubscriptions.uniqueSubscribedPaths} subscribed ${branchSubscriptions.uniqueSubscribedPaths === 1 ? 'path' : 'paths'}`
      : '';
    return `<div class="branch-row"><span>${kindLabels[kind]}</span><div class="branch-track"><i style="width:${Math.round((total / maximum) * 100)}%"></i></div><strong>${total} total · ${unique} unique${subscriptionDetail}</strong></div>`;
  }).join('');

  elements.schemaSummary.innerHTML = `
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

  const sourceCoverage = report.coverage;
  const newestRelease = report.provenance.schemaSnapshot.release;
  elements.coverageContent.innerHTML = `
    <div class="coverage-grid">
      <div class="coverage-item"><span>Files parsed</span><strong>${sourceCoverage.files.parsed} of ${sourceCoverage.files.reachable}</strong></div>
      <div class="coverage-item"><span>Static paths</span><strong>${sourceCoverage.xapiReferences.staticallyResolved} of ${sourceCoverage.xapiReferences.candidates}</strong></div>
      <div class="coverage-item"><span>Schema snapshots</span><strong>${coverage.totalVersions} checked</strong></div>
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
  return state.files.find((selection) => selection.file.id === fileId)?.file.path ?? fileId;
}

function renderSourceSnippet(sourceReference: SourceReference): string {
  const file = state.files.find((selection) => selection.file.id === sourceReference.fileId)?.file;
  if (!file) return '';

  const snippet = buildSourceSnippet(file.source, sourceReference.range);
  const reportedStart = sourceReference.range.start.line;
  const reportedEnd = sourceReference.range.end.line;
  const reportedLabel = reportedEnd > reportedStart
    ? `lines ${reportedStart}–${reportedEnd}`
    : `line ${reportedStart}`;
  const code = snippet.lines.map((line) => `
    <span class="source-code-line ${line.highlighted ? 'highlighted' : ''}">
      <span class="source-code-number" aria-hidden="true">${line.number}</span>
      <span class="source-code-text">${escapeHtml(line.text)}</span>
    </span>`).join('');

  return `<details class="source-snippet">
    <summary>View code near ${reportedLabel}</summary>
    <pre aria-label="${escapeHtml(`${file.path}, lines ${snippet.startLine} through ${snippet.endLine}`)}"><code>${code}</code></pre>
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
        ${snippetSources.map((reference) => renderSourceSnippet(reference)).join('')}
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
          <details>
            <summary>Source occurrences</summary>
            <ul class="occurrence-list">${referenceGroup.references.map(renderSourceOccurrence).join('')}</ul>
          </details>
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
  state.analysis = session;
  const analysis = deriveAnalysisSessionPresentation(session);
  state.findingFilter = 'all';
  state.findingScope = undefined;
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
  renderOverview(
    analysis.displayReport,
    groups,
    analysis.coverage,
    analysis.subscriptions,
  );
  renderMacroRelationships(analysis.displayReport);
  renderFindings(analysis.displayReport);
  renderAndroidContainerIssues(analysis.primaryReport);
  renderReferenceList(analysis);
  elements.rawJson.textContent = JSON.stringify(session, null, 2);
  renderFiles();
  activateResultTab('overview');
  elements.results.hidden = false;
  elements.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

function exportReport(): void {
  if (!state.analysis) return;
  const blob = new Blob([`${JSON.stringify(state.analysis, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${state.analysis.sessionId}.json`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyReport(): Promise<void> {
  if (!state.analysis) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.analysis, null, 2));
    elements.copyButton.textContent = 'Copied';
    window.setTimeout(() => {
      elements.copyButton.textContent = 'Copy JSON';
    }, 1200);
  } catch {
    elements.copyButton.textContent = 'Copy failed';
  }
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
elements.macroSelectAll.addEventListener('click', () => setAllMacrosIncluded(true));
elements.macroClearAll.addEventListener('click', () => setAllMacrosIncluded(false));
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
elements.demoButton.addEventListener('click', loadExample);
elements.clearButton.addEventListener('click', () => {
  if (state.endpoint) return;
  state.files = [];
  resetAnalysis();
  renderFiles();
});
elements.analyzeButton.addEventListener('click', () => void runAnalysis());
elements.copyButton.addEventListener('click', () => void copyReport());
elements.exportButton.addEventListener('click', exportReport);
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
window.addEventListener('beforeunload', () => state.endpoint?.xapi.close());

initializeProductTelemetry();
renderFiles();
renderRecentEndpoints();
void loadCatalog();
