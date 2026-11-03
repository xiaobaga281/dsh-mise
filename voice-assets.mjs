/**
 * Voice for a film: text in, a spoken audio file out.
 *
 * The one thing a film cannot draw is a voice. Everything else here is
 * code — pages draw the picture, CSS holds it still — but dialogue needs a
 * speech engine, and the harness's own transcription only runs the other way
 * (audio → text) and is not even loaded in this profile.
 *
 * Edge TTS is the right default: Microsoft's neural voices, reachable without
 * an account or a key, and the quality is high enough that a short film sounds
 * narrated rather than read by a machine. `node-edge-tts` is a declared
 * dependency, so installing the plugin installs the voice engine too — a person
 * never has to register, configure, or download anything.
 *
 * @module mise-voice
 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Load the voice engine.
 *
 * A linked plugin does not get its own `node_modules` populated: pnpm installs
 * a link target's dependencies into the profile, which is not on this module's
 * resolution path, so a bare `import('node-edge-tts')` can fail even though the
 * dependency was declared. The engine is therefore vendored beside the plugin
 * and loaded from that absolute path first, with the bare specifier kept as a
 * fallback for a packed install.
 * @returns {Promise<Function>} the EdgeTTS constructor
 */
async function loadEngine() {
  const candidates = [
    join(PLUGIN_ROOT, 'vendor', 'node_modules', 'node-edge-tts'),
    'node-edge-tts',
  ];
  const require = createRequire(import.meta.url);
  for (const candidate of candidates) {
    let entry;
    try {
      entry = require.resolve(candidate);
    } catch {
      continue;
    }
    const loaded = await import(pathToFileURL(entry).href);
    const EdgeTTS = loaded?.EdgeTTS ?? loaded?.default?.EdgeTTS;
    if (typeof EdgeTTS === 'function') return EdgeTTS;
  }
  throw new Error(
    'the voice engine is not installed (node-edge-tts missing from vendor/node_modules). Reinstall the plugin, then retry.',
  );
}

/**
 * The voices offered by default. All are Mandarin neural voices; the list is
 * short on purpose, chosen for narration rather than completeness.
 */
export const VOICES = [
  { id: 'zh-CN-YunxiNeural', label: '云希 · 男声 · 年轻', gender: 'male' },
  { id: 'zh-CN-YunjianNeural', label: '云健 · 男声 · 沉稳', gender: 'male' },
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女声 · 自然', gender: 'female' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女声 · 轻快', gender: 'female' },
  { id: 'zh-CN-YunyangNeural', label: '云扬 · 男声 · 播报', gender: 'male' },
];

/** The voice used when the caller names none. */
export const DEFAULT_VOICE = 'zh-CN-YunxiNeural';

/** A filename that cannot escape the assets folder or collide with itself.
 *
 * The stamp goes to the millisecond and a short random tag is added, so two
 * lines finished in the same second (the panel and the agent working at once)
 * never overwrite each other's audio.
 */
