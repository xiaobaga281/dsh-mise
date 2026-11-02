/**
 * Video generation that survives a busy queue, a dropped poll and a restart.
 *
 * A clip takes minutes and the services fail by being popular: fal's queue
 * answers 503, Agnes's free tier waits, a poll times out. The old queue retried
 * the whole generation, which meant a second paid POST whenever reading the
 * first one failed. Here the generation is a task with a phase:
 *
 *   create → (remote id kept) → poll → download → done
 *
 * The remote id is written to `<project>/.film/media-jobs/<id>.json` as soon as
 * it exists, and a retry only ever asks again about that same task. A restart
 * reads the same files and continues. A submission whose result is unknown is
 * parked as `unknown_submission` instead of being sent a second time.
 *
 * @module openfilm-asset-queue
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { advanceVideoTask, downloadVideoTask, recordAsset, startVideoTask, validateRequest } from './media-service.mjs';

/** The jobs this process is running, by id. */
const RUNNING = new Map();
/** Every settled job the panel may still show, by project and id. */
const RECENT = new Map();

const JOBS_DIR = join('.film', 'media-jobs');
/** Backoff for a retryable failure: 15s, 30s, 60s, 120s, then every 4 min. */
const RETRY_DELAYS = [15_000, 30_000, 60_000, 120_000];
const MAX_ATTEMPTS = 10;
/** How long one clip may take before the job stops asking (the service may still finish). */
const TASK_DEADLINE_MS = 40 * 60 * 1000;
const POLL_MS = 5000;

function jobPath(projectPath, id) {
  return join(projectPath, JOBS_DIR, `${id}.json`);
}

/** Write the job so a later process (or the panel) sees the same state. */
function persist(job) {
  try {
    mkdirSync(join(job.projectPath, JOBS_DIR), { recursive: true });
    writeFileSync(jobPath(job.projectPath, job.id), `${JSON.stringify(job, null, 2)}\n`);
  } catch {}
}

/** The public shape: what the panel shows, and no secret (a key is never stored). */
function publicShape(job) {
  return {
    id: job.id,
    kind: job.kind,
    projectPath: job.projectPath,
    provider: job.provider,
    model: job.model,
    prompt: String(job.prompt ?? '').length > 120 ? `${String(job.prompt).slice(0, 117)}...` : String(job.prompt ?? ''),
    hint: job.hint ?? null,
    state: job.state,
    phase: job.phase,
    attempts: job.attempts,
    nextAttemptAt: job.state === 'waiting' ? job.nextAttemptAt : null,
    lastError: job.lastError,
    result: job.result ?? null,
    assetId: job.task?.assetId ?? null,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt ?? null,
  };
}

/**
 * Queue one video generation and start it.
 * @param {{ projectPath: string, request: object, resolveKey: () => Promise<string>, hint?: string }} spec
 * @returns {object} the job's public shape
 */
export function enqueueMediaJob(spec) {
  // An impossible combination is a mistake, not a job: refusing here means no
  // task file, no attempt and no chance of a paid request that could not work.
  validateRequest({ ...spec.request, kind: 'video' });
  const id = randomBytes(8).toString('hex');
  const job = {
    version: 1,
    id,
    kind: 'video',
    projectPath: spec.projectPath,
    provider: spec.request.provider,
    model: spec.request.model,
    prompt: spec.request.prompt,
    hint: spec.hint ?? null,
    state: 'queued',
    phase: 'created',
    attempts: 0,
    nextAttemptAt: Date.now(),
    lastError: null,
    result: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    deadline: Date.now() + TASK_DEADLINE_MS,
    task: { ...spec.request, projectPath: spec.projectPath, hint: spec.hint },
  };
  persist(job);
  RECENT.set(`${job.projectPath}\0${job.id}`, job);
  RUNNING.set(job.id, { job, resolveKey: spec.resolveKey, controller: new AbortController() });
  void drive(job.id).catch(() => {});
  return publicShape(job);
}

