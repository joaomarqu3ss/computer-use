import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

type OpencodeExample = {
  mcp?: { 'computer-use'?: { type?: unknown; command?: unknown; enabled?: unknown } };
};

// Seam: envelope MCP do cliente Opencode (arquivo que o opencode lê).
// Fonte de verdade independente: formato documentado do opencode 1.x
// (mcp.<nome> com type local + command array + enabled) e a exigência
// da issue #9 de não conter paths absolutos de máquina.
function readExample(): { raw: string; json: OpencodeExample } {
  const raw = readFileSync(join(__dirname, '../../opencode.jsonc.example'), 'utf8');
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  return { raw, json: JSON.parse(stripped) };
}

describe('opencode MCP envelope (issue #9)', () => {
  it('exists with the computer-use server in opencode 1.x shape', () => {
    const { json } = readExample();
    const server = json?.mcp?.['computer-use'];
    expect(server).toBeDefined();
    expect(server?.type).toBe('local');
    const command = server?.command as unknown[];
    expect(Array.isArray(command)).toBe(true);
    expect(command[0]).toBe('node');
    expect(String(command[1])).toMatch(/dist\/src\/mcp-server\.js$/);
    expect(server?.enabled).toBe(true);
  });

  it('carries no absolute machine paths', () => {
    const { raw } = readExample();
    expect(raw).not.toMatch(/\/Users\//);
    expect(raw).not.toMatch(/\/home\//);
    expect(raw).toMatch(/<caminho-do-repo>/);
  });
});
