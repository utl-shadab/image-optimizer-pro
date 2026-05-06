import fs from 'node:fs/promises';
import path from 'node:path';

import { toPosixPath } from './security';
import type {
  FileProcessingResult,
  ImageManifestEntry,
  ImageManifestOutput,
  OptimizationResult,
  OutputArtifact,
} from '../types';

const MANIFEST_OUTPUT_STATUSES = new Set(['generated', 'up-to-date', 'dry-run']);

export function buildImageManifest(
  result: Pick<OptimizationResult, 'rootDir' | 'files'>,
): ImageManifestEntry[] {
  const publicRoot = findPublicRoot(result.rootDir);

  return result.files
    .map((fileResult) => buildManifestEntry(publicRoot, fileResult))
    .filter((entry): entry is ImageManifestEntry => entry !== null);
}

export async function writeImageManifest(
  manifest: readonly ImageManifestEntry[],
  manifestPath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function buildManifestEntry(
  publicRoot: string,
  fileResult: FileProcessingResult,
): ImageManifestEntry | null {
  if (fileResult.errors.length > 0) {
    return null;
  }

  const outputs = fileResult.outputs
    .filter((output) => MANIFEST_OUTPUT_STATUSES.has(output.status))
    .map((output) => buildManifestOutput(publicRoot, output));

  if (outputs.length === 0) {
    return null;
  }

  return {
    sourceAbsolutePath: fileResult.sourcePath,
    sourceRelativePath: toPosixPath(path.relative(publicRoot, fileResult.sourcePath)),
    outputs,
  };
}

function buildManifestOutput(publicRoot: string, output: OutputArtifact): ImageManifestOutput {
  const relativePath = toPosixPath(path.relative(publicRoot, output.absolutePath));

  return {
    format: output.format,
    absolutePath: output.absolutePath,
    relativePath,
    publicPath: `/${relativePath}`,
  };
}

function findPublicRoot(rootDir: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const parsedPath = path.parse(resolvedRoot);
  const pathSegments = path
    .relative(parsedPath.root, resolvedRoot)
    .split(path.sep)
    .filter((segment) => segment.length > 0);

  const publicSegmentIndex = findLastIndex(
    pathSegments,
    (segment) => segment.toLowerCase() === 'public',
  );

  if (publicSegmentIndex === -1) {
    return resolvedRoot;
  }

  return path.join(parsedPath.root, ...pathSegments.slice(0, publicSegmentIndex + 1));
}

function findLastIndex<T>(values: readonly T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];

    if (value !== undefined && predicate(value)) {
      return index;
    }
  }

  return -1;
}
