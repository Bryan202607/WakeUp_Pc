"""
WakeUp-Pc - déverrouillage à distance (OPTIONNEL, Windows seulement).

Pourquoi un programme à part ? Quand Windows est verrouillé, l'écran de connexion tourne sur un
"bureau protégé" où un programme normal ne peut PAS taper de touches. Seul un programme qui tourne
avec les droits SYSTEM peut le faire. Ce fichier installe donc un petit service, une seule fois.

  python unlock.py setup     installe (à lancer dans une invite de commandes EN ADMINISTRATEUR)
  python unlock.py remove    désinstalle tout
  python unlock.py status    vérifie que le service répond
  (serve et type sont lancés par Windows tout seuls, ne les utilise pas à la main)

Comment c'est protégé :
  - ton mot de passe (ou code PIN) Windows est chiffré par Windows lui-même (DPAPI, clé de cette machine)
    et rangé dans un dossier réservé aux administrateurs ;
  - pour s'en servir, l'appli doit envoyer un CODE DE DÉVERROUILLAGE que tu choisis à l'installation,
    différent du token et du mot de passe Windows ;
  - 3 codes faux de suite = blocage de 15 minutes ;
  - le mot de passe n'est tapé QUE si l'écran de connexion est bien affiché (jamais dans une fenêtre
    ouverte, jamais dans une demande d'autorisation UAC) ;
  - le service n'écoute que sur 127.0.0.1 : seul l'agent du PC peut lui parler.
"""
import os, sys, json, time, hmac, ctypes, base64, shutil, hashlib, secrets, getpass, subprocess, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from xml.sax.saxutils import escape

PORT = int(os.environ.get("WAKEUP_UNLOCK_PORT", "8767"))
TASK = "WakeUpPcUnlock"
DATA = os.environ.get("WAKEUP_DATA") or os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "WakeUpPc")
CFG = os.path.join(DATA, "unlock.json")
LOG = os.path.join(DATA, "unlock.log")
SELF = os.path.abspath(__file__)
ITER = 200000
MAX_FAILS, LOCK_SECONDS = 3, 900

U32, VP = ctypes.c_uint32, ctypes.c_void_p
STATE = {"fails": 0, "until": 0.0, "last": 0.0}
STATE_LOCK = threading.Lock()
RUN_LOCK = threading.Lock()


def log(msg):
    """Journal sans aucun secret : sert à comprendre un problème."""
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")
    except OSError:
        pass


def need_win():
    if os.name != "nt":
        raise RuntimeError("Windows seulement")


# ---------------------------------------------------------------- chiffrement Windows (DPAPI)

class BLOB(ctypes.Structure):
    _fields_ = [("cb", U32), ("pb", ctypes.POINTER(ctypes.c_ubyte))]


def dpapi(data, protect):
    need_win()
    crypt, k = ctypes.windll.crypt32, ctypes.windll.kernel32
    k.LocalFree.argtypes = [VP]
    buf = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    src = BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)))
    out = BLOB()
    if protect:     # 0x1 = pas de fenêtre, 0x4 = clé de la machine (lisible par le service SYSTEM)
        ok = crypt.CryptProtectData(ctypes.byref(src), None, None, None, None, 0x5, ctypes.byref(out))
    else:
        ok = crypt.CryptUnprotectData(ctypes.byref(src), None, None, None, None, 0x1, ctypes.byref(out))
    if not ok:
        raise RuntimeError("DPAPI : erreur %d" % ctypes.GetLastError())
    try:
        return ctypes.string_at(out.pb, out.cb)
    finally:
        k.LocalFree(ctypes.cast(out.pb, VP))


# ---------------------------------------------------------------- code de déverrouillage

def hash_code(code, salt):
    return hashlib.pbkdf2_hmac("sha256", code.encode("utf-8"), salt, ITER)


def load_cfg():
    with open(CFG, encoding="utf-8") as f:
        return json.load(f)


def code_ok(code, cfg):
    return hmac.compare_digest(hash_code(code, base64.b64decode(cfg["salt"])), base64.b64decode(cfg["hash"]))


# ---------------------------------------------------------------- saisie sur l'écran de connexion

