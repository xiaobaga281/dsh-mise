/**
 * Agnes asset generation: real pictures and footage for a film's `assets/`.
 *
 * OpenFilm upstream has no video generation — its `get` dispatch names nine
 * fixed providers and cannot be extended — so a film made here could only ever
 * draw its pictures in code. This module calls Agnes directly instead:
 *
 *   image  POST /v1/images/generations   (synchronous, returns a URL or b64)
 *   video  POST /v1/videos               (asynchronous: create, then poll)
 *
 * Both write the result into the film project's `assets/`, which is exactly
 * where `film.html` expects media and where the person sees it in Studio.
 *
 * Billing is real for video ($0.025/s at 720P, $0.040/s at 1080P), and the
 * image model is free at the time of writing. The caller is told the cost class
 * before anything is spent; see `describeAssetCost`.
 *
 * @module openfilm-assets
 */

import { writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

/** Where Agnes serves the API. One place, so a regional host swaps in one edit. */
const AGNES_BASE_URL = 'https://apihub.agnes-ai.com';

/**
 * The models this module calls. Flash is chosen deliberately: it is the tier
 * currently on a $0 promotion, and it is the only video model whose limits the
 * request shape below satisfies (`size` must be exactly "720P").
 */
const AGNES_VIDEO_MODEL = 'agnes-video-2.5-flash';
const AGNES_IMAGE_MODEL = 'agnes-image-2.5-flash';

/** Video durations the service accepts, and the size tiers it offers. */
export const VIDEO_SECONDS = { min: 4, max: 12 };
/**
 * `agnes-video-2.5-flash` accepts only `720P` — any other tier is an HTTP 400
 * ("size must be 720P"), and Flash rejects reference videos entirely. The
 * non-Flash `agnes-video-2.5` adds 1080P/1K/2K and reference videos; this
 * plugin deliberately targets Flash because it is currently free.
 */
export const VIDEO_SIZES = ['720P'];
export const IMAGE_SIZES = ['1K', '2K', '3K', '4K'];
export const ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];

/**
 * Per-second price by size tier, in USD, from the published price list.
 * Flash is on a limited-time $0 promotion; the list price is noted so the
 * estimate stays honest once the promotion ends.
 */
const VIDEO_PRICE_PER_SECOND = { '720P': 0 };
const VIDEO_LIST_PRICE_PER_SECOND = { '720P': 0.025 };

/** Poll cadence and ceiling for the asynchronous video task. */
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * What one generation would cost, so a caller can decide before spending.
 * @param {{ kind: 'video'|'image', seconds?: number, size?: string }} request
 * @returns {{ kind: string, unitPriceUsd: number, estimatedUsd: number, note: string }}
 */
export function describeAssetCost(request) {
  if (request.kind === 'image') {
    return { kind: 'image', unitPriceUsd: 0, estimatedUsd: 0, note: 'image output is free at the published current price' };
  }
  const size = VIDEO_SIZES.includes(request.size) ? request.size : '720P';
  const seconds = clampSeconds(request.seconds);
  const unit = VIDEO_PRICE_PER_SECOND[size] ?? 0;
  const list = VIDEO_LIST_PRICE_PER_SECOND[size] ?? 0;
  return {
    kind: 'video',
    unitPriceUsd: unit,
    estimatedUsd: Number((unit * seconds).toFixed(3)),
    note:
      unit === 0
        ? `${seconds}s at ${size} — currently free (list price $${list.toFixed(3)}/s, a limited-time promotion)`
        : `${seconds}s at ${size} — billed per second by Agnes, not by this plugin`,
  };
}

/** Clamp a requested duration into the range the service accepts. */
function clampSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.min(VIDEO_SECONDS.max, Math.max(VIDEO_SECONDS.min, Math.round(n)));
}

/** A filename that cannot escape the assets folder or collide with itself. */
function assetFileName(prefix, extension, hint) {
  const safe = String(hint ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${prefix}-${safe ? `${safe}-` : ''}${stamp}${extension}`;
}

/**
 * One JSON request, with the key never echoed into an error message.
 *
 * 429 and 503 are retryable by the service's own guidance: 429 is a rate limit
 * ("use exponential backoff"), 503 on video creation is a full queue ("please
 * retry later"), which a busy free tier hits routinely. Both are retried with
 * growing waits; anything else fails immediately, because a 400 will never
 * succeed by asking again.
 * @param {string} url
 * @param {string} apiKey
 * @param {object} body
 * @param {{ timeoutMs?: number, retries?: number, signal?: AbortSignal }} [options]
 */
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
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Agnes returned non-JSON (HTTP ${response.status}): ${text.slice(0, 200)}`);
    }
    if (response.ok) return parsed;

    // A full queue or a rate limit is worth waiting out; nothing else is.
    const retryable = response.status === 429 || response.status === 503;
    if (retryable && attempt < retries) {
      attempt += 1;
      // 5s, 10s, 20s, 30s, 30s — long enough for a queue slot, short enough to
      // stay inside one tool call.
      const wait = Math.min(30_000, 5_000 * 2 ** (attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }
    const detail = parsed?.error?.message ?? parsed?.detail ?? parsed?.message ?? text.slice(0, 200);
    const hint = retryable ? ` after ${attempt + 1} attempts (the queue stays busy)` : '';
    throw new AgnesRequestError(`Agnes rejected the request (HTTP ${response.status})${hint}: ${detail}`, response.status);
  }
}

