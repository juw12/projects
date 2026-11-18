"""A QR code for a short text, such as a link: text in, a square of dark and light modules out.

Standard library only, so the desk can draw the phone link without anything installed. It writes
bytes (UTF-8) with error correction M: about 15 in 100 modules may be unreadable and the code is
still read. Versions 1 to 10, which is up to 213 bytes: a link is about 100.

    rows = qr.encode("https://example.com/")   # rows[y][x] is True for a dark module
"""

from __future__ import annotations

MAX_VERSION = 10
ERROR_WORDS = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26]  # per block, level M, versions 1 to 10
BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5]  # level M, versions 1 to 10
LEVEL_M = 0  # the two bits that name level M in the format information
QUIET = 4  # light modules a reader wants around the code


class TooLong(ValueError):
    """The text does not fit in the largest code made here."""


def raw_modules(version: int) -> int:
    """How many modules carry data and error words, once the fixed patterns are taken away."""
    count = (16 * version + 128) * version + 64
    if version >= 2:
        marks = version // 7 + 2
        count -= (25 * marks - 10) * marks - 55
        if version >= 7:
            count -= 36
    return count


def data_words(version: int) -> int:
    return raw_modules(version) // 8 - ERROR_WORDS[version - 1] * BLOCKS[version - 1]


def version_for(length: int) -> int:
    """The smallest version that holds this many bytes."""
    for version in range(1, MAX_VERSION + 1):
        count_bits = 8 if version <= 9 else 16
        if 4 + count_bits + 8 * length <= 8 * data_words(version):
            return version
    raise TooLong(f"{length} bytes do not fit in a QR code of version {MAX_VERSION}")


# ---------------------------------------------------------------- error correction (Reed-Solomon over GF(256))


def gf_multiply(left: int, right: int) -> int:
    result = 0
    for bit in range(7, -1, -1):
        result = (result << 1) ^ ((result >> 7) * 0x11D)
        result ^= ((right >> bit) & 1) * left
    return result


def divisor(degree: int) -> list:
    """The polynomial (x - 2^0)(x - 2^1)...(x - 2^(degree-1)), without its leading 1."""
    result = [0] * (degree - 1) + [1]
    root = 1
    for _ in range(degree):
        for index in range(degree):
            result[index] = gf_multiply(result[index], root)
            if index + 1 < degree:
                result[index] ^= result[index + 1]
        root = gf_multiply(root, 2)
    return result


def remainder(words: list, by: list) -> list:
    """The error words for these data words."""
    result = [0] * len(by)
    for word in words:
        factor = word ^ result.pop(0)
        result.append(0)
        for index, coefficient in enumerate(by):
            result[index] ^= gf_multiply(coefficient, factor)
    return result


# ---------------------------------------------------------------- from text to the words that are drawn


def codewords(data: bytes, version: int) -> list:
    """The data as the standard's words: mode, length, bytes, an end mark and padding."""
    count_bits = 8 if version <= 9 else 16
    bits = [0, 1, 0, 0] + [(len(data) >> shift) & 1 for shift in range(count_bits - 1, -1, -1)]
    for byte in data:
        bits += [(byte >> shift) & 1 for shift in range(7, -1, -1)]
    capacity = 8 * data_words(version)
    bits += [0] * min(4, capacity - len(bits))
    bits += [0] * (-len(bits) % 8)
    words = [int("".join(map(str, bits[index : index + 8])), 2) for index in range(0, len(bits), 8)]
    pad = 0xEC
    while len(words) < capacity // 8:
        words.append(pad)
        pad ^= 0xEC ^ 0x11
    return words


def interleave(words: list, version: int) -> list:
    """Split into blocks, add each block's error words, and deal them out one word at a time."""
    blocks = BLOCKS[version - 1]
    error_words = ERROR_WORDS[version - 1]
    total = raw_modules(version) // 8
    short_blocks = blocks - total % blocks
    short_length = total // blocks - error_words
    by = divisor(error_words)
    data_blocks, error_blocks, at = [], [], 0
    for index in range(blocks):
        length = short_length + (0 if index < short_blocks else 1)
        block = words[at : at + length]
        at += length
        data_blocks.append(block)
        error_blocks.append(remainder(block, by))
    result = []
    for index in range(short_length + 1):
        result += [block[index] for block in data_blocks if index < len(block)]
    for index in range(error_words):
        result += [block[index] for block in error_blocks]
    return result


# ---------------------------------------------------------------- the square


def alignment_centres(version: int) -> list:
    if version == 1:
        return []
    marks = version // 7 + 2
    step = (version * 8 + marks * 3 + 5) // (marks * 4 - 4) * 2
    size = version * 4 + 17
    return [6] + sorted(size - 7 - index * step for index in range(marks - 1))


def bch(value: int, bits: int, generator: int) -> int:
    """The check bits that follow value: the remainder of value * 2^bits divided by the generator."""
    result = value
    for _ in range(bits):
        result = (result << 1) ^ ((result >> (bits - 1)) * generator)
    return result


