import type { MetricEvidence, MetricKey } from './types.js';

export type Forge = 'gitlab' | 'github';

/** GitHub is supported only on github.com; this is the one base URL it ever takes. */
export const GITHUB_BASE_URL = 'https://github.com';

export function changeUrl(
  forge: Forge | undefined,
  baseUrl: string,
  projectPath: string,
  iid: number
): string {
  return forge === 'github'
    ? `${baseUrl}/${projectPath}/pull/${iid}`
    : `${baseUrl}/${projectPath}/-/merge_requests/${iid}`;
}

export function changeRef(forge: Forge | undefined, iid: number): string {
  return `${forge === 'github' ? '#' : '!'}${iid}`;
}

/** Whole-string GitHub copy, for strings the word rewrite in forgeText cannot express. */
export const GITHUB_COPY: Readonly<Record<string, string>> = {
  'Source: GitLab pushes to tracked projects':
    'Source: GitHub commits on your PRs',
  'Source: GitLab notes and approvals': 'Source: GitHub comments and approvals',
  "Distinct teammates' MRs you reviewed, by note or approval, in the window.":
    "Distinct teammates' PRs you reviewed, by comment or approval, in the window.",
  "Distinct teammates' MRs the user reviewed (note or approval) in the window.":
    "Distinct teammates' PRs the user reviewed (comment or approval) in the window.",
  'those count with zeroed diff/notes.':
    'those count with zeroed diff/comments.',
  'Source: GitLab pipelines you triggered':
    'Source: GitHub Actions runs you triggered',
  'Number of distinct days the user pushed at least one commit (to the tracked project) during the window.':
    'Number of distinct days the user authored at least one commit on their PRs during the window.',
  'Number of distinct days you pushed at least one commit to a tracked project during the window.':
    'Distinct days you authored at least one commit on your PRs.',
  'Average inline (DiffNote) comments per reviewed MR ... higher = more substantive review.':
    'Average inline comments per reviewed PR ... higher = more substantive review.',
  'Longest run of consecutive calendar days on which the user merged at least one MR, within the window. E.g. 4 = merged an MR on 4 days in a row at some point. (Based on merges, not pushes.)':
    'Longest run of consecutive calendar days on which the user merged at least one PR, within the window. E.g. 4 = merged a PR on 4 days in a row at some point. (Based on merges, not commits.)',
  "boxscore couldn't tell who you are. Check that your GitLab token is set and that your GitLab username is on the team roster in console.":
    "boxscore couldn't tell who you are. Check that rt can read a GitHub token for one of boxscore's projects and that your GitHub username is on the team roster in console.",
  'Check that your GitLab token is set and that your GitLab username is on the team roster in console.':
    "Check that rt can read a GitHub token for one of boxscore's projects and that your GitHub username is on the team roster in console.",
  Pushes: 'Commits',
  pushes: 'commits',
  push: 'commit',
  'Push calendar': 'Commit calendar',
  'pushes per day': 'commits per day',
  'Weekdays without a push': 'Weekdays without a commit',
};

const GITHUB_WORDS: [RegExp, string][] = [
  [/\bmerge requests\b/g, 'pull requests'],
  [/\bmerge request\b/g, 'pull request'],
  [/\bMerge requests\b/g, 'Pull requests'],
  [/\bMRs\b/g, 'PRs'],
  [/\bMR\b/g, 'PR'],
  [/\bGitLab\b/g, 'GitHub'],
  [/\b(days?) with a push\b/g, '$1 with a commit'],
];

/** The copy for a team's forge: GitLab copy is returned as written, so absent reads GitLab. */
export function forgeText(text: string, forge: Forge | undefined): string {
  if (forge !== 'github') return text;
  const whole = GITHUB_COPY[text];
  if (whole !== undefined) return whole;
  return GITHUB_WORDS.reduce((s, [re, to]) => s.replace(re, to), text);
}

/** Evidence headings and summary in the forge's copy; cells hold forge data and stay as fetched. */
export function forgeEvidenceText(
  evidence: Partial<Record<MetricKey, MetricEvidence>>,
  forge: Forge | undefined
): Partial<Record<MetricKey, MetricEvidence>> {
  if (forge !== 'github') return evidence;
  const out: Partial<Record<MetricKey, MetricEvidence>> = {};
  for (const [key, ev] of Object.entries(evidence) as [
    MetricKey,
    MetricEvidence,
  ][]) {
    out[key] = {
      ...ev,
      columns: ev.columns.map(c => forgeText(c, forge)),
      ...(ev.summary === undefined
        ? {}
        : { summary: forgeText(ev.summary, forge) }),
    };
  }
  return out;
}
