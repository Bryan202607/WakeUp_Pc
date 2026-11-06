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

Fichiers et dossiers : le dossier SHARE_DIR (par défaut ~/WakeUp-Pc) est le seul accessible
depuis le téléphone, dans les deux sens. Pour en partager plusieurs, sépare-les par un
point-virgule : SHARE_DIR=C:\\Users\\Moi\\Documents;D:\\Photos

Pour "Ouvrir une appli" : crée un fichier apps.json à côté de agent.py, par exemple
    {"YouTube": "https://youtube.com", "Bloc-notes": "notepad.exe"}
Seules les applis de cette liste peuvent être lancées depuis le téléphone.
"""
import os, re, sys, json, time, hmac, ctypes, base64, shlex, shutil, socket, hashlib, platform
import csv, struct, zlib, secrets, tempfile, zipfile, ipaddress, threading, subprocess, mimetypes, webbrowser
import urllib.parse, urllib.request
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
MAX_ZIP = int(os.environ.get("MAX_ZIP_MB", "2048")) * 1024 * 1024   # taille max d'un dossier téléchargé en zip
MAX_UNZIP = MAX_UPLOAD * 4                                          # taille max d'un zip une fois extrait
MAX_FILES = 20000
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
    d["awake_until"] = awake_until()
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


_ROOTS = None


def share_roots():
    """Dossiers partagés : liste de (nom affiché, chemin réel). SHARE_DIR peut en contenir plusieurs, séparés par ;"""
    global _ROOTS
    if _ROOTS is None:
        default = os.path.join(os.path.expanduser("~"), "WakeUp-Pc")
        roots, used = [], set()
        for p in [x.strip() for x in SHARE_DIR.split(";") if x.strip()] or [default]:
            real = os.path.realpath(os.path.expanduser(p))
            os.makedirs(real, exist_ok=True)
            base = clean_name(os.path.basename(real.rstrip("\\/")) or "Disque")
            name, i = base, 2
            while name.lower() in used:
                name, i = "%s (%d)" % (base, i), i + 1
            used.add(name.lower())
            roots.append((name, real))
        _ROOTS = roots
    return _ROOTS


def resolve(rel):
    """(dossier partagé, chemin réel). (None, None) veut dire : la liste des dossiers partagés."""
    roots = share_roots()
    parts = [p for p in str(rel or "").replace("\\", "/").split("/") if p not in ("", ".")]
    if ".." in parts or any(":" in p for p in parts):
        raise ValueError("chemin interdit")
    if len(roots) == 1:
        root, sub = roots[0][1], parts
    else:
        if not parts:
            return None, None
        match = [r for n, r in roots if n.lower() == parts[0].lower()]
        if not match:
            raise ValueError("chemin interdit")
        root, sub = match[0], parts[1:]
    p = os.path.realpath(os.path.join(root, *sub))
    try:
        ok = os.path.commonpath([root, p]) == root
    except ValueError:
        ok = False
    if not ok:
        raise ValueError("chemin interdit")
    return root, p


def safe_path(rel):
    """Chemin à l'intérieur d'un dossier partagé, jamais en dehors."""
    root, p = resolve(rel)
    if p is None:
        raise ValueError("choisis d'abord un dossier partagé")
    return p


def disposition(name):
    ascii_name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    return "attachment; filename=\"%s\"; filename*=UTF-8''%s" % (ascii_name, quote(name))


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
    root, folder = resolve(body.get("path", ""))
    roots = share_roots()
    if root is None:      # plusieurs dossiers partagés : on affiche la liste de départ
        entries = []
        for n, r in roots:
            try:
                m = int(os.path.getmtime(r))
            except OSError:
                m = 0
            entries.append({"n": n, "d": True, "s": 0, "m": m})
        return {"path": "", "virtual": True, "root": " ; ".join(r for _, r in roots),
                "max_upload": MAX_UPLOAD, "entries": entries, "more": False}

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
    rel = os.path.relpath(folder, root).replace("\\", "/")
    rel = "" if rel == "." else rel
    if len(roots) > 1:
        rel = [n for n, r in roots if r == root][0] + ("/" + rel if rel else "")
    return {"path": rel, "root": root, "max_upload": MAX_UPLOAD,
            "entries": entries[:500], "more": len(entries) > 500}


def act_mkdir(body):
    parent = safe_path(body.get("path", ""))
    if not os.path.isdir(parent):
        raise ValueError("dossier introuvable")
    if not str(body.get("name", "")).strip():
        raise ValueError("nom vide")
    name = clean_name(body.get("name"))
    target = os.path.join(parent, name)
    if os.path.exists(target):
        raise ValueError("ce nom existe déjà")
    os.mkdir(target)
    note("Dossier créé : " + name[:50])
    return {"name": name}


def make_zip(folder):
    """Zip temporaire d'un dossier : sans fichiers cachés, sans liens, avec une taille maximale."""
    files, total = [], 0
    top = os.path.basename(folder.rstrip("\\/")) or "dossier"
    for dirpath, dirnames, filenames in os.walk(folder):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for f in filenames:
            full = os.path.join(dirpath, f)
            if f.startswith(".") or os.path.islink(full):
                continue
            try:
                total += os.path.getsize(full)
            except OSError:
                continue
            if total > MAX_ZIP:
                raise ValueError("dossier trop gros pour un zip (max %s)" % human(MAX_ZIP))
            files.append(full)
            if len(files) > MAX_FILES:
                raise ValueError("trop de fichiers dans ce dossier (max %d)" % MAX_FILES)
    if not files:
        raise ValueError("le dossier est vide")
    fd, tmp = tempfile.mkstemp(suffix=".zip", prefix="wakeup-")
    os.close(fd)
    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as z:
            for full in files:
                try:
                    z.write(full, os.path.join(top, os.path.relpath(full, folder)))
                except OSError:
                    pass    # fichier verrouillé ou disparu : on le saute
    except Exception:
        os.remove(tmp)
        raise
    return tmp


