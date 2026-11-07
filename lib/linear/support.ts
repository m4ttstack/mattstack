const GRAPHQL_URL = "https://api.linear.app/graphql";

export type SupportIssueInput = {
  kind: "bug" | "feature";
  title: string;
  problem: string;
  idea: string;
  acceptance: string[];
  source: { person: string; date: string; room: string };
};

export class LinearSupportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinearSupportError";
  }
}

export function renderSupportBody(input: SupportIssueInput): string {
  const acceptance = input.acceptance.map((a) => `- ${a}`).join("\n");
  return [
    "## Problem",
    input.problem,
    "## Fix",
    input.idea,
    "## Acceptance",
    acceptance,
    "## Source",
    `${input.kind === "bug" ? "Bug report" : "Feature request"} from a Slack chat with ${input.source.person} in ${input.source.room} on ${input.source.date}.`,
  ].join("\n\n");
}

const TEAMS_QUERY = "query { teams { nodes { id } } }";
const CREATE_MUTATION = `mutation($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { identifier title url } }
}`;

async function gql(
  apiKey: string,
  fetchImpl: typeof fetch,
  query: string,
  variables: Record<string, unknown>,
): Promise<any> {
  let response: Response;
  try {
    response = await fetchImpl(GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: apiKey },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    throw new LinearSupportError(name === "TimeoutError" || name === "AbortError" ? "Linear did not answer in 15 seconds" : "Linear could not be reached");
  }
  type Body = { data?: unknown; errors?: Array<{ message: string }> };
  let json: Body;
  try {
    json = (await response.json()) as Body;
  } catch {
    throw new LinearSupportError(response.ok ? "Linear sent a reply that is not JSON" : `Linear API ${response.status}`);
  }
  const message = json?.errors?.map((e) => e.message).join("; ");
  if (message) throw new LinearSupportError(message);
  if (!response.ok) throw new LinearSupportError(`Linear API ${response.status}`);
  return json?.data;
}

export async function createSupportIssue(
  input: SupportIssueInput,
  opts: { apiKey: string; fetchImpl?: typeof fetch },
): Promise<{ id: string; title: string; url: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const teams = await gql(opts.apiKey, fetchImpl, TEAMS_QUERY, {});
  const nodes = (teams?.teams?.nodes ?? []) as Array<{ id?: string }>;
  // The key is meant to see only the support team; with several, an issue could land in the wrong one.
  if (nodes.length === 0) throw new LinearSupportError("the Linear key sees no team");
  if (nodes.length > 1) throw new LinearSupportError(`the Linear key sees ${nodes.length} teams, so make a key that sees only the support team`);
  const teamId = nodes[0]!.id;
  if (!teamId) throw new LinearSupportError("the Linear key sees no team");

  const data = await gql(opts.apiKey, fetchImpl, CREATE_MUTATION, {
    input: { teamId, title: input.title, description: renderSupportBody(input) },
  });
  const issue = data?.issueCreate?.issue;
  if (!data?.issueCreate?.success || !issue) throw new LinearSupportError("Linear did not create the issue");
  return { id: issue.identifier, title: issue.title, url: issue.url };
}