function voiceFileName(hint) {
  const safe = String(hint ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
  const tag = randomBytes(3).toString('hex');
  return `vo-${safe ? `${safe}-` : ''}${stamp}-${tag}.mp3`;
}

/**
 * Read a duration out of an mp3 by parsing its frames.
 *
 * The engine returns audio bytes but no length, and a film needs the length to
 * place the clip: a voice-over that runs long would be cut mid-word by its
 * `#t=0,<len>`. Parsing the frames is exact and needs no ffprobe.
 * @param {Buffer} bytes an mp3 file
 * @returns {number} seconds, or 0 when the file is not a parseable mp3
 */
export function mp3Duration(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) return 0;
  let offset = 0;
  // ID3v2 header, if present, sits before the first frame.
  if (bytes.subarray(0, 3).toString('latin1') === 'ID3') {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    offset = 10 + size;
  }
  const BITRATES = {
    v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    v2l3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  };
  const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  let seconds = 0;
  let frames = 0;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) { offset += 1; continue; }
    const versionBits = (bytes[offset + 1] >> 3) & 0x03;
    const layerBits = (bytes[offset + 1] >> 1) & 0x03;
    if (versionBits === 1 || layerBits === 0) { offset += 1; continue; }
    const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
    const rateIndex = (bytes[offset + 2] >> 2) & 0x03;
    const pad = (bytes[offset + 2] >> 1) & 0x01;
    const table = versionBits === 3 ? BITRATES.v1l3 : BITRATES.v2l3;
    const bitrate = table[bitrateIndex] * 1000;
    const sampleRate = (RATES[versionBits] ?? RATES[3])[rateIndex];
    if (!bitrate || !sampleRate) { offset += 1; continue; }
    const samples = versionBits === 3 ? 1152 : 576;
    const frameLength = Math.floor((samples / 8) * bitrate / sampleRate) + pad;
    if (frameLength <= 0) break;
    // Only a frame that is completely present counts: a truncated file (a cut
    // download, an aborted synthesis) would otherwise be reported as a real
    // length and the line would be cut mid-word.
    if (offset + frameLength > bytes.length) break;
    seconds += samples / sampleRate;
    frames += 1;
    offset += frameLength;
  }
  return frames > 0 ? Number(seconds.toFixed(3)) : 0;
}

/**
 * ── Who speaks, and with which voice ──────────────────────────────────────
 *
 * A film is either told by one voice or played by several, and the two cases
 * want opposite rules. One narrator must keep one voice for every line: a
 * marketing film whose fourth sentence is suddenly someone else sounds broken,
 * and nothing about an mp3 says who spoke, so the mistake is invisible until
 * playback. A scene with two characters must keep each of them stable instead —
 * unifying those voices is equally wrong.
 *
 * There is therefore no global "one voice" setting. A line belongs to a ROLE,
 * the role is bound to a voice the first time it speaks, and every later line
 * of that role reuses the binding. One role = one voice; several roles = one
 * voice each. The binding lives in `.film/cast.json`, which Studio ignores and
 * an agent rewrite of film.html cannot damage.
 */

/** The role a film defaults to: a single narrator, so one voice for all lines. */
export const DEFAULT_ROLE = 'narrator';

const CAST_FILE = join('.film', 'cast.json');

/**
 * The project's cast, or an empty one. A missing or unreadable file is an empty
 * cast rather than an error: a film made before roles existed still works.
 * @param {string} projectPath
 * @returns {{ roles: Record<string, { voice: string, lines?: number }>, clips: Record<string, { role: string, voice: string, text?: string, seconds?: number }> }}
 */
export function readCast(projectPath) {
  try {
    const parsed = JSON.parse(readFileSync(join(projectPath, CAST_FILE), 'utf8'));
    return {
      roles: parsed?.roles && typeof parsed.roles === 'object' ? parsed.roles : {},
      clips: parsed?.clips && typeof parsed.clips === 'object' ? parsed.clips : {},
    };
  } catch {
    return { roles: {}, clips: {} };
  }
}

/** @param {string} projectPath @param {ReturnType<typeof readCast>} cast */
function writeCast(projectPath, cast) {
  const dir = join(projectPath, '.film');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(projectPath, CAST_FILE), `${JSON.stringify(cast, null, 2)}\n`);
}

/** A voice id that exists, or the default one. @param {string | undefined} voice */
export function knownVoice(voice) {
  return VOICES.some((v) => v.id === voice) ? voice : DEFAULT_VOICE;
}

/**
 * The voice a role speaks with, and whether asking for another one is a mistake.
 *
 * A new role takes the requested voice (or the default) and keeps it. An
 * existing role keeps its binding: asking for a different voice for the same
 * role is refused unless `recast` is set, because that is exactly how one
 * narrator turns into four, one line at a time.
 *
 * @param {string} projectPath
 * @param {{ role?: string, voice?: string, recast?: boolean }} request
 * @returns {{ role: string, voice: string, bound: boolean, requested: string | null, refusal: string | null }}
 */
