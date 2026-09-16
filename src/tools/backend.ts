import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { ToolCall, ToolResult } from './types';
import { describeOverlayEvent, OverlayEvent } from './overlay';

// O executável MacSidecar foi compilado em src/sidecar/.build/release/MacSidecar
const SIDECAR_PATH = join(__dirname, __dirname.includes('dist') ? '../../../src/sidecar/.build/release/MacSidecar' : '../../src/sidecar/.build/release/MacSidecar');

/**
 * Executa uma chamada de ferramenta nativa delegando para o sidecar do macOS.
 * Screenshot/zoom preferem o frame do stream contínuo quando há sessão ativa
 * (milissegundos, sem handshake SCK por chamada); o fallback é o one-shot.
 */
export function executeCanonicalCall(call: ToolCall): ToolResult {
  const streamFrame = readStreamFrame(call);
  if (streamFrame) return streamFrame;

  const result = spawnSync(SIDECAR_PATH, [JSON.stringify(call)], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
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
  } catch {
    return {
      id: call.id,
      is_error: true,
      error: `Failed to parse sidecar output: ${output}`,
    };
  }
}

/**
 * Best-effort overlay session (ADR-0005): the AgentLoop owns the lifecycle
 * (start on run, stop at the end), the sidecar daemon renders. Overlay must
 * never break actions, so sink failures are logged and swallowed.
 */
export type SessionSink = {
  start(): void;
  event(event: OverlayEvent): void;
  stop(): void;
  /** Latest stream frame, or null when unavailable (caller falls back). */
  captureFrame?(region?: [number, number, number, number]): ToolResult | null;
};

let sessionSink: SessionSink | null = null;
let sessionActive = false;

function swallow(stage: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error(`Session sink ${stage} failed (ignored): ${err instanceof Error ? err.message : err}`);
  }
}

export function setSessionSink(sink: SessionSink | null): void {
  sessionSink = sink;
  if (sink === null) sessionActive = false;
}

export function startSession(): void {
  sessionActive = true;
  const sink = sessionSink;
  if (sink) swallow('start', () => sink.start());
}

export function stopSession(): void {
  sessionActive = false;
  const sink = sessionSink;
  if (sink) swallow('stop', () => sink.stop());
}

export function isSessionActive(): boolean {
  return sessionActive;
}

export function notifyAction(call: ToolCall): void {
  if (!sessionActive || !sessionSink) return;
  const event = describeOverlayEvent(call);
  if (!event) return;
  const sink = sessionSink;
  swallow('event', () => sink.event(event));
}

/** Screenshot/zoom via the live stream when a session sink offers frames. */
function readStreamFrame(call: ToolCall): ToolResult | null {
  if (isLegacyCapture()) return null;
  if (!sessionActive) return null;
  const sink = sessionSink;
  if (!sink?.captureFrame) return null;
  const region = call.member === 'zoom' ? call.input.region : undefined;
  if (call.member !== 'screenshot' && call.member !== 'zoom') return null;
  try {
    const frame = sink.captureFrame(region);
    if (!frame || frame.is_error || !frame.base64_image) return null;
    return { ...frame, id: call.id };
  } catch {
    return null;
  }
}

/**
 * Hidden legacy opt-in: '1' keeps the one-shot CGDisplay capture path.
 * Default (unset/anything else) is the ScreenCaptureKit stream path.
 */
export function isLegacyCapture(): boolean {
  return process.env.COMPUTER_USE_LEGACY_CAPTURE === '1';
}

/** Minimal handle the daemon sink needs; structural so tests can fake it. */
export type DaemonProcess = {
  write(line: string): void;
  close(): void;
  kill(): void;
  /** Directory the daemon snapshots stream frames into (snap-frame). */
  frameDir: string | null;
};

export type DaemonSpawner = (
  path: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv },
) => DaemonProcess;

export type DaemonSinkOptions = {
  /** How long to wait for a snapped frame file before one-shot fallback. */
  frameWaitMs?: number;
};