/** A failed Agnes call, carrying the status so a caller can explain it. */
export class AgnesRequestError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'AgnesRequestError';
    this.status = status;
  }
}

/** Download a generated asset into the project's assets folder. */
async function saveAsset(url, projectPath, fileName) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`could not download the result (HTTP ${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const assetsDir = join(projectPath, 'assets');
  const target = join(assetsDir, fileName);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(target, bytes);
  // The relative path is what film.html wants: media lives under assets/.
  return { path: target, relative: `assets/${fileName}`, bytes: bytes.length };
}

/**
 * Generate one image and save it under the project's `assets/`.
 * @param {{ apiKey: string, projectPath: string, prompt: string, size?: string, ratio?: string, hint?: string }} request
 * @returns {Promise<{ relative: string, path: string, bytes: number, model: string }>}
 */
export async function generateImage(request) {
  const size = IMAGE_SIZES.includes(request.size) ? request.size : '2K';
  const ratio = ASPECT_RATIOS.includes(request.ratio) ? request.ratio : '16:9';
  const body = {
    model: AGNES_IMAGE_MODEL,
    prompt: request.prompt,
    size,
    ratio,
    // Top-level response_format is rejected; it belongs inside extra_body.
    extra_body: { response_format: 'url' },
  };
  const parsed = await postJson(`${AGNES_BASE_URL}/v1/images/generations`, request.apiKey, body, { timeoutMs: 360_000 });
  const url = parsed?.data?.[0]?.url;
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('Agnes returned no image URL (unexpected response shape)');
  }
  const saved = await saveAsset(url, request.projectPath, assetFileName('img', '.png', request.hint));
  return { ...saved, model: AGNES_IMAGE_MODEL };
}

/**
 * Create one video task, poll it to completion, and save the result.
 * @param {{ apiKey: string, projectPath: string, prompt: string, seconds?: number, size?: string, aspectRatio?: string, hint?: string, signal?: AbortSignal, onProgress?: (p: object) => void }} request
 * @returns {Promise<{ relative: string, path: string, bytes: number, model: string, seconds: number, size: string }>}
 */
export async function generateVideo(request) {
  const seconds = clampSeconds(request.seconds);
  const size = VIDEO_SIZES.includes(request.size) ? request.size : '720P';
  const aspectRatio = ASPECT_RATIOS.includes(request.aspectRatio) ? request.aspectRatio : '16:9';

  const created = await postJson(`${AGNES_BASE_URL}/v1/videos`, request.apiKey, {
    model: AGNES_VIDEO_MODEL,
    prompt: request.prompt,
    seconds: String(seconds),
    mode: 'text',
    size,
    aspect_ratio: aspectRatio,
  });
  const videoId = created?.video_id ?? created?.id;
  if (typeof videoId !== 'string' || videoId.length === 0) {
    throw new Error('Agnes returned no video_id (unexpected response shape)');
  }
  request.onProgress?.({ phase: 'queued', videoId, progress: 0 });

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    if (request.signal?.aborted) throw new Error('cancelled');
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const query = new URLSearchParams({ video_id: videoId, model_name: AGNES_VIDEO_MODEL });
    const response = await fetch(`${AGNES_BASE_URL}/agnesapi?${query}`, {
      headers: { authorization: `Bearer ${request.apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 429) continue; // back off by simply waiting another tick
    if (!response.ok) throw new Error(`could not read the video task (HTTP ${response.status})`);
    last = await response.json();
    request.onProgress?.({ phase: last?.status ?? 'in_progress', videoId, progress: Number(last?.progress ?? 0) });
    if (last?.status === 'completed' || last?.status === 'failed') break;
  }
  if (last?.status === 'failed') {
    throw new Error(`Agnes could not make the video: ${last?.error?.message ?? 'no reason given'}`);
  }
  if (last?.status !== 'completed') {
    throw new Error(`the video task did not finish within ${POLL_TIMEOUT_MS / 1000}s (video_id ${videoId})`);
  }
  const url = last?.url;
  if (typeof url !== 'string' || url.length === 0) throw new Error('the completed task carried no url');

  const saved = await saveAsset(url, request.projectPath, assetFileName('vid', '.mp4', request.hint));
  return { ...saved, model: AGNES_VIDEO_MODEL, seconds, size };
}
