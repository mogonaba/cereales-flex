const API = '/api';

async function appel(url, opts = {}) {
  const res = await fetch(API + url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erreur || 'Une erreur est survenue');
  return data;
}

function toast(msg) {
  const zone = document.getElementById('toast-zone');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  zone.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function formatFCFA(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA'; }
// Échappe tout contenu injecté dans le HTML (noms/messages/avis viennent de clients non fiables ;
// sans cela, un client malveillant pourrait exécuter du code dans la session de l'administrateur)
function esc(valeur) {
  if (valeur === null || valeur === undefined) return '';
  return String(valeur)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function formatDate(d) { return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }

let categoriesCache = [];

// ===================== CONNEXION =====================
document.getElementById('form-admin-connexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const admin = await appel('/admin/connexion', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
    demarrerApp(admin);
  } catch (err) { toast(err.message); }
});

document.getElementById('btn-admin-deconnexion').addEventListener('click', async () => {
  await appel('/admin/deconnexion', { method: 'POST' });
  location.reload();
});

async function demarrerApp(admin) {
  document.getElementById('ecran-connexion').classList.add('masque');
  document.getElementById('app-admin').classList.remove('masque');
  document.getElementById('nom-admin-connecte').textContent = admin.nom;
  categoriesCache = await appel('/categories');
  const select = document.getElementById('select-categorie-produit');
  select.innerHTML = categoriesCache.map(c => `<option value="${c.id}">${c.nom}</option>`).join('');
  await Promise.all([chargerStats(), chargerProduits()]);
}

(async function verifierSession() {
  try {
    const admin = await appel('/admin/moi');
    demarrerApp(admin);
  } catch { /* pas connecté */ }
})();

// ===================== NAVIGATION =====================
document.querySelectorAll('.lien-nav[data-panneau]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.lien-nav').forEach(b => b.classList.remove('actif'));
    btn.classList.add('actif');
    document.querySelectorAll('.panneau-admin').forEach(p => p.classList.remove('actif'));
    document.getElementById('panneau-' + btn.dataset.panneau).classList.add('actif');
    const chargeurs = {
      'tableau-de-bord': chargerStats, produits: chargerProduits, promotions: chargerPromotions,
      categories: chargerCategoriesAdmin, commandes: () => chargerCommandes(''),
      clients: () => chargerClients(''), deductions: chargerDeductions, conversations: chargerConversations,
      avis: () => chargerAvis('en_attente'), idees: chargerIdees, notifications: chargerNotifications,
      parametres: chargerParametres,
    };
    chargeurs[btn.dataset.panneau]?.();
  });
});

// ===================== TABLEAU DE BORD =====================
async function chargerStats() {
  const s = await appel('/admin/statistiques');
  document.getElementById('grille-stats').innerHTML = `
    <div class="carte-stat"><div class="valeur">${s.nb_commandes}</div><div class="label">Commandes totales</div></div>
    <div class="carte-stat ${s.nb_commandes_en_attente > 0 ? 'alerte' : ''}"><div class="valeur">${s.nb_commandes_en_attente}</div><div class="label">Commandes en attente</div></div>
    <div class="carte-stat"><div class="valeur">${formatFCFA(s.chiffre_affaires)}</div><div class="label">Chiffre d'affaires</div></div>
    <div class="carte-stat"><div class="valeur">${s.nb_clients}</div><div class="label">Clients inscrits</div></div>
    <div class="carte-stat ${s.nb_kyc_en_attente > 0 ? 'alerte' : ''}"><div class="valeur">${s.nb_kyc_en_attente}</div><div class="label">Vérifications KYC en attente</div></div>
    <div class="carte-stat"><div class="valeur">${s.nb_produits}</div><div class="label">Produits actifs</div></div>
    <div class="carte-stat ${s.nb_avis_en_attente > 0 ? 'alerte' : ''}"><div class="valeur">${s.nb_avis_en_attente}</div><div class="label">Avis à modérer</div></div>
    <div class="carte-stat ${s.nb_idees_nouvelles > 0 ? 'alerte' : ''}"><div class="valeur">${s.nb_idees_nouvelles}</div><div class="label">Nouvelles idées</div></div>
    <div class="carte-stat ${s.nb_deductions_en_attente > 0 ? 'alerte' : ''}"><div class="valeur">${s.nb_deductions_en_attente}</div><div class="label">Coupures à autoriser</div></div>
    <div class="carte-stat ${s.messages_non_lus > 0 ? 'alerte' : ''}"><div class="valeur">${s.messages_non_lus}</div><div class="label">Messages non lus</div></div>`;

  document.getElementById('liste-stock-bas').innerHTML = s.produits_stock_bas.length === 0
    ? '<div class="vide">Aucun produit en stock bas.</div>'
    : s.produits_stock_bas.map(p => `<div style="padding:6px 0;border-bottom:1px solid var(--creme-fonce);">⚠️ <strong>${esc(p.nom)}</strong> — ${p.stock} ${esc(p.unite)} restants</div>`).join('');

  majPastille('pastille-commandes', s.nb_commandes_en_attente);
  majPastille('pastille-kyc', s.nb_kyc_en_attente);
  majPastille('pastille-deductions', s.nb_deductions_en_attente);
  majPastille('pastille-messages', s.messages_non_lus);
  majPastille('pastille-avis', s.nb_avis_en_attente);
  majPastille('pastille-idees', s.nb_idees_nouvelles);
  chargerGraphiqueVentes();
}

