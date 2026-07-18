const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { signToken, adminMiddleware, validerTailleBase64 } = require('../utils');

const TAILLE_MAX_IMAGE_MO = 25;
const { diffuserNotification } = require('../notifications');
const { listerFournisseurs } = require('../payments');

const COOKIE_OPTS = {
  httpOnly: true, sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// ===== AUTH =====
router.post('/admin/connexion', (req, res) => {
  const { telephone, mot_de_passe } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE telephone = ?').get(telephone);
  if (!admin || !bcrypt.compareSync(mot_de_passe || '', admin.mot_de_passe_hash)) {
    return res.status(401).json({ erreur: 'Identifiants incorrects' });
  }
  const token = signToken({ id: admin.id, type: 'admin', nom: admin.nom }, '7d');
  res.cookie('admin_token', token, COOKIE_OPTS);
  res.json({ id: admin.id, nom: admin.nom, telephone: admin.telephone });
});

router.post('/admin/deconnexion', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ ok: true });
});

router.get('/admin/moi', adminMiddleware, (req, res) => {
  const admin = db.prepare('SELECT id, nom, telephone FROM admins WHERE id = ?').get(req.admin.id);
  res.json(admin);
});

router.put('/admin/mot-de-passe', adminMiddleware, (req, res) => {
  const { ancien_mot_de_passe, nouveau_mot_de_passe } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!bcrypt.compareSync(ancien_mot_de_passe || '', admin.mot_de_passe_hash)) {
    return res.status(401).json({ erreur: 'Ancien mot de passe incorrect' });
  }
  if (!nouveau_mot_de_passe || nouveau_mot_de_passe.length < 6) {
    return res.status(400).json({ erreur: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
  }
  const hash = bcrypt.hashSync(nouveau_mot_de_passe, 10);
  db.prepare('UPDATE admins SET mot_de_passe_hash = ? WHERE id = ?').run(hash, req.admin.id);
  res.json({ ok: true });
});

// Toutes les routes ci-dessous nécessitent une connexion admin
router.use(adminMiddleware);

// ===== VENTES DES 7 DERNIERS JOURS (pour le graphique du tableau de bord) =====
router.get('/admin/statistiques/ventes-recentes', (req, res) => {
  const lignes = db.prepare(`
    SELECT date(cree_le) as jour, COALESCE(SUM(total),0) as total, COUNT(*) as nb
    FROM orders WHERE statut != 'annulee' AND cree_le >= date('now', '-6 days')
    GROUP BY date(cree_le)
  `).all();
  const parJour = {};
  lignes.forEach(l => parJour[l.jour] = l);
  const resultat = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const cle = d.toISOString().slice(0, 10);
    resultat.push({ jour: cle, total: parJour[cle] ? parJour[cle].total : 0, nb: parJour[cle] ? parJour[cle].nb : 0 });
  }
  res.json(resultat);
});

// ===== TABLEAU DE BORD =====
router.get('/admin/statistiques', (req, res) => {
  const nbCommandes = db.prepare('SELECT COUNT(*) n FROM orders').get().n;
  const nbCommandesEnAttente = db.prepare(`SELECT COUNT(*) n FROM orders WHERE statut = 'en_attente'`).get().n;
  const chiffreAffaires = db.prepare(`SELECT COALESCE(SUM(total),0) s FROM orders WHERE statut != 'annulee'`).get().s;
  const nbClients = db.prepare('SELECT COUNT(*) n FROM customers').get().n;
  const nbKycEnAttente = db.prepare(`SELECT COUNT(*) n FROM customers WHERE kyc_statut = 'en_attente'`).get().n;
  const nbProduits = db.prepare('SELECT COUNT(*) n FROM products WHERE actif = 1').get().n;
  const nbAvisEnAttente = db.prepare(`SELECT COUNT(*) n FROM reviews WHERE statut = 'en_attente'`).get().n;
  const nbIdeesNouvelles = db.prepare(`SELECT COUNT(*) n FROM ideas WHERE statut = 'nouvelle'`).get().n;
  const nbDeductionsEnAttente = db.prepare(`SELECT COUNT(*) n FROM deduction_requests WHERE statut = 'en_attente_autorisation'`).get().n;
  const messagesNonLus = db.prepare('SELECT COALESCE(SUM(non_lus_admin),0) n FROM conversations').get().n;
  const produitsStockBas = db.prepare('SELECT id, nom, stock, unite FROM products WHERE stock <= 10 AND actif = 1 ORDER BY stock ASC').all();

  res.json({
    nb_commandes: nbCommandes, nb_commandes_en_attente: nbCommandesEnAttente,
    chiffre_affaires: chiffreAffaires, nb_clients: nbClients,
    nb_kyc_en_attente: nbKycEnAttente, nb_produits: nbProduits,
    nb_avis_en_attente: nbAvisEnAttente, nb_idees_nouvelles: nbIdeesNouvelles,
    nb_deductions_en_attente: nbDeductionsEnAttente, messages_non_lus: messagesNonLus,
    produits_stock_bas: produitsStockBas,
  });
});

