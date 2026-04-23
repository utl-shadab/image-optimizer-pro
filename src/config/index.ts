import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertNoNullBytes } from '../core/security';
import type {
  LoadedConfig,
  LogLevel,
  OptimizerOptions,
  OutputFormat,
  QualityProfile,
  ResolvedOptimizerOptions,
} from '../types';

const DEFAULT_QUALITY: QualityProfile = {
  small: 60,
  medium: 50,
  large: 40,
};

const DEFAULT_INCLUDE = ['**/*'];
const DEFAULT_EXCLUDE = ['node_modules', '.git'];
const DEFAULT_FORMATS: OutputFormat[] = ['avif', 'webp'];
const CONFIG_FILE_NAMES = [
  'image-optimizer.config.js',
  'image-optimizer.config.cjs',
  'image-optimizer.config.mjs',
];

export async function resolveOptimizerConfig(
  inputDir: string,
  overrides: OptimizerOptions = {},
  cwd = process.cwd(),
): Promise<ResolvedOptimizerOptions> {
  const rootDir = await resolveRootDirectory(inputDir, cwd);
  const loadedConfig =
    overrides.config !== undefined
      ? await loadOptimizerConfig({ cwd, configPath: overrides.config })
      : await loadConfigFromSearchPaths([cwd, rootDir]);
  const mergedOptions = mergeOptions(loadedConfig.config, overrides);
  const outputDir = mergedOptions.outputDir
    ? resolveOutputDirectory(rootDir, mergedOptions.outputDir)
    : undefined;
  const exclude = normalizePatterns(mergedOptions.exclude ?? DEFAULT_EXCLUDE);

  if (outputDir !== undefined) {
    const outputRelativePath = path.relative(rootDir, outputDir).replace(/\\/g, '/');
    exclude.push(outputRelativePath, `${outputRelativePath}/**`);
  }

  return {
    rootDir,
    quality: normalizeQuality(mergedOptions.quality),
    formats: normalizeFormats(mergedOptions.formats),
    include: normalizePatterns(mergedOptions.include ?? DEFAULT_INCLUDE),
    exclude: deduplicateStrings(exclude),
    concurrency: normalizeConcurrency(mergedOptions.concurrency),
    dryRun: normalizeBoolean(mergedOptions.dryRun, 'dryRun'),
    logLevel: resolveLogLevel(mergedOptions),
    plugins: normalizePlugins(mergedOptions.plugins),
    ...(outputDir !== undefined ? { outputDir } : {}),
    ...(loadedConfig.configFilePath !== undefined
      ? { configFilePath: loadedConfig.configFilePath }
      : {}),
  };
}

export async function loadOptimizerConfig(
  options: {
    cwd?: string;
    configPath?: string;
  } = {},
): Promise<LoadedConfig> {
  const cwd = options.cwd ?? process.cwd();
  const configFilePath = await findConfigFile(cwd, options.configPath);

  if (configFilePath === undefined) {
    return { config: {} };
  }

  const moduleUrl = pathToFileURL(configFilePath).href;
  const importedModule = (await import(moduleUrl)) as { default?: unknown };
  const resolvedConfig = normalizeExport(importedModule.default ?? importedModule);

  return {
    config: resolvedConfig,
    configFilePath,
  };
}

async function loadConfigFromSearchPaths(searchPaths: readonly string[]): Promise<LoadedConfig> {
  for (const searchPath of searchPaths) {
    const loadedConfig = await loadOptimizerConfig({ cwd: searchPath });

    if (loadedConfig.configFilePath !== undefined) {
      return loadedConfig;
    }
  }

  return { config: {} };
}

export function resolveLogLevel(
  options: Pick<OptimizerOptions, 'debug' | 'silent' | 'verbose'>,
): LogLevel {
  if (normalizeBoolean(options.silent, 'silent')) {
    return 'silent';
  }

  if (normalizeBoolean(options.debug, 'debug')) {
    return 'debug';
  }

  if (normalizeBoolean(options.verbose, 'verbose')) {
    return 'verbose';
  }

  return 'normal';
}

function mergeOptions(
  base: Partial<OptimizerOptions>,
  overrides: OptimizerOptions,
): OptimizerOptions {
  return {
    ...base,
    ...overrides,
    quality: {
      ...(base.quality ?? {}),
      ...(overrides.quality ?? {}),
    },
    ...(overrides.formats !== undefined ? { formats: overrides.formats } : {}),
    ...(overrides.include !== undefined ? { include: overrides.include } : {}),
    ...(overrides.exclude !== undefined ? { exclude: overrides.exclude } : {}),
    ...(overrides.plugins !== undefined ? { plugins: overrides.plugins } : {}),
  };
}

function normalizeExport(candidate: unknown): Partial<OptimizerOptions> {
  if (typeof candidate === 'function') {
    throw new Error('Config files must export a plain object.');
  }

  if (!isPlainObject(candidate)) {
    throw new Error('Config file must export an object.');
  }

  return candidate;
}

