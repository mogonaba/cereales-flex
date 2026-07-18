const express = require('express');
const router = express.Router();
const db = require('../database');

function meilleurePromotion(produit) {
  const aujourdHui = new Date().toISOString();
  const promos = db.prepare(`
    SELECT * FROM promotions WHERE actif = 1
    AND (product_id = ? OR categorie_id = ?)
    AND (date_debut IS NULL OR date_debut <= ?)
    AND (date_fin IS NULL OR date_fin >= ?)
  `).all(produit.id, produit.categorie_id, aujourdHui, aujourdHui);
  if (promos.length === 0) return null;
  const meilleure = promos.reduce((max, p) => p.reduction_pourcentage > max.reduction_pourcentage ? p : max, promos[0]);
  return {
    nom: meilleure.nom,
    reduction_pourcentage: meilleure.reduction_pourcentage,
    prix_promo: Math.round(produit.prix_unitaire * (1 - meilleure.reduction_pourcentage / 100)),
  };
}

router.get('/categories', (req, res) => {
  const cats = db.prepare('SELECT * FROM categories ORDER BY ordre').all();
  res.json(cats);
});

router.get('/products', (req, res) => {
  const { categorie, q } = req.query;
  let sql = `SELECT p.*, c.nom as categorie_nom, c.slug as categorie_slug, c.disponible as categorie_disponible
             FROM products p LEFT JOIN categories c ON p.categorie_id = c.id
             WHERE p.actif = 1`;
  const params = [];
  if (categorie) {
    sql += ' AND c.slug = ?';
    params.push(categorie);
  }
  if (q) {
    sql += ' AND (p.nom LIKE ? OR p.description LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY p.cree_le DESC';
  const produits = db.prepare(sql).all(...params);
  const avecPromotions = produits.map(p => ({ ...p, promotion: meilleurePromotion(p) }));
  res.json(avecPromotions);
});

router.get('/products/:id', (req, res) => {
  const p = db.prepare(`SELECT p.*, c.nom as categorie_nom FROM products p
    LEFT JOIN categories c ON p.categorie_id = c.id WHERE p.id = ?`).get(req.params.id);
  if (!p) return res.status(404).json({ erreur: 'Produit introuvable' });
  res.json({ ...p, promotion: meilleurePromotion(p) });
});

module.exports = router;
