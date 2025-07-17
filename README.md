# GoLogin MCP Server

Manage your GoLogin browser profiles and automation directly through AI conversations. This MCP server connects to the GoLogin API, letting you create, configure, and control browser profiles using natural language.

<a href="https://glama.ai/mcp/servers/@gologinapp/gologin-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@gologinapp/gologin-mcp/badge" alt="GoLogin MCP server" />
</a>

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

**How to connect Gologin MCP with Claude Desktop:**
   
   

Step 1: Access Claude Desktop settings
Open your Claude Desktop application. In the top menu bar, click on 'Claude' and then select 'Settings...'.

<img width="380" height="200" src='https://images.gologin.com/claude-1.png' />

Step 2: Navigate to developer settings
In the Settings window, on the left sidebar, click on 'Developer'. This section manages connections via the Model Context Protocol. Click the 'Edit Config' button to open the configuration file.

<img width="380" height="200" src='https://images.gologin.com/claude-2.png' />

Step 3: Locate claude_desktop_config.json
This action will open the claude_desktop_config.json file in your default text editor. This file is where you configure your MCP servers.

<img width="380" height="200" src='https://images.gologin.com/claude-3.png' />

Step 4: Add Gologin MCP configuration
You need to add the GoLogin MCP server configuration details within the mcpservers object. Carefully paste the following JSON snippet into your claude_desktop_config.json file.
Important: Replace 'your-gologin-api-token-here' with your actual GoLogin API token. Ensure the JSON structure remains correct after pasting.

<img width="380" height="200" src='https://images.gologin.com/claude-4.png' />
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




Step 5: Verify connection in connectors
After saving the claude_desktop_config.json file, it is recommended to restart Claude Desktop to ensure the new configuration is loaded.
Once Claude restarts, navigate back to its 'Settings'. Under the 'Connectors' section (which might be under 'General' or 'Extensions' depending on your Claude version), you should now see 'gologin-mcp LOCAL' listed as a connected service. This indicates a successful integration.

<img width="380" height="200" src='https://images.gologin.com/claude-5.png' />

Congratulations! You have successfully connected GoLogin MCP with Claude Desktop. Your AI assistant can now leverage Gologin profiles for various tasks.


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