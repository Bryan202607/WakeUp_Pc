"""
WakeUp-Pc - agent sécurisé.

MODE=pc     -> tourne sur le PC : verrouiller, veille, hibernation, déconnexion,
               redémarrer, éteindre (tout de suite ou programmé), écran, volume et
               médias, infos du PC, ouvrir un site ou une appli, presse-papiers
MODE=relay  -> tourne sur un appareil toujours allumé du même réseau : wake (Wake-on-LAN)

L'agent n'écoute QUE sur 127.0.0.1. Il est publié en HTTPS uniquement
à l'intérieur de ton réseau privé Tailscale avec : tailscale serve --bg 8765

Pour "Ouvrir une appli" : crée un fichier apps.json à côté de agent.py, par exemple
    {"YouTube": "https://youtube.com", "Bloc-notes": "notepad.exe"}
Seules les applis de cette liste peuvent être lancées depuis le téléphone.
"""
import os, sys, json, time, hmac, ctypes, base64, shlex, shutil, socket, platform
import threading, subprocess, webbrowser
from collections import deque
from urllib.parse import urlparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODE = os.environ.get("MODE", "pc")
TOKEN = os.environ.get("TOKEN", "")
ORIGINS = {o.strip() for o in os.environ.get("ALLOWED_ORIGIN", "").split(",") if o.strip()}
# ex: https://pseudo.github.io,https://localhost  (la page GitHub et l'appli Android)
WOL_MAC = os.environ.get("WOL_MAC", "")         # mode relay : adresse MAC du PC
PORT = int(os.environ.get("PORT", "8765"))
BIND = "127.0.0.1"
MAX_FAILS, LOCK_SECONDS = 5, 900
MAX_BODY = 8192
IS_WIN = platform.system() == "Windows"
HERE = os.path.dirname(os.path.abspath(__file__))

state = {"fails": 0, "until": 0.0, "shutdown_at": None}
HISTORY = deque(maxlen=30)   # dernières actions (perdues si l'agent redémarre)


def log(msg):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


def note(text, bad=False):
    HISTORY.append({"t": int(time.time()), "text": text, "bad": bad})


# ---------------------------------------------------------------- lancer des commandes

def spawn(cmd):
    if not shutil.which(cmd[0]):
        raise ValueError("outil introuvable sur le PC : " + cmd[0])
    subprocess.Popen(cmd)


def later(cmd):
    """Lance la commande une fraction de seconde plus tard, pour que la réponse parte d'abord."""
    if not shutil.which(cmd[0]):
        raise ValueError("outil introuvable sur le PC : " + cmd[0])
    threading.Timer(0.3, lambda: subprocess.Popen(cmd)).start()


# action -> (texte de l'historique, commande Windows, commande Linux)
SIMPLE = {
    "lock": ("Verrouillage", ["rundll32.exe", "user32.dll,LockWorkStation"], ["loginctl", "lock-session"]),
    "sleep": ("Mise en veille", ["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"], ["systemctl", "suspend"]),
    "hibernate": ("Hibernation", ["shutdown", "/h"], ["systemctl", "hibernate"]),
    "logout": ("Déconnexion", ["shutdown", "/l"], ["loginctl", "terminate-user", os.environ.get("USER", "")]),
    "restart": ("Redémarrage", ["shutdown", "/r", "/t", "5"], ["systemctl", "reboot"]),
    "shutdown": ("Extinction", ["shutdown", "/s", "/t", "5"], ["systemctl", "poweroff"]),
}
POWER = {"restart", "shutdown"}  # ces deux-là annulent d'abord une extinction programmée

# action -> (touche Windows, nombre d'appuis, commande Linux)
MEDIA = {
    "vol_up": (0xAF, 5, ["pactl", "set-sink-volume", "@DEFAULT_SINK@", "+10%"]),
    "vol_down": (0xAE, 5, ["pactl", "set-sink-volume", "@DEFAULT_SINK@", "-10%"]),
    "mute": (0xAD, 1, ["pactl", "set-sink-mute", "@DEFAULT_SINK@", "toggle"]),
    "play": (0xB3, 1, ["playerctl", "play-pause"]),
    "next": (0xB0, 1, ["playerctl", "next"]),
    "prev": (0xB1, 1, ["playerctl", "previous"]),
}


def cancel_schedule():
    try:
        subprocess.run(["shutdown", "/a"] if IS_WIN else ["shutdown", "-c"],
                       capture_output=True, timeout=10)
    except Exception:
        pass
    state["shutdown_at"] = None


