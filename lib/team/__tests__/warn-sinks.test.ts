import { test, expect, beforeEach, afterEach } from "bun:test";
import * as out from "../../ui/out.ts";
import { captureOut } from "../../ui/__tests__/capture-out.ts";
import { setWarningLog, __test__ as warnTest } from "../../ui/warn.ts";
import { realMintInviteSeams } from "../invite.ts";
import { realJoinRedeemSeams } from "../join.ts";
import { realMembersSeams } from "../members.ts";

let io: ReturnType<typeof captureOut>;
let logged: Array<{ module: string; message: string }>;

beforeEach(() => {
  io = captureOut();
  out.__test__.setHuman(() => false);
  warnTest.reset();
  logged = [];
  setWarningLog((module, message) => {
    logged.push({ module, message });
  });
});
afterEach(() => {
  warnTest.reset();
  io.restore();
});

const sinks = {
  invite: () => realMintInviteSeams().warn,
  join: () => realJoinRedeemSeams().warn,
  members: () => realMembersSeams().warn,
};

for (const [name, sink] of Object.entries(sinks)) {
  test(`${name}: the default sink logs the message and shows the plain copy on stderr`, () => {
    sink()("board peering: the switchboard register answered 500", { title: "This invite will not connect their board", hint: "invite their board again after they join" });
    expect(logged).toEqual([{ module: "team", message: "board peering: the switchboard register answered 500" }]);
    expect(io.stderr()).toBe("[warning] This invite will not connect their board  invite their board again after they join\n");
    expect(io.stdout()).toBe("");
  });

  test(`${name}: a warning with no copy of its own shows its message`, () => {
    sink()("board.members is not a list");
    expect(io.stderr()).toBe("[warning] board.members is not a list\n");
    expect(io.stdout()).toBe("");
  });
}
