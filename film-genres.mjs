/**
 * Genres, as production rules rather than one film.
 *
 * Code video is not one thing: a launch opener, a data explainer, a photo
 * story, a lyric piece and a vertical social cut need different shot lengths,
 * different motion budgets and different use of pictures. What they share is
 * the engine; what differs is the recipe. This module is the recipe book, so
 * the director layer can plan any of them without re-inventing craft each time.
 *
 * Pictures are a role here, not a genre: `plate` (the shot is a picture),
 * `texture` (a picture sits inside a designed frame), `pose` (keyframes for a
 * moving subject), or `none` (pure code).
 *
 * @module mise-film-genre
 */

import { craftNotes } from './film-craft.mjs';
import { pairClaims } from './film-claims.mjs';

export const GENRES = {
  'title-sequence': {
    label: '片头/标题序列',
    aspect: '16:9',
    shot: { min: 2.0, max: 4.5 },
    type: { palette: 'amber', motion: 'mask-rise', sweep: 0.65 },
    score: { mood: 'tense', bpm: 84 },
    grade: 'filmic',
    letterbox: 0.11,
    imageUse: 'none',
    motionBudget: 2,
    beats: ['title', 'scene', 'type', 'end'],
  },
  keynote: {
    label: '发布会/产品主张',
    aspect: '16:9',
    shot: { min: 2.5, max: 5.0 },
    type: { palette: 'mono', motion: 'tracking-in', sweep: 0.35 },
    score: { mood: 'hopeful', bpm: 92 },
    grade: 'filmic',
    letterbox: 0.11,
    imageUse: 'texture',
    motionBudget: 2,
    beats: ['scene', 'type', 'graphics', 'end'],
  },
  'explainer-data': {
    label: '讲解/数据故事',
    aspect: '16:9',
    shot: { min: 3.0, max: 5.5 },
    type: { palette: 'paper', motion: 'per-word', sweep: 0.25 },
    score: { mood: 'hopeful', bpm: 88 },
    grade: 'clean',
    letterbox: 0,
    imageUse: 'texture',
    motionBudget: 2,
    beats: ['title', 'graphics', 'scene', 'end'],
  },
  'story-photo': {
    label: '照片故事/回忆',
    aspect: '16:9',
    shot: { min: 2.8, max: 4.2 },
    type: { palette: 'amber', motion: 'mask-rise', sweep: 0.45 },
    score: { mood: 'warm', bpm: 76 },
    grade: 'filmic',
    letterbox: 0.11,
    imageUse: 'plate',
    motionBudget: 1,
    beats: ['title', 'scene', 'scene', 'scene', 'end'],
  },
  lyric: {
    label: '歌词/音乐视频',
    aspect: '16:9',
    shot: { min: 1.6, max: 3.0 },
    type: { palette: 'teal', motion: 'per-word', sweep: 0.6 },
    score: { mood: 'minimal', bpm: 96 },
    grade: 'filmic',
    letterbox: 0,
    imageUse: 'texture',
    motionBudget: 3,
    beats: ['graphics', 'type', 'graphics', 'type'],
  },
  'social-vertical': {
    label: '竖屏短视频',
    aspect: '9:16',
    shot: { min: 1.2, max: 2.6 },
    type: { palette: 'amber', motion: 'per-word', sweep: 0.7 },
    score: { mood: 'hopeful', bpm: 104 },
    grade: 'filmic',
    letterbox: 0,
    imageUse: 'texture',
    motionBudget: 3,
    beats: ['title', 'graphics', 'scene', 'end'],
  },
  'product-mg': {
    label: '产品动态图形',
    aspect: '16:9',
    shot: { min: 2.2, max: 4.0 },
    type: { palette: 'mono', motion: 'tracking-in', sweep: 0.4 },
    score: { mood: 'hopeful', bpm: 100 },
    grade: 'filmic',
    letterbox: 0,
    imageUse: 'texture',
    motionBudget: 3,
    beats: ['scene', 'graphics', 'graphics', 'end'],
  },
};

