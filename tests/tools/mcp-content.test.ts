import { describe, it, expect } from 'vitest';
import { toolResultToMcpContent } from '../../src/tools/mcp-content';

describe('toolResultToMcpContent', () => {
  it('maps text results to a single text part', () => {
    expect(toolResultToMcpContent({ id: 'c1', text: 'OK' })).toEqual([{ type: 'text', text: 'OK' }]);
  });

  it('labels images png by default', () => {
    expect(toolResultToMcpContent({ id: 'c1', text: 'OK', base64_image: 'AAA' })).toEqual([
      { type: 'text', text: 'OK' },
      { type: 'image', data: 'AAA', mimeType: 'image/png' },
    ]);
  });

  it('labels stream frames jpeg (ADR-0005 fast path)', () => {
    expect(
      toolResultToMcpContent({ id: 'c1', base64_image: 'BBB', imageFormat: 'jpeg' }),
    ).toEqual([{ type: 'image', data: 'BBB', mimeType: 'image/jpeg' }]);
  });

  it('falls back to a Success text when the result is empty', () => {
    expect(toolResultToMcpContent({ id: 'c1' })).toEqual([{ type: 'text', text: 'Success' }]);
  });
});
