import { describe, test, expect } from "bun:test";
import { forgeRole, forgeScopes, linkScopes, missingScopes, scopeShortfallDetail, tokenCreateLink, tokenField } from "../token-create.ts";

describe("forgeScopes", () => {
  test("gitlab member: api, because the board posts review comments and replies as the member", () => {
    expect(forgeScopes("gitlab", "member")).toEqual(["api"]);
  });

  test("gitlab owner: api alone covers the push, the members API and everything a member needs", () => {
    expect(forgeScopes("gitlab", "owner")).toEqual(["api"]);
  });

  test("github: the classic scopes, same for both roles", () => {
    expect(forgeScopes("github", "member")).toEqual(["repo", "read:org"]);
    expect(forgeScopes("github", "owner")).toEqual(["repo", "read:org"]);
  });
});

describe("forgeRole", () => {
  test("intent takes priority, otherwise recorded role decides", () => {
    expect(forgeRole({ intentMode: "create", role: "member", hasTeam: false })).toBe("owner");
    expect(forgeRole({ intentMode: "join", role: "admin", hasTeam: true })).toBe("member");
    for (const role of ["org-owner", "admin", "owner"] as const) expect(forgeRole({ intentMode: null, role, hasTeam: true })).toBe("owner");
    for (const role of ["member", "unknown", null] as const) expect(forgeRole({ intentMode: null, role, hasTeam: true })).toBe("member");
    expect(forgeRole({ intentMode: null, role: null, hasTeam: false })).toBe("member");
    expect(forgeRole({ intentMode: null, role: "admin", hasTeam: false })).toBe("member");
  });
});

describe("tokenField", () => {
  test("the hint names the role's scopes, comma separated", () => {
    expect(tokenField("gitlab", "owner")).toEqual({ name: "token", label: "GitLab token", secret: true, hint: "api" });
    expect(tokenField("github", "member")).toEqual({ name: "token", label: "GitHub token", secret: true, hint: "repo, read:org" });
  });
});

describe("tokenCreateLink", () => {
  test("gitlab: the new-token page on the given host with name and scopes prefilled", () => {
    expect(tokenCreateLink("gitlab", "member", "gitlab.example.com")).toEqual({
      label: "Create a token on GitLab…",
      url: "https://gitlab.example.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=api%2Cread_api%2Cread_user%2Cread_repository%2Cwrite_repository%2Cai_features",
    });
  });

  test("gitlab with no host: gitlab.com", () => {
    expect(tokenCreateLink("gitlab", "owner", null).url).toBe("https://gitlab.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=api%2Cread_api%2Cread_user%2Cread_repository%2Cwrite_repository%2Cai_features");
  });

  test("github: the classic new-token page, host ignored", () => {
    expect(tokenCreateLink("github", "member", "ghe.example.com")).toEqual({
      label: "Create a token on GitHub…",
      url: "https://github.com/settings/tokens/new?description=mattstack&scopes=repo%2Cread%3Aorg",
    });
  });
});

describe("missingScopes", () => {
  test("names each required scope the token lacks", () => {
    expect(missingScopes("gitlab", "owner", ["read_api", "read_user"])).toEqual(["api"]);
    expect(missingScopes("gitlab", "member", ["read_api", "read_user"])).toEqual(["api"]);
  });

  test("a broader scope satisfies the narrower one it contains", () => {
    expect(missingScopes("gitlab", "member", ["api"])).toEqual([]);
    expect(missingScopes("github", "member", ["repo", "admin:org"])).toEqual([]);
  });

  test("no scopes reported (a fine-grained GitHub token) is not a shortfall", () => {
    expect(missingScopes("github", "member", [])).toEqual([]);
  });
});

describe("scopeShortfallDetail", () => {
  test("a member's gitlab token short of api says the board needs it to post reviews", () => {
    expect(scopeShortfallDetail("gitlab", "member", ["api"])).toBe("This token is missing api (needs api to post board review comments)");
  });

  test("an owner's gitlab token short of api names the owner's own needs", () => {
    expect(scopeShortfallDetail("gitlab", "owner", ["api"])).toBe("This token is missing api (needs api for the home-repo push and members sync)");
  });

  test("scopes with no recorded reason are just named", () => {
    expect(scopeShortfallDetail("github", "member", ["read:org"])).toBe("This token is missing read:org");
  });
});

describe("linkScopes", () => {
  test("gitlab link pre-checks the six scopes, required stays api", () => {
    expect(linkScopes("gitlab", "member")).toEqual(["api", "read_api", "read_user", "read_repository", "write_repository", "ai_features"]);
    expect(forgeScopes("gitlab", "member")).toEqual(["api"]);
    expect(tokenCreateLink("gitlab", "member", null).url).toBe(
      "https://gitlab.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=api%2Cread_api%2Cread_user%2Cread_repository%2Cwrite_repository%2Cai_features",
    );
    expect(missingScopes("gitlab", "member", ["api"])).toEqual([]);
  });

  test("github link scopes equal the required scopes", () => {
    expect(linkScopes("github", "owner")).toEqual(forgeScopes("github", "owner"));
  });
});