/**
 * How a genre joins its shots.
 *
 * `presentation` means both shots are on screen while one leaves and the other
 * arrives (mise_duo): the right choice when shots are related — a title
 * handing over to a scene, a chapter into its content.
 * `overlay` means a shape covers the cut (mise_transition): the right choice
 * when the cut is a beat — a lyric line, a social cut, a hard change of world.
 */
export const TRANSITION_STYLE = {
  'title-sequence': 'presentation',
  keynote: 'presentation',
  'explainer-data': 'overlay',
  'story-photo': 'presentation',
  lyric: 'overlay',
  'social-vertical': 'overlay',
  'product-mg': 'presentation',
};

/**
 * How long a hand-over lasts, per genre. A presentation join needs enough time
 * to read as motion (under ~0.8s it reads as a stutter); an overlay beat wants
 * to be quick, like a percussion hit.
 */
export const TRANSITION_DURATION = {
  'title-sequence': 0.9,
  keynote: 0.8,
  'explainer-data': 0.0,
  'story-photo': 1.0,
  lyric: 0.0,
  'social-vertical': 0.0,
  'product-mg': 0.8,
};

/** The shortest presentation join that still reads as movement, in seconds. */
export const MIN_PRESENTATION_JOIN = 0.8;

/**
 * The groove each genre's score plays. A launch film wants a straight pulse; a
 * story wants space; a vertical cut wants the off-beats to catch the thumb.
 */
export const SCORE_GROOVE = {
  'title-sequence': 'syncopated',
  keynote: 'straight',
  'explainer-data': 'straight',
  'story-photo': 'sparse',
  lyric: 'syncopated',
  'social-vertical': 'syncopated',
  'product-mg': 'straight',
};

/**
 * The camera moves available to a genre, used only by the shots inside its
 * motion budget. Names match what the page builders can actually do.
 */
export const SHOT_MOVES = {
  'title-sequence': ['push-in', 'drift-up', 'pan-right'],
  keynote: ['push-in', 'pan-left', 'drift-up'],
  'explainer-data': ['push-in', 'pan-right', 'drift-up'],
  'story-photo': ['push-in', 'handheld', 'pan-left'],
  lyric: ['drift-up', 'push-in', 'pan-left'],
  'social-vertical': ['push-in', 'handheld', 'drift-up'],
  'product-mg': ['orbit', 'push-in', 'pan-right'],
};

/**
 * The finishing look each genre is graded to.
 *
 * One grade for every film is how a "generated video" reads as generated: a
 * launch film wants a clean, restrained image, a memory film wants grain and a
 * halation glow, a lyric video wants contrast. These numbers travel with the
 * plan so the delivery step cannot quietly apply the default.
 */
export const GRADE_LOOK = {
  'title-sequence': { preset: 'filmic', bloom: 0.16, grain: 0.12, vignette: 0.16 },
  keynote: { preset: 'clean', bloom: 0.06, grain: 0.05, vignette: 0.12 },
  'explainer-data': { preset: 'clean', bloom: 0.04, grain: 0.04, vignette: 0.1 },
  'story-photo': { preset: 'faded-print', bloom: 0.2, grain: 0.22, vignette: 0.16 },
  lyric: { preset: 'teal-orange', bloom: 0.18, grain: 0.14, vignette: 0.16 },
  'social-vertical': { preset: 'warm-film', bloom: 0.14, grain: 0.1, vignette: 0.14 },
  'product-mg': { preset: 'clean', bloom: 0.1, grain: 0.06, vignette: 0.14 },
};

/**
 * How each kind of beat is judged. A frame is not good or bad in the abstract:
 * a title must sit inside the safe area with its type large enough to read,
 * while a photograph is meant to fill the frame and must not be called a
 * mistake for doing so. These are the thresholds mise_verify applies.
 */
