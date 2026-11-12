import {spawn} from 'node:child_process';
import {existsSync,createWriteStream} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {Backend} from './backend.mjs';
import {mediaPaths,ROOT} from './runtime-paths.mjs';

async function freePort(){const s=net.createServer();await new Promise((ok,no)=>{s.once('error',no);s.listen(0,'127.0.0.1',ok);});const p=s.address().port;await new Promise(ok=>s.close(ok));return p;}
export class StandaloneBackend extends Backend {
  constructor(dataDir){super({base:'http://127.0.0.1:1',keyFile:path.join(dataDir,'backend','api-key.txt')});this.mode='standalone';this.home=path.join(dataDir,'backend');this.proxyFile=path.join(this.home,'data','proxies.json');this.problem=null;}
  async start(){
    await mkdir(this.home,{recursive:true});
    try{this.key=(await readFile(this.keyFile,'utf8')).trim();}catch(e){if(e.code!=='ENOENT')throw e;this.key=randomBytes(32).toString('hex');await writeFile(this.keyFile,this.key,{flag:'wx',mode:0o600});}
    const python=mediaPaths().python;
    if(!existsSync(python)){this.problem='Chưa cài runtime độc lập. Chạy Setup-Muse-Web.cmd rồi Restart-Muse-Web.cmd.';return;}
    let previous;try{previous=JSON.parse(await readFile(path.join(this.home,'runtime-process.json'),'utf8'));}catch{}
    if(previous?.pid){for(let i=0;i<100;i++){let alive=false;try{process.kill(previous.pid,0);alive=true;}catch(e){alive=e.code!=='ESRCH';}if(!alive)break;if(i===99){this.problem='Backend trước chưa dừng. Đợi rồi chạy Restart-Muse-Web.cmd; không mở hai backend cùng dữ liệu.';return;}await new Promise(r=>setTimeout(r,100));}}
    const port=await freePort(),cdpPort=await freePort();this.base=`http://127.0.0.1:${port}`;
    const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('MUSE2API_'))delete env[key];
    Object.assign(env,{PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1',MUSE2API_HOME:this.home,MUSE2API_PROFILE_ROOT:path.join(this.home,'profiles'),MUSE2API_HOME_DIR:this.home,MUSE2API_PORT:String(port),MUSE2API_HOST:'127.0.0.1',MUSE2API_CDP_PORT:String(cdpPort),MUSE2API_KEY:this.key,MUSE2API_CONCURRENCY:'8',MUSE2API_CORS_ORIGINS:'',MUSE_STUDIO_PARENT:'1'});
    if(process.env.MUSE_BROWSER_EXE)env.MUSE2API_CHROMIUM=process.env.MUSE_BROWSER_EXE;
    const log=createWriteStream(path.join(this.home,'runtime.log'),{flags:'a',mode:0o600});
    this.child=spawn(python,['-u',path.join(ROOT,'scripts','standalone_backend.py')],{cwd:ROOT,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child.stdin.on('error',()=>{});
    if(this.child.pid)await writeFile(path.join(this.home,'runtime-process.json'),JSON.stringify({pid:this.child.pid}));
    this.child.stdout.pipe(log,{end:false});this.child.stderr.pipe(log,{end:false});
    this.child.once('error',()=>{this.problem='Không khởi động được runtime. Chạy lại Setup-Muse-Web.cmd.';});
    this.child.once('exit',()=>{log.end();this.problem='Backend độc lập đã dừng. Chạy Restart-Muse-Web.cmd; xem data/backend/runtime.log.';});
    for(let i=0;i<100;i++){if(this.problem)break;try{const r=await fetch(this.base+'/healthz',{signal:AbortSignal.timeout(400)});const d=await r.json();if(d.studioStandalone===true){this.problem=null;return;}}catch{}await new Promise(r=>setTimeout(r,100));}
    this.problem||='Backend độc lập chưa sẵn sàng. Xem data/backend/runtime.log.';
  }
  async status(){if(this.problem)return {connected:false,mode:this.mode,error:this.problem,code:'STANDALONE_UNAVAILABLE'};return {...await super.status(),mode:this.mode};}
  async request(route,options){if(this.problem)throw Object.assign(new Error(this.problem),{status:503,code:'STANDALONE_UNAVAILABLE'});return super.request(route,options);}
  async close(){if(!this.child||this.child.exitCode!==null)return;this.child.stdin.end();await Promise.race([new Promise(r=>this.child.once('exit',r)),new Promise(r=>setTimeout(r,10000).unref())]);if(this.child.exitCode===null)this.child.kill();}
}
export async function createBackend(dataDir){if(process.env.MUSE_BACKEND_URL||process.env.MUSE_BACKEND_MODE==='desktop'){const b=new Backend();b.mode='desktop';return b;}const b=new StandaloneBackend(dataDir);await b.start();return b;}
