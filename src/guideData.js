// Contenu du guide d'utilisation, lu directement dans l'appli (aucune connexion nécessaire).
// Types de blocs : h (sous-titre), p (texte), list (puces), steps (étapes numérotées),
// code (commande à copier), warn (à retenir), agent (boutons pour récupérer agent.py).
// **gras** et `code` marchent dans le texte. {ORIGIN} devient l'adresse de cette appli.

export const CHAPTERS = [
  {
    id: "how",
    title: "Comment ça marche",
    icon: "info",
    color: "var(--blue)",
    blocks: [
      { t: "p", text: "WakeUp-Pc contrôle ton ordinateur depuis ton téléphone, même quand tu es très loin de chez toi : l'allumer, l'éteindre, le redémarrer, le verrouiller, régler le volume…" },
      { t: "p", text: "Pour que ce soit sûr, **rien n'est ouvert sur internet**. Un réseau privé (Tailscale) relie tes appareils entre eux, et seuls ceux connectés à ton compte peuvent y entrer." },
      { t: "h", text: "Les trois morceaux" },
      {
        t: "list",
        items: [
          "**L'appli**, sur ton téléphone, envoie les ordres.",
          "**L'agent**, un petit programme (`agent.py`) qui tourne sur le PC et exécute les ordres : éteindre, verrouiller, volume…",
          "**Le relais**, un petit appareil toujours allumé chez toi (un Raspberry Pi par exemple). Un PC éteint ne peut rien recevoir, donc c'est le relais qui envoie le signal Wake-on-LAN pour le réveiller.",
        ],
      },
      { t: "warn", text: "Sans relais, tu peux tout faire sauf allumer le PC. Tu peux donc commencer sans, et l'ajouter plus tard." },
    ],
  },
  {
    id: "need",
    title: "Ce qu'il faut avoir",
    icon: "monitor",
    color: "var(--secondary)",
    blocks: [
      {
        t: "list",
        items: [
          "Un **PC Windows** avec **Python 3**. Télécharge-le sur python.org et, pendant l'installation, coche la case « Add Python to PATH ».",
          "Le PC branché en **câble Ethernet**. En Wi-Fi, l'allumage à distance ne marche presque jamais.",
          "Pour allumer le PC : un **relais** toujours allumé sur le même réseau (Raspberry Pi ou autre petit appareil Linux). Un téléphone Android ne convient pas.",
          "Un **compte Tailscale** gratuit, et l'appli Tailscale sur le téléphone, le PC et le relais.",
        ],
      },
    ],
  },
  {
    id: "tailscale",
    title: "Installer Tailscale",
    icon: "shield",
    color: "var(--indigo)",
    blocks: [
      {
        t: "steps",
        items: [
          "Crée un compte sur tailscale.com avec ton compte Google ou Microsoft. **Active la validation en 2 étapes** sur ce compte : c'est lui qui protège tout le reste.",
          "Dans la console d'administration de Tailscale, page **DNS**, active **MagicDNS** et **HTTPS Certificates**.",
          "Installe Tailscale sur le téléphone, sur le PC et sur le relais, et connecte les trois au **même compte**.",
        ],
      },
      { t: "warn", text: "Tailscale doit être actif sur ton téléphone chaque fois que tu utilises WakeUp-Pc. Sinon l'appli dira « hors ligne » même si le PC est allumé." },
    ],
  },
  {
    id: "agent",
    title: "Installer l'agent sur le PC",
    icon: "power",
    color: "var(--orange)",
    blocks: [
      { t: "h", text: "1. Récupérer agent.py" },
      { t: "p", text: "Le programme est dans l'appli. Envoie-le sur le PC avec Partager (e-mail, messagerie, Taildrop…), ou copie le code, colle-le dans le Bloc-notes du PC et enregistre-le sous le nom `agent.py` (Type : Tous les fichiers)." },
      { t: "agent" },
      { t: "h", text: "2. Fabriquer un token" },
      { t: "p", text: "Le token est le mot de passe de l'agent. Sur le PC, ouvre l'invite de commandes et tape :" },
      { t: "code", text: 'python -c "import secrets; print(secrets.token_urlsafe(24))"' },
      { t: "p", text: "Copie ce qui s'affiche. Il fait au moins 16 caractères, sinon l'agent refuse de démarrer." },
      { t: "h", text: "3. Lancer l'agent" },
      { t: "p", text: "Dans l'invite de commandes, place-toi dans le dossier de agent.py, puis tape (remplace `ton-token`) :" },
      { t: "code", text: "set MODE=pc\nset TOKEN=ton-token\nset ALLOWED_ORIGIN={ORIGIN}\npython agent.py" },
      { t: "p", text: "`ALLOWED_ORIGIN` est l'adresse de cette appli. Si tu t'en sers aussi depuis un autre endroit (page web, version installée), ajoute l'autre adresse après une virgule." },
      { t: "h", text: "4. Rendre l'agent joignable" },
      { t: "p", text: "Dans une **deuxième** fenêtre de l'invite de commandes :" },
      { t: "code", text: "tailscale serve --bg 8765" },
      { t: "p", text: "Ça affiche ton adresse, du genre `https://nom-du-pc.xxxx.ts.net`. C'est elle qu'il faut mettre dans les réglages. Pour la revoir : `tailscale serve status`." },
      { t: "warn", text: "Ne ferme pas la fenêtre de l'agent. Pour qu'il se lance tout seul au démarrage de Windows, regarde le chapitre « Démarrage automatique »." },
    ],
  },
  {
    id: "relay",
    title: "Le relais pour allumer le PC",
    icon: "bolt",
    color: "var(--pink)",
    blocks: [
      { t: "h", text: "Préparer le PC" },
      {
        t: "list",
        items: [
          "**BIOS** : active « Wake on LAN » (ou « Power on by PCI-E »).",
          "**Windows** : Gestionnaire de périphériques, double-clique sur ta carte réseau, onglet Gestion de l'alimentation. Coche les cases qui autorisent le périphérique à réveiller l'ordinateur, et « Magic Packet uniquement ».",
          "**Démarrage rapide** : désactive-le (Options d'alimentation, puis Choisir l'action des boutons d'alimentation).",
        ],
      },
      { t: "h", text: "Trouver l'adresse MAC du PC" },
      { t: "p", text: "Sur le PC, dans l'invite de commandes :" },
      { t: "code", text: "ipconfig /all" },
      { t: "p", text: "Note l'**Adresse physique** de la carte Ethernet, de la forme `AA-BB-CC-DD-EE-FF`." },
      { t: "h", text: "Lancer l'agent sur le relais" },
      { t: "p", text: "Mets `agent.py` sur le relais (même méthode que pour le PC), puis tape. Le token doit être **différent** de celui du PC :" },
      { t: "code", text: "export MODE=relay\nexport TOKEN=un-autre-token\nexport ALLOWED_ORIGIN={ORIGIN}\nexport WOL_MAC=AA:BB:CC:DD:EE:FF\npython3 agent.py" },
      { t: "p", text: "Puis `tailscale serve --bg 8765` sur le relais. Il a sa propre adresse, différente de celle du PC." },
      { t: "h", text: "Tester sans relais" },
      { t: "p", text: "Mets le téléphone sur le même Wi-Fi que le PC, installe une appli gratuite « Wake on LAN » du Play Store, entre l'adresse MAC, éteins le PC et envoie le signal. S'il démarre, le PC est bien prêt." },
    ],
  },
  {
    id: "settings",
    title: "Remplir les réglages",
    icon: "sliders",
    color: "var(--secondary)",
    blocks: [
      { t: "p", text: "Ouvre les Réglages (le curseur en haut à droite). Il y a deux blocs, à remplir de la même façon :" },
      {
        t: "list",
        items: [
          "**Ordinateur** : l'adresse Tailscale du PC et le token de l'agent du PC.",
          "**Relais d'allumage** : l'adresse Tailscale du relais et son token.",
        ],
      },
      { t: "p", text: "L'adresse commence par `https://` et finit par `.ts.net`. Pas de numéro de port, pas de `/` à la fin. Si aucune adresse en `https` n'apparaît, c'est que HTTPS Certificates n'est pas activé dans Tailscale." },
      { t: "p", text: "Tout s'enregistre pendant que tu tapes, et reste sur ton téléphone. Si la ligne du haut affiche « Ordinateur en ligne », c'est gagné." },
    ],
  },
  {
    id: "use",
    title: "Utiliser l'appli",
    icon: "play",
    color: "var(--green)",
    blocks: [
      { t: "h", text: "Le statut" },
      {
        t: "list",
        items: [
          "**Rond vert** : le PC est allumé et répond.",
          "**Rond rouge** : le PC est éteint, ou Tailscale n'est pas actif, ou l'agent n'est pas lancé.",
          "**Rond orange** : accès refusé. Le token est faux, ou l'agent s'est bloqué après trop d'erreurs.",
          "**Rond gris** : vérification en cours, ou réglages vides.",
        ],
      },
      { t: "p", text: "La vérification se refait toute seule toutes les 8 secondes." },
      { t: "h", text: "Allumer le PC" },
      { t: "p", text: "Quand le PC est éteint, un gros bouton **Allumer l'ordinateur** apparaît. Appuie une fois, puis attends environ une minute : le temps que Windows démarre et que l'agent se lance. Le bouton est grisé si le relais est hors ligne." },
      { t: "h", text: "Les 4 actions de base" },
      {
        t: "list",
        items: [
          "**Verrouiller** : verrouille la session Windows.",
          "**Mettre en veille** : tout de suite.",
          "**Redémarrer** et **Éteindre** : il faut appuyer **deux fois**. La ligne devient rouge, et tu as 4 secondes pour confirmer.",
        ],
      },
      { t: "h", text: "Les outils" },
      {
        t: "list",
        items: [
          "**Éteindre dans…** : 15 min, 30 min, 1 h, 2 h ou 4 h. Tu peux annuler depuis la même feuille.",
          "**Autres actions** : Hiberner, Se déconnecter (tu perds ce qui n'est pas enregistré) et Éteindre l'écran (il se rallume dès que tu bouges la souris).",
          "**Médias et volume** : précédent, lecture/pause, suivant, volume moins, muet, volume plus.",
          "**Envoyer au PC** : ouvrir une appli de ta liste, ouvrir un site, ou envoyer un texte dans le presse-papiers du PC (ensuite Ctrl+V sur le PC).",
          "**Infos et historique** : temps allumé, mémoire, disque, batterie, et les 20 dernières actions avec l'heure. Les tentatives refusées apparaissent en rouge.",
        ],
      },
      { t: "warn", text: "Si tu éteins le PC, tu ne pourras plus le contrôler avant de l'avoir rallumé avec le bouton Allumer. Et selon la carte mère, un PC en veille ne se réveille pas toujours à distance : teste avant." },
    ],
  },
  {
    id: "apps",
    title: "Choisir les applis à ouvrir",
    icon: "send",
    color: "var(--blue)",
    blocks: [
      { t: "p", text: "Pour ta sécurité, le téléphone ne peut ouvrir **que** les applis que tu as autorisées sur le PC. Crée un fichier `apps.json` dans le même dossier que `agent.py`, avec ce genre de contenu :" },
      { t: "code", text: '{\n  "YouTube": "https://youtube.com",\n  "Bloc-notes": "notepad.exe",\n  "Calculatrice": "calc.exe"\n}' },
      { t: "p", text: "À gauche, le nom affiché dans l'appli. À droite, ce qui doit s'ouvrir : un site, un programme ou un dossier. Dans un chemin Windows, chaque `\\` s'écrit `\\\\` dans ce fichier." },
      { t: "p", text: "Pas besoin de relancer l'agent quand tu changes la liste." },
    ],
  },
  {
    id: "auto",
    title: "Démarrage automatique",
    icon: "restart",
    color: "var(--teal)",
    blocks: [
      { t: "p", text: "Quand le PC redémarre, l'agent s'arrête : les commandes `set` et `python agent.py` ne survivent pas. Pour qu'il se relance tout seul :" },
      {
        t: "steps",
        items: [
          "Ouvre le Bloc-notes et colle le texte ci-dessous. Remplace `ton-token` et, si besoin, `C:\\wakeup` par le dossier de agent.py.",
          "Enregistre-le sous le nom `start-wakeup.bat` (Type : Tous les fichiers).",
          "Appuie sur les touches Windows + R, tape `shell:startup` et valide.",
          "Copie `start-wakeup.bat` dans le dossier qui s'ouvre.",
        ],
      },
      { t: "code", text: '@echo off\nif "%1"=="" (\n  start "WakeUp-Pc" /min "%~f0" run\n  exit\n)\ncd /d C:\\wakeup\nset MODE=pc\nset TOKEN=ton-token\nset ALLOWED_ORIGIN={ORIGIN}\npython agent.py' },
      { t: "warn", text: "Ce fichier contient ton token en clair : ne le partage pas. Il ne démarre qu'après l'ouverture de ta session Windows. Pour que ça marche après un redémarrage sans toi, active l'ouverture automatique de session (outil Autologon de Microsoft)." },
    ],
  },
  {
    id: "pin",
    title: "Code PIN et mode démo",
    icon: "lock",
    color: "var(--blue)",
    blocks: [
      { t: "h", text: "Le code PIN" },
      { t: "p", text: "Dans Réglages, ligne **Code PIN**, crée un code à 6 chiffres. L'appli le demande à chaque ouverture et se reverrouille quand tu la quittes plus de 30 secondes." },
      {
        t: "list",
        items: [
          "Après 5 erreurs, il faut attendre 1 minute, puis 5, puis 15 si tu continues.",
          "Le code reste sur ton téléphone sous forme d'empreinte, jamais en clair.",
          "Code oublié ? Le bouton sur l'écran de verrouillage efface tout sur le téléphone (adresses, tokens, code). Tu ressaisis les réglages. Le PC n'est pas touché.",
        ],
      },
      { t: "p", text: "Le code protège contre quelqu'un qui prend ton téléphone. Il ne remplace pas un token gardé secret." },
      { t: "h", text: "Le mode démo" },
      { t: "p", text: "Dans Réglages, l'interrupteur **Mode démo** donne un faux ordinateur : tout marche, rien n'est envoyé sur le réseau, et tes vrais réglages restent intacts. Pratique pour essayer ou pour montrer l'appli." },
    ],
  },
  {
    id: "security",
    title: "Sécurité",
    icon: "shield",
    color: "var(--green)",
    blocks: [
      {
        t: "list",
        items: [
          "**Aucun port ouvert** sur ta box : tout passe par le tunnel chiffré de Tailscale.",
          "L'agent n'écoute qu'en local. C'est `tailscale serve` qui le rend visible, et seulement à tes appareils.",
          "Il faut un **token**, et l'agent se bloque 15 minutes après 5 essais ratés.",
          "L'agent refuse les requêtes qui ne viennent pas de l'adresse indiquée dans `ALLOWED_ORIGIN`.",
          "Utilise **deux tokens différents** : un pour le PC, un pour le relais.",
          "Ne partage jamais un token et n'envoie pas de capture des réglages.",
          "**Téléphone perdu ou volé** : va tout de suite dans la console Tailscale et retire l'appareil. Ensuite change les tokens.",
          "Évite d'éteindre le PC pendant que quelqu'un travaille dessus : le message ne prévient que 5 secondes avant.",
          "Garde le relais toujours branché, sinon plus rien ne s'allume à distance.",
        ],
      },
    ],
  },
  {
    id: "help",
    title: "Si ça ne marche pas",
    icon: "dots",
    color: "var(--orange)",
    blocks: [
      { t: "h", text: "Ordinateur hors ligne alors qu'il est allumé" },
      { t: "p", text: "Vérifie dans l'ordre : Tailscale actif sur le téléphone, la fenêtre de `agent.py` ouverte sur le PC, et la commande `tailscale serve --bg 8765` lancée. Vérifie aussi l'adresse dans les réglages." },
      { t: "h", text: "Accès refusé" },
      { t: "p", text: "Le token est faux. Après 5 erreurs, l'agent se bloque 15 minutes : patiente, ou relance l'agent." },
      { t: "h", text: "Le PC ne s'allume pas" },
      { t: "p", text: "C'est presque toujours le Wake-on-LAN : BIOS, réglages Windows, démarrage rapide encore actif, PC en Wi-Fi, ou mauvaise adresse MAC. Fais le test sans relais (chapitre « Le relais »)." },
      { t: "h", text: "Messages en bas de l'écran" },
      {
        t: "list",
        items: [
          "**« Injoignable. Tailscale est-il actif ? »** : le téléphone n'atteint pas l'appareil.",
          "**« token invalide »** : le token des réglages n'est pas celui de l'agent.",
          "**« verrouillé, réessaie plus tard »** : trop d'erreurs, l'agent attend 15 minutes.",
          "**« origine refusée »** : `ALLOWED_ORIGIN` ne correspond pas à l'adresse de l'appli. Recopie-la depuis le chapitre « Installer l'agent ».",
          "**« outil introuvable sur le PC »** ou **« appli non autorisée »** : la commande n'existe pas sur le PC, ou l'appli n'est pas dans `apps.json`.",
        ],
      },
    ],
  },
];
