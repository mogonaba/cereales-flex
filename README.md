# 🌾 Céréales Flex

Site marchand agricole complet : céréales, farines, son, aliment pour bétail et volaille, couveuses, matériel d'élevage et d'agriculture — avec comptes clients vérifiés (CNIB), paiement échelonné, coupure à la source (banque/employeur), chat, avis, boîte à idées, notifications, **et un espace administrateur complet**.

## 🔍 Audit de ce projet — ce qui a été vérifié, corrigé, ajouté

**Vérification effectuée :** relecture complète des 13 fichiers serveur et des 2 applications front (site public + admin), vérification syntaxique (`node --check`) de tous les fichiers JS, vérification de la structure HTML, revue de la logique métier (calculs de livraison, échelonnement, promotions, stock).

**Bugs corrigés :**
- 🔴 **Faille de sécurité (XSS stocké)** : les avis, messages du chat, idées, noms/coordonnées saisis à la commande ou à l'inscription étaient injectés tels quels dans le HTML (`innerHTML`) — un client malveillant pouvait exécuter du code dans le navigateur d'un autre visiteur **ou de l'administrateur**. Corrigé par un échappement systématique de tout contenu utilisateur, côté site public et côté espace admin.
- 🟠 **Survente possible** : rien n'empêchait de commander plus d'articles que le stock réellement disponible. Une vérification bloque désormais la commande si le stock est insuffisant.
- 🟡 Dépendances déclarées mais jamais utilisées (`multer`, `uuid`) supprimées du `package.json`.

**Durcissement / efficacité :**
- En-têtes de sécurité HTTP (Helmet), compression gzip des réponses, mise en cache des fichiers statiques.
- Limitation de débit (rate limiting) sur la connexion, l'inscription et les formulaires publics (chat, avis, idées) pour freiner le bruteforce et le spam.
- Point de contrôle `/api/health` pour la supervision (utile pour Render ou tout monitoring externe).

