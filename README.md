# WakeUp-Pc

Un petit projet perso pour contrôler mon ordinateur avec mon téléphone, même quand je suis très loin de chez moi. Avec l'appli on peut allumer le PC, l'éteindre, le redémarrer, le mettre en veille et le verrouiller.

Ce fichier explique l'installation. Pour se servir de l'appli au quotidien, lis le `GUIDE.md`. Pour la mettre sur le Play Store, lis le `PLAYSTORE.md`.

## Comment ça marche

Je ne voulais pas ouvrir mon PC directement sur internet, c'est trop risqué, n'importe qui pourrait essayer de s'y connecter. Du coup j'utilise Tailscale, qui crée un réseau privé entre mes appareils. Seuls les appareils connectés à mon compte peuvent y entrer, donc personne d'autre ne peut même voir le PC.

Pour éteindre, redémarrer, etc, c'est le fichier `agent.py` qui tourne sur le PC et qui reçoit les ordres du téléphone.

Pour allumer, c'est un peu plus compliqué. Un PC éteint ne peut rien recevoir, donc il faut un deuxième petit appareil, toujours allumé chez soi, qu'on appelle le relais. C'est lui qui envoie le signal spécial (le Wake-on-LAN) pour réveiller le PC. On utilise le même fichier `agent.py` pour le relais, mais en mode `relay`.

L'interface est faite en React (avec Vite), c'est la page qu'on ouvre sur le téléphone. Comme je n'ai pas d'ordinateur de développement sous la main, c'est GitHub Actions qui compile le projet et le publie tout seul sur GitHub Pages à chaque modification.

## Ce qu'il faut avoir

- Un PC Windows avec Python 3 installé
- Le PC branché en câble Ethernet, parce qu'en Wi-Fi l'allumage à distance marche rarement
- Un appareil toujours allumé chez soi pour le relais, par exemple un Raspberry Pi (un vieux téléphone Android ne marche pas pour ça)
- Un compte Tailscale, c'est gratuit
- Un compte GitHub (rien à installer pour l'interface, GitHub la compile tout seul)

## Installation

### 1. Tailscale

1. Crée un compte Tailscale en te connectant avec un compte Google ou Microsoft, et mets la validation en 2 étapes sur ce compte. C'est important, parce que c'est ce compte qui protège tout le reste.
2. Sur le site d'administration de Tailscale, dans la page DNS, active MagicDNS et HTTPS Certificates.
3. Installe l'appli Tailscale sur le téléphone, sur le PC et sur le relais, et connecte les trois au même compte.

### 2. L'interface sur GitHub Pages

1. Crée un dépôt nommé `WakeUp-Pc` sur GitHub.
2. Ajoute-y tous les fichiers du projet, avec la même organisation :
   ```
   WakeUp-Pc/
   ├── .github/workflows/android.yml
   ├── .github/workflows/deploy.yml
   ├── .github/workflows/keystore.yml
   ├── src/
   │   ├── api.js
   │   ├── App.jsx
   │   ├── icons.jsx
   │   ├── main.jsx
   │   ├── Settings.jsx
   │   ├── Guide.jsx
   │   ├── guideData.js
   │   ├── Pin.jsx
   │   ├── pin.js
   │   ├── Row.jsx
   │   ├── Tools.jsx
   │   ├── Sheet.jsx
   │   ├── styles.css
   │   └── useStatus.js
   ├── .gitignore
   ├── capacitor.config.json
   ├── PLAYSTORE.md
   ├── public/privacy.html
   ├── tools/make_assets.py
   ├── agent.py
   ├── index.html
   ├── package.json
   ├── README.md
   └── vite.config.js
   ```
   Depuis le téléphone, le plus simple est Add file, puis Create new file. Dans le champ du nom, tape le chemin complet, par exemple `src/App.jsx`, le dossier se crée tout seul quand tu tapes le `/`. Ensuite colle le contenu et fais Commit changes. Pour `.github/workflows/deploy.yml` c'est pareil.
3. Va dans Settings, puis Pages, et dans Source choisis **GitHub Actions** (pas une branche).
4. Va dans l'onglet Actions, le déploiement se lance tout seul à chaque commit. Au bout d'une minute ou deux, quand c'est vert, la page est disponible à l'adresse `https://TON-PSEUDO.github.io/WakeUp-Pc/`.

Si le rond est rouge dans Actions, ouvre l'exécution pour lire l'erreur, c'est souvent un fichier mal placé ou un nom de dossier différent.

Retiens bien `https://TON-PSEUDO.github.io` (sans le `/WakeUp-Pc/` à la fin), on en a besoin juste après pour `ALLOWED_ORIGIN`.

### 3. L'agent sur le PC

Mets `agent.py` dans un dossier, ouvre l'invite de commandes dans ce dossier et tape :

```
set MODE=pc
set TOKEN=UN-LONG-MOT-DE-PASSE-UNIQUE-1
set ALLOWED_ORIGIN=https://TON-PSEUDO.github.io,https://localhost
python agent.py
```

Le token doit faire au moins 16 caractères, sinon l'agent refuse de démarrer.

Dans `ALLOWED_ORIGIN`, la première adresse est celle de ta page GitHub. La deuxième, `https://localhost`, est celle que prend l'appli Android une fois installée depuis le Play Store. Tu peux garder les deux séparées par une virgule, ça ne gêne pas.

Ensuite, dans une deuxième fenêtre de l'invite de commandes, tape :

```
tailscale serve --bg 8765
```

Ça affiche une adresse du genre `https://nom-du-pc.xxxx.ts.net`, garde-la bien, on en a besoin dans l'appli.

### 4. Le relais pour allumer le PC

Sur le relais (Raspberry Pi ou autre petit appareil Linux, branché en câble sur le même réseau que le PC, avec Tailscale installé), tape :

```
export MODE=relay
export TOKEN=UN-AUTRE-LONG-TOKEN-DIFFERENT-2
export ALLOWED_ORIGIN=https://TON-PSEUDO.github.io,https://localhost
export WOL_MAC=AA:BB:CC:DD:EE:FF
python3 agent.py
```

Puis `tailscale serve --bg 8765` comme sur le PC.

`WOL_MAC` c'est l'adresse MAC du PC. Sur le PC, tape `ipconfig /all` et regarde la ligne Adresse physique de la carte Ethernet.

Il faut aussi préparer le PC pour qu'il accepte d'être réveillé :
- Dans le BIOS, active l'option Wake-on-LAN (ça peut s'appeler aussi Power On By PCI-E ou Wake on LAN selon la carte mère).
- Dans Windows, ouvre le Gestionnaire de périphériques, double-clique sur ta carte réseau, va dans Gestion de l'alimentation et coche les cases qui autorisent le périphérique à réveiller l'ordinateur.

