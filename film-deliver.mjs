/**
 * Delivery: the last step, described so it can be checked.
 *
 * A finished film is a claim, and a claim needs evidence: what file was made,
 * from which cut, at which size and frame rate, how loud it is, and whether it
 * passed the gates. This module builds that record from measurements only —
 * nothing here is copied from what a tool *hoped* it produced.
 *
 * @module openfilm-film-deliver
 */

/**
 * Read the loudness numbers ffmpeg's loudnorm prints to stderr.
 * @param {string} stderr
 * @returns {{ integrated: number|null, truePeak: number|null, lra: number|null }}
 */
export function parseLoudnorm(stderr) {
  const text = String(stderr ?? '');
  const pick = (key) => {
    const match = new RegExp(`"${key}"\\s*:\\s*"(-?[0-9.]+)"`).exec(text);
    return match ? Number(match[1]) : null;
  };
  return {
    integrated: pick('input_i'),
    truePeak: pick('input_tp'),
    lra: pick('input_lra'),
  };
}

/**
 * Does the sound outlast the picture?
 *
 * A score written for the plan's scene lengths and a film whose shots are cut
 * short by their joins end at different times: the picture stops, the music
 * keeps playing for three seconds, and the last thing the viewer sees is a black
 * frame with an orchestra. The assembler cannot see this; delivery can.
 *
 * @param {{ videoSeconds?: number, audioSeconds?: number, tolerance?: number }} spec
 * @returns {{ ok: boolean, mismatch: number, problems: string[] }}
 */
export function mediaMismatch(spec = {}) {
  const video = Number(spec.videoSeconds ?? 0);
  const audio = Number(spec.audioSeconds ?? 0);
  const tolerance = Number(spec.tolerance ?? 0.2);
  if (!Number.isFinite(video) || !Number.isFinite(audio) || video <= 0 || audio <= 0) {
    return { ok: true, mismatch: 0, problems: [] };
  }
  const mismatch = Number(Math.abs(audio - video).toFixed(3));
  if (mismatch <= tolerance) return { ok: true, mismatch, problems: [] };
  return {
    ok: false,
    mismatch,
    problems: audio > video
      ? [`the sound runs ${mismatch}s past the picture: trim the score to the film's length`]
      : [`the picture runs ${mismatch}s past the sound: the tail is silent`],
  };
}

/**
 * The delivery record.
 * @param {{
 *   filmPath: string,
 *   outputPath: string,
 *   sourcePath?: string,
 *   ladder: string[],
 *   media?: { width?: number, height?: number, fps?: number|null, duration?: number, video?: string, audio?: string, channels?: number, audioDuration?: number },
 *   loudness?: { integrated: number|null, truePeak: number|null, lra: number|null },
 *   gate?: { ok: boolean, blockers?: string[] },
 *   grade?: { preset?: string, grain?: number, bloom?: number, vignette?: number, letterbox?: number },
 *   changes?: Array<{ at: number, changedPercent: number, brightnessBefore: number, brightnessAfter: number, centroidShift: number }>,
 *   score?: { mood?: string, bpm?: number, groove?: string, grid?: number, voices?: number, synth?: string },
 *   now?: Date
 * }} input
 */
