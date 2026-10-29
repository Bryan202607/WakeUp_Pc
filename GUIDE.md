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

Quand le PC est en ligne, tu as 4 lignes :

- Verrouiller : verrouille la session Windows, utile si tu l'as laissée ouverte.
- Mettre en veille : le PC se met en veille tout de suite.
- Redémarrer : le PC redémarre.
- Éteindre : le PC s'éteint complètement.

Pour Redémarrer et Éteindre, il faut appuyer deux fois. Au premier appui, la ligne devient rouge avec le message Appuie pour confirmer. Tu as 4 secondes pour appuyer une deuxième fois, sinon ça s'annule. C'est fait exprès pour éviter les mauvaises manips.

Attention, si tu éteins le PC, tu ne pourras plus le contrôler avant de l'avoir rallumé avec le bouton Allumer. Et si tu mets en veille, il peut ne pas se réveiller avec ce bouton selon la carte mère, donc teste avant de t'en servir à distance.

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