class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", ctypes.c_int32), ("dy", ctypes.c_int32), ("data", U32), ("flags", U32),
                ("time", U32), ("extra", ctypes.c_size_t)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("vk", ctypes.c_uint16), ("scan", ctypes.c_uint16), ("flags", U32), ("time", U32), ("extra", ctypes.c_size_t)]


class _IU(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", U32), ("u", _IU)]


def kbd(vk=0, scan=0, flags=0):
    return INPUT(1, _IU(ki=KEYBDINPUT(vk, scan, flags, 0, 0)))


def send(items):
    arr = (INPUT * len(items))(*items)
    if ctypes.windll.user32.SendInput(len(items), ctypes.byref(arr), ctypes.sizeof(INPUT)) != len(items):
        raise RuntimeError("SendInput refusé (erreur %d)" % ctypes.GetLastError())


def input_desktop_name():
    """Nom du bureau qui reçoit le clavier : 'Winlogon' = écran de connexion, 'Default' = session ouverte."""
    u = ctypes.windll.user32
    u.OpenInputDesktop.restype = VP
    u.OpenInputDesktop.argtypes = [U32, ctypes.c_int, U32]
    u.GetUserObjectInformationW.argtypes = [VP, ctypes.c_int, VP, U32, ctypes.POINTER(U32)]
    u.CloseDesktop.argtypes = [VP]
    h = u.OpenInputDesktop(0, False, 0x0101)
    if not h:
        return None
    try:
        buf = ctypes.create_unicode_buffer(256)
        need = U32()
        if not u.GetUserObjectInformationW(h, 2, buf, ctypes.sizeof(buf), ctypes.byref(need)):   # 2 = nom
            return None
        return buf.value
    finally:
        u.CloseDesktop(h)


# codes de sortie du programme qui tape (mode "type")
OK, DEJA_OUVERT, REFUSE, PAS_D_ECRAN, ERREUR_CFG = 0, 2, 3, 4, 5


def type_mode():
    """Tourne en SYSTEM sur le bureau de connexion. Tape le mot de passe, jamais ailleurs."""
    try:
        cfg = load_cfg()
        pw = dpapi(base64.b64decode(cfg["pw"]), False).decode("utf-16-le")
    except Exception as e:
        log("type : configuration illisible : %r" % (e,))
        return ERREUR_CFG
    name = input_desktop_name()
    log("type : bureau d'entrée = %r" % (name,))
    if name is None:
        return PAS_D_ECRAN
    if name.lower() != "winlogon":
        return DEJA_OUVERT                      # session déjà ouverte : on ne tape RIEN
    u = ctypes.windll.user32
    u.mouse_event(0x0001, 4, 4, 0, 0)           # réveille l'écran de verrouillage
    send([kbd(0x10, 0, 0), kbd(0x10, 0, 2)])    # Maj : fait apparaître le champ du mot de passe, sans rien y écrire
    time.sleep(1.6)
    if (input_desktop_name() or "").lower() != "winlogon":
        return DEJA_OUVERT                      # quelqu'un a déverrouillé entre-temps : on s'arrête
    items = []
    for ch in pw:
        raw = ch.encode("utf-16-le")
        for i in range(0, len(raw), 2):
            unit = int.from_bytes(raw[i:i + 2], "little")
            items += [kbd(0, unit, 0x0004), kbd(0, unit, 0x0006)]
    if cfg.get("enter", True):
        items += [kbd(0x0D, 0, 0), kbd(0x0D, 0, 2)]
    send(items)
    pw = None
    time.sleep(4)
    return OK if (input_desktop_name() or "").lower() == "default" else REFUSE


# ---------------------------------------------------------------- lancer le programme qui tape dans la session

class STARTUPINFO(ctypes.Structure):
    _fields_ = [("cb", U32), ("lpReserved", ctypes.c_wchar_p), ("lpDesktop", ctypes.c_wchar_p), ("lpTitle", ctypes.c_wchar_p),
                ("dwX", U32), ("dwY", U32), ("dwXSize", U32), ("dwYSize", U32), ("dwXCountChars", U32),
                ("dwYCountChars", U32), ("dwFillAttribute", U32), ("dwFlags", U32), ("wShowWindow", ctypes.c_uint16),
                ("cbReserved2", ctypes.c_uint16), ("lpReserved2", VP), ("hStdInput", VP), ("hStdOutput", VP), ("hStdError", VP)]


class PROCINFO(ctypes.Structure):
    _fields_ = [("hProcess", VP), ("hThread", VP), ("dwProcessId", U32), ("dwThreadId", U32)]


def run_typist():
    """Lance 'unlock.py type' avec les droits SYSTEM, dans la session de l'écran, sur le bureau de connexion."""
    need_win()
    k, a = ctypes.windll.kernel32, ctypes.windll.advapi32
    k.WTSGetActiveConsoleSessionId.restype = U32
    k.GetCurrentProcess.restype = VP
    k.CloseHandle.argtypes = [VP]
    k.WaitForSingleObject.argtypes = [VP, U32]
    k.WaitForSingleObject.restype = U32
    k.GetExitCodeProcess.argtypes = [VP, ctypes.POINTER(U32)]
    a.OpenProcessToken.argtypes = [VP, U32, ctypes.POINTER(VP)]
    a.DuplicateTokenEx.argtypes = [VP, U32, VP, ctypes.c_int, ctypes.c_int, ctypes.POINTER(VP)]
    a.SetTokenInformation.argtypes = [VP, ctypes.c_int, VP, U32]
    a.CreateProcessAsUserW.argtypes = [VP, ctypes.c_wchar_p, ctypes.c_wchar_p, VP, VP, ctypes.c_int, U32, VP,
                                       ctypes.c_wchar_p, ctypes.POINTER(STARTUPINFO), ctypes.POINTER(PROCINFO)]

    sid = k.WTSGetActiveConsoleSessionId()
    if sid == 0xFFFFFFFF:
        raise RuntimeError("aucune session à l'écran")
    me = VP()
    if not a.OpenProcessToken(k.GetCurrentProcess(), 0x0002, ctypes.byref(me)):        # TOKEN_DUPLICATE
        raise RuntimeError("OpenProcessToken : erreur %d" % ctypes.GetLastError())
    tok = VP()
    ok = a.DuplicateTokenEx(me, 0x02000000, None, 2, 1, ctypes.byref(tok))              # copie "primaire" du jeton SYSTEM
    k.CloseHandle(me)
    if not ok:
        raise RuntimeError("DuplicateTokenEx : erreur %d" % ctypes.GetLastError())
    try:
        session = U32(sid)
        if not a.SetTokenInformation(tok, 12, ctypes.byref(session), 4):                # 12 = numéro de session
            raise RuntimeError("SetTokenInformation : erreur %d (le service doit tourner en SYSTEM)" % ctypes.GetLastError())
        si = STARTUPINFO()
        si.cb = ctypes.sizeof(STARTUPINFO)
        si.lpDesktop = "winsta0\\winlogon"
        pi = PROCINFO()
        cmd = ctypes.create_unicode_buffer('"%s" "%s" type' % (sys.executable, SELF))
        if not a.CreateProcessAsUserW(tok, None, cmd, None, None, False, 0x08000000, None, None, ctypes.byref(si), ctypes.byref(pi)):
            raise RuntimeError("CreateProcessAsUser : erreur %d" % ctypes.GetLastError())
        try:
            if k.WaitForSingleObject(pi.hProcess, 40000) != 0:
                raise RuntimeError("délai dépassé")
            code = U32()
            k.GetExitCodeProcess(pi.hProcess, ctypes.byref(code))
            return int(code.value)
        finally:
            k.CloseHandle(pi.hProcess)
            k.CloseHandle(pi.hThread)
    finally:
        k.CloseHandle(tok)


def uac_visible():
    """Une demande d'autorisation Windows (UAC) est à l'écran : on ne tape jamais de mot de passe dedans."""
    try:
        out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, timeout=15, creationflags=0x08000000).stdout
        return b"consent.exe" in out.lower()
    except Exception:
        return False


