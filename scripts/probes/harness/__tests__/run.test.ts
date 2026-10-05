import {expect,test} from "bun:test";
import {parseArgs,finalizeRun,runSelected} from "../run";
test("requires explicit cases and output and rejects unknown cases",()=>{
 expect(()=>parseArgs(["--live"])).toThrow();expect(()=>parseArgs(["--cases","G9","--out","x"])).toThrow();
 expect(parseArgs(["--live","--cases","G3","--out","x"]).cases).toEqual(["G3"]);
});
test("case filtering never runs the unselected async or restart experiment",async()=>{
 const seen:string[]=[];await runSelected(["G3"],{G3:async()=>{seen.push("G3");},G4:async()=>{seen.push("G4");},G7:async()=>{seen.push("G7");}});expect(seen).toEqual(["G3"]);
});
test("failed diagnostics still attempt cleanup and report",async()=>{
 const seen:string[]=[];await finalizeRun({workers:[{name:"w",pane:"p"}],herdr:async()=>{throw new Error("read failed");},stop:async()=>{seen.push("stop");return[{resource:"p",ok:true}];}} as any,{record:()=>{throw new Error("disk failed");},addCleanup:()=>{throw new Error("sink failed");},write:()=>{seen.push("write");return "r";}} as any);expect(seen).toEqual(["stop","write"]);
});
