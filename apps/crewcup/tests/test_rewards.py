"""Company coffee rewards: manual rewards, budgets, rules, nominations and partner vouchers."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from crewcup import engine as E  # noqa: E402
from crewcup import rewards as R  # noqa: E402
from crewcup import seed  # noqa: E402
from crewcup import social as SOC  # noqa: E402

START = seed.DEMO_START


class RewardTests(unittest.TestCase):
    def setUp(self):
        self.state = seed.build_state(real_now=0.0)
        self.office = self.state["offices"]["o_jkt"]
        self.value = R.coffee_value(self.office)

    def budget(self):
        return self.office["budgets"]["rewards"]

    def test_person_reward_credits_gift_and_budget(self):
        andi = self.state["employees"]["e_andi"]
        gift_before = andi["wallet"]["gift"]
        spent_before = self.budget()["spent"]
        result = R.reward_give(self.state, START, "o_jkt", "person", "e_andi", 2, "great_work", "Shipped QRIS refunds")
        self.assertEqual(result["recipients"], 1)
        self.assertEqual(andi["wallet"]["gift"] - gift_before, 2 * self.value)
        self.assertEqual(self.budget()["spent"] - spent_before, 2 * self.value)
        spend = [row for row in self.state["spend"] if row["ref"] == result["batch"]]
        self.assertEqual(spend[0]["category"], "gift_individual")
        self.assertTrue(any(note["to"] == "e_andi" and note["ref"] == result["batch"] for note in self.state["notifications"]))

    def test_team_and_office_rewards_only_reach_that_office(self):
        result = R.reward_give(self.state, START, "o_jkt", "team", "Engineering", 1)
        engineers = [emp for emp in self.state["employees"].values() if emp["office"] == "o_jkt" and emp["team"] == "Engineering"]
        self.assertEqual(result["recipients"], len(engineers))
        result = R.reward_give(self.state, START, "o_jkt", "office", None, 1)
        self.assertEqual(result["recipients"], sum(1 for emp in self.state["employees"].values() if emp["office"] == "o_jkt"))
        self.assertNotIn("e_weiling", [row["emp"] for row in self.state["rewards"] if row["batch"] == result["batch"]])

    def test_budget_and_limits_are_enforced(self):
        self.budget()["limit"] = self.budget()["spent"] + self.value
        with self.assertRaises(E.DemoError) as error:
            R.reward_give(self.state, START, "o_jkt", "person", "e_andi", 2)
        self.assertEqual(error.exception.code, "BUDGET")
        with self.assertRaises(E.DemoError):
            R.reward_give(self.state, START, "o_jkt", "person", "e_andi", R.MAX_COFFEES_PER_PERSON + 1)
        with self.assertRaises(E.DemoError):
            R.reward_give(self.state, START, "o_jkt", "person", "e_weiling", 1)  # Singapore staff, Jakarta budget

    def test_announced_reward_appears_on_company_feed_only(self):
        R.reward_give(self.state, START, "o_jkt", "person", "e_sari", 1, "great_work", "New order screen", announce=True)
        andi_feed = [post for post in SOC.view_for(self.state, "emp:e_andi", START)["feed"] if post["kind"] == "recognition"]
        self.assertTrue(any("Sari Wulandari" in post["text"] for post in andi_feed))
        cafe_feed = SOC.view_for(self.state, "cafe:c_senja", START)["feed"]
        self.assertFalse(any(post["kind"] == "recognition" for post in cafe_feed))

    def test_anniversary_and_birthday_rules_fire_once(self):
        budi = self.state["employees"]["e_budi"]
        before = budi["wallet"]["gift"]
        E.tick(self.state, START)
        E.tick(self.state, START + 60)
        rule = self.state["reward_rules"]["anniversary"]["coffees"]
        self.assertEqual(budi["wallet"]["gift"] - before, rule * self.value)
        sari = self.state["employees"]["e_sari"]
        E.tick(self.state, START + 86400)
        self.assertIn("birthday:2026", sari["reward_log"])
        andi = self.state["employees"]["e_andi"]
        andi["birthday"] = "11-03"  # birthday known but not opted in → no reward
        self.assertNotIn("birthday:2026", andi["reward_log"])

    def test_rules_can_be_switched_off(self):
        R.rules_update(self.state, START, {"anniversary": {"on": False}})
        before = self.state["employees"]["e_budi"]["wallet"]["gift"]
        E.tick(self.state, START)
        self.assertEqual(self.state["employees"]["e_budi"]["wallet"]["gift"], before)

    def test_welcome_coffee_for_scim_joiner(self):
        emp = E.scim_add(self.state, START, "o_jkt", "Nadia Kusuma", "Product", "nadia@nusantara.co.id")
        R.on_join(self.state, START, emp["id"])
        self.assertEqual(emp["wallet"]["gift"], self.state["reward_rules"]["welcome"]["coffees"] * self.value)

    def test_birthday_optin_validates_date(self):
        with self.assertRaises(E.DemoError):
            R.birthday_optin(self.state, START, "e_andi", True, "1990-03-21")
        result = R.birthday_optin(self.state, START, "e_andi", True, "3-21")
        self.assertEqual(result["birthday"], "03-21")

    def test_nomination_flow(self):
        with self.assertRaises(E.DemoError):
            R.nominate(self.state, START, "e_andi", "e_andi", "great_work", "I did a great job today")
        with self.assertRaises(E.DemoError):
            R.nominate(self.state, START, "e_andi", "e_sari", "great_work", "nice")
        item = R.nominate(self.state, START, "e_andi", "e_sari", "great_work", "Redesigned the order screen in a week")
        before = self.state["employees"]["e_sari"]["wallet"]["gift"]
        R.nomination_decide(self.state, START + 60, item["id"], True, coffees=2)
        self.assertEqual(self.state["employees"]["e_sari"]["wallet"]["gift"] - before, 2 * self.value)
        self.assertEqual(item["status"], "approved")
        with self.assertRaises(E.DemoError):
            R.nomination_decide(self.state, START + 60, item["id"], True)

    def test_partner_voucher_lifecycle(self):
        voucher = R.partner_send(self.state, START, "o_jkt", "member:m_rina", 2, "Thanks for the workshop")
        self.assertTrue(voucher["code"].startswith("CC-"))
        with self.assertRaises(E.DemoError):
            R.voucher_redeem(self.state, START, "c_sg", voucher["code"])          # wrong city
        R.voucher_redeem(self.state, START + 60, "c_senja", voucher["code"])
        with self.assertRaises(E.DemoError) as error:
            R.voucher_redeem(self.state, START + 120, "c_senja", voucher["code"])
        self.assertEqual(error.exception.code, "USED")
        with self.assertRaises(E.DemoError):
            R.partner_send(self.state, START, "o_sg", "member:m_rina", 1)           # currency/city mismatch
        with self.assertRaises(E.DemoError):
            R.partner_send(self.state, START, "o_jkt", "member:m_kevin", 1)         # Singapore member
        SOC.company_block(self.state, START, "co_mandala", True)
        with self.assertRaises(E.DemoError):
            R.partner_send(self.state, START, "o_jkt", "member:m_hendra", 1)        # blocked company

    def test_partner_thanks_and_expiry(self):
        voucher = R.partner_send(self.state, START, "o_jkt", "member:m_laras", 1)
        R.tick(self.state, START + R.PARTNER_REPLY_MIN * 60)
        self.assertTrue(voucher["thanks"])
        R.tick(self.state, START + (R.VOUCHER_DAYS + 1) * 86400)
        self.assertEqual(voucher["status"], "expired")

    def test_employee_view_is_private(self):
        R.reward_give(self.state, START, "o_jkt", "person", "e_sari", 1, "great_work", "Private thanks", announce=False)
        andi = R.employee_view(self.state, "e_andi")
        self.assertFalse(any(row["emp"] == "e_sari" and row["message"] == "Private thanks" for row in andi["mine"] + andi["wall"]))
        sari = R.employee_view(self.state, "e_sari")
        self.assertTrue(any(row["message"] == "Private thanks" for row in sari["mine"]))


if __name__ == "__main__":
    unittest.main()