def extract_zip(zip_path, parent, folder_name):
    """Extrait un zip reçu dans un nouveau dossier. Noms nettoyés, taille et nombre limités.
    Si le zip contient déjà un seul dossier (ex. Projet/...), on s'en sert comme dossier de destination."""
    out = None
    total = count = 0
    try:
        with zipfile.ZipFile(zip_path) as z:
            infos = z.infolist()
            if len(infos) > MAX_FILES:
                raise ValueError("trop de fichiers dans le zip (max %d)" % MAX_FILES)
            items = []
            for info in infos:
                parts = [clean_name(p) for p in info.filename.replace("\\", "/").split("/") if p not in ("", ".", "..")]
                if parts:
                    items.append((info, parts))
            firsts = {p[0] for _, p in items}
            if len(firsts) == 1 and all(len(p) > 1 or i.is_dir() for i, p in items):
                folder_name = next(iter(firsts))                       # le zip contient déjà son dossier
                items = [(i, p[1:]) for i, p in items if len(p) > 1]

            out = unique_path(parent, clean_name(folder_name))
            os.makedirs(out)
            real_out = os.path.realpath(out)
            for info, parts in items:
                dst = os.path.join(out, *parts)
                if os.path.commonpath([real_out, os.path.realpath(dst)]) != real_out:
                    continue
                if info.is_dir():
                    os.makedirs(dst, exist_ok=True)
                    continue
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                with z.open(info) as src, open(dst, "wb") as f:
                    while True:
                        chunk = src.read(65536)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > MAX_UNZIP:
                            raise ValueError("zip trop gros une fois extrait (max %s)" % human(MAX_UNZIP))
                        f.write(chunk)
                count += 1
    except (zipfile.BadZipFile, NotImplementedError):
        if out:
            shutil.rmtree(out, ignore_errors=True)
        raise ValueError("zip illisible")
    except RuntimeError:
        if out:
            shutil.rmtree(out, ignore_errors=True)
        raise ValueError("zip protégé par un mot de passe")
    except Exception:
        if out:
            shutil.rmtree(out, ignore_errors=True)
        raise
    return os.path.basename(out), count, total


PC["files"] = act_files
PC["mkdir"] = act_mkdir


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


# ---------------------------------------------------------------- souris, clavier, capture d'écran (Windows)

NOWIN = {"creationflags": 0x08000000} if IS_WIN else {}   # pas de fenêtre noire pour les commandes lancées


def need_win():
    if not IS_WIN:
        raise ValueError("disponible sur Windows seulement")


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", ctypes.c_int32), ("dy", ctypes.c_int32), ("data", ctypes.c_uint32),
                ("flags", ctypes.c_uint32), ("time", ctypes.c_uint32), ("extra", ctypes.c_size_t)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("vk", ctypes.c_uint16), ("scan", ctypes.c_uint16), ("flags", ctypes.c_uint32),
                ("time", ctypes.c_uint32), ("extra", ctypes.c_size_t)]