// ===== PRODUITS =====
router.get('/admin/produits', (req, res) => {
  const produits = db.prepare(`SELECT p.*, c.nom as categorie_nom FROM products p
    LEFT JOIN categories c ON p.categorie_id = c.id ORDER BY p.cree_le DESC`).all();
  res.json(produits);
});

router.post('/admin/produits', (req, res) => {
  const { categorie_id, nom, description, prix_unitaire, unite, stock, image } = req.body;
  if (!nom || !prix_unitaire || !categorie_id) return res.status(400).json({ erreur: 'Catégorie, nom et prix sont obligatoires' });
  const { valide, tailleMo } = validerTailleBase64(image, TAILLE_MAX_IMAGE_MO);
  if (!valide) {
    return res.status(413).json({ erreur: `Le fichier image est trop volumineux (${tailleMo.toFixed(1)} Mo). Taille maximale : ${TAILLE_MAX_IMAGE_MO} Mo.` });
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO products (id, categorie_id, nom, description, prix_unitaire, unite, stock, image)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, categorie_id, nom, description || null, prix_unitaire, unite || 'kg', stock || 0, image || null);
  res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
});

router.put('/admin/produits/:id', (req, res) => {
  const { categorie_id, nom, description, prix_unitaire, unite, stock, image, actif } = req.body;
  const existe = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!existe) return res.status(404).json({ erreur: 'Produit introuvable' });
  const { valide, tailleMo } = validerTailleBase64(image, TAILLE_MAX_IMAGE_MO);
  if (!valide) {
    return res.status(413).json({ erreur: `Le fichier image est trop volumineux (${tailleMo.toFixed(1)} Mo). Taille maximale : ${TAILLE_MAX_IMAGE_MO} Mo.` });
  }
  db.prepare(`UPDATE products SET categorie_id=?, nom=?, description=?, prix_unitaire=?, unite=?,
    stock=?, image=?, actif=?, modifie_le=CURRENT_TIMESTAMP WHERE id=?`)
    .run(categorie_id, nom, description || null, prix_unitaire, unite || 'kg', stock || 0,
      image || null, actif === undefined ? 1 : (actif ? 1 : 0), req.params.id);
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
});

