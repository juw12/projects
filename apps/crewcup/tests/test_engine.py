"""Unit tests for the CrewCup engine. Run: python -m unittest discover -s tests -v"""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from crewcup import engine as E  # noqa: E402
from crewcup import seed  # noqa: E402

START = seed.DEMO_START


def minutes(value):
    return START + value * 60


def jkt(state, hm_text):
    return E.at_local_hm(START, state["offices"]["o_jkt"], hm_text)


class EngineTestCase(unittest.TestCase):
    def setUp(self):
        self.state = seed.build_state()

    def emp(self, emp_id):
        return self.state["employees"][emp_id]

    def new_run(self, host="e_andi", cafe="c_senja", slot="09:50", cutoff="09:30", **kwargs):
        return E.run_create(self.state, START, host, cafe, jkt(self.state, slot), cutoff_ts=jkt(self.state, cutoff), **kwargs)


class PricingAndTax(EngineTestCase):
    def test_indonesia_pb1_added_on_top_with_offpeak_and_perk(self):
        cafe = self.state["cafes"]["c_senja"]
        spec = E.normalize_spec(cafe, {"item": "latte"})
        offpeak_slot = jkt(self.state, "10:00")
        price = E.price_line(cafe, spec, "co_nusantara", offpeak_slot)
        # 32,000 list; 10% off-peak = 3,200; 5% company perk on 28,800 = 1,440 -> rounded to 1,400
        self.assertEqual(price["list"], 32000)
        self.assertEqual(price["offpeak"], 3200)
        self.assertEqual(price["perk"], 1400)
        self.assertEqual(price["net"], 27400)
        self.assertEqual(price["tax"], 2740)
        self.assertEqual(price["gross"], 30140)
        self.assertFalse(price["tax_inclusive"])
        self.assertEqual(price["in_store_price"], 32000)
        self.assertEqual(price["markup"], 0)

    def test_peak_slot_gets_no_offpeak_discount(self):
        cafe = self.state["cafes"]["c_senja"]
        spec = E.normalize_spec(cafe, {"item": "latte"})
        price = E.price_line(cafe, spec, "co_nusantara", jkt(self.state, "09:00"))
        self.assertEqual(price["offpeak"], 0)

    def test_singapore_gst_inclusive(self):
        cafe = self.state["cafes"]["c_sg"]
        spec = E.normalize_spec(cafe, {"item": "latte"})
        slot = E.at_local_hm(START, cafe, "09:00")
        price = E.price_line(cafe, spec, "co_nusantara", slot)
        self.assertTrue(price["tax_inclusive"])
        self.assertEqual(price["net"] + price["tax"], price["gross"])
        self.assertAlmostEqual(price["tax"] / price["net"], 0.09, places=2)

    def test_money_format(self):
        self.assertEqual(E.fmt_money("ID", 28000), "Rp28.000")
        self.assertEqual(E.fmt_money("SG", 650), "S$6.50")
        self.assertEqual(E.fmt_money("VN", 29000), "29.000 ₫")


class CapacitySlots(EngineTestCase):
    def test_back_to_back_orders_cannot_bypass_capacity(self):
        cafe = self.state["cafes"]["c_senja"]
        slot = jkt(self.state, "09:10")  # 7 of 8 already booked by other companies
        self.assertEqual(E.slot_load(self.state, "c_senja", slot), 7)
        E.solo_order(self.state, START, "e_andi", "c_senja", {"item": "americano"}, slot_ts=slot)
        with self.assertRaises(E.DemoError) as caught:
            E.solo_order(self.state, START, "e_andi", "c_senja", {"item": "americano"}, slot_ts=slot)
        self.assertEqual(caught.exception.code, "SLOT_FULL")
        suggestions = caught.exception.data["suggestions"]
        self.assertTrue(suggestions)
        self.assertGreater(suggestions[0]["slot"], slot)
        self.assertEqual(E.slot_load(self.state, "c_senja", slot), cafe["capacity_per_slot"])


