/**
 * The promo language: one frame, repeated.
 *
 * These tests hold the properties that make a promo read as one film rather than
 * a slideshow — a single chrome in every shot, joins that own the hand-over, and
 * a timeline where no two clips share a frame.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const promoMod = new URL('../film-promo.mjs', import.meta.url).href;

const BRIEF = {
  shots: [
    { kind: 'type', kicker: 'A', title: ['第一镜'], duration: 3.4 },
    { kind: 'plate', image: 'assets/a.png', kicker: 'B', title: ['第二镜'], duration: 4.4 },
    { kind: 'number', figure: 154, unit: '个', caption: '数字', chips: ['x', 'y'], duration: 3.4 },
    { kind: 'end', title: ['End'], url: 'github.com/x', duration: 4.0 },
  ],
};

test('a brief is validated before anything is written', async () => {
  const { planPromo } = await import(promoMod);
  const empty = planPromo({ shots: [] });
  assert.equal(empty.ok, false);
  assert.match(empty.problems[0], /at least one shot/);

  const missingImage = planPromo({ shots: [{ kind: 'plate', title: ['x'] }] });
  assert.ok(missingImage.problems.some((p) => /a plate needs an image/.test(p)));

  const noUrl = planPromo({ shots: [{ kind: 'end', title: ['x'] }] });
  assert.ok(noUrl.problems.some((p) => /end card needs a url/.test(p)));

  const ok = planPromo(BRIEF);
  assert.equal(ok.ok, true);
  assert.equal(ok.shots.length, 4);
});

test('shots are laid out so that the film and its sound end together', async () => {
  const { buildPromo } = await import(promoMod);
  const built = buildPromo(BRIEF);
  assert.equal(built.ok, true);
  // Every lane starts where the previous one ended: no gaps, no overlaps.
  for (let i = 1; i < built.lanes.length; i += 1) {
    const previous = built.lanes[i - 1];
    const end = Number((previous.at + previous.length).toFixed(3));
    assert.equal(built.lanes[i].at, end, `lane ${i} starts where lane ${i - 1} ends`);
  }
  const lastLane = built.lanes[built.lanes.length - 1];
  assert.equal(Number((lastLane.at + lastLane.length).toFixed(3)), built.seconds);
});

test('every shot carries the same chrome and the same camera move', async () => {
  const { buildPromo } = await import(promoMod);
  const built = buildPromo(BRIEF);
  const pushes = new Set();
  for (const page of built.pages) {
    assert.match(page.html, /class="brand"/, `${page.name} has the brand mark`);
    assert.match(page.html, /class="idx"/, `${page.name} has the shot index`);
    assert.match(page.html, /class="prog"/, `${page.name} has the progress hairline`);
    assert.match(page.html, /\(1\.03 \+ PUSH \* easeInOut/, `${page.name} pushes in like the others`);
    assert.match(page.html, /window\.film = \{/, `${page.name} exposes a film clock`);
    pushes.add(page.html.match(/const PUSH = ([\d.]+);/)?.[1]);
  }
  // One camera for the whole film: the value may differ between structures, never
  // between shots of the same one.
  assert.equal(pushes.size, 1, 'every shot pushes at the same rate');
});

test('a join owns the hand-over instead of stacking on the shots', async () => {
  const { buildPromo } = await import(promoMod);
  const built = buildPromo(BRIEF);
  assert.equal(built.joins.length, BRIEF.shots.length - 1);
  for (const join of built.joins) {
    assert.ok(built.pages.some((page) => page.name === join.from));
    assert.ok(built.pages.some((page) => page.name === join.to));
    assert.match(built.filmHtml, new RegExp(`src="${join.name.replace('.', '\\.')}#t=0`), 'the film plays the join');
  }
  // No clip may be placed inside another: read the film's own iframes.
  const clips = [...built.filmHtml.matchAll(/src="([^"#]+)#t=([\d.]+),([\d.]+)"(?:\s+at="([\d.]+)")?/g)]
    .map((m) => ({
      name: m[1],
      at: Number(m[4] ?? 0),
      length: Number(m[3]) - Number(m[2]),
    }))
    .sort((a, b) => a.at - b.at);
  for (let i = 1; i < clips.length; i += 1) {
    const previousEnd = Number((clips[i - 1].at + clips[i - 1].length).toFixed(3));
    assert.ok(clips[i].at >= previousEnd - 1e-6, `${clips[i].name} does not overlap ${clips[i - 1].name}`);
  }
});

test('the end card carries the address it was given', async () => {  const { buildPromo } = await import(promoMod);
  const built = buildPromo(BRIEF);
  const end = built.pages.find((page) => page.name.includes('end'));
  assert.match(end.html, /github\.com\/x/);
});

test('a proof shot can point at what it claims', async () => {
  const { buildPromo } = await import(promoMod);
  const marked = buildPromo({
    shots: [
      { kind: 'plate', image: 'assets/a.png', title: ['证据'], mark: { x: 29, y: 840, w: 587, h: 150, label: '就在这一屏' } },
      { kind: 'end', title: ['X'], url: 'github.com/x/y' },
    ],
  });
  const html = marked.pages[0].html;
  assert.match(html, /class="mark-box"/, 'the callout exists');
  assert.match(html, /const MARK = \[29, 840, 587, 150\];/);
  assert.match(html, /const MARK_LABEL = "就在这一屏";/);
  // The spotlight is clipped to the phone screen, so the copy is never dimmed.
  assert.match(html, /\.mark \{ position: absolute; left: 1403px; top: 131px; width: 378px; height: 818px;/);

  // A shot without a mark has no callout at all.
  const plain = buildPromo({ shots: [{ kind: 'plate', image: 'assets/a.png', title: ['证据'] }] });
  // The stylesheet always carries the rule; the element is what must be absent.
  assert.equal(plain.pages[0].html.includes('<div class="mark">'), false);
  assert.equal(plain.pages[0].html.includes('const MARK = null;'), true);
});

test('a behaviour claim shows two states of the same screen', async () => {
  const { buildPromo } = await import(promoMod);
  const built = buildPromo({
    shots: [
      { kind: 'plate', image: 'assets/a.png', imageAfter: 'assets/b.png', title: ['它会换一种回答'],
        mark: { x: 60, y: 900, w: 900, h: 160, label: '语音' }, markAfter: { x: 60, y: 1500, w: 900, h: 200 } },
      { kind: 'end', title: ['X'], url: 'github.com/x/y' },
    ],
  });
  const html = built.pages[0].html;
  assert.match(html, /<img class="after" src="assets\/b\.png"/, 'the second state is a layer');
  assert.match(html, /const MARK_AFTER = \[60, 1500, 900, 200\];/);
  assert.match(html, /const swap = easeInOut\(clamp01\(\(t - D \* 0\.42\) \/ \(D \* 0\.2\)\)\)/, 'the change lands mid-shot');
  assert.match(html, /MARK\[0\] = MARK\[0\] \+ \(MARK_AFTER\[0\] - MARK\[0\]\) \* swap/, 'and the callout travels with it');

  // One state needs no dissolve layer and no travelling callout.
  const single = buildPromo({ shots: [{ kind: 'plate', image: 'assets/a.png', title: ['x'], mark: { x: 1, y: 2, w: 3, h: 4 } }] });
  assert.equal(single.pages[0].html.includes('img class="after"'), false);
  assert.match(single.pages[0].html, /const MARK_AFTER = null;/);
});

test('a number shot can carry a row of figures, each with its unit', async () => {
  const { buildPromo } = await import(promoMod);
  const built = buildPromo({
    shots: [
      { kind: 'number', caption: '一个手机里有', duration: 4.2,
        figures: [
          { value: 154, unit: '个工具', label: '可调用' },
          { value: 23, unit: '项权限', label: '声明在清单里' },
          { value: 49, unit: '个测试文件', label: '403 条断言' },
        ],
        sources: 'docs/facts.json' },
      { kind: 'end', title: ['X'], url: 'github.com/x/y' },
    ],
  });
  const html = built.pages[0].html;
  assert.equal((html.match(/class="fig"/g) ?? []).length, 3);
  assert.deepEqual([...html.matchAll(/data-v="(\d+)"/g)].map((m) => m[1]), ['154', '23', '49']);
  assert.match(html, /个工具/);
  assert.match(html, /项权限/);
  assert.ok(html.includes('docs/facts.json'), 'the row says where the numbers came from');

  // A bad row is refused before a page is written: no unit, no figure shot.
  const refused = buildPromo({ shots: [{ kind: 'number', figures: [{ value: 5 }] }] });
  assert.equal(refused.ok, false);
  assert.ok(refused.problems.some((problem) => /needs a unit/.test(problem)));
});

test('a cut changes the material as well as the content', async () => {
  const { buildPromo } = await import(promoMod);
  const built = buildPromo({
    shots: [
      { kind: 'type', title: ['一'] },
      { kind: 'plate', image: 'a.png', title: ['二'] },
      { kind: 'number', figures: [{ value: 154, unit: '个工具', label: '工具' }] },
      { kind: 'claim', claim: '结论', evidence: [{ text: 'x' }] },
      { kind: 'end', title: ['X'], url: 'github.com/x/y' },
    ],
  });
  const surfaceOf = (page) => page.html.match(/class="surface (surface-[a-z]+)"/)?.[1];
  const map = Object.fromEntries(built.pages.map((page) => [page.name.split('-')[1].replace('.html', ''), surfaceOf(page)]));
  assert.equal(map.type, 'surface-paper', 'words sit on paper');
  assert.equal(map.plate, 'surface-glass', 'a screen sits under glass');
  assert.equal(map.number, 'surface-metal', 'a figure sits on machined metal');
  assert.equal(map.claim, 'surface-glass');
  assert.equal(map.end, 'surface-paper');
  // Three different materials in one film, not one repeated background.
  assert.equal(new Set(Object.values(map)).size, 3);
});

test('every surface is lit from the same place', async () => {
  const { buildPromo } = await import(promoMod);
  const built = buildPromo({ shots: [{ kind: 'type', title: ['一'] }, { kind: 'plate', image: 'a.png', title: ['二'] }] });
  const [typePage, platePage] = built.pages;
  for (const page of [typePage, platePage]) {
    // The room glow sits where the light is, and the far side is shaded.
    assert.match(page.html, /radial-gradient\(80% 70% at 34% 26%/, `${page.name}: the room is lit from the upper left`);
    assert.match(page.html, /class="shade"/, `${page.name}: the far side is shaded`);
  }
  // The glass highlight is derived from the light, not a fixed angle.
  const glass = platePage.html.match(/\.surface-glass \{[^}]*linear-gradient\((-?\d+)deg/);
  assert.ok(glass, 'the glass surface has a derived highlight');
  assert.notEqual(glass[1], '118', 'it is no longer the hard-coded angle');
});

test('each kind of shot gets its own camera', async () => {
  const { buildPromo } = await import(promoMod);
  const built = buildPromo({
    shots: [
      { kind: 'type', title: ['一'] },
      { kind: 'plate', image: 'a.png', title: ['二'] },
      { kind: 'number', figures: [{ value: 154, unit: '个工具', label: '工具' }] },
      { kind: 'claim', claim: '结论', evidence: [{ text: 'x' }] },
      { kind: 'end', title: ['X'], url: 'github.com/x/y' },
    ],
  });
  const cameraOf = (page) => page.html.match(/const CAMERA = "([a-z]+)";/)?.[1];
  const map = Object.fromEntries(built.pages.map((page) => [page.name.split('-')[1].replace('.html', ''), cameraOf(page)]));
  assert.equal(map.type, 'dolly', 'words get a dolly');
  assert.equal(map.plate, 'shoulder', 'proof gets a shoulder');
  assert.equal(map.number, 'locked', 'a figure gets a locked-off frame');
  assert.equal(map.claim, 'dolly');

  // The movement has a start and a settle, not a constant rate.
  assert.match(built.pages[0].html, /const head = easeInOut\(clamp01\(shotT \/ 0\.22\)\)/);
  // A shoulder keeps micro-motion at more than one frequency.
  assert.match(built.pages[1].html, /Math\.sin\(t \* 1\.7\)/);
  assert.match(built.pages[1].html, /Math\.sin\(t \* 3\.3/);
});

test('each kind of shot has a focus plane, and nothing readable is blurred', async () => {
  const { buildPromo } = await import(promoMod);
  const built = buildPromo({
    shots: [
      { kind: 'type', title: ['一'] },
      { kind: 'plate', image: 'a.png', title: ['二'] },
      { kind: 'number', figures: [{ value: 154, unit: '个工具', label: '工具' }] },
    ],
  });
  const focusOf = (page) => {
    const match = page.html.match(/--bg-blur: (\d+)px; --surface-blur: ([\d.]+)px/);
    return match ? { bg: Number(match[1]), surface: Number(match[2]) } : null;
  };
  const map = Object.fromEntries(built.pages.map((page) => [page.name.split('-')[1].replace('.html', ''), focusOf(page)]));
  assert.ok(map.type && map.plate && map.number, 'every kind declares a focus plane');
  assert.ok(map.type.bg > map.plate.bg, 'words push the background further out of focus');
  assert.ok(map.number.surface > map.type.surface, 'a figure sits behind a softer dial');

  // Whatever carries meaning must stay sharp: no blur on copy or phone.
  for (const page of built.pages) {
    assert.equal(/\.copy[^{]*\{[^}]*filter:\s*blur/.test(page.html), false, 'the copy is never blurred');
    assert.equal(/\.phone[^{]*\{[^}]*filter:\s*blur/.test(page.html), false, 'the screen is never blurred');
  }
});

test('the room has air, but it never fogs', async () => {
  const { buildPromo } = await import(promoMod);
  const built = buildPromo({ shots: [{ kind: 'type', title: ['一'] }] });
  const html = built.pages[0].html;
  assert.match(html, /class="haze"/, 'a haze layer');
  assert.match(html, /class="bloom"/, 'a bloom layer');
  // Both are bounded: air is not fog, and bloom is not a white wash.
  assert.match(html, /\.haze \{[^}]*opacity: (0\.[0-4]\d*);/, 'haze stays under half');
  assert.match(html, /\.bloom \{[^}]*opacity: 0\.1\d*;/, 'bloom stays near a tenth');
  assert.match(html, /mask-image: radial-gradient/, 'bloom only spreads where the light is');
  assert.match(html, /mix-blend-mode: screen/, 'and it adds light rather than covering the frame');
});