def act_simple(name):
    label, win, lin = SIMPLE[name]

    def f(body):
        if name in POWER:
            cancel_schedule()
        later(win if IS_WIN else lin)
        note(label)
        return {}
    return f


def act_media(name):
    vk, times, lin = MEDIA[name]

    def f(body):
        if IS_WIN:
            u = ctypes.windll.user32
            for _ in range(times):
                u.keybd_event(vk, 0, 0, 0)   # touche enfoncée
                u.keybd_event(vk, 0, 2, 0)   # touche relâchée
        else:
            spawn(lin)
        return {}
    return f


def act_screenoff(body):
    if IS_WIN:
        # 0x0112 = WM_SYSCOMMAND, 0xF170 = SC_MONITORPOWER, 2 = écran éteint
        ctypes.windll.user32.PostMessageW(0xFFFF, 0x0112, 0xF170, 2)
    else:
        spawn(["xset", "dpms", "force", "off"])
    note("Écran éteint")
    return {}


def act_schedule(body):
    try:
        m = int(body.get("minutes", 0))
    except (TypeError, ValueError):
        m = 0
    if not 1 <= m <= 1440:
        raise ValueError("durée entre 1 et 1440 minutes")
    cancel_schedule()
    spawn(["shutdown", "/s", "/t", str(m * 60)] if IS_WIN else ["shutdown", "-P", "+%d" % m])
    state["shutdown_at"] = int(time.time()) + m * 60
    note("Extinction programmée dans %d min" % m)
    return {"shutdown_at": state["shutdown_at"]}


def act_cancel(body):
    cancel_schedule()
    note("Extinction programmée annulée")
    return {}


# ---------------------------------------------------------------- infos du PC

class MEM(ctypes.Structure):
    _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong),
                ("total", ctypes.c_ulonglong), ("avail", ctypes.c_ulonglong),
                ("tpf", ctypes.c_ulonglong), ("apf", ctypes.c_ulonglong),
                ("tv", ctypes.c_ulonglong), ("av", ctypes.c_ulonglong),
                ("ave", ctypes.c_ulonglong)]


class PWR(ctypes.Structure):
    _fields_ = [("ac", ctypes.c_ubyte), ("flag", ctypes.c_ubyte), ("pct", ctypes.c_ubyte),
                ("sys", ctypes.c_ubyte), ("life", ctypes.c_ulong), ("full", ctypes.c_ulong)]


