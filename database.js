const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'cereales-flex.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  telephone TEXT UNIQUE NOT NULL,
  mot_de_passe_hash TEXT NOT NULL,
  cree_le TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  prenom TEXT NOT NULL,
  nom TEXT NOT NULL,
  telephone TEXT UNIQUE NOT NULL,
  email TEXT,
  mot_de_passe_hash TEXT NOT NULL,
  cnib_numero TEXT,
  cnib_photo_recto TEXT,
  cnib_photo_verso TEXT,
  photo_identite TEXT,
  localite TEXT,
  latitude REAL,
  longitude REAL,
  cil_accepte INTEGER DEFAULT 0,
  cil_accepte_le TEXT,
  kyc_statut TEXT DEFAULT 'en_attente',
  kyc_note TEXT,
  remise_faveur_pourcentage REAL DEFAULT 0,
  tranches_max_faveur INTEGER,
  note_faveur_admin TEXT,
  cree_le TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  icone TEXT,
  couleur TEXT,
  ordre INTEGER DEFAULT 0,
  disponible INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  categorie_id TEXT REFERENCES categories(id),
  nom TEXT NOT NULL,
  description TEXT,
  prix_unitaire REAL NOT NULL,
  unite TEXT DEFAULT 'kg',
  stock REAL DEFAULT 0,
  image TEXT,
  actif INTEGER DEFAULT 1,
  cree_le TEXT DEFAULT CURRENT_TIMESTAMP,
  modifie_le TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  type_cible TEXT NOT NULL DEFAULT 'produit',
  product_id TEXT REFERENCES products(id),
  categorie_id TEXT REFERENCES categories(id),
  reduction_pourcentage REAL NOT NULL,
  date_debut TEXT,
  date_fin TEXT,
  actif INTEGER DEFAULT 1,
  cree_le TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  client_nom TEXT,
  client_telephone TEXT,
  client_localite TEXT,
  latitude REAL,
  longitude REAL,
  sous_total REAL NOT NULL,
  frais_livraison REAL DEFAULT 0,
  distance_km REAL,
  remise_pourcentage REAL DEFAULT 0,
  montant_remise REAL DEFAULT 0,
  total REAL NOT NULL,
  mode_paiement TEXT DEFAULT 'comptant',
  nb_tranches INTEGER,
  frais_echelonnement REAL DEFAULT 0,
  montant_par_tranche REAL,
  fournisseur_paiement TEXT,
  reference_paiement TEXT,
  statut_paiement TEXT DEFAULT 'non_paye',
  statut TEXT DEFAULT 'en_attente',
  cree_le TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES orders(id),
  product_id TEXT REFERENCES products(id),
  nom_produit TEXT,
  prix_unitaire REAL,
  quantite REAL,
  sous_total REAL
);

CREATE TABLE IF NOT EXISTS deduction_requests (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  order_id TEXT REFERENCES orders(id),
  type_source TEXT NOT NULL,
  nom_institution TEXT NOT NULL,
  contact_institution TEXT,
  reference_employe TEXT,
  document_autorisation TEXT,
  montant_total REAL,
  nb_tranches INTEGER,
  statut TEXT DEFAULT 'en_attente_autorisation',
  note_admin TEXT,
  cree_le TEXT DEFAULT CURRENT_TIMESTAMP,
  traite_le TEXT
);

CREATE TABLE IF NOT EXISTS conversations (
  telephone TEXT PRIMARY KEY,
  nom TEXT,
  customer_id TEXT,
  derniere_activite TEXT DEFAULT CURRENT_TIMESTAMP,
  non_lus_admin INTEGER DEFAULT 0,
  non_lus_client INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  telephone TEXT REFERENCES conversations(telephone),
  auteur TEXT NOT NULL,
  contenu TEXT NOT NULL,
  envoye_le TEXT DEFAULT CURRENT_TIMESTAMP,
  lu INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  nom TEXT NOT NULL,
  note INTEGER NOT NULL,
  commentaire TEXT,
  statut TEXT DEFAULT 'en_attente',
  cree_le TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  nom TEXT,
  contenu TEXT NOT NULL,
  statut TEXT DEFAULT 'nouvelle',
  reponse_admin TEXT,
  cree_le TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  titre TEXT NOT NULL,
  contenu TEXT NOT NULL,
  type TEXT DEFAULT 'info',
  envoyer_email INTEGER DEFAULT 1,
  envoyer_sms INTEGER DEFAULT 1,
  nb_emails_envoyes INTEGER DEFAULT 0,
  nb_sms_envoyes INTEGER DEFAULT 0,
  cree_le TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notification_lectures (
  notification_id TEXT REFERENCES notifications(id),
  customer_id TEXT REFERENCES customers(id),
  lu_le TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notification_id, customer_id)
);