export function resolveRoleVoice(projectPath, request = {}) {
  const role = typeof request.role === 'string' && request.role.trim() ? request.role.trim().slice(0, 60) : DEFAULT_ROLE;
  const requested = request.voice === undefined ? null : knownVoice(request.voice);
  const cast = readCast(projectPath);
  const existing = cast.roles[role]?.voice;
  if (existing && requested && requested !== existing && !request.recast) {
    return {
      role,
      voice: existing,
      bound: true,
      requested,
      refusal:
        `role "${role}" already speaks with ${existing} (${labelOf(existing)}); passing ${requested} would put a second voice on the same speaker. `
        + `Use the same voice for the rest of this role's lines, give a different speaker its own role (e.g. role: "host2"), or set recast: true to re-voice the whole role.`,
    };
  }
  const voice = requested ?? existing ?? DEFAULT_VOICE;
  cast.roles[role] = { voice, lines: cast.roles[role]?.lines ?? 0 };
  writeCast(projectPath, cast);
  return { role, voice, bound: Boolean(existing), requested, refusal: null };
}

/** Record which role said one file, so the checker can prove it later. */
export function recordVoiceLine(projectPath, line) {
  const cast = readCast(projectPath);
  const role = line.role || DEFAULT_ROLE;
  cast.roles[role] = { voice: line.voice, lines: (cast.roles[role]?.lines ?? 0) + 1 };
  cast.clips[line.relative] = {
    role,
    voice: line.voice,
    ...(typeof line.text === 'string' ? { text: line.text.slice(0, 200) } : {}),
    ...(typeof line.seconds === 'number' ? { seconds: line.seconds } : {}),
  };
  writeCast(projectPath, cast);
  return readCast(projectPath);
}

/** The human label of a voice id, for a message. @param {string} id */
export function labelOf(id) {
  const found = VOICES.find((v) => v.id === id);
  return found ? found.label : id;
}

/**
 * Whether a film's spoken files still match its cast.
 *
 * Only files this plugin made are known (`cast.clips`); a project with no cast
 * at all is left alone rather than declared broken. The two defects it finds are
 * the two the person hears: one role with more than one voice, and a film that
 * plays a recorded line whose role has since been re-voiced.
 *
 * @param {string} projectPath
 * @returns {{ problems: Array<{ rule: string, message: string }>, roles: Array<{ role: string, voice: string, lines: number }>, narratorOnly: boolean }}
 */
export function castReport(projectPath) {
  const cast = readCast(projectPath);
  const roles = Object.entries(cast.roles).map(([role, info]) => ({ role, voice: info?.voice ?? DEFAULT_VOICE, lines: Number(info?.lines ?? 0) }));
  const problems = [];
  const byRole = new Map();

  // Only a file the film actually plays can put the wrong voice on screen.
  // A line that was re-recorded and removed from film.html must stop being
  // reported, or a correctly re-voiced film could never get a clean check.
  const referenced = referencedAudio(projectPath);
  const clips = Object.entries(cast.clips).filter(([file]) => referenced === null || referenced.has(file));

  for (const [file, info] of clips) {
    const role = info?.role ?? DEFAULT_ROLE;
    if (!byRole.has(role)) byRole.set(role, new Set());
    byRole.get(role).add(info?.voice ?? DEFAULT_VOICE);
    if (info?.voice && cast.roles[role]?.voice && info.voice !== cast.roles[role].voice) {
      problems.push({
        rule: 'voice-cast',
        message: `${file} was spoken by ${info.voice} but role "${role}" is now bound to ${cast.roles[role].voice}: re-record that line with the role's voice so the speaker does not change mid-film`,
      });
    }
  }
  for (const [role, voices] of byRole) {
    if (voices.size > 1) {
      problems.push({
        rule: 'voice-cast',
        message: `role "${role}" speaks with ${voices.size} different voices (${[...voices].map((v) => `${v} (${labelOf(v)})`).join(', ')}): one speaker must keep one voice; give the other voice its own role, or re-record the odd lines`,
      });
    }
  }
  return { problems, roles, narratorOnly: roles.length <= 1, checkedClips: clips.length };
}

