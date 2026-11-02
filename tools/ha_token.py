"""Создаёт долгоживущий токен HA для страницы квартиры.

Токен обменивается из refresh-токена на сервере и через WebSocket API
регистрируется как long_lived_access_token с именем sadovniki-3d.
"""
import asyncio
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request

import websockets

HOST = "192.168.191.110"
BASE = f"http://{HOST}:8123"
EXPECT = "/tmp/ha_ssh.exp"


def server(cmd):
    out = subprocess.run(["expect", EXPECT, cmd], capture_output=True, text=True).stdout
    return out


def refresh_token():
    raw = server("cat /homeassistant/.storage/auth")
    tokens = re.findall(r'"token": "([a-f0-9]{128})"', raw)
    types = re.findall(r'"token_type": "([a-z_]+)"', raw)
    if not tokens:
        sys.exit("no tokens found")
    # первый обычный (normal) токен — сессия фронтенда
    idx = types.index("normal") if "normal" in types else 0
    return tokens[idx]


def access_token(refresh):
    data = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": refresh,
    }).encode()
    req = urllib.request.Request(BASE + "/auth/token", data=data)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)["access_token"]
    except urllib.error.HTTPError as e:
        sys.exit("token exchange failed: " + e.read().decode()[:300])


async def create_long_lived(at):
    async with websockets.connect(f"ws://{HOST}:8123/api/websocket", max_size=4 * 1024 * 1024) as ws:
        await ws.recv()  # auth_required
        await ws.send(json.dumps({"type": "auth", "access_token": at}))
        msg = json.loads(await ws.recv())
        if msg.get("type") != "auth_ok":
            sys.exit(f"auth failed: {msg}")
        await ws.send(json.dumps({
            "id": 1,
            "type": "auth/long_lived_access_token",
            "client_name": "sadovniki-3d",
            "lifespan": 3650,
        }))
        while True:
            reply = json.loads(await ws.recv())
            if reply.get("id") == 1:
                if not reply.get("success"):
                    sys.exit(f"error: {reply}")
                return reply["result"]


def main():
    rt = refresh_token()
    at = access_token(rt)
    token = asyncio.run(create_long_lived(at))
    print("TOKEN_OK", len(token))
    with open("/tmp/apt_token", "w") as f:
        f.write(token)


main()
