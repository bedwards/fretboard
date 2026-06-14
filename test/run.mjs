// Tiny CI-style runner: runs every *.test.mjs file via Node's built-in test
// runner and exits non-zero on any failure.
//
// Usage:  node test/run.mjs
//
// Note: `node --test` (default discovery, run from the repo root) and
// `node --test test/*.test.mjs` are equivalent ways to run the same suite.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Explicitly enumerate the *.test.mjs files so the runner is independent of CWD
// and never tries to execute the non-test helper modules in this directory.
const testFiles = readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()
  .map((f) => join(__dirname, f));

// Guard: Node's default `--test` discovery executes every file inside a test/
// directory. Only actually spawn the suite when run DIRECTLY, so discovery
// doesn't recursively re-invoke the runner.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const child = spawn(process.execPath, ['--test', ...testFiles], {
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`tests terminated by signal ${signal}`);
      process.exit(1);
    }
    process.exit(code === 0 ? 0 : 1);
  });
}
