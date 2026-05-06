import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertNoNullBytes } from '../core/security';
import { DEFAULT_REWRITE_EXTENSIONS } from '../core/rewrite';
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
  const formats = normalizeFormats(mergedOptions.formats);
  const rewrite = normalizeRewriteOptions(mergedOptions.rewrite, formats);
  const manifest = normalizeManifestOption(mergedOptions.manifest, cwd);

  if (outputDir !== undefined) {
    const outputRelativePath = path.relative(rootDir, outputDir).replace(/\\/g, '/');
    exclude.push(outputRelativePath, `${outputRelativePath}/**`);
  }

  return {
    rootDir,
    quality: normalizeQuality(mergedOptions.quality),
    formats,
    include: normalizePatterns(mergedOptions.include ?? DEFAULT_INCLUDE),
    exclude: deduplicateStrings(exclude),
    concurrency: normalizeConcurrency(mergedOptions.concurrency),
    dryRun: normalizeBoolean(mergedOptions.dryRun, 'dryRun'),
    logLevel: resolveLogLevel(mergedOptions),
    ...(rewrite !== undefined ? { rewrite } : {}),
    ...(manifest !== undefined ? { manifest } : {}),
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
  const mergedOptions: OptimizerOptions = {
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

  if (base.rewrite !== undefined || overrides.rewrite !== undefined) {
    mergedOptions.rewrite = {
      ...(base.rewrite ?? {}),
      ...(overrides.rewrite ?? {}),
    } as NonNullable<OptimizerOptions['rewrite']>;
  }

  if (overrides.manifest !== undefined) {
    mergedOptions.manifest = overrides.manifest;
  } else if (base.manifest !== undefined) {
    mergedOptions.manifest = base.manifest;
  }

  return mergedOptions;
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

function normalizeRewriteOptions(
  input: OptimizerOptions['rewrite'],
  formats: readonly OutputFormat[],
): ResolvedOptimizerOptions['rewrite'] | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!isPlainObject(input)) {
    throw new Error('rewrite must be an object.');
  }

  if (!Array.isArray(input.targets) || input.targets.length === 0) {
    throw new Error('rewrite.targets must be a non-empty array of paths.');
  }

  const targets = input.targets.map((target, index) => normalizePathEntry(target, index));
  const extensions =
    input.extensions === undefined
      ? DEFAULT_REWRITE_EXTENSIONS
      : normalizeRewriteExtensions(input.extensions);
  const prefer = normalizePreferredFormat(input.prefer, formats);

  return {
    targets,
    extensions,
    prefer,
    dryRun: normalizeBoolean(input.dryRun, 'rewrite.dryRun'),
  };
}

function normalizeRewriteExtensions(extensions: readonly string[]): string[] {
  if (!Array.isArray(extensions)) {
    throw new Error('rewrite.extensions must be an array of file extensions.');
  }

  return deduplicateStrings(
    extensions
      .map((extension, index) => {
        if (typeof extension !== 'string') {
          throw new Error(`rewrite.extensions[${index}] must be a string.`);
        }

        assertNoNullBytes(extension, `rewrite.extensions[${index}]`);
        return extension.trim().toLowerCase().replace(/^\.+/u, '');
      })
      .filter((extension) => extension.length > 0),
  );
}

function normalizePreferredFormat(format: unknown, formats: readonly OutputFormat[]): OutputFormat {
  if (format === undefined) {
    const firstFormat = formats[0];

    if (firstFormat === undefined) {
      throw new Error('At least one output format must be configured.');
    }

    return firstFormat;
  }

  if (format !== 'avif' && format !== 'webp') {
    throw new Error(
      `Unsupported preferred format "${formatInvalidValue(format)}". Use "avif" or "webp".`,
    );
  }

  return format;
}

function formatInvalidValue(value: unknown): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  if (value === null) {
    return 'null';
  }

  return typeof value;
}

function normalizeManifestOption(
  value: OptimizerOptions['manifest'],
  cwd: string,
): ResolvedOptimizerOptions['manifest'] | undefined {
  if (value === undefined || value === false) {
    return undefined;
  }

  if (value === true) {
    return true;
  }

  if (typeof value !== 'string') {
    throw new Error('manifest must be a boolean or path string.');
  }

  assertNoNullBytes(value, 'manifest');

  if (value.trim().length === 0) {
    throw new Error('manifest path must not be empty.');
  }

  return path.resolve(cwd, value);
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

function normalizePathEntry(pathEntry: unknown, index: number): string {
  if (typeof pathEntry !== 'string') {
    throw new Error(`rewrite.targets[${index}] must be a string.`);
  }

  assertNoNullBytes(pathEntry, `rewrite.targets[${index}]`);

  const normalizedPath = pathEntry.trim();

  if (normalizedPath.length === 0) {
    throw new Error(`rewrite.targets[${index}] must not be empty.`);
  }

  return normalizedPath;
}

function deduplicateStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
