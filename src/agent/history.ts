import { ToolCall, ToolResult, NOT_EXECUTED_MESSAGE } from '../tools/types';

export interface TurnRecord {
  call: ToolCall;
  result: ToolResult;
  turn: number;
}

export interface LoopLimits {
  maxPerTurn?: number;
  maxPerSession?: number;
}

export function isPlaceholderRecord(rec: TurnRecord): boolean {
  return rec.result.error === NOT_EXECUTED_MESSAGE;
}

// Keeps the latest `limit` real records plus the latest `limit`
// placeholders, preserving order. Quota is per kind by design: placeholders
// never evict real records, and neither group grows without bound.
function takeLatestPerKind(records: TurnRecord[], limit: number): TurnRecord[] {
  const [real, placeholders] = partitionBy(records, (r) => !isPlaceholderRecord(r));
  const kept = new Set<TurnRecord>([...real.slice(-limit), ...placeholders.slice(-limit)]);
  return records.filter((r) => kept.has(r));
}

function partitionBy<T>(arr: T[], predicate: (item: T) => boolean): [T[], T[]] {
  const matching: T[] = [];
  const rest: T[] = [];
  for (const item of arr) (predicate(item) ? matching : rest).push(item);
  return [matching, rest];
}

const IMAGE_OMITTED_NOTE = '[Image omitted from history]';

export class AgentHistory {
  readonly maxPerTurn: number;
  readonly maxPerSession: number;
  private records: TurnRecord[] = [];

  constructor(limits: LoopLimits = {}) {
    this.maxPerTurn = limits.maxPerTurn ?? 10;
    this.maxPerSession = limits.maxPerSession ?? 50;
  }

  add(record: TurnRecord): void {
    this.records.push(record);
  }

  getAll(): TurnRecord[] {
    return [...this.records];
  }

  truncateHistory(currentTurn: number): void {
    // Release images from older turns by replacing stored records: the
    // caller's objects are never mutated, and the key is dropped entirely
    // (same shape as stripImage produces).
    this.records = this.records.map((rec) => {
      if (!(rec.turn < currentTurn && rec.result.base64_image)) return rec;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { base64_image: _omitted, ...rest } = rec.result;
      return {
        ...rec,
        result: { ...rest, text: [rest.text, IMAGE_OMITTED_NOTE].filter(Boolean).join('\n') },
      };
    });

    const byTurn = new Map<number, TurnRecord[]>();
    for (const item of this.records) {
      const group = byTurn.get(item.turn);
      if (group) group.push(item);
      else byTurn.set(item.turn, [item]);
    }

    this.records = [];
    for (const items of byTurn.values()) {
      this.records.push(...takeLatestPerKind(items, this.maxPerTurn));
    }

    this.records = takeLatestPerKind(this.records, this.maxPerSession);
  }
}