class PreAuthorisedPayments(EngineTestCase):
    def test_hold_on_join_capture_at_cutoff_allowance_first(self):
        run = self.new_run()
        andi = self.emp("e_andi")
        balance_before = andi["wallet"]["balance"]
        line = E.run_join(self.state, START, run["id"], "e_andi", {"item": "latte"})
        sources = [part["src"] for part in line["pay"]]
        self.assertEqual(sources[0], "allowance")
        self.assertEqual(andi["wallet"]["balance"], balance_before)
        self.assertLess(E.wallet_available(andi), balance_before)
        E.tick(self.state, jkt(self.state, "09:30"))
        self.assertEqual(run["status"], "queued")
        self.assertEqual(andi["allowance"]["used"], 25000)
        self.assertEqual(andi["wallet"]["balance"], balance_before - (line["price"]["gross"] - 25000))
        self.assertFalse(andi["wallet"]["holds"])

    def test_insufficient_wallet_is_rejected_and_rolled_back(self):
        run = self.new_run()
        fajar = self.emp("e_fajar")
        fajar["wallet"]["balance"] = 0
        E.run_join(self.state, START, run["id"], "e_fajar", {"item": "americano"})
        with self.assertRaises(E.DemoError) as caught:
            E.run_join(self.state, START, run["id"], "e_fajar", {"item": "pandan_latte", "milk": "oat"})
        self.assertEqual(caught.exception.code, "INSUFFICIENT")
        self.assertEqual(len(fajar["allowance"]["held"]), 1)

    def test_drop_out_before_cutoff_releases_hold(self):
        run = self.new_run()
        dewi = self.emp("e_dewi")
        available_before = E.wallet_available(dewi)
        line = E.run_join(self.state, START, run["id"], "e_dewi", {"item": "pandan_latte"})
        self.assertTrue(dewi["allowance"]["held"])
        self.assertLess(E.wallet_available(dewi), available_before)
        E.line_remove(self.state, START, run["id"], line["id"], by="e_dewi")
        self.assertFalse(dewi["wallet"]["holds"])
        self.assertFalse(dewi["allowance"]["held"])
        self.assertEqual(E.wallet_available(dewi), available_before)

    def test_host_pays_and_treat_ledger(self):
        run = self.new_run(pay_mode="host")
        E.run_join(self.state, START, run["id"], "e_andi", {"item": "americano"})
        line = E.run_join(self.state, START, run["id"], "e_maya", {"item": "americano"})
        self.assertTrue(all(part.get("emp") == "e_andi" for part in line["pay"]))
        self.assertEqual(line["pay"][0]["src"], "wallet")
        E.tick(self.state, jkt(self.state, "09:30"))
        self.assertEqual(self.emp("e_andi")["treat_balance"], line["price"]["gross"])
        self.assertEqual(self.emp("e_maya")["treat_balance"], -line["price"]["gross"])

    def test_guest_pays_with_qris_immediately(self):
        run = self.new_run()
        line = E.run_join(self.state, START, run["id"], None, {"item": "teh_manis"}, guest_name="Pak Joko", guest_method="QRIS")
        self.assertEqual(line["pay"][0]["src"], "guest")
        self.assertTrue(line["pay"][0]["captured"])
        self.assertTrue(line["code"].startswith("PJ-"))


