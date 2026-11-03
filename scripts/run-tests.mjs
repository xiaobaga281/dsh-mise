/**
 * Run every test file in tests/ once, in order, and report a single verdict.
 *
 * `npm run test:all` pointed at this file long before it existed, so the only
 * way to run the suite was to type each file by hand — which is how a failing
 * regression test stays unnoticed. Each file is a standalone `node <file>`
 * script (node:test), so this just spawns them and stops counting at the first
 * failure while still running the rest: one red test should not hide the other
 * seven.
 *
 *   node scripts/run-tests.mjs
 *   node scripts/run-tests.mjs --bail     stop at the first failure
 */

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TESTS = join(ROOT, 'tests');
const bail = process.argv.includes('--bail');

const files = readdirSync(TESTS)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

if (files.length === 0) {
  console.error('no tests/*.test.mjs found');
  process.exit(1);
}

const failed = [];
const started = Date.now();
for (const file of files) {
  const begin = Date.now();
  const run = spawnSync(process.execPath, [join(TESTS, file)], { cwd: ROOT, encoding: 'utf8' });
  const ms = Date.now() - begin;
  if (run.status === 0) {
    console.log(`ok    ${file.padEnd(28)} ${String(ms).padStart(5)}ms`);
    continue;
  }
  failed.push({ file, output: `${run.stdout ?? ''}${run.stderr ?? ''}` });
  console.log(`FAIL  ${file.padEnd(28)} ${String(ms).padStart(5)}ms`);
  if (bail) break;
}

if (failed.length) {
  for (const failure of failed) {
    console.log(`\n── ${failure.file} ──`);
    console.log(failure.output.split('\n').filter((line) => /not ok|error:|AssertionError|expected|actual/.test(line)).slice(0, 12).join('\n') || failure.output.slice(-800));
  }
}

const total = Date.now() - started;
console.log(`\n${files.length - failed.length}/${files.length} files passed in ${(total / 1000).toFixed(1)}s`);
process.exit(failed.length ? 1 : 0);
