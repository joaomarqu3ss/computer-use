import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Seam: envelope MCP do cliente Hermes (trecho que o Hermes lê sob
// `mcp_servers:` em ~/.hermes/config.yaml, via `hermes mcp add`).
// Fonte de verdade independente: formato documentado no
// cli-config.yaml.example do Hermes (mcp_servers.<nome> com command + args)
// e a exigência da issue #13 de não conter paths absolutos de máquina.
function readExample(): string {
  return readFileSync(join(__dirname, '../../hermes-mcp.example.yaml'), 'utf8');
}

function lineIndex(lines: string[], re: RegExp): number {
  return lines.findIndex((l) => re.test(l));
}

describe('hermes MCP envelope (issue #13)', () => {
  it('exists with the computer-use server in hermes mcp_servers shape', () => {
    const lines = readExample().split('\n');
    const iServers = lineIndex(lines, /^mcp_servers:\s*$/);
    const iServer = lineIndex(lines, /^ {2}computer-use:\s*$/);
    const iCommand = lineIndex(lines, /^ {4}command:\s*node\s*$/);
    const iArgs = lineIndex(lines, /^ {4}args:\s*$/);
    const iArgItem = lineIndex(
      lines,
      /^ {6}-\s*<caminho-do-repo>\/dist\/src\/mcp-server\.js\s*$/,
    );
    const iEnabled = lineIndex(lines, /^ {4}enabled:\s*true\s*$/);
    for (const i of [iServers, iServer, iCommand, iArgs, iArgItem, iEnabled]) {
      expect(i).toBeGreaterThanOrEqual(0);
    }
    expect(iServers).toBeLessThan(iServer);
    expect(iServer).toBeLessThan(iCommand);
    expect(iServer).toBeLessThan(iArgs);
    expect(iArgs).toBeLessThan(iArgItem);
    expect(iServer).toBeLessThan(iEnabled);
  });

  it('carries no absolute machine paths', () => {
    const raw = readExample();
    expect(raw).not.toMatch(/\/Users\//);
    expect(raw).not.toMatch(/\/home\//);
    expect(raw).toMatch(/<caminho-do-repo>/);
  });
});
