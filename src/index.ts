export { createCliProgram, runCli } from './cli/index';
export { loadOptimizerConfig, resolveLogLevel, resolveOptimizerConfig } from './config';
export { createLogger } from './core/logger';
export { optimizeImages } from './core/optimizer';
export { processImage, selectQuality } from './core/processor';
export { runTaskQueue } from './core/queue';
export { scanDirectory } from './core/scanner';
export type {
  CliOutputWriter,
  CliRunOptions,
  FileProcessingResult,
  FileProcessStatus,
  FileRecord,
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
  SupportedInputFormat,
} from './types';
