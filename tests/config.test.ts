import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadOptimizerConfig, resolveOptimizerConfig } from '../src/config';
import { cleanupTempDirectories, createTempDirectory } from './helpers';

const tempDirectories: string[] = [];

describe('config', () => {
  afterEach(async () => {
    await cleanupTempDirectories(tempDirectories);
  });

  it('loads configuration from image-optimizer.config.js', async () => {
    const rootDir = await createTempDirectory('image-optimizer-pro-config-', tempDirectories);

    await fs.writeFile(
      path.join(rootDir, 'image-optimizer.config.js'),
      `
      module.exports = {
        formats: ['webp'],
        concurrency: 2,
        outputDir: 'optimized',
        verbose: true
      };
      `,
      'utf8',
    );

    const loaded = await loadOptimizerConfig({ cwd: rootDir });

    expect(loaded.config.formats).toEqual(['webp']);
    expect(loaded.config.concurrency).toBe(2);
    expect(loaded.config.outputDir).toBe('optimized');
    expect(loaded.config.verbose).toBe(true);
  });

  it('merges config file values with runtime overrides', async () => {
    const rootDir = await createTempDirectory('image-optimizer-pro-config-', tempDirectories);

    await fs.writeFile(
      path.join(rootDir, 'image-optimizer.config.js'),
      `
      module.exports = {
        formats: ['webp'],
        concurrency: 2,
        outputDir: 'optimized'
      };
      `,
      'utf8',
    );

    const resolved = await resolveOptimizerConfig(rootDir, {
      concurrency: 4,
      dryRun: true,
    });

    expect(resolved.formats).toEqual(['webp']);
    expect(resolved.concurrency).toBe(4);
    expect(resolved.dryRun).toBe(true);
    expect(resolved.outputDir).toBe(path.join(rootDir, 'optimized'));
  });

  it('rejects output directories outside the root', async () => {
    const rootDir = await createTempDirectory('image-optimizer-pro-config-', tempDirectories);

    await expect(
      resolveOptimizerConfig(rootDir, {
        outputDir: '../escape',
      }),
    ).rejects.toThrow('outputDir must stay inside the input directory.');
  });

  it('rejects malformed config values', async () => {
    const rootDir = await createTempDirectory('image-optimizer-pro-config-', tempDirectories);

    await fs.writeFile(
      path.join(rootDir, 'image-optimizer.config.js'),
      `
      module.exports = {
        quality: { small: 'bad' },
        verbose: 'yes'
      };
      `,
      'utf8',
    );

    await expect(resolveOptimizerConfig(rootDir)).rejects.toThrow(
      'quality.small must be an integer between 1 and 100.',
    );
  });

  it('rejects non-array include and exclude values', async () => {
    const rootDir = await createTempDirectory('image-optimizer-pro-config-', tempDirectories);

    await fs.writeFile(
      path.join(rootDir, 'image-optimizer.config.js'),
      `
      module.exports = {
        include: '**/*'
      };
      `,
      'utf8',
    );

    await expect(resolveOptimizerConfig(rootDir)).rejects.toThrow(
      'include and exclude must be arrays of glob patterns.',
    );
  });
});
