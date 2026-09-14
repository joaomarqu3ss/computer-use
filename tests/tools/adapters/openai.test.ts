import { describe, it, expect } from "vitest";

import { fromOpenAi, toOpenAi, OpenAiComputerCall } from '../../../src/tools/adapters/openai';
import { ToolResult } from '../../../src/tools/types';

describe('OpenAI Adapter', () => {
  it('should convert from OpenAI batch of actions', () => {
    const input: OpenAiComputerCall[] = [
      {
        type: 'computer_call',
        call_id: 'call_1',
        actions: [
          { type: 'click', button: 'left', x: 100, y: 200 },
          { type: 'type', text: 'hello' },
          { type: 'screenshot' }
        ]
      }
    ];

    const result = fromOpenAi(input);
    expect(result).toHaveLength(3);
    
    expect(result[0]).toEqual({
      id: 'call_1_0',
      member: 'left_click',
      input: { coordinate: [100, 200] }
    });
    
    expect(result[1]).toEqual({
      id: 'call_1_1',
      member: 'type',
      input: { text: 'hello' }
    });

    expect(result[2]).toEqual({
      id: 'call_1_2',
      member: 'screenshot',
      input: {}
    });
  });

  it('should convert to OpenAI output (success with image)', () => {
    const input: ToolResult[] = [
      { id: 'call_1_0', text: 'OK' },
      { id: 'call_1_1', base64_image: 'base64data' }
    ];

    const result = toOpenAi(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'computer_call_output',
      call_id: 'call_1',
      output: {
        type: 'computer_screenshot',
        image_url: 'data:image/png;base64,base64data',
        detail: 'original'
      }
    });
  });

  it('should convert to OpenAI output (error aborts batch)', () => {
    const input: ToolResult[] = [
      { id: 'call_1_0', text: 'OK' },
      { id: 'call_1_1', is_error: true, error: 'Failed to type' },
      { id: 'call_1_2', is_error: true, error: 'Not executed due to previous error' }
    ];

    const result = toOpenAi(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'computer_call_output',
      call_id: 'call_1',
      output: 'Failed to type'
    });
  });
  
  it('should convert to OpenAI output (success without image)', () => {
    const input: ToolResult[] = [
      { id: 'call_1_0', text: 'OK' }
    ];

    const result = toOpenAi(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'computer_call_output',
      call_id: 'call_1',
      output: 'OK'
    });
  });
});
