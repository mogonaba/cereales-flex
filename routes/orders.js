const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const db = require('../database');
const { haversineKm, calculerLivraison, calculerEchelonnement, authMiddleware } = require('../utils');
const { initierPaiement, listerFournisseurs } = require('../payments');

function getSetting(cle) {
  const row = db.prepare('SELECT valeur FROM settings WHERE cle = ?').get(cle);
  return row ? row.valeur : null;
}

// Renvoie le prix unitaire après la meilleure promotion active applicable au produit (ou à sa catégorie)
function prixApresPromotion(produit) {
  const aujourdHui = new Date().toISOString();
  const promos = db.prepare(`
    SELECT * FROM promotions WHERE actif = 1
    AND (product_id = ? OR categorie_id = ?)
    AND (date_debut IS NULL OR date_debut <= ?)
    AND (date_fin IS NULL OR date_fin >= ?)
  `).all(produit.id, produit.categorie_id, aujourdHui, aujourdHui);
  if (promos.length === 0) return { prix: produit.prix_unitaire, promotion: null };
  const meilleure = promos.reduce((max, p) => p.reduction_pourcentage > max.reduction_pourcentage ? p : max, promos[0]);
  const prix = Math.round(produit.prix_unitaire * (1 - meilleure.reduction_pourcentage / 100));
  return { prix, promotion: { id: meilleure.id, nom: meilleure.nom, reduction_pourcentage: meilleure.reduction_pourcentage } };
}

// Calcule le devis complet (partagé entre simulation et création réelle)
function calculerDevis({ articles, latitude, longitude, remise_pourcentage, nb_tranches, customer_id }) {
  let sousTotal = 0;
  const detailsArticles = [];
  for (const art of articles) {
    const produit = db.prepare('SELECT * FROM products WHERE id = ? AND actif = 1').get(art.product_id);
    if (!produit) continue;
    const qte = Number(art.quantite) || 0;
    if (qte <= 0) continue;
    const { prix, promotion } = prixApresPromotion(produit);
    const sousTotalArticle = prix * qte;
    sousTotal += sousTotalArticle;
    detailsArticles.push({
      produit, qte, sousTotalArticle,
      nom: produit.nom, prix_unitaire: prix, prix_original: produit.prix_unitaire, promotion,
    });
  }

  const departLat = Number(getSetting('depart_latitude'));
  const departLon = Number(getSetting('depart_longitude'));
  const tarifKm = Number(getSetting('tarif_km'));
  const minimum = Number(getSetting('livraison_minimum'));
  const distanceKm = (latitude && longitude) ? haversineKm(departLat, departLon, Number(latitude), Number(longitude)) : null;
  const fraisLivraison = calculerLivraison(distanceKm, tarifKm, minimum);

  // Faveur admin : si le client a une remise spéciale accordée, elle s'applique au minimum
  // (le client garde le bénéfice même s'il ne demande pas explicitement la remise)
  let client = null;
  if (customer_id) client = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
  const remiseDemandee = Math.max(0, Math.min(30, Number(remise_pourcentage) || 0));
  const remiseFaveur = client ? Number(client.remise_faveur_pourcentage) || 0 : 0;
  const remisePourcent = Math.max(remiseDemandee, remiseFaveur);
  const montantRemise = Math.round(sousTotal * (remisePourcent / 100));

  const totalApresRemise = sousTotal - montantRemise + fraisLivraison;

  const trancheMaxDefaut = Number(getSetting('tranches_max')) || 6;
  const trancheMaxClient = client && client.tranches_max_faveur ? Number(client.tranches_max_faveur) : trancheMaxDefaut;

  let echelonnement = null;
  let total = totalApresRemise;
  if (nb_tranches && Number(nb_tranches) > 1) {
    const fraisPourcentParTranche = Number(getSetting('frais_echelonnement_pourcentage'));
    echelonnement = calculerEchelonnement(totalApresRemise, nb_tranches, fraisPourcentParTranche, trancheMaxClient);
    total = echelonnement.totalAvecFrais;
  }

  return {
    detailsArticles, sousTotal, distanceKm, fraisLivraison,
    remisePourcent, montantRemise, totalApresRemise, echelonnement, total,
    trancheMaxClient, remiseFaveurAppliquee: remiseFaveur > remiseDemandee,
  };
}

// ===== Fournisseurs de paiement disponibles (Orange Money, Wave, Visa...) =====
router.get('/paiement/fournisseurs', (req, res) => {
  res.json(listerFournisseurs());
});

