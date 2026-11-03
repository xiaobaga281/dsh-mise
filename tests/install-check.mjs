/**
 * Is the *installed* copy actually loadable?
 *
 * The panel showed "HTTP 404" and "plugin not installed" because one module
 * in the installed plugin was stale: index.js imported a symbol that the copied
 * film-doctor.mjs did not have, apply() threw, and with it went every tool and
 * every route. This check mounts the installed directory the way the host does,
 * so a half-synced plugin fails here instead of in the panel.
 *
 *   node tests/install-check.mjs [path-to-installed-plugin]
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const target = process.argv[2]
  ?? join(homedir(), '.dsh', 'plugins', 'dsh-mise');
const entry = join(target, 'index.js');
if (!existsSync(entry)) {
  console.error(`no plugin at ${target}`);
  process.exit(2);
}

const tools = [];
const routes = [];
const skills = [];
try {
  const mod = await import(pathToFileURL(entry).href);
  mod.apply({
    tools: { register: (tool) => { tools.push(tool.name); return () => {}; } },
    skills: { register: (skill) => { skills.push(skill?.name ?? 'skill'); return () => {}; } },
    effect: (fn) => { try { fn(); } catch {} return () => {}; },
    logger: { warn: () => {} },
    get: () => undefined,
    webServer: { register: (spec) => { routes.push(spec.path); return () => {}; } },
  });
} catch (error) {
  console.error(`apply() threw: ${error.message}`);
  console.error('The panel would show 404 and "not installed" in this state.');
  process.exit(1);
}

const problems = [];
if (tools.length < 20) problems.push(`only ${tools.length} tools registered`);
if (!routes.includes('/mise/status')) problems.push('no /mise/status route');
if (!routes.includes('/mise/storyboard')) problems.push('no /mise/storyboard route (the panel cannot edit shots)');
for (const name of ['mise_demo', 'mise_verify', 'mise_probe', 'mise_deliver', 'mise_start']) {
  if (!tools.includes(name)) problems.push(`${name} is missing`);
}

// The desktop profile loads this package through its overlay patch. If that file
// is missing, DSH fails to start with ENOENT and the panel never appears — which
// is exactly what a mirror step that deletes "unexpected" files did once.
const profileOverlay = join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', '@local', 'dsh-mise');
const overlayPatch = join(profileOverlay, 'cordis.patch.yml');
const localPatch = join(target, 'cordis.patch.yml');
if (!existsSync(localPatch)) {
  problems.push('cordis.patch.yml is missing from the plugin (the desktop profile cannot load it)');
} else {
  let manifest = null;
  try { manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')); } catch { manifest = null; }
  if (!manifest?.dsh?.bundle?.patch) problems.push('package.json does not declare dsh.bundle.patch');
  if (manifest?.dsh?.bundle?.patch && !existsSync(join(target, manifest.dsh.bundle.patch))) {
    problems.push(`dsh.bundle.patch points at a missing file: ${manifest.dsh.bundle.patch}`);
  }
}
if (existsSync(profileOverlay) && !existsSync(overlayPatch)) {
  problems.push(`the desktop overlay is present but cannot read ${overlayPatch}`);
}

console.log(`installed plugin: ${tools.length} tools, ${routes.length} routes, ${skills.length} skills`);
console.log(`overlay patch: ${existsSync(overlayPatch) ? 'readable' : (existsSync(profileOverlay) ? 'MISSING' : 'no desktop profile')}`);
for (const problem of problems) console.log(`  ✗ ${problem}`);
console.log(problems.length ? 'FAIL' : 'OK');
process.exit(problems.length ? 1 : 0);
