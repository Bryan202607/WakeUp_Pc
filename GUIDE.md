# Guide d'utilisation de WakeUp-Pc

Ce guide explique comment se servir de l'appli au quotidien, une fois que tout est installé. Si ce n'est pas encore fait, l'installation est expliquée dans le `README.md`.

## Avant de commencer

L'appli ne marche que si Tailscale est actif sur ton téléphone. C'est lui qui crée le tunnel privé vers le PC, donc si tu l'oublies, l'appli affichera que l'ordinateur est hors ligne même s'il est allumé.

Pense donc toujours à ouvrir l'appli Tailscale d'abord et à vérifier qu'elle est connectée.

## Où trouver le token et l'adresse

L'appli te demande deux choses pour chaque appareil (le PC, et le relais), une adresse et un token. Personne ne te les donne, c'est toi qui les prépares pendant l'installation.

### Le token

Le token est un mot de passe que tu inventes toi-même. Il doit être long, 16 caractères minimum, sinon l'agent refuse de démarrer.

Le plus simple pour en fabriquer un bon, c'est de demander à Python. Sur le PC, ouvre l'invite de commandes et tape :

```
python -c "import secrets; print(secrets.token_urlsafe(24))"
```

Ça affiche une suite de caractères au hasard, copie-la. Ensuite tu l'utilises à deux endroits :

1. Sur le PC, quand tu lances l'agent : `set TOKEN=ton-token`
2. Dans l'appli, dans Réglages, partie Ordinateur, champ Token.

Pour le relais, refais la même chose pour avoir un deuxième token, différent du premier. Tu le mets dans `export TOKEN=...` sur le relais, et dans la partie Relais d'allumage de l'appli.

Garde les tokens dans un endroit sûr, comme un gestionnaire de mots de passe, mais pas dans une capture d'écran ou un message.

### L'adresse

L'adresse est celle que Tailscale donne à ton appareil, elle ressemble à `https://nom-du-pc.tail1234.ts.net`. Pour la trouver, tu as trois possibilités :

- Quand tu tapes `tailscale serve --bg 8765` sur le PC, l'adresse s'affiche dans le résultat, sur la ligne Available within your tailnet.
- Si tu l'as ratée, retape `tailscale serve status` et elle s'affiche à nouveau.
- Sinon, ouvre la console d'administration de Tailscale, onglet Machines. Chaque appareil a un nom qui finit par `.ts.net`, et l'adresse c'est `https://` suivi de ce nom complet.

Le relais a sa propre adresse, différente de celle du PC. Il ne faut pas ajouter de numéro de port, ni de `/` à la fin.

Si aucune adresse en `https` n'apparaît, c'est que l'option HTTPS Certificates n'est pas activée dans Tailscale. Retourne dans le `README.md`, étape 1.

## Première connexion

1. Ouvre ton appli.
2. Appuie sur le bouton Configurer (ou sur Réglages en haut à droite).
3. Dans la partie Ordinateur, mets l'adresse du PC et son token (voir plus haut où les trouver).
4. Dans la partie Relais d'allumage, mets l'adresse du relais et son token.
5. Appuie sur Enregistrer.

Les réglages sont gardés sur ton téléphone, donc tu ne les remplis qu'une seule fois. Si tu changes de téléphone ou que tu vides les données du navigateur, il faudra les remettre.

Astuce, ajoute la page à l'écran d'accueil de ton téléphone (menu du navigateur, puis Ajouter à l'écran d'accueil), comme ça tu l'ouvres comme une vraie appli.

## Comprendre l'écran

En haut, une ligne avec un petit rond de couleur te dit où en est le PC :

- Rond vert, Ordinateur en ligne : le PC est allumé et répond.
- Rond rouge, Ordinateur hors ligne : le PC est éteint, ou alors Tailscale n'est pas actif, ou l'agent n'est pas lancé.
- Rond orange, Accès refusé : le token est faux, ou l'agent s'est bloqué après trop d'erreurs.
- Rond gris, Vérification ou Non configuré : l'appli teste encore la connexion, ou les réglages sont vides.

La vérification se refait toute seule toutes les 8 secondes, pas besoin de recharger la page.

## Allumer le PC

