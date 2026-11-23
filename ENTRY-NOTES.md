# Entry notes — hidden-spec-cli-01-run-20261122 ("mend")

## Requirements as verified (2026-11-23, from make.fun itself)
- Sources: GET /api/competitions/hidden-spec-cli-01-run-20261122/requirements,
  the competition description, and the official kit (GET /c/<slug>/kit):
  starter/SPEC.md is the normative spec; starter/main.ts implements
  sections 1-4, 9, 10 and leaves 5-8 to the entrant.
- Entrypoint: main.ts at repo root (Node 22), with the kit's runner.ts
  beside it, kept as it is. Node 22 stdlib only, nothing installed.
- Deterministic: same check -> same exit code, stdout and files.
- Caps: 1 MiB per file, 4 MiB of source in all (this entry is far under).
- LICENSE (OSI) at the submitted commit; transcripts required.
- Prerequisite named by the competition: Node 22.
- Scoring: 100 checks drawn after the deadline from a sealed pool of 300,
  including kinds the practice set does not show; a house "strict applier"
  entry must be beaten for a reward. Entries close 2026-11-24T14:00:00Z.

## How this entry meets them
- All four formats implemented to SPEC.md's sentences (not fitted to the
  practice set): tiered matching with tier-2 re-indentation, unified
  nearest-occurrence choice with the running delta d, the backslash
  end-of-file rule, SEARCH/REPLACE path recovery and exactly-once rule,
  V4A anchors/cursor/end-of-file chunks, JSON create/str_replace/insert,
  atomic all-or-nothing writes, and the section 2 `R old -> new` lines
  for moves (which the starter's output stage did not emit).
- Practice evidence: 100 of 100 public practice checks pass (score 1000),
  including the CRLF, no-eol, rename, cursor, eof, strict, unsafe and
  usage families.

## Unverified / risks
- The scored pool (300) contains check kinds the practice set does not
  show; each tests a sentence of SPEC.md. Two readings I had to choose
  where the text is terse: (1) a `\` line after a `-` line does not by
  itself clear the result's final break (section 6 names only a `\`
  following the last context or `+` line); (2) V4A section-end blank
  lines include whitespace-only context lines (section 4's definition
  of blank) — the second is confirmed by the v-cursor practice check.
- Local Node is v24; the grader's pinned image is Node 22. The code uses
  only long-stable stdlib APIs and erasable TypeScript syntax, as the
  kit's starter does.
- Submission still needs: repo created after the competition opened,
  .makefun/owner.json if the GitHub owner differs from the account's
  GitHub login, and the session transcripts bundled by the kit CLI.
  This folder is a local git repo, ready to push; nothing was submitted.