// ===== Mini graphique SVG des ventes des 7 derniers jours (sans dépendance externe) =====
async function chargerGraphiqueVentes() {
  const zone = document.getElementById('graphique-ventes');
  if (!zone) return;
  const jours = await appel('/admin/statistiques/ventes-recentes');
  const max = Math.max(1, ...jours.map(j => j.total));
  const largeur = 560, hauteur = 160, marge = 26, largeurBarre = (largeur - marge * 2) / jours.length - 10;
  const barres = jours.map((j, i) => {
    const h = Math.round((j.total / max) * (hauteur - 40));
    const x = marge + i * ((largeur - marge * 2) / jours.length);
    const y = hauteur - 24 - h;
    const label = new Date(j.jour).toLocaleDateString('fr-FR', { weekday: 'short' });
    return `
      <rect x="${x}" y="${y}" width="${largeurBarre}" height="${h}" rx="4" fill="var(--or-millet)"></rect>
      <text x="${x + largeurBarre / 2}" y="${hauteur - 6}" text-anchor="middle" font-size="10" fill="var(--texte-clair)">${label}</text>
      <title>${formatFCFA(j.total)} — ${j.nb} commande(s)</title>`;
  }).join('');
  zone.innerHTML = `<svg viewBox="0 0 ${largeur} ${hauteur}" style="width:100%;height:auto;">${barres}</svg>`;
}
function majPastille(id, n) {
  const el = document.getElementById(id);
  el.textContent = n;
  el.classList.toggle('masque', n === 0);
}

// ===================== PRODUITS =====================
async function chargerProduits() {
  const produits = await appel('/admin/produits');
  document.getElementById('tbody-produits').innerHTML = produits.map(p => `
    <tr>
      <td><strong>${esc(p.nom)}</strong></td>
      <td>${esc(p.categorie_nom || '')}</td>
      <td>${formatFCFA(p.prix_unitaire)} / ${p.unite}</td>
      <td>${p.stock}</td>
      <td>${p.actif ? '<span class="badge-statut badge-valide">Actif</span>' : '<span class="badge-statut badge-rejete">Désactivé</span>'}</td>
      <td>
        <button class="btn btn-fantome btn-petit" data-modifier="${p.id}">Modifier</button>
        <button class="btn btn-danger btn-petit" data-supprimer="${p.id}">Retirer</button>
      </td>
    </tr>`).join('');

  document.querySelectorAll('[data-modifier]').forEach(b => b.addEventListener('click', () => modifierProduit(produits.find(p => p.id === b.dataset.modifier))));
  document.querySelectorAll('[data-supprimer]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Retirer ce produit du catalogue ?')) return;
    await appel(`/admin/produits/${b.dataset.supprimer}`, { method: 'DELETE' });
    toast('Produit retiré');
    chargerProduits();
  }));
}

const TAILLE_MAX_IMAGE_MO = 25;

