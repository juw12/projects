"""Small stdlib CDP client for browser regression checks (shared with apps/sped).

Only connects to an isolated test Chrome process on localhost; never uses a
personal browser profile. Chrome must be supplied by the caller.
"""
import base64
import json
import os
import socket
import struct
from urllib.parse import urlparse


class DevTools:
    def __init__(self, url):
        parsed = urlparse(url)
        if parsed.hostname not in ("127.0.0.1", "localhost"):
            raise ValueError("Only localhost test browsers are supported")
        self.sock = socket.create_connection((parsed.hostname, parsed.port), timeout=120)
        self.buffer = b""
        self.sequence = 0
        self.events = []
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((
            f"GET {parsed.path} HTTP/1.1\r\nHost: {parsed.netloc}\r\n"
            f"Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        ).encode())
        response = b""
        while b"\r\n\r\n" not in response:
            response += self.sock.recv(4096)
        header, self.buffer = response.split(b"\r\n\r\n", 1)
        if b"101" not in header.splitlines()[0]:
            raise ConnectionError(header.decode())

    def send(self, payload):
        data = json.dumps(payload).encode()
        length = len(data)
        header = bytearray([0x81])
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", length)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", length)
        mask = os.urandom(4)
        self.sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def read(self, length):
        while len(self.buffer) < length:
            chunk = self.sock.recv(1048576)
            if not chunk:
                raise ConnectionError("Test browser closed")
            self.buffer += chunk
        value, self.buffer = self.buffer[:length], self.buffer[length:]
        return value

    def receive(self):
        message = b""
        while True:
            first, second = self.read(2)
            length = second & 127
            if length == 126:
                length = struct.unpack(">H", self.read(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self.read(8))[0]
            if first & 15 == 8:
                raise ConnectionError("Test browser closed WebSocket")
            message += self.read(length)
            if first & 128:
                return json.loads(message)

    def call(self, method, **params):
        self.sequence += 1
        sequence = self.sequence
        self.send({"id": sequence, "method": method, "params": params})
        while True:
            reply = self.receive()
            if reply.get("id") == sequence:
                if "error" in reply:
                    raise RuntimeError(reply["error"])
                return reply.get("result", {})
            self.events.append(reply)

    def evaluate(self, expression):
        result = self.call("Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"])
        return result.get("result", {}).get("value")
