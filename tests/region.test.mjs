/**
 * A marked region must reach the agent as precise numbers, not as a picture.
 *
 * These tests mount the plugin on a stub host and submit a selection exactly the
 * way the panel does. What is asserted is what the agent would actually get.
 *
 *   node tests/region.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PLUGIN = new URL('../index.js', import.meta.url).href;

/** A POST body the route's own reader can consume (it reads an async iterable). */
function request(body) {
  const text = JSON.stringify(body ?? {});
  return {
    method: 'POST',
    url: '/mise/region-edit',
    async *[Symbol.asyncIterator]() { yield Buffer.from(text, 'utf8'); },
  };
}

function response() {
  const out = { status: 0, body: '' };
  return {
    out,
    writeHead(status) { out.status = status; },
    end(body) { out.body = body; },
  };
}

async function mount(agentRegistry) {
  const plugin = await import(PLUGIN);
  const routes = new Map();
  const sent = [];
  const agent = { followup: (message) => sent.push(message) };
  plugin.apply({
    tools: { register: () => () => {} },
    skills: { register: () => () => {} },
    effect: (fn) => { try { fn(); } catch {} return () => {}; },
    logger: { warn: () => {} },
    webServer: { register: ({ path, handler }) => { routes.set(path, handler); return () => {}; } },
    get: (name) => {
      if (name === 'agents') return agentRegistry ? agentRegistry(agent) : { get: () => agent };
      if (name === 'credentials') return { resolve: async () => undefined, describe: async () => ({ configured: false }), set: async () => {}, unset: async () => {} };
      return undefined;
    },
  });
  return { handler: routes.get('/mise/region-edit'), sent };
}

function film() {
  const dir = mkdtempSync(join(tmpdir(), 'mise-region-'));
  writeFileSync(join(dir, 'film.html'), '<meta name="viewport" content="width=1920, height=1080"><section><iframe src="s1.html#t=0,5"></iframe></section>');
  writeFileSync(join(dir, 's1.html'), '<script>window.film={duration:5,frame(t){}}</script>');
  return dir;
}

const textOf = (message) => (Array.isArray(message?.content) ? message.content.map((p) => p.text ?? '').join('\n') : '');

test('a marked region becomes an exact request to the agent', async () => {
  const dir = film();
  const { handler, sent } = await mount();
  const res = response();
  await handler(request({
    cwd: dir,
    session: 'session-test',
    time: 2.5,
    rect: { x: 0.25, y: 0.5, w: 0.1, h: 0.2 },
    instruction: '把这里改成暖橙色，其它地方不要动',
  }), res);

  const body = JSON.parse(res.out.body);
  assert.equal(res.out.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.submitted, true);
  assert.equal(sent.length, 1, 'the agent should receive exactly one message');

  const text = textOf(sent[0]);
  // The rectangle is in the film's own pixels, not the panel's.
  assert.ok(text.includes('x=480'), text);
  assert.ok(text.includes('y=540'), text);
  assert.ok(text.includes('192×216'), text);
  assert.ok(text.includes('把这里改成暖橙色，其它地方不要动'), text);
  assert.ok(text.includes('2.50s'), text);
  assert.ok(text.includes('change only that part'), text);

  // The request is on disk, with the same numbers, so a later turn can find it.
  const recordDir = join(dir, '.film', 'region-edits');
  assert.ok(existsSync(recordDir));
  const file = readdirSync(recordDir).find((name) => name.endsWith('.json'));
  assert.ok(file);
  const record = JSON.parse(readFileSync(join(recordDir, file), 'utf8'));
  assert.deepEqual(record.pixels, { x: 480, y: 540, w: 192, h: 216 });
  assert.equal(record.instruction, '把这里改成暖橙色，其它地方不要动');
  rmSync(dir, { recursive: true, force: true });
});

test('an empty instruction is refused and nothing reaches the agent', async () => {
  const dir = film();
  const { handler, sent } = await mount();
  const res = response();
  await handler(request({ cwd: dir, time: 1, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, instruction: '   ' }), res);
  assert.equal(res.out.status, 400);
  assert.equal(sent.length, 0);
  assert.equal(existsSync(join(dir, '.film', 'region-edits')), false);
  rmSync(dir, { recursive: true, force: true });
});

test('a selection covering the whole frame is refused', async () => {
  const dir = film();
  const { handler, sent } = await mount();
  const res = response();
  await handler(request({ cwd: dir, time: 1, rect: { x: 0, y: 0, w: 1, h: 1 }, instruction: 'change everything' }), res);
  assert.equal(res.out.status, 400);
  assert.equal(sent.length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('with no session id, the most recent agent still receives the request', async () => {
  const dir = film();
  // The panel is injected without a session id, and the host process may have
  // none either. The request must still be delivered instead of asking the
  // person for another word.
  const previous = process.env.DSH_SESSION_ID;
  delete process.env.DSH_SESSION_ID;
  const { handler, sent } = await mount((agent) => ({
    get: (id) => (id === 'session-newest' ? agent : undefined),
    list: () => [{ id: 'session-old' }, { id: 'session-newest' }],
  }));
  const res = response();
  await handler(request({ cwd: dir, time: 2, rect: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 }, instruction: '换成爱心' }), res);
  assert.equal(res.out.status, 200);
  assert.equal(JSON.parse(res.out.body).submitted, true);
  assert.equal(sent.length, 1);
  assert.ok(textOf(sent[0]).includes('换成爱心'));
  if (previous !== undefined) process.env.DSH_SESSION_ID = previous;
  rmSync(dir, { recursive: true, force: true });
});

test('the film wakes the conversation that made it, not the newest one', async () => {
  const dir = film();
  // The film records its owner beside itself, so a marked region reaches the
  // conversation that actually knows the film.
  const recordDir = join(dir, '.film');
  mkdirSync(recordDir, { recursive: true });
  writeFileSync(join(recordDir, 'session.json'), JSON.stringify({ sessionId: 'session-maker', updatedAt: new Date().toISOString() }));

  const delivered = [];
  const maker = { followup: (message) => delivered.push(['maker', message]) };
  const newest = { followup: (message) => delivered.push(['newest', message]) };
  const { handler } = await mount(() => ({
    get: (id) => (id === 'session-maker' ? maker : id === 'session-newest' ? newest : undefined),
    list: () => [{ id: 'session-maker' }, { id: 'session-newest' }],
  }));

  const res = response();
  await handler(request({ cwd: dir, time: 2, rect: { x: 0.3, y: 0.3, w: 0.1, h: 0.1 }, instruction: '把这里换成爱心' }), res);
  const body = JSON.parse(res.out.body);
  assert.equal(body.submitted, true);
  assert.equal(body.owner, 'session-maker');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0][0], 'maker', 'the maker must receive it, not the newest conversation');
  assert.ok(textOf(delivered[0][1]).includes('把这里换成爱心'));

  // If the maker is not loaded, the request is NOT delivered to someone else.
  delivered.length = 0;
  const { handler: second } = await mount(() => ({
    get: (id) => (id === 'session-newest' ? newest : undefined),
    list: () => [{ id: 'session-newest' }],
  }));
  const res2 = response();
  await second(request({ cwd: dir, time: 2, rect: { x: 0.3, y: 0.3, w: 0.1, h: 0.1 }, instruction: '把这里换成爱心' }), res2);
  const body2 = JSON.parse(res2.out.body);
  assert.equal(body2.submitted, false);
  assert.equal(delivered.length, 0, 'a different conversation must not be woken');
  assert.ok(body2.message.includes('session-m') || body2.message.includes('会话'));

  rmSync(dir, { recursive: true, force: true });
});
