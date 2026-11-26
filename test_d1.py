from email.message import Message
from io import BytesIO
import json
from unittest import TestCase
from unittest.mock import patch
from urllib.error import HTTPError

with patch.dict('os.environ', {'ACCOUNT': 'offline-test'}):
    import d1


def response(value):
    return BytesIO(json.dumps(dict(success=True, result=value)).encode())


def http_error(status, retry_after=None):
    headers = Message()
    if retry_after is not None:
        headers['Retry-After'] = str(retry_after)
    return HTTPError('https://example.com', status, 'Test', headers, BytesIO(b'test error'))


class D1RequestTest(TestCase):
    def setUp(self):
        environment = patch.dict('os.environ', {'CF_TOKEN': 'test-token'})
        environment.start()
        self.addCleanup(environment.stop)

    def test_rapid_requests_are_spaced_when_pacing_is_enabled(self):
        started = []
        now = 10.0

        def sleep(seconds):
            nonlocal now
            now += seconds

        def send(request, timeout):
            started.append(now)
            return response([])

        with (patch.dict('os.environ', {'D1_MIN_REQUEST_INTERVAL_SECONDS': '0.32'}),
              patch.object(d1, '_last_request_started', float('-inf'), create=True),
              patch.object(d1.time, 'monotonic', lambda: now),
              patch.object(d1.time, 'sleep', sleep),
              patch.object(d1.urllib.request, 'urlopen', send)):
            d1.api('?name=test')
            d1.api('/test/query', {'sql': 'SELECT 1'})

        self.assertEqual(len(started), 2)
        self.assertAlmostEqual(started[1] - started[0], 0.32)

    def test_retries_a_rate_limited_request_after_the_server_delay(self):
        with (patch.object(d1.time, 'sleep') as sleep,
              patch.object(d1.urllib.request, 'urlopen',
                           side_effect=[http_error(429, 7), response([{'ok': True}])]) as send):
            self.assertEqual(d1.api('/test/query', {'sql': 'SELECT 1'}), [{'ok': True}])
            sleep.assert_called_once_with(7)
            self.assertEqual(send.call_count, 2)
            self.assertIs(send.call_args_list[0].args[0], send.call_args_list[1].args[0])

    def test_non_rate_limit_errors_do_not_repeat_requests(self):
        with patch.object(d1.urllib.request, 'urlopen', side_effect=http_error(503)) as send:
            with self.assertRaisesRegex(RuntimeError, 'D1 HTTP 503'):
                d1.api('/test/query', {'sql': 'UPDATE financing_events SET amount=?', 'params': ['10']})
            self.assertEqual(send.call_count, 1)

    def test_query_usage_reports_observed_and_missing_counts_without_sql(self):
        statement = 'SELECT * FROM private_table WHERE id=?'
        results = [
            [{'meta': {'rows_read': 17, 'rows_written': 0}, 'results': [{'ok': True}]}],
            [{'meta': {'rows_read': 3, 'rows_written': 2}, 'results': []}],
            [{'results': []}],
        ]
        with (patch.object(d1, 'api', side_effect=results),
              patch.object(d1, '_query_usage', {}, create=True),
              patch.dict('os.environ', {'GITHUB_ACTIONS': 'true'}),
              patch('builtins.print') as log):
            self.assertEqual(d1.query('/test', statement, ['private-value']), [{'ok': True}])
            d1.query('/test', 'UPDATE private_table SET id=1')
            d1.query('/test', 'SELECT 2')
            d1.report_query_usage()
        message = str(log.call_args)
        self.assertIn('queries=3', message)
        self.assertIn('rows_read=20', message)
        self.assertIn('rows_written=2', message)
        self.assertIn('queries_without_complete_metrics=1', message)
        self.assertNotIn('private_table', message)
        self.assertNotIn('private-value', message)
