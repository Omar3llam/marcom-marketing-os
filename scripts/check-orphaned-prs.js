#!/usr/bin/env node
// ============================================================
// MARCOM — Orphaned PR Check
// ============================================================
// Answers the one question the GitHub UI cannot: DID THIS MERGED PR'S CODE
// ACTUALLY REACH master?
//
// WHY THIS EXISTS
//   PR #344 was based on `fix/reallocate-actionability` (PR #343's branch)
//   rather than on master, to dodge one conflict in one test file. #343 merged
//   into master at 17:29; #344 merged into that same branch at 17:50 — twenty-one
//   minutes AFTER its base had merged and stopped feeding master.
//
//   Both PRs showed "Merged". Master received one of them. Render deploys
//   master, so the other silently never shipped, and nothing anywhere said so.
//   It was found only because a human asked why a deploy had not happened.
//
//   A stacked PR is only safe if the CHILD merges FIRST. Merges here happen in
//   review order, not dependency order, so that ordering cannot be assumed.
//
// WHY IT DOES NOT TEST COMMIT ANCESTRY
//   The obvious check — `git merge-base --is-ancestor <mergeCommit> master` —
//   was tried first and produced THREE false positives out of three. A stacked
//   child's content can reach master through its parent's merge (and a squash
//   merge rewrites the SHA entirely), so the original commit is not an ancestor
//   even though every line of it is on master. SHA identity answers "did this
//   commit travel", which is not the question. The question is "is this CODE on
//   master", so this script reads master's TREE.
//
// WHAT IT DOES
//   1. Screens every recently merged PR for `base != master` — the precondition
//      for orphaning, and cheap to check.
//   2. For each suspect, replays the PR's own diff and asks, per added line,
//      whether that line is present in master's copy of the file.
//   3. Reports a coverage ratio. Deliberately a RATIO, not a boolean: master
//      moves on, and a later PR editing the same lines is not evidence that this
//      one was lost. A near-zero ratio is; a partial one is worth a human look.
//
//   Also lists OPEN PRs whose base is not master, because that is the moment the
//   problem is still free to fix.
//
// USAGE
//   node scripts/check-orphaned-prs.js [--limit 40] [--all]
//     --all    deep-check every merged PR, not only the non-master-based ones
//
// Requires the `gh` CLI, authenticated. Exits 1 when work looks stranded, so it
// can gate a release step; exits 0 (with a notice) when gh is unavailable, since
// "no network" must not read as "nothing is wrong".
// ============================================================
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || 40;
const DEEP_ALL = args.includes('--all');

// The trunk to check against. Overridable ONLY so this script can be pointed at
// a historical master and proved to catch a known-orphaned PR — see the header
// of its own test. Nothing in normal use should set it.
const MASTER = process.env.ORPHAN_CHECK_REF || 'origin/master';

// Below this share of a PR's added lines present on master, the work is treated
// as stranded. Not 1.0: later PRs legitimately rewrite lines this one added.
const COVERAGE_FLOOR = 0.5;

const sh = (cmd, cmdArgs) =>
  execFileSync(cmd, cmdArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const trySh = (cmd, cmdArgs) => {
  try { return sh(cmd, cmdArgs); } catch { return null; }
};

/** Lines a diff ADDS, minus the noise that would match anything. */
function addedLines(diff) {
  return diff
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1).trim())
    // A bare brace or an empty line is present in every file on earth; counting
    // them would float the coverage ratio of a completely stranded PR.
    .filter((l) => l.length > 8);
}

/**
 * What share of this PR's added lines exist in master's copy of the files?
 * @returns {{ratio:number, checked:number, missingFiles:string[]}|null}
 */
function coverageOnMaster(baseSha, headSha) {
  const files = trySh('git', ['diff', '--name-only', `${baseSha}..${headSha}`]);
  if (files === null) return null;

  let total = 0;
  let found = 0;
  const missingFiles = [];

  for (const file of files.split('\n').filter(Boolean)) {
    const diff = trySh('git', ['diff', `${baseSha}..${headSha}`, '--', file]);
    if (!diff) continue;
    const added = addedLines(diff);
    if (added.length === 0) continue;

    // Deleted on master, or never arrived — either way its added lines are not there.
    const onMaster = trySh('git', ['show', `${MASTER}:${file}`]);
    if (onMaster === null) {
      total += added.length;
      missingFiles.push(file);
      continue;
    }

    const hay = new Set(onMaster.split('\n').map((l) => l.trim()));
    const hit = added.filter((l) => hay.has(l)).length;
    total += added.length;
    found += hit;
    if (hit === 0) missingFiles.push(file);
  }

  return total === 0 ? null : { ratio: found / total, checked: total, missingFiles };
}