export function deliveryManifest(input = {}) {
  const media = input.media ?? {};
  const loudness = input.loudness ?? { integrated: null, truePeak: null, lra: null };
  const problems = [];
  if (!input.outputPath) problems.push('no output file');
  if (!Number.isFinite(media.width) || !Number.isFinite(media.height)) problems.push('output size was not measured');
  if (!Number.isFinite(media.duration) || media.duration <= 0) problems.push('output duration was not measured');
  if (media.audio === undefined) problems.push('audio stream was not measured');
  if (media.audio === null) problems.push('the delivered file has no audio track');
  // A film whose music outlasts its picture is a timing mistake, not a taste one.
  if (Number.isFinite(Number(media.audioDuration)) && Number(media.audioDuration) > 0) {
    problems.push(...mediaMismatch({ videoSeconds: media.duration, audioSeconds: media.audioDuration }).problems);
  }
  // A forced delivery is recorded as an override, not as a silent failure: the
  // person decided to ship with the gate closed, and the record must say so.
  if (input.gate && input.gate.ok !== true && input.gate.overridden !== true) problems.push('export gate was closed');

  return {
    version: 1,
    at: (input.now ?? new Date()).toISOString(),
    film: String(input.filmPath ?? ''),
    source: String(input.sourcePath ?? ''),
    output: String(input.outputPath ?? ''),
    ladder: Array.isArray(input.ladder) ? input.ladder : [],
    media: {
      width: Number(media.width ?? 0),
      height: Number(media.height ?? 0),
      fps: media.fps ?? null,
      duration: Number(media.duration ?? 0),
      video: String(media.video ?? ''),
      audio: media.audio === null ? null : String(media.audio ?? ''),
      channels: Number(media.channels ?? 0),
    },
    loudness,
    // What the picture was finished with. A receipt that does not say how the
    // film was graded cannot be used to compare two deliveries honestly.
    // The sound design travels with the picture, for the same reason: a receipt
    // that only says a loudness number cannot reproduce how the film feels.
    ...(input.score ? {
      score: {
        mood: String(input.score.mood ?? ''),
        bpm: Number(input.score.bpm ?? 0),
        groove: String(input.score.groove ?? ''),
        grid: Number(input.score.grid ?? 0),
        voices: Number(input.score.voices ?? 0),
        synth: String(input.score.synth ?? ''),
      },
    } : {}),
    // Which shots this version actually changed, compared with the last delivery.
    ...(Array.isArray(input.changes) && input.changes.length ? { changes: input.changes } : {}),
    ...(input.grade ? {
      grade: {
        preset: String(input.grade.preset ?? ''),
        grain: Number(input.grade.grain ?? 0),
        bloom: Number(input.grade.bloom ?? 0),
        vignette: Number(input.grade.vignette ?? 0),
        letterbox: Number(input.grade.letterbox ?? 0),
      },
    } : {}),
    gate: {
      ok: input.gate?.ok === true,
      blockers: input.gate?.blockers ?? [],
      // The override must survive into the record: the receipt has to be able
      // to say "delivered by force" instead of quietly looking like a pass.
      ...(input.gate?.overridden === true ? { overridden: true } : {}),
    },
    problems,
    ok: problems.length === 0,
  };
}

/**
 * Loudness acceptance: streaming delivery wants about -16 LUFS integrated and
 * a true peak under -1 dBTP. Reported, never silently "fixed".
 * @param {{ integrated: number|null, truePeak: number|null }} loudness
 * @param {number} [target] the loudness this piece should hit, from its length
 */
export function loudnessVerdict(loudness = {}, target = -16) {
  const problems = [];
  const integrated = Number(loudness.integrated);
  const truePeak = Number(loudness.truePeak);
  const wanted = Number.isFinite(Number(target)) ? Number(target) : -16;
  if (!Number.isFinite(integrated)) problems.push('integrated loudness was not measured');
  // The band is around the target for this length: a 15s piece is mastered at
  // -14, a 60s one at -16, and either is wrong measured against the other.
  else if (integrated < wanted - 8) problems.push(`mix is quiet (${integrated} LUFS); streaming normalisation will lift the noise floor`);
  else if (integrated > wanted + 7) problems.push(`mix is loud (${integrated} LUFS); it will be turned down and lose impact`);
  if (!Number.isFinite(truePeak)) problems.push('true peak was not measured');
  else if (truePeak > -1) problems.push(`true peak ${truePeak} dBTP will clip on lossy encode`);
  return { ok: problems.length === 0, problems };
}

/**
 * A human sign-off is only about the cut it was given for.
 *
 * Machine checks say the file is well-formed; they cannot say the film is good.
 * A delivery therefore needs a person's verdict, and that verdict expires the
 * moment the film is edited.
 * @param {{ signoff?: { by?: string, verdict?: string, note?: string, at?: string, filmMtimeMs?: number } | null, filmMtimeMs?: number }} state
 * @returns {{ status: 'missing'|'approved'|'rejected'|'stale', by: string, note: string, at: string }}
 */
