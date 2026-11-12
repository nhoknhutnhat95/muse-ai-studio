"""Offline contract tests. Remote HTTP and the generation browser are blocked."""
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
TEMP = tempfile.TemporaryDirectory(prefix='muse-standalone-test-')
os.environ.update(MUSE2API_HOME=TEMP.name, MUSE2API_PROFILE_ROOT=TEMP.name + '/profiles', MUSE2API_KEY='test-only')
sys.path.insert(0, str(ROOT / 'scripts'))
import standalone_backend as backend
from fastapi.testclient import TestClient


class StandaloneContract(unittest.TestCase):
    def setUp(self):
        self.network = patch('requests.sessions.Session.request', side_effect=AssertionError('Remote network forbidden'))
        self.network.start()
        self.browser = patch.object(backend.engine, 'start', side_effect=AssertionError('Real browser forbidden'))
        self.browser.start()
        backend.store.accounts.clear()
        backend.store.tasks.clear()
        backend.proxies.clear()
        self.client = TestClient(backend.app, headers={'Authorization': 'Bearer test-only'})
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.browser.stop()
        self.network.stop()

    def add(self):
        r = self.client.post('/admin/accounts', json={'label': 'offline fixture', 'cookies': {'hatch_sess': 'private-fixture'}})
        self.assertEqual(r.status_code, 200)
        return backend.store.accounts[-1]['id']

    def poll(self, tid):
        for _ in range(300):
            r = self.client.get('/v1/videos/' + tid).json()
            if r['status'] not in ('queued', 'processing'):
                return r
            time.sleep(.01)
        self.fail('Task did not finish')

    def test_empty_backend_auth_and_no_updater(self):
        self.assertTrue(self.client.get('/healthz').json()['studioStandalone'])
        self.assertEqual(self.client.get('/admin/status').json()['stats']['total'], 0)
        self.assertEqual(self.client.get('/admin/status', headers={'Authorization': ''}).status_code, 401)
        for p in ['/admin/repo/push', '/admin/update/upgrade', '/admin/apikey', '/openapi.json']:
            self.assertEqual(self.client.get(p).status_code, 404)

    def test_account_proxy_contract_no_secret_in_account_response(self):
        aid = self.add()
        p = self.client.post('/admin/proxies', json={'name': 'fixture', 'proxy': 'http://user:secret@example.invalid:8080'}).json()['id']
        self.assertEqual(self.client.patch('/admin/accounts/' + aid, json={'proxy_id': p}).status_code, 200)
        self.assertEqual(backend.store.get_account(aid)['proxy']['username'], 'user')
        raw = self.client.get('/admin/accounts').text
        self.assertNotIn('private-fixture', raw)
        self.assertNotIn('secret', raw)
        self.assertEqual(self.client.delete('/admin/proxies/' + p).status_code, 409)
        self.assertEqual(self.client.patch('/admin/accounts/' + aid, json={'proxy_id': 'missing'}).status_code, 404)
        self.assertEqual(backend.store.get_account(aid)['proxy_id'], p)
        self.client.patch('/admin/accounts/' + aid, json={'proxy_id': None})
        self.assertEqual(self.client.delete('/admin/proxies/' + p).status_code, 200)

    def test_generation_once_selected_account_identity_and_media_range(self):
        aid = self.add()
        calls = []
        def generate(cookies, prompt, **kwargs):
            calls.append((prompt, kwargs))
            target = Path(backend.cfg.media_dir) / 'fixture.mp4'
            target.write_bytes(b'0123456789')
            return {'filename': target.name, 'size': 10, 'kind': 'video'}
        with patch.object(backend.engine, 'start'), patch.object(backend.engine, 'generate', generate), patch.object(backend.upstream, '_sync_cookies'):
            r = self.client.post('/v1/videos', json={'prompt': 'locked narration', 'account_id': aid, 'duration': 8, 'size': '9:16'})
            task = self.poll(r.json()['id'])
        self.assertEqual(task['status'], 'completed')
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1]['account_id'], aid)
        self.assertIn('locked narration', calls[0][0])
        media = self.client.get(task['result']['url'], headers={'Range': 'bytes=2-5'})
        self.assertEqual(media.status_code, 206)
        self.assertEqual(media.content, b'2345')
        self.assertEqual(self.client.get(task['result']['url'], headers={'Authorization': ''}).status_code, 401)
        self.assertEqual(self.client.post('/v1/videos/' + task['id'] + '/cancel').json()['status'], 'completed')

    def test_uncertain_generation_is_unknown_and_never_repeated(self):
        self.add()
        def generate(*args, **kwargs):
            backend.engine._ensure_local().studio_submitted = True
            raise TimeoutError('must not expose cookies or remote content')
        with patch.object(backend.engine, 'start'), patch.object(backend.engine, 'generate', side_effect=generate) as fake:
            tid = self.client.post('/v1/images/tasks', json={'prompt': 'only once'}).json()['id']
            task = self.poll(tid)
            self.assertEqual(task['status'], 'unknown')
            self.assertEqual(fake.call_count, 1)
            self.assertNotIn('cookies', json.dumps(task))
        for _ in range(3):
            self.assertEqual(self.client.get('/v1/images/tasks/' + tid).json()['status'], 'unknown')

    def test_missing_account_fails_before_browser_and_restart_is_unknown(self):
        tid = self.client.post('/v1/videos', json={'prompt': 'no accounts'}).json()['id']
        self.assertEqual(self.poll(tid)['status'], 'failed')
        task = backend.store.create_task('video', 'interrupted')
        self.client.__exit__(None, None, None)
        self.client.__enter__()
        self.assertEqual(self.client.get('/v1/videos/' + task['id']).json()['status'], 'unknown')


if __name__ == '__main__':
    unittest.main()
