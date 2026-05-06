import { performance } from 'node:perf_hooks';
import path from 'node:path';

import { resolveOptimizerConfig } from '../config';
import { createLogger, snapshotStats } from './logger';
import { buildImageManifest, writeImageManifest } from './manifest';
import { processImage } from './processor';
import { runTaskQueue } from './queue';
import { formatErrorMessage } from './security';
import { rewriteImageReferences } from './rewrite';
import { scanDirectory } from './scanner';
import type {
  FileProcessingResult,
  FileRecord,
  ImageOptimizerPluginContext,
  OptimizationResult,
  OptimizerOptions,
  ProgressStats,
  ResolvedOptimizerOptions,
} from '../types';

export async function optimizeImages(
  inputDir: string,
  options: OptimizerOptions = {},
): Promise<OptimizationResult> {
  const config = await resolveOptimizerConfig(inputDir, options);
  const logger = createLogger(config.logLevel);
  const startedAt = performance.now();
  const files = await scanDirectory(config.rootDir, config);
  const stats: ProgressStats = {
    totalFiles: files.length,
    processedFiles: 0,
    skippedFiles: 0,
    errorFiles: 0,
    generatedFiles: 0,
    inputBytes: files.reduce((total, file) => total + file.size, 0),
    outputBytes: 0,
  };

  logger.start(files.length, config);

  const pluginContext = createPluginContext(config, stats, logger);
  await callPluginHook(pluginContext, config, 'setup');

  const results = await runTaskQueue(files, config.concurrency, async (file) => {
    await callPluginHook(pluginContext, config, 'onFileStart', file);
    const result = await safelyProcessFile(file, config);

    updateStats(stats, result);
    logger.fileResult(result);

    await callPluginHook(pluginContext, config, 'onFileComplete', result);
    return result;
  });

  const finalResult: OptimizationResult = {
    rootDir: config.rootDir,
    config,
    stats: snapshotStats(stats),
    files: results,
    durationMs: performance.now() - startedAt,
  };

  if (config.manifest !== undefined || config.rewrite !== undefined) {
    const manifest = buildImageManifest(finalResult);

    if (config.manifest !== undefined) {
      await writeImageManifest(manifest, resolveManifestOutputPath(config));
      finalResult.manifest = manifest;
    } else if (config.rewrite !== undefined) {
      finalResult.manifest = manifest;
    }

    if (config.rewrite !== undefined) {
      finalResult.rewrite = await rewriteImageReferences(manifest, {
        targets: config.rewrite.targets,
        extensions: config.rewrite.extensions,
        prefer: config.rewrite.prefer,
        dryRun: config.dryRun || config.rewrite.dryRun,
      });
    }
  }

  finalResult.durationMs = performance.now() - startedAt;

  await callPluginHook(pluginContext, config, 'onComplete', finalResult);
  logger.summary(finalResult);

  return finalResult;
}

function createPluginContext(
  config: ResolvedOptimizerOptions,
  stats: ProgressStats,
  logger: ReturnType<typeof createLogger>,
): ImageOptimizerPluginContext {
  return {
    rootDir: config.rootDir,
    config,
    stats,
    logger,
  };
}

async function safelyProcessFile(
  file: FileRecord,
  config: ResolvedOptimizerOptions,
): Promise<FileProcessingResult> {
  try {
    return await processImage(file, config);
  } catch (error) {
    return {
      sourcePath: file.absolutePath,
      relativePath: file.relativePath,
      status: 'error',
      quality: null,
      outputs: [],
      errors: [formatErrorMessage(error)],
      durationMs: 0,
    };
  }
}

function resolveManifestOutputPath(config: ResolvedOptimizerOptions): string {
  if (config.manifest === true) {
    return path.join(config.rootDir, 'image-optimizer.manifest.json');
  }

  if (typeof config.manifest === 'string') {
    return config.manifest;
  }

  throw new Error('manifest output path is not configured.');
}

function updateStats(stats: ProgressStats, result: FileProcessingResult): void {
  if (result.status === 'processed' || result.status === 'partial') {
    stats.processedFiles += 1;
  }

  if (result.status === 'skipped') {
    stats.skippedFiles += 1;
  }

  if (result.status === 'partial' || result.status === 'error') {
    stats.errorFiles += 1;
  }

  for (const output of result.outputs) {
    if (output.status === 'generated') {
      stats.generatedFiles += 1;
      stats.outputBytes += output.bytes ?? 0;
    }
  }
}

async function callPluginHook(
  context: ImageOptimizerPluginContext,
  config: ResolvedOptimizerOptions,
  hook: 'setup',
): Promise<void>;
async function callPluginHook(
  context: ImageOptimizerPluginContext,
  config: ResolvedOptimizerOptions,
  hook: 'onFileStart',
  payload: FileRecord,
): Promise<void>;
async function callPluginHook(
  context: ImageOptimizerPluginContext,
  config: ResolvedOptimizerOptions,
  hook: 'onFileComplete',
  payload: FileProcessingResult,
): Promise<void>;
async function callPluginHook(
  context: ImageOptimizerPluginContext,
  config: ResolvedOptimizerOptions,
  hook: 'onComplete',
  payload: OptimizationResult,
): Promise<void>;
async function callPluginHook(
  context: ImageOptimizerPluginContext,
  config: ResolvedOptimizerOptions,
  hook: 'setup' | 'onFileStart' | 'onFileComplete' | 'onComplete',
  payload?: FileRecord | FileProcessingResult | OptimizationResult,
): Promise<void> {
  for (const plugin of config.plugins) {
    try {
      if (hook === 'setup') {
        await plugin.setup?.(context);
      } else if (hook === 'onFileStart' && payload !== undefined) {
        await plugin.onFileStart?.(payload as FileRecord, context);
      } else if (hook === 'onFileComplete' && payload !== undefined) {
        await plugin.onFileComplete?.(payload as FileProcessingResult, context);
      } else if (hook === 'onComplete' && payload !== undefined) {
        await plugin.onComplete?.(payload as OptimizationResult, context);
      }
    } catch (error) {
      context.logger.debug(
        `plugin "${plugin.name}" ${hook} hook failed: ${formatErrorMessage(error)}`,
      );
    }
  }
}
