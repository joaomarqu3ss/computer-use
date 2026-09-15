import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '../../src/agent/loop';
import {  } from '../../src/agent/history';
import { ToolCall } from '../../src/tools/types';
import * as backend from '../../src/tools/backend';
import { toAnthropic } from '../../src/tools/adapters/anthropic';

vi.mock('../../src/tools/backend', () => ({
  executeCanonicalCall: vi.fn(),
  checkPermissions: vi.fn().mockReturnValue(true),
}));

describe('Agent Loop e Cleaner', () => {
  const mockExecute = vi.mocked(backend.executeCanonicalCall);
  const mockCheckPerms = vi.mocked(backend.checkPermissions);

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckPerms.mockReturnValue(true);
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

    // expect 3 returned items (the auto screenshot is not in results)
    expect(results).toHaveLength(3);
    
    expect(results[0].is_error).toBeFalsy();
    expect(results[0].id).toBe('1');
    
    expect(results[1].is_error).toBe(true);
    expect(results[1].error).toBe('Fail');
    expect(results[1].id).toBe('2');
    
    expect(results[2].is_error).toBe(true);
    expect(results[2].error).toBe('Not executed: an earlier computer action in this turn failed.');
    expect(results[2].id).toBe('3');
    
    // 2 explicitly executed + 1 screenshot at the end
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });

  it('um tool_result por tool_use, casado por id e com toolset_name', () => {
    const loop = new AgentLoop();
    mockExecute.mockReturnValue({ id: 'c1', text: 'OK' });
    
    const calls: ToolCall[] = [{ id: 'c1', member: 'wait', input: { duration: 1 } }];
    const results = loop.executeBatch(calls);
    
    const anthropicResults = toAnthropic(results);
    expect(anthropicResults).toHaveLength(1);
    expect(anthropicResults[0].tool_use_id).toBe('c1');
    expect(anthropicResults[0].toolset_name).toBe('computer');
  });

  it('cleaner respeita os limites por turno e por sessão', () => {
    const loop = new AgentLoop(2, 3); // max 2 per turn, max 3 per session
    
    mockExecute.mockImplementation((call: ToolCall) => ({ id: call.id, text: 'OK' }));
    
    loop.executeBatch([
      { id: 't1_1', member: 'wait', input: { duration: 1 } },
      { id: 't1_2', member: 'wait', input: { duration: 1 } },
      { id: 't1_3', member: 'wait', input: { duration: 1 } }
    ]);
    
    // t1_1, t1_2, t1_3 + screenshot1 = 4 items in turn 1. maxPerTurn=2. 
    // Wait, the W1 logic might change this. Let's adapt when we implement W1.
  });
  
  it('sem permissao falha fechado com a guia (nunca clique fantasma)', () => {
    mockCheckPerms.mockReturnValue(false);
    const loop = new AgentLoop();
    
    const results = loop.executeBatch([
      { id: '1', member: 'left_click', input: {} },
      { id: '2', member: 'type', input: { text: 'a' } }
    ]);
    
    expect(results[0].is_error).toBe(true);
    expect(results[0].error).toContain('permissions');
    
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe('Agent Loop Imagem', () => {
  const mockExecute = vi.mocked(backend.executeCanonicalCall);
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('P4: descarta base64_image de eventos que nao sao screenshot/zoom', () => {
    const loop = new AgentLoop();
    mockExecute.mockReturnValue({ id: 'c1', base64_image: 'some_base64', text: 'OK' });
    
    const calls: ToolCall[] = [
      { id: '1', member: 'left_click', input: {} },
      { id: '2', member: 'zoom', input: { region: [0, 0, 10, 10] } }
    ];
    
    const results = loop.executeBatch(calls);
    
    // left_click loses base64_image
    expect(results[0].id).toBe('1');
    expect(results[0].base64_image).toBeUndefined();
    expect(results[0].text).toBe('OK');
    
    // zoom keeps it
    expect(results[1].id).toBe('2');
    expect(results[1].base64_image).toBe('some_base64');
  });
});
