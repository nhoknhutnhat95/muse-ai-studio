import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,readdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {installSkills} from '../scripts/install-skills.mjs';
import {ROOT} from '../server/runtime-paths.mjs';

async function fixture(){
  const temp=await mkdtemp(path.join(tmpdir(),'muse-skill-')),root=path.join(temp,"Dự án O'Brien & Muse"),userHome=path.join(temp,'user');
  await mkdir(path.join(root,'bin'),{recursive:true});await mkdir(userHome);
  await cp(path.join(ROOT,'skills'),path.join(root,'skills'),{recursive:true});
  await writeFile(path.join(root,'package.json'),JSON.stringify({name:'muse-studio-web'}));
  await writeFile(path.join(root,'bin/muse.mjs'),"console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));if(process.argv.includes('wait'))process.exitCode=2;");
  await mkdir(path.join(root,'data'));await writeFile(path.join(root,'data','private.txt'),'not part of a skill');
  return {temp,root,userHome};
}
async function run(file,args,cwd,env={}){
  const child=spawn(process.execPath,[file,...args],{cwd,env:{...process.env,...env},windowsHide:true});let out='',err='';child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>err+=s);
  const code=await new Promise((ok,no)=>{child.once('error',no);child.once('exit',ok);});return {code,out,err};
}

test('installer links both hosts to the clone without copying user data',async()=>{
  const f=await fixture(),result=await installSkills(f);assert.equal(result.length,2);
  assert.equal(result[0].path,path.join(f.userHome,'.agents/skills/muse-studio-web'));assert.equal(result[1].path,path.join(f.userHome,'.claude/skills/muse-studio-web'));
  for(const installed of result){
    const config=JSON.parse(await readFile(path.join(installed.path,'references/instance.json'),'utf8'));assert.equal(config.root,f.root);assert.equal(config.url,'http://127.0.0.1:3210');
    assert.deepEqual((await readdir(installed.path)).sort(),['SKILL.md','agents','assets','references','scripts']);
    assert.ok(!(await readFile(path.join(installed.path,'SKILL.md'),'utf8')).includes('D:/muse-studio-ai'));
  }
  const wrapper=path.join(result[0].path,'scripts/muse.mjs');
  const probe=await run(wrapper,['doctor'],f.temp);assert.equal(probe.code,0,probe.err);assert.deepEqual(JSON.parse(probe.out),{args:['--base','http://127.0.0.1:3210','doctor'],cwd:f.temp});
  const wait=await run(wrapper,['wait','fixture','--timeout','1'],f.temp,{MUSE_STUDIO_URL:'http://127.0.0.1:3999'});assert.equal(wait.code,2);assert.equal(JSON.parse(wait.out).args[1],'http://127.0.0.1:3999');
});

test('skill update backs up previous files, keeps extra notes, and only installs requested host',async()=>{
  const f=await fixture();const [first]=await installSkills({...f,agent:'claude'});
  await writeFile(path.join(first.path,'SKILL.md'),'previous user skill');await writeFile(path.join(first.path,'notes.md'),'keep user notes');
  const [second]=await installSkills({...f,agent:'claude',url:'http://127.0.0.1:3211'});
  assert.equal(await readFile(path.join(second.backup,'SKILL.md'),'utf8'),'previous user skill');assert.equal(await readFile(path.join(first.path,'notes.md'),'utf8'),'keep user notes');
  assert.equal(JSON.parse(await readFile(path.join(second.path,'references/instance.json'),'utf8')).url,'http://127.0.0.1:3211');
  assert.ok(!(await readdir(f.userHome)).includes('.agents'));
});

test('existing legacy Codex skill is updated in place without duplicate discovery',async()=>{
  const f=await fixture(),legacy=path.join(f.userHome,'.codex/skills/muse-studio-web');await mkdir(legacy,{recursive:true});await writeFile(path.join(legacy,'SKILL.md'),'legacy');
  const [result]=await installSkills({...f,agent:'codex'});assert.equal(result.path,legacy);assert.equal(await readFile(path.join(result.backup,'SKILL.md'),'utf8'),'legacy');
  assert.ok(!(await readdir(f.userHome)).includes('.agents'));
});

test('invalid host and nonlocal web URL fail without installing',async()=>{
  const f=await fixture();await assert.rejects(installSkills({...f,agent:'unknown'}),/Agent/);await assert.rejects(installSkills({...f,url:'https://example.com'}),/loopback/);assert.deepEqual(await readdir(f.userHome),[]);
});
