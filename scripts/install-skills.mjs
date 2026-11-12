import {readFile,writeFile,mkdir,copyFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {ROOT} from '../server/runtime-paths.mjs';

const FILES=['SKILL.md','agents/openai.yaml','references/operations.md','references/instance.json','assets/character-script.json','scripts/muse.mjs'];
const info=async p=>{try{return await lstat(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
async function plainAncestors(p){let current=path.resolve(p);for(;;){const s=await info(current);if(s?.isSymbolicLink())throw Error('Khong ghi de skill qua symlink/junction. Chon thu muc cai binh thuong.');const parent=path.dirname(current);if(parent===current)return;current=parent;}}

export async function installSkills({agent='both',userHome=homedir(),root=ROOT,url='http://127.0.0.1:3210'}={}){
  if(!['codex','claude','both'].includes(agent))throw Error('Agent phai la codex, claude hoac both.');
  root=path.resolve(root);userHome=path.resolve(userHome);
  if(JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).name!=='muse-studio-web')throw Error('Chay installer tu ban clone Muse Studio Web.');
  const u=new URL(url);if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Web URL phai la HTTP loopback cua Muse tren may nay.');
  const source=path.join(root,'skills/muse-studio-web'),contents=new Map();
  // Explicit allowlist: never copy data, sessions or unrelated personal skills.
  for(const file of FILES)contents.set(file,await readFile(path.join(source,file)));
  contents.set('references/instance.json',Buffer.from(JSON.stringify({root,url:u.origin},null,2)+'\n'));
  const results=[];
  for(const type of agent==='both'?['codex','claude']:[agent]){
    let hostRoot=path.join(userHome,type==='codex'?'.agents':'.claude');
    // Keep an already installed legacy Codex skill in place instead of adding
    // another skill with the same name to a second discovery directory.
    if(type==='codex'&&!await info(path.join(hostRoot,'skills/muse-studio-web'))&&await info(path.join(userHome,'.codex/skills/muse-studio-web')))hostRoot=path.join(userHome,'.codex');
    const target=path.join(hostRoot,'skills/muse-studio-web');
    await plainAncestors(target);
    for(const file of FILES)await plainAncestors(path.join(target,file));
    const existing=[];for(const file of FILES)if(await info(path.join(target,file)))existing.push(file);
    const backup=existing.length?path.join(hostRoot,'skill-backups','muse-studio-web',new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid):null;
    if(backup)for(const file of existing){await mkdir(path.dirname(path.join(backup,file)),{recursive:true});await copyFile(path.join(target,file),path.join(backup,file));}
    for(const[file,content]of contents){const dest=path.join(target,file);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,content);}
    results.push({agent:type,path:target,backup,root,url:u.origin});
  }
  return results;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const {values}=parseArgs({options:{agent:{type:'string',default:'both'},url:{type:'string',default:'http://127.0.0.1:3210'}}});for(const r of await installSkills(values))console.log(`Installed ${r.agent}: ${r.path}${r.backup?`\nPrevious files saved: ${r.backup}`:''}`);console.log('Open a new Codex / Claude Code chat. The skill is muse-studio-web.');}
  catch(e){console.error(e.message);process.exitCode=1;}
}