class FireOnApproach(EngineTestCase):
    def test_fire_waits_for_runner_and_ready_matches_arrival(self):
        run = self.new_run(slot="10:30", cutoff="09:30")
        for emp_id in ("e_andi", "e_maya", "e_putri"):
            E.run_join(self.state, START, run["id"], emp_id, {"item": "americano"})
        E.tick(self.state, jkt(self.state, "09:30"))
        self.assertEqual(run["status"], "queued")
        prep = run["prep_min"]
        E.runner_depart(self.state, jkt(self.state, "09:40"), run["id"], "e_andi", eta_min=12)
        due, arrival = E.fire_plan(self.state, run)
        self.assertEqual(arrival, jkt(self.state, "09:52"))
        self.assertEqual(due, arrival - prep * 60)
        E.tick(self.state, due - 60)
        self.assertEqual(run["status"], "queued")
        E.tick(self.state, arrival)
        self.assertEqual(run["status"], "ready")
        self.assertEqual(run["ready_at"], arrival)

    def test_traffic_delay_pushes_fire_time(self):
        run = self.new_run(slot="10:30", cutoff="09:30")
        E.run_join(self.state, START, run["id"], "e_andi", {"item": "americano"})
        E.tick(self.state, jkt(self.state, "09:30"))
        E.runner_depart(self.state, jkt(self.state, "09:40"), run["id"], "e_andi", eta_min=5)
        first_due, _ = E.fire_plan(self.state, run)
        E.runner_depart(self.state, jkt(self.state, "09:41"), run["id"], "e_andi", eta_min=15)
        second_due, _ = E.fire_plan(self.state, run)
        self.assertGreater(second_due, first_due)

    def test_allergy_ticket_needs_cafe_ack_before_firing(self):
        run = self.new_run(slot="10:00", cutoff="09:30")
        E.run_join(self.state, START, run["id"], "e_sari", {"item": "latte", "milk": "oat"})
        E.tick(self.state, jkt(self.state, "09:59"))
        self.assertEqual(run["status"], "needs_ack")
        with self.assertRaises(E.DemoError):
            E.cafe_fire(self.state, jkt(self.state, "09:59"), run["id"])
        E.cafe_ack(self.state, jkt(self.state, "09:59"), run["id"])
        E.tick(self.state, jkt(self.state, "10:30"))
        self.assertEqual(run["status"], "ready")


class ScanToVerify(EngineTestCase):
    def ready_run(self):
        run = self.new_run(slot="10:00", cutoff="09:30")
        lines = [E.run_join(self.state, START, run["id"], emp_id, {"item": "americano"}) for emp_id in ("e_andi", "e_maya")]
        E.tick(self.state, jkt(self.state, "10:00"))
        self.assertEqual(run["status"], "ready")
        return run, lines

    def test_missing_cup_blocks_leaving(self):
        run, lines = self.ready_run()
        result = E.pickup_scan(self.state, jkt(self.state, "10:01"), run["id"], lines[0]["code"].lower())
        self.assertTrue(result["ok"])
        with self.assertRaises(E.DemoError) as caught:
            E.pickup_complete(self.state, jkt(self.state, "10:01"), run["id"], "e_andi")
        self.assertEqual(caught.exception.data["missing"], [lines[1]["code"]])

    def test_wrong_cup_from_other_order_is_flagged(self):
        run, lines = self.ready_run()
        other = E.solo_order(self.state, START, "e_putri", "c_senja", {"item": "americano"}, slot_ts=jkt(self.state, "10:00"))
        result = E.pickup_scan(self.state, jkt(self.state, "10:01"), run["id"], other["lines"][0]["code"])
        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "WRONG_RUN")

    def test_report_missing_creates_priority_remake_and_karma(self):
        run, lines = self.ready_run()
        E.pickup_scan(self.state, jkt(self.state, "10:01"), run["id"], lines[0]["code"])
        E.pickup_complete(self.state, jkt(self.state, "10:02"), run["id"], "e_andi", report_missing=True)
        remakes = [item for item in self.state["runs"].values() if item["kind"] == "remake"]
        self.assertEqual(len(remakes), 1)
        self.assertTrue(remakes[0]["priority"])
        self.assertEqual(self.emp("e_andi")["runs_done"], 4)
        self.assertEqual(run["freshness_min"], 2.0)


