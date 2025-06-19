# GoLogin MCP Server

Manage your GoLogin browser profiles and automation directly through AI conversations. This MCP server connects to the GoLogin API, letting you create, configure, and control browser profiles using natural language.

## What You Can Do

With GoLogin MCP Server, you can:

- **Manage browser profiles** - Create, update, delete, and list your browser profiles
- **Configure proxies** - Set up and modify proxy settings for your profiles
- **Handle fingerprints** - Customize browser fingerprints and user agents
- **Manage folders** - Organize your profiles into folders
- **Account information** - Check your subscription status and usage

### Example Use Cases

- "Create a new browser profile with a US proxy"
- "Show me all my browser profiles"
- "Update the proxy settings for my profile"
- "Delete old profiles I no longer need"
- "Check my GoLogin account status"
- "Create a folder to organize my profiles"

## Setup for MCP Clients

### Claude Desktop

1. **Add to Claude Desktop configuration:**
   
   Open your Claude Desktop config file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

   Add the server configuration:
   ```json
   {
     "mcpServers": {
       "gologin-mcp": {
         "command": "npx",
         "args": ["gologin-mcp"],
         "env": {
           "API_TOKEN": "your-gologin-api-token-here"
         }
       }
     }
   }
   ```

2. **Restart Claude Desktop** and the server will be available.

### Cursor

1. **Configure in Cursor:**
   
   Add to your Cursor MCP configuration:
   ```json
   {
     "mcpServers": {
       "gologin-mcp": {
         "command": "npx",
         "args": ["gologin-mcp"],
         "env": {
           "API_TOKEN": "your-gologin-api-token-here"
         }
       }
     }
   }
   ```

### Other MCP Clients

For other MCP-compatible clients, use the same configuration pattern with the appropriate config file location for your client.

## Getting Your API Token

1. Log in to your [GoLogin account](https://app.gologin.com/)
2. Go to API settings
3. Generate or copy your API token
4. Use this token in the configuration above

## Example Workflow

1. **Check your account:**
   "What's my GoLogin account status?"

2. **Create a profile:**
   "Create a new browser profile with Chrome browser and a US proxy"

3. **Manage profiles:**
   "Show me all my profiles"
   "Update the proxy for profile ID 123 to use a UK proxy"
   "Delete the profile named 'test-profile'"

4. **Organize profiles:**
   "Create a folder called 'Social Media Accounts'"
   "Move profile XYZ to the Social Media Accounts folder"

5. **Control browsers:**
   "Start a browser session for my profile"
   "Stop all running browser sessions"

## Requirements

- Node.js 18 or higher
- Valid GoLogin API token
- Active GoLogin account