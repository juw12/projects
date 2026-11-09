"""Minimal PG wire protocol v3 test client for ShardBase.

Tests the full connection lifecycle:
1. Startup message
2. SCRAM-SHA-256 auth
3. Simple queries (CREATE TABLE, INSERT, SELECT)
"""
import socket
import struct
import hashlib
import hmac
import base64
import os
import sys

HOST = "127.0.0.1"
PORT = 5432
USER = "postgres"
DB = "shardbase"
PASSWORD = "postgres"


def read_exact(sock, n):
    data = b""
    while len(data) < n:
        chunk = sock.recv(n - len(data))
        if not chunk:
            raise ConnectionError("connection closed")
        data += chunk
    return data


def read_msg(sock):
    """Read a type-tagged message: [type:1][len:4][payload]"""
    t = read_exact(sock, 1)[0]
    ln = struct.unpack("!i", read_exact(sock, 4))[0]
    payload = read_exact(sock, ln - 4) if ln > 4 else b""
    return chr(t), payload


def read_startup_packet(sock):
    """Read a startup packet: [len:4][payload]"""
    ln = struct.unpack("!i", read_exact(sock, 4))[0]
    payload = read_exact(sock, ln - 4) if ln > 4 else b""
    return ln, payload


def cstring(s):
    return s.encode("utf-8") + b"\x00"


def build_startup(user, db):
    payload = struct.pack("!i", 196608)  # protocol v3.0
    payload += cstring("user") + cstring(user)
    payload += cstring("database") + cstring(db)
    payload += b"\x00"
    return struct.pack("!i", 4 + len(payload)) + payload


def build_query(sql):
    payload = cstring(sql)
    return b"Q" + struct.pack("!i", 4 + len(payload)) + payload


def build_terminate():
    return b"X" + struct.pack("!i", 4)


def b64url(data):
    return base64.b64encode(data).decode()


def pbkdf2(password, salt, iterations, dklen=32):
    return hashlib.pbkdf2_hmac("sha256", password, salt, iterations, dklen)


