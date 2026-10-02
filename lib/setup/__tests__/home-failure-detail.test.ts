import { describe, expect, test } from "bun:test";
import { INIT_STEP_FAILED } from "../../home/init-exec.ts";
import { failureDetail, homeInitDoneDetail, homeInitRemedy } from "../steps/home.ts";

describe("failureDetail", () => {
  // The exact shape that reached CI: bun's crash frame arrived first and the
  // real exception was thrown away, so the app showed a source line.
  test("skips bun crash frames and reports the exception", () => {
    const stderr = [
      "79828 |     console.error(`[age-key] ${cmd.join(\" \")}`);",
      "                 ^",
      "error: age-keygen exited 127: command not found",
      "    at run (/$bunfs/root/rt:79828:13)",
    ].join("\n");
    expect(failureDetail(stderr)).toBe("error: age-keygen exited 127: command not found");
  });

  test("a clean single-line failure is unchanged", () => {
    expect(failureDetail("fatal: could not read Username for 'https://github.com'")).toBe(
      "fatal: could not read Username for 'https://github.com'",
    );
  });

  test("falls back to the first non-frame line when nothing names an error", () => {
    expect(failureDetail("12 | x\n    ^\nsomething unusual happened")).toBe("something unusual happened");
  });

  test("empty stderr yields an empty detail rather than throwing", () => {
    expect(failureDetail("   \n  \n")).toBe("");
  });

  // rt home init leads with the failed step's title and puts what the child
  // said under "what it said:"; the title alone hides the cause.
  test("a home init failure title carries the line under it that names the error", () => {
    const stderr = [INIT_STEP_FAILED.commitInitialUserRepo, "what it said:", "  fatal: empty ident name not allowed"].join("\n");
    expect(failureDetail(stderr)).toBe(`${INIT_STEP_FAILED.commitInitialUserRepo}: fatal: empty ident name not allowed`);
  });

  test("a home init failure title with no error word under it carries the first line it said", () => {
    const stderr = [INIT_STEP_FAILED.cloneUserRepo, "what it said:", "  remote: Repository not found."].join("\n");
    expect(failureDetail(stderr)).toBe(`${INIT_STEP_FAILED.cloneUserRepo}: remote: Repository not found.`);
  });

  test("a home init failure title with nothing under it still reports itself", () => {
    expect(failureDetail(INIT_STEP_FAILED.cloneUserRepo)).toBe(INIT_STEP_FAILED.cloneUserRepo);
  });

  // out.fail tags its title when something already reached stderr in the same process.
  test("a tagged home init failure title after an unrelated line is still found", () => {
    const stderr = [
      "[warning] rt could not read one of your settings",
      `[failed] ${INIT_STEP_FAILED.cloneUserRepo}`,
      "what it said:",
      "  remote: Permission denied",
    ].join("\n");
    expect(failureDetail(stderr)).toBe(`${INIT_STEP_FAILED.cloneUserRepo}: remote: Permission denied`);
  });

  test("rt's own why and next lines are guidance, not the error", () => {
    const stderr = ["rt could not refresh one of its own pieces", "  why: The step marked failed above is one rt needs.", "  next: rt home init"].join("\n");
    expect(failureDetail(stderr)).toBe("rt could not refresh one of its own pieces");
  });

  test("a refusal reads without its plain tag", () => {
    const stderr = ["[refused] Your home folder is set up, apart from your skills link", "  why: /x/skills.jsonc is a real file, and rt will not overwrite it."].join("\n");
    expect(failureDetail(stderr)).toBe("Your home folder is set up, apart from your skills link");
  });
});

// ─── remedy for a missing binary ─────────────────────────────────────────────

describe("homeInitRemedy: missing executable", () => {
  // The exact stderr that dead-ended every clean-Mac install. The old remedy
  // was "Check the error above, then Retry" — true, and unactionable.
  test("names the tool, and maps age-keygen to the package that provides it", () => {
    const remedy = homeInitRemedy('error: Executable not found in $PATH: "age-keygen"');
    expect(remedy).toContain("age-keygen");
    expect(remedy).toContain("Reinstall mattstack.app");
    expect(remedy).toContain("brew install age"); // the formula is `age`, not `age-keygen`
  });

  test("a tool whose name matches its package is not rewritten", () => {
    expect(homeInitRemedy('error: Executable not found in $PATH: "sops"')).toContain("brew install sops");
  });

  // The missing-binary check runs first precisely because this stderr would
  // otherwise fall through to the auth heuristics.
  test("takes precedence over the auth remedy", () => {
    const remedy = homeInitRemedy('error: Executable not found in $PATH: "sops"\npermission denied');
    expect(remedy).not.toContain("gh auth login");
  });

  test("a genuine auth failure still gets the auth remedy", () => {
    expect(homeInitRemedy('fatal: could not read Username for \'https://github.com\'')).toContain("gh auth login");
  });
});

describe("homeInitDoneDetail", () => {
  test("the done detail is home init's ending line without its tag", () => {
    expect(homeInitDoneDetail("[ok] Clone your home repo  https://forge.example.test/sample/home.git\n[ok] This Mac is set up  /fake-home/.mattstack\n")).toBe(
      "This Mac is set up: /fake-home/.mattstack",
    );
  });
});

describe("homeInitRemedy: the clone step", () => {
  test("a bare permission denial under the clone title is auth-shaped, and the same denial under another step is not", () => {
    const auth = homeInitRemedy("fatal: Authentication failed for 'https://forge.example.test/sample/home.git/'");
    expect(homeInitRemedy([INIT_STEP_FAILED.cloneUserRepo, "what it said:", "  remote: Permission denied"].join("\n"))).toBe(auth);
    expect(homeInitRemedy([INIT_STEP_FAILED.initUserRepo, "what it said:", "  fatal: cannot mkdir user: Permission denied"].join("\n"))).not.toBe(auth);
  });

  test("a tagged clone title after an unrelated line is still the clone step", () => {
    const auth = homeInitRemedy("fatal: Authentication failed for 'https://forge.example.test/sample/home.git/'");
    const stderr = [
      "[warning] rt could not read one of your settings",
      `[failed] ${INIT_STEP_FAILED.cloneUserRepo}`,
      "what it said:",
      "  remote: Permission denied",
    ].join("\n");
    expect(homeInitRemedy(stderr)).toBe(auth);
  });
});