class CarryPlanAndFairness(EngineTestCase):
    def test_eleven_cups_need_two_carriers_and_fair_co_runner(self):
        self.assertEqual(E.carry_plan(8)["carriers"], 1)
        self.assertEqual(E.carry_plan(9)["carriers"], 2)
        run = self.new_run(cafe="c_aren", slot="10:10", cutoff="09:40")
        people = ["e_andi", "e_maya", "e_putri", "e_fajar", "e_budi", "e_dewi"]
        for emp_id in people:
            self.emp(emp_id)["wallet"]["balance"] = 500000
            E.run_join(self.state, START, run["id"], emp_id, {"item": "americano"})
        for emp_id in people[:3]:
            E.run_join(self.state, START, run["id"], emp_id, {"item": "teh_manis"})
        with self.assertRaises(E.DemoError):
            # Slot capacity (10) still applies to big groups.
            for emp_id in people:
                E.run_join(self.state, START, run["id"], emp_id, {"item": "teh_manis"})
        E.tick(self.state, jkt(self.state, "09:40"))
        self.assertEqual(len(E.active_lines(run)), 10)
        self.assertEqual(run["carriers"], 2)
        self.assertEqual(run["co_runners"], ["e_fajar"])  # zero runs done so far

    def test_suggest_runner_picks_least_runs(self):
        run = self.new_run(host="e_putri")
        for emp_id in ("e_putri", "e_maya", "e_sari"):
            E.run_join(self.state, START, run["id"], emp_id, {"item": "americano"} if emp_id != "e_sari" else {"item": "americano", "temp": "hot"})
        self.assertEqual(E.suggest_runner(self.state, run["id"]), "e_sari")

    def test_fairness_index(self):
        stats = E.fairness_stats(self.state, "o_jkt")
        self.assertLess(stats["jain"], 0.7)
        self.assertEqual(stats["distribution"][0], 9)


class HybridAndRemote(EngineTestCase):
    def test_remote_worker_allowance_at_home_cafe(self):
        rizky = self.emp("e_rizky")
        status = E.allowance_status(self.state, rizky, START, self.state["cafes"]["c_bsd"])
        self.assertFalse(status["in_office"])
        self.assertTrue(status["eligible"])
        run = E.solo_order(self.state, START, "e_rizky", "c_bsd", {"item": "kopi_aren"})
        self.assertEqual(run["lines"][0]["pay"][0]["src"], "allowance")

    def test_office_days_only_policy(self):
        self.state["company"]["policy"]["allowance_office_days_only"] = True
        status = E.allowance_status(self.state, self.emp("e_rizky"), START)
        self.assertFalse(status["eligible"])

    def test_recurring_skips_wfh(self):
        E.tick(self.state, jkt(self.state, "08:35"))
        notes = [note["en"] for note in self.state["notifications"] if note["to"] == "e_rizky"]
        self.assertTrue(any("WFH" in note for note in notes))
        self.assertFalse(any(run["host"] == "e_rizky" for run in self.state["runs"].values()))

    def test_send_coffee_to_remote_teammate(self):
        E.gift_send(self.state, START, "e_andi", "e_rizky", 30000, source="kudos", message="Thanks for the fix!")
        self.assertEqual(self.emp("e_rizky")["wallet"]["gift"], 30000)
        categories = [entry["category"] for entry in self.state["spend"] if entry["amount"] == 30000]
        self.assertIn("gift_individual", categories)


class MeetingsAndRamadan(EngineTestCase):
    def test_meeting_order_follows_rsvps(self):
        run = E.meeting_order_create(self.state, START, "ev_sprint", "c_senja", "e_dewi")
        people = set(E.people_in(run))
        self.assertEqual(people, {"e_dewi", "e_andi", "e_budi", "e_sari"})
        E.event_rsvp(self.state, START, "ev_sprint", "e_budi", "no")
        E.event_rsvp(self.state, START, "ev_sprint", "e_fajar", "yes")
        self.assertEqual(set(E.people_in(run)), {"e_dewi", "e_andi", "e_sari", "e_fajar"})
        self.assertEqual(run["lines"][0]["pay"][0]["src"], "budget")

    def test_ramadan_excludes_fasting_attendees(self):
        self.state["company"]["policy"]["ramadan_mode"] = True
        run = E.meeting_order_create(self.state, START, "ev_sprint", "c_senja", "e_dewi")
        self.assertNotIn("e_budi", E.people_in(run))

    def test_delivery_to_jakarta_lobby_then_handoff(self):
        run = E.meeting_order_create(self.state, START, "ev_sprint", "c_senja", "e_dewi")
        for _ in range(3):
            E.tick(self.state, jkt(self.state, "10:00"))
        if run["status"] == "needs_ack":
            E.cafe_ack(self.state, jkt(self.state, "10:00"), run["id"])
        E.tick(self.state, jkt(self.state, "10:30"))
        self.assertEqual(run["status"], "at_lobby")
        E.lobby_handoff(self.state, jkt(self.state, "10:31"), run["id"], "e_andi")
        self.assertEqual(run["status"], "done")