export const KIND_ACCEPTANCE = {
  // A title is allowed to sit off-centre, but not to wander: the centroid rule
  // is what catches "every shot parked dead centre" and "type sliding out of
  // frame" without having to look at the picture.
  title: { bleed: false, safe: 56, minCoverage: 0.3, maxCoverage: 70, expectCentroidX: 0.5, expectCentroidY: 0.52, centroidTolerance: 0.15 },
  type: { bleed: false, safe: 56, minCoverage: 0.3, maxCoverage: 70, expectCentroidX: 0.5, expectCentroidY: 0.5, centroidTolerance: 0.2 },
  end: { bleed: false, safe: 56, minCoverage: 0.25, maxCoverage: 70, expectCentroidX: 0.5, expectCentroidY: 0.5, centroidTolerance: 0.18 },
  // Footage is meant to fill the frame, and a lit scene is low-contrast by
  // design: for these kinds "not blank" is decided by contrast, not by a share
  // of the frame. A coverage floor here would call a real, moody shot empty.
  // Composition is left free: a photograph is allowed to break the rule.
  scene: { bleed: true, safe: 0, minCoverage: 0.05, maxCoverage: 99, delta: 45 },
  graphics: { bleed: false, safe: 40, minCoverage: 0.4, maxCoverage: 85 },
  particles: { bleed: true, safe: 0, minCoverage: 0.05, maxCoverage: 99 },
  pulse: { bleed: true, safe: 0, minCoverage: 0.05, maxCoverage: 99, delta: 45 },
  keyframes: { bleed: true, safe: 0, minCoverage: 0.05, maxCoverage: 99, delta: 45 },
};

/** The acceptance rules for one beat kind, with a safe fallback. */
export function acceptanceFor(kind) {
  return KIND_ACCEPTANCE[kind] ?? KIND_ACCEPTANCE.type;
}

/**
 * How the cuts change speed through the film.
 *
 * `decelerate` opens on longer shots and tightens as the film finds its subject;
 * `accelerate` opens quick and lets the last shot breathe; `even` is a metronome
 * and should be rare — a film that never changes tempo feels like a slideshow.
 */
export const SHOT_PACING = {
  'title-sequence': 'decelerate',
  keynote: 'even',
  'explainer-data': 'even',
  'story-photo': 'decelerate',
  lyric: 'accelerate',
  'social-vertical': 'accelerate',
  'product-mg': 'accelerate',
};

/**
 * Turn a pacing name into per-beat weights (before the genre's min/max clamps).
 * @param {'even'|'accelerate'|'decelerate'} pacing
 * @param {number} count
 */
export function pacingWeights(pacing, count) {
  const n = Math.max(1, count);
  if (pacing === 'accelerate') return Array.from({ length: n }, (_, i) => 1.25 - 0.5 * (i / Math.max(1, n - 1)));
  if (pacing === 'decelerate') return Array.from({ length: n }, (_, i) => 0.75 + 0.5 * (i / Math.max(1, n - 1)));
  return Array.from({ length: n }, () => 1);
}

export function validateGenre(spec = {}) {
  const problems = [];
  if (spec.genre !== undefined && !GENRES[spec.genre]) problems.push('unknown genre ' + JSON.stringify(spec.genre) + '; there is ' + Object.keys(GENRES).join(', '));
  if (spec.seconds !== undefined) {
    const seconds = Number(spec.seconds);
    if (!Number.isFinite(seconds) || seconds < 4 || seconds > 600) problems.push('seconds must be 4..600');
  }
  return { ok: problems.length === 0, problems };
}

