import {createHash} from 'node:crypto';
import {existsSync,createReadStream,createWriteStream} from 'node:fs';
import {readFile,writeFile,mkdir,readdir,rename,open,unlink} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {ROOT,runtimeRoot} from '../server/runtime-paths.mjs';

const run=(exe,args,options={})=>new Promise((ok,no)=>{const c=spawn(exe,args,{cwd:ROOT,windowsHide:true,stdio:'inherit',...options});c.once('error',no);c.once('exit',code=>code===0?ok():no(Error(`Setup command failed (${code}).`)));});
async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function download(spec,file){
  if(existsSync(file)&&await digest(file)===spec.sha256)return file;
  console.log(`Downloading ${new URL(spec.url).hostname} ...`);
  const r=await fetch(spec.url,{signal:AbortSignal.timeout(600000)});if(!r.ok)throw Error(`Download HTTP ${r.status}`);
  await pipeline(Readable.fromWeb(r.body),createWriteStream(file+'.part'));
  if(await digest(file+'.part')!==spec.sha256)throw Error('Download checksum mismatch. Nothing was executed.');
  await rename(file+'.part',file);return file;
}
async function extract(file,dir){await mkdir(dir,{recursive:true});await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command','Expand-Archive -LiteralPath $env:MUSE_SETUP_ZIP -DestinationPath $env:MUSE_SETUP_DEST -Force'],{env:{...process.env,MUSE_SETUP_ZIP:file,MUSE_SETUP_DEST:dir}});}

export async function setup(){
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('Automatic runtime setup currently supports Windows x64.');
  const manifestText=await readFile(path.join(ROOT,'scripts/runtime-manifest.json'),'utf8'),requirements=await readFile(path.join(ROOT,'scripts/runtime-requirements.txt'),'utf8');
  const fingerprint=createHash('sha256').update(manifestText+requirements).digest('hex'),root=runtimeRoot(),manifest=JSON.parse(manifestText);
  const marker=path.join(root,'ready.json'),python=path.join(root,'python','python.exe');
  try{if(JSON.parse(await readFile(marker,'utf8')).fingerprint===fingerprint&&existsSync(python)&&existsSync(path.join(root,'ffmpeg/bin/ffmpeg.exe'))&&existsSync(path.join(root,'ffmpeg/bin/ffprobe.exe'))){console.log('Standalone runtime is ready.');return;}}catch{}
  await mkdir(root,{recursive:true});
  const lock=await open(path.join(root,'setup.lock'),'wx').catch(()=>{throw Error('Another setup is running. If interrupted, remove tools/standalone/setup.lock then retry.');});
  try{
    const cache=path.join(root,'downloads');await mkdir(cache,{recursive:true});
    if(!existsSync(python)){
      await extract(await download(manifest.python,path.join(cache,'python.zip')),path.join(root,'python'));
      await writeFile(path.join(root,'python','python312._pth'),'python312.zip\n.\nLib/site-packages\nimport site\n','utf8');
    }
    const pip=await download(manifest.pip,path.join(cache,'pip.zip'));
    await extract(pip,path.join(root,'python/Lib/site-packages'));
    console.log('Installing pinned Python packages ...');
    await run(python,['-m','pip','install','--disable-pip-version-check','--no-warn-script-location','--only-binary=:all:','--require-hashes','-r',path.join(ROOT,'scripts/runtime-requirements.txt')]);
    if(!existsSync(path.join(root,'ffmpeg/bin/ffmpeg.exe'))||!existsSync(path.join(root,'ffmpeg/bin/ffprobe.exe'))){
      const staging=path.join(root,'ffmpeg-extract-'+Date.now());
      await extract(await download(manifest.ffmpeg,path.join(cache,'ffmpeg.zip')),staging);
      const folders=await readdir(staging,{withFileTypes:true});const folder=folders.find(x=>x.isDirectory()&&x.name.startsWith('ffmpeg-'));
      if(!folder)throw Error('FFmpeg archive has an unexpected layout.');
      await rename(path.join(staging,folder.name),path.join(root,'ffmpeg'));
    }
    await run(python,['-c','import fastapi, uvicorn, requests, websocket, multipart, edge_tts; print("Python runtime OK")']);
    await run(path.join(root,'ffmpeg/bin/ffmpeg.exe'),['-version'],{stdio:'ignore'});
    await run(path.join(root,'ffmpeg/bin/ffprobe.exe'),['-version'],{stdio:'ignore'});
    await writeFile(marker,JSON.stringify({fingerprint,installedAt:new Date().toISOString()},null,2));
    console.log('Standalone setup complete. Open Start-Muse-Web.cmd.');
  }finally{await lock.close();await unlink(path.join(root,'setup.lock'));}
}
setup().catch(e=>{console.error(e.message);process.exitCode=1;});
