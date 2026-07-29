import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const exportClient = readFileSync(
  new URL('./export/analysisExportClient.ts', import.meta.url),
  'utf8',
);
const exportWorker = readFileSync(
  new URL('./export/analysisExport.worker.ts', import.meta.url),
  'utf8',
);
const importClient = readFileSync(
  new URL('./analysis/analysisSessionImportClient.ts', import.meta.url),
  'utf8',
);
const importWorker = readFileSync(
  new URL('./analysis/analysisSessionImport.worker.ts', import.meta.url),
  'utf8',
);
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const publicFavicon = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const localFavicon = readFileSync(new URL('../public/favicon-local.svg', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const manifest = JSON.parse(
  readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'),
) as { Version: string };
const packageMetadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };
const packageLockMetadata = JSON.parse(
  readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
) as { version: string; packages: { '': { version: string } } };

describe('Cisco Macro Analyzer product shell', () => {
  it('keeps the original task and identity obvious', () => {
    expect(html).toContain('<title>Cisco Macro Analyzer</title>');
    expect(html).toContain('Add macro files');
    expect(html).toContain('Exploratory Analysis across validated RoomOS versions');
    expect(html).toContain('Analyze macro');
    expect(html.indexOf('Upload macro files')).toBeLessThan(
      html.indexOf('Exploratory Analysis across validated RoomOS versions'),
    );
  });

  it('reserves the site icon dimensions before CSS loads', () => {
    expect(html).toContain(
      '<img class="brand-mark" src="/favicon.svg" width="29" height="29" alt="" aria-hidden="true" />',
    );
    expect(html).toContain(
      '<img class="brand-mark small" src="/favicon.svg" width="23" height="23" alt="" aria-hidden="true" />',
    );
  });

  it('uses the beta-banner yellow favicon only when served locally', () => {
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
    expect(publicFavicon).toContain('fill="#649ef5"');
    expect(localFavicon).toContain('fill="#f0c243"');
    expect(css).toMatch(
      /\.beta-banner \{[^}]*background: var\(--warning-bg-default\);/s,
    );
    expect(viteConfig).toContain("command === 'serve'");
    expect(viteConfig).toContain('html.replace(publicFavicon, localFavicon)');
  });

  it('makes the dependency example available only in local development', () => {
    expect(html).toMatch(/id="demo-button"[^>]*hidden/);
    expect(main).toContain('if (import.meta.env.DEV) {');
    expect(main).toContain('elements.demoButton.hidden = false;');
    expect(main).toContain(
      "elements.demoButton.addEventListener('click', () => void loadExample());",
    );
    expect(main).toContain(
      "await import('./examples/dependencyMapExample')",
    );
    expect(main).not.toContain(
      "from './examples/dependencyMapExample'",
    );
  });

  it('shows the beta release and current copyright in the product shell', () => {
    expect(manifest.Version).toBe('0.6.9-BETA');
    expect(packageMetadata.version).toBe('0.6.9-beta');
    expect(packageMetadata.version).toBe(manifest.Version.toLowerCase());
    expect(packageLockMetadata.version).toBe(packageMetadata.version);
    expect(packageLockMetadata.packages[''].version).toBe(packageMetadata.version);
    expect(html).toContain('class="beta-banner"');
    expect(html).toContain(`<strong id="app-version">v${manifest.Version}</strong>`);
    expect(main).toContain("import manifest from '../manifest.json'");
    expect(main).toContain('elements.appVersion.textContent = `v${manifest.Version}`');
    expect(css).toContain('.beta-banner');
    expect(html).toContain('id="current-year"');
    expect(html).toContain('Cisco Systems, Inc.');
    expect(html).toContain('Created by the Collaboration TME team');
    expect(main).toContain('elements.currentYear.textContent = String(new Date().getFullYear())');
  });

  it('keeps the footer visible without covering the end of the page', () => {
    expect(css).toMatch(/body \{[^}]*padding-bottom: var\(--footer-height\)/s);
    expect(css).toMatch(/footer \{[^}]*position: fixed;[^}]*bottom: 0;/s);
    expect(css).toMatch(/footer \{[^}]*height: var\(--footer-height\)/s);
    expect(css).toContain('--footer-height: 92px');
  });

  it('offers an accessible, safely isolated feedback link', () => {
    expect(html).toContain('>Bugs / Suggestions</a>');
    expect(html).toContain(
      'href="https://github.com/ctg-tme/Cisco-Macro-Analytics/issues/new"',
    );
    expect(html).toMatch(
      /href="https:\/\/github\.com\/ctg-tme\/Cisco-Macro-Analytics\/issues\/new"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/,
    );
  });

  it('offers persistent system, light, and dark color themes', () => {
    expect(html).toContain('id="theme-select"');
    expect(html).toContain('<option value="system">System</option>');
    expect(html).toContain('<option value="light">Light</option>');
    expect(html).toContain('<option value="dark">Dark</option>');
    expect(html).not.toContain('id="theme-button"');
    expect(html).toContain('data-cds-theme="magnetic-dark"');
    expect(main).toContain("window.matchMedia('(prefers-color-scheme: dark)')");
    expect(main).toContain(
      "root.dataset.cdsTheme = dark ? 'magnetic-dark' : 'magnetic-light'",
    );
    expect(main).toContain("systemColorScheme.addEventListener('change'");
    expect(css).toContain(':root[data-cds-theme="magnetic-light"]');
    expect(css).not.toContain('@momentum-design');
    expect(css).not.toContain('mds-theme-stable');
  });

  it('keeps the winter treatment seasonal and previewable', () => {
    expect(html).toContain('id="winter-snowfall"');
    expect(main).toContain("get('winter') === 'true'");
    expect(css).toContain('.winter-theme :is(');
    expect(css).toContain('url("/winter-light-row.svg")');
    expect(css).toContain('url("/winter-light-column.svg")');
    expect(css).toContain('.results-section .macro-finding-section');
    expect(css).toContain('.results-section .macro-reference-section');
    expect(css).toMatch(
      /\.winter-theme :is\([^)]*\.issue-source-review,[^)]*\.dependency-map-canvas[^)]*\) \{\s+box-shadow: inset/s,
    );
    expect(css).toContain('.winter-theme dialog:not(.dependency-map-dialog)');
    expect(css).toContain('.winter-theme .dependency-map-dialog');
    expect(css).toContain('.winter-theme .brand-mark');
    expect(css).not.toContain('winter-lights-live');
  });

  it('keeps winter lights outside outer result containers', () => {
    const lightFrameRule = css.match(
      /\.winter-theme :is\(([^)]*)\)::before \{([^}]*)\}/,
    );

    expect(lightFrameRule).not.toBeNull();
    expect(lightFrameRule?.[1]).toContain('.results-section .macro-overview-section');
    expect(lightFrameRule?.[1]).toContain('.results-section .macro-finding-section');
    expect(lightFrameRule?.[1]).toContain('.results-section .macro-reference-section');
    expect(lightFrameRule?.[1]).not.toContain('.results-section .summary-card');
    expect(lightFrameRule?.[1]).not.toContain('.results-section .finding');
    expect(lightFrameRule?.[1]).not.toContain('.results-section .issue-source-review');
    expect(lightFrameRule?.[1]).not.toContain('.results-section .reference-card');
    expect(lightFrameRule?.[2]).toContain(
      'inset: var(--winter-light-inset, -8px)',
    );
  });

  it('keeps complete winter frames and snowfall above every modal', () => {
    expect(css).toMatch(
      /\.winter-theme dialog:not\(\.dependency-map-dialog\)::before \{[^}]*url\("\/winter-light-row\.svg"\) 0 100%/s,
    );
    expect(css).toMatch(
      /\.winter-theme \.dependency-map-dialog::before \{[^}]*inset: 0/s,
    );
    expect(css).toMatch(
      /\.winter-modal-snowfall \{[^}]*z-index: 20;[^}]*pointer-events: none;/s,
    );
    expect(main).toContain(
      "document.querySelectorAll<HTMLDialogElement>('dialog')",
    );
    expect(main).toContain(
      "modalSnowfall.className = 'winter-modal-snowfall'",
    );
  });

  it('does not ask the author to choose a schema or device profile', () => {
    expect(html).not.toContain('id="schema-select"');
    expect(html).not.toContain('id="product-select"');
    expect(html).not.toContain('id="operating-mode"');
    expect(html).not.toContain('id="runtime-role"');
    expect(html).not.toContain('Refine schema comparison');
  });

  it('uses familiar result labels instead of internal analysis terminology', () => {
    expect(html).toContain('>Overview<');
    expect(html).toContain('>Entries &amp; Dependencies<');
    expect(html).toContain('>General Issues<');
    expect(html).toContain('>Android Issues<');
    expect(html).toContain('>xAPI References<');
    expect(html).not.toContain('>Raw JSON<');
    expect(html).not.toContain('Inspect the code.');
    expect(html).not.toContain('Keep the uncertainty.');
    expect(html).not.toContain('Claim mode');
    expect(html).not.toContain('Macro Diagnostics home');
  });

  it('presents result tabs as Magnetic secondary tabs', () => {
    expect(css).toContain('.result-tabs button { min-height: 39px');
    expect(css).toContain('.result-tabs button:not([aria-selected="true"]):hover');
    expect(css).toContain('.result-tabs button:active');
    expect(css).toContain('border-bottom: 3px solid transparent');
    expect(css).toContain('border-bottom-color: var(--interact-border-medium-active)');
  });

  it('uses Android Container as the user-facing operating-mode term', () => {
    expect(html).toContain('Android Container schema availability');
    expect(html).toContain('Android Container refers to device deployments running Microsoft Teams Rooms or Zoom Rooms software on top of RoomOS');
    expect(html).not.toMatch(/>\s*MTR\s*</);
    expect(html).toContain('This is Microsoft Teams schema evidence, not a runtime test.');
    expect(html).toContain('A schema with no Android Container metadata is treated as not supporting the container.');
    expect(html).toContain('Conflicting evidence or a missing kind-specific convention in a metadata-bearing schema is reported as unknown.');
    expect(html).toContain('do not provide equivalent general availability metadata for Zoom Rooms');
  });

  it('keeps Android Container schema availability compact in the overview and its detail in the issues tab', () => {
    expect(main).toContain("summaryCard(\n      'Android Container'");
    expect(main).toContain('`${readiness.available} of ${readiness.total} Available`');
    expect(html).not.toContain('class="result-card android-readiness-card"');
    expect(html.indexOf('id="tab-android-container"')).toBeLessThan(
      html.indexOf('id="android-container-readiness-detail"'),
    );
    expect(main).toContain('elements.androidContainerReadinessDetail.innerHTML');
  });

  it('summarizes every macro independently in an initially collapsed Overview tile', () => {
    expect(html).toContain('id="macro-overview-list"');
    expect(html).not.toContain('id="summary-grid"');
    expect(main).toContain('report.fileInventory.map((file, index)');
    expect(main).not.toContain("index === 0 ? ' open' : ''");
    expect(main).toContain('reference.source.fileId === file.fileId');
    expect(main).toContain('finding.sourceFileIds.includes(file.fileId)');
    expect(main).toContain('schemaCoverageForMacro(session, file.fileId)');
    expect(main).toContain('summarizeSubscriptions(references)');
    expect(main).toContain('data-overview-macro=');
    expect(main).toContain('class="macro-overview-toggle"');
    expect(css).toContain('.macro-overview-toggle { width: 27px; height: 27px;');
    expect(css).toContain('.macro-overview-toggle::before { content: "→"; }');
    expect(css).toContain('.macro-overview-section[open] .macro-overview-toggle::before { content: "↓"; }');
    expect(css).toContain('border: 1px solid var(--border)');
    expect(css).toContain('.macro-overview-section:not([open]) > .macro-overview-content { display: none; }');
    expect(css).toContain('.macro-overview-content');
    expect(main).not.toContain("summaryCard('Unique xAPI paths'");
    expect(main).toContain("'Subscriptions'");
    expect(main).toContain("'Schema Range'");
    expect(main).toContain("summaryCard('General Issues'");
    expect(main).not.toContain('Latest software · derived from xAPI presence');
    expect(css).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))');
    expect(css).toContain('.summary-card { min-height: 76px');
    expect(css).toContain('.macro-overview-section > summary { display: block; padding: 11px 13px');
  });

  it('separates Cloud and On-premises version pills into two columns', () => {
    expect(main).toContain("label: 'Cloud'");
    expect(main).toContain("label: 'On-premises'");
    expect(main).toContain('Schema name includes a release month');
    expect(css).toContain('.version-channel-grid');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
  });

  it('describes schema availability without claiming software compatibility', () => {
    expect(main).toContain('All xAPI references available');
    expect(main).toContain('Schema Availability Range');
    expect(main).toContain('Oldest fully represented');
    expect(main).toContain('Newest fully represented');
    expect(main).toContain('Latest software');
    expect(main).toContain('latest?.id === coverage.latestCatalogVersion?.id');
    expect(main).toContain('newest ${channel.label} snapshot in the catalog');
    expect(main).not.toContain('Software Compatibility Range');
    expect(main).not.toContain('Oldest compatible');
    expect(main).not.toContain('Newest compatible');
    expect(main).toContain('Not available on these versions');
    expect(main).toContain('version.missingReferences');
    expect(main).toContain('The missing paths are listed with it.');
    expect(main).toContain('Schema absence means unavailable');
    expect(main).not.toContain('Could not determine on these versions');
  });

  it('shows one local source preview at a time in both issue views', () => {
    expect(main).toContain('renderFindingSourceEvidence(finding, snippetSources, sourceReviews)');
    expect(main).toContain('`finding:${finding.id}`');
    expect(main).toContain('`android:${issueGroup.key}:${issue.key}`');
    expect(main).toContain('sourceReferences,');
    expect(main).toContain('sourceReviews,');
    expect(main).toContain('data-source-review-frame');
    expect(main).toContain('<details class="source-snippet">');
    expect(main).not.toContain('<details class="source-snippet" open>');
    expect(main).not.toContain('maskSensitiveSourceLine');
    expect(css).toContain('.source-code-line.highlighted');
  });

  it('uses one compact, dismissible source queue for every issue type', () => {
    const sourceReview = main.slice(
      main.indexOf('function renderIssueSourceReview('),
      main.indexOf('function renderFindingSourceEvidence('),
    );

    expect(main).toContain('function renderIssueSourceReview(');
    expect(main).toContain('function bindIssueSourceReviewControls(');
    expect(main).toContain('renderIssueSourceReview(\n    `finding:${finding.id}`');
    expect(main).toContain('${renderIssueSourceReview(\n            `android:${issueGroup.key}:${issue.key}`');
    expect(main).toContain("finding.code === 'source.sensitive-credential-indicator'");
    expect(main).toContain('combine ${finding.observationIds.length} matched phrases');
    expect(main).toContain('data-source-review-dismiss');
    expect(main).toContain('data-source-review-restore');
    expect(main).toContain('data-source-review-direction="previous"');
    expect(main).toContain('data-source-review-direction="next"');
    expect(sourceReview).toContain('>Dismiss issue</button>');
    expect(sourceReview).not.toContain('Dismiss location');
    expect(sourceReview.indexOf('>Next location</button>')).toBeLessThan(
      sourceReview.indexOf('>Dismiss issue</button>'),
    );
    expect(main).toContain('sourceReviews.set(reviewId, sourceReferences)');
    expect(main).toContain('state.dismissedIssueLocations');
    expect(main).toContain('Dismissal affects only this local review');
    expect(main).toContain('The analysis result and exported report are unchanged');
    expect(css).toContain('.issue-source-review');
    expect(css).toContain('.source-review-controls');
    expect(css).toContain('.source-review-actions');
    expect(css).toContain('.source-review-empty');
  });

  it('renders actionable Finding evidence without duplicating Source locations', () => {
    expect(main).toContain('function renderFindingRoutes(');
    expect(main).toContain('function renderFindingDependencyPaths(');
    expect(main).toContain('function renderCredentialTerms(');
    expect(main).toContain('function renderCanonicalFindingReference(');
    expect(main).toContain('data-finding-id="${escapeHtml(finding.id)}"');
    expect(main).toContain('xAPI binding routes');
    expect(main).toContain('Dependency paths');
    expect(main).toContain('Detected vocabulary matches');
    expect(main).toContain('Canonical xAPI reference');
    expect(main).not.toContain('function renderFindingLocations(');
    expect(main).not.toContain('Source locations');
    expect(css).toContain('.binding-route-list');
    expect(css).toContain('.credential-term-list');
  });

  it('puts analyzed Entry and dependency relationships in their own result tab', () => {
    const renderFiles = main.slice(
      main.indexOf('function renderFiles(): void'),
      main.indexOf('function resetAnalysis(): void'),
    );

    expect(html).toContain('id="macro-relationships"');
    expect(html).toContain('data-result-tab="relationships"');
    expect(html).toContain('id="tab-relationships"');
    expect(html.indexOf('id="tab-relationships"')).toBeGreaterThan(html.indexOf('id="tab-overview"'));
    expect(html.slice(
      html.indexOf('id="tab-overview"'),
      html.indexOf('id="tab-relationships"'),
    )).not.toContain('id="macro-relationships"');
    expect(main).toContain('function renderMacroRelationships(');
    expect(main).toContain("file.roles.includes('Entry')");
    expect(main).toContain('report.directDependencyGraph');
    expect(main).toContain('report.unresolvedDependencyEdges');
    expect(main).not.toContain('data-finding-scope="direct"');
    expect(main).toContain('data-finding-scope="dependency"');
    expect(renderFiles).toContain('active-badge ${selection.active ?');
    expect(renderFiles).not.toContain('role-badge entry');
    expect(renderFiles).not.toContain('role-badge dependency');
    expect(renderFiles).not.toContain('renderDependencyTree');
    expect(renderFiles).not.toContain('data-finding-scope');
    expect(css).toContain('.macro-relationships');
    expect(css).toContain('border: 1px dotted var(--dependency)');
  });

  it('opens a visual Dependency map from each Entry Macro', () => {
    expect(html).toContain('id="dependency-map-dialog"');
    expect(html).toContain('id="dependency-map-canvas"');
    expect(html).toContain('Destination · In Use');
    expect(html).toContain('Destination · Use Unknown');
    expect(html).toContain('Destination · Not In Use');
    expect(html).toContain('id="dependency-map-show-comments"');
    expect(html).toContain('id="dependency-url-inspector"');
    expect(html).toContain('id="dependency-map-zoom-out"');
    expect(html).toContain('id="dependency-map-fit"');
    expect(html).toContain('id="dependency-map-zoom-in"');
    expect(html).toContain('id="dependency-map-zoom-value"');
    expect(html).toContain('id="dependency-map-download"');
    expect(html).toContain('id="dependency-map-key"');
    expect(html).toContain('aria-keyshortcuts="- _"');
    expect(html).toContain('aria-keyshortcuts="+ ="');
    expect(main).toContain('data-dependency-map-entry=');
    expect(main).toMatch(
      /buildDependencyMap\(\s*dependencyMapView\.report,\s*dependencyMapView\.entryFileId,/,
    );
    expect(main).toContain('buildDependencyMap(report, fileId).counts.dependencies');
    expect(main).toContain("dependencyCount === 0 ? ' disabled' : ''");
    expect(main).toContain('dependency-map-button-count');
    expect(main).toContain('renderDependencyMapSvg(model)');
    expect(main).toContain('elements.dependencyMapDialog.showModal()');
    expect(main).toContain('function fitDependencyMap(');
    expect(main).toContain('function setDependencyMapFocus(');
    expect(main).toContain('dependencyMapView.model = model;');
    expect(main).toContain("elements.dependencyMapCanvas.addEventListener('pointerdown'");
    expect(main).toContain("elements.dependencyMapCanvas.addEventListener('pointermove'");
    expect(main).toContain('setPointerCapture(event.pointerId)');
    expect(main).toContain("window.addEventListener('keydown'");
    expect(main).toContain("elements.dependencyMapCanvas.addEventListener('wheel'");
    expect(main).toContain('event.metaKey || event.ctrlKey');
    expect(main).toContain('{ passive: false }');
    expect(main).toContain('function downloadDependencyMapPng(');
    expect(main).toContain('new XMLSerializer()');
    expect(css).toContain('.dependency-map-button { width: 132px');
    expect(css).toContain('.dependency-map-button:disabled');
    expect(css).toContain('.dependency-map-button-count');
    expect(css).toContain('.dependency-map-svg');
    expect(css).toContain('width: 100vw');
    expect(css).toContain('height: 100dvh');
    expect(css).toContain('grid-template-rows: auto auto minmax(0, 1fr)');
    expect(css).toContain('.dependency-map-key { position: absolute');
    expect(css).toContain('.dependency-map-node.external');
    expect(css).toContain('.dependency-map-node.external.not-in-use');
    expect(css).toContain('.dependency-map-edge.external-url');
    expect(css).toContain('.dependency-map-edge.skip-level');
    expect(css).toContain('.dependency-map-edge.is-dimmed');
    expect(css).toContain('.dependency-map-node.is-dimmed');
    expect(css).toContain('.dependency-map-zoom-controls');
    expect(css).toContain('cursor: grab');
    expect(css).toContain('.dependency-map-canvas.is-panning');
    expect(css).toContain('grid-template-columns: 28px minmax(120px, 1fr) 182px 276px');
    expect(css).toContain('.macro-relationship-badges { width: 182px; }');
    expect(css).toContain('.macro-impact-links { width: 276px;');
  });

  it('groups Findings by source macro instead of Review Priority', () => {
    expect(main).toContain('groupFindingsByMacro(');
    expect(main).toContain('macro-finding-section');
    expect(main).not.toContain('Findings by Review Priority');
    expect(html).toContain('General Issues grouped by macro');
    expect(css).toContain('.macro-finding-section');
  });

  it('groups Android Issues by source macro with collapsible issue details', () => {
    expect(main).toContain('groupAndroidContainerIssuesByMacro(');
    expect(html).toContain('Android Issues grouped by macro');
    expect(main).toContain('android-issue-section');
    expect(main).toContain('<details class="container-issue-card');
  });

  it('groups xAPI references by source macro with a list of paths in each group', () => {
    expect(main).toContain('groupReferencesByMacro(');
    expect(html).toContain('xAPI References grouped by macro');
    expect(main).toContain('macro-reference-section');
    expect(main).toContain('macroGroup.referenceGroups.map(renderReferenceCard)');
    expect(css).toContain('.macro-reference-section');
    expect(css).toContain('.macro-reference-content');
  });

  it('shows subscription-specific analytics without replacing general xAPI counts', () => {
    expect(main).toContain("'Subscriptions'");
    expect(main).toContain('subscriptions.totalRegistrations');
    expect(main).toContain('subscriptions.uniqueSubscribedPaths');
    expect(main).toContain('subscriptions.byBranch[kind]');
    expect(main).toContain("'xAPI references'");
    expect(main).not.toContain("summaryCard('Unique xAPI paths'");
  });

  it('offers current and planned exports from one chooser', () => {
    expect(html).toContain('id="export-button" type="button">Export<');
    expect(html).toContain('id="export-dialog"');
    expect(html).toContain('id="export-name"');
    expect(html).toContain('>Report name<');
    expect(html).toContain('id="export-analysis-button"');
    expect(html).toContain('>Export Analysis JSON<');
    expect(html).toMatch(
      /id="export-report-button"[^>]*disabled[^>]*>[\s\S]*Export Report[\s\S]*Coming soon/,
    );
    expect(html).not.toContain('Copy JSON');
    expect(html).not.toContain('id="raw-json"');
    expect(main).toContain('defaultAnalysisExportName({');
    expect(main).toContain('elements.exportName.value = defaultName');
    expect(main).toContain('elements.exportDialog.showModal()');
    expect(main).toContain(
      "elements.exportAnalysisButton.addEventListener('click', () => void exportAnalysisJson())",
    );
    expect(main).toContain('buildAnalysisSession({');
    expect(main).toContain('deriveAnalysisSessionPresentation(session)');
    expect(main).not.toContain('JSON.stringify(session, null, 2)');
    expect(main).not.toContain('JSON.stringify(state.analysis, null, 2)');
    expect(main).toContain('createAnalysisExportBlob(session)');
    expect(main).toContain('link.download = `${reportName}.zip`');
    expect(exportClient).toContain("new Worker(");
    expect(exportWorker).toContain('createAnalysisExportArchive(event.data.session)');
    expect(main).not.toContain('const exportData = primaryReport');
    expect(main).toContain('document.body.append(link)');
    expect(main).toContain('link.remove()');
    expect(main).toContain('window.setTimeout(() => URL.revokeObjectURL(url), 0)');
  });

  it('imports a complete Analysis Session JSON without re-running macro analysis', () => {
    expect(html).toContain('id="analysis-import-input"');
    expect(html).toContain('accept=".json,application/json"');
    expect(html).toContain('>Import Analysis JSON<');
    expect(main).toContain('importAnalysisSessionJson(await file.text())');
    expect(main).toContain('renderAnalysis(session)');
    expect(main).toContain('Results re-rendered without analyzing macros again.');
    expect(main).toContain(
      'state.analysis?.schemas[0]?.report.fileInventory.find',
    );
    expect(importClient).toContain("new Worker(");
    expect(importWorker).toContain('parseAnalysisSessionJson(event.data.text)');
  });

  it('warns before any operation purges analyzed results', () => {
    const importFlow = main.slice(
      main.indexOf('async function importAnalysisFile('),
      main.indexOf('function yieldToBrowser('),
    );
    const exampleFlow = main.slice(
      main.indexOf('async function loadExample('),
      main.indexOf('function endpointMacroSelections('),
    );
    const endpointFlow = main.slice(
      main.indexOf('async function connectEndpoint('),
      main.indexOf('function disconnectEndpoint('),
    );

    expect(html).toContain('id="analysis-purge-dialog"');
    expect(html).toContain('id="analysis-purge-message"');
    expect(html).toContain('id="analysis-purge-confirm"');
    expect(html).toContain('>Keep current results<');
    expect(html).toContain('Export the current analysis first if you want to keep a copy.');
    expect(main).toContain('function confirmAnalysisPurge(');
    expect(main).toContain('if (!state.analysis) return Promise.resolve(true);');
    expect(main).toContain('Importing this Analysis JSON will permanently clear');
    expect(main).toContain('Loading the Dependency Example will permanently clear');
    expect(main).toContain('Connecting an Endpoint will permanently clear');
    expect(main).toContain('Changing the included Macro Set will permanently clear');
    expect(main).toContain('Adding files will permanently clear');
    expect(main).toContain('Clearing the Macro Set will permanently clear');
    expect(main).toContain('Running a new analysis will permanently replace');
    expect(importFlow.indexOf('confirmAnalysisPurge({')).toBeLessThan(
      importFlow.indexOf('state.files = [];'),
    );
    expect(exampleFlow.indexOf('confirmAnalysisPurge({')).toBeLessThan(
      exampleFlow.indexOf('state.files = dependencyMapExampleFiles'),
    );
    expect(endpointFlow.indexOf('confirmAnalysisPurge({')).toBeLessThan(
      endpointFlow.indexOf('connectToEndpoint(credentials)'),
    );
    expect(main).toContain("window.addEventListener('beforeunload', (event) => {");
    expect(main).toContain('if (import.meta.env.DEV || !state.analysis) return;');
    expect(main).toContain('event.preventDefault();');
    expect(main).toContain('event.returnValue = true;');
    expect(main).toContain("window.addEventListener('pagehide', () => state.endpoint?.xapi.close())");
    expect(main).not.toContain(
      "window.addEventListener('beforeunload', () => state.endpoint?.xapi.close())",
    );
    expect(css).toContain('#analysis-purge-dialog form { gap: 8px; }');
  });

  it('omits empty Parent branch and Not found coverage sections from xAPI cards', () => {
    expect(main).toMatch(
      /coverage\.parentVersions\.length > 0\s+\? referenceVersionGroup\(\s+'Parent branch'/,
    );
    expect(main).toMatch(
      /coverage\.missingVersions\.length > 0\s+\? referenceVersionGroup\(\s+'Not found'/,
    );
  });

  it('keeps large macro sets out of the primary input layout', () => {
    expect(html).toContain('id="macro-list-button"');
    expect(html).toContain('id="macro-list-dialog"');
    expect(html.indexOf('id="macro-list-dialog"')).toBeGreaterThan(html.indexOf('</main>'));
    expect(main).toContain('elements.macroListDialog.showModal()');
    expect(css).toContain('.macro-list-dialog .file-list-wrap');
    expect(css).toContain('overflow-y: auto');
  });

  it('keeps an analysis failure visible while allowing a retry', () => {
    expect(main).toContain('analysisError?: string;');
    expect(main).toContain('if (state.analysisError)');
    expect(main).toContain('state.analysisError = error instanceof Error');
    expect(main).toContain('Boolean(state.analysisError || state.analysisImportError)');
    expect(main).toContain("hasError ? 'alert' : 'status'");
  });

  it('shows determinate progress while RoomOS schemas are evaluated', () => {
    expect(html).toContain('id="analysis-progress" hidden');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="RoomOS schema evaluation progress"');
    expect(main).toContain('showAnalysisProgress(0, catalog.snapshots.length)');
    expect(main).toContain('showAnalysisProgress(index + 1, catalog.snapshots.length)');
    expect(main).toContain('hideAnalysisProgress();');
    expect(css).toContain('.analysis-progress-track i');
    expect(css).toContain('transition: width .2s ease');
  });
});
