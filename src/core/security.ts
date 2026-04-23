import fs from 'node:fs/promises';
import path from 'node:path';

import type { SupportedInputFormat } from '../types';

const SUPPORTED_INPUT_EXTENSIONS: Record<string, SupportedInputFormat> = {
  '.png': 'png',
  '.jpg': 'jpg',
  '.jpeg': 'jpeg',
  '.webp': 'webp',
};

export const MAX_INPUT_PIXELS = 268_402_689;
export const GENERATED_OUTPUT_MTIME_TOLERANCE_MS = 5;

export function getSupportedExtension(filePath: string): SupportedInputFormat | null {
  const extension = path.extname(filePath).toLowerCase();

  return SUPPORTED_INPUT_EXTENSIONS[extension] ?? null;
}

export function assertPathInsideRoot(
  rootDir: string,
  candidatePath: string,
  label = 'Path',
): string {
  const resolvedRoot = normalizeForComparison(path.resolve(rootDir));
  const resolvedCandidate = normalizeForComparison(path.resolve(candidatePath));
  const relativePath = path.relative(resolvedRoot, resolvedCandidate);

  if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
    return path.resolve(candidatePath);
  }

  throw new Error(`${label} must stay within the configured root directory.`);
}

export function normalizePattern(pattern: string): string {
  assertNoNullBytes(pattern, 'Pattern');

  return pattern
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .trim();
}

export function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function assertNoNullBytes(value: string, label: string): void {
  if (value.includes('\0')) {
    throw new Error(`${label} must not contain null bytes.`);
  }
}

export async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeForComparison(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
