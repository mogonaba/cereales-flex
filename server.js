const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

require('./database'); // initialise et seed la base au démarrage

const app = express();
const PORT = process.env.PORT || 3000;

// Rendu derrière un proxy (Render) : nécessaire pour que express-rate-limit
// et les cookies "secure" identifient correctement l'IP réelle du client
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false, // le front utilise des styles/scripts inline volontairement
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
// 40 Mo : les fichiers (photos CNIB, images produits...) sont envoyés en base64 dans le JSON,
// ce qui gonfle leur taille d'environ 33% — un fichier de 25 Mo peut donc peser ~34 Mo une fois encodé.
app.use(express.json({ limit: '40mb' }));
app.use(express.urlencoded({ extended: true, limit: '40mb' }));

// Vérification de santé pour Render / supervision externe
app.get('/api/health', (req, res) => res.json({ ok: true, heure: new Date().toISOString() }));

// Limite les tentatives de connexion/inscription pour freiner le bruteforce et le spam
const limiteurAuth = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erreur: 'Trop de tentatives. Réessayez dans quelques minutes.' },
});
app.use(['/api/auth/connexion', '/api/auth/inscription', '/api/admin/connexion'], limiteurAuth);

// Limite le spam sur le chat, les avis et la boîte à idées (formulaires publics sans compte)
const limiteurFormulairesPublics = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erreur: 'Trop de messages envoyés. Merci de patienter un instant.' },
});
app.use(['/api/chat', '/api/avis', '/api/idees'], limiteurFormulairesPublics);

app.use('/api', require('./routes/products'));
app.use('/api', require('./routes/orders'));
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/deduction'));
app.use('/api', require('./routes/public-features'));
app.use('/api', require('./routes/admin'));

// Fichiers statiques : site public + espace admin
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// Toute autre route non-API sert la page d'accueil (SPA-friendly)
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erreur: 'Une erreur est survenue sur le serveur' });
});

app.listen(PORT, () => {
  console.log(`Céréales Flex — serveur démarré sur le port ${PORT}`);
});
