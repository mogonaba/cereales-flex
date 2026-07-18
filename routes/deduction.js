const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const db = require('../database');
const { authMiddleware } = require('../utils');

// Session dédiée : demande de coupure à la source via banque ou employeur
router.post('/deduction/demandes', authMiddleware, (req, res) => {
  const {
    order_id, type_source, nom_institution, contact_institution,
    reference_employe, document_autorisation, montant_total, nb_tranches,
  } = req.body;

  if (!['banque', 'employeur'].includes(type_source)) {
    return res.status(400).json({ erreur: 'Le type de source doit être "banque" ou "employeur"' });
  }
  if (!nom_institution || !montant_total) {
    return res.status(400).json({ erreur: 'Le nom de l\'institution et le montant sont obligatoires' });
  }

  const id = randomUUID();
  db.prepare(`INSERT INTO deduction_requests
    (id, customer_id, order_id, type_source, nom_institution, contact_institution,
     reference_employe, document_autorisation, montant_total, nb_tranches, statut)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, req.customer.id, order_id || null, type_source, nom_institution,
      contact_institution || null, reference_employe || null, document_autorisation || null,
      montant_total, nb_tranches || null, 'en_attente_autorisation');

  res.status(201).json({
    id, statut: 'en_attente_autorisation',
    message: `Votre demande de coupure à la source auprès de ${nom_institution} a été enregistrée. ` +
      `L'accord final est confirmé hors-ligne avec votre ${type_source === 'banque' ? 'banque' : 'employeur'} avant toute mise en place.`,
  });
});

router.get('/deduction/demandes/mes-demandes', authMiddleware, (req, res) => {
  const demandes = db.prepare('SELECT * FROM deduction_requests WHERE customer_id = ? ORDER BY cree_le DESC').all(req.customer.id);
  res.json(demandes);
});

module.exports = router;
