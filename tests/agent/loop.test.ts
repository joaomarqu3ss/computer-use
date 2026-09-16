import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '../../src/agent/loop';
import { ToolCall } from '../../src/tools/types';
import { NOT_EXECUTED_MESSAGE } from '../../src/tools/types';
import * as backend from '../../src/tools/backend';

vi.mock('../../src/tools/backend', () => ({
  executeCanonicalCall: vi.fn(),
  checkPermissions: vi.fn().mockReturnValue(true),
  startSession: vi.fn(),
  stopSession: vi.fn(),
  notifyAction: vi.fn(),
  setSessionSink: vi.fn(),
  createSidecarDaemonSink: vi.fn(() => ({ start: vi.fn(), event: vi.fn(), stop: vi.fn() })),
}));

describe('AgentLoop batch execution', () => {
  const mockExecute = vi.mocked(backend.executeCanonicalCall);
  const mockCheckPermissions = vi.mocked(backend.checkPermissions);

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckPermissions.mockReturnValue(true);
  });

  it('runs calls in order and halts after the first error', () => {
    const loop = new AgentLoop();

    mockExecute.mockImplementation((call: ToolCall) => {
      if (call.member === 'left_click') return { id: call.id, is_error: true, error: 'Fail' };
      return { id: call.id, text: 'OK' };
    });

    const results = loop.executeBatch([
      { id: '1', member: 'mouse_move', input: { coordinate: [0, 0] } },
      { id: '2', member: 'left_click', input: {} },
      { id: '3', member: 'type', input: { text: 'hello' } },
    ]);

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ id: '1' });
    expect(results[0].is_error).toBeFalsy();
    expect(results[1]).toMatchObject({ id: '2', is_error: true, error: 'Fail' });
    expect(results[2]).toMatchObject({ id: '3', is_error: true, error: NOT_EXECUTED_MESSAGE });

    // Two requested calls plus the end-of-turn screenshot.
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });

  it('returns exactly one canonical result per call, without toolset_name', () => {
    const loop = new AgentLoop();
    mockExecute.mockReturnValue({ id: 'c1', text: 'OK' });

    const results = loop.executeBatch([{ id: 'c1', member: 'wait', input: { duration: 1 } }]);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('c1');
    // Adapters own toolset_name; the loop stays canonical.
    expect('toolset_name' in results[0]).toBe(false);
  });

  it('returns an empty array for an empty batch without touching the backend', () => {
    const loop = new AgentLoop();
    expect(loop.executeBatch([])).toEqual([]);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('records a deterministic end-of-turn screenshot without returning it', () => {
    const loop = new AgentLoop();
    mockExecute.mockImplementation((call: ToolCall) => ({ id: call.id, text: 'OK' }));

    const results = loop.executeBatch([{ id: 'c1', member: 'wait', input: { duration: 1 } }]);
    const history = loop.history.getAll();

    expect(results).toHaveLength(1);
    const photo = history.find((rec) => rec.call.member === 'screenshot');
    expect(photo?.call.id).toBe('auto-screenshot-turn-1');
  });

  it('denies every call without permissions and never touches the backend', () => {
    mockCheckPermissions.mockReturnValue(false);
    const loop = new AgentLoop();

    const results = loop.executeBatch([
      { id: '1', member: 'left_click', input: {} },
      { id: '2', member: 'type', input: { text: 'a' } },
    ]);

    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.is_error).toBe(true);
      expect(result.error).toContain('permissions');
    }
    expect(mockExecute).not.toHaveBeenCalled();

    // History holds the two real denied calls, nothing synthetic.
    const ids = loop.history.getAll().map((rec) => rec.call.id).sort();
    expect(ids).toEqual(['1', '2']);
  });

  it('strips images from action results but keeps them on screenshot and zoom', () => {
    const loop = new AgentLoop();
    const backendResult = { id: 'x', base64_image: 'some_base64', text: 'OK' };
    mockExecute.mockImplementation((call: ToolCall) => ({ ...backendResult, id: call.id }));

    const results = loop.executeBatch([
      { id: '1', member: 'left_click', input: {} },
      { id: '2', member: 'screenshot', input: {} },
      { id: '3', member: 'zoom', input: { region: [0, 0, 10, 10] } },
    ]);

    expect(results[0].base64_image).toBeUndefined();
    expect(results[1].base64_image).toBe('some_base64');
    expect(results[2].base64_image).toBe('some_base64');

    // The backend-owned object is never mutated.
    expect(backendResult.base64_image).toBe('some_base64');

    // The stored history copy is stripped for the action call.
    const stored = loop.history.getAll().find((rec) => rec.call.id === '1');
    expect(stored?.result.base64_image).toBeUndefined();
    expect(stored?.result.text).toBe('OK');
  });
});

