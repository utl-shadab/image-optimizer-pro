import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import sharp from 'sharp';

import { optimizeImages } from '../dist/index.mjs';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'image-optimizer-pro-'));
const scenarios = [
  {
    name: 'small-folder',
    fixtures: [
      { fileName: 'hero.png', width: 1200, height: 800, format: 'png', background: '#2a6f97' },
      {
        fileName: 'gallery.jpg',
        width: 900,
        height: 600,
        format: 'jpeg',
        background: '#ef476f',
      },
      {
        fileName: 'banner.webp',
        width: 800,
        height: 450,
        format: 'webp',
        background: '#118ab2',
      },
    ],
  },
  {
    name: 'large-folder',
    fixtures: [
      { fileName: 'hero.png', width: 3200, height: 2200, format: 'png', background: '#2a6f97' },
      {
        fileName: 'gallery.jpg',
        width: 2800,
        height: 1800,
        format: 'jpeg',
        background: '#ef476f',
      },
      {
        fileName: 'banner.webp',
        width: 2600,
        height: 1400,
        format: 'webp',
        background: '#118ab2',
      },
      {
        fileName: 'cover.png',
        width: 3400,
        height: 2200,
        format: 'png',
        background: '#06d6a0',
      },
      {
        fileName: 'feature.jpg',
        width: 3000,
        height: 2000,
        format: 'jpeg',
        background: '#073b4c',
      },
      {
        fileName: 'thumb.webp',
        width: 2000,
        height: 1200,
        format: 'webp',
        background: '#ffd166',
      },
    ],
  },
];

const reports = [];

try {
  for (const scenario of scenarios) {
    const inputDir = path.join(tempRoot, scenario.name);
    await fs.mkdir(inputDir, { recursive: true });

    for (const fixture of scenario.fixtures) {
      await createFixture(inputDir, fixture);
    }

    const sourceFiles = await fs.readdir(inputDir);
    const sourceBytes = await Promise.all(
      sourceFiles.map(async (fileName) => {
        const stats = await fs.stat(path.join(inputDir, fileName));
        return stats.size;
      }),
    );

    const startedAt = performance.now();
    const result = await optimizeImages(inputDir, {
      outputDir: '.tmp-bench',
      concurrency:
        typeof os.availableParallelism === 'function'
          ? os.availableParallelism()
          : os.cpus().length,
      silent: true,
    });
    const durationMs = performance.now() - startedAt;

    reports.push({
      scenario: scenario.name,
      durationMs: Math.round(durationMs),
      sourceBytes: sourceBytes.reduce((total, value) => total + value, 0),
      outputBytes: result.stats.outputBytes,
      processedFiles: result.stats.processedFiles,
      skippedFiles: result.stats.skippedFiles,
      generatedFiles: result.stats.generatedFiles,
    });
  }

  console.log(JSON.stringify(reports, null, 2));
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function createFixture(inputDir, fixture) {
  const svg = createFixtureSvg(fixture.width, fixture.height, fixture.background);
  const pipeline = sharp(Buffer.from(svg));
  const filePath = path.join(inputDir, fixture.fileName);

  if (fixture.format === 'png') {
    await pipeline.png().toFile(filePath);
    return;
  }

  if (fixture.format === 'jpeg') {
    await pipeline.jpeg({ quality: 90 }).toFile(filePath);
    return;
  }

  await pipeline.webp({ quality: 90 }).toFile(filePath);
}

function createFixtureSvg(width, height, background) {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${background}" />
          <stop offset="100%" stop-color="#0f172a" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)" />
      <circle cx="${Math.round(width * 0.28)}" cy="${Math.round(height * 0.35)}" r="${Math.round(width * 0.12)}" fill="#ffffff" fill-opacity="0.12" />
      <circle cx="${Math.round(width * 0.72)}" cy="${Math.round(height * 0.62)}" r="${Math.round(width * 0.16)}" fill="#ffffff" fill-opacity="0.08" />
      <text x="50%" y="52%" fill="#ffffff" font-family="Arial, sans-serif" font-size="${Math.round(width * 0.05)}" font-weight="700" text-anchor="middle">image-optimizer-pro</text>
    </svg>
  `;
}