function main() {
  const ghAvailable = trySh('gh', ['--version']) !== null;
  if (!ghAvailable) {
    console.log('ℹ️  gh CLI not available — skipping orphaned-PR check.');
    console.log('   This is a SKIP, not a pass. Re-run where gh is authenticated.');
    process.exit(0);
  }

  trySh('git', ['fetch', 'origin', '--quiet']);

  const raw = trySh('gh', [
    'pr', 'list', '--state', 'merged', '--limit', String(LIMIT),
    '--json', 'number,title,baseRefName,headRefName,mergedAt',
  ]);
  if (raw === null) {
    console.log('ℹ️  Could not list PRs (auth or network) — skipping. Not a pass.');
    process.exit(0);
  }

  const merged = JSON.parse(raw);
  const suspects = DEEP_ALL ? merged : merged.filter((p) => p.baseRefName !== 'master');

  console.log(`\n── Orphaned PR check — last ${merged.length} merged PRs ─────────────`);
  console.log(`   ${merged.filter((p) => p.baseRefName !== 'master').length} were NOT based on master`);
  console.log(`   deep-checking ${suspects.length}\n`);

  const stranded = [];
  const unknown = [];

  for (const pr of suspects) {
    const head = `origin/${pr.headRefName}`;
    if (trySh('git', ['rev-parse', '--verify', '-q', head]) === null) {
      unknown.push({ ...pr, why: 'branch deleted — cannot replay its diff' });
      continue;
    }
    const baseSha = trySh('git', ['merge-base', MASTER, head])?.trim();
    if (!baseSha) { unknown.push({ ...pr, why: 'no merge-base with master' }); continue; }

    const label = `#${pr.number} ${pr.headRefName} → ${pr.baseRefName}`;

    // The branch is wholly contained in master — merge-base IS its tip, so there
    // is no diff left to check. That is the STRONGEST pass available, and it
    // must not be reported as "not determinable": that reading is what let a
    // real orphan hide among the unknowns the first time this was checked.
    const headSha = trySh('git', ['rev-parse', head])?.trim();
    if (headSha && baseSha === headSha) {
      console.log(`  ✅ ${label} — branch fully contained in master`);
      continue;
    }

    const cov = coverageOnMaster(baseSha, head);
    if (!cov) { unknown.push({ ...pr, why: 'no comparable added lines' }); continue; }

    const pct = Math.round(cov.ratio * 100);
    if (cov.ratio < COVERAGE_FLOOR) {
      stranded.push({ ...pr, pct, missingFiles: cov.missingFiles });
      console.log(`  ❌ ${label}\n       ${pct}% of its added lines are on master (${cov.checked} checked)`);
      for (const f of cov.missingFiles.slice(0, 6)) console.log(`       missing: ${f}`);
    } else {
      console.log(`  ✅ ${label} — ${pct}% on master`);
    }
  }

  const openRaw = trySh('gh', ['pr', 'list', '--state', 'open', '--limit', '30', '--json', 'number,baseRefName,headRefName']);
  const openStacked = openRaw ? JSON.parse(openRaw).filter((p) => p.baseRefName !== 'master') : [];
  if (openStacked.length) {
    console.log('\n⚠️  OPEN PRs not based on master — fixable right now:');
    for (const p of openStacked) {
      console.log(`     #${p.number} ${p.headRefName} → ${p.baseRefName}`);
      console.log('       If its base merges first, this PR merges into a dead branch.');
    }
  }

  if (unknown.length) {
    console.log('\n   Not determinable (needs a human):');
    for (const p of unknown) console.log(`     #${p.number} ${p.headRefName} — ${p.why}`);
  }

  console.log('');
  if (stranded.length) {
    console.log(`❌ ${stranded.length} merged PR(s) look STRANDED off master.`);
    console.log('   Fix: open a new PR from the same branch to master. No rebase needed');
    console.log('   while the branch still exists.\n');
    process.exit(1);
  }
  console.log('✅ Every checked PR\'s code is present on master.\n');
  process.exit(0);
}

main();
