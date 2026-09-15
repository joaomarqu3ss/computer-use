import { ToolCall, ToolResult, NOT_EXECUTED_MESSAGE } from '../tools/types';
import { executeCanonicalCall, checkPermissions } from '../tools/backend';
import { AgentHistory, TurnRecord, LoopLimits } from './history';

export interface AgentLoopOptions extends LoopLimits {
  maxTurns?: number;
}

const PERMISSION_ERROR =
  'Missing accessibility/screen recording permissions. Cannot execute computer actions.';

// Images travel only on screenshot/zoom results. Always returns a copy:
// the object owned by the backend is never stored or mutated.
function stripImage(call: ToolCall, result: ToolResult): ToolResult {
  if (result.base64_image && call.member !== 'screenshot' && call.member !== 'zoom') {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { base64_image: _omitted, ...rest } = result;
    return rest;
  }
  return { ...result };
}

export class AgentLoop {
  history: AgentHistory;
  readonly maxTurns: number;
  private turnCount = 0;

  constructor(options: AgentLoopOptions = {}) {
    this.maxTurns = options.maxTurns ?? 50;
    this.history = new AgentHistory(options);
  }

  private record(call: ToolCall, result: ToolResult): void {
    this.history.add({ call, result: stripImage(call, result), turn: this.turnCount });
  }

  // Harness self-check, not a model signal: every call gets exactly one
  // result, matched by id. Failures here throw; model-level is_error in
  // results flows back to the model via history instead.
  verifyBatch(calls: ToolCall[], results: ToolResult[]): string[] {
    const problems: string[] = [];
    if (results.length !== calls.length) {
      problems.push(`expected ${calls.length} results, got ${results.length}`);
    }
    calls.forEach((call, index) => {
      if (results[index]?.id !== call.id) {
        problems.push(`result ${index} does not match call ${call.id}`);
      }
    });
    return problems;
  }

  // The end-of-turn photo is recorded for the next turn but never returned:
  // provider contracts demand exactly one result per requested call, and the
  // photo has no matching request. Without permissions there is nothing
  // capturable, so the denied path below skips it by design.
  private recordTurnScreenshot(): void {
    const call: ToolCall = {
      id: `auto-screenshot-turn-${this.turnCount}`,
      member: 'screenshot',
      input: {},
    };
    this.record(call, executeCanonicalCall(call));
  }

  executeBatch(calls: ToolCall[]): ToolResult[] {
    if (calls.length === 0) return [];
    this.turnCount++;

    if (!checkPermissions()) {
      const denied = calls.map((call) => {
        const err: ToolResult = { id: call.id, is_error: true, error: PERMISSION_ERROR };
        this.record(call, err);
        return err;
      });
      this.history.truncateHistory(this.turnCount);
      return denied;
    }

    const results: ToolResult[] = [];
    let hasError = false;

    for (const call of calls) {
      if (hasError) {
        const skipped: ToolResult = { id: call.id, is_error: true, error: NOT_EXECUTED_MESSAGE };
        results.push(skipped);
        this.record(call, skipped);
        continue;
      }

      const result = executeCanonicalCall(call);
      if (result.is_error) hasError = true;

      const stored = stripImage(call, result);
      results.push(stored);
      this.record(call, result);
    }

    this.recordTurnScreenshot();

    const problems = this.verifyBatch(calls, results);
    if (problems.length > 0) {
      throw new Error(`Batch verification failed: ${problems.join('; ')}`);
    }

    this.history.truncateHistory(this.turnCount);
    return results;
  }

  async run(model: (history: TurnRecord[]) => Promise<ToolCall[]>): Promise<TurnRecord[]> {
    let completed = false;
    for (let i = 0; i < this.maxTurns; i++) {
      const calls = await model(this.history.getAll());
      if (!calls || calls.length === 0) {
        completed = true;
        break;
      }
      // Model signals (including is_error) return via history for the
      // model to replan; only harness faults thrown above abort the run.
      this.executeBatch(calls);
    }

    if (!completed) {
      throw new Error(`Exceeded max turns (${this.maxTurns}) without completing the task.`);
    }

    return this.history.getAll();
  }
}
