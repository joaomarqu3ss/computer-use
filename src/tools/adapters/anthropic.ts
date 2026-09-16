import { ToolCall, ToolResult, Member, mimeForImageFormat } from '../types';

export interface AnthropicToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  toolset_name?: string;
  input: unknown;
}

export interface AnthropicToolResult {
  type: 'tool_result';
  tool_use_id: string;
  toolset_name?: string;
  is_error?: boolean;
  content: string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }>;
}

export function fromAnthropic(toolUses: AnthropicToolUse[]): ToolCall[] {
  return toolUses.map((tu) => {
    return {
      id: tu.id,
      member: tu.name as Member,
      input: tu.input,
    } as ToolCall;
  });
}

export function toAnthropic(results: ToolResult[]): AnthropicToolResult[] {
  return results.map((res) => {
    let content: AnthropicToolResult['content'];
    if (res.is_error) {
      content = res.error || "Unknown error";
    } else if (res.base64_image) {
      content = [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mimeForImageFormat(res.imageFormat),
            data: res.base64_image,
          },
        },
      ];
    } else {
      content = [{ type: "text", text: res.text || "OK" }];
    }

    const result: AnthropicToolResult = {
      type: "tool_result",
      tool_use_id: res.id,
      toolset_name: "computer",
      content,
    };
    
    if (res.is_error) {
      result.is_error = true;
    }
    
    return result;
  });
}
