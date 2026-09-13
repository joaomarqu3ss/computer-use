import { ToolCall, ToolResult } from '../types';

export interface OpenAiAction {
  type: "click" | "double_click" | "drag" | "move" | "scroll" | "type" | "wait" | "keypress" | "screenshot";
  button?: "left" | "right" | "middle";
  x?: number;
  y?: number;
  path?: Array<[number, number] | { x: number; y: number }>;
  scroll_x?: number;
  scroll_y?: number;
  keys?: string[];
  text?: string;
}

export interface OpenAiComputerCall {
  type: "computer_call";
  call_id: string;
  actions: OpenAiAction[];
  status?: string;
}

export interface OpenAiComputerCallOutput {
  type: "computer_call_output";
  call_id: string;
  output: string | { type: "computer_screenshot"; image_url: string; detail?: "original" };
}

export function fromOpenAi(calls: OpenAiComputerCall[]): ToolCall[] {
  const result: ToolCall[] = [];
  
  for (const call of calls) {
    if (!call.actions) continue;
    
    for (let i = 0; i < call.actions.length; i++) {
      const action = call.actions[i];
      const id = `${call.call_id}_${i}`;
      
      switch (action.type) {
        case "click": {
          let member: "left_click" | "right_click" | "middle_click" = "left_click";
          if (action.button === "right") member = "right_click";
          if (action.button === "middle") member = "middle_click";
          
          result.push({
            id,
            member,
            input: {
              ...(action.x !== undefined && action.y !== undefined ? { coordinate: [action.x, action.y] } : {})
            }
          });
          break;
        }
        case "double_click":
          result.push({
            id,
            member: "double_click",
            input: {
              ...(action.x !== undefined && action.y !== undefined ? { coordinate: [action.x, action.y] } : {})
            }
          });
          break;
        case "drag": {
          // Normalizing path to coordinates
          const path = action.path || [];
          if (path.length >= 2) {
            const first = path[0];
            const last = path[path.length - 1];
            
            const start_coordinate: [number, number] = Array.isArray(first) ? [first[0], first[1]] : [first.x, first.y];
            const coordinate: [number, number] = Array.isArray(last) ? [last[0], last[1]] : [last.x, last.y];
            
            result.push({
              id,
              member: "left_click_drag",
              input: { start_coordinate, coordinate }
            });
          }
          break;
        }
        case "move":
          if (action.x !== undefined && action.y !== undefined) {
            result.push({
              id,
              member: "mouse_move",
              input: { coordinate: [action.x, action.y] }
            });
          }
          break;
        case "scroll": {
          const scroll_x = action.scroll_x || 0;
          const scroll_y = action.scroll_y || 0;
          
          let direction: "up" | "down" | "left" | "right" = "down";
          let amount = Math.max(1, Math.abs(Math.round(scroll_y / 100)));
          
          if (scroll_y !== 0) {
            direction = scroll_y < 0 ? "up" : "down";
            amount = Math.max(1, Math.abs(Math.round(scroll_y / 100)));
          } else if (scroll_x !== 0) {
            direction = scroll_x < 0 ? "left" : "right";
            amount = Math.max(1, Math.abs(Math.round(scroll_x / 100)));
          }
          
          result.push({
            id,
            member: "scroll",
            input: {
              scroll_direction: direction,
              scroll_amount: amount,
              ...(action.x !== undefined && action.y !== undefined ? { coordinate: [action.x, action.y] } : {})
            }
          });
          break;
        }
        case "type":
          result.push({
            id,
            member: "type",
            input: { text: action.text || "" }
          });
          break;
        case "wait":
          result.push({
            id,
            member: "wait",
            input: { duration: 2 } // Default for OpenAI is usually short pause
          });
          break;
        case "keypress": {
          const keys = action.keys || [];
          result.push({
            id,
            member: "key",
            input: { text: keys.join("+") }
          });
          break;
        }
        case "screenshot":
          result.push({
            id,
            member: "screenshot",
            input: {}
          });
          break;
      }
    }
  }
  
  return result;
}

export function toOpenAi(results: ToolResult[]): OpenAiComputerCallOutput[] {
  // We group by the original call_id (which is everything before the last underscore)
  const grouped = new Map<string, ToolResult[]>();
  
  for (const result of results) {
    const lastUnderscore = result.id.lastIndexOf('_');
    const call_id = lastUnderscore !== -1 ? result.id.substring(0, lastUnderscore) : result.id;
    
    if (!grouped.has(call_id)) {
      grouped.set(call_id, []);
    }
    grouped.get(call_id)!.push(result);
  }
  
  const outputs: OpenAiComputerCallOutput[] = [];
  
  for (const [call_id, groupResults] of grouped.entries()) {
    // Check if any error occurred
    const errorResult = groupResults.find(r => r.is_error);
    
    if (errorResult) {
      outputs.push({
        type: "computer_call_output",
        call_id,
        output: errorResult.error || "Error executing actions"
      });
      continue;
    }
    
    // Find the last image, if any
    const imageResult = groupResults.slice().reverse().find(r => r.base64_image);
    
    if (imageResult) {
      outputs.push({
        type: "computer_call_output",
        call_id,
        output: {
          type: "computer_screenshot",
          image_url: `data:image/png;base64,${imageResult.base64_image}`,
          detail: "original"
        }
      });
    } else {
      // If no image and no error, just return OK
      outputs.push({
        type: "computer_call_output",
        call_id,
        output: "OK"
      });
    }
  }
  
  return outputs;
}
