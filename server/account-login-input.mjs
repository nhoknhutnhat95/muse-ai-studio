import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';
import { AppError } from './schema.mjs';

export class LoginError extends AppError {
  constructor(code, message, status=400) { super(message, status, code); }
}
const emailPattern=/^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/;
const claimPattern=/^ORD[0-9A-F]{8}-[A-Z2-7]{10}$/i;
export function parseLoginLine(value) {
  const line=String(value).trim();
  if(claimPattern.test(line))return {type:'CLAIM',code:line.toUpperCase()};
  const parts=line.split(/\s*\|+\s*/);
  if(parts.length>3)throw new LoginError('LOGIN_FORMAT','Dùng email|mật khẩu[|2FA], email|link OTP hoặc mã nhập Muse Studio.');
  let email=parts[0], url=parts.find(v=>/^https:\/\//i.test(v));
  if(url&&parts.length===1){const u=new URL(url);email=u.searchParams.get('email')||u.searchParams.get('mail')||'';}
  if(!emailPattern.test(email)||email.length>254)throw new LoginError('LOGIN_FORMAT','Thiếu email hợp lệ hoặc sai định dạng dòng tài khoản.');
  if(url)return {type:'EMAIL_OTP',email,inboxUrl:inboxURL(url).href};
  if(parts.length===1)return {type:'EMAIL_OTP',email,inboxUrl:`https://${email.split('@')[1]}/mail/?email=${encodeURIComponent(email)}`};
  if(!parts[1])throw new LoginError('LOGIN_FORMAT','Thiếu mật khẩu hoặc link OTP.');
  if(parts[2])decodeBase32(parts[2]);
  return {type:parts[2]?'TOTP':'PASSWORD',email,password:parts[1],...(parts[2]?{totp:parts[2]}:{})};
}
export function parseLoginText(text) {
  if(typeof text!=='string'||text.length>100000)throw new LoginError('LOGIN_FORMAT','Dữ liệu đăng nhập tối đa 100 KB.');
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#'));
  if(!lines.length||lines.length>100)throw new LoginError('LOGIN_FORMAT','Nhập từ 1 đến 100 dòng tài khoản.');
  return [...new Set(lines)].map((line,index)=>{
    // Also accept the shop's descriptive copy line containing just one claim code.
    const claims=line.match(/\bORD[0-9A-F]{8}-[A-Z2-7]{10}\b/gi);
    try{return parseLoginLine(claims?.length===1?claims[0]:line);}
    catch{throw new LoginError('LOGIN_FORMAT',`Dòng ${index+1} chưa đúng định dạng. Kiểm tra email, mật khẩu, link OTP hoặc mã nhập.`);}
  });
}
function decodeBase32(secret) {
  const clean=String(secret).replace(/[\s=-]/g,'').toUpperCase();
  if(!/^[A-Z2-7]{16,128}$/.test(clean))throw new LoginError('LOGIN_2FA','Mã bí mật 2FA phải là chuỗi Base32, không phải mã 6 số đang hiển thị.');
  let bits=0,value=0;const out=[];
  for(const char of clean){value=(value<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);bits+=5;if(bits>=8){bits-=8;out.push((value>>>bits)&255);}}
  return Buffer.from(out);
}
export function totpCode(secret, now=Date.now()) {
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(now/30000)));
  const digest=createHmac('sha1',decodeBase32(secret)).update(counter).digest();
  return String((digest.readUInt32BE(digest[19]&15)&0x7fffffff)%1000000).padStart(6,'0');
}
function inboxURL(raw) {
  let u;try{u=new URL(raw);}catch{throw new LoginError('LOGIN_INBOX','Link OTP không hợp lệ.');}
  if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||isIP(u.hostname.replace(/^\[|\]$/g,''))||!u.hostname.includes('.'))throw new LoginError('LOGIN_INBOX','Link OTP phải dùng HTTPS và tên miền công khai.');
  return u;
}
export function publicAddress(address) {
  if(isIP(address)!==4)return false; // Resolve an IPv4 address and pin it for the request.
  const [a,b,c]=address.split('.').map(Number);
  return a!==0&&a!==10&&a!==127&&a<224&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||b===0&&(c===0||c===2)||b===88&&c===99))&&!(a===100&&b>=64&&b<=127)&&!(a===198&&(b===18||b===19||b===51&&c===100))&&!(a===203&&b===0&&c===113);
}
// No redirects, cookies, authorization headers or unpinned DNS requests to inbox URLs.
export async function publicJSON(raw,{body,signal}={}) {
  const u=inboxURL(raw),addresses=await lookup(u.hostname,{family:4,all:true});
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new LoginError('LOGIN_INBOX','Không đọc link OTP trỏ vào mạng nội bộ.');
  const payload=body===undefined?null:Buffer.from(JSON.stringify(body));
  return new Promise((resolve,reject)=>{
    const request=https.request(u,{method:payload?'POST':'GET',signal,timeout:15000,lookup:(_host,options,cb)=>cb(null,options.all?[addresses[0]]:addresses[0].address,4),headers:{Accept:'application/json','User-Agent':'MuseStudioWeb',...(payload?{'Content-Type':'application/json','Content-Length':payload.length}:{})}},response=>{
      if(response.statusCode!==200){response.resume();reject(new LoginError('LOGIN_INBOX','Dịch vụ mã nhập/OTP chưa trả dữ liệu hợp lệ. Kiểm tra link hoặc thử lại sau.'));return;}
      let size=0;const chunks=[];
      response.on('data',chunk=>{size+=chunk.length;if(size>1048576)request.destroy(new Error('Response too large'));else chunks.push(chunk);});
      response.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new LoginError('LOGIN_INBOX','Dịch vụ OTP chưa trả dữ liệu JSON được hỗ trợ.'));}});
      response.on('error',()=>reject(new LoginError('LOGIN_INBOX','Kết nối dịch vụ OTP bị gián đoạn.')));
    });
    request.on('timeout',()=>request.destroy());
    request.on('error',()=>reject(new LoginError('LOGIN_INBOX','Không kết nối được dịch vụ mã nhập/OTP.')));
    request.end(payload);
  });
}
export async function claimAccounts(code,{request=publicJSON,signal}={}) {
  if(!claimPattern.test(code))throw new LoginError('LOGIN_FORMAT','Mã nhập Muse Studio không hợp lệ.');
  const data=await request(`https://api.mrhulkstore.store/api/v1/muse/claim/${encodeURIComponent(code)}`,{signal});
  const urls=new Map((Array.isArray(data.accounts)?data.accounts:[]).filter(a=>typeof a?.email==='string').map(a=>[a.email,a.otp_url]));
  const emails=Array.isArray(data.emails)?data.emails:[...urls.keys()];
  if(!emails.length||emails.length>100)throw new LoginError('LOGIN_CLAIM','Mã nhập không có tài khoản hoặc vượt quá 100 tài khoản.');
  try{return [...new Set(emails)].map(email=>parseLoginLine(urls.get(email)?`${email}|${urls.get(email)}`:email));}
  catch{throw new LoginError('LOGIN_CLAIM','Shop trả định dạng tài khoản chưa được hỗ trợ.');}
}
export function inboxRequest(account) {
  const u=inboxURL(account.inboxUrl),email=account.email;
  if(u.hostname==='mrhulkstore.store'||u.hostname.endsWith('.mrhulkstore.store')) {
    const sig=u.searchParams.get('sig');
    if(sig)return {url:`${u.origin}/api/v1/otp/fetch`,body:{email,sig}};
  }
  if(u.hostname==='tinyhost.shop'||u.hostname.endsWith('.tinyhost.shop'))return {url:`${u.origin}/api/email/${encodeURIComponent(email)}/?page=1&limit=10`};
  if(u.pathname.replace(/\/$/,'')==='/mail')return {url:`${u.origin}/api/temp-mail/inbox?email=${encodeURIComponent(email)}`};
  return {url:u.href};
}
export function inboxMessages(data) {
  if(data?.success&&data.found&&/^\d{4,8}$/.test(String(data.otp_code||'')))return [{id:`portal:${data.received_at||''}:${data.otp_code}`,code:String(data.otp_code)}];
  const items=Array.isArray(data)?data:data?.messages||data?.emails||data?.data?.messages;
  if(!Array.isArray(items))throw new LoginError('LOGIN_INBOX','Định dạng hòm thư chưa được hỗ trợ. Dùng đăng nhập thủ công.');
  return items.slice(0,100).map(m=>{
    const content=['subject','body','text','snippet','content','html_body'].map(k=>typeof m[k]==='string'?m[k]:'').join(' ');
    const match=content.match(/(?:^|\D)(\d{6})(?!\d)/);
    return {id:String(m.id??m.message_id??content),code:match?.[1]||''};
  });
}
export async function readOTPInbox(account,{request=publicJSON,signal}={}) {
  const {url,body}=inboxRequest(account);return inboxMessages(await request(url,{body,signal}));
}
