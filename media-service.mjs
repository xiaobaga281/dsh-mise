/**
 * Media for a film: which service makes what, and one way to make it.
 *
 * Upstream OpenFilm's providers can already make video (Google's Veo, fal's
 * Seedance and Kling) and take a first frame, a last frame or reference
 * pictures. What they cannot do is survive a restart: a generation is one long
 * call, and a failed poll after the request was created means asking again.
 *
 * This module adds the part a film project needs and the provider contract does
 * not carry:
 *
 *  - a capability catalogue, so the tool and the panel offer only combinations
 *    a service accepts instead of failing after submission;
 *  - a video task split into create / poll / download, with the remote id kept
 *    so a retry continues the same task and never posts it twice;
 *  - every written file measured with ffprobe, so the film's metadata is the
 *    file's own, not what was asked for;
 *  - a manifest, so an asset keeps its id, its shot and what it was made from.
 *
 * Nothing here spends money on its own: it runs when the agent or the panel
 * asks, with the person's own key.
 *
 * @module openfilm-media-service
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));

/** The services that can make film media, and what each model accepts. */
export const MEDIA_CATALOG = {
  agnes: {
    id: 'agnes', name: 'Agnes', env: 'AGNES_API_KEY',
    kinds: ['image', 'video'],
    models: {
      image: [{ id: 'agnes-image-2.5-flash', name: 'Agnes Image 2.5 Flash', sizes: ['1K', '2K', '3K', '4K'] }],
      video: [{
        id: 'agnes-video-2.5-flash', name: 'Agnes Video 2.5 Flash',
        seconds: [4, 12], sizes: ['720P'], ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
        firstFrame: false, lastFrame: false, references: 0, generateAudio: false,
      }],
    },
  },
  google: {
    id: 'google', name: 'Google Gemini', env: 'GEMINI_API_KEY',
    kinds: ['image', 'video'],
    models: {
      image: [
        { id: 'gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image' },
        { id: 'gemini-3-pro-image', name: 'Nano Banana Pro' },
      ],
      video: [
        { id: 'veo-3.1-generate-preview', name: 'Veo 3.1', seconds: [4, 8], durations: [4, 6, 8], sizes: ['720p'], ratios: ['16:9', '9:16'], firstFrame: true, lastFrame: true, references: 3, generateAudio: true },
        { id: 'veo-3.1-fast-generate-preview', name: 'Veo 3.1 Fast', seconds: [4, 8], durations: [4, 6, 8], sizes: ['720p'], ratios: ['16:9', '9:16'], firstFrame: true, lastFrame: true, references: 3, generateAudio: true },
        { id: 'veo-3.1-lite-generate-preview', name: 'Veo 3.1 Lite', seconds: [4, 8], durations: [4, 6, 8], sizes: ['720p'], ratios: ['16:9', '9:16'], firstFrame: true, lastFrame: true, references: 3, generateAudio: true },
      ],
    },
  },
  fal: {
    id: 'fal', name: 'fal.ai', env: 'FAL_KEY',
    kinds: ['image', 'video'],
    models: {
      image: [
        { id: 'fal-ai/flux-2-pro', name: 'FLUX.2 [pro]' },
        { id: 'fal-ai/flux-2-max', name: 'FLUX.2 [max]' },
      ],
      video: [
        { id: 'seedance-2.0', name: 'Seedance 2.0', seconds: [4, 15], sizes: ['1080p'], ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], firstFrame: true, lastFrame: true, references: 9, generateAudio: true },
        { id: 'seedance-2.0-fast', name: 'Seedance 2.0 Fast', seconds: [4, 15], sizes: ['720p'], ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], firstFrame: true, lastFrame: true, references: 9, generateAudio: true },
        { id: 'kling-3.0-pro', name: 'Kling 3.0 Pro', seconds: [3, 15], sizes: [], ratios: ['16:9', '9:16', '1:1'], firstFrame: true, lastFrame: true, references: 0, generateAudio: true },
        { id: 'kling-3.0-standard', name: 'Kling 3.0 Standard', seconds: [3, 15], sizes: [], ratios: ['16:9', '9:16', '1:1'], firstFrame: true, lastFrame: true, references: 0, generateAudio: true },
      ],
    },
  },
};

