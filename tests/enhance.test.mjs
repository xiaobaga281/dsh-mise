/**
 * The two enhancement paths: interpolate a clip, and turn a picture into a
 * depth map through a pack. Plans are pure; the tools refuse cleanly when the
 * machine or the pack is not there.
 *
 *   node tests/enhance.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const plans = new URL('../film-interpolate.mjs', import.meta.url).href;
const plugin = new URL('../index.js', import.meta.url).href;

function mount() {
  const tools = [];
  return import(plugin).then((mod) => {
    mod.apply({
      tools: { register: (tool) => { tools.push(tool); return () => {}; } },
      skills: { register: () => () => {} },
      effect: (fn) => { try { fn(); } catch {} return () => {}; },
      logger: { warn: () => {} },
      get: () => undefined,
    });
    return tools;
  });
}

test('interpolation plan names the filter and refuses bad values', async () => {
  const { planInterpolation } = await import(plans);
  const mci = planInterpolation({ input: 'a.mp4', output: 'b.mp4', fps: 60 });
  assert.equal(mci.ok, true);
  assert.ok(mci.args.join(' ').includes('minterpolate=fps=60:mi_mode=mci'));

  const blend = planInterpolation({ input: 'a.mp4', output: 'b.mp4', fps: 30, mode: 'blend' });
  assert.ok(blend.args.join(' ').includes('mi_mode=blend'));

  assert.equal(planInterpolation({ input: 'a.mp4', output: 'b.mp4', fps: 5 }).ok, false);
  assert.equal(planInterpolation({ output: 'b.mp4' }).ok, false);
});

test('depth plan needs a verified depth pack and accepts module or exec entries', async () => {
  const { planDepth } = await import(plans);
  assert.equal(planDepth({ image: 'a.png', output: 'd.png' }).ok, false);
  assert.match(planDepth({ image: 'a.png', output: 'd.png' }).problems.join(' '), /depth pack/);

  const wrongKind = planDepth({ pack: { ok: true, name: 'lut-pack', kind: 'lut', entry: 'x.mjs' }, image: 'a.png', output: 'd.png' });
  assert.equal(wrongKind.ok, false);

  const modulePlan = planDepth({ pack: { ok: true, name: 'depth-a', kind: 'depth', dir: '/tmp/x', entry: 'run.mjs' }, image: 'a.png', output: 'd.png' });
  assert.equal(modulePlan.kind, 'module');

  const execPlan = planDepth({
    pack: { ok: true, name: 'depth-b', kind: 'depth', dir: '/tmp/x', entry: 'depth.exe', args: ['-i', '{{image}}', '-o', '{{out}}', '--nf'] },
    image: 'shot.png',
    output: 'shot-depth.png',
  });
  assert.equal(execPlan.kind, 'exec');
  assert.deepEqual(execPlan.args, ['-i', 'shot.png', '-o', 'shot-depth.png', '--nf']);
});

test('the tools refuse with a reason instead of guessing', async () => {
  const tools = await mount();
  assert.ok(tools.find((t) => t.name === 'mise_interpolate'));
  assert.ok(tools.find((t) => t.name === 'mise_depth'));

  const dir = mkdtempSync(join(tmpdir(), 'openfilm-enhance-'));
  writeFileSync(join(dir, 'film.html'), '<meta name="viewport" content="width=1920, height=1080"><section></section>');
  writeFileSync(join(dir, 'plate.png'), 'pretend png');

  const interpolate = tools.find((t) => t.name === 'mise_interpolate');
  const noClip = await interpolate.execute({ cwd: dir });
  assert.equal(noClip.ok, false);
  assert.ok(noClip.problems.length > 0);

  const depth = tools.find((t) => t.name === 'mise_depth');
  const noSrc = await depth.execute({ cwd: dir });
  assert.equal(noSrc.ok, false);

  const missing = await depth.execute({ cwd: dir, src: 'plate.png' });
  assert.equal(missing.ok, false);
  assert.match(missing.problems.join(' '), /depth pack|does not exist/);

  rmSync(dir, { recursive: true, force: true });
});
