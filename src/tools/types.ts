export type Toolset = "computer_toolset_20260801" | "computer";

export type Member = 
  | "screenshot"
  | "zoom"
  | "left_click"
  | "right_click"
  | "middle_click"
  | "double_click"
  | "triple_click"
  | "left_click_drag"
  | "mouse_move"
  | "left_mouse_down"
  | "left_mouse_up"
  | "cursor_position"
  | "scroll"
  | "type"
  | "key"
  | "hold_key"
  | "wait";

export type ToolCall =
  | { id: string; member: "screenshot"; input: Record<string, never> }
  | { id: string; member: "zoom"; input: { region: [number, number, number, number] } }
  | { id: string; member: "left_click"; input: { coordinate?: [number, number]; text?: string } }
  | { id: string; member: "right_click"; input: { coordinate?: [number, number]; text?: string } }
  | { id: string; member: "middle_click"; input: { coordinate?: [number, number]; text?: string } }
  | { id: string; member: "double_click"; input: { coordinate?: [number, number]; text?: string } }
  | { id: string; member: "triple_click"; input: { coordinate?: [number, number]; text?: string } }
  | { id: string; member: "left_click_drag"; input: { start_coordinate: [number, number]; coordinate: [number, number]; text?: string } }
  | { id: string; member: "mouse_move"; input: { coordinate: [number, number] } }
  | { id: string; member: "left_mouse_down"; input: Record<string, never> }
  | { id: string; member: "left_mouse_up"; input: Record<string, never> }
  | { id: string; member: "cursor_position"; input: Record<string, never> }
  | { id: string; member: "scroll"; input: { scroll_direction: "up" | "down" | "left" | "right"; scroll_amount: number; coordinate?: [number, number]; text?: string } }
  | { id: string; member: "type"; input: { text: string } }
  | { id: string; member: "key"; input: { text: string; repeat?: number } }
  | { id: string; member: "hold_key"; input: { text: string; duration: number } }
  | { id: string; member: "wait"; input: { duration: number } };

export type ToolResult = {
  id: string; // corresponds to the ToolCall id
  is_error?: boolean;
  error?: string;
  text?: string;
  base64_image?: string;
  toolset_name?: string;
};

// Ownership: the agent loop emits canonical ToolCalls/ToolResults WITHOUT
// toolset_name. Provider adapters attach it (Anthropic: "computer").

// Placeholder recorded for batch actions skipped after the first failure.
export const NOT_EXECUTED_MESSAGE =
  'Not executed: an earlier computer action in this turn failed.';
