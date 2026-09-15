import { ToolCall, ToolResult } from '../tools/types';
import { executeCanonicalCall } from '../tools/backend';

export class AgentLoop {
  history: {
    call: ToolCall;
    result: ToolResult;
    turn: number;
  }[] = [];

  private turnCount = 0;

  constructor(
    public maxPerTurnLimit = 10,
    public maxPerSessionLimit = 50
  ) {}

  executeBatch(calls: ToolCall[]): ToolResult[] {
    this.turnCount++;
    const results: ToolResult[] = [];
    let hasError = false;

    for (const call of calls) {
      if (hasError) {
        const skippedResult: ToolResult = {
          id: call.id,
          is_error: true,
          error: "Not executed: an earlier computer action in this turn failed."
        };
        results.push(skippedResult);
        this.history.push({ call, result: skippedResult, turn: this.turnCount });
        continue;
      }
      
      const result = executeCanonicalCall(call);
      
      if (result.base64_image && call.member !== 'screenshot' && call.member !== 'zoom') {
        delete result.base64_image;
      }
      
      if (result.is_error) {
        hasError = true;
      }
      
      results.push(result);
      this.history.push({ call, result, turn: this.turnCount });
    }

    this.cleanHistory();
    return results;
  }

  // Loop asking a "model" function until it returns an empty array
  async runLoop(model: (history: { call: ToolCall; result: ToolResult; turn: number }[]) => Promise<ToolCall[]>): Promise<void> {
    while (true) {
      const calls = await model(this.history);
      if (!calls || calls.length === 0) {
        break; // modelo parou de pedir ferramentas
      }
      
      this.executeBatch(calls);
    }
  }
  
  private cleanHistory() {
    const turnGroups = new Map<number, typeof this.history>();
    for (const item of this.history) {
      if (!turnGroups.has(item.turn)) turnGroups.set(item.turn, []);
      turnGroups.get(item.turn)!.push(item);
    }
    
    this.history = [];
    for (const items of turnGroups.values()) {
      let turnItems = items;
      if (turnItems.length > this.maxPerTurnLimit) {
         turnItems = turnItems.slice(turnItems.length - this.maxPerTurnLimit);
      }
      this.history.push(...turnItems);
    }

    if (this.history.length > this.maxPerSessionLimit) {
      this.history = this.history.slice(this.history.length - this.maxPerSessionLimit);
    }
  }
}