export function signoffVerdict(state = {}) {
  const signoff = state.signoff;
  if (!signoff || !signoff.verdict) return { status: 'missing', by: '', note: '', at: '' };
  const recorded = Number(signoff.filmMtimeMs ?? 0);
  const current = Number(state.filmMtimeMs ?? 0);
  const by = String(signoff.by ?? '');
  const note = String(signoff.note ?? '');
  const at = String(signoff.at ?? '');
  if (recorded > 0 && current > 0 && Math.abs(current - recorded) >= 1) return { status: 'stale', by, note, at };
  if (signoff.verdict === 'approved') return { status: 'approved', by, note, at };
  return { status: 'rejected', by, note, at };
}

/**
 * A one-page receipt for a delivery: the kind of note a producer can read
 * without opening the project. It repeats only recorded facts.
 * @param {{
 *   record: object,
 *   review?: { total: number, approved: number, pending: number, changed: number } | null,
 *   acceptance?: { ok: boolean, fresh: boolean, checked: number } | null,
 *   plan?: { genre?: string, label?: string, seconds?: number, shots?: number, pacing?: string, transition?: string, moves?: string[], claims?: number } | null,
 *   problems?: string[],
 *   previous?: object | null,
 *   signoff?: { status: string, by: string, note: string, at: string } | null,
 * }} input
 */
