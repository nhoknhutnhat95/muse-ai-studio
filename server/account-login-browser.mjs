import path from 'node:path';
import { existsSync } from 'node:fs';
import { LoginError, readOTPInbox, totpCode } from './account-login-input.mjs';

export function loginBrowserPath(env=process.env) {
  const candidates=[env.MUSE_BROWSER_EXE,
    path.join(env.ProgramFiles||'', 'Google/Chrome/Application/chrome.exe'),
    path.join(env.LOCALAPPDATA||'', 'Google/Chrome/Application/chrome.exe'),
    path.join(env['ProgramFiles(x86)']||'', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(env.ProgramFiles||'', 'Microsoft/Edge/Application/msedge.exe')];
  return candidates.find(p=>p&&existsSync(p))||null;
}
export function loginCapabilities() {
  let runtime=false;try{import.meta.resolve('playwright-core');runtime=true;}catch{}
  return {available:runtime&&!!loginBrowserPath(),runtime,browser:!!loginBrowserPath(),modes:['batch','manual'],maxAccounts:100};
}
export function museCookies(list) {
  const cookies={},expires={};
  for(const c of list){const host=String(c.domain||'').replace(/^\./,'').toLowerCase();if(host!=='muse.ai'&&!host.endsWith('.muse.ai'))continue;
    if(typeof c.name!=='string'||typeof c.value!=='string'||c.expires>0&&c.expires<=Date.now()/1000)continue;
    cookies[c.name]=c.value;if(c.expires>0)expires[c.name]=Math.floor(c.expires);
  }
  return cookies.hatch_sess&&cookies.hatch_vml?{cookies,expires}:null;
}
const delay=async(ms,signal)=>{
  if(signal?.aborted)throw new LoginError('LOGIN_CANCELLED','Đã dừng đăng nhập.');
  await new Promise(resolve=>{const t=setTimeout(done,ms);function done(){clearTimeout(t);signal?.removeEventListener('abort',done);resolve();}signal?.addEventListener('abort',done,{once:true});});
  if(signal?.aborted)throw new LoginError('LOGIN_CANCELLED','Đã dừng đăng nhập.');
};
function credentialOrigin(page) {
  const u=new URL(page.url());
  if(u.protocol!=='https:'||!['muse.ai','meta.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))throw new LoginError('LOGIN_MANUAL_REQUIRED','Trang đăng nhập chuyển sang miền khác. Hãy dùng đăng nhập thủ công.');
}
async function visible(page,selector) {
  const loc=page.locator(selector);for(let i=0;i<Math.min(await loc.count(),30);i++)if(await loc.nth(i).isVisible())return loc.nth(i);return null;
}
const nextSelector='button:has-text("Continue"), button:has-text("Next"), button:has-text("Confirm"), button:has-text("Tiếp tục"), button[type="submit"]';
const codeSelector='input[autocomplete="one-time-code"], input[aria-label*="code" i], input[placeholder*="code" i], input[name="code"], input[name="approvals_code"], input[maxlength="6"], input[maxlength="8"]';
async function next(page) {
  credentialOrigin(page);const b=await visible(page,nextSelector);
  if(!b)throw new LoginError('LOGIN_MANUAL_REQUIRED','Không nhận diện được bước đăng nhập. Hãy dùng đăng nhập thủ công.');
  await b.click({timeout:10000});
}
async function verdict(page) {
  const text=(await page.locator('body').innerText({timeout:2000}).catch(()=>'')).toLowerCase();
  const markers=[
    [['confirm you\'re human','confirm you’re human','captcha','checkpoint'],'LOGIN_MANUAL_REQUIRED','Tài khoản cần xác minh. Hãy dùng đăng nhập thủ công để tự xác minh.'],
    [['account disabled','account has been disabled','tài khoản bị vô hiệu hóa'],'LOGIN_DISABLED','Tài khoản bị vô hiệu hóa.'],
    [['incorrect password','wrong password','mật khẩu không chính xác'],'LOGIN_PASSWORD','Mật khẩu chưa đúng.'],
    [['invalid code','code you entered isn’t valid','code you entered isn\'t valid'],'LOGIN_2FA','Mã xác minh chưa đúng. Kiểm tra mã 2FA và giờ trên máy.'],
    [['try again later','couldn’t complete that request','couldn\'t complete that request'],'LOGIN_LIMITED','Dịch vụ đang giới hạn đăng nhập. Hãy thử lại sau.']
  ];
  for(const [words,code,message] of markers)if(words.some(w=>text.includes(w)))throw new LoginError(code,message);
}

// Each attempt owns a fresh browser/context. Never attach to a personal profile.
export async function loginWithBrowser(account,{mode,signal,onProgress=()=>{},proxy,inbox=readOTPInbox,launch,timeoutMs=mode==='manual'?600000:180000}={}) {
  let browser,context;
  const abort=()=>{browser?.close().catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  try {
    if(signal?.aborted)throw new LoginError('LOGIN_CANCELLED','Đã dừng đăng nhập.');
    const baseline=account.type==='EMAIL_OTP'?new Set((await inbox(account,{signal})).map(m=>m.id)):null;
    if(!launch){const cap=loginCapabilities();if(!cap.available)throw new LoginError('LOGIN_SETUP','Cần cài thành phần đăng nhập và Chrome hoặc Edge trên máy chạy web.',503);
      const {chromium}=await import('playwright-core');launch=options=>chromium.launch(options);}
    onProgress(mode==='manual'?'Đang mở cửa sổ để bạn đăng nhập…':'Đang mở phiên đăng nhập riêng…');
    browser=await launch({headless:mode!=='manual',executablePath:loginBrowserPath(),chromiumSandbox:true,...(proxy?{proxy}:{}),timeout:30000});
    if(signal?.aborted)throw new LoginError('LOGIN_CANCELLED','Đã dừng đăng nhập.');
    context=await browser.newContext({locale:'en-US',viewport:mode==='manual'?null:{width:1280,height:900},acceptDownloads:false});
    const page=await context.newPage();page.setDefaultTimeout(10000);
    await page.goto('https://muse.ai/',{waitUntil:'domcontentloaded',timeout:45000});
    const deadline=Date.now()+timeoutMs;
    if(mode==='manual'){await page.bringToFront();onProgress('Đăng nhập trong cửa sổ vừa mở. Web sẽ tự lưu khi phiên hợp lệ.');}
    let emailSent=false,passwordSent=false,codeSent=false,codeMethod=false,passwordMethod=false,profilePicked=false,authMethod=false;
    while(Date.now()<deadline) {
      if(signal?.aborted)throw new LoginError('LOGIN_CANCELLED','Đã dừng đăng nhập.');
      if(!browser.isConnected()||!context.pages().length)throw new LoginError('LOGIN_CANCELLED','Cửa sổ đăng nhập đã đóng.');
      const session=museCookies(await context.cookies('https://muse.ai/'));
      if(session) {
        const probe=await context.request.get('https://muse.ai/api/session',{maxRedirects:0,timeout:10000}).catch(()=>null);
        const valid=probe?.status()===200;await probe?.dispose();
        if(valid)return session;
      }
      if(mode==='manual'){await delay(1500,signal);continue;}
      await verdict(page);credentialOrigin(page);
      if(!emailSent) {
        const input=await visible(page,'input[autocomplete*="username"], input[type="email"], input[placeholder*="Mobile number or email"]');
        if(input){await input.fill(account.email);await next(page);emailSent=true;onProgress('Đã gửi email, đang chờ bước xác minh…');await delay(800,signal);continue;}
      }
      if(emailSent&&account.password&&!passwordSent) {
        const input=await visible(page,'input[type="password"]');
        if(input){await input.fill(account.password);await next(page);passwordSent=true;onProgress('Đã gửi mật khẩu, đang chờ xác minh…');await delay(800,signal);continue;}
        if(!passwordMethod){const use=await visible(page,'button:has-text("Use password instead"), a:has-text("Use password instead")');if(use){await use.click();passwordMethod=true;}}
      }
      if(passwordSent&&!profilePicked){const profile=await visible(page,'button[data-pel-click="login_account_selection_row_click"], button:has-text("Meta Account")');if(profile){await profile.click();profilePicked=true;await delay(800,signal);continue;}}
      if(passwordSent&&account.totp&&!authMethod){const radio=await visible(page,'input[name="two-factor-method"]');if(radio){await radio.check();await next(page);authMethod=true;await delay(800,signal);continue;}}
      if(emailSent&&account.type==='EMAIL_OTP'&&!codeMethod){const use=await visible(page,'button:has-text("Send code"), a:has-text("Send code"), button:has-text("email code")');if(use){await use.click();codeMethod=true;await delay(800,signal);continue;}}
      const input=emailSent&&!codeSent?await visible(page,codeSelector):null;
      if(input) {
        let code;
        if(account.totp){const left=30-Math.floor(Date.now()/1000)%30;if(left<5)await delay((left+1)*1000,signal);code=totpCode(account.totp);}
        else if(baseline){onProgress('Đang chờ mã OTP mới từ hòm thư…');const messages=await inbox(account,{signal});code=messages.find(m=>m.code&&!baseline.has(m.id))?.code;}
        else throw new LoginError('LOGIN_MANUAL_REQUIRED','Dịch vụ yêu cầu mã xác minh. Dùng đăng nhập thủ công hoặc cung cấp mã bí mật 2FA.');
        if(code){credentialOrigin(page);await input.fill(code);await next(page);codeSent=true;onProgress('Đã gửi mã xác minh, đang chờ phiên Muse…');}
      }
      await delay(baseline?2500:1000,signal);
    }
    throw new LoginError('LOGIN_TIMEOUT','Hết thời gian chờ đăng nhập. Kiểm tra thông tin hoặc dùng đăng nhập thủ công.');
  } catch(error) {
    if(signal?.aborted)throw new LoginError('LOGIN_CANCELLED','Đã dừng đăng nhập.');
    if(error instanceof LoginError)throw error;
    throw new LoginError('LOGIN_BROWSER','Không hoàn tất đăng nhập. Kiểm tra trình duyệt, mạng/proxy hoặc dùng đăng nhập thủ công.');
  } finally {signal?.removeEventListener('abort',abort);await context?.close().catch(()=>{});await browser?.close().catch(()=>{});}
}
