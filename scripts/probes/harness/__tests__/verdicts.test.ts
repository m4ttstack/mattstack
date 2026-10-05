import {expect,test} from "bun:test";
import {judgeCliAttribution,judgeMcpAttribution,judgeQuestionRecovery,judgeAsyncQuestion,judgePolicy,judgeSockets,judgeDelivery} from "../verdicts";
const workers=[{name:"w1",threadId:"T1"},{name:"w2",threadId:"T2"}];
test("CLI attribution requires both exact native ids, never inherited pane",()=>{
 const rows=workers.map(w=>({marker:w.name+"-cli",env:{CODEX_THREAD_ID:w.threadId,HERDR_PANE_ID:"wrong"}}));expect(judgeCliAttribution(workers,rows).verdict).toBe("proven");rows[0]!.env.CODEX_THREAD_ID="T2";expect(judgeCliAttribution(workers,rows).verdict).toBe("blocked");expect(judgeCliAttribution(workers,[]).verdict).toBe("not-run");
});
test("MCP attribution rejects substrings, mixed metadata and inconsistent fields",()=>{
 const rows=workers.map(w=>({kind:"call",marker:w.name+"-mcp",pid:1,meta:{codex:{threadId:w.threadId}},env:{}}));
 expect(judgeMcpAttribution(workers,rows,"codex.threadId").verdict).toBe("proven");
 expect(judgeMcpAttribution(workers,rows).verdict).toBe("partial");
 for(const bad of [{loaded:["T1","T2"]},{text:"T1 extra"},{other:"T1"}]){rows[0]!.meta=bad as any;expect(judgeMcpAttribution(workers,rows,"codex.threadId").verdict).not.toBe("proven");}
 const envRows=workers.map((w,i)=>({kind:"call",marker:w.name+"-mcp",pid:i+1,env:{CODEX_THREAD_ID:w.threadId}}));expect(judgeMcpAttribution(workers,envRows).verdict).toBe("proven");
});
test("question recovery requires same native item and confirmed completion",()=>{
 const first={requestId:0,threadId:"T1",turnId:"U1",itemId:"I1"};const obs={first,replayed:{...first,requestId:3},completed:true,answerObserved:true};
 expect(judgeQuestionRecovery(obs).verdict).toBe("proven");expect(judgeQuestionRecovery({...obs,replayed:{...first,itemId:"I9"}}).verdict).toBe("blocked");expect(judgeQuestionRecovery({...obs,completed:false}).verdict).toBe("partial");
 expect(judgeAsyncQuestion({async:true,completed:false}).verdict).not.toBe("proven");expect(judgeAsyncQuestion({async:false,completed:true}).verdict).not.toBe("proven");
});
test("policy and socket judges require actual enforcement and restricted MCP evidence",()=>{
 const good={hooksListed:2,toolBlocked:true,toolRan:false,stopContinued:true};expect(judgePolicy(good).verdict).toBe("proven");expect(judgePolicy({...good,hooksListed:0}).verdict).toBe("blocked");expect(judgePolicy({...good,toolRan:true}).verdict).toBe("blocked");expect(judgePolicy({...good,stopContinued:false}).verdict).toBe("partial");
 expect(judgeSockets({mcp:true,restricted:true}).verdict).toBe("proven");expect(judgeSockets({mcp:true,restricted:false}).verdict).toBe("partial");
});
test("consumption evidence never proves untested daemon restart",()=>{
 expect(judgeDelivery({consumed:true}).verdict).toBe("partial");expect(judgeDelivery({consumed:true}).observations.join(" ")).toContain("restart: unobserved");
 expect(judgeDelivery({consumed:false}).consequence).toContain("queued");
});
