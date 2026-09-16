import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { executeCanonicalCall, checkPermissions } from './tools/backend.js';
import { toolResultToMcpContent } from './tools/mcp-content.js';
import { ToolCall } from './tools/types.js';

const server = new Server({ name: 'computer-use', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'computer_action',
        description: 'Execute a computer action (click, type, screenshot, etc). The sidecar manages the OS.',
        inputSchema: {
          type: 'object',
          properties: {
            member: {
              type: 'string',
              enum: ['screenshot', 'zoom', 'left_click', 'right_click', 'middle_click', 'double_click', 'triple_click', 'left_click_drag', 'mouse_move', 'left_mouse_down', 'left_mouse_up', 'cursor_position', 'scroll', 'type', 'key', 'hold_key', 'wait']
            },
            input: {
              type: 'object',
              description: 'The arguments for the action.'
            }
          },
          required: ['member', 'input']
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'computer_action') {
    if (!checkPermissions()) {
      return { isError: true, content: [{ type: 'text', text: 'Missing accessibility/screen recording permissions.' }] };
    }
    const args = request.params.arguments as Record<string, unknown> | undefined;
    const call = {
      id: Math.random().toString(36).substring(7),
      member: args?.member,
      input: args?.input,
    } as unknown as ToolCall;
    
    const result = executeCanonicalCall(call);
    
    if (result.is_error) {
      return { isError: true, content: [{ type: 'text', text: result.error || 'Unknown error' }] };
    }

    return { content: toolResultToMcpContent(result) };
  }
  return { isError: true, content: [{ type: 'text', text: 'Unknown tool' }] };
});

const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
