import { ToolCall, ToolResult } from '../tools/types';

export interface TurnRecord {
  call: ToolCall;
  result: ToolResult;
  turn: number;
}

function takeLast<T>(arr: T[], limit: number, isPlaceholder: (item: T) => boolean): T[] {
  const nonPlaceholders = arr.filter(i => !isPlaceholder(i));
  if (nonPlaceholders.length <= limit) return arr;
  
  const firstKept = nonPlaceholders[nonPlaceholders.length - limit];
  const startIndex = arr.indexOf(firstKept);
  return arr.slice(startIndex);
}

export class AgentHistory {
  private records: TurnRecord[] = [];

  constructor(
    public maxPerTurn: number = 10,
    public maxPerSession: number = 50
  ) {}

  add(record: TurnRecord): void {
    this.records.push(record);
  }

  getAll(): TurnRecord[] {
    return this.records;
  }

  truncateHistory(currentTurn: number): void {
    // W1: trocar base64_image de entradas antigas por resumo
    for (const rec of this.records) {
      if (rec.turn < currentTurn && rec.result.base64_image) {
        delete rec.result.base64_image;
        rec.result.text = (rec.result.text ? rec.result.text + '\n' : '') + '[Image omitted from history]';
      }
    }

    // W1: excluir placeholders da cota
    // The skipped actions (Not executed...) are the placeholders to exclude from quota.
    const isPlaceholder = (rec: TurnRecord) => rec.result.error === "Not executed: an earlier computer action in this turn failed.";

    const turnGroups = new Map<number, TurnRecord[]>();
    for (const item of this.records) {
      if (!turnGroups.has(item.turn)) turnGroups.set(item.turn, []);
      turnGroups.get(item.turn)!.push(item);
    }
    
    this.records = [];
    for (const items of turnGroups.values()) {
      const kept = takeLast(items, this.maxPerTurn, isPlaceholder);
      this.records.push(...kept);
    }

    this.records = takeLast(this.records, this.maxPerSession, isPlaceholder);
  }
}
