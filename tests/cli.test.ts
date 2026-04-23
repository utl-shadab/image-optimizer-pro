import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/cli/index';
import {
  cleanupTempDirectories,
  createBufferWriter,
  createImageFixture,
  createTempDirectory,
} from './helpers';

const tempDirectories: string[] = [];

describe('CLI', () => {
  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
    await cleanupTempDirectories(tempDirectories);
  });

  it('processes images with verbose output', async () => {
    const rootDir = await createTempDirectory('image-optimizer-pro-cli-', tempDirectories);
    await createImageFixture(path.join(rootDir, 'hero.png'), { format: 'png' });

    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message: string) => {
      stdout.push(`${message}\n`);
    });

    const exitCode = await runCli([rootDir, '--verbose'], {
      stderr: createBufferWriter(stderr),
    });

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('[processed] hero.png');
    expect(await fileExists(path.join(rootDir, 'hero.avif'))).toBe(true);
    expect(await fileExists(path.join(rootDir, 'hero.webp'))).toBe(true);
  });

  it('supports dry-run mode from the CLI', async () => {
    const rootDir = await createTempDirectory('image-optimizer-pro-cli-', tempDirectories);
    await createImageFixture(path.join(rootDir, 'banner.jpg'), { format: 'jpeg' });

    const stdout: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message: string) => {
      stdout.push(`${message}\n`);
    });

    const exitCode = await runCli([rootDir, '--dry-run', '--verbose'], {
      stderr: createBufferWriter([]),
    });

    expect(exitCode).toBe(0);
    expect(stdout.join('')).toContain('mode dry-run');
    expect(await fileExists(path.join(rootDir, 'banner.avif'))).toBe(false);
    expect(await fileExists(path.join(rootDir, 'banner.webp'))).toBe(false);
  });

  it('returns an error for invalid format arguments', async () => {
    const rootDir = await createTempDirectory('image-optimizer-pro-cli-', tempDirectories);
    await createImageFixture(path.join(rootDir, 'hero.png'), { format: 'png' });

    const stderr: string[] = [];
    const exitCode = await runCli([rootDir, '--format', 'gif'], {
      stderr: createBufferWriter(stderr),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('')).toContain('Unsupported format "gif".');
  });

  it('returns an error when the target directory does not exist', async () => {
    const stderr: string[] = [];
    const exitCode = await runCli(['./missing-folder'], {
      stderr: createBufferWriter(stderr),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('')).toContain('Input directory does not exist');
  });
});

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}