describe('AgentLoop run guard', () => {
  const mockExecute = vi.mocked(backend.executeCanonicalCall);
  const mockCheckPermissions = vi.mocked(backend.checkPermissions);

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckPermissions.mockReturnValue(true);
    mockExecute.mockImplementation((call: ToolCall) => ({ id: call.id, text: 'OK' }));
  });

  it('returns history when the model stops requesting tools', async () => {
    const loop = new AgentLoop();
    const history = await loop.run(async () => []);
    expect(history).toEqual([]);
  });

  it('returns model-level errors to the model instead of throwing', async () => {
    const loop = new AgentLoop();
    mockExecute.mockReturnValue({ id: 'c1', is_error: true, error: 'App refused' });

    const history = await loop.run(async (seen) => (seen.length === 0 ? [{ id: 'c1', member: 'wait', input: { duration: 1 } }] : []));
    expect(history.length).toBeGreaterThan(0);
  });

  it('throws only after exhausting max turns', async () => {
    const loop = new AgentLoop({ maxTurns: 3 });
    await expect(loop.run(async () => [{ id: 'c1', member: 'wait', input: { duration: 1 } }])).rejects.toThrow(
      'Exceeded max turns (3)',
    );
  });

  it('completing exactly at the boundary does not throw', async () => {
    const loop = new AgentLoop({ maxTurns: 2 });
    let calls = 0;
    const history = await loop.run(async () => (++calls <= 1 ? [{ id: `c${calls}`, member: 'wait', input: { duration: 1 } }] : []));
    expect(history.length).toBeGreaterThan(0);
  });

  it('verifyBatch reports mismatched results instead of passing silently', () => {
    const loop = new AgentLoop();
    const calls: ToolCall[] = [
      { id: 'c1', member: 'wait', input: { duration: 1 } },
      { id: 'c2', member: 'wait', input: { duration: 1 } },
    ];
    expect(loop.verifyBatch(calls, [{ id: 'c1', text: 'OK' }])).toHaveLength(2);
    expect(loop.verifyBatch(calls, [{ id: 'c1', text: 'OK' }, { id: 'c2', text: 'OK' }])).toEqual([]);
  });
});

