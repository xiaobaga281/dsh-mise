/**
 * Optional enhancement packs: depth parallax and frame interpolation, installed
 * by the person, verified by hash, never bundled.
 *
 * The default plugin must stay installable on any machine. A depth network or
 * an interpolation model is 20–100 MB of binaries per platform, so it cannot be
 * part of the package; it is something a person adds when they want the
 * "layered" tier. A pack is a plain folder with a `pack.json`; installing is a
 * copy plus a hash check, and the doctor only believes a pack that passed it.
 *
 * @module mise-film-packs
 */

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const MANIFEST = 'pack.json';

/** Where packs live, under the harness home. */
export function packsRoot(home = process.env.DSH_HOME || process.env.USERPROFILE || process.env.HOME || '') {
  return join(home, 'mise-packs');
}

/** A pack's manifest must say what it is; anything else is refused. */
const KINDS = new Set(['depth', 'interp', 'lut', 'font', 'other']);

/**
 * Read and sanity-check one pack folder.
 * @param {string} dir
 * @returns {{ ok: boolean, pack?: object, problems: string[] }}
 */
export function readPack(dir) {
  const problems = [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8'));
  } catch {
    return { ok: false, problems: [`${dir}: no readable ${MANIFEST}`] };
  }
  const name = manifest?.name;
  const version = manifest?.version;
  const kind = manifest?.kind;
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(name)) problems.push('pack.json: name must be kebab-case');
  if (typeof version !== 'string' || version.length === 0) problems.push('pack.json: version is required');
  if (!KINDS.has(kind)) problems.push(`pack.json: kind must be one of ${[...KINDS].join(', ')}`);
  if (manifest?.integrity && typeof manifest.integrity !== 'object') problems.push('pack.json: integrity must be an object of path → sha256');
  return {
    ok: problems.length === 0,
    ...(problems.length === 0
      ? { pack: { name, version, kind, dir, sizes: manifest.sizes ?? {}, files: Object.keys(manifest.integrity ?? {}) } }
      : {}),
    problems,
  };
}

/** sha256 of a file, as lowercase hex. */
export function hashFile(file) {
  const hash = createHash('sha256');
  hash.update(readFileSync(file));
  return hash.digest('hex');
}

/**
 * Verify the files a pack declares, against their recorded hashes.
 * @param {string} dir
 * @returns {{ ok: boolean, checked: number, problems: string[] }}
 */
export function verifyPack(dir) {
  const read = readPack(dir);
  if (!read.ok) return { ok: false, checked: 0, problems: read.problems };
  const problems = [];
  const integrity = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8')).integrity ?? {};
  let checked = 0;
  for (const [rel, expected] of Object.entries(integrity)) {
    const target = resolve(dir, rel);
    if (target !== dir && !target.startsWith(dir + sep)) { problems.push(`path escapes the pack: ${rel}`); continue; }
    if (!existsSync(target) || !statSync(target).isFile()) { problems.push(`missing file: ${rel}`); continue; }
    checked += 1;
    if (hashFile(target) !== String(expected).toLowerCase()) problems.push(`hash mismatch: ${rel}`);
  }
  return { ok: problems.length === 0, checked, problems };
}

/** Every pack folder with its manifest, installed or not. */
export function listPacks(home) {
  const root = packsRoot(home);
  let names = [];
  try { names = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name); } catch { return []; }
  return names.map((name) => {
    const dir = join(root, name);
    const read = readPack(dir);
    if (!read.ok) return { name, dir, ok: false, problems: read.problems };
    const verify = verifyPack(dir);
    return { ...read.pack, ok: verify.ok, problems: verify.problems, checked: verify.checked };
  });
}

/**
 * Install a pack folder into the harness home.
 *
 * The source is copied, then verified in place: a pack whose files do not match
 * its manifest never becomes visible to the doctor.
 * @param {{ from: string, home?: string, force?: boolean }} request
 */
export function installPack({ from, home, force = false }) {
  const source = resolve(from);
  if (!existsSync(join(source, MANIFEST))) throw new Error(`no ${MANIFEST} in ${source}; a pack is a folder with one`);
  const read = readPack(source);
  if (!read.ok) throw new Error(read.problems.join('; '));
  const target = join(packsRoot(home), read.pack.name);
  if (existsSync(target)) {
    if (!force) throw new Error(`pack ${read.pack.name} is already installed; pass force to replace it`);
    rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
  const verify = verifyPack(target);
  if (!verify.ok) {
    rmSync(target, { recursive: true, force: true });
    throw new Error(`pack failed verification and was removed: ${verify.problems.join('; ')}`);
  }
  return { ok: true, name: read.pack.name, dir: target, checked: verify.checked };
}

/** Remove an installed pack. */
export function removePack(name, home) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(name)) throw new Error('invalid pack name');
  const target = join(packsRoot(home), name);
  if (!existsSync(target)) throw new Error(`no pack ${name}`);
  rmSync(target, { recursive: true, force: true });
  return { ok: true, name };
}

/** Write a manifest for a folder, hashing every file it contains. */
export function hashFolderIntoManifest(dir, { name, version, kind = 'other' }) {
  const integrity = {};
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const rel = relative(dir, full).split(sep).join('/');
      if (rel === MANIFEST) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) integrity[rel] = hashFile(full);
    }
  };
  walk(dir);
  const manifest = { name, version, kind, integrity };
  writeFileSync(join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
