import {join} from "node:path";
import {writeFileSync} from "node:fs";
import type {Lab} from "../lab";
import {quote} from "../lab";
import type {Evidence} from "../evidence";
import {readJsonl} from "../evidence";
import {judgePolicy} from "../verdicts";
import {cli,drive,ready} from "./common";
export async function run(lab:Lab,ev:Evidence){
 const log=join(lab.runDir,"hooks.jsonl");const pre=join(lab.runDir,"pre.json");const stop=join(lab.runDir,"stop.json");writeFileSync(pre,"{}");writeFileSync(stop,"{}");
 const hook=(event:string,file:string)=>[Bun.which("bun")??"bun",join(lab.repo,"scripts/probes/harness/probe-hook.ts"),log,event,file].map(quote).join(" ");
 const overrides:Record<string,unknown>={"features.hooks":true};
 for(const [event,file] of [["PreToolUse",pre],["Stop",stop],["SessionStart",pre]])overrides[`hooks.${event}`]=[{hooks:[{type:"command",command:hook(event!,file!)}]}];
 const w=await lab.launchWorker("p1",overrides);const c=await lab.connect();try{await ready(c,w);const inventory=await c.call("hooks/list",{cwds:[w.cwd]});const hooks=(inventory.data??[]).flatMap((e:any)=>e.hooks??[]).filter((h:any)=>h.command?.includes("probe-hook.ts"));ev.record("G5-inventory",{hooks,errors:(inventory.data??[]).flatMap((e:any)=>e.errors??[])});
 const listed=hooks.filter((h:any)=>h.enabled&&["preToolUse","stop"].includes(h.eventName)&&["trusted","managed"].includes(h.trustStatus)).length;
 const file=join(lab.runDir,"policy-cli.jsonl");await drive(c,w,`Run exactly: ${cli(lab)} record ${quote(file)} allowed. Reply DONE.`);
 const shell=readJsonl(log).find(r=>r.event==="PreToolUse")?.payload?.tool_name;let toolBlocked=false;let toolRan=false;let stopContinued=false;
 if(shell){writeFileSync(pre,JSON.stringify({block:[shell]}));const n=readJsonl(log).length;await drive(c,w,`Run exactly: ${cli(lab)} record ${quote(file)} forbidden. If refused, reply REFUSED and do not retry.`);toolBlocked=readJsonl(log).slice(n).some(r=>r.event==="PreToolUse"&&r.decision.exitCode===2);toolRan=readJsonl(file).some(r=>r.marker==="forbidden");writeFileSync(pre,"{}");writeFileSync(stop,JSON.stringify({blockOnce:true}));const before=readJsonl(log).length;await drive(c,w,"Reply DONE.");const stops=readJsonl(log).slice(before).filter(r=>r.event==="Stop");stopContinued=stops.length>=2&&stops[0].decision.consumeOnce===true&&stops.at(-1).decision.exitCode===0;}
 ev.record("G5-hook-rows",readJsonl(log));return [judgePolicy({hooksListed:listed,toolBlocked,toolRan,stopContinued})];
 }finally{c.close();writeFileSync(pre,"{}");writeFileSync(stop,"{}");}
}
