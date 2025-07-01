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

      // Add batch operations tool
      tools.push({
        name: 'batch_operations',
        description: 'Execute multiple API operations in batch. Supports creating multiple profiles, updating multiple proxies, etc.',
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['create_profiles'],
              description: 'The type of batch operation to perform'
            },
            count: {
              type: 'number',
              description: 'Number of operations to perform (for create/clone operations)',
              minimum: 1,
              maximum: 50
            },
            template: {
              type: 'object',
              description: 'Template parameters to use for each operation (for create operations)'
            },
            profileIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of profile IDs (for update/delete operations)'
            },
            updates: {
              type: 'object',
              description: 'Updates to apply to each item (for update operations)'
            },
            namePrefix: {
              type: 'string',
              description: 'Prefix for generated names (optional, defaults to "Profile")'
            }
          },
          required: ['operation']
        }
      });

      if (this.apiSpec && this.apiSpec.paths) {
        for (const [path, pathItem] of Object.entries(this.apiSpec.paths)) {
          if (!pathItem) continue;

          for (const [method, operation] of Object.entries(pathItem)) {
            if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method) && operation) {
              const op = operation as OpenAPIV3.OperationObject;

              let toolName = op.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;
              if (op.summary) {
                // Convert summary to a valid tool name (replace non-alphanumeric with underscores, remove spaces)
                toolName = op.summary.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').toLowerCase();
              }

              // Exclude specific tools
              const excludedTools = [
                'create_profile',
                'create_profile_with_partial_parameters',
              ];

              if (excludedTools.includes(toolName)) {
                continue;
              }

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
        // Handle batch operations tool
        if (name === 'batch_operations') {
          return await this.handleBatchOperations(args);
        }

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

  private validateParameters(
    operation: OpenAPIV3.OperationObject,
    path: string,
    parameters: CallParameters,
    headers: Record<string, string>
  ): string[] {
    const errors: string[] = [];

    // Validate path parameters
    const pathParams = this.extractPathParameters(operation, path);
    if (pathParams.required.length > 0) {
      if (!parameters.path) {
        errors.push(`Missing required path parameters: ${pathParams.required.join(', ')}`);
      } else {
        for (const requiredParam of pathParams.required) {
          if (!parameters.path[requiredParam]) {
            errors.push(`Missing required path parameter: ${requiredParam}`);
          }
        }
      }
    }

    const queryParams = this.extractQueryParameters(operation);
    if (queryParams.required.length > 0) {
      if (!parameters.query) {
        errors.push(`Missing required query parameters: ${queryParams.required.join(', ')}`);
      } else {
        for (const requiredParam of queryParams.required) {
          if (!parameters.query[requiredParam]) {
            errors.push(`Missing required query parameter: ${requiredParam}`);
          }
        }
      }
    }

    const bodySchema = this.extractRequestBodySchema(operation);
    if (bodySchema && !parameters.body) {
      errors.push('Missing required request body');
    }

    const requiredHeaders = this.extractRequiredHeaders(operation);
    for (const requiredHeader of requiredHeaders) {
      if (!headers[requiredHeader] && !headers[requiredHeader.toLowerCase()]) {
        errors.push(`Missing required header: ${requiredHeader}`);
      }
    }

    if (operation.parameters) {
      operation.parameters.forEach(param => {
        if ('$ref' in param) return;

        const parameter = param as OpenAPIV3.ParameterObject;
        let value: any;

        if (parameter.in === 'path' && parameters.path) {
          value = parameters.path[parameter.name];
        } else if (parameter.in === 'query' && parameters.query) {
          value = parameters.query[parameter.name];
        } else if (parameter.in === 'header') {
          value = headers[parameter.name] || headers[parameter.name.toLowerCase()];
        }

        if (value !== undefined && parameter.schema) {
          const validationError = this.validateParameterValue(parameter.name, value, parameter.schema, parameter.in);
          if (validationError) {
            errors.push(validationError);
          }
        }
      });
    }

    return errors;
  }

  private validateParameterValue(
    paramName: string,
    value: any,
    schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
    paramIn: string
  ): string | null {
    if ('$ref' in schema) {
      const resolved = this.resolveReference(schema.$ref);
      return this.validateParameterValue(paramName, value, resolved, paramIn);
    }

    const schemaObj = schema as OpenAPIV3.SchemaObject;

    if (schemaObj.enum && !schemaObj.enum.includes(value)) {
      return `Invalid value for ${paramIn} parameter '${paramName}': '${value}'. Must be one of: ${schemaObj.enum.join(', ')}`;
    }

    if (schemaObj.type) {
      const expectedType = schemaObj.type;
      const actualType = typeof value;

      if (expectedType === 'number' && actualType !== 'number') {
        if (isNaN(Number(value))) {
          return `Invalid type for ${paramIn} parameter '${paramName}': expected number, got ${actualType}`;
        }
      } else if (expectedType === 'boolean' && actualType !== 'boolean') {
        if (value !== 'true' && value !== 'false') {
          return `Invalid type for ${paramIn} parameter '${paramName}': expected boolean, got ${actualType}`;
        }
      } else if (expectedType === 'string' && actualType !== 'string') {
        return `Invalid type for ${paramIn} parameter '${paramName}': expected string, got ${actualType}`;
      }
    }

    return null;
  }

  private async handleBatchOperations(args: any): Promise<CallToolResult> {
    const { operation, count, template, profileIds, namePrefix } = args;

    const operationId = `${operation}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = new Date().toISOString();

    const results: any[] = [];
    const errors: string[] = [];

    try {
      switch (operation) {
        case 'create_profiles':
          if (!count || count < 1) {
            throw new Error('Count must be provided and greater than 0 for create_profiles operation');
          }

          for (let i = 0; i < count; i++) {
            try {
              const profileName = `${namePrefix || 'Profile'} ${i + 1}`;
              const profileData = {
                ...template,
                name: profileName,
              };

              const result = await this.callDynamicTool('create_profile_with_templates', {
                body: profileData
              });

              const profileResult = JSON.parse(result.content[0].text as string);
              results.push({
                index: i + 1,
                name: profileName,
                status: 'created',
                profileId: profileResult.body?.id || 'unknown',
                result: profileResult
              });
            } catch (error) {
              errors.push(`Profile ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          break;
        default:
          throw new Error(`Unsupported batch operation: ${operation}`);
      }

      const isSuccess = results.length > 0 && errors.length === 0;
      const isPartialSuccess = results.length > 0 && errors.length > 0;

      let status = 'SUCCESS';
      let message = '';

      if (isSuccess) {
        status = 'SUCCESS';
        message = `✅ Successfully completed ${operation}: ${results.length}/${operation === 'create_profiles' ? count : profileIds?.length || 0} operations succeeded`;
      } else if (isPartialSuccess) {
        status = 'PARTIAL_SUCCESS';
        message = `⚠️ Partially completed ${operation}: ${results.length}/${operation === 'create_profiles' ? count : profileIds?.length || 0} operations succeeded, ${errors.length} failed`;
      } else {
        status = 'FAILED';
        message = `❌ Failed ${operation}: All operations failed`;
      }

      const summary = {
        status,
        message,
        operationId,
        operation,
        startTime,
        endTime: new Date().toISOString(),
        totalOperations: operation === 'create_profiles' ? count : profileIds?.length || 0,
        successful: results.length,
        failed: errors.length,
        completed: true,
        results,
        errors: errors.length > 0 ? errors : undefined
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };

    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'FAILED',
              message: `❌ Batch operation failed: ${error instanceof Error ? error.message : String(error)}`,
              operationId,
              operation,
              startTime,
              endTime: new Date().toISOString(),
              completed: false,
              error: 'Batch operation failed',
              errorDetails: error instanceof Error ? error.message : String(error),
              results,
              errors
            }, null, 2),
          },
        ],
      };
    }
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

          // Use the same tool name generation logic as in setupHandlers
          let generatedToolName = opObj.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;
          if (opObj.summary) {
            generatedToolName = opObj.summary.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').toLowerCase();
          }

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

    // Validate parameters against OpenAPI spec
    const validationErrors = this.validateParameters(operation, targetPath, parameters, headers);
    if (validationErrors.length > 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Parameter validation failed',
              details: validationErrors
            }, null, 2),
          },
        ],
      };
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

      const result = {
        url: url,
        method: targetMethod,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseBody
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
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