class SafetyAndSubstitution(EngineTestCase):
    def test_allergy_and_halal_blocks(self):
        run = self.new_run()
        with self.assertRaises(E.DemoError) as caught:
            E.run_join(self.state, START, run["id"], "e_sari", {"item": "latte", "milk": "fresh"})
        self.assertEqual(caught.exception.code, "ALLERGEN")
        self.assertIn("oat", caught.exception.data["safe_milks"])
        with self.assertRaises(E.DemoError) as caught:
            E.run_join(self.state, START, run["id"], "e_budi", {"item": "rum_latte"})
        self.assertEqual(caught.exception.code, "NOT_HALAL")

    def test_oat_out_of_stock_substitutes_safely(self):
        run = self.new_run()
        sari_line = E.run_join(self.state, START, run["id"], "e_sari", {"item": "latte", "milk": "oat"})
        fajar_line = E.run_join(self.state, START, run["id"], "e_fajar", {"item": "latte", "milk": "oat"})
        old_gross = sari_line["price"]["gross"]
        E.cafe_stock_set(self.state, START, "c_senja", "milk:oat", False)
        self.assertEqual(sari_line["spec"]["milk"], "soy")
        self.assertLess(sari_line["price"]["gross"], old_gross)
        self.assertEqual(fajar_line["spec"]["milk"], "soy")
        E.cafe_stock_set(self.state, START, "c_senja", "milk:soy", False)
        # Sari: almond is next in her list (no nut allergy) -> almond, never charged more
        self.assertEqual(sari_line["spec"]["milk"], "almond")
        self.assertEqual(sari_line["price"]["absorbed"] > 0, True)
        # Fajar: nut allergy so almond is skipped; next rule is fresh milk
        self.assertEqual(fajar_line["spec"]["milk"], "fresh")

    def test_no_safe_substitute_refunds(self):
        run = self.new_run()
        line = E.run_join(self.state, START, run["id"], "e_dewi", {"item": "pandan_latte"})
        E.cafe_stock_set(self.state, START, "c_senja", "item:pandan_latte", False)
        self.assertEqual(line["status"], "removed")
        self.assertFalse(self.emp("e_dewi")["wallet"]["holds"])
        self.assertFalse(self.emp("e_dewi")["allowance"]["held"])


