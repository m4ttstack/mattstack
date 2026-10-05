import type {Lab} from "../lab";
import type {Evidence,QuestionId,CaseResult} from "../evidence";
import {judgeQuestionRecovery,judgeAsyncQuestion} from "../verdicts";
import {ready,ref,textInput} from "./common";
export async function run(lab:Lab,ev:Evidence,selected:QuestionId[]):Promise<CaseResult[]>{const results:CaseResult[]=[];
 for(const id of selected.filter(x=>x==="G3"||x==="G4")){
 const w=await lab.launchWorker(id.toLowerCase());let c=await lab.connect();
 try{const state=await ready(c,w);const isAsync=id==="G4";
 const pending=c.next(e=>e.kind==="request"&&e.method==="item/tool/requestUserInput"&&e.params.threadId===w.threadId,90000).catch(()=>undefined);
 const turn=await c.call("turn/start",{threadId:w.threadId,collaborationMode:{mode:isAsync?"default":"plan",settings:{model:state.model,reasoning_effort:"low",developer_instructions:null}},input:textInput(`Use ${isAsync?"request_user_input_async, the non-blocking variant":"request_user_input, the synchronous blocking variant"} with question id choice, header Choice, question Choose Alpha or Beta, options Alpha and Beta. Wait for the answer and then say only the chosen word. This is a disposable protocol test; do not create a plan or use other tools.`)});
 const first=await pending;ev.record(`${id}-first`,first??{request:"unobserved",turn:turn.turn.id});
 if(id==="G3"){
 c.close();c=await lab.connect();const replay=c.next(e=>e.kind==="request"&&e.method==="item/tool/requestUserInput"&&e.params.threadId===w.threadId,15000).catch(()=>undefined);
 await c.call("thread/resume",{threadId:w.threadId,excludeTurns:true});const r=await replay;const stateAfter=await c.call("thread/read",{threadId:w.threadId,includeTurns:false});ev.record("G3-reconnect",{request:r,status:stateAfter.thread.status});
 let completed=false;let answerObserved=false;
 if(first&&r&&r.params.itemId===first.params.itemId&&r.params.turnId===first.params.turnId){const off=c.onEvent(e=>{if(e.params.threadId===w.threadId&&e.params.turnId===first.params.turnId&&e.method==="item/completed"&&e.params.item?.type==="agentMessage"&&/beta/i.test(e.params.item.text??""))answerObserved=true;});const done=c.next(e=>e.method==="turn/completed"&&e.params.threadId===w.threadId&&e.params.turn?.id===first.params.turnId,90000).then(()=>true,()=>false);c.respond(r,{answers:{choice:{answers:["Beta"]}}});completed=await done;off();}
 results.push(judgeQuestionRecovery({first:first?ref(first):undefined,replayed:r?ref(r):undefined,completed,answerObserved}));
 }else{let completed=false;const asyncNative=first?.params.isBlocking===false;if(first&&asyncNative){const done=c.next(e=>e.method==="item/completed"&&e.params.threadId===w.threadId&&e.params.item?.id===first.params.itemId,60000).then(()=>true,()=>false);c.respond(first,{answers:{choice:{answers:["Beta"]}}});completed=await done;}results.push(judgeAsyncQuestion({async:asyncNative,completed}));}
 }finally{c.close();}
 }return results;
}
