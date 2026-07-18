const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const db = require('../database');

// ---------- CHAT ----------
router.post('/chat/ouvrir', (req, res) => {
  const { telephone, nom, customer_id } = req.body;
  if (!telephone) return res.status(400).json({ erreur: 'Numéro de téléphone requis' });

  const existant = db.prepare('SELECT * FROM conversations WHERE telephone = ?').get(telephone);
  if (!existant) {
    db.prepare('INSERT INTO conversations (telephone, nom, customer_id) VALUES (?,?,?)')
      .run(telephone, nom || null, customer_id || null);
  } else if (nom && !existant.nom) {
    db.prepare('UPDATE conversations SET nom = ? WHERE telephone = ?').run(nom, telephone);
  }
  const messages = db.prepare('SELECT * FROM messages WHERE telephone = ? ORDER BY envoye_le ASC').all(telephone);
  db.prepare('UPDATE conversations SET non_lus_client = 0 WHERE telephone = ?').run(telephone);
  res.json({ telephone, messages });
});

router.post('/chat/:telephone/envoyer', (req, res) => {
  const { telephone } = req.params;
  const { contenu } = req.body;
  if (!contenu || !contenu.trim()) return res.status(400).json({ erreur: 'Message vide' });

  const conv = db.prepare('SELECT * FROM conversations WHERE telephone = ?').get(telephone);
  if (!conv) return res.status(404).json({ erreur: 'Conversation introuvable' });

  const id = randomUUID();
  db.prepare('INSERT INTO messages (id, telephone, auteur, contenu) VALUES (?,?,?,?)')
    .run(id, telephone, 'client', contenu.trim());
  db.prepare('UPDATE conversations SET derniere_activite = CURRENT_TIMESTAMP, non_lus_admin = non_lus_admin + 1 WHERE telephone = ?')
    .run(telephone);

  // Chatbot d'absence : si l'admin est marqué hors-ligne, une réponse automatique part immédiatement
  const adminEnLigne = db.prepare(`SELECT valeur FROM settings WHERE cle = 'admin_en_ligne'`).get();
  let messageBot = null;
  if (adminEnLigne && adminEnLigne.valeur === '0') {
    const messageAbsence = db.prepare(`SELECT valeur FROM settings WHERE cle = 'message_absence'`).get();
    const texte = messageAbsence ? messageAbsence.valeur : 'Merci pour votre message, nous vous répondrons bientôt.';
    const botId = randomUUID();
    db.prepare('INSERT INTO messages (id, telephone, auteur, contenu) VALUES (?,?,?,?)')
      .run(botId, telephone, 'admin', `🤖 ${texte}`);
    db.prepare('UPDATE conversations SET non_lus_client = non_lus_client + 1 WHERE telephone = ?').run(telephone);
    messageBot = { id: botId, auteur: 'admin', contenu: `🤖 ${texte}` };
  }

  res.status(201).json({ id, auteur: 'client', contenu: contenu.trim(), messageBot });
});

router.get('/chat/:telephone/messages', (req, res) => {
  const messages = db.prepare('SELECT * FROM messages WHERE telephone = ? ORDER BY envoye_le ASC').all(req.params.telephone);
  res.json(messages);
});

// ---------- AVIS ----------
router.post('/avis', (req, res) => {
  const { nom, note, commentaire, customer_id } = req.body;
  const noteNum = Number(note);
  if (!nom || !noteNum || noteNum < 1 || noteNum > 5) {
    return res.status(400).json({ erreur: 'Nom et note (1 à 5) requis' });
  }
  const id = randomUUID();
  db.prepare('INSERT INTO reviews (id, customer_id, nom, note, commentaire, statut) VALUES (?,?,?,?,?,?)')
    .run(id, customer_id || null, nom, noteNum, commentaire || null, 'en_attente');
  res.status(201).json({ id, message: 'Merci ! Votre avis sera visible après modération.' });
});

router.get('/avis', (req, res) => {
  const avis = db.prepare('SELECT id, nom, note, commentaire, cree_le FROM reviews WHERE statut = ? ORDER BY cree_le DESC').all('approuve');
  res.json(avis);
});

// ---------- BOÎTE À IDÉES ----------
router.post('/idees', (req, res) => {
  const { nom, contenu } = req.body;
  if (!contenu || !contenu.trim()) return res.status(400).json({ erreur: 'Décrivez votre idée' });
  const id = randomUUID();
  db.prepare('INSERT INTO ideas (id, nom, contenu, statut) VALUES (?,?,?,?)')
    .run(id, nom || 'Anonyme', contenu.trim(), 'nouvelle');
  res.status(201).json({ id, message: 'Merci pour votre idée !' });
});

// ---------- NOTIFICATIONS ----------
router.get('/notifications', (req, res) => {
  const notifs = db.prepare('SELECT * FROM notifications ORDER BY cree_le DESC LIMIT 20').all();
  res.json(notifs);
});

module.exports = router;