/**
 * What each service can make now, for the panel and the tool. Only presence is
 * reported; a key's value never travels through here.
 * @param {(env: string) => (boolean | Promise<boolean>)} [configured]
 */
export async function describeMediaCapabilities(configured = () => false) {
  const out = [];
  for (const provider of Object.values(MEDIA_CATALOG)) {
    let isConfigured = false;
    try { isConfigured = (await configured(provider.env)) === true; } catch { isConfigured = false; }
    out.push({
      id: provider.id,
      name: provider.name,
      env: provider.env,
      configured: isConfigured,
      kinds: provider.kinds,
      models: provider.models,
    });
  }
  return out;
}

/** Find a provider/model pair, or say what exists. */
function resolveModel(providerId, kind, modelId) {
  const provider = MEDIA_CATALOG[providerId];
  if (!provider) throw new Error(`unknown provider "${providerId}"; there is ${Object.keys(MEDIA_CATALOG).join(', ')}`);
  if (!provider.kinds.includes(kind)) throw new Error(`${provider.name} does not make ${kind}`);
  const models = provider.models[kind] ?? [];
  const model = modelId ? models.find((m) => m.id === modelId) : models[0];
  if (!model) throw new Error(`${provider.name} has no ${kind} model ${JSON.stringify(modelId)}; there is ${models.map((m) => m.id).join(', ')}`);
  return { provider, model };
}

/**
 * Check a request against what the chosen model accepts, before anything is
 * sent. A combination the service would silently change is refused with the
 * list it does accept, so the person is never told a clip is 1080p when it is
 * not.
 */
export function validateRequest(request) {
  const kind = request.kind === 'video' ? 'video' : 'image';
  const { provider, model } = resolveModel(request.provider, kind, request.model);
  const first = request.firstFrame;
  const last = request.lastFrame;
  const refs = Array.isArray(request.references) ? request.references : [];
  let seconds;
  let aspectRatio = typeof request.aspectRatio === 'string' && request.aspectRatio ? request.aspectRatio : undefined;
  if (kind === 'video') {
    if (last && !first) throw new Error('a last frame needs a first frame: give both, or neither');
    if (first && !model.firstFrame) throw new Error(`${model.name} takes no first frame; remove it or choose a model that does`);
    if (last && !model.lastFrame) throw new Error(`${model.name} takes no last frame; remove it or choose a model that does`);
    if (refs.length && !model.references) throw new Error(`${model.name} takes no reference pictures; remove them or choose another model`);
    if (first && refs.length) throw new Error('a first frame and reference pictures cannot be mixed in one clip: choose one way to guide it');
    if (refs.length > model.references) throw new Error(`${model.name} takes at most ${model.references} reference picture(s); ${refs.length} were given`);
    // The model decides the length when none was named; the value returned is
    // the one actually used, so no caller has to guess.
    const asked = Number(request.seconds);
    if (!Number.isFinite(asked)) {
      seconds = Array.isArray(model.durations) ? model.durations[0] : model.seconds[0];
    } else if (Array.isArray(model.durations)) {
      if (!model.durations.includes(asked)) throw new Error(`${model.name} makes ${model.durations.join(', ')} second clips; ${asked} is not one`);
      seconds = asked;
    } else {
      if (asked < model.seconds[0] || asked > model.seconds[1]) throw new Error(`${model.name} makes ${model.seconds[0]}–${model.seconds[1]} second clips; ${asked} is outside that`);
      seconds = asked;
    }
    if (aspectRatio && !model.ratios.includes(aspectRatio)) throw new Error(`${model.name} makes ${model.ratios.join(', ')} clips; ${aspectRatio} is not one`);
    if (!aspectRatio) aspectRatio = model.ratios.includes('16:9') ? '16:9' : model.ratios[0];
    if (request.generateAudio === true && !model.generateAudio) throw new Error(`${model.name} does not generate sound; it would be silent`);
  }
  return { provider, model, kind, seconds, aspectRatio };
}

