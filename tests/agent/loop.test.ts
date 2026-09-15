import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '../../src/agent/loop';
import { ToolCall, ToolResult } from '../../src/tools/types';
import * as backend from '../../src/tools/backend';
import { toAnthropic } from '../../src/tools/adapters/anthropic';

vi.mock('../../src/tools/backend', () => ({
  executeCanonicalCall: vi.fn(),
}));

describe('Agent Loop e Cleaner', () => {
  const mockExecute = vi.mocked(backend.executeCanonicalCall);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('batch executa em ordem e para no primeiro erro', () => {
    const loop = new AgentLoop();
    
    mockExecute.mockImplementation((call: ToolCall) => {
      if (call.member === 'left_click') {
        return { id: call.id, is_error: true, error: 'Fail' };
      }
      return { id: call.id, text: 'OK' };
    });

    const calls: ToolCall[] = [
      { id: '1', member: 'mouse_move', input: { coordinate: [0, 0] } },
      { id: '2', member: 'left_click', input: {} },
      { id: '3', member: 'type', input: { text: 'hello' } },
    ];

    const results = loop.executeBatch(calls);

    expect(results).toHaveLength(3);
    
    expect(results[0].is_error).toBeFalsy();
    expect(results[0].id).toBe('1');
    
    expect(results[1].is_error).toBe(true);
    expect(results[1].error).toBe('Fail');
    expect(results[1].id).toBe('2');
    
    expect(results[2].is_error).toBe(true);
    expect(results[2].error).toBe('Not executed: an earlier computer action in this turn failed.');
    expect(results[2].id).toBe('3');
    
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('um tool_result por tool_use, casado por id e com toolset_name', () => {
    const loop = new AgentLoop();
    mockExecute.mockReturnValue({ id: 'c1', text: 'OK' });
    
    const calls: ToolCall[] = [{ id: 'c1', member: 'screenshot', input: {} }];
    const results = loop.executeBatch(calls);
    
    // Adapt to Anthropic format
    const anthropicResults = toAnthropic(results);
    expect(anthropicResults).toHaveLength(1);
    expect(anthropicResults[0].tool_use_id).toBe('c1');
    expect(anthropicResults[0].toolset_name).toBe('computer');
  });

  it('cleaner respeita os limites por turno e por sessão', () => {
    const loop = new AgentLoop(2, 3); // max 2 per turn, max 3 per session
    
    mockExecute.mockImplementation((call: ToolCall) => ({ id: call.id, text: 'OK' }));
    
    // Turn 1: 3 calls
    loop.executeBatch([
      { id: 't1_1', member: 'wait', input: { duration: 1 } },
      { id: 't1_2', member: 'wait', input: { duration: 1 } },
      { id: 't1_3', member: 'wait', input: { duration: 1 } }
    ]);
    
    expect(loop.history.length).toBe(2); // turn limit 2
    expect(loop.history[0].call.id).toBe('t1_2');
    expect(loop.history[1].call.id).toBe('t1_3');
    
    // Turn 2: 2 calls
    loop.executeBatch([
      { id: 't2_1', member: 'wait', input: { duration: 1 } },
      { id: 't2_2', member: 'wait', input: { duration: 1 } }
    ]);
    
    // Total in history: 4? No, session limit is 3. So we keep only the last 3 items overall.
    expect(loop.history.length).toBe(3);
    expect(loop.history[0].call.id).toBe('t1_3');
    expect(loop.history[1].call.id).toBe('t2_1');
    expect(loop.history[2].call.id).toBe('t2_2');
  });
  
  it('sem permissao falha fechado com a guia (nunca clique fantasma)', () => {
    // If backend returns permission error, it shouldn't proceed
    const loop = new AgentLoop();
    
    mockExecute.mockImplementation((call: ToolCall) => {
      return { id: call.id, is_error: true, error: 'Missing accessibility/screen recording permissions' };
    });
    
    const results = loop.executeBatch([
      { id: '1', member: 'left_click', input: {} },
      { id: '2', member: 'type', input: { text: 'a' } }
    ]);
    
    expect(results[0].is_error).toBe(true);
    expect(results[0].error).toContain('permissions');
    
    expect(results[1].is_error).toBe(true);
    expect(results[1].error).toBe('Not executed: an earlier computer action in this turn failed.');
    
    // executeCanonicalCall called only once, meaning ghost click 2 didn't happen
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});
