import { spawnSync } from 'child_process';
import { join } from 'path';
import { ToolCall, ToolResult } from './types';

// O executável MacSidecar foi compilado em src/sidecar/.build/release/MacSidecar
const SIDECAR_PATH = join(__dirname, __dirname.includes('dist') ? '../../../src/sidecar/.build/release/MacSidecar' : '../../src/sidecar/.build/release/MacSidecar');

/**
 * Executa uma chamada de ferramenta nativa delegando para o sidecar do macOS.
 */
export function executeCanonicalCall(call: ToolCall): ToolResult {
  const result = spawnSync(SIDECAR_PATH, [JSON.stringify(call)], {
    encoding: 'utf8',
  });

  if (result.error) {
    return {
      id: call.id,
      is_error: true,
      error: `Failed to spawn sidecar: ${result.error.message}`,
    };
  }

  const output = result.stdout ? result.stdout.trim() : null;
  if (!output) {
    return {
      id: call.id,
      is_error: true,
      error: `Sidecar returned empty output. Stderr: ${result.stderr}`,
    };
  }

  try {
    const parsed = JSON.parse(output);
    return parsed as ToolResult;
  } catch (_e) {
    return {
      id: call.id,
      is_error: true,
      error: `Failed to parse sidecar output: ${output}`,
    };
  }
}

/**
 * Checa se as permissões de Acessibilidade e Gravação de Tela estão concedidas.
 * Mensagens de erro/guia serão printadas no stderr do sidecar.
 */
export function checkPermissions(): boolean {
  const result = spawnSync(SIDECAR_PATH, ['check-permissions'], {
    encoding: 'utf8',
  });
  
  if (result.error) {
    console.error(`Failed to execute sidecar: ${result.error.message}`);
    return false;
  }
  
  if (result.stderr && result.stderr.trim().length > 0) {
    console.error(result.stderr.trim());
  }
  
  return result.stdout ? result.stdout.trim() === 'true' : false;
}
