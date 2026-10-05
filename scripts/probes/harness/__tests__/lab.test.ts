import { expect,test } from "bun:test";
import { OwnedResources, launchArgv, parseHerdrOutput } from "../lab";
test("partial launch cleanup attempts each owned workspace even after failure",async()=>{
 const closed:string[]=[];const resources=new OwnedResources(async id=>{closed.push(id);if(id==="w1")throw new Error("close failed");});
 resources.add("w1");resources.add("w2");const rows=await resources.stop();expect(closed).toEqual(["w2","w1"]);expect(rows.map(r=>r.ok)).toEqual([true,false]);
 expect(()=>resources.require("foreign")).toThrow("owned");expect((await resources.stop()).length).toBe(1);
});
test("worker launch preserves authentication and scopes config to invocation",()=>{
 const args=launchArgv("/repo/worker",["mcp_servers.probe.command=\"bun\""]);
 expect(args).toContain("-C");expect(args).toContain("/repo/worker");expect(args).toContain("mcp_servers.probe.command=\"bun\"");
 expect(args.some(a=>/^(HOME|CODEX_HOME)=/.test(a))).toBe(false);expect(args).not.toContain("daemon");
});

test("successful pane run with empty stdout is not a failed launch",()=>{expect(parseHerdrOutput("")).toEqual({});expect(parseHerdrOutput('{"result":{"id":"w1"}}')).toEqual({result:{id:"w1"}});});
test("shared-service probes explicitly connect to the discovered endpoint",()=>{
 const args=launchArgv("/repo/worker",[],"/home/codex/control.sock");
 expect(args.slice(args.indexOf("--remote"),args.indexOf("--remote")+2)).toEqual(["--remote","unix:///home/codex/control.sock"]);
});
