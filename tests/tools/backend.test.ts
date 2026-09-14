import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as cp from 'child_process';
import { executeCanonicalCall, checkPermissions } from '../../src/tools/backend';
import { ToolCall } from '../../src/tools/types';

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

describe('Backend API', () => {
  const spawnSyncMock = vi.mocked(cp.spawnSync);
  
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it('spawn com saída válida', () => {
    spawnSyncMock.mockReturnValue({
      pid: 1,
      output: [],
      stdout: JSON.stringify({ id: 'call_1', text: 'OK' }),
      stderr: '',
      status: 0,
      signal: null,
    });
    
    const call: ToolCall = { id: 'call_1', member: 'left_click', input: {} };
    const res = executeCanonicalCall(call);
    
    expect(res).toEqual({ id: 'call_1', text: 'OK' });
  });
  
  it('saída vazia', () => {
    spawnSyncMock.mockReturnValue({
      pid: 1,
      output: [],
      stdout: '',
      stderr: 'Error inside',
      status: 1,
      signal: null,
    });
    
    const call: ToolCall = { id: 'call_1', member: 'left_click', input: {} };
    const res = executeCanonicalCall(call);
    
    expect(res.is_error).toBe(true);
    expect(res.error).toContain('empty output');
  });
  
  it('JSON inválido', () => {
    spawnSyncMock.mockReturnValue({
      pid: 1,
      output: [],
      stdout: 'not-a-json',
      stderr: '',
      status: 0,
      signal: null,
    });
    
    const call: ToolCall = { id: 'call_1', member: 'left_click', input: {} };
    const res = executeCanonicalCall(call);
    
    expect(res.is_error).toBe(true);
    expect(res.error).toContain('Failed to parse');
  });
  
  it('binário ausente', () => {
    spawnSyncMock.mockReturnValue({
      pid: 1,
      output: [],
      stdout: '',
      stderr: '',
      status: 1,
      signal: null,
      error: new Error('ENOENT'),
    });
    
    const call: ToolCall = { id: 'call_1', member: 'left_click', input: {} };
    const res = executeCanonicalCall(call);
    
    expect(res.is_error).toBe(true);
    expect(res.error).toContain('Failed to spawn');
  });
  
  it('checkPermissions verdadeiro', () => {
    spawnSyncMock.mockReturnValue({
      pid: 1,
      output: [],
      stdout: 'true',
      stderr: '',
      status: 0,
      signal: null,
    });
    
    const res = checkPermissions();
    expect(res).toBe(true);
  });
  
  it('checkPermissions falso', () => {
    spawnSyncMock.mockReturnValue({
      pid: 1,
      output: [],
      stdout: 'false',
      stderr: 'Permissions missing',
      status: 1,
      signal: null,
    });
    
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = checkPermissions();
    
    expect(res).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith('Permissions missing');
  });

  it('valida envio de ToolCall com type (escape)', () => {
    spawnSyncMock.mockReturnValue({
      pid: 1, output: [], stdout: '{"id":"call_type","text":"OK"}', stderr: '', status: 0, signal: null
    });
    const call: ToolCall = { id: 'call_type', member: 'type', input: { text: 'a\\"b' } };
    executeCanonicalCall(call);
    expect(spawnSyncMock).toHaveBeenCalledWith(expect.any(String), [JSON.stringify(call)], expect.any(Object));
  });

  it('valida envio de ToolCall com key repeat e modifiers', () => {
    spawnSyncMock.mockReturnValue({
      pid: 1, output: [], stdout: '{"id":"call_key","text":"OK"}', stderr: '', status: 0, signal: null
    });
    const call: ToolCall = { id: 'call_key', member: 'key', input: { text: 'tab', repeat: 4 } };
    executeCanonicalCall(call);
    expect(spawnSyncMock).toHaveBeenCalledWith(expect.any(String), [JSON.stringify(call)], expect.any(Object));
  });

  it('valida envio de ToolCall click com modifiers', () => {
    spawnSyncMock.mockReturnValue({
      pid: 1, output: [], stdout: '{"id":"call_click","text":"OK"}', stderr: '', status: 0, signal: null
    });
    const call: ToolCall = { id: 'call_click', member: 'left_click', input: { text: 'shift' } };
    executeCanonicalCall(call);
    expect(spawnSyncMock).toHaveBeenCalledWith(expect.any(String), [JSON.stringify(call)], expect.any(Object));
  });
});
