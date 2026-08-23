#!/usr/bin/env bun
/**
 * Standing alias for `gitq job-status`, kept so a pane whose installed skill
 * still spells the old `bun run bin/gitq-status.ts <state> <status>` form
 * keeps writing status. The board hands out `<gitq> job-status` now: a
 * compiled binary carries no bin/ directory to point at.
 *
 * A leading `job-status` is stripped so both spellings work here, which is
 * what covers the skew of a long-running board still handing out this path
 * while the skills on disk have already moved to the verb form.
 */
import { runJobStatus } from '../src/cli/job-status.ts';

const argv = process.argv.slice(2);
process.exit(runJobStatus(argv[0] === 'job-status' ? argv.slice(1) : argv));
