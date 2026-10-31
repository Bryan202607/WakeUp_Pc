"""
WakeUp-Pc - agent sécurisé.

MODE=pc     -> tourne sur le PC : verrouiller, veille, hibernation, déconnexion,
               redémarrer, éteindre (tout de suite ou programmé), écran, volume et
               médias, infos du PC, ouvrir un site ou une appli, presse-papiers
MODE=relay  -> tourne sur un appareil toujours allumé du même réseau : wake (Wake-on-LAN)

L'agent n'écoute QUE sur 127.0.0.1. Il est publié en HTTPS uniquement
à l'intérieur de ton réseau privé Tailscale avec : tailscale serve --bg 8765

Connexion directe (sans internet) : lance l'agent avec LAN=1. L'agent écoute alors aussi
sur le réseau local (port 8766), par exemple quand le PC est connecté au point d'accès
Wi-Fi du téléphone, au même Wi-Fi, ou au partage de connexion Bluetooth. Les requêtes y
sont signées (le token ne circule jamais en clair).

Fichiers : le dossier SHARE_DIR (par défaut ~/WakeUp-Pc) est le seul accessible depuis
le téléphone, dans les deux sens.

Pour "Ouvrir une appli" : crée un fichier apps.json à côté de agent.py, par exemple
    {"YouTube": "https://youtube.com", "Bloc-notes": "notepad.exe"}
Seules les applis de cette liste peuvent être lancées depuis le téléphone.
"""
import os, re, sys, json, time, hmac, ctypes, base64, shlex, shutil, socket, hashlib, platform
import secrets, threading, subprocess, mimetypes, webbrowser
from collections import deque
from urllib.parse import urlparse, parse_qs, quote
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODE = os.environ.get("MODE", "pc")
TOKEN = os.environ.get("TOKEN", "")
ORIGINS = {o.strip() for o in os.environ.get("ALLOWED_ORIGIN", "").split(",") if o.strip()}
# ex: https://pseudo.github.io,https://localhost  (la page GitHub et l'appli Android)
WOL_MAC = os.environ.get("WOL_MAC", "")         # mode relay : adresse MAC du PC
PORT = int(os.environ.get("PORT", "8765"))
BIND = "127.0.0.1"
LAN = os.environ.get("LAN", "").lower() in ("1", "true", "oui", "yes")
LAN_PORT = int(os.environ.get("LAN_PORT", "8766"))
LAN_BIND = os.environ.get("LAN_BIND", "0.0.0.0")
SHARE_DIR = os.environ.get("SHARE_DIR") or os.path.join(os.path.expanduser("~"), "WakeUp-Pc")
MAX_UPLOAD = int(os.environ.get("MAX_UPLOAD_MB", "1024")) * 1024 * 1024
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


# ---------------------------------------------------------------- fichiers partagés

RESERVED = {"CON", "PRN", "AUX", "NUL"} | {"COM%d" % i for i in range(1, 10)} | {"LPT%d" % i for i in range(1, 10)}


def human(n):
    for unit in ("o", "Ko", "Mo", "Go"):
        if n < 1024 or unit == "Go":
            return ("%d %s" % (n, unit)) if unit == "o" else ("%.1f %s" % (n, unit)).replace(".0 ", " ")
        n /= 1024.0


def share_root():
    root = os.path.realpath(SHARE_DIR)
    os.makedirs(root, exist_ok=True)
    return root


def safe_path(rel):
    """Chemin à l'intérieur du dossier de partage, jamais en dehors."""
    root = share_root()
    parts = [p for p in str(rel or "").replace("\\", "/").split("/") if p not in ("", ".")]
    if ".." in parts or any(":" in p for p in parts):
        raise ValueError("chemin interdit")
    p = os.path.realpath(os.path.join(root, *parts))
    try:
        ok = os.path.commonpath([root, p]) == root
    except ValueError:
        ok = False
    if not ok:
        raise ValueError("chemin interdit")
    return p


def clean_name(name):
    name = str(name).replace("\\", "/").split("/")[-1]
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    base, ext = os.path.splitext(name or "fichier")
    if base.upper() in RESERVED:
        base = "_" + base
    if len(base) + len(ext) > 150:
        base = base[:150 - len(ext)]
    return (base + ext) or "fichier"


def unique_path(folder, name):
    base, ext = os.path.splitext(name)
    p, i = os.path.join(folder, name), 1
    while os.path.exists(p):
        p = os.path.join(folder, "%s (%d)%s" % (base, i, ext))
        i += 1
    return p


