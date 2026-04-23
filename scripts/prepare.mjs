import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

if (!fs.existsSync('.git')) {
  process.exit(0);
}

const result = spawnSync('npx', ['husky'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