describe('AgentLoop async batch + session lifecycle (ADR-0005)', () => {
  const mockExecute = vi.mocked(backend.executeCanonicalCall);
  const mockCheckPermissions = vi.mocked(backend.checkPermissions);
  const mockStart = vi.mocked(backend.startSession);
  const mockStop = vi.mocked(backend.stopSession);
  const mockNotify = vi.mocked(backend.notifyAction);

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckPermissions.mockReturnValue(true);
    mockExecute.mockImplementation((call: ToolCall) => ({ id: call.id, text: 'OK' }));
  });

  it('executeBatchAsync preserves order and halts after the first error', async () => {
    const loop = new AgentLoop();
    mockExecute.mockImplementation((call: ToolCall) => {
      if (call.member === 'left_click') return { id: call.id, is_error: true, error: 'Fail' };
      return { id: call.id, text: 'OK' };
    });

    const results = await loop.executeBatchAsync([
      { id: '1', member: 'mouse_move', input: { coordinate: [0, 0] } },
      { id: '2', member: 'left_click', input: {} },
      { id: '3', member: 'type', input: { text: 'hello' } },
    ]);

    expect(results).toHaveLength(3);
    expect(results[2]).toMatchObject({ id: '3', is_error: true, error: NOT_EXECUTED_MESSAGE });
    expect(mockExecute).toHaveBeenCalledTimes(3); // 2 actions + end-of-turn photo
  });

  it('executeBatchAsync notifies the overlay only for executed calls', async () => {
    const loop = new AgentLoop();
    mockExecute.mockImplementation((call: ToolCall) => {
      if (call.member === 'left_click') return { id: call.id, is_error: true, error: 'Fail' };
      return { id: call.id, text: 'OK' };
    });

    await loop.executeBatchAsync([
      { id: '1', member: 'mouse_move', input: { coordinate: [0, 0] } },
      { id: '2', member: 'left_click', input: {} },
      { id: '3', member: 'type', input: { text: 'hello' } },
    ]);

    const notified = mockNotify.mock.calls.map(([call]) => (call as ToolCall).id).sort();
    // mouse_move + left_click executed; skipped type never notifies; the auto
    // screenshot notifies too but describeOverlayEvent maps it to null downstream.
    expect(notified).toContain('1');
    expect(notified).toContain('2');
    expect(notified).not.toContain('3');
  });

  it('executeBatchAsync supports a custom async executor preserving order', async () => {
    const loop = new AgentLoop();
    const order: string[] = [];
    const results = await loop.executeBatchAsync(
      [
        { id: 'a', member: 'wait', input: { duration: 1 } },
        { id: 'b', member: 'wait', input: { duration: 1 } },
      ],
      async (call) => {
        await new Promise((r) => setTimeout(r, 5));
        order.push(call.id);
        return { id: call.id, text: 'OK' };
      },
    );
    expect(order).toEqual(['a', 'b', 'auto-screenshot-turn-1']);
    expect(results.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('run() starts the session and stops it on completion', async () => {
    const loop = new AgentLoop();
    await loop.run(async () => []);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('run() stops the session even when max turns throw', async () => {
    const loop = new AgentLoop({ maxTurns: 2 });
    await expect(loop.run(async () => [{ id: 'c1', member: 'wait', input: { duration: 1 } }])).rejects.toThrow(
      'Exceeded max turns (2)',
    );
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStop).toHaveBeenCalledTimes(1);
  });
});

describe('AgentLoop session sink wiring', () => {
  const mockSetSink = vi.mocked(backend.setSessionSink);
  const mockCreateSink = vi.mocked(backend.createSidecarDaemonSink);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(backend.checkPermissions).mockReturnValue(true);
    vi.mocked(backend.executeCanonicalCall).mockImplementation((call: ToolCall) => ({ id: call.id, text: 'OK' }));
    delete process.env.COMPUTER_USE_NO_OVERLAY;
  });

  it('run() installs the default daemon sink and clears it afterwards', async () => {
    const loop = new AgentLoop();
    await loop.run(async () => []);
    expect(mockCreateSink).toHaveBeenCalledTimes(1);
    expect(mockSetSink).toHaveBeenNthCalledWith(1, expect.objectContaining({ start: expect.any(Function) }));
    expect(mockSetSink).toHaveBeenLastCalledWith(null);
  });

  it('run() honors an explicit custom sink instead of the default', async () => {
    const custom = { start: vi.fn(), event: vi.fn(), stop: vi.fn() };
    const loop = new AgentLoop({ sink: custom });
    await loop.run(async () => []);
    expect(mockCreateSink).not.toHaveBeenCalled();
    expect(mockSetSink).toHaveBeenNthCalledWith(1, custom);
    expect(mockSetSink).toHaveBeenLastCalledWith(null);
  });

  it('run() stays headless with COMPUTER_USE_NO_OVERLAY=1', async () => {
    process.env.COMPUTER_USE_NO_OVERLAY = '1';
    const loop = new AgentLoop();
    await loop.run(async () => []);
    expect(mockCreateSink).not.toHaveBeenCalled();
    expect(mockSetSink).toHaveBeenNthCalledWith(1, null);
  });

  it('run() cleans the session on SIGINT and re-raises', async () => {
    const mockStop = vi.mocked(backend.stopSession);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as typeof process.kill);
    const onceSpy = vi.spyOn(process, 'once');
    const removeSpy = vi.spyOn(process, 'removeListener');

    let resolveModel!: () => void;
    const gate = new Promise<void>((r) => {
      resolveModel = r;
    });
    const loop = new AgentLoop();
    const runPromise = loop.run(async () => {
      await gate;
      return [];
    });

    const sigintHandler = onceSpy.mock.calls.find(([sig]) => sig === 'SIGINT')?.[1] as () => void;
    expect(sigintHandler).toBeDefined();
    sigintHandler();
    expect(mockStop).toHaveBeenCalled();
    expect(mockSetSink).toHaveBeenLastCalledWith(null);
    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGINT');

    resolveModel();
    await runPromise;
    expect(removeSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
  });
});