function nodeDaemonSpawner(path: string, args: string[], opts: { env: NodeJS.ProcessEnv }): DaemonProcess {
  const frameDir = opts.env.COMPUTER_USE_FRAME_DIR ?? null;
  const child = spawn(path, args, { env: opts.env, stdio: ['pipe', 'ignore', 'ignore'] });
  return {
    frameDir,
    write: (line: string) => {
      child.stdin?.write(line + '\n');
    },
    close: () => {
      child.stdin?.end();
    },
    kill: () => {
      child.kill();
    },
  };
}

function sleepMs(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // best-effort pacing only
  }
}

/**
 * Production SessionSink (ADR-0005, seam Q10-A): spawns one `MacSidecar
 * daemon` per session. The daemon holds the SCStream (system indicator) and
 * renders the halo; screenshots are snapped from the stream buffer to a frame
 * file (sync fs polling, no stdout RPC — Node 24 sockets expose no sync fd).
 * Best-effort throughout: spawn, write or snap failures degrade to one-shot
 * capture, never to failed actions.
 */
export function createSidecarDaemonSink(
  spawner: DaemonSpawner = nodeDaemonSpawner,
  opts: DaemonSinkOptions = {},
): SessionSink {
  const frameWaitMs = opts.frameWaitMs ?? 6000;
  let daemon: DaemonProcess | null = null;
  let ownedDir: string | null = null;

  const sendLine = (obj: unknown): void => {
    if (!daemon) return;
    try {
      daemon.write(JSON.stringify(obj));
    } catch {
      // best-effort: a dead pipe must not break the batch
    }
  };

  const waitForFile = (path: string): boolean => {
    const deadline = Date.now() + frameWaitMs;
    while (Date.now() < deadline) {
      try {
        if (existsSync(path)) return true;
      } catch {
        return false;
      }
      sleepMs(25);
    }
    try {
      return existsSync(path);
    } catch {
      return false;
    }
  };

  return {
    start: () => {
      if (daemon) return;
      try {
        ownedDir = mkdtempSync(join(tmpdir(), 'cu-frames-'));
        daemon = spawner(SIDECAR_PATH, ['daemon'], {
          env: { ...process.env, COMPUTER_USE_FRAME_DIR: ownedDir },
        });
      } catch {
        daemon = null;
        ownedDir = null;
        return;
      }
      // Overlay first: the window must exist before the stream starts so the
      // exclusion filter (by window number) actually catches it.
      sendLine({ cmd: 'overlay-show' });
      sendLine({ cmd: 'stream-start' });
    },
    event: (event: OverlayEvent) => {
      if (!daemon) return;
      sendLine({
        cmd: 'overlay-event',
        member: event.member,
        ...(event.coordinate ? { coordinate: event.coordinate } : {}),
        ...(event.pulse ? { pulse: event.pulse } : {}),
      });
    },
    captureFrame: (region?: [number, number, number, number]): ToolResult | null => {
      if (!daemon?.frameDir) return null;
      const nonce = randomBytes(8).toString('hex');
      const target = join(daemon.frameDir, `frame-${nonce}.jpg`);
      try {
        sendLine({ cmd: 'snap-frame', nonce, ...(region ? { region } : {}) });
        if (!waitForFile(target)) return null;
        const data = readFileSync(target);
        try {
          unlinkSync(target);
        } catch {
          // ignore cleanup failure
        }
        if (data.length === 0) return null;
        return { id: '', base64_image: data.toString('base64'), imageFormat: 'jpeg' };
      } catch {
        return null;
      }
    },
    stop: () => {
      if (!daemon) return;
      sendLine({ cmd: 'overlay-hide' });
      sendLine({ cmd: 'stream-stop' });
      sendLine({ cmd: 'exit' });
      try {
        daemon.close();
      } catch {
        // ignored
      }
      // Grace for stopCapture/terminate before the backstop kill, so the
      // stream and overlay are released gracefully instead of SIGKILLed.
      sleepMs(200);
      try {
        daemon.kill();
      } catch {
        // ignored
      }
      daemon = null;
      if (ownedDir) {
        try {
          rmSync(ownedDir, { recursive: true, force: true });
        } catch {
          // ignored
        }
        ownedDir = null;
      }
    },
  };
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
