// ============================================================
// FE-01 — every colour class written in source must RESOLVE
// ------------------------------------------------------------
// `no-generic-tailwind` is a DENYLIST: it bans nine named hues, raw hex and
// three type utilities. A denylist is structurally incapable of catching the
// defect that actually shipped — a class that is not banned and does not exist.
//
// Measured on a30c912: EIGHT undefined tokens across NINETY call sites, every
// one of them in a file the linter reads, every one passing `lint:ci`:
//
//     bg-lumi-accent-soft · text-signal-{success,warning,danger}
//     text-text-{primary,secondary,muted,subtle}
//
// They render nothing, and have since the day they were written.
//
// ── WHY THE COMPILED CSS, AND NOT A TOKEN REGISTRY ──────────────────────────
// A registry check has to re-implement Tailwind: defaults, variants, opacity
// modifiers, arbitrary values. Every one of those is a chance to be wrong in a
// direction that produces false positives, and a checker that cries wolf gets
// switched off. The compiled stylesheet already IS the answer — Tailwind emits
// a rule for every class it recognised. So the question this asks is exactly
// the one that matters:
//
//     for each colour class in the source, did Tailwind emit a rule for it?
//
// `p-[18px]`, `hover:bg-lumi-accent`, `bg-lumi-accent/30` all pass, because
// Tailwind really does emit them. Only a class it did not recognise fails.
//
// Requires a build first — it reads `dist/assets/*.css`.
// ============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist', 'assets');

// Only colour-bearing utilities. Spacing and layout mistakes are visible the
// moment anyone looks at the page; a missing COLOUR is invisible, because the
// element simply inherits — which is why this defect survived 90 sites.
const COLOUR_PREFIX = /^(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline|placeholder|caret|accent|decoration|shadow)-/;

// A token that cannot be resolved statically. `text-${tone}` is a runtime
// decision; this checker has no opinion on it and says so by skipping.
const DYNAMIC = /\$\{|^\W|\*/;

/** Strip comments so a class NAMED in prose is not read as a class USED. */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * Every class selector the stylesheet actually defines, unescaped.
 *
 * `.` and `}` MUST terminate a match. Minified CSS runs declarations together,
 * so a decimal value is a false start: in `letter-spacing:-.01em}.text-xs{`
 * the regex begins at the `.` of `.01em`, and if `}` and `.` are allowed to
 * continue the match it captures `01em}.text-xs` as ONE selector — silently
 * swallowing the real class that follows. That produced 130 false positives on
 * `text-xs` before the control caught it. An escaped `\.` is still consumed by
 * the `\\.` branch, which is the only way a dot legitimately appears in a class.
 */
export function selectorsInCss(css) {
  const out = new Set();
  for (const m of css.matchAll(/\.((?:\\.|[^\s,{}>+~()[\]:;'".])+)/g)) {
    out.add(m[1].replace(/\\(.)/g, '$1'));
  }
  return out;
}

/** Candidate colour classes in a source file, comments removed. */
export function colourClassesIn(code) {
  const found = new Map(); // class -> first line
  const clean = stripComments(code);
  const lines = clean.split('\n');
  lines.forEach((line, i) => {
    // `=` and `&` are part of arbitrary VARIANTS — `data-[active=true]:bg-x`,
    // `[&_svg]:text-y`. Excluding them splits the token mid-variant and leaves
    // a fragment like `true]:bg-lumi-gold/5`, which looks exactly like an
    // undefined class and is not one. Four such phantoms appeared before this.
    for (const m of line.matchAll(/[A-Za-z0-9:_\-/[\]#.%!=&]+/g)) {
      const raw = m[0];
      const cls = raw.replace(/^!/, '');
      // The utility is whatever follows the last variant separator.
      const bare = cls.slice(cls.lastIndexOf(':') + 1);
      if (!COLOUR_PREFIX.test(bare)) continue;
      if (DYNAMIC.test(cls)) continue;
      // A fragment can still survive if a line contains stray punctuation, so
      // require the whole token to be a plausible class: it must start with a
      // letter and carry no unbalanced bracket.
      if (!/^[a-z]/.test(cls)) continue;
      if ((cls.match(/\[/g) || []).length !== (cls.match(/\]/g) || []).length) continue;
      // A trailing hyphen means the token was cut at an interpolation —
      // `text-${tone}-500` tokenises to `text-`, which passes the prefix test
      // and is not a class. No utility ends in a hyphen.
      if (cls.endsWith('-')) continue;
      if (!found.has(cls)) found.set(cls, i + 1);
    }
  });
  return found;
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\.|__tests__/.test(p)) acc.push(p);
  }
  return acc;
}

export function run() {
  const sheets = readdirSync(DIST).filter((f) => f.endsWith('.css'));
  if (sheets.length === 0) {
    throw new Error('checkTokenResolution: no compiled CSS in dist/assets — run `npm run build` first.');
  }
  const css = sheets.map((f) => readFileSync(join(DIST, f), 'utf8')).join('\n');
  const defined = selectorsInCss(css);

  // Self-refutation, declared before the output is read: a checker that
  // resolves nothing would report every class as missing and look like a
  // catastrophic finding. If a class we KNOW ships cannot be found, the
  // instrument is broken and its output means nothing.
  //
  // The control is deliberately DIVERSE in shape, because the first version of
  // this file used three same-shaped tokens and passed while mis-parsing every
  // class that happened to follow a decimal value in the minified sheet. One
  // shape proves one shape. Each entry below exercises a different escape path:
  // a plain colour, a scale utility, an arbitrary value, an opacity modifier.
  const CONTROL = [
    'bg-lumi-surface',   // plain semantic colour
    'text-lumi-muted',   // plain semantic colour, different prefix
    'border-lumi-border',
    'text-xs',           // scale utility — sits next to decimals in the sheet
    'text-[10px]',       // arbitrary value — exercises \[ \] unescaping
    'bg-lumi-accent/10', // opacity modifier — exercises \/ unescaping
  ];
  const blind = CONTROL.filter((c) => !defined.has(c));
  if (blind.length) {
    throw new Error(
      `checkTokenResolution: instrument is blind — these ship but were not found: ${blind.join(', ')}. `
      + `Parsed ${defined.size} selectors from ${sheets.length} sheet(s). Refusing to report.`,
    );
  }

  const misses = new Map(); // class -> [ "file:line", … ]
  for (const file of walk(SRC)) {
    for (const [cls, line] of colourClassesIn(readFileSync(file, 'utf8'))) {
      if (defined.has(cls)) continue;
      if (!misses.has(cls)) misses.set(cls, []);
      misses.get(cls).push(`${relative(ROOT, file).replace(/\\/g, '/')}:${line}`);
    }
  }
  return { defined: defined.size, misses };
}

// ── CLI ──────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const { defined, misses } = run();
  const sites = [...misses.values()].reduce((n, a) => n + a.length, 0);

  if (misses.size === 0) {
    process.stdout.write(`✅ Every colour class resolves (${defined} selectors in the compiled CSS).\n`);
    process.exit(0);
  }

  process.stdout.write(`\n❌ ${misses.size} colour class(es) do not exist — ${sites} call site(s) render nothing.\n\n`);
  for (const [cls, where] of [...misses].sort((a, b) => b[1].length - a[1].length)) {
    process.stdout.write(`  ${cls}  (${where.length})\n`);
    for (const w of where.slice(0, 4)) process.stdout.write(`      ${w}\n`);
    if (where.length > 4) process.stdout.write(`      … and ${where.length - 4} more\n`);
  }
  process.stdout.write('\n');
  process.exit(1);
}
