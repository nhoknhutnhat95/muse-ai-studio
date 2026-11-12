"""Private, process-owned Muse2API runtime for Muse Studio Web.

No desktop binaries, license files or installed account paths are used here.
"""
from __future__ import annotations
import asyncio
import contextlib
import json
import logging
import os
from pathlib import Path
import sys
import threading
import time
import uuid
from urllib.parse import urlsplit, unquote

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "vendor" / "muse2api"))
import app as upstream
from fastapi import Body, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from store import _read, _write
from proxy import split_proxy_url, normalize_server, request_proxy_context

app, store, engine, cfg = upstream.app, upstream.store, upstream.engine, upstream.CFG
# Only our host performs updates. Do not expose upstream Git/update or API-key UI.
allowed = {
    '/v1/chat/completions', '/v1/models', '/v1/media/{name}',
    '/admin/accounts', '/admin/accounts/{aid}', '/admin/accounts/{aid}/test',
    '/admin/accounts/{aid}/cookies', '/admin/accounts/{aid}/quota', '/admin/quota',
    '/admin/accounts/keepalive', '/admin/accounts/{aid}/keepalive',
    '/admin/keepalive/status', '/admin/media', '/admin/media/delete', '/admin/media/{name}',
}
replaced = {('/admin/accounts', 'POST'), ('/admin/accounts/{aid}', 'PATCH')}
app.router.routes[:] = [r for r in app.router.routes if getattr(r, 'path', '') in allowed
                       and not any((r.path, m) in replaced for m in getattr(r, 'methods', []))]
app.user_middleware.clear()
app.router.on_startup.clear()
app.router.on_shutdown.clear()
# Library errors can contain account labels and remote response fragments.
# Public error strings below are fixed and logs contain lifecycle events only.
logging.getLogger('muse2api').disabled = True
logging.getLogger('muse2api.engine').disabled = True
events: dict[str, threading.Event] = {}
task_lock = threading.RLock()
proxy_file = Path(cfg.data_dir) / 'proxies.json'
proxies = _read(str(proxy_file), [])
if not isinstance(proxies, list):
    raise RuntimeError('Invalid standalone proxy store')


@app.middleware('http')
async def private_api(request: Request, call_next):
    if request.url.path != '/healthz':
        import secrets
        if not secrets.compare_digest(request.headers.get('authorization', ''), 'Bearer ' + cfg.api_key):
            return JSONResponse({'detail': 'Unauthorized'}, status_code=401)
    return await call_next(request)


@app.get('/healthz')
def health():
    return {'status': 'ok', 'studioStandalone': True}


@app.get('/admin/status')
def status():
    result = upstream.admin_status()
    result['config'].update(gen_slots=upstream.GEN_LOCK.limit,
                            gen_active=upstream.GEN_LOCK._active_count)
    return result


def proxy_by_id(pid):
    if not pid:
        return None
    found = next((p for p in proxies if p['id'] == pid), None)
    if not found:
        raise HTTPException(404, 'Khong tim thay proxy; khong chuyen sang ket noi truc tiep.')
    return found


def proxy_config(record):
    if not record:
        return None
    raw = record['url']
    return split_proxy_url({'server': raw})


def assigned_proxy(pid):
    return proxy_config(proxy_by_id(pid))


def clean_proxy(data, existing=None):
    raw = str(data.get('proxy') or (existing or {}).get('url') or '').strip()
    if '://' not in raw:
        fields = raw.split(':')
        if len(fields) not in (2, 4):
            raise HTTPException(400, 'Dinh dang proxy khong hop le.')
        from urllib.parse import quote
        auth = quote(fields[2], safe='') + ':' + quote(fields[3], safe='') + '@' if len(fields) == 4 else ''
        raw = data.get('scheme', 'http') + '://' + auth + fields[0] + ':' + fields[1]
    try:
        conf = split_proxy_url({'server': raw})
        normalize_server(conf['server'])
    except Exception:
        raise HTTPException(400, 'Proxy can HTTP hoac SOCKS5 hop le.') from None
    return {**(existing or {'id': uuid.uuid4().hex[:12], 'created_at': int(time.time())}),
            'name': str(data.get('name', (existing or {}).get('name', 'Proxy')))[:40], 'url': raw}


@app.get('/admin/proxies')
def list_proxies():
    # Node sanitizes these records; this endpoint is authenticated and private.
    return {'proxies': [{**p, 'usage': sum(a.get('proxy_id') == p['id'] for a in store.accounts)} for p in proxies]}


