import { test, expect } from "bun:test";
import { executeInitPlan, type ExecSeam } from "../init-exec.ts";
import { InvalidMachineKeyError, InvalidProfileKeyError, ProfileChoiceRequiredError, ProfileNameCollisionError, UnknownProfileFlagError } from "../init-plan.ts";
import { InvalidZoneError, ZoneOwnedByOthersError } from "../snapshot-owners.ts";

const DASH = new RegExp(`[${String.fromCodePoint(0x2013)}${String.fromCodePoint(0x2014)}]`);

test("the machine profile and machine name errors read as plain sentences", () => {
  const messages = [
    new InvalidMachineKeyError("a/b").message,
    new UnknownProfileFlagError("ghost", ["desktop", "laptop"]).message,
    new UnknownProfileFlagError("ghost", []).message,
    new ProfileChoiceRequiredError(["desktop", "laptop"]).message,
    new InvalidProfileKeyError("..").message,
    new ProfileNameCollisionError("sample-mbp").message,
  ];
  expect(messages).toEqual([
    '"a/b" cannot name a Mac: a name cannot be empty, ".", "..", or hold a slash or a backslash.',
    "There is no machine profile called ghost yet (the profiles are desktop, laptop). Name it as a new profile to create it.",
    "There is no machine profile called ghost yet (there are none yet). Name it as a new profile to create it.",
    "This Mac could use any of 2 machine profiles (desktop, laptop), and there is no terminal to ask which.",
    '".." cannot name a machine profile: a name cannot be empty, ".", "..", or hold a slash or a backslash.',
    "This Mac's default profile name, sample-mbp, already belongs to another Mac's profile. Give the new profile a name of its own.",
  ]);
  expect(new UnknownProfileFlagError("ghost", []).profile).toBe("ghost");
  for (const message of messages) expect(message).not.toMatch(DASH);
});

test("the claim errors name the path and the owner, with no flag in the sentence", () => {
  expect(new InvalidZoneError("/abs").message).toBe('"/abs" is not a path rt can track: a path must not be empty, start with a slash, hold a backslash, or have a "." or ".." part.');
  expect(new ZoneOwnedByOthersError("prefs/", "sample@sample-mbp").message).toBe('"prefs/" is already claimed by sample@sample-mbp');
});

test("each init step's progress reads as a plain sub-line", async () => {
  const lines: string[] = [];
  const seam: ExecSeam = {
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
    writeFile: async () => {},
    mkdirp: async () => {},
    exists: async (path) => path === "user/snapshot-owners.jsonc",
    blocksSymlink: async () => false,
    writeSymlink: async () => {},
  };
  await executeInitPlan(
    [
      { kind: "ensureStateDirs", dirs: ["rt"] },
      { kind: "cloneUserRepo", url: "https://forge.example.test/sample/home.git" },
      { kind: "initUserRepo" },
      { kind: "commitInitialUserRepo" },
      { kind: "writeGitignore", content: "" },
      { kind: "writeOwners", content: "" },
      { kind: "writeMachineKey", key: "sample-mbp" },
      { kind: "ensureProfileDir", key: "sample-mbp" },
      { kind: "writeSkillsSymlink" },
    ],
    seam,
    (line) => lines.push(line),
  );
  expect(lines).toEqual([
    "Creating rt/",
    "Cloning https://forge.example.test/sample/home.git",
    "Starting a repo with no remote",
    "Committing the first version",
    "Adding user/.gitignore",
    "user/snapshot-owners.jsonc is already there, so rt left it",
    "Naming this Mac sample-mbp",
    "Creating the profile folder for sample-mbp",
    "Linking your skills list",
  ]);
});

test("a real file in the way of the skills link says so plainly", async () => {
  const seam: ExecSeam = {
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
    writeFile: async () => {},
    mkdirp: async () => {},
    exists: async () => false,
    blocksSymlink: async () => true,
    writeSymlink: async () => {},
  };
  expect(await executeInitPlan([{ kind: "writeSkillsSymlink" }], seam, () => {})).toEqual({
    ok: false,
    failedStep: "writeSkillsSymlink",
    stderr: "A real file is already at skills.jsonc, and rt will not overwrite it",
  });
});
