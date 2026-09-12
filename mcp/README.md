# RetainPDF MCP bridge

`retainpdf_mcp.py` exposes the local RetainPDF desktop HTTP API over stdio MCP.
The server reads its connection and provider credentials from the ignored
`secrets/retainpdf-mcp.json` file.

The MCP targets the locally installed desktop application's Rust API:

- Rust API: http://127.0.0.1:41000
- Simple multipart API: http://127.0.0.1:42000
- Authentication: the desktop app's local `X-API-Key`

The desktop application must be running before using this MCP. The bridge uses
the same task, document-library, glossary, artifact, and reader endpoints as
the desktop UI, so both clients operate on the same local data.

- Provider credentials remain in `secrets/retainpdf-mcp.json`; they are used only when MCP creates a job or sends a reader AI request.
- Do not copy desktop credentials into source-controlled files.
- The MCP command used by Proma is configured in each workspace's `mcp.json`.
