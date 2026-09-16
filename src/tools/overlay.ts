import { Member, ToolCall } from './types';

export type OverlayPulseColor = 'blue' | 'purple' | 'gray';

export type OverlayTrail = {
  from: [number, number];
  to: [number, number];
};

export type OverlayPulse = {
  color: OverlayPulseColor;
  pulses: number;
  trail?: OverlayTrail;
};

export type OverlayEvent = {
  member: Member;
  coordinate?: [number, number];
  pulse: OverlayPulse | null;
};

function clickEvent(
  member: Member,
  coordinate: [number, number] | undefined,
  color: OverlayPulseColor,
  pulses: number,
  trail?: OverlayTrail,
): OverlayEvent {
  return { member, coordinate, pulse: { color, pulses, ...(trail ? { trail } : {}) } };
}

/**
 * Maps a canonical ToolCall to the overlay halo/pulse to draw (Q14).
 * Returns null for members with no pointer presence on screen.
 * The sidecar resolves an undefined coordinate to the current cursor.
 */
export function describeOverlayEvent(call: ToolCall): OverlayEvent | null {
  switch (call.member) {
    case 'left_click':
      return clickEvent(call.member, call.input.coordinate, 'blue', 1);
    case 'right_click':
      return clickEvent(call.member, call.input.coordinate, 'purple', 1);
    case 'middle_click':
      return clickEvent(call.member, call.input.coordinate, 'gray', 1);
    case 'double_click':
      return clickEvent(call.member, call.input.coordinate, 'blue', 2);
    case 'triple_click':
      return clickEvent(call.member, call.input.coordinate, 'blue', 3);
    case 'left_click_drag':
      return clickEvent(call.member, call.input.coordinate, 'blue', 1, {
        from: call.input.start_coordinate,
        to: call.input.coordinate,
      });
    case 'mouse_move':
      return { member: call.member, coordinate: call.input.coordinate, pulse: null };
    default:
      return null;
  }
}
