# Cisco Macro Analyzer

Cisco Macro Analyzer is a browser-based tool for reviewing Cisco RoomOS
macros. It analyzes one or more JavaScript macro files locally and compares
their xAPI references with RoomOS schema snapshots whose fetched bytes are
verified against the local catalog.

[Open the live analyzer](https://ctg-tme.github.io/Cisco-Macro-Analytics/) ·
[View the project on GitHub](https://github.com/ctg-tme/Cisco-Macro-Analytics)

## What it does

- Maps macro imports, missing local dependencies, and external URL domains.
- Finds statically resolvable xAPI references and shows RoomOS version coverage.
- Reports subscription registrations, unique subscribed paths, and duplicate
  registrations separately from other repeated xAPI references.
- Highlights source, schema, syntax, security, and analysis-coverage findings.
- Reviews Android Container availability evidence where the RoomOS schemas
  provide it.
- Exports one canonical JSON analysis session containing every per-schema
  report, comparison, relationship, effective rule, and verified provenance
  record without including the original source code.

Macro source is analyzed in the browser and is not sent to an analysis service.
Results describe static source and schema evidence; they do not guarantee
runtime compatibility.

## License

This project is licensed under the
[Cisco Sample Code License, Version 1.1](LICENSE).