class UnclaimedAndQuality(EngineTestCase):
    def test_release_only_after_30_minutes(self):
        run = E.solo_order(self.state, START, "e_maya", "c_senja", {"item": "americano"}, slot_ts=jkt(self.state, "08:40"))
        E.tick(self.state, jkt(self.state, "08:40"))
        self.assertEqual(run["status"], "ready")
        with self.assertRaises(E.DemoError):
            E.cafe_release(self.state, jkt(self.state, "09:00"), run["id"])
        E.tick(self.state, jkt(self.state, "08:56"))
        self.assertTrue(run["reminded"])
        E.cafe_release(self.state, jkt(self.state, "09:10"), run["id"])
        self.assertEqual(run["status"], "released")

    def test_instant_credit_for_bad_drink(self):
        run = E.solo_order(self.state, START, "e_dewi", "c_senja", {"item": "latte"}, slot_ts=jkt(self.state, "08:40"))
        E.tick(self.state, jkt(self.state, "08:40"))
        line = run["lines"][0]
        gross = line["price"]["gross"]
        E.pickup_scan(self.state, jkt(self.state, "08:41"), run["id"], line["code"])
        E.pickup_complete(self.state, jkt(self.state, "08:41"), run["id"], "e_dewi")
        dewi = self.emp("e_dewi")
        self.assertEqual(dewi["allowance"]["used"], 25000)
        before = dewi["wallet"]["balance"]
        result = E.flag_line(self.state, jkt(self.state, "08:45"), run["id"], line["id"], "e_dewi", "credit", "too sweet")
        self.assertEqual(result["refunded"], gross)
        self.assertEqual(dewi["wallet"]["balance"], before + gross - 25000)
        self.assertEqual(dewi["allowance"]["used"], 0)
        self.assertEqual(self.state["cafes"]["c_senja"]["quality"]["flagged"], 1)

    def test_cafe_gets_instant_payout_minus_commission(self):
        run = E.solo_order(self.state, START, "e_maya", "c_senja", {"item": "latte"})
        payout = [entry for entry in self.state["payouts"] if entry["run"] == run["id"]][0]
        self.assertEqual(payout["status"], "paid_instant")
        self.assertEqual(payout["net"] + payout["commission"], payout["gross"])

    def test_at_cafe_duplicate_warning(self):
        E.set_at_cafe(self.state, START, "e_maya", "c_senja")
        with self.assertRaises(E.DemoError) as caught:
            E.solo_order(self.state, START, "e_maya", "c_senja", {"item": "americano"})
        self.assertEqual(caught.exception.code, "AT_CAFE")
        E.solo_order(self.state, START, "e_maya", "c_senja", {"item": "americano"}, confirm_duplicate=True)


class NaturalLanguage(EngineTestCase):
    def test_same_as_yesterday_but_oat_large(self):
        result = E.nl_parse(self.state, START, "e_andi", "c_senja", "same as yesterday but oat milk, large")
        spec = result["spec"]
        self.assertEqual(spec["item"], "kopi_aren")
        self.assertEqual(spec["milk"], "oat")
        self.assertEqual(spec["size"], "L")
        self.assertEqual(spec["sugar"], 50)

    def test_bahasa_indonesia(self):
        result = E.nl_parse(self.state, START, "e_maya", "c_senja", "es kopi susu aren besar, kurang manis, sedikit es, bawa tumbler")
        spec = result["spec"]
        self.assertEqual(spec["item"], "kopi_aren")
        self.assertEqual(spec["size"], "L")
        self.assertEqual(spec["sugar"], 50)
        self.assertEqual(spec["ice"], "less")
        self.assertTrue(spec["reusable"])

    def test_unknown(self):
        with self.assertRaises(E.DemoError):
            E.nl_parse(self.state, START, "e_maya", "c_senja", "something nice please")


class CateringAndAdmin(EngineTestCase):
    def test_catering_over_threshold_needs_approval(self):
        request = E.catering_request(self.state, START, "e_putri", "c_aren", "Kopi literan 1L x 10 + snack box", 40, jkt(self.state, "15:00"))
        E.cafe_quote(self.state, START, request["id"], 2_000_000)
        self.assertEqual(request["status"], "pending_approval")
        E.catering_approve(self.state, START, request["id"], True)
        self.assertEqual(request["status"], "approved")
        self.assertEqual(self.state["offices"]["o_jkt"]["budgets"]["meeting"]["spent"], 2_000_000)

    def test_roulette_and_scim(self):
        entry = E.roulette_run(self.state, START, "o_jkt")
        paired = sorted(emp_id for group in entry["groups"] for emp_id in group)
        self.assertEqual(len(paired), 8)
        new = E.scim_add(self.state, START, "o_jkt", "Nadia Putri", "People", "nadia@nusantara.co.id")
        self.assertTrue(new["active"])
        E.scim_deactivate(self.state, START, new["id"])
        self.assertFalse(new["active"])

    def test_state_is_json_serialisable_after_full_day(self):
        for minute in range(0, 600, 5):
            E.tick(self.state, minutes(minute))
        json.dumps(self.state)
        json.dumps(E.derived(self.state, minutes(600)))


if __name__ == "__main__":
    unittest.main()
