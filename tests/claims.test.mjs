/**
 * Claims and proof: one claim at a time, with its evidence on screen.
 *
 *   node tests/claims.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const claimsMod = new URL('../film-claims.mjs', import.meta.url).href;
const genreMod = new URL('../film-genres.mjs', import.meta.url).href;
const preflightMod = new URL('../film-preflight.mjs', import.meta.url).href;

test('a claim without evidence is refused, with the reason', async () => {
  const { validateClaim } = await import(claimsMod);
  assert.equal(validateClaim({}).ok, false);
  const bare = validateClaim({ text: '渲染更便宜' });
  assert.equal(bare.ok, false);
  assert.match(bare.problems.join(' '), /no evidence/);

  assert.equal(validateClaim({ text: '成本 2ms', evidence: { kind: 'number', value: 2 } }).ok, false, 'a number needs a unit');
  assert.equal(validateClaim({ text: '成本 2ms', evidence: { kind: 'number', value: 2, unit: 'ms' } }).ok, true);
  assert.equal(validateClaim({ text: '对比', evidence: { kind: 'chart', items: [{ label: '代码', value: 1 }] } }).ok, false, 'one bar is not a comparison');
  assert.equal(validateClaim({ text: '对比', evidence: { kind: 'chart', items: [{ label: 'a', value: 1 }, { label: 'b', value: 40 }] } }).ok, true);
  assert.equal(validateClaim({ text: '他说', evidence: { kind: 'quote' } }).ok, false, 'a quote needs a who');
  assert.equal(validateClaim({ text: '他说', evidence: { kind: 'quote', who: '导演' } }).ok, true);
});

test('the sentence and the evidence must agree on the number', async () => {
  const { validateClaim, claimNumber } = await import(claimsMod);
  assert.equal(claimNumber('比模型便宜 40 倍'), 40);
  assert.equal(claimNumber('没有数字'), null);

  const wrongChart = validateClaim({
    text: '比模型便宜 40 倍',
    evidence: { kind: 'chart', items: [{ label: '代码', value: 1 }, { label: '模型', value: 12 }] },
  });
  assert.equal(wrongChart.ok, false, 'a chart topping out at 12 does not prove 40');
  assert.match(wrongChart.problems.join(' '), /no bar in the chart is that value/);

  const rightChart = validateClaim({
    text: '比模型便宜 40 倍',
    evidence: { kind: 'chart', items: [{ label: '代码', value: 1 }, { label: '模型', value: 40 }] },
  });
  assert.equal(rightChart.ok, true);

  const wrongNumber = validateClaim({ text: '一帧只要 2ms', evidence: { kind: 'number', value: 5, unit: 'ms' } });
  assert.equal(wrongNumber.ok, false);
  assert.match(wrongNumber.problems.join(' '), /says 2 but the evidence value is 5/);
});

test('claims pair with the shots that can prove them', async () => {
  const { pairClaims } = await import(claimsMod);
  const beats = [
    { index: 1, at: 0, kind: 'title' },
    { index: 2, at: 3, kind: 'graphics' },
    { index: 3, at: 7, kind: 'graphics' },
  ];
  const paired = pairClaims(beats, [
    { text: '成本 2ms', evidence: { kind: 'number', value: 2, unit: 'ms' } },
  ]);
  assert.equal(paired.ok, true);
  assert.deepEqual(paired.assignments.map((a) => a.beat), [2]);
  assert.deepEqual(paired.unproven, [3], 'the second proof shot is left without a claim');

  const tooMany = pairClaims(beats, [
    { text: '一', evidence: { kind: 'number', value: 1, unit: 'x' } },
    { text: '二', evidence: { kind: 'number', value: 2, unit: 'x' } },
    { text: '三', evidence: { kind: 'number', value: 3, unit: 'x' } },
  ]);
  assert.equal(tooMany.ok, false, 'more claims than shots that can show them');
});

test('the plan carries the pairing, and a bad claim is visible there', async () => {
  const { planProduction } = await import(genreMod);
  const good = planProduction({
    genre: 'explainer-data',
    seconds: 16,
    claims: [{ text: '成本 2ms', evidence: { kind: 'number', value: 2, unit: 'ms' } }],
  });
  assert.ok(good.claims, 'the plan reports the pairing');
  assert.equal(good.claims.assignments.length, 1);
  assert.ok(good.rules.some((line) => line.startsWith('主张-证据')));

  const bad = planProduction({ genre: 'explainer-data', seconds: 16, claims: [{ text: '没有证据' }] });
  assert.ok(bad.claims.problems.some((p) => /no evidence/.test(p)));
});

test('an unproven claim blocks export rather than being a style note', async () => {
  const { preflight } = await import(preflightMod);
  const review = { counts: { total: 3, approved: 3, pending: 0, changed: 0 } };
  const acceptance = { ok: true, fresh: true, checked: 4 };
  const open = preflight({ review, acceptance, hasPlan: true });
  assert.equal(open.ok, true);

  const blocked = preflight({
    review,
    acceptance,
    hasPlan: true,
    claims: { assignments: [{ beat: 2, claim: 'x', kind: 'number' }], unproven: [3], problems: ['claim 1: no evidence'] },
  });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.blockers.some((b) => /claim without proof/.test(b)));
  assert.ok(blocked.blockers.some((b) => /shot\(s\) 3/.test(b)));

  const clean = preflight({
    review,
    acceptance,
    hasPlan: true,
    claims: { assignments: [{ beat: 2, claim: 'x', kind: 'number' }], unproven: [], problems: [] },
  });
  assert.equal(clean.ok, true);
  assert.ok(clean.checks.some((check) => check.id === 'claims' && check.ok));
});
