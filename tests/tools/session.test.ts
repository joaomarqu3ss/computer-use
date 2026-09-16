import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setSessionSink,
  startSession,
  stopSession,
  isSessionActive,
  notifyAction,
  isLegacyCapture,
  SessionSink,
} from '../../src/tools/backend';
import { ToolCall } from '../../src/tools/types';

function makeSink(): SessionSink & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    start: () => void calls.push('start'),
    event: (e) => void calls.push(`event:${e.member}`),
    stop: () => void calls.push('stop'),
  };
}

describe('session lifecycle (daemon behind AgentLoop)', () => {
  beforeEach(() => {
    setSessionSink(null);
    delete process.env.COMPUTER_USE_LEGACY_CAPTURE;
  });

  it('starts inactive and notifies nothing without a sink', () => {
    expect(isSessionActive()).toBe(false);
    startSession();
    expect(isSessionActive()).toBe(true);
    const call: ToolCall = { id: 'c1', member: 'left_click', input: {} };
    expect(() => notifyAction(call)).not.toThrow();
    stopSession();
    expect(isSessionActive()).toBe(false);
  });

  it('forwards start/event/stop to the sink in order', () => {
    const sink = makeSink();
    setSessionSink(sink);
    startSession();
    notifyAction({ id: 'c1', member: 'left_click', input: { coordinate: [1, 2] } });
    notifyAction({ id: 's1', member: 'screenshot', input: {} });
    stopSession();
    expect(sink.calls).toEqual(['start', 'event:left_click', 'stop']);
  });

  it('emits nothing for non-pointer members', () => {
    const sink = makeSink();
    setSessionSink(sink);
    startSession();
    notifyAction({ id: 't1', member: 'type', input: { text: 'hi' } });
    expect(sink.calls).toEqual(['start']);
    stopSession();
  });

  it('emits nothing while the session is stopped', () => {
    const sink = makeSink();
    setSessionSink(sink);
    notifyAction({ id: 'c1', member: 'left_click', input: {} });
    expect(sink.calls).toEqual([]);
  });

  it('a throwing sink never breaks action notification (overlay is best-effort)', () => {
    const sink: SessionSink = {
      start: () => {
        throw new Error('boom');
      },
      event: () => {
        throw new Error('boom');
      },
      stop: () => {
        throw new Error('boom');
      },
    };
    setSessionSink(sink);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => startSession()).not.toThrow();
    expect(() => notifyAction({ id: 'c1', member: 'left_click', input: {} })).not.toThrow();
    expect(() => stopSession()).not.toThrow();
    expect(err).toHaveBeenCalled();
    expect(isSessionActive()).toBe(false);
  });

  it('replacing the sink resets the session', () => {
    const sink = makeSink();
    setSessionSink(sink);
    startSession();
    setSessionSink(null);
    expect(isSessionActive()).toBe(false);
  });
});

describe('isLegacyCapture', () => {
  beforeEach(() => {
    delete process.env.COMPUTER_USE_LEGACY_CAPTURE;
  });

  it('is false by default (SCK stream path)', () => {
    expect(isLegacyCapture()).toBe(false);
  });

  it('is true only with the explicit opt-in flag', () => {
    process.env.COMPUTER_USE_LEGACY_CAPTURE = '1';
    expect(isLegacyCapture()).toBe(true);
    process.env.COMPUTER_USE_LEGACY_CAPTURE = '0';
    expect(isLegacyCapture()).toBe(false);
  });
});