/** One pass of the state machine, then either finish, wait, or keep polling. */
async function drive(id) {
  const entry = RUNNING.get(id);
  if (!entry) return;
  const { job } = entry;
  if (job.state === 'cancelled') return;
  job.attempts += 1;
  job.nextAttemptAt = null;
  try {
    const apiKey = await entry.resolveKey();
    if (!apiKey) throw Object.assign(new Error('the service key is not configured any more'), { fatal: true });
    if (!job.task.remote) {
      // Creating is the only step that spends: it happens exactly once.
      job.state = 'creating';
      persist(job);
      job.task = await startVideoTask({ ...job.task, apiKey, signal: entry.controller.signal });
      job.phase = 'created';
      persist(job);
    }
    job.state = 'running';
    persist(job);
    while (job.phase !== 'download') {
      if (entry.controller.signal.aborted) throw Object.assign(new Error('cancelled'), { cancelled: true });
      if (Date.now() > job.deadline) throw Object.assign(new Error('the clip did not finish in time; the service may still complete it, so this job is not resubmitted'), { fatal: true });
      job.task = await advanceVideoTask(job.task, { apiKey, signal: entry.controller.signal });
      persist(job);
      if (job.task.progress) job.progress = job.task.progress;
      if (job.phase !== 'download') await sleep(POLL_MS, entry.controller.signal);
    }
    job.state = 'downloading';
    persist(job);
    job.task = await downloadVideoTask(job.task, { apiKey, signal: entry.controller.signal });
    job.state = 'done';
    job.phase = 'done';
    job.result = job.task.result;
    job.finishedAt = new Date().toISOString();
    persist(job);
    recordAsset(job.projectPath, {
      assetId: job.task.assetId,
      kind: 'video',
      relative: job.result.relative,
      bytes: job.result.bytes,
      provider: job.provider,
      model: job.model,
      prompt: job.prompt,
      ...(job.task.shotId ? { shotId: job.task.shotId } : {}),
      ...(job.task.firstFrame ? { firstFrame: job.task.firstFrame } : {}),
      ...(job.task.lastFrame ? { lastFrame: job.task.lastFrame } : {}),
      ...(job.task.references ? { references: job.task.references } : {}),
      requested: { seconds: job.task.seconds, aspectRatio: job.task.aspectRatio, generateAudio: job.task.generateAudio },
      actual: job.result.actual,
      jobId: job.id,
      createdAt: new Date().toISOString(),
    });
    RUNNING.delete(id);
    return;
  } catch (error) {
    await failOrRetry(entry, error);
  }
}

