import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { optimizeImages } from '../src';
import { runCli } from '../src/cli/index';
import {
  cleanupTempDirectories,
  createBufferWriter,
  createImageFixture,
  createTempDirectory,
} from './helpers';

const tempDirectories: string[] = [];

describe('build-time reference rewriting', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTempDirectories(tempDirectories);
  });

  it('generates manifest entries with public paths for inputs under public', async () => {
    const projectDir = await createTempDirectory('image-optimizer-pro-rewrite-', tempDirectories);
    const inputRoot = path.join(projectDir, 'public', 'foldername');

    await fs.mkdir(inputRoot, { recursive: true });
    await createImageFixture(path.join(inputRoot, '1.jpg'), { format: 'jpeg' });

    const result = await optimizeImages(inputRoot, {
      formats: ['webp'],
      manifest: true,
      concurrency: 1,
      silent: true,
    });
    const entry = result.manifest?.[0];
    const output = entry?.outputs[0];

    expect(entry?.sourceAbsolutePath).toBe(path.join(inputRoot, '1.jpg'));
    expect(entry?.sourceRelativePath).toBe('foldername/1.jpg');
    expect(output?.format).toBe('webp');
    expect(output?.relativePath).toBe('foldername/1.webp');
    expect(output?.publicPath).toBe('/foldername/1.webp');
    expect(await fileExists(path.join(inputRoot, 'image-optimizer.manifest.json'))).toBe(true);
  });

  it('rewrites static references from the CLI', async () => {
    const projectDir = await createTempDirectory('image-optimizer-pro-rewrite-', tempDirectories);
    const inputRoot = path.join(projectDir, 'public', 'foldername');
    const srcDir = path.join(projectDir, 'src');
    const appPath = path.join(srcDir, 'App.tsx');

    await fs.mkdir(inputRoot, { recursive: true });
    await fs.mkdir(srcDir, { recursive: true });
    await createImageFixture(path.join(inputRoot, '1.jpg'), { format: 'jpeg' });
    await createImageFixture(path.join(inputRoot, '4.png'), { format: 'png' });
    await createImageFixture(path.join(inputRoot, '5.jpeg'), { format: 'jpeg' });
    await fs.writeFile(
      appPath,
      [
        'const one = "/foldername/1.jpg";',
        "const four = '/foldername/4.png';",
        'const five = `/foldername/5.jpeg`;',
      ].join('\n'),
      'utf8',
    );

    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const stderr: string[] = [];
    const exitCode = await runCli([inputRoot, '--format', 'webp', '--rewrite', srcDir], {
      stderr: createBufferWriter(stderr),
    });
    const rewritten = await fs.readFile(appPath, 'utf8');

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(rewritten).toContain('"/foldername/1.webp"');
    expect(rewritten).toContain("'/foldername/4.webp'");
    expect(rewritten).toContain('`/foldername/5.webp`');
    expect(await fileExists(path.join(inputRoot, '1.webp'))).toBe(true);
    expect(await fileExists(path.join(inputRoot, '4.webp'))).toBe(true);
    expect(await fileExists(path.join(inputRoot, '5.webp'))).toBe(true);
  });

  it('preserves quote styles for static string literals', async () => {
    const { inputRoot, srcDir, appPath } = await createRewriteProject();

    await createImageFixture(path.join(inputRoot, '1.jpg'), { format: 'jpeg' });
    await createImageFixture(path.join(inputRoot, '2.png'), { format: 'png' });
    await createImageFixture(path.join(inputRoot, '3.jpeg'), { format: 'jpeg' });
    await fs.writeFile(
      appPath,
      [
        'const double = "/foldername/1.jpg";',
        "const single = '/foldername/2.png';",
        'const template = `/foldername/3.jpeg`;',
      ].join('\n'),
      'utf8',
    );

    await optimizeImages(inputRoot, {
      formats: ['webp'],
      rewrite: { targets: [srcDir] },
      concurrency: 1,
      silent: true,
    });
    const rewritten = await fs.readFile(appPath, 'utf8');

    expect(rewritten).toContain('const double = "/foldername/1.webp";');
    expect(rewritten).toContain("const single = '/foldername/2.webp';");
    expect(rewritten).toContain('const template = `/foldername/3.webp`;');
  });

  it('rewrites safe relative references', async () => {
    const { inputRoot, srcDir, appPath } = await createRewriteProject();

    await createImageFixture(path.join(inputRoot, '1.jpg'), { format: 'jpeg' });
    await createImageFixture(path.join(inputRoot, '2.png'), { format: 'png' });
    await fs.writeFile(
      appPath,
      ['const local = "./foldername/1.jpg";', 'const parent = "../foldername/2.png";'].join('\n'),
      'utf8',
    );

    await optimizeImages(inputRoot, {
      formats: ['webp'],
      rewrite: { targets: [srcDir] },
      concurrency: 1,
      silent: true,
    });
    const rewritten = await fs.readFile(appPath, 'utf8');

    expect(rewritten).toContain('const local = "./foldername/1.webp";');
    expect(rewritten).toContain('const parent = "../foldername/2.webp";');
  });

  it('does not touch dynamic template literals', async () => {
    const { inputRoot, srcDir, appPath } = await createRewriteProject();

    await createImageFixture(path.join(inputRoot, '1.jpg'), { format: 'jpeg' });
    await fs.writeFile(
      appPath,
      'const image = `/foldername/${id}.jpg`;\nconst staticImage = "/foldername/1.jpg";\n',
      'utf8',
    );

    await optimizeImages(inputRoot, {
      formats: ['webp'],
      rewrite: { targets: [srcDir] },
      concurrency: 1,
      silent: true,
    });
    const rewritten = await fs.readFile(appPath, 'utf8');

    expect(rewritten).toContain('const image = `/foldername/${id}.jpg`;');
    expect(rewritten).toContain('const staticImage = "/foldername/1.webp";');
  });

  it('is idempotent on repeated runs', async () => {
    const { inputRoot, srcDir, appPath } = await createRewriteProject();

    await createImageFixture(path.join(inputRoot, '1.jpg'), { format: 'jpeg' });
    await fs.writeFile(appPath, 'const image = "/foldername/1.jpg";\n', 'utf8');

    const firstRun = await optimizeImages(inputRoot, {
      formats: ['webp'],
      rewrite: { targets: [srcDir] },
      concurrency: 1,
      silent: true,
    });
    const secondRun = await optimizeImages(inputRoot, {
      formats: ['webp'],
      rewrite: { targets: [srcDir] },
      concurrency: 1,
      silent: true,
    });

    expect(firstRun.rewrite?.replacements).toBe(1);
    expect(secondRun.rewrite?.replacements).toBe(0);
    expect(await fs.readFile(appPath, 'utf8')).toBe('const image = "/foldername/1.webp";\n');
  });

  it('reports rewrite dry-runs without modifying source files', async () => {
    const { inputRoot, srcDir, appPath } = await createRewriteProject();

    await createImageFixture(path.join(inputRoot, '1.jpg'), { format: 'jpeg' });
    await fs.writeFile(appPath, 'const image = "/foldername/1.jpg";\n', 'utf8');

    const result = await optimizeImages(inputRoot, {
      formats: ['webp'],
      rewrite: { targets: [srcDir], dryRun: true },
      concurrency: 1,
      silent: true,
    });

    expect(result.rewrite?.dryRun).toBe(true);
    expect(result.rewrite?.replacements).toBe(1);
    expect(await fs.readFile(appPath, 'utf8')).toBe('const image = "/foldername/1.jpg";\n');
  });

  it('chooses AVIF when preferred and both AVIF and WebP exist', async () => {
    const { inputRoot, srcDir, appPath } = await createRewriteProject();

    await createImageFixture(path.join(inputRoot, 'hero.jpg'), { format: 'jpeg' });
    await fs.writeFile(appPath, 'const image = "/foldername/hero.jpg";\n', 'utf8');

    await optimizeImages(inputRoot, {
      formats: ['webp', 'avif'],
      rewrite: { targets: [srcDir], prefer: 'avif' },
      concurrency: 1,
      silent: true,
    });

    expect(await fs.readFile(appPath, 'utf8')).toBe('const image = "/foldername/hero.avif";\n');
  });

  it('falls back to WebP when preferred AVIF is unavailable', async () => {
    const { inputRoot, srcDir, appPath } = await createRewriteProject();

    await createImageFixture(path.join(inputRoot, 'hero.jpg'), { format: 'jpeg' });
    await fs.writeFile(appPath, 'const image = "/foldername/hero.jpg";\n', 'utf8');

    await optimizeImages(inputRoot, {
      formats: ['webp'],
      rewrite: { targets: [srcDir], prefer: 'avif' },
      concurrency: 1,
      silent: true,
    });

    expect(await fs.readFile(appPath, 'utf8')).toBe('const image = "/foldername/hero.webp";\n');
  });

  it('does not rewrite references for images that failed optimization', async () => {
    const { inputRoot, srcDir, appPath } = await createRewriteProject();

    await createImageFixture(path.join(inputRoot, 'good.jpg'), { format: 'jpeg' });
    await fs.writeFile(path.join(inputRoot, 'broken.jpg'), 'not-an-image', 'utf8');
    await fs.writeFile(
      appPath,
      ['const good = "/foldername/good.jpg";', 'const broken = "/foldername/broken.jpg";'].join(
        '\n',
      ),
      'utf8',
    );

    const result = await optimizeImages(inputRoot, {
      formats: ['webp'],
      rewrite: { targets: [srcDir] },
      concurrency: 1,
      silent: true,
    });
    const rewritten = await fs.readFile(appPath, 'utf8');

    expect(result.stats.errorFiles).toBe(1);
    expect(result.rewrite?.replacements).toBe(1);
    expect(rewritten).toContain('const good = "/foldername/good.webp";');
    expect(rewritten).toContain('const broken = "/foldername/broken.jpg";');
  });

  it('does not scan excluded directories', async () => {
    const { inputRoot, srcDir, appPath } = await createRewriteProject();
    const nodeModulesPath = path.join(srcDir, 'node_modules', 'pkg', 'index.ts');
    const distPath = path.join(srcDir, 'dist', 'index.ts');
    const nextPath = path.join(srcDir, '.next', 'index.ts');

    await createImageFixture(path.join(inputRoot, '1.jpg'), { format: 'jpeg' });
    await fs.mkdir(path.dirname(nodeModulesPath), { recursive: true });
    await fs.mkdir(path.dirname(distPath), { recursive: true });
    await fs.mkdir(path.dirname(nextPath), { recursive: true });
    await fs.writeFile(appPath, 'const image = "/foldername/1.jpg";\n', 'utf8');
    await fs.writeFile(nodeModulesPath, 'const image = "/foldername/1.jpg";\n', 'utf8');
    await fs.writeFile(distPath, 'const image = "/foldername/1.jpg";\n', 'utf8');
    await fs.writeFile(nextPath, 'const image = "/foldername/1.jpg";\n', 'utf8');

    const result = await optimizeImages(inputRoot, {
      formats: ['webp'],
      rewrite: { targets: [srcDir] },
      concurrency: 1,
      silent: true,
    });

    expect(result.rewrite?.filesScanned).toBe(1);
    expect(await fs.readFile(appPath, 'utf8')).toBe('const image = "/foldername/1.webp";\n');
    expect(await fs.readFile(nodeModulesPath, 'utf8')).toBe('const image = "/foldername/1.jpg";\n');
    expect(await fs.readFile(distPath, 'utf8')).toBe('const image = "/foldername/1.jpg";\n');
    expect(await fs.readFile(nextPath, 'utf8')).toBe('const image = "/foldername/1.jpg";\n');
  });
});

async function createRewriteProject(): Promise<{
  projectDir: string;
  inputRoot: string;
  srcDir: string;
  appPath: string;
}> {
  const projectDir = await createTempDirectory('image-optimizer-pro-rewrite-', tempDirectories);
  const inputRoot = path.join(projectDir, 'public', 'foldername');
  const srcDir = path.join(projectDir, 'src');
  const appPath = path.join(srcDir, 'App.tsx');

  await fs.mkdir(inputRoot, { recursive: true });
  await fs.mkdir(srcDir, { recursive: true });

  return {
    projectDir,
    inputRoot,
    srcDir,
    appPath,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}
