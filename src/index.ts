#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolResult,
  // Tool,
} from '@modelcontextprotocol/sdk/types.js';
import yaml from 'js-yaml';
import { OpenAPIV3 } from 'openapi-types';
import { z } from 'zod';

type OpenAPISpec = OpenAPIV3.Document;

type CallParameters = {
  path?: Record<string, string> | undefined;
  query?: Record<string, string> | undefined;
  body?: any | undefined;
}

class GologinMcpServer {
  private server: McpServer;
  private apiSpec: OpenAPISpec | null = null;
  private baseUrl: string = '';
  private token?: string | undefined;

  constructor(token?: string) {
    this.server = new McpServer(
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
    // this.setupHandlers();
  }

  private async setupHandlers(): Promise<void> {
    await this.loadApiSpec();
    // const tools: Tool[] = [];
    console.log('this.apiSpec', this.apiSpec);
    if (this.apiSpec && this.apiSpec.paths) {
      for (const [path, pathItem] of Object.entries(this.apiSpec.paths)) {
        if (!pathItem) continue;

        for (const [method, operation] of Object.entries(pathItem)) {
          if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method) && operation) {
            const op = operation as OpenAPIV3.OperationObject;
            const toolName = op.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;

            const inputSchema = this.buildInputSchema(op, path);
            this.server.registerTool(toolName, { title: toolName, description: op.summary || op.description || `${method.toUpperCase()} ${path}`, inputSchema }, (params: any) => {
              return this.callDynamicTool(toolName, params);
            });
            // tools.push({
            //   name: toolName,
            //   description: op.summary || op.description || `${method.toUpperCase()} ${path}`,
            //   inputSchema,
            // });
          }
        }
      }
    }

    // this.server.registerTool(tools);
    // this.server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
    //   const tools: Tool[] = [];
    //   if (this.apiSpec && this.apiSpec.paths) {
    //     for (const [path, pathItem] of Object.entries(this.apiSpec.paths)) {
    //       if (!pathItem) continue;

    //       for (const [method, operation] of Object.entries(pathItem)) {
    //         if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method) && operation) {
    //           const op = operation as OpenAPIV3.OperationObject;
    //           const toolName = op.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;

    //           const inputSchema = this.buildInputSchema(op, path);

    //           tools.push({
    //             name: toolName,
    //             description: op.summary || op.description || `${method.toUpperCase()} ${path}`,
    //             inputSchema,
    //           });
    //         }
    //       }
    //     }
    //   }

    //   return { tools };
    // });

    // this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    //   const { name, arguments: args } = request.params;

    //   if (!args) {
    //     throw new Error('No arguments provided');
    //   }

    //   try {
    //     const parameters: CallParameters = {
    //       path: args.path as Record<string, string> | undefined,
    //       query: args.query as Record<string, string> | undefined,
    //       body: args.body || (args.parameters ? args.parameters : undefined),
    //     };

