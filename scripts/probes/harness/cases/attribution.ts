import {join} from "node:path";
import type {Lab} from "../lab";
import {quote} from "../lab";
import type {Evidence,QuestionId,CaseResult} from "../evidence";
import {readJsonl} from "../evidence";
import {judgeCliAttribution,judgeMcpAttribution} from "../verdicts";
import {cli,drive} from "./common";
export async function run(lab:Lab,ev:Evidence,selected:QuestionId[]):Promise<CaseResult[]>{
 const workers=[await lab.launchWorker("w1"),await lab.launchWorker("w2")];const ctl=await lab.connect();const file=join(lab.runDir,"cli.jsonl");
 try{await Promise.all(workers.map(w=>drive(ctl,w,[selected.includes("G1")?`Run exactly this shell command: ${cli(lab)} record ${quote(file)} ${w.name}-cli`:"",selected.includes("G2")?`Call the MCP tool probe_whoami (server harness_probe) with marker ${w.name}-mcp.`:"","Reply DONE."].join("\n"))));}finally{ctl.close();}
 const mcp=readJsonl(join(lab.runDir,"mcp.jsonl"));ev.record("attribution-mcp",mcp);const rows=readJsonl(file);ev.record("attribution-cli",rows);
 return [selected.includes("G1")?judgeCliAttribution(workers,rows):null,selected.includes("G2")?judgeMcpAttribution(workers,mcp):null].filter(Boolean) as CaseResult[];
}
