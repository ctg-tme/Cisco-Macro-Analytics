# Keep analysis data local to the browser

Macro source and reports may contain credentials, internal addresses, proprietary automation logic, and deployment details. The Macro Analyzer will perform analysis in the user's browser and will not transmit Macro source, filenames, Declared Targets, report findings, Endpoint identity or address, or credentials to another service.

Product Telemetry is default-on when an Aptabase app key is configured and disabled when it is absent. Its event and property contract is closed rather than generic: it may record successful Endpoint connections, manual Macro loading, the number of Macros in a completed analysis, per-analysis counts of Macros containing ECMAScript import syntax, export syntax, or either form, and whether the analyzed Macro Set came from an Endpoint or manual loading. No other user-supplied or analysis-derived value is permitted.

The Aptabase SDK is version-pinned and bundled with the application, so executable dependencies and Schema Snapshots remain served from the application origin. The Content Security Policy permits event delivery only to Aptabase's US and EU ingestion origins in addition to the application's existing connections. This limits server-assisted analysis and third-party executable resources while making the remaining privacy boundary explicit and testable.
