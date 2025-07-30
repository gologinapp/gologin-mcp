#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolResult,
  ListToolsRequestSchema,
  CallToolRequestSchema,
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
    // this.setupHandlers();
  }

  private async setupHandlers(): Promise<void> {
    await this.loadApiSpec();

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = [];
      if (this.apiSpec && this.apiSpec.paths) {
        for (const [path, pathItem] of Object.entries(this.apiSpec.paths)) {
          if (!pathItem) continue;

          for (const [method, operation] of Object.entries(pathItem)) {
            if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method) && operation) {
              const op = operation as OpenAPIV3.OperationObject;
              const toolName = `${method}${path.replace('browser', 'profile').replace(/[^a-zA-Z0-9]/g, '_')}`;

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

    this.server.setRequestHandler(CallToolRequestSchema, async (request: any): Promise<CallToolResult> => {
      const { name, arguments: args } = request.params;

      if (!args) {
        throw new Error('No arguments provided');
      }
      console.log('args', args);
      try {
        const parameters: CallParameters = this.extractParametersFromArgs(name, args);
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

  private extractParametersFromArgs(toolName: string, args: Record<string, any>): CallParameters {
    if (!this.apiSpec || !this.apiSpec.paths) {
      return { body: args };
    }

    let operation: OpenAPIV3.OperationObject | undefined;
    let path = '';

    for (const [apiPath, pathItem] of Object.entries(this.apiSpec.paths)) {
      if (!pathItem) continue;

      for (const [method, op] of Object.entries(pathItem)) {
        if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method) && op) {
          const opObj = op as OpenAPIV3.OperationObject;
          const generatedToolName = opObj.operationId || `${method}_${apiPath.replace(/[^a-zA-Z0-9]/g, '_')}`;

          if (generatedToolName === toolName) {
            operation = opObj;
            path = apiPath;
            break;
          }
        }
      }
      if (operation) break;
    }

    if (!operation) {
      return { body: args };
    }

    const pathParams: Record<string, string> = {};
    const queryParams: Record<string, string> = {};
    const bodyParams: any = {};

    const pathParamNames = path.match(/\{([^}]+)\}/g)?.map(p => p.slice(1, -1)) || [];

    if (operation.parameters) {
      operation.parameters.forEach(param => {
        if ('$ref' in param) return;

        const parameter = param as OpenAPIV3.ParameterObject;
        const paramName = parameter.name;

        if (parameter.in === 'path' && args[paramName] !== undefined) {
          pathParams[paramName] = String(args[paramName]);
        } else if (parameter.in === 'query' && args[paramName] !== undefined) {
          queryParams[paramName] = String(args[paramName]);
        }
      });
    }

    pathParamNames.forEach(paramName => {
      if (args[paramName] !== undefined && !pathParams[paramName]) {
        pathParams[paramName] = String(args[paramName]);
      }
    });

    const usedParams = new Set([...Object.keys(pathParams), ...Object.keys(queryParams)]);
    for (const [key, value] of Object.entries(args)) {
      if (!usedParams.has(key)) {
        bodyParams[key] = value;
      }
    }

    const parameters: CallParameters = {};

    if (Object.keys(pathParams).length > 0) {
      parameters.path = pathParams;
    }

    if (Object.keys(queryParams).length > 0) {
      parameters.query = queryParams;
    }

    if (Object.keys(bodyParams).length > 0) {
      parameters.body = bodyParams;
    }

    return parameters;
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
    const properties: any = {};
    const required: string[] = [];

    const pathParams = this.extractPathParameters(operation, path);
    const queryParams = this.extractQueryParameters(operation);
    const bodySchema = this.extractRequestBodySchema(operation);

    if (pathParams.properties && Object.keys(pathParams.properties).length > 0) {
      for (const [key, prop] of Object.entries(pathParams.properties)) {
        properties[key] = this.convertOpenAPISchemaToJsonSchema(prop as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject);
        if (pathParams.required.includes(key)) {
          required.push(key);
        }
      }
    }

    if (queryParams.properties && Object.keys(queryParams.properties).length > 0) {
      for (const [key, prop] of Object.entries(queryParams.properties)) {
        properties[key] = this.convertOpenAPISchemaToJsonSchema(prop as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject);
        if (queryParams.required.includes(key)) {
          required.push(key);
        }
      }
    }

    if (bodySchema && bodySchema.properties) {
      for (const [key, prop] of Object.entries(bodySchema.properties)) {
        properties[key] = this.convertOpenAPISchemaToJsonSchema(prop as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject);
        if (bodySchema.required && bodySchema.required.includes(key)) {
          required.push(key);
        }
      }
    }

    const schema: any = {
      type: 'object',
      properties,
    };

    if (required.length > 0) {
      schema.required = required;
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
    console.error('this.token', this.token);
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
      console.error('fetchOptions', fetchOptions);
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
    await this.setupHandlers();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('GoLogin MCP server running on stdio111');
  }
}

const token = process.env.API_TOKEN || '';
console.log('token', token);
const server = new GologinMcpServer(token);
server.run().catch(console.error); 