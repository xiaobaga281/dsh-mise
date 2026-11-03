/**
 * The panel's picture: the route that serves it must find the film the request
 * names, and must still find it when the request carries no `cwd` (an older
 * panel, a stale tab). This is the bug behind "画面读取失败": the route guessed
 * one project, the file lived in another, and the panel showed an error for a
 * file that existed.
 *
 * The host is stubbed — no server, no browser — so the route's own logic is
 * what is tested.
 *
 *   node tests/preview.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PLUGIN = new URL('../index.js', import.meta.url).href;

/** Mount the plugin's routes on a stub host and return the file handler. */
async function mount() {
  const plugin = await import(PLUGIN);
  const routes = new Map();
  const ctx = {
    tools: { register: () => () => {} },
    skills: { register: () => () => {} },
    effect: (fn) => { try { fn(); } catch {} return () => {}; },
    logger: { warn: () => {} },
    webServer: {
      register: ({ path, handler }) => { routes.set(path, handler); return () => {}; },
    },
    get: (name) => (name === 'credentials' ? { resolve: async () => undefined, describe: async () => ({ configured: false }), set: async () => {}, unset: async () => {} } : undefined),
  };
  plugin.apply(ctx);
  return routes;
}

/** A response object that records what the route wrote. */
function recorder() {
  const out = { status: 0, headers: {}, body: null };
  const response = {
    writeHead(status, headers) { out.status = status; out.headers = headers ?? {}; return this; },
    end(body) { out.body = body; return this; },
  };
  return { response, out };
}

/** One film project with a real PNG in its look cache. */
function film(name) {
  const dir = mkdtempSync(join(tmpdir(), `mise-${name}-`));
  mkdirSync(join(dir, '.film', 'cache', 'look'), { recursive: true });
  writeFileSync(join(dir, 'film.html'), '<section></section>');
  // A minimal 1x1 PNG, so the route serves real bytes.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  writeFileSync(join(dir, '.film', 'cache', 'look', 'frame.png'), png);
  return { dir, png };
}

test('the preview route serves the film the request names', async () => {
  const filmA = film('a');
  const filmB = film('b');
  const routes = await mount();
  const { response, out } = recorder();
  await routes.get('/mise/file')(
    { method: 'GET', url: `/mise/file?p=${encodeURIComponent('.film/cache/look/frame.png')}&cwd=${encodeURIComponent(filmA.dir)}` },
    response,
  );
  assert.equal(out.status, 200);
  assert.equal(out.headers['content-type'], 'image/png');
  assert.equal(out.body.length, filmA.png.length);
  rmSync(filmA.dir, { recursive: true, force: true });
  rmSync(filmB.dir, { recursive: true, force: true });
});

test('a request without cwd still finds the film the panel just showed', async () => {
  const filmA = film('c');
  const routes = await mount();
  // The panel asks for status first; that is what teaches the process which
  // film it is on. A file request from an older panel (no `cwd`) must then find
  // that same film instead of guessing another one.
  await routes.get('/mise/status')(
    { method: 'GET', url: `/mise/status?cwd=${encodeURIComponent(filmA.dir)}` },
    recorder().response,
  );
  const { response, out } = recorder();
  await routes.get('/mise/file')({ method: 'GET', url: `/mise/file?p=${encodeURIComponent('.film/cache/look/frame.png')}` }, response);
  assert.equal(out.status, 200, `expected the existing file to be served, got ${out.status} ${String(out.body)}`);
  rmSync(filmA.dir, { recursive: true, force: true });
});

test('a file outside every film is refused, and an unknown type is refused', async () => {
  const filmA = film('d');
  const routes = await mount();
  const outside = recorder();
  await routes.get('/mise/file')({ method: 'GET', url: `/mise/file?p=${encodeURIComponent('../../secret.png')}&cwd=${encodeURIComponent(filmA.dir)}` }, outside.response);
  assert.equal(outside.out.status, 404);
  const type = recorder();
  await routes.get('/mise/file')({ method: 'GET', url: `/mise/file?p=film.html&cwd=${encodeURIComponent(filmA.dir)}` }, type.response);
  assert.equal(type.out.status, 415);
  rmSync(filmA.dir, { recursive: true, force: true });
});
