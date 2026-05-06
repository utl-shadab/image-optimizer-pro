import fs from 'node:fs/promises';
import path from 'node:path';

import { assertNoNullBytes, toPosixPath } from './security';
import type {
  ImageManifestEntry,
  ImageManifestOutput,
  OutputFormat,
  RewriteChange,
  RewriteQuote,
  RewriteResult,
} from '../types';

export const DEFAULT_REWRITE_EXTENSIONS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'html',
  'css',
  'scss',
  'sass',
  'json',
  'md',
  'mdx',
];

const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
]);

interface RewriteImageReferencesOptions {
  targets: readonly string[];
  extensions?: readonly string[];
  prefer?: OutputFormat;
  dryRun?: boolean;
  cwd?: string;
}

interface ReplacementEntry {
  sourceAbsolutePath: string;
  sourcePublicPath: string;
  sourceRelativePath: string;
  output: ImageManifestOutput;
}

interface ReplacementResolution {
  replacement: string;
  sourceAbsolutePath: string;
  outputAbsolutePath: string;
}

interface StaticStringLiteral {
  start: number;
  end: number;
  quote: RewriteQuote;
  value: string;
}

interface PendingReplacement {
  start: number;
  end: number;
  replacement: string;
  change: RewriteChange;
}

type ParsedLiteral =
  | {
      kind: 'literal';
      literal: StaticStringLiteral;
      nextIndex: number;
    }
  | {
      kind: 'skip';
      nextIndex: number;
    };

export async function rewriteImageReferences(
  manifest: readonly ImageManifestEntry[],
  options: RewriteImageReferencesOptions,
): Promise<RewriteResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const dryRun = options.dryRun ?? false;
  const extensions = normalizeRewriteExtensions(options.extensions ?? DEFAULT_REWRITE_EXTENSIONS);
  const replacementEntries = createReplacementEntries(manifest, options.prefer);
  const files = await collectRewriteFiles(options.targets, extensions, cwd);
  const changes: RewriteChange[] = [];
  let filesChanged = 0;

  for (const filePath of files) {
    const buffer = await fs.readFile(filePath);

    if (isBinaryBuffer(buffer)) {
      continue;
    }

    const content = buffer.toString('utf8');
    const result = rewriteFileContent(filePath, cwd, content, replacementEntries);

    if (result.changes.length === 0) {
      continue;
    }

    filesChanged += 1;
    changes.push(...result.changes);

    if (!dryRun) {
      await fs.writeFile(filePath, result.content, 'utf8');
    }
  }

  return {
    filesScanned: files.length,
    filesChanged,
    replacements: changes.length,
    changes,
    dryRun,
  };
}

function createReplacementEntries(
  manifest: readonly ImageManifestEntry[],
  prefer: OutputFormat | undefined,
): ReplacementEntry[] {
  const entries: ReplacementEntry[] = [];

  for (const manifestEntry of manifest) {
    const output = selectManifestOutput(manifestEntry.outputs, prefer);

    if (output === null) {
      continue;
    }

    entries.push({
      sourceAbsolutePath: manifestEntry.sourceAbsolutePath,
      sourcePublicPath: `/${manifestEntry.sourceRelativePath}`,
      sourceRelativePath: manifestEntry.sourceRelativePath,
      output,
    });
  }

  return entries;
}

function selectManifestOutput(
  outputs: readonly ImageManifestOutput[],
  prefer: OutputFormat | undefined,
): ImageManifestOutput | null {
  if (outputs.length === 0) {
    return null;
  }

  if (prefer !== undefined) {
    const preferredOutput = outputs.find((output) => output.format === prefer);

    if (preferredOutput !== undefined) {
      return preferredOutput;
    }
  }

  return outputs[0] ?? null;
}

