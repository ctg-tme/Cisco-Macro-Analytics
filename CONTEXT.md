# Cisco Macro Analysis

This context defines the language used to assess and investigate RoomOS macros while keeping source-only findings distinct from conclusions based on observed device behavior.

## Repository Working Agreement

Agents may create local commits for completed work without requesting additional permission, but they must never push changes unless the user explicitly asks for a push.

After completing any work, agents must verify that port `5176` is serving this repository's page. If nothing is listening, they must start this repository's local development server. If another page is being served, they must stop that process and start this repository's local development server. They must post the server address in the task chat unless it has already been posted in that task on the same calendar day.

## Language

**Macro**:
A RoomOS-hosted JavaScript module that can run as an active automation or provide exports to other macros.
_Avoid_: Generic Script, Node Application

**Macro Author**:
A person developing or reviewing a Macro Set before deployment who can act on source-level findings. The Macro Author is the Macro Analyzer's primary user.
_Avoid_: Endpoint Operator, Runtime Support Investigator

**Macro Set**:
One or more macros explicitly included for analysis and analyzed together, including any included local modules reachable through statically resolved imports. Unchecked source files are outside the submitted Macro Set at every analysis stage. A single macro is a valid Macro Set; absent or unresolved dependencies make the set incomplete.
_Avoid_: Isolated File, Complete Solution

**Entry Macro**:
A top-level import-graph root inferred from the included Macro Set, regardless of its endpoint Active state. It roots an import graph but does not establish which runtime branches will execute.
_Avoid_: Imported Module, Executed Code Path

**Macro Active State**:
Endpoint-reported metadata indicating whether a macro is currently active or inactive. It is displayed independently and does not determine whether the macro is an Entry Macro or participates in a Dependency Relationship.
_Avoid_: Entry Status, Dependency Status

**Dependency Relationship**:
A statically resolved local import from one macro to another macro in the Macro Set. The imported macro may also be an Entry Macro or participate in other Dependency Relationships.
_Avoid_: Dependency Macro, Helper File

**External Dependency**:
A normalized External Destination identified from a statically recoverable absolute URL occurrence in executable Macro syntax. The Analysis Report retains the External Destination, protocol, and URL Usage classification but not the complete URL or path. An External Dependency is source evidence that a macro names a network location; it does not establish that a runtime branch connects to that destination or that the service is available.
_Avoid_: Observed Network Connection, Remote Runtime Dependency

**External Destination**:
The normalized DNS hostname or IP literal and optional explicitly authored port named by an External Dependency occurrence. An explicit port is always preserved as part of the identity, including a protocol-default port, so an unqualified host and each host-and-port combination remain separate destinations; the protocol is retained separately.
_Avoid_: Domain, Runtime Endpoint, URL Path

**External Dependency Occurrence**:
One statically recoverable absolute URL token in executable Macro syntax, including each repeated token within the same string or XML payload. Every occurrence has its own exact Source Reference and URL Usage, while the Analysis Report retains only its normalized External Destination and protocol rather than the complete token or path.
_Avoid_: URL Syntax Node, Deduplicated Domain Match

**Commented URL**:
One statically recoverable absolute URL token in comment syntax. It is Not In Use source evidence with an exact Source Reference, but it is not an External Dependency and does not contribute to External Dependency Status or dependency totals.
_Avoid_: Ignored Dependency, Comment External Dependency

**URL Usage**:
The static relationship between a detected URL occurrence and the Macro source. In Use means the URL value has at least one statically supported source path that proves it is structurally included anywhere within an argument delivered at a proven xAPI Touchpoint, including through explicitly recoverable structure-preserving transformations, or occurs inside structurally recognized XML; XML is an independent proof route, while JSON structure only preserves provenance and does not establish use on its own, and the receiving property need not have a URL-shaped name. Not In Use means the occurrence is in comment syntax or every explicit executable path from it is proven to terminate without reaching xAPI, while Use Unknown means at least one path crosses an opaque or dynamic boundary; all three states are source evidence rather than proof that a branch executed, a value was included at runtime, network contact occurred, or a service was available.
_Avoid_: Executed URL, Active Network Connection, Unused Forever