class _IU(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", ctypes.c_uint32), ("u", _IU)]


KEYS = {"enter": 0x0D, "backspace": 0x08, "tab": 0x09, "esc": 0x1B, "delete": 0x2E, "space": 0x20,
        "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28, "home": 0x24, "end": 0x23,
        "pageup": 0x21, "pagedown": 0x22, "win": 0x5B, "ctrl": 0x11, "shift": 0x10, "alt": 0x12}
KEYS.update({"f%d" % i: 0x6F + i for i in range(1, 13)})
KEYS.update({"insert": 0x2D, "prtsc": 0x2C, "capslock": 0x14})
EXTENDED = {0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B}   # touches "étendues" de Windows


def vk_of(name):
    n = str(name).lower()
    if n in KEYS:
        return KEYS[n]
    if len(n) == 1 and n.isascii() and n.isalnum():
        return ord(n.upper())
    raise ValueError("touche inconnue : " + n[:10])


def kbd(vk=0, scan=0, flags=0):
    return INPUT(1, _IU(ki=KEYBDINPUT(vk, scan, flags, 0, 0)))


def tap_vk(vk):
    ext = 0x0001 if vk in EXTENDED else 0
    return [kbd(vk, 0, ext), kbd(vk, 0, ext | 0x0002)]


def send_inputs(items):
    for i in range(0, len(items), 200):
        part = items[i:i + 200]
        arr = (INPUT * len(part))(*part)
        if ctypes.windll.user32.SendInput(len(part), ctypes.byref(arr), ctypes.sizeof(INPUT)) != len(part):
            raise ValueError("Windows a refusé la saisie")


def act_key(body):
    need_win()
    STREAM["hot"] = time.time() + 2.0
    items = []
    if "text" in body:
        for ch in str(body["text"])[:500]:
            if ch == "\n":
                items += tap_vk(0x0D)
            elif ch == "\t":
                items += tap_vk(0x09)
            elif ch != "\r":
                raw = ch.encode("utf-16-le")        # une lettre peut valoir 2 unités (emoji)
                for k in range(0, len(raw), 2):
                    unit = int.from_bytes(raw[k:k + 2], "little")
                    items += [kbd(0, unit, 0x0004), kbd(0, unit, 0x0006)]   # UNICODE, puis UNICODE | KEYUP
    elif "combo" in body:                              # ex. ["ctrl", "c"]
        vks = [vk_of(k) for k in list(body["combo"])[:4]]
        if not vks:
            raise ValueError("combinaison vide")
        items += [kbd(v, 0, 0x0001 if v in EXTENDED else 0) for v in vks]
        items += [kbd(v, 0, (0x0001 if v in EXTENDED else 0) | 0x0002) for v in reversed(vks)]
    elif "key" in body:
        vk, n = vk_of(body["key"]), max(1, min(20, int(body.get("n", 1))))
        for _ in range(n):
            items += tap_vk(vk)
    else:
        raise ValueError("rien à saisir")
    send_inputs(items)
    return {}


MOUSE_BTN = {"left": (0x0002, 0x0004), "right": (0x0008, 0x0010), "middle": (0x0020, 0x0040)}


def act_mouse(body):
    need_win()
    STREAM["hot"] = time.time() + 2.0
    try:
        dx, dy, sc, hs, zm = (int(float(body.get(k, 0))) for k in ("dx", "dy", "scroll", "hscroll", "zoom"))
    except (TypeError, ValueError):
        raise ValueError("valeur invalide")
    u = ctypes.windll.user32
    if dx or dy:
        u.mouse_event(0x0001, max(-3000, min(3000, dx)), max(-3000, min(3000, dy)), 0, 0)   # déplacement relatif
    if sc:
        u.mouse_event(0x0800, 0, 0, -max(-50, min(50, sc)) * 120, 0)                          # molette (+ = vers le bas)
    if hs:
        u.mouse_event(0x01000, 0, 0, max(-50, min(50, hs)) * 120, 0)                          # molette horizontale (+ = vers la droite)
    if zm:                                                                                    # zoom : Ctrl + molette (+ = agrandir)
        u.keybd_event(0x11, 0, 0, 0)
        u.mouse_event(0x0800, 0, 0, max(-20, min(20, zm)) * 120, 0)
        u.keybd_event(0x11, 0, 2, 0)
    btn = body.get("btn")
    if btn:
        if btn not in MOUSE_BTN:
            raise ValueError("bouton inconnu")
        down, up = MOUSE_BTN[btn]
        act = body.get("act", "click")
        if act == "down":
            u.mouse_event(down, 0, 0, 0, 0)
        elif act == "up":
            u.mouse_event(up, 0, 0, 0, 0)
        elif act in ("click", "double"):
            for _ in range(2 if act == "double" else 1):
                u.mouse_event(down, 0, 0, 0, 0)
                u.mouse_event(up, 0, 0, 0, 0)
        else:
            raise ValueError("action inconnue")
    return {}


class BMIH(ctypes.Structure):
    _fields_ = [("size", ctypes.c_uint32), ("w", ctypes.c_int32), ("h", ctypes.c_int32), ("planes", ctypes.c_uint16),
                ("bits", ctypes.c_uint16), ("comp", ctypes.c_uint32), ("img", ctypes.c_uint32), ("xppm", ctypes.c_int32),
                ("yppm", ctypes.c_int32), ("used", ctypes.c_uint32), ("imp", ctypes.c_uint32)]


def png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png_bytes(rgb, w, h):
    """Image PNG à partir de pixels RGB (sans aucune bibliothèque, juste zlib)."""
    stride = w * 3
    raw = b"".join(b"\x00" + rgb[y * stride:(y + 1) * stride] for y in range(h))
    return (b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + png_chunk(b"IDAT", zlib.compress(raw, 3)) + png_chunk(b"IEND", b""))


# PNG à 256 couleurs fixes (3 bits rouge, 3 bits vert, 2 bits bleu) : 3 fois moins de données et bien plus rapide,
# c'est ce qui permet de tenir une vidéo fluide sans aucune bibliothèque.
_T_R = bytes(v & 0xE0 for v in range(256))
_T_G = bytes((v & 0xE0) >> 3 for v in range(256))
_T_B = bytes(v >> 6 for v in range(256))
_PLTE = b"".join(bytes((round(255 * ((i >> 5) & 7) / 7), round(255 * ((i >> 2) & 7) / 7), round(255 * (i & 3) / 3))) for i in range(256))


def png_indexed(bgra, w, h):
    n = w * h
    plane = (int.from_bytes(bgra[2::4].translate(_T_R), "little") | int.from_bytes(bgra[1::4].translate(_T_G), "little")
             | int.from_bytes(bgra[0::4].translate(_T_B), "little")).to_bytes(n, "little")   # additions de gros entiers : très rapide
    raw = b"".join(b"\x00" + plane[y * w:(y + 1) * w] for y in range(h))
    return (b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 3, 0, 0, 0))
            + png_chunk(b"PLTE", _PLTE) + png_chunk(b"IDAT", zlib.compress(raw, 1)) + png_chunk(b"IEND", b""))


# flèche de la souris, dessinée sur l'image (la capture Windows ne la contient pas)
CURSOR_ART = [
    "X           ", "XX          ", "X.X         ", "X..X        ", "X...X       ", "X....X      ", "X.....X     ",
    "X......X    ", "X.......X   ", "X........X  ", "X.....XXXXX ", "X..X..X     ", "X.X X..X    ", "XX  X..X    ",
    "X    X..X   ", "     X..X   ", "      X..X  ", "      X..X  ", "       XX   ",
]


def draw_cursor(buf, tw, th, cx, cy):
    """Dessine la flèche dans une image BGRA (buf accepte l'assignation de tranches)."""
    k = max(1, tw // 700)
    stride = tw * 4
    for y, row in enumerate(CURSOR_ART):
        for x, ch in enumerate(row):
            if ch == " ":
                continue
            col = b"\xff\xff\xff\xff" if ch == "." else b"\x00\x00\x00\xff"
            for dy in range(k):
                py = cy + y * k + dy
                if py >= th:
                    break
                for dx in range(k):
                    px = cx + x * k + dx
                    if px < tw:
                        o = py * stride + px * 4
                        buf[o:o + 4] = col


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_int32), ("y", ctypes.c_int32)]


_gdi_ready = False


