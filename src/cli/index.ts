#!/usr/bin/env node

import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command, CommanderError, InvalidArgumentError } from 'commander';

import { optimizeImages } from '../core/optimizer';
import { formatErrorMessage } from '../core/security';
import type { CliRunOptions, OptimizerOptions, OutputFormat } from '../types';

interface CliOptions {
  config?: string;
  verbose?: boolean;
  silent?: boolean;
  debug?: boolean;
  dryRun?: boolean;
  concurrency?: number;
  output?: string;
  format?: OutputFormat[];
}

export function createCliProgram(options: CliRunOptions = {}): Command {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  return new Command()
    .name('img-optimize')
    .description('Convert PNG, JPG, JPEG, and WebP assets into AVIF and WebP outputs.')
    .showHelpAfterError()
    .configureOutput({
      writeOut: (message) => {
        stdout.write(message);
      },
      writeErr: (message) => {
        stderr.write(message);
      },
      outputError: (message, write) => {
        write(message);
      },
    })
    .argument('<dir>', 'directory to scan recursively')
    .option('-c, --config <path>', 'path to an image-optimizer config file')
    .option('-o, --output <dir>', 'write optimized assets into a nested output directory')
    .option('--dry-run', 'scan and report without writing output files')
    .option('--verbose', 'enable per-file logs')
    .option('--silent', 'suppress non-error logs')
    .option('--debug', 'enable debug logging')
    .option(
      '--concurrency <number>',
      'number of files to process in parallel',
      parsePositiveInteger,
    )
    .option('--format <formats...>', 'output formats to generate (avif webp)', collectFormatOption)
    .action(async (dir: string, cliOptions: CliOptions) => {
      const optimizerOptions = resolveCliOptions(cliOptions);

      const result = await optimizeImages(dir, optimizerOptions);
      process.exitCode = result.stats.errorFiles > 0 ? 1 : 0;
    });
}

export async function runCli(
  argv: readonly string[],
  options: CliRunOptions = {},
): Promise<number> {
  const stderr = options.stderr ?? process.stderr;
  const program = createCliProgram(options);
  const previousExitCode = process.exitCode;
  program.exitOverride();

  try {
    process.exitCode = undefined;
    await program.parseAsync(argv, { from: 'user' });
    return normalizeExitCode(process.exitCode);
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }

    stderr.write(`image-optimizer-pro: ${formatErrorMessage(error)}\n`);
    return 1;
  } finally {
    process.exitCode = previousExitCode;
  }
}

function resolveCliOptions(cliOptions: CliOptions): OptimizerOptions {
  return {
    ...(cliOptions.config !== undefined ? { config: cliOptions.config } : {}),
    ...(cliOptions.verbose !== undefined ? { verbose: cliOptions.verbose } : {}),
    ...(cliOptions.silent !== undefined ? { silent: cliOptions.silent } : {}),
    ...(cliOptions.debug !== undefined ? { debug: cliOptions.debug } : {}),
    ...(cliOptions.dryRun !== undefined ? { dryRun: cliOptions.dryRun } : {}),
    ...(cliOptions.concurrency !== undefined ? { concurrency: cliOptions.concurrency } : {}),
    ...(cliOptions.output !== undefined ? { outputDir: cliOptions.output } : {}),
    ...(cliOptions.format !== undefined ? { formats: cliOptions.format } : {}),
  };
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('Expected a positive integer.');
  }

  return parsed;
}

function collectFormatOption(value: string, previous: OutputFormat[] = []): OutputFormat[] {
  const normalized = value.toLowerCase();

  if (normalized !== 'avif' && normalized !== 'webp') {
    throw new InvalidArgumentError(`Unsupported format "${value}".`);
  }

  const format: OutputFormat = normalized;
  return [...new Set([...previous, format])];
}

function normalizeExitCode(exitCode: string | number | undefined): number {
  if (exitCode === undefined) {
    return 0;
  }

  if (typeof exitCode === 'number') {
    return exitCode;
  }

  const parsed = Number.parseInt(exitCode, 10);
  return Number.isInteger(parsed) ? parsed : 1;
}

if (isExecutedDirectly()) {
  void runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}

function isExecutedDirectly(): boolean {
  if (process.argv[1] === undefined) {
    return false;
  }

  return (
    normalizeExecutionPath(process.argv[1]) ===
    normalizeExecutionPath(fileURLToPath(import.meta.url))
  );
}

function normalizeExecutionPath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);

  try {
    return fs.realpathSync.native(resolvedPath);
  } catch {
    return resolvedPath;
  }
}
