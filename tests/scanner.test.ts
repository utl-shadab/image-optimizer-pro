import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scanDirectory } from '../src/core/scanner';
import {
  cleanupTempDirectories,
  createImageFixture,
  createTempDirectory,
  setFileTimestamp,
} from './helpers';

const tempDirectories: string[] = [];

describe('scanDirectory', () => {
  afterEach(async () => {
    await cleanupTempDirectories(tempDirectories);
  });

  it('finds supported files and skips excluded directories', async () => {
    const rootDir = await createTempDirectory('image-optimizer-pro-scanner-', tempDirectories);

    await fs.mkdir(path.join(rootDir, 'nested'), { recursive: true });
    await fs.mkdir(path.join(rootDir, 'node_modules'), { recursive: true });
    await fs.mkdir(path.join(rootDir, '.git'), { recursive: true });

    await fs.writeFile(path.join(rootDir, 'hero.png'), 'png');
    await fs.writeFile(path.join(rootDir, 'nested', 'gallery.jpeg'), 'jpeg');
    await fs.writeFile(path.join(rootDir, 'nested', 'poster.webp'), 'webp');
    await fs.writeFile(path.join(rootDir, 'notes.txt'), 'skip');
    await fs.writeFile(path.join(rootDir, 'node_modules', 'ignore.jpg'), 'skip');
    await fs.writeFile(path.join(rootDir, '.git', 'hidden.png'), 'skip');

    const files = await scanDirectory(rootDir, {
      include: ['**/*'],
      exclude: ['node_modules', '.git'],
    });

    expect(files.map((file) => file.relativePath)).toEqual([
      'hero.png',
      'nested/gallery.jpeg',
      'nested/poster.webp',
    ]);
  });

  it('filters generated same-directory webp fallbacks and keeps real webp sources', async () => {
    const rootDir = await createTempDirectory('image-optimizer-pro-scanner-', tempDirectories);
    const sourcePng = path.join(rootDir, 'hero.png');
    const generatedWebp = path.join(rootDir, 'hero.webp');
    const realWebp = path.join(rootDir, 'standalone.webp');

    await createImageFixture(sourcePng, { format: 'png' });
    const sourceStats = await fs.stat(sourcePng);

    await createImageFixture(generatedWebp, { format: 'webp' });
    await setFileTimestamp(generatedWebp, sourceStats.mtimeMs);

    await createImageFixture(realWebp, { format: 'webp' });

    const files = await scanDirectory(rootDir, {
      include: ['**/*'],
      exclude: [],
    });

    expect(files.map((file) => file.relativePath)).toEqual(['hero.png', 'standalone.webp']);
  });

  it('does not drop legitimate webp files that share a stem with another source', async () => {
    const rootDir = await createTempDirectory('image-optimizer-pro-scanner-', tempDirectories);
    const pngPath = path.join(rootDir, 'shared.png');
    const webpPath = path.join(rootDir, 'shared.webp');

    await createImageFixture(pngPath, { format: 'png' });
    await createImageFixture(webpPath, { format: 'webp' });

    const pngStats = await fs.stat(pngPath);
    await setFileTimestamp(webpPath, pngStats.mtimeMs + 200);

    const files = await scanDirectory(rootDir, {
      include: ['**/*'],
      exclude: [],
    });

    expect(files.map((file) => file.relativePath)).toEqual(['shared.png', 'shared.webp']);
  });
});