export function planProduction(spec = {}) {
  const genreName = spec.genre in GENRES ? spec.genre : 'title-sequence';
  const genre = GENRES[genreName];
  const seconds = Number(spec.seconds ?? 20);
  const wanted = Math.max(genre.beats.length, Math.min(12, Math.round(seconds / 3.4)));
  let count = Math.max(2, Math.min(12, Number(spec.beats ?? wanted)));

  const pacing = SHOT_PACING[genreName] ?? 'even';
  const bpm = Number(genre.score.bpm ?? 84);
  const beat = 60 / bpm;
  // Music-first editing: cuts land on the half-beat grid, so the picture and the
  // score agree instead of being fitted to each other afterwards.
  const grid = beat / 2;
  // A length must be both on the grid and inside the genre's range. Clamping
  // first and snapping after would break the grid (the snap moves it out of
  // range again); so the allowed band is itself made grid-aligned.
  const lowest = Math.max(genre.shot.min, grid);
  const lo = Math.ceil(lowest / grid - 1e-9) * grid;
  const hi = Math.floor(genre.shot.max / grid + 1e-9) * grid;
  const snap = spec.snapToBeat === false
    ? (value) => Math.min(genre.shot.max, Math.max(genre.shot.min, value))
    : (value) => Math.min(hi, Math.max(lo, Math.round(value / grid) * grid));

  const lengthsFor = (n) => {
    const weights = pacingWeights(pacing, n);
    const sum = weights.reduce((total, value) => total + value, 0);
    // Pacing decides the shape, the genre's min/max decides the truth: the
    // weights are scaled so the film still lands on its target length.
    return weights.map((weight, index) => {
      const edge = index === 0 || index === n - 1;
      const share = (weight / sum) * seconds;
      return Number(snap(share * (edge ? 1.06 : 1.0)).toFixed(2));
    });
  };

  // A genre with short shots (vertical social) clamps below the target length;
  // add beats until the film reaches it, rather than shipping a short film.
  let lengths = lengthsFor(count);
  const total = (list) => list.reduce((sum, value) => sum + value, 0);
  while (total(lengths) < seconds * 0.92 && count < 12) {
    count += 1;
    lengths = lengthsFor(count);
  }
  // and if it overshoots badly, one fewer beat brings it back.
  while (total(lengths) > seconds * 1.12 && count > 2) {
    count -= 1;
    lengths = lengthsFor(count);
  }

  let at = 0;
  const beats = lengths.map((length, index) => {
    // The recipe's last kind always closes the film; the rest cycle through it.
    const isLast = index === count - 1;
    const kind = isLast ? genre.beats[genre.beats.length - 1] : genre.beats[index % Math.max(1, genre.beats.length - 1)];
    // Each beat carries the thresholds it will be judged by, so the film can be
    // checked without guessing whether a frame is a title or a photograph.
    const plan = { index: index + 1, at: Number(at.toFixed(2)), length, kind, acceptance: acceptanceFor(kind) };
    at += length;
    return plan;
  });

  // Every cut is classified, because the fill that announces it depends on what
  // kind of edit it is: a chapter change, a related hand-over, or a hard cut.
  const joinStyle = TRANSITION_STYLE[genreName] ?? 'overlay';
  const cuts = beats.slice(1).map((beat, index) => {
    const previous = beats[index];
    const isFinalJoin = joinStyle === 'presentation' && index === beats.length - 2 && (TRANSITION_DURATION[genreName] ?? 0) > 0;
    const type = isFinalJoin ? 'join' : (['title', 'type', 'end'].includes(previous.kind) ? 'chapter' : 'cut');
    return { at: beat.at, type, from: previous.kind, to: beat.kind };
  });

  // Camera moves are a budget, not a default. Only the shots that carry the film
  // get one; the rest hold still and rely on type and light. A film where every
  // shot moves reads as cheap, because nothing is allowed to settle.
  const movePool = SHOT_MOVES[genreName] ?? SHOT_MOVES['title-sequence'];
  const budget = Math.max(1, Math.min(beats.length, Number(genre.motionBudget ?? 2)));
  const priority = [];
  if (beats.length) priority.push(0);
  const climax = Math.max(0, Math.min(beats.length - 1, Math.round(beats.length * 0.8) - 1));
  if (!priority.includes(climax)) priority.push(climax);
  if (beats.length > 1 && !priority.includes(beats.length - 1)) priority.push(beats.length - 1);
  for (let index = 0; index < beats.length && priority.length < budget; index += 1) {
    if (!priority.includes(index)) priority.push(index);
  }
  const moving = new Set(priority.slice(0, budget));
  let moveCursor = 0;
  beats.forEach((beat, index) => {
    // Walk the pool with a cursor rather than by beat index: two moving shots
    // should not both get the pool's first entry.
    beat.move = moving.has(index) ? movePool[moveCursor++ % movePool.length] : 'still';
  });

  // A claim and its proof travel together: when the author states claims, each
  // one is paired with the shot that shows it, and an unproven scene is named.
  const claimPlan = Array.isArray(spec.claims) && spec.claims.length ? pairClaims(beats, spec.claims) : null;
  if (claimPlan) {
    claimPlan.assignments.forEach((assignment) => {
      const beat = beats.find((item) => item.index === assignment.beat);
      if (beat) beat.claim = { text: assignment.claim, kind: assignment.kind };
    });
  }

  return {
    ok: true,
    genre: genreName,
    label: genre.label,
    aspect: genre.aspect,
    seconds: Number(at.toFixed(2)),
    beats,
    type: genre.type,
    score: { mood: genre.score.mood, bpm: genre.score.bpm, align: 'cuts', beat: Number(beat.toFixed(3)), grid: Number(grid.toFixed(3)), groove: SCORE_GROOVE[genreName] ?? 'straight' },
    grade: {
      ...(GRADE_LOOK[genreName] ?? GRADE_LOOK['title-sequence']),
      letterbox: genre.letterbox,
    },
    imageUse: genre.imageUse,
    motionBudget: genre.motionBudget,
    transition: TRANSITION_STYLE[genreName] ?? 'overlay',
    transitionDuration: TRANSITION_DURATION[genreName] ?? 0,
    cuts,
    pacing,
    rules: [
      '每个镜头 ' + genre.shot.min + '-' + genre.shot.max + ' 秒，不要整片等长',
      '节奏：' + ({ accelerate: '渐快（越到后面切得越紧）', decelerate: '渐慢（开场短、结尾给足呼吸）', even: '匀速（少用，容易像幻灯片）' }[pacing] ?? '匀速'),
      '全片动效预算 ' + genre.motionBudget + ' 个镜头（其余靠运镜、排版、光学）',
      '图片角色：' + genre.imageUse + '（plate=画面就是图；texture=图放在设计框里；pose=关键帧；none=纯代码）',
      '配乐 ' + genre.score.mood + ' / ' + genre.score.bpm + 'bpm，和弦落在切点',
      '切点吸附到 ' + (beat / 2).toFixed(3) + 's 的半拍网格（音乐先行；需要自由时长时传 snapToBeat:false）',
      '收尾统一 ' + genre.grade + ' 调色' + (genre.letterbox ? '，' + (genre.letterbox * 2 * 100).toFixed(1) + '% 宽银幕黑边' : ''),
      '转场：' + (TRANSITION_STYLE[genreName] === 'presentation'
        ? `呈现式 ${TRANSITION_DURATION[genreName] ?? 0.9}s（两个镜头同屏交接，用 mise_duo；短于 ${MIN_PRESENTATION_JOIN}s 会像卡顿）`
        : '遮罩式（盖住切点，适合节拍硬切，用 mise_transition）'),
      `调色档：${(GRADE_LOOK[genreName] ?? GRADE_LOOK['title-sequence']).preset}（颗粒 ${(GRADE_LOOK[genreName] ?? GRADE_LOOK['title-sequence']).grain}，光晕 ${(GRADE_LOOK[genreName] ?? GRADE_LOOK['title-sequence']).bloom}，暗角 ${(GRADE_LOOK[genreName] ?? GRADE_LOOK['title-sequence']).vignette}）`,
      ...craftNotes(),
      ...(claimPlan
        ? [
          `主张-证据：${claimPlan.assignments.length} 组已配对；${claimPlan.unproven.length ? `未配对的证据镜头 ${claimPlan.unproven.join(', ')}` : '没有空镜'}`,
          ...claimPlan.problems,
        ]
        : ['主张-证据：讲解类请传 claims（每句主张附证据：number/chart/quote/source），空口主张会被拦下']),
    ],
    ...(claimPlan ? { claims: { assignments: claimPlan.assignments, unproven: claimPlan.unproven, problems: claimPlan.problems } } : {}),
  };
}
