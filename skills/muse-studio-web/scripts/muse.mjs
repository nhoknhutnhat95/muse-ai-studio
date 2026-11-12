#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

try{
  const location=path.dirname(fileURLToPath(import.meta.url));
  const instance=JSON.parse(await readFile(path.join(location,'../references/instance.json'),'utf8'));
  const root=process.env.MUSE_STUDIO_ROOT||instance.root;
  if(!root||!path.isAbsolute(root))throw Error('Chua co duong dan Muse. Chay Install-AI-Skills.cmd trong thu muc clone tren may nay.');
  const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  if(pkg.name!=='muse-studio-web')throw Error('Thu muc da cai skill khong phai Muse Studio Web. Chay lai Install-AI-Skills.cmd.');
  const base=process.env.MUSE_STUDIO_URL||instance.url||'http://127.0.0.1:3210';
  const child=spawn(process.execPath,[path.join(root,'bin/muse.mjs'),'--base',base,...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});
  child.once('error',()=>{console.error(JSON.stringify({error:'Khong chay duoc Muse CLI. Kiem tra duong dan va cai lai skill.'}));process.exitCode=1;});
  child.once('exit',code=>{process.exitCode=code??1;});
}catch{console.error(JSON.stringify({error:'Khong doc duoc ban Muse da lien ket. Chay lai Install-AI-Skills.cmd trong thu muc clone hien tai.'}));process.exitCode=1;}