@app.post('/admin/proxies')
def add_proxy(data: dict = Body()):
    with task_lock:
        p = clean_proxy(data)
        proxies.append(p)
        _write(str(proxy_file), proxies)
    return {'ok': True, 'id': p['id']}


@app.patch('/admin/proxies/{pid}')
def patch_proxy(pid: str, data: dict = Body()):
    with task_lock, upstream.ACCOUNT_POOL.cond:
        affected = [a for a in store.accounts if a.get('proxy_id') == pid]
        if any(a['id'] in upstream.ACCOUNT_POOL.busy_accounts for a in affected):
            raise HTTPException(409, 'Proxy dang duoc su dung.')
        p = proxy_by_id(pid)
        p.update(clean_proxy(data, p))
        _write(str(proxy_file), proxies)
        for a in affected:
            store.update_account(a['id'], proxy=proxy_config(p), ok=None, checked_at=0)
    return {'ok': True}


@app.delete('/admin/proxies/{pid}')
def delete_proxy(pid: str):
    with task_lock, upstream.ACCOUNT_POOL.cond:
        if any(a.get('proxy_id') == pid for a in store.accounts):
            raise HTTPException(409, 'Go gan proxy khoi tai khoan truoc khi xoa.')
        proxies.remove(proxy_by_id(pid))
        _write(str(proxy_file), proxies)
    return {'ok': True}


def probe_proxy(p):
    import requests
    start = time.monotonic()
    try:
        with request_proxy_context(proxy_config(p)) as options:
            r = requests.get('https://api.ipify.org?format=json', timeout=15, allow_redirects=False, **options)
            r.raise_for_status()
            import ipaddress
            ip = str(ipaddress.ip_address(r.json()['ip']))
        return {'ok': True, 'ip': ip, 'ms': round((time.monotonic() - start) * 1000)}
    except Exception:
        return {'ok': False, 'error': 'Khong ket noi duoc proxy.'}


@app.post('/admin/proxies/test')
def test_proxy_input(data: dict = Body()):
    return probe_proxy(clean_proxy(data))


@app.post('/admin/proxies/{pid}/test')
def test_proxy(pid: str):
    return probe_proxy(proxy_by_id(pid))


@app.post('/admin/accounts')
def add_account(data: dict = Body()):
    with task_lock:
        proxy = assigned_proxy(data.get('proxy_id'))
        before = {a['id'] for a in store.accounts}
        result = upstream.add_account(upstream.AccountRequest(**data))
        for a in store.accounts:
            if a['id'] not in before:
                store.update_account(a['id'], proxy_id=data.get('proxy_id'), proxy=proxy,
                                     login_type=str(data.get('login_type', 'COOKIE'))[:80])
    return {'ok': True, 'added': result['count'], 'count': result['count'], 'warning': result.get('warning')}


@app.patch('/admin/accounts/{aid}')
def patch_account(aid: str, data: dict = Body()):
    with task_lock, upstream._account_operation(aid):
        changes = {k: v for k, v in data.items() if k in ('label', 'enabled')}
        if 'proxy_id' in data:
            changes.update(proxy_id=data['proxy_id'] or '', proxy=assigned_proxy(data['proxy_id']) or {}, ok=None, checked_at=0)
        store.update_account(aid, **changes)
    return {'ok': True}


# The engine sends once. Mark the boundary before the browser send, so lost
# confirmation/timeouts cannot be reported as safe to retry.
original_send = engine._send


def send_once(prompt):
    local = engine._ensure_local()
    stop = getattr(local, 'studio_stop', None)
    if stop and stop.is_set():
        raise RuntimeError('Cancelled before submission')
    local.studio_submitted = True
    return original_send(prompt)


engine._send = send_once


