import chalk from 'chalk';

import { formatBytes } from './security';
import type {
  FileProcessingResult,
  LogLevel,
  LoggerLike,
  OptimizationResult,
  ProgressStats,
  ResolvedOptimizerOptions,
} from '../types';

export interface Logger extends LoggerLike {
  start(totalFiles: number, config: ResolvedOptimizerOptions): void;
  fileResult(result: FileProcessingResult): void;
  summary(result: OptimizationResult): void;
}

export function createLogger(level: LogLevel): Logger {
  const isSilent = level === 'silent';
  const isVerbose = level === 'verbose' || level === 'debug';
  const isDebug = level === 'debug';

  const write = (message: string): void => {
    if (!isSilent) {
      console.log(message);
    }
  };

  const logger: Logger = {
    info(message) {
      write(chalk.cyan(message));
    },
    warn(message) {
      write(chalk.yellow(message));
    },
    error(message) {
      write(chalk.red(message));
    },
    success(message) {
      write(chalk.green(message));
    },
    verbose(message) {
      if (isVerbose) {
        write(chalk.gray(message));
      }
    },
    debug(message) {
      if (isDebug) {
        write(chalk.magenta(`[debug] ${message}`));
      }
    },
    start(totalFiles, config) {
      if (isSilent) {
        return;
      }

      const mode = config.dryRun ? chalk.yellow('dry-run') : chalk.green('live');
      const output = config.outputDir ?? 'source directories';

      write(
        chalk.cyan(
          `image-optimizer-pro -> ${totalFiles} file(s), concurrency ${config.concurrency}, output ${output}, mode ${mode}`,
        ),
      );
    },
    fileResult(result) {
      if (!isVerbose || isSilent) {
        return;
      }

      const prefix = getResultPrefix(result);
      const summary = result.outputs
        .map(
          (output) =>
            `${output.format}:${output.status}${output.bytes ? `(${formatBytes(output.bytes)})` : ''}`,
        )
        .join(', ');

      write(`${prefix} ${result.relativePath}${summary ? ` -> ${summary}` : ''}`);

      for (const error of result.errors) {
        write(chalk.red(`  ${error}`));
      }
    },
    summary(result) {
      if (isSilent) {
        return;
      }

      const { stats } = result;
      const durationSeconds = (result.durationMs / 1000).toFixed(2);
      const headline =
        stats.errorFiles > 0 ? chalk.yellow('completed with issues') : chalk.green('completed');

      write(
        `${headline} in ${durationSeconds}s | total ${stats.totalFiles} | processed ${stats.processedFiles} | skipped ${stats.skippedFiles} | errors ${stats.errorFiles} | outputs ${stats.generatedFiles}`,
      );
      write(
        chalk.gray(
          `input ${formatBytes(stats.inputBytes)} -> generated ${formatBytes(stats.outputBytes)}${formatDryRunSuffix(
            result.config.dryRun,
            stats,
          )}`,
        ),
      );
    },
  };

  return logger;
}

export function snapshotStats(stats: ProgressStats): ProgressStats {
  return {
    totalFiles: stats.totalFiles,
    processedFiles: stats.processedFiles,
    skippedFiles: stats.skippedFiles,
    errorFiles: stats.errorFiles,
    generatedFiles: stats.generatedFiles,
    inputBytes: stats.inputBytes,
    outputBytes: stats.outputBytes,
  };
}

function getResultPrefix(result: FileProcessingResult): string {
  switch (result.status) {
    case 'processed':
      return chalk.green('[processed]');
    case 'partial':
      return chalk.yellow('[partial]');
    case 'error':
      return chalk.red('[error]');
    case 'skipped':
      return chalk.gray('[skipped]');
    default:
      return chalk.white('[info]');
  }
}

function formatDryRunSuffix(dryRun: boolean, stats: ProgressStats): string {
  if (!dryRun) {
    return '';
  }

  return stats.generatedFiles > 0 ? ' (simulated writes)' : ' (dry run)';
}