function fichierEnBase64(fichier) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(fichier);
  });
}

function reinitialiserZoneImageProduit() {
  document.getElementById('texte-image-produit').textContent = '📷 Choisir un fichier';
  document.getElementById('zone-image-produit').classList.remove('rempli');
  const apercu = document.getElementById('apercu-image-produit');
  apercu.src = '';
  apercu.classList.add('masque');
  document.getElementById('input-image-produit').value = '';
}

document.getElementById('input-image-produit').addEventListener('change', async (e) => {
  const fichier = e.target.files[0];
  if (!fichier) return;
  const tailleMo = fichier.size / (1024 * 1024);
  if (tailleMo > TAILLE_MAX_IMAGE_MO) {
    toast(`Fichier trop volumineux (${tailleMo.toFixed(1)} Mo). Taille maximale : ${TAILLE_MAX_IMAGE_MO} Mo.`);
    e.target.value = '';
    return;
  }
  const base64 = await fichierEnBase64(fichier);
  document.querySelector('#form-produit input[name=image]').value = base64;
  document.getElementById('texte-image-produit').textContent = '✅ ' + fichier.name;
  document.getElementById('zone-image-produit').classList.add('rempli');
  const apercu = document.getElementById('apercu-image-produit');
  if (fichier.type.startsWith('image/')) {
    apercu.src = base64;
    apercu.classList.remove('masque');
  } else {
    apercu.classList.add('masque');
  }
});

document.getElementById('btn-nouveau-produit').addEventListener('click', () => {
  document.getElementById('form-produit').reset();
  document.getElementById('form-produit').id.value = '';
  reinitialiserZoneImageProduit();
  document.getElementById('titre-form-produit').textContent = 'Nouveau produit';
  document.getElementById('carte-form-produit').classList.remove('masque');
});
document.getElementById('btn-annuler-produit').addEventListener('click', () => {
  document.getElementById('carte-form-produit').classList.add('masque');
});

function modifierProduit(p) {
  const form = document.getElementById('form-produit');
  form.id.value = p.id;
  form.categorie_id.value = p.categorie_id;
  form.nom.value = p.nom;
  form.description.value = p.description || '';
  form.prix_unitaire.value = p.prix_unitaire;
  form.unite.value = p.unite;
  form.stock.value = p.stock;
  reinitialiserZoneImageProduit();
  form.image.value = p.image || '';
  if (p.image) {
    document.getElementById('texte-image-produit').textContent = '✅ Image actuelle conservée (choisissez un fichier pour la remplacer)';
    document.getElementById('zone-image-produit').classList.add('rempli');
    const apercu = document.getElementById('apercu-image-produit');
    if (p.image.startsWith('data:image') || /^https?:\/\/.+\.(png|jpe?g|gif|webp|svg)$/i.test(p.image)) {
      apercu.src = p.image;
      apercu.classList.remove('masque');
    }
  }
  document.getElementById('titre-form-produit').textContent = 'Modifier le produit';
  document.getElementById('carte-form-produit').classList.remove('masque');
}

