import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { optimizeImages } from '../src';
import {
  cleanupTempDirectories,
  createImageFixture,
  createTempDirectory,
  setFileTimestamp,
} from './helpers';

const tempDirectories: string[] = [];

describe('optimizeImages', () => {
  afterEach(async () => {
    await cleanupTempDirectories(tempDirectories);
  });

  it('generates avif and webp outputs and skips up-to-date assets on re-run', async () => {
    const rootDir = await createTempDirectory('image-optimizer-pro-optimizer-', tempDirectories);
    const sourcePath = path.join(rootDir, 'hero.png');

    await createImageFixture(sourcePath, { format: 'png' });

    const firstRun = await optimizeImages(rootDir, {
      concurrency: 1,
      silent: true,
    });

    expect(firstRun.stats.processedFiles).toBe(1);
    expect(firstRun.stats.generatedFiles).toBeGreaterThanOrEqual(2);
    expect(await fileExists(path.join(rootDir, 'hero.avif'))).toBe(true);
    expect(await fileExists(path.join(rootDir, 'hero.webp'))).toBe(true);

    const secondRun = await optimizeImages(rootDir, {
      concurrency: 1,
      silent: true,
    });

    expect(secondRun.stats.skippedFiles).toBe(1);
    expect(secondRun.stats.generatedFiles).toBe(0);
  });

  it('supports dry-run mode without writing files', async () => {
    const rootDir = await createTempDirectory('image-optimizer-pro-optimizer-', tempDirectories);
    const sourcePath = path.join(rootDir, 'mockup.jpg');

    await createImageFixture(sourcePath, {
      format: 'jpeg',
      width: 240,
      height: 240,
      background: '#264653',
    });

    const result = await optimizeImages(rootDir, {
      dryRun: true,
      silent: true,
    });

    expect(result.stats.processedFiles).toBe(1);
    expect(await fileExists(path.join(rootDir, 'mockup.avif'))).toBe(false);
    expect(await fileExists(path.join(rootDir, 'mockup.webp'))).toBe(false);
  });

  it('isolates corrupted image failures without crashing the full run', async () => {
    const rootDir = await createTempDirectory('image-optimizer-pro-optimizer-', tempDirectories);

    await createImageFixture(path.join(rootDir, 'valid.png'), { format: 'png' });
    await fs.writeFile(path.join(rootDir, 'broken.jpg'), 'not-an-image', 'utf8');

    const result = await optimizeImages(rootDir, {
      concurrency: 1,
      silent: true,
    });

    expect(result.stats.processedFiles).toBe(1);
    expect(result.stats.errorFiles).toBe(1);
    expect(await fileExists(path.join(rootDir, 'valid.avif'))).toBe(true);
  });

  it('keeps real webp inputs and generates avif for them', async () => {
    const rootDir = await createTempDirectory('image-optimizer-pro-optimizer-', tempDirectories);
    const pngPath = path.join(rootDir, 'shared.png');
    const webpPath = path.join(rootDir, 'shared.webp');

    await createImageFixture(pngPath, { format: 'png' });
    await createImageFixture(webpPath, { format: 'webp' });

    const pngStats = await fs.stat(pngPath);
    await setFileTimestamp(webpPath, pngStats.mtimeMs + 200);

    const result = await optimizeImages(rootDir, {
      formats: ['avif'],
      silent: true,
    });

    expect(result.stats.processedFiles).toBe(2);
    expect(await fileExists(path.join(rootDir, 'shared.png.avif'))).toBe(true);
    expect(await fileExists(path.join(rootDir, 'shared.webp.avif'))).toBe(true);
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
