# Publier WakeUp-Pc sur le Play Store

Ce guide explique comment transformer l'appli en vraie appli Android et la mettre sur le Play Store, depuis un téléphone, sans rien installer. Tout est compilé par GitHub.

## Ce qui est déjà prêt

- La transformation en appli Android avec Capacitor (fichier `capacitor.config.json`)
- Le niveau Android exigé par Google (API 36, obligatoire pour les nouvelles applis depuis le 31 août 2026)
- Les icônes et l'écran de démarrage, dessinés automatiquement par `tools/make_assets.py`
- La compilation et la signature de l'appli par GitHub (workflows `android.yml` et `keystore.yml`)
- La politique de confidentialité, que Google demande (`public/privacy.html`)
- Les images du Play Store : une icône 512 et une image de présentation, dans le dossier `playstore`

## Avant de commencer, à savoir

1. **Le compte développeur Google Play** coûte 25 dollars, une seule fois, et demande une pièce d'identité. Il faut compter quelques jours pour la vérification.
2. **Règle des 12 testeurs.** Si ton compte est un compte personnel créé après le 13 novembre 2023, Google oblige à faire un test fermé avec au moins 12 testeurs, qui doivent rester inscrits pendant 14 jours d'affilée, avant de pouvoir publier pour tout le monde. Compte environ 3 semaines pour la première publication. Un compte d'organisation n'a pas cette obligation, mais il demande un numéro D-U-N-S.
3. **Le nom du paquet** (`com.wakeuppc.app` dans `capacitor.config.json`) ne pourra plus jamais être changé après la première mise en ligne. Si tu veux un autre nom, change-le maintenant, par exemple `com.tonpseudo.wakeuppc`, en minuscules et sans espace.
4. Ces règles de Google changent souvent, vérifie-les dans la Play Console avant de payer.

## Étape 1 : mettre les nouveaux fichiers dans le dépôt

Les nouveaux fichiers sont :

```
.github/workflows/android.yml
.github/workflows/keystore.yml
public/privacy.html
tools/make_assets.py
capacitor.config.json
PLAYSTORE.md
```

Il y a aussi des fichiers modifiés (`package.json`, `agent.py`, `styles.css`, `deploy.yml`, `.gitignore`, `README.md`) : remplace leur contenu par les nouvelles versions.

Dans `public/privacy.html`, remplace `TON-EMAIL@exemple.com` par ton vrai e-mail de contact.

## Étape 2 : créer le jeton qui permet de ranger la clé

GitHub doit pouvoir enregistrer la clé de signature dans les secrets du dépôt. Pour ça, il lui faut un jeton.

1. Sur GitHub, va dans ton profil, Settings, puis tout en bas Developer settings, Personal access tokens, Fine-grained tokens, Generate new token.
2. Donne-lui un nom (par exemple `wakeup-secrets`) et une durée, par exemple 90 jours.
3. Dans Repository access, choisis Only select repositories, puis `WakeUp-Pc`.
4. Dans Permissions, Repository permissions, mets **Secrets** sur Read and write.
5. Génère le jeton et copie-le tout de suite, il ne sera plus affiché.
6. Dans ton dépôt, va dans Settings, Secrets and variables, Actions, New repository secret. Nom : `SECRETS_PAT`. Valeur : le jeton.

## Étape 3 : créer la clé de signature (une seule fois)

1. Va dans l'onglet Actions du dépôt.
2. Choisis le workflow Créer la clé de signature, puis Run workflow.
3. Quand le rond est vert, la clé est rangée dans les secrets, tu n'as plus rien à faire. Tu peux même supprimer le jeton `SECRETS_PAT` ensuite.

Ne relance pas ce workflow plus tard pour essayer d'avoir une autre clé : s'il voit que la clé existe déjà, il ne fait rien. Tu ne peux pas relire la clé depuis GitHub, donc si tu supprimes le secret, Google devra réinitialiser ta clé d'envoi (c'est possible, mais il faut contacter leur support).

## Étape 4 : construire l'appli

1. Dans Actions, choisis le workflow Construire l'appli Android, puis Run workflow.
2. Attends 5 à 10 minutes. Quand le rond est vert, ouvre l'exécution et descends jusqu'à Artifacts.
3. Télécharge `WakeUp-Pc-aab`, c'est un zip qui contient le fichier `WakeUp-Pc.aab`. Extrais-le avec l'appli Fichiers de ton téléphone.

