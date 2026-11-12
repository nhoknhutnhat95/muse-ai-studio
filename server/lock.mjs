import { mkdirSync, openSync, writeFileSync, readFileSync, closeSync, unlinkSync } from 'node:fs';
import path from 'node:path';

// A second server must never resume or claim jobs from a live server's database.
export function acquireLock(dir) {
  mkdirSync(dir,{recursive:true}); const file=path.join(dir,'studio.lock');
  for(let attempt=0;attempt<2;attempt++) {
    let fd;
    try{fd=openSync(file,'wx');}
    catch(e){
      if(e.code!=='EEXIST')throw e;
      let owner;try{owner=JSON.parse(readFileSync(file,'utf8'));}catch{throw Error(`Khóa studio không hợp lệ: ${file}. Kiểm tra server trước khi xóa khóa.`);}
      if(!Number.isInteger(owner.pid)||owner.pid<=0)throw Error('Khóa studio thiếu PID hợp lệ.');
      let alive=true;try{process.kill(owner.pid,0);}catch(err){if(err.code==='ESRCH')alive=false;}
      if(alive)throw Error(`Web Studio đã chạy (PID ${owner.pid}). Không khởi động server thứ hai với cùng dữ liệu.`);
      unlinkSync(file);continue;
    }
    writeFileSync(fd,JSON.stringify({pid:process.pid,started:new Date().toISOString()}));closeSync(fd);
    return ()=>{try{const o=JSON.parse(readFileSync(file,'utf8'));if(o.pid===process.pid)unlinkSync(file);}catch{}};
  }
  throw Error('Không lấy được khóa Web Studio.');
}