document.getElementById('form-produit').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const id = fd.get('id');
  const payload = Object.fromEntries(fd);
  try {
    if (id) await appel(`/admin/produits/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await appel('/admin/produits', { method: 'POST', body: JSON.stringify(payload) });
    toast('Produit enregistré');
    document.getElementById('carte-form-produit').classList.add('masque');
    chargerProduits();
  } catch (err) { toast(err.message); }
});

// ===================== COMMANDES =====================
document.querySelectorAll('#filtres-commandes .sous-onglet-admin').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#filtres-commandes .sous-onglet-admin').forEach(x => x.classList.remove('actif'));
    b.classList.add('actif');
    chargerCommandes(b.dataset.statut);
  });
});

async function chargerCommandes(statut) {
  const commandes = await appel('/admin/commandes' + (statut ? `?statut=${statut}` : ''));
  const statuts = ['en_attente', 'confirmee', 'en_livraison', 'livree', 'annulee'];
  document.getElementById('tbody-commandes').innerHTML = commandes.map(c => `
    <tr>
      <td><strong>${esc(c.client_nom)}</strong><br><small>${esc(c.client_telephone)}</small></td>
      <td>${c.items.map(i => `${esc(i.nom_produit)} × ${i.quantite}`).join(', ')}</td>
      <td>${formatFCFA(c.total)}</td>
      <td>${c.mode_paiement === 'echelonne' ? `Échelonné (${c.nb_tranches}x)` : 'Comptant'}</td>
      <td>
        <select class="select-statut" data-commande="${c.id}">
          ${statuts.map(s => `<option value="${s}" ${s === c.statut ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}
        </select>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" class="vide">Aucune commande</td></tr>';

  document.querySelectorAll('[data-commande]').forEach(sel => sel.addEventListener('change', async () => {
    await appel(`/admin/commandes/${sel.dataset.commande}/statut`, { method: 'PUT', body: JSON.stringify({ statut: sel.value }) });
    toast('Statut mis à jour');
    chargerStats();
  }));
}

// ===================== CLIENTS & KYC =====================
document.querySelectorAll('#filtres-kyc .sous-onglet-admin').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#filtres-kyc .sous-onglet-admin').forEach(x => x.classList.remove('actif'));
    b.classList.add('actif');
    chargerClients(b.dataset.kyc);
  });
});

async function chargerClients(kyc) {
  const clients = await appel('/admin/clients' + (kyc ? `?kyc_statut=${kyc}` : ''));
  document.getElementById('tbody-clients').innerHTML = clients.map(c => `
    <tr>
      <td>${esc(c.prenom)} ${esc(c.nom)}</td>
      <td>${esc(c.telephone)}</td>
      <td>${esc(c.localite || '—')}</td>
      <td><span class="badge-statut badge-${c.kyc_statut}">${c.kyc_statut.replace('_', ' ')}</span></td>
      <td><button class="btn btn-fantome btn-petit" data-voir-client="${c.id}">Voir le dossier</button></td>
    </tr>`).join('') || '<tr><td colspan="5" class="vide">Aucun client</td></tr>';

  document.querySelectorAll('[data-voir-client]').forEach(b => b.addEventListener('click', () => voirDossierClient(b.dataset.voirClient)));
}

async function voirDossierClient(id) {
  const c = await appel(`/admin/clients/${id}`);
  const carte = document.getElementById('carte-detail-client');
  carte.classList.remove('masque');
  carte.innerHTML = `
    <h3>${esc(c.prenom)} ${esc(c.nom)}</h3>
    <p><strong>Téléphone :</strong> ${esc(c.telephone)} — <strong>Localité :</strong> ${esc(c.localite || '—')}</p>
    <p><strong>N° CNIB :</strong> ${esc(c.cnib_numero || '—')}</p>
    <p><strong>Consentement CIL :</strong> ${c.cil_accepte ? '✅ accepté le ' + formatDate(c.cil_accepte_le) : '❌ non accepté'}</p>
    <div class="grille-docs">
      ${c.cnib_photo_recto ? `<div><small>CNIB recto</small><img class="miniature-doc" src="${c.cnib_photo_recto}" onclick="window.open(this.src)"></div>` : ''}
      ${c.cnib_photo_verso ? `<div><small>CNIB verso</small><img class="miniature-doc" src="${c.cnib_photo_verso}" onclick="window.open(this.src)"></div>` : ''}
      ${c.photo_identite ? `<div><small>Photo d'identité</small><img class="miniature-doc" src="${c.photo_identite}" onclick="window.open(this.src)"></div>` : ''}
    </div>
    <div class="champ"><label>Statut de vérification</label>
      <select id="select-kyc-statut">
        <option value="en_attente" ${c.kyc_statut === 'en_attente' ? 'selected' : ''}>En attente</option>
        <option value="valide" ${c.kyc_statut === 'valide' ? 'selected' : ''}>Validé</option>
        <option value="rejete" ${c.kyc_statut === 'rejete' ? 'selected' : ''}>Rejeté</option>
      </select>
    </div>
    <div class="champ"><label>Note interne</label><textarea id="note-kyc" rows="2">${esc(c.kyc_note || '')}</textarea></div>
    <button class="btn btn-vert" id="btn-enregistrer-kyc">Enregistrer la vérification</button>

    <hr style="border:none;border-top:1px solid var(--creme-fonce);margin:18px 0;">
    <h3>🎁 Faveur pour ce client</h3>
    <p style="font-size:.85rem;color:var(--texte-clair);">Accordez une remise automatique et/ou davantage de mois d'échelonnement à ce client précis. Elle s'applique dès sa prochaine commande, sans qu'il ait besoin de la demander.</p>
    <div class="ligne-2">
      <div class="champ"><label>Remise automatique (%)</label><input type="number" id="faveur-remise" min="0" max="50" value="${c.remise_faveur_pourcentage || 0}"></div>
      <div class="champ"><label>Mois d'échelonnement max. autorisés</label><input type="number" id="faveur-tranches" min="1" max="24" value="${c.tranches_max_faveur || ''}" placeholder="par défaut : 6"></div>
    </div>
    <div class="champ"><label>Note (facultatif)</label><input type="text" id="faveur-note" value="${esc(c.note_faveur_admin || '')}" placeholder="Ex : client fidèle, accord spécial..."></div>
    <button class="btn btn-terre" id="btn-enregistrer-faveur">Enregistrer la faveur</button>`;

  document.getElementById('btn-enregistrer-kyc').addEventListener('click', async () => {
    const kyc_statut = document.getElementById('select-kyc-statut').value;
    const kyc_note = document.getElementById('note-kyc').value;
    await appel(`/admin/clients/${id}/kyc`, { method: 'PUT', body: JSON.stringify({ kyc_statut, kyc_note }) });
    toast('Vérification mise à jour');
    chargerClients('');
    chargerStats();
  });

  document.getElementById('btn-enregistrer-faveur').addEventListener('click', async () => {
    const remise_faveur_pourcentage = document.getElementById('faveur-remise').value;
    const tranches_max_faveur = document.getElementById('faveur-tranches').value || null;
    const note_faveur_admin = document.getElementById('faveur-note').value;
    await appel(`/admin/clients/${id}/faveur`, { method: 'PUT', body: JSON.stringify({ remise_faveur_pourcentage, tranches_max_faveur, note_faveur_admin }) });
    toast('Faveur enregistrée pour ce client');
  });
}

// ===================== DÉDUCTIONS =====================
async function chargerDeductions() {
  const demandes = await appel('/admin/deductions');
  const statuts = ['en_attente_autorisation', 'autorisee', 'refusee', 'active', 'terminee'];
  document.getElementById('tbody-deductions').innerHTML = demandes.map(d => `
    <tr>
      <td>${esc(d.prenom)} ${esc(d.nom)}<br><small>${esc(d.telephone)}</small></td>
      <td>${esc(d.nom_institution)}<br><small>${esc(d.type_source)}</small></td>
      <td>${formatFCFA(d.montant_total)}</td>
      <td>${d.nb_tranches}</td>
      <td>
        <select class="select-statut" data-deduction="${d.id}">
          ${statuts.map(s => `<option value="${s}" ${s === d.statut ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}
        </select>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" class="vide">Aucune demande</td></tr>';

  document.querySelectorAll('[data-deduction]').forEach(sel => sel.addEventListener('change', async () => {
    await appel(`/admin/deductions/${sel.dataset.deduction}/statut`, { method: 'PUT', body: JSON.stringify({ statut: sel.value }) });
    toast('Statut mis à jour');
    chargerStats();
  }));
}

// ===================== CONVERSATIONS =====================
let conversationActive = null;
async function chargerConversations() {
  const convs = await appel('/admin/conversations');
  document.getElementById('conv-liste').innerHTML = convs.map(c => `
    <div class="conv-item ${c.telephone === conversationActive ? 'actif' : ''}" data-conv="${c.telephone}">
      <strong>${esc(c.nom || c.telephone)}</strong>
      <small>${esc(c.telephone)} ${c.non_lus_admin > 0 ? '• 🔴 ' + c.non_lus_admin + ' non lu(s)' : ''}</small>
    </div>`).join('') || '<div class="vide">Aucune conversation</div>';

  document.querySelectorAll('[data-conv]').forEach(el => el.addEventListener('click', () => ouvrirConversation(el.dataset.conv)));
}

async function ouvrirConversation(telephone) {
  conversationActive = telephone;
  chargerConversations();
  const messages = await appel(`/admin/chat/${telephone}`);
  document.getElementById('conv-messages').innerHTML = messages.map(m => `<div class="bulle ${esc(m.auteur)}">${esc(m.contenu)}</div>`).join('') || '<div class="vide">Aucun message</div>';
  document.getElementById('conv-messages').scrollTop = 999999;
}

document.getElementById('btn-conv-envoyer').addEventListener('click', envoyerReponseAdmin);
document.getElementById('conv-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') envoyerReponseAdmin(); });
async function envoyerReponseAdmin() {
  const input = document.getElementById('conv-input');
  const contenu = input.value.trim();
  if (!contenu || !conversationActive) return;
  input.value = '';
  await appel(`/admin/chat/${conversationActive}/reply`, { method: 'POST', body: JSON.stringify({ contenu }) });
  ouvrirConversation(conversationActive);
}

// ===================== AVIS =====================
document.querySelectorAll('#filtres-avis .sous-onglet-admin').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#filtres-avis .sous-onglet-admin').forEach(x => x.classList.remove('actif'));
    b.classList.add('actif');
    chargerAvis(b.dataset.statutAvis);
  });
});

async function chargerAvis(statut) {
  const avis = await appel('/admin/avis' + (statut ? `?statut=${statut}` : ''));
  document.getElementById('liste-avis-admin').innerHTML = avis.map(a => `
    <div class="carte">
      <div style="display:flex;justify-content:space-between;">
        <strong>${esc(a.nom)}</strong>
        <span>${'★'.repeat(a.note)}${'☆'.repeat(5 - a.note)}</span>
      </div>
      <p style="color:var(--texte-clair);">${esc(a.commentaire || '')}</p>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-vert btn-petit" data-avis-approuver="${a.id}">Approuver</button>
        <button class="btn btn-danger btn-petit" data-avis-rejeter="${a.id}">Rejeter</button>
      </div>
    </div>`).join('') || '<div class="vide">Aucun avis</div>';

  document.querySelectorAll('[data-avis-approuver]').forEach(b => b.addEventListener('click', async () => {
    await appel(`/admin/avis/${b.dataset.avisApprouver}/statut`, { method: 'PUT', body: JSON.stringify({ statut: 'approuve' }) });
    toast('Avis approuvé'); chargerAvis(document.querySelector('#filtres-avis .actif').dataset.statutAvis); chargerStats();
  }));
  document.querySelectorAll('[data-avis-rejeter]').forEach(b => b.addEventListener('click', async () => {
    await appel(`/admin/avis/${b.dataset.avisRejeter}/statut`, { method: 'PUT', body: JSON.stringify({ statut: 'rejete' }) });
    toast('Avis rejeté'); chargerAvis(document.querySelector('#filtres-avis .actif').dataset.statutAvis); chargerStats();
  }));
}

// ===================== IDÉES =====================
async function chargerIdees() {
  const idees = await appel('/admin/idees');
  const statuts = ['nouvelle', 'en_cours', 'retenue', 'rejetee'];
  document.getElementById('liste-idees-admin').innerHTML = idees.map(i => `
    <div class="carte">
      <div style="display:flex;justify-content:space-between;">
        <strong>${esc(i.nom || 'Anonyme')}</strong>
        <select class="select-statut" data-idee="${i.id}">
          ${statuts.map(s => `<option value="${s}" ${s === i.statut ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}
        </select>
      </div>
      <p style="color:var(--texte-clair);">${esc(i.contenu)}</p>
      <small>${formatDate(i.cree_le)}</small>
    </div>`).join('') || '<div class="vide">Aucune idée pour le moment</div>';

  document.querySelectorAll('[data-idee]').forEach(sel => sel.addEventListener('change', async () => {
    await appel(`/admin/idees/${sel.dataset.idee}`, { method: 'PUT', body: JSON.stringify({ statut: sel.value }) });
    toast('Idée mise à jour'); chargerStats();
  }));
}

// ===================== NOTIFICATIONS =====================
document.getElementById('form-notification').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await appel('/admin/notifications', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
  toast('Notification publiée');
  e.target.reset();
  chargerNotifications();
});

async function chargerNotifications() {
  const notifs = await appel('/notifications');
  document.getElementById('liste-notifications-admin').innerHTML = notifs.map(n => `
    <div class="carte" style="display:flex;justify-content:space-between;align-items:center;">
      <div><strong>${esc(n.titre)}</strong><p style="color:var(--texte-clair);margin:4px 0;">${esc(n.contenu)}</p><small>${formatDate(n.cree_le)}</small></div>
      <button class="btn btn-danger btn-petit" data-suppr-notif="${n.id}">Supprimer</button>
    </div>`).join('') || '<div class="vide">Aucune notification publiée</div>';

  document.querySelectorAll('[data-suppr-notif]').forEach(b => b.addEventListener('click', async () => {
    await appel(`/admin/notifications/${b.dataset.supprNotif}`, { method: 'DELETE' });
    chargerNotifications();
  }));
}

// ===================== PROMOTIONS =====================
document.getElementById('select-type-cible-promo').addEventListener('change', (e) => {
  document.getElementById('champ-promo-produit').classList.toggle('masque', e.target.value !== 'produit');
  document.getElementById('champ-promo-categorie').classList.toggle('masque', e.target.value !== 'categorie');
});

async function chargerPromotions() {
  const [produits, promos] = await Promise.all([appel('/admin/produits'), appel('/admin/promotions')]);
  const selectProduit = document.getElementById('select-produit-promo');
  const selectCategorie = document.getElementById('select-categorie-promo');
  if (!selectProduit.dataset.charge) {
    selectProduit.innerHTML = produits.map(p => `<option value="${p.id}">${p.nom}</option>`).join('');
    selectCategorie.innerHTML = categoriesCache.map(c => `<option value="${c.id}">${c.nom}</option>`).join('');
    selectProduit.dataset.charge = '1';
  }

  document.getElementById('liste-promotions').innerHTML = promos.map(p => `
    <div class="carte" style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <strong>${p.nom}</strong> — ${p.reduction_pourcentage}% de réduction<br>
        <small style="color:var(--texte-clair);">${p.type_cible === 'produit' ? 'Produit : ' + (p.produit_nom || '—') : 'Catégorie : ' + (p.categorie_nom || '—')}
        ${p.date_debut ? ' • du ' + p.date_debut : ''}${p.date_fin ? ' au ' + p.date_fin : ''}</small>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="badge-statut badge-${p.actif ? 'valide' : 'rejete'}">${p.actif ? 'Active' : 'Suspendue'}</span>
        <button class="btn btn-fantome btn-petit" data-toggle-promo="${p.id}" data-actif="${p.actif}">${p.actif ? 'Suspendre' : 'Réactiver'}</button>
        <button class="btn btn-danger btn-petit" data-suppr-promo="${p.id}">Supprimer</button>
      </div>
    </div>`).join('') || '<div class="vide">Aucune promotion pour le moment</div>';

  document.querySelectorAll('[data-toggle-promo]').forEach(b => b.addEventListener('click', async () => {
    await appel(`/admin/promotions/${b.dataset.togglePromo}`, { method: 'PUT', body: JSON.stringify({ actif: b.dataset.actif !== '1' }) });
    chargerPromotions();
  }));
  document.querySelectorAll('[data-suppr-promo]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Supprimer cette promotion ?')) return;
    await appel(`/admin/promotions/${b.dataset.supprPromo}`, { method: 'DELETE' });
    chargerPromotions();
  }));
}

document.getElementById('form-promotion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await appel('/admin/promotions', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
    toast('Promotion lancée');
    e.target.reset();
    chargerPromotions();
  } catch (err) { toast(err.message); }
});