# ---------------------------------------------------------------- petit serveur local (tourne en SYSTEM)

TYPIST = run_typist       # remplaçables pour les tests
UAC = uac_visible

MESSAGES = {
    DEJA_OUVERT: (409, "le PC est déjà déverrouillé"),
    REFUSE: (502, "le mot de passe a été tapé mais Windows ne s'est pas déverrouillé (mot de passe changé ? option Entrée ?)"),
    PAS_D_ECRAN: (502, "écran de connexion introuvable"),
    ERREUR_CFG: (500, "configuration illisible : relance « python unlock.py setup »"),
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/ping":
            return self._send(200, {"ok": True})
        self._send(404, {"error": "introuvable"})

    def do_POST(self):
        if self.path != "/unlock":
            return self._send(404, {"error": "introuvable"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 1024:
                return self._send(413, {"error": "message trop gros"})
            code = str(json.loads(self.rfile.read(n) or b"{}").get("code", ""))
        except ValueError:
            return self._send(400, {"error": "message invalide"})
        if not code or len(code) > 100:
            return self._send(400, {"error": "code manquant"})

        with STATE_LOCK:
            now = time.time()
            if now < STATE["until"]:
                return self._send(429, {"error": "trop d'essais, réessaie dans %d min" % (1 + int((STATE["until"] - now) // 60))})
            try:
                good = code_ok(code, load_cfg())
            except Exception as e:
                log("configuration illisible : %r" % (e,))
                return self._send(500, {"error": "configuration illisible : relance « python unlock.py setup »"})
            if not good:
                STATE["fails"] += 1
                log("code refusé (%d/%d)" % (STATE["fails"], MAX_FAILS))
                if STATE["fails"] >= MAX_FAILS:
                    STATE["until"], STATE["fails"] = now + LOCK_SECONDS, 0
                    log("blocage 15 min")
                return self._send(403, {"error": "code de déverrouillage incorrect"})
            STATE["fails"] = 0
            if now - STATE["last"] < 8:
                return self._send(429, {"error": "attends quelques secondes entre deux essais"})
            STATE["last"] = now

        if not RUN_LOCK.acquire(blocking=False):
            return self._send(429, {"error": "un déverrouillage est déjà en cours"})
        try:
            if UAC():
                log("refus : demande UAC à l'écran")
                return self._send(409, {"error": "une demande d'autorisation Windows est affichée : ferme-la d'abord"})
            try:
                rc = TYPIST()
            except Exception as e:
                log("échec : %r" % (e,))
                return self._send(500, {"error": "impossible d'agir sur l'écran de connexion : %s" % e})
            log("code de sortie : %d" % rc)
            if rc == OK:
                return self._send(200, {"ok": True})
            code_http, msg = MESSAGES.get(rc, (500, "erreur inconnue (%d)" % rc))
            return self._send(code_http, {"error": msg})
        finally:
            RUN_LOCK.release()


def serve():
    log("service démarré (port %d)" % PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


# ---------------------------------------------------------------- installation

TASK_XML = """<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>WakeUp-Pc : déverrouillage à distance</Description></RegistrationInfo>
  <Triggers><BootTrigger><Enabled>true</Enabled></BootTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author"><Exec><Command>{python}</Command><Arguments>"{script}" serve</Arguments></Exec></Actions>
</Task>
"""


def run(*cmd):
    return subprocess.run(list(cmd), capture_output=True, text=True, creationflags=0x08000000 if os.name == "nt" else 0)


def python_is_safe():
    """Un programme lancé en SYSTEM ne doit pas pouvoir être modifié par un simple utilisateur."""
    py = os.path.realpath(sys.executable).lower()
    for var in ("ProgramFiles", "ProgramFiles(x86)", "SystemRoot"):
        base = os.environ.get(var)
        if base and py.startswith(os.path.realpath(base).lower() + os.sep):
            return True
    return False


def setup(args):
    if os.name != "nt":
        sys.exit("Ce programme ne marche que sur Windows.")
    if not ctypes.windll.shell32.IsUserAnAdmin():
        sys.exit("Ouvre l'invite de commandes EN ADMINISTRATEUR (clic droit, Exécuter en tant qu'administrateur), puis relance.")
    if not python_is_safe() and "--accept-risk" not in args:
        sys.exit(
            "Python est installé dans un dossier que n'importe quel utilisateur peut modifier :\n  %s\n"
            "Le service tourne avec les droits SYSTEM, donc un programme malveillant pourrait en profiter.\n"
            "Solution propre : réinstalle Python avec « Install for all users » (dossier Program Files).\n"
            "Si tu acceptes le risque sur ce PC personnel : python unlock.py setup --accept-risk" % sys.executable)

    print("Installation du déverrouillage à distance.")
    print("Ton mot de passe (ou code PIN) Windows sera chiffré par Windows et rangé dans :\n  " + DATA)
    print("Il n'est utilisé que pour taper sur l'écran de connexion, quand tu envoies le code de déverrouillage.\n")
    pw = getpass.getpass("Mot de passe (ou code PIN) de ta session Windows : ")
    if not pw:
        sys.exit("Un compte sans mot de passe ne peut pas être utilisé ici.")
    if getpass.getpass("Confirme-le : ") != pw:
        sys.exit("Les deux saisies sont différentes.")
    print("\nChoisis maintenant un CODE DE DÉVERROUILLAGE (6 caractères minimum). C'est lui que tu taperas dans l'appli.")
    print("Il doit être différent de ton token et de ton mot de passe Windows.")
    code = getpass.getpass("Code de déverrouillage : ")
    if len(code) < 6:
        sys.exit("Le code doit faire au moins 6 caractères.")
    if getpass.getpass("Confirme-le : ") != code:
        sys.exit("Les deux saisies sont différentes.")
    enter = True
    if "--enter-no" in args:
        enter = False
    else:
        r = input("Appuyer sur Entrée après le mot de passe ? [O/n] (réponds n si c'est un code PIN qui se valide tout seul) ").strip().lower()
        enter = r not in ("n", "non")

    os.makedirs(DATA, exist_ok=True)
    # dossier réservé à SYSTEM et aux administrateurs (avant d'y écrire quoi que ce soit)
    acl = run("icacls", DATA, "/inheritance:r", "/grant:r", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F")
    if acl.returncode != 0:
        sys.exit("Impossible de protéger le dossier : " + acl.stderr.strip())
    dst = os.path.join(DATA, "unlock.py")
    shutil.copyfile(SELF, dst)
    salt = secrets.token_bytes(16)
    cfg = {"salt": base64.b64encode(salt).decode(), "hash": base64.b64encode(hash_code(code, salt)).decode(),
           "pw": base64.b64encode(dpapi(pw.encode("utf-16-le"), True)).decode(), "enter": enter}
    with open(CFG, "w", encoding="utf-8") as f:
        json.dump(cfg, f)

    xml = os.path.join(DATA, "task.xml")
    with open(xml, "w", encoding="utf-16") as f:
        f.write(TASK_XML.replace("{python}", escape(sys.executable)).replace("{script}", escape(dst)))
    r = run("schtasks", "/Create", "/TN", TASK, "/XML", xml, "/F")
    os.remove(xml)
    if r.returncode != 0:
        sys.exit("Création de la tâche impossible : " + (r.stderr or r.stdout).strip())
    run("schtasks", "/End", "/TN", TASK)
    run("schtasks", "/Run", "/TN", TASK)
    time.sleep(3)
    print()
    status()
    print("\nC'est installé. Pour tester : verrouille le PC (touches Windows + L), puis dans l'appli, ligne « Déverrouiller le PC ».")
    print("Journal en cas de problème : " + LOG)


def remove():
    if os.name != "nt" or not ctypes.windll.shell32.IsUserAnAdmin():
        sys.exit("Lance cette commande dans une invite de commandes EN ADMINISTRATEUR, sous Windows.")
    run("schtasks", "/End", "/TN", TASK)
    run("schtasks", "/Delete", "/TN", TASK, "/F")
    shutil.rmtree(DATA, ignore_errors=True)
    print("Déverrouillage à distance désinstallé : tâche supprimée, mot de passe effacé.")


def status():
    import urllib.request
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/ping" % PORT, timeout=3) as r:
            print("Service de déverrouillage : EN MARCHE")
    except Exception:
        print("Service de déverrouillage : ne répond pas")
    if os.name == "nt":
        q = run("schtasks", "/Query", "/TN", TASK)
        print("Tâche Windows : " + ("installée" if q.returncode == 0 else "absente"))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "setup":
        setup(sys.argv[2:])
    elif cmd == "remove":
        remove()
    elif cmd == "status":
        status()
    elif cmd == "serve":
        serve()
    elif cmd == "type":
        try:
            sys.exit(type_mode())
        except Exception as e:
            log("type : erreur : %r" % (e,))
            sys.exit(PAS_D_ECRAN)
    else:
        print(__doc__)