// Simulation de calcul (panier -> devis complet), sans créer la commande
router.post('/orders/simuler', (req, res) => {
  const { articles, latitude, longitude, remise_pourcentage, nb_tranches, customer_id } = req.body;
  if (!Array.isArray(articles) || articles.length === 0) {
    return res.status(400).json({ erreur: 'Panier vide' });
  }
  const devis = calculerDevis({ articles, latitude, longitude, remise_pourcentage, nb_tranches, customer_id });

  res.json({
    articles: devis.detailsArticles.map(a => ({
      product_id: a.produit.id, nom: a.nom, prix_unitaire: a.prix_unitaire,
      prix_original: a.prix_original, promotion: a.promotion, quantite: a.qte, sous_total: a.sousTotalArticle,
    })),
    sous_total: devis.sousTotal,
    distance_km: devis.distanceKm ? Math.round(devis.distanceKm * 10) / 10 : null,
    frais_livraison: devis.fraisLivraison,
    remise_pourcentage: devis.remisePourcent,
    remise_faveur_appliquee: devis.remiseFaveurAppliquee,
    montant_remise: devis.montantRemise,
    total: devis.total,
    tranches_max_autorisees: devis.trancheMaxClient,
    echelonnement: devis.echelonnement,
  });
});

// Création réelle de la commande
router.post('/orders', async (req, res) => {
  const {
    articles, client_nom, client_telephone, client_localite,
    latitude, longitude, remise_pourcentage, nb_tranches, mode_paiement,
    fournisseur_paiement, customer_id,
  } = req.body;

  if (!Array.isArray(articles) || articles.length === 0 || !client_nom || !client_telephone) {
    return res.status(400).json({ erreur: 'Informations incomplètes' });
  }

  const devis = calculerDevis({ articles, latitude, longitude, remise_pourcentage, nb_tranches, customer_id });
  if (devis.detailsArticles.length === 0) return res.status(400).json({ erreur: 'Aucun article valide' });

  // Vérification du stock disponible juste avant la création, pour éviter la survente
  const enRupture = devis.detailsArticles.find(a => a.qte > a.produit.stock);
  if (enRupture) {
    return res.status(409).json({
      erreur: `Stock insuffisant pour "${enRupture.produit.nom}" (${enRupture.produit.stock} ${enRupture.produit.unite} disponible(s), ${enRupture.qte} demandé(s))`,
    });
  }

  const orderId = randomUUID();
  const nbTranchesFinal = devis.echelonnement ? devis.echelonnement.nbTranches : null;
  const fraisEchelonnement = devis.echelonnement ? devis.echelonnement.frais : 0;
  const montantParTranche = devis.echelonnement ? devis.echelonnement.montantParTranche : null;

  db.prepare(`INSERT INTO orders
    (id, customer_id, client_nom, client_telephone, client_localite, latitude, longitude,
     sous_total, frais_livraison, distance_km, remise_pourcentage, montant_remise, total,
     mode_paiement, nb_tranches, frais_echelonnement, montant_par_tranche,
     fournisseur_paiement, statut_paiement, statut)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(orderId, customer_id || null, client_nom, client_telephone, client_localite || null,
      latitude || null, longitude || null, devis.sousTotal, devis.fraisLivraison, devis.distanceKm,
      devis.remisePourcent, devis.montantRemise, devis.total, mode_paiement || 'comptant',
      nbTranchesFinal, fraisEchelonnement, montantParTranche,
      fournisseur_paiement || null, 'non_paye', 'en_attente');

  const insertItem = db.prepare(`INSERT INTO order_items
    (id, order_id, product_id, nom_produit, prix_unitaire, quantite, sous_total)
    VALUES (?,?,?,?,?,?,?)`);
  for (const a of devis.detailsArticles) {
    insertItem.run(randomUUID(), orderId, a.produit.id, a.nom, a.prix_unitaire, a.qte, a.sousTotalArticle);
    db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?').run(a.qte, a.produit.id);
  }

  let paiementInfo = null;
  if (fournisseur_paiement && fournisseur_paiement !== 'especes') {
    try {
      paiementInfo = await initierPaiement(fournisseur_paiement, { montant: devis.total, telephone: client_telephone, orderId });
    } catch (err) {
      paiementInfo = { statut: 'a_configurer', message: err.message };
    }
  }

  const commande = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  res.status(201).json({ ...commande, items, paiement: paiementInfo });
});

router.get('/orders/mes-commandes', authMiddleware, (req, res) => {
  const commandes = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY cree_le DESC').all(req.customer.id);
  const withItems = commandes.map(c => ({
    ...c, items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(c.id),
  }));
  res.json(withItems);
});

// Récupère une commande et vérifie qu'elle appartient bien au client connecté.
// Renvoie { erreurReponse } si la vérification échoue (à renvoyer telle quelle), sinon { commande }.
function commandeDuClient(orderId, customerId) {
  const commande = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!commande) return { erreurReponse: { statut: 404, corps: { erreur: 'Commande introuvable' } } };
  if (commande.customer_id !== customerId) {
    return { erreurReponse: { statut: 403, corps: { erreur: 'Cette commande ne vous appartient pas' } } };
  }
  return { commande };
}

// Modification d'une commande encore en attente par son propriétaire (articles, remise, tranches, adresse).
// Restaure le stock des anciens articles puis redéduit le stock des nouveaux, comme à la création.
router.put('/orders/:id', authMiddleware, (req, res) => {
  const { commande, erreurReponse } = commandeDuClient(req.params.id, req.customer.id);
  if (erreurReponse) return res.status(erreurReponse.statut).json(erreurReponse.corps);
  if (commande.statut !== 'en_attente') {
    return res.status(409).json({ erreur: 'Cette commande ne peut plus être modifiée (elle est déjà en cours de traitement)' });
  }

  const {
    articles, client_nom, client_localite, latitude, longitude,
    remise_pourcentage, nb_tranches, mode_paiement,
  } = req.body;
  if (!Array.isArray(articles) || articles.length === 0) {
    return res.status(400).json({ erreur: 'Panier vide' });
  }

  const devis = calculerDevis({
    articles, latitude, longitude, remise_pourcentage, nb_tranches, customer_id: req.customer.id,
  });
  if (devis.detailsArticles.length === 0) return res.status(400).json({ erreur: 'Aucun article valide' });

  try {
    const modifier = db.transaction(() => {
      // Remet en stock les quantités des anciens articles avant de vérifier/déduire les nouveaux
      const anciensArticles = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(commande.id);
      for (const a of anciensArticles) {
        if (a.product_id) db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(a.quantite, a.product_id);
      }

      const enRupture = devis.detailsArticles
        .map(a => ({ ...a, stockActuel: db.prepare('SELECT stock FROM products WHERE id = ?').get(a.produit.id).stock }))
        .find(a => a.qte > a.stockActuel);
      if (enRupture) {
        const err = new Error(`Stock insuffisant pour "${enRupture.produit.nom}" (${enRupture.stockActuel} ${enRupture.produit.unite} disponible(s), ${enRupture.qte} demandé(s))`);
        err.statutHttp = 409;
        throw err;
      }

      const nbTranchesFinal = devis.echelonnement ? devis.echelonnement.nbTranches : null;
      const fraisEchelonnement = devis.echelonnement ? devis.echelonnement.frais : 0;
      const montantParTranche = devis.echelonnement ? devis.echelonnement.montantParTranche : null;

      db.prepare(`UPDATE orders SET
        client_nom = COALESCE(?, client_nom), client_localite = COALESCE(?, client_localite),
        latitude = ?, longitude = ?, sous_total = ?, frais_livraison = ?, distance_km = ?,
        remise_pourcentage = ?, montant_remise = ?, total = ?, mode_paiement = COALESCE(?, mode_paiement),
        nb_tranches = ?, frais_echelonnement = ?, montant_par_tranche = ?
        WHERE id = ?`)
        .run(client_nom || null, client_localite || null, latitude || null, longitude || null,
          devis.sousTotal, devis.fraisLivraison, devis.distanceKm, devis.remisePourcent, devis.montantRemise,
          devis.total, mode_paiement || null, nbTranchesFinal, fraisEchelonnement, montantParTranche, commande.id);

      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(commande.id);
      const insertItem = db.prepare(`INSERT INTO order_items
        (id, order_id, product_id, nom_produit, prix_unitaire, quantite, sous_total)
        VALUES (?,?,?,?,?,?,?)`);
      for (const a of devis.detailsArticles) {
        insertItem.run(randomUUID(), commande.id, a.produit.id, a.nom, a.prix_unitaire, a.qte, a.sousTotalArticle);
        db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?').run(a.qte, a.produit.id);
      }
    });
    modifier();
  } catch (err) {
    return res.status(err.statutHttp || 500).json({ erreur: err.statutHttp ? err.message : 'Une erreur est survenue' });
  }

  const commandeMaj = db.prepare('SELECT * FROM orders WHERE id = ?').get(commande.id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(commande.id);
  res.json({ ...commandeMaj, items });
});

// Annulation d'une commande encore en attente par son propriétaire — remet le stock des articles.
router.delete('/orders/:id', authMiddleware, (req, res) => {
  const { commande, erreurReponse } = commandeDuClient(req.params.id, req.customer.id);
  if (erreurReponse) return res.status(erreurReponse.statut).json(erreurReponse.corps);
  if (commande.statut !== 'en_attente') {
    return res.status(409).json({ erreur: 'Cette commande ne peut plus être annulée (elle est déjà en cours de traitement)' });
  }

  const annuler = db.transaction(() => {
    const articles = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(commande.id);
    for (const a of articles) {
      if (a.product_id) db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(a.quantite, a.product_id);
    }
    db.prepare(`UPDATE orders SET statut = 'annulee' WHERE id = ?`).run(commande.id);
  });
  annuler();

  res.json({ ok: true });
});

module.exports = router;
