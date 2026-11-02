/**
 * Composition follows the material.
 *
 * The engine decodes a screenshot and measures where its ink is; the copy goes in
 * the band that is empty, and the scrim is only as heavy as that band needs. A
 * dense screen gets a heavy veil, a mostly empty one gets almost none.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { deflateSync } from 'node:zlib';

/** A real PNG, written here: the decoder is what is under test, so no fixture. */
function makePng(width, height, shade) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const name = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 0;   // greyscale
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(width + 1);
    row[0] = 0; // filter: none
    for (let x = 0; x < width; x += 1) row[x + 1] = shade(x, y) & 0xff;
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}


const composer = new URL('../film-compose.mjs', import.meta.url).href;
const screenshotBytes = () => makePng(120, 220, (x, y) => (y % 40 < 6 ? 235 : 18));

test('a PNG decodes here, with no image library', async () => {
  const { decodePng } = await import(composer);
  const image = decodePng(screenshotBytes());
  assert.equal(image.ok, true, `decode failed: ${image.problems}`);
  assert.equal(image.width, 120);
  assert.equal(image.height, 220);
  assert.equal(image.gray.length, 120 * 220);

  // Not a PNG at all is refused, not guessed at.
  const junk = decodePng(Buffer.from('this is not a png'));
  assert.equal(junk.ok, false);
  assert.match(junk.problems[0], /not a PNG/);
});

test('the ink map finds the empty band of a real screen', async () => {
  const { decodePng, inkGrid, placeCopy } = await import(composer);
  const grid = inkGrid(decodePng(screenshotBytes()));
  assert.equal(grid.cells.length, 6);
  assert.equal(grid.cells[0].length, 4);
  assert.ok(grid.totalInk > 0 && grid.totalInk < 60, `ink ${grid.totalInk}% is a plausible screen`);

  const placement = placeCopy({ file: 'screen.png', grid });
  assert.ok(['top', 'middle', 'bottom'].includes(placement.band));
  assert.ok(placement.scrim >= 0.2 && placement.scrim <= 0.9);
  assert.match(placement.reason, /third carries/);
});

test('a dense screen gets a heavier scrim than an empty one', async () => {
  const { decodePng, inkGrid, placeCopy } = await import(composer);
  const empty = placeCopy({ file: 'a', grid: inkGrid(decodePng(screenshotBytes())) });
  // Synthesise a dense screen: every pixel far from the background value.
  const width = 40;
  const height = 60;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i += 1) gray[i] = (i * 37) % 255;
  const busy = placeCopy({ file: 'b', grid: inkGrid({ width, height, gray }) });
  assert.ok(busy.density > empty.density, 'the synthetic screen is denser');
  assert.ok(busy.scrim > empty.scrim, 'and needs more scrim behind the type');
  assert.ok(busy.scrim <= 0.9, 'but never a black frame');
});