async function collectRewriteFiles(
  targets: readonly string[],
  extensions: ReadonlySet<string>,
  cwd: string,
): Promise<string[]> {
  const files: string[] = [];
  const seenFiles = new Set<string>();

  for (const target of targets) {
    const resolvedTarget = resolveRewriteTarget(target, cwd);
    const stats = await fs.lstat(resolvedTarget).catch(() => {
      throw new Error(`Rewrite target does not exist: ${resolvedTarget}`);
    });

    if (stats.isSymbolicLink()) {
      continue;
    }

    if (stats.isDirectory()) {
      if (isExcludedDirectory(resolvedTarget)) {
        continue;
      }

      await walkRewriteDirectory(resolvedTarget, extensions, files, seenFiles);
      continue;
    }

    if (stats.isFile() && shouldScanFile(resolvedTarget, extensions)) {
      addRewriteFile(files, seenFiles, resolvedTarget);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function walkRewriteDirectory(
  directory: string,
  extensions: ReadonlySet<string>,
  files: string[],
  seenFiles: Set<string>,
): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!isExcludedDirectory(absolutePath)) {
        await walkRewriteDirectory(absolutePath, extensions, files, seenFiles);
      }

      continue;
    }

    if (entry.isFile() && shouldScanFile(absolutePath, extensions)) {
      addRewriteFile(files, seenFiles, absolutePath);
    }
  }
}

function resolveRewriteTarget(target: string, cwd: string): string {
  assertNoNullBytes(target, 'Rewrite target');

  if (target.trim().length === 0) {
    throw new Error('Rewrite target must not be empty.');
  }

  if (path.isAbsolute(target)) {
    return path.resolve(target);
  }

  const resolvedTarget = path.resolve(cwd, target);
  const relativePath = path.relative(cwd, resolvedTarget);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Relative rewrite targets must stay inside the current working directory.');
  }

  return resolvedTarget;
}

function normalizeRewriteExtensions(extensions: readonly string[]): ReadonlySet<string> {
  const normalizedExtensions = new Set<string>();

  for (const extension of extensions) {
    assertNoNullBytes(extension, 'Rewrite extension');

    const normalized = extension.trim().toLowerCase().replace(/^\.+/u, '');

    if (normalized.length > 0) {
      normalizedExtensions.add(normalized);
    }
  }

  return normalizedExtensions;
}

function isExcludedDirectory(directory: string): boolean {
  return EXCLUDED_DIRECTORIES.has(path.basename(directory));
}

function shouldScanFile(filePath: string, extensions: ReadonlySet<string>): boolean {
  const extension = path.extname(filePath).toLowerCase().replace(/^\./u, '');
  return extension.length > 0 && extensions.has(extension);
}

function addRewriteFile(files: string[], seenFiles: Set<string>, filePath: string): void {
  const key = createPathKey(filePath);

  if (seenFiles.has(key)) {
    return;
  }

  seenFiles.add(key);
  files.push(filePath);
}

function rewriteFileContent(
  filePath: string,
  cwd: string,
  content: string,
  replacementEntries: readonly ReplacementEntry[],
): { content: string; changes: RewriteChange[] } {
  const literals = findStaticStringLiterals(content);
  const replacements: PendingReplacement[] = [];

  for (const literal of literals) {
    const resolution = resolveReplacement(literal.value, replacementEntries);

    if (resolution === null || resolution.replacement === literal.value) {
      continue;
    }

    replacements.push({
      start: literal.start,
      end: literal.end,
      replacement: resolution.replacement,
      change: {
        filePath,
        fileRelativePath: toPosixPath(path.relative(cwd, filePath)),
        sourceAbsolutePath: resolution.sourceAbsolutePath,
        outputAbsolutePath: resolution.outputAbsolutePath,
        original: literal.value,
        replacement: resolution.replacement,
        quote: literal.quote,
      },
    });
  }

  if (replacements.length === 0) {
    return { content, changes: [] };
  }

  let rewrittenContent = '';
  let cursor = 0;

  for (const replacement of replacements) {
    rewrittenContent += content.slice(cursor, replacement.start);
    rewrittenContent += replacement.replacement;
    cursor = replacement.end;
  }

  rewrittenContent += content.slice(cursor);

  return {
    content: rewrittenContent,
    changes: replacements.map((replacement) => replacement.change),
  };
}

