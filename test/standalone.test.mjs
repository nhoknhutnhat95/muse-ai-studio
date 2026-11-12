import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {StandaloneBackend} from '../server/standalone.mjs';
import {mediaPaths} from '../server/runtime-paths.mjs';
import {migrateDesktop} from '../scripts/migrate-desktop.mjs';

test('standalone starts with no installed Muse, owns secrets and shuts down its child',{skip:!existsSync(mediaPaths().python)},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'muse-standalone-')),backend=new StandaloneBackend(dir);
  try{
    await backend.start();const status=await backend.status();assert.equal(status.connected,true);assert.equal(status.mode,'standalone');assert.equal(status.accounts.total,0);
    assert.equal((await fetch(backend.base+'/admin/accounts')).status,401);
    assert.ok(!JSON.stringify(status).includes(backend.key));
    assert.equal((await backend.request('/admin/proxies')).proxies.length,0);
  }finally{await backend.close();}
  assert.throws(()=>process.kill(backend.child.pid,0));
});

test('Python bridge contract uses no real remote account or generation',{skip:!existsSync(mediaPaths().python)},async()=>{
  const p=spawn(mediaPaths().python,['test/standalone_backend_test.py'],{windowsHide:true});let output='';p.stdout.on('data',d=>output+=d);p.stderr.on('data',d=>output+=d);const code=await new Promise((ok,no)=>{p.once('error',no);p.once('exit',ok);});assert.equal(code,0,output);
});

test('migration copies into an isolated store, keeps source and refuses overwriting accounts',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'muse-migration-')),source=path.join(dir,'old'),dataDir=path.join(dir,'new');
  await mkdir(path.join(source,'media'),{recursive:true});const original=JSON.stringify([{id:'test',label:'fixture',cookies:{hatch_sess:'private'},otp_url:'https://private.invalid'}]);
  await writeFile(path.join(source,'accounts.json'),original);await writeFile(path.join(source,'tasks.json'),JSON.stringify({t:{id:'t',status:'completed'}}));await writeFile(path.join(source,'media/a.mp4'),'fixture');
  const result=await migrateDesktop({source,dataDir,assets:path.join(dir,'no-assets')});assert.equal(result.accounts,1);assert.equal(result.mediaCopied,1);
  assert.equal(await readFile(path.join(source,'accounts.json'),'utf8'),original);
  const copied=await readFile(path.join(dataDir,'backend/data/accounts.json'),'utf8');assert.ok(copied.includes('private'));assert.ok(!copied.includes('otp_url'));
  assert.equal((await migrateDesktop({source,dataDir})).alreadyImported,true);
  const existing=path.join(dir,'existing');await mkdir(path.join(existing,'backend/data'),{recursive:true});await writeFile(path.join(existing,'backend/data/accounts.json'),'[]');await assert.rejects(migrateDesktop({source,dataDir:existing}),/không ghi đè/);
});
