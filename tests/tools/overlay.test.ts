import { describe, it, expect } from 'vitest';
import { describeOverlayEvent } from '../../src/tools/overlay';
import { ToolCall } from '../../src/tools/types';

describe('describeOverlayEvent (Q14 pulse mapping)', () => {
  it('maps left_click with coordinate to a single blue pulse', () => {
    const call: ToolCall = { id: 'c1', member: 'left_click', input: { coordinate: [100, 200] } };
    expect(describeOverlayEvent(call)).toEqual({
      member: 'left_click',
      coordinate: [100, 200],
      pulse: { color: 'blue', pulses: 1 },
    });
  });

  it('maps left_click without coordinate (current cursor) with undefined coordinate', () => {
    const call: ToolCall = { id: 'c2', member: 'left_click', input: {} };
    expect(describeOverlayEvent(call)).toEqual({
      member: 'left_click',
      coordinate: undefined,
      pulse: { color: 'blue', pulses: 1 },
    });
  });

  it('maps right_click to purple and middle_click to gray', () => {
    expect(
      describeOverlayEvent({ id: 'c3', member: 'right_click', input: { coordinate: [1, 2] } }),
    ).toEqual({ member: 'right_click', coordinate: [1, 2], pulse: { color: 'purple', pulses: 1 } });
    expect(describeOverlayEvent({ id: 'c4', member: 'middle_click', input: {} })).toEqual({
      member: 'middle_click',
      coordinate: undefined,
      pulse: { color: 'gray', pulses: 1 },
    });
  });

  it('maps double/triple clicks to multi-pulse blue', () => {
    const dbl: ToolCall = { id: 'c5', member: 'double_click', input: {} };
    const tpl: ToolCall = { id: 'c6', member: 'triple_click', input: { coordinate: [9, 9] } };
    expect(describeOverlayEvent(dbl)).toEqual({
      member: 'double_click',
      coordinate: undefined,
      pulse: { color: 'blue', pulses: 2 },
    });
    expect(describeOverlayEvent(tpl)).toEqual({
      member: 'triple_click',
      coordinate: [9, 9],
      pulse: { color: 'blue', pulses: 3 },
    });
  });

  it('maps left_click_drag to a blue pulse with trail from start to end', () => {
    const call: ToolCall = {
      id: 'c7',
      member: 'left_click_drag',
      input: { start_coordinate: [10, 20], coordinate: [30, 40] },
    };
    expect(describeOverlayEvent(call)).toEqual({
      member: 'left_click_drag',
      coordinate: [30, 40],
      pulse: { color: 'blue', pulses: 1, trail: { from: [10, 20], to: [30, 40] } },
    });
  });

  it('maps mouse_move to a move-only event without pulse', () => {
    const call: ToolCall = { id: 'c8', member: 'mouse_move', input: { coordinate: [5, 6] } };
    expect(describeOverlayEvent(call)).toEqual({
      member: 'mouse_move',
      coordinate: [5, 6],
      pulse: null,
    });
  });

  it('returns null for non-pointer members', () => {
    const calls: ToolCall[] = [
      { id: 's1', member: 'screenshot', input: {} },
      { id: 'z1', member: 'zoom', input: { region: [0, 0, 10, 10] } },
      { id: 't1', member: 'type', input: { text: 'hi' } },
      { id: 'k1', member: 'key', input: { text: 'enter' } },
      { id: 'w1', member: 'wait', input: { duration: 1 } },
      { id: 'p1', member: 'cursor_position', input: {} },
      { id: 'd1', member: 'left_mouse_down', input: {} },
      { id: 'u1', member: 'left_mouse_up', input: {} },
    ];
    for (const call of calls) {
      expect(describeOverlayEvent(call)).toBeNull();
    }
  });
});
