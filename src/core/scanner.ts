import fs from 'node:fs/promises';
import path from 'node:path';

import picomatch from 'picomatch';

import {
  GENERATED_OUTPUT_MTIME_TOLERANCE_MS,
  assertPathInsideRoot,
  getSupportedExtension,
  normalizePattern,
  toPosixPath,
} from './security';
import type { FileRecord, ResolvedOptimizerOptions } from '../types';

export async function scanDirectory(
  rootDir: string,
  options: Pick<ResolvedOptimizerOptions, 'include' | 'exclude'>,
): Promise<FileRecord[]> {
  const includeMatcher = createMatcher(options.include, 'include');
  const excludeMatcher = createMatcher(options.exclude, 'exclude');
  const files: FileRecord[] = [];

  await walkDirectory(rootDir);
  return disambiguateOutputCollisions(filterGeneratedFallbacks(files)).sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );

  async function walkDirectory(currentDirectory: string): Promise<void> {
    const securedDirectory = assertPathInsideRoot(rootDir, currentDirectory, 'Directory');
    const entries = await fs.readdir(securedDirectory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      const absolutePath = assertPathInsideRoot(
        rootDir,
        path.join(securedDirectory, entry.name),
        'Entry',
      );
      const relativePath = toPosixPath(path.relative(rootDir, absolutePath));

      if (entry.isDirectory()) {
        if (relativePath !== '' && excludeMatcher(`${relativePath}/`)) {
          continue;
        }

        await walkDirectory(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = getSupportedExtension(absolutePath);
      if (extension === null) {
        continue;
      }

      if (excludeMatcher(relativePath) || !includeMatcher(relativePath)) {
        continue;
      }

      const stats = await fs.stat(absolutePath);
      files.push({
        absolutePath,
        relativePath,
        extension,
        size: stats.size,
        modifiedAtMs: stats.mtimeMs,
      });
    }
  }
}

function createMatcher(
  patterns: readonly string[],
  mode: 'include' | 'exclude',
): (value: string) => boolean {
  const expandedPatterns = patterns.flatMap((pattern) => expandPattern(pattern, mode));

  if (expandedPatterns.length === 0) {
    return mode === 'include' ? () => true : () => false;
  }

  const matcher = picomatch(expandedPatterns, {
    dot: true,
    nocase: true,
  });

  return (value: string): boolean => matcher(normalizePattern(value));
}

function expandPattern(pattern: string, mode: 'include' | 'exclude'): string[] {
  const normalized = normalizePattern(pattern);

  if (normalized.length === 0) {
    return [];
  }

  if (/[\\*?[\]{}()!+@]/.test(normalized)) {
    return [normalized];
  }

  if (mode === 'include') {
    return [normalized, `**/${normalized}`];
  }

  return [normalized, `${normalized}/**`, `**/${normalized}`, `**/${normalized}/**`];
}

function filterGeneratedFallbacks(files: readonly FileRecord[]): FileRecord[] {
  const nonWebpSourcesByStem = new Map<string, FileRecord[]>();

  for (const file of files) {
    if (file.extension === 'webp') {
      continue;
    }

    const stemKey = getStemKey(file.relativePath);
    const existing = nonWebpSourcesByStem.get(stemKey) ?? [];
    existing.push(file);
    nonWebpSourcesByStem.set(stemKey, existing);
  }

  return files.filter(
    (file) =>
      !(
        file.extension === 'webp' &&
        hasGeneratedSourceSibling(
          file,
          nonWebpSourcesByStem.get(getStemKey(file.relativePath)) ?? [],
        )
      ),
  );
}

function getStemKey(relativePath: string): string {
  return relativePath.replace(/\.[^.]+$/u, '').toLowerCase();
}

function hasGeneratedSourceSibling(webpFile: FileRecord, siblings: readonly FileRecord[]): boolean {
  return siblings.some(
    (sibling) =>
      Math.abs(sibling.modifiedAtMs - webpFile.modifiedAtMs) <= GENERATED_OUTPUT_MTIME_TOLERANCE_MS,
  );
}

function disambiguateOutputCollisions(files: readonly FileRecord[]): FileRecord[] {
  const filesByStem = new Map<string, FileRecord[]>();

  for (const file of files) {
    const stemKey = getStemKey(file.relativePath);
    const existing = filesByStem.get(stemKey) ?? [];
    existing.push(file);
    filesByStem.set(stemKey, existing);
  }

  return files.map((file) => {
    const stemKey = getStemKey(file.relativePath);
    const collisions = filesByStem.get(stemKey) ?? [];

    if (collisions.length <= 1) {
      return file;
    }

    return {
      ...file,
      outputRelativeBasePath: file.relativePath,
    };
  });
}
