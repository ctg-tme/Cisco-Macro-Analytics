# Macro Analyzer v1

## Product decision

The immediate product is a static Macro Analyzer for RoomOS macro authors and reviewers performing pre-deployment assessment. It applies Explicit Source Analysis to submitted JavaScript, produces target-independent source findings, and applies target-dependent rules when the Declared Target and immutable Schema Snapshot provide the evidence they require. It does not claim compatibility or diagnose runtime behavior.

Macro Diagnostics is a later, separate live mode. Its initial boundary is read-only evidence collection from an explicitly connected Endpoint.

## Product promise

Given a Macro Set, the analyzer produces a versioned Analysis Report that answers:

- What source and schema evidence was available?
- Which files are Entry Macros, which Dependency Relationships connect them, and what analysis coverage was achieved?
- Which xAPI references can be statically resolved?
- How did each proven xAPI root flow through local names and abstractions to those references?
- Does each resolved reference appear in the pinned schema evidence for the Declared Target?
- Do statically known parameters and values agree with that schema evidence?
- Which target-dependent and target-independent rules apply, and what observations triggered them?
- Which references repeat within one macro or overlap across dependency surfaces?
- What remains Unknown?

The analyzer does not answer whether a macro will behave correctly on an Endpoint. API Availability does not establish configuration, physical interfaces, permissions on an actual device, executed code paths, arguments computed at runtime, or runtime state.

## Inputs

### Macro Set

A Macro Set contains one or more RoomOS JavaScript macros. The Macro Author selects Entry Macros independently of endpoint Active state. Top-level roots with no incoming local imports are selected by default; every member of a top-level import cycle is selected by default. Supplied dependencies reachable from a selected Entry Macro are analyzed automatically, and a macro may be both an Entry Macro and a dependency.

The analyzer follows statically resolved local imports and builds a Potential API Surface per entry graph. A supplied file unreachable from every selected Entry Macro is shown as `Not in analyzed graph`. Missing imports, failed file parses, dynamic imports, computed xAPI paths, and unproven xAPI Binding Flows become Warning Coverage Gaps. A single usable file can produce a partial report. Only a submission from which no usable Macro Set can be parsed is an Analysis Failure.

`Starts analysis` is the only scope-selection control; supplied reachable dependencies do not require a separate include switch. Each macro's expandable details list all dependency names hierarchically, direct dependencies first with transitive branches beneath them. One Missing Dependency is consolidated per normalized expected path and retains every importer, affected Entry Macro, and dependency route. It appears as a dotted violet virtual dependency row with a gray `Not evaluated` state, while each importing macro carries the corresponding Warning and all other supplied source continues to be analyzed.

### Declared Target

A complete Declared Target contains:

- RoomOS release
- Product model
- Operating mode
- Macro Runtime Role

Target fields have no silent defaults. When the target is incomplete, the user explicitly performs an Exploratory Analysis; API Availability remains Unknown.

### Evidence versions

Every analysis pins:

- Analyzer version
- Analysis Report schema version
- Parser version
- Analysis time
- Schema Snapshot identifier, upstream update time, and content hash
- Rule Pack identifier and version
- Credential Vocabulary and Recognized Macro Global environment-model versions

“Latest” is a selection convenience that resolves to an immutable snapshot before analysis begins.

## Analysis model

### Parsing boundary

The source parser accepts standard modern JavaScript independently of the Declared Target. Explicit Source Analysis extracts statically determinable observations from syntax, lexical scope, imports, and declared object structure without treating dynamic object behavior as established. Parser acceptance does not imply RoomOS runtime support; target-specific syntax support belongs to applicable Target-dependent Rules.

Seeded xAPI Data Flow begins only at a statically proven `"xapi"` module import, require, or re-export origin. It follows proven aliases, destructuring, call-site argument mappings, returns, properties, exports, imports, and dependency crossings regardless of local binding names. It never seeds from an xAPI-looking property path. Dynamic or opaque boundaries become Dynamic xAPI References with Partial Observation Coverage, while independently proven routes remain analyzed.

Binding analysis respects assignment order and statically resolvable control flow. References before a later reassignment remain valid; a use reached by mixed xAPI and non-xAPI or unknown values is Partial and is not reconstructed as a canonical reference.

The analyzer does not execute macro code or attempt to simulate arbitrary JavaScript. Dynamic values, property existence, runtime branches, external mutation, prototypes, proxies, and unproven paths remain Unknown.

### Evidence classifications

- **Observed Finding**: directly supported by submitted source or pinned schema evidence.
- **Potential Risk**: source-specific evidence promoted by an applicable Analysis Rule, with limitations stated.
- **Unknown**: unavailable evidence or a condition that static analysis cannot establish.

Evidence classification is independent of Review Priority:

