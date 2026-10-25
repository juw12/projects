#!/usr/bin/env python3
"""Deterministic 1.0.2 regressions: cashflow-neutral drawdown and stale trade tickets."""
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

APP = Path(__file__).resolve().parent.parent


class IterationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        os.environ['TWIN_DATA'] = cls.directory.name
        spec = importlib.util.spec_from_file_location('iteration_server', APP / 'server.py')
        cls.server = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.server)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def series(self, start=0, count=120, value=-0.05):
        return {
            f'{2000 + i // 12:04d}-{i % 12 + 1:02d}': value
            for i in range(start, start + count)
        }

    def test_drawdown_excludes_deposits(self):
        s = self.server
        with patch.object(s, 'monthly_returns', return_value=self.series()):
            first = s.goal_sim({'TEST': 1}, 1, 1000, 0, 2000, paths=40)
            large_deposits = s.goal_sim({'TEST': 1}, 1, 1000, 10000, 2000, paths=40)
        expected = round(((0.95 ** 12) - 1) * 100, 1)
        self.assertEqual(first['median_worst_drop'], expected)
        self.assertEqual(large_deposits['median_worst_drop'], expected)
        self.assertGreater(large_deposits['median'], first['median'])

    def test_missing_months_do_not_join_history(self):
        s = self.server
        data = self.series(0, 65, 0.01)
        data.update(self.series(100, 70, 0.02))
        with patch.object(s, 'monthly_returns', return_value=data):
            result = s.goal_sim({'TEST': 1}, 1, 1000, 0, 2000, paths=40)
        self.assertEqual(result['history']['months'], 70)
        self.assertEqual(result['history']['from'], sorted(self.series(100, 70))[0])
        self.assertTrue(any('Missing shared months' in warning for warning in result['warnings']))

    def test_no_synthetic_wrap_from_last_to_first_month(self):
        s = self.server
        class LastValidStart:
            def __init__(self, seed):
                self.sizes = []
            def randrange(self, limit):
                self.sizes.append(limit)
                return limit - 1
        fake = LastValidStart(19)
        data = self.series(value=0.0)
        data[sorted(data)[0]] = 0.9
        with patch.object(s, 'monthly_returns', return_value=data), patch.object(s.random, 'Random', return_value=fake):
            result = s.goal_sim({'TEST': 1}, 1, 1000, 0, 2000, paths=1)
        self.assertEqual(fake.sizes, [109])
        self.assertEqual(result['median'], 1000)

    def test_zero_weights_and_nan_rejected(self):
        s = self.server
        with self.assertRaises(s.AppError):
            s.goal_sim({'TEST': 0}, 1, 100, 0, 200)
        with self.assertRaises(s.AppError):
            s.goal_sim({'TEST': float('nan')}, 1, 100, 0, 200)

    def test_invalid_history_rejected(self):
        s = self.server
        with patch.object(s, 'monthly_returns', return_value=self.series(value=float('nan'))):
            with self.assertRaises(s.AppError):
                s.goal_sim({'TEST': 1}, 1, 100, 0, 200, paths=1)

    def test_half_up_risk_rounding_matches_browser(self):
        s = self.server
        result = s.score_quiz({'risk_points': [2, 3], 'style_points': [2], 'flags': []})
        self.assertEqual(result['risk_level'], 3)
        with self.assertRaises(s.AppError):
            s.score_quiz({'risk_points': [99], 'style_points': [2], 'flags': []})

    def test_stale_and_cross_user_trade_tokens(self):
        s = self.server
        with patch.object(s, 'execute_trade_step', side_effect=lambda *args: {'ok': True, 'data': {'status': 'triggered'}}):
            first = s.day_trade_step('alice', 'entry', 'demo', {})
            second = s.day_trade_step('alice', 'entry', 'demo', {})
            self.assertNotEqual(first['run_id'], second['run_id'])
            with self.assertRaises(s.AppError):
                s.day_trade_step('alice', 'exit', 'demo', {}, first['run_id'])
            with self.assertRaises(s.AppError):
                s.day_trade_step('bob', 'exit', 'demo', {}, second['run_id'])

    def test_failed_entry_removes_stale_orders(self):
        s = self.server
        root = s.trader_root('failed', 'demo') / 'trader'
        (root / 'orders.json').write_text('[{"symbol":"OLD"}]')
        with patch.object(s, 'execute_trade_step', side_effect=s.AppError('no entry')):
            with self.assertRaises(s.AppError):
                s.day_trade_step('failed', 'entry', 'demo', {})
        self.assertFalse((root / 'orders.json').exists())
        self.assertEqual(s.load_json(root / 'state/pipeline.json', {})['completed'], [])

    def test_prerequisites_and_limit_changes_invalidate_tickets(self):
        s = self.server
        with patch.object(s, 'execute_trade_step', side_effect=lambda *args: {'ok': True, 'data': {'status': 'triggered'}}):
            result = s.day_trade_step('limits', 'entry', 'demo', {})
            with self.assertRaises(s.AppError):
                s.day_trade_step('limits', 'broker', 'demo', {}, result['run_id'])
            path = s.trader_root('limits', 'demo') / 'trader/config.json'
            path.write_text(path.read_text() + '\n')
            with self.assertRaises(s.AppError):
                s.day_trade_step('limits', 'exit', 'demo', {}, result['run_id'])

    def test_replay_respects_flat_by(self):
        s = self.server
        root = s.trader_root('flatby', 'demo') / 'trader'
        (root / 'plan.json').write_text(json.dumps({'flat_by': '15:55'}))
        with patch.object(s, 'run_tool', return_value={'ok': True}) as tool:
            s.execute_trade_step('flatby', 'timemachine', 'demo', {})
        args = tool.call_args.args[2]
        self.assertEqual(args[args.index('--until') + 1], '15:55')
        demo = json.loads((APP / 'web/demo/trade.json').read_text())
        for target, data in demo['plans'].items():
            self.assertEqual(data['timemachine']['mc']['until'], data['exit']['flat_by'], target)


if __name__ == '__main__':
    unittest.main(verbosity=2)
