/**
 * A claim and its proof, kept together.
 *
 * The rule a good explainer follows is "one claim at a time, with its evidence
 * on screen". A film can break it silently: a chart appears that proves nothing,
 * a number appears with no source. This module makes the pairing a data
 * structure, so a missing proof is a checkable failure rather than a matter of
 * taste.
 *
 * @module mise-film-claims
 */

export const CLAIM_KINDS = ['number', 'chart', 'quote', 'source'];

/**
 * The number a sentence actually states, if it states one.
 *
 * "便宜 40 倍" is a claim of 40; "2 毫秒" is a claim of 2. Without this the
 * evidence and the sentence are never compared, and a chart of 12 stands in for
 * a claim of 40.
 * @param {string} text
 * @returns {number|null}
 */
export function claimNumber(text) {
  const match = String(text ?? '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * @param {{ text?: string, evidence?: { kind?: string, value?: number, unit?: string, items?: Array<{label: string, value: number}>, source?: string, who?: string } }} claim
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function validateClaim(claim = {}) {
  const problems = [];
  // Two characters is a real claim in Chinese ("他说"); one is a placeholder.
  if (typeof claim.text !== 'string' || claim.text.trim().length < 2) problems.push('a claim needs a sentence');
  const evidence = claim.evidence;
  if (!evidence || typeof evidence !== 'object') {
    problems.push(`claim "${String(claim.text ?? '').slice(0, 24)}" has no evidence`);
    return { ok: false, problems };
  }
  if (!CLAIM_KINDS.includes(evidence.kind)) problems.push(`evidence kind must be one of ${CLAIM_KINDS.join(', ')}`);
  if (evidence.kind === 'number') {
    if (!Number.isFinite(evidence.value)) problems.push('a number claim needs a value');
    if (typeof evidence.unit !== 'string' || !evidence.unit) problems.push('a number claim needs a unit (%, ×, s, …)');
  }
  if (evidence.kind === 'chart') {
    const items = Array.isArray(evidence.items) ? evidence.items : [];
    if (items.length < 2) problems.push('a chart needs at least two bars to compare');
    for (const [index, item] of items.entries()) {
      if (typeof item?.label !== 'string' || !item.label) problems.push(`chart bar ${index + 1} has no label`);
      if (!Number.isFinite(item?.value)) problems.push(`chart bar ${index + 1} has no numeric value`);
    }
  }
  if (evidence.kind === 'quote') {
    if (typeof evidence.who !== 'string' || !evidence.who) problems.push('a quote needs to say who said it');
  }
  if (evidence.kind === 'source') {
    if (typeof evidence.source !== 'string' || !evidence.source) problems.push('a source claim needs where it came from');
  }

  // The sentence and the evidence must agree on the number. A chart of 12 does
  // not prove a claim of 40, whatever the bars are labelled.
  const stated = claimNumber(claim.text);
  if (Number.isFinite(stated)) {
    if (evidence.kind === 'number' && Number.isFinite(evidence.value)) {
      if (Math.abs(evidence.value - stated) > Math.max(0.01, Math.abs(stated) * 0.02)) {
        problems.push(`the sentence says ${stated} but the evidence value is ${evidence.value}`);
      }
    }
    if (evidence.kind === 'chart') {
      const values = (Array.isArray(evidence.items) ? evidence.items : []).map((item) => Number(item?.value));
      const close = values.some((value) => Number.isFinite(value) && Math.abs(value - stated) <= Math.max(0.01, Math.abs(stated) * 0.02));
      if (!close) problems.push(`the sentence says ${stated} but no bar in the chart is that value (max ${Math.max(...values.filter(Number.isFinite))})`);
    }
    if (evidence.kind === 'source' && evidence.value !== undefined && Number.isFinite(evidence.value)) {
      if (Math.abs(evidence.value - stated) > Math.max(0.01, Math.abs(stated) * 0.02)) {
        problems.push(`the sentence says ${stated} but the source records ${evidence.value}`);
      }
    }
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Pair claims with the beats that will show them.
 *
 * Only the beats that can carry proof (graphics) are paired. A film that states
 * a claim on a title card with nothing on screen has not shown it.
 * @param {Array<{ index: number, kind: string }>} beats
 * @param {Array<object>} claims
 */
export function pairClaims(beats, claims) {
  const list = Array.isArray(claims) ? claims : [];
  const problems = [];
  list.forEach((claim, index) => {
    const verdict = validateClaim(claim);
    if (!verdict.ok) problems.push(`claim ${index + 1}: ${verdict.problems.join('; ')}`);
  });

  const carriers = (Array.isArray(beats) ? beats : []).filter((beat) => beat.kind === 'graphics');
  if (list.length > carriers.length) {
    problems.push(`${list.length} claims but only ${carriers.length} scene(s) that can show evidence`);
  }

  const assignments = list.slice(0, carriers.length).map((claim, index) => ({
    beat: carriers[index].index,
    at: carriers[index].at,
    claim: claim.text,
    kind: claim.evidence?.kind ?? '',
    evidence: claim.evidence ?? null,
  }));

  const unproven = carriers.slice(list.length).map((beat) => beat.index);
  return { ok: problems.length === 0, problems, assignments, unproven };
}

/**
 * Does the evidence actually contain the number the claim states? A chart that
 * does not include the claimed value is decoration standing in for proof.
 * @param {{ text?: string, evidence?: { kind?: string, value?: number, items?: Array<{ value: number }> } }} claim
 * @param {number} [tolerance]
 */
export function evidenceSupports(claim, tolerance = 0.01) {
  const evidence = claim?.evidence ?? {};
  if (evidence.kind === 'number') return Number.isFinite(evidence.value);
  if (evidence.kind === 'chart') {
    const claimed = Number(claim?.value ?? claim?.evidence?.value);
    if (!Number.isFinite(claimed)) return true; // a chart with no stated number proves a shape, not a figure
    const values = (Array.isArray(evidence.items) ? evidence.items : []).map((item) => Number(item.value));
    return values.some((value) => Math.abs(value - claimed) <= tolerance);
  }
  return true;
}