// ===================== CATÉGORIES (disponibilité) =====================
async function chargerCategoriesAdmin() {
  const cats = await appel('/categories');
  document.getElementById('liste-categories-admin').innerHTML = cats.map(c => `
    <div class="carte" style="display:flex;justify-content:space-between;align-items:center;">
      <div><strong>${c.icone || ''} ${c.nom}</strong></div>
      <label style="display:flex;gap:8px;align-items:center;">
        <span class="badge-statut badge-${c.disponible ? 'valide' : 'en_attente'}">${c.disponible ? 'Disponible' : 'Grisée (bientôt)'}</span>
        <input type="checkbox" data-cat-dispo="${c.id}" ${c.disponible ? 'checked' : ''} style="width:auto;transform:scale(1.3);">
      </label>
    </div>`).join('');

  document.querySelectorAll('[data-cat-dispo]').forEach(chk => chk.addEventListener('change', async () => {
    await appel(`/admin/categories/${chk.dataset.catDispo}/disponibilite`, { method: 'PUT', body: JSON.stringify({ disponible: chk.checked }) });
    toast('Disponibilité mise à jour');
    chargerCategoriesAdmin();
  }));
}


async function chargerParametres() {
  const params = await appel('/admin/parametres');
  const form = document.getElementById('form-parametres');
  Object.entries(params).forEach(([k, v]) => { if (form[k]) form[k].value = v; });

  const formChat = document.getElementById('form-chat-dispo');
  formChat.admin_en_ligne.value = params.admin_en_ligne || '1';
  formChat.message_absence.value = params.message_absence || '';

  const formNotif = document.getElementById('form-notif-canaux');
  ['email_actif', 'email_smtp_hote', 'email_smtp_port', 'email_smtp_utilisateur', 'email_expediteur',
   'sms_actif', 'sms_fournisseur', 'sms_expediteur'].forEach(k => { if (formNotif[k]) formNotif[k].value = params[k] || ''; });

  const fournisseurs = await appel('/admin/paiement/fournisseurs');
  document.getElementById('champs-fournisseurs-paiement').innerHTML = fournisseurs.map(f => `
    <div style="border-bottom:1px solid var(--creme-fonce);padding:10px 0;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong>${f.logo} ${f.nom}</strong>
        <label style="display:flex;gap:6px;align-items:center;font-size:.85rem;">
          <input type="checkbox" name="${f.id}_actif" ${f.actif ? 'checked' : ''} style="width:auto;"> Activer
        </label>
      </div>
      <input type="password" name="${f.id}_cle_api" placeholder="Clé API ${f.nom}" value="${f.configure ? '••••••••' : ''}" style="margin-top:6px;width:100%;padding:9px 12px;border-radius:8px;border:1.5px solid var(--creme-fonce);">
    </div>`).join('');
}

