import { join } from "node:path";
import type { Inbound, CodexControl } from "../codex-control";
import type { Lab, Worker } from "../lab";
import { quote } from "../lab";
export const textInput=(text:string)=>[{type:"text",text}];
export const cli=(lab:Lab)=>[Bun.which("bun")??"bun",join(lab.repo,"scripts/probes/harness/probe-cli.ts")].map(quote).join(" ");
export async function ready(c:CodexControl,w:Worker):Promise<any>{const end=Date.now()+90000;while(Date.now()<end){const r=await c.call("thread/read",{threadId:w.threadId,includeTurns:false});if(r.thread.status?.type==="idle")return c.call("thread/resume",{threadId:w.threadId,excludeTurns:true});await Bun.sleep(500);}throw new Error(`worker ${w.name} did not become idle`);}
export async function drive(c:CodexControl,w:Worker,text:string,timeout=180000,extra:Record<string,unknown>={}):Promise<Inbound[]>{
 await ready(c,w);const seen:Inbound[]=[];const off=c.onEvent(e=>{if(e.params.threadId===w.threadId)seen.push(e);});
 try{const r=await c.call("turn/start",{threadId:w.threadId,input:textInput(text),...extra});await c.next(e=>e.method==="turn/completed"&&e.params.threadId===w.threadId&&e.params.turn?.id===r.turn.id,timeout);return seen;}finally{off();}
}
export function ref(e:Inbound){return {requestId:e.id!,threadId:e.params.threadId,turnId:e.params.turnId,itemId:e.params.itemId};}
