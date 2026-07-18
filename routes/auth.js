const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { signToken, authMiddleware } = require('../utils');

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

// Inscription : infos CNIB + photos (base64) + consentement CIL obligatoire
router.post('/auth/inscription', (req, res) => {
  const {
    prenom, nom, telephone, email, mot_de_passe,
    cnib_numero, cnib_photo_recto, cnib_photo_verso, photo_identite,
    localite, latitude, longitude, cil_accepte,
  } = req.body;

  if (!prenom || !nom || !telephone || !mot_de_passe) {
    return res.status(400).json({ erreur: 'Prénom, nom, téléphone et mot de passe sont obligatoires' });
  }
  if (mot_de_passe.length < 6) {
    return res.status(400).json({ erreur: 'Le mot de passe doit contenir au moins 6 caractères' });
  }
  if (!cnib_numero || !cnib_photo_recto || !cnib_photo_verso || !photo_identite) {
    return res.status(400).json({ erreur: 'La CNIB (numéro, photo recto, photo verso) et une photo d\'identité sont obligatoires' });
  }
  if (!cil_accepte) {
    return res.status(400).json({ erreur: 'Vous devez accepter les conditions de protection des données (CIL) pour créer un compte' });
  }

  const existant = db.prepare('SELECT id FROM customers WHERE telephone = ?').get(telephone);
  if (existant) return res.status(409).json({ erreur: 'Un compte existe déjà avec ce numéro de téléphone' });

  const id = randomUUID();
  const hash = bcrypt.hashSync(mot_de_passe, 10);
  db.prepare(`INSERT INTO customers
    (id, prenom, nom, telephone, email, mot_de_passe_hash, cnib_numero, cnib_photo_recto, cnib_photo_verso,
     photo_identite, localite, latitude, longitude, cil_accepte, cil_accepte_le, kyc_statut)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, prenom, nom, telephone, email || null, hash, cnib_numero, cnib_photo_recto, cnib_photo_verso,
      photo_identite, localite || null, latitude || null, longitude || null, 1,
      new Date().toISOString(), 'en_attente');

  const token = signToken({ id, type: 'customer', telephone });
  res.cookie('customer_token', token, COOKIE_OPTS);
  res.status(201).json({
    id, prenom, nom, telephone, kyc_statut: 'en_attente',
    message: 'Compte créé. Votre pièce d\'identité est en cours de vérification par notre équipe.',
  });
});

router.post('/auth/connexion', (req, res) => {
  const { telephone, mot_de_passe } = req.body;
  if (!telephone || !mot_de_passe) return res.status(400).json({ erreur: 'Téléphone et mot de passe requis' });

  const client = db.prepare('SELECT * FROM customers WHERE telephone = ?').get(telephone);
  if (!client || !bcrypt.compareSync(mot_de_passe, client.mot_de_passe_hash)) {
    return res.status(401).json({ erreur: 'Téléphone ou mot de passe incorrect' });
  }

  const token = signToken({ id: client.id, type: 'customer', telephone: client.telephone });
  res.cookie('customer_token', token, COOKIE_OPTS);
  const { mot_de_passe_hash, ...safe } = client;
  res.json(safe);
});

router.post('/auth/deconnexion', (req, res) => {
  res.clearCookie('customer_token');
  res.json({ ok: true });
});

router.get('/auth/moi', authMiddleware, (req, res) => {
  const client = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.customer.id);
  if (!client) return res.status(404).json({ erreur: 'Compte introuvable' });
  const { mot_de_passe_hash, ...safe } = client;
  res.json(safe);
});

router.put('/auth/moi', authMiddleware, (req, res) => {
  const { localite, latitude, longitude, email } = req.body;
  db.prepare('UPDATE customers SET localite = ?, latitude = ?, longitude = ?, email = COALESCE(?, email) WHERE id = ?')
    .run(localite || null, latitude || null, longitude || null, email || null, req.customer.id);
  res.json({ ok: true });
});

// Suppression du compte client. L'historique des commandes est conservé pour la comptabilité
// (obligation légale et suivi des stocks), mais détaché du compte supprimé.
router.delete('/auth/moi', authMiddleware, (req, res) => {
  const client = db.prepare('SELECT id FROM customers WHERE id = ?').get(req.customer.id);
  if (!client) return res.status(404).json({ erreur: 'Compte introuvable' });

  const supprimer = db.transaction((customerId) => {
    db.prepare('UPDATE orders SET customer_id = NULL WHERE customer_id = ?').run(customerId);
    db.prepare('UPDATE deduction_requests SET customer_id = NULL WHERE customer_id = ?').run(customerId);
    db.prepare('DELETE FROM notification_lectures WHERE customer_id = ?').run(customerId);
    db.prepare('DELETE FROM customers WHERE id = ?').run(customerId);
  });
  supprimer(req.customer.id);

  res.clearCookie('customer_token');
  res.json({ ok: true, message: 'Votre compte a été supprimé.' });
});

module.exports = router;
