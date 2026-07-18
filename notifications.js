// Module d'envoi des notifications par email et SMS.
// Reste inactif (mais ne plante jamais) tant que les identifiants ne sont pas
// renseignés dans Admin > Paramètres > Notifications.

const db = require('./database');

function getSetting(cle) {
  const row = db.prepare('SELECT valeur FROM settings WHERE cle = ?').get(cle);
  return row ? row.valeur : null;
}

let transporteurEmail = null;
function obtenirTransporteurEmail() {
  if (getSetting('email_actif') !== '1') return null;
  if (transporteurEmail) return transporteurEmail;
  try {
    // nodemailer est en dépendance optionnelle : n'échoue pas si non installé,
    // ce qui permet au site de fonctionner même sans configuration email.
    const nodemailer = require('nodemailer');
    transporteurEmail = nodemailer.createTransport({
      host: getSetting('email_smtp_hote'),
      port: Number(getSetting('email_smtp_port')) || 587,
      auth: { user: getSetting('email_smtp_utilisateur'), pass: getSetting('email_smtp_mot_de_passe') },
    });
    return transporteurEmail;
  } catch {
    console.warn('nodemailer n\'est pas installé — ajoutez-le à package.json pour activer l\'envoi d\'emails réel.');
    return null;
  }
}

async function envoyerEmail(destinataire, sujet, contenu) {
  const transporteur = obtenirTransporteurEmail();
  if (!transporteur || !destinataire) return { envoye: false, raison: 'email non configuré ou destinataire manquant' };
  try {
    await transporteur.sendMail({ from: getSetting('email_expediteur'), to: destinataire, subject: sujet, text: contenu });
    return { envoye: true };
  } catch (err) {
    console.error('Erreur envoi email:', err.message);
    return { envoye: false, raison: err.message };
  }
}

// Envoi SMS générique — adapter l'appel HTTP au fournisseur choisi (Orange SMS API, Twilio, etc.)
async function envoyerSMS(telephone, message) {
  if (getSetting('sms_actif') !== '1') return { envoye: false, raison: 'SMS non configuré' };
  const cleApi = getSetting('sms_cle_api');
  const fournisseur = getSetting('sms_fournisseur');
  if (!cleApi || !fournisseur) return { envoye: false, raison: 'clé API ou fournisseur SMS manquant' };

  try {
    // ---- Zone d'intégration réelle, à adapter selon le fournisseur choisi -----------
    // Exemple générique :
    // const res = await fetch(`https://api.${fournisseur}.com/sms/send`, {
    //   method: 'POST',
    //   headers: { Authorization: `Bearer ${cleApi}`, 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ to: telephone, from: getSetting('sms_expediteur'), text: message }),
    // });
    // if (!res.ok) throw new Error(await res.text());
    // -----------------------------------------------------------------------------------
    console.log(`[SMS simulé — configurez ${fournisseur} pour un envoi réel] à ${telephone}: ${message}`);
    return { envoye: false, raison: `Intégration ${fournisseur} à finaliser dans notifications.js` };
  } catch (err) {
    return { envoye: false, raison: err.message };
  }
}

// Diffuse une notification (prix, promo...) à tous les clients par email + SMS,
// en respectant les canaux choisis pour cette notification.
async function diffuserNotification(notification) {
  const clients = db.prepare('SELECT telephone, email FROM customers').all();
  let nbEmails = 0, nbSms = 0;
  for (const client of clients) {
    if (notification.envoyer_email && client.email) {
      const res = await envoyerEmail(client.email, notification.titre, notification.contenu);
      if (res.envoye) nbEmails++;
    }
    if (notification.envoyer_sms && client.telephone) {
      const res = await envoyerSMS(client.telephone, `${notification.titre} — ${notification.contenu}`);
      if (res.envoye) nbSms++;
    }
  }
  db.prepare('UPDATE notifications SET nb_emails_envoyes = ?, nb_sms_envoyes = ? WHERE id = ?')
    .run(nbEmails, nbSms, notification.id);
  return { nbEmails, nbSms, totalClients: clients.length };
}

module.exports = { envoyerEmail, envoyerSMS, diffuserNotification };
