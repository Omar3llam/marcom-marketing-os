// ============================================================
// LUMI design tokens — resolver and rule checker (Phase 2)
// ------------------------------------------------------------
// The ONE current token authority is `tokens/*.json` next to this file.
// This module reads it, resolves every reference and derivation to a
// concrete value, and returns every broken rule as an error string. It
// never repairs anything: a token system that quietly fixes itself is a
// token system nobody can reason about.
//
// Layers (DESIGN_TOKEN_ARCHITECTURE.md §2):
//
//   brand      literal identity values               references nothing
//   primitive  raw scales; derived neutral steps      brand NEUTRALS and brand fonts only
//   semantic   named jobs, resolved per ground       primitive only (+ one declared exception)
//   component  Phase 3; empty now                    semantic only
//
// No dependency: the stack already has everything this needs.
// ============================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Under vitest's jsdom environment `import.meta.url` is not a file: URL, so
// fileURLToPath throws; the pathname form is the same fallback
// client/scripts/checkTokenResolution.js relies on.
export function localDir(relative, base = import.meta.url) {
  const url = new URL(relative, base);
  try { return fileURLToPath(url); } catch { return decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, '$1'); }
}

export const TOKEN_DIR = localDir('./tokens/');
export const LAYERS = ['brand', 'primitive', 'semantic', 'component'];
export const GROUNDS = ['charcoal', 'offWhite'];

/** The only semantic token allowed to reach the brand layer: gold's attention job. */
export const ATTENTION_EXCEPTION = { from: 'color.signal.attention', to: 'brand.color.gold' };

const SEMANTIC_ROOTS = ['color', 'type', 'space', 'size', 'border', 'radius', 'shadow', 'motion', 'layer', 'layout'];
const TYPES = ['color', 'fontFamily', 'dimension', 'fontWeight', 'fontVariantNumeric', 'duration', 'cubicBezier', 'number', 'shadow'];
const BRAND_NEUTRALS = ['brand.color.charcoal', 'brand.color.offWhite', 'brand.color.warmGray'];
const VERDICT_PRIMITIVES = ['kill', 'hold', 'scale', 'watch', 'refresh', 'reallocate'].map((v) => `primitive.color.${v}`);
const GENERIC_FAMILIES = ['system-ui', 'sans-serif', 'serif', 'monospace', 'ui-monospace', 'ui-sans-serif'];

// Hue and effect names invite a token to converge with a stock framework palette or a
// forbidden aesthetic, so they are banned from every semantic path. Ordinal and
// generic-status names become "whatever is important" (DESIGN_TOKEN_ARCHITECTURE.md §4.4),
// so they are banned from colour paths — except a locked state name in its own slot,
// `color.state.<state>`: SUCCESS is a published state (STATE_RULES.md §11), not a tone.
const FORBIDDEN_HUE = /^(red|orange|amber|yellow|green|teal|cyan|blue|indigo|purple|violet|pink|gr[ae]y|gold|white|black|glow|gradient|glass|neon)$/i;
const FORBIDDEN_COLOUR_NAME = /^(primary|secondary|tertiary|accent|success|danger|warning|info|error)$/i;
const SEGMENT = /^([a-z][a-zA-Z0-9]*|[0-9]+)$/;
const REF = /^\{([^{}]+)\}$/;

// ── JSON with duplicate-key detection ────────────────────────
// JSON.parse keeps the LAST of two equal keys and says nothing, which is exactly
// how two definitions of one token would hide. So the text is scanned first.
export function duplicateKeys(text) {
  const dupes = [];
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const str = text.slice(i + 1, j);
      let k = j + 1;
      while (/\s/.test(text[k])) k++;
      const top = stack[stack.length - 1];
      if (text[k] === ':' && top) {
        if (top.has(str)) dupes.push(str);
        top.add(str);
      }
      i = j;
    } else if (ch === '{') stack.push(new Set());
    else if (ch === '[') stack.push(null);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  return dupes;
}

