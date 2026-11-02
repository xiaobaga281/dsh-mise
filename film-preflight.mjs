/**
 * The export gate: two gates, one answer.
 *
 * A film can fail in two different ways, and both have to be closed before an
 * export means anything:
 *  - the *look*: every shot's keyframe was actually looked at and approved
 *    (the review gate);
 *  - the *pixels*: the frames that render contain the content, inside the safe
 *    area, on the current cut of the film (the acceptance gate).
 *
 * Neither substitutes for the other: approved shots can still render blank, and
 * a passing pixel check says nothing about whether the shot is right. This
 * module joins them into one verdict with explicit blockers, so a render step
 * can refuse for a reason a person can act on.
 *
 * @module openfilm-film-preflight
 */

/**
 * @param {{
 *   review?: { total: number, approved: number, pending: number, changed: number, readyToRender: boolean } | null,
 *   acceptance?: { ok: boolean, fresh: boolean, at?: string, problems?: string[], checked?: number } | null,
 *   hasPlan?: boolean,
 * }} state
 * @returns {{ ok: boolean, blockers: string[], warnings: string[], checks: Array<{ id: string, ok: boolean, detail: string }> }}
 */
export function preflight(state = {}) {
  const blockers = [];
  const warnings = [];
  const checks = [];

  // reviewStatus() reports { counts: {...}, readyToRender }; a caller may also
  // pass the flat shape. Normalise once so neither can be misread as "absent".
  const raw = state.review ?? null;
  const counts = raw?.counts ?? raw ?? null;
  const review = counts
    ? {
      total: Number(counts.total ?? 0),
      approved: Number(counts.approved ?? 0),
      pending: Number(counts.pending ?? 0),
      changed: Number(counts.changed ?? 0),
      readyToRender: raw?.readyToRender === true || (Number(counts.total ?? 0) > 0 && Number(counts.approved ?? 0) === Number(counts.total ?? 0)),
    }
    : null;

  if (!review || !Number.isFinite(review.total) || review.total === 0) {
    warnings.push('no shot review recorded: mise_review keyframes + approve before exporting');
    checks.push({ id: 'review', ok: false, detail: 'not recorded' });
  } else if (review.readyToRender === true) {
    checks.push({ id: 'review', ok: true, detail: `${review.approved}/${review.total} shots approved` });
  } else {
    const parts = [];
    if (review.pending) parts.push(`${review.pending} pending`);
    if (review.changed) parts.push(`${review.changed} marked changed`);
    blockers.push(`shot review incomplete: ${parts.join(', ') || 'not ready'} (${review.approved}/${review.total} approved)`);
    checks.push({ id: 'review', ok: false, detail: parts.join(', ') });
  }

  const acceptance = state.acceptance ?? null;
  if (!acceptance) {
    blockers.push('frames were never accepted: run mise_verify on the current cut');
    checks.push({ id: 'acceptance', ok: false, detail: 'not recorded' });
  } else if (acceptance.ok !== true) {
    blockers.push(`frame acceptance failed${acceptance.at ? ` at ${acceptance.at}` : ''}: ${(acceptance.problems?.[0] ?? 'see .film/verify.json').slice(0, 140)}`);
    checks.push({ id: 'acceptance', ok: false, detail: 'failed' });
  } else if (acceptance.fresh !== true) {
    blockers.push('frame acceptance is stale: the film changed since it was checked');
    checks.push({ id: 'acceptance', ok: false, detail: 'stale' });
  } else {
    checks.push({ id: 'acceptance', ok: true, detail: `${acceptance.checked ?? 0} frame(s) checked on the current cut` });
  }

  if (state.hasPlan !== true) {
    warnings.push('no production plan: mise_plan gives the film a genre, shot lengths and an ending');
  }

  // A stated claim with no proof is not a style question: it ships a film that
  // asserts something it never shows.
  const claims = state.claims ?? null;
  if (claims) {
    const problems = Array.isArray(claims.problems) ? claims.problems : [];
    const unproven = Array.isArray(claims.unproven) ? claims.unproven : [];
    if (problems.length || unproven.length) {
      for (const problem of problems) blockers.push(`claim without proof: ${problem}`);
      if (unproven.length) blockers.push(`shot(s) ${unproven.join(', ')} can show evidence but were given no claim`);
      checks.push({ id: 'claims', ok: false, detail: `${problems.length} problem(s), ${unproven.length} unpaired` });
    } else if (Array.isArray(claims.assignments) && claims.assignments.length) {
      checks.push({ id: 'claims', ok: true, detail: `${claims.assignments.length} claim(s) paired with their proof shot` });
    }
  }

  return { ok: blockers.length === 0, blockers, warnings, checks };
}