def act_files(body):
    folder = safe_path(body.get("path", ""))
    if not os.path.isdir(folder):
        raise ValueError("dossier introuvable")
    entries = []
    try:
        with os.scandir(folder) as it:
            for e in it:
                if e.name.startswith("."):      # les .part sont des envois en cours
                    continue
                try:
                    st = e.stat()
                    isdir = e.is_dir()
                    entries.append({"n": e.name, "d": isdir, "s": 0 if isdir else st.st_size, "m": int(st.st_mtime)})
                except OSError:
                    pass
    except OSError:
        raise ValueError("lecture impossible")
    entries.sort(key=lambda x: (not x["d"], x["n"].lower()))
    root = share_root()
    rel = os.path.relpath(folder, root).replace("\\", "/")
    return {"path": "" if rel == "." else rel, "root": root, "max_upload": MAX_UPLOAD,
            "entries": entries[:500], "more": len(entries) > 500}


PC["files"] = act_files


# ---------------------------------------------------------------- signatures (connexion directe)
# Une requête signée porte ses propres paramètres : ?...&t=<heure ms>&n=<aléa>&s=<signature>
# s = HMAC-SHA256(token, METHODE + "." + adresse sans le &s=...). Le token ne voyage jamais.

SEEN = {}
SEEN_LOCK = threading.Lock()


def sign(method, signed_target):
    return hmac.new(TOKEN.encode(), (method + "." + signed_target).encode(), hashlib.sha256).hexdigest()


def check_signed(method, target, is_download):
    """Renvoie None si la signature est bonne, sinon (type, message)."""
    i = target.rfind("&s=")
    if i < 0:
        return "bad", "signature manquante"
    signed, sig = target[:i], target[i + 3:]
    q = parse_qs(urlparse(signed).query)
    try:
        t, n = int(q["t"][0]), q["n"][0]
    except (KeyError, IndexError, ValueError):
        return "bad", "signature invalide"
    now = time.time() * 1000
    if abs(now - t) > (600000 if is_download else 60000):
        return "stale", "heure trop différente"
    if not (8 <= len(n) <= 64) or not hmac.compare_digest(sign(method, signed), sig):
        return "bad", "signature invalide"
    if not is_download:   # un envoi ne peut servir qu'une fois (un lien de téléchargement peut reprendre)
        with SEEN_LOCK:
            for k in [k for k, v in SEEN.items() if now - v > 180000]:
                del SEEN[k]
            if n in SEEN:
                return "bad", "requête déjà utilisée"
            SEEN[n] = now
    return None