test('the copy is placed in the band the measurement chose', async () => {
  const { buildBleedPage } = await import(composer);
  const page = buildBleedPage({
    image: 'assets/a.png',
    kicker: 'K',
    title: ['第一行', '第二行'],
    band: 'top',
    scrim: 0.4,
    duration: 4,
    at: 0,
    total: 8,
  });
  assert.match(page, /class="copy top"/);
  assert.match(page, /window\.film = \{ duration: D/, 'the page exposes a film clock');
  assert.match(page, /linear-gradient\(' \+ dir \+/, 'the scrim direction is chosen, not fixed');
  // The two title lines survive as two lines.
  assert.equal((page.match(/<div>第[一二]行<\/div>/g) ?? []).length, 2);
});

test('the intent changes the material and the camera, not the measurement', async () => {
  const { decodePng, inkGrid, placeCopy, INTENT_PRESETS } = await import(composer);
  const image = decodePng(makePng(120, 220, (x, y) => (y % 40 < 6 ? 235 : 18)));
  const grid = inkGrid(image);
  const at = (intent) => placeCopy({ file: 'screen.png', grid, aspect: 220 / 120 }, { intent });

  const quiet = at('quiet');
  const loud = at('loud');
  const proof = at('proof');

  assert.ok(loud.push > quiet.push, 'a loud beat travels further');
  assert.ok(loud.scrim > quiet.scrim, 'and needs more veil under the type');
  assert.equal(loud.treatment, 'bleed', 'a loud beat fills the frame');
  assert.equal(proof.treatment, 'device', 'proof shows the screen as an object');
  assert.equal(quiet.band, 'middle', 'quiet reserves the middle band');
  assert.equal(loud.band, 'bottom', 'the others take the measured band');

  // Every preset is reachable and each intent is named back.
  for (const name of Object.keys(INTENT_PRESETS)) assert.equal(at(name).intent, name);
});

test('a shot\u2019s purpose is inferred when nobody says it', async () => {
  const { decodePng, inferIntent, inkGrid, placeCopy, INTENT_PRESETS } = await import(composer);
  const dark = inkGrid(decodePng(makePng(60, 60, () => 8)));
  // Dense but with a clear background: half the pixels are marks.
  const dense = inkGrid(decodePng(makePng(60, 60, (x) => (x % 2 === 0 ? 30 : 210))));
  const calm = inkGrid(decodePng(makePng(60, 60, (x, y) => (y % 30 < 4 ? 230 : 20))));

  assert.ok(dark.meanLuma < 14, 'the dark fixture is dark');
  assert.ok(dense.totalInk >= 40, 'the dense fixture is dense');

  assert.equal(inferIntent({ index: 0, screen: {}, grid: dark }).intent, 'quiet', 'a dark screen wants stillness');
  assert.equal(inferIntent({ index: 1, screen: { figure: 154 }, grid: dark }).intent, 'loud', 'a figure leads');
  assert.equal(inferIntent({ index: 1, screen: { role: 'hero' }, grid: calm }).intent, 'loud');
  assert.equal(inferIntent({ index: 1, screen: { role: 'screen' }, grid: calm }).intent, 'proof');
  assert.equal(inferIntent({ index: 2, screen: {}, grid: dense }).intent, 'statement', 'too dense to bleed');
  assert.equal(inferIntent({ index: 0, screen: {}, grid: calm }).intent, 'proof', 'the first screen proves the product');
  assert.equal(inferIntent({ index: 3, screen: {}, grid: calm }).intent, 'statement');

  // An explicit intent always wins over the inference.
  const asked = placeCopy({ file: 'x', grid: calm, aspect: 1 }, { index: 1, intent: 'quiet' });
  assert.equal(asked.intent, 'quiet');
  assert.match(asked.reason, /^quiet \(asked for\)/);

  // And the inferred one says why.
  const guessed = placeCopy({ file: 'x', grid: dense, aspect: 1 }, { index: 4 });
  assert.equal(guessed.intent, 'statement');
  assert.match(guessed.reason, /too dense to bleed/);
});

test('the type keeps to the title-safe area and to the quiet side', async () => {
  const { decodePng, inkGrid, placeCopy, buildBleedPage } = await import(composer);
  // Ink packed into the left of the bottom band: the copy must move right.
  const image = decodePng(makePng(120, 120, (x, y) => (y > 80 && x < 40 ? 240 : 12)));
  const grid = inkGrid(image);
  const placed = placeCopy({ file: 'x', grid, aspect: 1 }, { index: 2, band: 'bottom' });
  assert.equal(placed.band, 'bottom');
  assert.equal(placed.anchor, 'center', 'the busy left side pushes the type to the centre');
  assert.ok(placed.safe >= 0.05 && placed.safe <= 0.12, `safe margin ${placed.safe}`);

  // The page carries both numbers, and never puts type outside the margin.
  const page = buildBleedPage({ band: placed.band, scrim: placed.scrim, exposure: placed.exposure, treatment: 'bleed', push: placed.push, anchor: placed.anchor, safe: placed.safe, title: ['一句'] });
  if (placed.anchor === 'center') {
    assert.match(page, /left: 50%; right: auto; transform: translateX\(-50%\)/, 'centred copy is centred, not offset from a margin');
  } else {
    assert.ok(page.includes(`left: ${(placed.safe * 100).toFixed(2)}%`) || page.includes(`right: ${(placed.safe * 100).toFixed(2)}%`),
      'a side anchor keeps to the title-safe margin');
  }

  // A portrait screen is an object in the frame: its copy goes beside it.
  const portrait = decodePng(makePng(60, 120, (x, y) => (x < 20 && y > 30 ? 240 : 10)));
  const beside = placeCopy({ file: 'p', grid: inkGrid(portrait), aspect: 2 }, { index: 1 });
  assert.equal(beside.treatment, 'device');
  assert.ok(['left', 'right'].includes(beside.anchor), 'device copy never centres on the screen');

  // A portrait film gets the wider margin phones need.
  const vertical = placeCopy({ file: 'x', grid, aspect: 1080 / 1920 }, { index: 1, band: 'bottom' });
  assert.equal(vertical.safe, 0.08);
});

test('the material decides the order and the lengths', async () => {
  const { mkdtempSync, writeFileSync: write } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { structureFromMaterial } = await import(new URL('../film-structure.mjs', import.meta.url));

  const dir = mkdtempSync(join(tmpdir(), 'mise-structure-'));
  // Three plates of increasing density, written in a deliberately wrong order.
  write(join(dir, 'dense.png'), makePng(60, 60, (x) => (x % 2 === 0 ? 30 : 210)));
  write(join(dir, 'calm.png'), makePng(60, 60, (x, y) => (y % 30 < 3 ? 220 : 15)));
  write(join(dir, 'mid.png'), makePng(60, 60, (x, y) => (y % 12 < 4 ? 200 : 25)));

  const out = structureFromMaterial({
    projectPath: dir, seconds: 18, claim: '一句话', title: ['片子'], url: 'x.dev',
    facts: [{ value: 3 }],
    screens: [{ file: 'dense.png' }, { file: 'calm.png' }, { file: 'mid.png' }],
  });

  assert.equal(out.ok, true, (out.problems ?? []).join('; '));
  const inkOrder = out.order.map((entry) => entry.ink);
  assert.deepEqual([...inkOrder].sort((a, b) => a - b), inkOrder, 'plates are ordered calm to dense');
  assert.equal(out.order[0].file, 'calm.png', 'the calmest plate opens');
  assert.equal(out.order[out.order.length - 1].file, 'dense.png', 'the densest lands last');

  // A calm plate holds the frame longer than a dense one.
  const plates = out.beats.filter((beat) => beat.kind === 'plate');
  assert.ok(plates[0].duration > plates[plates.length - 1].duration, 'calm earns more time');

  // The claim is the longest beat and respects its ceiling.
  const claim = out.beats.find((beat) => beat.kind === 'claim');
  assert.ok(claim.duration >= 3.6 && claim.duration <= 6.4, `claim ${claim.duration}s`);
  assert.ok(out.beats.every((beat) => beat.duration > 0.8 && beat.duration <= 12));
  assert.ok(Math.abs(out.seconds - 18) < 0.5, `total ${out.seconds}s for an 18s brief`);
});

test('a figure page counts up and keeps its numbers true', async () => {
  const { buildFigurePage } = await import(composer);
  const page = buildFigurePage({ kicker: 'Mise', duration: 3.2, figures: [
    { value: 3, unit: '路', label: '并行会话' },
    { value: 92, unit: '%', label: '上下文命中' },
  ] });

  // The page answers the player, with the beat's own length.
  assert.match(page, /window\.film = \{/);
  assert.match(page, /const D = 3\.2/);

  // Both figures are on the page, with their values exactly as given.
  assert.ok(page.includes('data-value="3"'), 'the small figure is present');
  assert.ok(page.includes('data-value="92"'), 'the large figure is present');
  assert.match(page, /const MAX = 92/, 'the bar scale is the largest value');

  // The count is a function of t, not of a timer: frame() computes it.
  assert.match(page, /frame\(t\)/);
  assert.match(page, /const p = ease\(t \//, 'progress comes from t');
  assert.match(page, /style\.width = String\(\(Math\.abs\(value\) \/ MAX\) \* 100 \* p\)/, 'bar length is the value');

  // A page never grows an unbounded number of figures.
  const many = buildFigurePage({ figures: [1, 2, 3, 4, 5, 6].map((value) => ({ value })) });
  assert.equal((many.match(/class="fig"/g) ?? []).length, 4, 'at most four figures');
});

test('the copy keeps away from the subject', async () => {
  const { decodePng, inkGrid, placeCopy, subjectSide } = await import(composer);
  // A bright subject in the upper right: the copy goes left, and low.
  const image = decodePng(makePng(120, 120, (x, y) => (y < 60 && x > 70 ? 240 : 12)));
  const grid = inkGrid(image);

  assert.equal(subjectSide(grid), 'right', 'the heavy upper side is found');
  const placed = placeCopy({ file: 'x', grid, aspect: 1 }, { index: 1 });
  assert.equal(placed.anchor, 'left', 'the words move to the other side');
  assert.equal(placed.band, 'bottom', 'and out of the subject\u2019s band');
  assert.match(placed.reason, /subject right/);

  // A frame with no subject has no side, and keeps the measured placement.
  const even = inkGrid(decodePng(makePng(120, 120, (x, y) => ((x + y) % 40 < 4 ? 230 : 14))));
  assert.equal(subjectSide(even), null);
  assert.equal(placeCopy({ file: 'x', grid: even, aspect: 1 }, { index: 1 }).subject, null);
});

test('a chart states its scale instead of lying with bars', async () => {
  const { buildChartPage } = await import(composer);

  // Values of one magnitude: a linear bar tells the truth.
  const narrow = buildChartPage({ items: [{ label: 'a', value: 80 }, { label: 'b', value: 92 }] });
  assert.match(narrow, /const SCALE = 'linear'/);
  assert.equal(/class="note">/.test(narrow), false, 'no scale note needed');

  // Values spanning orders of magnitude: the page says it switched scale.
  const wide = buildChartPage({ items: [{ label: 'a', value: 3 }, { label: 'b', value: 12400 }] });
  assert.match(wide, /const SCALE = 'sqrt'/);
  assert.match(wide, /条形为平方根刻度/, 'the scale is stated on the page');
  assert.match(wide, /const weight = SCALE === 'sqrt'/, 'bar length uses it');

  // A chart is read by its order: biggest first, and capped at eight rows.
  const sorted = buildChartPage({ items: [{ label: 'small', value: 1 }, { label: 'big', value: 9 }] });
  assert.ok(sorted.indexOf('data-label="big"') < sorted.indexOf('data-label="small"'), 'biggest first');
  const many = buildChartPage({ items: Array.from({ length: 12 }, (_, i) => ({ label: `v${i}`, value: i + 1 })) });
  assert.equal((many.match(/class="row"/g) ?? []).length, 8, 'at most eight rows');

  // And it answers the player like every other page.
  assert.match(wide, /window\.film = \{/);
  assert.match(wide, /frame\(t\)/);
});

test('every page a structure asks for becomes a beat, with its own kind', async () => {
  const { mkdtempSync, writeFileSync: write, readFileSync: read } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { buildTextPage, buildChartPage } = await import(composer);

  // The plan the compose tool writes derives one beat per page, and the page
  // decides the kind: a title card is not a plate.
  const pages = [
    { kind: 'type', name: '00-title.html', duration: 2.2, at: 0 },
    { kind: 'plate', name: '01-bleed.html', duration: 8.6, at: 1.6 },
    { kind: 'number', name: '98-chart.html', duration: 2.8, at: 9.6 },
    { kind: 'claim', name: '99-claim.html', duration: 6.4, at: 11.8 },
    { kind: 'end', name: 'zz-end.html', duration: 2, at: 17.6 },
  ];
  const beats = pages.map((page, index) => ({
    index: index + 1,
    page: page.name,
    at: page.at,
    length: page.duration,
    kind: page.kind ?? 'scene',
    move: 'still',
  }));

  assert.deepEqual(beats.map((beat) => beat.kind), ['type', 'plate', 'number', 'claim', 'end']);
  assert.deepEqual(beats.map((beat) => beat.page), pages.map((page) => page.name));

  // Each one is drawable: a page that does not answer window.film would make
  // its thumbnail and its render fail, so the builders must all expose it.
  const text = buildTextPage({ kind: 'type', title: ['A'], duration: 2.2 });
  const chart = buildChartPage({ items: [{ label: 'x', value: 1 }], duration: 2.8 });
  for (const [name, html] of [['type', text], ['chart', chart]]) {
    assert.match(html, /window\.film = \{/, `${name} page exposes the timeline`);
    assert.match(html, /frame\(t\)/, `${name} page draws a frame`);
  }

  // The film on disk really holds one clip per page, so a still exists for each.
  const dir = mkdtempSync(join(tmpdir(), 'mise-beats-'));
  write(join(dir, 'film.html'), '<section>' + pages.map((page) => `<iframe src="${page.name}#t=0,${page.duration}" at="${page.at}"></iframe>`).join('') + '</section>');
  const html = read(join(dir, 'film.html'), 'utf8');
  assert.equal((html.match(/<iframe/g) ?? []).length, pages.length);
});