CREATE TABLE IF NOT EXISTS settings (
  cle TEXT PRIMARY KEY,
  valeur TEXT
);
`);

// --- Seed default settings (delivery origin point, rates) ---
const defaultSettings = {
  depart_latitude: '12.3714',   // Ouagadougou approx
  depart_longitude: '-1.5197',
  tarif_km: '150',              // FCFA par km
  livraison_minimum: '1000',    // FCFA
  frais_echelonnement_pourcentage: '3', // % par mois de tranche additionnelle
  tranches_max: '6',            // paiement échelonné : jusqu'à 6 mois

  // Passerelles de paiement — désactivées tant que les clés API ne sont pas renseignées ici
  orange_money_actif: '0', orange_money_cle_api: '',
  mobicash_actif: '0', mobicash_cle_api: '',
  wave_actif: '0', wave_cle_api: '',
  visa_actif: '0', visa_cle_api: '',
  mastercard_actif: '0', mastercard_cle_api: '',

  // Notifications email / SMS — désactivées tant que non configurées
  email_actif: '0', email_smtp_hote: '', email_smtp_port: '587',
  email_smtp_utilisateur: '', email_smtp_mot_de_passe: '', email_expediteur: 'contact@cerealesflex.com',
  sms_actif: '0', sms_fournisseur: '', sms_cle_api: '', sms_expediteur: 'CerealesFlex',

  // Chat : disponibilité de l'admin (pour la réponse automatique en son absence)
  admin_en_ligne: '1',
  message_absence: 'Merci pour votre message ! Notre équipe n\'est pas disponible immédiatement mais vous répondra dans les meilleurs délais (généralement sous 24h). Nos horaires : Lundi-Samedi, 7h-19h.',
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (cle, valeur) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaultSettings)) insertSetting.run(k, v);

// --- Seed categories ---
const categories = [
  { nom: 'Céréales', slug: 'cereales', icone: '🌾', couleur: 'or' },
  { nom: 'Farines', slug: 'farines', icone: '🌰', couleur: 'terre' },
  { nom: 'Son', slug: 'son', icone: '🌿', couleur: 'vert' },
  { nom: 'Aliment bétail & volaille', slug: 'aliment-betail-volaille', icone: '🐓', couleur: 'or' },
  { nom: 'Couveuses', slug: 'couveuses', icone: '🥚', couleur: 'terre' },
  { nom: 'Matériel d\'élevage & agriculture', slug: 'materiel', icone: '🔧', couleur: 'vert' },
];
const insertCat = db.prepare('INSERT OR IGNORE INTO categories (id, nom, slug, icone, couleur, ordre) VALUES (?, ?, ?, ?, ?, ?)');
categories.forEach((c, i) => {
  const existing = db.prepare('SELECT id FROM categories WHERE slug = ?').get(c.slug);
  if (!existing) insertCat.run(randomUUID(), c.nom, c.slug, c.icone, c.couleur, i);
});

// --- Seed default admin (change on first login recommended) ---
const adminCount = db.prepare('SELECT COUNT(*) as n FROM admins').get().n;
if (adminCount === 0) {
  const hash = bcrypt.hashSync('CerealesFlex2026', 10);
  db.prepare('INSERT INTO admins (id, nom, telephone, mot_de_passe_hash) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), 'Administrateur', '00000000', hash);
  console.log('Admin par défaut créé — téléphone: 00000000 / mot de passe: CerealesFlex2026 (à changer !)');
}

module.exports = db;