def lan_addresses():
    ips = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))     # aucun paquet n'est envoyé
            ips.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith(("127.", "169.254.", "0.")))


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
    lan_only = False   # True sur le serveur réseau local : seules les requêtes signées passent

    def log_message(self, *a):
        pass

    def _cors(self):
        o = self.headers.get("Origin")
        if o and o in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Access-Control-Allow-Headers", "X-Token, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Vary", "Origin")

    def _send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _origin_ok(self):
        origin = self.headers.get("Origin")
        if origin and origin not in ORIGINS:
            log("origine refusée: " + origin)
            self._send(403, {"error": "origine refusée"})
            return False
        return True

    def _auth(self, method, is_download=False):
        """None si l'accès est autorisé, sinon (code HTTP, réponse)."""
        now = time.time()
        if now < state["until"]:
            return 429, {"error": "verrouillé, réessaie plus tard"}

        hdr = self.headers.get("X-Token")
        if hdr is not None and not self.lan_only:
            err = None if hmac.compare_digest(hdr.encode(), TOKEN.encode()) else ("bad", "token invalide")
        else:
            err = check_signed(method, self.path, is_download)
        if err is None:
            state["fails"] = 0
            return None

        kind, msg = err
        if kind == "stale":
            return 400, {"error": msg, "stale": True}
        state["fails"] += 1
        log("accès refusé (%d/%d) : %s" % (state["fails"], MAX_FAILS, msg))
        note("Accès refusé" + (" (réseau local)" if self.lan_only else ""), bad=True)
        if state["fails"] >= MAX_FAILS:
            state["until"] = now + LOCK_SECONDS
            state["fails"] = 0
            log("verrouillage 15 min")
            note("Accès bloqué 15 min", bad=True)
        return 401, {"error": "token invalide" if msg == "token invalide" else "signature invalide"}

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if not self._origin_ok():
            return
        path = urlparse(self.path).path
        if path == "/time":     # sert à caler l'horloge du téléphone et à reconnaître l'agent
            return self._send(200, {"t": int(time.time() * 1000), "app": "wakeup-pc", "mode": MODE})
        if path == "/dl" and MODE == "pc":
            denied = self._auth("GET", is_download=True)
            if denied:
                return self._send(*denied)
            return self._download(parse_qs(urlparse(self.path).query))
        self._send(404, {"error": "introuvable"})

    def _download(self, q):
        try:
            p = safe_path((q.get("path") or [""])[0])
            if not os.path.isfile(p):
                raise ValueError("fichier introuvable")
        except ValueError as e:
            return self._send(404, {"error": str(e)})

        size = os.path.getsize(p)
        start, end, code = 0, size - 1, 200
        m = re.match(r"bytes=(\d*)-(\d*)$", (self.headers.get("Range") or "").strip())
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
            else:
                start, end = max(0, size - int(m.group(2))), size - 1
            if start > end or start >= size:
                self.send_response(416)
                self.send_header("Content-Range", "bytes */%d" % size)
                self.end_headers()
                return
            code = 206

        name = os.path.basename(p)
        self.send_response(code)
        self.send_header("Content-Type", mimetypes.guess_type(name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(max(0, end - start + 1)))
        self.send_header("Accept-Ranges", "bytes")
        if code == 206:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        ascii_name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
        self.send_header("Content-Disposition", "attachment; filename=\"%s\"; filename*=UTF-8''%s" % (ascii_name, quote(name)))
        self.end_headers()
        if start == 0:
            note("Fichier envoyé : %s (%s)" % (name[:50], human(size)))
        try:
            with open(p, "rb") as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(65536, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except OSError:
            pass   # le téléphone a coupé : rien à faire

    def do_PUT(self):
        if not self._origin_ok():
            return
        u = urlparse(self.path)
        if u.path != "/upload" or MODE != "pc":
            return self._send(404, {"error": "introuvable"})
        denied = self._auth("PUT")
        if denied:
            return self._send(*denied)

        q = parse_qs(u.query)
        try:
            size = int(self.headers.get("Content-Length") or -1)
        except ValueError:
            size = -1
        if size <= 0:
            return self._send(400, {"error": "fichier vide ou taille manquante"})
        if size > MAX_UPLOAD:
            return self._send(413, {"error": "fichier trop gros (max %s)" % human(MAX_UPLOAD)})
        try:
            folder = safe_path((q.get("dir") or [""])[0])
            if not os.path.isdir(folder):
                raise ValueError("dossier introuvable")
            if shutil.disk_usage(folder).free < size + 100 * 1024 * 1024:
                raise ValueError("pas assez de place sur le PC")
        except ValueError as e:
            return self._send(400, {"error": str(e)})

        name = clean_name((q.get("name") or ["fichier"])[0])
        tmp = os.path.join(folder, ".upload-%s.part" % secrets.token_hex(6))
        try:
            self.connection.settimeout(60)
            left = size
            with open(tmp, "wb") as f:
                while left > 0:
                    chunk = self.rfile.read(min(65536, left))
                    if not chunk:
                        raise OSError("connexion interrompue")
                    f.write(chunk)
                    left -= len(chunk)
            final = unique_path(folder, name)
            os.replace(tmp, final)
        except Exception as e:
            log("réception interrompue: " + repr(e))
            try:
                os.remove(tmp)
            except OSError:
                pass
            return self._send(500, {"error": "réception interrompue"})
        got = os.path.basename(final)
        note("Fichier reçu : %s (%s)" % (got[:50], human(size)))
        self._send(200, {"ok": True, "name": got, "size": size})

    def do_POST(self):
        if not self._origin_ok():
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n > MAX_BODY:
            return self._send(413, {"error": "message trop gros"})
        raw = self.rfile.read(n) if n else b""

        denied = self._auth("POST")
        if denied:
            return self._send(*denied)

        try:
            body = json.loads(raw) if raw else {}
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            return self._send(400, {"error": "message invalide"})

        action = urlparse(self.path).path.strip("/")
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
        if action not in ("info", "apps", "files"):
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


class HL(H):
    lan_only = True


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
    if MODE == "pc":
        log("Dossier de partage : " + share_root())
    if LAN:
        try:
            lan = ThreadingHTTPServer((LAN_BIND, LAN_PORT), HL)
        except OSError as e:
            sys.exit("Impossible d'ouvrir le port %d : %s" % (LAN_PORT, e))
        threading.Thread(target=lan.serve_forever, daemon=True).start()
        ips = lan_addresses()
        for ip in ips:
            log("Connexion directe : http://%s:%d" % (ip, LAN_PORT))
        if not ips:
            log("Connexion directe active sur le port %d (adresse : tape ipconfig)" % LAN_PORT)
        log("Si Windows demande d'autoriser Python dans le pare-feu, accepte pour les réseaux privés.")
    ThreadingHTTPServer((BIND, PORT), H).serve_forever()
