import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { safeAppend } from "./evidence";
import { redactDeep } from "../../../lib/mcp/redact";
import { envSnapshot } from "./probe-cli";
type Policy={block?:string[];blockOnce?:boolean};
export function hookRow(event:string,payload:unknown,decision:unknown,env:Record<string,string|undefined>):unknown{return redactDeep({at:Date.now(),event,pid:process.pid,env:envSnapshot(env),payload,decision});}
export function decideHook(event:string,payload:any,policy:Policy){const blocked=event==="Stop"?policy.blockOnce===true:(policy.block??[]).includes(payload.tool_name??payload.toolName??payload.tool?.name);return {exitCode:blocked?2:0,stdout:blocked?"":"{}",stderr:blocked?"Harness spike refused this action. If this is a Stop, reply CONTINUED now.":"",consumeOnce:blocked && event==="Stop"};}
if(import.meta.main){const [file,event,policyFile]=process.argv.slice(2);if(!file||!event||!policyFile)throw new Error("missing hook arguments");const payload=JSON.parse(await new Response(Bun.stdin.stream()).text());const policy:Policy=existsSync(policyFile)?JSON.parse(readFileSync(policyFile,"utf8")):{};const decision=decideHook(event,payload,policy);if(decision.consumeOnce)writeFileSync(policyFile,JSON.stringify({...policy,blockOnce:false}));safeAppend(file,hookRow(event,payload,decision,process.env));if(decision.stdout)process.stdout.write(decision.stdout);if(decision.stderr)process.stderr.write(decision.stderr);process.exit(decision.exitCode);}
