import { ToolResult, mimeForImageFormat } from './types';

export type McpContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; text?: string; data?: string; mimeType?: string };

/**
 * Maps a canonical ToolResult to MCP content parts. Stream frames arrive as
 * JPEG (ADR-0005 fast path); everything else stays PNG.
 */
export function toolResultToMcpContent(result: ToolResult): McpContentPart[] {
  const content: McpContentPart[] = [];
  if (result.text) {
    content.push({ type: 'text', text: result.text });
  }
  if (result.base64_image) {
    content.push({
      type: 'image',
      data: result.base64_image,
      mimeType: mimeForImageFormat(result.imageFormat),
    });
  }
  if (content.length === 0) {
    content.push({ type: 'text', text: 'Success' });
  }
  return content;
}
