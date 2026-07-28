# Use a read-only Endpoint connection as a Macro Set source

Selecting **Connect endpoint** opens a browser-local RoomOS JSXAPI session over
`wss://` using credentials entered in the connection dialog. After the socket is
ready, the session reads `Status SystemUnit BroadcastName` and performs one source
acquisition operation: `Macros Macro Get` with `Content: 'True'`. Returned macro
source becomes the in-memory Macro Set and is passed through the same Local
Analysis pipeline as manually supplied files. The connection does not run macros,
issue state-changing commands, or turn static findings into Runtime Evidence.

The JSXAPI dependency is version-pinned and bundled with the application. After
each successful socket connection, the normalized host address and device-reported
broadcast name are stored in a most-recently-used browser list limited to five
unique hosts. This list provides address-only quick selection on later connection
attempts. Usernames and passwords are not stored in application state or browser
storage, and the password form value is cleared after each connection attempt.
Macro source and reports remain in the browser and are not sent to an analysis
service.

While an Endpoint session is active, manual browse, drop, example, and clear
controls are unavailable so source origins cannot be mixed accidentally.
Disconnecting closes the socket, clears Endpoint-derived source and results from
memory, and restores the manual Macro Set controls. Retrieving endpoint macros and
uploading local files both open the Macro list for inclusion review; neither action
starts analysis. Every newly retrieved or uploaded macro is included by default.
Unchecked macros are excluded from the submitted Macro Set before parsing,
dependency resolution, Findings, counts, and export; imports that target them are
therefore Missing Dependencies. Entry Macros are inferred from the included
source graph. The shared Macro list provides Include all and Exclude all controls
before the Macro Author explicitly begins analysis.