**URL Usage Explanation**:
Structured evidence explaining why one detected URL occurrence received its URL Usage, including a stable reason, the last proven Source Reference or destination, and its URL Provenance Flow when available. It supports troubleshooting without adding complete URL values, paths, or source text to the Analysis Report.
_Avoid_: Status-only Label, Unstructured URL Rationale

**External Dependency Status**:
The Entry-Macro-specific summary derived from every URL Usage occurrence for one External Dependency. In Use takes precedence over Use Unknown, which takes precedence over Not In Use; lower-priority occurrences remain part of the supporting source evidence.
_Avoid_: Domain Usage, Runtime Dependency Status

**URL Provenance Flow**:
The bounded, versioned static evidence chain by which an External Dependency occurrence remains structurally represented through explicitly modeled value transformations toward an xAPI Touchpoint within the supplied Macro Set, including across statically resolved imports and exports and through statically recoverable callback bodies without claiming the callback ran. Proof is independent of author-chosen identifiers and property names; an unrecognized transformation, missing consumer, unresolved dependency, or escape from the evaluated Macro Set does not preserve proof of either use or non-use and leaves the occurrence Use Unknown unless another supported path establishes In Use.
_Avoid_: Runtime URL Trace, General Taint Analysis

**Dynamic URL**:
An executable URL-shaped source expression whose complete External Destination cannot be statically normalized. It is not an External Dependency because the analyzer does not invent or group it under a guessed destination. It remains Use Unknown unless structurally recognized XML independently proves In Use, and it always retains an exact Source Reference.
_Avoid_: Guessed External Dependency, Dynamic Domain Match

**Missing Dependency**:
A statically resolved local import whose target was not supplied or could not be resolved within the Macro Set. One Missing Dependency represents each normalized expected path and retains every importer and affected Entry Macro; it is a Coverage Gap with no source available for evaluation, not a supplied macro known to be issue-free.
_Avoid_: Missing Macro Finding, Evaluated Dependency

**Potential API Surface**:
The statically resolved xAPI references reachable through the import graph rooted at an Entry Macro, regardless of whether their runtime branches execute.
_Avoid_: Runtime API Usage, Executed Calls

**Macro Analyzer**:
A tool that applies Explicit Source Analysis to RoomOS macro source, including specialized Seeded xAPI Data Flow and schema comparison, without claiming to understand every execution path or observe behavior on a device.
_Avoid_: Macro Diagnostics, Macro Troubleshooter

**Explicit Source Analysis**:
The governing scope principle that permits the Macro Analyzer to extract a statically determinable source fact and interpret it only through a named, versioned Analysis Rule. Ordinary JavaScript bindings and explicitly declared object structure may be observed, while dynamic property existence, external mutation, branch execution, prototypes, proxies, and other runtime object behavior remain Unknown. xAPI receives deeper binding and property-path analysis because it has a proven module origin and authoritative schema evidence.
_Avoid_: General Runtime Simulation, xAPI-only Syntax Search

**Local Analysis**:
Analysis performed within the user's browser without transmitting macro source, filenames, Declared Targets, or report findings to another service.
_Avoid_: Anonymous Upload, Server-side Analysis

**Exploratory Analysis**:
Analysis performed without a complete Declared Target. It may inventory source evidence and possible schema matches, but API Availability remains Unknown.
_Avoid_: Default Target, Compatibility Check

**Product Telemetry**:
Default-on anonymous measurement of explicitly allowlisted product interactions when an Aptabase app key is configured. It may record successful Endpoint connections, manual Macro loading, the number of Macros in a completed analysis, per-analysis counts of Macros containing ECMAScript import syntax, export syntax, or either form, and whether the analyzed Macro Set came from an Endpoint or manual loading. It excludes Macro names, filenames, source content, Endpoint identity or address, credentials, Declared Targets, report findings, and every other user-supplied or analysis-derived value. Product Telemetry is disabled when the app key is absent.
_Avoid_: Analysis Telemetry, Identifying Tracking, Arbitrary Event Properties

