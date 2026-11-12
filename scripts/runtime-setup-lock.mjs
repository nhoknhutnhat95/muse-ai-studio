import {open,readFile,unlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const exec=promisify(execFile);
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
async function legacyActive(){
  // The first launcher wrote an empty lock. Check other installer processes
  // before recovering it; only PID numbers leave the process query.
  if(process.platform!=='win32')return true;
  const command="Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.ProcessId -ne [int]$env:MUSE_SETUP_SELF -and $_.CommandLine -match 'setup-runtime\\.mjs' } | ForEach-Object { $_.ProcessId }";
  const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:10000,env:{...process.env,MUSE_SETUP_SELF:String(process.pid)}});
  return !!stdout.trim();
}
export async function acquireSetupLock(file,{legacyIsActive=legacyActive,isAlive=alive,log=console.log}={}){
  const owner={pid:process.pid,token:randomUUID()};
  for(let attempt=0;attempt<3;attempt++){
    let handle;
    try{handle=await open(file,'wx');}catch(e){
      if(e.code!=='EEXIST')throw e;
      let text;try{text=await readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')continue;throw e;}
      let old;try{old=JSON.parse(text);}catch{}
      const busy=Number.isInteger(old?.pid)&&old.pid>0?isAlive(old.pid):await legacyIsActive();
      if(busy)throw Error('Another setup is still running. Close its window first, then run Start-Muse-Web.cmd again.');
      // Do not remove a lock that changed during the process check.
      if(await readFile(file,'utf8').catch(()=>null)!==text)continue;
      await unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});
      log('Recovered an interrupted setup. Continuing ...');continue;
    }
    await handle.writeFile(JSON.stringify(owner));await handle.close();
    return async()=>{const current=JSON.parse(await readFile(file,'utf8').catch(()=>'{}'));if(current.token===owner.token)await unlink(file);};
  }
  throw Error('Setup lock changed; try again after the other setup closes.');
}
