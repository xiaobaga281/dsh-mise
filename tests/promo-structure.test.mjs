/**
 * The structure of a proposal: the same shots do not fit every product.
 *
 * Detection reads the project's own words and figures; it may change the order
 * and the presence of shots, never the copy.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const promoMod = new URL('../film-promo.mjs', import.meta.url).href;

const BASE = {
  name: 'DSH Mobile',
  tagline: '装在口袋里的 DeepSeek Harness —— Android 端 AI 助手客户端。',
  url: 'github.com/xiaobaga281/dsh-mobile',
  facts: { tools: { catalogEntries: 154 }, apk: { bytes: 237295867 } },
  screenshots: [{ file: 'a.png' }, { file: 'b.png' }, { file: 'c.png' }],
};

test('the material decides the structure', async () => {
  const { detectSkeleton } = await import(promoMod);
  assert.equal(detectSkeleton({ text: '本项目是开源项目，代码在 GitHub 上' }).id, 'open-source');
  assert.equal(detectSkeleton({ text: '订阅价格每月 9 元' }).id, 'pricing');
  assert.equal(detectSkeleton({ text: '扫描延迟 12 毫秒' }).id, 'performance');
  assert.equal(detectSkeleton({ text: '一个安静的产品' }).id, 'product');
  // A licence in the facts is as good as the word in the README.
  assert.equal(detectSkeleton({ text: '', facts: { license: 'MIT' } }).id, 'open-source');
});

test('an open-source project gets a why shot and ends on the repository', async () => {
  const { proposePromo } = await import(promoMod);
  const proposal = proposePromo({ ...BASE, text: '代码开源，见 GitHub' });
  assert.equal(proposal.skeleton, 'open-source');
  const kinds = proposal.shots.map((shot) => shot.kind);
  assert.deepEqual(kinds, ['type', 'plate', 'plate', 'number', 'type', 'end']);
  const why = proposal.shots[4];
  assert.equal(why.kicker, 'WHY OPEN SOURCE');
  assert.equal(proposal.shots[5].url, BASE.url, 'the last frame is the repository');
});

test('a speed story leads with the number, not the screenshot', async () => {
  const { proposePromo } = await import(promoMod);
  const proposal = proposePromo({ ...BASE, text: '扫描延迟很低' });
  assert.equal(proposal.skeleton, 'performance');
  assert.equal(proposal.shots[1].kind, 'number');
});

test('a caller can force a structure and supply its line', async () => {
  const { proposePromo } = await import(promoMod);
  const proposal = proposePromo({ ...BASE, text: '一个安静的产品', skeleton: 'open-source', why: '代码可读，规则可改' });
  assert.equal(proposal.skeleton, 'open-source');
  assert.deepEqual(proposal.shots[4].title, ['代码可读，规则可改']);
  assert.equal(proposal.reason, 'chosen by the caller');
});

test('a skeleton never invents a shot it has no material for', async () => {
  const { proposePromo } = await import(promoMod);
  // No figure in the facts: the number slot is skipped rather than filled.
  const proposal = proposePromo({
    name: 'X',
    tagline: 'a b',
    url: 'github.com/x/y',
    facts: {},
    screenshots: [{ file: 'a.png' }],
    text: '开源',
  });
  assert.equal(proposal.shots.some((shot) => shot.kind === 'number'), false);
  assert.equal(proposal.shots.filter((shot) => shot.kind === 'plate').length, 1);
});

test('the structure also sets the camera and how fast words land', async () => {
  const { buildPromo, SKELETON_STYLE } = await import(promoMod);
  const shots = [
    { kind: 'type', kicker: 'PACE', title: ['推镜', '速度'], note: '同一批镜头' },
    { kind: 'end', title: ['X'], url: 'github.com/x/y' },
  ];
  const read = (html, name) => Number(html.match(new RegExp(`const ${name} = ([\\d.]+);`))[1]);

  const slow = buildPromo({ shots, skeleton: 'open-source' });
  const fast = buildPromo({ shots, skeleton: 'performance' });

  // A credibility film travels less and lets each line settle; a speed film
  // pushes further and lands its lines almost together.
  assert.ok(read(fast.pages[0].html, 'PUSH') > read(slow.pages[0].html, 'PUSH'), 'the speed cut pushes further');
  assert.ok(read(fast.pages[0].html, 'SETTLE') < read(slow.pages[0].html, 'SETTLE'), 'and settles sooner');
  assert.ok(read(fast.pages[0].html, 'STAGGER') < read(slow.pages[0].html, 'STAGGER'), 'and staggers tighter');

  assert.equal(read(slow.pages[0].html, 'PUSH'), SKELETON_STYLE['open-source'].motion.push);
  // A type shot has no photograph, so the copy carries the camera itself.
  // The copy carries the camera itself: a dolly drifts it vertically as well.
  assert.match(slow.pages[0].html, /copyEl\.style\.transform = 'translateY\(-50%\) translateY\(/, 'the copy moves too');
});

test('the structure is audible, not only visible', async () => {
  const { buildPromo, SKELETON_STYLE } = await import(promoMod);
  const { composeForShots } = await import(new URL('../film-score.mjs', import.meta.url).href);
  const shots = [
    { kind: 'type', kicker: 'X', title: ['一句话'], duration: 3.6 },
    { kind: 'plate', image: 'a.png', title: ['证据'] },
    { kind: 'number', figure: 154, unit: '个', caption: '工具' },
    { kind: 'end', title: ['X'], url: 'github.com/x/y', duration: 4.2 },
  ];

  const style = {};
  for (const skeleton of ['open-source', 'performance', 'product']) {
    const built = buildPromo({ shots, skeleton });
    assert.equal(built.plan.score.bpm, SKELETON_STYLE[skeleton].bpm, `${skeleton} sets its tempo`);
    const score = composeForShots({
      shots: built.lanes,
      mood: 'warm',
      bpm: built.plan.score.bpm,
      grid: null,
      groove: built.plan.score.groove,
      dynamics: built.plan.score.dynamics,
      fills: false,
      cutKinds: built.kinds,
    });
    style[skeleton] = {
      lanes: built.lanes.map((lane) => lane.length),
      density: score.notes.length / Math.max(1, score.seconds),
      pulses: score.notes.filter((note) => note.voice === 'pulse').length,
      seconds: built.seconds,
    };
  }

  // A speed film is cut tighter per shot and scored denser than a credibility
  // film. (The whole film is not necessarily shorter: a shorter join leaves more
  // picture on screen, which is the point of a fast cut.)
  const bodyLength = (entry) => entry.lanes[1];
  assert.ok(bodyLength(style.performance) < bodyLength(style['open-source']), 'the speed shot itself is shorter');
  assert.ok(style.performance.density > style['open-source'].density, 'and the score is denser');
  // Only the film with dynamics gets a climax pulse.
  assert.ok(style.performance.pulses > 0, 'the speed film has a pulse');
  assert.equal(style['open-source'].pulses, 0, 'the credibility film stays flat');
});

test('the structure joins differently: a slow focus pull or a fast cut', async () => {
  const { buildPromo, SKELETON_STYLE } = await import(promoMod);
  const shots = [
    { kind: 'type', kicker: 'X', title: ['一'] },
    { kind: 'plate', image: 'a.png', title: ['二'] },
    { kind: 'end', title: ['X'], url: 'github.com/x/y' },
  ];
  const slow = buildPromo({ shots, skeleton: 'open-source' });
  const fast = buildPromo({ shots, skeleton: 'performance' });

  assert.equal(slow.joins[0].kind, 'depth', 'credibility joins on a focus pull');
  assert.equal(fast.joins[0].kind, 'fade', 'speed joins on a near cut');
  assert.ok(fast.joins[0].duration < slow.joins[0].duration, 'and the fast join is shorter');
  assert.ok(fast.joins[0].duration <= 0.25, 'a speed join is a cut, not a dissolve');
  assert.equal(slow.joins[0].duration, SKELETON_STYLE['open-source'].transition.duration);

  // A caller may override the join without changing the structure.
  const forced = buildPromo({ shots, skeleton: 'open-source', joinKind: 'wipe', transition: 0.4 });
  assert.equal(forced.joins[0].kind, 'wipe');
  assert.equal(forced.joins[0].duration, 0.4);
});

test('the film can end on a claim, with its receipts under it', async () => {
  const { proposePromo, buildPromo } = await import(promoMod);
  const proposal = proposePromo({
    name: 'X', tagline: 'a b', url: 'github.com/x/y', text: '开源，见 GitHub',
    facts: { tools: { catalogEntries: 154 } },
    screenshots: [{ file: 'a.png' }, { file: 'b.png' }],
    claim: '它不是聊天玩具',
    evidence: [{ text: '154 个工具', source: 'docs/facts.json' }, { text: '数据只在手机' }],
  });
  const kinds = proposal.shots.map((shot) => shot.kind);
  assert.equal(kinds[kinds.length - 2], 'claim', 'the claim comes just before the card');
  assert.equal(kinds[kinds.length - 1], 'end');

  const built = buildPromo({ shots: proposal.shots, skeleton: proposal.skeleton });
  const page = built.pages.find((entry) => entry.name.includes('claim'));
  assert.ok(page, 'a claim page was written');
  assert.match(page.html, /class="claimtext"/);
  assert.equal((page.html.match(/class="ev"/g) ?? []).length, 2, 'one row per receipt');
  assert.ok(page.html.includes('docs/facts.json'), 'a receipt keeps its source');

  // Without a claim there is no claim shot at all.
  const bare = proposePromo({
    name: 'X', tagline: 'a b', url: 'github.com/x/y', text: '开源',
    facts: {}, screenshots: [{ file: 'a.png' }],
  });
  assert.equal(bare.shots.some((shot) => shot.kind === 'claim'), false);
});

test('a claim shot without a claim is refused', async () => {
  const { buildPromo } = await import(promoMod);
  const refused = buildPromo({ shots: [{ kind: 'claim', evidence: [] }] });
  assert.equal(refused.ok, false);
  assert.ok(refused.problems.some((problem) => /a claim shot needs a claim/.test(problem)));
});

test('the claim is the longest shot and it drops the rhythm', async () => {
  const { buildPromo } = await import(promoMod);
  const { composeForShots } = await import(new URL('../film-score.mjs', import.meta.url).href);
  const shots = [
    { kind: 'type', kicker: 'X', title: ['一'] },
    { kind: 'plate', image: 'a.png', title: ['二'] },
    { kind: 'number', figures: [{ value: 154, unit: '个工具', label: '工具' }] },
    { kind: 'claim', claim: '它不是聊天玩具', evidence: [{ text: '154 个工具' }] },
    { kind: 'end', title: ['X'], url: 'github.com/x/y' },
  ];
  const built = buildPromo({ shots, skeleton: 'open-source' });
  const claimBeat = built.plan.beats.find((beat) => beat.kind === 'claim');
  assert.ok(claimBeat, 'the claim keeps its kind in the plan');
  const longest = built.plan.beats.reduce((a, b) => (b.length > a.length ? b : a));
  assert.equal(longest.kind, 'claim', 'the film stops longest on the conclusion');
  assert.ok(claimBeat.length >= 4.6 && claimBeat.length <= 6.4, 'and stops for 4.6-6.4s');

  const score = composeForShots({
    shots: built.lanes,
    mood: 'warm',
    bpm: built.plan.score.bpm,
    grid: null,
    groove: built.plan.score.groove,
    dynamics: built.plan.score.dynamics,
    fills: false,
    cutKinds: built.kinds,
  });
  const lane = built.lanes[built.kinds.indexOf('claim')];
  // Stop short of the lane's end: the next shot's accent sits on the boundary.
  // The harmony starts on the cut itself; the rhythm must not continue past it.
  const inside = score.notes.filter((note) => note.at >= lane.at - 0.01 && note.at < lane.at + lane.length - 0.06);
  assert.equal(inside.some((note) => note.voice === 'hat'), false, 'no hats under the sentence');
  assert.equal(inside.some((note) => note.voice === 'kick' && note.at > lane.at + 0.3), false, 'no beat running under it');
  assert.ok(inside.some((note) => note.voice === 'pad'), 'but the harmony holds');
});
