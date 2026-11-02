"""Loyalty: points, tiers, coupons on real orders, café promotions, achievements and referrals."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from crewcup import engine as E  # noqa: E402
from crewcup import loyalty as L  # noqa: E402
from crewcup import seed  # noqa: E402

START = seed.DEMO_START
LATTE = {"item": "latte", "sugar": 50}


def coupon_of(state, emp_id, source):
    return next(coupon for coupon in state["loyalty"]["coupons"].values()
                if coupon["emp"] == emp_id and coupon["source"] == source and coupon["status"] == "active")


class LoyaltyTests(unittest.TestCase):
    def setUp(self):
        self.state = seed.build_state(real_now=0.0)

    def test_seeded_accounts_do_not_get_retroactive_rewards(self):
        acc = L.account(self.state, "e_andi")
        self.assertIn("runner", acc["achievements"])        # already met via 3 runs → pre-marked
        before = acc["points"]
        L._check_achievements(self.state, START, "e_andi")
        self.assertEqual(acc["points"], before)

    def test_tiers_and_multiplier(self):
        self.assertEqual(L.tier_of(0)[0], "bronze")
        self.assertEqual(L.tier_of(500)[0], "silver")
        self.assertEqual(L.tier_of(4000)[0], "platinum")
        acc = L.account(self.state, "e_andi")                 # Silver → 1.1x
        added = L.award(self.state, START, "e_andi", 100, "test")
        self.assertEqual(added, 110)
        acc["lifetime"] = 1495
        L.award(self.state, START, "e_andi", 10, "push to gold")
        self.assertEqual(L.tier_of(acc["lifetime"])[0], "gold")
        self.assertTrue(any(c["emp"] == "e_andi" and c["source"] == "tier" for c in self.state["loyalty"]["coupons"].values()))

    def test_crewcup_coupon_discounts_order_and_tops_up_cafe(self):
        coupon = coupon_of(self.state, "e_andi", "welcome")
        run = E.solo_order(self.state, START, "e_andi", "c_senja", LATTE, coupon=coupon["id"])
        line = run["lines"][0]
        self.assertEqual(line["price"]["coupon"], coupon["amount"])
        self.assertEqual(self.state["loyalty"]["coupons"][coupon["id"]]["status"], "used")
        payout = next(row for row in self.state["payouts"] if row["line"] == line["id"])
        self.assertEqual(payout["subsidy"], coupon["amount"])
        self.assertEqual(payout["gross"], line["price"]["gross"] + coupon["amount"])
        with self.assertRaises(E.DemoError):
            E.solo_order(self.state, START + 60, "e_andi", "c_senja", LATTE, coupon=coupon["id"])  # single use

    def test_cafe_promo_is_cafe_funded_and_cafe_specific(self):
        promo = next(p for p in self.state["loyalty"]["promos"].values() if p["cafe"] == "c_aren")
        coupon = L.promo_claim(self.state, START, "e_sari", promo["id"])
        with self.assertRaises(E.DemoError):
            L.promo_claim(self.state, START, "e_sari", promo["id"])                 # once per person
        with self.assertRaises(E.DemoError) as error:
            E.solo_order(self.state, START, "e_sari", "c_senja", {"item": "americano"}, coupon=coupon["id"])
        self.assertEqual(error.exception.code, "COUPON_CAFE")
        run = E.solo_order(self.state, START, "e_sari", "c_aren", {"item": "americano"}, coupon=coupon["id"])
        payout = next(row for row in self.state["payouts"] if row["line"] == run["lines"][0]["id"])
        self.assertEqual(payout["subsidy"], 0)

    def test_offpeak_coupon_rejected_in_rush_hour(self):
        promo = next(p for p in self.state["loyalty"]["promos"].values() if p["cafe"] == "c_senja")
        coupon = coupon_of(self.state, "e_andi", "cafe_promo")
        self.assertEqual(coupon["promo"], promo["id"])
        rush_slot = E.at_local_hm(START, self.state["cafes"]["c_senja"], "09:00")
        with self.assertRaises(E.DemoError) as error:
            E.solo_order(self.state, START, "e_andi", "c_senja", LATTE, slot_ts=rush_slot, coupon=coupon["id"])
        self.assertEqual(error.exception.code, "COUPON_PEAK")
        self.assertEqual(coupon["status"], "active")                                   # not consumed by the failed order

    def test_coupon_released_when_line_removed_before_cafe_starts(self):
        coupon = coupon_of(self.state, "e_andi", "welcome")
        run = E.run_create(self.state, START, "e_andi", "c_senja", E.at_local_hm(START, self.state["cafes"]["c_senja"], "10:30"))
        line = E.run_join(self.state, START, run["id"], "e_andi", LATTE, coupon=coupon["id"])
        self.assertEqual(coupon["status"], "used")
        E.line_remove(self.state, START + 60, run["id"], line["id"], by="e_andi")
        self.assertEqual(coupon["status"], "active")

    def test_coupon_needs_own_payment(self):
        coupon = coupon_of(self.state, "e_andi", "welcome")
        run = E.run_create(self.state, START, "e_putri", "c_senja", E.at_local_hm(START, self.state["cafes"]["c_senja"], "10:30"),
                           pay_mode="host")
        with self.assertRaises(E.DemoError) as error:
            E.run_join(self.state, START, run["id"], "e_andi", LATTE, coupon=coupon["id"])
        self.assertEqual(error.exception.code, "COUPON_PAYER")

    def test_paid_order_earns_points_and_unlocks_achievement(self):
        acc = L.account(self.state, "e_andi")                 # 9 drinks before
        before = acc["points"]
        E.solo_order(self.state, START, "e_andi", "c_senja", dict(LATTE, reusable=True))
        self.assertIn("regular", acc["achievements"])
        self.assertGreater(acc["points"], before + 100)        # drink + reusable bonus + achievement
        self.assertTrue(any(c["emp"] == "e_andi" and c["source"] == "achievement" for c in self.state["loyalty"]["coupons"].values()))

    def test_store_redemption(self):
        acc = L.account(self.state, "e_budi")
        acc["points"] = 100
        with self.assertRaises(E.DemoError):
            L.redeem(self.state, START, "e_budi", "free_drink")
        acc["points"] = 600
        result = L.redeem(self.state, START, "e_budi", "free_drink")
        self.assertEqual(acc["points"], 100)
        coupon = self.state["loyalty"]["coupons"][result["coupon"]]
        self.assertEqual(coupon["funder"], "crewcup")
        L.account(self.state, "e_budi")["points"] = 300
        L.redeem(self.state, START, "e_budi", "donate_meal")
        self.assertEqual(self.state["loyalty"]["donations"]["meals"], 1)

    def test_referral_pipeline_pays_once(self):
        with self.assertRaises(E.DemoError):
            L.refer(self.state, START, "e_sari", "company", "Bank Mandala", "hr@bankmandala.co.id")  # already on CrewCup
        with self.assertRaises(E.DemoError):
            L.refer(self.state, START, "e_sari", "cafe", "Kopi Lantai 3", "not-an-email")
        item = L.refer(self.state, START, "e_sari", "cafe", "Kopi Lantai 3", "owner@kopilantai3.id")
        acc = L.account(self.state, "e_sari")
        before = acc["points"]
        L.tick(self.state, START + L.REFERRAL_CONTACT_MIN * 60)
        self.assertEqual(item["status"], "contacted")
        L.tick(self.state, START + L.REFERRAL_SIGNUP_MIN * 60)
        L.tick(self.state, START + L.REFERRAL_SIGNUP_MIN * 60 + 60)
        self.assertEqual(item["status"], "joined")
        self.assertIn("ambassador", acc["achievements"])
        self.assertEqual(acc["points"] - before, L.EARN["referral_cafe"] + 200)

    def test_views_are_scoped(self):
        andi = L.employee_view(self.state, "e_andi", START)
        self.assertTrue(all(coupon["emp"] == "e_andi" for coupon in andi["coupons"]))
        self.assertTrue(all(promo["country"] == "ID" for promo in andi["promos"]))
        self.assertNotIn("claims", andi["promos"][0])
        weiling = L.employee_view(self.state, "e_weiling", START)
        self.assertTrue(all(promo["country"] == "SG" for promo in weiling["promos"]))
        cafe = L.cafe_view(self.state, "c_senja", START)
        self.assertTrue(all(promo["cafe"] == "c_senja" for promo in cafe["promos"]))


if __name__ == "__main__":
    unittest.main()
