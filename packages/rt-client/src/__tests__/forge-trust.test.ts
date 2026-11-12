import { describe, expect, test } from "bun:test";
import { mayOfferGitLabTokenToHost } from "../forge-trust.ts";

describe("mayOfferGitLabTokenToHost", () => {
  test("gitlab.com takes the token with no confirmed host", () => {
    expect(mayOfferGitLabTokenToHost("gitlab.com", undefined)).toBe(true);
  });

  test("the host the person confirmed takes the token, whatever its case", () => {
    expect(mayOfferGitLabTokenToHost("GitLab.Corp.Example", "gitlab.corp.example")).toBe(true);
    expect(mayOfferGitLabTokenToHost("gitlab.corp.example", "GITLAB.CORP.EXAMPLE")).toBe(true);
  });

  test("a host that only looks like GitLab is refused", () => {
    expect(mayOfferGitLabTokenToHost("gitlab.evil.example", undefined)).toBe(false);
    expect(mayOfferGitLabTokenToHost("gitlab.evil.example", "gitlab.corp.example")).toBe(false);
  });

  test("github.com never takes a GitLab token, even when it is the confirmed host", () => {
    expect(mayOfferGitLabTokenToHost("github.com", "github.com")).toBe(false);
    expect(mayOfferGitLabTokenToHost("github.com:443", "github.com:443")).toBe(false);
  });

  test("a missing host or a confirmed value that is not a string is refused", () => {
    expect(mayOfferGitLabTokenToHost(null, "gitlab.corp.example")).toBe(false);
    expect(mayOfferGitLabTokenToHost("", "")).toBe(false);
    expect(mayOfferGitLabTokenToHost("gitlab.corp.example", 443)).toBe(false);
  });
});