**Fonctionnalités modernes ajoutées :**
- ❤️ **Liste de favoris** (persistée sur l'appareil) avec un onglet dédié dans la boutique.
- 🔀 **Tri du catalogue** (prix croissant/décroissant, nom, plus récents).
- 🌙 **Mode sombre** avec bascule manuelle et détection de la préférence système.
- 📱 **Application installable (PWA)** : manifeste + service worker pour un chargement plus rapide et une tolérance aux coupures réseau ponctuelles (les données commerciales — prix, stock — ne sont jamais mises en cache, uniquement la coquille de l'app).
- 🧭 **Suivi visuel des commandes** (étapes reçue → confirmée → en livraison → livrée) dans « Mon compte ».
- 📈 **Mini graphique des ventes des 7 derniers jours** sur le tableau de bord administrateur.
- 🚀 **`render.yaml`** pour un déploiement en un clic sur Render (Blueprint), en plus de la méthode manuelle déjà documentée.

## Ce que contient le projet

- **Backend** : Node.js + Express + SQLite (better-sqlite3), API REST complète
- **Frontend public** : site à onglets colorés avec barre décorative en pointillés (rappel des coutures d'un sac de grain), palette crème / or millet / terre-cuite / vert forêt, typographie Fraunces + Work Sans, illustration SVG originale d'un village (femme étalant le maïs à sécher) en page d'accueil
- **Comptes clients** : inscription avec CNIB (numéro + photos recto/verso), photo d'identité, email facultatif, consentement CIL obligatoire, connexion par téléphone + mot de passe, localité et géolocalisation facultative
- **Calculs intelligents** :
  - Livraison au juste prix (distance réelle via géolocalisation, formule de Haversine × tarif au km, avec minimum)
  - Paiement échelonné sur 1 à 6 mois (frais et montant mensuel calculés automatiquement)
  - Remise premium en pourcentage, cumulée avec les promotions actives
  - **Faveurs clients** : l'administrateur peut accorder à un client précis une remise automatique et/ou davantage de mois d'échelonnement, appliqués dès sa prochaine commande
  - **Promotions** : par produit ou par catégorie entière, avec dates de début/fin, affichées sur le catalogue (prix barré + badge) et appliquées automatiquement au panier
  - Demande de coupure à la source (banque ou employeur) — enregistrée avec mention claire que l'accord final se confirme hors-ligne
- **Paiement** : passerelles Orange Money, Moov/MobiCash, Wave, Visa, Mastercard — présentes et sélectionnables, **prêtes à être activées** dès que vous renseignez leurs clés API dans Admin > Paramètres (voir plus bas). Tant qu'aucune clé n'est fournie, elles restent visibles mais marquées « bientôt disponible » pour ne jamais induire le client en erreur.
- **Notifications email + SMS** : diffusion des changements de prix/promos vers tous les clients, avec configuration SMTP (email) et fournisseur SMS dans Admin > Paramètres. Fonctionne dès que vous renseignez vos identifiants ; reste silencieux (sans erreur) sinon.
- **Chatbox avec réponse automatique en l'absence de l'admin** : un bouton dans Admin > Paramètres bascule le statut En ligne / Hors-ligne ; en hors-ligne, chaque message client reçoit une réponse automatique immédiate (message personnalisable).
- **Catégories activables** : toutes les catégories (céréales, farines, son...) sont listées en permanence ; l'administrateur peut griser celles qui ne sont pas encore prêtes (« bientôt disponible ») sans supprimer leurs produits.
- **Fonctionnalités modernes** : chat client persistant, avis 5 étoiles avec modération, boîte à idées, ajout illimité de nouveaux articles avec prix et image
- **Espace admin** (`/admin`) : tableau de bord avec alertes, gestion des produits (avec image), promotions, disponibilité des catégories, suivi des commandes, validation KYC (visualisation des photos CNIB), faveurs clients, demandes de coupure à la source, messagerie clients, modération des avis, boîte à idées, diffusion de notifications email/SMS, réglages de livraison, paramètres de paiement et de notifications
- Adapté à tout type d'appareil (mobile, tablette, ordinateur)

## Activer les paiements, l'email et le SMS (après déploiement)

Rien de tout cela ne fonctionne « en dur » avec de fausses clés — c'est voulu, pour ne jamais afficher un faux succès de paiement. Voici comment les activer réellement :

1. **Orange Money / Wave / Moov-MobiCash** : ouvrez un compte marchand auprès du fournisseur, obtenez une clé API, puis dans Admin > Paramètres > Passerelles de paiement, cochez « Activer » et collez la clé. Le code d'intégration réel (appel HTTP à l'API du fournisseur) est à compléter dans `payments.js` — la structure et les commentaires y indiquent exactement où l'ajouter, en suivant la documentation officielle de chaque fournisseur.
2. **Visa / Mastercard** : nécessite une passerelle carte tierce habilitée en Afrique de l'Ouest (ex : CinetPay, PayDunya, Paystack) — le même fichier `payments.js` sert de point d'intégration.
3. **Email** : renseignez un hôte SMTP (Gmail, Zoho, votre hébergeur...) dans Admin > Paramètres > Notifications. Le module `nodemailer` est déjà installé et prêt.
4. **SMS** : renseignez le nom du fournisseur et sa clé API. L'appel HTTP réel est à compléter dans `notifications.js` (zone clairement indiquée), selon la documentation du fournisseur choisi (Orange SMS API, Twilio, etc.).



## Identifiants admin par défaut

À la première connexion, un compte admin est créé automatiquement :

- **Téléphone** : `00000000`
- **Mot de passe** : `CerealesFlex2026`

⚠️ **Changez ce mot de passe immédiatement** depuis Paramètres → Changer mon mot de passe une fois le site en ligne.

## Déploiement gratuit — GitHub + Render (pas à pas)

### Étape 1 — Mettre le code sur GitHub

1. Créez un compte sur [github.com](https://github.com) si vous n'en avez pas.
2. Cliquez sur **New repository**, nommez-le par exemple `cereales-flex`, laissez-le en **Public** ou **Private**, ne cochez aucune case d'initialisation.
3. Sur votre ordinateur, dans le dossier du projet :
   ```bash
   git init
   git add .
   git commit -m "Premier envoi du site Céréales Flex"
   git branch -M main
   git remote add origin https://github.com/VOTRE-NOM/cereales-flex.git
   git push -u origin main
   ```

### Étape 2 — Déployer sur Render

**Option rapide (recommandée) — via Blueprint :**
1. Créez un compte gratuit sur [render.com](https://render.com) (connexion directe avec GitHub possible).
2. Cliquez sur **New +** → **Blueprint**, puis sélectionnez votre dépôt `cereales-flex`.
3. Render détecte automatiquement le fichier `render.yaml` à la racine et propose de créer le service avec les bons réglages (Node, `npm install`, `npm start`, `JWT_SECRET` généré automatiquement). Cliquez sur **Apply**.

**Option manuelle :**
1. Cliquez sur **New +** → **Web Service**.
2. Connectez votre dépôt GitHub `cereales-flex`.
3. Renseignez :
   - **Name** : `cereales-flex` (ou ce que vous voulez)
   - **Region** : la plus proche de vos clients
   - **Branch** : `main`
   - **Runtime** : Node
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : Free
4. Dans **Environment Variables**, ajoutez :
   - `JWT_SECRET` = une longue phrase secrète aléatoire (ex : `changez-cette-phrase-en-quelque-chose-de-tres-long-et-unique`)
   - `NODE_ENV` = `production`
5. Cliquez sur **Create Web Service**. Render installe les dépendances et démarre le site automatiquement (~2-3 minutes).
6. Votre site est en ligne à une adresse du type `https://cereales-flex.onrender.com` — le site public est à la racine, l'espace admin à `/admin`.

**Important — plan gratuit Render** : le service gratuit se met en veille après 15 minutes d'inactivité et redémarre (environ 30-50 secondes) au prochain visiteur. C'est normal et gratuit. Le disque de la base SQLite est **éphémère sur le plan gratuit** — pour une persistance garantie des données sur le long terme, ajoutez un **Persistent Disk** Render (payant, quelques dollars/mois) monté sur `/opt/render/project/src/data`, ou migrez vers PostgreSQL géré (Render offre un plan gratuit PostgreSQL 90 jours).

### Mettre à jour le site après une modification

```bash
git add .
git commit -m "Description de la modification"
git push
```
Render redéploie automatiquement à chaque `push` sur `main`.

## Structure du projet

```
cereales-flex/
├── server.js              # Point d'entrée Express (sécurité, compression, rate limiting)
├── database.js            # Schéma SQLite + données de départ
├── utils.js                # Auth, calcul de livraison (Haversine), échelonnement
├── render.yaml             # Déploiement Render en un clic (Blueprint)
├── routes/
│   ├── products.js         # Catalogue, catégories
│   ├── orders.js            # Simulation & création de commandes (avec contrôle de stock)
│   ├── auth.js               # Inscription/connexion client (CNIB, CIL)
│   ├── deduction.js         # Coupure à la source
│   ├── public-features.js  # Chat, avis, idées, notifications
│   └── admin.js              # Toutes les routes de l'espace admin + statistiques de ventes
├── public/
│   ├── index.html, css/, js/   # Site public (favoris, tri, mode sombre, suivi commande)
│   ├── manifest.json, sw.js     # Application installable (PWA)
│   └── admin/                       # Espace administrateur (graphique de ventes)
└── data/cereales-flex.db     # Base SQLite (créée automatiquement)
```

## Ce qui a été vérifié

Tous les fichiers ont été vérifiés syntaxiquement (`node --check`), le HTML a été vérifié pour l'équilibre des balises, et le code a été relu ligne par ligne (logique métier, sécurité, gestion des erreurs). L'installation des dépendances n'a pas pu être testée dans l'environnement de génération (pas d'accès réseau) — Render l'effectuera automatiquement via `npm install` au déploiement. Avant votre premier déploiement, vous pouvez tester en local avec `npm install && npm start` pour vérifier que tout fonctionne sur votre machine.

## Prochaines étapes possibles

- Ajouter de vraies photos de produits (actuellement des icônes)
- Remplir les produits des catégories restantes
- Notifications push/SMS réelles (actuellement in-app uniquement)
- Passer à PostgreSQL pour une persistance garantie en production
- Authentification par code SMS (OTP) pour la récupération de mot de passe client
- Pagination des listes admin (produits, commandes, clients) si le catalogue grossit beaucoup

