/**
 * Fonts: one shared stack, and a warning before a title renders as boxes.
 *
 *   node tests/fonts.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const fontsMod = new URL('../film-fonts.mjs', import.meta.url).href;
const typeMod = new URL('../film-type.mjs', import.meta.url).href;
const sceneMod = new URL('../film-scene.mjs', import.meta.url).href;
const graphicsMod = new URL('../film-graphics.mjs', import.meta.url).href;

test('the stack is one list, CJK first, and quoted where it needs to be', async () => {
  const { FONT_STACK, fontStack } = await import(fontsMod);
  const css = fontStack();
  assert.ok(css.startsWith('"Noto Sans SC"'), 'a CJK face leads the stack');
  assert.ok(css.includes('"Microsoft YaHei"'), 'Windows has a real fallback');
  assert.ok(css.includes('"PingFang SC"'), 'and macOS does too');
  assert.ok(css.trim().endsWith('sans-serif'), 'the stack always ends somewhere');
  assert.equal(FONT_STACK[FONT_STACK.length - 1], 'sans-serif');
});

test('a machine without a CJK font is a loud failure for CJK text, not for Latin', async () => {
  const { fontRisk } = await import(fontsMod);
  assert.equal(fontRisk({ text: 'HELLO', cjkAvailable: false }).ok, true, 'Latin is fine anywhere');
  assert.equal(fontRisk({ text: '中文标题', cjkAvailable: true }).ok, true);
  const risk = fontRisk({ text: '中文标题', cjkAvailable: false });
  assert.equal(risk.ok, false);
  assert.match(risk.problems.join(' '), /boxes/);
  assert.match(risk.advice, /CJK font/);
});

test('one suspicious page is named, not the whole project vaguely', async () => {
  const { projectFontRisk } = await import(fontsMod);
  const report = projectFontRisk(
    [{ file: '01-title.html', html: '<h1>你好</h1>' }, { file: '02-scene.html', html: '<p>hi</p>' }],
    { cjkAvailable: false },
  );
  assert.equal(report.ok, false);
  assert.deepEqual(report.files, ['01-title.html']);
  assert.ok(report.problems[0].startsWith('01-title.html:'));
  assert.equal(report.problems.length, 1, 'only the page that needs the font is reported');

  const clean = projectFontRisk([{ file: 'a.html', html: '<p>hi</p>' }], { cjkAvailable: false });
  assert.equal(clean.ok, true);
});

test('the page builders share the stack instead of each inventing one', async () => {
  const { buildTypePage } = await import(typeMod);
  const { buildScenePage } = await import(sceneMod);
  const { buildGraphicsPage } = await import(graphicsMod);
  const pages = [
    buildTypePage({ lines: [{ text: '标题' }], duration: 3 }),
    buildScenePage({ panels: [{ text: '场景' }], duration: 3 }),
    buildGraphicsPage({ mode: 'chart', title: '图', items: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }], duration: 3 }),
  ];
  for (const page of pages) {
    assert.ok(page.includes('"Noto Sans SC"'), 'the shared stack is in the page');
    assert.ok(page.includes('"WenQuanYi Zen Hei"'), 'including the Linux fallback');
    assert.ok(!/"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", system-ui, sans-serif;/.test(page), 'no page keeps a private copy of the list');
  }
});