def test_scram_auth(sock):
    """Perform SCRAM-SHA-256 auth. Returns True on success."""
    # Server should send R (Authentication) with SASL
    msg_type, payload = read_msg(sock)
    assert msg_type == "R", f"expected R, got {msg_type}"
    code = struct.unpack("!i", payload[:4])[0]
    print(f"  Auth code: {code}")

    if code == 10:
        # SASL - parse mechanisms
        mech_data = payload[4:]
        mechanisms = mech_data.split(b"\x00")
        mechanisms = [m.decode() for m in mechanisms if m]
        print(f"  SASL mechanisms: {mechanisms}")
        assert "SCRAM-SHA-256" in mechanisms

        # Generate client nonce
        client_nonce = b64url(os.urandom(18))
        gs2_header = "n,,"
        client_first_bare = f"n={USER},r={client_nonce}"
        client_first = gs2_header + client_first_bare

        # Send SASLInitialResponse: 'p' + len + mechanism\0 + client_first
        sasl_init = cstring("SCRAM-SHA-256") + client_first.encode()
        sock.sendall(b"p" + struct.pack("!i", 4 + len(sasl_init)) + sasl_init)

        # Read server-first-message (R with code 11)
        msg_type, payload = read_msg(sock)
        assert msg_type == "R", f"expected R, got {msg_type}"
        code = struct.unpack("!i", payload[:4])[0]
        assert code == 11, f"expected SASL continue (11), got {code}"
        server_first = payload[4:].decode()
        print(f"  Server-first: {server_first}")

        # Parse server-first
        fields = dict(f.split("=", 1) for f in server_first.split(","))
        combined_nonce = fields["r"]
        salt = base64.b64decode(fields["s"] + "=" * (4 - len(fields["s"]) % 4) if len(fields["s"]) % 4 else fields["s"])
        iterations = int(fields["i"])

        # Compute proof
        salted_password = pbkdf2(PASSWORD.encode(), salt, iterations)
        client_key = hmac.new(salted_password, b"Client Key", hashlib.sha256).digest()
        stored_key = hashlib.sha256(client_key).digest()
        client_final_no_proof = f"c={b64url(gs2_header.encode())},r={combined_nonce}"
        auth_message = f"{client_first_bare},{server_first},{client_final_no_proof}"
        client_sig = hmac.new(stored_key, auth_message.encode(), hashlib.sha256).digest()
        client_proof = bytes(a ^ b for a, b in zip(client_key, client_sig))
        client_final = f"{client_final_no_proof},p={b64url(client_proof)}"

        # Send SASLResponse
        sock.sendall(b"p" + struct.pack("!i", 4 + len(client_final)) + client_final.encode())

        # Read server-final (R with code 12)
        msg_type, payload = read_msg(sock)
        assert msg_type == "R", f"expected R, got {msg_type}"
        code = struct.unpack("!i", payload[:4])[0]
        assert code == 12, f"expected SASL final (12), got {code}"
        server_final = payload[4:].decode()
        print(f"  Server-final: {server_final}")

        # Verify server signature
        server_key = hmac.new(salted_password, b"Server Key", hashlib.sha256).digest()
        expected_sig = hmac.new(server_key, auth_message.encode(), hashlib.sha256).digest()
        actual_sig = base64.b64decode(server_final.split("v=")[1])
        assert expected_sig == actual_sig, "Server signature mismatch!"
        print("  Server signature: OK")

        # Read AuthenticationOk (R with code 0)
        msg_type, payload = read_msg(sock)
        assert msg_type == "R", f"expected R, got {msg_type}"
        code = struct.unpack("!i", payload[:4])[0]
        assert code == 0, f"expected AuthOk (0), got {code}"
        print("  Authentication: OK")
        return True

    elif code == 3:
        # Cleartext password
        print("  Cleartext password auth")
        pwd = cstring(PASSWORD)
        sock.sendall(b"p" + struct.pack("!i", 4 + len(pwd)) + pwd)
        msg_type, payload = read_msg(sock)
        assert msg_type == "R"
        code = struct.unpack("!i", payload[:4])[0]
        assert code == 0, f"expected AuthOk, got {code}"
        print("  Authentication: OK")
        return True
    else:
        raise Exception(f"Unsupported auth code: {code}")


def read_params_and_ready(sock):
    """Read ParameterStatus messages, BackendKeyData, and ReadyForQuery."""
    while True:
        msg_type, payload = read_msg(sock)
        if msg_type == "S":
            parts = payload.split(b"\x00")
            name, value = parts[0].decode(), parts[1].decode()
            print(f"  Param: {name} = {value}")
        elif msg_type == "K":
            pid, secret = struct.unpack("!ii", payload)
            print(f"  BackendKeyData: pid={pid} secret={secret:#x}")
        elif msg_type == "Z":
            status = chr(payload[0])
            print(f"  ReadyForQuery: {status}")
            return
        else:
            raise Exception(f"Unexpected message in post-auth: {msg_type}")