def act_info(body):
    d = {}
    try:
        if IS_WIN:
            k = ctypes.windll.kernel32
            k.GetTickCount64.restype = ctypes.c_uint64
            d["uptime"] = int(k.GetTickCount64() // 1000)
            m = MEM()
            m.length = ctypes.sizeof(MEM)
            k.GlobalMemoryStatusEx(ctypes.byref(m))
            d["mem_pct"] = int(m.load)
            p = PWR()
            k.GetSystemPowerStatus(ctypes.byref(p))
            if p.flag != 128 and p.pct != 255:   # 128 = pas de batterie, 255 = inconnu
                d["battery"] = {"pct": int(p.pct), "ac": p.ac == 1}
        else:
            with open("/proc/uptime") as f:
                d["uptime"] = int(float(f.read().split()[0]))
            mem = {}
            with open("/proc/meminfo") as f:
                for line in f:
                    k, v = line.split(":")
                    mem[k] = int(v.split()[0])
            d["mem_pct"] = round(100 * (1 - mem["MemAvailable"] / mem["MemTotal"]))
            base = "/sys/class/power_supply"
            for n in sorted(os.listdir(base)):
                if n.startswith("BAT"):
                    with open(os.path.join(base, n, "capacity")) as f:
                        pct = int(f.read())
                    with open(os.path.join(base, n, "status")) as f:
                        ac = f.read().strip() != "Discharging"
                    d["battery"] = {"pct": pct, "ac": ac}
                    break
    except Exception as e:
        log("info partielle: " + repr(e))
    try:
        u = shutil.disk_usage(os.environ.get("SystemDrive", "C:") + "\\" if IS_WIN else "/")
        d["disk_free"], d["disk_total"] = u.free, u.total
    except Exception:
        pass

    at = state["shutdown_at"]
    if at and time.time() > at + 120:   # l'heure est passée : on oublie
        at = state["shutdown_at"] = None
    d["shutdown_at"] = at
    d["history"] = list(HISTORY)[::-1][:20]
    return d


# ---------------------------------------------------------------- ouvrir / copier

def load_apps():
    try:
        with open(os.path.join(HERE, "apps.json"), encoding="utf-8") as f:
            return {str(k): str(v) for k, v in json.load(f).items()}
    except FileNotFoundError:
        return {}
    except Exception as e:
        log("apps.json illisible: " + repr(e))
        return {}


def act_apps(body):
    return {"apps": list(load_apps().keys())}


def launch(target):
    if target.lower().startswith(("http://", "https://")):
        webbrowser.open(target)
    elif IS_WIN:
        os.startfile(target)
    else:
        spawn(shlex.split(target))


def act_open(body):
    name = str(body.get("name", ""))
    apps = load_apps()
    if name not in apps:
        raise ValueError("appli non autorisée")
    launch(apps[name])
    note("Ouverture : " + name)
    return {}


def act_url(body):
    url = str(body.get("url", "")).strip()
    ok = url.lower().startswith(("http://", "https://")) and len(url) <= 2000
    if not ok or any(c.isspace() or ord(c) < 32 for c in url):
        raise ValueError("adresse invalide")
    webbrowser.open(url)
    note("Site ouvert : " + urlparse(url).netloc[:60])
    return {}


def act_clip(body):
    text = str(body.get("text", ""))[:2000]
    if not text:
        raise ValueError("texte vide")
    if IS_WIN:
        # le texte passe en base64 : pas de souci d'accents ni de caractères spéciaux
        b64 = base64.b64encode(text.encode("utf-8")).decode()
        ps = "Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%s')))" % b64
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                       capture_output=True, timeout=20, creationflags=0x08000000)
    else:
        tool = ["wl-copy"] if shutil.which("wl-copy") else ["xclip", "-selection", "clipboard"]
        if not shutil.which(tool[0]):
            raise ValueError("installe xclip ou wl-copy sur le PC")
        subprocess.run(tool, input=text.encode("utf-8"), timeout=10)
    note("Texte copié (%d caractères)" % len(text))
    return {}


PC = {n: act_simple(n) for n in SIMPLE}
PC.update({n: act_media(n) for n in MEDIA})
PC.update({
    "screenoff": act_screenoff, "schedule": act_schedule, "cancel": act_cancel,
    "info": act_info, "apps": act_apps, "open": act_open, "url": act_url, "clip": act_clip,
})


# ---------------------------------------------------------------- Wake-on-LAN (relais)

def wake(mac):
    raw = bytes.fromhex(mac.replace(":", "").replace("-", ""))
    packet = b"\xff" * 6 + raw * 16
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        for _ in range(3):
            s.sendto(packet, ("255.255.255.255", 9))
            time.sleep(0.2)


# ---------------------------------------------------------------- serveur

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

        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n > MAX_BODY:
            return self._send(413, {"error": "message trop gros"})
        raw = self.rfile.read(n) if n else b""

        now = time.time()
        if now < state["until"]:
            return self._send(429, {"error": "verrouillé, réessaie plus tard"})

        given = self.headers.get("X-Token", "").encode()
        if not hmac.compare_digest(given, TOKEN.encode()):
            state["fails"] += 1
            log("token invalide (%d/%d)" % (state["fails"], MAX_FAILS))
            note("Token refusé", bad=True)
            if state["fails"] >= MAX_FAILS:
                state["until"] = now + LOCK_SECONDS
                state["fails"] = 0
                log("verrouillage 15 min")
                note("Accès bloqué 15 min", bad=True)
            return self._send(401, {"error": "token invalide"})
        state["fails"] = 0

        try:
            body = json.loads(raw) if raw else {}
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            return self._send(400, {"error": "message invalide"})

        action = self.path.strip("/")
        if action == "ping":
            return self._send(200, {"ok": True, "mode": MODE})

        if MODE == "relay":
            if action != "wake":
                return self._send(400, {"error": "action inconnue"})
            log("wake")
            wake(WOL_MAC)
            return self._send(200, {"ok": True, "action": "wake"})

        fn = PC.get(action)
        if not fn:
            return self._send(400, {"error": "action inconnue"})
        if action not in ("info", "apps"):
            log("action: " + action)
        try:
            result = fn(body) or {}
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        except Exception as e:
            log("erreur %s: %r" % (action, e))
            return self._send(500, {"error": "erreur sur le PC"})
        result.update(ok=True, action=action)
        self._send(200, result)


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
