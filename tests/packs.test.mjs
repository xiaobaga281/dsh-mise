/**
 * Optional packs: installed, verified by hash, removable — and never trusted
 * just because a folder exists.
 *
 *   node tests/packs.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mod = new URL('../film-packs.mjs', import.meta.url).href;

function makePack(dir, { name = 'depth-small', version = '1.0.0', kind = 'depth' } = {}) {
  mkdirSync(join(dir, 'models'), { recursive: true });
  writeFileSync(join(dir, 'models', 'weights.bin'), 'a tiny pretend model');
  writeFileSync(join(dir, 'README.md'), 'depth pack');
  const { hashFolderIntoManifest } = modUtils;
  hashFolderIntoManifest(dir, { name, version, kind });
  return dir;
}

/** The module is imported lazily; this is filled once below. */
let modUtils = {};

test('a pack is only active when every hash matches', async () => {
  const packs = await import(mod);
  modUtils = packs;
  const home = mkdtempSync(join(tmpdir(), 'openfilm-home-'));
  const src = mkdtempSync(join(tmpdir(), 'openfilm-pack-'));
  makePack(src);

  const read = packs.readPack(src);
  assert.equal(read.ok, true);
  assert.equal(read.pack.kind, 'depth');

  const verified = packs.verifyPack(src);
  assert.equal(verified.ok, true);
  assert.equal(verified.checked, 2);

  // Tampering is caught, not ignored.
  writeFileSync(join(src, 'models', 'weights.bin'), 'tampered');
  const broken = packs.verifyPack(src);
  assert.equal(broken.ok, false);
  assert.ok(broken.problems.some((p) => /hash mismatch/.test(p)));

  // Install refuses a pack that does not verify, and leaves nothing behind.
  assert.throws(() => packs.installPack({ from: src, home }), /failed verification/);

  rmSync(home, { recursive: true, force: true });
  rmSync(src, { recursive: true, force: true });
});

test('install copies, verifies, lists, replaces and removes', async () => {
  const packs = await import(mod);
  modUtils = packs;
  const home = mkdtempSync(join(tmpdir(), 'openfilm-home-'));
  const src = mkdtempSync(join(tmpdir(), 'openfilm-pack-'));
  makePack(src, { name: 'interp-fast', kind: 'interp' });

  const installed = packs.installPack({ from: src, home });
  assert.equal(installed.ok, true);
  assert.equal(installed.checked, 2);

  const listed = packs.listPacks(home);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'interp-fast');
  assert.equal(listed[0].ok, true);

  assert.throws(() => packs.installPack({ from: src, home }), /already installed/);
  const replaced = packs.installPack({ from: src, home, force: true });
  assert.equal(replaced.ok, true);

  packs.removePack('interp-fast', home);
  assert.equal(packs.listPacks(home).length, 0);
  assert.throws(() => packs.removePack('interp-fast', home), /no pack/);

  rmSync(home, { recursive: true, force: true });
  rmSync(src, { recursive: true, force: true });
});

test('the pack tool lists, installs, verifies and removes through the harness home', async () => {
  const plugin = await import(new URL('../index.js', import.meta.url).href);
  const home = mkdtempSync(join(tmpdir(), 'openfilm-home-'));
  const src = mkdtempSync(join(tmpdir(), 'openfilm-pack-'));
  makePack(src, { name: 'lut-film', kind: 'lut' });

  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const tools = [];
    plugin.apply({
      tools: { register: (tool) => { tools.push(tool); return () => {}; } },
      skills: { register: () => () => {} },
      effect: (fn) => { try { fn(); } catch {} return () => {}; },
      logger: { warn: () => {} },
      get: () => undefined,
    });
    const tool = tools.find((t) => t.name === 'mise_pack');
    assert.ok(tool, 'mise_pack must be registered');

    const empty = await tool.execute({ action: 'list' });
    assert.equal(empty.ok, true);
    assert.equal(empty.packs.length, 0);

    const installed = await tool.execute({ action: 'install', from: src });
    assert.equal(installed.ok, true);
    assert.ok(installed.message.includes('verified'));

    const listed = await tool.execute({ action: 'list' });
    assert.equal(listed.packs.length, 1);
    assert.equal(listed.packs[0].name, 'lut-film');

    const verified = await tool.execute({ action: 'verify', name: 'lut-film' });
    assert.equal(verified.ok, true);

    const removed = await tool.execute({ action: 'remove', name: 'lut-film' });
    assert.equal(removed.ok, true);
    assert.equal(removed.packs.length, 0);

    const bad = await tool.execute({ action: 'install', from: join(src, 'nope') });
    assert.equal(bad.ok, false);
    assert.ok(bad.error);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    rmSync(home, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
  }
});