def grab_raw(max_w, fast=False, cursor=False):
    """Capture l'écran principal réduit à max_w de large. Renvoie (pixels BGRA, largeur, hauteur)."""
    global _gdi_ready
    need_win()
    u, g = ctypes.windll.user32, ctypes.windll.gdi32
    P, I = ctypes.c_void_p, ctypes.c_int
    if not _gdi_ready:
        u.GetDC.argtypes, u.GetDC.restype = [P], P
        u.ReleaseDC.argtypes = [P, P]
        g.CreateCompatibleDC.argtypes, g.CreateCompatibleDC.restype = [P], P
        g.CreateCompatibleBitmap.argtypes, g.CreateCompatibleBitmap.restype = [P, I, I], P
        g.SelectObject.argtypes, g.SelectObject.restype = [P, P], P
        g.SetStretchBltMode.argtypes = [P, I]
        g.StretchBlt.argtypes = [P, I, I, I, I, P, I, I, I, I, ctypes.c_uint32]
        g.GetDIBits.argtypes = [P, P, ctypes.c_uint, ctypes.c_uint, P, P, ctypes.c_uint]
        g.DeleteObject.argtypes = [P]
        g.DeleteDC.argtypes = [P]
        try:
            u.SetProcessDPIAware()      # sinon Windows ne renvoie qu'une partie de l'écran quand il est agrandi (125 %...)
        except Exception:
            pass
        _gdi_ready = True
    sw, sh = u.GetSystemMetrics(0), u.GetSystemMetrics(1)
    if sw <= 0 or sh <= 0:
        raise ValueError("écran introuvable")
    tw = min(sw, max_w)
    th = max(1, round(sh * tw / sw))
    hs = u.GetDC(None)
    hm = g.CreateCompatibleDC(hs)
    hb = g.CreateCompatibleBitmap(hs, tw, th)
    try:
        old = g.SelectObject(hm, hb)
        g.SetStretchBltMode(hm, 3 if fast else 4)                    # 3 = rapide, 4 = HALFTONE (meilleure qualité)
        if not g.StretchBlt(hm, 0, 0, tw, th, hs, 0, 0, sw, sh, 0x40CC0020):   # SRCCOPY | CAPTUREBLT
            raise ValueError("capture refusée (écran verrouillé ?)")
        g.SelectObject(hm, old)
        bmi = BMIH()
        bmi.size, bmi.w, bmi.h, bmi.planes, bmi.bits = ctypes.sizeof(BMIH), tw, -th, 1, 32   # hauteur < 0 : de haut en bas
        buf = ctypes.create_string_buffer(tw * th * 4)
        if g.GetDIBits(hm, hb, 0, th, buf, ctypes.byref(bmi), 0) == 0:
            raise ValueError("lecture de l'image impossible")
    finally:
        g.DeleteObject(hb)
        g.DeleteDC(hm)
        u.ReleaseDC(None, hs)
    if cursor:
        pt = POINT()
        if u.GetCursorPos(ctypes.byref(pt)):
            draw_cursor(buf, tw, th, pt.x * tw // sw, pt.y * th // sh)
    return buf.raw, tw, th


def grab_png(max_w):
    bgra, tw, th = grab_raw(max_w)
    rgb = bytearray(tw * th * 3)
    rgb[0::3], rgb[1::3], rgb[2::3] = bgra[2::4], bgra[1::4], bgra[0::4]      # BGRA -> RGB
    return png_bytes(bytes(rgb), tw, th)


# ---- vidéo de l'écran : flux d'images PNG dont le rythme s'adapte (de 3 à 60 images par seconde)
STREAM = {"gen": 0, "fps": 0.0, "w": 0, "kb": 0.0, "hot": 0.0}
STREAM_LOCK = threading.Lock()


def act_streaminfo(body):
    return {"fps": round(STREAM["fps"], 1), "w": STREAM["w"], "kb": round(STREAM["kb"])}


# ---------------------------------------------------------------- veille, programmes, presse-papiers

awake = {"until": None, "stop": None}


def awake_until():
    if awake["until"] and time.time() > awake["until"]:
        awake["until"] = None
    return awake["until"]


def act_awake(body):
    need_win()
    try:
        m = int(body.get("minutes", 0))
    except (TypeError, ValueError):
        m = -1
    if not 0 <= m <= 720:
        raise ValueError("durée entre 0 et 720 minutes")
    if awake["stop"]:
        awake["stop"].set()
    if m == 0:
        awake.update(until=None, stop=None)
        note("Veille autorisée à nouveau")
        return {"awake_until": None}
    stop = threading.Event()

    def hold():     # l'état "éveillé" appartient au thread : il doit rester vivant pendant la durée
        k = ctypes.windll.kernel32
        k.SetThreadExecutionState(ctypes.c_uint32(0x80000001))   # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
        stop.wait(m * 60)
        k.SetThreadExecutionState(ctypes.c_uint32(0x80000000))   # ES_CONTINUOUS seul : on rend la main

    threading.Thread(target=hold, daemon=True).start()
    awake.update(until=int(time.time()) + m * 60, stop=stop)
    note("PC gardé éveillé %d min" % m)
    return {"awake_until": awake["until"]}


# programmes qu'on ne peut pas fermer depuis le téléphone (système, agent, Tailscale)
PROTECTED = {"system", "system idle process", "registry", "smss.exe", "csrss.exe", "wininit.exe", "winlogon.exe",
             "services.exe", "lsass.exe", "svchost.exe", "dwm.exe", "fontdrvhost.exe", "explorer.exe", "conhost.exe",
             "python.exe", "pythonw.exe", "python3", "python", "tailscaled.exe", "tailscale-ipn.exe", "tailscale.exe",
             "memory compression", "securityhealthservice.exe", "systemd", "init", "sshd"}


def act_procs(body):
    groups = {}
    if IS_WIN:
        out = subprocess.run(["tasklist", "/fo", "csv", "/nh"], capture_output=True, timeout=20, **NOWIN).stdout
        for r in csv.reader(out.decode("utf-8", "replace").splitlines()):
            if len(r) >= 5:
                rows = [(r[0], int("".join(c for c in r[4] if c.isdigit()) or 0))]
                groups_add(groups, rows)
    else:
        out = subprocess.run(["ps", "-eo", "rss=,comm="], capture_output=True, timeout=20).stdout.decode("utf-8", "replace")
        for line in out.splitlines():
            parts = line.strip().split(None, 1)
            if len(parts) == 2 and parts[0].isdigit():
                groups_add(groups, [(parts[1], int(parts[0]))])
    items = sorted(groups.values(), key=lambda x: -x["m"])[:40]
    for it in items:
        it["p"] = it["n"].lower() in PROTECTED
    return {"procs": items}


def groups_add(groups, rows):
    for name, mem in rows:
        g = groups.setdefault(name.lower(), {"n": name, "c": 0, "m": 0})
        g["c"] += 1
        g["m"] += mem          # en Ko


def act_kill(body):
    name = str(body.get("name", "")).strip()
    if not re.fullmatch(r"[\w .+()\-]{1,80}", name):
        raise ValueError("nom invalide")
    if name.lower() in PROTECTED:
        raise ValueError("programme protégé")
    r = subprocess.run(["taskkill", "/F", "/IM", name] if IS_WIN else ["pkill", "-x", name],
                       capture_output=True, timeout=20, **NOWIN)
    if r.returncode != 0:
        raise ValueError("introuvable ou refusé")
    note("Programme fermé : " + name[:40])
    return {}


def pc_locked():
    """True si l'écran est verrouillé (ou si une demande UAC est affichée) : Windows refuse alors l'accès au bureau."""
    if not IS_WIN:
        return False
    try:
        u = ctypes.windll.user32
        u.OpenInputDesktop.restype = ctypes.c_void_p
        u.OpenInputDesktop.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
        u.CloseDesktop.argtypes = [ctypes.c_void_p]
        h = u.OpenInputDesktop(0, False, 0x0100)
        if not h:
            return True
        u.CloseDesktop(h)
        return False
    except Exception:
        return False


UNLOCK_PORT = int(os.environ.get("UNLOCK_PORT", "8767"))


def act_unlock(body):
    need_win()
    code = str(body.get("code", ""))
    if not code or len(code) > 100:
        raise ValueError("code de déverrouillage manquant")
    if not pc_locked():
        raise ValueError("le PC n'est pas verrouillé")
    req = urllib.request.Request("http://127.0.0.1:%d/unlock" % UNLOCK_PORT, data=json.dumps({"code": code}).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=50) as r:
            json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("error")
        except Exception:
            msg = None
        if e.code == 403:
            note("Code de déverrouillage refusé", bad=True)
        raise ValueError(msg or "déverrouillage refusé")
    except OSError:
        raise ValueError("le déverrouillage n'est pas installé sur le PC (voir le guide)")
    note("PC déverrouillé à distance")
    return {}


def act_clipget(body):
    if IS_WIN:
        u, k = ctypes.windll.user32, ctypes.windll.kernel32
        u.OpenClipboard.argtypes = [ctypes.c_void_p]
        u.GetClipboardData.argtypes, u.GetClipboardData.restype = [ctypes.c_uint], ctypes.c_void_p
        k.GlobalLock.argtypes, k.GlobalLock.restype = [ctypes.c_void_p], ctypes.c_void_p
        k.GlobalUnlock.argtypes = [ctypes.c_void_p]
        for _ in range(10):
            if u.OpenClipboard(None):
                break
            time.sleep(0.05)
        else:
            raise ValueError("presse-papiers occupé, réessaie")
        try:
            h = u.GetClipboardData(13)          # CF_UNICODETEXT
            text = ""
            if h:
                p = k.GlobalLock(h)
                try:
                    text = ctypes.wstring_at(p) if p else ""
                finally:
                    k.GlobalUnlock(h)
        finally:
            u.CloseClipboard()
    else:
        tool = ["wl-paste", "--no-newline"] if shutil.which("wl-paste") else ["xclip", "-selection", "clipboard", "-o"]
        if not shutil.which(tool[0]):
            raise ValueError("installe xclip ou wl-clipboard sur le PC")
        text = subprocess.run(tool, capture_output=True, timeout=10).stdout.decode("utf-8", "replace")
    note("Presse-papiers du PC lu")
    return {"text": text[:5000], "truncated": len(text) > 5000}


# ---------------------------------------------------------------- téléchargement à distance

ALLOW_LAN_DOWNLOAD = os.environ.get("ALLOW_LAN_DOWNLOAD", "").lower() in ("1", "true", "oui", "yes")
MAX_DOWNLOAD = MAX_UPLOAD * 4
DL = {}
DL_LOCK = threading.Lock()


def check_url(url):
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname or len(url) > 2000 \
            or any(c.isspace() or ord(c) < 32 for c in url):
        raise ValueError("adresse invalide (http ou https)")
    if ALLOW_LAN_DOWNLOAD:
        return
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except OSError:
        raise ValueError("adresse introuvable")
    for info in infos:
        if not ipaddress.ip_address(info[4][0].split("%")[0]).is_global:
            raise ValueError("adresse du réseau local interdite (ALLOW_LAN_DOWNLOAD=1 pour l'autoriser)")


class CheckedRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)          # une redirection ne doit pas mener vers le réseau local
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = urllib.request.build_opener(CheckedRedirect())


