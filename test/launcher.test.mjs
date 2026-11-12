import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass'];
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('Windows launcher works with source only and explains startup failures', { skip: process.platform !== 'win32', timeout: 90000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'muse-launcher-'));
  const clone = path.join(dir, 'Bản clone có dấu & khoảng trắng');
  await mkdir(clone);
  for (const item of ['server', 'public', 'schema', 'scripts', 'package.json', 'Start-Muse-Web.cmd']) {
    await cp(path.join(root, item), path.join(clone, item), { recursive: true });
  }
  const port = await freePort();
  const env = { ...process.env, MUSE_NODE: process.execPath, MUSE_PORT: String(port), MUSE_DATA_DIR: 'du lieu rieng', LOCALAPPDATA: dir, MUSE_BACKEND_URL: 'http://127.0.0.1:9' };
  delete env.MUSE_API_KEY;
  delete env.MUSE_KEY_FILE;
  delete env.NODE_OPTIONS;
  const args = [...psArgs, '-File', path.join(clone, 'scripts/start.ps1'), '-NoBrowser'];
  function environment(overrides) {
    const result = { ...env };
    for (const [name, value] of Object.entries(overrides)) {
      for (const key of Object.keys(result)) if (key.toLowerCase() === name.toLowerCase()) delete result[key];
      result[name] = value;
    }
    return result;
  }
  let invocation = 0;
  async function launch(overrides = {}, withoutNode = false) {
    // File handles avoid inherited pipe handles keeping execFile open after PS exits.
    const prefix = path.join(dir, `launch-${++invocation}`);
    const out = await open(prefix + '.out', 'w'), err = await open(prefix + '.err', 'w');
    // Windows PowerShell may restore ProgramFiles on startup; simulate a clean
    // machine after it has initialized, without changing this machine's PATH.
    const childArgs = withoutNode ? [...psArgs, '-Command', "$env:PATH = ''; $env:ProgramFiles = $env:LOCALAPPDATA; ${env:ProgramFiles(x86)} = $env:LOCALAPPDATA; & $env:MUSE_TEST_LAUNCHER -NoBrowser"] : args;
    const child = spawn(powershell, childArgs, { cwd: tmpdir(), env: environment({ ...overrides, MUSE_TEST_LAUNCHER: path.join(clone, 'scripts/start.ps1') }), windowsHide: true, stdio: ['ignore', out.fd, err.fd] });
    const timer = setTimeout(() => child.kill(), 40000);
    try {
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
      return { code, stdout: await readFile(prefix + '.out', 'utf8'), stderr: await readFile(prefix + '.err', 'utf8') };
    } finally { clearTimeout(timer); await out.close(); await err.close(); }
  }
  const url = `http://127.0.0.1:${port}`;
  const lock = path.join(clone, env.MUSE_DATA_DIR, 'studio.lock');
  t.after(async () => {
    // Kill only the PID in this test's fresh, isolated data directory.
    try { const owner = JSON.parse(await readFile(lock, 'utf8')); process.kill(owner.pid); } catch {}
  });

  await t.test('missing Node gives installation instructions', async () => {
    const result = await launch({ MUSE_NODE: '' }, true);
    assert.equal(result.code, 1, JSON.stringify(result));
    assert.match(result.stdout, /Chua tim thay Node.js/);
    assert.match(result.stdout, /https:\/\/nodejs.org\/en\/download/);
  });
  await t.test('old Node and unavailable SQLite fail before launching the server', async () => {
    const stub = path.join(dir, 'runtime-stub.cmd');
    for (const [version, message] of [['v20.0.0', /qua cu/], ['v24.0.0', /khong mo duoc SQLite/]]) {
      await writeFile(stub, `@echo off\r\nif "%~1"=="--version" (\r\necho ${version}\r\nexit /b 0\r\n)\r\nexit /b 1\r\n`);
      const result = await launch({ MUSE_NODE: stub });
      assert.equal(result.code, 1, JSON.stringify(result));
      assert.match(result.stdout, message);
    }
  });
  await t.test('CMD preserves a failure until the user presses a key', async () => {
    // Use a simple working directory so cmd metacharacters in clone paths are irrelevant.
    const child = spawn(process.env.ComSpec, ['/d', '/c', 'Start-Muse-Web.cmd -NoBrowser'], {
      cwd: clone, env: { ...env, MUSE_NODE: path.join(dir, 'missing-node.exe') }, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let output = '';
    const finished = new Promise(resolve => child.on('exit', code => resolve(code)));
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    try {
      const deadline = Date.now() + 10000;
      while (!output.includes('Nhan phim bat ky') && child.exitCode === null && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
      assert.match(output, /MUSE_NODE khong tro/);
      assert.match(output, /Nhan phim bat ky/);
      assert.equal(child.exitCode, null, 'CMD must wait for input on failure');
      child.stdin.end('\r\n');
      assert.equal(await finished, 1);
    } finally { if (child.exitCode === null) child.kill(); }
  });
  await t.test('server startup error reports the log file', async () => {
    const result = await launch({ MUSE_BACKEND_URL: 'invalid-url' });
    assert.equal(result.code, 1, JSON.stringify(result));
    assert.match(result.stdout, /May chu da dung/);
    assert.match(result.stdout, /server-error.log/);
    assert.match(await readFile(path.join(clone, env.MUSE_DATA_DIR, 'server-error.log'), 'utf8'), /Invalid URL/);
  });
  await t.test('foreign listener is reported without overwriting logs', async () => {
    const other = http.createServer((req, res) => { res.end('{"ok":true}'); });
    await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
    try {
      const result = await launch({ MUSE_PORT: String(other.address().port) });
      assert.equal(result.code, 1, JSON.stringify(result));
      assert.match(result.stdout, /dang duoc ung dung khac su dung/);
    } finally { await new Promise(resolve => other.close(resolve)); }
  });
  await t.test('fresh source starts with Unicode paths, custom port/data and no Muse or Python', async () => {
    const result = await launch();
    assert.equal(result.code, 0, JSON.stringify(result));
    assert.equal((await (await fetch(`${url}/api/health`)).json()).ok, true);
    assert.deepEqual(await (await fetch(`${url}/api/projects`)).json(), []);
    const capabilities = await (await fetch(`${url}/api/media/capabilities`)).json();
    assert.equal(capabilities.python, false);
    assert.equal(capabilities.ffmpeg, false);
    assert.equal((await (await fetch(`${url}/api/backend`)).json()).connected, false);
    assert.equal((await fetch(url)).status, 200);
  });
  await t.test('repeat launch uses the existing process', async () => {
    const original = await readFile(lock, 'utf8');
    const result = await launch();
    assert.equal(result.code, 0, JSON.stringify(result));
    assert.match(result.stdout, /Muse Web da chay/);
    assert.equal(await readFile(lock, 'utf8'), original);
  });
});
