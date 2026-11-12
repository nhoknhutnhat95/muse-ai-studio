import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
let checked=0;
for(const dir of ['server','bin','public','scripts'])for(const name of readdirSync(dir)){
  if(!/\.m?js$/.test(name))continue;
  const result=spawnSync(process.execPath,['--check',`${dir}/${name}`],{windowsHide:true,stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);checked++;
}
console.log(`Syntax OK: ${checked} JavaScript modules.`);