**Product Version**:
The release identity of the Cisco Macro Analyzer as a user-facing product. It advances with user-visible product changes and remains distinct from Analysis Provenance component versions such as the analyzer, Analysis Report schema, parser, Rule Pack, and Credential Vocabulary.
_Avoid_: Analyzer Version, Report Schema Version

**Macro Diagnostics**:
An explicit live investigation that uses read-only Runtime Evidence from an Endpoint to explain a macro's observed behavior or failure. It does not execute commands or change Endpoint state.
_Avoid_: Macro Analyzer, Static Analysis

**Runtime Evidence**:
A time-stamped observation collected from an Endpoint during Macro Diagnostics, such as device identity, RoomOS details, macro state, logs, status, or configuration. It remains distinct from source and schema evidence.
_Avoid_: Static Finding, Declared Target

**Compatibility**:
An end-to-end judgment that a macro will behave as intended in a particular RoomOS deployment, accounting for executed code paths, software release, product capabilities, physical interfaces, and runtime state. Source and schema analysis alone cannot establish compatibility.
_Avoid_: Confidence Score, API Availability

**API Availability**:
Evidence that a detected xAPI reference appears in the applicable RoomOS schema for a particular product or operating mode. It does not establish that required configuration, arguments, permissions, physical interfaces, or runtime state are correct.
_Avoid_: Compatibility, Runtime Confidence

**Android Container**:
The user-facing name for device deployments running Microsoft Teams Rooms or Zoom Rooms software on top of RoomOS. Upstream schemas encode Microsoft Teams container evidence with kind-specific conventions: Configuration and Status paths use the internal `mtr` extension marker as an allowlist; older Command schemas use the same allowlist, while newer Command schemas use Microsoft Teams unavailable states as a denylist; and Events are available when their underlying feature exists. A Schema Snapshot containing no Android Container availability metadata is treated as not supporting the Android Container. Once a snapshot establishes support, absence is meaningful only within the applicable kind-specific convention; a missing convention for that kind or conflicting product variants is Unknown. The schemas do not provide equivalent general availability evidence for Zoom Rooms. Keep schema terms internal and use Android Container in interface labels and explanatory copy.
_Avoid_: The standalone MTR acronym, or either product name as a substitute for Android Container outside this definition

**Declared Target**:
The intended deployment described by a RoomOS release, product model, operating mode, and Macro Runtime Role. It is the basis for schema comparison but is not evidence about an actual device's configuration or state.
_Avoid_: Endpoint, Connected Device

**Macro Runtime Role**:
The authority under which an Entry Macro is intended to run on its Declared Target. It allows schema role requirements to be compared without asserting that an actual Endpoint is configured accordingly.
_Avoid_: Logged-in User, Analyzer Permission

**Schema Snapshot**:
An immutable copy of the RoomOS schema evidence used for an analysis, identified by its schema name, upstream update time, and content hash. “Latest” may select a Schema Snapshot but is not itself a reproducible schema identity.
_Avoid_: Latest Schema, Live Schema

**Schema Catalog**:
The validated collection of Schema Snapshots available for analysis. Suspect upstream responses are quarantined rather than replacing the last known-good catalog.
_Avoid_: Upstream Response, Unvalidated Manifest

**Cloud Schema**:
A Schema Snapshot whose upstream schema name contains a calendar month. This naming rule describes the upstream release channel; it is not inferred from the numeric release alone.
_Avoid_: Monthly Version, Newest Schema

**On-premises Schema**:
A Schema Snapshot whose upstream schema name does not contain a calendar month. It remains separate from Cloud Schemas when version coverage is presented.
_Avoid_: Non-cloud Guess, Old Version

