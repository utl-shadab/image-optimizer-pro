[![npm version](https://img.shields.io/npm/v/image-optimizer-pro.svg)](https://www.npmjs.com/package/image-optimizer-pro)
[![npm downloads](https://img.shields.io/npm/dm/image-optimizer-pro.svg)](https://www.npmjs.com/package/image-optimizer-pro)
[![license](https://img.shields.io/npm/l/image-optimizer-pro.svg)](./LICENSE)

# image-optimizer-pro

Production-grade image optimization for Node.js and modern JavaScript frameworks.

`image-optimizer-pro` recursively scans directories, converts supported raster assets into AVIF as the primary output and WebP as the fallback output, and exposes both a CLI and a typed programmatic API.

## Features

- AVIF-first output pipeline with optional WebP fallback generation
- Recursive scanning for `png`, `jpg`, `jpeg`, and `webp`
- Smart quality strategy based on source file size
- Safe output path handling that keeps writes inside the declared root
- Config support through `image-optimizer.config.js`, CLI flags, or API options
- Concurrency queue tuned to CPU core count by default
- Per-file error isolation so one corrupted asset does not stop the full run
- Logging modes for normal, verbose, silent, and debug workflows
- Dry-run mode for CI and preview builds
- Atomic output replacement to avoid partial writes
- Same-directory rerun protection for generated WebP fallbacks
- Dual ESM/CJS output with generated TypeScript declarations
- Lightweight plugin hooks for future integrations

## Installation

```bash
npm install image-optimizer-pro
```

Global CLI install:

```bash
npm install --global image-optimizer-pro
```

## CLI Usage

Basic:

```bash
img-optimize ./public/images
```

Write into a nested output folder:

```bash
img-optimize ./public/images --output optimized
```

Dry-run validation:

```bash
img-optimize ./images --dry-run --verbose
```

AVIF only:

```bash
img-optimize ./assets --format avif
```

### Options

```bash
img-optimize <dir> [options]

Options:
  -c, --config <path>       path to an image-optimizer config file
  -o, --output <dir>        write optimized assets into a nested output directory
      --dry-run             scan and report without writing output files
      --verbose             enable per-file logs
      --silent              suppress non-error logs
      --debug               enable debug logging
      --concurrency <n>     number of files to process in parallel
      --format <formats...> output formats to generate (avif webp)
  -h, --help                display help for command
```

### Example Commands

```bash
img-optimize ./public
img-optimize ./assets --verbose
img-optimize ./images --dry-run
img-optimize ./gallery --concurrency 4 --format avif webp
img-optimize ./src/assets --config ./image-optimizer.config.js
```

## API Usage

### Basic

```ts
import { optimizeImages } from 'image-optimizer-pro';

const result = await optimizeImages('./public/images', {
  outputDir: 'optimized',
  concurrency: 4,
  verbose: true,
});

console.log(result.stats);
```

### Typed Configuration

```ts
import type { OptimizerOptions } from 'image-optimizer-pro';

const options: OptimizerOptions = {
  quality: {
    small: 60,
    medium: 50,
    large: 40,
  },
  formats: ['avif', 'webp'],
  include: ['**/*'],
  exclude: ['node_modules', '.git'],
  outputDir: 'optimized',
  concurrency: 8,
  dryRun: false,
  verbose: true,
};
```

### CLI Embedding

```ts
import { runCli } from 'image-optimizer-pro';

const exitCode = await runCli(['./public', '--dry-run']);
console.log(exitCode);
```

## Config File

Create `image-optimizer.config.js`:

```js
module.exports = {
  quality: {
    small: 60,
    medium: 50,
    large: 40,
  },
  formats: ['avif', 'webp'],
  include: ['**/*'],
  exclude: ['node_modules', '.git'],
  outputDir: 'optimized',
  concurrency: 4,
  dryRun: false,
  verbose: false,
};
```

CLI flags and API options override config file values.

## Smart Compression Strategy

| Source size | Output quality |
| ----------- | -------------- |
| `< 200 KB`  | `60`           |
| `< 1 MB`    | `50`           |
| `>= 1 MB`   | `40`           |

## Logging and Progress

Each run tracks:

- Total files discovered
- Processed file count
- Skipped file count
- Files with errors
- Total generated output files
- Input and output byte totals

Logging modes:

- `normal`: summary output only
- `verbose`: summary plus per-file status output
- `silent`: suppress non-error logs
- `debug`: verbose logs plus plugin/internal debug messages

## Security

- All input and output paths are resolved inside the declared root
- `outputDir` must stay inside the input directory
- Path values reject null bytes
- Symbolic links are skipped during recursive scans
- Generated outputs are replaced atomically to avoid partial files
- Existing outputs are overwritten only when the source is newer
- Corrupted images fail in isolation and do not stop the full queue
- Sharp input processing uses sequential reads with input pixel limits

## Framework Usage

### Next.js

Optimize static assets before deployment:

```json
{
  "scripts": {
    "optimize:images": "img-optimize ./public --output optimized",
    "build": "npm run optimize:images && next build"
  }
}
```

### React / Vite

```json
{
  "scripts": {
    "optimize:images": "img-optimize ./src/assets --output optimized",
    "build": "npm run optimize:images && vite build"
  }
}
```

### Node.js Build Pipeline

```ts
import { optimizeImages } from 'image-optimizer-pro';

await optimizeImages('./assets', {
  outputDir: 'optimized',
  silent: false,
});
```

## Plugin System

```ts
import { optimizeImages, type ImageOptimizerPlugin } from 'image-optimizer-pro';

const plugin: ImageOptimizerPlugin = {
  name: 'metrics',
  onFileComplete(result, context) {
    context.logger.debug(`${result.relativePath}: ${result.status}`);
  },
};

await optimizeImages('./assets', {
  plugins: [plugin],
});
```

## Benchmarks

Run the built-in benchmark:

```bash
npm run benchmark
```

Example benchmark output:

```json
[
  {
    "scenario": "small-folder",
    "durationMs": 153,
    "sourceBytes": 118203,
    "outputBytes": 39522,
    "processedFiles": 3,
    "skippedFiles": 0,
    "generatedFiles": 5
  },
  {
    "scenario": "large-folder",
    "durationMs": 642,
    "sourceBytes": 1144412,
    "outputBytes": 392307,
    "processedFiles": 6,
    "skippedFiles": 0,
    "generatedFiles": 10
  }
]
```

## Format Comparison

Representative output characteristics:

| Format | Typical size | Use case                                         |
| ------ | ------------ | ------------------------------------------------ |
| PNG    | Largest      | Lossless source assets and alpha-heavy originals |
| WebP   | Smaller      | Broad browser fallback                           |
| AVIF   | Smallest     | Primary delivery target                          |

## FAQ

### Does it overwrite original files?

No. Source files are preserved. Outputs are written beside the source or into `outputDir`.

### What happens when a file fails?

That file is isolated, the error is reported, and the remaining queue continues.

### Does it skip already optimized files?

Yes. If the target output exists, is non-empty, and is newer than the source, it is skipped.

### Can I generate only AVIF?

Yes. Use `--format avif` or `formats: ['avif']`.

### Can I test the CLI globally before publishing?

Yes:

```bash
npm link
img-optimize ./public --dry-run --verbose
```

## Development

```bash
npm ci
npm run check
npm run benchmark
npm run pack:check
```

## Roadmap

- Responsive image variants
- Metadata retention controls
- Cache manifest support
- Additional plugin hooks for reporting and integrations

## License

MIT