router.delete('/admin/produits/:id', (req, res) => {
  db.prepare('UPDATE products SET actif = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== CATÉGORIES =====
router.post('/admin/categories', (req, res) => {
  const { nom, slug, icone, couleur } = req.body;
  if (!nom || !slug) return res.status(400).json({ erreur: 'Nom et slug requis' });
  const id = randomUUID();
  db.prepare('INSERT INTO categories (id, nom, slug, icone, couleur, ordre) VALUES (?,?,?,?,?,?)')
    .run(id, nom, slug, icone || '📦', couleur || 'or', 99);
  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
});

router.put('/admin/categories/:id/disponibilite', (req, res) => {
  const { disponible } = req.body;
  db.prepare('UPDATE categories SET disponible = ? WHERE id = ?').run(disponible ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// ===== PROMOTIONS =====
router.get('/admin/promotions', (req, res) => {
  const promos = db.prepare(`SELECT p.*, pr.nom as produit_nom, c.nom as categorie_nom
    FROM promotions p LEFT JOIN products pr ON p.product_id = pr.id
    LEFT JOIN categories c ON p.categorie_id = c.id ORDER BY p.cree_le DESC`).all();
  res.json(promos);
});

router.post('/admin/promotions', (req, res) => {
  const { nom, type_cible, product_id, categorie_id, reduction_pourcentage, date_debut, date_fin } = req.body;
  if (!nom || !reduction_pourcentage) return res.status(400).json({ erreur: 'Nom et pourcentage de réduction requis' });
  if (type_cible === 'produit' && !product_id) return res.status(400).json({ erreur: 'Choisissez un produit' });
  if (type_cible === 'categorie' && !categorie_id) return res.status(400).json({ erreur: 'Choisissez une catégorie' });
  const id = randomUUID();
  db.prepare(`INSERT INTO promotions (id, nom, type_cible, product_id, categorie_id, reduction_pourcentage, date_debut, date_fin)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, nom, type_cible, type_cible === 'produit' ? product_id : null,
      type_cible === 'categorie' ? categorie_id : null, reduction_pourcentage, date_debut || null, date_fin || null);
  res.status(201).json(db.prepare('SELECT * FROM promotions WHERE id = ?').get(id));
});

router.put('/admin/promotions/:id', (req, res) => {
  const { actif } = req.body;
  db.prepare('UPDATE promotions SET actif = ? WHERE id = ?').run(actif ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.delete('/admin/promotions/:id', (req, res) => {
  db.prepare('DELETE FROM promotions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== COMMANDES =====
router.get('/admin/commandes', (req, res) => {
  const { statut } = req.query;
  let sql = 'SELECT * FROM orders';
  const params = [];
  if (statut) { sql += ' WHERE statut = ?'; params.push(statut); }
  sql += ' ORDER BY cree_le DESC';
  const commandes = db.prepare(sql).all(...params);
  const withItems = commandes.map(c => ({ ...c, items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(c.id) }));
  res.json(withItems);
});

router.put('/admin/commandes/:id/statut', (req, res) => {
  const { statut } = req.body;
  const valides = ['en_attente', 'confirmee', 'en_livraison', 'livree', 'annulee'];
  if (!valides.includes(statut)) return res.status(400).json({ erreur: 'Statut invalide' });
  db.prepare('UPDATE orders SET statut = ? WHERE id = ?').run(statut, req.params.id);
  res.json({ ok: true });
});

// ===== CLIENTS & VALIDATION KYC (CNIB) =====
router.get('/admin/clients', (req, res) => {
  const { kyc_statut } = req.query;
  let sql = 'SELECT id, prenom, nom, telephone, localite, kyc_statut, cree_le FROM customers';
  const params = [];
  if (kyc_statut) { sql += ' WHERE kyc_statut = ?'; params.push(kyc_statut); }
  sql += ' ORDER BY cree_le DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/admin/clients/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ erreur: 'Client introuvable' });
  const { mot_de_passe_hash, ...safe } = client;
  res.json(safe);
});

router.put('/admin/clients/:id/kyc', (req, res) => {
  const { kyc_statut, kyc_note } = req.body;
  if (!['en_attente', 'valide', 'rejete'].includes(kyc_statut)) {
    return res.status(400).json({ erreur: 'Statut KYC invalide' });
  }
  db.prepare('UPDATE customers SET kyc_statut = ?, kyc_note = ? WHERE id = ?')
    .run(kyc_statut, kyc_note || null, req.params.id);
  res.json({ ok: true });
});

// Faveur admin : remise spéciale et/ou nombre de mois de paiement échelonné étendu pour un client précis
router.put('/admin/clients/:id/faveur', (req, res) => {
  const { remise_faveur_pourcentage, tranches_max_faveur, note_faveur_admin } = req.body;
  const remise = Math.max(0, Math.min(50, Number(remise_faveur_pourcentage) || 0));
  db.prepare('UPDATE customers SET remise_faveur_pourcentage = ?, tranches_max_faveur = ?, note_faveur_admin = ? WHERE id = ?')
    .run(remise, tranches_max_faveur || null, note_faveur_admin || null, req.params.id);
  res.json({ ok: true });
});

// ===== DEMANDES DE COUPURE À LA SOURCE =====
router.get('/admin/deductions', (req, res) => {
  const { statut } = req.query;
  let sql = `SELECT d.*, c.prenom, c.nom, c.telephone FROM deduction_requests d
             JOIN customers c ON d.customer_id = c.id`;
  const params = [];
  if (statut) { sql += ' WHERE d.statut = ?'; params.push(statut); }
  sql += ' ORDER BY d.cree_le DESC';
  res.json(db.prepare(sql).all(...params));
});

router.put('/admin/deductions/:id/statut', (req, res) => {
  const { statut, note_admin } = req.body;
  const valides = ['en_attente_autorisation', 'autorisee', 'refusee', 'active', 'terminee'];
  if (!valides.includes(statut)) return res.status(400).json({ erreur: 'Statut invalide' });
  db.prepare('UPDATE deduction_requests SET statut = ?, note_admin = ?, traite_le = CURRENT_TIMESTAMP WHERE id = ?')
    .run(statut, note_admin || null, req.params.id);
  res.json({ ok: true });
});

// ===== CONVERSATIONS (CHAT) =====
router.get('/admin/conversations', (req, res) => {
  const convs = db.prepare('SELECT * FROM conversations ORDER BY derniere_activite DESC').all();
  res.json(convs);
});

router.get('/admin/chat/:telephone', (req, res) => {
  const messages = db.prepare('SELECT * FROM messages WHERE telephone = ? ORDER BY envoye_le ASC').all(req.params.telephone);
  db.prepare('UPDATE conversations SET non_lus_admin = 0 WHERE telephone = ?').run(req.params.telephone);
  res.json(messages);
});

router.post('/admin/chat/:telephone/reply', (req, res) => {
  const { contenu } = req.body;
  if (!contenu || !contenu.trim()) return res.status(400).json({ erreur: 'Message vide' });
  const id = randomUUID();
  db.prepare('INSERT INTO messages (id, telephone, auteur, contenu) VALUES (?,?,?,?)')
    .run(id, req.params.telephone, 'admin', contenu.trim());
  db.prepare('UPDATE conversations SET derniere_activite = CURRENT_TIMESTAMP, non_lus_client = non_lus_client + 1 WHERE telephone = ?')
    .run(req.params.telephone);
  res.status(201).json({ id, auteur: 'admin', contenu: contenu.trim() });
});

// ===== AVIS (MODÉRATION) =====
router.get('/admin/avis', (req, res) => {
  const { statut } = req.query;
  let sql = 'SELECT * FROM reviews';
  const params = [];
  if (statut) { sql += ' WHERE statut = ?'; params.push(statut); }
  sql += ' ORDER BY cree_le DESC';
  res.json(db.prepare(sql).all(...params));
});

router.put('/admin/avis/:id/statut', (req, res) => {
  const { statut } = req.body;
  if (!['en_attente', 'approuve', 'rejete'].includes(statut)) return res.status(400).json({ erreur: 'Statut invalide' });
  db.prepare('UPDATE reviews SET statut = ? WHERE id = ?').run(statut, req.params.id);
  res.json({ ok: true });
});

// ===== BOÎTE À IDÉES =====
router.get('/admin/idees', (req, res) => {
  res.json(db.prepare('SELECT * FROM ideas ORDER BY cree_le DESC').all());
});

router.put('/admin/idees/:id', (req, res) => {
  const { statut, reponse_admin } = req.body;
  if (statut && !['nouvelle', 'en_cours', 'retenue', 'rejetee'].includes(statut)) {
    return res.status(400).json({ erreur: 'Statut invalide' });
  }
  db.prepare('UPDATE ideas SET statut = COALESCE(?, statut), reponse_admin = COALESCE(?, reponse_admin) WHERE id = ?')
    .run(statut || null, reponse_admin || null, req.params.id);
  res.json({ ok: true });
});

// ===== NOTIFICATIONS (diffusion prix, promos...) =====
router.post('/admin/notifications', async (req, res) => {
  const { titre, contenu, type, envoyer_email, envoyer_sms } = req.body;
  if (!titre || !contenu) return res.status(400).json({ erreur: 'Titre et contenu requis' });
  const id = randomUUID();
  db.prepare('INSERT INTO notifications (id, titre, contenu, type, envoyer_email, envoyer_sms) VALUES (?,?,?,?,?,?)')
    .run(id, titre, contenu, type || 'info', envoyer_email ? 1 : 0, envoyer_sms ? 1 : 0);
  const notification = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
  const resultatDiffusion = await diffuserNotification(notification);
  res.status(201).json({ id, diffusion: resultatDiffusion });
});

router.delete('/admin/notifications/:id', (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== PASSERELLES DE PAIEMENT (état de configuration) =====
router.get('/admin/paiement/fournisseurs', (req, res) => {
  res.json(listerFournisseurs());
});

// ===== PARAMÈTRES (tarifs livraison, point de départ, échelonnement) =====
router.get('/admin/parametres', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const obj = {};
  rows.forEach(r => obj[r.cle] = r.valeur);
  res.json(obj);
});

router.put('/admin/parametres', (req, res) => {
  const upsert = db.prepare('INSERT INTO settings (cle, valeur) VALUES (?,?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur');
  for (const [cle, valeur] of Object.entries(req.body)) {
    upsert.run(cle, String(valeur));
  }
  res.json({ ok: true });
});

module.exports = router;