def generate_once(tid, req, references, kind, stop):
    account = None
    acquired = False
    local = engine._ensure_local()
    local.studio_stop, local.studio_submitted = stop, False
    timeout = min(1800, max(1, int(req.get('timeout') or (600 if kind == 'video' else 240))))
    deadline = time.monotonic() + timeout
    try:
        while not stop.is_set() and time.monotonic() < deadline:
            if upstream.GEN_LOCK.acquire(timeout=0.2):
                acquired = True
                break
        if stop.is_set():
            store.update_task(tid, status='cancelled')
            return
        if not acquired:
            raise RuntimeError('Queue timeout')
        account = upstream.ACCOUNT_POOL.acquire(account_id=req.get('account_id'), timeout=max(1, deadline - time.monotonic()))
        upstream._bind_account_proxy(account)
        store.update_task(tid, status='processing', progress=5, account=account['id'])
        engine.start()
        instruction = f"Create a {kind}. Aspect ratio: {req.get('size') or req.get('aspect_ratio') or '16:9'}. "
        if kind == 'video':
            instruction += f"Requested duration: {req.get('duration') or 10} seconds. "
        if references:
            instruction += ('Use the attached references for character identity; do not force them as the first frame. ' if req.get('reference_mode') == 'identity'
                            else 'Use the first attached image as the starting frame; other images are references. ') if kind == 'video' else 'Use the attached reference images. '
        prompt = instruction + req['prompt']
        store.update_task(tid, api_prompt=prompt)
        result = engine.generate(account['cookies'], prompt, expect=kind,
                                 timeout=max(1, int(deadline - time.monotonic())),
                                 expires=account.get('cookies_exp'), account_id=account['id'],
                                 reference_images=references, stop_event=stop,
                                 on_progress=lambda p: store.update_task(tid, progress=p))
        url = '/v1/media/' + result['filename']
        store.update_task(tid, status='completed', progress=100, url=url,
                          result={k: result[k] for k in ('filename', 'size', 'kind')} | {'url': url})
        store.mark(account['id'], True, '')
        upstream._sync_cookies(account['id'])
    except Exception:
        unknown = local.studio_submitted
        state = 'unknown' if unknown else 'cancelled' if stop.is_set() else 'failed'
        store.update_task(tid, status=state, error=('Chua ro ket qua tren Muse; khong tu gui lai.' if unknown
                          else 'Chua gui tao media. Kiem tra tai khoan, proxy va trinh duyet.'))
    finally:
        engine.close_current_page()
        upstream._clear_account_proxy()
        if account:
            upstream.ACCOUNT_POOL.release(account['id'])
        if acquired:
            upstream.GEN_LOCK.release()
        events.pop(tid, None)
        local.studio_stop = None


def submit(data, kind):
    if not isinstance(data.get('prompt'), str) or not data['prompt'].strip():
        raise HTTPException(400, 'Can prompt.')
    refs = data.get('images') or data.get('reference_image') or data.get('image') or []
    if isinstance(refs, str):
        refs = [refs]
    if not isinstance(refs, list) or len(refs) > 6:
        raise HTTPException(400, 'Toi da 6 anh tham chieu.')
    refs = upstream._prepare_reference_images(refs)
    with task_lock:
        if len(events) >= 32:
            raise HTTPException(429, 'Hang doi day.')
        task = store.create_task(kind, data['prompt'])
        stop = threading.Event()
        events[task['id']] = stop
        threading.Thread(target=generate_once, args=(task['id'], data, refs, kind, stop), daemon=True).start()
    return {'id': task['id'], 'status': 'queued'}


@app.post('/v1/videos')
def video(data: dict = Body()):
    return submit(data, 'video')


@app.post('/v1/images/tasks')
def image(data: dict = Body()):
    return submit(data, 'image')


@app.get('/v1/videos/{tid}')
@app.get('/v1/images/tasks/{tid}')
def get_task(tid: str):
    task = store.get_task(tid)
    if not task:
        raise HTTPException(404, 'Khong tim thay tac vu.')
    return dict(task)


@app.post('/v1/videos/{tid}/cancel')
@app.post('/v1/images/tasks/{tid}/cancel')
def cancel_task(tid: str):
    result = get_task(tid)
    if tid in events:
        events[tid].set()
    return result  # A running remote generation cannot be claimed cancelled.


@app.get('/admin/tasks')
def tasks(limit: int = 60):
    return {'tasks': [{**t, 'type': t.get('kind')} for t in store.list_tasks(min(500, max(1, limit)))]}


@contextlib.asynccontextmanager
async def lifespan(_):
    for task in list(store.tasks.values()):
        if task.get('status') in ('queued', 'processing', 'running'):
            store.update_task(task['id'], status='unknown', error='Backend restarted; do not resubmit automatically.')
    yield
    for event in list(events.values()):
        event.set()
    engine.stop()


app.router.lifespan_context = lifespan


if __name__ == '__main__':
    import uvicorn
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=cfg.port, log_level='warning', access_log=False))
    if os.environ.get('MUSE_STUDIO_PARENT') == '1':
        def parent_watch():
            sys.stdin.buffer.read()
            server.should_exit = True
        threading.Thread(target=parent_watch, daemon=True).start()
    server.run()
