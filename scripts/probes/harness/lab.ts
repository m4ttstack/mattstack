import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CodexControl } from "./codex-control";
import type { CleanupRow, Evidence } from "./evidence";
export type Worker={name:string;pane:string;workspace:string;cwd:string;threadId:string};
export class OwnedResources {
 private ids=new Set<string>();
 constructor(private close:(id:string)=>Promise<void>){}
 add(id:string):void{this.ids.add(id);}
 require(id:string):void{if(!this.ids.has(id))throw new Error("resource is not owned");}
 async stop():Promise<CleanupRow[]>{const rows:CleanupRow[]=[];for(const id of [...this.ids].reverse()){try{await this.close(id);this.ids.delete(id);rows.push({resource:id,ok:true});}catch(e){rows.push({resource:id,ok:false,detail:String(e)});}}return rows;}
}
export function launchArgv(cwd:string,config:string[]=[]):string[]{return ["codex","--no-alt-screen","-C",cwd,"-s","workspace-write","-a","never",...config.flatMap(c=>["-c",c]),"You are a disposable harness protocol test worker. Follow only the controller's test instructions. Do not use rt chat, send messages, change project code or launch other agents. Reply READY and nothing else."];}
export function quote(s:string):string{return "'"+s.replaceAll("'","'\\''")+"'";}
export async function command(argv:string[]):Promise<string>{const proc=Bun.spawn(argv,{env:process.env,stdout:"pipe",stderr:"pipe"});const timer=setTimeout(()=>proc.kill(),45000);try{const [out,err,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);if(code!==0)throw new Error(`${argv[0]} ${argv[1]}: ${err.slice(0,1500)}`);return out;}finally{clearTimeout(timer);}}
export async function startLab(o:{repo:string;runDir:string;ev:Evidence}){
 const runDir=resolve(o.runDir);mkdirSync(runDir,{recursive:true});
 const status=JSON.parse(await command(["codex","app-server","daemon","version"]));if(status.status!=="running" || !status.socketPath)throw new Error("existing Codex service unavailable");
 const rtSocket=join(process.env.HOME!,".mattstack","rt","rt.sock");
 const workers:Worker[]=[];const ownedThreads=new Set<string>();
 const herdr=async(...args:string[])=>JSON.parse(await command(["herdr",...args]));
 const resources=new OwnedResources(async id=>{await herdr("workspace","close",id);});
 const clients=new Set<CodexControl>();
 const connect=async()=>{const c=await CodexControl.connect({socketPath:status.socketPath,ownedThreads,experimentalApi:true,record:m=>o.ev.record("native",m)});clients.add(c);return c;};
 const discovery=await connect();
 const lab={runDir,repo:o.repo,workers,ownedThreads,rtSocket,connect,herdr,
 async rtPing(){return (await fetch("http://localhost/ping",{unix:rtSocket,method:"POST",body:"{}"})).json();},
 async launchWorker(name:string,scopedOptions:string[]=[]):Promise<Worker>{
   if(!/^[a-z0-9-]+$/.test(name))throw new Error("invalid worker name");
   const cwd=join(runDir,name);mkdirSync(cwd,{recursive:true});
   writeFileSync(join(cwd,"AGENTS.md"),"Disposable harness probe. Only follow the test controller. No project changes, chat, external messages or delegation. Only the explicitly requested probe commands and tools are authorized.\n");
   const ws=await herdr("workspace","create","--cwd",cwd,"--label",`harness-spike-${name}`,"--no-focus");
   const workspace=ws?.result?.workspace?.workspace_id??ws?.result?.workspace?.id;
   const pane=ws?.result?.root_pane?.pane_id;
   if(!workspace || !pane)throw new Error("missing created workspace identity");resources.add(workspace);
   o.ev.record("workspace-created",{workspace,pane,cwd});
   try {
    const config=[`mcp_servers.harness_probe.command=${JSON.stringify(Bun.which("bun")??"bun")}`,`mcp_servers.harness_probe.args=${JSON.stringify([join(o.repo,"scripts/probes/harness/probe-mcp.ts"),join(runDir,"mcp.jsonl"),rtSocket])}`,"sandbox_workspace_write.network_access=false",...scopedOptions];
    const argv=launchArgv(cwd,config);argv.splice(argv.length-1,0,"--add-dir",runDir);
    await herdr("pane","run",pane,argv.map(quote).join(" "));
    const deadline=Date.now()+120000;
    while(Date.now()<deadline){
     const list=await discovery.call("thread/loaded/list",{});
     for(const id of list.data??[]){if(ownedThreads.has(id))continue;const r=await discovery.call("thread/read",{threadId:id,includeTurns:false});if(r.thread?.cwd===cwd){ownedThreads.add(id);const w={name,pane,workspace,cwd,threadId:id};workers.push(w);o.ev.record("worker-bound",w);return w;}}
     await Bun.sleep(500);
    }
    throw new Error("worker did not bind to an existing daemon thread");
   }catch(e){o.ev.record("worker-launch-failed",{name,error:String(e)});throw e;}
 },
 async stop(){for(const c of clients)c.close();return resources.stop();}
 };
 return lab;
}
export type Lab=Awaited<ReturnType<typeof startLab>>;