- **Required**: the Macro Author must inspect the item before relying on the assessment.
- **Warning**: a source concern or explicit analysis limitation that does not prescribe that the Macro Author must act.
- **Advisory**: an optional improvement or preferred practice.
- **Informational**: neutral inventory or context.

Required is reserved for a direct source/schema contradiction or an unconditional source policy in the applicable Rule Pack. Coverage Gaps are Warnings and describe the analysis, never the macro's ability to run. Interface colors are red, orange, yellow, and blue respectively, always accompanied by labels and icons.

### Finding contract

Each Finding contains:

- Stable rule identifier and rule version
- Finding Category, evidence classification, Review Priority, and Rule Applicability
- References to one or more addressable Analysis Observations
- Every source occurrence, affected Entry Macro, and direct-versus-dependency impact
- Submitted and normalized evidence fields appropriate to the observation
- Concise summary
- Technical basis and authoritative citation when applicable
- Explicit limitations
- Recommended action
- Related xAPI and Schema Snapshot references

Analysis Report schema `2.3.0` separates the file inventory, Observation Ledger, Findings, dependency relationships, and Analysis Provenance. The ledger contains every supported observation whether or not it produces a Finding, including External Destinations, Dynamic URLs, Commented URLs, occurrence-level URL Usage classifications, URL Usage Explanations, and bounded URL Provenance Flows. Per-file Observation Coverage reports each observation family as Complete, Partial, or Not evaluated. Report-local Source References use file identities, content hashes, and source ranges so users can join observations back to files they already possess.

Original source files, source excerpts, complete URL values and paths, literal argument values, and dynamic identifier text are never embedded or offered as an export option. External Dependency observations retain only the External Destination, protocol, URL Usage, explanation, and report-safe provenance references. xAPI observations retain Argument Shapes, submitted syntax classification, Canonical xAPI References, documentation locators when complete, and exact binding-name routes. The local interface may render unredacted source context directly from the in-memory Macro Set.

### URL dependency contract

Each absolute URL token in executable syntax is one External Dependency Occurrence. Its External Destination identity is the normalized DNS hostname or IP literal plus any explicitly authored port; the protocol is retained separately. An authored default port is not collapsed, so `example.com`, `example.com:443`, and `example.com:8443` are separate destinations. Bracketed IPv6 destinations retain their brackets when a port is present.

Each occurrence receives one URL Usage:

- **In Use** when any bounded provenance route carries the URL value anywhere inside an argument delivered to a proven xAPI Touchpoint, or when the URL occurs in structurally recognized executable XML. XML independently proves source use in the closed RoomOS Macro runtime. JSON serialization or parsing only preserves provenance and never proves use by itself.
- **Use Unknown** when no route proves In Use and at least one path crosses an unsupported transformation, unknown call, opaque mutation, unresolved or unsupplied consumer, or dynamic destination boundary.
- **Not In Use** only when every explicit path is bounded and proven to terminate without xAPI use. This includes values that are never read, overwritten before a read, discarded through supported transformations, or used only by `console.*`.

Status for one External Destination is aggregated in this priority order: In Use, Use Unknown, Not In Use. A single In Use occurrence makes the destination In Use while lower-priority occurrences remain visible in details.

The versioned provenance allowlist initially covers aliases and assignments; object and array construction, access, destructuring, and spread; supported function arguments and returns; conditional and logical merges; statically recoverable callbacks; statically resolved imports and exports; template interpolation and string concatenation; `String`, trim variants, case conversion, and normalization; `map`, `flatMap`, `filter`, `find`, `findLast`, `forEach`, `flat`, `slice`, `concat`, and `join`; and `JSON.stringify` and `JSON.parse`. Content-changing string operations, `reduce`, mutating array methods, unknown calls, proxies, prototypes, and opaque external mutation are outside the initial allowlist.

Dynamic-host expressions appear as Dynamic URL evidence rather than under a guessed External Destination. They are Use Unknown unless executable XML independently proves In Use. URLs in JavaScript comments are Commented URL evidence: they are Not In Use, are not External Dependencies, never affect dependency totals or External Dependency Status, and are hidden in the map by default.

Every URL Usage includes a stable reason, concise explanation, last proven Source Reference, and every available provenance route. The local dependency-map inspector may use those references to show exact unredacted source regions because the Macro Set is already in memory. Canonical reports and exports continue to omit URL paths and source text.

## v1 evidence scope

The first trustworthy release includes:

