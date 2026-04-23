import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import sharp from 'sharp';

export async function createTempDirectory(prefix: string, registry: string[]): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  registry.push(directory);
  return directory;
}

export async function cleanupTempDirectories(registry: string[]): Promise<void> {
  await Promise.all(registry.map((directory) => removeDirectoryWithRetries(directory)));
  registry.length = 0;
}

async function removeDirectoryWithRetries(directory: string): Promise<void> {
  const attempts = 8;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        (error.code !== 'EBUSY' && error.code !== 'EPERM') ||
        attempt === attempts - 1
      ) {
        throw error;
      }

      await sleep(75 * (attempt + 1));
    }
  }
}

export async function createImageFixture(
  filePath: string,
  options: {
    width?: number;
    height?: number;
    background?: string;
    format: 'png' | 'jpeg' | 'webp';
  },
): Promise<void> {
  const width = options.width ?? 320;
  const height = options.height ?? 180;
  const background = options.background ?? '#2a9d8f';

  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 4,
      background,
    },
  });

  if (options.format === 'png') {
    await fs.writeFile(filePath, await pipeline.png().toBuffer());
    return;
  }

  if (options.format === 'jpeg') {
    await fs.writeFile(filePath, await pipeline.jpeg({ quality: 92 }).toBuffer());
    return;
  }

  await fs.writeFile(filePath, await pipeline.webp({ quality: 92 }).toBuffer());
}

export async function setFileTimestamp(filePath: string, timestampMs: number): Promise<void> {
  const timestamp = new Date(timestampMs);
  await fs.utimes(filePath, timestamp, timestamp);
}

export function createBufferWriter(buffer: string[]): { write(chunk: string): void } {
  return {
    write(chunk: string) {
      buffer.push(chunk);
    },
  };
}