### 5. Dans l'appli

1. Active Tailscale sur ton téléphone.
2. Ouvre la page `https://TON-PSEUDO.github.io/WakeUp-Pc/`.
3. Appuie sur le bouton de réglages en haut à droite et remplis les adresses et les tokens du PC et du relais. Si tu ne sais pas où les trouver, regarde la partie Où trouver le token et l'adresse dans le `GUIDE.md`.
4. Enregistre. Si tout va bien, la ligne du haut affiche Ordinateur en ligne.

## Nouveautés de la version 1.1

Extinction programmée, hibernation, déconnexion, écran éteint, volume et médias, infos du PC avec historique, ouvrir un site ou une appli, presse-papiers, code PIN pour toute l'appli et mode démo. Tout est expliqué dans GUIDE.md, et le même guide est aussi lisible directement dans l'appli (bouton livre en haut à droite), même sans connexion. L'appli contient aussi le code de `agent.py` : bouton Partager ou Copier dans le chapitre « Installer l'agent sur le PC ». Pour "ouvrir une appli", crée un fichier `apps.json` à côté de `agent.py` (exemple dans `apps.example.json`).

## Utilisation

- Si le PC est éteint, un gros bouton Allumer l'ordinateur apparaît. Il faut attendre une minute environ que le PC démarre et que l'agent se lance.
- Si le PC est allumé, tu as 4 lignes : Verrouiller, Mettre en veille, Redémarrer et Éteindre.
- Pour Redémarrer et Éteindre, il faut appuyer deux fois. Au premier appui la ligne devient rouge, et il faut appuyer encore dans les 4 secondes pour confirmer. C'est pour éviter de couper le PC par erreur.

## Si ça ne marche pas

- Écran avec Ordinateur hors ligne alors que le PC est allumé : vérifie que Tailscale est actif sur le téléphone, que `agent.py` tourne et que la commande `tailscale serve --bg 8765` a été lancée.
- Accès refusé : le token est faux. Après 5 erreurs, l'agent se bloque pendant 15 minutes, il faut attendre.
- Le PC ne s'allume pas : c'est presque toujours le Wake-on-LAN qui n'est pas bien activé (BIOS ou Windows), ou le PC qui est en Wi-Fi. Vérifie aussi l'adresse MAC.
- Rien ne s'affiche sur la page : vérifie que `ALLOWED_ORIGIN` correspond exactement à ton adresse GitHub Pages, sans le chemin à la fin.

## À propos de la sécurité

- Aucun port n'est ouvert sur la box, tout passe par le tunnel chiffré de Tailscale.
- L'agent écoute seulement en local, c'est `tailscale serve` qui le rend accessible, et seulement aux appareils de mon réseau Tailscale.
- Il y a un token, et l'agent se bloque après 5 essais ratés.
- Il refuse les requêtes qui ne viennent pas de ma page GitHub Pages.
- Utilise deux tokens différents, un pour le PC et un pour le relais.
- Si le téléphone est perdu ou volé, il faut retirer l'appareil dans la console Tailscale tout de suite.

Rien n'est sûr à 100 %, mais comme rien n'est exposé sur internet, c'est déjà bien protégé.

## Ce qu'il reste à faire

- Lancer l'agent automatiquement au démarrage de Windows
- Gérer plusieurs ordinateurs
