import { ToolCall, ToolResult } from '../tools/types';
import { executeCanonicalCall, checkPermissions } from '../tools/backend';
import { AgentHistory, TurnRecord } from './history';

export class AgentLoop {
  history: AgentHistory;
  private turnCount = 0;
  
  constructor(
    maxPerTurn = 10,
    maxPerSession = 50,
    public maxTurns = 50
  ) {
    this.history = new AgentHistory(maxPerTurn, maxPerSession);
  }

  private record(call: ToolCall, result: ToolResult): void {
    // P3: toolset_name desde a saída do loop
    const finalResult: ToolResult = { ...result, toolset_name: "computer" } as ToolResult; 
    
    // W3: Não mutar o objeto do backend
    if (finalResult.base64_image && call.member !== 'screenshot' && call.member !== 'zoom') {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { base64_image, ...rest } = finalResult;
      this.history.add({ call, result: rest as ToolResult, turn: this.turnCount });
    } else {
      this.history.add({ call, result: finalResult, turn: this.turnCount });
    }
  }

  executeBatch(calls: ToolCall[]): ToolResult[] {
    this.turnCount++;
    const results: ToolResult[] = [];
    let hasError = false;

    // P5: Teste fail-closed real
    if (!checkPermissions()) {
      const errCall = calls[0];
      const errResult: ToolResult = {
        id: errCall ? errCall.id : "no-id",
        is_error: true,
        error: "Missing accessibility/screen recording permissions. Cannot execute computer actions."
      };
      this.record(errCall || { id: "no-id", member: "screenshot", input: {} }, errResult);
      return [errResult];
    }

    for (const call of calls) {
      if (hasError) {
        const skippedResult: ToolResult = {
          id: call.id,
          is_error: true,
          error: "Not executed: an earlier computer action in this turn failed."
        };
        results.push(skippedResult);
        this.record(call, skippedResult);
        continue;
      }
      
      const result = executeCanonicalCall(call);
      
      if (result.is_error) {
        hasError = true;
      }
      
      // P3: apply toolset_name for return array as well
      const resultWithToolset = { ...result, toolset_name: "computer" } as ToolResult;
      if (resultWithToolset.base64_image && call.member !== 'screenshot' && call.member !== 'zoom') {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { base64_image, ...rest } = resultWithToolset;
        results.push(rest as ToolResult);
      } else {
        results.push(resultWithToolset);
      }
      
      this.record(call, result);
    }

    // P1: Fotografar todo turno
    const screenshotCall: ToolCall = { id: `auto-screenshot-${Date.now()}`, member: 'screenshot', input: {} };
    const screenshotResult = executeCanonicalCall(screenshotCall);
    this.record(screenshotCall, screenshotResult);
    
    // The screenshot result isn't returned in the batch results but it is recorded
    this.history.truncateHistory(this.turnCount);
    return results;
  }

  async run(model: (history: TurnRecord[]) => Promise<ToolCall[]>): Promise<TurnRecord[]> {
    for (let i = 0; i < this.maxTurns; i++) {
      const calls = await model(this.history.getAll());
      if (!calls || calls.length === 0) {
        break; // model stopped requesting tools
      }
      
      const results = this.executeBatch(calls);
      
      // W2: Propagação de is_error (sem loop infinito)
      if (results.some(r => r.is_error)) {
        throw new Error(`Turn failed: ${results.find(r => r.is_error)?.error}`);
      }
    }
    
    // W2: Teto de turnos com erro explícito
    if (this.turnCount >= this.maxTurns) {
      throw new Error(`Exceeded max turns (${this.maxTurns}) without completing the task.`);
    }
    
    return this.history.getAll();
  }
}