/** Decide whether a failure is worth another attempt, and never re-create. */
async function failOrRetry(entry, error) {
  const { job } = entry;
  const message = error instanceof Error ? error.message : String(error);
  if (error?.cancelled || entry.controller.signal.aborted) {
    job.state = 'cancelled';
    job.lastError = 'cancelled by the person';
    job.finishedAt = new Date().toISOString();
    persist(job);
    RUNNING.delete(job.id);
    return;
  }
  // Before a remote id exists, an error is ambiguous: the service may have
  // taken the request and failed to answer. Retrying is only safe for a busy
  // signal or a network error; a rejection is final.
  const networkish = error instanceof TypeError || error?.retryable === true;
  if (error?.fatal) {
    job.state = 'failed';
    job.lastError = message.slice(0, 300);
    job.finishedAt = new Date().toISOString();
    persist(job);
    RUNNING.delete(job.id);
    return;
  }
  if (!job.task?.remote && !networkish) {
    job.state = 'unknown_submission';
    job.lastError = `${message.slice(0, 240)} — the request may or may not have been created, so it is not sent again; check the service's own page`;
    job.finishedAt = new Date().toISOString();
    persist(job);
    RUNNING.delete(job.id);
    return;
  }
  if (job.attempts < MAX_ATTEMPTS && (networkish || job.task?.remote)) {
    const delay = RETRY_DELAYS[Math.min(job.attempts - 1, RETRY_DELAYS.length - 1)];
    job.state = 'waiting';
    job.lastError = message.slice(0, 300);
    job.nextAttemptAt = Date.now() + delay;
    persist(job);
    setTimeout(() => {
      const live = RUNNING.get(job.id);
      if (live && live.job.state === 'waiting') void drive(job.id).catch(() => {});
    }, delay);
    return;
  }
  job.state = 'failed';
  job.lastError = message.slice(0, 300);
  job.finishedAt = new Date().toISOString();
  persist(job);
  RUNNING.delete(job.id);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => { cleanup(); reject(Object.assign(new Error('cancelled'), { cancelled: true })); };
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Where a job is, in memory or on disk. @param {string} id */
export function getJob(projectPath, id) {
  const live = RUNNING.get(id)?.job;
  if (live && live.projectPath === projectPath) return publicShape(live);
  const recent = RECENT.get(`${projectPath}\0${id}`);
  if (recent) return publicShape(recent);
  try {
    const stored = JSON.parse(readFileSync(jobPath(projectPath, id), 'utf8'));
    return publicShape(stored);
  } catch {
    return null;
  }
}

/** Stop asking about one job. The service may still finish the clip. */
export function cancelJob(projectPath, id) {
  const entry = RUNNING.get(id);
  if (entry && entry.job.projectPath === projectPath) {
    entry.controller.abort();
    return { ok: true, cancelled: true, note: 'the remote clip may still finish on the service; nothing more is downloaded here' };
  }
  const job = getJob(projectPath, id);
  if (!job) return { ok: false, error: 'no such job' };
  return { ok: true, cancelled: false, note: `that job is already ${job.state}` };
}

/**
 * List the jobs a project knows: the ones running now, then the ones on disk
 * that this process has not seen (a previous harness session).
 */
export function listJobs(projectPath) {
  if (!projectPath) {
    return [...RUNNING.values()].map((e) => publicShape(e.job)).reverse();
  }
  const seen = new Map();
  for (const job of [...RUNNING.values()].map((e) => e.job).filter((j) => j.projectPath === projectPath)) seen.set(job.id, job);
  for (const job of [...RECENT.values()].filter((j) => j.projectPath === projectPath)) seen.set(job.id, seen.get(job.id) ?? job);
  try {
    for (const name of readdirSync(join(projectPath, JOBS_DIR))) {
      if (!name.endsWith('.json')) continue;
      const id = name.replace(/\.json$/, '');
      if (seen.has(id)) continue;
      try { seen.set(id, JSON.parse(readFileSync(jobPath(projectPath, id), 'utf8'))); } catch {}
    }
  } catch {}
  return [...seen.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(publicShape);
}

/** Forget finished jobs on disk. Running and waiting jobs stay. */
export function clearFinishedJobs(projectPath) {
  let n = 0;
  for (const [key, job] of RECENT) {
    if (job.state === 'done' || job.state === 'failed' || job.state === 'unknown_submission') {
      try { rmSync(jobPath(job.projectPath, job.id), { force: true }); } catch {}
      RECENT.delete(key);
      n += 1;
    }
  }
  for (const entry of [...RUNNING.values()]) {
    if (entry.job.state === 'done' || entry.job.state === 'failed') RUNNING.delete(entry.job.id);
  }
  return n;
}

/** Whether anything is still working or waiting. */
export function hasPendingJobs(projectPath) {
  for (const entry of RUNNING.values()) {
    if ((!projectPath || entry.job.projectPath === projectPath)
      && ['queued', 'creating', 'running', 'downloading', 'waiting'].includes(entry.job.state)) return true;
  }
  return false;
}

/**
 * Continue every job a previous process left unfinished, so a restart resumes
 * the same remote task instead of losing it.
 * @param {string[]} projectRoots the films to look in
 * @param {(projectPath: string) => (Promise<string | undefined>)} resolveKey
 */
export async function resumeJobs(projectRoots, resolveKey) {
  const resumed = [];
  for (const projectPath of projectRoots) {
    let names = [];
    try { names = readdirSync(join(projectPath, JOBS_DIR)); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      let job;
      try { job = JSON.parse(readFileSync(jobPath(projectPath, name), 'utf8')); } catch { continue; }
      if (!job?.id || RUNNING.has(job.id)) continue;
      if (!['queued', 'creating', 'running', 'downloading', 'waiting'].includes(job.state)) continue;
      job.projectPath = projectPath;
      job.state = 'waiting';
      job.nextAttemptAt = Date.now();
      RUNNING.set(job.id, { job, resolveKey: () => resolveKey(projectPath), controller: new AbortController() });
      RECENT.set(`${projectPath}\0${job.id}`, job);
      void drive(job.id).catch(() => {});
      resumed.push(publicShape(job));
    }
  }
  return resumed;
}

/** Test hook: drop everything. */
export function resetJobs() {
  RUNNING.clear();
  RECENT.clear();
}

/** Test hook: the retry policy, for assertions. */
export const RETRY_POLICY = { RETRY_DELAYS, MAX_ATTEMPTS, TASK_DEADLINE_MS, POLL_MS };
