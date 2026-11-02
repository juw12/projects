"""Minimal QR Code encoder (ISO/IEC 18004), byte mode, versions 1-40, standard library only.

Follows the well-known reference structure (finder/timing/alignment patterns, Reed-Solomon
over GF(256) with polynomial 0x11D, BCH format/version info, 8 masks with penalty scoring).
Verified in tests against an independent encoder (segno) and decoder (OpenCV) when available.
"""

ECL_ORDINAL = {"L": 0, "M": 1, "Q": 2, "H": 3}
ECL_FORMAT_BITS = {"L": 1, "M": 0, "Q": 3, "H": 2}

ECC_CODEWORDS_PER_BLOCK = (
    (-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30),
    (-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28),
    (-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30),
    (-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30),
)

NUM_ERROR_CORRECTION_BLOCKS = (
    (-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25),
    (-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49),
    (-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68),
    (-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81),
)

MASK_FUNCTIONS = (
    lambda x, y: (x + y) % 2 == 0,
    lambda x, y: y % 2 == 0,
    lambda x, y: x % 3 == 0,
    lambda x, y: (x + y) % 3 == 0,
    lambda x, y: (x // 3 + y // 2) % 2 == 0,
    lambda x, y: x * y % 2 + x * y % 3 == 0,
    lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0,
    lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0,
)


class QrError(ValueError):
    pass


def _bit(value, index):
    return (value >> index) & 1 != 0


def _num_raw_data_modules(version):
    result = (16 * version + 128) * version + 64
    if version >= 2:
        num_align = version // 7 + 2
        result -= (25 * num_align - 10) * num_align - 55
        if version >= 7:
            result -= 36
    return result


def _num_data_codewords(version, ecl):
    ordinal = ECL_ORDINAL[ecl]
    return (_num_raw_data_modules(version) // 8
            - ECC_CODEWORDS_PER_BLOCK[ordinal][version] * NUM_ERROR_CORRECTION_BLOCKS[ordinal][version])


def _gf_multiply(x, y):
    z = 0
    for index in reversed(range(8)):
        z = (z << 1) ^ ((z >> 7) * 0x11D)
        z ^= ((y >> index) & 1) * x
    return z


def _rs_divisor(degree):
    result = [0] * (degree - 1) + [1]
    root = 1
    for _ in range(degree):
        for index in range(len(result)):
            result[index] = _gf_multiply(result[index], root)
            if index + 1 < len(result):
                result[index] ^= result[index + 1]
        root = _gf_multiply(root, 0x02)
    return result


def rs_remainder(data, degree):
    divisor = _rs_divisor(degree)
    result = [0] * len(divisor)
    for byte in data:
        factor = byte ^ result.pop(0)
        result.append(0)
        for index, coefficient in enumerate(divisor):
            result[index] ^= _gf_multiply(coefficient, factor)
    return result


class QrCode:
    def __init__(self, version, ecl, codewords, mask=None):
        self.version = version
        self.ecl = ecl
        self.size = version * 4 + 17
        self.modules = [[False] * self.size for _ in range(self.size)]
        self.is_function = [[False] * self.size for _ in range(self.size)]
        self._draw_function_patterns()
        all_codewords = self._add_ecc_and_interleave(codewords)
        self._draw_codewords(all_codewords)
        if mask is None:
            best_penalty = None
            for candidate in range(8):
                self._apply_mask(candidate)
                self._draw_format_bits(candidate)
                penalty = self._penalty()
                if best_penalty is None or penalty < best_penalty:
                    mask = candidate
                    best_penalty = penalty
                self._apply_mask(candidate)  # XOR again to undo
        self.mask = mask
        self._apply_mask(mask)
        self._draw_format_bits(mask)

    # -- function patterns --------------------------------------------------

    def _set_function(self, x, y, dark):
        self.modules[y][x] = dark
        self.is_function[y][x] = True

    def _draw_function_patterns(self):
        for index in range(self.size):
            self._set_function(6, index, index % 2 == 0)
            self._set_function(index, 6, index % 2 == 0)
        self._draw_finder(3, 3)
        self._draw_finder(self.size - 4, 3)
        self._draw_finder(3, self.size - 4)
        positions = self._alignment_positions()
        count = len(positions)
        for i in range(count):
            for j in range(count):
                if (i == 0 and j == 0) or (i == 0 and j == count - 1) or (i == count - 1 and j == 0):
                    continue
                self._draw_alignment(positions[i], positions[j])
        self._draw_format_bits(0)
        self._draw_version()

    def _draw_finder(self, x, y):
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                xx = x + dx
                yy = y + dy
                if 0 <= xx < self.size and 0 <= yy < self.size:
                    distance = max(abs(dx), abs(dy))
                    self._set_function(xx, yy, distance not in (2, 4))

    def _draw_alignment(self, x, y):
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                self._set_function(x + dx, y + dy, max(abs(dx), abs(dy)) != 1)

    def _alignment_positions(self):
        if self.version == 1:
            return []
        num_align = self.version // 7 + 2
        step = (self.version * 8 + num_align * 3 + 5) // (num_align * 4 - 4) * 2
        result = [self.size - 7 - index * step for index in range(num_align - 1)] + [6]
        return list(reversed(result))

    def _draw_format_bits(self, mask):
        data = ECL_FORMAT_BITS[self.ecl] << 3 | mask
        remainder = data
        for _ in range(10):
            remainder = (remainder << 1) ^ ((remainder >> 9) * 0x537)
        bits = (data << 10 | remainder) ^ 0x5412
        for index in range(0, 6):
            self._set_function(8, index, _bit(bits, index))
        self._set_function(8, 7, _bit(bits, 6))
        self._set_function(8, 8, _bit(bits, 7))
        self._set_function(7, 8, _bit(bits, 8))
        for index in range(9, 15):
            self._set_function(14 - index, 8, _bit(bits, index))
        for index in range(0, 8):
            self._set_function(self.size - 1 - index, 8, _bit(bits, index))
        for index in range(8, 15):
            self._set_function(8, self.size - 15 + index, _bit(bits, index))
        self._set_function(8, self.size - 8, True)

    def _draw_version(self):
        if self.version < 7:
            return
        remainder = self.version
        for _ in range(12):
            remainder = (remainder << 1) ^ ((remainder >> 11) * 0x1F25)
        bits = self.version << 12 | remainder
        for index in range(18):
            dark = _bit(bits, index)
            a = self.size - 11 + index % 3
            b = index // 3
            self._set_function(a, b, dark)
            self._set_function(b, a, dark)

    # -- data -----------------------------------------------------------------

    def _add_ecc_and_interleave(self, data):
        ordinal = ECL_ORDINAL[self.ecl]
        num_blocks = NUM_ERROR_CORRECTION_BLOCKS[ordinal][self.version]
        block_ecc_len = ECC_CODEWORDS_PER_BLOCK[ordinal][self.version]
        raw_codewords = _num_raw_data_modules(self.version) // 8
        num_short_blocks = num_blocks - raw_codewords % num_blocks
        short_block_len = raw_codewords // num_blocks
        blocks = []
        offset = 0
        for index in range(num_blocks):
            length = short_block_len - block_ecc_len + (0 if index < num_short_blocks else 1)
            block = list(data[offset:offset + length])
            offset += length
            ecc = rs_remainder(block, block_ecc_len)
            if index < num_short_blocks:
                block.append(0)
            blocks.append(block + ecc)
        result = []
        for i in range(len(blocks[0])):
            for j, block in enumerate(blocks):
                if i != short_block_len - block_ecc_len or j >= num_short_blocks:
                    result.append(block[i])
        return result

    def _draw_codewords(self, data):
        index = 0
        right = self.size - 1
        while right >= 1:
            if right == 6:
                right = 5
            for vertical in range(self.size):
                for j in range(2):
                    x = right - j
                    upward = (right + 1) & 2 == 0
                    y = self.size - 1 - vertical if upward else vertical
                    if not self.is_function[y][x] and index < len(data) * 8:
                        self.modules[y][x] = _bit(data[index >> 3], 7 - (index & 7))
                        index += 1
            right -= 2

    def _apply_mask(self, mask):
        function = MASK_FUNCTIONS[mask]
        for y in range(self.size):
            for x in range(self.size):
                if not self.is_function[y][x] and function(x, y):
                    self.modules[y][x] = not self.modules[y][x]

    def _penalty(self):
        size = self.size
        modules = self.modules
        penalty = 0
        for lines in (modules, [list(column) for column in zip(*modules)]):
            for line in lines:
                run_color = line[0]
                run_length = 1
                for value in line[1:]:
                    if value == run_color:
                        run_length += 1
                    else:
                        if run_length >= 5:
                            penalty += run_length - 2
                        run_color = value
                        run_length = 1
                if run_length >= 5:
                    penalty += run_length - 2
        for y in range(size - 1):
            for x in range(size - 1):
                color = modules[y][x]
                if color == modules[y][x + 1] == modules[y + 1][x] == modules[y + 1][x + 1]:
                    penalty += 3
        dark = sum(row.count(True) for row in modules)
        total = size * size
        k = (abs(dark * 20 - total * 10) + total - 1) // total - 1
        penalty += k * 10
        return penalty


def encode(text, ecl="M", min_version=1, max_version=40, mask=None):
    data = text.encode("utf-8") if isinstance(text, str) else bytes(text)
    for version in range(min_version, max_version + 1):
        capacity_bits = _num_data_codewords(version, ecl) * 8
        count_bits = 8 if version <= 9 else 16
        used_bits = 4 + count_bits + len(data) * 8
        if used_bits <= capacity_bits:
            break
    else:
        raise QrError("Data too long for a QR code")
    bits = []

    def append(value, length):
        for index in reversed(range(length)):
            bits.append((value >> index) & 1)

    append(0b0100, 4)
    append(len(data), count_bits)
    for byte in data:
        append(byte, 8)
    append(0, min(4, capacity_bits - len(bits)))
    append(0, (8 - len(bits) % 8) % 8)
    pad = 0xEC
    while len(bits) < capacity_bits:
        append(pad, 8)
        pad ^= 0xEC ^ 0x11
    codewords = [int("".join(str(bit) for bit in bits[index:index + 8]), 2) for index in range(0, len(bits), 8)]
    return QrCode(version, ecl, codewords, mask)


def to_svg(code, scale=4, border=4, dark="#111111", light="#ffffff"):
    size = code.size + border * 2
    parts = []
    for y in range(code.size):
        for x in range(code.size):
            if code.modules[y][x]:
                parts.append(f"M{x + border},{y + border}h1v1h-1z")
    pixels = size * scale
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{pixels}" height="{pixels}" '
        f'shape-rendering="crispEdges"><rect width="100%" height="100%" fill="{light}"/>'
        f'<path d="{"".join(parts)}" fill="{dark}"/></svg>'
    )