def run_query(sock, sql):
    """Send a query and read the full response."""
    sock.sendall(build_query(sql))
    print(f"\n  SQL: {sql}")

    rows = []
    columns = []
    while True:
        msg_type, payload = read_msg(sock)
        if msg_type == "T":
            # RowDescription
            nfields = struct.unpack("!h", payload[:2])[0]
            off = 2
            for _ in range(nfields):
                end = payload.index(b"\x00", off)
                name = payload[off:end].decode()
                off = end + 1 + 4 + 2 + 4 + 2 + 4 + 2  # skip the rest
                columns.append(name)
            print(f"  Columns: {columns}")
        elif msg_type == "D":
            # DataRow
            ncol = struct.unpack("!h", payload[:2])[0]
            off = 2
            row = []
            for _ in range(ncol):
                vlen = struct.unpack("!i", payload[off:off+4])[0]
                off += 4
                if vlen == -1:
                    row.append(None)
                else:
                    row.append(payload[off:off+vlen].decode())
                    off += vlen
            rows.append(row)
            print(f"  Row: {row}")
        elif msg_type == "C":
            tag = payload.split(b"\x00")[0].decode()
            print(f"  CommandComplete: {tag}")
        elif msg_type == "E":
            # ErrorResponse: (field_code, null_terminated_value) ... null_terminator
            fields = {}
            off = 0
            while off < len(payload):
                code_byte = payload[off]
                if code_byte == 0:
                    break
                off += 1
                end = payload.index(b"\x00", off)
                fields[chr(code_byte)] = payload[off:end].decode()
                off = end + 1
            print(f"  ERROR: {fields.get('S','?')}: {fields.get('M','?')} (SQLSTATE {fields.get('C','?')})")
        elif msg_type == "Z":
            status = chr(payload[0])
            print(f"  ReadyForQuery: {status}")
            return columns, rows
        elif msg_type == "I":
            print("  EmptyQueryResponse")
        else:
            raise Exception(f"Unexpected message in query response: {msg_type}")


def main():
    print(f"Connecting to {HOST}:{PORT}...")
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(10)
    sock.connect((HOST, PORT))
    print("Connected.")

    # Send startup message
    sock.sendall(build_startup(USER, DB))
    print(f"Startup sent. User={USER} DB={DB}")

    # Handle SSL request response if any (server sends 'N')
    # Actually, we didn't send an SSL request, so the server should
    # respond directly with auth.

    # Auth
    print("\nAuthenticating...")
    test_scram_auth(sock)

    # Post-auth
    print("\nPost-auth handshake...")
    read_params_and_ready(sock)

    # Run test queries
    print("\n" + "=" * 50)
    print("Test 1: CREATE TABLE")
    print("=" * 50)
    run_query(sock, "CREATE TABLE t (id INT PRIMARY KEY, name TEXT)")

    print("\n" + "=" * 50)
    print("Test 2: INSERT")
    print("=" * 50)
    run_query(sock, "INSERT INTO t VALUES (1, 'alice')")
    run_query(sock, "INSERT INTO t VALUES (2, 'bob')")

    print("\n" + "=" * 50)
    print("Test 3: SELECT *")
    print("=" * 50)
    cols, rows = run_query(sock, "SELECT * FROM t")
    assert len(rows) == 2, f"Expected 2 rows, got {len(rows)}"
    assert rows[0] == ["1", "alice"], f"Row 0 mismatch: {rows[0]}"
    assert rows[1] == ["2", "bob"], f"Row 1 mismatch: {rows[1]}"
    print("  PASS: 2 rows returned with correct values")

    print("\n" + "=" * 50)
    print("Test 4: SELECT WHERE")
    print("=" * 50)
    cols, rows = run_query(sock, "SELECT * FROM t WHERE id = 1")
    assert len(rows) == 1, f"Expected 1 row, got {len(rows)}"
    assert rows[0] == ["1", "alice"], f"Row mismatch: {rows[0]}"
    print("  PASS: WHERE filter works")

    print("\n" + "=" * 50)
    print("Test 5: SELECT literal")
    print("=" * 50)
    cols, rows = run_query(sock, "SELECT 1")
    assert len(rows) == 1, f"Expected 1 row, got {len(rows)}"
    assert rows[0] == ["1"], f"Row mismatch: {rows[0]}"
    print("  PASS: literal SELECT works")

    print("\n" + "=" * 50)
    print("Test 6: Error handling")
    print("=" * 50)
    run_query(sock, "SELECT * FROM nonexistent_table")

    # Terminate
    sock.sendall(build_terminate())
    sock.close()
    print("\n" + "=" * 50)
    print("ALL TESTS PASSED")
    print("=" * 50)


if __name__ == "__main__":
    main()