/**
 * The audio files film.html actually names, or null when the film cannot be
 * read (then every recorded clip is checked rather than silently skipped).
 * @param {string} projectPath
 * @returns {Set<string> | null}
 */
function referencedAudio(projectPath) {
  let text;
  try { text = readFileSync(join(projectPath, 'film.html'), 'utf8'); } catch { return null; }
  const found = new Set();
  for (const match of text.matchAll(/(?:src|href)\s*=\s*["']([^"'#?]+\.(?:mp3|wav|m4a|aac|ogg|flac))["']/gi)) {
    found.add(match[1].replace(/^\.\//, ''));
  }
  return found;
}

/**
 * Make one spoken line and commit everything that describes it.
 *
 * This is the ONE way a line is made, whether the agent asked or the panel did:
 * the role decides the voice, the audio is written, the cue is written, and the
 * cast is recorded — only after the audio exists. A failed synthesis therefore
 * cannot leave a role bound to a voice it never spoke, and the panel cannot
 * drift from the tool.
 *
 * @param {{ projectPath: string, text: string, role?: string, voice?: string, recast?: boolean, hint?: string, subtitles?: boolean }} request
 * @returns {Promise<{ ok: boolean, relative: string, path: string, bytes: number, seconds: number, voice: string, role: string, cast: object, cues?: string, words?: Array<object> }>}
 */
export async function speakLine(request) {
  const text = String(request?.text ?? '').trim();
  if (!text) throw new Error('nothing to say: the text is empty');
  const casting = resolveRoleVoice(request.projectPath, { role: request.role, voice: request.voice, recast: request.recast === true });
  if (casting.refusal) throw new Error(casting.refusal);

  const spoken = await speak({
    text,
    projectPath: request.projectPath,
    voice: casting.voice,
    hint: request.hint,
    withWords: request.subtitles !== false,
  });

  let cues;
  if (request.subtitles !== false) {
    const cue = cueFile({ audioRelative: spoken.relative, text, seconds: spoken.seconds, words: spoken.words });
    writeFileSync(join(request.projectPath, cue.relative), cue.body, 'utf8');
    cues = cue.relative;
  }

  recordVoiceLine(request.projectPath, {
    relative: spoken.relative,
    role: casting.role,
    voice: spoken.voice,
    text,
    seconds: spoken.seconds,
  });
  const cast = castReport(request.projectPath);
  return {
    ok: true,
    relative: spoken.relative,
    path: spoken.path,
    bytes: spoken.bytes,
    seconds: spoken.seconds,
    voice: spoken.voice,
    role: casting.role,
    cast,
    ...(cues ? { cues } : {}),
    ...(spoken.words ? { words: spoken.words } : {}),
  };
}

/**
 * Speak one line and save it under the project's `assets/`.
 * @param {{ text: string, projectPath: string, voice?: string, hint?: string }} request
 * @returns {Promise<{ relative: string, path: string, bytes: number, seconds: number, voice: string }>}
 */
export async function speak(request) {
  if (typeof request.text !== 'string' || request.text.trim().length === 0) {
    throw new Error('nothing to say: the text is empty');
  }
  if (request.text.length > 4000) {
    throw new Error('the line is too long (max 4000 characters); split it into several lines');
  }

  const EdgeTTS = await loadEngine();

  const voice = VOICES.some((v) => v.id === request.voice) ? request.voice : DEFAULT_VOICE;
  // The engine can also hand back word boundaries (`saveSubtitles`), which is
  // what lets a subtitle follow the voice instead of covering the whole line.
  const engine = new EdgeTTS({
    voice,
    lang: 'zh-CN',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    timeout: 60_000,
    saveSubtitles: request.withWords === true,
  });

  const fileName = voiceFileName(request.hint);
  const assetsDir = join(request.projectPath, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  const target = join(assetsDir, fileName);

  await engine.ttsPromise(request.text, target);

  // Read the engine's own timing file (milliseconds), then remove it: the
  // project keeps the audio and the .vtt, not the engine's intermediate file.
  let words = [];
  if (request.withWords === true) {
    const sidecar = `${target}.json`;
    try {
      const parsed = JSON.parse(readFileSync(sidecar, 'utf8'));
      words = (Array.isArray(parsed) ? parsed : [])
        .filter((w) => typeof w?.part === 'string' && w.part.trim() && Number.isFinite(w.start) && Number.isFinite(w.end))
        .map((w) => ({ token: w.part, start: w.start / 1000, end: w.end / 1000 }))
        .filter((w) => w.end > w.start);
    } catch {
      words = [];
    } finally {
      try { rmSync(sidecar, { force: true }); } catch {}
    }
  }

  const bytes = readFileSync(target);
  if (bytes.length === 0) throw new Error('the voice engine produced an empty file');
  const seconds = mp3Duration(bytes);
  if (!(seconds > 0)) {
    throw new Error(`the voice engine produced audio whose length cannot be read (${bytes.length} bytes); the line was not kept`);
  }
  return {
    relative: `assets/${fileName}`,
    path: target,
    bytes: bytes.length,
    seconds,
    voice,
    ...(words.length ? { words } : {}),
  };
}

/**
 * Build the WebVTT Studio reads for subtitles, beside the audio.
 *
 * With word times, one cue per short phrase (a clause ends at punctuation, or
 * when the words run long); without them, one cue for the whole line. Either
 * way the cue ends at or before the audio's real end, so a subtitle never
 * outlives its voice.
 * @param {{ audioRelative: string, text: string, seconds: number, words?: Array<{ token: string, start: number, end: number }> }} request
 * @returns {{ relative: string, body: string }}
 */
export function cueFile(request) {
  const base = request.audioRelative.replace(/\.[^.]+$/, '');
  const duration = Math.max(0.001, Number(request.seconds) || 0);
  const cues = Array.isArray(request.words) && request.words.length
    ? phraseCues(request.words, duration)
    : [{ start: 0, end: duration, text: String(request.text ?? '').trim() }];
  const rows = ['WEBVTT', ''];
  for (const cue of cues) {
    const text = vttText(cue.text);
    if (!text) continue;
    rows.push(`${stamp(cue.start)} --> ${stamp(cue.end)}`, text, '');
  }
  return { relative: `${base}.vtt`, body: `${rows.join('\n')}\n` };
}

/** Short phrases from word times: punctuation or a long run ends a cue. */
function phraseCues(words, duration) {
  const cues = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    const start = current[0].start;
    const end = Math.min(duration, Math.max(current[current.length - 1].end, start + 0.2));
    const text = current.map((w) => w.token).join('').trim();
    if (text && end > start) cues.push({ start, end, text });
    current = [];
  };
  for (const word of words) {
    current.push(word);
    const endsClause = /[。！？；，、.!?;:,]$/.test(word.token);
    const tooLong = current.map((w) => w.token).join('').length >= 18;
    if (endsClause || tooLong) flush();
  }
  flush();
  // A last cue that would run past the audio is cut at the audio's end; an
  // empty or inverted cue is dropped rather than written as invalid VTT.
  return cues
    .map((c) => ({ ...c, start: Math.min(c.start, Math.max(0, duration - 0.05)), end: Math.min(c.end, duration) }))
    .filter((c) => c.end > c.start && c.text);
}

/** Subtitle text that cannot break the cue: no blank line, no arrow. */
function vttText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/-->/g, '→')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

/** `hh:mm:ss.mmm` from integer milliseconds, so a minute carries correctly. */
function stamp(sec) {
  const total = Math.max(0, Math.round((Number(sec) || 0) * 1000));
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60_000) % 60;
  const h = Math.floor(total / 3_600_000);
  const pad = (n, width) => String(n).padStart(width, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
}
