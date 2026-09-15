import { describe, it, expect } from 'vitest';
import { AgentHistory, isPlaceholderRecord } from '../../src/agent/history';
import { TurnRecord } from '../../src/agent/history';
import { NOT_EXECUTED_MESSAGE } from '../../src/tools/types';

function record(id: string, turn: number, error?: string, image = false): TurnRecord {
  return {
    call: { id, member: 'wait', input: { duration: 1 } },
    result: {
      id,
      ...(error ? { is_error: true, error } : { text: 'OK' }),
      ...(image ? { base64_image: 'image-bytes' } : {}),
    },
    turn,
  };
}

describe('AgentHistory quota', () => {
  it('caps real records per turn and per session', () => {
    const history = new AgentHistory({ maxPerTurn: 2, maxPerSession: 3 });
    for (let i = 1; i <= 4; i++) history.add(record(`t1_${i}`, 1));
    history.truncateHistory(2);
    expect(history.getAll().map((r) => r.call.id)).toEqual(['t1_3', 't1_4']);

    for (let i = 1; i <= 4; i++) history.add(record(`t2_${i}`, 2));
    history.truncateHistory(3);
    expect(history.getAll()).toHaveLength(3);
  });

  it('excludes placeholders from quota but still bounds them', () => {
    const history = new AgentHistory({ maxPerTurn: 1, maxPerSession: 2 });
    for (let i = 1; i <= 5; i++) history.add(record(`real_${i}`, 1));
    for (let i = 1; i <= 5; i++) history.add(record(`skip_${i}`, 1, NOT_EXECUTED_MESSAGE));
    history.truncateHistory(2);

    const kept = history.getAll();
    expect(kept.filter((r) => !isPlaceholderRecord(r))).toHaveLength(1);
    // Bounded: placeholders cannot grow history without limit.
    expect(kept.length).toBeLessThanOrEqual(2);
  });

  it('replaces old images with a note instead of mutating stored objects', () => {
    const history = new AgentHistory();
    const original = record('img', 1, undefined, true);
    const originalResult = original.result;
    history.add(original);
    history.truncateHistory(2);

    const stored = history.getAll()[0];
    expect(stored.result.base64_image).toBeUndefined();
    expect(stored.result.text).toContain('[Image omitted from history]');
    // The caller's object is untouched: truncate replaces, never mutates.
    expect(originalResult.base64_image).toBe('image-bytes');
    expect(originalResult.text).toBe('OK');
    // Current-turn images are kept.
    const fresh = new AgentHistory();
    fresh.add(record('fresh', 2, undefined, true));
    fresh.truncateHistory(2);
    expect(fresh.getAll()[0].result.base64_image).toBe('image-bytes');
  });
});