**Endpoint**:
An actual RoomOS device whose configuration and runtime state require evidence collected from that device.
_Avoid_: Declared Target, Selected Schema

## Analysis Results

**Analysis Report**:
The canonical, versioned result of analyzing a Macro Set against a Declared Target and Schema Snapshot. Version 2 separates the submitted-file inventory, Observation Ledger, Findings, relationship data, and analysis provenance so another consumer can inspect the analyzer's evidence or apply different interpretations rather than merely recreate the product interface. It never embeds or bundles the submitted source files, may be exported only through an explicit user action, and treats the product interface as one possible rendering.
_Avoid_: Debug Dump, UI State

**Analysis Session Result**:
The canonical, versioned result of one explicit browser analysis across the selected verified Schema Snapshots. It contains the analyzed source inventory, source relationships, every per-schema Analysis Report and verified Schema Provenance record, cross-schema comparison, effective Rule Pack configuration, subscription analytics, and named runtime metadata. The product interface and explicit ZIP export are projections of this same result. The user names the ZIP before export. It contains the complete canonical result as `full-analysis.json` and a separate source-free analysis projection for every submitted Macro under `independent-macro-analysis/`.
The complete `full-analysis.json` may be imported later to re-render the saved product interface without resubmitting or re-analyzing Macro source. An independent per-Macro projection cannot reconstruct the cross-schema session and is not accepted by this import path.
_Avoid_: Primary Report Export, UI-only Comparison State

**Analysis Observation**:
A structured, rule-independent fact extracted from the submitted Macro Set, such as an import reference, xAPI Touchpoint, syntax occurrence, credential-vocabulary match, or parser diagnostic. It preserves bounded fields intrinsic to the fact, their normalized representation when applicable, a Source Reference, and any extraction limitation, but not arbitrary source excerpts or literal argument values; an Analysis Observation is not itself a recommendation or Finding.
_Avoid_: Finding, Rendered Issue, Runtime Fact

**Observation Ledger**:
The Analysis Report collection of every supported Analysis Observation extracted from the Macro Set, whether or not a current Analysis Rule turns that observation into a Finding. Observation identities are unique references within one report and are not promised to remain identical across separate analyses. Findings reference those identities instead of being the only place extracted evidence survives, allowing another consumer to regroup observations, apply its own rules, or ignore the product's Findings without reparsing the report presentation.
_Avoid_: Issue List, UI Card Data, Raw AST

**Observation Coverage**:
The per-file, per-observation-family status stating whether extraction was Complete, Partial, or Not evaluated, together with the reason for any limitation. It prevents the absence of observations from being interpreted as evidence that the source contained none.
_Avoid_: Confidence Score, Empty Findings

**Source Reference**:
A portable pointer from an Analysis Observation to the user's own submitted file, consisting of a report-local file identity, content hash, and source range. The content hash is an integrity fingerprint that allows a consumer to verify that its local file is the same version analyzed; it does not replace the file or provide a cross-report Observation identity. A consumer that already possesses the submitted files can use the reference to recover surrounding context without the Analysis Report storing source contents.
_Avoid_: Source Copy, Embedded Snippet

**Analysis Provenance**:
The parser, Analysis Report schema, Rule Pack, Credential Vocabulary, Schema Snapshot, and relevant analyzer versions that produced an Analysis Report, together with the Declared Target inputs used. It allows a consumer to distinguish submitted facts from versioned interpretations and reproduce the applicable analysis boundary.
_Avoid_: Product Version Only, Hidden Configuration

**Evidence Coverage**:
A non-scored summary of the submitted files, import resolution, statically resolved and dynamic references, Declared Target completeness, and Schema Snapshot used for an analysis.
_Avoid_: Confidence Score, Compatibility Percentage