1. JavaScript parsing, lexical-binding observations, local-import and External Destination coverage, Entry Macro selection, dependency graphs, unresolved edges, and per-family Observation Coverage.
2. Seeded, call-site-sensitive xAPI Binding Flow with exact binding routes, Dynamic xAPI References, Argument Shapes, and Canonical xAPI References reconstructed in preferred New Style.
3. API Availability for a complete Declared Target, including product, operating-mode, Macro Runtime Role, parameter, and configuration-value Schema Mismatches.
4. Target-independent source rules:
   - CommonJS Migration Requirement — one Required Finding per macro for every executable `require`, `module.*`, `exports.*`, `__filename`, or `__dirname`; comments discussing CommonJS do not count.
   - Sensitive Credential Indicator — one Warning per macro with every matched Credential Vocabulary term, occurrence, and matched-term count. Matching covers filenames, identifiers, property names, strings, templates, and comments using versioned, case-insensitive word-component matching rather than arbitrary substrings.
   - Unresolved Identifier — Warning for names outside lexical scope and the Recognized Macro Global environment model.
   - Nonstandard xAPI Root Binding — Warning when the proven module-root object is not named exactly `xapi`.
5. Preferred-syntax guidance:
   - Old-style xAPI Usage — one Advisory per old-only macro.
   - Mixed xAPI Syntax within one macro — one Advisory per internally mixed macro; different files using different internally consistent styles do not create this Finding.
   - New Style is Preferred; old style remains supported and acceptable. New-style-only use is neutral file metadata and does not create an Informational Finding.
6. Neutral xAPI optimization evidence:
   - xAPI Abstraction — Informational, with every proven route reaching a touchpoint.
   - Repeated xAPI Reference — Informational within one macro.
   - Cross-Macro xAPI Overlap — Informational across Entry Macro Potential API Surfaces.

Repeated and cross-macro identity uses Canonical xAPI Reference kind, normalized path, and operation. Arguments, root names, binding routes, and submitted syntax do not divide otherwise identical references. These findings do not assert runtime execution or behavioral redundancy.

## Report hierarchy

The interface presents all major sections collapsed initially:

1. Required
2. Warning
3. Advisory
4. Informational
5. No findings in evaluated source

Each section header shows both Finding count and affected-macro count. Individual Finding cards are expandable and show title, category, priority, occurrence count, affected-macro count, and filenames before expansion; details show every source location, locally rendered masked context, binding and dependency paths, technical basis, limitations, and recommended action. `No findings in evaluated source` is a collapsed green file list, not a collection of green issue cards, and excludes missing, unparsed, and unanalyzed files.

File rows distinguish Entry and Dependency roles from Active state. Entry uses teal and Dependency uses violet. Missing dependencies appear as dotted violet virtual rows labeled `Missing dependency`, `Warning`, and `Not evaluated`. Each evaluated file row shows separate direct-Finding and dependency-impact counts; those counts navigate to filtered views of the same canonical Findings rather than duplicate them.

The source file owns a Finding's direct count; each affected Entry Macro receives a dependency-impact count. Selecting a direct count filters Issues to that file's direct Findings, while selecting an Entry Macro's dependency-impact count filters the same canonical Finding by that entry. A consolidated Finding counts once globally even when it appears through multiple source files, dependency rows, Entry Macros, or filtered views.

The versioned JSON Analysis Report is canonical. The interface, prose, counts, charts, explicit exports, tests, and future clients derive from the same report records.

## Privacy and trust

Analysis is local to the browser. Macro source, filenames, Declared Targets, and report findings are not transmitted to another service.

- Report export requires explicit user action.
- Product Telemetry is disabled until the user opts in.
- Telemetry is restricted to allowlisted interactions and cannot contain user-supplied values or analysis-derived data.
- Executable dependencies and Schema Snapshots are pinned and served from the application origin.
- A Content Security Policy blocks third-party script execution.

## Current prototype review

### What is worth preserving

- A simple static deployment and browser-local file-reading flow.
- Real RoomOS schema data and automated acquisition work.
- Test macros covering modern, legacy, mixed, and deprecated syntax examples.
- An interface prototype for upload, target selection, result tabs, explicit ZIP export, and future endpoint connection.
- The instinct to qualify product coverage and MTR claims rather than present them as certainty.

### Critical correctness risks

1. The analyzer is regex-based. It can treat comments as calls, miss aliases and computed references, and cannot establish an import graph or exact source ranges.
2. `Macro_Runtime_Confidence` is a product/API coverage ratio, not runtime confidence. Empty or partial schema matches can produce reassuring output without representing unresolved references.
3. Subscription analytics contain inconsistent keys and counters. One test uses `includes('on', 'once')`, which only checks `on`, and the configuration total/unique subscription fields are reversed.
4. The chart loader defaults to `analyze-results-xapi-stats`, while the page provides `analyze-results-pretty-canvas`; the first analysis can fail while trying to obtain a canvas context.
5. The current Schema Catalog is not trustworthy. Its manifest contains only two `sample-*` entries after an automated upstream fetch replaced the prior release list.
6. Schema lookup, parsing, rule evaluation, report construction, telemetry, and presentation are coupled through browser globals, making findings difficult to test independently.
7. There is no automated test runner or asserted expected output. The sample macros demonstrate inputs but cannot detect false positives, false negatives, incorrect ranges, or report-schema drift.
8. Third-party executable code is loaded at runtime, which prevents enforcement of the Local Analysis trust boundary.