def guess_name(url, headers):
    cd = headers.get("Content-Disposition") or ""
    m = re.search(r"filename\*=UTF-8''([^;]+)", cd, re.I) or re.search(r'filename="?([^";]+)"?', cd, re.I)
    if m:
        return urllib.parse.unquote(m.group(1))
    return urllib.parse.unquote(os.path.basename(urlparse(url).path)) or "telechargement"


def dl_worker(job, url, folder, forced):
    tmp = os.path.join(folder, ".dl-%s.part" % job["id"])
    try:
        with OPENER.open(urllib.request.Request(url, headers={"User-Agent": "WakeUp-Pc"}), timeout=30) as r:
            total = int(r.headers.get("Content-Length") or 0)
            if total > MAX_DOWNLOAD:
                raise ValueError("fichier trop gros (max %s)" % human(MAX_DOWNLOAD))
            if shutil.disk_usage(folder).free < total + 100 * 1024 * 1024:
                raise ValueError("pas assez de place sur le PC")
            name = clean_name(forced or guess_name(url, r.headers))
            job.update(name=name, total=total)
            got = 0
            with open(tmp, "wb") as f:
                while True:
                    if job["cancel"]:
                        raise ValueError("annulé")
                    chunk = r.read(65536)
                    if not chunk:
                        break
                    got += len(chunk)
                    if got > MAX_DOWNLOAD:
                        raise ValueError("fichier trop gros (max %s)" % human(MAX_DOWNLOAD))
                    f.write(chunk)
                    job["got"] = got
        final = unique_path(folder, name)
        os.replace(tmp, final)
        job.update(state="ok", name=os.path.basename(final), total=got)
        note("Téléchargé : %s (%s)" % (job["name"][:50], human(got)))
    except Exception as e:
        job.update(state="err", error=str(e) if isinstance(e, ValueError) else "échec du téléchargement")
        try:
            os.remove(tmp)
        except OSError:
            pass
        note("Téléchargement échoué : " + job["error"][:60], bad=True)


