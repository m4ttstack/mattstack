/** Forge payloads and error texts can carry live credentials (avatar URLs
    with a private_token query, remotes with oauth2:<token>@, tokens in job
    traces). The lookbehinds and length caps keep every pattern linear on
    large traces. Redact strings before serializing them: after
    JSON.stringify an escaped quote or \n sits against the value and the
    patterns would either eat the escape or miss the token. */
const URL_USERINFO = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,31}):\/\/([^/\s"'@?#]{1,512})@/gi;
const CREDENTIAL_PARAM = /([?&;](?:private_token|access_token|job_token|oauth_token|feed_token|token|api_key|apikey|sig)=)[^&\s"'#\\<>]{1,2048}/gi;
const TOKEN_SHAPE = /(?<![A-Za-z0-9])(?:glpat|gldt|glrt|glptt|glcbt|glft|glsoat|gloas|glimt|glagent|glffct|glwt|ghp|gho|ghu|ghs|ghr|github_pat)[-_][A-Za-z0-9_-]{16,512}/g;
const CREDENTIAL_HEADER = /\b(PRIVATE-TOKEN|JOB-TOKEN|Authorization)(:[ \t]*)[^\r\n]{1,2048}/gi;

export function redactCredentials(text: string): string {
  return text
    .replace(URL_USERINFO, (whole, scheme: string, info: string) =>
      scheme.toLowerCase().startsWith("http") || info.includes(":") ? `${scheme}://[redacted]@` : whole)
    .replace(CREDENTIAL_PARAM, "$1[redacted]")
    .replace(TOKEN_SHAPE, "[redacted]")
    .replace(CREDENTIAL_HEADER, "$1$2[redacted]");
}