function normalizeQuality(input: Partial<QualityProfile> | undefined): QualityProfile {
  if (input !== undefined && !isPlainObject(input)) {
    throw new Error('quality must be an object.');
  }

  return {
    small: normalizeQualityValue(input?.small ?? DEFAULT_QUALITY.small, 'quality.small'),
    medium: normalizeQualityValue(input?.medium ?? DEFAULT_QUALITY.medium, 'quality.medium'),
    large: normalizeQualityValue(input?.large ?? DEFAULT_QUALITY.large, 'quality.large'),
  };
}

function normalizeQualityValue(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error(`${label} must be an integer between 1 and 100.`);
  }

  return value;
}

function normalizeFormats(input: OutputFormat[] | undefined): OutputFormat[] {
  if (input !== undefined && !Array.isArray(input)) {
    throw new Error('formats must be an array.');
  }

  const formats = deduplicateStrings<string>([...(input ?? DEFAULT_FORMATS)]);
  const validatedFormats: OutputFormat[] = [];

  if (formats.length === 0) {
    throw new Error('At least one output format must be configured.');
  }

  for (const format of formats) {
    if (format !== 'avif' && format !== 'webp') {
      throw new Error(`Unsupported output format "${format}". Use "avif" and/or "webp".`);
    }

    validatedFormats.push(format);
  }

  return validatedFormats;
}

function normalizePatterns(patterns: readonly string[]): string[] {
  if (!Array.isArray(patterns)) {
    throw new Error('include and exclude must be arrays of glob patterns.');
  }

  return deduplicateStrings(
    patterns
      .map((pattern, index) => normalizePatternEntry(pattern, index))
      .filter((pattern) => pattern.length > 0),
  );
}

function normalizeConcurrency(value: number | undefined): number {
  const defaultConcurrency =
    typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;

  if (value === undefined) {
    return Math.max(1, defaultConcurrency);
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error('concurrency must be a positive integer.');
  }

  return value;
}

function normalizeBoolean(value: boolean | undefined, label: string): boolean {
  if (value === undefined) {
    return false;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean.`);
  }

  return value;
}

function normalizePlugins(
  value: OptimizerOptions['plugins'],
): NonNullable<OptimizerOptions['plugins']> {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error('plugins must be an array.');
  }

  for (const [index, plugin] of value.entries()) {
    if (!isPlainObject(plugin) && typeof plugin !== 'object') {
      throw new Error(`Plugin at index ${index} must be an object.`);
    }

    if (plugin === null || typeof (plugin as { name?: unknown }).name !== 'string') {
      throw new Error(`Plugin at index ${index} must define a string name.`);
    }
  }

  return value;
}

function resolveOutputDirectory(rootDir: string, outputDir: string): string {
  assertNoNullBytes(outputDir, 'outputDir');

  if (outputDir.trim().length === 0) {
    throw new Error('outputDir must not be empty.');
  }

  if (path.isAbsolute(outputDir)) {
    throw new Error('outputDir must be a relative path inside the input directory.');
  }

  const resolved = path.resolve(rootDir, outputDir);
  const relativePath = path.relative(rootDir, resolved);

  if (
    relativePath === '' ||
    relativePath === '.' ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error('outputDir must stay inside the input directory.');
  }

  return resolved;
}

async function findConfigFile(cwd: string, explicitPath?: string): Promise<string | undefined> {
  if (explicitPath !== undefined) {
    assertNoNullBytes(explicitPath, 'Config path');
    const resolvedPath = path.resolve(cwd, explicitPath);
    await ensureFileExists(resolvedPath, 'Config file');
    return resolvedPath;
  }

  for (const fileName of CONFIG_FILE_NAMES) {
    const candidate = path.resolve(cwd, fileName);

    try {
      await ensureFileExists(candidate, 'Config file');
      return candidate;
    } catch {
      continue;
    }
  }

  return undefined;
}

async function ensureFileExists(filePath: string, label: string): Promise<void> {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) {
    throw new Error(`${label} must point to a file.`);
  }
}

async function resolveRootDirectory(inputDir: string, cwd: string): Promise<string> {
  assertNoNullBytes(inputDir, 'Input directory');
  const resolvedPath = path.resolve(cwd, inputDir);
  const stats = await fs.stat(resolvedPath).catch(() => {
    throw new Error(`Input directory does not exist: ${resolvedPath}`);
  });

  if (!stats.isDirectory()) {
    throw new Error(`Input path must be a directory: ${resolvedPath}`);
  }

  return fs.realpath(resolvedPath);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePatternEntry(pattern: unknown, index: number): string {
  if (typeof pattern !== 'string') {
    throw new Error(`Pattern at index ${index} must be a string.`);
  }

  assertNoNullBytes(pattern, `Pattern at index ${index}`);
  return pattern.replace(/\\/g, '/').trim();
}

function deduplicateStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
