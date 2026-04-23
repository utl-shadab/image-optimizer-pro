export type OutputFormat = 'avif' | 'webp';

export type SupportedInputFormat = 'png' | 'jpg' | 'jpeg' | 'webp';

export type LogLevel = 'silent' | 'normal' | 'verbose' | 'debug';

export type FileProcessStatus = 'processed' | 'partial' | 'skipped' | 'error';

export type OutputArtifactStatus =
  | 'generated'
  | 'dry-run'
  | 'up-to-date'
  | 'skipped-same-format'
  | 'failed';

export interface QualityProfile {
  small: number;
  medium: number;
  large: number;
}

export interface FileRecord {
  absolutePath: string;
  relativePath: string;
  extension: SupportedInputFormat;
  size: number;
  modifiedAtMs: number;
  outputRelativeBasePath?: string;
}

export interface OutputArtifact {
  format: OutputFormat;
  absolutePath: string;
  relativePath: string;
  status: OutputArtifactStatus;
  bytes?: number;
  message?: string;
}

export interface FileProcessingResult {
  sourcePath: string;
  relativePath: string;
  status: FileProcessStatus;
  quality: number | null;
  outputs: OutputArtifact[];
  errors: string[];
  durationMs: number;
}

export interface ProgressStats {
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  errorFiles: number;
  generatedFiles: number;
  inputBytes: number;
  outputBytes: number;
}

export interface LoggerLike {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  verbose(message: string): void;
  debug(message: string): void;
  success(message: string): void;
}

export interface ImageOptimizerPluginContext {
  rootDir: string;
  config: ResolvedOptimizerOptions;
  stats: Readonly<ProgressStats>;
  logger: LoggerLike;
}

export interface ImageOptimizerPlugin {
  name: string;
  setup?(context: ImageOptimizerPluginContext): Promise<void> | void;
  onFileStart?(file: FileRecord, context: ImageOptimizerPluginContext): Promise<void> | void;
  onFileComplete?(
    result: FileProcessingResult,
    context: ImageOptimizerPluginContext,
  ): Promise<void> | void;
  onComplete?(
    result: OptimizationResult,
    context: ImageOptimizerPluginContext,
  ): Promise<void> | void;
}

export interface OptimizerOptions {
  quality?: Partial<QualityProfile>;
  formats?: OutputFormat[];
  include?: string[];
  exclude?: string[];
  outputDir?: string;
  concurrency?: number;
  dryRun?: boolean;
  verbose?: boolean;
  silent?: boolean;
  debug?: boolean;
  config?: string;
  plugins?: ImageOptimizerPlugin[];
}

export interface CliOutputWriter {
  write(chunk: string): void;
}

export interface CliRunOptions {
  stdout?: CliOutputWriter;
  stderr?: CliOutputWriter;
}

export interface ResolvedOptimizerOptions {
  rootDir: string;
  quality: QualityProfile;
  formats: OutputFormat[];
  include: string[];
  exclude: string[];
  outputDir?: string;
  concurrency: number;
  dryRun: boolean;
  logLevel: LogLevel;
  configFilePath?: string;
  plugins: ImageOptimizerPlugin[];
}

export interface LoadedConfig {
  config: Partial<OptimizerOptions>;
  configFilePath?: string;
}

export interface OptimizationResult {
  rootDir: string;
  config: ResolvedOptimizerOptions;
  stats: ProgressStats;
  files: FileProcessingResult[];
  durationMs: number;
}