Quand le PC est éteint, un gros bouton Allumer l'ordinateur apparaît. Appuie dessus une fois, puis attends environ une minute. Le PC doit démarrer Windows et lancer l'agent, et ensuite le rond passe au vert tout seul.

Le bouton est grisé si le relais est hors ligne. Dans ce cas, vérifie que le relais est bien allumé et connecté à Tailscale.

## Contrôler le PC allumé

Quand le PC est en ligne, l'écran montre deux groupes de lignes.

**Le premier groupe, les 4 actions de base :**

- Verrouiller : verrouille la session Windows, utile si tu l'as laissée ouverte.
- Mettre en veille : le PC se met en veille tout de suite.
- Redémarrer : le PC redémarre.
- Éteindre : le PC s'éteint complètement.

Pour Redémarrer et Éteindre, il faut appuyer deux fois. Au premier appui, la ligne devient rouge avec le message Appuie pour confirmer. Tu as 4 secondes pour appuyer une deuxième fois, sinon ça s'annule. C'est fait exprès pour éviter les mauvaises manips.

**Le deuxième groupe, les outils (chaque ligne ouvre une petite feuille) :**

- Éteindre dans… : choisis 15 min, 30 min, 1 h, 2 h ou 4 h, et le PC s'éteint tout seul à l'heure prévue. Tu peux annuler à tout moment depuis la même feuille.
- Autres actions : Hiberner, Se déconnecter (deux appuis, tu perds ce qui n'est pas enregistré) et Éteindre l'écran (il se rallume dès que tu bouges la souris).
- Médias et volume : précédent, lecture/pause, suivant, volume moins, muet, volume plus.
- Envoyer au PC : ouvrir une appli de ta liste, ouvrir un site, ou envoyer un texte dans le presse-papiers du PC (ensuite tu fais Ctrl+V sur le PC).
- Infos et historique : depuis combien de temps le PC est allumé, mémoire, disque, batterie s'il y en a une, et les 20 dernières actions avec l'heure. Les tentatives de token refusées y apparaissent en rouge.

Attention, si tu éteins le PC, tu ne pourras plus le contrôler avant de l'avoir rallumé avec le bouton Allumer. Et si tu mets en veille, il peut ne pas se réveiller avec ce bouton selon la carte mère, donc teste avant de t'en servir à distance.

## Choisir les applis qu'on peut ouvrir à distance

Pour des raisons de sécurité, le téléphone ne peut ouvrir que les applis que toi tu as autorisées sur le PC. Crée un fichier `apps.json` dans le même dossier que `agent.py`, avec ce genre de contenu :

```
{
  "YouTube": "https://youtube.com",
  "Bloc-notes": "notepad.exe",
  "Calculatrice": "calc.exe",
  "Mon dossier": "C:\\Users\\Bryan\\Documents"
}
```

À gauche le nom qui s'affichera dans l'appli, à droite ce qui doit s'ouvrir (un site, un programme, un dossier). Sur Windows, les `\` d'un chemin s'écrivent `\\` dans ce fichier. Pas besoin de relancer l'agent quand tu modifies la liste. Ne mets pas ce fichier sur GitHub (il est déjà ignoré).

## Le code PIN

Dans Réglages, ligne Code PIN, tu peux créer un code à 6 chiffres. Ensuite l'appli le demande à chaque ouverture, et se reverrouille quand tu la quittes plus de 30 secondes.

- Après 5 erreurs, il faut attendre 1 minute. Ça monte à 5 puis 15 minutes si tu continues.
- Le code reste sur ton téléphone sous forme d'empreinte, il n'est écrit nulle part en clair.
- Si tu l'oublies, appuie sur Code oublié ? sur l'écran de verrouillage. Ça efface tout sur le téléphone (adresses, tokens, code), tu devras ressaisir les réglages. Le PC n'est pas touché.
- Le code protège contre quelqu'un qui prend ton téléphone, pas contre quelqu'un qui connaît ton token. Garde le token secret aussi.

## Le mode démo

Dans Réglages, tu peux activer le Mode démo. L'appli utilise alors un faux ordinateur : tout marche (éteindre, rallumer, minuterie, historique…) mais rien n'est envoyé sur le réseau. Tes vrais réglages ne sont pas modifiés, tu les retrouves en désactivant la démo. C'est aussi ce que les testeurs du Play Store utiliseront.

## Travailler sans internet : la connexion directe

Quand le téléphone et le PC sont sur le même petit réseau, ils peuvent se parler sans internet et sans Tailscale :

- le point d'accès Wi-Fi du téléphone, avec le PC connecté dessus ;
- le même Wi-Fi (même box ou routeur, même sans internet) ;
- le partage de connexion Bluetooth du téléphone (lent, mais ça passe) ;
- le partage de connexion USB (le plus rapide).

Marche à suivre :

1. Sur le PC, ajoute `set LAN=1` avant `python agent.py`. L'agent affiche des lignes « Connexion directe : http://192.168.x.x:8766 ».
2. Accepte la demande du pare-feu Windows pour les réseaux privés. Si le PC est sur le point d'accès du téléphone et que Windows le classe en réseau public, passe-le en privé.
3. Dans l'appli, Réglages, ligne **Direct** : tape l'adresse (par exemple `192.168.43.2`).
4. La ligne du haut affiche « Ordinateur en ligne · direct ».

Ça ne marche que dans l'appli Android (l'APK ou le Play Store), pas dans la page web. Et un PC éteint ne rejoint aucun réseau : pour l'allumer, il faut le relais, dont tu peux aussi mettre l'adresse locale dans sa ligne **Direct**.

