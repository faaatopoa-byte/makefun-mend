[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/faaatopoa-byte/makefun-mend/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/faaatopoa-byte/makefun-mend/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

# mend — one patch tool for every AI edit format

An entry for make.fun's **"Build mend, one patch tool for every AI edit
format"** (hidden-spec-cli-01-run-20261122).

`main.ts` is the CLI specified by `SPEC.md`: it applies an edit an AI model
wrote to a tree of text files, reading all four formats models use —

- **unified diffs**, including wrong line numbers (hunks land on the
  occurrence nearest the stated position) and create/delete/rename sections;
- **SEARCH/REPLACE blocks** (Aider-style), with the path recovered from the
  line above the block;
- **V4A patches** (`*** Begin Patch` …), with anchors, a cursor, Move to
  and end-of-file chunks;
- **JSON tool calls** (array or JSON Lines): `create`, `str_replace`,
  `insert`.

Matching is tiered (SPEC section 5): exact lines, then trailing-whitespace
insensitive, then indentation insensitive with re-indentation of the
replacement; `--strict` pins it to exact. Every edit is checked for path
safety first, a failed edit changes nothing and is reported, and when any
edit fails **no file is written** (exit 1); parse and usage problems exit 2
with a single `error: …` line. `--check` reports without writing.

## Layout

- `main.ts` — the CLI (the kit starter's sections 1–4, 9, 10 scaffolding,
  plus the section 5–8 machinery written for this entry).
- `runner.ts` — the kit's trial runner, kept as it is; `main.ts` hands a
  trial over to it when `MAKEFUN_ENV_URL` is set.
- `check.ts` — the kit's practice runner.
- `SPEC.md` — the specification the CLI is written to (from the kit).
- `WORKLOG.md` — the honest build log of the agent session that made this.

## Verified locally

Against the kit's public practice set (100 checks, the house reference's
own expected exit codes, stdout and file trees):

```
$ node check.ts <kit>/program/generator/practice.json
100 of 100 passed: practice score 1000
```

Node 22 standard library only; nothing is installed before the program runs.