**Coverage Gap**:
A Finding identifying a failed file parse, missing import, unresolved dependency, unproven xAPI Binding Flow, dynamic reference, or absent target input that limits what an analysis can establish without invalidating evidence gathered elsewhere. Most Coverage Gaps are Warnings; a Dynamic xAPI Reference is Advisory because runtime construction may be intentional and valid even though the complete path cannot be verified statically.
_Avoid_: Macro Error, Failed Analysis

**Analysis Failure**:
A submission state in which no usable Macro Set can be parsed and therefore no meaningful Analysis Report can be produced.
_Avoid_: Coverage Gap, Potential Risk

**Finding**:
A structured Analysis Report interpretation with a stable rule identity and version, Finding Category, evidence classification, Review Priority, referenced Analysis Observations, affected Entry Macros, technical basis, limitations, recommended action, and applicable xAPI and Schema Snapshot references. A consumer may use the referenced observations while declining the product's interpretation.
_Avoid_: Prose-only Warning, Chart Datum

**Finding Category**:
The subject grouping assigned to a Finding independently of its evidence classification and Review Priority: Coverage, Schema, Security, Syntax, or xAPI Touchpoints.
_Avoid_: Severity, Priority

**Review Priority**:
The degree of Macro Author attention assigned independently of evidence classification: Required, Warning, Advisory, or Informational. Required is reserved for evidence that establishes a direct contradiction within the analyzer's stated scope or violates an unconditional source policy in the applicable Rule Pack; Warning identifies a source concern or explicit analysis limitation without prescribing that the Macro Author must act; Advisory identifies an optional improvement or preferred practice; Informational presents neutral evidence. Review Priority does not express failure probability or runtime severity.
_Avoid_: Error Level, Warning Severity

**Observed Finding**:
A fact directly supported by the submitted macro source or applicable RoomOS schema.
_Avoid_: Proven Behavior, Runtime Fact

**Potential Risk**:
A source-level pattern that an Analysis Rule identifies as potentially causing failure or maintenance difficulty but that cannot be confirmed without additional context or runtime evidence.
_Avoid_: Error, Defect

**Analysis Rule**:
A named and versioned criterion that interprets referenced Analysis Observations as a Finding. Every rule declares its Rule Applicability, technical basis, limitations, and applicable Review Priority so consumers do not have to infer whether it expresses target evidence or an intentional source policy.
_Avoid_: Generic Warning, Unexplained Heuristic, Hidden Policy

**Rule Applicability**:
The declared execution boundary of an Analysis Rule: Target-dependent or Target-independent. Applicability determines whether missing Declared Target evidence prevents the rule from running; it is separate from Finding Category and Review Priority.
_Avoid_: Severity, Evidence Classification

**Target-dependent Rule**:
An Analysis Rule whose conclusion depends on the Declared Target, Schema Snapshot, release, operating mode, or Macro Runtime Role. It is not applied when its required target evidence is Unknown, and the unavailable analysis becomes a Coverage Gap when appropriate.
_Avoid_: Universal Rule, Assumed Target

**Target-independent Source Rule**:
An Analysis Rule that evaluates submitted-source observations regardless of the Declared Target, such as the CommonJS Migration Requirement or Authentication Vocabulary Match. Its Finding must identify the applicable source policy or review rationale and must not be presented as an endpoint compatibility claim.
_Avoid_: Compatibility Rule, Target Fact

**Recognized Macro Global**:
A JavaScript or RoomOS host-provided global binding explicitly included in the versioned Rule Pack environment model. A name is not treated as globally available merely because it is common or was observed in another macro.
_Avoid_: Assumed Global, Unresolved Identifier

**Unresolved Identifier**:
A neutral Analysis Observation recorded when an identifier use has no declaration, import, parameter, enclosing binding, or Recognized Macro Global in lexical scope. It remains available in the Observation Ledger for diagnostics and future rules, but it does not produce a Finding because the analyzer cannot establish runtime execution or rule out an unmodeled host global. It is not attached to a Dynamic xAPI Reference; that Coverage Gap retains only the observations that establish the opaque xAPI boundary.
_Avoid_: Missing Object Property, Proven Runtime ReferenceError

