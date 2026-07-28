# Source schemas from the RoomOS repository

The Schema Catalog is synchronized from the `schemas` directory of the public
[`cisco-ce/roomos.cisco.com`](https://github.com/cisco-ce/roomos.cisco.com)
repository during local development and production builds. The previous scheduled
workflow that queried `roomos.cisco.com/api/schema` and committed its response is
removed because that API returned a stale sample manifest. The sync validates each
download before replacing local evidence and falls back to the local last-known-good
schemas when development is offline; production builds use strict mode.

Catalog presentation classifies a snapshot as Cloud when its upstream schema name
contains a calendar month. A name without a month is classified as On-premises.
This rule preserves the distinction encoded by the upstream repository without
guessing from release numbers.
