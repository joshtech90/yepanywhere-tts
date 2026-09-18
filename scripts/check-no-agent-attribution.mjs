#!/usr/bin/env node
/**
 * Refuse to publish commits that credit an agent as an author.
 *
 * This repository records agent involvement with a `Contributing-model:`
 * trailer and nothing else. A `Co-Authored-By:` trailer naming a model, a
 * "Generated with" banner, a robot-emoji line, or a commit authored from a
 * no-reply bot address all state authorship instead, and they are rejected.
 *
 * Two callers, one implementation:
 *
 * - `.husky/pre-push` runs it with git's pre-push arguments and stdin, so every
 *   hand-run `git push` is checked against the destination it is actually
 *   pushing to. This matters because destinations disagree: a violation that
 *   one remote accepts can be refused by another, and by then the commit is in
 *   shared history and can no longer be rewritten. `--no-verify` is the escape
 *   hatch for exactly that already-published case.
 * - `--range <rev-range>` checks an explicit range, which is what a publish
 *   flow uses to inspect every destination's outgoing history before it
 *   pushes to any of them. Add `--any` to report on published commits too,
 *   which is for auditing rather than for gating a push.
 *
 * Exit 0 clean, 1 with findings, 2 on a usage or git error.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ZERO = "0".repeat(40);

/**
 * Message lines that state agent authorship.
 *
 * Anchored to the start of a line rather than searched anywhere in the text,
 * so a commit whose prose discusses attribution — this file's own history, for
 * one — is not itself a violation. Not restricted to the trailing trailer
 * block: a `Co-Authored-By:` line followed by more prose, or by a bullet that
 * breaks the block, is still a claim of authorship, and a destination doing a
 * plain scan will reject it even though `git interpret-trailers --parse` does
 * not see it.
 */
const MESSAGE_PATTERNS = [
  { label: "Co-Authored-By trailer", pattern: /^\s*co-authored-by:/imu },
  { label: "generated-with banner", pattern: /^\s*generated with[ []/imu },
  { label: "robot-emoji line", pattern: /^\s*🤖/mu },
];

/** Identity fields that name a bot rather than a person. */
const IDENTITY_PATTERNS = [
  { label: "no-reply author address", pattern: /noreply@/iu },
  { label: "bot account", pattern: /\[bot\]/iu },
];

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" });
  } catch (error) {
    process.stderr.write(
      `no-agent-attribution: git ${args.join(" ")} failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exit(2);
  }
}

/**
 * Every commit already published somewhere, as `rev-list` exclusions.
 *
 * Only unpublished work is checked. A commit that another remote already
 * carries is accepted history: rewriting it is what the project forbids, so
 * refusing to push it would make the escape hatch the routine path and the
 * guard would stop meaning anything. This is not a loophole — a commit reaches
 * its first destination only by passing this check, so the way to be excluded
 * here is to have been clean earlier, or to have arrived from upstream.
 */
function publishedTips() {
  return git(["for-each-ref", "--format=%(objectname)", "refs/remotes/"])
    .split("\n")
    .filter(Boolean)
    .map((tip) => `^${tip}`);
}

/**
 * Commits a push would add to one destination, narrowed to unpublished ones.
 *
 * A brand-new remote ref reports no remote sha, which makes the local tip's
 * whole history technically outgoing; the exclusions handle that case too.
 */
function outgoingRevisions(localSha, remoteSha) {
  const excluded = publishedTips();
  if (remoteSha === ZERO) return [localSha, ...excluded];
  return [`${remoteSha}..${localSha}`, ...excluded];
}

function commitsIn(revArgs) {
  return git(["rev-list", ...revArgs])
    .split("\n")
    .filter(Boolean);
}

/** Every violation in one commit, as lines to show the user. */
function findingsFor(sha) {
  const [message, author, committer] = git([
    "show",
    "--no-patch",
    "--format=%B%x00%an <%ae>%x00%cn <%ce>",
    sha,
  ])
    .split("\0")
    .map((part) => part.trim());
  const findings = [];
  for (const { label, pattern } of MESSAGE_PATTERNS) {
    const line = message
      .split("\n")
      .find((candidate) => pattern.test(candidate));
    if (line !== undefined) findings.push(`${label}: ${line.trim()}`);
  }
  for (const { label, pattern } of IDENTITY_PATTERNS) {
    if (pattern.test(author)) findings.push(`${label} (author): ${author}`);
    if (pattern.test(committer) && committer !== author) {
      findings.push(`${label} (committer): ${committer}`);
    }
  }
  return findings;
}

function reportAndExit(offenders) {
  if (offenders.length === 0) process.exit(0);
  const out = process.stderr;
  out.write("no-agent-attribution: refusing to push.\n\n");
  out.write(
    "This repository credits agent involvement with a Contributing-model\n" +
      "trailer; a commit must not name an agent as an author.\n\n",
  );
  for (const { sha, subject, findings } of offenders) {
    out.write(`  ${sha.slice(0, 9)} ${subject}\n`);
    for (const finding of findings) out.write(`      ${finding}\n`);
  }
  out.write(
    "\nRewrite the marked commits by SHA, replacing the authorship line with\n" +
      "  Contributing-model: <short-model-name>\n" +
      "then push again. If these commits are already published elsewhere and\n" +
      "cannot be rewritten, push with --no-verify.\n",
  );
  process.exit(1);
}

function collect(revisionRanges) {
  const offenders = [];
  const seen = new Set();
  for (const revArgs of revisionRanges) {
    for (const sha of commitsIn(revArgs)) {
      if (seen.has(sha)) continue;
      seen.add(sha);
      const findings = findingsFor(sha);
      if (findings.length === 0) continue;
      offenders.push({
        sha,
        subject: git(["show", "--no-patch", "--format=%s", sha]).trim(),
        findings,
      });
    }
  }
  return offenders;
}

const argv = process.argv.slice(2);
const rangeIndex = argv.indexOf("--range");

if (rangeIndex !== -1) {
  const range = argv[rangeIndex + 1];
  if (!range) {
    process.stderr.write("no-agent-attribution: --range needs a rev-range\n");
    process.exit(2);
  }
  const excluded = argv.includes("--any") ? [] : publishedTips();
  reportAndExit(collect([[range, ...excluded]]));
}

// Pre-push mode. Git passes the remote name and URL as arguments and the refs
// being updated on stdin; a deleted ref has an all-zero local sha and pushes
// no commits at all.
const stdin = readFileSync(0, "utf8");
const ranges = [];
for (const line of stdin.split("\n")) {
  if (!line.trim()) continue;
  const [, localSha, , remoteSha] = line.split(/\s+/u);
  if (!localSha || localSha === ZERO) continue;
  ranges.push(outgoingRevisions(localSha, remoteSha ?? ZERO));
}
reportAndExit(collect(ranges));