export function deliveryReceipt(input = {}) {
  const record = input.record ?? {};
  const media = record.media ?? {};
  const loudness = record.loudness ?? {};
  const lines = [];
  lines.push(`# 交付回执 · ${record.output || '(未产出)'}`);
  lines.push('');
  lines.push(`- 时间：${record.at ?? '—'}`);
  if (input.plan?.label) lines.push(`- 类型：${input.plan.label}（${input.plan.genre ?? ''}）`);
  lines.push(`- 源片：${record.source || '—'}`);
  if (Array.isArray(record.changes) && record.changes.length) {
    // "Visible" means a shot really moved: pixels, composition or exposure.
    const visible = record.changes.filter((row) => (row.changedPercent ?? 0) >= 0.5
      || Math.abs(row.centroidShift ?? 0) >= 0.01
      || Math.abs((row.brightnessAfter ?? 0) - (row.brightnessBefore ?? 0)) >= 2);
    if (!visible.length) {
      lines.push('- 本版改动：逐镜对比无可见变化（重新交付而非重剪）');
    } else {
      const ranked = [...visible].sort((a, b) => (b.changedPercent ?? 0) - (a.changedPercent ?? 0));
      const describe = (row) => {
        const where = row.shot ? `${row.shot} ` : '';
        const pixels = row.changedPercent ?? 0;
        if (pixels >= 0.5) return `${where}${row.at}s（${pixels.toFixed(1)}% 画面变化）`;
        const shift = Math.abs(row.centroidShift ?? 0);
        if (shift >= 0.01) return `${where}${row.at}s（构图位移 ${(row.centroidShift ?? 0).toFixed(3)}）`;
        const before = row.brightnessBefore ?? 0;
        const after = row.brightnessAfter ?? 0;
        return `${where}${row.at}s（亮度 ${before} → ${after}）`;
      };
      lines.push(`- 本版改了哪些镜：${ranked.map(describe).join(' · ')}`);
    }
  }
  const design = input.plan ?? {};
  if (design.shots || design.pacing || design.transition) {
    const parts = [];
    if (design.shots) parts.push(`${design.shots} 个镜头`);
    if (design.pacing) parts.push({ accelerate: '渐快', decelerate: '渐慢', even: '匀速' }[design.pacing] ?? design.pacing);
    if (design.transition) parts.push(design.transition === 'presentation' ? '呈现式转场' : '遮罩式转场');
    if (Array.isArray(design.moves)) {
      const moving = design.moves.filter((move) => move && move !== 'still');
      parts.push(moving.length ? `运镜 ${moving.join('/')}` : '无运镜（纯排版）');
    }
    if (design.claims) parts.push(`${design.claims} 组主张-证据`);
    lines.push(`- 设计：${parts.join(' · ')}`);
  }
  lines.push(`- 处理链：${(record.ladder ?? []).join(' → ') || '—'}`);
  lines.push('');
  lines.push('## 规格（实测）');
  lines.push(`- 画面：${media.width}×${media.height}，${media.fps} fps，${media.duration}s`);
  if (record.score && record.score.mood) {
    const parts = [record.score.mood, `${record.score.bpm}bpm`];
    if (record.score.groove) parts.push(record.score.groove);
    if (record.score.grid) parts.push(`网格 ${record.score.grid}s`);
    if (record.score.voices) parts.push(`${record.score.voices} 个声部`);
    lines.push(`- 配乐：${parts.join(' · ')}${record.score.synth ? `（${record.score.synth}）` : ''}`);
  }
  if (record.grade && record.grade.preset) {
    lines.push(`- 调色：${record.grade.preset}（颗粒 ${record.grade.grain} · 光晕 ${record.grade.bloom} · 暗角 ${record.grade.vignette}${record.grade.letterbox ? ` · 黑边 ${(record.grade.letterbox * 100).toFixed(1)}%` : ''}）`);
  }
  lines.push(`- 编码：${media.video || '—'} / ${media.audio ?? '无音轨'}${media.channels ? `（${media.channels}ch${media.sampleRate ? ` · ${Math.round(Number(media.sampleRate) / 1000)}kHz` : ''}）` : ''}`);
  lines.push(`- 响度：${loudness.integrated ?? '—'} LUFS，峰值 ${loudness.truePeak ?? '—'} dBTP，LRA ${loudness.lra ?? '—'}${input.loudnessTarget ? `（目标 ${input.loudnessTarget} LUFS）` : ''}`);
  if (input.loudnessNote) lines.push(`  · ${input.loudnessNote}`);
  lines.push('');
  lines.push('## 门禁');
  lines.push(`- 导出闸门：${record.gate?.ok ? '已通过' : '未通过'}${record.gate?.overridden ? '（强制越过）' : ''}`);
  for (const blocker of record.gate?.blockers ?? []) lines.push(`  - ${blocker}`);
  if (input.review) {
    lines.push(`- 逐镜审看：${input.review.approved}/${input.review.total} 已批准${input.review.pending ? `，${input.review.pending} 待审` : ''}${input.review.changed ? `，${input.review.changed} 待改` : ''}`);
  }
  if (input.acceptance) {
    lines.push(`- 像素验收：${input.acceptance.ok ? '通过' : '未通过'}${input.acceptance.fresh ? '（当前版本）' : '（已过期）'}，抽检 ${input.acceptance.checked ?? 0} 帧${input.acceptance.contactSheet ? `，联系表 ${input.acceptance.contactSheet}` : ''}`);
  }
  const problems = input.problems ?? record.problems ?? [];
  const gateOk = record.gate?.ok === true;
  const overridden = record.gate?.overridden === true;
  // A closed gate is work left to do, not a footnote: it belongs in the same
  // list as the measured problems, and it decides the verdict.
  const todo = [
    ...problems,
    ...(gateOk ? [] : (record.gate?.blockers ?? []).map((blocker) => `门禁：${blocker}`)),
    ...(overridden ? ['本次为强制越过门禁的交付，发布前需人工确认'] : []),
  ];
  lines.push('');
  lines.push('## 待办');
  if (todo.length === 0) lines.push('- 无');
  else for (const item of todo) lines.push(`- ${item}`);
  const actions = nextActions(record, input);
  if (actions.length) {
    lines.push('');
    lines.push('## 下一步');
    for (const action of actions) lines.push(`- \`${action.command}\` — ${action.why}`);
  }
  if (input.previous) {
    const comparison = compareDelivery(input.previous, record);
    lines.push('');
    lines.push('## 与上次交付相比');
    lines.push(`- 判定：${comparison.verdict}`);
    for (const change of comparison.changes) lines.push(`  - ${change}`);
  }
  const signoff = input.signoff ?? null;
  const signoffStatus = signoff?.status ?? 'missing';
  lines.push('');
  lines.push('## 人工签收');
  if (signoffStatus === 'missing') lines.push('- 尚未签收（机器指标通过不等于片子好看）');
  else if (signoffStatus === 'approved') lines.push(`- 已批准：${signoff.by || '未署名'}${signoff.at ? ` · ${signoff.at}` : ''}${signoff.note ? ` — ${signoff.note}` : ''}`);
  else if (signoffStatus === 'rejected') lines.push(`- 已否决：${signoff.by || '未署名'}${signoff.note ? ` — ${signoff.note}` : ''}`);
  else lines.push(`- 签收已过期（影片在上次签收后被修改）${signoff.by ? `：${signoff.by}` : ''}`);

  lines.push('');
  const verdict = !record.ok
    ? '不可交付'
    : !gateOk
      ? (overridden
        ? `已强制交付（门禁未通过${signoffStatus === 'approved' ? `；已签收${signoff.by ? `：${signoff.by}` : ''}` : ''}，需人工确认）`
        : '不可交付')
      : signoffStatus === 'approved'
        ? `可交付（已签收${signoff.by ? `：${signoff.by}` : ''}）`
        : signoffStatus === 'rejected'
          ? '不可交付（人工否决）'
          : signoffStatus === 'stale'
            ? '不可交付（签收已过期，影片已修改）'
            : '机器通过，待人工签收';
  lines.push(`结论：${verdict}`);
  return lines.join('\n');
}