**Rule Pack**:
A versioned collection of Target-dependent Rules and Target-independent Source Rules. Every rule has an explicit applicability mode and versioned technical basis; Target-dependent Rules declare their release and operating-mode applicability and are not applied when required target evidence is Unknown, while Target-independent Source Rules remain applicable without target evidence.
_Avoid_: Hardcoded Warnings, Schema Snapshot

**Unknown**:
A condition the available source and schema evidence cannot establish and that must remain explicit in the analysis report.
_Avoid_: Assumed Compatible, Assumed Incompatible

**Statically Resolved xAPI Reference**:
An xAPI path that can be derived from the submitted JavaScript syntax and a proven xAPI Binding Flow without executing the macro or guessing a dynamically computed value.
_Avoid_: Runtime Call, Regex Match, All xAPI Usage

**Canonical xAPI Reference**:
The API kind, normalized path segments, and operation reconstructed from a Statically Resolved xAPI Reference independently of the submitted root name, downstream binding names, or old-versus-new syntax. When every segment is known, it provides a conventional New-style xAPI Syntax display expression and an official RoomOS documentation locator while the Analysis Observation separately preserves the submitted syntax classification. When any required segment is dynamic, the analyzer retains the known prefix and limitation without inventing a complete path or documentation link.
_Avoid_: Submitted Expression, Runtime Call, Guessed Documentation Path

**xAPI Binding**:
A JavaScript binding statically proven from an xAPI module import origin to refer to the xAPI object or one of its branches, regardless of the local identifier chosen by the Macro Author. A conventional name alone never establishes an xAPI Binding.
_Avoid_: Identifier Named xapi, Assumed API Object

**Seeded xAPI Data Flow**:
The conservative analysis that begins only at a statically proven `"xapi"` module import, require, or re-export origin and follows every explicitly established binding route reachable from that seed. Property names or call shapes that merely resemble xAPI never create a seed.
_Avoid_: Whole-program Object Search, xAPI Shape Guessing

**xAPI Call Context**:
The statically resolved mapping from arguments at one function, method, or constructor call site to the called parameters and resulting xAPI Binding Flow. The same callable may have both xAPI and non-xAPI contexts; only contexts receiving a proven xAPI Binding attribute downstream source occurrences to xAPI.
_Avoid_: Globally Tainted Function, Runtime Invocation

**xAPI Binding Flow**:
The statically proven propagation of an xAPI Binding within Seeded xAPI Data Flow through aliases, destructuring, xAPI Call Contexts, returns, instance properties, exports, imports, or equivalent local abstractions. It respects assignment order and statically resolvable control flow, and may cross supplied dependency files when imports and calls resolve statically. The analyzer evaluates only explicitly established routes: uncertain or mixed values reaching a use produce Partial Observation Coverage and a Dynamic xAPI Reference Advisory while independently proven routes and earlier source occurrences remain analyzed.
_Avoid_: Runtime Execution Trace, Name Matching

**xAPI Binding Route**:
An ordered evidence chain for one proven xAPI Binding Flow from its module origin toward an xAPI Touchpoint. Each hop identifies its exact local binding name, binding transformation, and Source Reference, allowing a renderer to explain import aliases, argument-to-parameter propagation, property assignment, or dependency crossings and support Canonical xAPI Reference reconstruction without claiming the route executed at runtime.
_Avoid_: Call Trace, Stack Trace

**Dynamic xAPI Reference**:
An xAPI reference whose complete path cannot be verified from source because a path segment or binding is supplied at runtime, passes through opaque code, or may resolve to different xAPI values. The analyzer retains the last statically proven hop, marks the applicable Observation Coverage Partial, and produces one consolidated Advisory per containing macro. Dynamic construction may be intentional and correct; the injected content should be reviewed and tested on the target device before release and treated as an early troubleshooting point if an error occurs.
_Avoid_: xAPI Flow Frontier, Unresolved Object, Assumed Return Value