document.getElementById('form-parametres').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await appel('/admin/parametres', { method: 'PUT', body: JSON.stringify(Object.fromEntries(fd)) });
  toast('Paramètres enregistrés');
});

document.getElementById('form-mdp-admin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await appel('/admin/mot-de-passe', { method: 'PUT', body: JSON.stringify(Object.fromEntries(fd)) });
    toast('Mot de passe changé');
    e.target.reset();
  } catch (err) { toast(err.message); }
});

document.getElementById('form-chat-dispo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await appel('/admin/parametres', { method: 'PUT', body: JSON.stringify(Object.fromEntries(fd)) });
  toast('Disponibilité du chat mise à jour');
});

document.getElementById('form-paiement').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {};
  for (const [k, v] of fd.entries()) {
    if (k.endsWith('_actif')) continue; // traité séparément ci-dessous (checkbox absente si décochée)
    if (v && !v.startsWith('••••')) payload[k] = v; // ne pas écraser une clé déjà enregistrée si le champ reste masqué
  }
  document.querySelectorAll('#champs-fournisseurs-paiement input[type=checkbox]').forEach(chk => {
    payload[chk.name] = chk.checked ? '1' : '0';
  });
  await appel('/admin/parametres', { method: 'PUT', body: JSON.stringify(payload) });
  toast('Paramètres de paiement enregistrés');
  chargerParametres();
});

document.getElementById('form-notif-canaux').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = Object.fromEntries(fd);
  if (payload.email_smtp_mot_de_passe === '') delete payload.email_smtp_mot_de_passe;
  if (payload.sms_cle_api === '') delete payload.sms_cle_api;
  await appel('/admin/parametres', { method: 'PUT', body: JSON.stringify(payload) });
  toast('Paramètres de notification enregistrés');
});