/**
 * What to run next, derived from the recorded state. A to-do list is only
 * useful if each line can be executed, so every entry names the tool.
 * @param {object} record
 * @param {{ review?: object|null, acceptance?: object|null }} input
 */
export function nextActions(record = {}, input = {}) {
  const actions = [];
  const blockers = record.gate?.blockers ?? [];
  const text = blockers.join(' ');
  if (blockers.length === 0) return actions;

  if (/shot review incomplete/i.test(text)) {
    actions.push({ command: 'mise_review action="status"', why: '先看哪几镜还没批准' });
    actions.push({ command: 'mise_review action="approve" shot="<id>"', why: '逐镜批准，或 reject 并写明要改什么' });
  }
  if (/frames were never accepted|acceptance is stale/i.test(text)) {
    actions.push({ command: 'mise_verify', why: '在批过的镜头上重新抽帧验收' });
  }
  if (/no production plan/i.test(text)) {
    actions.push({ command: 'mise_plan genre="<类型>" seconds=<秒>', why: '给这支片一个类型配方与镜头表' });
  }
  if (actions.length === 0) {
    actions.push({ command: 'mise_verify action="gate"', why: '查看完整门禁明细' });
  }
  return actions;
}

/**
 * Compare a delivery with the previous one, on measurable fields only.
 * @param {object|null} previous
 * @param {object} current
 */
export function compareDelivery(previous, current = {}) {
  if (!previous || typeof previous !== 'object') return { verdict: '首次交付', changes: [] };
  const changes = [];
  let score = 0;

  const prevGate = previous.gate?.ok === true;
  const nowGate = current.gate?.ok === true;
  if (prevGate !== nowGate) {
    changes.push(nowGate ? '门禁：由未通过变为通过' : '门禁：由通过变为未通过');
    score += nowGate ? 2 : -2;
  }

  const prevProblems = (previous.problems ?? []).length;
  const nowProblems = (current.problems ?? []).length;
  if (nowProblems !== prevProblems) {
    changes.push(`问题数：${prevProblems} → ${nowProblems}`);
    score += nowProblems < prevProblems ? 1 : -1;
  }

  const prevFps = Number(previous.media?.fps ?? 0);
  const nowFps = Number(current.media?.fps ?? 0);
  if (prevFps && nowFps && prevFps !== nowFps) {
    changes.push(`帧率：${prevFps} → ${nowFps} fps`);
    score += nowFps > prevFps ? 1 : -1;
  }

  const prevLoud = Number(previous.loudness?.integrated ?? NaN);
  const nowLoud = Number(current.loudness?.integrated ?? NaN);
  if (Number.isFinite(prevLoud) && Number.isFinite(nowLoud) && Math.abs(prevLoud - nowLoud) > 0.3) {
    const target = Number.isFinite(Number(current.loudnessTarget)) ? Number(current.loudnessTarget) : -16;
    const prevDistance = Math.abs(prevLoud - target);
    const nowDistance = Math.abs(nowLoud - target);
    changes.push(`响度：${prevLoud} → ${nowLoud} LUFS（目标 ${target}）`);
    score += nowDistance < prevDistance ? 1 : -1;
  }

  const verdict = score > 0 ? '进步' : score < 0 ? '退步' : '持平';
  if (changes.length === 0) changes.push('关键指标没有变化');
  return { verdict, changes, score };
}
