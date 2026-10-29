"""
WakeUp-Pc - agent sécurisé.

MODE=pc     -> tourne sur le PC : lock, sleep, restart, shutdown
MODE=relay  -> tourne sur un appareil toujours allumé du même réseau : wake (Wake-on-LAN)

L'agent n'écoute QUE sur 127.0.0.1. Il est publié en HTTPS uniquement
à l'intérieur de ton réseau privé Tailscale avec : tailscale serve --bg 8765
"""
import os, sys, json, time, hmac, socket, platform, subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODE = os.environ.get("MODE", "pc")
TOKEN = os.environ.get("TOKEN", "")
ORIGINS = {o.strip() for o in os.environ.get("ALLOWED_ORIGIN", "").split(",") if o.strip()}
# ex: https://pseudo.github.io,https://localhost  (la page GitHub et l'appli Android)
WOL_MAC = os.environ.get("WOL_MAC", "")         # mode relay : adresse MAC du PC
PORT = int(os.environ.get("PORT", "8765"))
BIND = "127.0.0.1"
MAX_FAILS, LOCK_SECONDS = 5, 900
state = {"fails": 0, "until": 0.0}

WIN = {
    "shutdown": ["shutdown", "/s", "/t", "5"],
    "restart": ["shutdown", "/r", "/t", "5"],
    "sleep": ["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"],
    "lock": ["rundll32.exe", "user32.dll,LockWorkStation"],
}
LIN = {
    "shutdown": ["systemctl", "poweroff"],
    "restart": ["systemctl", "reboot"],
    "sleep": ["systemctl", "suspend"],
    "lock": ["loginctl", "lock-session"],
}
CMDS = WIN if platform.system() == "Windows" else LIN


def log(msg):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


def wake(mac):
    raw = bytes.fromhex(mac.replace(":", "").replace("-", ""))
    packet = b"\xff" * 6 + raw * 16
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        for _ in range(3):
            s.sendto(packet, ("255.255.255.255", 9))
            time.sleep(0.2)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _cors(self):
        o = self.headers.get("Origin")
        if o and o in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Access-Control-Allow-Headers", "X-Token, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Vary", "Origin")

    def _send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        self._send(404, {"error": "introuvable"})

    def do_POST(self):
        origin = self.headers.get("Origin")
        if origin and origin not in ORIGINS:
            log("origine refusée: " + origin)
            return self._send(403, {"error": "origine refusée"})

        now = time.time()
        if now < state["until"]:
            return self._send(429, {"error": "verrouillé, réessaie plus tard"})

        given = self.headers.get("X-Token", "").encode()
        if not hmac.compare_digest(given, TOKEN.encode()):
            state["fails"] += 1
            log("token invalide (%d/%d)" % (state["fails"], MAX_FAILS))
            if state["fails"] >= MAX_FAILS:
                state["until"] = now + LOCK_SECONDS
                state["fails"] = 0
                log("verrouillage 15 min")
            return self._send(401, {"error": "token invalide"})
        state["fails"] = 0

        action = self.path.strip("/")
        if action == "ping":
            return self._send(200, {"ok": True, "mode": MODE})

        if MODE == "relay":
            if action != "wake":
                return self._send(400, {"error": "action inconnue"})
            log("wake")
            wake(WOL_MAC)
            return self._send(200, {"ok": True, "action": "wake"})

        cmd = CMDS.get(action)
        if not cmd:
            return self._send(400, {"error": "action inconnue"})
        log("action: " + action)
        self._send(200, {"ok": True, "action": action})
        subprocess.Popen(cmd)


if __name__ == "__main__":
    if MODE not in ("pc", "relay"):
        sys.exit("MODE doit valoir pc ou relay")
    if len(TOKEN) < 16:
        sys.exit("TOKEN trop court : 16 caractères minimum")
    if not ORIGINS or not all(o.startswith("https://") for o in ORIGINS):
        sys.exit("ALLOWED_ORIGIN requis, ex: https://pseudo.github.io,https://localhost")
    if MODE == "relay" and not WOL_MAC:
        sys.exit("WOL_MAC requis en mode relay")
    log("Agent %s sur %s:%d" % (MODE, BIND, PORT))
    ThreadingHTTPServer((BIND, PORT), H).serve_forever()