    //     return await this.callDynamicTool(name, parameters, args.headers as Record<string, string> | undefined);
    //   } catch (error) {
    //     return {
    //       content: [
    //         {
    //           type: 'text',
    //           text: `Error: ${error instanceof Error ? error.message : String(error)}`,
    //         },
    //       ],
    //     };
    //   }
    // });
  }

  private async loadApiSpec(): Promise<void> {
    const url = 'https://docs-download.gologin.com/openapi-test.json';
    console.log('url', url);
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
    // console.log('spec', spec);
    this.apiSpec = spec;

    this.baseUrl = this.getBaseUrl(spec);
  }

  private buildInputSchema(operation: OpenAPIV3.OperationObject, path: string): any {
    const schemaObj: any = {};

    const pathParams = this.extractPathParameters(operation, path);
    const queryParams = this.extractQueryParameters(operation);
    const bodySchema = this.extractRequestBodySchema(operation);

    if (pathParams.properties && Object.keys(pathParams.properties).length > 0) {
      const pathZodObj: any = {};
      for (const [key, prop] of Object.entries(pathParams.properties)) {
        const zodSchema = this.convertToZodSchema(prop);
        pathZodObj[key] = pathParams.required.includes(key) ? zodSchema : zodSchema.optional();
      }
      schemaObj.path = z.object(pathZodObj);
    }

    if (queryParams.properties && Object.keys(queryParams.properties).length > 0) {
      const queryZodObj: any = {};
      for (const [key, prop] of Object.entries(queryParams.properties)) {
        const zodSchema = this.convertToZodSchema(prop);
        queryZodObj[key] = queryParams.required.includes(key) ? zodSchema : zodSchema.optional();
      }
      schemaObj.query = z.object(queryZodObj);
    }

    if (bodySchema) {
      schemaObj.body = this.convertJsonSchemaToZod(bodySchema);
    }

    return schemaObj;
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
          // Use full schema instead of just type to preserve enum
          properties[parameter.name] = parameter.schema || { type: 'string' };
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
          properties[parameter.name] = parameter.schema || { type: 'string' };
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

  private convertOpenAPISchemaToJsonSchema(schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject): any {
    if ('$ref' in schema) {
      return this.resolveReference(schema.$ref);
    }

    const schemaObj = schema as OpenAPIV3.SchemaObject;

    if (schemaObj.allOf) {
      const mergedSchema: any = {
        type: schemaObj.type || 'object',
      };

      if (schemaObj.description) {
        mergedSchema.description = schemaObj.description;
      }

      schemaObj.allOf.forEach(subSchema => {
        const resolvedSubSchema = this.convertOpenAPISchemaToJsonSchema(subSchema);

        if (resolvedSubSchema.properties) {
          if (!mergedSchema.properties) {
            mergedSchema.properties = {};
          }
          Object.entries(resolvedSubSchema.properties).forEach(([key, prop]) => {
            mergedSchema.properties[key] = this.convertOpenAPISchemaToJsonSchema(prop as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject);
          });
        }

        if (resolvedSubSchema.required) {
          if (!mergedSchema.required) {
            mergedSchema.required = [];
          }
          mergedSchema.required.push(...resolvedSubSchema.required.filter((req: string) => !mergedSchema.required.includes(req)));
        }

        if (!mergedSchema.type && resolvedSubSchema.type) {
          mergedSchema.type = resolvedSubSchema.type;
        }

        ['enum', 'format', 'minimum', 'maximum', 'pattern', 'items'].forEach(prop => {
          if (resolvedSubSchema[prop] && !mergedSchema[prop]) {
            mergedSchema[prop] = resolvedSubSchema[prop];
          }
        });
      });

      // Ensure required array is always present for object types
      if (!mergedSchema.required) {
        mergedSchema.required = [];
      }

      return mergedSchema;
    }

    const jsonSchema: any = {
      type: schemaObj.type || 'object',
    };

    if (schemaObj.properties) {
      jsonSchema.properties = {};
      Object.entries(schemaObj.properties).forEach(([key, prop]) => {
        jsonSchema.properties[key] = this.convertOpenAPISchemaToJsonSchema(prop);
      });
    }

    // Only add required field for object types
    if (jsonSchema.type === 'object') {
      if (schemaObj.required) {
        jsonSchema.required = schemaObj.required;
      } else {
        jsonSchema.required = [];
      }
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
    console.log('parameters', parameters.body);
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
          const generatedToolName = `${method}${path.replace('browser', 'profile').replace(/[^a-zA-Z0-9]/g, '_')}`;

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
      requestHeaders['Authorization'] = `${this.token}`;
    }

    if (parameters.path) {
      for (const [key, value] of Object.entries(parameters.path)) {
        url = url.replace(`{${key}}`, encodeURIComponent(value));
      }
    }

    const queryParams = new URLSearchParams();
    if (parameters.query) {
      for (const [key, value] of Object.entries(parameters.query)) {
        if (value) {
          queryParams.append(key, value);
        }
      }
    }

    if (queryParams.toString()) {
      url += `?${queryParams.toString()}`;
    }
    if (parameters.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(targetMethod)) {
      requestHeaders['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(parameters.body);
    }
    console.log('requestBody', requestBody);
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

  private convertToZodSchema(prop: any): any {
    let zodSchema: any;
    if (prop.enum && Array.isArray(prop.enum)) {
      zodSchema = z.enum(prop.enum as [string, ...string[]]);
    } else {
      switch (prop.type) {
        case 'string':
          zodSchema = z.string();
          break;
        case 'number':
          zodSchema = z.number();
          break;
        case 'integer':
          zodSchema = z.number().int();
          break;
        case 'boolean':
          zodSchema = z.boolean();
          break;
        case 'array':
          zodSchema = z.array(z.any());
          break;
        default:
          zodSchema = z.string();
      }
    }

    if (prop.description) {
      zodSchema = zodSchema.describe(prop.description);
    }

    return zodSchema;
  }

  private convertJsonSchemaToZod(schema: any): any {
    if (!schema || typeof schema !== 'object') {
      return z.any();
    }

    let zodSchema: any;

    if (schema.enum && Array.isArray(schema.enum)) {
      zodSchema = z.enum(schema.enum as [string, ...string[]]);
    } else {
      switch (schema.type) {
        case 'object':
          if (schema.properties) {
            const zodObj: any = {};
            const requiredFields = schema.required || [];
            for (const [key, prop] of Object.entries(schema.properties)) {
              let propSchema = this.convertJsonSchemaToZod(prop);
              // If the field is not in the required array, make it optional
              if (!requiredFields.includes(key)) {
                propSchema = propSchema.optional();
              }
              zodObj[key] = propSchema;
            }
            zodSchema = z.object(zodObj);
          } else {
            zodSchema = z.object({});
          }
          break;
        case 'array':
          zodSchema = z.array(schema.items ? this.convertJsonSchemaToZod(schema.items) : z.any());
          break;
        case 'string':
          zodSchema = z.string();
          break;
        case 'number':
          zodSchema = z.number();
          break;
        case 'integer':
          zodSchema = z.number().int();
          break;
        case 'boolean':
          zodSchema = z.boolean();
          break;
        default:
          zodSchema = z.any();
      }
    }

    if (schema.description) {
      zodSchema = zodSchema.describe(schema.description);
    }

    return zodSchema;
  }

  private getBaseUrl(spec: OpenAPISpec): string {
    if (spec.servers && spec.servers.length > 0) {
      return spec.servers[0].url;
    }

    throw new Error('No servers found in API spec');
  }

  public async run(): Promise<void> {
    await this.setupHandlers();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('GoLogin MCP server running on stdio');
  }
}

const token = process.env.API_TOKEN || '';
const server = new GologinMcpServer(token);
server.run().catch(console.error); 