// Module des passerelles de paiement.
// Chaque fournisseur est un point d'intégration prêt à l'emploi : dès que vous renseignez
// les clés API dans Admin > Paramètres > Paiement, l'appel réel remplace la simulation.
// Tant qu'aucune clé n'est configurée, le fournisseur reste affiché mais inactif côté client.

const db = require('./database');

function getSetting(cle) {
  const row = db.prepare('SELECT valeur FROM settings WHERE cle = ?').get(cle);
  return row ? row.valeur : null;
}

const FOURNISSEURS = [
  { id: 'orange_money', nom: 'Orange Money', logo: '🟠', type: 'mobile_money' },
  { id: 'mobicash', nom: 'Moov / MobiCash', logo: '🔵', type: 'mobile_money' },
  { id: 'wave', nom: 'Wave', logo: '🌊', type: 'mobile_money' },
  { id: 'visa', nom: 'Visa', logo: '💳', type: 'carte_bancaire' },
  { id: 'mastercard', nom: 'Mastercard', logo: '💳', type: 'carte_bancaire' },
];

// Liste des fournisseurs avec leur statut de configuration (pour affichage client / admin)
function listerFournisseurs() {
  return FOURNISSEURS.map(f => ({
    ...f,
    actif: getSetting(`${f.id}_actif`) === '1',
    configure: !!getSetting(`${f.id}_cle_api`),
  }));
}

// Point d'entrée générique d'initiation de paiement.
// Retourne soit une redirection/référence réelle (une fois les clés API branchées),
// soit une erreur explicite si le fournisseur n'est pas encore configuré.
async function initierPaiement(fournisseurId, { montant, telephone, orderId }) {
  const fournisseur = FOURNISSEURS.find(f => f.id === fournisseurId);
  if (!fournisseur) throw new Error('Fournisseur de paiement inconnu');

  const actif = getSetting(`${fournisseurId}_actif`) === '1';
  const cleApi = getSetting(`${fournisseurId}_cle_api`);

  if (!actif || !cleApi) {
    throw new Error(
      `${fournisseur.nom} n'est pas encore configuré. ` +
      `Ajoutez votre clé API dans Admin > Paramètres > Paiement pour l'activer.`
    );
  }

  // ---- Zone d'intégration réelle -------------------------------------------------
  // Exemple à adapter à la documentation officielle de chaque fournisseur :
  //
  // if (fournisseurId === 'orange_money') {
  //   const res = await fetch('https://api.orange.com/orange-money-webpay/.../transactionstatus', {
  //     method: 'POST',
  //     headers: { Authorization: `Bearer ${cleApi}` },
  //     body: JSON.stringify({ amount: montant, currency: 'XOF', order_id: orderId }),
  //   });
  //   return await res.json();
  // }
  // if (fournisseurId === 'wave') { /* appel API Wave Checkout */ }
  // if (fournisseurId === 'visa' || fournisseurId === 'mastercard') { /* appel passerelle carte (ex: CinetPay, PayDunya) */ }
  // ---------------------------------------------------------------------------------

  return {
    statut: 'simule',
    message: `Clé API détectée pour ${fournisseur.nom}, mais l'appel réel n'est pas encore implémenté dans ce code. ` +
      `Suivez la documentation officielle de ${fournisseur.nom} pour finaliser l'intégration.`,
    reference: `SIMULATION-${Date.now()}`,
  };
}

module.exports = { listerFournisseurs, initierPaiement, FOURNISSEURS };