/** A filename no two generations can collide on, inside `assets/<dir>/`. */
export function uniqueAssetName(kind, hint, ext) {
  const dir = kind === 'video' ? 'video' : 'image';
  const safe = String(hint ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
  const tag = randomBytes(3).toString('hex');
  return `${dir}/${kind}-${safe ? `${safe}-` : ''}${stamp}-${tag}.${ext.replace(/^\./, '')}`;
}

/** Read a project file named by the request, refusing anything outside it. */
function readProjectFile(root, rel) {
  const target = resolve(root, String(rel));
  const inside = target === root || target.startsWith(root + sep);
  if (!inside) throw new Error(`${rel} is outside the film project`);
  if (!existsSync(target) || !statSync(target).isFile()) throw new Error(`${rel} does not exist in the film project`);
  return readFileSync(target);
}

/**
 * What a file really is, measured by ffprobe: width, height, duration, frame
 * rate, and whether it carries sound. A file ffprobe cannot read is refused
 * rather than described by the request.
 * @param {string} file absolute path
 */
export function probeMedia(file) {
  const run = (args) => spawnSync(process.env.DSH_FFPROBE || 'ffprobe', args, { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  const result = run(['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (result.error) throw new Error(`ffprobe could not run: ${result.error.code === 'ENOENT' ? 'ffprobe is not on the PATH (it comes with ffmpeg)' : result.error.message}`);
  if (result.status !== 0) throw new Error(`ffprobe could not read ${file}: ${(result.stderr || '').trim().slice(0, 200)}`);
  let info;
  try { info = JSON.parse(result.stdout); } catch { throw new Error(`ffprobe answered unusably for ${file}`); }
  const streams = Array.isArray(info?.streams) ? info.streams : [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const duration = Number(info?.format?.duration ?? video?.duration ?? audio?.duration);
  const rate = String(video?.avg_frame_rate ?? video?.r_frame_rate ?? '');
  const [num, den] = rate.split('/').map(Number);
  const fps = Number.isFinite(num) && Number.isFinite(den) && den > 0 ? Number((num / den).toFixed(3)) : null;
  // Only measured facts are returned: a key that could not be measured is
  // omitted, never set to undefined — a tool result must be lossless JSON.
  const actual = { kind: video ? 'video' : audio ? 'audio' : 'unknown', hasAudio: Boolean(audio) };
  if (Number(video?.width) > 0) actual.width = Number(video.width);
  if (Number(video?.height) > 0) actual.height = Number(video.height);
  if (Number.isFinite(duration) && duration > 0) actual.duration = Number(duration.toFixed(3));
  if (fps !== null) actual.fps = fps;
  return actual;
}

/** Write bytes so a half-written file is never visible under its final name. */
function atomicWrite(target, bytes) {
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${randomBytes(3).toString('hex')}.part`;
  writeFileSync(temp, bytes);
  renameSync(temp, target);
}

const MANIFEST = join('.film', 'assets.json');

/**
 * Record what an asset is: its id, the shot it belongs to, and how it was made.
 * Additive and best effort: a manifest that cannot be written never fails a
 * generation whose file exists.
 */
export function recordAsset(projectPath, entry) {
  try {
    const file = join(projectPath, MANIFEST);
    let manifest = { version: 1, assets: {} };
    try { manifest = JSON.parse(readFileSync(file, 'utf8')); } catch {}
    if (!manifest?.assets || typeof manifest.assets !== 'object') manifest = { version: 1, assets: {} };
    manifest.version = 1;
    manifest.assets[entry.assetId] = entry;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch {}
}

/** The manifest, for the panel and for reuse by a later generation. */
export function readAssetManifest(projectPath) {
  try {
    const parsed = JSON.parse(readFileSync(join(projectPath, MANIFEST), 'utf8'));
    return parsed?.assets && typeof parsed.assets === 'object' ? parsed.assets : {};
  } catch {
    return {};
  }
}

/* ── Images ─────────────────────────────────────────────────────────────── */

/**
 * Make one picture and return its file's measured facts.
 */
export async function generateImage(request) {
  const { provider, model } = validateRequest({ ...request, kind: 'image' });
  const root = request.projectPath;
  if (provider.id === 'agnes') {
    const { generateImage: agnesImage } = await import('./agnes-assets.mjs');
    const made = await agnesImage({ apiKey: request.apiKey, projectPath: root, prompt: request.prompt, size: request.size, ratio: request.aspectRatio, hint: request.hint });
    const actual = probeMedia(made.path);
    return { provider: provider.id, model: made.model, relative: made.relative, path: made.path, bytes: made.bytes, actual };
  }
  const adapter = await loadAdapter(provider.id);
  const out = uniqueAssetName('image', request.hint, 'png');
  const name = out.split('/').pop().replace(/\.[^.]+$/, '');
  const result = await adapter.run('image', {
    prompt: request.prompt,
    ratio: request.aspectRatio || '16:9',
    quality: request.quality || 'low',
    out: name,
  }, adapterContext({ key: request.apiKey, model: model.id, root }));
  const file = (result.files ?? [])[0];
  if (!file?.bytes || !file.path) throw new Error(`${provider.name} answered without a picture`);
  const relativePath = file.path.split('\\').join('/');
  atomicWrite(join(root, relativePath), Buffer.from(file.bytes));
  const actual = probeMedia(join(root, relativePath));
  return { provider: provider.id, model: model.id, relative: relativePath, path: join(root, relativePath), bytes: statSync(join(root, relativePath)).size, actual };
}

/* ── Video: create, poll, download ──────────────────────────────────────── */

/**
 * Submit one video request and return the task to keep. A task whose `remote`
 * is set has been created: from then on only `advanceVideoTask` and
 * `downloadVideoTask` are used, so a retry can never create a second clip.
 */
export async function startVideoTask(request) {
  const { provider, model, seconds, aspectRatio: ratio } = validateRequest({ ...request, kind: 'video' });
  const root = request.projectPath;
  const id = randomBytes(8).toString('hex');
  const task = {
    version: 1,
    id,
    kind: 'video',
    provider: provider.id,
    model: model.id,
    prompt: request.prompt,
    seconds,
    aspectRatio: ratio,
    generateAudio: request.generateAudio === true,
    out: `assets/${uniqueAssetName('video', request.hint, 'mp4')}`,
    assetId: `asset-${id}`,
    ...(request.shotId ? { shotId: String(request.shotId) } : {}),
    ...(request.firstFrame ? { firstFrame: String(request.firstFrame) } : {}),
    ...(request.lastFrame ? { lastFrame: String(request.lastFrame) } : {}),
    ...(Array.isArray(request.references) && request.references.length ? { references: request.references.map(String) } : {}),
    createdAt: new Date().toISOString(),
    phase: 'created',
    remote: null,
  };

  if (provider.id === 'agnes') {
    const created = await postJson(`${serviceBase('AGNES', 'https://apihub.agnes-ai.com')}/v1/videos`, request.apiKey, {
      model: model.id,
      prompt: request.prompt,
      seconds: String(seconds),
      mode: 'text',
      size: model.sizes[0] ?? '720P',
      aspect_ratio: ratio,
    });
    const videoId = created?.video_id ?? created?.id;
    if (typeof videoId !== 'string' || !videoId) throw new Error('Agnes returned no video_id; the request may not have been created');
    task.remote = { videoId };
    return task;
  }

  if (provider.id === 'google') {
    const base = serviceBase('GOOGLE', 'https://generativelanguage.googleapis.com');
    const instance = {
      prompt: request.prompt,
      ...(request.firstFrame ? { image: inlinePicture(root, request.firstFrame) } : {}),
      ...(request.lastFrame ? { lastFrame: inlinePicture(root, request.lastFrame) } : {}),
      ...(Array.isArray(request.references) && request.references.length
        ? { referenceImages: request.references.map((r) => ({ image: inlinePicture(root, r), referenceType: 'asset' })) }
        : {}),
    };
    const started = await fetchJson(`${base}/v1beta/models/${model.id}:predictLongRunning`, {
      method: 'POST',
      headers: { 'x-goog-api-key': request.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ instances: [instance], parameters: { aspectRatio: ratio, durationSeconds: seconds } }),
      signal: request.signal,
    });
    const name = started?.name;
    if (typeof name !== 'string' || !name) throw new Error('Google did not start the video; the request may not have been created');
    task.remote = { operation: name };
    return task;
  }

  // fal: the queue takes the request and answers with the URLs to ask about it.
  const adapter = await loadAdapter('fal');
  const endpoints = adapter.VIDEO_ENDPOINTS?.[model.id];
  if (!endpoints) throw new Error(`fal has no endpoint map for ${model.id}`);
  const first = task.firstFrame;
  const refs = task.references ?? [];
  const endpoint = first ? endpoints.image : refs.length && endpoints.reference ? endpoints.reference : endpoints.text;
  const kling = !endpoints.reference;
  const input = {
    prompt: request.prompt,
    duration: String(seconds),
    ...(endpoints.resolution ? { resolution: endpoints.resolution } : {}),
    ...(ratio && !(kling && first) ? { aspect_ratio: ratio } : {}),
    ...(first ? { [kling ? 'start_image_url' : 'image_url']: dataUriOf(root, first) } : {}),
    ...(task.lastFrame ? { end_image_url: dataUriOf(root, task.lastFrame) } : {}),
    ...(refs.length ? { image_urls: refs.map((r) => dataUriOf(root, r)) } : {}),
    ...(model.generateAudio && endpoints.reference ? { generate_audio: request.generateAudio === true } : {}),
  };
  const base = serviceBase('FAL', 'https://queue.fal.run');
  const job = await fetchJson(`${base}/${endpoint}`, {
    method: 'POST',
    headers: { authorization: `Key ${request.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal: request.signal,
  });
  if (!job?.status_url || !job?.response_url) throw new Error('fal did not take the request; it may not have been created');
  task.remote = { endpoint, statusUrl: job.status_url, responseUrl: job.response_url, ...(job.cancel_url ? { cancelUrl: job.cancel_url } : {}) };
  return task;
}

/**
 * Ask the service how the task is doing. Returns the same task, updated.
 * Throws only on a real failure or a retryable reading error, so a caller can
 * retry without ever re-creating the clip.
 */
export async function advanceVideoTask(task, { apiKey, signal } = {}) {
  if (!task?.remote) throw new Error('this task has no remote request: it was never created');
  if (task.provider === 'agnes') {
    const query = new URLSearchParams({ video_id: task.remote.videoId, model_name: task.model });
    const base = serviceBase('AGNES', 'https://apihub.agnes-ai.com');
    const response = await fetch(`${base}/agnesapi?${query}`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (response.status === 429 || response.status === 503) throw retryable(`Agnes is busy (HTTP ${response.status})`);
    if (!response.ok) throw new Error(`could not read the Agnes video task (HTTP ${response.status})`);
    const body = await response.json();
    if (body?.status === 'failed') throw new Error(`Agnes could not make the video: ${body?.error?.message ?? 'no reason given'}`);
    if (body?.status === 'completed') {
      if (typeof body?.url !== 'string' || !body.url) throw new Error('the completed Agnes task carried no url');
      task.remote.url = body.url;
      task.phase = 'download';
    }
    task.progress = { phase: body?.status ?? 'in_progress', progress: Number(body?.progress ?? 0) };
    return task;
  }
  if (task.provider === 'google') {
    const base = serviceBase('GOOGLE', 'https://generativelanguage.googleapis.com');
    const op = await fetchJson(`${base}/v1beta/${task.remote.operation}`, {
      headers: { 'x-goog-api-key': apiKey }, signal,
    });
    if (op?.error) throw new Error(`Veo could not make the clip: ${op.error.message ?? JSON.stringify(op.error)}`);
    if (op?.done) {
      const result = op?.response?.generateVideoResponse;
      const uri = result?.generatedSamples?.[0]?.video?.uri;
      if (typeof uri !== 'string' || !uri) {
        throw new Error(`Veo made no clip${result?.raiMediaFilteredReasons ? `: ${[].concat(result.raiMediaFilteredReasons).join('; ')}` : ''}`);
      }
      task.remote.uri = uri;
      task.phase = 'download';
    }
    return task;
  }
  // fal
  const status = await fetchJson(task.remote.statusUrl, { headers: { authorization: `Key ${apiKey}` }, signal });
  if (status?.status === 'COMPLETED') {
    if (status.error) throw new Error(`fal could not make it: ${status.error}`);
    task.phase = 'download';
  }
  task.progress = { phase: status?.status ?? 'IN_QUEUE', queue: status?.queue_position };
  return task;
}

/** Fetch the finished clip, write it once, and describe the file itself. */
export async function downloadVideoTask(task, { apiKey, signal } = {}) {
  if (task.phase !== 'download') throw new Error('the video is not finished yet');
  const root = task.projectPath;
  if (!root) throw new Error('the task lost its project path');
  let bytes;
  if (task.provider === 'agnes') {
    const response = await fetch(task.remote.url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000) });
    if (!response.ok) throw retryable(`could not download the clip (HTTP ${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
  } else if (task.provider === 'google') {
    const response = await fetch(task.remote.uri, { headers: { 'x-goog-api-key': apiKey }, signal });
    if (!response.ok) throw retryable(`could not download the clip (HTTP ${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
  } else {
    const result = await fetchJson(task.remote.responseUrl, { headers: { authorization: `Key ${apiKey}` }, signal });
    const url = result?.video?.url;
    if (typeof url !== 'string' || !url) throw new Error('fal answered without a clip');
    const response = await fetch(url, { signal });
    if (!response.ok) throw retryable(`could not download the clip (HTTP ${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const absolute = join(root, task.out);
  atomicWrite(absolute, bytes);
  const actual = probeMedia(absolute);
  task.phase = 'done';
  task.result = {
    relative: task.out,
    bytes: statSync(absolute).size,
    actual,
    seconds: actual.duration ?? task.seconds,
  };
  return task;
}

/** A failure worth retrying: the request exists and only the reading failed. */
function retryable(message) {
  return Object.assign(new Error(message), { retryable: true });
}

/* ── Talking to a service ───────────────────────────────────────────────── */

function serviceBase(name, fallback) {
  return (process.env[`OPENFILM_${name}_URL`]?.trim() || fallback).replace(/\/+$/, '');
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (response.status === 429 || response.status === 503 || response.status === 504) throw retryable(`the service is busy (HTTP ${response.status})`);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`the service answered ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

async function postJson(url, apiKey, body, { timeoutMs = 120_000, retries = 5, signal } = {}) {
  let attempt = 0;
  for (;;) {
    if (signal?.aborted) throw new Error('cancelled');
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error(`the service returned non-JSON (HTTP ${response.status}): ${text.slice(0, 200)}`); }
    if (response.ok) return parsed;
    const isBusy = response.status === 429 || response.status === 503;
    if (isBusy && attempt < retries) {
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 5_000 * 2 ** (attempt - 1))));
      continue;
    }
    const detail = parsed?.error?.message ?? parsed?.detail ?? parsed?.message ?? text.slice(0, 200);
    throw Object.assign(new Error(`the service rejected the request (HTTP ${response.status}): ${detail}`), { status: response.status, retryable: isBusy });
  }
}

/** A project picture as `data:` URI (fal takes pictures inline). */
function dataUriOf(root, rel) {
  const bytes = readProjectFile(root, rel);
  const ext = extname(String(rel)).slice(1).toLowerCase();
  const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext;
  return `data:image/${mime};base64,${bytes.toString('base64')}`;
}

/** A project picture inline, the way Gemini's API takes it. */
function inlinePicture(root, rel) {
  const bytes = readProjectFile(root, rel);
  const ext = extname(String(rel)).slice(1).toLowerCase();
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  return { inlineData: { mimeType: mime, data: bytes.toString('base64') } };
}

/** Load one upstream provider adapter by path (it is vendored, not a package). */
async function loadAdapter(id) {
  const file = join(PLUGIN_ROOT, 'vendor', 'node_modules', 'openfilm', 'studio', 'server', 'providers', `${id}.mjs`);
  if (!existsSync(file)) throw new Error(`the ${id} adapter is missing from the vendored OpenFilm package`);
  return import(new URL(`file:///${file.replace(/\\/g, '/')}`).href);
}

/** The context an upstream adapter expects. */
function adapterContext({ key, model, root }) {
  return {
    key,
    model,
    root,
    signal: new AbortController().signal,
    say: () => {},
    read: (path) => Promise.resolve(readProjectFile(root, path)),
  };
}
