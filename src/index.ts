#!/usr/bin/env node
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

              const inputSchema = this.buildInputSchema(op, path);

              tools.push({
                name: toolName,
                description: op.summary || op.description || `${method.toUpperCase()} ${path}`,
                inputSchema,
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

  private buildInputSchema(operation: OpenAPIV3.OperationObject, path: string): any {
    const schema: any = {
      type: 'object',
      properties: {},
      required: [],
    };

    const pathParams = this.extractPathParameters(operation, path);
    const queryParams = this.extractQueryParameters(operation);
    const bodySchema = this.extractRequestBodySchema(operation);
    const requiredHeaders = this.extractRequiredHeaders(operation);

    if (pathParams.properties && Object.keys(pathParams.properties).length > 0) {
      schema.properties.path = {
        type: 'object',
        properties: pathParams.properties,
        description: 'Path parameters for URL substitution',
      };
      if (pathParams.required.length > 0) {
        schema.properties.path.required = pathParams.required;
        schema.required.push('path');
      }
    }

    if (queryParams.properties && Object.keys(queryParams.properties).length > 0) {
      schema.properties.query = {
        type: 'object',
        properties: queryParams.properties,
        description: 'Query parameters',
      };
      if (queryParams.required.length > 0) {
        schema.properties.query.required = queryParams.required;
        if (queryParams.required.length === Object.keys(queryParams.properties).length) {
          schema.required.push('query');
        }
      }
    }

    if (bodySchema) {
      schema.properties.body = {
        ...bodySchema,
        description: 'Request body parameters',
      };
      schema.required.push('body');
    }

    if (requiredHeaders.length > 0) {
      schema.properties.headers = {
        type: 'object',
        properties: {},
        required: requiredHeaders,
        description: 'Additional headers for the request',
      };
      schema.required.push('headers');
    } else {
      schema.properties.headers = {
        type: 'object',
        description: 'Additional headers for the request',
      };
    }

    return schema;
  }

  private extractPathParameters(operation: OpenAPIV3.OperationObject, path: string): { properties: any; required: string[] } {
    const properties: any = {};
    const required: string[] = [];

    const pathParamNames = path.match(/\{([^}]+)\}/g)?.map(p => p.slice(1, -1)) || [];

    if (operation.parameters) {
      operation.parameters.forEach(param => {
        if ('$ref' in param) return;

        const parameter = param as OpenAPIV3.ParameterObject;
        if (parameter.in === 'path') {
          properties[parameter.name] = {
            type: parameter.schema ? this.getSchemaType(parameter.schema) : 'string',
            description: parameter.description || '',
          };
          if (parameter.required) {
            required.push(parameter.name);
          }
        }
      });
    }

    pathParamNames.forEach(paramName => {
      if (!properties[paramName]) {
        properties[paramName] = {
          type: 'string',
          description: `Path parameter: ${paramName}`,
        };
        required.push(paramName);
      }
    });

    return { properties, required };
  }

  private extractQueryParameters(operation: OpenAPIV3.OperationObject): { properties: any; required: string[] } {
    const properties: any = {};
    const required: string[] = [];

    if (operation.parameters) {
      operation.parameters.forEach(param => {
        if ('$ref' in param) return;

        const parameter = param as OpenAPIV3.ParameterObject;
        if (parameter.in === 'query') {
          properties[parameter.name] = {
            type: parameter.schema ? this.getSchemaType(parameter.schema) : 'string',
            description: parameter.description || '',
          };
          if (parameter.required) {
            required.push(parameter.name);
          }
        }
      });
    }

    return { properties, required };
  }

  private extractRequestBodySchema(operation: OpenAPIV3.OperationObject): any | null {
    if (!operation.requestBody || '$ref' in operation.requestBody) {
      return null;
    }

    const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject;
    if (!requestBody.content) {
      return null;
    }

    const jsonContent = requestBody.content['application/json'];
    if (!jsonContent || !jsonContent.schema) {
      return null;
    }

    return this.convertOpenAPISchemaToJsonSchema(jsonContent.schema);
  }

  private extractRequiredHeaders(operation: OpenAPIV3.OperationObject): string[] {
    const required: string[] = [];

    if (operation.parameters) {
      operation.parameters.forEach(param => {
        if ('$ref' in param) return;

        const parameter = param as OpenAPIV3.ParameterObject;
        if (parameter.in === 'header' && parameter.required) {
          required.push(parameter.name);
        }
      });
    }

    return required;
  }

  private getSchemaType(schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject): string {
    if ('$ref' in schema) {
      const resolved = this.resolveReference(schema.$ref);
      return resolved.type || 'object';
    }

    const schemaObj = schema as OpenAPIV3.SchemaObject;
    return schemaObj.type || 'string';
  }

  private convertOpenAPISchemaToJsonSchema(schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject): any {
    if ('$ref' in schema) {
      return this.resolveReference(schema.$ref);
    }

    const schemaObj = schema as OpenAPIV3.SchemaObject;
    const jsonSchema: any = {
      type: schemaObj.type || 'object',
    };

    if (schemaObj.properties) {
      jsonSchema.properties = {};
      Object.entries(schemaObj.properties).forEach(([key, prop]) => {
        jsonSchema.properties[key] = this.convertOpenAPISchemaToJsonSchema(prop);
      });
    }

    if (schemaObj.required) {
      jsonSchema.required = schemaObj.required;
    }

    if (schemaObj.description) {
      jsonSchema.description = schemaObj.description;
    }

    if (schemaObj.type === 'array' && 'items' in schemaObj && schemaObj.items) {
      jsonSchema.items = this.convertOpenAPISchemaToJsonSchema(schemaObj.items);
    }

    if (schemaObj.enum) {
      jsonSchema.enum = schemaObj.enum;
    }

    if (schemaObj.format) {
      jsonSchema.format = schemaObj.format;
    }

    if (schemaObj.minimum !== undefined) {
      jsonSchema.minimum = schemaObj.minimum;
    }

    if (schemaObj.maximum !== undefined) {
      jsonSchema.maximum = schemaObj.maximum;
    }

    if (schemaObj.pattern) {
      jsonSchema.pattern = schemaObj.pattern;
    }

    return jsonSchema;
  }

  private resolveReference(ref: string): any {
    if (!this.apiSpec) {
      return { type: 'object' };
    }

    const parts = ref.split('/');
    if (parts[0] !== '#') {
      return { type: 'object' };
    }

    let current: any = this.apiSpec;
    for (let i = 1; i < parts.length; i++) {
      if (!current || typeof current !== 'object') {
        return { type: 'object' };
      }
      current = current[parts[i]];
    }

    if (!current) {
      return { type: 'object' };
    }

    return this.convertOpenAPISchemaToJsonSchema(current);
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