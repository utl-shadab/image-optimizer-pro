import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import sharp from 'sharp';

import {
  GENERATED_OUTPUT_MTIME_TOLERANCE_MS,
  MAX_INPUT_PIXELS,
  assertPathInsideRoot,
  formatErrorMessage,
  pathExists,
  toPosixPath,
} from './security';
import type {
  FileProcessingResult,
  FileRecord,
  OutputArtifact,
  OutputFormat,
  QualityProfile,
  ResolvedOptimizerOptions,
} from '../types';

sharp.cache({ files: 0 });

export async function processImage(
  file: FileRecord,
  config: ResolvedOptimizerOptions,
): Promise<FileProcessingResult> {
  const startTime = performance.now();
  const outputBaseDirectory = config.outputDir ?? config.rootDir;
  const relativeWithoutExtension =
    file.outputRelativeBasePath ?? file.relativePath.replace(/\.[^.]+$/u, '');
  const requestedFormats = config.formats.filter(
    (format) => !(file.extension === 'webp' && format === 'webp'),
  );
  const outputs: OutputArtifact[] = [];
  const errors: string[] = [];

  if (requestedFormats.length === 0) {
    outputs.push({
      format: 'webp',
      absolutePath: file.absolutePath,
      relativePath: file.relativePath,
      status: 'skipped-same-format',
      message: 'The source file already uses the requested output format.',
    });

    return {
      sourcePath: file.absolutePath,
      relativePath: file.relativePath,
      status: 'skipped',
      quality: null,
      outputs,
      errors,
      durationMs: performance.now() - startTime,
    };
  }

  const quality = selectQuality(file.size, config.quality);
  const pendingFormats: Array<{
    format: OutputFormat;
    absolutePath: string;
    relativePath: string;
  }> = [];

  for (const format of requestedFormats) {
    const outputRelativePath = `${relativeWithoutExtension}.${format}`;
    const outputAbsolutePath = assertPathInsideRoot(
      config.rootDir,
      path.join(outputBaseDirectory, outputRelativePath),
      'Output path',
    );

    const outputRelativeFromRoot = toPosixPath(path.relative(config.rootDir, outputAbsolutePath));

    if (await isUpToDate(outputAbsolutePath, file.modifiedAtMs)) {
      outputs.push({
        format,
        absolutePath: outputAbsolutePath,
        relativePath: outputRelativeFromRoot,
        status: 'up-to-date',
        message: 'Output already exists and is newer than the source file.',
      });
      continue;
    }

    pendingFormats.push({
      format,
      absolutePath: outputAbsolutePath,
      relativePath: outputRelativeFromRoot,
    });
  }

  if (pendingFormats.length === 0) {
    return {
      sourcePath: file.absolutePath,
      relativePath: file.relativePath,
      status: 'skipped',
      quality: null,
      outputs,
      errors,
      durationMs: performance.now() - startTime,
    };
  }

  for (const pendingFormat of pendingFormats) {
    if (config.dryRun) {
      outputs.push({
        format: pendingFormat.format,
        absolutePath: pendingFormat.absolutePath,
        relativePath: pendingFormat.relativePath,
        status: 'dry-run',
        message: 'Skipped write because dry-run mode is enabled.',
      });
      continue;
    }

    try {
      await fs.mkdir(path.dirname(pendingFormat.absolutePath), { recursive: true });

      const pipeline = sharp(file.absolutePath, {
        sequentialRead: true,
        limitInputPixels: MAX_INPUT_PIXELS,
      }).rotate();
      const temporaryOutputPath = createTemporaryOutputPath(pendingFormat.absolutePath);

      if (pendingFormat.format === 'avif') {
        await pipeline
          .clone()
          .avif({
            quality,
            effort: file.size > 1024 * 1024 ? 6 : 5,
          })
          .toFile(temporaryOutputPath);
      } else {
        await pipeline
          .clone()
          .webp({
            quality,
            effort: 4,
          })
          .toFile(temporaryOutputPath);
      }

      await replaceFileAtomically(temporaryOutputPath, pendingFormat.absolutePath);
      await syncOutputTimestamp(pendingFormat.absolutePath, file.modifiedAtMs);

      const outputStats = await fs.stat(pendingFormat.absolutePath);
      outputs.push({
        format: pendingFormat.format,
        absolutePath: pendingFormat.absolutePath,
        relativePath: pendingFormat.relativePath,
        status: 'generated',
        bytes: outputStats.size,
      });
    } catch (error) {
      const message = `${pendingFormat.format}: ${formatErrorMessage(error)}`;
      errors.push(message);
      outputs.push({
        format: pendingFormat.format,
        absolutePath: pendingFormat.absolutePath,
        relativePath: pendingFormat.relativePath,
        status: 'failed',
        message,
      });
    }
  }

  const generatedCount = outputs.filter(
    (output) => output.status === 'generated' || output.status === 'dry-run',
  ).length;
  const status =
    errors.length > 0 && generatedCount > 0 ? 'partial' : errors.length > 0 ? 'error' : 'processed';

  return {
    sourcePath: file.absolutePath,
    relativePath: file.relativePath,
    status,
    quality,
    outputs,
    errors,
    durationMs: performance.now() - startTime,
  };
}

export function selectQuality(fileSize: number, quality: QualityProfile): number {
  if (fileSize < 200 * 1024) {
    return quality.small;
  }

  if (fileSize < 1024 * 1024) {
    return quality.medium;
  }

  return quality.large;
}

async function isUpToDate(outputPath: string, sourceModifiedAtMs: number): Promise<boolean> {
  try {
    const stats = await fs.stat(outputPath);
    return (
      stats.isFile() &&
      stats.size > 0 &&
      stats.mtimeMs + GENERATED_OUTPUT_MTIME_TOLERANCE_MS >= sourceModifiedAtMs
    );
  } catch {
    return false;
  }
}

function createTemporaryOutputPath(outputPath: string): string {
  const directory = path.dirname(outputPath);
  const fileName = path.basename(outputPath);
  return path.join(directory, `.${fileName}.${randomUUID()}.tmp`);
}

async function replaceFileAtomically(temporaryPath: string, finalPath: string): Promise<void> {
  const backupPath = `${finalPath}.${randomUUID()}.bak`;
  const finalPathExists = await pathExists(finalPath);
  let backupCreated = false;

  try {
    if (finalPathExists) {
      await fs.rename(finalPath, backupPath);
      backupCreated = true;
    }

    await fs.rename(temporaryPath, finalPath);

    if (backupCreated) {
      await fs.rm(backupPath, { force: true });
    }
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);

    if (backupCreated) {
      if (!(await pathExists(finalPath))) {
        await fs.rename(backupPath, finalPath).catch(() => undefined);
      } else {
        await fs.rm(backupPath, { force: true }).catch(() => undefined);
      }
    }

    throw error;
  }
}

async function syncOutputTimestamp(outputPath: string, sourceModifiedAtMs: number): Promise<void> {
  const timestamp = new Date(sourceModifiedAtMs);
  await fs.utimes(outputPath, timestamp, timestamp).catch(() => undefined);
}
