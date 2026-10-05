export type Inbound = { kind: "request" | "notification"; id?: number | string; method: string; params: any; connection: string };
type Options = { socketPath: string; ownedThreads: Set<string>; experimentalApi: boolean; timeoutMs?: number; record?: (message: Inbound) => void };
const READ = new Set(["thread/loaded/list", "hooks/list", "config/read", "model/list", "experimentalFeature/list"]);
export class CodexControl {
  readonly connection = crypto.randomUUID();
  private seq = 0;
  private closed = false;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private requests = new Map<string | number, Inbound>();
  private buffer: Inbound[] = [];
  private waiters = new Set<{ match: (m: Inbound) => boolean; resolve: (m: Inbound) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Set<(m: Inbound) => void>();
  private constructor(private ws: WebSocket, private options: Options) {
    ws.onmessage = e => this.receive(String(e.data));
    ws.onclose = () => this.fail(new Error("closed"));
    ws.onerror = () => this.fail(new Error("socket error"));
  }
  static async connect(options: Options): Promise<CodexControl> {
    const ws = new WebSocket(`ws+unix://${options.socketPath}`);
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{ws.close();reject(new Error("connect timed out"));},options.timeoutMs??25000);
      ws.onopen=()=>{clearTimeout(timer);resolve();}; ws.onerror=()=>{clearTimeout(timer);reject(new Error("connect failed"));};
    });
    const c=new CodexControl(ws,options);
    try { await c.call("initialize",{clientInfo:{name:"mattstack_harness_gate_spike",version:"0.0.0"},capabilities:{experimentalApi:options.experimentalApi}});
      ws.send(JSON.stringify({method:"initialized",params:{}})); return c;
    } catch(e) {c.close();throw e;}
  }
  async call<T=any>(method:string,params:any):Promise<T> {
    if(this.closed) throw new Error("closed");
    const discovery=method==="thread/read" && params.includeTurns===false;
    if(method!=="initialize" && !READ.has(method) && !discovery && !this.options.ownedThreads.has(params?.threadId)) throw new Error("thread is not owned");
    const id=++this.seq;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${method} timed out`));},this.options.timeoutMs??25000);
      this.pending.set(id,{resolve,reject,timer});
      try {this.ws.send(JSON.stringify({id,method,params}));} catch(e) {clearTimeout(timer);this.pending.delete(id);reject(e);}
    });
  }
  respond(request:Inbound,result:unknown):void {
    if(request.connection!==this.connection) throw new Error("wrong connection");
    if(this.closed || request.kind!=="request" || request.id===undefined || this.requests.get(request.id)!==request || !this.options.ownedThreads.has(request.params?.threadId)) throw new Error("request is not owned or already answered");
    this.ws.send(JSON.stringify({id:request.id,result})); this.requests.delete(request.id);
  }
  onEvent(fn:(m:Inbound)=>void):()=>void {this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};}
  next(match:(m:Inbound)=>boolean,timeoutMs:number):Promise<Inbound> {
    const i=this.buffer.findIndex(match); if(i>=0) return Promise.resolve(this.buffer.splice(i,1)[0]!);
    if(this.closed) return Promise.reject(new Error("closed"));
    return new Promise((resolve,reject)=>{
      const w={match,resolve,reject,timer:setTimeout(()=>{this.waiters.delete(w);reject(new Error("no matching message"));},timeoutMs)}; this.waiters.add(w);
    });
  }
  private receive(raw:string):void {
    let m:any;try{m=JSON.parse(raw);}catch{this.fail(new Error("invalid JSON"));return;}
    if(m.method===undefined && m.id!==undefined) {const p=this.pending.get(m.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(new Error(`${m.error.code}: ${m.error.message}`)):p.resolve(m.result);return;}
    if(!this.options.ownedThreads.has(m.params?.threadId)) return;
    const event:Inbound={kind:m.id===undefined?"notification":"request",id:m.id,method:m.method,params:m.params,connection:this.connection};
    if(event.kind==="request") this.requests.set(event.id!,event);
    this.options.record?.(event);for(const listener of this.listeners) listener(event);
    let delivered=false;for(const w of [...this.waiters]){if(w.match(event)){clearTimeout(w.timer);this.waiters.delete(w);w.resolve(event);delivered=true;}}
    if(!delivered){this.buffer.push(event);if(this.buffer.length>2000)this.buffer.shift();}
  }
  private fail(error:Error):void {this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();for(const w of this.waiters){clearTimeout(w.timer);w.reject(error);}this.waiters.clear();}
  close():void {this.fail(new Error("closed"));this.requests.clear();this.ws.close();}
}