Sur ce chemin, le token ne circule jamais (chaque requête est signée), mais le contenu des fichiers n'est pas chiffré : utilise-le sur ton propre réseau protégé par mot de passe, pas sur un Wi-Fi public.

## Transférer des fichiers et des dossiers

L'écran **Fichiers et dossiers** donne accès aux dossiers de partage du PC. Par défaut, c'est `WakeUp-Pc` dans ton dossier utilisateur. Pour en choisir d'autres, ajoute avant `python agent.py` :

```
set SHARE_DIR=C:\\Users\\Bryan\\Documents;D:\\Photos
```

Plusieurs dossiers se séparent par un point-virgule, et l'appli affiche alors la liste de départ. Rien d'autre sur le PC n'est visible.

- **Télécharger un fichier** : appuie dessus. Le navigateur du téléphone le télécharge dans Téléchargements.
- **Télécharger un dossier** : ouvre-le et appuie sur « Télécharger ce dossier (.zip) ». Le PC le compresse (2 Go maximum, `MAX_ZIP_MB` pour changer).
- **Envoyer des fichiers** : choisis-en un ou plusieurs, ils arrivent dans le dossier ouvert (1 Go maximum par fichier, `MAX_UPLOAD_MB` pour changer).
- **Envoyer un dossier** : compresse-le en .zip sur le téléphone, puis « Envoyer un dossier (.zip) ». Le PC le décompresse tout seul dans un nouveau dossier.
- **Nouveau dossier** : crée un dossier sur le PC, là où tu te trouves.
- Un fichier ou un dossier du même nom n'est jamais écrasé : le nouveau devient `nom (1)`.
- Ça marche par Tailscale et en connexion directe, donc avec ou sans internet.

## Pavé tactile, clavier et vidéo de l'écran

- **Pavé tactile** : plein écran, fond gris. Un doigt déplace, un tap clique, un tap à deux doigts fait un clic droit, deux doigts font défiler, deux doigts qui s'écartent zooment, trois doigts changent de fenêtre. La bande du bas donne les boutons gauche et droit. **Quitter** en haut à gauche.
- **Écran et pavé** : comme le pavé, avec l'écran du PC en vidéo dans le tiers du haut. La vidéo va de 3 images par seconde (écran fixe) à 60 (écran qui bouge) et réduit sa taille toute seule si la connexion est lente. Pour la fluidité, préfère la connexion directe.
- **Clavier** : plein écran, AZERTY avec accents, Ctrl/Alt/Win « collants » pour les raccourcis, pages 123 et Fn. **Quitter** en haut à gauche.
- **Capture d'écran** : une image, avec affichage en direct, trois qualités et enregistrement.
- **Presse-papiers** : du téléphone vers le PC et du PC vers le téléphone.

