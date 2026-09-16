import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as cp from 'child_process';
import { executeCanonicalCall, checkPermissions, setSessionSink, startSession, SessionSink } from '../../src/tools/backend';
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

describe('Stream frame fast path (ADR-0005)', () => {
  const spawnSyncMock = vi.mocked(cp.spawnSync);

  const frameSink = (frame: ReturnType<NonNullable<SessionSink['captureFrame']>>): SessionSink => ({
    start: () => {},
    event: () => {},
    stop: () => {},
    captureFrame: () => frame,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setSessionSink(null);
    delete process.env.COMPUTER_USE_LEGACY_CAPTURE;
  });

  afterEach(() => {
    setSessionSink(null);
    delete process.env.COMPUTER_USE_LEGACY_CAPTURE;
  });

  it('serves screenshots from the live stream without spawning', () => {
    setSessionSink(frameSink({ id: '', base64_image: 'stream-bytes', imageFormat: 'jpeg' }));
    startSession();
    const res = executeCanonicalCall({ id: 'shot9', member: 'screenshot', input: {} });
    expect(res).toEqual({ id: 'shot9', base64_image: 'stream-bytes', imageFormat: 'jpeg' });
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('serves zoom from the stream with the region', () => {
    const seen: Array<[number, number, number, number] | undefined> = [];
    setSessionSink({
      start: () => {},
      event: () => {},
      stop: () => {},
      captureFrame: (region) => {
        seen.push(region);
        return { id: '', base64_image: 'zoom-bytes', imageFormat: 'jpeg' };
      },
    });
    startSession();
    const res = executeCanonicalCall({ id: 'z9', member: 'zoom', input: { region: [0, 0, 10, 10] } });
    expect(res.id).toBe('z9');
    expect(seen).toEqual([[0, 0, 10, 10]]);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('falls back to one-shot when the frame is missing or errored', () => {
    setSessionSink(frameSink(null));
    startSession();
    spawnSyncMock.mockReturnValue({
      pid: 1, output: [], stdout: '{"id":"shot9","text":"OK"}', stderr: '', status: 0, signal: null
    });
    const res = executeCanonicalCall({ id: 'shot9', member: 'screenshot', input: {} });
    expect(res).toEqual({ id: 'shot9', text: 'OK' });
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
  });

  it('legacy opt-in bypasses the stream even with a session', () => {
    process.env.COMPUTER_USE_LEGACY_CAPTURE = '1';
    setSessionSink(frameSink({ id: '', base64_image: 'stream-bytes', imageFormat: 'jpeg' }));
    startSession();
    spawnSyncMock.mockReturnValue({
      pid: 1, output: [], stdout: '{"id":"shot9","text":"OK"}', stderr: '', status: 0, signal: null
    });
    const res = executeCanonicalCall({ id: 'shot9', member: 'screenshot', input: {} });
    expect(res).toEqual({ id: 'shot9', text: 'OK' });
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
  });

  it('non-capture members never consult the stream', () => {
    const captureFrame = vi.fn(() => ({ id: '', base64_image: 'x', imageFormat: 'jpeg' as const }));
    setSessionSink({ start: () => {}, event: () => {}, stop: () => {}, captureFrame });
    startSession();
    spawnSyncMock.mockReturnValue({
      pid: 1, output: [], stdout: '{"id":"c1","text":"OK"}', stderr: '', status: 0, signal: null
    });
    executeCanonicalCall({ id: 'c1', member: 'left_click', input: {} });
    expect(captureFrame).not.toHaveBeenCalled();
  });
});
