/**
 * Draw the panel for review.
 *
 * The sidebar only exists inside the harness, so this takes the stylesheet and
 * the class names out of client.js and renders a mock of the panel in Chromium —
 * light and dark, side by side — so the design can be looked at like a picture
 * instead of guessed at from CSS.
 *
 *   node scripts/panel-preview.mjs [out.png]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = resolve(here, '..');
const out = resolve(process.argv[2] ?? join(plugin, 'deliveries', 'panel-preview.png'));
const tab = ['film', 'look', 'setup'].includes(process.argv[3]) ? process.argv[3] : 'film';

const client = readFileSync(join(plugin, 'client.js'), 'utf8');
const start = client.indexOf('const css = `');
const end = client.indexOf('`;', start);
if (start < 0 || end < 0) throw new Error('the panel stylesheet was not found in client.js');
let css = client.slice(start + 'const css = `'.length, end);

// The panel inherits its colours from the harness; in a mock they must be given.
const mockVars = `
  :root { color-scheme: light dark; }
  body.light { --dsw-alias-bg-layer-1: #ffffff; --dsw-alias-label-primary: #1c1c1e;
    --dsw-alias-label-secondary: #6b6b70; --dsw-alias-border-l1: rgba(0,0,0,0.10);
    --dsw-alias-border-l2: rgba(0,0,0,0.18); --dsw-alias-accent: #0a84ff; background: #f2f2f7; }
  body.dark { --dsw-alias-bg-layer-1: #1c1c1e; --dsw-alias-label-primary: #ffffff;
    --dsw-alias-label-secondary: #9a9aa0; --dsw-alias-border-l1: rgba(255,255,255,0.10);
    --dsw-alias-border-l2: rgba(255,255,255,0.18); --dsw-alias-accent: #0a84ff; background: #000; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI Variable Text", "PingFang SC", system-ui, sans-serif; }
  .stage { display: flex; gap: 24px; padding: 24px; align-items: flex-start; }
  .column { flex: 0 0 380px; width: 380px; border-radius: 22px; overflow: hidden;
    background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
    box-shadow: 0 24px 60px rgba(0,0,0,0.28), 0 0 0 1px var(--dsw-alias-border-l1); }
`;

const panel = `
  <div class="of-dock" data-tab="__TAB__">
    <div class="of-dock-head">
      <div class="of-dock-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5l5 2.5-5 2.5z"/></svg>
        <span>Mise</span>
        <span class="of-dock-sub">Mise · 影片即调度</span>
      </div>
      <button class="of-btn">刷新</button>
    </div>

    <div class="of-seg" role="tablist">
      <button class="of-seg-item __SEGON_film__">分镜</button>
      <button class="of-seg-item __SEGON_look__">预览</button>
      <button class="of-seg-item __SEGON_setup__">设置</button>
    </div>

    <div class="of-body of-sec-look">
      <div class="of-col-preview">
        <div class="of-preview" style="height:180px;position:relative">
          <div class="of-preview-empty"><span class="of-empty-mark">◍</span><span class="of-empty-line">还没有画面。先画一帧，看看片子长什么样。</span><button class="of-btn of-primary">画一帧</button></div>
        </div>
      </div>
    </div>

    <div class="of-board of-sec-film">
      <div class="of-board-head"><span>分镜 · 6</span><span class="of-board-sub">product-mg</span></div>
      <div class="of-board-strip">
        <button class="of-shot of-shot-active of-shot-has"><img class="of-shot-img" src="__THUMB1__" alt=""><span class="of-shot-i">01</span><span class="of-shot-k">scan</span><span class="of-shot-t">5.0s</span></button>
        <button class="of-shot of-shot-has"><img class="of-shot-img" src="__THUMB2__" alt=""><span class="of-shot-i">02</span><span class="of-shot-k">number</span><span class="of-shot-t">4.2s</span></button>
        <button class="of-shot of-shot-has"><img class="of-shot-img" src="__THUMB3__" alt=""><span class="of-shot-i">03</span><span class="of-shot-k">split</span><span class="of-shot-t">3.5s</span></button>
        <button class="of-shot of-shot-has"><img class="of-shot-img" src="__THUMB4__" alt=""><span class="of-shot-i">04</span><span class="of-shot-k">statement</span><span class="of-shot-t">2.4s</span></button>
        <button class="of-shot of-shot-has"><img class="of-shot-img" src="__THUMB5__" alt=""><span class="of-shot-i">05</span><span class="of-shot-k">bleed</span><span class="of-shot-t">3.3s</span></button>
        <button class="of-shot of-shot-add"><span class="of-shot-add-mark">＋</span><span class="of-shot-k">新增一镜</span></button>
      </div>
      <div class="of-board-actions">
        <button class="of-btn of-primary">渲染全片</button>
        <button class="of-btn">上一镜</button>
        <button class="of-btn">下一镜</button>
      </div>
      <div class="of-board-edit">
        <span class="of-board-edit-name">01 · 5.0s</span>
        <button class="of-btn">−0.5s</button>
        <button class="of-btn">+0.5s</button>
        <button class="of-btn">前移</button>
        <button class="of-btn">后移</button>
      </div>
    </div>

    <div class="of-card of-sec-setup">
      <button class="of-toggle"><span>渲染</span><span>−</span></button>
      <div class="of-row"><span>帧率</span><button class="of-btn">30 fps</button></div>
      <div class="of-row"><span>尺寸</span><span class="of-hint">1920 × 1080</span></div>
      <div class="of-row"><span>交付响度</span><span class="of-chip">−16 LUFS</span></div>
    </div>

    <div class="of-card of-sec-setup">
      <div class="of-compare-head"><span>上一版交付</span><span class="of-compare-file">cut-b-delivered.mp4</span></div>
      <div class="of-compare-meta"><span class="of-chip">门禁通过</span><span class="of-chip">-15.02 LUFS</span></div>
      <div class="of-compare-list">
        <button class="of-compare-row" type="button"><span class="of-compare-shot">第7镜 · 标题</span><span class="of-compare-at">14.28s</span><span class="of-compare-pct">11.5 → 10</span></button>
        <button class="of-compare-row" type="button"><span class="of-compare-shot">第2镜 · 标题</span><span class="of-compare-at">6.05s</span><span class="of-compare-pct">38 → 36.8</span></button>
      </div>
    </div>

    <div class="of-card of-sec-setup">
      <button class="of-toggle"><span>检查</span><span>+</span></button>
      <div class="of-status-ok">门禁通过 · 7/7 已批准 · 像素验收通过</div>
      <div class="of-hint">Mise 自己渲染：临时回环服务 + 逐帧驱动时钟 + ffmpeg 混流，不启动 Studio。</div>
    </div>

    <pre class="of-output of-sec-setup of-status-ok">rendered cut-b/mise-tool.mp4
703 frames · 23.4s · 11 clips · 1 audio track</pre>
  </div>
`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>${mockVars}\n${css}</style></head>
<body>
<div class="stage">
  <div class="column light"><div class="light-body">${panel}</div></div>
  <div class="column dark"><div class="dark-body">${panel}</div></div>
</div>
</body></html>`;

// The panel expects the colour variables on an ancestor; give each column its own.
const panelFor = (tab) => panel.replace('<div class="of-dock">', '<div class="of-dock" data-tab="' + tab + '">');
const threeTabs = html
  .replace(/<div class="stage">[\s\S]*<\/div>\s*<\/body>/, '')
  .replace('</body>', '');
const lightHtml = html.replace('<div class="column light"><div class="light-body">', '<div class="column light"><div class="light-body" data-theme="light">');
const finalHtml = lightHtml
  .replace('body.light {', 'body.light, [data-theme="light"] {')
  .replace('body.dark {', 'body.dark, .column.dark {');

const thumbDir = resolve(plugin, '..', 'deliveries', 'dsh-mobile-promo', 'cut-b', '.film', 'thumbs');
const inline = (name) => {
  try {
    const bytes = readFileSync(join(thumbDir, name));
    return 'data:image/png;base64,' + bytes.toString('base64');
  } catch { return ''; }
};
let withThumbs = finalHtml
  .replace('__THUMB1__', inline('shot-01.small.png'))
  .replace('__THUMB2__', inline('shot-02.small.png'))
  .replace('__THUMB3__', inline('shot-03.small.png'))
  .replace('__THUMB4__', inline('shot-04.small.png'))
  .replace('__THUMB5__', inline('shot-05.small.png'));
const tmp = join(plugin, '.panel-preview.html');
const marked = ['film', 'look', 'setup'].reduce((html, key) => html.split('__SEGON_' + key + '__').join(key === tab ? 'of-seg-on' : ''), withThumbs);
writeFileSync(tmp, marked.split('__TAB__').join(tab), 'utf8');

const { chromium } = await import('../vendor/node_modules/playwright-core/index.mjs');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 880, height: 1100 }, deviceScaleFactor: 2 });
await page.goto(`file:///${tmp.replace(/\\/g, '/')}`, { waitUntil: 'load' });
mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out, fullPage: true });
await browser.close();
writeFileSync(tmp, '', 'utf8');
console.log('panel preview written:', out);