def act_dl_start(body):
    url = str(body.get("url", "")).strip()
    check_url(url)
    root, folder = resolve(body.get("dir", ""))
    if folder is None:
        folder = share_roots()[0][1]          # plusieurs dossiers partagés : le premier par défaut
    if not os.path.isdir(folder):
        raise ValueError("dossier introuvable")
    with DL_LOCK:
        if sum(1 for j in DL.values() if j["state"] == "run") >= 2:
            raise ValueError("2 téléchargements à la fois, pas plus")
        job = {"id": secrets.token_hex(4), "name": clean_name(str(body.get("name") or "") or guess_name(url, {})),
               "got": 0, "total": 0, "state": "run", "error": "", "cancel": False}
        DL[job["id"]] = job
        while len(DL) > 20:
            old = next((k for k, j in DL.items() if j["state"] != "run"), None)
            if old is None:
                break
            del DL[old]
    note("Téléchargement lancé depuis " + urlparse(url).netloc[:40])
    threading.Thread(target=dl_worker, args=(job, url, folder, str(body.get("name") or "").strip()), daemon=True).start()
    return {"id": job["id"]}


def act_dl_status(body):
    keys = ("id", "name", "got", "total", "state", "error")
    with DL_LOCK:
        return {"jobs": [{k: j[k] for k in keys} for j in list(DL.values())[::-1][:10]]}


def act_dl_cancel(body):
    job = DL.get(str(body.get("id", "")))
    if job:
        job["cancel"] = True
    return {}


# ---------------------------------------------------------------- raccourcis personnalisés

def load_shortcuts():
    try:
        with open(os.path.join(HERE, "shortcuts.json"), encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception as e:
        log("shortcuts.json illisible: " + repr(e))
        return {}


def act_shortcuts(body):
    out = []
    for name, spec in load_shortcuts().items():
        out.append({"n": str(name), "confirm": bool(isinstance(spec, dict) and spec.get("confirm"))})
    return {"shortcuts": out}


def oem_encoding():
    try:
        return "cp%d" % ctypes.windll.kernel32.GetOEMCP()
    except Exception:
        return "utf-8"


def act_run(body):
    name = str(body.get("name", ""))
    shortcuts = load_shortcuts()
    if name not in shortcuts:
        raise ValueError("raccourci non autorisé")
    spec = shortcuts[name]
    opts = spec if isinstance(spec, dict) else {}
    cmd = [spec] if isinstance(spec, str) else spec.get("cmd") if isinstance(spec, dict) else None
    if not cmd or not all(isinstance(c, str) for c in cmd):
        raise ValueError("raccourci mal écrit dans shortcuts.json")
    if not shutil.which(cmd[0]) and not os.path.exists(cmd[0]):
        raise ValueError("programme introuvable : " + cmd[0][:40])
    cwd = os.path.dirname(cmd[0]) if os.path.isfile(cmd[0]) else None
    note("Raccourci : " + name[:40])
    if opts.get("output"):
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=min(int(opts.get("timeout", 30)), 120), cwd=cwd, **NOWIN)
        except subprocess.TimeoutExpired:
            raise ValueError("le raccourci met trop de temps")
        text = (r.stdout + r.stderr).decode(oem_encoding() if IS_WIN else "utf-8", "replace")
        return {"output": text[:4000], "code": r.returncode}
    subprocess.Popen(cmd, cwd=cwd)
    return {}


# ---------------------------------------------------------------- réveil programmé (sur le relais)

SCHED_FILE = os.path.join(HERE, "schedule.json")
SCHED_LOCK = threading.Lock()


def sched_load():
    try:
        with open(SCHED_FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, list) else []
    except (OSError, ValueError):
        return []


def sched_save(items):
    tmp = SCHED_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)
    os.replace(tmp, SCHED_FILE)


def act_sched_list(body):
    with SCHED_LOCK:
        items = sched_load()
    return {"items": items, "now": time.strftime("%H:%M"), "tz": time.strftime("%Z")}


def act_sched_add(body):
    m = re.fullmatch(r"(\d{2}):(\d{2})", str(body.get("time", "")))
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        raise ValueError("heure invalide (HH:MM)")
    days = sorted({int(d) for d in body.get("days", []) if str(d).isdigit() and 0 <= int(d) <= 6})
    with SCHED_LOCK:
        items = sched_load()
        if len(items) >= 20:
            raise ValueError("20 réveils au maximum")
        item = {"id": secrets.token_hex(3), "time": m.group(0), "days": days, "on": True,
                "label": str(body.get("label", ""))[:30]}
        items.append(item)
        sched_save(items)
    log("réveil programmé ajouté : %s %s" % (item["time"], days or "une fois"))
    return {"item": item}


def act_sched_del(body):
    with SCHED_LOCK:
        sched_save([i for i in sched_load() if i.get("id") != body.get("id")])
    return {}


def act_sched_toggle(body):
    with SCHED_LOCK:
        items = sched_load()
        for i in items:
            if i.get("id") == body.get("id"):
                i["on"] = bool(body.get("on"))
        sched_save(items)
    return {}


def act_wake(body):
    log("wake")
    wake(WOL_MAC)
    return {}


