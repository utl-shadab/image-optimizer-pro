export { createCliProgram, runCli } from './cli/index';
export { loadOptimizerConfig, resolveLogLevel, resolveOptimizerConfig } from './config';
export { createLogger } from './core/logger';
export { buildImageManifest, writeImageManifest } from './core/manifest';
export { optimizeImages } from './core/optimizer';
export { processImage, selectQuality } from './core/processor';
export { runTaskQueue } from './core/queue';
export { rewriteImageReferences } from './core/rewrite';
export { scanDirectory } from './core/scanner';
export type {
  CliOutputWriter,
  CliRunOptions,
  FileProcessingResult,
  FileProcessStatus,
  FileRecord,
  ImageManifestEntry,
  ImageManifestOutput,
  ImageOptimizerPlugin,
  ImageOptimizerPluginContext,
  LoadedConfig,
  LogLevel,
  LoggerLike,
  OptimizationResult,
  OptimizerOptions,
  OutputArtifact,
  OutputArtifactStatus,
  OutputFormat,
  ProgressStats,
  QualityProfile,
  ResolvedOptimizerOptions,
  RewriteChange,
  RewriteQuote,
  RewriteResult,
  SupportedInputFormat,
} from './types';
