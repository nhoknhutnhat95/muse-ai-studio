import {readFile,writeFile,mkdir,readdir,copyFile,rename,stat} from 'node:fs/promises';
import {constants,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from '../server/runtime-paths.mjs';

const readJSON=async(file,fallback)=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw Error('Không đọc được dữ liệu nguồn; chưa thay thế dữ liệu.');}};
async function copyTree(source,target){
  if(!existsSync(source))return 0;
  await mkdir(target,{recursive:true});let count=0;
  for(const entry of await readdir(source,{withFileTypes:true})){
    if(entry.isSymbolicLink())continue;
    const src=path.join(source,entry.name),dst=path.join(target,entry.name);
    if(entry.isDirectory()){count+=await copyTree(src,dst);continue;}
    if(!entry.isFile())continue;
    if(existsSync(dst)){if((await stat(src)).size!==(await stat(dst)).size)throw Error('File đích khác nguồn; giữ nguyên, cần đối chiếu.');continue;}
    await copyFile(src,dst+'.part',constants.COPYFILE_EXCL);await rename(dst+'.part',dst);count++;
  }
  return count;
}

export async function migrateDesktop({source=path.join(process.env.LOCALAPPDATA||'','Muse AI Studio','muse2api_data'),dataDir=path.join(ROOT,'data'),assets=path.join(process.env.LOCALAPPDATA||'','Programs','Muse AI Studio','_internal')}={}){
  const destination=path.resolve(dataDir,'backend/data');source=path.resolve(source);
  if(destination===source||destination.startsWith(source+path.sep))throw Error('Nguồn và đích phải độc lập.');
  // A live standalone process must never have its in-memory account store replaced.
  const runtime=await readJSON(path.join(dataDir,'backend/runtime-process.json'),null);
  if(runtime?.pid){try{process.kill(runtime.pid,0);throw Error('Dừng Muse Web độc lập trước khi nhập dữ liệu desktop.');}catch(e){if(e.code!=='ESRCH')throw e;}}
  const marker=path.join(destination,'desktop-import.json');
  if(existsSync(marker))return {ok:true,alreadyImported:true,...await readJSON(marker,{})};
  if(existsSync(path.join(destination,'accounts.json'))||existsSync(path.join(destination,'tasks.json')))throw Error('Backend độc lập đã có dữ liệu; không ghi đè tài khoản/dự án.');
  const accounts=await readJSON(path.join(source,'accounts.json'),null),tasks=await readJSON(path.join(source,'tasks.json'),{}),proxies=await readJSON(path.join(source,'proxies.json'),[]);
  if(!Array.isArray(accounts)||!accounts.length)throw Error('Không tìm thấy tài khoản Muse desktop tại nguồn.');
  if(Object.values(tasks).some(t=>['queued','processing','running'].includes(t.status)))throw Error('Backend desktop còn tác vụ đang chạy; đợi xong trước khi chuyển.');
  if(!Array.isArray(proxies))throw Error('Định dạng proxy nguồn chưa được hỗ trợ; chưa chuyển dữ liệu.');
  const safeAccounts=accounts.map(a=>{const result={...a};delete result.otp_url;delete result.password;const p=proxies.find(p=>p.id===a.proxy_id);if(a.proxy_id&&!p)throw Error('Có tài khoản gán proxy thiếu trong nguồn; không chuyển sang trực tiếp.');if(p){const u=new URL(p.url);result.proxy={server:u.origin,username:decodeURIComponent(u.username),password:decodeURIComponent(u.password)};}return result;});
  const stage=path.join(dataDir,'backend','desktop-import-staging');await mkdir(stage,{recursive:true});
  const media=await copyTree(path.join(source,'media'),path.join(stage,'media'));
  await copyTree(path.join(assets,'assets','kol_presets'),path.join(dataDir,'presets','kol'));
  await copyTree(path.join(assets,'ah_bgm'),path.join(dataDir,'presets','music'));
  for(const [name,value] of [['accounts',safeAccounts],['tasks',tasks],['proxies',proxies]])await writeFile(path.join(stage,name+'.json'),JSON.stringify(value),{mode:0o600});
  const result={accounts:accounts.length,tasks:Object.keys(tasks).length,mediaCopied:media,importedAt:new Date().toISOString()};
  await writeFile(path.join(stage,'desktop-import.json'),JSON.stringify(result,null,2));
  // Destination only appears after all copies succeed. Original files are untouched.
  await mkdir(path.dirname(destination),{recursive:true});await rename(stage,destination);
  return {ok:true,...result};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))migrateDesktop({dataDir:process.env.MUSE_DATA_DIR||path.join(ROOT,'data')}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(JSON.stringify({error:e.message}));process.exitCode=1;});
