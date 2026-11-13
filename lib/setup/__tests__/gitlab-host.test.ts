import { describe, expect, test } from "bun:test";
import { confirmedGitlabHost } from "../gitlab-host.ts";

describe("confirmedGitlabHost", () => {
  test("drops a leftover github.com host", () => {
    expect(confirmedGitlabHost({ forgeHost: "github.com" })).toBeNull();
  });
  test("drops it case-insensitively", () => {
    expect(confirmedGitlabHost({ forgeHost: "GitHub.com" })).toBeNull();
  });
  test("keeps a self-hosted GitLab host, lowercased", () => {
    expect(confirmedGitlabHost({ forgeHost: "GitLab.Example.com" })).toBe("gitlab.example.com");
  });
  test("an invalid host gives null", () => {
    expect(confirmedGitlabHost({ forgeHost: "https://gitlab.example.com/x" })).toBeNull();
    expect(confirmedGitlabHost({ forgeHost: " gitlab.example.com" })).toBeNull();
  });
  test("no host gives null", () => {
    expect(confirmedGitlabHost({})).toBeNull();
    expect(confirmedGitlabHost({ forgeHost: undefined })).toBeNull();
  });
  test("does not change the overrides it was given", () => {
    const input = { forgeHost: "GitHub.com" };
    confirmedGitlabHost(input);
    expect(input).toEqual({ forgeHost: "GitHub.com" });
  });
});