**Nonstandard xAPI Root Binding**:
A Warning Observed Finding produced when the xAPI module object is imported or assigned at its module origin under a local name other than the conventional exact name `xapi`. One Finding per macro consolidates every nonstandard root occurrence. The bindings remain eligible for proven xAPI Binding Flow analysis; the Warning concerns the root naming convention and is not a Coverage Gap or compatibility claim.
_Avoid_: Unresolved xAPI Alias, Unsupported Import

**xAPI Abstraction**:
An Informational Observed Finding documenting a proven xAPI root binding—regardless of its local name—flowing through aliases, destructured branches, function or method parameters, constructor parameters, instance properties, or equivalent abstractions and reaching at least one xAPI Touchpoint. One Finding per macro consolidates every applicable xAPI Binding Route and exposes each route in its details without treating abstraction as a source concern or analysis limitation. Proven propagation that reaches no detected touchpoint remains neutral Observation Ledger evidence, while an unproven route is a Warning Coverage Gap.
_Avoid_: Nonstandard xAPI Root Binding, Unresolved xAPI Flow

**xAPI Touchpoint**:
A source location where a macro directly contains a statically resolved xAPI reference. Its Analysis Observation may retain an Argument Shape, but multiple touchpoints for the same API kind, path, and operation may be candidates for consolidation behind a local wrapper regardless of their arguments; their number does not establish runtime call count.
_Avoid_: Executed Call, Failure Point

**Argument Shape**:
Structured metadata describing an xAPI Touchpoint's argument count, positions, container forms, property names, detectable value types, and whether each value form is static or dynamic. It excludes literal values and dynamic identifier text, and Repeated xAPI Reference, Linked Macro xAPI Overlap, and Separate Macro xAPI Overlap do not use it when determining identity.
_Avoid_: Argument Value, Source Snippet, Duplicate Identity

**New-style xAPI Syntax**:
The object-oriented JSXAPI form preferred for readability, editor autocompletion, and generated Macro Editor snippets. Its use does not make equivalent Old-style xAPI Syntax invalid.
_Avoid_: Required Syntax, Only Supported Syntax

**Old-style xAPI Syntax**:
The function-and-path-string JSXAPI form that Cisco continues to support and permits alongside New-style xAPI Syntax. Its presence is source-style evidence, not a deprecation or compatibility failure.
_Avoid_: Deprecated xAPI Syntax, Unsupported Syntax

**CommonJS Module Syntax**:
The executable `require`, `module.*`, `exports.*`, `__filename`, or `__dirname` module form, distinct from Old-style xAPI Syntax. The Rule Pack unconditionally requires migration from CommonJS Module Syntax to ES module syntax regardless of endpoint configuration or present runtime support.
_Avoid_: Old-style xAPI Syntax, CommonJS Compatibility Failure

**CommonJS Migration Requirement**:
A Required Observed Finding produced whenever CommonJS Module Syntax appears in a macro. One Finding per macro consolidates every executable occurrence; comments that merely discuss CommonJS do not count. It enforces an unconditional source policy and does not assert that the current endpoint necessarily rejects the macro.
_Avoid_: Conditional CommonJS Warning, Runtime Failure

**Old-style xAPI Usage**:
A consolidated Advisory Observed Finding produced when a macro's xAPI Touchpoints use Old-style xAPI Syntax without any New-style xAPI Syntax. Old Style remains acceptable, while New Style is Preferred.
_Avoid_: Old-style Deprecation, Unsupported xAPI Usage

**Mixed xAPI Syntax**:
A consolidated Advisory Observed Finding that New-style xAPI Syntax and Old-style xAPI Syntax both appear within one macro. Both styles remain acceptable, while New Style is Preferred. New-style-only use remains neutral file metadata, and different files using different internally consistent styles do not create a cross-file Mixed xAPI Syntax Finding.
_Avoid_: Syntax Compatibility Warning, Deprecated Syntax Finding

