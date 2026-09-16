import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  setSessionSink,
  createSidecarDaemonSink,
  DaemonProcess,
  DaemonSpawner,
} from '../../src/tools/backend';

function makeFakeSpawner() {
  const lines: string[] = [];
  const calls: string[] = [];
  let failSpawn = false;
  let dir: string | null = null;
  const spawner: DaemonSpawner = (_path, _args, opts) => {
    calls.push('spawn');
    if (failSpawn) throw new Error('ENOENT');
    dir = opts.env.COMPUTER_USE_FRAME_DIR as string;
    calls.push(`env:${dir ? 'frame-dir' : 'none'}`);
    // Emulate the daemon: answer snap-frame by writing the frame file.
    const proc: DaemonProcess = {
      frameDir: dir,
      write: (line: string) => {
        lines.push(line);
        const cmd = JSON.parse(line) as { cmd: string; nonce?: string };
        if (cmd.cmd === 'snap-frame' && cmd.nonce && dir) {
          writeFileSync(join(dir, `frame-${cmd.nonce}.jpg`), 'fake-jpeg-bytes');
        }
      },
      close: () => void calls.push('close'),
      kill: () => void calls.push('kill'),
    };
    return proc;
  };
  return {
    lines,
    calls,
    spawner,
    dir: () => dir,
    fail(fail = true) { failSpawn = fail; },
  };
}

function cmds(lines: string[]): Array<Record<string, unknown>> {
  return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('SidecarDaemonSink (TS bridge to MacSidecar daemon)', () => {
  let dirs: string[] = [];
  beforeEach(() => {
    setSessionSink(null);
    dirs = [];
  });

  afterEach(() => {
    setSessionSink(null);
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('starts the overlay before the stream, tears down and cleans the frame dir', () => {
    const fake = makeFakeSpawner();
    const sink = createSidecarDaemonSink(fake.spawner);
    setSessionSink(sink);
    sink.start();
    const dir = fake.dir();
    if (dir) dirs.push(dir);
    sink.stop();

    expect(fake.calls[0]).toBe('spawn');
    expect(fake.calls).toContain('env:frame-dir');
    const sent = cmds(fake.lines);
    // Overlay first so the stream exclusion filter catches the window.
    expect(sent[0]).toMatchObject({ cmd: 'overlay-show' });
    expect(sent[1]).toMatchObject({ cmd: 'stream-start' });
    expect(sent[sent.length - 3]).toMatchObject({ cmd: 'overlay-hide' });
    expect(sent[sent.length - 2]).toMatchObject({ cmd: 'stream-stop' });
    expect(sent[sent.length - 1]).toMatchObject({ cmd: 'exit' });
    expect(fake.calls).toContain('close');
    expect(fake.calls).toContain('kill');
    expect(dir && existsSync(dir)).toBe(false);
  });

  it('forwards pointer actions as overlay-event lines', () => {
    const fake = makeFakeSpawner();
    const sink = createSidecarDaemonSink(fake.spawner);
    setSessionSink(sink);
    sink.start();
    const dir = fake.dir();
    if (dir) dirs.push(dir);
    sink.event({
      member: 'left_click',
      coordinate: [100, 200],
      pulse: { color: 'blue', pulses: 1 },
    });
    sink.event({ member: 'mouse_move', coordinate: [5, 6], pulse: null });
    sink.stop();

    const sent = cmds(fake.lines);
    expect(sent[2]).toEqual({
      cmd: 'overlay-event',
      member: 'left_click',
      coordinate: [100, 200],
      pulse: { color: 'blue', pulses: 1 },
    });
    expect(sent[3]).toEqual({ cmd: 'overlay-event', member: 'mouse_move', coordinate: [5, 6] });
  });

  it('snaps stream frames from the frame file', () => {
    const fake = makeFakeSpawner();
    const sink = createSidecarDaemonSink(fake.spawner);
    sink.start();
    const dir = fake.dir();
    if (dir) dirs.push(dir);
    const frame = sink.captureFrame?.();
    expect(frame?.base64_image).toBe(Buffer.from('fake-jpeg-bytes').toString('base64'));
    expect(frame?.imageFormat).toBe('jpeg');
    sink.stop();
  });

  it('passes zoom regions through to snap-frame', () => {
    const fake = makeFakeSpawner();
    const sink = createSidecarDaemonSink(fake.spawner);
    sink.start();
    const dir = fake.dir();
    if (dir) dirs.push(dir);
    sink.captureFrame?.([0, 0, 10, 10]);
    const sent = cmds(fake.lines);
    expect(sent[2]).toMatchObject({ cmd: 'snap-frame', region: [0, 0, 10, 10] });
    expect((sent[2].nonce as string) ?? '').toMatch(/^[0-9a-f]{16}$/);
    sink.stop();
  });

  it('returns null when no frame file appears (one-shot fallback)', () => {
    const silent: DaemonSpawner = (_path, _args, opts) => ({
      frameDir: (opts.env.COMPUTER_USE_FRAME_DIR as string) ?? null,
      write: () => {},
      close: () => {},
      kill: () => {},
    });
    const sink = createSidecarDaemonSink(silent, { frameWaitMs: 50 });
    sink.start();
    expect(sink.captureFrame?.()).toBeNull();
    sink.stop();
  });

  it('ignores events before start and after stop', () => {
    const fake = makeFakeSpawner();
    const sink = createSidecarDaemonSink(fake.spawner);
    sink.event({ member: 'left_click', coordinate: [1, 1], pulse: { color: 'blue', pulses: 1 } });
    expect(fake.lines).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it('a failed spawn degrades to silent no-op (overlay is best-effort)', () => {
    const fake = makeFakeSpawner();
    fake.fail(true);
    const sink = createSidecarDaemonSink(fake.spawner);
    expect(() => sink.start()).not.toThrow();
    expect(() => sink.event({ member: 'left_click', coordinate: [1, 1], pulse: { color: 'blue', pulses: 1 } })).not.toThrow();
    expect(sink.captureFrame?.()).toBeNull();
    expect(() => sink.stop()).not.toThrow();
    expect(fake.lines).toEqual([]);
  });

  it('start is idempotent while running', () => {
    const fake = makeFakeSpawner();
    const sink = createSidecarDaemonSink(fake.spawner);
    sink.start();
    sink.start();
    expect(fake.calls.filter((c) => c === 'spawn')).toHaveLength(1);
    const dir = fake.dir();
    if (dir) dirs.push(dir);
    sink.stop();
  });
});
