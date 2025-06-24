#!/usr/bin/env node

import { spawn } from 'child_process';

class MCPTestClient {
  constructor() {
    this.requestId = 1;
    this.server = null;
  }

  async startServer() {
    console.log('Starting MCP server...');

    this.server = spawn('node', ['dist/index.js'], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, API_TOKEN: process.env.API_TOKEN || '' }
    });

    this.server.on('error', (err) => {
      console.error('Server error:', err);
    });

    this.server.on('exit', (code) => {
      console.log(`Server exited with code ${code}`);
    });

    return new Promise((resolve) => {
      setTimeout(() => {
        console.log('Server should be ready now');
        resolve();
      }, 2000);
    });
  }

  sendRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const request = {
        jsonrpc: '2.0',
        id: this.requestId++,
        method: method,
        params: params
      };

      const requestStr = JSON.stringify(request) + '\n';
      // console.log('\n📤 Sending request:', JSON.stringify(request, null, 2));

      let responseBuffer = '';

      const onData = (data) => {
        responseBuffer += data.toString();

        const lines = responseBuffer.split('\n');
        responseBuffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line);
              // console.log('📥 Received response:', JSON.stringify(response, null, 2));

              if (response.id === request.id) {
                this.server.stdout.off('data', onData);
                resolve(response);
                return;
              }
            } catch (e) {
              console.log('📄 Server log:', line);
            }
          }
        }
      };

      this.server.stdout.on('data', onData);

      setTimeout(() => {
        this.server.stdout.off('data', onData);
        reject(new Error('Request timeout'));
      }, 10000);

      this.server.stdin.write(requestStr);
    });
  }

  async testListTools() {
    console.log('\n🔧 Testing tools/list...');
    try {
      const response = await this.sendRequest('tools/list');
      console.log(`✅ Found ${response.result?.tools?.length || 0} tools`);
      return response.result?.tools || [];
    } catch (error) {
      console.error('❌ Error testing tools/list:', error.message);
      return [];
    }
  }

  async testCallTool(toolName, args = {}) {
    console.log(`\n🚀 Testing tools/call with ${toolName}...`);
    try {
      const response = await this.sendRequest('tools/call', {
        name: toolName,
        arguments: args
      });
      console.log('✅ Tool call successful');
      return response.result;
    } catch (error) {
      console.error(`❌ Error testing tools/call for ${toolName}:`, error.message);
      return null;
    }
  }

  async runTests() {
    try {
      await this.startServer();

      const tools = await this.testListTools();

      if (tools.length > 0) {
        console.log('\n📋 Available tools:');
        tools.slice(0, 5).forEach((tool, index) => {
          // console.log(`${index + 1}. ${tool.name}: ${tool.description}`);
        });

        const firstTool = tools.find(tool => tool.name === 'BrowserController_quickAddBrowser');
        // console.log('firstTool', firstTool.inputSchema);
        if (firstTool) {
          // console.log(`\n🎯 Testing first tool: ${firstTool.name}`);

          const sampleArgs = this.generateSampleArgs(firstTool);
          await this.testCallTool(firstTool.name, sampleArgs);
        }
      }

    } catch (error) {
      console.error('Test failed:', error);
    } finally {
      this.cleanup();
    }
  }

  generateSampleArgs(tool) {
    const args = {};

    if (tool.inputSchema?.properties) {
      // console.error('tool.inputSchema', tool.inputSchema);
      Object.entries(tool.inputSchema.properties).forEach(([key, prop]) => {
        if (key === 'headers') {
          args[key] = { 'Content-Type': 'application/json' };
        } else if (key === 'path') {
          args[key] = { id: 'test-id' };
        } else if (key === 'query') {
          args[key] = { page: 1 };
        } else if (key === 'body') {
          args[key] = { test: true };
        }
      });
    }

    return args;
  }

  cleanup() {
    if (this.server) {
      console.log('\n🧹 Cleaning up...');
      this.server.kill();
      this.server = null;
    }
  }
}

const client = new MCPTestClient();

process.on('SIGINT', () => {
  console.log('\n👋 Interrupted, cleaning up...');
  client.cleanup();
  process.exit(0);
});

client.runTests().then(() => {
  console.log('\n✨ Tests completed');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
}); 