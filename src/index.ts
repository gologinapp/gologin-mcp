import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  CallToolResult,
  ListToolsResult,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import yaml from 'js-yaml';
import { OpenAPIV3 } from 'openapi-types';

type OpenAPISpec = OpenAPIV3.Document;

type CallParameters = {
  path?: Record<string, string> | undefined;
  query?: Record<string, string> | undefined;
  body?: any | undefined;
}

class GologinMcpServer {
  private server: Server;
  private apiSpec: OpenAPISpec | null = null;
  private baseUrl: string = '';
  private token?: string | undefined;

  constructor(token?: string) {
    this.server = new Server(
      {
        name: 'gologin-mcp',
        version: '0.0.1',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.token = token;
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
      const tools: Tool[] = [];
      if (this.apiSpec && this.apiSpec.paths) {
        for (const [path, pathItem] of Object.entries(this.apiSpec.paths)) {
          if (!pathItem) continue;

          for (const [method, operation] of Object.entries(pathItem)) {
            if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method) && operation) {
              const op = operation as OpenAPIV3.OperationObject;
              const toolName = op.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;

              tools.push({
                name: toolName,
                description: op.summary || op.description || `${method.toUpperCase()} ${path}`,
                inputSchema: {
                  type: 'object',
                  properties: {
                    path: {
                      type: 'object',
                      description: 'Path parameters for URL substitution',
                    },
                    query: {
                      type: 'object',
                      description: 'Query parameters',
                    },
                    body: {
                      type: 'object',
                      description: 'Request body parameters',
                    },
                    headers: {
                      type: 'object',
                      description: 'Additional headers for the request',
                    },
                  },
                },
              });
            }
          }
        }
      }

      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      const { name, arguments: args } = request.params;

      if (!args) {
        throw new Error('No arguments provided');
      }

      try {
        const parameters: CallParameters = {
          path: args.path as Record<string, string> | undefined,
          query: args.query as Record<string, string> | undefined,
          body: args.body || (args.parameters ? args.parameters : undefined),
        };

        return await this.callDynamicTool(name, parameters, args.headers as Record<string, string> | undefined);
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    });
  }

  private async loadApiSpec(): Promise<void> {
    const url = 'https://docs-download.gologin.com/openapi.json';

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    let spec: any;

    if (contentType.includes('application/json')) {
      spec = await response.json();
    } else {
      const text = await response.text();
      try {
        spec = JSON.parse(text);
      } catch {
        spec = yaml.load(text);
      }
    }

    this.apiSpec = spec;
    this.baseUrl = this.getBaseUrl(spec);
  }

  private async callDynamicTool(
    toolName: string,
    parameters: CallParameters = {},
    headers: Record<string, string> = {}
  ): Promise<CallToolResult> {
    if (!this.apiSpec || !this.apiSpec.paths) {
      throw new Error('API specification not loaded');
    }

    let targetPath = '';
    let targetMethod = '';
    let operation: OpenAPIV3.OperationObject | undefined;

    for (const [path, pathItem] of Object.entries(this.apiSpec.paths)) {
      if (!pathItem) continue;

      for (const [method, op] of Object.entries(pathItem)) {
        if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method) && op) {
          const opObj = op as OpenAPIV3.OperationObject;
          const generatedToolName = opObj.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;

          if (generatedToolName === toolName) {
            targetPath = path;
            targetMethod = method.toUpperCase();
            operation = opObj;
            break;
          }
        }
      }
      if (operation) break;
    }

    if (!operation) {
      throw new Error(`Tool "${toolName}" not found`);
    }

    let url = `${this.baseUrl}${targetPath}`;
    const requestHeaders: Record<string, string> = { ...headers };
    let requestBody: string | undefined;

    requestHeaders['User-Agent'] = 'gologin-mcp';

    if (this.token) {
      requestHeaders['Authorization'] = `Bearer ${this.token}`;
    }

    if (parameters.path) {
      for (const [key, value] of Object.entries(parameters.path)) {
        url = url.replace(`{${key}}`, encodeURIComponent(value));
      }
    }

    const queryParams = new URLSearchParams();
    if (parameters.query) {
      for (const [key, value] of Object.entries(parameters.query)) {
        queryParams.append(key, value);
      }
    }

    if (queryParams.toString()) {
      url += `?${queryParams.toString()}`;
    }

    if (parameters.body && ['POST', 'PUT', 'PATCH'].includes(targetMethod)) {
      requestHeaders['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(parameters.body);
    }

    try {
      const fetchOptions: RequestInit = {
        method: targetMethod,
        headers: requestHeaders,
      };

      if (requestBody) {
        fetchOptions.body = requestBody;
      }

      const response = await fetch(url, fetchOptions);

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let responseBody: any;
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        try {
          responseBody = await response.json();
        } catch {
          responseBody = await response.text();
        }
      } else {
        responseBody = await response.text();
      }

      return {
        content: [
          {
            type: 'text',
            text: `API Call Result:\n` +
              `URL: ${url}\n` +
              `Method: ${targetMethod}\n` +
              `Status: ${response.status} ${response.statusText}\n\n` +
              `Response Headers:\n${JSON.stringify(responseHeaders, null, 2)}\n\n` +
              `Response Body:\n${typeof responseBody === 'object' ? JSON.stringify(responseBody, null, 2) : responseBody}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`API call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getBaseUrl(spec: OpenAPISpec): string {
    if (spec.servers && spec.servers.length > 0) {
      return spec.servers[0].url;
    }

    throw new Error('No servers found in API spec');
  }

  public async run(): Promise<void> {
    await this.loadApiSpec();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('GoLogin MCP server running on stdio');
  }
}

const token = process.env.API_TOKEN || '';
const server = new GologinMcpServer(token);
server.run().catch(console.error); 