# gitlab_get on GitHub: narrowing the word guard (RT-554)

Status: design for review. No plan and no code until Matt approves it.

## Intent

On GitHub, `gitlab_get` refuses any path that has a guarded word
(`hooks`, `keys`, `secrets`, `variables`, `environments` and the rest of
`GITHUB_REFUSED_SEGMENTS`) in any segment. That fails closed, and it also
blocks ordinary reads:

- file paths such as `:repo/contents/src/hooks/useAuth.ts`,
  `:repo/contents/secrets.md` and `:repo/contents/infra/variables.tf`;
- every read on a repo whose owner or name is a guarded word
  (`acme/keys`, `acme/hooks.io`, `secrets/app`).

The refusal also says the path "can return credentials", which is false
for a file path.

`.claude/rules/mcp-and-gates.md` says the guard lists are widened, never
narrowed, without a design review, because every tool on the mattstack
MCP server runs on every estate machine with no permission check. This
document is that review. It narrows the GitHub match in two places and
widens it in three, and it proves the narrowing opens no route that can
return a credential.

## Decisions taken

These were put to Matt through the shepherd on 2026-11-13 and answered:

1. **Narrow.** Stop word matching after a literal lowercase `contents/`
   that is the fourth raw segment (`repos/<owner>/<name>/contents/`), and
   never match the owner and name segments. Every other route keeps the
   strict match. The raw owner and name segments must carry no percent
   escapes.
2. **Refuse decoded whitespace and zero-width or format characters**
   (Unicode White_Space and the Cf category) in every segment outside a
   `contents/` file path. Inside the file path they stay allowed.
3. **Refuse `copilot`.** Already decided and in flight in a separate lane
   (`copilot-refusal`), which adds `copilot` to `GITHUB_REFUSED_SEGMENTS`
   with its tests as its own PR, ahead of this design. This design
   assumes that entry exists and treats it like every other word.

## Approaches considered

