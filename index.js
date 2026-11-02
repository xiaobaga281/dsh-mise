/**
 * Host half of `@local/dsh-openfilm`.
 *
 * Bundles the upstream `openfilm` npm package (MIT, github.com/mise/openfilm)
 * under `vendor/node_modules/` and wires it into the harness natively:
 *
 *   - tools: `mise_manual` (the film-format manual the agent reads before
 *     writing a film) and `mise_run` (every CLI command: open/look/render/
 *     get/capture/skills). The CLI is spawned with the profile's own node via
 *     absolute paths — no npm, no npx, no network at call time.
 *   - skills: the ten official OpenFilm style skills (keynote, collage,
 *     whiteboard, …) registered through `ctx.skills` so the model discovers
 *     them in the catalog, plus an `openfilm` skill carrying the manual.
 *
 * @module @local/dsh-openfilm
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_VOICE, VOICES, speakLine } from './voice-assets.mjs';
import { checkFilm } from './film-check.mjs';
import { cancelJob, clearFinishedJobs, enqueueMediaJob, getJob, hasPendingJobs, listJobs, resumeJobs } from './asset-queue.mjs';
import {
  MEDIA_CATALOG,
  describeMediaCapabilities,
  generateImage as generateMediaImage,
  probeMedia,
  recordAsset,
  startVideoTask,
  advanceVideoTask,
  downloadVideoTask,
  validateRequest,
} from './media-service.mjs';
import { newFilm, STAGES } from './film-new.mjs';
import { placeLines } from './film-timeline.mjs';
import { getMotion, listMotion, searchMotion } from './film-motion-catalog.mjs';
import { keyframePath, reviewStatus, setShotReview, shotsFromFacts } from './film-review.mjs';
import { CINE_GRADES, CINE_MOVES, buildCinePage, validateCine } from './film-cine.mjs';
import { assessEnvironment, describeTier, startGuide } from './film-doctor.mjs';
import { describeShots, moveShot, setShotLength } from './film-storyboard.mjs';
import { projectFontRisk } from './film-fonts.mjs';
import { shotWarmth } from './film-craft.mjs';
import { installPack, listPacks, removePack, verifyPack } from './film-packs.mjs';
import { planDepth, planInterpolation } from './film-interpolate.mjs';
import { buildDepthPage, validateDepthSpec } from './film-depth.mjs';
import { buildMorphPage, keyframeTimes, validateMorphSpec } from './film-keyframes.mjs';
import { SCENE_MOVES, SCENE_PALETTES, buildScenePage, validateSceneSpec } from './film-scene.mjs';
import { TYPE_MOTIONS, TYPE_PALETTES, buildTypePage, validateTypeSpec } from './film-type.mjs';
import { GRAPHICS_MODES, buildGraphicsPage, validateGraphicsSpec } from './film-graphics.mjs';
import { TRANSITION_COLORS, TRANSITION_KINDS, buildTransitionPage, validateTransitionSpec } from './film-transition.mjs';
import { DUO_KINDS, buildDuoPage, validateDuoSpec } from './film-duo.mjs';
import { GRADE_PRESETS, loudnessReason, planGrade, targetLufs } from './film-grade.mjs';
import { SCORE_KEYS, SCORE_MOODS, composeForShots, composeScore, renderScoreWav, validateScoreSpec } from './film-score.mjs';
import { planMix } from './film-mix.mjs';
import { envelopeForPage, wavEnvelope, speechRegions } from './film-audio.mjs';
import { GENRES, planProduction, validateGenre } from './film-genres.mjs';
import { buildPromo, proposePromo } from './film-promo.mjs';
import { buildBleedPage, decodePng, inkGrid, placeCopy, buildTextPage, buildFigurePage, buildChartPage } from './film-compose.mjs';
import { grabFrames, renderFilm } from './mise-render.mjs';
import { compareFrames, tileSheet } from './mise-look.mjs';
import { addShot } from './mise-storyboard-add.mjs';
import { toolPath } from './mise-tools.mjs';
import { structureFromMaterial } from './film-structure.mjs';
import { acceptanceWarning, analyzeGray, continuityReport, isFresh, summarizeFrames, varietyReport, verifyRecord } from './film-verify.mjs';
import { preflight } from './film-preflight.mjs';
import { deliveryManifest, deliveryReceipt, loudnessVerdict, parseLoudnorm, signoffVerdict } from './film-deliver.mjs';
import { assessBackground, cutoutImage } from './film-cutout.mjs';

const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * No vendored runtime.
 *
 * This plugin used to bundle an upstream CLI and spawn it for render, look and
 * the style documents. Rendering is now ours (mise-render), the contact sheet is
 * ours (mise-look), and the style documents travel in `skills/`. What remains
 * here are the two names the rest of this file still asks about: whether the
 * plugin can render at all, and which version it reports.
 */
const OPENFILM_PKG = undefined;
const OPENFILM_BIN = undefined;

/**
 * The frame grabbers, resolved by name and never by path.
 *
 * Both tools are optional: a machine without them still lists films, it just
 * cannot take a poster frame, and the panel falls back to a placeholder. The
 * environment variables let a person point at their own build; otherwise the
 * normal PATH lookup finds it, wherever it was installed.
 */
const FFMPEG_COMMAND = toolPath('ffmpeg');
const FFPROBE_COMMAND = toolPath('ffprobe');
const OPENFILM_SKILLS_DIR = join(PLUGIN_ROOT, 'skills');

/** Version, read once from this plugin's own manifest. */
const OPENFILM_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

/** ── Shared state ───────────────────────────────────────────────────────── */

/**
 * The media services `openfilm get` can draw on, named by the environment key
 * each one reads. Upstream looks these up in the child's environment, so the
 * bridge below feeds them from the harness credential store.
 */
/**
 * What each service can make, named by the environment key it reads.
 *
 * This is the ONE declaration of provider capabilities: the panel renders what
 * this map says instead of keeping its own copy, so a provider added here can
 * never show up in the panel as "capability unknown". The values are capability
 * ids the client translates; an id with no translation still renders as itself
 * rather than disappearing.
 */
const PROVIDER_CAPS = {
  ELEVENLABS_API_KEY: ['voice', 'sfx', 'music', 'transcript'],
  FAL_KEY: ['image', 'video', 'music', 'sfx'],
  GEMINI_API_KEY: ['voice', 'image', 'video', 'subtitle'],
  GROQ_API_KEY: ['voice', 'transcript'],
  OPENAI_API_KEY: ['voice', 'image', 'transcript', 'subtitle'],
  PEXELS_API_KEY: ['stock'],
  PIXABAY_API_KEY: ['stock'],
  BRAVE_API_KEY: ['search'],
  TAVILY_API_KEY: ['search'],
  // The plugin's own provider: upstream cannot generate video, so Agnes is
  // called directly and its capabilities are the two this plugin implements.
  AGNES_API_KEY: ['image', 'video'],
};

const PROVIDER_ENVS = [
  'ELEVENLABS_API_KEY',
  'FAL_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'OPENAI_API_KEY',
  'PEXELS_API_KEY',
  'PIXABAY_API_KEY',
  'BRAVE_API_KEY',
  'TAVILY_API_KEY',
  // Not an upstream OpenFilm provider: the plugin's own asset tool calls Agnes
  // directly, because upstream has no video generation at all and its `get`
  // dispatch cannot be extended. Listed here so the panel configures it in the
  // same place as the rest.
  'AGNES_API_KEY',
];

/** Everything the Agnes asset tool needs to know about one model. */
const AGNES_VIDEO_MODEL = 'agnes-video-2.5-flash';
const AGNES_IMAGE_MODEL = 'agnes-image-2.5-flash';
const AGNES_TEXT_MODEL = 'agnes-3.0-flash';
const AGNES_BASE_URL = 'https://apihub.agnes-ai.com';

/**
 * Commands the panel may trigger. `update` is deliberately absent: it installs
 * a new OpenFilm over the global one, which is a decision for a person or the
 * agent, never something a watching panel should be able to set off.
 */
const PANEL_COMMANDS = new Set(['look', 'render', 'skills', 'skill', 'manual']);
/** What the agent tool may trigger: the panel set, plus opening a project. */
const AGENT_COMMANDS = new Set([...PANEL_COMMANDS, 'open']);

/**
 * An error that carries the HTTP status the route should answer with. The panel
 * must see a refusal as a refusal: a rejected command or directory is a 4xx,
 * never a silent fall back to some other, allowed one.
 */
class HttpError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Folders a command may be pointed at, and whose files it may write.
 *
 * The roots come from the running deployment, never from a guessed install
 * location: the workspace the Host was configured with, the directory the
 * process was started in, and any film this process has already opened (a film
 * that exists is proof its folder is one we work in, wherever it is installed).
 * Nothing here assumes a particular home directory or folder layout.
 */
function workspaceRoots() {
  return [
    process.env.DSH_WORKSPACE,
    process.cwd(),
    ...[...KNOWN_PROJECTS.keys()].map((project) => dirname(project)),
  ]
    .filter((dir) => typeof dir === 'string' && dir.length > 0)
    .map((dir) => resolve(dir));
}

/** True when `dir` is one of the workspace roots or sits inside one of them. */
function withinWorkspace(dir) {
  try {
    const target = resolve(dir);
    return workspaceRoots().some((root) => target === root || target.startsWith(root + sep));
  } catch {
    return false;
  }
}

/**
 * Check one command line before it reaches the CLI.
 *
 * Two things are enforced. The command itself must be one the caller is allowed
 * to run. And any output path the CLI was handed — `render --out`, or the file
 * `capture` writes — must land inside the directory the command runs in, so a
 * panel cannot aim a render at an arbitrary place on the disk.
 * @param {readonly string[]} argv
 * @param {string} cwd
 * @param {'panel'|'agent'} caller
 * @throws {HttpError} 400 for a refused command, 403 for a path outside the project
 */
function assertRunAllowed(argv, cwd, caller) {
  const head = argv[0] ?? '';
  // A leading flag (`--version`, `--help`) asks the CLI for information and
  // writes nothing, so it is allowed by either caller.
  if (!head.startsWith('-')) {
    const allowed = caller === 'agent' ? AGENT_COMMANDS : PANEL_COMMANDS;
    if (!allowed.has(head)) {
      throw new HttpError(400, caller === 'panel'
        ? `command "${head}" cannot be run from the panel`
        : `unknown openfilm command "${head}"`);
    }
  }

  // Paths the CLI is told to write, in argv order.
  const written = [];
  const outAt = argv.indexOf('--out');
  if (outAt >= 0 && typeof argv[outAt + 1] === 'string') written.push(argv[outAt + 1]);
  if (head === 'capture' && typeof argv[2] === 'string' && !argv[2].startsWith('-')) written.push(argv[2]);

  const root = resolve(cwd);
  for (const path of written) {
    let target;
    try {
      target = resolve(root, path);
    } catch {
      throw new HttpError(400, `invalid output path ${path}`);
    }
    if (target !== root && !target.startsWith(root + sep)) {
      throw new HttpError(403, `output path ${path} is outside the project`);
    }
  }
}

/**
 * Module-level ring of what the agent has actually been doing, newest last.
 * The panel polls this so a person watching a film being made sees the same
 * execution facts the tools returned — never an invented summary.
 *
 * `records` holds plain objects that are mutated in place as a call moves from
 * `running` to its terminal state; `snapshotProgress` is what leaves this
 * module, so a reader never sees a half-written entry.
 */
const PROGRESS_LIMIT = 30;
const PROGRESS_RECORDS = [];
let PROGRESS_UPDATED_AT = Date.now();

/**
 * The directory the last mise_run ran in, for this Host process only.
 * The panel is a live view: it asks the Host where the film is right now and
 * gets an answer computed from that request, never from a remembered value.
 * @type {string | null}
 */
let lastRunCwd = null;

/**
 * Which film each session is working on, and when it was last touched. The
 * panel asks for one session's view, so a film opened in another conversation
 * cannot answer for it.
 * @type {Map<string, { path: string, lastUsedAt: number }>}
 */
const SESSION_PROJECTS = new Map();
/** Every film this process has seen, newest use first. @type {Map<string, number>} */
const KNOWN_PROJECTS = new Map();
/** The Studio address each project reported when it was opened. @type {Map<string, string>} */

/**
 * Films this plugin has actually seen, written to the harness home so a
 * restart still knows where the person's work is. Without it the panel can only
 * look under the process's own directory, and a reload shows "no films" even
 * though the films are on disk.
 *
 * Only paths that were really opened or reported are kept — nothing is guessed
 * and no install location is assumed.
 */
const PROJECTS_FILE = join(process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh'), 'openfilm-projects.json');

/** Remembered films that still exist, newest use first. @returns {Array<{ path: string, lastUsedAt: number }>} */
function loadProjectSeeds() {
  try {
    const parsed = JSON.parse(readFileSync(PROJECTS_FILE, 'utf8'));
    const list = Array.isArray(parsed?.projects) ? parsed.projects : [];
    return list
      .filter((entry) => typeof entry?.path === 'string' && existsSync(join(entry.path, 'film.html')))
      .map((entry) => ({ path: entry.path, lastUsedAt: Number(entry.lastUsedAt) || 0 }));
  } catch {
    return [];
  }
}

/** Write the films this process knows, capped so the file cannot grow forever. */
function saveProjectSeeds() {
  try {
    const projects = [...KNOWN_PROJECTS.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([path, lastUsedAt]) => ({ path, lastUsedAt }));
    mkdirSync(dirname(PROJECTS_FILE), { recursive: true });
    writeFileSync(PROJECTS_FILE, `${JSON.stringify({ version: 1, projects }, null, 2)}\n`);
  } catch {}
}

/** Note that a project was used, and by which conversation. */
function noteProject(projectPath, sessionId) {
  if (!projectPath) return;
  const at = Date.now();
  KNOWN_PROJECTS.set(projectPath, at);
  if (sessionId) {
    SESSION_PROJECTS.set(sessionId, { path: projectPath, lastUsedAt: at });
    // The conversation that made a film is written beside the film itself, so
    // a later edit request (a marked region, for instance) wakes THAT
    // conversation, not whichever one happens to be newest after a restart.
    try {
      const dir = join(projectPath, '.film');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'session.json'), `${JSON.stringify({ sessionId: String(sessionId), updatedAt: new Date().toISOString() }, null, 2)}\n`);
    } catch {}
  }
  saveProjectSeeds();
}

/**
 * The conversation that made this film, or null.
 *
 * The project's own file is authoritative; the in-memory map is a fallback for
 * a film made before the file existed.
 * @param {string} projectPath
 * @returns {string | null}
 */
function ownerSessionOf(projectPath) {
  try {
    const parsed = JSON.parse(readFileSync(join(projectPath, '.film', 'session.json'), 'utf8'));
    if (typeof parsed?.sessionId === 'string' && parsed.sessionId) return parsed.sessionId;
  } catch {}
  for (const [sessionId, entry] of SESSION_PROJECTS) {
    if (entry?.path === projectPath) return sessionId;
  }
  return null;
}

// Seed the in-memory list from the last run, so a restart starts where the
// person left off instead of with an empty panel.
for (const seed of loadProjectSeeds()) {
  if (!KNOWN_PROJECTS.has(seed.path)) KNOWN_PROJECTS.set(seed.path, seed.lastUsedAt);
}

/** The film used most recently, remembered across restarts, or null. */
function mostRecentlyUsedProject() {
  const entries = [...KNOWN_PROJECTS.entries()]
    .filter(([path]) => existsSync(join(path, 'film.html')))
    .sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? null;
}

/**
 * Begin one progress entry and return the handles the caller needs to finish it.
 * The entry is appended immediately, so a long `render` is visible as running
 * while it is still running.
 * @param {string} toolName - the tool or command that started.
 * @param {string} summary - short human-readable description of the work.
 * @param {{ sessionId?: string, projectPath?: string|null }} [scope] who did it, to which film
 * @returns {{ finish: (status: 'done'|'error', detail?: string) => void, fail: (detail: string) => void }}
 */
function beginProgress(toolName, summary, scope = {}) {
  const record = {
    startedAt: new Date().toISOString(),
    toolName,
    summary: summarizeProgress(summary),
    status: 'running',
    // A record with no session belongs to no conversation in particular; the
    // panel only hides it when it asked for one session's view.
    ...(scope.sessionId ? { sessionId: String(scope.sessionId) } : {}),
    ...(scope.projectPath ? { projectPath: scope.projectPath } : {}),
  };
  PROGRESS_RECORDS.push(record);
  // Keep only the newest PROGRESS_LIMIT entries; the oldest fall off the front.
  if (PROGRESS_RECORDS.length > PROGRESS_LIMIT) PROGRESS_RECORDS.splice(0, PROGRESS_RECORDS.length - PROGRESS_LIMIT);
  PROGRESS_UPDATED_AT = Date.now();

  const settle = (status, detail) => {
    record.status = status;
    record.finishedAt = new Date().toISOString();
    if (detail !== undefined) record.detail = summarizeProgress(detail);
    PROGRESS_UPDATED_AT = Date.now();
  };
  return {
    finish: (status, detail) => settle(status, detail),
    fail: (detail) => settle('error', detail),
    // A long task reports its own milestones (a queued video, a progress
    // percent) without ending: the entry stays `running` and keeps its place.
    update: (detail) => {
      if (record.status !== 'running') return;
      if (detail !== undefined) record.detail = summarizeProgress(detail);
      PROGRESS_UPDATED_AT = Date.now();
    },
  };
}

/** Clamp one display string so a long CLI echo cannot bloat the poll payload. */
function summarizeProgress(text) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > 80 ? `${value.slice(0, 79)}…` : value;
}

/**
 * A detached, JSON-safe view of the ring: newest first for display, plus the
 * entry currently running (null when nothing is in flight).
 * @param {string} [sessionId] when given, only that session's entries are returned
 */
function snapshotProgress(sessionId) {
  const pool = sessionId
    ? PROGRESS_RECORDS.filter((record) => record.sessionId === String(sessionId))
    : PROGRESS_RECORDS;
  const current = pool.find((record) => record.status === 'running') ?? null;
  return {
    recent: pool.slice(-PROGRESS_LIMIT).reverse().map((record) => ({ ...record })),
    current: current ? { ...current } : null,
  };
}

/** ── Credential bridge for the media services ───────────────────────────── */

/**
 * The environment for one child run: the harness process's own environment,
 * plus every media-service key the person has stored in the harness credential
 * store. A key already set in the real environment wins — the bridge adds, it
 * never overrides.
 *
 * Values are read here and handed straight to the child; they are never
 * returned, logged, or placed in any response.
 * @param {object} ctx Host context
 * @returns {Promise<Record<string, string>>}
 */
async function childEnvironment(ctx) {
  const env = {
    ...process.env,
    // The CLI is run headless; its output is all the caller needs.
    OPENFILM_NO_BROWSER: process.env.OPENFILM_NO_BROWSER ?? '1',
    // Upstream writes its docs as `npx openfilm …`; the harness has no working
    // npx here, so the printed commands name the tool that does work.
    OPENFILM_RUN: process.env.OPENFILM_RUN ?? 'mise_run',
  };
  const credentials = ctx.get?.('credentials');
  if (!credentials?.resolve) return env;
  for (const name of PROVIDER_ENVS) {
    if (typeof process.env[name] === 'string' && process.env[name].length > 0) continue;
    try {
      const resolved = await credentials.resolve(name);
      if (typeof resolved?.value === 'string' && resolved.value.length > 0) env[name] = resolved.value;
    } catch {
      // An unreadable credential is simply an unconnected service.
    }
  }
  return env;
}

/**
 * Read one provider key for a direct call this plugin makes itself (the Agnes
 * asset tool), rather than handing it to a child process.
 *
 * The value never leaves this function's caller: it is not returned in any
 * HTTP response, not logged, and not written into a progress record. The
 * launching environment wins, exactly as it does for the child-process bridge.
 * @param {object} ctx Host context
 * @param {string} name the environment-style credential name
 * @returns {Promise<string | undefined>}
 */
async function resolveProviderKey(ctx, name) {
  const fromProcess = process.env[name];
  if (typeof fromProcess === 'string' && fromProcess.trim().length > 0) return fromProcess.trim();
  const credentials = ctx.get?.('credentials');
  if (!credentials?.resolve) return undefined;
  try {
    const resolved = await credentials.resolve(name);
    const value = resolved?.value;
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Which media services are connected, for the panel to show. This uses
 * `describe`, which reports only whether a key exists and where it came from:
 * no secret value is read, returned, or logged by this path.
 * @param {object} ctx Host context
 * @returns {Promise<Array<{ env: string, configured: boolean, source: string|null }>>}
 */
async function describeProviders(ctx) {
  const credentials = ctx.get?.('credentials');
  return Promise.all(PROVIDER_ENVS.map(async (name) => {
    const caps = PROVIDER_CAPS[name] ?? [];
    const fromProcess = typeof process.env[name] === 'string' && process.env[name].length > 0;
    if (fromProcess) return { env: name, configured: true, source: 'environment', caps };
    if (!credentials?.describe) return { env: name, configured: false, source: null, caps };
    try {
      const info = await credentials.describe(name);
      return { env: name, configured: info?.configured === true, source: info?.configured ? (info.source ?? 'store') : null, caps };
    } catch {
      return { env: name, configured: false, source: null, caps };
    }
  }));
}

/**
 * Write or remove one media-service key in the harness credential store, so the
 * panel can configure `get` without a terminal or a settings page.
 *
 * The name is checked against {@link PROVIDER_ENVS} before anything else: the
 * store is shared by the whole harness and already holds Harness's own keys
 * (`QODER_MANAGED_CREDENTIAL`, bot tokens, …). Accepting an arbitrary name would
 * turn this route into a way to overwrite them, so an unknown name is refused
 * outright rather than passed through.
 *
 * The value is never echoed, logged, or written to a progress record.
 * @param {object} ctx Host context
 * @param {{ env?: unknown, value?: unknown }} body
 * @returns {Promise<{ ok: true, env: string, configured: boolean }>}
 */

/**
 * Generate media from the panel: the tool implementations behind an HTTP call.
 *
 * Shared with the tools on purpose (one implementation, two callers): a picture
 * the person makes in the panel lands in assets/ exactly like one the agent
 * makes, and every fix here fixes both. A voice line is the panel's own use —
 * it needs no key and no provider decision, which is why it is the default.
 * @param {object} ctx Host context
 * @param {{ kind?: unknown, prompt?: unknown, cwd?: unknown, voice?: unknown, hint?: unknown, seconds?: unknown, size?: unknown, text?: unknown }} body
 */
/** Wait, without a dependency. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Make one asset now, from any service the catalogue offers.
 *
 * Video is a task here too: it is created once, then only asked about until it
 * is finished. The project's metadata is the file's own ffprobe reading, never
 * the number that was requested.
 * @param {object} ctx
 * @param {object} request validated by the media service
 * @param {{ progress?: { update?: (line: string) => void }, signal?: AbortSignal }} [options]
 */
async function generateAssetNow(ctx, request, { progress, signal } = {}) {
  const { provider } = validateRequest(request);
  const apiKey = await resolveProviderKey(ctx, provider.env);
  if (!apiKey) {
    throw new Error(`${provider.env} is not configured. Store it in the film panel (服务商密钥) or in the harness credential store, then retry.`);
  }
  if (request.kind === 'image') {
    const made = await generateMediaImage({ ...request, apiKey });
    recordAsset(request.projectPath, {
      assetId: `asset-${randomUUID()}`,
      kind: 'image',
      relative: made.relative,
      bytes: made.bytes,
      provider: made.provider,
      model: made.model,
      prompt: request.prompt,
      ...(request.shotId ? { shotId: request.shotId } : {}),
      actual: made.actual,
      createdAt: new Date().toISOString(),
    });
    return { ...made, seconds: undefined };
  }

  let task = await startVideoTask({ ...request, apiKey, signal });
  progress?.update?.(`${task.provider}/${task.model}: created`);
  const deadline = Date.now() + 40 * 60 * 1000;
  while (task.phase !== 'download') {
    if (signal?.aborted) throw new Error('cancelled');
    if (Date.now() > deadline) throw new Error('the clip did not finish within 40 minutes; it was created once and is not sent again');
    await delay(5000);
    task = await advanceVideoTask(task, { apiKey, signal });
    if (task.progress) progress?.update?.(`${task.provider}: ${task.progress.phase}`);
  }
  task = await downloadVideoTask({ ...task, projectPath: request.projectPath }, { apiKey, signal });
  recordAsset(request.projectPath, {
    assetId: task.assetId,
    kind: 'video',
    relative: task.result.relative,
    bytes: task.result.bytes,
    provider: task.provider,
    model: task.model,
    prompt: task.prompt,
    ...(task.shotId ? { shotId: task.shotId } : {}),
    ...(task.firstFrame ? { firstFrame: task.firstFrame } : {}),
    ...(task.lastFrame ? { lastFrame: task.lastFrame } : {}),
    ...(task.references ? { references: task.references } : {}),
    requested: { seconds: task.seconds, aspectRatio: task.aspectRatio, generateAudio: task.generateAudio },
    actual: task.result.actual,
    createdAt: new Date().toISOString(),
  });
  return {
    provider: task.provider,
    model: task.model,
    relative: task.result.relative,
    path: join(request.projectPath, task.result.relative),
    bytes: task.result.bytes,
    seconds: task.result.seconds,
    actual: task.result.actual,
    assetId: task.assetId,
  };
}

/** Every generation request a tool or the panel can make, from one shape. */
function mediaRequestFrom(body, projectPath) {
  const kind = body?.kind === 'video' ? 'video' : 'image';
  const references = Array.isArray(body?.references) ? body.references.filter((v) => typeof v === 'string' && v.length > 0) : [];
  return {
    kind,
    provider: typeof body?.provider === 'string' && body.provider ? body.provider : 'agnes',
    ...(typeof body?.model === 'string' && body.model ? { model: body.model } : {}),
    prompt: String(body?.prompt ?? '').trim(),
    projectPath,
    // A length is named only when one was asked for: the chosen model's own
    // default is used otherwise, and Veo does not take 5 seconds.
    ...(body?.seconds !== undefined && Number.isFinite(Number(body.seconds)) ? { seconds: Number(body.seconds) } : {}),
    ...(typeof body?.aspectRatio === 'string' && body.aspectRatio ? { aspectRatio: body.aspectRatio } : {}),
    ...(typeof body?.size === 'string' && body.size ? { size: body.size } : {}),
    ...(typeof body?.firstFrame === 'string' && body.firstFrame ? { firstFrame: body.firstFrame } : {}),
    ...(typeof body?.lastFrame === 'string' && body.lastFrame ? { lastFrame: body.lastFrame } : {}),
    ...(references.length ? { references } : {}),
    ...(body?.generateAudio === true ? { generateAudio: true } : {}),
    ...(typeof body?.hint === 'string' && body.hint ? { hint: body.hint } : {}),
    ...(typeof body?.shotId === 'string' && body.shotId ? { shotId: body.shotId } : {}),
  };
}

async function generateMedia(ctx, body) {
  const kind = body?.kind === 'video' || body?.kind === 'image' || body?.kind === 'voice' ? body.kind : 'voice';
  const cwd = typeof body?.cwd === 'string' && body.cwd.length > 0 ? body.cwd : lastRunCwd ?? process.cwd();
  const projectPath = resolveProjectFrom(cwd);
  if (!projectPath) throw new HttpError(400, 'no film project around the current directory; open one first');

  if (kind === 'voice') {
    const text = typeof body?.text === 'string' ? body.text.trim() : typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    if (!text) throw new HttpError(400, 'text is required for a voice line');
    if (text.length > 4000) throw new HttpError(400, 'the line is too long (max 4000 characters)');
    // The panel goes through the same role-aware entry the tool uses, so a
    // line made here keeps the cast consistent instead of bypassing it.
    const spoken = await speakLine({
      projectPath,
      text,
      role: body?.role,
      voice: body?.voice,
      recast: body?.recast === true,
      hint: body?.hint,
      subtitles: body?.subtitles !== false,
    });
    return {
      ok: true, kind, relative: spoken.relative, seconds: spoken.seconds, voice: spoken.voice, role: spoken.role,
      ...(spoken.cues ? { cues: spoken.cues } : {}),
      ...(spoken.words ? { words: spoken.words.length } : {}),
      note: `cut into film.html as <audio src="${spoken.relative}" at="<start>"></audio>`,
    };
  }

  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) throw new HttpError(400, `prompt is required for a ${kind}`);
  const request = mediaRequestFrom({ ...body, kind }, projectPath);
  // Check the combination before spending anything: a panel that offers a
  // first frame on a model that has none must say so here, not after a POST.
  validateRequest(request);
  // A video can take minutes, so the panel queues it by default and the person
  // keeps working; the job's own file lets it resume after a restart.
  if (kind === 'video' && body?.background !== false) {
    const provider = MEDIA_CATALOG[request.provider];
    const job = enqueueMediaJob({
      projectPath,
      request,
      hint: request.hint,
      resolveKey: () => resolveProviderKey(ctx, provider.env),
    });
    return { ok: true, kind, queued: true, jobId: job.id, state: job.state, provider: job.provider, model: job.model, note: 'queued; its state is in the panel queue and in mise_asset jobId lookups' };
  }
  const result = await generateAssetNow(ctx, request);
  return {
    ok: true,
    kind,
    provider: result.provider,
    model: result.model,
    relative: result.relative,
    bytes: result.bytes,
    ...(result.seconds ? { seconds: result.seconds } : {}),
    ...(result.actual ? { actual: result.actual } : {}),
    ...(result.assetId ? { assetId: result.assetId } : {}),
  };
}

async function writeProviderCredential(ctx, body) {
  const env = typeof body?.env === 'string' ? body.env.trim() : '';
  if (!PROVIDER_ENVS.includes(env)) {
    throw new HttpError(400, `unknown provider ${env || '(none)'}; expected one of ${PROVIDER_ENVS.join(', ')}`);
  }
  const credentials = ctx.get?.('credentials');
  if (!credentials?.set || !credentials?.unset) throw new HttpError(503, 'credential store unavailable');

  const value = body?.value;
  if (value === null || value === undefined) {
    await credentials.unset(env);
    return { ok: true, env, configured: false };
  }
  if (typeof value !== 'string') throw new HttpError(400, 'value must be a string or null');
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new HttpError(400, 'value must not be empty');
  if (trimmed.length > 400) throw new HttpError(400, 'value is too long');
  // A newline or control character would corrupt the store file.
  if (/[\r\n\0]/.test(trimmed)) throw new HttpError(400, 'value must not contain line breaks');

  await credentials.set(env, trimmed);
  return { ok: true, env, configured: true };
}

/** ── Speech: what the harness itself can already do ────────────────────── */

/**
 * The speech services this composition publishes, and their real shape.
 *
 * Verified finding (2026-10-18): neither `speechController` nor `speechToText`
 * is resolvable from this plugin. `ctx.get()` returns undefined for both, and
 * declaring `speechToText` in `inject` fails activation with
 * "pending (waiting for service: speechToText)" — the service is not loaded in
 * this profile's composition at all. `speechController` is additionally a
 * `@Remote` service, reachable only across the typert protocol.
 *
 * So the harness's own transcription cannot be bridged into OpenFilm today.
 * This probe stays because it answers "why can't I transcribe" with evidence
 * rather than a guess, and it will start reporting the services the moment a
 * composition loads them.
 * @param {object} ctx Host context
 * @returns {Promise<{ available: boolean, services: object }>}
 */
async function probeSpeech(ctx) {
  const services = {};
  for (const name of ['speechController', 'speechToText']) {
    const service = ctx.get?.(name);
    if (!service) continue;
    services[name] = {
      methods: Object.getOwnPropertyNames(Object.getPrototypeOf(service))
        .filter((key) => key !== 'constructor' && typeof service[key] === 'function'),
    };
    try {
      if (typeof service.catalog === 'function') services[name].catalog = await service.catalog();
      if (typeof service.snapshot === 'function') services[name].snapshot = await service.snapshot();
      if (typeof service.listProviders === 'function') services[name].providers = await service.listProviders();
    } catch (error) {
      services[name].error = String(error?.message ?? error);
    }
  }
  return { available: Object.keys(services).length > 0, services };
}

/**
 * Run the openfilm CLI.
 * @param {readonly string[]} args argv after the bin
 * @param {{ cwd?: string, timeoutMs?: number, signal?: AbortSignal, env?: Record<string,string>, sessionId?: string }} options
 * @returns {Promise<{ exitCode: number|null, stdout: string, stderr: string, timedOut: boolean, killed: boolean, truncated: boolean }>}
 */
/**
 * The command dispatcher, with no vendored runtime behind it.
 *
 * The tools and the panel were written against `runOpenfilm(args)`, which spawned
 * the vendored CLI. That CLI is gone; every command it answered is answered here
 * instead, by Mise's own modules:
 *
 *   render [a-b]     → mise-render (headless Chromium + ffmpeg)
 *   look [t | a-b]   → mise-render stills into .film/cache/look, tiled into a sheet
 *   skills / skill   → ./skills (our copy of the style documents)
 *   manual           → ./skills/MANUAL.md
 *   open <name>      → film-new: a project that renders before it is written into
 *
 * The return shape is unchanged ({ exitCode, stdout, stderr, timedOut, killed }),
 * so every existing caller keeps working.
 *
 * @param {string[]} args
 * @param {{ cwd?: string, sessionId?: string, timeoutMs?: number, signal?: { aborted: boolean } }} [options]
 */
async function runOpenfilm(args, options = {}) {
  const command = Array.isArray(args) ? args[0] : undefined;
  const rest = Array.isArray(args) ? args.slice(1) : [];
  const cwd = options.cwd && existsSync(options.cwd) ? options.cwd : process.cwd();
  // Remember where a real command ran, and which film it belongs to, so the panel
  // can answer for this session rather than for some other one.
  lastRunCwd = cwd;
  noteProject(resolveProjectFrom(cwd), options.sessionId);

  const ok = (stdout) => ({ exitCode: 0, stdout, stderr: '', timedOut: false, killed: false });
  const fail = (message) => ({ exitCode: 1, stdout: '', stderr: message, timedOut: false, killed: false });

  try {
    if (command === 'render') {
      const projectPath = resolveProjectFrom(cwd) ?? cwd;
      const range = typeof rest[0] === 'string' ? rest[0] : '';
      if (range && /^\d+(\.\d+)?-\d+(\.\d+)?$/.test(range)) {
        return fail('range renders were provided by the vendored runtime; use mise_render and cut the file with ffmpeg');
      }
      const result = await renderFilm({ projectDir: projectPath, ...(range && /^\d/.test(range) ? {} : {}) });
      return ok(`→ ${relative(projectPath, result.out)}\n${result.frames} frames · ${result.seconds}s`);
    }

    if (command === 'look') {
      const projectPath = resolveProjectFrom(cwd) ?? cwd;
      const storyboard = describeStoryboard(projectPath);
      const asked = typeof rest[0] === 'string' && rest[0] ? Number(rest[0]) : null;
      const times = Number.isFinite(asked) && asked !== null
        ? [asked]
        : (storyboard.beats ?? [])
          .filter((beat) => beat.length > 0 && !/^join-/.test(String(beat.page ?? '')))
          .map((beat) => Number((beat.at + beat.length / 2).toFixed(2)));
      if (!times.length) return fail('the film has no shots to look at');

      const lookDir = join(projectPath, '.film', 'cache', 'look');
      mkdirSync(lookDir, { recursive: true });
      const grabbed = await grabFrames({ projectDir: projectPath, times, width: 640 });
      // The panel expects one still per time, named "<t>s.png".
      const written = [];
      for (const [index, thumb] of grabbed.thumbs.entries()) {
        const name = `${times[index]}s.png`;
        copyFileSync(thumb.file, join(lookDir, name));
        written.push(name);
      }
      const sheet = await tileSheet({
        files: grabbed.thumbs.map((thumb) => thumb.file),
        out: join(lookDir, 'contact-sheet.png'),
        cols: 3,
        cellWidth: 640,
      });
      return ok(`→ ${written.map((name) => `.film/cache/look/${name}`).join('\n→ ')}\nsheet: .film/cache/look/contact-sheet.png (${sheet.files} frames)`);
    }

    if (command === 'skills') {
      const names = readdirSync(join(PLUGIN_ROOT, 'skills'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      return ok(names.join('\n'));
    }

    if (command === 'skill') {
      const name = String(rest[0] ?? '').trim();
      if (!name) return fail('skill needs a name; run "skills" for the list');
      const dir = join(PLUGIN_ROOT, 'skills', name);
      if (!existsSync(dir)) return fail(`no skill named ${name}`);
      const files = readdirSync(dir).filter((file) => file.toLowerCase().endsWith('.md'));
      const body = files.map((file) => readFileSync(join(dir, file), 'utf8')).join('\n\n');
      return ok(body || `skill ${name} has no markdown`);
    }

    if (command === 'manual' || command === undefined) {
      const manual = join(PLUGIN_ROOT, 'skills', 'MANUAL.md');
      return existsSync(manual) ? ok(readFileSync(manual, 'utf8')) : fail('the manual is missing');
    }

    if (command === 'open') {
      const name = String(rest[0] ?? '').trim().replace(/[^A-Za-z0-9._-]+/g, '-');
      if (!name) return fail('open needs a folder name');
      const projectPath = resolve(cwd, name);
      const made = await newFilm({ projectPath, title: name });
      if (!made.ok) return fail(String(made.error ?? 'could not create the project'));
      return ok(`project ${projectPath}`);
    }

    return fail(`"${command ?? ''}" was a command of the vendored runtime, which this plugin no longer bundles. ` +
      'Use mise_render, mise_look, mise_thumbs, mise_compose or mise_promo instead.');
  } catch (error) {
    return fail(String(error?.message ?? error));
  }
}

/**
 * Resolve a session id to the directory that session works in.
 *
 * A browser panel has no Agent object; it knows only its session id. The
 * service exposes `get(session)`, and a Session is reachable from the Host's
 * session registry, so the id is enough. Anything unresolvable answers
 * undefined — the caller then falls back to its other roots rather than
 * inventing a directory.
 * @param {object} ctx Host context
 * @param {string} [sessionId]
 * @returns {string | undefined}
 */
function sessionDirectoryById(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined;
  try {
    const wd = ctx.get?.('workingDirectory');
    if (!wd?.get) return undefined;
    const sessions = ctx.get?.('sessions');
    const session = sessions?.get?.(sessionId) ?? sessions?.byId?.(sessionId);
    if (!session) return undefined;
    const dir = wd.get(session);
    return typeof dir === 'string' && dir.length > 0 ? dir : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The directory a tool should work in: the agent's own session when a call has
 * one, otherwise the newest live session, otherwise the process directory.
 *
 * @param {object} ctx Host context
 * @param {{ id?: string, header?: { cwd?: string } }} [agent]
 * @returns {Promise<string>}
 */
async function sessionCwd(ctx, agent) {
  const fromAgent = typeof agent?.header?.cwd === 'string' && agent.header.cwd
    ? agent.header.cwd
    : sessionDirectoryById(ctx, typeof agent?.id === 'string' ? agent.id : undefined);
  if (fromAgent) return fromAgent;
  return newestSessionDirectory(ctx) ?? process.cwd();
}

/**
 * The directory of the most recently created live session.
 *
 * A panel is not bound to a session (the `main` slot binds only the reserved
 * conversation key), so it cannot always say which session it belongs to. The
 * Host can still answer for itself: every live session records its own `cwd` in
 * its header, and the newest one is the conversation the person is looking at.
 * A fallback of last resort — an explicit request directory or session id wins.
 * @param {object} ctx Host context
 * @returns {string | undefined}
 */
function newestSessionDirectory(ctx) {
  try {
    const sessions = ctx.get?.('sessions');
    const list = sessions?.list?.();
    if (!Array.isArray(list) || list.length === 0) return undefined;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const cwd = list[i]?.header?.cwd;
      if (typeof cwd === 'string' && cwd.length > 0) return cwd;
    }
  } catch {}
  return undefined;
}

/**
 * Rewrite upstream's own command examples for this harness.
 *
 * OpenFilm writes its manual and skill files as `npx openfilm …`, which is how
 * it expects a terminal agent to call it. Here there is no working npx (the npm
 * cache on this machine is not writable), and the real entry point is the
 * `mise_run` tool, so every copy the model reads is rewritten in one place.
 * @param {string} text
 * @returns {string}
 */
function harnessize(text) {
  return String(text ?? '')
    .replace(/npx -y openfilm@latest/g, 'mise_run')
    .replace(/npx openfilm/g, 'mise_run');
}

/** ── HTTP routes for the client half ───────────────────────────────────── */

/** The host's own request gate, when the composition publishes one (from session-manager). */
function requestRejection(ctx, request) {
  try {
    const connection = ctx.get?.('connection');
    const rejection = connection?.requestRejection?.(request);
    return typeof rejection === 'number' ? rejection : undefined;
  } catch {
    return 403;
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

/** ── Finding the film that exists right now ───────────────────────────── */

/** How deep the disk search may go, and how many folders it may visit. */
const SCAN_MAX_DEPTH = 3;
const SCAN_MAX_DIRS = 400;
/** Folders a scan must never descend into. */
const SCAN_SKIP = new Set(['node_modules', '.git', 'vendor', '.film', '.cache', 'AppData', 'Windows', 'Program Files']);

/**
 * The folders this harness actually works in, recovered from its own session
 * store (`<DSH_HOME>/sessions/<encoded-workspace>/<session>/…`).
 *
 * The plugin process does not run in the person's folder, so without this a
 * fresh panel has nothing to look under and reports "no films" while the films
 * sit on disk. Only an entry that decodes to a folder that exists is used; an
 * unfamiliar layout decodes to a path that does not exist and is ignored, so a
 * change in that layout degrades to the old behaviour instead of pointing
 * somewhere wrong.
 * @returns {string[]}
 */
function sessionWorkspaceRoots() {
  const home = process.env.DSH_HOME;
  if (typeof home !== 'string' || home.length === 0) return [];
  const sessions = join(home, 'sessions');
  const roots = [];
  try {
    for (const name of readdirSync(sessions, { withFileTypes: true })) {
      if (!entry_isDirectory(name)) continue;
      const decoded = decodeSessionFolder(name.name);
      if (decoded && existsSync(decoded) && !roots.includes(decoded)) roots.push(decoded);
    }
  } catch {}
  return roots;
}

/** A Dirent check that also answers for a plain name. */
function entry_isDirectory(entry) {
  return typeof entry?.isDirectory === 'function' ? entry.isDirectory() : false;
}

/**
 * `--D-5-~65B0~5EFA~6587~4EF6~5939--` → `D:\5\新建文件夹`.
 * The layout is DSH's own: `--`, the path with separators as `-`, and any
 * non-ASCII character written as `~<hex code point>~`.
 * @param {string} name
 * @returns {string | null}
 */
function decodeSessionFolder(name) {
  const match = /^--(.*)--$/.exec(name);
  if (!match) return null;
  const parts = match[1].split('-');
  if (parts.length < 2 || parts[0].length !== 1) return null;
  const segments = [`${parts[0]}:`];
  for (const part of parts.slice(1)) {
    if (!part) return null;
    segments.push(part.replace(/~([0-9A-Fa-f]{1,6})~/g, (_whole, hex) => String.fromCodePoint(parseInt(hex, 16))));
  }
  return segments.join('\\');
}

/**
 * Every film project under the roots people actually work in, newest first.
 *
 * This is what makes the panel live rather than remembered: it reads the
 * filesystem at the moment the panel asks, so a film created seconds ago is
 * found and a deleted one is not. Listing them all, rather than only the
 * newest, is what lets a person with several films pick one.
 * @returns {Array<{ path: string, lastUsedAt: number }>}
 */
function scanProjects(extraRoots = []) {
  const roots = [
    ...extraRoots,
    process.cwd(),
    process.env.DSH_WORKSPACE,
    // The folders this harness has sessions in: the person's real workspace.
    ...sessionWorkspaceRoots(),
    // A film this process already opened proves its folder is a real place we
    // work in, so its parent is a legitimate root — no fixed install path is
    // assumed anywhere here.
    ...[...KNOWN_PROJECTS.keys()].map((project) => dirname(project)),
  ].filter((dir) => typeof dir === 'string' && dir.length > 0 && existsSync(dir));

  const found = new Map();
  let visited = 0;
  const queue = roots.map((dir) => ({ dir: resolve(dir), depth: 0 }));

  while (queue.length > 0 && visited < SCAN_MAX_DIRS) {
    const { dir, depth } = queue.shift();
    visited += 1;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name === 'film.html') {
          try { found.set(dir, statSync(join(dir, 'film.html')).mtimeMs); } catch {}
          continue;
        }
        if (!entry.isDirectory() || depth >= SCAN_MAX_DEPTH) continue;
        if (entry.name.startsWith('.') || SCAN_SKIP.has(entry.name)) continue;
        queue.push({ dir: join(dir, entry.name), depth: depth + 1 });
      }
    } catch {
      // An unreadable folder just ends that branch of the walk.
    }
  }
  return [...found.entries()].map(([path, lastUsedAt]) => ({ path, lastUsedAt }));
}

/** The newest film project on disk, used only when nothing better is known. */
function newestProjectOnDisk() {
  return scanProjects()[0]?.path ?? null;
}

/**
 * The newest film that lives inside one named folder, or null.
 *
 * A workspace folder is usually not itself a film, it holds films. Choosing the
 * newest film inside the session's own folder is what keeps the panel pointed at
 * the person's work instead of whichever film is newest on the whole disk.
 * @param {string | undefined} dir
 * @returns {string | null}
 */
function newestProjectIn(dir) {
  if (typeof dir !== 'string' || dir.length === 0) return null;
  try {
    if (!existsSync(dir)) return null;
    // A film this session has already acted on wins over one that merely has a
    // newer file: the person is working on the former.
    const known = [...KNOWN_PROJECTS.entries()]
      .filter(([path]) => path === resolve(dir) || path.startsWith(resolve(dir) + sep))
      .sort((a, b) => b[1] - a[1])[0];
    if (known) return known[0];
    return scanProjects([dir])[0]?.path ?? null;
  } catch {
    return null;
  }
}

/**
 * A poster image for one rendered film, or null when none can be had.
 *
 * Three sources, cheapest and best first:
 *  1. the film's own contact sheet that `look` already drew — it is literally
 *     the film's picture, already on disk, and needs no work;
 *  2. a frame of the video, taken by `ffmpeg` and cached under the film's own
 *     `.film/cache` folder, so the cost is paid once per render;
 *  3. nothing, when `ffmpeg` is not installed — the panel then draws a labelled
 *     placeholder rather than a broken image.
 *
 * The returned URL always goes through the project-rooted media route, so the
 * panel can never read a file outside the film it belongs to.
 * @param {string} projectPath
 * @param {string} file the .mp4's file name
 * @param {string} full absolute path of the mp4
 * @param {number} stamp the mp4's mtime, for cache busting
 * @returns {string | null}
 */
function posterFor(projectPath, file, full, stamp) {
  const mediaRoute = (relative, version) =>
    `/mise/file?p=${encodeURIComponent(relative.split(sep).join('/'))}&cwd=${encodeURIComponent(projectPath)}&v=${version}`;
  try {
    // 1. The contact sheet `look` drew for this film, newest first.
    const lookDir = join(projectPath, '.film', 'cache', 'look');
    if (existsSync(lookDir)) {
      const newest = readdirSync(lookDir)
        .filter((name) => /\.png$/i.test(name))
        .map((name) => {
          try { return { name, at: statSync(join(lookDir, name)).mtimeMs }; } catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => b.at - a.at)[0];
      if (newest) return mediaRoute(`${join('.film', 'cache', 'look', newest.name)}`, Math.round(newest.at));
    }
    // 2. A frame of the video, cached beside it. The cache key carries the
    //    video's mtime, so a re-render produces a new poster.
    const cacheDir = join(projectPath, '.film', 'cache', 'poster');
    const poster = join(cacheDir, `${file.replace(/\.mp4$/i, '')}-${stamp}.jpg`);
    if (existsSync(poster)) return mediaRoute(`${join('.film', 'cache', 'poster', `${file.replace(/\.mp4$/i, '')}-${stamp}.jpg`)}`, stamp);
    mkdirSync(cacheDir, { recursive: true });
    // 10% in, where a film usually already has its picture, rather than the
    // black first frame.
    const probe = probeVideoDuration(full);
    const at = probe && probe > 0 ? Math.min(probe * 0.1, 3) : 1;
    const done = spawnSync(FFMPEG_COMMAND, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', at.toFixed(3), '-i', full,
      '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', poster,
    ], { timeout: 20_000, windowsHide: true });
    if (done?.status === 0 && existsSync(poster)) return mediaRoute(`${join('.film', 'cache', 'poster', `${file.replace(/\.mp4$/i, '')}-${stamp}.jpg`)}`, stamp);
  } catch {}
  return null;
}

/**
 * A video's length in seconds, or null.
 *
 * `ffprobe` is the exact answer. It is optional: an installation without it
 * simply gets a fixed poster offset instead of an early frame.
 * @param {string} file
 * @returns {number | null}
 */
function probeVideoDuration(file) {
  try {
    const out = spawnSync(FFPROBE_COMMAND, [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
    ], { timeout: 10_000, windowsHide: true, encoding: 'utf8' });
    const seconds = Number(String(out?.stdout ?? '').trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

/** List rendered films for the sidebar library. *
 * The roots matter: a plugin process does not necessarily run in the folder the
 * person is working in, and a film made in that folder would then be invisible
 * even though every other route knows it. So the search starts from the folders
 * this request actually names — the panel's own directory, the film this
 * session is on, the film the last run touched, and every film this process has
 * opened — and only then falls back to the process's own defaults. */
function describeLibrary(query = {}) {
  const sessionProject = query.sessionId ? SESSION_PROJECTS.get(query.sessionId)?.path : undefined;
  const namedCwd = typeof query.cwd === 'string' && query.cwd.length > 0 ? query.cwd : undefined;
  const named = [
    // The directory itself is a scan root, not only the film around it: a
    // workspace folder usually holds several films and is itself no film.
    namedCwd,
    resolveProjectFrom(namedCwd),
    query.workspace,
    resolveProjectFrom(sessionProject),
    resolveProjectFrom(lastRunCwd),
    ...KNOWN_PROJECTS.keys(),
  ].filter((dir) => typeof dir === 'string' && dir.length > 0);
  const out = [];
  for (const project of scanProjects(named)) {
    let entries = [];
    try { entries = readdirSync(project.path); } catch { continue; }
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.mp4')) continue;
      const full = join(project.path, entry);
      try {
        const st = statSync(full);
        if (!st.isFile()) continue;
        const stamp = Math.round(st.mtimeMs);
        const projectName = project.path.split(/[\\/]/).filter(Boolean).pop() ?? project.path;
        const fileUrl = `/mise/file?p=${encodeURIComponent(entry.split(sep).join('/'))}&cwd=${encodeURIComponent(project.path)}&v=${stamp}`;
        out.push({
          id: `${project.path}\\0${entry}`,
          name: entry.replace(/\.mp4$/i, ''),
          file: entry,
          project: projectName,
          projectPath: project.path,
          bytes: st.size,
          updatedAt: st.mtimeMs,
          url: fileUrl,
          // A card without a picture makes a person guess which film it is. The
          // poster is the film's own contact sheet when one exists (the same
          // picture the panel already shows), else a frame taken from the video
          // itself, else absent — the panel then draws a labelled placeholder.
          poster: posterFor(project.path, entry, full, stamp),
        });
      } catch {}
    }
  }
  const q = typeof query.q === 'string' ? query.q.trim().toLocaleLowerCase() : '';
  const filtered = q ? out.filter((x) => `${x.name} ${x.project}`.toLocaleLowerCase().includes(q)) : out;
  const sort = query.sort || 'updated';
  filtered.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'size' ? b.bytes - a.bytes : sort === 'oldest' ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt);
  return { ok: true, films: filtered.slice(0, 100), total: filtered.length };
}

/** Bounded JSON body reader for the small run payloads the panel posts. */
async function readJsonBody(request) {
  if (typeof request?.[Symbol.asyncIterator] !== 'function') return {};
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('request-body-too-large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Describe the OpenFilm install and the film project as of this exact request.
 *
 * The project is chosen in a fixed order, most specific first: the directory
 * the caller named, then the film this session was last working on, then the
 * film the most recent run touched, and only then the newest film on disk. The
 * first two matter because a person with several films open must not be shown
 * whichever one happens to have the newest file.
 * @param {object} ctx Host context
 * @param {{ cwd?: string, sessionId?: string }} [query]
 */
async function describeStatus(ctx, query = {}) {
  const started = Date.now();
  const sessionId = query.sessionId ? String(query.sessionId) : undefined;
  const sessionProject = sessionId ? SESSION_PROJECTS.get(sessionId)?.path : undefined;
  // The session's own directory, when the browser did not name one: a panel
  // opened in a workspace must show that workspace's films even when this
  // process was not started there.
  const sessionDir = query.cwd
    ? undefined
    : sessionDirectoryById(ctx, sessionId) ?? newestSessionDirectory(ctx);
  const projectPath = resolveProjectFrom(query.cwd)
    ?? resolveProjectFrom(sessionDir)
    ?? resolveProjectFrom(sessionProject)
    ?? resolveProjectFrom(lastRunCwd)
    // A workspace folder is usually not itself a film: it holds films. In that
    // case the newest film inside the session's own directory is the one the
    // panel should show, rather than an unrelated newest film on the disk.
    ?? newestProjectIn(sessionDir)
    // Nothing names a film: continue with the one used last, remembered across
    // restarts, rather than whichever file happens to be newest on disk.
    ?? mostRecentlyUsedProject()
    ?? newestProjectOnDisk();
  if (projectPath) noteProject(projectPath, sessionId);

  // Every film known to this process plus every film on disk, newest use first.
  const scanned = scanProjects([query.cwd, sessionDir, resolveProjectFrom(sessionDir)].filter(Boolean));
  const byPath = new Map(scanned.map((entry) => [entry.path, entry.lastUsedAt]));
  for (const [path, at] of KNOWN_PROJECTS) if (!byPath.has(path) || byPath.get(path) < at) byPath.set(path, Math.max(byPath.get(path) ?? 0, at));
  const projects = [...byPath.entries()]
    .map(([path, lastUsedAt]) => ({ path, lastUsedAt }))
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);

  return {
    ok: true,
    installed: true,
    version: OPENFILM_VERSION,
    project: projectPath ? { path: projectPath, inProject: true } : null,
    projects,
    // No web Studio address: the panel edits the film itself.
    styles: OFFICIAL_SKILL_NAMES,
    // Which media services can be used. Names and presence only — a value is
    // never read through this path.
    providers: await describeProviders(ctx),
    // The real picture, not a description of it: what `look` last drew and
    // what `render` last exported.
    ...describePreview(projectPath),
    // The shot list the panel edits against, instead of a separate Studio.
    storyboard: describeStoryboard(projectPath),
    // The last delivery and what it changed: the panel's 对比 view.
    delivery: describeDelivery(projectPath),
    // Which media services can make what, with the models and the combinations
    // each accepts. Key presence only: a value never travels through here.
    media: await describeMediaCapabilities((env) => resolveProviderKey(ctx, env).then((key) => Boolean(key))),
    // What the agent has actually been doing, newest first.
    progress: snapshotProgress(sessionId),
    // Background video jobs. They survive a restart: each one is a file under
    // .film/media-jobs/ with the service's own task id, so it resumes instead
    // of sending the request again.
    queue: {
      jobs: listJobs(projectPath ?? undefined),
      pending: hasPendingJobs(),
      persistent: true,
    },
    checkedAt: started,
  };
}

/**
 * The film's own storyboard, for the panel to edit against.
 *
 * The web Studio was the only place a shot list was visible, which meant the
 * panel depended on a second server being started. The plan already knows every
 * shot's kind, length, camera move and claim — this hands that to the sidebar so
 * the person can pick a shot, draw it, and render, without leaving.
 * @param {string|null} projectPath
 */
/**
 * The last delivery, as the panel needs it: what was produced and which shots
 * changed compared with the delivery before it.
 *
 * @param {string|null} projectPath
 */
function describeDelivery(projectPath) {
  if (!projectPath) return null;
  try {
    const record = JSON.parse(readFileSync(join(projectPath, '.film', 'delivery.json'), 'utf8'));
    return {
      output: String(record?.output ?? ''),
      at: String(record?.at ?? ''),
      ok: record?.ok === true,
      loudness: record?.loudness ?? null,
      gate: record?.gate ? { ok: record.gate.ok === true, blockers: record.gate.blockers ?? [] } : null,
      changes: Array.isArray(record?.changes) ? record.changes.slice(0, 6) : [],
    };
  } catch {
    return null;
  }
}

function describeStoryboard(projectPath) {
  if (!projectPath) return { beats: [], plan: null, frames: [], duration: 0 };
  let plan = null;
  try { plan = JSON.parse(readFileSync(join(projectPath, '.film', 'plan.json'), 'utf8')); } catch { plan = null; }
  // The shot track in film.html is the truth: it is what the panel edits and
  // what the renderer plays. The plan only supplies the labels for each shot.
  let filmShots = [];
  try {
    filmShots = describeShots(readFileSync(join(projectPath, 'film.html'), 'utf8'));
  } catch { filmShots = []; }
  const planBeats = Array.isArray(plan?.beats) ? plan.beats : [];
  // The timeline's stills: taken by mise_thumbs from the film itself, so each
  // chip shows the frame the shot really opens on.
  const thumbDir = join(projectPath, '.film', 'thumbs');
  const thumbFor = (shotIndex) => {
    const name = `shot-${String(shotIndex).padStart(2, '0')}.small.png`;
    if (!existsSync(join(thumbDir, name))) return null;
    // Same contract as the preview picture: the file route needs to know which
    // film, and the path must be URL-shaped on every platform.
    return `/mise/file?p=${encodeURIComponent(`.film/thumbs/${name}`)}&cwd=${encodeURIComponent(projectPath)}`;
  };
  const beats = (filmShots.length ? filmShots : planBeats).map((shot, index) => {
    // Pair by page name ("02-scene.html" is beat 2) so a reordered film keeps
    // each shot's kind and claim with the picture it belongs to.
    const numberMatch = /^(\d+)/.exec(String(shot.page ?? ''));
    // A join clip and a text page both start with a number, so the page file is
    // the pairing the plan recorded; the number is only the fallback.
    const planned = planBeats.find((beat) => String(beat.page ?? '') === String(shot.page ?? ''))
      ?? (numberMatch ? planBeats.find((beat) => beat.index === Number(numberMatch[1])) : null);
    const length = filmShots.length ? shot.length : Number(planBeats[index]?.length ?? 0);
    const at = filmShots.length ? shot.at : Number(planBeats[index]?.at ?? 0);
    return {
      index: filmShots.length ? shot.index : (planned?.index ?? index + 1),
      page: String(shot.page ?? ''),
      kind: String(planned?.kind ?? ''),
      at: Number(at ?? 0),
      length: Number(length ?? 0),
      move: String(planned?.move ?? 'still'),
      thumb: thumbFor(filmShots.length ? shot.index : (planned?.index ?? index + 1)),
      ...(planned?.claim ? { claim: String(planned.claim.text ?? '') } : {}),
    };
  });
  // Which times have already been drawn: a shot with a picture needs no redraw.
  let frames = [];
  const lookDir = join(projectPath, '.film', 'cache', 'look');
  try {
    frames = readdirSync(lookDir)
      .filter((name) => /^\d+(\.\d+)?s\.png$/.test(name))
      .map((name) => Number(name.replace('s.png', '')))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  } catch { frames = []; }
  return {
    beats,
    plan: plan ? { genre: plan.genre, seconds: plan.seconds, pacing: plan.pacing, transition: plan.transition, grade: plan.grade } : null,
    frames,
    duration: Number(beats.reduce((total, beat) => total + beat.length, 0).toFixed(2)),
  };
}

/** The lightweight poll entry: progress only, so a panel can poll it often. */
function describeProgress(sessionId) {
  return { progress: snapshotProgress(sessionId), updatedAt: PROGRESS_UPDATED_AT };
}

/**
 * The picture the panel shows: the newest contact sheet `look` drew, and the
 * newest rendered video. These are the artefacts the person actually wants to
 * see, so they are served straight from the project's own cache rather than
 * described in words.
 * @param {string | null} projectPath the film project, or null when there is none
 * @returns {{ previewUrl: string|null, videoUrl: string|null, previewUpdatedAt: number }}
 */
function describePreview(projectPath) {
  if (!projectPath) return { previewUrl: null, videoUrl: null, previewUpdatedAt: 0 };
  try {
    // `look` writes .film/cache/look/*.png; the newest one is the current picture.
    const lookDir = join(projectPath, '.film', 'cache', 'look');
    let previewFile = null;
    let previewUpdatedAt = 0;
    if (existsSync(lookDir)) {
      for (const entry of readdirSync(lookDir)) {
        if (!entry.toLowerCase().endsWith('.png')) continue;
        const full = join(lookDir, entry);
        try {
          const mtime = statSync(full).mtimeMs;
          if (mtime > previewUpdatedAt) { previewUpdatedAt = mtime; previewFile = entry; }
        } catch {}
      }
    }
    // `render` writes <project>/<folder>.mp4 beside film.html.
    let videoFile = null;
    let videoUpdatedAt = 0;
    try {
      for (const entry of readdirSync(projectPath)) {
        if (!entry.toLowerCase().endsWith('.mp4')) continue;
        const full = join(projectPath, entry);
        try {
          const mtime = statSync(full).mtimeMs;
          if (mtime > videoUpdatedAt) { videoUpdatedAt = mtime; videoFile = entry; }
        } catch {}
      }
    } catch {}

    const stamp = (ms) => (ms ? `&v=${Math.round(ms)}` : '');
    // URL paths use forward slashes on every platform: a Windows `\` would be
    // percent-encoded and is not a valid path separator in a URL.
    const asUrlPath = (relative) => relative.split(sep).join('/');
    // `cwd` travels with the file request: without it the route can only guess
    // which film is meant, and with several projects on disk it guessed another
    // one — the picture then 404s even though it exists.
    const project = `&cwd=${encodeURIComponent(projectPath)}`;
    return {
      previewUrl: previewFile ? `/mise/file?p=${encodeURIComponent(asUrlPath(join('.film', 'cache', 'look', previewFile)))}${project}${stamp(previewUpdatedAt)}` : null,
      videoUrl: videoFile ? `/mise/file?p=${encodeURIComponent(asUrlPath(videoFile))}${project}${stamp(videoUpdatedAt)}` : null,
      previewUpdatedAt,
    };
  } catch {
    return { previewUrl: null, videoUrl: null, previewUpdatedAt: 0 };
  }
}

/**
 * Copy the motion kit into a film project.
 *
 * Shot pages import `of-motion.mjs` with a relative path, and the kit lives in
 * this plugin's own vendor directory — which is not on a page's resolution
 * path. So `open` (and `mise_new`) copy it into the project root, where the
 * relative import works. A version marker keeps an older copy in a project from
 * shadowing a newer one: the file is refreshed when the marker differs.
 *
 * Failures are swallowed on purpose: a project that cannot take the copy is
 * still a project, and `mise_check` reports the missing kit.
 * @param {string | null} projectPath
 */
function copyMotionKit(projectPath) {
  if (!projectPath) return;
  try {
    const source = join(PLUGIN_ROOT, 'vendor', 'motion', 'of-motion.mjs');
    if (!existsSync(source)) return;
    const target = join(projectPath, 'of-motion.mjs');
    const marker = (text) => (/^ \* @of-motion v(\S+)/m.exec(text)?.[1] ?? null);
    const wanted = marker(readFileSync(source, 'utf8'));
    if (!(existsSync(target) && marker(readFileSync(target, 'utf8')) === wanted)) {
      mkdirSync(projectPath, { recursive: true });
      writeFileSync(target, readFileSync(source));
    }
  } catch {}
  copyRiveRuntime(projectPath);
}

/**
 * Copy the vendored Rive runtime into a film project as `vendor-rive/`.
 *
 * A Rive shot page loads `./vendor-rive/rive.js` and its `.wasm`, the same way
 * it loads the motion kit: the plugin's vendor directory is not on a page's
 * resolution path, so `open` puts it where the relative path works. The files
 * change only when the plugin does, so a size-and-name check skips a copy that
 * is already there — 4.6 MB is worth not rewriting on every open.
 * @param {string | null} projectPath
 */
function copyRiveRuntime(projectPath) {
  if (!projectPath) return;
  try {
    const source = join(PLUGIN_ROOT, 'vendor', 'rive');
    if (!existsSync(join(source, 'rive.js'))) return;
    const target = join(projectPath, 'vendor-rive');
    const same = (name) => {
      const a = join(source, name);
      const b = join(target, name);
      return existsSync(a) && existsSync(b) && statSync(a).size === statSync(b).size;
    };
    if (same('rive.js') && same('rive.wasm') && same('rive_fallback.wasm')) return;
    mkdirSync(target, { recursive: true });
    for (const name of ['rive.js', 'rive.wasm', 'rive_fallback.wasm']) {
      const from = join(source, name);
      if (existsSync(from)) writeFileSync(join(target, name), readFileSync(from));
    }
  } catch {}
}

/**
 * Resolve the film project the way look/render do: the folder around the given
 * directory (or the Host's own) that holds film.html.
 * @param {string | undefined} from
 * @returns {string | null}
 */
function resolveProjectFrom(from) {
  try {
    let dir = from ? resolve(from) : process.cwd();
    for (;;) {
      if (existsSync(join(dir, 'film.html'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  } catch {
    return null;
  }
}

/** ── Serving the film's own picture ─────────────────────────────────────── */

const CONTENT_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4' };

/**
 * Write one image or video out of the film project's own cache. The panel is
 * the only caller, and it may only ask for a file inside that project: the
 * requested relative path is resolved and then checked against the project
 * root, so `..` cannot escape it and this route can never read an arbitrary
 * file from the machine.
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @returns {boolean} true when the response was written here
 */
function sendFile(ctx, request, response) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const relative = url.searchParams.get('p') ?? '';
  const requested = url.searchParams.get('cwd');
  const session = url.searchParams.get('session');
  const sessionProject = session ? SESSION_PROJECTS.get(session)?.path : undefined;
  if (typeof relative !== 'string' || relative.length === 0) { sendJson(response, 400, { ok: false, error: 'p is required' }); return true; }

  // Candidate films, best first: the one the request names, then this session's,
  // then the last one a run touched, then every film this process has opened,
  // then every film found under the workspace, then the newest on disk. The
  // requested file decides which candidate serves it, so a stale or missing
  // `cwd` cannot make an existing picture 404.
  let scanned = [];
  try { scanned = scanProjects(workspaceRoots()).map((entry) => entry.path); } catch { scanned = []; }
  const candidates = [
    requested,
    sessionProject,
    lastRunCwd,
    ...[...KNOWN_PROJECTS.keys()],
    ...scanned,
    newestProjectOnDisk(),
  ]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .map((value) => resolveProjectFrom(value))
    .filter(Boolean);
  const unique = [...new Set(candidates)];
  if (unique.length === 0) { sendJson(response, 404, { ok: false, error: 'not a film project' }); return true; }

  const type = CONTENT_TYPES[extname(relative).toLowerCase()];
  if (!type) { sendJson(response, 415, { ok: false, error: 'unsupported media type' }); return true; }

  for (const project of unique) {
    const root = resolve(project);
    const target = resolve(root, relative);
    // Containment: the resolved file must stay inside the film project.
    if (target !== root && !target.startsWith(root + sep)) continue;
    try {
      if (!statSync(target).isFile()) continue;
      const bytes = readFileSync(target);
      response.writeHead(200, {
        'content-type': type,
        'content-length': bytes.length,
        // The panel appends the file's mtime, so a re-render is fetched fresh.
        'cache-control': 'no-cache',
      });
      response.end(bytes);
      return true;
    } catch {
      // Try the next candidate rather than failing on the first guess.
    }
  }
  sendJson(response, 404, { ok: false, error: `no such file in any film project: ${relative}` });
  return true;
}

/* ── A region the person marked in the panel ───────────────────────────── */

/** The frame of the film at `time`, cropped to the marked region. */
function cropFrame(projectPath, time, rect, stage, dir, id) {
  const root = resolve(projectPath);
  let video = null;
  try {
    for (const entry of readdirSync(root)) {
      if (entry.toLowerCase().endsWith('.mp4')) { video = join(root, entry); break; }
    }
  } catch {}
  if (!video) return { frame: null, crop: null, note: 'no rendered mp4 yet, so only the rectangle and your words were passed on' };
  const frame = join(dir, `${id}-frame.png`);
  const crop = join(dir, `${id}-crop.png`);
  const ff = toolPath('ffmpeg');
  const run = (args) => spawnSync(ff, args, { encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  const grabbed = run(['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, time)), '-i', video, '-frames:v', '1', frame]);
  if (grabbed.status !== 0 || !existsSync(frame)) return { frame: null, crop: null, note: 'could not take the frame from the mp4' };
  // The rectangle is normalized; the pixels come from the stage the film declares.
  const w = Math.max(8, Math.round(rect.w * stage.w));
  const h = Math.max(8, Math.round(rect.h * stage.h));
  const x = Math.min(stage.w - w, Math.max(0, Math.round(rect.x * stage.w)));
  const y = Math.min(stage.h - h, Math.max(0, Math.round(rect.y * stage.h)));
  const cut = run(['-y', '-hide_banner', '-loglevel', 'error', '-i', frame, '-vf', `crop=${w}:${h}:${x}:${y}`, crop]);
  return { frame, crop: cut.status === 0 && existsSync(crop) ? crop : null, pixels: { x, y, w, h }, video };
}

/** The picture clip the film plays at `time`, from the film's own facts. */
function clipAt(projectPath, time) {
  try {
    const facts = checkFilm(projectPath).facts;
    const clips = Array.isArray(facts?.picture) ? facts.picture : [];
    const covering = clips.filter((c) => Number.isFinite(c.at) && Number.isFinite(c.length) && c.length > 0 && time >= c.at && time < c.at + c.length);
    // Several clips can cover one moment (captions and titles sit on top). The
    // footage is the deepest picture track, so that is the one a marked region
    // belongs to; an overlay would name the wrong page.
    covering.sort((a, b) => (Number(b.track) || 0) - (Number(a.track) || 0));
    const hit = covering[0];
    return hit ? { src: hit.src, id: hit.id, at: hit.at, length: hit.length, kind: hit.kind } : null;
  } catch {
    return null;
  }
}

/**
 * The agent that should receive a request from a panel.
 *
 * The film's own conversation comes first — the person expects the agent that
 * made the film to change it, not whichever conversation happens to be newest.
 * Then the session the panel named, then this process's own. Only a film with
 * no recorded owner falls back to the most recently created agent.
 * @param {object} ctx @param {Array<string|undefined>} preferredIds in order
 */
function findAgent(ctx, preferredIds = [], { allowNewest = true } = {}) {
  const agents = (() => { try { return ctx.get?.('agents'); } catch { return undefined; } })();
  const byId = (id) => { try { return id ? agents?.get?.(id) : undefined; } catch { return undefined; } };
  for (const id of preferredIds) {
    const found = byId(id);
    if (found?.followup) return found;
  }
  // A film that names its conversation must not have its edit delivered to a
  // different one; only a film with no owner may use the newest agent.
  if (!allowNewest) return null;
  try {
    const list = agents?.list?.();
    if (Array.isArray(list) && list.length > 0) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const entry = list[i];
        const candidate = byId(entry?.id ?? entry?.sessionId ?? entry?.session?.id)
          ?? (typeof entry?.followup === 'function' ? entry : null)
          ?? entry?.agent;
        if (candidate?.followup) return candidate;
      }
    }
  } catch {}
  try {
    const sessions = ctx.get?.('sessions')?.list?.();
    if (Array.isArray(sessions) && sessions.length > 0) {
      const last = sessions[sessions.length - 1];
      return byId(last?.id ?? last?.sessionId) ?? null;
    }
  } catch {}
  return null;
}

/**
 * Take a region the person marked in the panel and hand it to the agent.
 *
 * The panel cannot know what should change, and a screenshot alone is a guess.
 * So the selection becomes a precise request: the time, the rectangle in the
 * film's own pixels, the clip playing there, a crop of exactly that area, and
 * the person's words — delivered as a message to their session, so the agent
 * that made the film can change just that part.
 */
async function submitRegionEdit(ctx, body) {
  const cwd = typeof body?.cwd === 'string' && body.cwd ? body.cwd : lastRunCwd;
  const projectPath = resolveProjectFrom(cwd || undefined) ?? mostRecentlyUsedProject();
  if (!projectPath) throw new HttpError(400, 'no film project around the current working directory');
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : '';
  if (instruction.length === 0) throw new HttpError(400, 'instruction is required');
  if (instruction.length > 1200) throw new HttpError(400, 'instruction is too long (max 1200 characters)');

  const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : 0));
  const raw = body?.rect ?? {};
  const rect = {
    x: clamp01(raw.x), y: clamp01(raw.y),
    w: Math.min(1 - clamp01(raw.x), Math.max(0.002, clamp01(raw.w))),
    h: Math.min(1 - clamp01(raw.y), Math.max(0.002, clamp01(raw.h))),
  };
  if (rect.w * rect.h > 0.98) throw new HttpError(400, 'the selection covers the whole frame; mark the part you want changed');
  const time = Math.max(0, Number(body?.time) || 0);

  const facts = checkFilm(projectPath).facts;
  const stage = facts?.stage ?? { w: 1920, h: 1080 };
  const dir = join(projectPath, '.film', 'region-edits');
  mkdirSync(dir, { recursive: true });
  const id = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + randomUUID().slice(0, 6);
  const clip = clipAt(projectPath, time);
  const made = cropFrame(projectPath, time, rect, stage, dir, id);

  const px = made.pixels ?? {
    x: Math.round(rect.x * stage.w), y: Math.round(rect.y * stage.h),
    w: Math.round(rect.w * stage.w), h: Math.round(rect.h * stage.h),
  };
  const record = {
    id, projectPath, instruction, time,
    rect, pixels: px, stage, clip,
    frame: made.frame, crop: made.crop, note: made.note ?? null,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);

  // What the agent reads: exact numbers, the clip, the crop, and the words.
  const lines = [
    '[框选修改] The person marked one region in the film and asked for a change there.',
    '',
    `Film: ${projectPath}`,
    `Time: ${time.toFixed(2)}s${clip ? ` · clip "${clip.id}" (${clip.kind}) src=${clip.src}, plays ${clip.at}–${(clip.at + clip.length).toFixed(2)}s` : ''}`,
    `Selection (normalized): x=${rect.x.toFixed(4)} y=${rect.y.toFixed(4)} w=${rect.w.toFixed(4)} h=${rect.h.toFixed(4)}`,
    `Selection (${stage.w}×${stage.h} frame): x=${px.x} y=${px.y} ${px.w}×${px.h} px`,
    `Record: ${join('.film', 'region-edits', `${id}.json`)}`,
    ...(made.crop ? [`Crop of exactly that area: ${join('.film', 'region-edits', `${id}-crop.png`)}`] : []),
    ...(made.frame ? [`Whole frame at that moment: ${join('.film', 'region-edits', `${id}-frame.png`)}`] : []),
    ...(made.note ? [`Note: ${made.note}`] : []),
    '',
    `What they want changed: ${instruction}`,
    '',
    'How to do it: change only that part and leave every other object and the composition as they are.',
    'Prefer the page layer when the detail can be drawn (text, sticker, colour, mask, crop, a small overlay placed at those coordinates) — it needs no regeneration and other pixels stay identical.',
    'Only if the detail is baked into a generated still, do a local repaint of that crop: edit the crop, feather its edge, composite it back into the original asset at those pixels, and keep the original file as a variant.',
    'Then run mise_check and openfilm look on that moment to prove nothing else moved. The panel redraws from the files, so the change shows up as soon as they are written.',
    'Reply in a few lines: what you changed, which file, and how the person can see it.',
  ];
  const text = lines.join('\n');

  const bodySession = typeof body?.session === 'string' && body.session ? body.session : undefined;
  // Whose conversation takes this request: the one that made this film, then
  // the one the panel named, then this process's own. A film with no recorded
  // owner is the only case that falls back to the newest conversation.
  const owner = ownerSessionOf(projectPath);
  const sessionId = owner ?? bodySession ?? (process.env.DSH_SESSION_ID || undefined);
  const agent = findAgent(ctx, [owner, bodySession, process.env.DSH_SESSION_ID].filter(Boolean), { allowNewest: !owner });

  if (agent?.followup) {
    agent.followup(userMessage(text));
    beginProgress('openfilm_region', `region edit @${time.toFixed(1)}s`, { sessionId, projectPath }).finish('done', 'submitted to the agent');
    return { ok: true, submitted: true, id, time, rect, pixels: px, crop: made.crop ? relative(projectPath, made.crop).split(sep).join('/') : null, message: '已交给做这支片的会话，侧边栏会显示修改', owner: owner ?? null };
  }
  // The film knows its conversation, but that conversation is not loaded: say
  // so instead of waking a different one that never saw this film.
  if (owner) {
    return {
      ok: true,
      submitted: false,
      id,
      time,
      rect,
      pixels: px,
      crop: made.crop ? relative(projectPath, made.crop).split(sep).join('/') : null,
      owner,
      message: `这支片由会话 ${owner.slice(0, 8)}… 制作，它当前没有加载。请在它的对话里提交，或在本会话说一句「按框选修改」由我处理。`,
    };
  }
  return {
    ok: true,
    submitted: false,
    id,
    time,
    rect,
    pixels: px,
    crop: made.crop ? relative(projectPath, made.crop).split(sep).join('/') : null,
    message: '已记录这次框选。请在这条对话里说一句「按框选修改」，我就接着改。',
  };
}

function mountRoutes(ctx) {
  // The caller's directory and session travel on the query string so a GET can
  // answer "where is this session's film, right now".
  const paramsOf = (request) => {
    try {
      const url = new URL(request?.url ?? '/', 'http://localhost');
      const cwd = url.searchParams.get('cwd');
      const session = url.searchParams.get('session');
      return {
        ...(typeof cwd === 'string' && cwd.length > 0 ? { cwd } : {}),
        ...(typeof session === 'string' && session.length > 0 ? { sessionId: session } : {}),
      };
    } catch {
      return {};
    }
  };
  const routes = [
    {
      method: 'GET',
      path: '/mise/status',
      run: async (_body, request) => describeStatus(ctx, paramsOf(request)),
    },
    {
      method: 'GET',
      path: '/mise/library',
      run: (_body, request) => {
        const url = new URL(request?.url ?? '/', 'http://localhost');
        return describeLibrary({
          q: url.searchParams.get('q') ?? '',
          sort: url.searchParams.get('sort') ?? 'updated',
          cwd: url.searchParams.get('cwd') ?? '',
          sessionId: url.searchParams.get('session') ?? '',
          workspace: sessionDirectoryById(ctx, url.searchParams.get('session') ?? '')
            ?? newestSessionDirectory(ctx),
        });
      },
    },
    {
      // The panel's own editing route: retime and reorder shots without a
      // separate Studio server. It rewrites the shot track in film.html and
      // answers with the storyboard it just produced.
      method: 'POST',
      path: '/mise/storyboard',
      run: async (body) => {
        const query = { cwd: body?.cwd ?? '', sessionId: body?.session ?? '' };
        const status = await describeStatus(ctx, query);
        const projectPath = status?.project?.path;
        if (!projectPath) return { ok: false, error: 'no film project' };
        const filmPath = join(projectPath, 'film.html');
        let html = '';
        try { html = readFileSync(filmPath, 'utf8'); } catch { return { ok: false, error: 'no film.html' }; }
        const action = String(body?.action ?? '');
        let result;
        if (action === 'setLength') {
          result = setShotLength(html, Number(body?.index), Number(body?.length));
        } else if (action === 'move') {
          result = moveShot(html, Number(body?.index), Number(body?.delta));
        } else if (action === 'add') {
          result = addShot({
            projectPath,
            filmText: html,
            ...(body?.kind ? { kind: String(body.kind) } : {}),
            ...(body?.length !== undefined ? { length: Number(body.length) } : {}),
            ...(body?.title ? { title: String(body.title) } : {}),
          });
          if (result.ok) {
            writeFileSync(filmPath, result.filmText, 'utf8');
            html = result.filmText;
          }
        } else {
          return { ok: false, error: `unknown action ${action}` };
        }
        if (!result.ok) return { ok: false, error: result.problems.join('; ') };
        writeFileSync(filmPath, result.html, 'utf8');
        const planPath = join(projectPath, '.film', 'plan.json');
        try {
          const plan = JSON.parse(readFileSync(planPath, 'utf8'));
          plan.seconds = Number(result.shots.reduce((total, shot) => total + shot.length, 0).toFixed(2));
          writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
        } catch { /* a film without a plan still edits fine */ }
        return { ok: true, storyboard: describeStoryboard(projectPath) };
      },
    },
    {
      // Cheap poll target: progress only, so a watching panel does not pull the
      // whole status document every tick.
      method: 'GET',
      path: '/mise/progress',
      run: (_body, request) => describeProgress(paramsOf(request).sessionId),
    },
    {
      method: 'POST',
      path: '/mise/run',
      run: async (body) => {
        const args = Array.isArray(body?.args)
          ? body.args.filter((w) => typeof w === 'string' && w.length > 0 && w.length <= 512)
          : [];
        if (args.length === 0) throw new HttpError(400, 'args is required, e.g. ["open","launch-video"]');
        if (args.length > 64) throw new HttpError(400, 'too many arguments');
        if (args.some((word) => word.includes('\0'))) throw new HttpError(400, 'invalid argument');
        const cwd = typeof body?.cwd === 'string' && body.cwd.length > 0 ? body.cwd : process.cwd();
        // The panel is an untrusted caller: the command must be one a viewer is
        // allowed to trigger, and the directory must be inside a workspace. A
        // refusal answers as a refusal — it never quietly runs somewhere else.
        if (!withinWorkspace(cwd)) throw new HttpError(403, `directory ${cwd} is outside the workspace`);
        assertRunAllowed(args, cwd, 'panel');

        // Render is Mise's own now: the panel's 渲染全片 goes straight to our
        // renderer instead of spawning the vendored runtime (and its Studio).
        if (args[0] === 'render') {
          const projectPath = resolveProjectFrom(cwd) ?? cwd;
          try {
            const rendered = await renderFilm({ projectDir: projectPath });
            noteProject(projectPath, typeof body?.session === 'string' ? body.session : undefined);
            return {
              ok: true,
              exitCode: 0,
              stdout: `→ ${relative(projectPath, rendered.out)}\n${rendered.frames} frames · ${rendered.seconds}s`,
              stderr: '',
              timedOut: false,
            };
          } catch (error) {
            return { ok: false, exitCode: 1, stdout: '', stderr: String(error?.message ?? error), timedOut: false };
          }
        }

        const r = await runOpenfilm(args, { ctx, cwd, timeoutMs: 600_000, sessionId: typeof body?.session === 'string' ? body.session : undefined });
        // The panel's Open button also brings the motion kit into a project it
        // just created, exactly as the agent's own `open` does.
        if (r.exitCode === 0 && args[0] === 'open') {
          const printedProject = /^project\s+(.+)$/m.exec(r.stdout)?.[1]?.trim();
          const namedChild = typeof args[1] === 'string' && !/^(https?:)?\/\//.test(args[1]) && !resolve(args[1]).startsWith(resolve(cwd))
            ? join(cwd, args[1])
            : undefined;
          const opened = resolveProjectFrom(printedProject || undefined)
            ?? resolveProjectFrom(namedChild || undefined)
            ?? resolveProjectFrom(cwd);
          if (opened) copyMotionKit(opened);
        }
        return { ok: r.exitCode === 0, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, timedOut: r.timedOut };
      },
    },
    {
      // Save or remove a media-service key from the panel. The name must be one
      // of the providers OpenFilm knows (see writeProviderCredential), so this
      // can never touch Harness's own credentials.
      method: 'POST',
      path: '/mise/credential',
      run: (body) => writeProviderCredential(ctx, body),
    },
    {
      // The background asset queue. ONE route, not two: the host's webServer
      // refuses a duplicate exact path, and that refusal took the whole
      // mountRoutes down — every route registered after it was lost with it.
      // GET lists the jobs, POST drops the finished ones; pending work is not
      // cancellable from here (cancel the tool call that enqueued it).
      method: ['GET', 'POST'],
      path: '/mise/queue',
      run: (body, request) => {
        if (request?.method === 'POST') {
          // cancel: stop asking about one job; clear: forget finished ones.
          if (body?.action === 'cancel' && typeof body?.jobId === 'string') {
            const projectPath = resolveProjectFrom(typeof body?.cwd === 'string' && body.cwd ? body.cwd : lastRunCwd)
              ?? newestProjectOnDisk();
            if (!projectPath) throw new HttpError(400, 'no film project');
            return { ok: true, ...cancelJob(projectPath, body.jobId), job: getJob(projectPath, body.jobId) };
          }
          return { ok: true, cleared: clearFinishedJobs(), pending: hasPendingJobs() };
        }
        return { ok: true, jobs: listJobs(paramsOf(request).projectPath), pending: hasPendingJobs(), persistent: true };
      },
    },
    {
      // Generate media straight from the panel, without a round-trip through
      // the conversation. This calls the same functions the mise_asset and
      // mise_voice tools call — one implementation, two callers — so a
      // picture made here behaves exactly like one the agent made, including
      // landing in the project's assets/ and appearing in mise_check.
      method: 'POST',
      path: '/mise/media',
      run: (body) => generateMedia(ctx, body),
    },
    {
      // A region the person marked on the picture, plus what they want there.
      // It becomes a precise message to the session's agent: time, pixels,
      // clip, a crop of exactly that area. The agent changes only that part.
      method: 'POST',
      path: '/mise/region-edit',
      run: (body) => submitRegionEdit(ctx, body),
    },
    {
      // The film's own facts, read-only: the same checkFilm the tool serves,
      // for the panel's timeline view. No write, no run, no media.
      method: 'GET',
      path: '/mise/check',
      run: (_body, request) => {
        const cwd = paramsOf(request).cwd;
        const projectPath = resolveProjectFrom(typeof cwd === 'string' && cwd ? cwd : lastRunCwd);
        if (!projectPath) throw new HttpError(400, 'no film project around the current directory; open one first');
        return checkFilm(projectPath);
      },
    },
    {
      // Reports what the harness's own speech services expose. This is how the
      // subtitle bridge was built against the live contract rather than a
      // guessed one; it stays because it answers "why can't I transcribe" too.
      method: 'GET',
      path: '/mise/speech',
      run: () => probeSpeech(ctx),
    },
    {
      // Serves the contact sheet and the exported video so the panel can show
      // the real picture instead of describing it. The requested path is
      // resolved inside the film project only — anything that escapes it is
      // refused, so this route can never read an arbitrary file.
      method: 'GET',
      path: '/mise/file',
      run: (_body, request, response) => sendFile(ctx, request, response),
      // A file route writes its own response and says so; the JSON routes
      // below return a document instead.
      raw: true,
    },
  ];

  // A second mount of the same plugin (a re-activation, or a host that replays
  // effects) must not register the routes twice: the host refuses a duplicate
  // exact path, and that refusal used to abort the whole mount. So the previous
  // mount is released before this one is taken.
  for (const dispose of ACTIVE_ROUTE_DISPOSERS) { try { dispose(); } catch {} }
  ACTIVE_ROUTE_DISPOSERS.length = 0;

  const disposers = routes.map(({ method, path: routePath, run, raw }) => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: routePath,
      handler: async (request, response) => {
        const rejection = requestRejection(ctx, request);
        if (rejection !== undefined) { sendJson(response, rejection, { ok: false, error: 'forbidden' }); return; }
        // One route may take more than one method (the host refuses a duplicate
        // path), so a route declares its methods as a string or a list of them.
        const methods = Array.isArray(method) ? method : [method];
        if (!methods.includes(request.method)) { sendJson(response, 405, { ok: false, error: 'method-not-allowed' }); return; }
        try {
          const body = request.method === 'POST' ? await readJsonBody(request) : undefined;
          if (raw) { await run(body, request, response); return; }
          sendJson(response, 200, await run(body, request));
        } catch (error) {
          // A guard's refusal carries its own status so the panel can tell a
          // rejected command from a failed one.
          if (error instanceof HttpError) { sendJson(response, error.status, { ok: false, error: error.message }); return; }
          sendJson(response, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    });
    if (typeof dispose === 'function') ACTIVE_ROUTE_DISPOSERS.push(dispose);
    return dispose;
  });
  return () => { for (const dispose of disposers) { try { dispose(); } catch {} } };
}

/**
 * The routes this plugin currently has registered. A module-level record, so a
 * second mount releases the first before taking the paths again — the host
 * refuses a duplicate exact path, and without this the second mount aborted
 * the whole registration and left the plugin with no routes at all.
 */
const ACTIVE_ROUTE_DISPOSERS = [];

/** ── Tools ─────────────────────────────────────────────────────────────── */

const MANUAL_ARGS = { type: 'object', additionalProperties: false, properties: {} };

/** Shared output schema for run-style tools: bounded command output plus exit state. */
const RUN_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    exitCode: { type: 'integer', description: '0 done, 1 the film or command failed, 2 not a project or a wrong command, -1 = the process could not be started.' },
    stdout: { type: 'string' },
    stderr: { type: 'string' },
    timedOut: { type: 'boolean' },
    truncated: { type: 'boolean', description: 'Output exceeded the 256 KiB capture budget; rerun with narrower arguments for the rest.' },
    note: { type: 'string', description: 'For a failed `get`: why, in upstream\'s own words; absent otherwise.' },
  },
  required: ['exitCode', 'stdout', 'stderr', 'timedOut', 'truncated'],
};

function renderRunOutput(_args, value) {
  const parts = [];
  if (value.exitCode !== 0) parts.push(`openfilm exited with code ${value.exitCode}${value.timedOut ? ' (timed out)' : ''}.`);
  if (value.stdout) parts.push(value.stdout);
  if (value.stderr) parts.push(`stderr:\n${value.stderr}`);
  if (value.truncated) parts.push('(output truncated)');
  return [{ type: 'text', text: parts.join('\n') || '(no output)' }];
}

function buildManualTool(ctx) {
  return {
    name: 'mise_manual',
    description:
      'Print the OpenFilm agent manual: the complete guide to making a film — a web page, film.html, that cuts shot pages, footage and sound together, with the shots listed and editable in the plugin panel. ' +
      'Read it before writing any film; then create the project and draw its frames so the person can watch it take shape in the panel.',
    parameters: MANUAL_ARGS,
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { manual: { type: 'string' } }, required: ['manual'] },
      render: (_args, value) => [{ type: 'text', text: value?.manual || '(empty manual)' }],
    },
    presentCall: () => ({ card: 'generic', title: 'Read the OpenFilm manual', kind: 'read' }),
    async execute(_args, exec) {
            const progress = beginProgress('mise_manual', 'openfilm manual');
      try {
        const result = await runOpenfilm([], { cwd: await sessionCwd(ctx, exec?.agent), timeoutMs: 30_000, signal: exec?.signal });
        if (result.exitCode !== 0 && !result.stdout) {
          progress.fail(`exit ${result.exitCode}: ${result.stderr || 'no output'}`);
          throw new Error(`openfilm failed (exit ${result.exitCode}): ${result.stderr || 'no output'}`);
        }
        progress.finish(result.exitCode === 0 ? 'done' : 'error', `${result.stdout.length} bytes`);
        return { manual: result.stdout };
      } catch (error) {
        // Re-thrown unchanged; the record was already settled above when the
        // failure was expected, and this covers anything unexpected.
        progress.fail(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
  };
}

function buildRunTool(ctx) {
  return {
    name: 'mise_run',
    description:
      'Run one OpenFilm command in the film project. Commands: ' +
      '"open" [folder|GitHub url] — create/open a project (optional: the panel does not need it); ' +
      '"look" [what] [t | a-b] — check the film and draw it: PNG contact sheets under .film/cache/look/ (paths are printed); ' +
      '"render" [a-b] [--out file] [--fps n] [--4k] [--blur] [--alpha] — the MP4 beside film.html; ' +
      '"get" [what] [--options] — voice-over, music, sound effects, transcripts, images from the person\'s connected services (run alone to list what is connected); ' +
      '"capture" <url> <file.png> [--full] [--size WxH] [--selector css] — a picture of a live web page; ' +
      '"skills" / "skill" <name> — list or print the official filmmaking skills; ' +
      '"update" — update OpenFilm itself. ' +
      'look, render and get work on the film project around the working directory; run "open <name>" first to create one. Exit codes: 0 done, 1 failed (output says why), 2 not a project or wrong command.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        args: {
          type: 'array',
          description: 'Command-line arguments after "openfilm", e.g. ["open","launch-video"], ["look","4.5"], ["render","--fps","60"], ["skill","keynote"]. Each element is one argv word; do not quote or join.',
          items: { type: 'string' },
        },
        cwd: {
          type: 'string',
          description: 'Directory to run in; defaults to the session working directory. look/render/get resolve the film project around it.',
        },
        timeoutMs: {
          type: 'integer',
          description: 'Kill the command after this many milliseconds. Default 120000; render and the first look (one-time ~100 MB browser download) may need 600000.',
        },
      },
      // Strict JSON Schema: `required` is an array of property names at the
      // object level. A boolean `required` inside a property is the harness's
      // own dialect, which strict validators reject and which failed the whole
      // model request when this tool was sent to one.
      required: ['args'],
    },
    output: { schema: RUN_OUTPUT_SCHEMA, render: renderRunOutput },
    presentCall: (args) => ({
      card: 'terminal',
      title: `openfilm ${(Array.isArray(args?.args) ? args.args : []).join(' ')}`.trim(),
      kind: 'execute',
      cwd: args?.cwd,
    }),
    async execute(args, exec) {
            const argv = (Array.isArray(args?.args) ? args.args : [])
        .filter((word) => typeof word === 'string' && word.length > 0 && word.length <= 512);
      if (argv.length === 0) throw new Error('mise_run: `args` is required, e.g. ["open","launch-video"] or ["look"]. For the manual use mise_manual.');
      if (argv.length > 64) throw new Error('mise_run: too many arguments (max 64).');
      if (argv.some((word) => word.includes('\0'))) throw new Error('mise_run: invalid argument.');
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx, exec?.agent);
      // An output path outside the project is refused for the agent too: the
      // CLI would happily write anywhere it is told.
      assertRunAllowed(argv, cwd, 'agent');
      const timeout = Number.isInteger(args?.timeoutMs) && args.timeoutMs > 0 && args.timeoutMs <= 3_600_000 ? args.timeoutMs : 120_000;
      const sessionId = exec?.agent?.id ? String(exec.agent.id) : undefined;

      // Side-channel only: the return value and every throw below are exactly
      // what they were without it. The record reports the real exit code.
      const progress = beginProgress('mise_run', `openfilm ${argv.join(' ')}`, { sessionId, projectPath: resolveProjectFrom(cwd) });
      try {
        const result = await runOpenfilm(argv, { ctx, cwd, timeoutMs: timeout, signal: exec?.signal, sessionId });
        noteProject(resolveProjectFrom(cwd), sessionId);
        // A project that has just been opened gets the motion kit, so its pages
        // can import it with a relative path. Idempotent, and only after a run
        // that could have created or resolved a project.
        //
        // The project is found from the run's own output first — `open` prints
        // `project  <path>` when it creates one. When it opens an existing one
        // by name it prints nothing of the sort, and the name resolves against
        // the working directory as a subfolder — which upward walking would
        // never see.
        const printedProject = /^project\s+(.+)$/m.exec(result.stdout)?.[1]?.trim();
        const namedChild = argv[0] === 'open' && typeof argv[1] === 'string'
          && !/^(https?:)?\/\//.test(argv[1]) && !resolve(argv[1]).startsWith(cwd)
          ? join(cwd, argv[1])
          : undefined;
        const openedProject = resolveProjectFrom(printedProject || undefined)
          ?? resolveProjectFrom(namedChild || undefined)
          ?? resolveProjectFrom(cwd);
        if (result.exitCode === 0 && openedProject) copyMotionKit(openedProject);
        progress.finish(result.exitCode === 0 ? 'done' : 'error', `exit ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
        // `get` fails when no service that makes that kind is connected. Say so
        // with upstream's own words rather than returning an empty failure the
        // model would have to guess at.
        let note;
        if (argv[0] === 'get' && result.exitCode !== 0) {
          const reason = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
          note = reason || 'openfilm get failed without a reason';
        }
        return {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          timedOut: result.timedOut,
          truncated: result.truncated,
          // Optional string fields: an absent one is omitted, not null, so the
          // value keeps matching the declared schema.
          ...(note ? { note } : {}),
        };
      } catch (error) {
        progress.fail(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    isConcurrencySafe: () => false, // look/render touch shared .film/cache
  };
}

/** ── Agnes assets: pictures and footage the film can actually play ──────── */

const ASSET_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    kind: { type: 'string' },
    relative: { type: 'string' },
    path: { type: 'string' },
    bytes: { type: 'integer' },
    model: { type: 'string' },
    provider: { type: 'string' },
    seconds: { type: 'number' },
    size: { type: 'string' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    hasAudio: { type: 'boolean' },
    costUsd: { type: 'number' },
    cost: { type: 'object', additionalProperties: true },
    actual: { type: 'object', additionalProperties: true, description: 'What the file really is, measured with ffprobe: width, height, duration, fps, hasAudio.' },
    requested: { type: 'object', additionalProperties: true, description: 'What was asked for, as the service received it.' },
    queued: { type: 'boolean', description: 'true when the generation was queued and no file exists yet.' },
    jobId: { type: 'string', description: 'The durable job id, for status and cancel.' },
    assetId: { type: 'string', description: 'The manifest id of this asset, stable across retries.' },
    cutout: {
      type: 'object',
      additionalProperties: false,
      properties: {
        relative: { type: 'string' },
        width: { type: 'integer' },
        height: { type: 'integer' },
        cutPixels: { type: 'integer' },
      },
      required: ['relative'],
    },
    note: { type: 'string' },
    error: { type: 'string' },
  },
  required: ['ok', 'kind'],
};

function buildAssetTool(ctx) {
  return {
    name: 'mise_asset',
    description:
      'Make a real picture or video for the film and save it under the project\'s assets/, where film.html can cut it in. ' +
      'Choose the service with `provider`: agnes (text only, 4–12 s, 720P), google (Veo 3.1: first frame, last frame, up to 3 reference pictures, 4/6/8 s, native sound) ' +
      'or fal (Seedance 2.0 / Kling 3.0: first and last frame, reference pictures, sound). ' +
      'Reference pictures and first/last frames are how one character or product stays the same across shots: pass project files (e.g. assets/hero.png) and describe them in the prompt. ' +
      'The returned `actual` is the file measured by ffprobe (width, height, duration, fps, hasAudio) — cut it in with that length, not with what was requested. ' +
      'Video is billed by the service to the person\'s own account, so say the cost before making more than one. ' +
      'A video can take minutes: set background: true to queue it and keep working; the job survives a restart and never pays twice for the same request.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: {
          type: 'string',
          enum: ['image', 'video'],
          description: 'image = a still; video = a clip.',
        },
        prompt: {
          type: 'string',
          description: 'What to make. For video, name the subject, the action, the camera move and the look, in that order. Name reference pictures the way the service sees them ("the woman in @Image1").',
        },
        cwd: {
          type: 'string',
          description: 'The film project (or a folder inside it); defaults to the session working directory.',
        },
        provider: {
          type: 'string',
          enum: ['agnes', 'google', 'fal'],
          description: 'Which service makes it (default agnes). Its key must be configured in the panel.',
        },
        model: {
          type: 'string',
          description: 'A model id from the provider, e.g. veo-3.1-fast-generate-preview, seedance-2.0-fast, kling-3.0-pro. Default: the provider\'s first video model.',
        },
        seconds: {
          type: 'number',
          description: 'clip length. Agnes 4–12; Veo 4, 6 or 8; Seedance 4–15; Kling 3–15. The service\'s own limit is refused before anything is sent.',
        },
        size: {
          type: 'string',
          description: 'Agnes only: 720P. Other providers choose resolution by model.',
        },
        aspectRatio: {
          type: 'string',
          description: 'A ratio the chosen model makes, e.g. 16:9, 9:16, 1:1.',
        },
        firstFrame: {
          type: 'string',
          description: 'A project picture the clip starts from (e.g. assets/hero.png). Google and fal support it.',
        },
        lastFrame: {
          type: 'string',
          description: 'A project picture the clip ends on; needs firstFrame.',
        },
        references: {
          type: 'array',
          items: { type: 'string' },
          description: 'Project pictures that keep a character or product consistent. Veo takes up to 3; Seedance up to 9. Cannot be mixed with firstFrame.',
        },
        generateAudio: {
          type: 'boolean',
          description: 'Ask a model that supports it (Veo, Seedance, Kling) for native sound. Refused for models that cannot.',
        },
        shotId: {
          type: 'string',
          description: 'Which shot this asset is for; stored in the project manifest so a later change can find it.',
        },
        hint: {
          type: 'string',
          description: 'A few words naming the asset, used in the filename (e.g. "opening shot").',
        },
        background: {
          type: 'boolean',
          description: 'video only: queue it and return immediately. The job keeps the service\'s task id, resumes after a restart, and is never submitted twice.',
        },
      },
      required: ['kind', 'prompt'],
    },
    output: { schema: ASSET_OUTPUT_SCHEMA, render: renderAssetOutput },
    presentCall: (args) => ({
      card: 'generic',
      title: `Make a ${args?.kind === 'video' ? 'video clip' : 'picture'} with ${args?.provider ?? 'Agnes'}`,
      kind: 'other',
      rawInput: String(args?.prompt ?? '').slice(0, 200),
    }),
    async execute(args, exec) {
      const kind = args?.kind === 'video' ? 'video' : args?.kind === 'image' ? 'image' : undefined;
      if (!kind) throw new Error('mise_asset: `kind` must be "image" or "video".');
      const prompt = typeof args?.prompt === 'string' ? args.prompt.trim() : '';
      if (prompt.length === 0) throw new Error('mise_asset: `prompt` is required.');
      if (prompt.length > 4000) throw new Error('mise_asset: `prompt` is too long (max 4000 characters).');

      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx, exec?.agent);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_asset: no film project around ${cwd} (no film.html found).`);

      const request = mediaRequestFrom({ ...args, kind, prompt }, projectPath);
      // Refuse an impossible combination here, with the accepted list, before
      // the person is charged or told about a clip that would never exist.
      const { provider, model } = validateRequest(request);
      const sessionId = exec?.agent?.id ? String(exec.agent.id) : undefined;

      // A video the person does not need to wait for: the queue owns polling
      // and retries, and its file keeps the service's task id.
      if (kind === 'video' && args?.background === true) {
        const job = enqueueMediaJob({
          projectPath,
          request,
          hint: request.hint,
          resolveKey: () => resolveProviderKey(ctx, provider.env),
        });
        return {
          ok: true,
          kind,
          queued: true,
          jobId: job.id,
          provider: job.provider,
          model: job.model,
          relative: '',
          path: '',
          bytes: 0,
          note:
            `queued as job ${job.id.slice(0, 8)} with ${provider.name} · ${model.name}. It keeps the service's task id, ` +
            `resumes after a restart and is never submitted twice. The finished clip appears in assets/video/; ` +
            `the panel's queue rows and the status route show its state (run mise_check later to see the file).`,
        };
      }

      const progress = beginProgress(
        'mise_asset',
        `${provider.id} ${kind}: ${prompt.slice(0, 60)}`,
        { sessionId, projectPath },
      );
      try {
        const result = await generateAssetNow(ctx, request, { progress, signal: exec?.signal });
        progress.finish('done', `${result.relative} (${Math.round(result.bytes / 1024)} KB)`);
        // A generated picture arrives as a rectangle. Whether that rectangle is
        // right depends on what the film does with it, and the file itself says
        // which case it is: a subject on one flat colour is a sticker waiting to
        // be cut, so the cut is made here instead of being left to habit. The
        // original stays; the transparent PNG sits beside it and is offered.
        let cutout;
        if (kind === 'image') {
          const probe = assessBackground(result.path);
          if (probe?.uniform) {
            try {
              const cut = await cutoutImage({
                src: result.path,
                projectPath,
                hint: args?.hint ?? 'subject',
                tolerance: args?.tolerance,
              });
              cutout = { relative: cut.relative, width: cut.width, height: cut.height, cutPixels: cut.cutPixels };
            } catch {
              // A background the cut cannot take (a photograph, a gradient) is
              // not a failure of the picture: it is used as it is.
            }
          }
        }
        const actual = result.actual ?? {};
        return {
          ok: true,
          kind,
          provider: result.provider,
          model: result.model,
          relative: result.relative,
          path: result.path,
          bytes: result.bytes,
          ...(cutout ? { cutout } : {}),
          ...(kind === 'video'
            ? {
                ...(Number.isFinite(result.seconds) ? { seconds: result.seconds } : {}),
                ...(actual.width && actual.height ? { size: `${actual.width}x${actual.height}` } : {}),
              }
            : {}),
          ...(Object.keys(actual).length ? { actual } : {}),
          ...(result.assetId ? { assetId: result.assetId } : {}),
          note:
            kind === 'video'
              ? `Made by ${provider.name} · ${model.name}; billed by the service to the person's account. ` +
                `Its real length is ${result.seconds}s at ${actual.width ?? '?'}x${actual.height ?? '?'}${actual.hasAudio ? ' with sound' : ' silent'} (measured, not requested). ` +
                `Cut it into film.html with src="${result.relative}#t=0,${result.seconds}" on a <video> element.`
              : cutout
                ? `The picture was drawn on one flat background, so its subject was also cut out to ${cutout.relative} (transparent PNG). Use the cut file whenever the picture sits on a page as a sticker; use ${result.relative} itself only as a full-frame plate.`
                : `Cut it into film.html with src="${result.relative}#t=0,<length>" on an <img> element (real size ${actual.width ?? '?'}x${actual.height ?? '?'}); its edges are real picture content, so it belongs as a full-frame plate or behind object-fit: cover.`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        progress.fail(message);
        throw new Error(`mise_asset (${kind}): ${message}`);
      }
    },
    isConcurrencySafe: () => false, // writes into the project's assets/
  };
}

function renderAssetOutput(_args, value) {
  if (value?.ok !== true) return [{ type: 'text', text: value?.error ?? 'asset generation failed' }];
  if (value.queued) return [{ type: 'text', text: value.note ?? `Queued as ${value.jobId}.` }];
  const actual = value.actual ?? {};
  const lines = [
    `Saved ${value.relative} (${Math.round((value.bytes ?? 0) / 1024)} KB) with ${value.provider ? `${value.provider} · ` : ''}${value.model}.`,
    ...(actual.duration ? [`Measured: ${actual.width}x${actual.height}, ${actual.duration}s${actual.fps ? `, ${actual.fps} fps` : ''}${actual.hasAudio ? ', with sound' : ', silent'}.`] : []),
    ...(value.cutout ? [`Cut out to ${value.cutout.relative} (${value.cutout.width}x${value.cutout.height}, ${value.cutout.cutPixels} px of background removed).`] : []),
    ...(typeof value.costUsd === 'number' ? [`Cost: about $${value.costUsd}.`] : []),
    ...(value.note ? [value.note] : []),
  ];
  return [{ type: 'text', text: lines.join('\n') }];
}

/** ── Voice: the one thing a film cannot draw ───────────────────────────── */

const VOICE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    relative: { type: 'string' },
    path: { type: 'string' },
    bytes: { type: 'integer' },
    seconds: { type: 'number' },
    voice: { type: 'string' },
    role: { type: 'string' },
    cast: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { role: { type: 'string' }, voice: { type: 'string' }, lines: { type: 'integer' } },
        required: ['role', 'voice'],
      },
    },
    cues: { type: 'string' },
    words: {
      type: 'array',
      description: 'Word boundaries the engine reported, in seconds: token, start, end. Empty when the engine gave none.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { token: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' } },
        required: ['token', 'start', 'end'],
      },
    },
    note: { type: 'string' },
    error: { type: 'string' },
  },
  required: ['ok'],
};

function renderVoiceOutput(_args, value) {
  if (value?.ok !== true) return [{ type: 'text', text: value?.error ?? 'voice generation failed' }];
  const cast = Array.isArray(value.cast) && value.cast.length > 0
    ? [`Cast so far: ${value.cast.map((c) => `${c.role} → ${c.voice} (${c.lines ?? 0} line(s))`).join('; ')}.`]
    : [];
  const lines = [
    `Saved ${value.relative} (${Math.round((value.bytes ?? 0) / 1024)} KB, ${value.seconds}s) spoken by ${value.voice} as ${value.role ?? 'narrator'}.`,
    ...cast,
    ...(value.cues ? [`Subtitles: ${value.cues}${Array.isArray(value.words) && value.words.length ? ` (${value.words.length} word timing(s))` : ' (one cue for the line)'}`] : []),
    ...(value.note ? [value.note] : []),
  ];
  return [{ type: 'text', text: lines.join('\n') }];
}

function buildVoiceTool(ctx) {
  return {
    name: 'mise_voice',
    description:
      'Speak a line of narration or dialogue and save it under the project\'s assets/, ready to cut into film.html as an <audio> clip. ' +
      'Use this for anything the film says: a narrator telling the story, a character shouting, a voice-over over footage. ' +
      'A film is silent unless a sound clip is placed on a track, and a page cannot make noise, so dialogue always has to become a clip like this one. ' +
      'Mandarin neural voices, no account and no key. It also writes the .vtt subtitle for that line. ' +
      'VOICE CONSISTENCY IS PER ROLE, not per film: a line belongs to a role (a narrator, a character), and a role keeps the voice it first spoke with, so one narrator never drifts between voices and each character stays recognisably themselves. ' +
      'Default role is "narrator": a single-voice film needs no role at all. Give a role a different voice only by naming a NEW role for that other speaker. ' +
      'The returned `seconds` is the clip\'s real length: use it as the #t=0,<length> so the line is never cut mid-word.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: {
          type: 'string',
          description: 'Exactly what is said, in the language it is said in. Write it the way it should be heard; punctuation sets the pauses.',
        },
        cwd: {
          type: 'string',
          description: 'The film project (or a folder inside it); defaults to the session working directory.',
        },
        voice: {
          type: 'string',
          description:
            `Voice id. One of: ${VOICES.map((v) => `${v.id} (${v.label})`).join(', ')}. ` +
            `Defaults to the voice this role already speaks with, else ${DEFAULT_VOICE}. Passing a different voice for a role that already has one is refused unless recast is set.`,
        },
        role: {
          type: 'string',
          description:
            'Who says this line: "narrator" (the default, for a single-voice film) or a character name such as "host", "child", "customer". Each role keeps one voice for the whole film.',
        },
        recast: {
          type: 'boolean',
          description: 'Re-voice an existing role deliberately (every line of that role must then be recorded again so the old files do not survive in the film).',
        },
        hint: {
          type: 'string',
          description: 'A few words naming the line, used in the filename (e.g. "narration-1").',
        },
        subtitles: {
          type: 'boolean',
          description: 'Also write the matching .vtt subtitle file beside the audio (default true).',
        },
      },
      required: ['text'],
    },
    output: { schema: VOICE_OUTPUT_SCHEMA, render: renderVoiceOutput },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Speak a line',
      kind: 'other',
      rawInput: String(args?.text ?? '').slice(0, 200),
    }),
    async execute(args, exec) {
      const text = typeof args?.text === 'string' ? args.text.trim() : '';
      if (text.length === 0) throw new Error('mise_voice: `text` is required.');

      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx, exec?.agent);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_voice: no film project around ${cwd} (no film.html found).`);

      const sessionId = exec?.agent?.id ? String(exec.agent.id) : undefined;
      const progress = beginProgress('mise_voice', `speak: ${text.slice(0, 60)}`, { sessionId, projectPath });
      try {
        // One entry decides voice, writes audio + cue, then commits the cast.
        const spoken = await speakLine({
          projectPath,
          text,
          role: args?.role,
          voice: args?.voice,
          recast: args?.recast === true,
          hint: args?.hint,
          subtitles: args?.subtitles !== false,
        });
        const cast = spoken.cast;
        progress.finish('done', `${spoken.relative} ${spoken.seconds}s`);
        return {
          ok: true,
          relative: spoken.relative,
          path: spoken.path,
          bytes: spoken.bytes,
          seconds: spoken.seconds,
          voice: spoken.voice,
          role: spoken.role,
          cast: cast.roles,
          ...(spoken.cues ? { cues: spoken.cues } : {}),
          ...(spoken.words ? { words: spoken.words } : {}),
          note:
            `Cut it into film.html as <audio src="${spoken.relative}"></audio> and give the picture clip that covers it ` +
            `at="<start>" for ${spoken.seconds}s, so the words land with the shot they belong to. ` +
            (cast.narratorOnly
              ? `This film has one speaking role (${spoken.role}), so keep using it for every line: a second voice here would be a different person.`
              : `Keep ${spoken.role} on ${spoken.voice} for the rest of its lines; other characters go on their own roles.`),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        progress.fail(message);
        throw new Error(`mise_voice: ${message}`);
      }
    },
    isConcurrencySafe: () => false, // writes into the project's assets/
  };
}

/** ── Motion catalogue: choose a pattern, say why ────────────────────────── */

const MOTION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    patterns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          use: { type: 'array', items: { type: 'string' } },
          when: { type: 'string' },
          snippet: { type: 'string', description: 'The frame(t) code for this pattern, ready to adapt.' },
          avoid: { type: 'string', description: 'How this pattern fails when misused.' },
        },
        required: ['id', 'name'],
      },
    },
    note: { type: 'string' },
  },
  required: ['ok', 'patterns'],
};

function renderMotionOutput(_args, value) {
  if (!value?.ok) return [{ type: 'text', text: value?.note ?? 'no patterns' }];
  const lines = [];
  for (const p of value.patterns) {
    lines.push(`${p.id} — ${p.name}`);
    if (Array.isArray(p.use) && p.use.length) lines.push(`  use: ${p.use.join(', ')}`);
    if (p.when) lines.push(`  when: ${p.when}`);
    if (p.snippet) lines.push('  snippet:\n    ' + String(p.snippet).split('\n').join('\n    '));
    if (p.avoid) lines.push(`  avoid: ${p.avoid}`);
    lines.push('');
  }
  if (value.note) lines.push(value.note);
  return [{ type: 'text', text: lines.join('\n').trim() || '(no patterns)' }];
}

function buildMotionTool() {
  return {
    name: 'mise_motion',
    description:
      'Search the motion catalogue before writing a shot page: the patterns a film can draw with of-motion (steps, comparison, number, chart, terminal typing, wipe reveal, chapter card, quote, device frame, still-photo camera move, match cut). ' +
      'Each result carries when to use it, the frame(t) snippet, and how it fails. ' +
      'A shot should pick a pattern and say why in one line, instead of defaulting to a centred caption; do not repeat the same pattern back to back, and use at most two in a film. ' +
      'Pass `query` (what the shot has to say), `use` (a purpose tag like explain/compare/data/transition/broll), or `id` for one pattern in full.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'What the shot has to say, in the person\'s words, e.g. "三个要点列表".' },
        use: { type: 'string', description: 'A purpose tag: explain, compare, data, steps, transition, chapter, quote, device, broll, image, code.' },
        id: { type: 'string', description: 'One pattern id, e.g. STEPS-LIST. Case-insensitive.' },
        limit: { type: 'integer', description: 'How many candidates (default 3, max 10).' },
      },
    },
    output: { schema: MOTION_OUTPUT_SCHEMA, render: renderMotionOutput },
    presentCall: (args) => ({ card: 'generic', title: 'Search motion patterns', kind: 'read', rawInput: args?.query ?? args?.use ?? args?.id }),
    async execute(args) {
      const id = typeof args?.id === 'string' ? args.id.trim() : '';
      if (id) {
        const pattern = getMotion(id);
        if (!pattern) {
          return { ok: false, patterns: [], note: `no pattern ${JSON.stringify(id)}; there is ${listMotion().map((p) => p.id).join(', ')}` };
        }
        return { ok: true, patterns: [pattern], note: 'Say why this pattern fits the shot in one line, then adapt its snippet in frame(t).' };
      }
      const patterns = searchMotion({
        query: typeof args?.query === 'string' ? args.query : '',
        use: typeof args?.use === 'string' ? args.use : '',
        limit: args?.limit,
      });
      return {
        ok: true,
        patterns,
        note: 'Compare the top three, name the winner and why in one line, then write the page. Do not use the same pattern twice in a row.',
      };
    },
    isConcurrencySafe: () => true,
  };
}

/** ── Review gate: every shot's keyframe approved before a render ─────────── */

const REVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    action: { type: 'string' },
    shots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          src: { type: 'string' },
          kind: { type: 'string', description: 'page, video or still.' },
          at: { type: 'number' },
          length: { type: 'number' },
          keyframeAt: { type: 'number' },
          keyframe: { type: 'string', description: 'The PNG drawn for this shot; empty until keyframes is run.' },
          state: { type: 'string', description: 'pending | approved | changed' },
          note: { type: 'string' },
        },
        required: ['id', 'state'],
      },
    },
    counts: {
      type: 'object',
      additionalProperties: false,
      properties: {
        total: { type: 'integer' },
        approved: { type: 'integer' },
        pending: { type: 'integer' },
        changed: { type: 'integer' },
      },
      required: ['total', 'approved', 'pending', 'changed'],
    },
    readyToRender: { type: 'boolean' },
    message: { type: 'string' },
  },
  required: ['ok', 'action', 'shots', 'counts', 'readyToRender'],
};

function renderReviewOutput(_args, value) {
  if (!value?.ok) return [{ type: 'text', text: value?.message ?? 'review failed' }];
  const mark = { approved: '✓', changed: '✗', pending: '·' };
  const lines = value.shots.map((s) =>
    `${mark[s.state] ?? '·'} ${s.id}  ${s.at}–${(s.at + s.length).toFixed(2)}s  keyframe@${s.keyframeAt}s`
    + (s.keyframe ? `  ${s.keyframe}` : '')
    + (s.note ? `\n    note: ${s.note}` : ''));
  const head = `review ${value.counts.approved}/${value.counts.total} approved`
    + (value.counts.changed ? ` · ${value.counts.changed} changed` : '')
    + (value.counts.pending ? ` · ${value.counts.pending} pending` : '');
  return [{ type: 'text', text: [head, ...lines, value.message].filter(Boolean).join('\n') }];
}

function buildReviewTool(ctx) {
  return {
    name: 'mise_review',
    description:
      'The per-shot keyframe gate: look at each shot before the film is rendered. ' +
      'Actions: "status" (default) lists every shot with its keyframe time and verdict; "keyframes" draws a missing keyframe for each shot with openfilm look and records it under .film/review/; ' +
      '"approve" marks one shot good (optionally with a note); "reject" marks one shot as needing a change and REQUIRES a note saying what. ' +
      'readyToRender is true only when every shot is approved — do not render before that. ' +
      'A shot the film no longer has drops off the list, and a new shot appears pending, so an edit cannot slip past the gate.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['status', 'keyframes', 'approve', 'reject'], description: 'Default status.' },
        cwd: { type: 'string', description: 'The film project (or a folder inside it); defaults to the session working directory.' },
        shot: { type: 'string', description: 'The shot id, as printed by status — required by approve and reject, optional for keyframes (one shot only).' },
        note: { type: 'string', description: 'For reject: what should change. For approve: optional context.' },
        force: { type: 'boolean', description: 'keyframes: redraw even when a keyframe already exists.' },
      },
    },
    output: { schema: REVIEW_OUTPUT_SCHEMA, render: renderReviewOutput },
    presentCall: (args) => ({ card: 'generic', title: `Review shots (${args?.action ?? 'status'})`, kind: 'read', rawInput: args?.shot }),
    async execute(args, exec) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx, exec?.agent);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_review: no film project around ${cwd} (no film.html found).`);
      const action = ['keyframes', 'approve', 'reject'].includes(args?.action) ? args.action : 'status';
      const shotId = typeof args?.shot === 'string' && args.shot.trim() ? args.shot.trim() : '';
      if ((action === 'approve' || action === 'reject') && !shotId) {
        throw new Error('mise_review: `shot` is required for approve/reject; run status to see the ids.');
      }

      const state = () => reviewStatus(projectPath, checkFilm(projectPath).facts);
      let message = '';

      if (action === 'keyframes') {
        const current = state();
        const targets = current.shots.filter((s) => (!shotId || s.id === shotId) && (args?.force === true || !s.keyframe));
        if (targets.length === 0) {
          message = 'every shot already has a keyframe; make one again with force.';
        } else {
          const failures = [];
          for (const shot of targets) {
            const lookDir = join(projectPath, '.film', 'cache', 'look');
            const before = newestPng(lookDir)?.mtime ?? 0;
            const run = await runOpenfilm(['look', String(shot.keyframeAt)], { ctx, cwd: projectPath, timeoutMs: 240_000, signal: exec?.signal });
            const drawn = newestPng(lookDir);
            if (run.exitCode !== 0 || !drawn || drawn.mtime <= before) {
              failures.push({ shot: shot.id, error: (run.stderr || run.stdout || 'no picture drawn').slice(0, 300) });
              continue;
            }
            const relativePath = keyframePath(shot.id);
            const target = join(projectPath, relativePath);
            mkdirSync(dirname(target), { recursive: true });
            copyFileSync(drawn.file, target);
            setShotReview(projectPath, shot.id, { state: 'pending', keyframe: relativePath, at: shot.keyframeAt });
          }
          message = failures.length
            ? `drew ${targets.length - failures.length} keyframe(s); failed: ${failures.map((f) => `${f.shot} (${f.error})`).join('; ')}`
            : `drew ${targets.length} keyframe(s) under .film/review/.`;
        }
      } else if (action === 'approve' || action === 'reject') {
        setShotReview(projectPath, shotId, {
          state: action === 'approve' ? 'approved' : 'changed',
          ...(typeof args?.note === 'string' && args.note.trim() ? { note: args.note.trim() } : {}),
        });
        message = action === 'approve'
          ? `${shotId} approved.`
          : `${shotId} marked as needing a change; fix it, then approve it.`;
      }

      const result = state();
      return {
        ok: true,
        action,
        shots: result.shots,
        counts: result.counts,
        readyToRender: result.readyToRender,
        message: [message, result.readyToRender ? 'every shot approved — safe to render.' : 'not every shot is approved yet: do not render.'].filter(Boolean).join(' '),
      };
    },
    isConcurrencySafe: () => false, // draws keyframes into the project
  };
}

/** The newest PNG in a folder, with its mtime; null when there is none. */
function newestPng(dir) {
  try {
    let best = null;
    for (const entry of readdirSync(dir)) {
      if (!entry.toLowerCase().endsWith('.png')) continue;
      const file = join(dir, entry);
      try {
        const mtime = statSync(file).mtimeMs;
        if (!best || mtime > best.mtime) best = { file, mtime };
      } catch {}
    }
    return best;
  } catch {
    return null;
  }
}

/** ── Cinematic pages: camera, grade and optics without a model ──────────── */

const CINE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    relative: { type: 'string', description: 'The page written, relative to the project.' },
    duration: { type: 'number' },
    move: { type: 'string' },
    grade: { type: 'string' },
    layers: { type: 'integer' },
    snippet: { type: 'string', description: 'The <iframe> line to cut into film.html.' },
    problems: { type: 'array', items: { type: 'string' } },
    error: { type: 'string' },
  },
  required: ['ok'],
};

function renderCineOutput(_args, value) {
  if (value?.ok !== true) {
    const lines = ['mise_cine could not write the page:'];
    for (const p of value?.problems ?? []) lines.push(`  - ${p}`);
    if (value?.error) lines.push(`  - ${value.error}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  return [{
    type: 'text',
    text: `${value.relative} — ${value.layers} layer(s), ${value.move}, ${value.grade}, ${value.duration}s.\nCut it in with:\n  ${value.snippet}`,
  }];
}

function buildCineTool(ctx) {
  return {
    name: 'mise_cine',
    description:
      'Write a cinematic shot page from a picture (or 2–3 layers) with no model and no GPU: an eased camera move (push-in, pan, tilt, dolly, handheld drift), layered parallax when layers are given, a CSS grade (warm-film, teal-orange, noir, clean, dream-soft), halation, corner falloff and film grain. ' +
      'This is the fast, portable way to make a still feel like footage; add an image-model matte or background extension as a layer when a shot needs real parallax. ' +
      'Pass `depth` (a grayscale depth map from mise_depth) for real depth-displaced parallax; without WebGL that page falls back to the same camera move. ' +
      'It writes <name>.html in the project and returns the <iframe> line to cut into film.html.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; defaults to the session working directory.' },
        name: { type: 'string', description: 'Page file name without .html, kebab-case (e.g. shot-03-cinematic).' },
        src: { type: 'string', description: 'The picture, relative to the project (one plate).' },
        depth: { type: 'string', description: 'Optional grayscale depth map (mise_depth output); turns the page into a depth-displaced shot.' },
        parallax: { type: 'number', description: 'With depth: 0..2 how far near things slide (default 1).' },
        layers: {
          type: 'array',
          description: 'Optional 2–3 pictures, far to near; each needs src and depth 0..1. Parallax comes from depth.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              src: { type: 'string' },
              depth: { type: 'number', description: '0 = far (barely moves), 1 = near (moves most).' },
            },
            required: ['src'],
          },
        },
        move: { type: 'string', description: `One of: ${Object.keys(CINE_MOVES).join(', ')}. Default push-in.` },
        grade: { type: 'string', description: `One of: ${Object.keys(CINE_GRADES).join(', ')}. Default warm-film.` },
        duration: { type: 'number', description: 'Seconds (default 5, max 120).' },
        grain: { type: 'number', description: '0..1, default 0.16.' },
        vignette: { type: 'number', description: '0..1, default 0.55.' },
        handheld: { type: 'number', description: '0..1, default 0.18. The small drift that reads as a real camera.' },
        bloom: { type: 'number', description: '0..1, default 0. A soft glow over the brightest part.' },
        force: { type: 'boolean', description: 'Overwrite an existing page of that name.' },
      },
      required: ['name'],
    },
    output: { schema: CINE_OUTPUT_SCHEMA, render: renderCineOutput },
    presentCall: (args) => ({ card: 'generic', title: `Cinematic page: ${args?.name ?? ''}`, kind: 'other', rawInput: args?.move }),
    async execute(args) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_cine: no film project around ${cwd} (no film.html found).`);
      const name = String(args?.name ?? '').trim().replace(/\.html$/i, '');
      if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(name)) throw new Error('mise_cine: `name` must be kebab-case (a-z, 0-9, -), e.g. shot-01-cinematic');

      const spec = {
        ...(typeof args?.src === 'string' && args.src ? { src: args.src } : {}),
        ...(Array.isArray(args?.layers) ? { layers: args.layers } : {}),
        ...(typeof args?.move === 'string' && args.move ? { move: args.move } : {}),
        ...(typeof args?.grade === 'string' && args.grade ? { grade: args.grade } : {}),
        ...(args?.duration !== undefined ? { duration: Number(args.duration) } : {}),
        ...(args?.grain !== undefined ? { grain: Number(args.grain) } : {}),
        ...(args?.vignette !== undefined ? { vignette: Number(args.vignette) } : {}),
        ...(args?.handheld !== undefined ? { handheld: Number(args.handheld) } : {}),
        ...(args?.bloom !== undefined ? { bloom: Number(args.bloom) } : {}),
      };
      const verdict = validateCine(spec, { exists: (rel) => existsSync(join(projectPath, rel)) });
      if (!verdict.ok) return { ok: false, problems: verdict.problems };

      // With a depth map the shot gets real parallax instead of a flat move:
      // the same parameters, one extra PNG.
      const depthRel = typeof args?.depth === 'string' && args.depth ? args.depth : '';
      if (depthRel) {
        const depthVerdict = validateDepthSpec(
          { src: spec.src, depth: depthRel, move: spec.move, grade: spec.grade, duration: spec.duration, grain: spec.grain, vignette: spec.vignette, amount: args?.parallax !== undefined ? Number(args.parallax) : undefined },
          { exists: (rel) => existsSync(join(projectPath, rel)) },
        );
        if (!depthVerdict.ok) return { ok: false, problems: depthVerdict.problems };
      }

      const relative = `${name}.html`;
      const target = join(projectPath, relative);
      if (existsSync(target) && args?.force !== true) {
        return { ok: false, problems: [`${relative} already exists; pass force to replace it`] };
      }
      const built = depthRel
        ? { html: buildDepthPage({ ...spec, depth: depthRel, ...(args?.parallax !== undefined ? { amount: Number(args.parallax) } : {}) }), duration: Number(spec.duration ?? 5) }
        : buildCinePage(spec);
      writeFileSync(target, built.html, 'utf8');
      const duration = built.duration;
      return {
        ok: true,
        relative,
        duration,
        move: spec.move ?? 'push-in',
        grade: spec.grade ?? 'warm-film',
        layers: verdict.layers.length,
        snippet: `<iframe src="${relative}#t=0,${duration}"></iframe>`,
        problems: [],
      };
    },
    isConcurrencySafe: () => false, // writes a page into the project
  };
}

/** ── Type and graphics: the two code-native primitives with no picture ───── */

const TYPE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    relative: { type: 'string' },
    lines: { type: 'integer' },
    motion: { type: 'string' },
    duration: { type: 'number' },
    snippet: { type: 'string' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok'],
};

function renderTypeOutput(_args, value) {
  if (value?.ok !== true) {
    const lines = ['mise_type could not write the page:'];
    for (const p of value?.problems ?? []) lines.push(`  - ${p}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  return [{ type: 'text', text: `${value.relative} — ${value.lines} line(s), ${value.motion}, ${value.duration}s.\nCut it in with:\n  ${value.snippet}` }];
}

function buildTypeTool(ctx) {
  return {
    name: 'mise_type',
    description:
      'Write a typographic shot: headline type that rises through a mask, tracks in, blurs in or lands word by word, with a light sweep, rules and grain. ' +
      'This is where code video beats generative video outright — exact kerning and a mask line that moves with the type at any frame rate. ' +
      'Use it for openings, chapter cards, claims and end cards.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; defaults to the session working directory.' },
        name: { type: 'string', description: 'Page file name without .html, kebab-case.' },
        lines: {
          type: 'array',
          description: '1–4 lines; the first is the headline.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              text: { type: 'string' },
              size: { type: 'number', description: 'px; default 118 for line 1, 46 otherwise.' },
              kicker: { type: 'string', description: 'Small uppercase label above the line.' },
            },
            required: ['text'],
          },
        },
        motion: { type: 'string', description: `One of: ${TYPE_MOTIONS.join(', ')}. Default mask-rise.` },
        palette: { type: 'string', description: `One of: ${Object.keys(TYPE_PALETTES).join(', ')}. Default amber.` },
        duration: { type: 'number', description: 'Seconds (default 4).' },
        stagger: { type: 'number', description: 'Per-unit delay in seconds (default 0.055).' },
        align: { type: 'string', enum: ['left', 'center'], description: 'Default center.' },
        grain: { type: 'number', description: '0..1, default 0.1.' },
        sweep: { type: 'number', description: '0..1 light sweep, default 0.6.' },
        force: { type: 'boolean', description: 'Overwrite an existing page of that name.' },
      },
      required: ['name', 'lines'],
    },
    output: { schema: TYPE_OUTPUT_SCHEMA, render: renderTypeOutput },
    presentCall: (args) => ({ card: 'generic', title: `Type shot: ${args?.name ?? ''}`, kind: 'other', rawInput: `${args?.lines?.length ?? 0} lines` }),
    async execute(args) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_type: no film project around ${cwd} (no film.html found).`);
      const name = String(args?.name ?? '').trim().replace(/\.html$/i, '');
      if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(name)) throw new Error('mise_type: `name` must be kebab-case');
      const spec = {
        lines: Array.isArray(args?.lines) ? args.lines.map((line) => ({
          text: String(line?.text ?? ''),
          ...(line?.size !== undefined ? { size: Number(line.size) } : {}),
          ...(typeof line?.kicker === 'string' && line.kicker ? { kicker: line.kicker } : {}),
        })) : [],
        ...(typeof args?.motion === 'string' && args.motion ? { motion: args.motion } : {}),
        ...(typeof args?.palette === 'string' && args.palette ? { palette: args.palette } : {}),
        ...(args?.duration !== undefined ? { duration: Number(args.duration) } : {}),
        ...(args?.stagger !== undefined ? { stagger: Number(args.stagger) } : {}),
        ...(typeof args?.align === 'string' ? { align: args.align === 'left' ? 'left' : 'center' } : {}),
        ...(args?.grain !== undefined ? { grain: Number(args.grain) } : {}),
        ...(args?.sweep !== undefined ? { sweep: Number(args.sweep) } : {}),
      };
      const verdict = validateTypeSpec(spec);
      if (!verdict.ok) return { ok: false, problems: verdict.problems };
      const relative = `${name}.html`;
      if (existsSync(join(projectPath, relative)) && args?.force !== true) return { ok: false, problems: [`${relative} already exists; pass force to replace it`] };
      writeFileSync(join(projectPath, relative), buildTypePage(spec), 'utf8');
      return { ok: true, relative, lines: spec.lines.length, motion: spec.motion ?? 'mask-rise', duration: Number(spec.duration ?? 4), snippet: `<iframe src="${relative}#t=0,${Number(spec.duration ?? 4)}"></iframe>` };
    },
    isConcurrencySafe: () => false,
  };
}

const GRAPHICS_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    relative: { type: 'string' },
    mode: { type: 'string' },
    duration: { type: 'number' },
    snippet: { type: 'string' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok'],
};

function renderGraphicsOutput(_args, value) {
  if (value?.ok !== true) {
    const lines = ['mise_graphics could not write the page:'];
    for (const p of value?.problems ?? []) lines.push(`  - ${p}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  return [{ type: 'text', text: `${value.relative} — ${value.mode}, ${value.duration}s.\nCut it in with:\n  ${value.snippet}` }];
}

function buildGraphicsTool(ctx) {
  return {
    name: 'mise_graphics',
    description:
      'Write a procedural graphics shot drawn on canvas: "chart" grows bars from zero with counting labels and a grid (numbers exactly true), ' +
      '"particles" assembles a word from thousands of dots flying into place (the premium logo/opening move), ' +
      '"pulse" breathes with the score — pass `audio` (a WAV in the project) and its loudness envelope drives rings and radial bars. ' +
      'All three are pure functions of t with seeded positions — no video model, no picture needed.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; defaults to the session working directory.' },
        name: { type: 'string', description: 'Page file name without .html, kebab-case.' },
        mode: { type: 'string', enum: GRAPHICS_MODES, description: 'chart, particles or pulse.' },
        audio: { type: 'string', description: 'pulse: the WAV (e.g. the score) whose loudness drives the rings.' },
        title: { type: 'string', description: 'chart: the line above the plot.' },
        items: {
          type: 'array',
          description: 'chart: 2–8 bars.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              label: { type: 'string' },
              value: { type: 'number' },
              unit: { type: 'string' },
            },
            required: ['label', 'value'],
          },
        },
        text: { type: 'string', description: 'particles: the word to assemble.' },
        dots: { type: 'number', description: 'particles: 200..12000 dots (default 2600).' },
        palette: { type: 'string', description: `One of: ${Object.keys(TYPE_PALETTES).join(', ')}. Default amber.` },
        duration: { type: 'number', description: 'Seconds (default 5).' },
        grain: { type: 'number', description: '0..1, default 0.1.' },
        force: { type: 'boolean', description: 'Overwrite an existing page of that name.' },
      },
      required: ['name', 'mode'],
    },
    output: { schema: GRAPHICS_OUTPUT_SCHEMA, render: renderGraphicsOutput },
    presentCall: (args) => ({ card: 'generic', title: `Graphics shot: ${args?.name ?? ''}`, kind: 'other', rawInput: args?.mode }),
    async execute(args) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_graphics: no film project around ${cwd} (no film.html found).`);
      const name = String(args?.name ?? '').trim().replace(/\.html$/i, '');
      if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(name)) throw new Error('mise_graphics: `name` must be kebab-case');
      const spec = {
        mode: typeof args?.mode === 'string' ? args.mode : 'chart',
        ...(typeof args?.title === 'string' ? { title: args.title } : {}),
        ...(Array.isArray(args?.items) ? { items: args.items.map((item) => ({ label: String(item?.label ?? ''), value: Number(item?.value), ...(typeof item?.unit === 'string' ? { unit: item.unit } : {}) })) } : {}),
        ...(typeof args?.text === 'string' ? { text: args.text } : {}),
        ...(args?.dots !== undefined ? { dots: Number(args.dots) } : {}),
        ...(typeof args?.palette === 'string' && args.palette ? { palette: args.palette } : {}),
        ...(args?.duration !== undefined ? { duration: Number(args.duration) } : {}),
        ...(args?.grain !== undefined ? { grain: Number(args.grain) } : {}),
      };
      // Pulse reads the score once, here, and bakes its envelope into the page:
      // the picture follows the sound without an audio engine in the renderer.
      if (spec.mode === 'pulse') {
        const audio = typeof args?.audio === 'string' ? args.audio : '';
        if (!audio) return { ok: false, problems: ['pulse needs `audio` — a WAV in the project (e.g. the score)'] };
        const audioPath = join(projectPath, audio);
        if (!existsSync(audioPath)) return { ok: false, problems: [`not found in the project: ${audio}`] };
        let env;
        try {
          env = wavEnvelope(readFileSync(audioPath), { fps: 30 });
        } catch (error) {
          return { ok: false, problems: [error instanceof Error ? error.message : String(error)] };
        }
        spec.envelope = envelopeForPage(env);
        spec.fps = 30;
        if (spec.duration === undefined) spec.duration = Number(Math.min(60, Math.max(2, Math.round(env.duration))));
      }
      const verdict = validateGraphicsSpec(spec);
      if (!verdict.ok) return { ok: false, problems: verdict.problems };
      const relative = `${name}.html`;
      if (existsSync(join(projectPath, relative)) && args?.force !== true) return { ok: false, problems: [`${relative} already exists; pass force to replace it`] };
      writeFileSync(join(projectPath, relative), buildGraphicsPage(spec), 'utf8');
      return { ok: true, relative, mode: spec.mode, duration: Number(spec.duration ?? 5), snippet: `<iframe src="${relative}#t=0,${Number(spec.duration ?? 5)}"></iframe>` };
    },
    isConcurrencySafe: () => false,
  };
}

/** ── Sign-off: a person's verdict on the cut, not a number ─────────────── */

const SIGNOFF_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    relative: { type: 'string' },
    status: { type: 'string', description: 'missing | approved | rejected | stale' },
    by: { type: 'string' },
    note: { type: 'string' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'status'],
};

function renderSignoffOutput(_args, value) {
  if (value?.ok !== true) {
    const lines = ['mise_signoff could not record the verdict:'];
    for (const p of value?.problems ?? []) lines.push(`  - ${p}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  const labels = { approved: '已批准', rejected: '已否决', stale: '已过期', missing: '未签收' };
  return [{ type: 'text', text: `${labels[value.status] ?? value.status}${value.by ? `：${value.by}` : ''}${value.note ? ` — ${value.note}` : ''}\n记录：${value.relative ?? '.film/signoff.json'}` }];
}

function buildSignoffTool(ctx) {
  return {
    name: 'mise_signoff',
    description:
      'Record a human verdict on the current cut: approved or rejected, with who and why. ' +
      'Machine checks can only say the file is well formed; they cannot say the film is good. The verdict is tied to the film\'s mtime, so editing the film after a sign-off makes it stale instead of silently valid.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; defaults to the session working directory.' },
        verdict: { type: 'string', enum: ['approved', 'rejected'], description: 'The human decision.' },
        by: { type: 'string', description: 'Who signed (a name or role).' },
        note: { type: 'string', description: 'Why — especially required for a rejection.' },
      },
      required: ['verdict'],
    },
    output: { schema: SIGNOFF_OUTPUT_SCHEMA, render: renderSignoffOutput },
    presentCall: (args) => ({ card: 'generic', title: `Sign-off: ${args?.verdict ?? ''}`, kind: 'other', rawInput: args?.by }),
    async execute(args) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_signoff: no film project around ${cwd} (no film.html found).`);
      const verdict = args?.verdict === 'approved' ? 'approved' : args?.verdict === 'rejected' ? 'rejected' : '';
      if (!verdict) return { ok: false, status: 'missing', problems: ['verdict must be approved or rejected'] };
      const note = typeof args?.note === 'string' ? args.note.trim() : '';
      if (verdict === 'rejected' && !note) return { ok: false, status: 'missing', problems: ['a rejection needs a note saying what is wrong'] };

      let filmMtimeMs = 0;
      try { filmMtimeMs = statSync(join(projectPath, 'film.html')).mtimeMs; } catch {}
      const signoff = {
        version: 1,
        at: new Date().toISOString(),
        by: typeof args?.by === 'string' && args.by.trim() ? args.by.trim() : '未署名',
        verdict,
        note,
        filmMtimeMs,
      };
      mkdirSync(join(projectPath, '.film'), { recursive: true });
      writeFileSync(join(projectPath, '.film', 'signoff.json'), `${JSON.stringify(signoff, null, 2)}\n`, 'utf8');
      return { ok: true, relative: '.film/signoff.json', status: verdict, by: signoff.by, note, problems: [] };
    },
    isConcurrencySafe: () => false,
  };
}

/** ── Delivery: the last step, measured ─────────────────────────────────── */

const DELIVER_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    output: { type: 'string' },
    ladder: { type: 'array', items: { type: 'string' } },
    media: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: { type: 'number' },
        height: { type: 'number' },
        fps: { type: 'number' },
        duration: { type: 'number' },
        video: { type: 'string' },
        audio: { type: 'string' },
        channels: { type: 'number' },
        sampleRate: { type: 'number', description: 'Audio sample rate in Hz, measured.' },
        audioDuration: { type: 'number', description: 'Audio stream length in seconds, measured.' },
      },
    },
    compare: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
    },
    loudness: {
      type: 'object',
      additionalProperties: false,
      properties: {
        integrated: { type: 'number' },
        truePeak: { type: 'number' },
        lra: { type: 'number' },
      },
    },
    compare: {
      type: 'array',
      description: 'Per shot differences between two renders, in film order.',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          time: { type: 'number' },
          ok: { type: 'boolean' },
          changedPercent: { type: 'number' },
          meanDiff: { type: 'number' },
          brightnessBefore: { type: 'number' },
          brightnessAfter: { type: 'number' },
          centroidShift: { type: 'number' },
        },
      },
    },
    relative: { type: 'string' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok'],
};

function renderDeliverOutput(_args, value) {
  if (value?.ok !== true) {
    const lines = ['mise_deliver could not finish:'];
    for (const p of value?.problems ?? []) lines.push(`  - ${p}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  const m = value.media ?? {};
  const l = value.loudness ?? {};
  return [{
    type: 'text',
    text: [
      `${value.output}`,
      `  ${m.width}×${m.height} · ${m.fps} fps · ${m.duration}s · ${m.video}/${m.audio ?? 'no audio'}${m.channels ? ` ${m.channels}ch` : ''}`,
      `  loudness ${l.integrated ?? '?'} LUFS · peak ${l.truePeak ?? '?'} dBTP`,
      `  ladder: ${(value.ladder ?? []).join(' → ')}`,
      `  record: ${value.relative}`,
    ].join('\n'),
  }];
}

/** Probe one file into the fields a delivery record needs. */
function probeDelivery(file) {
  const run = spawnSync(toolPath('ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  if (run.status !== 0) return null;
  let json;
  try { json = JSON.parse(run.stdout); } catch { return null; }
  const video = (json.streams ?? []).find((stream) => stream.codec_type === 'video') ?? {};
  const audioStream = (json.streams ?? []).find((stream) => stream.codec_type === 'audio') ?? null;
  const [num, den] = String(video.avg_frame_rate ?? '0/0').split('/').map(Number);
  return {
    width: Number(video.width ?? 0),
    height: Number(video.height ?? 0),
    fps: den ? Number((num / den).toFixed(2)) : null,
    duration: Number(json.format?.duration ?? 0),
    video: String(video.codec_name ?? ''),
    audio: audioStream ? String(audioStream.codec_name ?? '') : null,
    channels: Number(audioStream?.channels ?? 0),
    // The audio stream's own length: a score that outlasts the picture is a
    // timing bug that only shows up on the delivered file.
    audioDuration: Number(audioStream?.duration ?? json.format?.duration ?? 0),
    sampleRate: Number(audioStream?.sample_rate ?? 0),
  };
}

/** Measure loudness with loudnorm's analysis pass (no filtering, just numbers). */
function measureLoudness(file) {
  const run = spawnSync(toolPath('ffmpeg'), ['-hide_banner', '-nostats', '-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true, timeout: 300_000 });
  return parseLoudnorm(run.stderr ?? '');
}

/** The file the previous delivery produced, when the record says so. */
function previousDeliveredPath(projectPath) {
  try {
    const record = JSON.parse(readFileSync(join(projectPath, '.film', 'delivery.json'), 'utf8'));
    const output = typeof record?.output === 'string' ? record.output : '';
    if (!output) return undefined;
    const full = join(projectPath, output);
    return existsSync(full) ? full : undefined;
  } catch {
    return undefined;
  }
}

/** The copy of the previous delivery taken at the start of this run. */
function lastSnapshotPath(projectPath) {
  const path = join(projectPath, '.film', 'last-delivery.mp4');
  return existsSync(path) ? path : undefined;
}

function buildDeliverTool(ctx) {
  return {
    name: 'mise_deliver',
    description:
      'Finish and record a film in one step: check the export gate, apply the grade (preset from the plan when there is one), optionally lift the frame rate, then measure the result with ffprobe and loudnorm and write .film/delivery.json. ' +
      'Nothing in the record is guessed: size, duration, codecs and loudness are read from the file that was actually produced. A closed gate refuses unless force is set.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; defaults to the session working directory.' },
        input: { type: 'string', description: 'Rendered clip to finish; defaults to the newest mp4.' },
        fps: { type: 'number', description: 'Lift to this frame rate at the end (0 = keep, default 0).' },
        preset: { type: 'string', description: `Grade preset; defaults to the plan's, else warm-film.` },
        letterbox: { type: 'number', description: `Per-bar fraction; defaults to the plan's.` },
        grain: { type: 'number', description: '0..1, default 0.1.' },
        vignette: { type: 'number', description: '0..1, default 0.32.' },
        bloom: { type: 'number', description: '0..1, default 0.12.' },
        normalize: { type: 'boolean', description: 'Normalise the mix to -16 LUFS / -1.5 dBTP on the way out (default true).' },
        force: { type: 'boolean', description: 'Finish even when the export gate is closed.' },
      },
    },
    output: { schema: DELIVER_OUTPUT_SCHEMA, render: renderDeliverOutput },
    presentCall: (args) => ({ card: 'generic', title: 'Deliver the film', kind: 'other', rawInput: args?.input ?? '(newest mp4)' }),
    async execute(args) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_deliver: no film project around ${cwd} (no film.html found).`);

      let plan = null;
      try { plan = JSON.parse(readFileSync(join(projectPath, '.film', 'plan.json'), 'utf8')); } catch { plan = null; }

      const gate = projectGate(projectPath);
      if (!gate.ok && args?.force !== true) {
        return { ok: false, problems: [`export gate closed — ${gate.blockers.join('; ')}`, 'fix the gate, or pass force to deliver anyway'] };
      }

      // A person's rejection outranks a green machine report: do not ship a cut
      // somebody already looked at and refused.
      let signoffState = { status: 'missing', by: '', note: '', at: '' };
      try {
        const signoff = JSON.parse(readFileSync(join(projectPath, '.film', 'signoff.json'), 'utf8'));
        signoffState = signoffVerdict({ signoff, filmMtimeMs: statSync(join(projectPath, 'film.html')).mtimeMs });
      } catch { signoffState = { status: 'missing', by: '', note: '', at: '' }; }
      if (signoffState.status === 'rejected' && args?.force !== true) {
        return { ok: false, problems: [`human sign-off rejected${signoffState.by ? ` by ${signoffState.by}` : ''}: ${signoffState.note || 'no note'}`, 'address the note, or pass force to deliver anyway'] };
      }

      const probe = probeFfmpeg();
      if (!probe.ok) return { ok: false, problems: ['ffmpeg not found on PATH (or DSH_FFMPEG)'] };

      let input = typeof args?.input === 'string' && args.input ? args.input : '';
      if (!input) {
        const newest = readdirSync(projectPath).filter((n) => n.toLowerCase().endsWith('.mp4') && !/-delivered|-graded|-\d+\.mp4$/i.test(n))
          .map((n) => ({ n, m: statSync(join(projectPath, n)).mtimeMs }))
          .sort((a, b) => b.m - a.m)[0];
        if (!newest) return { ok: false, problems: ['no mp4 in the project yet; render one first'] };
        input = newest.n;
      }

      const ladder = ['gate'];
      // Copy the previous delivery aside before this run overwrites it, so the
      // comparison below has something to compare against.
      let snapshotPath = null;
      try {
        const prior = previousDeliveredPath(projectPath);
        if (prior) {
          snapshotPath = join(projectPath, '.film', 'last-delivery.mp4');
          copyFileSync(prior, snapshotPath);
        }
      } catch { snapshotPath = null; }

      let deliveryLook = null;
      // The score's design, read from the plan: the receipt should be able to
      // reproduce the sound, not just report its loudness.
      const scorePath = join(projectPath, 'assets', 'score.wav');
      const scoreDesign = plan?.score ? {
        mood: String(plan.score.mood ?? ''),
        bpm: Number(plan.score.bpm ?? 0),
        groove: String(plan.score.groove ?? ''),
        grid: Number(plan.score.grid ?? 0),
        voices: 7,
        synth: existsSync(scorePath) ? '代码合成：Karplus-Strong 拨弦 + 低通铺底 + Schroeder 混响' : '',
      } : null;
      // Length decides the loudness target, so it has to be known before grading.
      const inputSeconds = Number(probeDelivery(join(projectPath, input))?.duration ?? 0);
      const base = input.replace(/\.mp4$/i, '');
      const gradePath = `${base}-delivered.mp4`;
      const gradePlan = planGrade({
        input: join(projectPath, input),
        output: join(projectPath, gradePath),
        preset: typeof args?.preset === 'string' ? args.preset : (plan?.grade?.preset ?? undefined),
        letterbox: args?.letterbox !== undefined ? Number(args.letterbox) : (plan?.grade?.letterbox ?? undefined),
        // The recipe's look is the default, not a suggestion: a launch film and
        // a memory film must not be finished with identical grain and glow.
        grain: args?.grain !== undefined ? Number(args.grain) : (plan?.grade?.grain ?? undefined),
        vignette: args?.vignette !== undefined ? Number(args.vignette) : (plan?.grade?.vignette ?? undefined),
        bloom: args?.bloom !== undefined ? Number(args.bloom) : (plan?.grade?.bloom ?? undefined),
        normalizeAudio: args?.normalize !== false,
        ...(Number.isFinite(inputSeconds) && inputSeconds > 0 ? { seconds: inputSeconds } : {}),
        ...(args?.targetLufs !== undefined ? { targetLufs: Number(args.targetLufs) } : {}),
      }, { filters: probe.filters });
      if (!gradePlan.ok) return { ok: false, problems: gradePlan.problems };
      deliveryLook = {
        preset: typeof args?.preset === 'string' ? args.preset : (plan?.grade?.preset ?? 'warm-film'),
        grain: Number(args?.grain ?? plan?.grade?.grain ?? 0.1),
        bloom: Number(args?.bloom ?? plan?.grade?.bloom ?? 0),
        vignette: Math.min(0.16, Math.max(0, Number(args?.vignette ?? plan?.grade?.vignette ?? 0.35))),
        letterbox: Number(args?.letterbox ?? plan?.grade?.letterbox ?? 0),
      };
      const graded = spawnSync(toolPath('ffmpeg'), gradePlan.args, { encoding: 'utf8', windowsHide: true, timeout: 60 * 60 * 1000 });
      if (graded.status !== 0 || !existsSync(join(projectPath, gradePath))) {
        return { ok: false, problems: [`grade failed: ${(graded.stderr || '').slice(0, 300) || 'no output'}`] };
      }
      ladder.push('grade');

      let finalPath = gradePath;
      const fps = Number(args?.fps ?? 0);
      if (Number.isFinite(fps) && fps > 0) {
        if (!probe.filters.includes('minterpolate')) return { ok: false, problems: ['this ffmpeg has no minterpolate filter; deliver at the rendered frame rate'] };
        const interpPath = `${base}-delivered-${fps}.mp4`;
        const interpPlan = planInterpolation({ input: join(projectPath, gradePath), output: join(projectPath, interpPath), fps, mode: 'mci' });
        if (!interpPlan.ok) return { ok: false, problems: interpPlan.problems };
        const run = spawnSync(toolPath('ffmpeg'), interpPlan.args, { encoding: 'utf8', windowsHide: true, timeout: 60 * 60 * 1000 });
        if (run.status !== 0 || !existsSync(join(projectPath, interpPath))) {
          return { ok: false, problems: [`interpolation failed: ${(run.stderr || '').slice(0, 300) || 'no output'}`] };
        }
        finalPath = interpPath;
        ladder.push(`interpolate ${fps}fps`);
      }

      // What changed since the last delivery: the same film, measured per shot.
      // The previous file may be the very path this run writes, so it was copied
      // to a snapshot before grading started.
      let deliveryChanges = null;
      try {
        const previousOutput = lastSnapshotPath(projectPath) ?? previousDeliveredPath(projectPath);
        if (previousOutput && existsSync(previousOutput) && join(projectPath, finalPath) !== previousOutput) {
          const storyboard = describeStoryboard(projectPath);
          const times = (storyboard.beats ?? [])
            .filter((beat) => beat.length > 0 && !/^join-/.test(String(beat.page ?? '')))
            .map((beat) => Number((beat.at + beat.length / 2).toFixed(2)));
          if (times.length) {
            const compared = await compareFrames({
              times,
              before: previousOutput,
              after: join(projectPath, finalPath),
              width: 480,
            });
            const labelForShot = (at) => {
              const beat = (storyboard.beats ?? []).find((entry) => at >= entry.at - 0.01 && at < entry.at + entry.length);
              if (!beat) return '';
              const kindLabel = { title: '标题', type: '排版', scene: '场景', graphics: '图表', number: '数字', claim: '主张', end: '片尾' }[String(beat.kind ?? '')] ?? String(beat.kind ?? '');
              const extras = [kindLabel, beat.claim].filter(Boolean).join(' · ');
              return `第${beat.index}镜${extras ? ` · ${extras}` : ''}`;
            };
            deliveryChanges = compared.shots
              .filter((row) => row.ok)
              .sort((a, b) => b.changedPercent - a.changedPercent || b.meanDiff - a.meanDiff)
              .slice(0, 4)
              .map((row) => ({
                shot: labelForShot(row.time),
                at: row.time,
                changedPercent: row.changedPercent,
                brightnessBefore: row.brightnessBefore,
                brightnessAfter: row.brightnessAfter,
                centroidShift: row.centroidShift,
              }));
          }
        }
      } catch { deliveryChanges = null; }

      const media = probeDelivery(join(projectPath, finalPath));
      const loudness = media && media.audio ? measureLoudness(join(projectPath, finalPath)) : { integrated: null, truePeak: null, lra: null };
      // With no audio there is nothing to judge: "no audio track" is already a
      // problem, and repeating it as unmeasured loudness is just noise.
      const loudnessCheck = media?.audio ? loudnessVerdict(loudness) : { ok: true, problems: [] };
      const record = deliveryManifest({
        filmPath: 'film.html',
        sourcePath: input,
        outputPath: finalPath,
        ladder,
        media: media ?? {},
        loudness,
        gate: { ok: gate.ok, blockers: gate.blockers, ...(args?.force === true && !gate.ok ? { overridden: true } : {}) },
        ...(deliveryLook ? { grade: deliveryLook } : {}),
        ...(scoreDesign ? { score: scoreDesign } : {}),
        ...(deliveryChanges && deliveryChanges.length ? { changes: deliveryChanges } : {}),
      });
      record.problems.push(...loudnessCheck.problems);
      record.ok = record.ok && loudnessCheck.ok;

      // Read the previous record before overwriting it: the receipt should say
      // whether this delivery is better or worse than the last one.
      let previousRecord = null;
      try { previousRecord = JSON.parse(readFileSync(join(projectPath, '.film', 'delivery.json'), 'utf8')); } catch { previousRecord = null; }

      mkdirSync(join(projectPath, '.film'), { recursive: true });
      writeFileSync(join(projectPath, '.film', 'delivery.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');

      // The receipt repeats only recorded facts, so a producer can judge the
      // delivery without opening the project.
      let reviewForReceipt = null;
      try { reviewForReceipt = reviewStatus(projectPath, checkFilm(projectPath).facts).counts; } catch { reviewForReceipt = null; }
      let acceptanceForReceipt = null;
      try {
        const verifyRec = JSON.parse(readFileSync(join(projectPath, '.film', 'verify.json'), 'utf8'));
        const filmMtime = statSync(join(projectPath, 'film.html')).mtimeMs;
        acceptanceForReceipt = {
          ok: verifyRec.ok === true,
          fresh: isFresh(verifyRec, filmMtime),
          checked: verifyRec.checked ?? 0,
          ...(existsSync(join(projectPath, '.film', 'contact-sheet.png')) ? { contactSheet: '.film/contact-sheet.png' } : {}),
        };
      } catch { acceptanceForReceipt = null; }
      const receipt = deliveryReceipt({
        record,
        plan: plan ? {
          genre: plan.genre,
          label: plan.label,
          seconds: plan.seconds,
          // Count the film's own shot track, not the plan's beats: a presentation
          // join adds a clip, and the receipt must agree with the review count.
          shots: (() => { try { return describeShots(readFileSync(join(projectPath, 'film.html'), 'utf8')).length; } catch { return Array.isArray(plan.beats) ? plan.beats.length : 0; } })(),
          pacing: plan.pacing ?? '',
          transition: plan.transition ?? '',
          moves: Array.isArray(plan.beats) ? plan.beats.map((beat) => beat.move ?? 'still') : [],
          claims: plan.claims?.assignments?.length ?? 0,
        } : null,
        review: reviewForReceipt,
        acceptance: acceptanceForReceipt,
        problems: record.problems,
        signoff: signoffState,
        loudnessTarget: targetLufs(Number(media?.duration ?? inputSeconds)),
        loudnessNote: loudnessReason(Number(media?.duration ?? inputSeconds)),
        ...(previousRecord ? { previous: previousRecord } : {}),
      });
      writeFileSync(join(projectPath, '.film', 'delivery.md'), `${receipt}\n`, 'utf8');

      return {
        ok: record.ok,
        output: finalPath,
        ladder,
        media: media ?? {},
        loudness: {
          integrated: loudness.integrated ?? 0,
          truePeak: loudness.truePeak ?? 0,
          lra: loudness.lra ?? 0,
        },
        relative: '.film/delivery.md',
        problems: record.problems,
      };
    },
    isConcurrencySafe: () => false, // writes a delivered file and a record
  };
}

/** ── Demo: one command that proves the whole chain works here ───────────── */

const DEMO_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    project: { type: 'string' },
    pages: { type: 'array', items: { type: 'string' } },
    seconds: { type: 'number' },
    rendered: { type: 'string' },
    verified: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        checked: { type: 'integer' },
        problems: { type: 'array', items: { type: 'string' } },
        contactSheet: { type: 'string', description: 'One picture of the checked frames.' },
      },
      required: ['ok', 'checked'],
    },
    delivered: { type: 'string' },
    problems: { type: 'array', items: { type: 'string' } },
    next: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok'],
};

function renderDemoOutput(_args, value) {
  if (value?.ok !== true) {
    const lines = ['mise_demo could not build the demo:'];
    for (const p of value?.problems ?? []) lines.push(`  - ${p}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  const lines = [
    `样片工程：${value.project}`,
    `  ${value.pages.length} 个页面 · ${value.seconds}s${value.rendered ? ` · 已渲染 ${value.rendered}` : ' · 未渲染'}`,
  ];
  for (const page of value.pages) lines.push(`  - ${page}`);
  for (const step of value.next ?? []) lines.push(`→ ${step}`);
  return [{ type: 'text', text: lines.join('\n') }];
}

/** Map a planned camera move onto what the scene page can actually do. */
function sceneMoveFor(move) {
  switch (move) {
    case 'push-in': return 'dolly-through';
    case 'drift-up': return 'rise';
    case 'pan-right': return 'orbit-right';
    case 'pan-left': return 'orbit-left';
    case 'orbit': return 'orbit-right';
    case 'handheld': return 'dolly-through';
    default: return 'rise';
  }
}

/** Map a planned claim onto the chart page: the sentence, and its own bars. */
function claimChartCopy(claim) {
  const evidence = claim?.evidence ?? {};
  if (evidence.kind === 'chart' && Array.isArray(evidence.items) && evidence.items.length >= 2) {
    return { title: claim.claim, items: evidence.items.map((item) => ({ label: String(item.label), value: Number(item.value) })) };
  }
  if (evidence.kind === 'number' && Number.isFinite(evidence.value)) {
    return {
      title: claim.claim,
      items: [{ label: String(evidence.unit ?? '值'), value: Number(evidence.value) }, { label: '基准', value: 1 }],
    };
  }
  return null;
}

/** One generic line of demo copy per beat kind, so the sample reads as a film. */
function demoCopy(kind, index, subject) {
  if (kind === 'title') {
    return {
      lines: [
        { text: 'A FILM IN CODE', role: 'eyebrow' },
        { text: subject },
        { text: '没有视频模型，也没有素材', role: 'sub' },
        { text: '全部由代码绘制 · openfilm', role: 'note' },
      ],
    };
  }
  // Every kind must draw something: a skipped beat leaves a hole in the film.
  if (kind === 'type') return { lines: [{ text: '每一帧都是画出来的', kicker: 'drawn, not generated' }] };
  if (kind === 'end') return { lines: [{ text: '全部由代码绘制', kicker: 'no video model' }] };
  if (kind === 'graphics') return { mode: index % 2 === 0 ? 'chart' : 'particles', title: '一帧的成本', items: [{ label: '代码', value: 1 }, { label: '渲染', value: 2 }, { label: '配乐', value: 1 }], text: 'OPENFILM' };
  // A camera that travels the full depth pushes the panels out of frame by the
  // middle of a short beat (a near-black shot). "rise" keeps the world on
  // screen for the whole length, which is what a sample must do.
  if (kind === 'scene') return { move: 'rise', panels: [{ text: '场景', sub: '面板在空间里' }, { text: '运镜', sub: '摄影机缓慢移动' }, { text: '光', sub: '和尘埃' }] };
  if (kind === 'pulse') return { mode: 'particles', text: '声画同步' };
  if (kind === 'keyframes') return { panels: [{ text: '关键帧', sub: '姿态之间的过渡' }, { text: '节奏', sub: '落在切点上' }] };
  return null;
}

function buildDemoTool(ctx) {
  return {
    name: 'mise_demo',
    description:
      'Build a complete sample film from the engine itself — plan, pages, cut-aligned score, film.html — and optionally render it, so a new installation can prove the whole chain on the spot. ' +
      'No pictures and no models: every frame is drawn by code. Use it to sanity-check a machine, to show what the plugin can do, or as the starting skeleton of a real film.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'Where to build the sample (defaults to the session working directory).' },
        name: { type: 'string', description: 'Folder name for the sample (default openfilm-demo).' },
        genre: { type: 'string', enum: Object.keys(GENRES), description: 'Recipe to sample (default title-sequence).' },
        seconds: { type: 'number', description: 'Target length (default 16).' },
        subject: { type: 'string', description: 'Headline of the sample (default 代码生成的影像).' },
        render: { type: 'boolean', description: 'Render the MP4 now (default true; takes about a minute).' },
        finish: { type: 'boolean', description: 'After rendering, accept the frames and deliver with a receipt (default true).' },
        autoApprove: { type: 'boolean', description: 'Demo-only: approve every shot with a note saying it was automatic (default false).' },
        claims: {
          type: 'array',
          description: 'Optional: one claim per proof shot ({ text, evidence }). The graphics shot then shows that claim and its own numbers.',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              text: { type: 'string' },
              evidence: { type: 'object', additionalProperties: true, properties: { kind: { type: 'string' } } },
            },
            required: ['text', 'evidence'],
          },
        },
        force: { type: 'boolean', description: 'Rebuild pages even when the sample folder already exists.' },
      },
    },
    output: { schema: DEMO_OUTPUT_SCHEMA, render: renderDemoOutput },
    presentCall: (args) => ({ card: 'generic', title: 'Build a demo film', kind: 'other', rawInput: args?.genre ?? 'title-sequence' }),
    async execute(args, exec) {
      const base = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const name = String(args?.name ?? 'openfilm-demo').replace(/[^A-Za-z0-9._-]+/g, '-');
      const projectPath = join(base, name);
      if (existsSync(projectPath) && args?.force !== true) {
        const existing = readdirSync(projectPath).filter((n) => n.endsWith('.html') || n.endsWith('.mp4'));
        if (existing.length) return { ok: false, problems: [`${name} already exists with content; pass force to rebuild it`] };
      }
      mkdirSync(join(projectPath, 'assets'), { recursive: true });

      const plan = planProduction({
        genre: typeof args?.genre === 'string' ? args.genre : 'title-sequence',
        seconds: args?.seconds !== undefined ? Number(args.seconds) : 16,
        ...(Array.isArray(args?.claims) && args.claims.length ? { claims: args.claims } : {}),
      });
      mkdirSync(join(projectPath, '.film'), { recursive: true });

      const subject = typeof args?.subject === 'string' && args.subject.trim() ? args.subject.trim() : '代码生成的影像';
      const pages = [];
      const entries = [];
        const LAYOUT_CENTROID = {
          editorial: { x: 0.34, y: 0.5 },
          right: { x: 0.66, y: 0.5 },
          lower: { x: 0.35, y: 0.78 },
          corner: { x: 0.66, y: 0.78 },
          center: { x: 0.5, y: 0.5 },
        };
      let previousSpot = null;
      const chosenLayouts = [];
      /**
       * Which layout to use for this text shot: the one whose centre of weight is
       * farthest from the previous shot's. A film whose shots alternate sides
       * reads as edited; one that advances down a list reads as a template.
       */
      const chooseLayout = (index) => {
        const candidates = ['editorial', 'right', 'lower', 'corner'];
        if (index === 0 || !previousSpot) return 'editorial';
        let best = candidates[0];
        let bestDistance = -1;
        for (const layout of candidates) {
          const spot = LAYOUT_CENTROID[layout];
          const distance = Math.hypot(spot.x - previousSpot.x, spot.y - previousSpot.y);
          if (distance > bestDistance) { bestDistance = distance; best = layout; }
        }
        return best;
      };
      plan.beats.forEach((beat, index) => {
        const copy = demoCopy(beat.kind, index, subject);
        if (!copy) return;
        // A shot that carries a claim shows that claim and its own numbers, not
        // placeholder bars: the plan already paired them, so the picture uses
        // the pairing instead of inventing content beside it.
        const claim = plan.claims?.assignments?.find((assignment) => assignment.beat === beat.index);
        const chartCopy = claim ? claimChartCopy(claim) : null;
        const pageName = `${String(index + 1).padStart(2, '0')}-${beat.kind}.html`;
        let html;
        // Editorial furniture for every page: a small kicker, the subject as a
        // caption, and a frame number. It is what turns a panel floating in a
        // void into a shot of a film.
        const TITLE_LAYOUTS = ['editorial', 'right', 'lower', 'corner'];
        const titleLayout = chooseLayout(index);
        const inset = Math.round(Number(plan?.grade?.letterbox ?? 0) * 1080);
        const furniture = {
          inset,
          kicker: String(plan.label ?? plan.genre ?? '').slice(0, 24),
          caption: subject,
          captionSub: claim ? String(claim.claim).slice(0, 40) : String(beat.kind),
          frameNo: `${String(index + 1).padStart(2, '0')} / ${String(plan.beats.length).padStart(2, '0')}`,
        };
        const warmth = shotWarmth(index);
        if (Array.isArray(copy.lines)) {
          html = buildTypePage({ lines: copy.lines, warmth, motion: plan.type.motion, palette: plan.type.palette, duration: beat.length, sweep: plan.type.sweep, aspect: plan.aspect, layout: titleLayout, inset });
        } else if (Array.isArray(copy.panels)) {
          html = buildScenePage({ panels: copy.panels, move: sceneMoveFor(beat.move ?? copy.move), palette: 'amber', duration: beat.length, warmth, ...furniture });
        } else if (chartCopy) {
          // A shot carrying a claim is always a chart: the claim needs bars to
          // stand on, whatever the demo's alternating default would have chosen.
          html = buildGraphicsPage({ mode: 'chart', title: chartCopy.title, items: chartCopy.items, palette: 'amber', duration: beat.length, warmth });
        } else if (copy.mode === 'chart') {
          html = buildGraphicsPage({ mode: 'chart', title: copy.title, items: copy.items, palette: 'amber', duration: beat.length, warmth });
        } else {
          html = buildGraphicsPage({ mode: 'particles', text: copy.text, palette: 'amber', duration: beat.length, warmth });
        }
        if (Array.isArray(copy.lines)) {
          const spot = LAYOUT_CENTROID[titleLayout] ?? LAYOUT_CENTROID.center;
          chosenLayouts.push({ index, layout: titleLayout });
          previousSpot = spot;
          // A neighbour that only differs in brightness still reads as a repeat;
          // text shots keep their weight on a different side each time.
          plan.beats[index].acceptance = { ...(plan.beats[index].acceptance ?? {}), expectCentroidX: spot.x, expectCentroidY: spot.y, centroidTolerance: 0.2 };
        }
        writeFileSync(join(projectPath, pageName), html, 'utf8');
        pages.push(pageName);
        entries.push({ page: pageName, at: beat.at, length: beat.length });
      });
      if (!pages.length) return { ok: false, problems: ['the plan produced no drawable beats'] };

      // The join style comes from the recipe. A presentation join keeps both
      // shots on screen: the outgoing shot is cut short, a duo page covers the
      // hand-over, and the incoming shot continues from where the duo left it.
      const iframes = [];
      const preferredJoin = Number(plan.transitionDuration ?? 0.9);
      const wantedJoin = Math.min(
        preferredJoin,
        entries.length >= 2 ? entries[entries.length - 2].length * 0.4 : 0,
        entries.length >= 1 ? entries[entries.length - 1].length * 0.4 : 0,
      );
      // A join shorter than the minimum reads as a stutter, so fall back to a
      // hard cut rather than shipping a broken-looking hand-over.
      const presentation = plan.transition === 'presentation' && entries.length >= 2 && wantedJoin >= 0.8;
      const duoDuration = presentation ? Number(wantedJoin.toFixed(2)) : 0;
      const cutIndex = presentation ? entries.length - 2 : -1;
      let duoPage = '';
      entries.forEach((entry, index) => {
        if (index === cutIndex) {
          iframes.push(`  <iframe src="${entry.page}#t=0,${(entry.length - duoDuration).toFixed(2)}"${entry.at > 0 ? ` at="${entry.at}"` : ''}></iframe>`);
          const next = entries[index + 1];
          duoPage = `${String(index + 1).padStart(2, '0')}-duo.html`;
          writeFileSync(join(projectPath, duoPage), buildDuoPage({
            from: entry.page,
            to: next.page,
            kind: 'depth',
            duration: duoDuration,
            fromAt: Number((entry.length - duoDuration).toFixed(2)),
            toAt: 0,
          }), 'utf8');
          iframes.push(`  <iframe src="${duoPage}#t=0,${duoDuration.toFixed(2)}" at="${(entry.at + entry.length - duoDuration).toFixed(2)}"></iframe>`);
          return;
        }
        const isIncoming = presentation && index === entries.length - 1;
        const startAt = isIncoming ? duoDuration : 0;
        iframes.push(`  <iframe src="${entry.page}#t=${startAt.toFixed(2)},${entry.length}"${entry.at > 0 ? ` at="${entry.at}"` : ''}></iframe>`);
      });
      if (duoPage) pages.push(duoPage);
      // Written once the pages exist: each beat's composition target is now real.
      writeFileSync(join(projectPath, '.film', 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

      // The score is written first so the film can carry it from the first frame.
      const score = composeForShots({
        shots: plan.beats.map((beat) => ({ at: beat.at, length: beat.length })),
        mood: plan.score.mood,
        bpm: plan.score.bpm,
        ...(plan.score.groove ? { groove: plan.score.groove } : {}),
        ...(Number(plan.score.grid) > 0 ? { grid: Number(plan.score.grid) } : {}),
        ...(Array.isArray(plan.cuts) ? { cutTypes: plan.cuts.map((cut) => cut.type) } : {}),
        // Harmony follows the section each shot belongs to: open unresolved,
        // state the material, tighten under proof, land on the tonic.
        ...(Array.isArray(plan.beats) ? { cutKinds: plan.beats.map((beat) => beat.kind) } : {}),
        // Sound follows the picture: the demo's scene sits right of centre, its
        // titles left, so the score leans the same way.
        panByShot: plan.beats.map((beat) => (beat.kind === 'scene' ? 0.18 : beat.kind === 'graphics' ? 0 : -0.12)),
      });
      writeFileSync(join(projectPath, 'assets', 'score.wav'), renderScoreWav(score));

      writeFileSync(join(projectPath, 'film.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=1920, height=1080"><style>html,body{margin:0;background:#000}iframe{border:0}</style></head><body>
<section><audio src="assets/score.wav" at="0" volume="0.85"></audio></section>
<section>
${iframes.join('\n')}
</section>
</body></html>
`, 'utf8');

      const next = [
        'mise_verify action="gate" — check the sample before rendering',
        'mise_review action="keyframes" — draw one keyframe per shot, then approve',
        'mise_deliver — finish, normalise and write the receipt',
      ];
      let rendered = '';
      if (args?.render !== false) {
        const run = await runOpenfilm(['render'], { ctx, cwd: projectPath, timeoutMs: 30 * 60 * 1000, signal: exec?.signal });
        if (run.exitCode !== 0) {
          return { ok: false, project: name, pages, seconds: plan.seconds, problems: [`render failed: ${(run.stderr || run.stdout || '').slice(0, 300)}`], next };
        }
        const mp4 = readdirSync(projectPath).filter((n) => n.endsWith('.mp4') && !/-delivered|-graded|-\d+\.mp4$/i.test(n)).sort()[0];
        rendered = mp4 ?? '';
      }

      // Finish the sample the way a real film is finished: measure the frames,
      // (optionally) record a demo-only approval, then deliver with a receipt.
      let verified = null;
      let delivered = '';
      if (rendered && args?.finish !== false) {
        // A frame per beat gives a real thumbnail for every page, including numbers and charts.
        const times = plan.beats.map((beat) => Number((beat.at + beat.length / 2).toFixed(2)));
        const frames = [];
        const drawnFiles = [];
        for (const t of times) {
          const before = newestPng(join(projectPath, '.film', 'cache', 'look'))?.mtime ?? 0;
          const run = await runOpenfilm(['look', String(t)], { ctx, cwd: projectPath, timeoutMs: 240_000, signal: exec?.signal });
          const drawn = newestPng(join(projectPath, '.film', 'cache', 'look'));
          if (run.exitCode !== 0 || !drawn || drawn.mtime <= before) {
            frames.push({ t, coverage: 0, contrast: 0, mean: 0, margins: null, problems: ['could not draw the frame'], kind: '' });
            continue;
          }
          const decoded = grayFromPng(drawn.file);
          if (!decoded) {
            frames.push({ t, coverage: 0, contrast: 0, mean: 0, margins: null, problems: ['could not read the frame'], kind: '' });
            continue;
          }
          drawnFiles.push(drawn.file);
          const beat = plan.beats.find((item) => t >= item.at && t < item.at + item.length);
          const report = analyzeGray(decoded.gray, { width: decoded.width, height: decoded.height }, beat?.acceptance ?? {});
          frames.push({ t, coverage: report.coverage, contrast: report.contrast, mean: report.mean, margins: report.margins, problems: report.problems, kind: beat?.kind ?? '' });
        }
        // One picture of what was judged, so the sample's receipt is reviewable.
        const sheet = buildContactSheet(drawnFiles, join(projectPath, '.film', 'contact-sheet.png'));
        const summary = summarizeFrames(frames.map((frame) => ({ t: frame.t, report: { ...frame, bbox: null } })));
        let filmMtimeMs = 0;
        try { filmMtimeMs = statSync(join(projectPath, 'film.html')).mtimeMs; } catch {}
        writeFileSync(join(projectPath, '.film', 'verify.json'), `${JSON.stringify(verifyRecord({ ok: summary.ok, checked: frames.length, frames, problems: summary.problems }, { filmMtimeMs }), null, 2)}\n`, 'utf8');
        verified = { ok: summary.ok, checked: frames.length, problems: summary.problems, ...(sheet ? { contactSheet: '.film/contact-sheet.png' } : {}) };

        if (args?.autoApprove === true) {
          // Demo-only: this is not a person looking at the film. The note says so,
          // and the review record keeps it.
          for (const shot of shotsFromFacts(checkFilm(projectPath).facts)) {
            setShotReview(projectPath, shot.id, { state: 'approved', note: 'demo: 自动批准（演示链路，不代表人工看过）' });
          }
        }

        const gate = projectGate(projectPath);
        if (gate.ok) {
          const delivery = await buildDeliverTool(ctx).execute({ cwd: projectPath, fps: 0, force: true }, exec);
          if (delivery?.ok) delivered = delivery.output ?? '';
        }
        next.length = 0;
        next.push(
          ...(gate.ok ? [] : [`mise_verify action="gate" — ${gate.blockers[0] ?? 'see the gate'}`]),
          '打开 .film/delivery.md 看回执；不满意就改页面后重新 mise_demo --force',
        );
      }

      return {
        ok: true,
        project: name,
        pages,
        seconds: plan.seconds,
        ...(rendered ? { rendered } : {}),
        ...(verified ? { verified } : {}),
        ...(delivered ? { delivered } : {}),
        problems: [],
        next,
      };
    },
    isConcurrencySafe: () => false,
  };
}

/** ── Frame acceptance: draw it, then measure what actually appeared ─────── */

const VERIFY_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    checked: { type: 'integer' },
    frames: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          t: { type: 'number' },
          coverage: { type: 'number' },
          contrast: { type: 'number' },
          mean: { type: 'number' },
          background: { type: 'number', description: 'The most common level: the shot background.' },
          margins: { type: 'object' },
          kind: { type: 'string' },
          whitespace: { type: 'number', description: 'Percent of the frame that is background.' },
          centroid: {
            type: 'object',
            description: 'Where the weight of the frame sits, as fractions of the frame.',
            additionalProperties: false,
            properties: { x: { type: 'number' }, y: { type: 'number' } },
            required: ['x', 'y'],
          },
          problems: { type: 'array', items: { type: 'string' } },
        },
        required: ['t', 'coverage', 'problems'],
      },
    },
    problems: { type: 'array', items: { type: 'string' } },
    motion: {
      type: 'array',
      description: 'Present on action=motion: one row per moving shot.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer' },
          move: { type: 'string' },
          checked: { type: 'integer' },
          ok: { type: 'boolean' },
          problems: { type: 'array', items: { type: 'string' } },
        },
        required: ['index', 'move', 'ok'],
      },
    },
    relative: { type: 'string', description: 'Where the verdict was written (.film/verify.json).' },
    variety: {
      type: 'object',
      description: 'Whether neighbouring shots differ. Adjacent frames that match in composition and brightness read as a template.',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        problems: { type: 'array', items: { type: 'string' } },
      },
      required: ['ok', 'problems'],
    },
    continuity: {
      type: 'object',
      description: 'Present on picture-led films: whether neighbouring shots look like the same film.',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        problems: { type: 'array', items: { type: 'string' } },
        pairs: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              from: { type: 'number' },
              to: { type: 'number' },
              jumpMean: { type: 'number' },
              jumpBackground: { type: 'number' },
              ok: { type: 'boolean' },
              problems: { type: 'array', items: { type: 'string' } },
            },
            required: ['from', 'to', 'ok'],
          },
        },
      },
      required: ['ok', 'problems'],
    },
    contactSheet: { type: 'string', description: 'One picture of the checked frames (.film/contact-sheet.png).' },
    gate: { type: 'boolean', description: 'True when this answer is the export gate rather than a frame run.' },
    blockers: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          ok: { type: 'boolean' },
          detail: { type: 'string' },
        },
        required: ['id', 'ok'],
      },
    },
  },
  required: ['ok', 'checked'],
};

function renderVerifyOutput(_args, value) {
  if (value.gate === true) {
    const lines = [value.ok ? '✓ export gate open' : `✗ export gate closed — ${value.blockers.length} blocker(s)`];
    for (const blocker of value.blockers ?? []) lines.push(`  ✗ ${blocker}`);
    for (const warning of value.warnings ?? []) lines.push(`  ! ${warning}`);
    for (const check of value.checks ?? []) lines.push(`  ${check.ok ? '✓' : '✗'} ${check.id}: ${check.detail}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  const lines = [value.ok ? `✓ ${value.checked} frame(s) pass` : `✗ ${value.checked} frame(s) checked, ${value.problems.length} problem(s)`];
  for (const frame of value.frames ?? []) {
    lines.push(`  ${frame.t}s  coverage ${frame.coverage}%  contrast ${frame.contrast}${frame.centroid ? `  centroid ${frame.centroid.x}/${frame.centroid.y}` : ''}${frame.margins ? `  margins ${frame.margins.left}/${frame.margins.top}/${frame.margins.right}/${frame.margins.bottom}` : ''}`);
    for (const problem of frame.problems) lines.push(`     - ${problem}`);
  }
  for (const row of value.motion ?? []) {
    lines.push(`  shot ${row.index} ${row.move}: ${row.ok ? 'ok' : 'FAILED'}${row.problems.length ? ` — ${row.problems[0]}` : ''}`);
  }
  if (value.variety) {
    lines.push(`  variety: ${value.variety.ok ? 'every shot differs from its neighbour' : `${value.variety.problems.length} repeated shot(s)`}`);
    for (const problem of value.variety.problems) lines.push(`     - ${problem}`);
  }
  if (value.continuity) {
    lines.push(`  continuity: ${value.continuity.ok ? 'shots look like one film' : `${value.continuity.problems.length} jump(s)`}`);
    for (const problem of value.continuity.problems) lines.push(`     - ${problem}`);
  }
  return [{ type: 'text', text: lines.join('\n') }];
}

/**
 * The export gate for one project, from durable state only.
 *
 * Shared by mise_verify's gate action and by the finishing tools, so
 * "cannot export" is decided in one place.
 */
function projectGate(projectPath) {
  const hasPlan = existsSync(join(projectPath, '.film', 'plan.json'));
  let record = null;
  try { record = JSON.parse(readFileSync(join(projectPath, '.film', 'verify.json'), 'utf8')); } catch { record = null; }
  let filmMtimeMs = 0;
  try { filmMtimeMs = statSync(join(projectPath, 'film.html')).mtimeMs; } catch {}
  const acceptance = record
    ? { ok: record.ok === true, fresh: isFresh(record, filmMtimeMs), at: record.at, problems: record.problems, checked: record.checked }
    : null;
  let review = null;
  try { review = reviewStatus(projectPath, checkFilm(projectPath).facts); } catch { review = null; }
  // The plan's claim pairing is part of the gate: a claim with no proof blocks.
  let claims = null;
  try {
    const plan = JSON.parse(readFileSync(join(projectPath, '.film', 'plan.json'), 'utf8'));
    claims = plan.claims ?? null;
  } catch { claims = null; }
  return preflight({ review, acceptance, hasPlan, claims });
}

/** Convert one rendered PNG to a gray buffer, via ffmpeg (no PNG decoder in Node). */
function grayFromPng(file) {
  const probe = spawnSync(toolPath('ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  const [width, height] = String(probe.stdout ?? '').trim().split(',').map(Number);
  if (!width || !height) return null;
  const raw = spawnSync(toolPath('ffmpeg'), ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { windowsHide: true, timeout: 60_000, maxBuffer: width * height * 2 });
  if (raw.status !== 0 || !raw.stdout || raw.stdout.length < width * height) return null;
  return { gray: raw.stdout, width, height };
}

/**
 * Stitch the checked frames into one picture beside the film.
 *
 * A coverage number says "something was drawn"; a contact sheet says *what* was
 * drawn. It is the cheapest way to make an acceptance run reviewable later, and
 * it costs one ffmpeg call.
 * @param {string[]} files frames to place, in order
 * @param {string} outPath where to write the sheet
 * @returns {string|null} the sheet path, or null when it could not be built
 */
function buildContactSheet(files, outPath) {
  const list = (files ?? []).filter((file) => typeof file === 'string' && existsSync(file)).slice(0, 6);
  if (list.length < 2) return null;
  const cols = 2;
  // An odd count is filled by repeating the last frame: a short row of black
  // would read as a failed shot in the sheet.
  const frames = [...list];
  while (frames.length % cols !== 0) frames.push(frames[frames.length - 1]);

  const inputs = [];
  for (const file of frames) inputs.push('-i', file);
  const cells = frames.map((_, index) =>
    `[${index}:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2[v${index}]`).join(';');
  const layout = frames.map((_, index) =>
    `${(index % cols) === 0 ? '0' : 'w0'}_${Math.floor(index / cols) === 0 ? '0' : 'h0'}`).join('|');
  const chain = `${cells};${frames.map((_, index) => `[v${index}]`).join('')}xstack=inputs=${frames.length}:layout=${layout}`;

  const run = spawnSync(toolPath('ffmpeg'), ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', chain, '-frames:v', '1', outPath], { encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  return run.status === 0 && existsSync(outPath) ? outPath : null;
}

function buildVerifyTool(ctx) {
  return {
    name: 'mise_verify',
    description:
      'Draw the film at the given times and measure what actually appeared: coverage, content bounding box, margins against the safe area, contrast. ' +
      'Catches the failures a source check cannot see — a font falling back to 16px, a title pushed off the frame, a selector that stopped matching, a full-bleed colour covering the content. ' +
      'Returns one line per frame and refuses frames that are blank, flat, nearly filled, or outside the safe area.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; defaults to the session working directory.' },
        times: { type: 'array', items: { type: 'number' }, description: 'Times in seconds to check (default: four evenly spaced points).' },
        safe: { type: 'number', description: 'Safe margin in px that content must keep (default 48).' },
        minCoverage: { type: 'number', description: 'Percent floor for drawn content (default 0.35).' },
        maxCoverage: { type: 'number', description: 'Percent ceiling, above which the frame is probably covered (default 92).' },
        minContrast: { type: 'number', description: 'Contrast floor (default 8).' },
        bleed: { type: 'boolean', description: 'Footage shots are meant to fill the frame: skip the safe-area and fill checks (default false).' },
        action: { type: 'string', enum: ['frames', 'gate', 'motion'], description: 'frames (default) draws and measures; motion samples three points inside every moving shot; gate answers the export question without drawing.' },
        expectCentroidX: { type: 'number', description: 'Opt-in composition rule: where the subject should sit horizontally (0..1).' },
        expectCentroidY: { type: 'number', description: 'Opt-in composition rule: where the subject should sit vertically (0..1).' },
        centroidTolerance: { type: 'number', description: 'Allowed distance from that point, as a fraction of the frame (e.g. 0.12).' },
      },
    },
    output: { schema: VERIFY_OUTPUT_SCHEMA, render: renderVerifyOutput },
    presentCall: (args) => ({ card: 'generic', title: 'Check rendered frames', kind: 'read', rawInput: (args?.times ?? []).join(', ') || 'auto' }),
    async execute(args, exec) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_verify: no film project around ${cwd} (no film.html found).`);

      if (args?.action === 'gate') {
        const verdict = projectGate(projectPath);
        return {
          ok: verdict.ok,
          checked: 0,
          gate: true,
          blockers: verdict.blockers,
          warnings: verdict.warnings,
          checks: verdict.checks,
        };
      }

      const facts = checkFilm(projectPath).facts;
      // A film's duration can be unknown (dynamic pages, an audio-only length):
      // fall back to the plan, then to a sane default, instead of refusing to
      // check anything because the number came back as -1.
      let total = Number(facts?.duration ?? 0);
      if (!Number.isFinite(total) || total <= 0) {
        try { total = Number(JSON.parse(readFileSync(join(projectPath, '.film', 'plan.json'), 'utf8')).seconds ?? 0); } catch { total = 0; }
      }
      if (!Number.isFinite(total) || total <= 0) total = 20;
      // Default sample points: the middle of each shot when a plan exists, not
      // even fractions of the runtime. Fractions can land on the first frames of
      // a shot and call a title that is still entering "almost nothing drawn".
      let defaultTimes = [0.25, 0.5, 0.75, 0.9].map((f) => Number((total * f).toFixed(2)));
      try {
        const planned = JSON.parse(readFileSync(join(projectPath, '.film', 'plan.json'), 'utf8'));
        if (Array.isArray(planned.beats) && planned.beats.length) {
          defaultTimes = planned.beats.slice(0, 6).map((beat) => Number((beat.at + beat.length / 2).toFixed(2)));
        }
      } catch { /* no plan: even fractions are a reasonable guess */ }
      const requested = Array.isArray(args?.times) && args.times.length ? args.times.map(Number) : defaultTimes;
      let times = requested.filter((t) => Number.isFinite(t) && t >= 0 && t <= total).slice(0, 8);
      const motionMode = args?.action === 'motion';
      if (!times.length) return { ok: false, checked: 0, problems: [`no usable times (film is ${total}s)`] };

      const rules = {
        ...(args?.safe !== undefined ? { safe: Number(args.safe) } : {}),
        ...(args?.minCoverage !== undefined ? { minCoverage: Number(args.minCoverage) } : {}),
        ...(args?.maxCoverage !== undefined ? { maxCoverage: Number(args.maxCoverage) } : {}),
        ...(args?.minContrast !== undefined ? { minContrast: Number(args.minContrast) } : {}),
        ...(args?.bleed === true ? { bleed: true } : {}),
        ...(args?.expectCentroidX !== undefined ? { expectCentroidX: Number(args.expectCentroidX) } : {}),
        ...(args?.expectCentroidY !== undefined ? { expectCentroidY: Number(args.expectCentroidY) } : {}),
        ...(args?.centroidTolerance !== undefined ? { centroidTolerance: Number(args.centroidTolerance) } : {}),
      };

      // If the film was planned, every beat already says how it should be
      // judged: a title against the safe area, footage as full-bleed. Prefer
      // that over one rule for the whole film.
      let plan = null;
      try {
        plan = JSON.parse(readFileSync(join(projectPath, '.film', 'plan.json'), 'utf8'));
      } catch {
        plan = null;
      }
      const beatAt = (t) => (Array.isArray(plan?.beats)
        ? plan.beats.find((beat) => t >= beat.at - 1e-6 && t < beat.at + beat.length) ?? null
        : null);

      // A moving shot is checked at three points: a push-in that loses its
      // subject by the middle of the shot passes a single-frame check and still
      // looks broken.
      if (motionMode) {
        if (!Array.isArray(plan?.beats)) return { ok: false, checked: 0, problems: ['motion check needs a plan (.film/plan.json) so moving shots are known'] };
        const movingBeats = plan.beats.filter((beat) => typeof beat.move === 'string' && beat.move !== 'still');
        if (!movingBeats.length) return { ok: true, checked: 0, frames: [], motion: [], problems: [] };
        times = movingBeats
          .flatMap((beat) => [0.15, 0.5, 0.85].map((f) => Number((beat.at + beat.length * f).toFixed(2))))
          .slice(0, 18);
      }

      const frames = [];
      const drawnFiles = [];
      for (const t of times) {
        const before = newestPng(join(projectPath, '.film', 'cache', 'look'))?.mtime ?? 0;
        const run = await runOpenfilm(['look', String(t)], { ctx, cwd: projectPath, timeoutMs: 240_000, signal: exec?.signal });
        const drawn = newestPng(join(projectPath, '.film', 'cache', 'look'));
        if (run.exitCode !== 0 || !drawn || drawn.mtime <= before) {
          frames.push({ t, coverage: 0, contrast: 0, mean: 0, margins: null, problems: [`could not draw ${t}s: ${(run.stderr || run.stdout || 'no picture').slice(0, 200)}`] });
          continue;
        }
        const decoded = grayFromPng(drawn.file);
        if (!decoded) {
          frames.push({ t, coverage: 0, contrast: 0, mean: 0, margins: null, problems: ['could not read the drawn frame'] });
          continue;
        }
        drawnFiles.push(drawn.file);
        const beat = beatAt(t);
        const frameRules = { ...rules, ...(beat?.acceptance ?? {}) };
        const report = analyzeGray(decoded.gray, { width: decoded.width, height: decoded.height }, frameRules);
        const problems = [...report.problems];
        // Inside a moving shot the subject must stay in frame the whole way:
        // content touching the very edge means the camera has pushed it out.
        if (motionMode && beat && typeof beat.move === 'string' && beat.move !== 'still') {
          const box = report.bbox;
          if (!box) problems.push('nothing is drawn during the move');
          else if (box.x0 <= 1 || box.y0 <= 1 || box.x1 >= decoded.width - 2 || box.y1 >= decoded.height - 2) {
            problems.push(`content is clipped at the frame edge during ${beat.move}`);
          }
        }
        frames.push({
          t,
          coverage: report.coverage,
          contrast: report.contrast,
          mean: report.mean,
          background: report.background ?? 0,
          margins: report.margins ?? {},
          kind: beat?.kind ?? '',
          whitespace: report.whitespace ?? 0,
          centroid: report.centroid ?? { x: 0, y: 0 },
          problems,
        });
      }
      const summary = summarizeFrames(frames.map((frame) => ({ t: frame.t, report: { ...frame, bbox: null } })));

      // A picture-led film has to look like one film: when the recipe says the
      // shots are photographs, a jump in brightness or background between
      // neighbouring shots is reported. It warns rather than blocks — two
      // photos of a sunset and a night street are legitimately different.
      const continuity = ['plate', 'pose'].includes(plan?.imageUse)
        ? continuityReport(frames)
        : null;
      // Repetition: neighbouring shots that differ in nothing are a slideshow,
      // however well each frame passes on its own.
      const variety = frames.length >= 2 ? varietyReport(frames) : null;

      // One picture of the frames that were judged, beside the film.
      mkdirSync(join(projectPath, '.film'), { recursive: true });
      const sheet = buildContactSheet(drawnFiles, join(projectPath, '.film', 'contact-sheet.png'));
      const contactSheet = sheet ? '.film/contact-sheet.png' : '';

      // Persist the verdict with the film's mtime: editing the film afterwards
      // makes this record stale, and a stale record is not proof of anything.
      let filmMtimeMs = 0;
      try { filmMtimeMs = statSync(join(projectPath, 'film.html')).mtimeMs; } catch {}
      mkdirSync(join(projectPath, '.film'), { recursive: true });
      const record = verifyRecord({ ok: summary.ok, checked: frames.length, frames, problems: summary.problems }, { filmMtimeMs });
      writeFileSync(join(projectPath, '.film', 'verify.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');

      // Group the motion run by shot so the report reads as "shot 4: push-in ok".
      const motion = motionMode
        ? (plan?.beats ?? [])
          .filter((beat) => typeof beat.move === 'string' && beat.move !== 'still')
          .map((beat) => {
            const own = frames.filter((frame) => frame.t >= beat.at - 1e-6 && frame.t < beat.at + beat.length);
            return {
              index: beat.index,
              move: beat.move,
              checked: own.length,
              ok: own.length > 0 && own.every((frame) => frame.problems.length === 0),
              problems: own.flatMap((frame) => frame.problems),
            };
          })
        : [];

      return {
        ok: summary.ok,
        checked: frames.length,
        frames,
        problems: summary.problems,
        ...(motionMode ? { motion } : {}),
        ...(continuity ? { continuity } : {}),
        ...(variety ? { variety } : {}),
        relative: '.film/verify.json',
        contactSheet,
      };
    },
    isConcurrencySafe: () => false, // draws frames into .film/cache
  };
}

/** ── The director layer: any genre, one plan ────────────────────────────── */

const PLAN_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    genre: { type: 'string' },
    label: { type: 'string' },
    aspect: { type: 'string' },
    seconds: { type: 'number' },
    beats: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer' },
          at: { type: 'number' },
          length: { type: 'number' },
          kind: { type: 'string' },
          move: { type: 'string', description: 'Camera move for this shot, or still when it is outside the motion budget.' },
          claim: {
            type: 'object',
            description: 'The sentence this shot proves, when the plan was given claims.',
            additionalProperties: false,
            properties: { text: { type: 'string' }, kind: { type: 'string' } },
            required: ['text', 'kind'],
          },
          acceptance: {
            type: 'object',
            additionalProperties: false,
            properties: {
              bleed: { type: 'boolean' },
              safe: { type: 'number' },
              minCoverage: { type: 'number' },
              maxCoverage: { type: 'number' },
              delta: { type: 'number' },
              expectCentroidX: { type: 'number' },
              expectCentroidY: { type: 'number' },
              centroidTolerance: { type: 'number' },
            },
            required: ['bleed', 'safe'],
          },
        },
        required: ['index', 'at', 'length', 'kind'],
      },
    },
    rules: { type: 'array', items: { type: 'string' } },
    transition: { type: 'string', description: 'presentation or overlay.' },
    transitionDuration: { type: 'number', description: 'Seconds the recipe wants for its hand-over (0 for a hard cut).' },
    pacing: { type: 'string', description: 'even, accelerate or decelerate: how the cuts change speed.' },
    claims: {
      type: 'object',
      description: 'Present when the author stated claims: which shot proves which sentence.',
      additionalProperties: false,
      properties: {
        assignments: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              beat: { type: 'integer' },
              at: { type: 'number' },
              claim: { type: 'string' },
              kind: { type: 'string' },
            },
            required: ['beat', 'claim'],
          },
        },
        unproven: { type: 'array', items: { type: 'integer' } },
        problems: { type: 'array', items: { type: 'string' } },
      },
      required: ['assignments', 'unproven', 'problems'],
    },
    cuts: {
      type: 'array',
      description: 'Every cut and what kind of edit it is; the score uses this to choose its fill.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          at: { type: 'number' },
          type: { type: 'string', description: 'chapter, join or cut.' },
          from: { type: 'string' },
          to: { type: 'string' },
        },
        required: ['at', 'type'],
      },
    },
    relative: { type: 'string', description: 'Where the plan was written, when a project was found.' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok'],
};

function renderPlanOutput(_args, value) {
  if (value?.ok !== true) {
    const lines = ['mise_plan could not plan:'];
    for (const p of value?.problems ?? []) lines.push(`  - ${p}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  const lines = [`${value.label} (${value.genre}) · ${value.aspect} · ${value.seconds}s · ${value.beats.length} 拍`];
  for (const beat of value.beats) {
    const check = beat.acceptance
      ? (beat.acceptance.bleed ? ' 验:满幅' : ` 验:安全区${beat.acceptance.safe}px`)
      : '';
    lines.push(`  ${String(beat.index).padStart(2)}  ${beat.at.toFixed(2)}s  +${beat.length}s  ${beat.kind}${check}`);
  }
  for (const rule of value.rules ?? []) lines.push(`· ${rule}`);
  if (value.relative) lines.push(`写入 ${value.relative}`);
  return [{ type: 'text', text: lines.join('\n') }];
}

function buildPlanTool(ctx) {
  return {
    name: 'mise_plan',
    description:
      'Plan any kind of code film from a genre recipe: shot lengths inside the genre\'s range (longest at the open and close), the beat kinds in order, the score grid (mood/tempo, chords on cuts), the finishing grade and how pictures are used (plate/texture/pose/none). ' +
      `Genres: ${Object.keys(GENRES).join(', ')}. ` +
      'The plan is written to .film/plan.json and is the map the agent then builds: it is not a render.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; when found the plan is written there. Defaults to the session working directory.' },
        genre: { type: 'string', enum: Object.keys(GENRES), description: 'The recipe to plan from.' },
        seconds: { type: 'number', description: 'Target length 4..600 (default 20).' },
        beats: { type: 'number', description: 'Force a beat count 2..12 instead of deriving it from length.' },
        claims: {
          type: 'array',
          description: 'One claim per proof shot: { text, evidence }. A claim with no evidence is refused, and a claim with no shot to prove it is reported.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              text: { type: 'string' },
              evidence: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  kind: { type: 'string', description: 'number, chart, quote or source.' },
                  value: { type: 'number' },
                  unit: { type: 'string' },
                  source: { type: 'string' },
                  who: { type: 'string' },
                },
                required: ['kind'],
              },
            },
            required: ['text', 'evidence'],
          },
        },
      },
      required: ['genre'],
    },
    output: { schema: PLAN_OUTPUT_SCHEMA, render: renderPlanOutput },
    presentCall: (args) => ({ card: 'generic', title: `Plan: ${args?.genre ?? ''}`, kind: 'read', rawInput: `${args?.seconds ?? 20}s` }),
    async execute(args) {
      const spec = {
        genre: typeof args?.genre === 'string' ? args.genre : 'title-sequence',
        ...(args?.seconds !== undefined ? { seconds: Number(args.seconds) } : {}),
        ...(args?.beats !== undefined ? { beats: Number(args.beats) } : {}),
        ...(Array.isArray(args?.claims) && args.claims.length ? { claims: args.claims } : {}),
      };
      const verdict = validateGenre(spec);
      if (!verdict.ok) return { ok: false, problems: verdict.problems };
      const plan = planProduction(spec);

      // Write it beside the film when there is one: the plan is the handoff
      // between deciding and building, and it should survive the session.
      let relative;
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd);
      if (projectPath) {
        mkdirSync(join(projectPath, '.film'), { recursive: true });
        relative = '.film/plan.json';
        writeFileSync(join(projectPath, relative), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
      }
      return {
        ok: true,
        genre: plan.genre,
        label: plan.label,
        aspect: plan.aspect,
        seconds: plan.seconds,
        beats: plan.beats,
        rules: plan.rules,
        transition: plan.transition,
        transitionDuration: plan.transitionDuration,
        pacing: plan.pacing,
        cuts: plan.cuts,
        ...(plan.claims ? { claims: plan.claims } : {}),
        ...(relative ? { relative } : {}),
      };
    },
    isConcurrencySafe: () => false, // writes .film/plan.json
  };
}

/** ── Score and mix: the film's sound, made by code ──────────────────────── */

const SCORE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    relative: { type: 'string' },
    seconds: { type: 'number' },
    notes: { type: 'integer' },
    mood: { type: 'string' },
    key: { type: 'string' },
    bpm: { type: 'number' },
    bytes: { type: 'integer' },
    cutPoints: { type: 'array', items: { type: 'number' }, description: 'With align=cuts: the shot starts each chord change landed on.' },
    intensities: { type: 'array', items: { type: 'number' }, description: 'With align=cuts: the loudness each shot was given (0..1).' },
    dynamics: { type: 'string', description: 'auto or flat.' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok'],
};

function renderScoreOutput(_args, value) {
  if (value?.ok !== true) {
    const lines = ['mise_score could not write the score:'];
    for (const p of value?.problems ?? []) lines.push(`  - ${p}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  return [{
    type: 'text',
    text: `${value.relative} — ${value.mood} in ${value.key}, ${value.bpm} bpm, ${value.seconds}s, ${value.notes} notes.\nPlace it with:\n  <audio src="${value.relative}" at="0" volume="0.8"></audio>`,
  }];
}

function buildScoreTool(ctx) {
  return {
    name: 'mise_score',
    description:
      'Compose and synthesise an original score with code: a key, a tempo, a four-chord progression, pad, arpeggio, bass and light percussion, written as a WAV in the project. ' +
      `Moods: ${Object.keys(SCORE_MOODS).join(', ')} — deterministic, so a re-render sounds identical. ` +
      'Use it for the bed under narration; it needs no music service and no licence.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; defaults to the session working directory.' },
        name: { type: 'string', description: 'Output name without .wav (default score-<mood>).' },
        mood: { type: 'string', description: `One of: ${Object.keys(SCORE_MOODS).join(', ')}. Default warm.` },
        key: { type: 'string', description: `One of: ${SCORE_KEYS.join(', ')}. Default D.` },
        bpm: { type: 'number', description: 'Tempo 40..200 (default 84).' },
        bars: { type: 'number', description: 'Length in bars (default from seconds).' },
        seconds: { type: 'number', description: 'Target length in seconds; ignored when bars is given.' },
        align: { type: 'string', enum: ['bars', 'cuts'], description: 'bars (default) or cuts: one chord per shot, changing exactly on each cut.' },
        dynamics: { type: 'string', enum: ['auto', 'flat'], description: 'With align=cuts: auto (default) builds to the climax and drops percussion in quiet shots; flat keeps one density.' },
        groove: { type: 'string', enum: ['straight', 'syncopated', 'sparse'], description: 'With align=cuts: the rhythm pattern. Defaults to the plan\'s, else straight.' },
      },
    },
    output: { schema: SCORE_OUTPUT_SCHEMA, render: renderScoreOutput },
    presentCall: (args) => ({ card: 'generic', title: `Score: ${args?.mood ?? 'warm'}`, kind: 'other', rawInput: `${args?.key ?? 'D'} ${args?.bpm ?? 84}bpm` }),
    async execute(args) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_score: no film project around ${cwd} (no film.html found).`);
      const spec = {
        ...(typeof args?.mood === 'string' && args.mood ? { mood: args.mood } : {}),
        ...(typeof args?.key === 'string' && args.key ? { key: args.key } : {}),
        ...(args?.bpm !== undefined ? { bpm: Number(args.bpm) } : {}),
        ...(args?.bars !== undefined ? { bars: Number(args.bars) } : {}),
        ...(args?.seconds !== undefined ? { seconds: Number(args.seconds) } : {}),
      };
      const verdict = validateScoreSpec(spec);
      if (!verdict.ok) return { ok: false, problems: verdict.problems };

      const mood = spec.mood ?? 'warm';
      const name = String(args?.name ?? `score-${mood}`).replace(/\.wav$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-');
      const relative = join('assets', `${name}.wav`).split('\\').join('/');
      mkdirSync(join(projectPath, 'assets'), { recursive: true });

      let score;
      if (args?.align === 'cuts') {
        // Cut to the picture: one chord per shot, its change exactly on the cut.
        const shots = shotsFromFacts(checkFilm(projectPath).facts).map((shot) => ({ at: shot.at, length: shot.length }));
        // When the film was planned, its half-beat grid comes along: the score
        // then lands on the same grid the cuts were snapped to.
        let grid = 0;
        let groove = '';
        let cutTypes = null;
        let cutKinds = null;
        try {
          const planned = JSON.parse(readFileSync(join(projectPath, '.film', 'plan.json'), 'utf8'));
          grid = Number(planned.score?.grid ?? 0);
          groove = String(planned.score?.groove ?? '');
          cutTypes = Array.isArray(planned.cuts) ? planned.cuts.map((cut) => cut.type) : null;
          cutKinds = Array.isArray(planned.beats) ? planned.beats.map((beat) => beat.kind) : null;
        } catch { grid = 0; groove = ''; cutTypes = null; }
        const composed = composeForShots({
          shots,
          ...(spec.mood ? { mood: spec.mood } : {}),
          ...(spec.key ? { key: spec.key } : {}),
          ...(spec.bpm !== undefined ? { bpm: spec.bpm } : {}),
          ...(Number.isFinite(grid) && grid > 0 ? { grid } : {}),
          ...(typeof args?.groove === 'string' && args.groove ? { groove: args.groove } : (groove ? { groove } : {})),
          ...(Array.isArray(cutTypes) && cutTypes.length === shots.length - 1 ? { cutTypes } : {}),
          ...(Array.isArray(cutKinds) && cutKinds.length === shots.length ? { cutKinds } : {}),
          ...(args?.dynamics === 'flat' ? { dynamics: 'flat' } : {}),
        });
        if (composed.ok !== true) return { ok: false, problems: composed.problems };
        score = composed;
      } else {
        score = composeScore(spec);
      }
      const bytes = renderScoreWav(score);
      writeFileSync(join(projectPath, relative), bytes);
      return {
        ok: true,
        relative,
        seconds: score.seconds,
        notes: score.notes.length,
        mood: score.mood,
        key: score.key,
        bpm: score.bpm,
        bytes: bytes.length,
        cutPoints: Array.isArray(score.cutPoints) ? score.cutPoints : [],
        intensities: Array.isArray(score.intensities) ? score.intensities : [],
        dynamics: typeof score.dynamics === 'string' ? score.dynamics : '',
      };
    },
    isConcurrencySafe: () => false, // writes a WAV
  };
}

const MIX_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    output: { type: 'string' },
    bytes: { type: 'integer' },
    voices: { type: 'integer' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok'],
};

function renderMixOutput(_args, value) {
  if (value?.ok !== true) {
    const lines = ['mise_mix could not run:'];
    for (const p of value?.problems ?? []) lines.push(`  - ${p}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  return [{ type: 'text', text: `${value.output} — ${value.voices} voice line(s) over the score, ducked and normalised to -16 LUFS.\nUse it as the film's audio track.` }];
}

function buildMixTool(ctx) {
  return {
    name: 'mise_mix',
    description:
      'Mix a score under the narration: place each voice line at its real time, duck the music with the voice as a sidechain, sum, limit and normalise to -16 LUFS / -1.5 dBTP. ' +
      'This is the film-sound standard rather than a volume knob: without it a bed fights the voice and the whole film sounds amateur.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; defaults to the session working directory.' },
        music: { type: 'string', description: 'The score file, relative to the project.' },
        voices: {
          type: 'array',
          description: 'Narration lines, each at its real start time.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              src: { type: 'string' },
              at: { type: 'number', description: 'Start time in seconds (default 0).' },
            },
            required: ['src'],
          },
        },
        out: { type: 'string', description: 'Output audio file (default mix.m4a).' },
        musicGain: { type: 'number', description: 'Score gain before ducking (default 1).' },
      },
      required: ['music'],
    },
    output: { schema: MIX_OUTPUT_SCHEMA, render: renderMixOutput },
    presentCall: (args) => ({ card: 'generic', title: 'Mix score and voice', kind: 'other', rawInput: args?.music }),
    async execute(args) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_mix: no film project around ${cwd} (no film.html found).`);
      const music = typeof args?.music === 'string' ? args.music : '';
      if (!music || !existsSync(join(projectPath, music))) return { ok: false, problems: ['music file is required and must exist in the project'] };

      const voices = Array.isArray(args?.voices)
        ? args.voices
          .filter((voice) => typeof voice?.src === 'string' && voice.src && existsSync(join(projectPath, voice.src)))
          .map((voice) => ({ path: join(projectPath, voice.src), ...(voice.at !== undefined ? { at: Number(voice.at) } : {}) }))
        : [];
      const output = typeof args?.out === 'string' && args.out ? args.out : 'mix.m4a';
      // The music's real length keeps the bed playing after the last line:
      // sidechaincompress otherwise stops where the voice does.
      const musicProbe = spawnSync(toolPath('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', join(projectPath, music)], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
      const musicSeconds = Number(String(musicProbe.stdout ?? '').trim());
      // Read the lines into sentences, so the music ducks before a line starts
      // and lifts between sentences instead of chasing a threshold.
      let speech = [];
      if (voices.length) {
        try {
          for (const voice of voices) {
            const buffer = readFileSync(voice.path);
            const envelope = wavEnvelope(buffer, { fps: 60 });
            const offset = Number(voice.at ?? 0);
            for (const run of speechRegions(envelope)) {
              speech.push({ start: Number((run.start + offset).toFixed(3)), end: Number((run.end + offset).toFixed(3)) });
            }
          }
          speech.sort((a, b) => a.start - b.start);
        } catch {
          speech = [];
        }
      }
      const plan = planMix({
        music: join(projectPath, music),
        voices,
        output: join(projectPath, output),
        ...(Number.isFinite(musicSeconds) && musicSeconds > 0 ? { seconds: musicSeconds } : {}),
        ...(speech.length ? { speech } : {}),
        ...(args?.musicGain !== undefined ? { musicGain: Number(args.musicGain) } : {}),
      });
      if (!plan.ok) return { ok: false, problems: plan.problems };

      const run = spawnSync(toolPath('ffmpeg'), plan.args, { encoding: 'utf8', windowsHide: true, timeout: 30 * 60 * 1000 });
      if (run.status !== 0 || !existsSync(join(projectPath, output))) {
        return { ok: false, problems: [`ffmpeg failed: ${(run.stderr || '').slice(0, 300) || 'no output'}`] };
      }
      return { ok: true, output, bytes: statSync(join(projectPath, output)).size, voices: voices.length };
    },
    isConcurrencySafe: () => false,
  };
}

/** ── Presentation transitions: both shots on screen, not a mask ─────────── */

const DUO_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    relative: { type: 'string' },
    kind: { type: 'string' },
    duration: { type: 'number' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok'],
};

function renderDuoOutput(_args, value) {
  if (value?.ok !== true) {
    const lines = ['mise_duo could not write the page:'];
    for (const p of value?.problems ?? []) lines.push(`  - ${p}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  return [{
    type: 'text',
    text: `${value.relative} — ${value.kind}, ${value.duration}s. 两个页面同屏，由转场页驱动子页面时钟；替换掉原来那一对镜头（而不是叠在它们上面）。`,
  }];
}

const PROMO_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
    project: { type: 'string' },
    seconds: { type: 'number' },
    pages: { type: 'number' },
    joins: { type: 'number' },
    rendered: { type: 'string' },
    next: { type: 'string' },
  },
  required: ['ok', 'problems'],
};

function renderPromoOutput(value) {
  const lines = [
    `promo: ${value.pages} pages · ${value.joins} joins · ${value.seconds}s`,
    `project: ${value.project}`,
  ];
  if (value.rendered) lines.push(`rendered: ${value.rendered}`);
  for (const problem of value.problems ?? []) lines.push(`problem: ${problem}`);
  return [{ type: 'text', text: lines.join('\n') }];
}

function buildPromoTool(ctx) {
  return {
    name: 'mise_promo',
    description:
      'Build a product promo film from a brief: statements, real screenshots and numbers, all in one visual language. ' +
      'Every shot shares the same grid, the same chrome (brand, index, progress) and the same camera move, and every ' +
      'join is a focus pull rather than a slide. Use it for app, product and feature promos: it writes the pages, the ' +
      'joins, the score and the film, and renders on request.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'Where to create the project; defaults to the session working directory.' },
        name: { type: 'string', description: 'Project folder name (default promo-film).' },
        shots: {
          type: 'array',
          description:
            'Shots in order. kind "type" (a statement: title lines, kicker, note), "plate" (a real screenshot: image + title + note), ' +
            '"number" (figure, unit, chips) or "end" (title, url, note).',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              kind: { type: 'string', enum: ['type', 'plate', 'number', 'claim', 'end'] },
              duration: { type: 'number', description: 'Seconds (default 3.6).' },
              title: { type: 'array', items: { type: 'string' } },
              kicker: { type: 'string' },
              eyebrow: { type: 'string' },
              note: { type: 'string' },
              image: { type: 'string', description: 'plate: picture relative to the project (assets/chat.png).' },
              figure: { type: 'number', description: 'number: the value to count up to.' },
              unit: { type: 'string' },
              caption: { type: 'string' },
              chips: { type: 'array', items: { type: 'string' } },
              figures: { type: 'array', description: 'number: a row of figures, each { value, unit, label }.' },
              sources: { type: 'string', description: 'number: where the figures came from.' },
              imageAfter: { type: 'string', description: 'plate: the second state of the same screen.' },
              mark: { type: 'object', additionalProperties: true, description: 'plate: the callout { x, y, w, h, label } in screenshot pixels.' },
              markAfter: { type: 'object', additionalProperties: true, description: 'plate: where the callout travels to.' },
              claim: { type: 'string', description: 'claim: the sentence to argue.' },
              evidence: { type: 'array', description: 'claim: rows of { text, source }.' },
              url: { type: 'string', description: 'end: the address on the card.' },
              brand: { type: 'string', description: 'The mark in the top-left (default OPENFILM).' },
            },
            required: ['kind'],
          },
          minItems: 1,
        },
        transition: { type: 'number', description: 'Focus-pull length in seconds (default 0.55).' },
        bpm: { type: 'number', description: 'Score tempo; defaults to what the structure wants.' },
        skeleton: {
          type: 'string',
          enum: ['open-source', 'pricing', 'performance', 'product'],
          description: 'Structure: sets pacing, camera speed, join style and the score.',
        },
        joinKind: { type: 'string', enum: ['depth', 'fade', 'slide', 'wipe', 'push-up'], description: 'Override the structure join (default: depth, or fade for fast cuts).' },
        render: { type: 'boolean', description: 'Render the film after writing it (default false).' },
        force: { type: 'boolean', description: 'Write into an existing project folder.' },
      },
      required: ['shots'],
    },
    output: { schema: PROMO_OUTPUT_SCHEMA, render: renderPromoOutput },
    presentCall: (args) => ({ card: 'generic', title: 'Build a product promo', kind: 'other', rawInput: `${Array.isArray(args?.shots) ? args.shots.length : 0} shots` }),
    async execute(args, exec) {
      const base = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const name = String(args?.name ?? 'promo-film').replace(/[^A-Za-z0-9._-]+/g, '-');
      const projectPath = join(base, name);
      if (existsSync(join(projectPath, 'film.html')) && args?.force !== true) {
        return { ok: false, problems: [`${name} already has a film.html; pass force to rebuild it`] };
      }

      // A plate may be given as an absolute path: copy it into the project so the
      // film is self-contained and portable to another machine.
      const shots = (Array.isArray(args?.shots) ? args.shots : []).map((shot) => {
        if (shot?.kind !== 'plate' || typeof shot.image !== 'string') return shot;
        if (!isAbsolute(shot.image) || !existsSync(shot.image)) return shot;
        mkdirSync(join(projectPath, 'assets'), { recursive: true });
        const file = join(projectPath, 'assets', basename(shot.image));
        copyFileSync(shot.image, file);
        return { ...shot, image: `assets/${basename(shot.image)}` };
      });

      const built = buildPromo({
        ...(typeof args?.skeleton === 'string' && args.skeleton ? { skeleton: args.skeleton } : {}),
        shots,
        ...(args?.transition !== undefined ? { transition: Number(args.transition) } : {}),
        ...(args?.bpm !== undefined ? { bpm: Number(args.bpm) } : {}),
      });
      if (!built.ok) return { ok: false, problems: built.problems };

      mkdirSync(join(projectPath, '.film'), { recursive: true });
      mkdirSync(join(projectPath, 'assets'), { recursive: true });

      // A plate references a picture; a missing file is reported here rather than
      // shipping as a blank rectangle in the render.
      const missing = [];
      for (const shot of shots) {
        if (shot?.kind === 'plate' && typeof shot.image === 'string' && !existsSync(join(projectPath, shot.image))) {
          missing.push(shot.image);
        }
      }
      if (missing.length) {
        return { ok: false, problems: missing.map((file) => `plate picture is missing from the project: ${file}`) };
      }

      for (const page of built.pages) writeFileSync(join(projectPath, page.name), page.html, 'utf8');
      for (const joinPage of built.joins) {
        writeFileSync(join(projectPath, joinPage.name), buildDuoPage({
          from: joinPage.from,
          to: joinPage.to,
          kind: joinPage.kind ?? 'depth',
          duration: joinPage.duration,
          fromAt: joinPage.fromAt,
          toAt: 0,
        }), 'utf8');
      }

      const score = composeForShots({
        shots: built.lanes,
        mood: 'warm',
        bpm: Number(built.plan.score.bpm),
        grid: null,
        groove: built.plan.score.groove ?? 'sparse',
        dynamics: built.plan.score.dynamics === 'auto' ? 'auto' : 'flat',
        fills: false,
        cutKinds: built.kinds,
      });
      writeFileSync(join(projectPath, 'assets', 'score.wav'), renderScoreWav(score));
      writeFileSync(join(projectPath, 'film.html'), built.filmHtml, 'utf8');
      writeFileSync(join(projectPath, '.film', 'plan.json'), `${JSON.stringify(built.plan, null, 2)}\n`, 'utf8');

      const result = {
        ok: true,
        problems: [],
        project: projectPath,
        seconds: built.seconds,
        pages: built.pages.length,
        joins: built.joins.length,
        next: 'mise_check reads the film; mise_run ["render"] renders it.',
      };
      if (args?.render === true) {
        const rendered = await runOpenfilm(['render'], { cwd: projectPath, sessionId: exec?.sessionId, ctx });
        if (rendered.exitCode === 0) {
          const newest = readdirSync(projectPath).filter((entry) => entry.endsWith('.mp4')).sort().pop();
          result.rendered = newest ?? '';
        } else {
          result.ok = false;
          result.problems.push(`render failed: ${String(rendered.stderr || rendered.stdout).slice(0, 400)}`);
        }
      }
      return result;
    },
  };
}

const PROMO_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
    sources: {
      type: 'object',
      additionalProperties: false,
      properties: {
        readme: { type: 'string' },
        facts: { type: 'string' },
        screenshots: { type: 'number' },
      },
    },
    proposal: {
      type: 'object',
      additionalProperties: true,
      properties: {
        name: { type: 'string' },
        url: { type: 'string' },
        skeleton: { type: 'string' },
        reason: { type: 'string' },
        shots: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
    },
  },
  required: ['ok', 'problems'],
};

function renderPromoPlanOutput(value) {
  const lines = [];
  if (!value.ok) {
    lines.push('proposal: refused');
    for (const problem of value.problems ?? []) lines.push(`  - ${problem}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  lines.push(`proposal: ${value.proposal.shots.length} shots for ${value.proposal.name}`);
  if (value.proposal.skeleton) lines.push(`structure: ${value.proposal.skeleton} (${value.proposal.reason ?? ''})`);
  for (const shot of value.proposal.shots) {
    const label = shot.kind === 'number'
      ? `${shot.figure} ${shot.unit ?? ''} (${shot.caption ?? ''})`
      : shot.kind === 'plate'
        ? `${shot.image}`
        : (shot.title ?? []).join(' / ');
    lines.push(`  ${shot.kind.padEnd(6)} ${label}`);
  }
  lines.push(`read: ${value.sources.readme ? 'README' : 'no README'} · ${value.sources.facts ? 'facts.json' : 'no facts'} · ${value.sources.screenshots} screenshots`);
  if (!value.proposal.url) lines.push('note: no repository link was found or passed — pass url to add the end card.');
  lines.push('next: pass these shots to mise_promo (edit the copy first).');
  return [{ type: 'text', text: lines.join('\n') }];
}

/** Strip the markup that a README puts around a sentence. */
function plainSentence(text) {
  return String(text)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first paragraph of a README, as a tagline. */
function readTagline(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  let started = false;
  const paragraph = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!started) {
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('>') || trimmed.startsWith('|')) continue;
      started = true;
    }
    if (started) {
      if (!trimmed) break;
      if (trimmed.startsWith('#')) break;
      paragraph.push(trimmed);
    }
  }
  const text = plainSentence(paragraph.join(' '));
  return text.split(/(?<=[。！？.!?])/)[0] ?? text;
}

function pickScreenshotDir(projectPath, wanted) {
  const hasImages = (dir) => {
    try {
      return readdirSync(dir).some((entry) => /\.(png|jpe?g|webp)$/i.test(entry));
    } catch {
      return false;
    }
  };
  const candidates = wanted ? [wanted] : ['素材截图', 'screenshots', 'shots', 'preview', 'assets', 'docs'];
  for (const candidate of candidates) {
    const full = join(projectPath, candidate);
    if (existsSync(full) && statSync(full).isDirectory() && hasImages(full)) return candidate;
  }
  // Nothing obvious: look one level down for a folder that actually holds frames.
  for (const candidate of ['素材截图', 'screenshots', 'shots', 'assets', 'docs', 'preview']) {
    const full = join(projectPath, candidate);
    if (!existsSync(full) || !statSync(full).isDirectory()) continue;
    try {
      for (const child of readdirSync(full)) {
        const childFull = join(full, child);
        if (statSync(childFull).isDirectory() && hasImages(childFull)) return `${candidate}/${child}`;
      }
    } catch { /* unreadable folder: skip it */ }
  }
  return undefined;
}

function buildPromoPlanTool(ctx) {
  return {
    name: 'mise_promo_plan',
    description:
      'Propose a promo shot list from what a project already says about itself: its README (name and tagline), a facts JSON ' +
      '(the figures worth counting up) and a folder of real screenshots. It only uses strings and numbers that exist in ' +
      'those files — nothing is invented — and returns shots to hand to mise_promo after editing the copy.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The project to read; defaults to the session working directory.' },
        shotsDir: { type: 'string', description: 'Screenshot folder (default: 素材截图, screenshots, shots, preview or assets).' },
        url: { type: 'string', description: 'The address for the end card; defaults to a GitHub link found in the README.' },
        name: { type: 'string', description: 'Override the product name (default: the README heading).' },
        tagline: { type: 'string', description: 'Override the tagline (default: the README first paragraph).' },
        note: { type: 'string', description: 'A short line for the opener and the end card.' },
        facts: { type: 'string', description: 'Facts JSON path (default docs/facts.json when it exists).' },
        maxScreens: { type: 'number', description: 'How many screenshot shots to propose (default 3).' },
        skeleton: { type: 'string', enum: ['open-source', 'pricing', 'performance', 'product'], description: 'Force a structure instead of detecting one.' },
        why: { type: 'string', description: 'For the open-source structure: the line about why it is open.' },
        claim: { type: 'string', description: 'The conclusion the film argues for (a claim shot is added when given).' },
        evidence: {
          type: 'array',
          description: 'Rows under the claim, each { text, source }.',
          items: { type: 'object', additionalProperties: true, properties: { text: { type: 'string' }, source: { type: 'string' } }, required: ['text'] },
        },
      },
    },
    output: { schema: PROMO_PLAN_SCHEMA, render: renderPromoPlanOutput },
    presentCall: (args) => ({ card: 'generic', title: 'Propose a promo shot list', kind: 'other', rawInput: args?.cwd ?? 'session' }),
    async execute(args) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      if (!existsSync(cwd)) return { ok: false, problems: [`no such folder: ${cwd}`] };

      const problems = [];
      const sources = { readme: '', facts: '', screenshots: 0 };

      // README: name and tagline.
      let markdown = '';
      for (const candidate of ['README.md', 'readme.md', 'Readme.md']) {
        const full = join(cwd, candidate);
        if (existsSync(full)) { markdown = readFileSync(full, 'utf8'); sources.readme = candidate; break; }
      }
      const heading = markdown.match(/^#\s+(.+)$/m);
      const name = String(args?.name ?? (heading ? plainSentence(heading[1]) : basename(cwd))).trim();
      const tagline = String(args?.tagline ?? readTagline(markdown)).trim();

      // Facts: the figures worth counting up.
      let facts = {};
      const factsPath = typeof args?.facts === 'string' ? args.facts : join(cwd, 'docs', 'facts.json');
      if (existsSync(factsPath)) {
        try {
          facts = JSON.parse(readFileSync(factsPath, 'utf8'));
          sources.facts = 'docs/facts.json';
        } catch { problems.push(`facts file is not valid JSON: ${factsPath}`); }
      }
      if (!sources.facts) {
        const alt = join(cwd, 'facts.json');
        if (existsSync(alt)) {
          try { facts = JSON.parse(readFileSync(alt, 'utf8')); sources.facts = 'facts.json'; } catch { /* ignored */ }
        }
      }

      // Screenshots: real frames only.
      const wantedDir = typeof args?.shotsDir === 'string' && args.shotsDir ? args.shotsDir : undefined;
      const shotsRoot = wantedDir && isAbsolute(wantedDir) ? wantedDir : cwd;
      const dir = wantedDir && isAbsolute(wantedDir) ? undefined : pickScreenshotDir(cwd, wantedDir);
      const shotsDirPath = dir ? join(cwd, dir) : shotsRoot;
      const shots = [];
      if (existsSync(shotsDirPath) && statSync(shotsDirPath).isDirectory()) {
        const prefix = dir ?? basename(shotsDirPath);
        const files = readdirSync(shotsDirPath)
          .filter((entry) => /\.(png|jpe?g|webp)$/i.test(entry))
          .sort((a, b) => {
            const score = (entry) => (/shot|screen/i.test(entry) ? 0 : 1);
            return score(a) - score(b) || a.localeCompare(b);
          });
        sources.screenshots = files.length;
        const maxScreens = Math.max(1, Math.min(4, Number(args?.maxScreens ?? 3)));
        for (const file of files.slice(0, maxScreens)) {
          const relative = prefix ? `${prefix}/${file}` : file;
          shots.push({ file: dir ? relative : join(shotsDirPath, file) });
        }
      }
      if (!shots.length) problems.push(`no screenshots found${dir ? ` in ${dir}` : ''}`);
      if (!markdown && !args?.name && !args?.tagline) problems.push('no README found: pass name and tagline, or point cwd at the project that has one');

      const urlMatch = markdown.match(/https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/) ?? markdown.match(/github\.com\/[\w.-]+\/[\w.-]+/);
      let url = String(args?.url ?? (urlMatch?.[0]?.replace(/^https?:\/\//, '') ?? '')).trim();
      // No link in the README? The repository itself knows its own address.
      if (!url && existsSync(join(cwd, '.git'))) {
        // origin first, then whatever remote the repo does have.
        let remote = spawnSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
        let value = String(remote.stdout ?? '').trim();
        if (!value) {
          remote = spawnSync('git', ['-C', cwd, 'remote', '-v'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
          value = String(remote.stdout ?? '').trim().split(/\s+/)[1] ?? '';
        }
        if (value) {
          url = value.replace(/^git@([^:]+):/, '$1/').replace(/^https?:\/\//, '').replace(/\.git$/, '');
        }
      }

      if (problems.length) return { ok: false, problems, sources };

      const proposal = proposePromo({
        name,
        tagline,
        // The README is what decides the structure: an open-source project is
        // argued differently from a paid one.
        text: markdown,
        ...(args?.skeleton ? { skeleton: String(args.skeleton) } : {}),
        ...(args?.why ? { why: String(args.why) } : {}),
        ...(args?.claim ? { claim: String(args.claim) } : {}),
        ...(Array.isArray(args?.evidence) ? { evidence: args.evidence } : {}),
        ...(args?.note ? { note: String(args.note) } : {}),
        ...(url ? { url } : {}),
        facts,
        screenshots: shots,
      });
      if (!proposal.ok) return { ok: false, problems: proposal.problems, sources };
      return { ok: true, problems: [], sources, proposal };
    },
  };
}

const COMPOSE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
    project: { type: 'string' },
    seconds: { type: 'number' },
    pages: { type: 'number' },
    placements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          file: { type: 'string' },
          band: { type: 'string' },
          scrim: { type: 'number' },
          density: { type: 'number' },
          reason: { type: 'string' },
        },
      },
    },
    rendered: { type: 'string' },
  },
  required: ['ok', 'problems'],
};

function renderComposeOutput(value) {
  const lines = [];
  if (!value.ok) {
    lines.push('compose: refused');
    for (const problem of value.problems ?? []) lines.push(`  - ${problem}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  lines.push(`compose: ${value.pages} measured shots · ${value.seconds}s`);
  for (const placement of value.placements ?? []) {
    lines.push(`  ${placement.file}  band ${placement.band}  scrim ${placement.scrim}  ink ${placement.density}%  (${placement.reason})`);
  }
  if (value.rendered) lines.push(`rendered: ${value.rendered}`);
  else lines.push('next: mise_run ["render"] renders it.');
  return [{ type: 'text', text: lines.join('\n') }];
}

function buildComposeTool(ctx) {
  return {
    name: 'mise_compose',
    description:
      'Compose a film from real screenshots by measuring them first: the engine decodes each picture, finds the band where its ink is ' +
      'lightest, and sets the copy there, with a scrim only as heavy as that band needs. Use it when a film should follow the material ' +
      'instead of a fixed layout — dense screens get a full bleed, calm ones need almost no veil.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'Where to create the project; defaults to the session working directory.' },
        name: { type: 'string', description: 'Project folder name (default compose-film).' },
        screens: {
          type: 'array',
          description: 'Shots in order: { file, kicker?, title? }. file may be absolute; it is copied into the project.',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              file: { type: 'string' },
              kicker: { type: 'string' },
              title: { type: 'array', items: { type: 'string' } },
              duration: { type: 'number' },
              band: { type: 'string', enum: ['top', 'middle', 'bottom'], description: 'Force the band instead of measuring one.' },
              intent: { type: 'string', enum: ['statement', 'proof', 'loud', 'quiet'], description: 'What the shot is for: air, an object on stage, a push, or stillness.' },
            },
            required: ['file'],
          },
          minItems: 1,
        },
        secondsPerShot: { type: 'number', description: 'Default shot length (default 4.6).' },
        transition: { type: 'number', description: 'Focus-pull length (default 0.6).' },
        structure: { type: 'string', enum: ['auto'], description: 'Derive the order, lengths and per-shot intent from the plates themselves instead of the listed order.' },
        claim: { type: 'string', description: 'One sentence the film argues for (used by structure auto).' },
        title: { type: 'array', items: { type: 'string' }, description: 'Opening title lines (used by structure auto).' },
        url: { type: 'string', description: 'Address on the end card (used by structure auto).' },
        render: { type: 'boolean', description: 'Render after writing (default false).' },
        force: { type: 'boolean', description: 'Write into an existing project folder.' },
      },
      required: ['screens'],
    },
    output: { schema: COMPOSE_OUTPUT_SCHEMA, render: renderComposeOutput },
    presentCall: (args) => ({ card: 'generic', title: 'Compose from screenshots', kind: 'other', rawInput: `${Array.isArray(args?.screens) ? args.screens.length : 0} screens` }),
    async execute(args, exec) {
      const base = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const name = String(args?.name ?? 'compose-film').replace(/[^A-Za-z0-9._-]+/g, '-');
      const projectPath = join(base, name);
      if (existsSync(join(projectPath, 'film.html')) && args?.force !== true) {
        return { ok: false, problems: [`${name} already has a film.html; pass force to rebuild it`] };
      }

      let screens = Array.isArray(args?.screens) ? args.screens : [];
      const problems = [];
      if (!screens.length) problems.push('at least one screen is required');

      // Structure from the material: the plates are measured and the order, the
      // lengths and each shot's intent come out of those measurements.
      let structure = null;
      if (args?.structure === 'auto' && screens.length) {
        const resolved = screens.map((screen) => ({ ...screen, file: isAbsolute(screen.file) ? screen.file : join(base, screen.file) }));
        structure = structureFromMaterial({
          projectPath: base,
          seconds: args?.seconds,
          claim: args?.claim,
          facts: args?.facts,
          title: args?.title,
          url: args?.url,
          screens: resolved,
        });
        if (!structure.ok) return { ok: false, problems: structure.problems };
        const byFile = new Map(screens.map((screen) => [isAbsolute(screen.file) ? screen.file : join(base, screen.file), screen]));
        screens = structure.beats
          .filter((beat) => beat.kind === 'plate')
          .map((beat) => ({
            ...(byFile.get(beat.image) ?? { file: beat.image }),
            duration: beat.duration,
            intent: beat.intent,
          }));
      }
      const transition = Math.max(0.2, Math.min(1.2, Number(args?.transition ?? 0.6)));
      const defaultDuration = Math.max(1.5, Math.min(12, Number(args?.secondsPerShot ?? 4.6)));
      for (const screen of screens) {
        const file = typeof screen?.file === 'string' ? screen.file : '';
        const resolved = isAbsolute(file) ? file : join(base, file);
        if (!file || !existsSync(resolved)) problems.push(`screen not found: ${file || '(missing file)'}`);
      }
      if (problems.length) return { ok: false, problems };

      mkdirSync(join(projectPath, 'assets'), { recursive: true });
      mkdirSync(join(projectPath, '.film'), { recursive: true });

      const placements = [];
      const pages = [];
      let at = 0;

      // A material-driven structure starts with a title and ends on a card; both
      // are type-only pages, written before the plates so the timeline can open
      // with them.
      const structureBeats = structure ? structure.beats : [];
      const titleBeat = structureBeats.find((beat) => beat.kind === 'type');
      if (titleBeat) {
        const pageName = '00-title.html';
        writeFileSync(join(projectPath, pageName), buildTextPage({
          kind: 'type',
          title: titleBeat.title ?? (Array.isArray(args?.title) ? args.title.map(String) : []),
          duration: titleBeat.duration,
          ...(typeof args?.brand === 'string' ? { kicker: args.brand } : {}),
        }), 'utf8');
        pages.push({ kind: 'type', name: pageName, duration: titleBeat.duration, at: 0, placement: { band: 'middle', anchor: 'left', intent: 'statement', reason: 'title card' } });
        at += titleBeat.duration - transition;
      }
      for (const [index, screen] of screens.entries()) {
        const source = isAbsolute(screen.file) ? screen.file : join(base, screen.file);
        const asset = `assets/${String(index + 1).padStart(2, '0')}-${basename(source)}`;
        copyFileSync(source, join(projectPath, asset));

        const image = decodePng(readFileSync(join(projectPath, asset)));
        if (!image.ok) {
          // A picture this build cannot read is reported, not silently rendered blank.
          return { ok: false, problems: image.problems.map((problem) => `${screen.file}: ${problem}`) };
        }
        const grid = inkGrid(image);
        // The page needs the aspect: a portrait screen is treated as an object.
        const placement = placeCopy(
          { file: screen.file, grid, aspect: image.height / image.width },
          { index, ...(typeof screen.intent === 'string' ? { intent: screen.intent } : {}), ...(screen.band ? { band: screen.band } : {}) },
        );
        if (screen.band) placement.band = screen.band;

        const duration = Number(screen.duration ?? defaultDuration);
        const pageName = `${String(index + 1).padStart(2, '0')}-bleed.html`;
        const totalGuess = screens.reduce((sum, entry) => sum + Number(entry?.duration ?? defaultDuration), 0) - transition * (screens.length - 1);
        writeFileSync(join(projectPath, pageName), buildBleedPage({
          image: asset,
          ...(screen.kicker ? { kicker: String(screen.kicker) } : {}),
          title: Array.isArray(screen.title) ? screen.title.map(String) : [],
          band: placement.band,
          scrim: placement.scrim,
          exposure: placement.exposure,
          treatment: placement.treatment,
          push: placement.push,
          anchor: placement.anchor,
          safe: placement.safe,
          duration,
          at: Number(at.toFixed(3)),
          total: Number(totalGuess.toFixed(3)),
          index: index + 1,
          count: screens.length,
        }), 'utf8');
        pages.push({ kind: 'plate', name: pageName, duration, at: Number(at.toFixed(3)), placement });
        placements.push({ file: screen.file, band: placement.band, anchor: placement.anchor, safe: placement.safe, intent: placement.intent, scrim: placement.scrim, density: placement.density, reason: placement.reason });
        at += duration - transition;
      }
      const numberBeat = structureBeats.find((beat) => beat.kind === 'number');
      const figures = Array.isArray(args?.facts) ? args.facts : [];
      if (numberBeat && figures.length) {
        // Past four values, or when the person asked for a chart, the numbers are
        // drawn instead of set: a bar is read faster than a list of figures.
        const asChart = args?.chart === true || figures.length > 4;
        const pageName = asChart ? '98-chart.html' : '98-figure.html';
        // The two builders read the same numbers under different names.
        const pageHtml = asChart
          ? buildChartPage({
            kicker: typeof args?.brand === 'string' ? args.brand : undefined,
            items: figures.map((figure) => ({
              label: typeof figure?.label === 'string' ? figure.label : '',
              value: Number(figure?.value ?? 0),
              ...(typeof figure?.unit === 'string' ? { unit: figure.unit } : {}),
            })),
            duration: numberBeat.duration,
            ...(typeof args?.note === 'string' ? { note: args.note } : {}),
          })
          : buildFigurePage({
            kicker: typeof args?.brand === 'string' ? args.brand : undefined,
            figures,
            duration: numberBeat.duration,
            ...(typeof args?.note === 'string' ? { note: args.note } : {}),
          });
        writeFileSync(join(projectPath, pageName), pageHtml, 'utf8');
        pages.push({ kind: 'number', name: pageName, duration: numberBeat.duration, at: Number(at.toFixed(3)), placement: { band: 'middle', anchor: 'left', intent: 'loud', reason: 'a figure leads' } });
        at += numberBeat.duration - transition;
      }

      const claimBeat = structureBeats.find((beat) => beat.kind === 'claim');
      if (claimBeat) {
        const pageName = '99-claim.html';
        writeFileSync(join(projectPath, pageName), buildTextPage({
          kind: 'claim',
          claim: claimBeat.claim ?? '',
          duration: claimBeat.duration,
          ...(typeof args?.kicker === 'string' ? { kicker: args.kicker } : {}),
        }), 'utf8');
        pages.push({ kind: 'claim', name: pageName, duration: claimBeat.duration, at: Number(at.toFixed(3)), placement: { band: 'middle', anchor: 'left', intent: 'statement', reason: 'claim card' } });
        at += claimBeat.duration - transition;
      }
      const endBeat = structureBeats.find((beat) => beat.kind === 'end');
      if (endBeat) {
        const pageName = 'zz-end.html';
        writeFileSync(join(projectPath, pageName), buildTextPage({
          kind: 'end',
          url: endBeat.url ?? '',
          duration: endBeat.duration,
          ...(typeof args?.brand === 'string' ? { kicker: args.brand } : {}),
        }), 'utf8');
        pages.push({ kind: 'end', name: pageName, duration: endBeat.duration, at: Number(at.toFixed(3)), placement: { band: 'middle', anchor: 'left', intent: 'statement', reason: 'end card' } });
        at += endBeat.duration - transition;
      }

      const total = Number((at + transition).toFixed(3));

      const iframes = [];
      pages.forEach((page, index) => {
        const next = pages[index + 1];
        const head = index === 0 ? 0 : transition;
        const tail = next ? transition : 0;
        iframes.push(`  <iframe src="${page.name}#t=${head.toFixed(2)},${(page.duration - tail).toFixed(2)}"${index > 0 ? ` at="${(page.at + head).toFixed(2)}"` : ''}></iframe>`);
        if (!next) return;
        const duoName = `join-${index + 1}.html`;
        writeFileSync(join(projectPath, duoName), buildDuoPage({
          from: page.name,
          to: next.name,
          kind: 'depth',
          duration: transition,
          fromAt: page.duration - transition,
          toAt: 0,
        }), 'utf8');
        iframes.push(`  <iframe src="${duoName}#t=0,${transition.toFixed(2)}" at="${(page.at + page.duration - transition).toFixed(2)}"></iframe>`);
      });

      const score = composeForShots({
        shots: pages.map((page, index) => ({
          at: page.at,
          length: pages[index + 1] ? Number((page.duration - transition).toFixed(3)) : page.duration,
        })),
        mood: 'warm',
        bpm: 88,
        grid: null,
        groove: 'sparse',
        fills: false,
        cutKinds: pages.map(() => 'scene'),
      });
      writeFileSync(join(projectPath, 'assets', 'score.wav'), renderScoreWav(score));

      writeFileSync(join(projectPath, 'film.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=1920, height=1080">
<style>html, body { margin: 0; background: #000; } iframe { border: 0; }</style></head>
<body>
<section><audio src="assets/score.wav" at="0" volume="0.9"></audio></section>
<section>
${iframes.join('\n')}
</section>
</body></html>
`, 'utf8');

      writeFileSync(join(projectPath, '.film', 'plan.json'), `${JSON.stringify({
        genre: 'product-mg',
        label: '按素材构图',
        aspect: '16:9',
        seconds: total,
        // One beat per page, with the kind it really is: a title card and a chart
        // are shots too, and the panel draws a still for each of them.
        beats: pages.map((page, index) => ({ index: index + 1, page: page.name, at: page.at, length: page.duration, kind: page.kind ?? 'scene', move: 'still' })),
        score: { mood: 'warm', bpm: 88, grid: 0, groove: 'sparse' },
        grade: { preset: 'clean', grain: 0.07, bloom: 0.1, vignette: 0.14, letterbox: 0 },
      }, null, 2)}\n`, 'utf8');

      const result = {
        ok: true,
        problems: [],
        project: projectPath,
        seconds: total,
        pages: pages.length,
        placements,
        // When the order and lengths came from the material, say what it read.
        ...(structure ? {
          structure: {
            order: structure.order,
            beats: structure.beats,
            // A number beat has no page of its own: the figure rides on a plate.
            unrealized: structure.beats
              .filter((beat) => !['plate', 'type', 'number', 'claim', 'end'].includes(beat.kind))
              .map((beat) => beat.kind),
          },
        } : {}),
      };
      if (args?.render === true) {
        const rendered = await runOpenfilm(['render'], { cwd: projectPath, sessionId: exec?.sessionId, ctx });
        if (rendered.exitCode === 0) {
          const newest = readdirSync(projectPath).filter((entry) => entry.endsWith('.mp4')).sort().pop();
          result.rendered = newest ?? '';
        } else {
          result.ok = false;
          result.problems.push(`render failed: ${String(rendered.stderr || rendered.stdout).slice(0, 400)}`);
        }
      }
      return result;
    },
  };
}

const MISE_RENDER_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
    out: { type: 'string' },
    frames: { type: 'number' },
    seconds: { type: 'number' },
    clips: { type: 'number' },
    audio: { type: 'number' },
  },
  required: ['ok', 'problems'],
};

function renderMiseOutput(value) {
  const lines = [];
  if (!value.ok) {
    lines.push('render: failed');
    for (const problem of value.problems ?? []) lines.push(`  - ${problem}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  lines.push(`rendered ${value.out}`);
  lines.push(`${value.frames} frames · ${value.seconds}s · ${value.clips} clips · ${value.audio} audio track(s)`);
  return [{ type: 'text', text: lines.join('\n') }];
}

function buildMiseRenderTool(ctx) {
  return {
    name: 'mise_render',
    description:
      'Render a film project to MP4 with Mise\'s own renderer: it serves the project over a throwaway loopback server, drives each page\'s ' +
      'clock frame by frame in a headless browser, and muxes the film\'s audio with ffmpeg. No Studio, no web app, no OpenFilm runtime.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; defaults to the session working directory.' },
        entry: { type: 'string', description: 'Entry page (default film.html).' },
        out: { type: 'string', description: 'Output file, relative to the project (default mise-<timestamp>.mp4).' },
        fps: { type: 'number', description: 'Frame rate (default 30).' },
        width: { type: 'number', description: 'Frame width (default 1920).' },
        height: { type: 'number', description: 'Frame height (default 1080).' },
      },
    },
    output: { schema: MISE_RENDER_OUTPUT_SCHEMA, render: renderMiseOutput },
    presentCall: (args) => ({ card: 'generic', title: 'Render with Mise', kind: 'other', rawInput: args?.cwd ?? 'session' }),
    async execute(args) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd) ?? cwd;
      try {
        const result = await renderFilm({
          projectDir: projectPath,
          ...(typeof args?.entry === 'string' && args.entry ? { entry: args.entry } : {}),
          ...(typeof args?.out === 'string' && args.out ? { out: join(projectPath, args.out) } : {}),
          ...(args?.fps !== undefined ? { fps: Number(args.fps) } : {}),
          ...(args?.width !== undefined ? { width: Number(args.width) } : {}),
          ...(args?.height !== undefined ? { height: Number(args.height) } : {}),
        });
        return { ok: true, problems: [], ...result, out: relative(projectPath, result.out) };
      } catch (error) {
        return { ok: false, problems: [error?.message ?? String(error)] };
      }
    },
  };
}

const MISE_THUMBS_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
    thumbs: { type: 'number' },
    dir: { type: 'string' },
  },
  required: ['ok', 'problems'],
};

function renderMiseThumbsOutput(value) {
  if (!value.ok) {
    const lines = ['thumbs: failed'];
    for (const problem of value.problems ?? []) lines.push(`  - ${problem}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  return [{ type: 'text', text: `thumbs: ${value.thumbs} stills in ${value.dir}` }];
}

function buildMiseThumbsTool(ctx) {
  return {
    name: 'mise_thumbs',
    description:
      'Draw one still per shot and cache it under .film/thumbs, so the sidebar\'s timeline shows the frame each shot really opens on instead of a label. ' +
      'Uses Mise\'s own renderer; no Studio, no web app.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; defaults to the session working directory.' },
        width: { type: 'number', description: 'Thumbnail width in pixels (default 480).' },
      },
    },
    output: { schema: MISE_THUMBS_OUTPUT_SCHEMA, render: renderMiseThumbsOutput },
    presentCall: (args) => ({ card: 'generic', title: 'Draw shot stills', kind: 'other', rawInput: args?.cwd ?? 'session' }),
    async execute(args) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd) ?? cwd;
      try {
        // Times: a third of the way into each shot, where the frame has settled.
        const storyboard = describeStoryboard(projectPath);
        const times = (storyboard.beats ?? [])
          .filter((beat) => beat.length > 0)
          .map((beat) => Number((beat.at + beat.length * 0.35).toFixed(2)));
        if (!times.length) return { ok: false, problems: ['the film has no shots to draw'] };
        const result = await grabFrames({
          projectDir: projectPath,
          times,
          width: Number(args?.width ?? 480),
        });
        return { ok: true, problems: [], thumbs: result.thumbs.length, dir: relative(projectPath, result.outDir) || '.film/thumbs' };
      } catch (error) {
        return { ok: false, problems: [error?.message ?? String(error)] };
      }
    },
  };
}

const MISE_LOOK_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
    sheet: { type: 'string' },
    frames: { type: 'number' },
    loudness: {
      type: 'object',
      additionalProperties: false,
      properties: {
        integrated: { type: 'number' },
        truePeak: { type: 'number' },
        lra: { type: 'number' },
      },
    },
  },
  required: ['ok', 'problems'],
};

function renderMiseLookOutput(value) {
  if (!value.ok) {
    const lines = ['look: failed'];
    for (const problem of value.problems ?? []) lines.push(`  - ${problem}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  if (Array.isArray(value.compare)) {
    const lines = ['compare: per shot'];
    for (const row of value.compare) {
      lines.push(row.ok
        ? `  ${row.time}s  ${String(row.changedPercent).padStart(5)}% changed  brightness ${row.brightnessBefore} → ${row.brightnessAfter}  centroid ${row.centroidShift > 0 ? '+' : ''}${row.centroidShift}`
        : `  ${row.time}s  could not compare: ${(row.problems ?? []).join('; ')}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  }
  const lines = [`sheet: ${value.sheet}`, `${value.frames} frames`];
  if (value.loudness) {
    lines.push(`loudness: ${value.loudness.integrated} LUFS · peak ${value.loudness.truePeak} dBTP · LRA ${value.loudness.lra}`);
  }
  return [{ type: 'text', text: lines.join('\n') }];
}

function buildMiseLookTool(ctx) {
  return {
    name: 'mise_look',
    description:
      'Look at a film: draw stills at chosen times with Mise\'s own renderer, tile them into one contact sheet, and measure the film\'s loudness so ' +
      'the picture and the sound are judged together. Replaces the vendored runtime\'s look.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; defaults to the session working directory.' },
        times: { type: 'array', items: { type: 'number' }, description: 'Seconds to draw (default: the middle of each shot).' },
        cols: { type: 'number', description: 'Columns in the sheet (default 3).' },
        cellWidth: { type: 'number', description: 'Width of one cell in pixels (default 640).' },
        video: { type: 'string', description: 'File to measure loudness from (default: the newest mp4 in the project).' },
        compare: {
          type: 'object',
          additionalProperties: false,
          properties: {
            before: { type: 'string', description: 'The earlier render, relative to the project.' },
            after: { type: 'string', description: 'The later render, relative to the project.' },
          },
          required: ['before', 'after'],
        },
      },
    },
    output: { schema: MISE_LOOK_OUTPUT_SCHEMA, render: renderMiseLookOutput },
    presentCall: (args) => ({ card: 'generic', title: 'Look at the film', kind: 'other', rawInput: args?.cwd ?? 'session' }),
    async execute(args) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd) ?? cwd;
      try {
        const storyboard = describeStoryboard(projectPath);
        // Compare mode answers "did the shot that had to change change", so it
        // reports per shot instead of drawing a sheet.
        if (args?.compare && typeof args.compare.before === 'string' && typeof args.compare.after === 'string') {
          const times = Array.isArray(args?.times) && args.times.length
            ? args.times.map(Number)
            : (storyboard.beats ?? [])
              .filter((beat) => beat.length > 0 && !/^join-/.test(String(beat.page ?? '')))
              .map((beat) => Number((beat.at + beat.length / 2).toFixed(2)));
          const compared = await compareFrames({
            times,
            before: join(projectPath, args.compare.before),
            after: join(projectPath, args.compare.after),
            width: Math.max(320, Number(args?.cellWidth ?? 480)),
          });
          return { ok: true, problems: [], compare: compared.shots };
        }
        const times = Array.isArray(args?.times) && args.times.length
          ? args.times.map(Number)
          : (storyboard.beats ?? [])
            .filter((beat) => beat.length > 0 && !/^join-/.test(String(beat.page ?? '')))
            .map((beat) => Number((beat.at + beat.length / 2).toFixed(2)));
        if (!times.length) return { ok: false, problems: ['the film has no shots to look at'] };

        const outDir = join(projectPath, '.film', 'cache', 'look');
        const grabbed = await grabFrames({ projectDir: projectPath, times, width: Math.max(320, Number(args?.cellWidth ?? 640)) });
        const sheetPath = join(outDir, 'contact-sheet.png');
        let sheet = null;
        let sheetNote = '';
        try {
          sheet = await tileSheet({
            files: grabbed.thumbs.map((thumb) => thumb.file),
            out: sheetPath,
            cols: Number(args?.cols ?? 3),
            cellWidth: Math.max(320, Number(args?.cellWidth ?? 640)),
          });
        } catch (error) {
          // No ffmpeg: the frames exist, the tiled sheet does not.
          sheetNote = `contact sheet skipped (${String(error?.message ?? error).slice(0, 120)}); the stills are in .film/cache/look`;
        }

        // Loudness from the film's own output, when there is one.
        let video = typeof args?.video === 'string' && args.video ? join(projectPath, args.video) : null;
        if (!video) {
          const mp4s = readdirSync(projectPath)
            .filter((name) => name.toLowerCase().endsWith('.mp4'))
            .map((name) => ({ name, at: statSync(join(projectPath, name)).mtimeMs }))
            .sort((a, b) => Number(/-delivered/.test(b.name)) - Number(/-delivered/.test(a.name)) || b.at - a.at);
          video = mp4s.length ? join(projectPath, mp4s[0].name) : null;
        }
        const loudness = video && existsSync(video)
          ? (() => { const parsed = measureLoudness(video); return { ok: Number.isFinite(parsed?.integrated), integrated: parsed?.integrated, truePeak: parsed?.truePeak, lra: parsed?.lra }; })()
          : { ok: false };

        return {
          ok: true,
          problems: [],
          ...(sheet ? { sheet: (relative(projectPath, sheetPath) || '.film/cache/look/contact-sheet.png').split(sep).join('/') } : {}),
          frames: grabbed.thumbs.length,
          ...(sheetNote ? { problems: [sheetNote] } : {}),
          ...(loudness.ok ? { loudness: { integrated: loudness.integrated, truePeak: loudness.truePeak, lra: loudness.lra } } : {}),
        };
      } catch (error) {
        return { ok: false, problems: [error?.message ?? String(error)] };
      }
    },
  };
}

function buildDuoTool(ctx) {
  return {
    name: 'mise_duo',
    description:
      'Write a presentation transition: the outgoing page and the incoming page are both on screen while their presentation animates (slide / fade / wipe / push-up). ' +
      'The page hosts both sources in iframes and drives their clocks itself, so it works in the one-page-per-clip film model. ' +
      'Use it in place of the two shots at a cut: this is how editing reads, rather than an overlay painted over the join.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; defaults to the session working directory.' },
        name: { type: 'string', description: 'Page file name without .html, kebab-case.' },
        from: { type: 'string', description: 'Outgoing page, relative to the project.' },
        to: { type: 'string', description: 'Incoming page, relative to the project.' },
        kind: { type: 'string', enum: DUO_KINDS, description: 'slide (default), fade, wipe or push-up.' },
        duration: { type: 'number', description: 'Seconds (default 1; 0.2..8).' },
        direction: { type: 'string', enum: ['left', 'right', 'up', 'down'], description: 'Default left.' },
        fromAt: { type: 'number', description: 'Local time the outgoing page starts at (default 0).' },
        toAt: { type: 'number', description: 'Local time the incoming page starts at (default 0).' },
        force: { type: 'boolean', description: 'Overwrite an existing page of that name.' },
      },
      required: ['name', 'from', 'to'],
    },
    output: { schema: DUO_OUTPUT_SCHEMA, render: renderDuoOutput },
    presentCall: (args) => ({ card: 'generic', title: `Duo transition: ${args?.kind ?? 'slide'}`, kind: 'other', rawInput: `${args?.from} → ${args?.to}` }),
    async execute(args) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_duo: no film project around ${cwd} (no film.html found).`);
      const name = String(args?.name ?? '').trim().replace(/\.html$/i, '');
      if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(name)) throw new Error('mise_duo: `name` must be kebab-case');
      const spec = {
        from: typeof args?.from === 'string' ? args.from : '',
        to: typeof args?.to === 'string' ? args.to : '',
        ...(typeof args?.kind === 'string' && args.kind ? { kind: args.kind } : {}),
        ...(args?.duration !== undefined ? { duration: Number(args.duration) } : {}),
        ...(typeof args?.direction === 'string' && args.direction ? { direction: args.direction } : {}),
        ...(args?.fromAt !== undefined ? { fromAt: Number(args.fromAt) } : {}),
        ...(args?.toAt !== undefined ? { toAt: Number(args.toAt) } : {}),
      };
      const verdict = validateDuoSpec(spec, { exists: (rel) => existsSync(join(projectPath, rel)) });
      if (!verdict.ok) return { ok: false, problems: verdict.problems };
      const relative = `${name}.html`;
      if (existsSync(join(projectPath, relative)) && args?.force !== true) return { ok: false, problems: [`${relative} already exists; pass force to replace it`] };
      writeFileSync(join(projectPath, relative), buildDuoPage(spec), 'utf8');
      return { ok: true, relative, kind: spec.kind ?? 'slide', duration: Number(spec.duration ?? 1), problems: [] };
    },
    isConcurrencySafe: () => false,
  };
}

/** ── Transitions and the finishing grade ────────────────────────────────── */

const TRANSITION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    relative: { type: 'string' },
    kind: { type: 'string' },
    duration: { type: 'number' },
    snippet: { type: 'string' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok'],
};

function renderTransitionOutput(_args, value) {
  if (value?.ok !== true) {
    const lines = ['mise_transition could not write the page:'];
    for (const p of value?.problems ?? []) lines.push(`  - ${p}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  return [{
    type: 'text',
    text: `${value.relative} — ${value.kind}, ${value.duration}s overlay.\nPut it on a track ABOVE the pictures, centred on the cut:\n  ${value.snippet}`,
  }];
}

function buildTransitionTool(ctx) {
  return {
    name: 'mise_transition',
    description:
      'Write a transition overlay: an element that covers a cut so the join reads as a move. Kinds: line (a line opens into a band), wipe, iris, rgb strips, letterbox bars, flash. ' +
      'The page is transparent where it does not paint; place it on a track above the pictures, starting half its duration before the cut. ' +
      'Use it at the few joins that matter — a transition on every cut is how a film starts to look like a template.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; defaults to the session working directory.' },
        name: { type: 'string', description: 'Page file name without .html, kebab-case.' },
        kind: { type: 'string', description: `One of: ${TRANSITION_KINDS.join(', ')}. Default line.` },
        duration: { type: 'number', description: 'Seconds (default 0.7; 0.05..5).' },
        color: { type: 'string', description: `One of: ${Object.keys(TRANSITION_COLORS).join(', ')}. Default black (use ink for a deliberate white flash).` },
        direction: { type: 'string', enum: ['left', 'right', 'up', 'down'], description: 'Default right.' },
        thickness: { type: 'number', description: '0..1 line weight (default 0.5).' },
        softness: { type: 'number', description: '0..1 edge softness (default 0.2).' },
        force: { type: 'boolean', description: 'Overwrite an existing page of that name.' },
      },
      required: ['name'],
    },
    output: { schema: TRANSITION_OUTPUT_SCHEMA, render: renderTransitionOutput },
    presentCall: (args) => ({ card: 'generic', title: `Transition: ${args?.kind ?? 'line'}`, kind: 'other', rawInput: args?.name }),
    async execute(args) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_transition: no film project around ${cwd} (no film.html found).`);
      const name = String(args?.name ?? '').trim().replace(/\.html$/i, '');
      if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(name)) throw new Error('mise_transition: `name` must be kebab-case');
      const spec = {
        kind: typeof args?.kind === 'string' ? args.kind : 'line',
        ...(args?.duration !== undefined ? { duration: Number(args.duration) } : {}),
        ...(typeof args?.color === 'string' && args.color ? { color: args.color } : {}),
        ...(typeof args?.direction === 'string' && args.direction ? { direction: args.direction } : {}),
        ...(args?.thickness !== undefined ? { thickness: Number(args.thickness) } : {}),
        ...(args?.softness !== undefined ? { softness: Number(args.softness) } : {}),
      };
      const verdict = validateTransitionSpec(spec);
      if (!verdict.ok) return { ok: false, problems: verdict.problems };
      const relative = `${name}.html`;
      if (existsSync(join(projectPath, relative)) && args?.force !== true) return { ok: false, problems: [`${relative} already exists; pass force to replace it`] };
      writeFileSync(join(projectPath, relative), buildTransitionPage(spec), 'utf8');
      const duration = Number(spec.duration ?? 0.7);
      return { ok: true, relative, kind: spec.kind, duration, snippet: `<iframe src="${relative}#t=0,${duration}" at="<cut - ${(duration / 2).toFixed(2)}>"></iframe>` };
    },
    isConcurrencySafe: () => false,
  };
}

const GRADE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    input: { type: 'string' },
    output: { type: 'string' },
    preset: { type: 'string' },
    filter: { type: 'string' },
    bytes: { type: 'integer' },
    problems: { type: 'array', items: { type: 'string' } },
    error: { type: 'string' },
  },
  required: ['ok'],
};

function renderGradeOutput(_args, value) {
  if (value?.ok !== true) {
    const lines = ['mise_grade could not run:'];
    for (const p of value?.problems ?? []) lines.push(`  - ${p}`);
    if (value?.error) lines.push(`  - ${value.error}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  return [{
    type: 'text',
    text: `${value.output} — ${value.preset}, ${Math.round((value.bytes ?? 0) / 1024)} KB.\nFilter chain: ${value.filter}`,
  }];
}

function buildGradeTool(ctx) {
  return {
    name: 'mise_grade',
    description:
      'Finish a rendered film with one grade: a preset (warm-film, teal-orange, noir, clean, faded-print), film grain, corner falloff, bloom and optional letterbox bars, applied by ffmpeg in one pass. ' +
      'Use it after render so every shot shares one look; the source file is left untouched.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; defaults to the session working directory.' },
        input: { type: 'string', description: 'Rendered clip, relative to the project; defaults to the newest mp4.' },
        out: { type: 'string', description: 'Output file (default <input>-graded.mp4).' },
        preset: { type: 'string', description: `One of: ${Object.keys(GRADE_PRESETS).join(', ')}. Default warm-film.` },
        grain: { type: 'number', description: '0..1, default 0.10.' },
        vignette: { type: 'number', description: '0..1, default 0.35.' },
        bloom: { type: 'number', description: '0..1, default 0.' },
        letterbox: { type: 'number', description: '0..0.45 per bar (e.g. 0.12 for 2.39:1 on a 16:9 frame).' },
        crf: { type: 'number', description: 'x264 CRF (default 17).' },
        force: { type: 'boolean', description: 'Finish even when the export gate is closed (planned films gate by default).' },
      },
    },
    output: { schema: GRADE_OUTPUT_SCHEMA, render: renderGradeOutput },
    presentCall: (args) => ({ card: 'generic', title: `Grade: ${args?.preset ?? 'warm-film'}`, kind: 'other', rawInput: args?.input ?? '(newest mp4)' }),
    async execute(args) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_grade: no film project around ${cwd} (no film.html found).`);

      // A planned film has opted into the gate: finishing an unaccepted cut is
      // how a film ships with a blank frame nobody saw.
      if (args?.force !== true && existsSync(join(projectPath, '.film', 'plan.json'))) {
        const gate = projectGate(projectPath);
        if (!gate.ok) {
          return { ok: false, problems: [`export gate closed — ${gate.blockers.join('; ')}`, 'fix the gate, or pass force to finish anyway'] };
        }
      }

      const probe = probeFfmpeg();
      if (!probe.ok) return { ok: false, problems: ['ffmpeg not found on PATH (or DSH_FFMPEG)'] };

      let input = typeof args?.input === 'string' && args.input ? args.input : '';
      if (!input) {
        const newest = readdirSync(projectPath).filter((n) => n.toLowerCase().endsWith('.mp4'))
          .map((n) => ({ n, m: statSync(join(projectPath, n)).mtimeMs }))
          .sort((a, b) => b.m - a.m)[0];
        if (!newest) return { ok: false, problems: ['no mp4 in the project yet; render one first'] };
        input = newest.n;
      }
      const output = typeof args?.out === 'string' && args.out ? args.out : `${input.replace(/\.mp4$/i, '')}-graded.mp4`;
      const plan = planGrade({
        input: join(projectPath, input),
        output: join(projectPath, output),
        preset: typeof args?.preset === 'string' ? args.preset : undefined,
        grain: args?.grain !== undefined ? Number(args.grain) : undefined,
        vignette: args?.vignette !== undefined ? Number(args.vignette) : undefined,
        bloom: args?.bloom !== undefined ? Number(args.bloom) : undefined,
        letterbox: args?.letterbox !== undefined ? Number(args.letterbox) : undefined,
        crf: args?.crf !== undefined ? Number(args.crf) : undefined,
      }, { filters: probe.filters });
      if (!plan.ok) return { ok: false, problems: plan.problems };

      const run = spawnSync(toolPath('ffmpeg'), plan.args, { encoding: 'utf8', windowsHide: true, timeout: 30 * 60 * 1000 });
      if (run.status !== 0 || !existsSync(join(projectPath, output))) {
        return { ok: false, problems: [`ffmpeg failed: ${(run.stderr || '').slice(0, 300) || 'no output'}`] };
      }
      return { ok: true, input, output, preset: args?.preset ?? 'warm-film', filter: plan.filter, bytes: statSync(join(projectPath, output)).size };
    },
    isConcurrencySafe: () => false,
  };
}

/** ── Scenes: code-native geometry, camera and light ─────────────────────── */

const SCENE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    relative: { type: 'string' },
    panels: { type: 'integer' },
    duration: { type: 'number' },
    move: { type: 'string' },
    palette: { type: 'string' },
    snippet: { type: 'string' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok'],
};

function renderSceneOutput(_args, value) {
  if (value?.ok !== true) {
    const lines = ['mise_scene could not write the page:'];
    for (const p of value?.problems ?? []) lines.push(`  - ${p}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  return [{
    type: 'text',
    text: `${value.relative} — ${value.panels} panel(s), ${value.move}, ${value.palette}, ${value.duration}s.\nCut it in with:\n  ${value.snippet}`,
  }];
}

function buildSceneTool(ctx) {
  return {
    name: 'mise_scene',
    description:
      'Write a code-native 3D scene shot: panels in space, a camera that moves through them, a rotating light, dust and type — drawn entirely by the page, no picture required. ' +
      'This is the engine\'s geometry primitive: a picture, when given, is only a texture on a panel. ' +
      'Covers product/keynote/explainer openings where the market uses 3D motion design, but deterministic and without a video model. ' +
      'CSS 3D is used because it is software-rasterised everywhere (no WebGL context to lose).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; defaults to the session working directory.' },
        name: { type: 'string', description: 'Page file name without .html, kebab-case.' },
        panels: {
          type: 'array',
          description: '1–7 panels, placed in space; text and/or an image texture.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              text: { type: 'string', description: 'Headline on the panel.' },
              sub: { type: 'string', description: 'One supporting line.' },
              image: { type: 'string', description: 'Optional picture used as the panel texture, relative to the project.' },
              x: { type: 'number', description: 'Horizontal offset in px (default spread).' },
              y: { type: 'number', description: 'Vertical offset in px (default spread).' },
              z: { type: 'number', description: 'Depth offset in px (default spread).' },
              rotate: { type: 'number', description: 'RotateY in degrees (default faces the camera slightly).' },
              width: { type: 'number', description: 'Panel width in px (default 460).' },
            },
          },
        },
        move: { type: 'string', description: `Camera move: ${Object.keys(SCENE_MOVES).join(', ')}. Default dolly-through.` },
        palette: { type: 'string', description: `Colour script: ${Object.keys(SCENE_PALETTES).join(', ')}. Default amber.` },
        duration: { type: 'number', description: 'Seconds (default 5).' },
        particles: { type: 'number', description: 'Dust count 0..2000 (default 90).' },
        light: { type: 'number', description: 'Light intensity 0..1 (default 0.55).' },
        grain: { type: 'number', description: 'Grain 0..1 (default 0.14).' },
        force: { type: 'boolean', description: 'Overwrite an existing page of that name.' },
      },
      required: ['name', 'panels'],
    },
    output: { schema: SCENE_OUTPUT_SCHEMA, render: renderSceneOutput },
    presentCall: (args) => ({ card: 'generic', title: `3D scene: ${args?.name ?? ''}`, kind: 'other', rawInput: `${args?.panels?.length ?? 0} panels, ${args?.move ?? 'dolly-through'}` }),
    async execute(args) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_scene: no film project around ${cwd} (no film.html found).`);
      const name = String(args?.name ?? '').trim().replace(/\.html$/i, '');
      if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(name)) throw new Error('mise_scene: `name` must be kebab-case');

      const spec = {
        panels: Array.isArray(args?.panels) ? args.panels.map((panel) => ({
          ...(typeof panel?.text === 'string' ? { text: panel.text } : {}),
          ...(typeof panel?.sub === 'string' ? { sub: panel.sub } : {}),
          ...(typeof panel?.image === 'string' && panel.image ? { image: panel.image } : {}),
          ...(panel?.x !== undefined ? { x: Number(panel.x) } : {}),
          ...(panel?.y !== undefined ? { y: Number(panel.y) } : {}),
          ...(panel?.z !== undefined ? { z: Number(panel.z) } : {}),
          ...(panel?.rotate !== undefined ? { rotate: Number(panel.rotate) } : {}),
          ...(panel?.width !== undefined ? { width: Number(panel.width) } : {}),
        })) : [],
        ...(typeof args?.move === 'string' && args.move ? { move: args.move } : {}),
        ...(typeof args?.palette === 'string' && args.palette ? { palette: args.palette } : {}),
        ...(args?.duration !== undefined ? { duration: Number(args.duration) } : {}),
        ...(args?.particles !== undefined ? { particles: Number(args.particles) } : {}),
        ...(args?.light !== undefined ? { light: Number(args.light) } : {}),
        ...(args?.grain !== undefined ? { grain: Number(args.grain) } : {}),
      };
      const verdict = validateSceneSpec(spec, { exists: (rel) => existsSync(join(projectPath, rel)) });
      if (!verdict.ok) return { ok: false, problems: verdict.problems };

      const relative = `${name}.html`;
      if (existsSync(join(projectPath, relative)) && args?.force !== true) {
        return { ok: false, problems: [`${relative} already exists; pass force to replace it`] };
      }
      writeFileSync(join(projectPath, relative), buildScenePage(spec), 'utf8');
      return {
        ok: true,
        relative,
        panels: spec.panels.length,
        duration: Number(spec.duration ?? 5),
        move: spec.move ?? 'dolly-through',
        palette: spec.palette ?? 'amber',
        snippet: `<iframe src="${relative}#t=0,${Number(spec.duration ?? 5)}"></iframe>`,
      };
    },
    isConcurrencySafe: () => false, // writes a page into the project
  };
}

/** ── Keyframes: a subject that moves, drawn as poses ─────────────────────── */

const KEYFRAMES_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    relative: { type: 'string' },
    frames: { type: 'integer' },
    times: { type: 'array', items: { type: 'number' } },
    duration: { type: 'number' },
    snippet: { type: 'string' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok'],
};

function renderKeyframesOutput(_args, value) {
  if (value?.ok !== true) {
    const lines = ['mise_keyframes could not write the page:'];
    for (const p of value?.problems ?? []) lines.push(`  - ${p}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  return [{
    type: 'text',
    text: `${value.relative} — ${value.frames} poses at ${value.times.map((t) => `${t}s`).join(', ')}, ${value.duration}s.\nCut it in with:\n  ${value.snippet}`,
  }];
}

function buildKeyframesTool(ctx) {
  return {
    name: 'mise_keyframes',
    description:
      'Write a keyframe shot page: 2–8 pictures of the same subject, dissolved at exact times with a slow push, so a changing pose reads as motion — the honest way to get subject movement without a video model. ' +
      'Frames may come from anywhere: an image model drawing the poses, a camera burst, a person\'s sketches. The page only needs files and times. ' +
      'Without explicit `at` times the poses are spread evenly across the shot.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; defaults to the session working directory.' },
        name: { type: 'string', description: 'Page file name without .html, kebab-case.' },
        frames: {
          type: 'array',
          description: 'The poses, in order. 2–8.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              src: { type: 'string', description: 'Picture, relative to the project.' },
              at: { type: 'number', description: 'Optional time in seconds; defaults to evenly spaced.' },
            },
            required: ['src'],
          },
        },
        duration: { type: 'number', description: 'Shot length (default 5).' },
        fade: { type: 'number', description: 'Dissolve length in seconds (default 0.6).' },
        grade: { type: 'string', description: 'Same grades as mise_cine; default warm-film.' },
        grain: { type: 'number', description: '0..1, default 0.16.' },
        vignette: { type: 'number', description: '0..1, default 0.55.' },
        push: { type: 'number', description: 'How far the plate pushes in over the shot (0..1, default 0.04).' },
        drift: { type: 'number', description: 'Handheld drift (0..1, default 0.18).' },
        force: { type: 'boolean', description: 'Overwrite an existing page of that name.' },
      },
      required: ['name', 'frames'],
    },
    output: { schema: KEYFRAMES_OUTPUT_SCHEMA, render: renderKeyframesOutput },
    presentCall: (args) => ({ card: 'generic', title: `Keyframe shot: ${args?.name ?? ''}`, kind: 'other', rawInput: `${args?.frames?.length ?? 0} poses` }),
    async execute(args) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_keyframes: no film project around ${cwd} (no film.html found).`);
      const name = String(args?.name ?? '').trim().replace(/\.html$/i, '');
      if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(name)) throw new Error('mise_keyframes: `name` must be kebab-case');

      const spec = {
        frames: Array.isArray(args?.frames) ? args.frames.map((frame) => ({
          src: String(frame?.src ?? ''),
          ...(frame?.at !== undefined ? { at: Number(frame.at) } : {}),
        })) : [],
        ...(args?.duration !== undefined ? { duration: Number(args.duration) } : {}),
        ...(args?.fade !== undefined ? { fade: Number(args.fade) } : {}),
        ...(typeof args?.grade === 'string' && args.grade ? { grade: args.grade } : {}),
        ...(args?.grain !== undefined ? { grain: Number(args.grain) } : {}),
        ...(args?.vignette !== undefined ? { vignette: Number(args.vignette) } : {}),
        ...(args?.push !== undefined ? { push: Number(args.push) } : {}),
        ...(args?.drift !== undefined ? { drift: Number(args.drift) } : {}),
      };
      const verdict = validateMorphSpec(spec, { exists: (rel) => existsSync(join(projectPath, rel)) });
      if (!verdict.ok) return { ok: false, problems: verdict.problems };

      const relative = `${name}.html`;
      if (existsSync(join(projectPath, relative)) && args?.force !== true) {
        return { ok: false, problems: [`${relative} already exists; pass force to replace it`] };
      }
      const times = keyframeTimes(spec);
      writeFileSync(join(projectPath, relative), buildMorphPage(spec), 'utf8');
      return {
        ok: true,
        relative,
        frames: spec.frames.length,
        times,
        duration: Number(spec.duration ?? 5),
        snippet: `<iframe src="${relative}#t=0,${Number(spec.duration ?? 5)}"></iframe>`,
      };
    },
    isConcurrencySafe: () => false, // writes a page into the project
  };
}

/** ── Doctor: what this machine can do, named plainly ────────────────────── */

const DOCTOR_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    tier: { type: 'string' },
    summary: { type: 'string' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          required: { type: 'boolean' },
          ok: { type: 'boolean' },
          detail: { type: 'string' },
          fix: { type: 'string', description: 'A paste-ready command that fixes this on this platform.' },
        },
        required: ['id', 'ok', 'detail'],
      },
    },
    filters: { type: 'object' },
    recommendations: { type: 'array', items: { type: 'string' } },
    matrix: { type: 'object', description: 'What each capability tier needs.' },
    nextSteps: {
      type: 'array',
      description: 'Only the missing pieces, with the command that fixes each one.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          detail: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['id', 'fix'],
      },
    },
  },
  required: ['ok', 'tier', 'checks'],
};

function renderDoctorOutput(_args, value) {
  const mark = (c) => (c.ok ? '✓' : c.required ? '✗' : '!');
  const lines = [`${value.tier} — ${value.summary}`];
  for (const c of value.checks ?? []) lines.push(`${mark(c)} ${c.id}: ${c.detail}`);
  const filters = Object.entries(value.filters ?? {}).filter(([, v]) => v?.ok).map(([k]) => k);
  if (filters.length) lines.push(`grading filters: ${filters.join(', ')}`);
  for (const step of value.nextSteps ?? []) lines.push(`→ ${step.id}: ${step.fix}`);
  for (const r of value.recommendations ?? []) lines.push(`· ${r}`);
  return [{ type: 'text', text: lines.join('\n') }];
}

/** Probe ffmpeg for its version and filter list (best effort, never throws). */
function probeFfmpeg() {
  const ff = toolPath('ffmpeg');
  const version = spawnSync(ff, ['-hide_banner', '-version'], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
  if (version.error || version.status !== 0) return { ok: false };
  const first = String(version.stdout ?? '').split('\n')[0] ?? '';
  const list = spawnSync(ff, ['-hide_banner', '-filters'], { encoding: 'utf8', windowsHide: true, timeout: 25_000 });
  const filters = list.status === 0
    ? [...new Set(String(list.stdout ?? '').split('\n').map((line) => /^\s*[TSC.]{2,4}\s+(\S+)/.exec(line)?.[1]).filter(Boolean))]
    : [];
  // Encoders matter as much as filters: an ffmpeg without libx264 can decode
  // everything and still be unable to produce the deliverable MP4.
  const encodersRun = spawnSync(ff, ['-hide_banner', '-encoders'], { encoding: 'utf8', windowsHide: true, timeout: 25_000 });
  const encoders = encodersRun.status === 0
    ? [...new Set(String(encodersRun.stdout ?? '').split('\n').map((line) => /^\s*[VAS][A-Z.]{5}\s+(\S+)/.exec(line)?.[1]).filter(Boolean))]
    : [];
  return { ok: true, version: first.replace(/^ffmpeg version\s*/i, '').slice(0, 40), filters, encoders };
}

/** Probe for a headless browser Playwright would use. */
async function probeChromium() {
  try {
    // playwright-core is vendored, not a dependency of the host: resolve it by
    // path, then ask it where its browser lives. Headless rendering uses the
    // headless shell build, which is a different download from full Chromium,
    // so both candidates are checked before answering "missing".
    const require = createRequire(import.meta.url);
    const entry = require.resolve('playwright-core', { paths: [join(PLUGIN_ROOT, 'vendor', 'node_modules')] });
    const mod = await import(pathToFileURL(entry).href);
    // A CJS package imported from ESM may put its API on the default export.
    const chromium = mod.chromium ?? mod.default?.chromium;
    const full = chromium?.executablePath?.();
    const candidates = [full];
    if (typeof full === 'string' && /chromium-(\d+)/.test(full)) {
      candidates.push(
        full
          .replace(/chromium-(\d+)/, 'chromium_headless_shell-$1')
          .replace(/chrome-win64[\\/]chrome\.exe$/i, 'chrome-headless-shell-win64/chrome-headless-shell.exe')
          .replace(/chromium-\d+[\\/]chrome-linux[\\/]chrome/i, 'chromium_headless_shell-$1/chrome-linux/headless_shell'),
      );
    }
    const found = candidates.find((candidate) => typeof candidate === 'string' && existsSync(candidate));
    return { ok: Boolean(found), path: found ?? full };
  } catch {
    return { ok: false };
  }
}

/** Best-effort CJK font presence, by the paths each OS actually uses. */
function probeFonts() {
  const candidates = process.platform === 'win32'
    ? ['C:\\Windows\\Fonts\\msyh.ttc', 'C:\\Windows\\Fonts\\simsun.ttc', 'C:\\Windows\\Fonts\\msyhbd.ttc']
    : process.platform === 'darwin'
      ? ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Light.ttc']
      : ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'];
  const found = candidates.filter((p) => existsSync(p));
  return { cjk: found.length > 0, list: found };
}

/** Optional enhancement packs, looked for in the harness home. */
function probePacks() {
  // Only a pack whose files match its manifest counts as installed: a folder
  // that failed verification must not lift the doctor's tier.
  const packs = listPacks();
  return { installed: packs.filter((p) => p.ok).map((p) => p.name), dir: join(process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh'), 'openfilm-packs') };
}

function buildDoctorTool(ctx) {
  return {
    name: 'mise_doctor',
    description:
      'Check whether this machine can render, animate and grade, and say which tier works here: cinematic (zero downloads), animated (ffmpeg with minterpolate), layered (optional packs), or unsupported. ' +
      'Use it before promising a look, and when a render fails with a missing tool. Read-only: it starts nothing.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: { schema: DOCTOR_OUTPUT_SCHEMA, render: renderDoctorOutput },
    presentCall: () => ({ card: 'generic', title: 'Check the film toolchain', kind: 'read' }),
    async execute() {
      const report = assessEnvironment(await probeEnvironment());
      return {
        ok: report.ok,
        tier: report.tier,
        summary: describeTier(report),
        checks: report.checks,
        filters: report.filters,
        recommendations: report.recommendations,
        matrix: report.matrix,
        nextSteps: report.nextSteps,
      };
    },
    isConcurrencySafe: () => true,
  };
}

/** Everything the doctor and the onboarding read from this machine. */
async function probeEnvironment() {
  const [chromium] = await Promise.all([probeChromium()]);
  return {
    platform: process.platform,
    node: process.versions.node,
    ffmpeg: probeFfmpeg(),
    ffprobe: { ok: !spawnSync(toolPath('ffprobe'), ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 20_000 }).error },
    chromium,
    fonts: probeFonts(),
    packs: probePacks(),
  };
}

/** ── First run: what this install can do, and the one command to prove it ── */

const START_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    tier: { type: 'string' },
    headline: { type: 'string' },
    canDo: { type: 'array', items: { type: 'string' } },
    firstStep: { type: 'string' },
    reason: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'tier', 'headline', 'firstStep'],
};

function renderStartOutput(_args, value) {
  const lines = [`这台机器：${value.headline}`];
  if (value.canDo?.length) {
    lines.push('已经能做：');
    for (const item of value.canDo) lines.push(`  · ${item}`);
  }
  if (value.reason) lines.push(`先修这一项 — ${value.reason}`);
  lines.push(`下一步：${value.firstStep}`);
  const rest = (value.steps ?? []).filter((step) => step !== value.firstStep);
  for (const step of rest) lines.push(`  ${step}`);
  return [{ type: 'text', text: lines.join('\n') }];
}

function buildStartTool(ctx) {
  return {
    name: 'mise_start',
    description:
      'The first thing to read on a new machine: what this install can already do, the single command that proves it with a sample film, and — when something is missing — the one fix that unblocks the most. ' +
      'Read-only: it probes, it does not render.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: { schema: START_OUTPUT_SCHEMA, render: renderStartOutput },
    presentCall: () => ({ card: 'generic', title: 'Start here', kind: 'read' }),
    async execute() {
      return startGuide(assessEnvironment(await probeEnvironment()));
    },
    isConcurrencySafe: () => true,
  };
}

/** ── Optional packs: depth parallax and interpolation, verified ─────────── */

const PACK_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    action: { type: 'string' },
    packs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
          kind: { type: 'string' },
          ok: { type: 'boolean' },
          problems: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'ok'],
      },
    },
    message: { type: 'string' },
    error: { type: 'string' },
  },
  required: ['ok', 'action'],
};

function renderPackOutput(_args, value) {
  if (value?.error) return [{ type: 'text', text: value.error }];
  const lines = [];
  if (!value.packs?.length) lines.push('no packs installed.');
  for (const p of value.packs ?? []) {
    lines.push(`${p.ok ? '✓' : '✗'} ${p.name}${p.version ? ` ${p.version}` : ''}${p.kind ? ` · ${p.kind}` : ''}`);
    for (const problem of p.problems ?? []) lines.push(`    ${problem}`);
  }
  if (value.message) lines.push(value.message);
  return [{ type: 'text', text: lines.join('\n') }];
}

function buildPackTool(ctx) {
  return {
    name: 'mise_pack',
    description:
      'Optional enhancement packs — depth parallax and frame interpolation — as something the person installs, not something the plugin ships. ' +
      'A pack is a folder with pack.json (name, version, kind, and a sha256 per file); install copies it into the harness home and verifies every hash, so a corrupt or tampered pack never becomes active. ' +
      'Actions: list (default), verify, install (from a local folder), remove. The doctor only counts packs that verify. ' +
      'Use this instead of promising depth parallax on a machine that has no depth pack.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list', 'verify', 'install', 'remove'], description: 'Default list.' },
        from: { type: 'string', description: 'install: the pack folder to copy in.' },
        name: { type: 'string', description: 'verify/remove: the installed pack name.' },
        force: { type: 'boolean', description: 'install: replace an installed pack of the same name.' },
      },
    },
    output: { schema: PACK_OUTPUT_SCHEMA, render: renderPackOutput },
    presentCall: (args) => ({ card: 'generic', title: `Enhancement packs (${args?.action ?? 'list'})`, kind: 'read', rawInput: args?.name ?? args?.from }),
    async execute(args) {
      const action = ['verify', 'install', 'remove'].includes(args?.action) ? args.action : 'list';
      try {
        if (action === 'install') {
          if (typeof args?.from !== 'string' || !args.from) throw new Error('install needs `from` (the pack folder)');
          const result = installPack({ from: args.from, force: args.force === true });
          return { ok: true, action, packs: listPacks().map(compactPack), message: `installed ${result.name} (${result.checked} file(s) verified)` };
        }
        if (action === 'remove') {
          if (typeof args?.name !== 'string' || !args.name) throw new Error('remove needs `name`');
          removePack(args.name);
          return { ok: true, action, packs: listPacks().map(compactPack), message: `removed ${args.name}` };
        }
        if (action === 'verify') {
          if (typeof args?.name !== 'string' || !args.name) throw new Error('verify needs `name`');
          const packs = listPacks();
          const found = packs.find((p) => p.name === args.name);
          if (!found) throw new Error(`no pack ${args.name}`);
          return { ok: found.ok, action, packs: [compactPack(found)], message: found.ok ? 'every file matches the manifest' : 'this pack does not verify; it is not active' };
        }
        return { ok: true, action, packs: listPacks().map(compactPack) };
      } catch (error) {
        return { ok: false, action, error: error instanceof Error ? error.message : String(error) };
      }
    },
    isConcurrencySafe: () => false, // install/remove write to the harness home
  };
}

/** A pack row without its absolute dir, for a tool result. */
function compactPack(pack) {
  return {
    name: String(pack.name ?? ''),
    ...(pack.version ? { version: String(pack.version) } : {}),
    ...(pack.kind ? { kind: String(pack.kind) } : {}),
    ok: pack.ok === true,
    problems: Array.isArray(pack.problems) ? pack.problems.slice(0, 5).map(String) : [],
  };
}

/** ── The two things a pack buys: a depth map, and a higher frame rate ────── */

const INTERPOLATE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    input: { type: 'string' },
    output: { type: 'string' },
    fps: { type: 'number' },
    mode: { type: 'string' },
    bytes: { type: 'integer' },
    problems: { type: 'array', items: { type: 'string' } },
    error: { type: 'string' },
  },
  required: ['ok'],
};

function renderInterpolateOutput(_args, value) {
  if (value?.ok !== true) {
    const lines = ['mise_interpolate could not run:'];
    for (const p of value?.problems ?? []) lines.push(`  - ${p}`);
    if (value?.error) lines.push(`  - ${value.error}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  return [{
    type: 'text',
    text: `${value.output} — ${value.fps} fps (${value.mode}), ${Math.round((value.bytes ?? 0) / 1024)} KB.\nSource: ${value.input}`,
  }];
}

function buildInterpolateTool(ctx) {
  return {
    name: 'mise_interpolate',
    description:
      'Lift a rendered clip to a higher frame rate with ffmpeg minterpolate (motion-compensated by default; blend as the cheap fallback). ' +
      'This is the "animated" tier: draw a film at 30 fps, deliver at 60, without a video model. ' +
      'The source is left untouched; the result is written beside it (or to `out`). If the installed ffmpeg has no minterpolate, the call is refused with that reason instead of producing a duplicate file.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; defaults to the session working directory.' },
        input: { type: 'string', description: 'Clip to interpolate, relative to the project; defaults to the newest mp4 in it.' },
        out: { type: 'string', description: 'Output file, relative to the project; defaults to <input>-<fps>.mp4.' },
        fps: { type: 'number', description: 'Target frame rate (default 60, 12..120).' },
        mode: { type: 'string', enum: ['mci', 'blend'], description: 'mci = motion-compensated (default), blend = cheap.' },
        force: { type: 'boolean', description: 'Interpolate even when the export gate is closed.' },
      },
    },
    output: { schema: INTERPOLATE_OUTPUT_SCHEMA, render: renderInterpolateOutput },
    presentCall: (args) => ({ card: 'generic', title: 'Interpolate a clip', kind: 'other', rawInput: `${args?.input ?? '(newest mp4)'} → ${args?.fps ?? 60}fps` }),
    async execute(args) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_interpolate: no film project around ${cwd} (no film.html found).`);

      if (args?.force !== true && existsSync(join(projectPath, '.film', 'plan.json'))) {
        const gate = projectGate(projectPath);
        if (!gate.ok) {
          return { ok: false, problems: [`export gate closed — ${gate.blockers.join('; ')}`, 'fix the gate, or pass force to interpolate anyway'] };
        }
      }

      const probe = probeFfmpeg();
      if (!probe.ok) return { ok: false, problems: ['ffmpeg not found on PATH (or DSH_FFMPEG); interpolation needs it'] };
      if (!probe.filters.includes('minterpolate')) return { ok: false, problems: ['this ffmpeg has no minterpolate filter; install a full build (gyan.dev / Homebrew ffmpeg)'] };

      let input = typeof args?.input === 'string' && args.input ? args.input : '';
      if (!input) {
        const newest = readdirSync(projectPath).filter((n) => n.toLowerCase().endsWith('.mp4'))
          .map((n) => ({ n, m: statSync(join(projectPath, n)).mtimeMs }))
          .sort((a, b) => b.m - a.m)[0];
        if (!newest) return { ok: false, problems: ['no mp4 in the project yet; render one first'] };
        input = newest.n;
      }
      const fps = Number(args?.fps ?? 60);
      const mode = args?.mode === 'blend' ? 'blend' : 'mci';
      const output = typeof args?.out === 'string' && args.out ? args.out : `${input.replace(/\.mp4$/i, '')}-${fps}.mp4`;
      const plan = planInterpolation({ input: join(projectPath, input), output: join(projectPath, output), fps, mode });
      if (!plan.ok) return { ok: false, problems: plan.problems };

      const run = spawnSync(toolPath('ffmpeg'), plan.args, { encoding: 'utf8', windowsHide: true, timeout: 30 * 60 * 1000 });
      if (run.status !== 0 || !existsSync(join(projectPath, output))) {
        return { ok: false, problems: [`ffmpeg failed: ${(run.stderr || '').slice(0, 300) || 'no output'}`] };
      }
      return { ok: true, input, output, fps, mode, bytes: statSync(join(projectPath, output)).size };
    },
    isConcurrencySafe: () => false, // writes a new file
  };
}

const DEPTH_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    relative: { type: 'string' },
    bytes: { type: 'integer' },
    pack: { type: 'string' },
    problems: { type: 'array', items: { type: 'string' } },
    error: { type: 'string' },
  },
  required: ['ok'],
};

function renderDepthOutput(_args, value) {
  if (value?.ok !== true) {
    const lines = ['mise_depth could not run:'];
    for (const p of value?.problems ?? []) lines.push(`  - ${p}`);
    if (value?.error) lines.push(`  - ${value.error}`);
    lines.push('A depth pack is an optional enhancement: without one, mise_cine still moves the camera on a single plate.');
    return [{ type: 'text', text: lines.join('\n') }];
  }
  return [{ type: 'text', text: `Depth map: ${value.relative} (${Math.round((value.bytes ?? 0) / 1024)} KB) from pack ${value.pack}.\nFeed it to mise_cine as a layer plate, or keep it beside the shot for the depth page.` }];
}

function buildDepthTool(ctx) {
  return {
    name: 'mise_depth',
    description:
      'Produce a depth map for one picture using an installed depth pack (kind "depth"). ' +
      'A pack is a folder with pack.json and an entry (a .mjs module called with { image, out }, or an executable called with its declared args). ' +
      'Without a pack this refuses and says so — it never invents a depth map. The result is a grayscale PNG beside the shot.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: 'The film project; defaults to the session working directory.' },
        src: { type: 'string', description: 'The picture, relative to the project.' },
        out: { type: 'string', description: 'Output PNG, relative to the project; defaults to assets/depth-<name>.png.' },
        pack: { type: 'string', description: 'A specific installed depth pack name; defaults to the first verified one.' },
      },
      required: ['src'],
    },
    output: { schema: DEPTH_OUTPUT_SCHEMA, render: renderDepthOutput },
    presentCall: (args) => ({ card: 'generic', title: 'Depth map', kind: 'other', rawInput: args?.src }),
    async execute(args) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_depth: no film project around ${cwd} (no film.html found).`);
      const src = typeof args?.src === 'string' ? args.src : '';
      if (!src) return { ok: false, problems: ['src is required (a picture in the project)'] };
      const image = join(projectPath, src);
      if (!existsSync(image)) return { ok: false, problems: [`${src} does not exist in the project`] };

      const packs = listPacks().filter((p) => p.ok && p.kind === 'depth');
      const wanted = typeof args?.pack === 'string' && args.pack ? args.pack : undefined;
      const pack = wanted ? packs.find((p) => p.name === wanted) : packs[0];
      if (!pack) {
        return { ok: false, problems: [wanted ? `no verified depth pack named ${wanted}` : 'no verified depth pack installed'] };
      }
      const outRel = typeof args?.out === 'string' && args.out
        ? args.out
        : join('assets', `depth-${src.split(/[\\/]/).pop().replace(/\.[^.]+$/, '')}.png`).split('\\').join('/');
      const output = join(projectPath, outRel);
      mkdirSync(dirname(output), { recursive: true });

      const plan = planDepth({ pack, image, output });
      if (!plan.ok) return { ok: false, problems: plan.problems };

      try {
        if (plan.kind === 'module') {
          const entry = await import(pathToFileURL(join(pack.dir, plan.entry)).href);
          const run = entry.default ?? entry.run;
          if (typeof run !== 'function') return { ok: false, problems: [`pack ${pack.name} module exports no default({ image, out })`] };
          await run({ image, out: output });
        } else {
          const run = spawnSync(join(pack.dir, plan.entry), plan.args, { encoding: 'utf8', windowsHide: true, timeout: 10 * 60 * 1000, cwd: pack.dir });
          if (run.status !== 0) return { ok: false, problems: [`pack ${pack.name} failed: ${(run.stderr || '').slice(0, 300) || `exit ${run.status}`}`] };
        }
      } catch (error) {
        return { ok: false, problems: [error instanceof Error ? error.message : String(error)] };
      }
      if (!existsSync(output) || statSync(output).size === 0) return { ok: false, problems: [`pack ${pack.name} produced no depth image`] };
      return { ok: true, relative: outRel, bytes: statSync(output).size, pack: pack.name };
    },
    isConcurrencySafe: () => false, // writes beside the shot
  };
}

/** ── Pre-flight: read the film before anything expensive runs ──────────── */

const CHECK_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', description: 'true when film.html parsed cleanly and no structural problem was found.' },
    problems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          line: { type: 'integer', description: 'film.html line, or -1 when the problem is not tied to one.' },
          message: { type: 'string' },
          rule: { type: 'string' },
        },
        required: ['message', 'rule'],
      },
    },
    warnings: {
      type: 'array',
      description: 'Real defects that do not stop a render, such as a picture keeping its rectangular background.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { message: { type: 'string' }, rule: { type: 'string' } },
        required: ['message', 'rule'],
      },
    },
    deferred: {
      type: 'array',
      description: 'What static reading cannot decide and openfilm look can: a dynamic stage size, or a clip whose length lives in its file.',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: { message: { type: 'string' }, rule: { type: 'string' } },
        required: ['message', 'rule'],
      },
    },
    facts: {
      type: 'object',
      additionalProperties: false,
      properties: {
        stage: { type: 'object', additionalProperties: false, properties: { w: { type: 'integer' }, h: { type: 'integer' } } },
        tracks: { type: 'integer' },
        clips: { type: 'integer' },
        byKind: { type: 'object' },
        duration: { type: 'number', description: 'Total seconds, or -1 when any clip\'s length lives only in its media file.' },
        durationKnown: { type: 'boolean' },
        missingFiles: { type: 'array' },
        missingTiming: { type: 'array' },
        badAttrs: { type: 'array' },
        unknownLength: { type: 'array' },
        overlaps: { type: 'array' },
        audio: { type: 'array' },
        picture: { type: 'array', description: 'The picture clips, per clip: id, src, track, at, length (-1 unknown), kind.' },
        unresolvedImports: { type: 'array' },
        motionLibPresent: { type: 'boolean' },
        pagesWithoutMotion: { type: 'integer', description: 'How many pages read no import of the motion kit.' },
        pageContract: { type: 'array', description: 'Pages whose window.film declares a duration/width/height that is not a positive number.' },
        rectangularAssets: { type: 'array', description: 'Pictures that still carry their own rectangular background (reported as warnings).' },
        voiceCast: { type: 'object', additionalProperties: true, description: 'Which role speaks with which voice, and any inconsistency found.' },
      },
    },
  },
  required: ['ok', 'problems', 'facts'],
};

function renderCheckOutput(_args, value) {
  const lines = [];
  const warnings = Array.isArray(value?.warnings) ? value.warnings : [];
  const deferred = Array.isArray(value?.deferred) ? value.deferred : [];
  if (value.ok && value.problems.length === 0) {
    lines.push(warnings.length === 0 ? 'film.html reads clean.' : `film.html renders, with ${warnings.length} warning(s).`);
  }
  for (const p of value.problems) lines.push(`${p.line !== null ? `film.html:${p.line}` : 'film.html'}: ${p.message}`);
  for (const w of warnings) lines.push(`warning: ${w.message}`);
  for (const d of deferred) lines.push(`deferred to look: ${d.message}`);

  const f = value.facts ?? {};
  if (f.stage) lines.push(`stage ${f.stage.w}x${f.stage.h} · ${f.tracks} track(s) · ${f.clips} clip(s)`);
  if (f.durationKnown) lines.push(`length ${f.duration}s`);
  else if (f.stage) lines.push(`length unknown from markup alone${Array.isArray(f.unknownLength) && f.unknownLength.length ? ` (${f.unknownLength.length} clip(s) keep their length in the media file)` : ''}`);
  if (f.overlaps?.length) lines.push(`overlaps: ${f.overlaps.map((o) => `${o.a.id} and ${o.b.id} (${o.overlap}s)`).join(', ')}`);
  if (f.missingFiles?.length) lines.push(`missing files: ${f.missingFiles.map((m) => m.src).join(', ')}`);
  if (f.missingTiming?.length) lines.push(`clips with no length written: ${f.missingTiming.map((m) => m.clip).join(', ')}`);
  if (f.unresolvedImports?.length) lines.push(`pages importing a missing of-motion.mjs: ${f.unresolvedImports.map((u) => u.page).join(', ')}`);
  if (!f.motionLibPresent && f.stage) lines.push('the motion kit is not in this project yet (mise_run ["open", "."] copies it in).');
  return [{ type: 'text', text: lines.join('\n') || '(no output)' }];
}

function buildCheckTool(ctx) {
  return {
    name: 'mise_check',
    description:
      'Read film.html and report what is wrong BEFORE anything expensive runs. ' +
      'Catches, as blocking problems: a still with no #t=0,length; two clips overlapping on one track (including a short clip inside a long one); a src pointing at a file that does not exist; ' +
      'a page loading a missing asset; speed/volume/fade out of range; a page whose declared duration/width/height is a provably invalid number. ' +
      'Reports separately the warnings (a picture keeping its rectangular background, a voice-cast mismatch) and what static reading cannot decide but openfilm look can (a page whose length comes from its own duration, a size computed at runtime). ' +
      'Also reports the facts: stage size, track and clip counts, total length (when every clip\'s length is written in the markup). ' +
      'Run this after writing or editing a film, before look or render — a 50 ms check instead of a failed render.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: {
          type: 'string',
          description: 'The film project (or a folder inside it); defaults to the session working directory.',
        },
      },
    },
    output: { schema: CHECK_OUTPUT_SCHEMA, render: renderCheckOutput },
    presentCall: (args) => ({ card: 'generic', title: 'Check film.html', kind: 'read', rawInput: args?.cwd }),
    async execute(args, exec) {
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx, exec?.agent);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_check: no film project around ${cwd} (no film.html found).`);

      const sessionId = exec?.agent?.id ? String(exec.agent.id) : undefined;
      const progress = beginProgress('mise_check', `check ${projectPath.split(/[\\/]/).pop()}`, { sessionId, projectPath });
      try {
        const result = checkFilm(projectPath);

        // The export gate: the source parsing is only half of "ready". The film
        // also needs its shots looked at and its frames accepted on this cut.
        try {
          const hasPlan = existsSync(join(projectPath, '.film', 'plan.json'));
          let planned = null;
          try { planned = JSON.parse(readFileSync(join(projectPath, '.film', 'plan.json'), 'utf8')); } catch { planned = null; }
          let record = null;
          try { record = JSON.parse(readFileSync(join(projectPath, '.film', 'verify.json'), 'utf8')); } catch { record = null; }
          const filmMtimeMs = statSync(join(projectPath, 'film.html')).mtimeMs;
          const acceptance = record
            ? { ok: record.ok === true, fresh: isFresh(record, filmMtimeMs), at: record.at, problems: record.problems, checked: record.checked }
            : null;
          const review = reviewStatus(projectPath, result.facts);
          const verdict = preflight({ review, acceptance, hasPlan, claims: planned?.claims ?? null });
          for (const blocker of verdict.blockers) result.warnings?.push(`render gate — ${blocker}`);
          for (const warning of verdict.warnings) result.warnings?.push(`render gate — ${warning}`);
        } catch {
          // A missing or unreadable record must never break the check itself.
        }

        // Fonts: a Chinese title on a machine with no CJK font renders as boxes.
        // That is worth saying before a render, not after one.
        try {
          const pages = readdirSync(projectPath).filter((name) => name.toLowerCase().endsWith('.html'));
          const sources = pages.map((name) => ({ file: name, html: readFileSync(join(projectPath, name), 'utf8') }));
          const risk = projectFontRisk(sources, { cjkAvailable: probeFonts().cjk });
          if (!risk.ok) {
            for (const problem of risk.problems.slice(0, 3)) result.warnings?.push(`font — ${problem}`);
            if (risk.advice) result.warnings?.push(`font — ${risk.advice}`);
          }
        } catch {
          // A font probe must never break a check.
        }

        progress.finish(result.ok ? 'done' : 'error', result.ok ? 'clean' : `${result.problems.length} problem(s)`);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        progress.fail(message);
        throw new Error(`mise_check: ${message}`);
      }
    },
    isConcurrencySafe: () => true, // reads only
  };
}

/** ── Scaffolding: a film that renders before anything is written into it ── */

const NEW_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    created: { type: 'array', items: { type: 'string' } },
    existed: { type: 'array', items: { type: 'string' } },
    filmPath: { type: 'string' },
    nextStep: { type: 'string' },
    error: { type: 'string' },
  },
  required: ['ok'],
};

function renderNewOutput(_args, value) {
  if (value.ok !== true) return [{ type: 'text', text: value.error ?? 'mise_new failed' }];
  const lines = [
    `created: ${value.created.join(', ')} in ${value.filmPath}`,
    ...(value.nextStep ? [value.nextStep] : []),
  ];
  return [{ type: 'text', text: lines.join('\n') }];
}

function buildNewTool(ctx) {
  return {
    name: 'mise_new',
    description:
      'Create a new OpenFilm film project that renders before anything is written into it: film.html with a real stage and one correctly timed shot, the shot page itself (a title that rises in, over the motion kit), and of-motion.mjs. ' +
      'Run mise_check on it, then mise_run ["look"] — the first look shows a picture, not an error. ' +
      'Never overwrites: if film.html already exists there, the tool refuses and says to open it instead.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: {
          type: 'string',
          description: 'The project folder name, created inside cwd (e.g. "launch-video").',
        },
        cwd: {
          type: 'string',
          description: 'Where to create the project folder; defaults to the session working directory.',
        },
        stage: {
          type: 'string',
          description: `Picture size: ${Object.keys(STAGES).join(' | ')} (default 16:9).`,
        },
        title: {
          type: 'string',
          description: 'The first shot shows this as a rising title.',
        },
      },
      required: ['name'],
    },
    output: { schema: NEW_OUTPUT_SCHEMA, render: renderNewOutput },
    presentCall: (args) => ({ card: 'generic', title: `New film: ${args?.name}`, kind: 'other', rawInput: args?.title ?? args?.name }),
    async execute(args, exec) {
      const name = typeof args?.name === 'string' ? args.name.trim() : '';
      if (!name) throw new Error('mise_new: `name` is required (the project folder name).');
      if (name.length > 80 || /[\\/:*?"<>|]/.test(name)) throw new Error(`mise_new: "${name}" is not a usable folder name.`);
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx, exec?.agent);
      const projectPath = join(cwd, name);

      const sessionId = exec?.agent?.id ? String(exec.agent.id) : undefined;
      const progress = beginProgress('mise_new', `new film: ${name}`, { sessionId, projectPath });
      try {
        const result = await newFilm({ projectPath, stage: args?.stage, title: args?.title });
        if (result.ok) {
          // This conversation owns the film from the moment it exists, so a
          // later marked region wakes it even after a harness restart.
          noteProject(projectPath, sessionId);
          progress.finish('done', result.created.join(', '));
          return {
            ok: true,
            created: result.created,
            existed: result.existed,
            filmPath: result.filmPath,
            nextStep:
              'mise_check the project, then draw the first frame with mise_run ["look", "1"], ' +
              'and edit the shot pages. The film already renders: every later change starts from a picture, not an error.',
          };
        }
        progress.finish('error', result.error ?? 'refused');
        return { ok: false, created: result.created, existed: result.existed, error: result.error };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        progress.fail(message);
        throw new Error(`mise_new: ${message}`);
      }
    },
    isConcurrencySafe: () => false, // writes into the workspace
  };
}

/** ── Timeline: placing sound under the picture by arithmetic ────────────── */

const TIMELINE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    placements: { type: 'array' },
    overruns: { type: 'array' },
    errors: { type: 'array', description: 'Why the shot plan itself cannot be used, when no single line is to blame.' },
    audioBlock: { type: 'string', description: 'The paste-ready <section>; empty unless every line was placed.' },
    totalLength: { type: 'number' },
  },
  required: ['ok'],
};

function renderTimelineOutput(_args, value) {
  if (!value.ok) {
    const lines = ['cannot place every line:'];
    for (const e of value.errors ?? []) lines.push(`  plan: ${e}`);
    for (const o of value.overruns ?? []) lines.push(`  line ${o.line} (${o.src ?? ''}): ${o.reason}`);
    lines.push('lengthen the named shots (or split the line) and run this again.');
    return [{ type: 'text', text: lines.join('\n') }];
  }
  const lines = [`all ${value.placements.length} line(s) placed · film length ${value.totalLength}s`, '', value.audioBlock];
  return [{ type: 'text', text: lines.join('\n') }];
}

function buildTimelineTool(ctx) {
  return {
    name: 'mise_timeline',
    description:
      'Place narration lines under a film\'s shots by arithmetic: given the shot plan (at, len per shot) and each line\'s measured length (mise_voice returns `seconds`), this computes every audio clip\'s `at=` so each line starts a beat after its named shot appears and ends before that shot ends. ' +
      'Lines that share a shot are spoken one after another, never on top of each other. ' +
      'A line that names no shot (when the counts differ), names a shot that does not exist, carries a negative lead, or would overrun its shot is refused — nothing is mapped by position unless the counts match exactly. ' +
      'Returns the ready-to-paste <section> of <audio> clips only when every line was placed. ' +
      'Run mise_check after editing film.html.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        shots: {
          type: 'array',
          description: 'The picture track\'s plan, in order: [{ "at": 0, "len": 4 }, ...]. mise_check reports the same numbers for an existing film.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              at: { type: 'number', description: 'seconds from the film\'s start' },
              len: { type: 'number', description: 'the shot\'s length in seconds' },
              id: { type: 'string', description: 'optional name, echoed in the result' },
            },
            required: ['at', 'len'],
          },
        },
        lines: {
          type: 'array',
          description: 'The narration, in order. Each line: { src, seconds, shot? } — src is the audio file mise_voice wrote, seconds its measured length, shot the index of the shot it belongs to (default: its own position).',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              src: { type: 'string', description: 'the audio file, relative to film.html' },
              seconds: { type: 'number', description: 'the file\'s measured length (mise_voice returns it as `seconds`)' },
              shot: { type: 'integer', description: 'which shot this line belongs to by index' },
               shotId: { type: 'string', description: 'which shot this line belongs to by the shot id' },
              lead: { type: 'number', description: 'this line\'s own beat of silence after the shot appears' },
              volume: { type: 'number', description: 'written as the clip\'s volume when given' },
            },
            required: ['src', 'seconds'],
          },
        },
        lead: {
          type: 'number',
          description: 'The default beat of silence after a shot appears before its line starts (default 0.35s, allowing the page title to appear).',
        },
      },
      required: ['shots', 'lines'],
    },
    output: { schema: TIMELINE_OUTPUT_SCHEMA, render: renderTimelineOutput },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Place narration under shots',
      kind: 'other',
      rawInput: `${(args?.lines ?? []).length} line(s) over ${(args?.shots ?? []).length} shot(s)`,
    }),
    async execute(args) {
      const plan = { shots: args?.shots, lines: args?.lines, lead: args?.lead };
      const result = placeLines(plan);
      return result;
    },
    isConcurrencySafe: () => true, // pure arithmetic
  };
}

/** ── Cutout: a sticker, not a rectangle ────────────────────────────────── */

const CUTOUT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    relative: { type: 'string' },
    bytes: { type: 'integer' },
    sourceBytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    background: { type: 'array', items: { type: 'integer' } },
    threshold: { type: 'number' },
    cutPixels: { type: 'integer' },
    note: { type: 'string' },
    error: { type: 'string' },
  },
  required: ['ok'],
};

function renderCutoutOutput(_args, value) {
  if (value?.ok !== true) return [{ type: 'text', text: value?.error ?? 'cutout failed' }];
  const lines = [
    `Saved ${value.relative} (${Math.round((value.bytes ?? 0) / 1024)} KB, transparent background).`,
    value.background ? `The background sampled as rgb(${value.background.join(', ')}); ${value.cutPixels} pixels cut at threshold ${value.threshold}.` : '',
    value.note ?? '',
  ];
  return [{ type: 'text', text: lines.filter(Boolean).join('\n') }];
}

function buildCutoutTool(ctx) {
  return {
    name: 'mise_cutout',
    description:
      'Cut the subject out of a picture\'s plain background and write a transparent PNG beside it in assets/, so it can be pressed onto a shot page as a sticker instead of pasted as a rectangle. ' +
      'Made for sticker-style art — the flat or gradient background of a generated illustration — by classic pixel arithmetic: the border is sampled, the background floods away by color distance, the cut is feathered, and the picture\'s own white die-cut stroke survives. ' +
      'A photograph of the real world is the wrong input for this; use a provider for that. ' +
      'Works offline, no model, no download.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        src: {
          type: 'string',
          description: 'The image file to cut, relative to the project (e.g. "assets/img-wolf.png"). PNG or JPEG.',
        },
        cwd: {
          type: 'string',
          description: 'The film project (or a folder inside it); defaults to the session working directory.',
        },
        hint: {
          type: 'string',
          description: 'A few words naming the sticker, used in the filename (e.g. "wolf").',
        },
        tolerance: {
          type: 'number',
          description: 'Scales the automatic background threshold (default 1). Raise it when background bits survive; lower it when part of the subject is cut away.',
        },
        threshold: {
          type: 'number',
          description: 'Overrides the automatic background color distance outright (0-255). Use when tolerance is not enough.',
        },
        feather: {
          type: 'integer',
          description: 'The soft-edge width in pixels (default 2).',
        },
      },
      required: ['src'],
    },
    output: { schema: CUTOUT_OUTPUT_SCHEMA, render: renderCutoutOutput },
    presentCall: (args) => ({ card: 'generic', title: `Cut out: ${args?.hint ?? args?.src}`, kind: 'other', rawInput: String(args?.src ?? '') }),
    async execute(args, exec) {
      const src = typeof args?.src === 'string' ? args.src.trim() : '';
      if (!src) throw new Error('mise_cutout: `src` is required (the image file, relative to the project).');
      const cwd = typeof args?.cwd === 'string' && args.cwd.length > 0 ? args.cwd : await sessionCwd(ctx, exec?.agent);
      const projectPath = resolveProjectFrom(cwd);
      if (!projectPath) throw new Error(`mise_cutout: no film project around ${cwd} (no film.html found).`);
      const source = join(projectPath, src);
      if (!existsSync(source)) throw new Error(`mise_cutout: ${src} does not exist in the project.`);

      const sessionId = exec?.agent?.id ? String(exec.agent.id) : undefined;
      const progress = beginProgress('mise_cutout', `cut out: ${src}`, { sessionId, projectPath });
      try {
        const result = await cutoutImage({
          src: source,
          projectPath,
          hint: args?.hint,
          threshold: args?.threshold,
          tolerance: args?.tolerance,
          feather: args?.feather,
        });
        progress.finish('done', `${result.relative} (${Math.round(result.bytes / 1024)} KB)`);
        return {
          ok: true,
          ...result,
          note: `press it onto a shot page with <img src="${result.relative}" ...> and of-motion's press() — the picture now has no background of its own.`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        progress.fail(message);
        return { ok: false, error: message };
      }
    },
    isConcurrencySafe: () => false, // writes into the project's assets/
  };
}

/** ── Skills ────────────────────────────────────────────────────────────── */

/** Parse a SKILL.md's YAML frontmatter without a YAML dependency (flat keys only). */
function parseSkillFrontmatter(raw) {
  if (!raw.startsWith('---')) return undefined;
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return undefined;
  const block = raw.slice(4, end);
  const data = {};
  for (const line of block.split('\n')) {
    const match = line.match(/^([A-Za-z][\w-]*):\s*(.+?)\s*$/);
    if (match) data[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  const body = raw.slice(raw.indexOf('\n', end + 1) + 1);
  return { data, body: body.trim() };
}

const OFFICIAL_SKILL_NAMES = ['collage', 'keynote', 'long-to-short', 'lyric-video', 'motion-graphics', 'presenter-pip', 'replicate', 'screen-demo', 'vintage-film', 'whiteboard'];

/** Build skill registrations straight from the vendored package's skills/ directory. */
function buildOfficialSkills() {
  const skills = [];
  if (!OPENFILM_SKILLS_DIR || !existsSync(OPENFILM_SKILLS_DIR)) return skills;
  for (const name of readdirSync(OPENFILM_SKILLS_DIR)) {
    if (!OFFICIAL_SKILL_NAMES.includes(name)) continue;
    const file = join(OPENFILM_SKILLS_DIR, name, 'SKILL.md');
    if (!existsSync(file)) continue;
    const parsed = parseSkillFrontmatter(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed.data.name !== 'string' || typeof parsed.data.description !== 'string') continue;
    skills.push({
      name: `mise-${parsed.data.name}`,
      description: parsed.data.description,
      whenToUse: parsed.data.whenToUse,
      content: parsed.body,
      metadata: { openfilm: true, upstream: `https://github.com/mise/skills/tree/main/skills/${parsed.data.name}` },
    });
  }
  return skills;
}

/** The film-format manual, registered as a skill so it sits in the catalog. */

/** Harness additions to the manual: two things the format does that the
 *  upstream MANUAL.md never mentions, joined onto the skill's content. */
const MANUAL_ADDITIONS = [
  '',
  '## Fades and the motion kit (harness additions)',
  '',
  'The manual above omits two things the format does:',
  '',
  '**Fades.** A clip may carry its own fade - an overrides entry without at, holding fade: [fadeIn, fadeOut] in seconds, written on the clip element as an attribute: overrides=\'[{"fade":[0.6,0]}]\'.',
  'It is a straight ramp up over fadeIn and down over fadeOut; in + out must fit in the clip\'s length, and longer ones are shortened alike to fit.',
  'fade is NOT a plain attribute - writing fade="0.6,0" is an error the parser reports by line.',
  'Use fades where a change of world happens (something arriving, the end of the story); keep the sticker-like shots hard-cut.',
  '',
  '**The motion kit.** mise_run open copies of-motion.mjs into the project root. A page imports it with a relative path: import { press, stagger, typewriter, fadeEnv, rnd } from \'./of-motion.mjs\'.',
  'Everything there is a pure function of t - easings, a seeded random (do not reach for Math.random), a typewriter, counters, and fadeEnv, which matches the clip\'s own fade so page contents can fade in sympathy with the film\'s fade on their clip.',
  'mise_check verifies a page\'s import resolves.',
  '',
  '## Choose the motion, do not default to a caption (harness additions, after FredTalk 2.1)',
  '',
  'A film made by improvising gets three moves and a big caption. Before writing a shot page, call mise_motion once per shot with what the shot has to say, and name the pattern in the page (a comment is enough):',
  '',
  '  mise_motion { "query": "三个要点列表" }   → STEPS-LIST, with its snippet',
  '  mise_motion { "use": "compare" }          → COMPARE-SPLIT',
  '  mise_motion { "id": "BROLL-KENBURNS" }     → one pattern in full (use the real id it reports)',
  '',
  'Rules that make the choice count:',
  '- Compare the top three candidates and say, in one line each, why the chosen one wins. Skipping the comparison is how every shot becomes a centred headline.',
  '- Do not use the same pattern twice in a row, and never use more than two in a film: variety is a rule, not a mood.',
  '- A pattern\'s `avoid` line is a real defect, not advice: it is the way that pattern fails.',
  '- When the shot is a still photo or generated picture, BROLL-KENBURNS is the default; when it is a comparison, COMPARE-SPLIT; when it is a number, NUMBER-COUNT. A caption alone is the last resort, not the first.',
  '',
  '## Look at every shot before you render (harness additions, after FredTalk 2.1)',
  '',
  'A film is not rendered until each shot has been looked at and approved. The gate is mise_review, and it reads the film itself, so a shot you added or moved cannot slip past it:',
  '',
  '  mise_review { "action": "keyframes" }                     draw one keyframe per shot into .film/review/',
  '  mise_review { "action": "status" }                        per shot: approved / changed / pending + notes',
  '  mise_review { "action": "approve", "shot": "s2" }         the person said this shot is right',
  '  mise_review { "action": "reject", "shot": "s2", "note": "……" }   what is wrong; the note is required',
  '',
  'readyToRender is true only when every shot is approved. When a shot is rejected, fix that shot, redraw its keyframe with force, and ask the person to approve it again. Rendering while shots are pending is how a film ships with a shot nobody looked at.',
  '',
  '## The sticker pipeline (harness additions)',
  '',
  'A generated picture is a rectangle with a background. A sticker is a subject with no background, pressed onto the page. The rectangle reads as a patch on the page; the pipeline is:',
  '',
  '1. mise_asset makes the picture (a subject on a plain background, in a sticker or cut-paper style).',
  '2. mise_cutout cuts the background away and writes a transparent PNG beside it in assets/. Its output names the cut file; it works offline, no model, and keeps the picture\'s own white die-cut stroke.',
  '3. The page places the cut file and moves it with of-motion\'s press() - the sticker lands with an overshoot, like it was pressed on.',
  '',
  'Cut every generated picture that will sit on a drawn page before writing the page. mise_cutout catches a rectangle the film still points at: mise_check now probes the file itself, and reports any picture placed as an overlay whose edges are one flat opaque colour, naming the clip and the border colour. A picture cropped with object-fit: cover, or one that covers the stage, is a plate and is left alone.',
  'A downloaded marketing screenshot is the same problem in another shape: the device sits inside a card of the publisher\'s own background. Either cut the device out, or crop the card into a rounded frame whose edge is deliberate — never paste the raw rectangle over a drawn page.',
  'A photograph of the real world is the wrong input for mise_cutout - that is a provider\'s job.',
  '',
  '## Rive shots (harness additions)',
  '',
  'A .riv file (a Rive animation) plays as a shot page. The runtime is vendored (4.6 MB, MIT): mise_run open copies it into the project as vendor-rive/.',
  '',
  '1. Copy vendor/motion/templates/rive-shot.html into the project as one page per .riv (say rive-bird.html).',
  '2. Change the two constants at the top of its script: SRC (the .riv, relative to the page) and ANIM (\'\' picks the file\'s first animation).',
  '3. film.html names only the page and its seconds: <iframe src="rive-bird.html#t=0,4" at="0"></iframe>. A src with a query (?x=) is not a clip the parser accepts.',
  '',
  '**How it stays deterministic.** The page never plays the animation: each frame resets the runtime, scrubs to t and draws that one frame (reset, scrub, drawFrame). Without the reset the runtime advances the artboard by the real time since the last draw, and the picture would depend on the order frames were asked for - the same t must always draw the same picture.',
  'The runtime and the file load before drawing (window.film.ready), so the first frame is never blank.',
  '',
  'mise_check reports a page that asks for vendor-rive/ and does not find it. .riv files come from the Rive editor or the Rive Marketplace; the runtime only plays them - it cannot make one.',
].join('\n');

function buildManualSkill() {
  // The manual travels with the plugin now: no vendored package to read it from.
  const manualPath = join(PLUGIN_ROOT, 'skills', 'MANUAL.md');
  if (!existsSync(manualPath)) return undefined;
  const manual = readFileSync(manualPath, 'utf8');
  const tail = '---\nMise ' + OPENFILM_VERSION
    + ', built on the OpenFilm film format (MIT) — the pages, the clip model and the skills.'
    + ' Rendering, the contact sheet and the thumbnails are Mise\'s own: mise_render, mise_look, mise_thumbs.';
  return {
    name: 'mise',
    description:
      'Make a film (video) with Mise: film.html cuts shot pages, footage and sound together, and the plugin composes, scores, checks and renders it itself — no external studio. ' +
      'Use whenever the person asks for a video, film, promo, lyric video, explainer, demo or render, or names a mise-* style skill (keynote, collage, whiteboard, …). ' +
      'Read this before writing any film; the mise_run tool drives look and render.',
    whenToUse: 'The person asks for a video or film, or a mise-* style skill was loaded.',
    content: manual + '\n\n' + tail + '\n' + MANUAL_ADDITIONS,
  };
}

/** ── Registration ──────────────────────────────────────────────────────── */

export const inject = ['tools', 'skills', 'commands', 'webServer'];

export function apply(ctx) {
  ctx.effect(() => {
    const disposeTools = [
      ctx.tools?.register(buildManualTool(ctx)),
      ctx.tools?.register(buildRunTool(ctx)),
      ctx.tools?.register(buildAssetTool(ctx)),
      ctx.tools?.register(buildVoiceTool(ctx)),
      ctx.tools?.register(buildCheckTool(ctx)),
      ctx.tools?.register(buildNewTool(ctx)),
      ctx.tools?.register(buildTimelineTool(ctx)),
      ctx.tools?.register(buildCutoutTool(ctx)),
      ctx.tools?.register(buildMotionTool()),
      ctx.tools?.register(buildReviewTool(ctx)),
      ctx.tools?.register(buildCineTool(ctx)),
      ctx.tools?.register(buildSceneTool(ctx)),
      ctx.tools?.register(buildTypeTool(ctx)),
      ctx.tools?.register(buildGraphicsTool(ctx)),
      ctx.tools?.register(buildTransitionTool(ctx)),
      ctx.tools?.register(buildDuoTool(ctx)),
      ctx.tools?.register(buildPromoTool(ctx)),
      ctx.tools?.register(buildComposeTool(ctx)),
      ctx.tools?.register(buildMiseRenderTool(ctx)),
      ctx.tools?.register(buildMiseThumbsTool(ctx)),
      ctx.tools?.register(buildMiseLookTool(ctx)),
      ctx.tools?.register(buildPromoPlanTool(ctx)),
      ctx.tools?.register(buildGradeTool(ctx)),
      ctx.tools?.register(buildPlanTool(ctx)),
      ctx.tools?.register(buildVerifyTool(ctx)),
      ctx.tools?.register(buildSignoffTool(ctx)),
      ctx.tools?.register(buildDemoTool(ctx)),
      ctx.tools?.register(buildDeliverTool(ctx)),
      ctx.tools?.register(buildScoreTool(ctx)),
      ctx.tools?.register(buildMixTool(ctx)),
      ctx.tools?.register(buildKeyframesTool(ctx)),
      ctx.tools?.register(buildDoctorTool(ctx)),
      ctx.tools?.register(buildStartTool(ctx)),
      ctx.tools?.register(buildPackTool(ctx)),
      ctx.tools?.register(buildInterpolateTool(ctx)),
      ctx.tools?.register(buildDepthTool(ctx)),
    ].filter((dispose) => typeof dispose === 'function');
    return () => { for (const dispose of disposeTools) { try { dispose(); } catch {} } };
  }, 'dsh-openfilm: tools');

  const manualSkill = buildManualSkill();
  const officialSkills = buildOfficialSkills();
  const skills = [...(manualSkill ? [manualSkill] : []), ...officialSkills];
  if (skills.length > 0) {
    ctx.effect(() => {
      const disposers = skills.map((skill) => {
        try {
          // `source` and `invocation` are defaulted by neither side: the
          // registry validates `source` as a required string on load.
          return ctx.skills?.register({
            ...skill,
            source: 'mise',
            invocation: { modelInvocable: true, userInvocable: true },
          });
        } catch (error) {
          ctx.logger?.warn?.(`@local/dsh-openfilm: skill ${skill.name} not registered: ${error?.message ?? error}`);
          return undefined;
        }
      }).filter((dispose) => typeof dispose === 'function');
      return () => { for (const dispose of disposers) { try { dispose(); } catch {} } };
    }, 'dsh-openfilm: skills');
  }

  const commands = ctx.get?.('commands');
  if (commands) {
    ctx.effect(() => commands.register(buildVideoCommand(ctx)), 'dsh-openfilm: /video command');
  }

  if (ctx.webServer) {
    ctx.effect(() => mountRoutes(ctx), 'dsh-openfilm: http routes');
  }

  // Continue any video a previous process left running. The job files keep the
  // service's own task id, so this asks about the same clip instead of buying
  // it again. Best effort: a job whose key is gone stays waiting.
  ctx.effect(() => {
    let stopped = false;
    void (async () => {
      try {
        const projects = [...new Set([
          ...KNOWN_PROJECTS.keys(),
          ...workspaceRoots().map((root) => newestProjectIn(root)).filter(Boolean),
        ])];
        if (!stopped && projects.length > 0) {
          await resumeJobs(projects, (projectPath) => {
            const jobs = listJobs(projectPath).filter((job) => ['queued', 'creating', 'running', 'downloading', 'waiting'].includes(job.state));
            const env = jobs.length > 0 ? MEDIA_CATALOG[jobs[0].provider]?.env : undefined;
            return env ? resolveProviderKey(ctx, env) : undefined;
          });
        }
      } catch (error) {
        ctx.logger?.warn?.(`@local/dsh-openfilm: could not resume media jobs: ${error?.message ?? error}`);
      }
    })();
    return () => { stopped = true; };
  }, 'dsh-openfilm: resume media jobs');
}

/** ── /video composer command ───────────────────────────────────────────── */

const VIDEO_USAGE = [
  'Usage:',
  '  /video <description>          ask the agent to make a film from a description',
  '  /video styles                 list the official OpenFilm filmmaking skills',
  '  /video skill <name>           print one style skill (e.g. keynote, whiteboard)',
  '  /video open [folder|url]      create/open the project',
  '  /video look [t | a-b]         check the film and draw it (contact-sheet PNG paths)',
  '  /video render [options…]      export the MP4 beside film.html',
].join('\n');

/** The directive handed to the model when /video is used with a description. */
function videoDirective(description, style) {
  const lines = [
    'Make a film with OpenFilm (the harness has the openfilm tools and skills installed).',
    '',
    `The person asked for this film: ${description}`,
  ];
  if (style) lines.push(`They named the OpenFilm style skill "${style}" — load the matching openfilm-<style> skill and follow it whole.`);
  lines.push(
    '',
    'How to do it:',
    '1. Read the `openfilm` skill (or call mise_manual) before writing any film — a film is a web page, film.html.',
    '2. Pick a short kebab-case film name and run mise_run with args ["open", "<name>"] to create the project: the panel lists its shots as soon as it exists, and the person retimes them there.',
    '3. Write one shot per HTML page (window.film.frame(t) draws moment t; the picture depends only on t) and cut them together in film.html.',
    '4. Check your work with mise_run ["look"] (and ["look", "4.5"] for a single frame); it also proves the same t draws the same picture.',
    '5. Only when the person asks for the file, run mise_run ["render"].',
    '',
    'Generated footage and pictures come from mise_asset. When a film needs real footage, a character or a product, generate one reference picture first and pass it as references (or firstFrame/lastFrame) to every later shot with provider "google" (Veo) or "fal" (Seedance/Kling) — that is how the same person stays the same person across shots. Read the returned `actual` width, height and duration and use those exact numbers in film.html; never write a size or length that was only requested. Set background: true for video so the person keeps working while it renders.',
    '',
    'Rules that matter: never re-encode or cut media into new files (trim with #t= and CSS); a page has no sound (sound is a clip in film.html); keep one shot per page so it stays editable; read film.html right before you change it because the panel edits the same track. When you are done, tell the person in a few lines what you made and where.',
  );
  return lines.join('\n');
}

/**
 * Build one model-visible user message. The harness owns message identity and
 * freezing; a plain literal with a UUID id is what the runtime expects, and the
 * registry validates the shape on append.
 */
function userMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  };
}

/** The /video command: a description drives the agent, a verb runs the CLI. */
function buildVideoCommand(ctx) {
  return {
    name: 'video',
    description: 'Make a film with OpenFilm, or drive it (look / render)',
    input: { hint: '<description>|styles|skill <name>|open|look|render', attachments: true },
    handler: async (invocation) => {
      const input = (invocation.rawInput ?? '').trim();
      const cwd = await sessionCwd(ctx, invocation.agent);

      // A bare /video: usage plus where a film project would resolve from here.
      if (input.length === 0) {
        return { kind: 'success', text: `${VIDEO_USAGE}\n\nWorking directory: ${cwd}` };
      }

      const [verb, ...rest] = input.split(/\s+/);

      // Sub-verbs that are pure CLI runs: their output is the reply.
      if (verb === 'styles' || verb === 'skills') {
        const r = await runOpenfilm(['skills'], { cwd, timeoutMs: 30_000, signal: invocation.signal });
        return { kind: 'success', text: r.stdout || r.stderr || 'no styles listed' };
      }
      if (verb === 'skill') {
        const name = rest[0];
        if (!name) return { kind: 'error', text: 'Usage: /video skill <name> (e.g. /video skill keynote)' };
        const r = await runOpenfilm(['skill', name], { cwd, timeoutMs: 30_000, signal: invocation.signal });
        return { kind: 'success', text: r.stdout || r.stderr || `no skill named ${name}` };
      }
      if (verb === 'open' || verb === 'look' || verb === 'render') {
        const r = await runOpenfilm([verb, ...rest], { cwd, timeoutMs: verb === 'render' ? 600_000 : 300_000, signal: invocation.signal });
        const body = [r.stdout, r.stderr && `stderr:\n${r.stderr}`].filter(Boolean).join('\n');
        return r.exitCode === 0
          ? { kind: 'success', text: body || 'done' }
          : { kind: 'error', text: body || `openfilm ${verb} failed (exit ${r.exitCode})` };
      }

      // Anything else is a film request: hand it to the model as a directive.
      const style = rest.find((w) => w.startsWith('--style='))?.slice('--style='.length);
      const description = input.replace(/\s*--style=\S+/g, '').trim();
      try {
        invocation.agent.followup(userMessage(videoDirective(description, style)));
        if (invocation.attachments?.length) {
          invocation.agent.followup({
            id: randomUUID(),
            role: 'user',
            content: [...invocation.attachments, { type: 'text', text: 'Reference material for the film above.' }],
            source: { kind: 'user' },
          });
        }
        // The agent now owns the work; this records the hand-off itself.
        beginProgress('/video', `film requested: ${description}`).finish('done', 'submitted to the agent');
        return { kind: 'success', text: 'On it — making the film now. Watch it come together in the panel.' };
      } catch (error) {
        return { kind: 'error', text: `Could not start the film: ${error?.message ?? error}` };
      }
    },
  };
}

export const name = 'openfilm';