Le numéro de version monte tout seul à chaque construction, donc tu peux refaire cette étape à chaque mise à jour.

Si le rond est rouge, ouvre l'exécution, regarde l'étape qui a échoué et envoie-moi le message d'erreur.

## Étape 5 : autoriser l'appli Android à parler au PC

L'appli installée depuis le Play Store n'a pas la même origine que ta page GitHub. Elle utilise `https://localhost`. Il faut donc l'autoriser dans l'agent. Sur le PC et sur le relais, change la variable ALLOWED_ORIGIN pour mettre les deux adresses séparées par une virgule :

```
set ALLOWED_ORIGIN=https://TON-PSEUDO.github.io,https://localhost
```

Sur le relais (Linux), c'est `export ALLOWED_ORIGIN=...` avec la même valeur.

## Étape 6 : créer la fiche dans la Play Console

Ouvre la Play Console depuis le navigateur de ton téléphone (si la page s'affiche mal, active l'option Version pour ordinateur du navigateur).

1. Crée l'application : nom WakeUp-Pc, langue par défaut français, type Application, gratuite.
2. Dans la fiche principale, mets les textes ci-dessous et les images du dossier `playstore` : `icon-512.png` pour l'icône et `feature-graphic.png` pour l'image de présentation.
3. Ajoute au moins 2 captures d'écran de ton téléphone. Prends-les depuis la vraie appli installée. Attention, n'affiche jamais ton adresse ni ton token dans une capture : fais-les sur l'écran principal.
4. Politique de confidentialité : colle l'adresse `https://TON-PSEUDO.github.io/WakeUp-Pc/privacy.html`.
5. Remplis les questionnaires obligatoires : classification du contenu, publicité (aucune), public cible (adultes, pas d'enfants), sécurité des données et accès à l'appli. Lis bien les questions de Google et réponds honnêtement. Pour la sécurité des données, l'appli ne collecte rien : tout reste sur le téléphone et les commandes ne vont que vers tes propres appareils.

### Textes à copier

**Nom (30 caractères maximum)**

```
WakeUp-Pc
```

**Description courte (80 caractères maximum)**

```
Allume, éteins et verrouille ton PC à distance, en toute sécurité.
```

**Description complète**

```
WakeUp-Pc te permet de contrôler ton ordinateur depuis ton téléphone, de n'importe où.

Allume ton PC à distance, puis verrouille-le, mets-le en veille, redémarre-le ou éteins-le en quelques appuis.

Les commandes passent par ton réseau privé Tailscale, chiffré, sans ouvrir aucun port sur ta box. Seuls tes propres appareils peuvent y accéder.

Pensée pour être simple : un seul écran, une confirmation avant d'éteindre ou de redémarrer, et un thème clair ou sombre automatique.

Important : l'appli a besoin du petit programme WakeUp-Pc installé sur ton ordinateur, d'un relais toujours allumé pour l'allumage à distance, et d'un compte Tailscale gratuit. Les explications d'installation sont disponibles dans le guide du projet sur GitHub.

Aucune publicité. Aucune collecte de données.
```

### L'accès à l'appli (point délicat)

Google demande comment ses testeurs peuvent utiliser ton appli. Comme elle ne marche qu'avec ton propre PC, un testeur de Google ne pourra pas la tester. Explique-le clairement dans la section Accès à l'appli (l'appli nécessite l'ordinateur de l'utilisateur, un relais et Tailscale) et ajoute un lien vers le guide. Si Google refuse malgré tout, une solution est d'ajouter un mode démo dans l'appli, avec un faux ordinateur, pour que les testeurs puissent voir les écrans. Je peux le faire si tu veux.

## Étape 7 : test fermé, puis production

1. Dans la Play Console, va dans Tests, Test fermé, et crée une version. Envoie le fichier `WakeUp-Pc.aab`.
2. Ajoute au moins 12 testeurs (leurs adresses Gmail) et envoie-leur le lien de test.
3. Les testeurs doivent installer l'appli et rester inscrits 14 jours d'affilée.
4. Ensuite, dans Production, demande l'accès à la production et réponds au questionnaire de Google. La vérification prend en général quelques jours.

## Mettre à jour l'appli plus tard

1. Modifie le code dans GitHub.
2. Relance le workflow Construire l'appli Android.
3. Télécharge le nouveau `.aab`, envoie-le dans une nouvelle version dans la Play Console.

La clé de signature est déjà là, et le numéro de version augmente seul.
