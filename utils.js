const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'cereales-flex-secret-change-in-production-2026';

function signToken(payload, expiresIn = '30d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// Distance à vol d'oiseau (km) - formule de Haversine
function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some(v => v === null || v === undefined || isNaN(v))) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculerLivraison(distanceKm, tarifKm, minimum) {
  if (distanceKm === null) return Number(minimum);
  const cout = distanceKm * tarifKm;
  return Math.round(Math.max(cout, minimum));
}

// nbTranches représente ici un nombre de MOIS (1 à 6, ou plus si une faveur admin l'autorise)
function calculerEchelonnement(total, nbTranches, pourcentageParTranche, maxTranches = 6) {
  nbTranches = Math.max(1, Math.min(maxTranches, Number(nbTranches) || 1));
  const fraisPourcent = nbTranches > 1 ? (nbTranches - 1) * Number(pourcentageParTranche) : 0;
  const frais = Math.round(total * (fraisPourcent / 100));
  const totalAvecFrais = total + frais;
  const montantParTranche = Math.round(totalAvecFrais / nbTranches);
  return { nbTranches, frais, totalAvecFrais, montantParTranche };
}

function authMiddleware(req, res, next) {
  const token = req.cookies?.customer_token || (req.headers.authorization || '').replace('Bearer ', '');
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.type !== 'customer') {
    return res.status(401).json({ erreur: 'Connexion requise' });
  }
  req.customer = payload;
  next();
}

// Valide qu'une chaîne base64 (data URI ou brute) ne dépasse pas la taille maximale autorisée (en Mo).
// Accepte n'importe quel format de fichier (image, PDF, etc.) — seule la taille est vérifiée ici.
function validerTailleBase64(donnee, maxMo = 25) {
  if (!donnee || typeof donnee !== 'string') return { valide: true, tailleMo: 0 };
  const virgule = donnee.indexOf(',');
  const partieBase64 = donnee.startsWith('data:') && virgule !== -1 ? donnee.slice(virgule + 1) : donnee;
  // Taille réelle approximative des octets encodés en base64
  const tailleOctets = (partieBase64.length * 3) / 4;
  const tailleMo = tailleOctets / (1024 * 1024);
  return { valide: tailleMo <= maxMo, tailleMo };
}

function adminMiddleware(req, res, next) {
  const token = req.cookies?.admin_token || (req.headers.authorization || '').replace('Bearer ', '');
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.type !== 'admin') {
    return res.status(401).json({ erreur: 'Accès administrateur requis' });
  }
  req.admin = payload;
  next();
}

module.exports = {
  signToken, verifyToken, haversineKm, calculerLivraison,
  calculerEchelonnement, authMiddleware, adminMiddleware, validerTailleBase64,
};
