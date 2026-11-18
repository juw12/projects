"""Tests for qr.py. Run: python -m unittest (in this folder).

The squares below were not made by qr.py: two come from segno 1.6.6 and one from OpenCV 5.0.0's
encoder, each with the same text, error correction M and mask. qr.py must give the same square,
module for module. Each row is written as one hexadecimal number.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import qr  # noqa: E402

SEGNO_V2_TEXT = "hello world, this is lower"  # 26 bytes: version 2, filled to the last byte
SEGNO_V2_MASK3 = """
    1fdf07f 1058541 1744b5d 1756f5d
    1748f5d 1048841 1fd557f 15000
    16e974b 14bb524 35fc40 1691d2e
    16d78ff d367ff 974996 148f371
    4c39f7 17319 1fdc557 105f713
    17405f1 175ea5b 17538f2 104bcdc
    1fd0e67
"""

SEGNO_V6_TEXT = "https://example.com/v1/indodax/phone?k=" + "0123456789abcdef" * 4 + "abc"  # 106 bytes: version 6, four blocks
SEGNO_V6_MASK5 = """
    1fc5599c97f 105a259c441 1755019035d 175a298cd5d
    174f8f3c35d 10484544041 1fd5555557f 1f4040300
    1059581eace 610d666290 3542d42100 992f72431a
    86ab156442 1f95f766279 ff4988b8a0 12b4e6101af
    11777d0eda4 122d92732f9 5d87726f9 19aa0564513
    6f7184bc0d 9122ef3a34 25589575a8 d9604457d9
    1f5571341ca 1a97a663edb 10fc3d4b932 b9c1342dd
    1c627819b0f 1716c766e51 1dc9a26bfb5 13300111748
    115bed3edfc 18632e314 1fc56dc3f50 1049b200110
    174a3e247f1 17474e3e021 1740a04f6f4 10432d7701d
    1fd52f1cab4
"""

OPENCV_V8_TEXT = "https://example.com/v1/indodax/phone?k=" + "fedcba9876543210" * 5 + "xyz!"  # 123 bytes: version 8, padding, blocks of two lengths
OPENCV_V8_MASK2 = """
    1fc7b31f9417f 104bebd17a741 17553a9b7435d 1754d820cfa5d
    175b3bfe5285d 105d65c62d441 1fd555555557f 1517455ab00
    17c46f7e21e7c a1d008bf81c8 1042bde405f93 5897e0bf813b
    125c26f8cd906 9a67ca15325a 617e1daff27 1614dca86b259
    dfe4f16c1924 38300c86b2f2 7437b96c1a09 1215221b83f1
    e5cbdfa879c7 1d2d96a0f1870 5faa8fe2f5ff 91c12c55ab10
    17588fd6e955d 11bfc454231e 15fb827cadff1 980caabf828a
    adf34b063334 1e9d9fda79ae8 593138b67cf da8e35e85c8a
    15c7d7493e7b4 1e1ac83394c82 f5e3cd17a379 1a23453d34c23
    1618d6ac7b57 41db6dbc3ae0 8ed7a6a1fc43 e23fa95129a2
    1c798d7eedbfd 1d4e466111c 1fc041d7afd5b 105a2bc75c91a
    175f3e7c835f6 175ec8cf69bfa 175e2ed5b5663 1042301c6b349
    1fd4c782c1b87
"""


def unpack(text):
    rows = text.split()
    size = len(rows)
    return [[(int(row, 16) >> (size - 1 - x)) & 1 == 1 for x in range(size)] for row in rows]


class QrTest(unittest.TestCase):
    def test_the_square_is_the_one_other_encoders_make(self):
        assert qr.encode(SEGNO_V2_TEXT, 3) == unpack(SEGNO_V2_MASK3)
        assert qr.encode(SEGNO_V6_TEXT, 5) == unpack(SEGNO_V6_MASK5)
        assert qr.encode(OPENCV_V8_TEXT, 2) == unpack(OPENCV_V8_MASK2)

    def test_the_smallest_version_that_holds_the_text_is_used(self):
        # Level M holds 14, 26, 42, 62, 84, 106, 122, 152, 180 and 213 bytes in versions 1 to 10.
        for version, most in enumerate([14, 26, 42, 62, 84, 106, 122, 152, 180, 213], 1):
            assert qr.version_for(most) == version
            assert len(qr.encode("x" * most, 0)) == version * 4 + 17
            if version < qr.MAX_VERSION:
                assert qr.version_for(most + 1) == version + 1
        with self.assertRaises(qr.TooLong):
            qr.encode("x" * 214)

    def test_the_words_and_their_error_words(self):
        # One byte, "a": mode 0100, length 00000001, the byte, the end mark, then EC 11 EC 11 ...
        words = qr.codewords(b"a", 1)
        assert words == [0x40, 0x16, 0x10] + [0xEC, 0x11] * 6 + [0xEC]
        # The ten error words OpenCV's encoder draws for the same sixteen.
        assert qr.interleave(words, 1)[16:] == [252, 160, 39, 162, 98, 107, 50, 59, 111, 28]

    def test_blocks_are_dealt_out_one_word_at_a_time(self):
        # Version 8 at level M: 154 data words in blocks of 38, 38, 39 and 39, each with 22 error words.
        words = list(range(154))
        dealt = qr.interleave(words, 8)
        assert len(dealt) == 242
        assert dealt[:8] == [0, 38, 76, 115, 1, 39, 77, 116]
        assert dealt[152:154] == [114, 153], "the two long blocks give their last word at the end"

    def test_the_fixed_patterns_are_where_a_reader_looks_for_them(self):
        rows = qr.encode("https://example.com/")
        size = len(rows)
        for left, top in ((0, 0), (size - 7, 0), (0, size - 7)):  # the three eyes
            eye = [row[left : left + 7] for row in rows[top : top + 7]]
            assert all(eye[0]) and all(eye[6]) and all(row[0] and row[6] for row in eye)
            assert not any(eye[1][1:6]) and all(all(row[2:5]) for row in eye[2:5])
        assert [rows[6][x] for x in range(8, size - 8)] == [x % 2 == 0 for x in range(8, size - 8)], "the timing line"
        assert rows[size - 8][8], "the module that is always dark"
        assert not rows[size - 8][size - 8] and rows[size - 7][size - 7], "no fourth eye"

    def test_the_mask_picked_is_the_easiest_to_read(self):
        text = "https://example.com/v1/indodax/phone?k=" + "ab" * 24
        choices = [qr.encode(text, mask) for mask in range(8)]
        picked = qr.encode(text)
        assert picked in choices
        assert qr.penalty(picked) == min(qr.penalty(choice) for choice in choices)
        assert len({str(choice) for choice in choices}) == 8, "eight different squares"

    def test_bytes_and_text_give_the_same_square(self):
        assert qr.encode("Rp50.000 é", 1) == qr.encode("Rp50.000 é".encode("utf-8"), 1)


if __name__ == "__main__":
    unittest.main()
