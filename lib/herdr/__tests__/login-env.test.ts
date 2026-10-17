import { expect, test } from "bun:test";
import { herdrServerEnv, LOGIN_ENV_MARKER, loginShellEnv } from "../login-env.ts";

test("loginShellEnv reads PATH, HOME, SHELL, TMPDIR and LANG from the login shell probe", async () => {
  const seen: string[][] = [];
  const env = await loginShellEnv(async (argv) => {
    seen.push(argv);
    return { exitCode: 0, stdout: `${LOGIN_ENV_MARKER}\n/opt/acme/bin:/usr/bin\n/Users/dev1\n/bin/zsh\n/var/tmp/dev1/\nen_US.UTF-8\n` };
  });
  expect(seen[0]?.slice(0, 2)).toEqual(["zsh", "-lc"]);
  expect(env).toEqual({
    PATH: "/opt/acme/bin:/usr/bin",
    HOME: "/Users/dev1",
    SHELL: "/bin/zsh",
    TMPDIR: "/var/tmp/dev1/",
    LANG: "en_US.UTF-8",
  });
});

test("loginShellEnv leaves out a key the login shell left empty", async () => {
  const env = await loginShellEnv(async () => ({ exitCode: 0, stdout: `${LOGIN_ENV_MARKER}\n/usr/bin\n/Users/dev1\n/bin/zsh\n\n\n` }));
  expect(env).toEqual({ PATH: "/usr/bin", HOME: "/Users/dev1", SHELL: "/bin/zsh" });
});

test("loginShellEnv reads only the lines after the marker, past anything the profile printed", async () => {
  const env = await loginShellEnv(async () => ({
    exitCode: 0,
    stdout: `Welcome to acme\nnvm: using node 20\n${LOGIN_ENV_MARKER}\n/opt/acme/bin:/usr/bin\n/Users/dev1\n/bin/zsh\n/var/tmp/dev1/\nen_US.UTF-8\n`,
  }));
  expect(env).toEqual({
    PATH: "/opt/acme/bin:/usr/bin",
    HOME: "/Users/dev1",
    SHELL: "/bin/zsh",
    TMPDIR: "/var/tmp/dev1/",
    LANG: "en_US.UTF-8",
  });
});

test("loginShellEnv is empty when the marker never printed", async () => {
  expect(await loginShellEnv(async () => ({ exitCode: 0, stdout: "/usr/bin\n/Users/dev1\n/bin/zsh\n\n\n" }))).toEqual({});
});

test("loginShellEnv is empty when the probe exits non-zero", async () => {
  expect(await loginShellEnv(async () => ({ exitCode: 1, stdout: "/usr/bin\n" }))).toEqual({});
});

test("loginShellEnv is empty when the probe throws", async () => {
  expect(await loginShellEnv(async () => { throw new Error("no zsh"); })).toEqual({});
});

const caller = {
  PATH: "/usr/bin:/bin",
  HOME: "/Users/dev1",
  SHELL: "/bin/bash",
  TMPDIR: "/tmp/caller/",
  LANG: "C",
  USER: "dev1",
  LOGNAME: "dev1",
  HERDR_THEME: "acme-dark",
  HERDR_SOCKET_PATH: "/tmp/acme.sock",
  HERDR_PANE_ID: "w1:p1",
  HERDR_MACOS_SERVER_CONTEXT: "app",
  RT_BATCH: "1",
  RT_HOME: "/tmp/rt",
  NODE_OPTIONS: "--inspect",
  UNSET: undefined,
};
const login = {
  PATH: "/opt/acme/bin:/usr/bin",
  HOME: "/Users/dev1",
  SHELL: "/bin/zsh",
  TMPDIR: "/var/tmp/dev1/",
  LANG: "en_US.UTF-8",
};

test("herdrServerEnv builds the server env from the login shell, the caller's identity and HERDR_* only", () => {
  expect(herdrServerEnv(caller, login, { HERDR_SESSION: "bg" })).toEqual({
    PATH: "/opt/acme/bin:/usr/bin",
    HOME: "/Users/dev1",
    SHELL: "/bin/zsh",
    TMPDIR: "/var/tmp/dev1/",
    LANG: "en_US.UTF-8",
    USER: "dev1",
    LOGNAME: "dev1",
    HERDR_THEME: "acme-dark",
    HERDR_SESSION: "bg",
    HERDR_MACOS_SERVER_CONTEXT: "user",
  });
});

test("herdrServerEnv sets the user server context even when extra asks for another", () => {
  expect(herdrServerEnv(caller, login, { HERDR_MACOS_SERVER_CONTEXT: "app" }).HERDR_MACOS_SERVER_CONTEXT).toBe("user");
});

test("herdrServerEnv falls back to the caller's PATH, HOME, SHELL, TMPDIR and LANG when the login probe failed", () => {
  const env = herdrServerEnv(caller, {});
  expect(env.PATH).toBe("/usr/bin:/bin");
  expect(env.HOME).toBe("/Users/dev1");
  expect(env.SHELL).toBe("/bin/bash");
  expect(env.TMPDIR).toBe("/tmp/caller/");
  expect(env.LANG).toBe("C");
});