These are prototype constraints, not reasons to discard the project. They explain why the analytical core should be replaced behind the useful interface rather than incrementally granting the current function more authority.

## Implementation roadmap

### 1. Establish the report contract

- Define and validate Analysis Report JSON schema `2.0.0`, including the file inventory, Observation Ledger, Observation Coverage, direct dependency graph, unresolved edges, Findings, impacts, and Analysis Provenance.
- Create fixture helpers and golden reports for Observed, Potential Risk, Unknown, and Coverage Gap outcomes.
- Prove that independent consumers can regroup observations and render different views without original source files or browser-only state.
- Make every regression a permanent fixture.
- Add a pure engine entry point that accepts sources, target, snapshot, and Rule Pack and returns an Analysis Report without accessing the DOM or network.

### 2. Parse Macro Sets

- Replace regex extraction with a JavaScript syntax tree.
- Preserve file identities and exact source ranges.
- Resolve static local imports, exports, Entry Macro graphs, dependency cycles, and default roots independently of Active state.
- Implement lexical scope and the versioned Recognized Macro Global environment model.
- Implement call-site-sensitive Seeded xAPI Data Flow from proven module origins through aliases, parameters, returns, properties, and supplied dependencies.
- Record binding routes, canonical references, argument shapes, missing imports, parse failures, dynamic imports, Dynamic xAPI References, and computed paths as observations with explicit coverage.
- Emit the complete Observation Ledger before adding Findings.

### 3. Build the trusted Schema Catalog

- Normalize upstream schema objects into a stable internal representation.
- Hash and retain immutable Schema Snapshots.
- Validate manifests and snapshots before publication.
- Quarantine malformed, unexpectedly small, or otherwise suspicious updates.
- Keep the last known-good catalog available.
- Add target-aware lookup for product, operating mode, role, command parameters, and configuration value spaces.

### 4. Add the first Rule Pack

- Define a versioned rule format with stable IDs, Target-dependent or Target-independent applicability, authoritative citations or explicit source-policy basis, evidence requirements, limitations, priority, category, and remediation.
- Implement only the agreed v1 scope.
- Implement CommonJS, credential-vocabulary, unresolved-identifier, xAPI-root-naming, syntax-style, abstraction, repeated-reference, and cross-macro-overlap rules against Observation identities.
- Do not apply a Target-dependent Rule when its required target evidence is Unknown; continue applying Target-independent Source Rules.

### 5. Rebuild the report interface around evidence

- Require explicit target values or explicit Exploratory Analysis.
- Render collapsed Required, Warning, Advisory, Informational, and No-findings sections with Finding and affected-macro metadata.
- Render Entry, Dependency, Active, inactive, missing, and not-in-graph states independently.
- Show direct-Finding and dependency-impact counts that navigate to filtered views of the same canonical Finding.
- Render consolidated line-level Findings with locally sourced masked context, dependency paths, binding routes, matched credential terms, and canonical documentation links.
- Keep neutral inventory and charts below actionable evidence.
- Export the canonical report only after an explicit action.

### 6. Enforce privacy

- Bundle and pin executable dependencies.
- Serve schemas from the application origin.
- Add a restrictive Content Security Policy and network-level tests proving analysis data is not transmitted.
- Replace default-on telemetry with consent and an allowlisted, non-content event API.

### 7. Release on evidence, not feature count

A v1 release candidate is ready when:

- Every supported construct has positive, negative, and Unknown fixtures.
- Partial Macro Sets produce explicit Coverage Gaps without losing valid findings.
- Re-running a report with the same inputs, analyzer, Schema Snapshot, and Rule Pack yields the same semantic result.
- Every observation family declares Complete, Partial, or Not evaluated coverage per file.
- No Finding lacks referenced observations, affected entries, basis, limitation, and recommended action.
- Direct, renamed, and abstracted references with the same canonical kind, path, and operation consolidate consistently.
- No target field is silently defaulted.
- No report or export embeds original source files, source excerpts, literal argument values, or dynamic identifier text.
- No source, filename, target, or finding leaves the browser during analysis.
- The UI contains no compatibility score or runtime-success claim.

## Later: Macro Diagnostics

Macro Diagnostics is not an expansion of a static finding. It is a separate live session with its own Runtime Evidence and provenance.

The first live mode may read:

- Endpoint identity and RoomOS details
- Installed macro inventory and enabled state
- Macro logs
- Relevant status and configuration evidence

It does not execute commands, change configuration, or mutate macro state. Credentials remain local. Any future state-changing action requires a separate explicit architectural and safety decision.
