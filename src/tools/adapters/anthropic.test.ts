import { describe, it, expect } from "vitest";

import { fromAnthropic, toAnthropic, AnthropicToolUse } from './anthropic';
import { ToolResult } from '../types';

describe('Anthropic Adapter', () => {
  it('should convert from Anthropic (including batch)', () => {
    const input: AnthropicToolUse[] = [
      {
        type: 'tool_use',
        id: 'call_1',
        name: 'left_click',
        toolset_name: 'computer',
        input: { coordinate: [100, 200] }
      },
      {
        type: 'tool_use',
        id: 'call_2',
        name: 'type',
        toolset_name: 'computer',
        input: { text: 'hello' }
      }
    ];

    const result = fromAnthropic(input);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('call_1');
    expect(result[0].member).toBe('left_click');
    expect(result[0].input).toEqual({ coordinate: [100, 200] });

    expect(result[1].id).toBe('call_2');
    expect(result[1].member).toBe('type');
    expect(result[1].input).toEqual({ text: 'hello' });
  });

  it('should convert to Anthropic (success, error, and image)', () => {
    const input: ToolResult[] = [
      { id: 'call_1', text: 'OK' },
      { id: 'call_2', is_error: true, error: 'Failed to type' },
      { id: 'call_3', base64_image: 'base64data' }
    ];

    const result = toAnthropic(input);
    expect(result).toHaveLength(3);
    
    expect(result[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'call_1',
      toolset_name: 'computer',
      content: [{ type: 'text', text: 'OK' }]
    });

    expect(result[1]).toEqual({
      type: 'tool_result',
      tool_use_id: 'call_2',
      toolset_name: 'computer',
      is_error: true,
      content: 'Failed to type'
    });

    expect(result[2]).toEqual({
      type: 'tool_result',
      tool_use_id: 'call_3',
      toolset_name: 'computer',
      content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'base64data' } }]
    });
  });
});