Tout ça demande l'agent sur Windows.

## Déverrouiller le PC à distance (facultatif)

Windows interdit à un programme normal de taper sur l'écran de connexion. `unlock.py` installe donc un petit service avec les droits SYSTEM :

1. Mets `unlock.py` à côté de `agent.py`. Python doit être installé pour tous les utilisateurs (Program Files).
2. Dans une invite de commandes **en administrateur** : `python unlock.py setup`. Il demande le mot de passe (ou le PIN) Windows, puis un **code de déverrouillage** à toi.
3. PC verrouillé (Windows + L) : la ligne du haut de l'appli affiche « Ordinateur verrouillé » et une ligne **Déverrouiller le PC** apparaît.

Le mot de passe est chiffré par Windows et rangé dans `C:\\ProgramData\\WakeUpPc`. Il n'est tapé que sur l'écran de connexion, jamais dans une fenêtre ouverte ni dans une demande UAC. Trois codes faux de suite bloquent 15 minutes. Pour désinstaller : `python unlock.py remove` (administrateur). Pour vérifier : `python unlock.py status`.

## Si la connexion directe ne marche pas bien

Dans Réglages, **Connexion directe** : « Chercher le PC et le relais » trouve les adresses tout seul, « Tester la connexion » dit ce qui bloque. Il faut l'appli Android (APK). Pare-feu Windows, une fois, en administrateur :

```
netsh advfirewall firewall add rule name="WakeUp-Pc" dir=in action=allow protocol=TCP localport=8766 profile=any
```

## Gérer le PC

- **Programmes en cours** : appuie deux fois sur un programme pour le fermer. Les programmes du système, l'agent et Tailscale sont protégés.
- **Raccourcis** : un fichier `shortcuts.json` à côté de `agent.py` liste les commandes que tu autorises (voir `shortcuts.example.json`). Chaque raccourci peut afficher son résultat (`"output": true`) ou demander un deuxième appui (`"confirm": true`).
- **Télécharger sur le PC** (dans « Envoyer au PC ») : le PC télécharge un lien dans son dossier partagé. Les liens vers le réseau local sont refusés, sauf avec `set ALLOW_LAN_DOWNLOAD=1`.
- **Minuteries** : éteindre dans…, et **garder le PC éveillé** de 30 minutes à 8 heures.
- **Réveil programmé** : le relais allume le PC à l'heure choisie, chaque jour ou une seule fois (fichier `schedule.json` sur le relais, qui doit rester allumé).
- **Empreinte digitale** : dans Réglages, Code PIN, si le téléphone en a une. Le code reste toujours possible.

## Obtenir l'APK

Voir la section « Obtenir l'APK » du README : onglet Actions, workflow **Construire l'APK**, puis le fichier `WakeUp-Pc.apk` dans les Releases du dépôt.

## Les messages en bas de l'écran

- Éteindre : envoyé, ou un message du même genre : l'ordre est bien parti.
- Injoignable, Tailscale est-il actif ? : le téléphone n'arrive pas à joindre l'appareil, vérifie Tailscale.
- token invalide : le token entré dans les réglages n'est pas le bon.
- verrouillé, réessaie plus tard : trop d'erreurs de token, l'agent s'est bloqué 15 minutes.
- origine refusée : l'adresse de ta page ne correspond pas à `ALLOWED_ORIGIN` dans l'agent.

## Bonnes pratiques

- Ne partage jamais les tokens, et n'envoie pas de capture d'écran des réglages.
- Si tu perds ton téléphone, va tout de suite dans la console Tailscale et retire l'appareil. Ensuite change les tokens dans l'agent.
- Si quelqu'un d'autre doit pouvoir utiliser l'appli, il lui faut son propre appareil connecté à ton compte Tailscale, ou un partage d'appareil depuis la console. Évite de lui donner ton compte.
- Évite d'éteindre le PC quand quelqu'un est en train de travailler dessus, un message prévient seulement 5 secondes avant.
- Garde le relais toujours branché, sinon tu ne pourras plus rien allumer à distance.

## Si ça ne marche toujours pas

Regarde la partie Si ça ne marche pas du `README.md`, elle liste les causes les plus courantes.