def sched_loop():
    """Toutes les 15 secondes : si une heure programmée arrive, on envoie le signal de réveil."""
    last = None
    while True:
        try:
            now = time.localtime()
            key = (now.tm_yday, now.tm_hour, now.tm_min)
            if key != last:
                last = key
                hhmm = "%02d:%02d" % (now.tm_hour, now.tm_min)
                with SCHED_LOCK:
                    items, changed = sched_load(), False
                    for it in items:
                        if it.get("on") and it.get("time") == hhmm and (not it.get("days") or now.tm_wday in it["days"]):
                            log("réveil programmé " + hhmm)
                            wake(WOL_MAC)
                            if not it.get("days"):          # réveil unique : il s'éteint après usage
                                it["on"], changed = False, True
                    if changed:
                        sched_save(items)
        except Exception as e:
            log("réveil programmé : " + repr(e))
        time.sleep(15)


PC.update({
    "key": act_key, "mouse": act_mouse, "awake": act_awake, "procs": act_procs, "kill": act_kill,
    "clipget": act_clipget, "dl_start": act_dl_start, "dl_status": act_dl_status, "dl_cancel": act_dl_cancel,
    "shortcuts": act_shortcuts, "run": act_run, "unlock": act_unlock, "streaminfo": act_streaminfo,
})
RELAY = {"wake": act_wake, "schedule_list": act_sched_list, "schedule_add": act_sched_add,
         "schedule_del": act_sched_del, "schedule_toggle": act_sched_toggle}
QUIET = {"info", "apps", "files", "mouse", "key", "procs", "dl_status", "shortcuts", "schedule_list", "clipget", "streaminfo"}


# ---------------------------------------------------------------- Wake-on-LAN (relais)

def wake(mac):
    raw = bytes.fromhex(mac.replace(":", "").replace("-", ""))
    packet = b"\xff" * 6 + raw * 16
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        for _ in range(3):
            try:
                s.sendto(packet, ("255.255.255.255", 9))
            except OSError as e:
                log("envoi du signal impossible : " + repr(e))
            time.sleep(0.2)