def blank(version: int) -> tuple:
    """The square with its fixed patterns drawn. Returns (modules, fixed): fixed marks what data may not touch."""
    size = version * 4 + 17
    modules = [[False] * size for _ in range(size)]
    fixed = [[False] * size for _ in range(size)]

    def put(x, y, dark):
        if 0 <= x < size and 0 <= y < size:
            modules[y][x] = dark
            fixed[y][x] = True

    for index in range(size):  # the two timing lines
        put(6, index, index % 2 == 0)
        put(index, 6, index % 2 == 0)
    for centre_x, centre_y in ((3, 3), (size - 4, 3), (3, size - 4)):  # the three corner eyes, with their light edge
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                put(centre_x + dx, centre_y + dy, max(abs(dx), abs(dy)) not in (2, 4))
    centres = alignment_centres(version)
    for row, centre_y in enumerate(centres):
        for column, centre_x in enumerate(centres):
            if (column, row) in ((0, 0), (0, len(centres) - 1), (len(centres) - 1, 0)):
                continue  # an eye is there
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    put(centre_x + dx, centre_y + dy, max(abs(dx), abs(dy)) != 1)
    if version >= 7:
        number = version << 12 | bch(version, 12, 0x1F25)
        for index in range(18):
            dark = (number >> index) & 1 == 1
            put(size - 11 + index % 3, index // 3, dark)
            put(index // 3, size - 11 + index % 3, dark)
    write_format(modules, fixed, 0)  # keeps the places; the real bits come with the mask
    return modules, fixed


def write_format(modules, fixed, mask: int) -> None:
    size = len(modules)
    data = LEVEL_M << 3 | mask
    bits = (data << 10 | bch(data, 10, 0x537)) ^ 0x5412

    def put(x, y, index):
        modules[y][x] = (bits >> index) & 1 == 1
        fixed[y][x] = True

    for index in range(6):
        put(8, index, index)
    put(8, 7, 6)
    put(8, 8, 7)
    put(7, 8, 8)
    for index in range(9, 15):
        put(14 - index, 8, index)
    for index in range(8):
        put(size - 1 - index, 8, index)
    for index in range(8, 15):
        put(8, size - 15 + index, index)
    modules[size - 8][8] = True  # always dark
    fixed[size - 8][8] = True


def place(modules, fixed, words: list) -> None:
    """Lay the words down in the standard's zigzag, two columns at a time from the right."""
    size = len(modules)
    at = 0
    total = len(words) * 8
    right = size - 1
    while right >= 1:
        if right == 6:
            right = 5  # the timing column is skipped
        upward = ((right + 1) & 2) == 0
        for step in range(size):
            y = size - 1 - step if upward else step
            for x in (right, right - 1):
                if not fixed[y][x] and at < total:
                    modules[y][x] = (words[at >> 3] >> (7 - (at & 7))) & 1 == 1
                    at += 1
        right -= 2


MASKS = [
    lambda x, y: (x + y) % 2 == 0,
    lambda x, y: y % 2 == 0,
    lambda x, y: x % 3 == 0,
    lambda x, y: (x + y) % 3 == 0,
    lambda x, y: (x // 3 + y // 2) % 2 == 0,
    lambda x, y: x * y % 2 + x * y % 3 == 0,
    lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0,
    lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0,
]


def masked(modules, fixed, mask: int) -> list:
    flip = MASKS[mask]
    result = [[dark != (not fixed[y][x] and flip(x, y)) for x, dark in enumerate(row)] for y, row in enumerate(modules)]
    write_format(result, fixed, mask)
    return result


def line_penalty(line: list) -> int:
    """Runs of five or more alike, and the eye-like pattern 1:1:3:1:1 with four light modules beside it."""
    penalty, run, last = 0, 0, None
    for dark in line:
        if dark == last:
            run += 1
            if run == 5:
                penalty += 3
            elif run > 5:
                penalty += 1
        else:
            run, last = 1, dark
    text = "".join("1" if dark else "0" for dark in line)
    for pattern in ("10111010000", "00001011101"):
        start = text.find(pattern)
        while start >= 0:
            penalty += 40
            start = text.find(pattern, start + 1)
    return penalty


def penalty(modules) -> int:
    """How hard this square is to read, by the standard's four rules. Lower is better."""
    size = len(modules)
    result = sum(line_penalty(row) for row in modules)
    result += sum(line_penalty([modules[y][x] for y in range(size)]) for x in range(size))
    for y in range(size - 1):
        for x in range(size - 1):
            if modules[y][x] == modules[y][x + 1] == modules[y + 1][x] == modules[y + 1][x + 1]:
                result += 3
    dark = sum(sum(row) for row in modules)
    steps = (abs(dark * 20 - size * size * 10) + size * size - 1) // (size * size) - 1
    return result + steps * 10


def encode(text, mask: int | None = None) -> list:
    """The QR code for this text as rows of True (dark) and False (light). mask: 0 to 7, or None for the best one."""
    data = text if isinstance(text, bytes) else str(text).encode("utf-8")
    version = version_for(len(data))
    modules, fixed = blank(version)
    place(modules, fixed, interleave(codewords(data, version), version))
    if mask is not None:
        return masked(modules, fixed, mask)
    return min((masked(modules, fixed, choice) for choice in range(8)), key=penalty)