export function loadSources(dir = TOKEN_DIR) {
  const errors = [];
  const sources = {};
  for (const layer of LAYERS) {
    const text = readFileSync(join(dir, `${layer}.json`), 'utf8');
    for (const d of duplicateKeys(text)) errors.push(`${layer}.json: duplicate key "${d}"`);
    const json = JSON.parse(text);
    if (json.$layer !== layer) errors.push(`${layer}.json: $layer is "${json.$layer}", expected "${layer}"`);
    sources[layer] = json;
  }
  return { sources, errors };
}

// ── colour arithmetic (WCAG 2.2 relative luminance) ──────────
const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const linear = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

export function luminance(hex) {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ── collection ───────────────────────────────────────────────
function collect(node, path, layer, out, errors) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    const p = path ? `${path}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value) && '$value' in value) {
      out.set(p, { path: p, layer, def: value });
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      collect(value, p, layer, out, errors);
    } else {
      errors.push(`${p}: neither a token (no $value) nor a group`);
    }
  }
}

export const cssVar = (path) => `--lumi-${path.split('.').map((s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()).join('-')}`;

const refsIn = (value) => {
  if (typeof value === 'string') { const m = value.match(REF); return m ? [m[1]] : []; }
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(refsIn);
  return [];
};

// ── resolution ───────────────────────────────────────────────
export function resolveTokens(dir = TOKEN_DIR) {
  const { sources, errors } = loadSources(dir);
  const tokens = new Map();
  for (const layer of LAYERS) collect(sources[layer], '', layer, tokens, errors);

  const resolved = new Map();
  const resolving = new Set();

  function scalar(value, from) {
    if (value === null) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const m = value.match(REF);
      if (!m) {
        if (value.includes('{')) errors.push(`${from}: malformed reference "${value}"`);
        return value;
      }
      const target = resolve(m[1], from);
      if (target && typeof target.value === 'object' && target.value !== null) {
        errors.push(`${from}: references ground-resolved token ${m[1]}; only invariant tokens may be referenced`);
        return null;
      }
      return target ? target.value : null;
    }
    if (typeof value === 'object' && '$mix' in value) {
      const color = scalar(value.$mix, from);
      const alpha = value.$alpha;
      if (typeof alpha !== 'number' || alpha < 0 || alpha > 1) errors.push(`${from}: $alpha must be within [0, 1]`);
      if (value.$translucent) {
        const [r, g, b] = channels(color);
        return `rgb(${r} ${g} ${b} / ${alpha})`;
      }
      const over = scalar(value.$over, from);
      const [c, o] = [channels(color), channels(over)];
      return toHex(c.map((v, i) => v * alpha + o[i] * (1 - alpha)));
    }
    if (typeof value === 'object' && '$stack' in value) {
      return value.$stack
        .map((part) => scalar(part, from))
        .map((f) => (GENERIC_FAMILIES.includes(f) ? f : `"${f}"`))
        .join(', ');
    }
    if (typeof value === 'object' && '$sum' in value) {
      const px = value.$sum.map((part) => scalar(part, from)).map((d) => {
        if (!/^\d+px$/.test(d)) errors.push(`${from}: $sum part "${d}" is not a px dimension`);
        return parseInt(d, 10);
      });
      return `${px.reduce((a, b) => a + b, 0)}px`;
    }
    if (typeof value === 'object' && '$shadow' in value) {
      const s = value.$shadow;
      return ['x', 'y', 'blur', 'spread', 'color'].map((k) => scalar(s[k], from)).join(' ');
    }
    errors.push(`${from}: unsupported value ${JSON.stringify(value)}`);
    return null;
  }

  function resolve(path, from) {
    if (resolved.has(path)) return resolved.get(path);
    const token = tokens.get(path);
    if (!token) { errors.push(`${from}: references missing token ${path}`); return null; }
    if (resolving.has(path)) { errors.push(`${path}: circular reference`); return null; }
    resolving.add(path);

    const { def, layer } = token;
    const raw = def.$value;
    const isGrounded = raw && typeof raw === 'object' && GROUNDS.some((g) => g in raw);
    let value;
    if (isGrounded) {
      const keys = Object.keys(raw).sort();
      if (keys.join() !== [...GROUNDS].sort().join()) errors.push(`${path}: a ground-resolved value must declare exactly ${GROUNDS.join(' and ')}`);
      value = Object.fromEntries(GROUNDS.map((g) => [g, scalar(raw[g], path)]));
    } else {
      value = scalar(raw, path);
    }
    const references = [...new Set([...refsIn(raw), ...refsIn(def.$reduced)])];
    const out = {
      path,
      layer,
      type: def.$type,
      value,
      reduced: def.$reduced === undefined ? undefined : scalar(def.$reduced, path),
      status: def.$status,
      description: def.$description,
      references,
    };
    resolving.delete(path);
    resolved.set(path, out);
    return out;
  }

  for (const path of tokens.keys()) resolve(path, path);

  // Transitive reference chains, for the "never reaches brand" rules.
  const chainOf = (path, seen = new Set()) => {
    for (const r of resolved.get(path)?.references ?? []) {
      if (!seen.has(r)) { seen.add(r); chainOf(r, seen); }
    }
    return seen;
  };
  for (const t of resolved.values()) t.chain = [...chainOf(t.path)].sort();

  return { sources, tokens: resolved, errors };
}

// ── rules ────────────────────────────────────────────────────
export function validate(result) {
  const { sources, tokens } = result;
  const errors = [...result.errors];
  const semantic = sources.semantic;

  for (const t of tokens.values()) {
    const segments = t.path.split('.');
    if (!TYPES.includes(t.type)) errors.push(`${t.path}: unknown $type "${t.type}"`);
    for (const s of segments) if (!SEGMENT.test(s)) errors.push(`${t.path}: segment "${s}" is not camelCase or numeric`);

    if (t.layer !== 'semantic' && segments[0] !== t.layer) errors.push(`${t.path}: a ${t.layer} token must live under "${t.layer}."`);
    if (t.layer === 'semantic' && !SEMANTIC_ROOTS.includes(segments[0])) errors.push(`${t.path}: unknown semantic root "${segments[0]}"`);
    if (t.layer === 'semantic' || t.layer === 'component') {
      const stateNames = Object.keys(result.sources.semantic.$states);
      segments.forEach((s, i) => {
        if (FORBIDDEN_HUE.test(s)) errors.push(`${t.path}: "${s}" is a hue or effect name`);
        const lockedStateSlot = segments[0] === 'color' && segments[1] === 'state' && i === 2 && stateNames.includes(s);
        if (t.type === 'color' && FORBIDDEN_COLOUR_NAME.test(s) && !lockedStateSlot) errors.push(`${t.path}: "${s}" is an ordinal or generic-status colour name`);
      });
    }
    if (t.reduced !== undefined && !/^motion\.(duration|distance)\./.test(t.path)) errors.push(`${t.path}: $reduced is only for motion durations and distances`);
    if (/^motion\.(duration|distance)\./.test(t.path) && t.reduced === undefined) errors.push(`${t.path}: motion token has no declared reduced-motion value`);

    for (const r of t.references) {
      const target = tokens.get(r);
      if (!target) continue;
      if (t.layer === 'brand') errors.push(`${t.path}: brand tokens are literal and reference nothing (found ${r})`);
      if (t.layer === 'primitive') {
        const ok = BRAND_NEUTRALS.includes(r) || r.startsWith('brand.font.');
        if (!ok) errors.push(`${t.path}: a primitive may reference only brand neutrals or brand fonts (found ${r})`);
        if (VERDICT_PRIMITIVES.includes(t.path)) errors.push(`${t.path}: verdict primitives are literal (found ${r})`);
      }
      if (t.layer === 'semantic' && target.layer !== 'primitive') {
        const excepted = t.path === ATTENTION_EXCEPTION.from && r === ATTENTION_EXCEPTION.to;
        if (!excepted) errors.push(`${t.path}: a semantic token may reference only primitive tokens (found ${r})`);
      }
      if (t.layer === 'component' && target.layer !== 'semantic') errors.push(`${t.path}: a component token may reference only semantic tokens (found ${r})`);
    }
  }

  // Every primitive must do a job; an unused primitive is a ghost waiting to be misused.
  const used = new Set([...tokens.values()].filter((t) => t.layer === 'semantic').flatMap((t) => t.chain));
  for (const t of tokens.values()) {
    if (t.layer === 'primitive' && !used.has(t.path)) errors.push(`${t.path}: primitive referenced by no semantic token`);
  }

  // CSS variable names must be unique, or two tokens would silently overwrite one another.
  const vars = new Map();
  for (const t of emitted(tokens)) {
    const v = cssVar(t.path);
    if (vars.has(v)) errors.push(`${t.path}: CSS variable ${v} collides with ${vars.get(v)}`);
    vars.set(v, t.path);
  }

  // Environments.
  for (const [name, env] of Object.entries(semantic.$environments)) {
    if (name.startsWith('$')) continue;
    if (!GROUNDS.includes(env.ground)) errors.push(`environment ${name}: unknown ground "${env.ground}"`);
    if (env.selector !== `[data-lumi-env="${name}"]`) errors.push(`environment ${name}: selector must be [data-lumi-env="${name}"]`);
  }

  // State registry.
  for (const [state, entry] of Object.entries(semantic.$states)) {
    if (state.startsWith('$')) continue;
    if (!['value', 'absence', 'claim', 'interaction'].includes(entry.illumination)) errors.push(`state ${state}: unknown illumination "${entry.illumination}"`);
    for (const p of entry.tokens) if (!tokens.has(p)) errors.push(`state ${state}: token ${p} does not exist`);
  }

  // Contrast manifest.
  const inPair = new Set();
  const results = [];
  for (const pair of semantic.$contrast.pairs) {
    for (const fg of pair.foreground) {
      for (const bg of pair.background) {
        inPair.add(fg); inPair.add(bg);
        for (const ground of pair.grounds) {
          const f = tokens.get(fg)?.value?.[ground];
          const b = tokens.get(bg)?.value?.[ground];
          if (!f || !b) { errors.push(`contrast ${fg} on ${bg} (${ground}): a token has no value on this ground`); continue; }
          const ratio = Math.round(contrast(f, b) * 100) / 100;
          const pass = ratio >= pair.minimum;
          results.push({ foreground: fg, background: bg, ground, ratio, minimum: pair.minimum, criterion: pair.criterion, pass });
          if (!pass) errors.push(`contrast ${fg} on ${bg} (${ground}): ${ratio} < ${pair.minimum}`);
        }
      }
    }
  }
  for (const t of tokens.values()) {
    if (t.layer !== 'semantic' || t.type !== 'color' || t.path.startsWith('shadow.')) continue;
    const exempt = t.path in semantic.$contrast.exempt;
    if (!inPair.has(t.path) && !exempt) errors.push(`${t.path}: colour token is in no contrast pair and not declared exempt`);
    if (inPair.has(t.path) && exempt) errors.push(`${t.path}: declared exempt but also verified in a pair`);
  }
  for (const p of Object.keys(semantic.$contrast.exempt)) if (!tokens.has(p)) errors.push(`contrast exempt: ${p} does not exist`);

  // Easing: no overshoot, no anticipation.
  for (const t of tokens.values()) {
    if (t.type !== 'cubicBezier' || t.value === 'linear') continue;
    const m = String(t.value).match(/^cubic-bezier\(([^)]+)\)$/);
    const n = m ? m[1].split(',').map(Number) : [];
    if (n.length !== 4 || n.some(Number.isNaN)) errors.push(`${t.path}: not a cubic-bezier`);
    else if ([n[1], n[3]].some((y) => y < 0 || y > 1) || [n[0], n[2]].some((x) => x < 0 || x > 1)) errors.push(`${t.path}: control point outside [0, 1] (overshoot or anticipation)`);
  }

  return { ...result, errors, contrast: results };
}

/** Tokens that become CSS variables: semantic and component, never provisional. */
export function emitted(tokens) {
  return [...tokens.values()]
    .filter((t) => (t.layer === 'semantic' || t.layer === 'component') && t.status !== 'provisional')
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function build(dir = TOKEN_DIR) {
  return validate(resolveTokens(dir));
}
