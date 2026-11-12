import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {download} from '../scripts/runtime-download.mjs';
import {acquireSetupLock} from '../scripts/runtime-setup-lock.mjs';

const payload=Buffer.from('verified runtime binary fixture '.repeat(300));
const sha256=createHash('sha256').update(payload).digest('hex');
async function fixture(t,handler){
  const dir=await mkdtemp(path.join(tmpdir(),'muse-download-')),server=http.createServer(handler);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  return {file:path.join(dir,'runtime.zip'),url:`http://127.0.0.1:${server.address().port}`,logs:[],dir};
}

test('stalled transfer switches mirror and resumes with visible byte progress',async t=>{
  const ranges=[];
  const f=await fixture(t,(req,res)=>{
    if(req.url==='/slow'){res.writeHead(200,{'Content-Length':payload.length});res.write(payload.subarray(0,500));return;}
    ranges.push(req.headers.range);res.writeHead(206,{'Content-Range':`bytes 500-${payload.length-1}/${payload.length}`,'Content-Length':payload.length-500});res.end(payload.subarray(500));
  });
  await download({url:f.url+'/slow',mirrors:[f.url+'/mirror'],sha256,bytes:payload.length},f.file,{idleMs:150,progressMs:25,log:s=>f.logs.push(s)});
  assert.deepEqual(await readFile(f.file),payload);assert.deepEqual(ranges,['bytes=500-']);
  assert.ok(f.logs.some(s=>s.includes('MB/s')));assert.ok(f.logs.some(s=>s.includes('Switching download source')));
});

test('old partial file resumes; a server ignoring Range restarts instead of appending',async t=>{
  let range;
  const f=await fixture(t,(req,res)=>{range=req.headers.range;res.writeHead(200,{'Content-Length':payload.length});res.end(payload);});
  await writeFile(f.file+'.part',payload.subarray(0,200));
  await download({url:f.url,sha256},f.file,{log:()=>{}});assert.equal(range,'bytes=200-');assert.deepEqual(await readFile(f.file),payload);
});

test('bad checksum is never published and next source starts fresh',async t=>{
  const ranges=[];
  const f=await fixture(t,(req,res)=>{ranges.push(req.headers.range);res.end(req.url==='/bad'?Buffer.alloc(payload.length):payload);});
  await download({url:f.url+'/bad',mirrors:[f.url+'/good'],sha256},f.file,{log:()=>{}});
  assert.deepEqual(await readFile(f.file),payload);assert.deepEqual(ranges,[undefined,undefined]);
});

test('invalid resumed range fails, retains partial and does not publish',async t=>{
  const f=await fixture(t,(_req,res)=>{res.writeHead(206,{'Content-Range':`bytes 0-${payload.length-1}/${payload.length}`});res.end(payload);});
  await writeFile(f.file+'.part',payload.subarray(0,200));
  await assert.rejects(download({url:f.url,sha256},f.file,{log:()=>{}}),/invalid download range/);
  assert.equal((await stat(f.file+'.part')).size,200);await assert.rejects(stat(f.file),{code:'ENOENT'});
});

test('verified cache and complete partial require no network',async t=>{
  const f=await fixture(t,()=>assert.fail('No HTTP expected'));
  await writeFile(f.file+'.part',payload);
  await download({url:f.url,sha256},f.file,{log:()=>{}});
  await download({url:f.url,sha256},f.file,{log:()=>{}});
  assert.deepEqual(await readFile(f.file),payload);
});

test('header timeout also switches source without hanging',async t=>{
  const f=await fixture(t,(req,res)=>{if(req.url==='/hang')return;res.end(payload);});
  await download({url:f.url+'/hang',mirrors:[f.url+'/ok'],sha256},f.file,{idleMs:100,progressMs:25,log:()=>{}});
  assert.deepEqual(await readFile(f.file),payload);
});

test('setup recovers stopped PID/old empty locks but refuses a live setup',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'muse-setup-lock-')),file=path.join(dir,'setup.lock');
  let release=await acquireSetupLock(file,{log:()=>{}});
  await assert.rejects(acquireSetupLock(file),/still running/);await release();
  await writeFile(file,JSON.stringify({pid:2147483647,token:'stopped'}));
  release=await acquireSetupLock(file,{log:()=>{}});await release();
  await writeFile(file,'');await assert.rejects(acquireSetupLock(file,{legacyIsActive:async()=>true}),/still running/);
  release=await acquireSetupLock(file,{legacyIsActive:async()=>false,log:()=>{}});await release();
  await assert.rejects(stat(file),{code:'ENOENT'});
});