| Approach | What it opens | Cost | Verdict |
|---|---|---|---|
| A. Narrow at a literal `contents/` and skip owner and name | File paths under `contents/`; repos named after a word | One proof over one route, plus a check that owner and name are bound identifiers | **Picked** |
| B. Skip owner and name only | Repos named after a word | File paths with a word stay refused: React `src/hooks/`, Terraform `variables.tf`, `keys/` folders, `secrets.md` docs | Rejected: leaves the most common miss in place |
| C. Keep strict, fix only the refusal text | Nothing | Every case above stays refused, through this tool, for every agent on every estate machine. The workaround is the local checkout, which does not cover a ref the checkout lacks (a fork's PR head, a remote branch not fetched). A repo named after a word cannot use `gitlab_get` at all | Rejected: a real cost with no security gain, since approach A opens no credential route (see the proof) |
| D. Exempt every path-bearing parameter (`commits/{ref}`, `compare/{basehead}`, `branches/{branch}`, `git/ref/{ref}`, `releases/tags/{tag}`, `readme/{dir}`, `actions/workflows/{workflow_id}` and so on) | Branch, tag and workflow names with a word | Each route needs its own proof, and several of those families sit next to guarded routes (`branches/{branch}/protection/...`, `environments/{environment_name}/secrets`) | Rejected: wide proof surface for a rare miss; a later design can add one route at a time |

## Evidence

- The guard: `checkGithubForgePath` and `plainApiPath` in
  `lib/daemon/forge-reads.ts`, and their tests in
  `lib/daemon/__tests__/forge-get-github.test.ts`.
- How the path reaches the wire: `GitHubProvider.restRequest` calls
  `api()` in `packages/glance/src/GitHubProvider.ts`, which escapes every
  `:` not followed by `/` to `%3A` and sends
  `octokit.request("GET <path>")`. Octokit expands `{name}` placeholders
  (refused by the guard) and splits the route at the first space
  (refused). The caller passes only `path`, `query`, `page` and
  `perPage`: there is no way to set a header, so the `Accept` media type
  is always Octokit's default JSON type.
- Redaction: every result passes through `callTool` in
  `lib/mcp/redact.ts`, whose `redactCredentials`
  (`packages/rt-client/src/redact.ts`) strips URL userinfo, the
  `token=`, `access_token=`, `sig=` and similar query values, token
  shapes, auth headers and `*TOKEN=`/`*SECRET=` assignments. The daemon
  side also blanks every `token` / `*_token` JSON key (`scrubTokens`).
- GitHub's route table: the published OpenAPI description
  (`github/rest-api-description`, `descriptions/api.github.com`,
  version 1.1.4, read 2026-11-13). It lists 279 GET routes under
  `/repos/{owner}/{repo}`. Every `/repos/...` route starts
  `/repos/{owner}/{repo}` except `/repos/{template_owner}/{template_repo}/generate`,
  which is POST only.
- PR #1087 (RT-540), which added the GitHub arm. Its review found that
  `gitlab_get` could read `secret-scanning/alerts`, and added
  `secret-scanning`, `organization-secrets`, `organization-variables` and
  `security-advisories`. Its follow-up list named this miss.
- `docs/superpowers/specs/2026-11-10-daemon-forge-router-design.md`,
  section 4, the first review of this arm.

## The rule

Terms. The **raw path** is the caller's path after leading slashes are
stripped and `:repo` is expanded to `repos/<owner>/<name>`, before any
percent-decoding. The **decoded segments** are the raw path decoded once
and split on `/`, lowercased, as today. The **repo segments** are
indices 0 to 2 (`repos`, owner, name). The **route segments** are index 3
on.

`checkGithubForgePath` keeps every check it runs today, in today's
order, with these changes:

1. **Repo shape (widening).** The configured `projectPath` must be
   exactly two non-empty segments, `owner/name`; anything else refuses
   before any request. GitHub has no deeper repo path.
2. **Plain repo segments (widening).** The raw path's first three
   segments must contain no `%`. GitHub owner and repo names are limited
   to letters, digits, `.`, `-` and `_`, so no real path needs an escape
   there. Because those segments and a literal `contents` hold no escape,
   raw and decoded segments line up one to one through index 3.
3. **The file path.** The path has a **file path** when the raw segment
   at index 3 is exactly `contents` (lowercase, no escape, no suffix) and
   is followed by `/`. The file path is every decoded segment from index
   4 on. `Contents`, `%63ontents`, `contents.json` and `contents%2F...`
   do not count: those paths are matched strictly.
4. **Whitespace and invisible characters (widening).** A decoded segment
   that is not in the file path and contains a character matching
   `/[\s\p{Cf}]/u` refuses. That covers space, tab, no-break space,
   U+FEFF, the line and paragraph separators, zero-width space, joiner
   and non-joiner, word joiner, soft hyphen and the bidi controls. The
   raw whitespace refusal stays as it is everywhere, file path included,
   because Octokit cuts the route at a raw space; a file name with a
   space is sent as `%20`.
5. **Word matching (narrowing).** `GITHUB_REFUSED_SEGMENTS` and
   `git/blobs` are matched only over the route segments, and not over
   the file path. An entry with a slash (`actions/oidc`) must start at
   index 3 or later. The repo-name refusal ("cannot read a GitHub repo
   whose owner or name is ...") goes away.

Unchanged, over the whole path, file path included: the control
character, `?`, `#`, `://` and backslash refusals; one level of decoding
only (a `%` left after decoding refuses); malformed escapes; dot segments
(`.`, `..`, in any encoding); `{` and `}`; `;`; the prefix check that the
decoded path sits under `repos/<owner>/<name>` of this repo (case
insensitive); the query key refusals; redirect refusal; the 256 KiB cap;
token redaction.

## Why nothing new is reachable

The rule changes the outcome for exactly two kinds of path. Every other
path is checked as strictly as today, or more.

### 1. A path with a file path

Claim: every path that passes the guard and has a file path is answered
by `GET /repos/{owner}/{repo}/contents/{path}`, and that route cannot
return an API credential.

- **The route is fixed by the prefix.** The first four raw segments are
  literal bytes with no escapes: `repos`, this repo's owner, this repo's
  name, `contents`. In GitHub's route table exactly one GET route has the
  literal `contents` in that position: `contents/{path}`. `{path}` is the
  route's last parameter and takes the rest of the path, slashes
  included.
- **Nothing after the prefix can climb out.** Dot segments are refused
  in the decoded path, so no layer that normalizes `..` (GitHub's edge,
  a proxy, a URL parser) can turn `contents/a/../../hooks` into
  `hooks`. Double encoding is refused, so no layer that decodes twice
  can find a dot segment or a slash the guard never saw.
- **The bytes checked are the bytes sent.** Octokit rewrites only `{...}`
  (refused) and `:word` (glance escapes the colon first), and a raw
  space (refused). The real-provider test already pins the pathname that
  reaches `fetch`.
- **The response.** The route answers with a file object (base64 content
  of a blob in this repo), a directory listing, a symlink object or the
  content of an in-repo target file, a submodule object, a 302 (refused
  by the redirect rule, which names only the host), or a 304, 403 or 404.
  Raw, HTML and object media types need an `Accept` header the caller
  cannot set, and would return the same file bytes anyway.
- **Repo content is not a credential this guard protects.** The token
  can already read every file through a clone, and
  `:repo/contents/.env` is readable through `gitlab_get` today. The guard
  exists to stop API-only secrets: Actions, Dependabot, Codespaces and
  agent secrets and variables, webhook configs and secrets, deploy keys,
  environment secrets, runner tokens, OIDC customization, secret-scanning
  alerts.
- **The one credential-shaped field.** On a private repo, `download_url`
  carries `?token=<short-lived raw token>`. That field is reachable today
  through any word-free contents path (`:repo/contents/README.md`), and
  `CREDENTIAL_PARAM` in `redactCredentials` blanks it on the way out of
  `callTool`. The narrowing adds no new kind of field. A submodule's
  `submodule_git_url` with userinfo is blanked by `URL_USERINFO`.

### 2. A word in the owner or name

Claim: a guarded word in segment 1 or 2 selects no endpoint.

- The prefix check already pins segments 1 and 2 to this repo's owner
  and name, and rule 2 makes the raw bytes equal the checked bytes.
- Every GET route under `/repos/` binds those two segments to
  `{owner}` and `{repo}`, which name a repository, not an endpoint.
- An entry with a slash cannot start in the name: `acme/actions` with
  path `:repo/oidc/customization/sub` becomes
  `/repos/acme/actions/oidc/customization/sub`, which in the route table
  is no route at all (the OIDC route is `actions/oidc/customization/sub`
  under a repo), so GitHub answers 404.

### Bypass checks

| Attempt | Result |
|---|---|
| `:repo/%63ontents/hooks`, `:repo/Contents/hooks`, `:repo/contents.json/hooks` | No file path (segment 3 is not the literal); strict match refuses `hooks` |
| `:repo/contents%2Fhooks`, `:repo/contents%2F..%2Fhooks` | No file path (raw segment 3 is `contents%2Fhooks`); strict match refuses; the second also has a dot segment |
| `:repo/actions/contents/secrets` | `contents` is not at index 3; strict match refuses `secrets` |
| `:repo/contents/../hooks`, `:repo/contents/%2e%2e/hooks`, `:repo/contents/.%2e/x` | Dot segments, refused |
| `:repo/contents/%252e%252e/hooks` | Double encoding, refused |
| `:repo/contents/x;/../hooks`, `:repo/contents/{x}` | `;` and braces refused over the whole path |
| `:repo/contents/a\b`, `:repo/contents/a%5Cb` | Backslash refused, raw and decoded |
| `:repo/contents/a b` | Raw whitespace refused; send `%20` |
| `repos/acme%2Fkeys/...`, `repos/o/%72/hooks` | Escape in a repo segment, refused by rule 2 |
| `:repo/actions/secrets%20`, `:repo/hooks%C2%A0`, `:repo/actions/secrets%E2%80%8B` | Decoded whitespace or Cf outside a file path, refused by rule 4 |
| `:repo/contents/hooks` with `query: {ref: "x"}` | Allowed; `ref` picks a commit in this repo and the route is still contents. Query values never change GitHub's route |
| A query key such as `token` or `access_token` | Refused as today |
| A renamed or transferred repo | GitHub answers 301 to `/repositories/<id>/...`; refused by the redirect rule. The guard never sends a `/repositories/` path |
| Trailing slash, `:repo/contents/src/` | Directory listing of `src`, still the contents route |
| Empty segment, `:repo/contents//hooks` | Still under the literal prefix; contents route or 404 |
| `:repo/git/trees/<sha>?recursive=1` | Unchanged and allowed today: a tree lists names and blob shas, no content, and is cut at 256 KiB |
| `:repo/git/blobs/<sha>` | Still refused for size (not in a file path) |
| `:repo/contents/git/blobs/x` | Allowed: a file named `x` in a folder `git/blobs`; the contents route never reads a blob by sha |
| `:repo/tarball/<ref>`, `:repo/zipball/<ref>` | 302 to codeload; refused by the redirect rule, as today |
| `:repo/readme/hooks` | Strict match refuses; `readme/{dir}` is not exempt |
| A homoglyph such as fullwidth `ｓｅｃｒｅｔｓ` outside a file path | Not refused by the guard; GitHub routes on literal ASCII bytes, so it is a 404. See "Left open" |

## Every route family, with a verdict

Route families are the first segment after `/repos/{owner}/{repo}` in the
OpenAPI description (version 1.1.4). "Unchanged" means this design does
not change the outcome for that family; the narrowing touches only
`contents` and the owner and name segments.

| Family | Credential-bearing GET routes | Verdict |
|---|---|---|
| (bare repo) | none; `*_token` keys blanked | Readable, unchanged |
| `contents` | none (see the proof) | **Narrowed**: the file path is no longer word matched |
| `actions` | `secrets`, `variables`, `organization-secrets`, `organization-variables`, `oidc/customization/sub`, `runners` (registration and remove tokens are POST, listing refused anyway) | Refused by word, unchanged. `artifacts/{id}/{archive_format}`, `runs/{id}/logs`, `jobs/{id}/logs` redirect to signed URLs and are refused by the redirect rule. `caches`, `permissions`, `policies`, `workflows`, `runs`, `jobs` readable, unchanged. `workflows/{workflow_id}` takes a file name and keeps the strict match |
| `agents` | `secrets`, `variables`, `organization-secrets`, `organization-variables` | Refused by word, unchanged |
| `codespaces` | `secrets`, devcontainers, machines | Refused by word (whole family), unchanged |
| `copilot` | `cloud-agent/configuration` (free-form MCP server config) | Refused by word once the `copilot-refusal` lane lands |
| `dependabot` | `secrets`, `runner-settings`, alerts | Refused by word (whole family), unchanged |
| `environments` | `{name}/secrets`, `{name}/variables` | Refused by word (whole family), unchanged |
| `hooks` | `{id}/config` (webhook secret), deliveries (request headers and payloads) | Refused by word, unchanged |
| `keys` | deploy keys | Refused by word, unchanged |
| `secret-scanning` | alerts carry the secret, locations, custom patterns | Refused by word, unchanged |
| `security-advisories`, `private-vulnerability-reporting` | unpublished advisory content | Refused by word, unchanged |
| `invitations`, `autolinks` | none known; listed by the first review | Refused by word, unchanged |
| `installation` | none (installation metadata; `access_tokens_url` is a URL, not a token) | Readable, unchanged (`installations`, plural, is the listed word) |
| `import` | none; `vcs_url` userinfo is blanked by redaction | Readable, unchanged |
| `git` | none; `blobs` refused for size | Unchanged. `ref/{ref}` and `matching-refs/{ref}` take a ref with slashes and keep the strict match |
| `commits` | none | Readable; `commits/{ref}` keeps the strict match |
| `compare` | none | Readable; `compare/{basehead}` keeps the strict match |
| `branches` | none (protection settings, no secrets) | Readable; `branches/{branch}` keeps the strict match |
| `releases` | none under the default JSON media type | Readable; `releases/tags/{tag}` keeps the strict match |
| `rules`, `rulesets` | none | Readable; `rules/branches/{branch}` keeps the strict match |
| `readme` | none | Readable; `readme/{dir}` keeps the strict match |
| `tarball`, `zipball` | signed redirect | Refused by the redirect rule, unchanged |
| `labels` | none | Readable; `labels/{name}` keeps the strict match |
| `attestations` | none | Readable, unchanged |
| `deployments` | none by design; `payload` is free-form JSON the deployer sets | Readable, unchanged |
| `code-scanning`, `code-quality`, `code-security-configuration`, `dependency-graph`, `vulnerability-alerts`, `automated-security-fixes` | none (findings, settings, SBOM) | Readable, unchanged |
| `pages`, `traffic`, `stats`, `activity`, `events`, `notifications`, `subscription`, `subscribers`, `stargazers`, `forks`, `contributors`, `collaborators`, `teams`, `topics`, `tags`, `languages`, `license`, `community`, `codeowners`, `properties`, `interaction-limits`, `immutable-releases`, `hash-algorithm`, `stacks` | none | Readable, unchanged |
| `issues`, `pulls`, `comments`, `milestones`, `assignees`, `issue-types`, `check-runs`, `check-suites` | none | Readable, unchanged |

Anything outside `/repos/<owner>/<name>/` (`/user`, `/orgs/...`,
`/installation/token`, `/repositories/...`, another repo) stays refused
by the prefix check.

## Refusal text

Plain words, one sentence of what happened and one of what to do. The
word in the text always comes from `GITHUB_REFUSED_SEGMENTS`, never from
the caller's path.

| Case | Text |
|---|---|
| A guarded word in the route segments | `gitlab_get refuses "path" because it has "hooks" in it. On GitHub that word names an endpoint that can return credentials, so it is refused anywhere after the repo, branch and tag names included. File names under :repo/contents/ are not checked for it.` |
| Decoded whitespace or an invisible character outside the file path | `"path" has a space or an invisible character outside the file path, which gitlab_get refuses on GitHub. A file name under :repo/contents/ may hold a space, sent as %20.` |
| An escape in the owner or name | `"path" must name the repo as repos/<owner>/<name> with no percent escapes.` |
| `projectPath` is not `owner/name` | `gitlab_get cannot read this GitHub repo: its path is not owner/name.` |
| `git/blobs` | Unchanged. |

The first row replaces today's `"path" names hooks, which can return
credentials; gitlab_get refuses it` on GitHub only. GitLab's text does
not change.

## Test plan

All through `forgeGet` with a real `GitHubProvider` over a stubbed
`globalThis.fetch`, the pattern of the existing
`forgeGet through a real GitHubProvider` block: each accepted case
asserts exactly one request, its `pathname`, and `redirect: "manual"`;
each refused case asserts the exact error and that `fetch` was never
called. The pure `checkGithubForgePath` tests stay for exact wording.

Accepted, with the pathname that reaches the wire:

- `:repo/contents/src/hooks/useAuth.ts`, `:repo/contents/secrets.md`,
  `:repo/contents/infra/variables.tf`, `:repo/contents/keys/README.md`,
  `:repo/contents/Actions/Secrets`, `:repo/contents/git/blobs/x`,
  `:repo/contents/docs%2Fhooks.md`, `:repo/contents/a%20b.md`,
  `:repo/contents/a%E2%80%8Bb.md`.
- For every entry in `GITHUB_REFUSED_SEGMENTS`:
  `:repo/contents/<entry>` and `:repo/contents/dir/<entry>.md` accepted,
  `:repo/<entry>` refused. This loop picks up `copilot` from the other
  lane with no edit.
- Repos `acme/keys`, `acme/hooks.io`, `secrets/app`: `:repo`,
  `:repo/pulls` accepted. Repo `acme/actions`: `:repo/oidc/customization/sub`
  accepted (GitHub's 404 is its own answer).

Refused, never reaching `fetch`:

- Strict match kept: `:repo/Contents/hooks`, `:repo/%63ontents/hooks`,
  `:repo/contents.json/hooks`, `:repo/contents%2Fhooks`,
  `:repo/actions/contents/secrets`, `:repo/readme/hooks`,
  `:repo/git/ref/heads/feature/hooks`, `:repo/commits/hooks`,
  `:repo/environments/prod/secrets`, `:repo/git/blobs/abc`.
- Climbing out of a file path: `:repo/contents/../hooks`,
  `:repo/contents/%2e%2e/hooks`, `:repo/contents/%252e%252e/hooks`,
  `:repo/contents/x;/../hooks`, `:repo/contents/{x}`,
  `:repo/contents/a%5Cb`, `:repo/contents/a b`.
- Repo segments: `repos/o%2Fr/pulls` style escapes, `repos/o/%72/pulls`,
  and a provider configured with a three-segment `projectPath`.
- Rule 4: `:repo/actions/secrets%20`, `:repo/hooks%09`,
  `:repo/hooks%C2%A0`, `:repo/actions/secrets%E2%80%8B`,
  `:repo/pulls%E2%80%AE`, `:repo/pulls%C2%AD`, `:repo/pulls%EF%BB%BF`.
- A 302 from a contents read (GitHub's documented answer for some
  files) is refused naming only the host.

One test at the MCP seam: a `gitlab_get` result whose body has
`download_url: "https://raw.githubusercontent.com/o/r/main/a.md?token=X"`
comes back with the token value as `[redacted]` through `callTool`.

Tests that change: `credentialRefusal` takes the new wording;
`:repo/contents/secrets.md` moves from refused to accepted; the repo-name
refusal test becomes the accepted repo cases above.

## Docs that change with the code

- `.claude/rules/mcp-and-gates.md`: the GitHub sentence becomes "a word
  in `GITHUB_REFUSED_SEGMENTS` is refused in any route segment after the
  repo, or as a segment's dot-suffixed prefix; the owner and name are
  never matched, and a file path after a literal `:repo/contents/` is
  not matched", plus the whitespace and repo-segment widenings. Keep
  "widened, never narrowed, without a design review" and name this
  spec as the review.
- The `gitlab_get` description in `lib/mcp/forge-read-tools.ts` gains
  "file paths under :repo/contents/ are not checked for those words",
  and the MCP tools reference is regenerated.
- `2026-11-10-daemon-forge-router-design.md` section 4 gets one line
  pointing here.

## Goals, non-goals, anti-goals

- Goal: an agent can read any file of this repo through
  `:repo/contents/<path>`, whatever its name, and can use `gitlab_get` on
  a repo named after a guarded word.
- Non-goal: branch, tag, workflow and label names with a guarded word
  (approach D). They stay refused; `:repo/commits` with
  `query: {path: ...}` covers a file's history.
- Non-goal: protecting repo content. Files the token can clone were
  never behind this guard.
- Non-goal: GitLab. Its arm and its texts do not change.
- Anti-goal: any GitHub route that returns a secret value, a deploy key,
  a webhook config or secret, an Actions, Dependabot, Codespaces, agent
  or environment secret or variable, a token, OIDC customization or
  secret-scanning content becoming reachable. The tests above pin each
  family's representative route as refused.

## Left to the builder

- How the code computes the file-path start (a small helper next to
  `entryAt` is my call); it must work on the raw path for rules 2 and 3
  and on decoded segments for rules 4 and 5.
- The mattstack plugin version bump and the regenerated reference, per
  the repo's usual flow.

## Left open

- **Non-ASCII outside a file path.** Refusing any non-ASCII character in
  route segments would close homoglyph questions without relying on
  GitHub routing by bytes. It was not put to Matt; it would refuse label
  and environment names with non-ASCII text. A later widening if wanted.
- **The route table moves.** GitHub adds route families (`agents`,
  `copilot` and `stacks` are recent). The narrowing holds as long as no
  second GET route starts with a literal `contents` under a repo; whoever
  next reviews the list should re-read the OpenAPI description for new
  families and for that.