**Authentication Vocabulary Match**:
A Warning Observed Finding produced when a Credential Vocabulary term appears anywhere in a Macro Set, including filenames, identifiers, property names, strings, template literals, or comments. One Finding per macro identifies every matching source occurrence and lists the exact submitted phrases that matched the vocabulary. The local interface shows the submitted source context without masking so the Macro Author can identify what to review; the exported Analysis Report still omits source excerpts and adjacent literal values. The Finding leaves security relevance to the Macro Author and does not establish that a secret or credential is present.
_Avoid_: Confirmed Secret, Credential Leak

**Credential Vocabulary**:
The categorized and versioned collection of normalized credential- and authorization-related terms used to produce Authentication Vocabulary Matches. Initial categories cover passwords (`password`, `passwd`, `pwd`, `passphrase`, `pin`), credentials and login names, access/refresh/identity/session/auth/bearer/JWT/PAT/SAS tokens, client/app/consumer/webhook secrets, API/access/secret/private/signing/encryption/SSH/HMAC/AES keys, authorization/authentication/basic/proxy terms, authorization and cookie headers, database URLs, connection strings, service accounts, and private-key markers. Matching is case-insensitive across camelCase, snake_case, kebab-case, and spaced word components, but does not use arbitrary substrings such as matching `token` inside `tokenizer`. The vocabulary belongs to the Rule Pack, and every match retains its category, canonical term, exact submitted term, and Source Reference.
_Avoid_: Hardcoded Credential Keywords, Secret Signature

**Repeated xAPI Reference**:
An Advisory Observed Finding that groups two or more non-subscription xAPI Touchpoints with the same Canonical xAPI Reference identity—API kind, normalized path, and operation—in one macro, regardless of their arguments, submitted xAPI syntax style, root binding name, or xAPI Binding Route. It asks the Macro Author to consider a shared local wrapper when that would improve maintenance; repetition alone does not imply a defect or Potential Risk. Repeated subscriptions use the dedicated Duplicate Subscription Registration signal instead.
_Avoid_: Duplicate API Warning, Duplicate API Error

**Subscription Registration**:
An xAPI Touchpoint whose operation registers a callback for a Configuration, Status, or Event path. Subscription analytics count every statically resolved registration and each unique API-kind-and-normalized-path identity across the complete analyzed Macro Set. These are source occurrences, not evidence that a handler registered or ran on an Endpoint.
_Avoid_: Active Subscription, Runtime Handler

**Duplicate Subscription Registration**:
An Advisory Observed Finding that identifies two or more Subscription Registrations with the same API kind and normalized path anywhere in the analyzed Macro Set, including separate macro files. It gives subscriptions a dedicated coordination signal rather than conflating them with repeated commands, reads, or writes. Multiple source registrations do not establish runtime duplication or prove that consolidation is safe.
_Avoid_: Duplicate Runtime Handler, Repeated Command

**Linked Macro xAPI Overlap**:
An Advisory Observed Finding that identifies the same Canonical xAPI Reference in two or more submitted macros that belong to one connected component of the supplied dependency graph. Dependency linkage is undirected and transitive for this coordination decision: imports establish that the files participate in one local macro system without implying runtime execution. The Finding asks whether a shared owner or wrapper would reduce maintenance.
_Avoid_: Proven Runtime Duplication, Required Consolidation

**Separate Macro xAPI Overlap**:
An Informational Observed Finding that identifies the same Canonical xAPI Reference across two or more disconnected components of the supplied dependency graph. It surfaces independent ownership that may need behavioral coordination, without implying that the references execute, conflict, or should share implementation.
_Avoid_: Cross-Macro Duplicate, Executed Redundant Call

**Schema Mismatch**:
A statically resolved xAPI path, parameter, or value that contradicts the pinned Schema Snapshot for the Declared Target. It is source-and-schema evidence of a Potential Risk, not proof of a runtime failure.
_Avoid_: Runtime Error, Incompatibility
