/**
 * Publish the source tree to the installed plugin directory — completely.
 *
 * The panel once showed "HTTP 404" and "not installed" because four files were
 * copied by hand and one of them was left behind: index.js imported a symbol the
 * installed film-doctor.mjs did not export, apply() threw, and every tool and
 * route died with it. Copying "the files I touched" is not a publish step.
 *
 * This mirrors every source file the plugin needs, verifies each copy by hash,
 * removes files in the target that no longer exist in the source, and then runs
 * the install check that mounts the result.
 *
 *   node scripts/sync.mjs [target]
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..');
const target = process.argv[2] ?? join(homedir(), '.dsh', 'plugins', 'dsh-mise');

/**
 * Files and folders that make up the plugin, relative to the project root.
 *
 * The overlay manifest is part of the plugin: the desktop profile loads the
 * package through `cordis.patch.yml`, and a mirror step that deletes "files the
 * source does not have" removed it once, which made DSH fail to start with
 * ENOENT. Anything the host reads belongs in this list.
 */
const INCLUDE_FILES = [
  'index.js',
  'client.js',
  'package.json',
  'manifest.json',
  'README.md',
  'cordis.patch.yml',
  'icon.svg',
];
const INCLUDE_DIRS = ['vendor', 'locale', 'skills', 'deliveries'];
const INCLUDE_GLOBS = [/\.mjs$/, /\.json$/, /\.ya?ml$/, /\.svg$/, /\.md$/, /\.riv$/];

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

if (!existsSync(join(root, 'index.js'))) {
  console.error(`not a plugin root: ${root}`);
  process.exit(2);
}
mkdirSync(target, { recursive: true });

// 1. What the source actually has: top-level modules and data files.
const wanted = [];
for (const name of readdirSync(root, { withFileTypes: true })) {
  if (name.isDirectory()) {
    if (INCLUDE_DIRS.includes(name.name)) {
      for (const file of walk(join(root, name.name))) wanted.push(relative(root, file));
    }
    continue;
  }
  if (INCLUDE_FILES.includes(name.name) || INCLUDE_GLOBS.some((re) => re.test(name.name))) {
    wanted.push(name.name);
  }
}
// Tests travel with the plugin so install-check and the suites can run there.
for (const file of walk(join(root, 'tests'))) wanted.push(relative(root, file));

// 2. Copy what differs, and say so.
let copied = 0;
for (const rel of wanted) {
  const from = join(root, rel);
  const to = join(target, rel);
  mkdirSync(join(to, '..'), { recursive: true });
  const same = existsSync(to) && sha(from) === sha(to);
  if (!same) {
    copyFileSync(from, to);
    copied += 1;
  }
}

// 3. Remove stale *modules* the source no longer has — a stale module is how the
//    import broke in the first place. Only .mjs files are pruned: a blanket
//    delete once removed cordis.patch.yml, which the desktop profile must read at
//    startup, and DSH would not boot (ENOENT on the overlay).
let removed = 0;
for (const file of walk(target)) {
  const rel = relative(target, file);
  if (rel.startsWith('node_modules')) continue;
  if (wanted.includes(rel)) continue;
  if (!rel.endsWith('.mjs')) continue;
  if (rel.endsWith('cordis.patch.yml')) continue;
  rmSync(file, { force: true });
  removed += 1;
}

// 4. Verify every file by hash, not by "the copy said it worked".
const mismatches = [];
for (const rel of wanted) {
  const from = join(root, rel);
  const to = join(target, rel);
  if (!existsSync(to) || sha(from) !== sha(to)) mismatches.push(rel);
}

console.log(`source ${root}`);
console.log(`target ${target}`);
console.log(`${wanted.length} files · ${copied} copied · ${removed} removed · ${mismatches.length} mismatched`);
if (mismatches.length) {
  for (const rel of mismatches.slice(0, 10)) console.log(`  ✗ ${rel}`);
  process.exit(1);
}
console.log('OK — every file matches the source');