# ---------------------------------------------------------------- serveur

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"   # la connexion reste ouverte entre deux requêtes : indispensable pour un pavé tactile fluide
    timeout = 60                    # une connexion inutilisée se ferme au bout d'une minute
    wbufsize = 65536                # une réponse = un seul envoi réseau (sinon l'algorithme de Nagle ajoute 40 ms à chaque requête)
    lan_only = False

    def setup(self):
        super().setup()
        try:
            self.request.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass

    def handle(self):
        try:
            super().handle()
        except (ConnectionError, TimeoutError):
            pass                    # le téléphone a coupé en route : rien à signaler

    def finish(self):
        try:
            super().finish()
        except (ConnectionError, TimeoutError):
            pass   # True sur le serveur réseau local : seules les requêtes signées passent

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
        self.send_header("Content-Length", "0")
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/time":     # sert à caler l'horloge, à trouver l'agent sur le réseau et à diagnostiquer la connexion
            origin = self.headers.get("Origin")
            data = json.dumps({"t": int(time.time() * 1000), "app": "wakeup-pc", "mode": MODE,
                               "origin_ok": (not origin) or origin in ORIGINS}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return
        if not self._origin_ok():
            return
        if path == "/stream" and MODE == "pc":
            denied = self._auth("GET")
            if denied:
                return self._send(*denied)
            return self._stream(parse_qs(urlparse(self.path).query))
        if path == "/shot" and MODE == "pc":
            denied = self._auth("GET")
            if denied:
                return self._send(*denied)
            return self._shot(parse_qs(urlparse(self.path).query))
        if path == "/dl" and MODE == "pc":
            denied = self._auth("GET", is_download=True)
            if denied:
                return self._send(*denied)
            return self._download(parse_qs(urlparse(self.path).query))
        self._send(404, {"error": "introuvable"})

    def _stream(self, q):
        """Flux multipart/x-mixed-replace : le navigateur affiche les images au fur et à mesure, comme une vidéo."""
        try:
            max_w = max(240, min(1920, int((q.get("w") or ["800"])[0])))
            fps_max = max(3, min(60, int((q.get("fps") or ["60"])[0])))
        except ValueError:
            max_w, fps_max = 800, 60
        try:
            need_win()
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        with STREAM_LOCK:
            STREAM["gen"] += 1          # un seul flux à la fois : le nouveau arrête l'ancien
            mine = STREAM["gen"]
        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        note("Écran en direct")
        try:
            ctypes.windll.winmm.timeBeginPeriod(1)      # pauses précises (sinon 15 ms minimum sur les vieux Python)
        except Exception:
            pass

        steps = [x for x in (240, 320, 480, 640, 800, 1024, 1280, 1600, 1920) if x <= max_w] or [max_w]
        lvl = min(3, len(steps) - 1)                    # on démarre vers 640 px puis on s'adapte
        last_raw = last_png = None
        last_sent = 0.0
        ema, calm, cool = 0.05, 0, 0.0
        loops = deque()
        try:
            while STREAM["gen"] == mine:
                t0 = time.time()
                try:
                    raw, tw, th = grab_raw(steps[lvl], fast=True, cursor=True)
                except Exception as e:
                    log("flux arrêté : " + repr(e))
                    break
                changed = raw != last_raw
                png, wr = None, 0.0
                if changed:
                    png = png_indexed(raw, tw, th)
                    last_raw, last_png = raw, png
                elif last_png and t0 - last_sent > 2.0:
                    png = last_png               # image fixe : on la renvoie de temps en temps pour garder la connexion vivante
                if png:
                    t1 = time.time()
                    self.wfile.write(b"--frame\r\nContent-Type: image/png\r\nContent-Length: %d\r\n\r\n" % len(png) + png + b"\r\n")
                    self.wfile.flush()
                    wr = time.time() - t1
                    last_sent = time.time()
                    STREAM["kb"] = len(png) / 1024.0
                if changed:
                    ema = 0.8 * ema + 0.2 * (time.time() - t0)
                    if ema > 0.16 and lvl > 0 and t0 > cool:          # trop lent : on réduit la taille de l'image
                        lvl, cool, calm = lvl - 1, t0 + 1.5, 0
                    elif ema < 0.045 and wr < 0.02:                   # tout va vite : on peut agrandir
                        calm += 1
                        if calm >= 25 and lvl < len(steps) - 1 and t0 > cool:
                            lvl, cool, calm = lvl + 1, t0 + 1.5, 0
                    else:
                        calm = 0
                STREAM["w"] = tw
                now = time.time()
                loops.append(now)
                while loops and loops[0] < now - 1.0:
                    loops.popleft()
                STREAM["fps"] = float(len(loops))
                # image qui bouge, ou souris/clavier utilisés à l'instant : vitesse maximale. Image fixe : 3 par seconde.
                hot = changed or now < STREAM["hot"]
                time.sleep(max(0.0, (1.0 / fps_max if hot else 1.0 / 3) - (time.time() - t0)))
        except OSError:
            pass                                  # le téléphone a fermé : on s'arrête
        finally:
            with STREAM_LOCK:
                if STREAM["gen"] == mine:
                    STREAM["fps"] = 0.0
            try:
                ctypes.windll.winmm.timeEndPeriod(1)
            except Exception:
                pass

    def _shot(self, q):
        try:
            w = max(320, min(2560, int((q.get("w") or ["1280"])[0])))
        except ValueError:
            w = 1280
        try:
            png = grab_png(w)
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        except Exception as e:
            log("capture impossible: " + repr(e))
            return self._send(500, {"error": "capture impossible"})
        save = (q.get("save") or [""])[0] == "1"
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(png)))
        self.send_header("Cache-Control", "no-store")
        if save:
            self.send_header("Content-Disposition", disposition("capture-%s.png" % time.strftime("%Y%m%d-%H%M%S")))
        self.end_headers()
        self.wfile.write(png)
        if (q.get("live") or [""])[0] != "1":      # l'affichage en direct ne remplit pas l'historique
            note("Capture d'écran" + (" enregistrée" if save else ""))

    def _download(self, q):
        try:
            p = safe_path((q.get("path") or [""])[0])
            if os.path.isdir(p):
                return self._download_zip(p)
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
                self.send_header("Content-Length", "0")
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
        self.send_header("Content-Disposition", disposition(name))
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

    def _download_zip(self, folder):
        try:
            tmp = make_zip(folder)
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        except Exception as e:
            log("zip impossible: " + repr(e))
            return self._send(500, {"error": "création du zip impossible"})
        try:
            size = os.path.getsize(tmp)
            name = (os.path.basename(folder.rstrip("\\/")) or "dossier") + ".zip"
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(size))
            self.send_header("Content-Disposition", disposition(name))
            self.end_headers()
            note("Dossier envoyé : %s (%s)" % (name[:50], human(size)))
            with open(tmp, "rb") as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except OSError:
            pass
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass

    def do_PUT(self):
        self.close_connection = True      # un envoi de fichier n'est jamais réutilisé : plus simple et plus sûr en cas d'erreur
        if not self._origin_ok():
            return
        u = urlparse(self.path)
        if u.path != "/upload" or MODE != "pc":
            return self._send(404, {"error": "introuvable"})
        denied = self._auth("PUT")
        if denied:
            return self._send(*denied)

        q = parse_qs(u.query)
        want_zip = (q.get("unzip") or [""])[0] == "1"   # un dossier envoyé en .zip : on l'extrait
        try:
            size = int(self.headers.get("Content-Length") or -1)
        except ValueError:
            size = -1
        if size <= 0:
            return self._send(400, {"error": "fichier vide ou taille manquante"})
        if size > MAX_UPLOAD:
            return self._send(413, {"error": "fichier trop gros (max %s)" % human(MAX_UPLOAD)})
        name = clean_name((q.get("name") or ["fichier"])[0])
        try:
            folder = safe_path((q.get("dir") or [""])[0])
            if not os.path.isdir(folder):
                raise ValueError("dossier introuvable")
            if want_zip and not name.lower().endswith(".zip"):
                raise ValueError("ce n'est pas un fichier .zip")
            if shutil.disk_usage(folder).free < size + 100 * 1024 * 1024:
                raise ValueError("pas assez de place sur le PC")
        except ValueError as e:
            return self._send(400, {"error": str(e)})

        def drop(path):
            try:
                os.remove(path)
            except OSError:
                pass

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
        except Exception as e:
            log("réception interrompue: " + repr(e))
            drop(tmp)
            return self._send(500, {"error": "réception interrompue"})

        if want_zip:
            try:
                got, count, total = extract_zip(tmp, folder, name[:-4] or "dossier")
            except ValueError as e:
                drop(tmp)
                return self._send(400, {"error": str(e)})
            except Exception as e:
                log("extraction impossible: " + repr(e))
                drop(tmp)
                return self._send(500, {"error": "extraction impossible"})
            drop(tmp)
            note("Dossier reçu : %s (%d fichiers)" % (got[:50], count))
            return self._send(200, {"ok": True, "name": got, "count": count, "size": total})

        try:
            final = unique_path(folder, name)
            os.replace(tmp, final)
        except OSError as e:
            log("enregistrement impossible: " + repr(e))
            drop(tmp)
            return self._send(500, {"error": "enregistrement impossible"})
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
            self.close_connection = True
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
            if MODE == "pc":
                return self._send(200, {"ok": True, "mode": MODE, "locked": pc_locked()})
            return self._send(200, {"ok": True, "mode": MODE})

        fn = (RELAY if MODE == "relay" else PC).get(action)
        if not fn:
            return self._send(400, {"error": "action inconnue"})
        if action not in QUIET:
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
    if MODE == "relay":
        threading.Thread(target=sched_loop, daemon=True).start()
        log("Réveils programmés : actifs (fichier schedule.json)")
    if MODE == "pc":
        for n, r in share_roots():
            log("Dossier partagé : " + r)
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
        log("Si le téléphone ne trouve pas le PC : autorise le port dans le pare-feu (invite de commandes en administrateur) :")
        log('  netsh advfirewall firewall add rule name="WakeUp-Pc" dir=in action=allow protocol=TCP localport=%d profile=any' % LAN_PORT)
    ThreadingHTTPServer((BIND, PORT), H).serve_forever()
