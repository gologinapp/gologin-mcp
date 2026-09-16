# GoLogin MCP Server for AI Agents

[![npm version](https://img.shields.io/npm/v/gologin-mcp)](https://www.npmjs.com/package/gologin-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Manage GoLogin browser profiles, proxies, fingerprints, folders, and cloud browser sessions through AI conversations. This Model Context Protocol (MCP) server connects your AI client to the GoLogin API.

## Quickstart

You need Node.js 22 or newer, an active GoLogin account, and a GoLogin API token. Node.js 22 and 24 LTS have been tested on macOS Apple Silicon.

1. Sign in to your [GoLogin account](https://app.gologin.com/), open **API & MCP**, and generate a token in the **API** tab.
2. Add this configuration to your MCP client, replacing the token placeholder. Merge it into any existing `mcpServers` configuration.

```json
{
  "mcpServers": {
    "gologin-mcp": {
      "command": "npx",
      "args": ["-y", "gologin-mcp"],
      "env": {
        "API_TOKEN": "your-gologin-api-token-here"
      }
    }
  }
}
```

3. Restart or reload your client's MCP connection, then ask: **"Show me my GoLogin profiles."**

The client starts the server automatically. `-y` lets npm install the package without an interactive confirmation. This server reads `API_TOKEN`; the `GOLOGIN_TOKEN` variable used by other GoLogin CLIs is not an alias here.

For a terminal startup check, with `API_TOKEN` already set in your environment:

```bash
npx -y gologin-mcp
```

The server communicates over standard input/output (stdio) and waits for an MCP client. It does not open a browser or provide an interactive command prompt by itself.

## What You Can Do

- Create, read, update, delete, and organize browser profiles.
- Configure profile proxies and refresh browser fingerprints.
- Manage folders and their profile membership.
- Read account information.
- Start and stop browser profiles in the GoLogin cloud.

Cloud startup returns a connection URL. This server does not expose page navigation, click, form-filling, or local Orbita launch tools. For page automation, use a separate browser automation client or the [GoLogin Agent Browser CLI](https://github.com/GologinLabs/agent-browser).

The MCP process runs locally; GoLogin API requests and cloud browser sessions require network access. Cloud availability and API operations depend on your account permissions and plan.

## Tools

Tool names are generated from the HTTP method and path in the [GoLogin OpenAPI specification](https://docs-download.gologin.com/openapi-test.json), which the server loads at startup. The following is a selection of available tools, not a fixed list of aliases. Query `tools/list` in your MCP client for the current names and input schemas.

| Tool | Description |
| --- | --- |
| `get_profile_v2` | List and search profiles, with pagination and folder filters |
| `post_profile_custom` | Create a profile with partial settings such as name, OS, and proxy |
| `get_profile_id` | Read a profile by ID |
| `put_profile_id_custom` | Update selected profile settings |
| `delete_profile` | Delete the profiles listed in `profilesToDelete` |
| `patch_profile_proxy_many_v2` | Configure proxies for one or more profiles |
| `patch_profile_fingerprints` | Refresh fingerprints for the profiles listed in `browsersIds` |
| `get_proxy_v2` | List proxies |
| `get_folders` | List folders |
| `post_folders_folder` | Create a folder by name |
| `patch_folders_folder` | Add or remove profiles from a folder |
| `delete_folders_folder` | Delete a folder by name |
| `post_profile_id_web` | Start a profile in the cloud and return a connection URL |
| `delete_profile_id_web` | Stop a cloud profile |
| `get_user` | Read account information |

For example, an MCP client can send this `tools/call` request to read a profile:

```json
{
  "name": "get_profile_id",
  "arguments": {
    "id": "your-profile-id"
  }
}
```

Arguments follow each tool's input schema. Path and query parameters, and request body fields, are passed as top-level arguments.

## Example Prompts

- "Show me my GoLogin profiles."
- "Create a Linux profile named 'Research'."
- "Rename profile PROFILE_ID to 'Research US'."
- "Update profile PROFILE_ID to use these proxy settings."
- "Refresh the fingerprint for profile PROFILE_ID."
- "Create a folder named 'Research' and add profile PROFILE_ID to it."
- "Start profile PROFILE_ID in the cloud and give me the connection URL."
- "Stop the cloud session for profile PROFILE_ID."
- "Show my GoLogin account information."

## Setup for MCP Clients

### Claude Desktop

Open **Settings > Developer > Edit Config** and add the Quickstart configuration to `claude_desktop_config.json`. Fully quit and restart Claude Desktop, then check that `gologin-mcp` and its tools are available.

See the [official local MCP setup guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers) for configuration paths and troubleshooting.

### Cursor

Add the Quickstart configuration to `~/.cursor/mcp.json` for your user account, or `.cursor/mcp.json` for a project. Reload the MCP connection and enable the server's tools. Keep configurations containing API tokens out of version control.

See [Cursor's MCP documentation](https://cursor.com/docs/context/mcp) for current client settings.

### Other MCP Clients

Use a client that supports local stdio MCP servers. Configure `npx` as the command, `-y` and `gologin-mcp` as its arguments, and `API_TOKEN` in the server environment. The configuration format and location depend on the client.

## Troubleshooting

- **Server does not connect:** check that Node.js and `npx` are available to the client, then restart its MCP connection. The server also needs access to `docs-download.gologin.com` to load its tool definitions.
- **API returns `401 Unauthorized`:** check the `API_TOKEN` passed to the server and the token's validity in GoLogin. Restart the connection after changing it.
- **Tool name not found:** refresh the tool list and use the names returned by `tools/list`; names such as `list_profiles` and `start_browser` are not built-in aliases.
- **Cloud startup fails:** check the API response and your account's cloud access. Local MCP startup does not itself start Orbita on your computer.

## Development

```bash
git clone https://github.com/gologinapp/gologin-mcp.git
cd gologin-mcp
npm ci
npm run build
```

To run your local build with `API_TOKEN` already configured:

```bash
node dist/index.js
```

Before publishing, run:

```bash
npm run release:check
```

The package includes only the built server, package metadata, README, and license. The release check verifies this allowlist so local state, databases, credentials, and development files cannot be included as extra files. `npm publish` runs the same check automatically.

### MCP Registry Releases

`server.json` describes this server for the [official MCP Registry](https://registry.modelcontextprotocol.io/) under `io.github.gologinapp/gologin-mcp`. The npm package declares the same identifier in `mcpName`.

Keep the versions in `package.json`, `package-lock.json`, and `server.json` aligned. Publish the checked npm package first, then run **Publish to MCP Registry** from the repository's **Actions** tab on `main`. The workflow verifies that the npm release contains the correct Registry identifier and authenticates using GitHub OIDC, without a separate Registry token. It does not publish to npm.

## Links

- [GoLogin](https://gologin.com/)
- [GoLogin API documentation](https://gologin.com/docs/api-reference/introduction/quickstart)
- [npm package](https://www.npmjs.com/package/gologin-mcp)
- [Glama directory](https://glama.ai/mcp/servers/@gologinapp/gologin-mcp)

## License

[MIT](LICENSE), copyright GoLogin.
