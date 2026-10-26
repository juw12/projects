"""Regression checks for isolated Chrome-profile teardown, with no Chrome needed."""
import errno
import tempfile
import unittest
import threading
from unittest.mock import patch

from verify_browser import BrowserProfile, accept_report


class CleanupTests(unittest.TestCase):
    def exercise(self, effects, expected_calls, expected_error=None):
        profile = BrowserProfile(prefix='cleanup-unit-')
        try:
            with patch.object(tempfile.TemporaryDirectory, 'cleanup', side_effect=effects) as cleanup:
                with patch('verify_browser.time.sleep'):
                    if expected_error is None:
                        profile.cleanup()
                    else:
                        with self.assertRaises(OSError) as raised:
                            profile.cleanup()
                        self.assertEqual(raised.exception.errno, expected_error)
                self.assertEqual(cleanup.call_count, expected_calls)
        finally:
            profile.cleanup()

    def test_late_progress_cannot_erase_terminal_report(self):
        latest = {'done': False, 'checks': []}
        finished = threading.Event()
        report_lock = threading.Lock()
        accept_report(latest, {'done': True, 'checks': ['complete']}, report_lock, finished)
        accept_report(latest, {'done': False, 'checks': ['stale']}, report_lock, finished)
        self.assertTrue(finished.is_set())
        self.assertTrue(latest['done'])
        self.assertEqual(latest['checks'], ['complete'])

    def test_only_directory_not_empty_is_retried(self):
        self.exercise([OSError(errno.ENOTEMPTY, 'late browser write'), None], 2)

    def test_unrelated_errors_are_not_hidden(self):
        self.exercise([OSError(errno.EACCES, 'permission error')], 1, errno.EACCES)

    def test_retries_are_bounded(self):
        self.exercise([OSError(errno.ENOTEMPTY, 'persistent writer')] * 8, 8, errno.ENOTEMPTY)

    def test_windows_handle_release_is_retried(self):
        error = OSError(errno.EACCES, 'Windows handle still releasing')
        error.winerror = 5
        self.exercise([error, None], 2)

    def test_persistent_windows_access_denied_still_raises(self):
        error = OSError(errno.EACCES, 'Windows permission failure')
        error.winerror = 5
        self.exercise([error] * 8, 8, errno.EACCES)


if __name__ == '__main__':
    unittest.main()