function resolveReplacement(
  value: string,
  replacementEntries: readonly ReplacementEntry[],
): ReplacementResolution | null {
  if (value.includes('\0') || isExternalReference(value)) {
    return null;
  }

  for (const entry of replacementEntries) {
    if (value === entry.sourcePublicPath) {
      return {
        replacement: entry.output.publicPath,
        sourceAbsolutePath: entry.sourceAbsolutePath,
        outputAbsolutePath: entry.output.absolutePath,
      };
    }

    const relativeReference = parseRelativeReference(value);

    if (relativeReference !== null && relativeReference.remainder === entry.sourceRelativePath) {
      return {
        replacement: `${relativeReference.prefix}${entry.output.relativePath}`,
        sourceAbsolutePath: entry.sourceAbsolutePath,
        outputAbsolutePath: entry.output.absolutePath,
      };
    }
  }

  return null;
}

function parseRelativeReference(value: string): { prefix: string; remainder: string } | null {
  if (value.startsWith('/') || value.startsWith('#') || isExternalReference(value)) {
    return null;
  }

  const normalizedValue = value.replace(/\\/g, '/');
  const relativeMatch = /^((?:\.\.?\/)+)(.+)$/u.exec(normalizedValue);

  if (relativeMatch !== null) {
    const prefix = relativeMatch[1];
    const remainder = relativeMatch[2];

    if (prefix !== undefined && remainder !== undefined) {
      return { prefix, remainder };
    }
  }

  return { prefix: '', remainder: normalizedValue };
}

function isExternalReference(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/u.test(value) || value.startsWith('//');
}

function findStaticStringLiterals(content: string): StaticStringLiteral[] {
  const literals: StaticStringLiteral[] = [];
  let index = 0;

  while (index < content.length) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (character === '/' && nextCharacter === '/') {
      index = skipLineComment(content, index + 2);
      continue;
    }

    if (character === '/' && nextCharacter === '*') {
      index = skipBlockComment(content, index + 2);
      continue;
    }

    if (character === '"' || character === "'" || character === '`') {
      const parsed = readStringLiteral(content, index, character);

      if (parsed.kind === 'literal') {
        literals.push(parsed.literal);
      }

      index = parsed.nextIndex;
      continue;
    }

    index += 1;
  }

  return literals;
}

function readStringLiteral(
  content: string,
  quoteStart: number,
  quote: RewriteQuote,
): ParsedLiteral {
  let cursor = quoteStart + 1;
  let hasTemplateInterpolation = false;

  while (cursor < content.length) {
    const character = content[cursor];
    const nextCharacter = content[cursor + 1];

    if (character === '\\') {
      cursor += 2;
      continue;
    }

    if (quote === '`' && character === '$' && nextCharacter === '{') {
      hasTemplateInterpolation = true;
      cursor += 2;
      continue;
    }

    if (character === quote) {
      if (hasTemplateInterpolation) {
        return {
          kind: 'skip',
          nextIndex: cursor + 1,
        };
      }

      return {
        kind: 'literal',
        literal: {
          start: quoteStart + 1,
          end: cursor,
          quote,
          value: content.slice(quoteStart + 1, cursor),
        },
        nextIndex: cursor + 1,
      };
    }

    cursor += 1;
  }

  return {
    kind: 'skip',
    nextIndex: content.length,
  };
}

function skipLineComment(content: string, startIndex: number): number {
  const lineEndIndex = content.indexOf('\n', startIndex);
  return lineEndIndex === -1 ? content.length : lineEndIndex + 1;
}

function skipBlockComment(content: string, startIndex: number): number {
  const blockEndIndex = content.indexOf('*/', startIndex);
  return blockEndIndex === -1 ? content.length : blockEndIndex + 2;
}

function isBinaryBuffer(buffer: Buffer): boolean {
  if (buffer.includes(0)) {
    return true;
  }

  let controlCharacterCount = 0;

  for (const byte of buffer) {
    const isAllowedWhitespace = byte === 9 || byte === 10 || byte === 13;
    const isControlCharacter = byte < 32 && !isAllowedWhitespace;

    if (isControlCharacter) {
      controlCharacterCount += 1;
    }
  }

  return controlCharacterCount > Math.max(8, buffer.length * 0.05);
}

function createPathKey(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}
