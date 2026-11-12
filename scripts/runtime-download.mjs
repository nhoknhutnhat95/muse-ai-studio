import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {stat,rename,truncate} from 'node:fs/promises';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
const bytes=async file=>{try{return (await stat(file)).size;}catch(e){if(e.code==='ENOENT')return 0;throw e;}};
const mb=n=>(n/1000000).toFixed(1);

/** Resume only into a private .part file; never publish an unverified download. */
export async function download(spec,file,{log=console.log,idleMs=30000,totalMs=1800000,progressMs=3000,fetchImpl=fetch}={}){
  if(await bytes(file)&&await digest(file)===spec.sha256){log(`Using verified ${file.split(/[\\/]/).pop()}.`);return file;}
  const part=file+'.part',sources=[...new Set([spec.url,...(spec.mirrors||[])])];
  if(await bytes(part)&&await digest(part)===spec.sha256){await rename(part,file);log('Completed download already present; checksum OK.');return file;}
  let lastError;
  for(let source=0;source<sources.length;source++){
    const url=sources[source],controller=new AbortController();
    let offset=await bytes(part),received=0,total=spec.bytes||0,idle,progress,phase='connecting',response;
    const started=Date.now(),abort=message=>controller.abort(new Error(message));
    const resetIdle=()=>{clearTimeout(idle);idle=setTimeout(()=>abort(`No download data for ${Math.round(idleMs/1000)} seconds`),idleMs);};
    const totalTimer=setTimeout(()=>abort('Download time limit reached'),totalMs);
    const report=()=>{const current=offset+received,seconds=Math.max(.001,(Date.now()-started)/1000),rate=received/seconds;log(phase==='connecting'?`  Waiting for ${new URL(url).hostname} ...`:`  ${mb(current)}${total?` / ${mb(total)}`:''} MB${total?` (${Math.min(100,Math.floor(current/total*100))}%)`:''} | ${mb(rate)} MB/s`);};
    log(`Downloading ${file.split(/[\\/]/).pop()} from ${new URL(url).hostname} [${source+1}/${sources.length}]${offset?` - resuming at ${mb(offset)} MB`:''} ...`);
    resetIdle();progress=setInterval(report,progressMs);
    try{
      response=await fetchImpl(url,{headers:{'Accept-Encoding':'identity',...(offset?{Range:`bytes=${offset}-`}:{})},signal:controller.signal});
      resetIdle();
      if(response.status===416){await truncate(part,0);throw Error('Partial download is no longer valid; restarting with the next source');}
      if(!response.ok)throw Error(`Download HTTP ${response.status}`);
      if(response.status===206){
        const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')||'');
        if(!range||+range[1]!==offset||+range[2]<offset||+range[3]<=+range[2]||(spec.bytes&&+range[3]!==spec.bytes))throw Error('Server returned an invalid download range');
        total=+range[3];
      }else{offset=0;total=spec.bytes||Number(response.headers.get('content-length'))||0;}
      phase='downloading';
      const meter=new Transform({transform(chunk,_encoding,next){received+=chunk.length;resetIdle();if(total&&offset+received>total)return next(Error('Download larger than expected'));next(null,chunk);}});
      await pipeline(Readable.fromWeb(response.body),meter,createWriteStream(part,{flags:offset?'a':'w'}),{signal:controller.signal});
      clearTimeout(idle);clearInterval(progress);report();
      if(total&&offset+received!==total)throw Error('Download ended before all bytes arrived');
      log('  Checking SHA-256 ...');
      if(await digest(part)!==spec.sha256){await truncate(part,0);throw Error('Download checksum mismatch; rejecting this source');}
      await rename(part,file);log('  Download verified.');return file;
    }catch(e){
      lastError=controller.signal.aborted?controller.signal.reason:e;
      log(`  ${lastError.message}.${source+1<sources.length?' Switching download source ...':' Partial download kept for the next run.'}`);
    }finally{
      clearTimeout(idle);clearTimeout(totalTimer);clearInterval(progress);
      controller.abort();
      if(response?.body&&!response.body.locked)await response.body.cancel().catch(()=>{});
    }
  }
  throw Error(`Cannot download ${file.split(/[\\/]/).pop()}: ${lastError?.message}. Run Start-Muse-Web.cmd again to resume.`);
}
