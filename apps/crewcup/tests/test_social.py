"""CrewCup Network: visibility rules, posting limits, moderation, coffee chats and meetups."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from crewcup import engine as E  # noqa: E402
from crewcup import seed  # noqa: E402
from crewcup import social as SOC  # noqa: E402

START = seed.DEMO_START


def fresh():
    return seed.build_state(real_now=0.0)


def ids(rows, key="id"):
    return {row[key] for row in rows}


class VisibilityTests(unittest.TestCase):
    def setUp(self):
        self.state = fresh()

    def view(self, persona, now=START):
        return SOC.view_for(self.state, persona, now)

    def test_directory_is_scoped_to_building_and_city(self):
        andi = self.view("emp:e_andi")
        companies = ids(andi["companies"])
        self.assertIn("co_mandala", companies)          # same building, network visibility
        self.assertIn("co_arunika", companies)          # building-only visibility, same building
        self.assertIn("co_lumbung", companies)          # same city
        self.assertNotIn("co_samudra", companies)       # private company is never listed
        self.assertNotIn("co_straits", companies)       # Singapore
        self.assertEqual(andi["private_in_building"], 1)
        weiling = self.view("emp:e_weiling")
        self.assertEqual(ids(weiling["companies"]) - {"co_nusantara"}, {"co_straits"})

    def test_post_audiences(self):
        cafe_feed = ids(self.view("cafe:c_senja")["feed"])
        self.assertNotIn("p_mandala_api", cafe_feed)    # building-only post, café is not a tenant
        self.assertNotIn("p_dewi_townhall", cafe_feed)  # company-only post
        self.assertIn("p_hendra_hiring", cafe_feed)     # network post in Jakarta
        andi_feed = ids(self.view("emp:e_andi")["feed"])
        self.assertTrue({"p_mandala_api", "p_dewi_townhall", "p_hendra_hiring"} <= andi_feed)
        self.assertNotIn("p_kevin_sg", andi_feed)
        self.assertEqual(self.view(None)["feed"], [])

    def test_scheduled_posts_appear_when_time_passes(self):
        self.assertNotIn("p_aren_rain", ids(self.view("emp:e_andi")["feed"]))
        self.assertIn("p_aren_rain", ids(self.view("emp:e_andi", START + 30 * 60)["feed"]))

    def test_building_only_profiles_stay_in_the_building(self):
        andi_people = ids(self.view("emp:e_andi")["people"], "key")
        self.assertIn("member:m_laras", andi_people)
        cafe_people = ids(self.view("cafe:c_senja")["people"], "key")
        self.assertNotIn("member:m_laras", cafe_people)

    def test_company_can_switch_network_off(self):
        SOC.company_settings(self.state, START, {"participation": False})
        andi = self.view("emp:e_andi")
        self.assertFalse(andi["enabled"])
        self.assertEqual(ids(andi["companies"]), {"co_nusantara"})
        self.assertTrue(all(post["same_company"] for post in andi["feed"]))
        with self.assertRaises(E.DemoError) as error:
            SOC.post_create(self.state, START, "e_andi", "Hello building", "building")
        self.assertEqual(error.exception.code, "NETWORK_OFF")
        SOC.post_create(self.state, START, "e_andi", "Internal note", "company")

    def test_block_hides_company_everywhere(self):
        SOC.company_block(self.state, START, "co_mandala", True)
        andi = self.view("emp:e_andi")
        self.assertNotIn("co_mandala", ids(andi["companies"]))
        self.assertFalse(any(post["author"]["company"] == "co_mandala" for post in andi["feed"]))
        self.assertFalse(any(person["company"] == "co_mandala" for person in andi["people"]))
        self.assertNotIn("mu_fintech", ids(andi["meetups"]))

    def test_challenge_only_ranks_companies_that_share_stats(self):
        board = self.view("emp:e_andi")["challenge"]
        names = [row["company"] for row in board["rows"]]
        self.assertNotIn("co_kawan", names)             # share_stats False
        self.assertNotIn("co_samudra", names)           # private
        self.assertEqual(board["not_shown"], 2)
        before = next(row for row in board["rows"] if row["mine"])
        self.state["esg"]["cups"] += 10
        self.state["esg"]["reusable_cups"] += 10
        after = next(row for row in self.view("emp:e_andi")["challenge"]["rows"] if row["mine"])
        self.assertGreater(after["reusable_pct"], before["reusable_pct"])


class PostingTests(unittest.TestCase):
    def setUp(self):
        self.state = fresh()

    def test_rate_limit_and_length(self):
        for index in range(SOC.POSTS_PER_HOUR):
            SOC.post_create(self.state, START + index, "e_andi", f"Update {index}", "building")
        with self.assertRaises(E.DemoError) as error:
            SOC.post_create(self.state, START + 10, "e_andi", "One too many", "building")
        self.assertEqual(error.exception.code, "RATE_LIMIT")
        with self.assertRaises(E.DemoError):
            SOC.post_create(self.state, START + 4000, "e_sari", "x" * (SOC.MAX_POST_LEN + 1), "building")
        with self.assertRaises(E.DemoError):
            SOC.post_create(self.state, START + 4000, "e_sari", "   ", "building")

    def test_hidden_profile_can_only_post_internally(self):
        with self.assertRaises(E.DemoError) as error:
            SOC.post_create(self.state, START, "e_rizky", "Hello network", "network")
        self.assertEqual(error.exception.code, "PROFILE_PRIVATE")
        post = SOC.post_create(self.state, START, "e_rizky", "Hello team", "company")
        self.assertEqual(post["audience"], "company")

    def test_comments_and_likes_need_visibility(self):
        SOC.react(self.state, START, "e_andi", "p_hendra_hiring")
        self.assertIn("emp:e_andi", self.state["social"]["posts"]["p_hendra_hiring"]["likes"])
        with self.assertRaises(E.DemoError):
            SOC.comment(self.state, START, "e_weiling", "p_hendra_hiring", "Hi from Singapore")
        SOC.comment(self.state, START, "e_andi", "p_hendra_hiring", "Interested, will reach out.")
        self.assertEqual(self.state["social"]["posts"]["p_hendra_hiring"]["comments"][-1]["by"], "emp:e_andi")

    def test_reports_hide_then_admin_moderates(self):
        post = SOC.post_create(self.state, START, "e_putri", "Selling my old laptop, DM me", "building")
        SOC.report(self.state, START + 5, "e_andi", post["id"], "spam")
        self.assertNotIn(post["id"], ids(SOC.view_for(self.state, "emp:e_andi", START + 10)["feed"]))
        self.assertIn(post["id"], ids(SOC.view_for(self.state, "emp:e_sari", START + 10)["feed"]))
        queue = SOC.view_for(self.state, "admin:co", START + 10)["admin"]["queue"]
        self.assertTrue(any(item["post"] == post["id"] and item["can_moderate"] for item in queue))
        SOC.moderate(self.state, START + 20, post["id"], "remove")
        self.assertNotIn(post["id"], ids(SOC.view_for(self.state, "emp:e_sari", START + 30)["feed"]))
        self.assertIn(post["id"], ids(SOC.view_for(self.state, "emp:e_putri", START + 30)["feed"]))  # author still sees it
        with self.assertRaises(E.DemoError):
            SOC.moderate(self.state, START, "p_hendra_hiring", "remove")  # other company's post

    def test_threshold_hides_external_post_for_everyone(self):
        for emp_id in ("e_andi", "e_sari", "e_budi"):
            SOC.report(self.state, START, emp_id, "p_dimas_reusable", "other")
        self.assertTrue(self.state["social"]["posts"]["p_dimas_reusable"].get("report_hidden"))
        self.assertNotIn("p_dimas_reusable", ids(SOC.view_for(self.state, "emp:e_putri", START)["feed"]))
        self.assertNotIn("p_dimas_reusable", ids(SOC.view_for(self.state, "cafe:c_aren", START)["feed"]))

    def test_people_nearby_engage_with_new_posts(self):
        post = SOC.post_create(self.state, START, "e_andi", "Anyone up for a Go meetup?", "building")
        SOC.tick(self.state, START + 60)
        self.assertEqual(post["likes"], [])
        SOC.tick(self.state, START + 180)
        self.assertTrue(any(key.startswith("member:") for key in post["likes"]))


class ChatAndMeetupTests(unittest.TestCase):
    def setUp(self):
        self.state = fresh()

    def test_chat_with_member_is_answered_after_a_few_minutes(self):
        slot = START + 2 * 3600
        chat = SOC.chat_request(self.state, START, "e_andi", "member:m_rina", "c_senja", slot, "Payments APIs")
        self.assertEqual(chat["status"], "pending")
        with self.assertRaises(E.DemoError) as error:
            SOC.chat_request(self.state, START, "e_andi", "member:m_rina", "c_senja", slot)
        self.assertEqual(error.exception.code, "DUPLICATE")
        SOC.tick(self.state, START + 60)
        self.assertEqual(chat["status"], "pending")
        SOC.tick(self.state, START + SOC.CHAT_REPLY_MIN * 60)
        self.assertEqual(chat["status"], "accepted")
        self.assertTrue(any(note["to"] == "e_andi" and "confirmed" in note["en"] for note in self.state["notifications"]))

    def test_member_can_decline_with_reason(self):
        chat = SOC.chat_request(self.state, START, "e_andi", "member:m_nadia", "c_seduh", START + 3600)
        SOC.tick(self.state, START + 600)
        self.assertEqual(chat["status"], "declined")
        self.assertIn("next week", chat["reason"])

    def test_chat_rules(self):
        with self.assertRaises(E.DemoError) as error:
            SOC.chat_request(self.state, START, "e_andi", "member:m_dimas", "c_aren", START + 3600)
        self.assertEqual(error.exception.code, "CHAT_NOT_ALLOWED")   # building-only, different tower
        with self.assertRaises(E.DemoError):
            SOC.chat_request(self.state, START, "e_andi", "member:m_kevin", "c_sg", START + 3600)  # other city
        with self.assertRaises(E.DemoError) as error:
            SOC.chat_request(self.state, START, "e_andi", "member:m_rina", "c_senja", START + 60)
        self.assertEqual(error.exception.code, "BAD_TIME")
        with self.assertRaises(E.DemoError):
            SOC.chat_request(self.state, START, "e_andi", "member:m_rina", "c_sg", START + 3600)  # café elsewhere
        with self.assertRaises(E.DemoError):
            SOC.chat_request(self.state, START, "e_andi", "emp:e_rizky", "c_senja", START + 3600)  # chats off

    def test_colleague_chat_needs_the_invitee_to_answer(self):
        chat = SOC.chat_request(self.state, START, "e_andi", "emp:e_sari", "c_senja", START + 3600)
        with self.assertRaises(E.DemoError):
            SOC.chat_respond(self.state, START, "e_budi", chat["id"], True)
        SOC.chat_respond(self.state, START, "e_sari", chat["id"], True)
        self.assertEqual(chat["status"], "accepted")
        SOC.chat_cancel(self.state, START, "e_andi", chat["id"])
        self.assertEqual(chat["status"], "cancelled")

    def test_meetup_per_company_cap(self):
        meetup = self.state["social"]["meetups"]["mu_fintech"]
        cap = meetup["max_per_company"]
        already = sum(1 for company in meetup["attendees"].values() if company == SOC.HOME_COMPANY)
        joiners = ["e_andi", "e_sari", "e_budi", "e_dewi", "e_putri", "e_fajar"]
        for emp_id in joiners[:cap - already]:
            SOC.meetup_rsvp(self.state, START, emp_id, "mu_fintech", True)
        with self.assertRaises(E.DemoError) as error:
            SOC.meetup_rsvp(self.state, START, joiners[cap - already], "mu_fintech", True)
        self.assertEqual(error.exception.code, "COMPANY_CAP")
        SOC.meetup_rsvp(self.state, START, joiners[0], "mu_fintech", False)
        SOC.meetup_rsvp(self.state, START, joiners[cap - already], "mu_fintech", True)

    def test_meetup_view_shares_counts_not_names(self):
        meetup = next(row for row in SOC.view_for(self.state, "emp:e_andi", START)["meetups"] if row["id"] == "mu_fintech")
        self.assertNotIn("attendees", meetup)
        self.assertEqual(meetup["going"], sum(row["count"] for row in meetup["breakdown"]))

    def test_employee_and_cafe_can_host(self):
        meetup = SOC.meetup_create(self.state, START, "emp:e_andi", "c_senja", "Go users coffee", START + 86400,
                                   capacity=10, max_per_company=3, audience="building")
        self.assertIn("emp:e_andi", meetup["attendees"])
        self.assertIn(meetup["id"], ids(SOC.view_for(self.state, "emp:e_sari", START)["meetups"]))
        with self.assertRaises(E.DemoError):
            SOC.meetup_create(self.state, START, "emp:e_andi", "c_sg", "Wrong city", START + 86400)
        cafe_meetup = SOC.meetup_create(self.state, START, "cafe:c_senja", "c_senja", "Latte art class", START + 2 * 86400)
        self.assertIn(cafe_meetup["id"], ids(SOC.view_for(self.state, "emp:e_andi", START)["meetups"]))


if __name__ == "__main__":
    unittest.main()
