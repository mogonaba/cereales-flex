// ===================== UTILITAIRES =====================
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

function toast(msg, duree = 3500) {
  const zone = document.getElementById('toast-zone');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  zone.appendChild(el);
  setTimeout(() => el.remove(), duree);
}

function formatFCFA(n) {
  return Math.round(n).toLocaleString('fr-FR') + ' FCFA';
}

// Échappe tout contenu injecté dans le HTML (protection contre les injections XSS :
// noms de produits, avis, messages du chat, idées... proviennent tous d'entrées utilisateur)
function esc(valeur) {
  if (valeur === null || valeur === undefined) return '';
  return String(valeur)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fichierEnBase64(fichier) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(fichier);
  });
}

function obtenirPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 8000 }
    );
  });
}

// ===================== MODE SOMBRE =====================
const Theme = {
  init() {
    const enregistre = localStorage.getItem('gdf_theme');
    const preferSombre = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.appliquer(enregistre || (preferSombre ? 'sombre' : 'clair'));
    document.getElementById('btn-theme').addEventListener('click', () => {
      const actuel = document.documentElement.getAttribute('data-theme') === 'sombre' ? 'clair' : 'sombre';
      this.appliquer(actuel);
    });
  },
  appliquer(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('gdf_theme', theme);
    const btn = document.getElementById('btn-theme');
    if (btn) btn.textContent = theme === 'sombre' ? '☀️' : '🌙';
  },
};

// ===================== FAVORIS (LISTE DE SOUHAITS) =====================
const Favoris = {
  liste: JSON.parse(localStorage.getItem('gdf_favoris') || '[]'),
  estFavori(id) { return this.liste.includes(id); },
  basculer(id) {
    if (this.estFavori(id)) this.liste = this.liste.filter(x => x !== id);
    else this.liste.push(id);
    localStorage.setItem('gdf_favoris', JSON.stringify(this.liste));
  },
};

// ===================== NAVIGATION =====================
const Navigation = {
  init() {
    document.querySelectorAll('[data-vue]').forEach(btn => {
      btn.addEventListener('click', () => this.aller(btn.dataset.vue));
    });
    document.querySelectorAll('[data-vue-lien]').forEach(el => {
      el.addEventListener('click', (e) => { e.preventDefault(); this.aller(el.dataset.vueLien); });
    });
  },
  aller(vue) {
    document.querySelectorAll('.vue').forEach(v => v.classList.add('masque'));
    document.getElementById('vue-' + vue).classList.remove('masque');
    document.querySelectorAll('#onglets-principaux .onglet').forEach(o => o.classList.remove('actif'));
    const onglet = document.querySelector(`#onglets-principaux .onglet[data-vue="${vue}"]`);
    if (onglet) onglet.classList.add('actif');
    if (vue === 'compte') Compte.rafraichir();
    if (vue === 'avis') Avis.charger();
  },
};

// ===================== BOUTIQUE =====================
const Boutique = {
  categorieActive: '',
  async init() {
    const cats = await appel('/categories');
    const nav = document.getElementById('filtres-categories');
    cats.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'sous-onglet' + (c.disponible ? '' : ' indisponible');
      btn.dataset.cat = c.slug;
      btn.textContent = `${c.icone || ''} ${c.nom}` + (c.disponible ? '' : ' (bientôt)');
      if (c.disponible) btn.addEventListener('click', () => this.filtrer(c.slug, btn));
      else btn.disabled = true;
      nav.appendChild(btn);
    });
    nav.querySelector('[data-cat=""]').addEventListener('click', (e) => this.filtrer('', e.target));
    document.getElementById('filtre-favoris').addEventListener('click', (e) => this.filtrer('__favoris', e.target));
    document.getElementById('select-tri').addEventListener('change', () => this.charger(document.getElementById('champ-recherche').value.trim()));
    this.charger();
  },
  async filtrer(slug, btn) {
    document.querySelectorAll('#filtres-categories .sous-onglet').forEach(b => b.classList.remove('actif'));
    btn.classList.add('actif');
    this.categorieActive = slug;
    this.charger();
  },
  async rechercher() {
    this.charger(document.getElementById('champ-recherche').value.trim());
  },
  async charger(q = '') {
    const grille = document.getElementById('grille-produits');
    grille.innerHTML = '<div class="vide"><div class="spinner"></div></div>';
    const modeFavoris = this.categorieActive === '__favoris';
    const params = new URLSearchParams();
    if (this.categorieActive && !modeFavoris) params.set('categorie', this.categorieActive);
    if (q) params.set('q', q);
    let produits = await appel('/products?' + params.toString());
    if (modeFavoris) produits = produits.filter(p => Favoris.estFavori(p.id));

    const tri = document.getElementById('select-tri')?.value || 'recent';
    const prixEffectif = p => p.promotion ? p.promotion.prix_promo : p.prix_unitaire;
    if (tri === 'prix_asc') produits.sort((a, b) => prixEffectif(a) - prixEffectif(b));
    else if (tri === 'prix_desc') produits.sort((a, b) => prixEffectif(b) - prixEffectif(a));
    else if (tri === 'nom') produits.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

    if (produits.length === 0) {
      grille.innerHTML = modeFavoris
        ? '<div class="vide">Aucun favori pour le moment — cliquez sur ♥ sur un produit pour l\'ajouter ici.</div>'
        : '<div class="vide">Aucun produit trouvé pour le moment.</div>';
      return;
    }
    grille.innerHTML = '';
    produits.forEach(p => {
      const indisponible = p.categorie_disponible === 0;
      const carte = document.createElement('div');
      carte.className = 'carte-produit' + (indisponible ? ' indisponible' : '');
      const prixAffiche = p.promotion
        ? `<span class="prix">${formatFCFA(p.promotion.prix_promo)}<small style="font-weight:400;font-size:.7rem;"> / ${p.unite}</small></span>
           <span style="text-decoration:line-through;color:var(--texte-clair);font-size:.8rem;margin-left:6px;">${formatFCFA(p.prix_unitaire)}</span>`
        : `<span class="prix">${formatFCFA(p.prix_unitaire)}<small style="font-weight:400;font-size:.7rem;"> / ${p.unite}</small></span>`;
      carte.innerHTML = `
        <div class="visuel">${p.image ? `<img src="${p.image}" alt="${esc(p.nom)}" style="width:100%;height:100%;object-fit:cover;">` : iconeCategorie(p.categorie_slug)}
          ${p.promotion ? `<span class="badge-promo">🏷️ -${p.promotion.reduction_pourcentage}%</span>` : ''}
          <button class="btn-favori ${Favoris.estFavori(p.id) ? 'actif' : ''}" data-favori="${p.id}" title="Ajouter aux favoris" style="position:absolute;top:8px;right:8px;background:rgba(255,255,255,.85);border:none;border-radius:50%;width:32px;height:32px;font-size:1rem;">${Favoris.estFavori(p.id) ? '♥' : '♡'}</button>
        </div>
        <div class="corps">
          <span class="categorie-tag">${esc(p.categorie_nom || '')}</span>
          <h3>${esc(p.nom)}</h3>
          <p class="desc">${esc(p.description || '')}</p>
          <div class="prix-ligne">
            <span>${prixAffiche}</span>
            <span class="stock">${indisponible ? 'Bientôt disponible' : (p.stock > 0 ? p.stock + ' ' + p.unite + ' dispo.' : 'Rupture')}</span>
          </div>
          <button class="btn btn-or btn-bloc btn-petit" ${(p.stock <= 0 || indisponible) ? 'disabled' : ''} data-ajouter="${p.id}">${indisponible ? 'Indisponible pour le moment' : 'Ajouter au panier'}</button>
        </div>`;
      carte.querySelector('[data-ajouter]')?.addEventListener('click', () => Panier.ajouter({ ...p, prix_unitaire: p.promotion ? p.promotion.prix_promo : p.prix_unitaire }));
      carte.querySelector('[data-favori]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        Favoris.basculer(p.id);
        if (modeFavoris) this.charger(q); else this.charger(q);
      });
      grille.appendChild(carte);
    });
  },
};

function iconeCategorie(slug) {
  const map = {
    cereales: '🌾', farines: '🌰', son: '🌿', 'aliment-betail-volaille': '🐓',
    couveuses: '🥚', materiel: '🔧',
  };
  return map[slug] || '📦';
}

// ===================== PANIER =====================
const Panier = {
  articles: JSON.parse(localStorage.getItem('gdf_panier') || '[]'), // état en mémoire de session (pas de stockage sensible)
  sauvegarder() {
    try { localStorage.setItem('gdf_panier', JSON.stringify(this.articles)); } catch {}
    this.majBadge();
  },
  ajouter(produit) {
    const existant = this.articles.find(a => a.product_id === produit.id);
    if (existant) existant.quantite += 1;
    else this.articles.push({ product_id: produit.id, nom: produit.nom, prix_unitaire: produit.prix_unitaire, unite: produit.unite, quantite: 1, categorie_slug: produit.categorie_slug });
    this.sauvegarder();
    toast(`${produit.nom} ajouté au panier`);
    this.rendre();
  },
  modifierQte(id, delta) {
    const a = this.articles.find(x => x.product_id === id);
    if (!a) return;
    a.quantite = Math.max(1, a.quantite + delta);
    this.sauvegarder();
    this.rendre();
  },
  retirer(id) {
    this.articles = this.articles.filter(a => a.product_id !== id);
    this.sauvegarder();
    this.rendre();
  },
  majBadge() {
    const total = this.articles.reduce((s, a) => s + a.quantite, 0);
    const badge = document.getElementById('badge-panier');
    badge.textContent = total;
    badge.classList.toggle('masque', total === 0);
  },
  ouvrir() {
    this.rendre();
    document.getElementById('voile-panier').classList.add('ouvert');
    document.getElementById('panneau-panier').classList.add('ouvert');
  },
  fermer() {
    document.getElementById('voile-panier').classList.remove('ouvert');
    document.getElementById('panneau-panier').classList.remove('ouvert');
  },
  rendre() {
    const corps = document.getElementById('contenu-panier');
    const pied = document.getElementById('pied-panier');
    if (this.articles.length === 0) {
      corps.innerHTML = '<div class="vide">Votre panier est vide.</div>';
      pied.innerHTML = '';
      return;
    }
    corps.innerHTML = '';
    let sousTotal = 0;
    this.articles.forEach(a => {
      sousTotal += a.prix_unitaire * a.quantite;
      const ligne = document.createElement('div');
      ligne.className = 'ligne-panier';
      ligne.innerHTML = `
        <div class="visuel-mini">${iconeCategorie(a.categorie_slug)}</div>
        <div class="infos">
          <strong>${esc(a.nom)}</strong>
          <span style="font-size:.82rem;color:var(--texte-clair)">${formatFCFA(a.prix_unitaire)} / ${a.unite}</span>
          <div class="qte-ctrl">
            <button class="qte-btn" data-moins="${a.product_id}">−</button>
            <span>${a.quantite}</span>
            <button class="qte-btn" data-plus="${a.product_id}">+</button>
            <button class="btn-petit btn-fantome btn" data-retirer="${a.product_id}" style="margin-left:auto;">Retirer</button>
          </div>
        </div>`;
      corps.appendChild(ligne);
    });
    corps.querySelectorAll('[data-moins]').forEach(b => b.addEventListener('click', () => this.modifierQte(b.dataset.moins, -1)));
    corps.querySelectorAll('[data-plus]').forEach(b => b.addEventListener('click', () => this.modifierQte(b.dataset.plus, 1)));
    corps.querySelectorAll('[data-retirer]').forEach(b => b.addEventListener('click', () => this.retirer(b.dataset.retirer)));

    pied.innerHTML = `
      <div class="recap-ligne total"><span>Sous-total</span><span>${formatFCFA(sousTotal)}</span></div>
      <small style="color:var(--texte-clair)">Livraison et remises calculées à l'étape suivante.</small>
      <button class="btn btn-terre btn-bloc" style="margin-top:12px;" id="btn-commander">Commander</button>`;
    document.getElementById('btn-commander').addEventListener('click', () => Commande.ouvrir());
  },
};

// ===================== COMMANDE (calcul intelligent) =====================
const Commande = {
  async ouvrir() {
    if (Panier.articles.length === 0) return;
    Panier.fermer();
    document.getElementById('voile-commande').classList.add('ouvert');
    document.getElementById('panneau-commande').classList.add('ouvert');
    if (Compte.client) {
      const form = document.getElementById('form-commande');
      form.client_nom.value = `${Compte.client.prenom} ${Compte.client.nom}`;
      form.client_telephone.value = Compte.client.telephone;
      form.client_localite.value = Compte.client.localite || '';
    }
    await this.chargerFournisseurs();
    await this.simuler();
  },
  async chargerFournisseurs() {
    const select = document.getElementById('select-fournisseur-paiement');
    if (select.dataset.charge) return;
    try {
      const fournisseurs = await appel('/paiement/fournisseurs');
      fournisseurs.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = `${f.logo} ${f.nom}` + (f.actif && f.configure ? '' : ' (bientôt disponible)');
        opt.disabled = !(f.actif && f.configure);
        select.appendChild(opt);
      });
      select.dataset.charge = '1';
    } catch {}
    select.addEventListener('change', () => {
      const opt = select.selectedOptions[0];
      document.getElementById('statut-fournisseur-paiement').textContent =
        opt.disabled ? '⏳ Ce moyen de paiement sera bientôt activé par l\'administrateur.' : '';
    });
  },
  fermer() {
    document.getElementById('voile-commande').classList.remove('ouvert');
    document.getElementById('panneau-commande').classList.remove('ouvert');
  },
  async geolocaliser() {
    document.getElementById('statut-geoloc-commande').textContent = 'Localisation en cours…';
    const pos = await obtenirPosition();
    const form = document.getElementById('form-commande');
    if (pos) {
      form.latitude.value = pos.latitude;
      form.longitude.value = pos.longitude;
      document.getElementById('statut-geoloc-commande').textContent = '✅ Position enregistrée — calcul de livraison précis';
    } else {
      document.getElementById('statut-geoloc-commande').textContent = 'Position indisponible — le tarif minimum sera appliqué';
    }
    await this.simuler();
  },
  async simuler() {
    const form = document.getElementById('form-commande');
    const fd = new FormData(form);
    const payload = {
      articles: Panier.articles.map(a => ({ product_id: a.product_id, quantite: a.quantite })),
      latitude: fd.get('latitude') || null,
      longitude: fd.get('longitude') || null,
      remise_pourcentage: fd.get('remise_pourcentage') || 0,
      nb_tranches: fd.get('mode_paiement') === 'echelonne' ? (fd.get('nb_tranches') || 3) : null,
      customer_id: Compte.client ? Compte.client.id : null,
    };
    try {
      const devis = await appel('/orders/simuler', { method: 'POST', body: JSON.stringify(payload) });
      const zone = document.getElementById('recapitulatif-commande');
      let html = `
        <div class="recap-ligne"><span>Sous-total</span><span>${formatFCFA(devis.sous_total)}</span></div>
        ${devis.distance_km !== null ? `<div class="recap-ligne"><span>Distance estimée</span><span>${devis.distance_km} km</span></div>` : ''}
        <div class="recap-ligne"><span>Livraison</span><span>${formatFCFA(devis.frais_livraison)}</span></div>
        ${devis.montant_remise > 0 ? `<div class="recap-ligne"><span>Remise (${devis.remise_pourcentage}%)${devis.remise_faveur_appliquee ? ' 🎁 tarif préférentiel' : ''}</span><span>− ${formatFCFA(devis.montant_remise)}</span></div>` : ''}`;
      if (devis.echelonnement) {
        html += `
        <div class="recap-ligne"><span>Frais d'échelonnement</span><span>${formatFCFA(devis.echelonnement.frais)}</span></div>
        <div class="recap-ligne total"><span>Total</span><span>${formatFCFA(devis.total)}</span></div>
        <div class="recap-ligne" style="color:var(--vert-foret-fonce);font-weight:600;"><span>${devis.echelonnement.nbTranches} mois de</span><span>${formatFCFA(devis.echelonnement.montantParTranche)}</span></div>`;
      } else {
        html += `<div class="recap-ligne total"><span>Total</span><span>${formatFCFA(devis.total)}</span></div>`;
      }
      zone.innerHTML = html;
    } catch (e) { toast(e.message); }
  },
  async soumettre(e) {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const modeEchelonne = fd.get('mode_paiement') === 'echelonne';
    const payload = {
      articles: Panier.articles.map(a => ({ product_id: a.product_id, quantite: a.quantite })),
      client_nom: fd.get('client_nom'),
      client_telephone: fd.get('client_telephone'),
      client_localite: fd.get('client_localite'),
      latitude: fd.get('latitude') || null,
      longitude: fd.get('longitude') || null,
      remise_pourcentage: fd.get('remise_pourcentage') || 0,
      mode_paiement: fd.get('mode_paiement'),
      nb_tranches: modeEchelonne ? fd.get('nb_tranches') : null,
      fournisseur_paiement: fd.get('fournisseur_paiement'),
      customer_id: Compte.client ? Compte.client.id : null,
    };
    try {
      const commande = await appel('/orders', { method: 'POST', body: JSON.stringify(payload) });
      toast('✅ Commande enregistrée ! Nous vous contactons bientôt.');
      if (commande.paiement && commande.paiement.message) toast(commande.paiement.message, 6000);
      Panier.articles = [];
      Panier.sauvegarder();
      this.fermer();
      form.reset();
      if (modeEchelonne && Compte.client) {
        toast('💡 Pensez à finaliser la coupure à la source dans « Mon compte »', 5000);
      }
    } catch (e) { toast(e.message); }
  },
};

function suiviCommandeHTML(statut) {
  if (statut === 'annulee') return '<div style="font-size:.8rem;color:var(--danger);margin:6px 0;">❌ Commande annulée</div>';
  const etapes = [
    { cle: 'en_attente', label: 'Reçue' },
    { cle: 'confirmee', label: 'Confirmée' },
    { cle: 'en_livraison', label: 'En livraison' },
    { cle: 'livree', label: 'Livrée' },
  ];
  const idxActuel = etapes.findIndex(e => e.cle === statut);
  return `<div style="display:flex;align-items:center;margin:10px 0;">
    ${etapes.map((e, i) => `
      <div style="display:flex;align-items:center;flex:${i < etapes.length - 1 ? 1 : 0};">
        <div style="width:20px;height:20px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.65rem;color:#fff;background:${i <= idxActuel ? 'var(--vert-foret)' : 'var(--creme-fonce)'};">${i <= idxActuel ? '✓' : ''}</div>
        ${i < etapes.length - 1 ? `<div style="flex:1;height:3px;background:${i < idxActuel ? 'var(--vert-foret)' : 'var(--creme-fonce)'};"></div>` : ''}
      </div>`).join('')}
  </div>
  <div style="display:flex;justify-content:space-between;font-size:.68rem;color:var(--texte-clair);margin-top:-6px;margin-bottom:6px;">
    ${etapes.map(e => `<span>${e.label}</span>`).join('')}
  </div>`;
}

// ===================== COMPTE CLIENT =====================
const Compte = {
  client: null,
  async init() {
    document.querySelectorAll('#compte-non-connecte .sous-onglet').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#compte-non-connecte .sous-onglet').forEach(x => x.classList.remove('actif'));
        b.classList.add('actif');
        document.getElementById('form-connexion').classList.toggle('masque', b.dataset.form !== 'connexion');
        document.getElementById('form-inscription').classList.toggle('masque', b.dataset.form !== 'inscription');
      });
    });

    ['recto', 'verso', 'portrait'].forEach(type => {
      const zone = document.getElementById(`zone-${type}`);
      const input = zone.querySelector('input[type=file]');
      input.addEventListener('change', () => {
        if (input.files[0]) {
          document.getElementById(`texte-${type}`).textContent = '✅ ' + input.files[0].name;
          zone.classList.add('rempli');
        }
      });
    });

    document.getElementById('btn-geoloc').addEventListener('click', async () => {
      document.getElementById('statut-geoloc').textContent = 'Localisation en cours…';
      const pos = await obtenirPosition();
      const form = document.getElementById('form-inscription');
      if (pos) {
        form.latitude.value = pos.latitude; form.longitude.value = pos.longitude;
        document.getElementById('statut-geoloc').textContent = '✅ Position enregistrée';
      } else {
        document.getElementById('statut-geoloc').textContent = 'Position indisponible';
      }
    });

    document.getElementById('form-connexion').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const client = await appel('/auth/connexion', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
        this.client = client;
        toast(`Bienvenue, ${client.prenom} !`);
        this.rafraichir();
      } catch (err) { toast(err.message); }
    });

    document.getElementById('form-inscription').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const fd = new FormData(form);
      try {
        const [recto, verso, portrait] = await Promise.all([
          fichierEnBase64(form.cnib_photo_recto.files[0]),
          fichierEnBase64(form.cnib_photo_verso.files[0]),
          fichierEnBase64(form.photo_identite.files[0]),
        ]);
        const payload = {
          prenom: fd.get('prenom'), nom: fd.get('nom'), telephone: fd.get('telephone'),
          email: fd.get('email') || null,
          mot_de_passe: fd.get('mot_de_passe'), cnib_numero: fd.get('cnib_numero'),
          cnib_photo_recto: recto, cnib_photo_verso: verso, photo_identite: portrait,
          localite: fd.get('localite'), latitude: fd.get('latitude') || null, longitude: fd.get('longitude') || null,
          cil_accepte: form.cil_accepte.checked,
        };
        const client = await appel('/auth/inscription', { method: 'POST', body: JSON.stringify(payload) });
        this.client = client;
        toast(client.message || 'Compte créé !');
        this.rafraichir();
      } catch (err) { toast(err.message); }
    });

    document.getElementById('btn-deconnexion').addEventListener('click', async () => {
      await appel('/auth/deconnexion', { method: 'POST' });
      this.client = null;
      this.rafraichir();
    });

    document.getElementById('btn-supprimer-compte').addEventListener('click', async () => {
      if (!confirm('Supprimer définitivement votre compte ? Cette action est irréversible.')) return;
      if (!confirm('Confirmez-vous une dernière fois la suppression de votre compte ?')) return;
      try {
        const res = await appel('/auth/moi', { method: 'DELETE' });
        toast(res.message || 'Compte supprimé');
        this.client = null;
        this.rafraichir();
      } catch (err) { toast(err.message); }
    });

    document.querySelectorAll('[data-panneau-compte]').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('[data-panneau-compte]').forEach(x => x.classList.remove('actif'));
        b.classList.add('actif');
        document.querySelectorAll('.panneau-compte').forEach(p => p.classList.add('masque'));
        document.getElementById('panneau-' + b.dataset.panneauCompte).classList.remove('masque');
      });
    });

    document.getElementById('form-deduction').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await appel('/deduction/demandes', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
        toast(res.message);
        e.target.reset();
        this.chargerDeductions();
      } catch (err) { toast(err.message); }
    });

    document.getElementById('btn-geoloc-profil').addEventListener('click', async () => {
      const pos = await obtenirPosition();
      const form = document.getElementById('form-profil');
      if (pos) { form.latitude.value = pos.latitude; form.longitude.value = pos.longitude; toast('Position mise à jour'); }
    });

    document.getElementById('form-profil').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await appel('/auth/moi', { method: 'PUT', body: JSON.stringify(Object.fromEntries(fd)) });
        toast('Profil mis à jour');
      } catch (err) { toast(err.message); }
    });

    document.getElementById('btn-geoloc-commande').addEventListener('click', () => Commande.geolocaliser());
    document.getElementById('form-commande').addEventListener('submit', (e) => Commande.soumettre(e));
    document.querySelector('select[name=mode_paiement]').addEventListener('change', (e) => {
      document.getElementById('champ-tranches').classList.toggle('masque', e.target.value !== 'echelonne');
      Commande.simuler();
    });
    document.querySelector('input[name=remise_pourcentage]').addEventListener('input', () => Commande.simuler());
    document.querySelector('input[name=nb_tranches]').addEventListener('input', () => Commande.simuler());

    // tentative de session existante
    try {
      this.client = await appel('/auth/moi');
    } catch { this.client = null; }
    this.rafraichir();
  },
  async rafraichir() {
    const connecte = !!this.client;
    document.getElementById('compte-non-connecte').classList.toggle('masque', connecte);
    document.getElementById('compte-connecte').classList.toggle('masque', !connecte);
    if (!connecte) return;
    document.getElementById('salutation-client').textContent = `Bonjour, ${this.client.prenom} ${this.client.nom}`;
    const badge = document.getElementById('badge-kyc');
    const labels = { en_attente: '⏳ Vérification en cours', valide: '✅ Identité vérifiée', rejete: '⚠️ Vérification refusée' };
    badge.textContent = labels[this.client.kyc_statut] || '';
    badge.className = 'badge-statut badge-' + this.client.kyc_statut;
    this.chargerCommandes();
    this.chargerDeductions();
    document.getElementById('form-profil').localite.value = this.client.localite || '';
  },
  async chargerCommandes() {
    const zone = document.getElementById('liste-commandes');
    try {
      this.commandes = await appel('/orders/mes-commandes');
      this.afficherCommandes();
    } catch { zone.innerHTML = ''; }
  },
  afficherCommandes() {
    const zone = document.getElementById('liste-commandes');
    const commandes = this.commandes || [];
    if (commandes.length === 0) { zone.innerHTML = '<div class="vide">Aucune commande pour le moment.</div>'; return; }
    zone.innerHTML = commandes.map(c => {
      const modifiable = c.statut === 'en_attente';
      return `
        <div class="carte" style="margin-bottom:12px;" data-carte-commande="${c.id}">
          <div style="display:flex;justify-content:space-between;">
            <strong>${new Date(c.cree_le).toLocaleDateString('fr-FR')}</strong>
            <span class="badge-statut badge-${c.statut}">${c.statut.replace('_', ' ')}</span>
          </div>
          <div class="zone-articles-commande" style="font-size:.88rem;color:var(--texte-clair);margin:6px 0;">${c.items.map(i => `${esc(i.nom_produit)} × ${i.quantite}`).join(', ')}</div>
          ${suiviCommandeHTML(c.statut)}
          <strong>${formatFCFA(c.total)}</strong>
          ${modifiable ? `
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button class="btn btn-fantome btn-petit" data-modifier-commande="${c.id}">✏️ Modifier</button>
            <button class="btn btn-danger btn-petit" data-annuler-commande="${c.id}">✕ Annuler</button>
          </div>` : ''}
        </div>`;
    }).join('');

    document.querySelectorAll('[data-annuler-commande]').forEach(b => b.addEventListener('click', () => this.annulerCommande(b.dataset.annulerCommande)));
    document.querySelectorAll('[data-modifier-commande]').forEach(b => b.addEventListener('click', () => this.ouvrirEditionCommande(b.dataset.modifierCommande)));
  },
  async annulerCommande(id) {
    if (!confirm('Annuler cette commande ? Cette action est définitive.')) return;
    try {
      await appel(`/orders/${id}`, { method: 'DELETE' });
      toast('Commande annulée');
      this.chargerCommandes();
    } catch (err) { toast(err.message); }
  },
  ouvrirEditionCommande(id) {
    const commande = (this.commandes || []).find(c => c.id === id);
    if (!commande) return;
    const carte = document.querySelector(`[data-carte-commande="${id}"] .zone-articles-commande`);
    if (!carte) return;
    carte.innerHTML = `
      <div class="edition-commande">
        ${commande.items.map((i, idx) => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0;">
            <span>${esc(i.nom_produit)}</span>
            <input type="number" min="0" step="any" value="${i.quantite}" data-qte-article="${idx}" style="width:80px;">
          </div>`).join('')}
        <small style="color:var(--texte-clair);">Mettez une quantité à 0 pour retirer un article.</small>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button class="btn btn-vert btn-petit" data-enregistrer-commande="${id}">Enregistrer</button>
          <button class="btn btn-fantome btn-petit" data-annuler-edition="${id}">Fermer</button>
        </div>
      </div>`;
    carte.querySelector(`[data-enregistrer-commande]`).addEventListener('click', () => this.enregistrerEditionCommande(id));
    carte.querySelector(`[data-annuler-edition]`).addEventListener('click', () => this.afficherCommandes());
  },
  async enregistrerEditionCommande(id) {
    const commande = (this.commandes || []).find(c => c.id === id);
    if (!commande) return;
    const inputs = document.querySelectorAll(`[data-carte-commande="${id}"] [data-qte-article]`);
    const articles = [];
    inputs.forEach((input, idx) => {
      const quantite = Number(input.value);
      if (quantite > 0) articles.push({ product_id: commande.items[idx].product_id, quantite });
    });
    if (articles.length === 0) return toast('Ajoutez au moins un article, ou annulez la commande à la place.');
    try {
      await appel(`/orders/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          articles, client_nom: commande.client_nom, client_localite: commande.client_localite,
          latitude: commande.latitude, longitude: commande.longitude,
          remise_pourcentage: commande.remise_pourcentage, nb_tranches: commande.nb_tranches,
          mode_paiement: commande.mode_paiement,
        }),
      });
      toast('Commande mise à jour');
      this.chargerCommandes();
    } catch (err) { toast(err.message); }
  },
  async chargerDeductions() {
    const zone = document.getElementById('liste-deductions');
    try {
      const demandes = await appel('/deduction/demandes/mes-demandes');
      zone.innerHTML = demandes.map(d => `
        <div class="carte" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;">
            <strong>${esc(d.nom_institution)} (${esc(d.type_source)})</strong>
            <span class="badge-statut badge-${d.statut}">${d.statut.replace(/_/g, ' ')}</span>
          </div>
          <span style="font-size:.85rem;color:var(--texte-clair);">${formatFCFA(d.montant_total)} en ${d.nb_tranches} tranches</span>
        </div>`).join('');
    } catch { zone.innerHTML = ''; }
  },
};

// ===================== CHAT =====================
const Chat = {
  telephone: localStorage.getItem('gdf_chat_telephone') || '',
  async init() {
    if (this.telephone) {
      document.getElementById('chat-telephone').value = this.telephone;
      this.ouvrir();
    }
    document.getElementById('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.envoyer(); });
  },
  async ouvrir() {
    const nom = document.getElementById('chat-nom').value.trim();
    const telephone = document.getElementById('chat-telephone').value.trim();
    if (!telephone) return toast('Entrez votre numéro de téléphone');
    try {
      const res = await appel('/chat/ouvrir', { method: 'POST', body: JSON.stringify({ nom, telephone, customer_id: Compte.client?.id }) });
      this.telephone = telephone;
      localStorage.setItem('gdf_chat_telephone', telephone);
      document.getElementById('discussion-identification').classList.add('masque');
      document.getElementById('discussion-fenetre').classList.remove('masque');
      this.afficherMessages(res.messages);
    } catch (e) { toast(e.message); }
  },
  afficherMessages(messages) {
    const zone = document.getElementById('chat-messages');
    if (messages.length === 0) {
      zone.innerHTML = '<div class="vide">Envoyez votre premier message, nous répondons rapidement !</div>';
    } else {
      zone.innerHTML = messages.map(m => `<div class="bulle ${esc(m.auteur)}">${esc(m.contenu)}</div>`).join('');
    }
    zone.scrollTop = zone.scrollHeight;
  },
  async envoyer() {
    const input = document.getElementById('chat-input');
    const contenu = input.value.trim();
    if (!contenu) return;
    input.value = '';
    try {
      await appel(`/chat/${this.telephone}/envoyer`, { method: 'POST', body: JSON.stringify({ contenu }) });
      const messages = await appel(`/chat/${this.telephone}/messages`);
      this.afficherMessages(messages);
    } catch (e) { toast(e.message); }
  },
};

// ===================== AVIS =====================
const Avis = {
  noteChoisie: 0,
  init() {
    document.querySelectorAll('#etoiles-choix button').forEach(b => {
      b.addEventListener('click', () => {
        this.noteChoisie = Number(b.dataset.note);
        document.querySelector('input[name=note]').value = this.noteChoisie;
        document.querySelectorAll('#etoiles-choix button').forEach(x => x.classList.toggle('pleine', Number(x.dataset.note) <= this.noteChoisie));
      });
    });
    document.getElementById('form-avis').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await appel('/avis', { method: 'POST', body: JSON.stringify({ ...Object.fromEntries(fd), customer_id: Compte.client?.id }) });
        toast(res.message);
        e.target.reset();
        this.noteChoisie = 0;
        document.querySelectorAll('#etoiles-choix button').forEach(x => x.classList.remove('pleine'));
      } catch (err) { toast(err.message); }
    });
  },
  async charger() {
    const zone = document.getElementById('liste-avis');
    const avis = await appel('/avis');
    if (avis.length === 0) { zone.innerHTML = '<div class="vide">Soyez le premier à laisser un avis !</div>'; return; }
    zone.innerHTML = avis.map(a => `
      <div class="carte">
        <div class="etoiles">${'★'.repeat(a.note)}${'☆'.repeat(5 - a.note)}</div>
        <strong>${esc(a.nom)}</strong>
        <p style="font-size:.88rem;color:var(--texte-clair);">${esc(a.commentaire || '')}</p>
      </div>`).join('');
  },
};

// ===================== IDÉES =====================
document.getElementById('form-idee').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const res = await appel('/idees', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
    toast(res.message);
    e.target.reset();
  } catch (err) { toast(err.message); }
});

// ===================== NOTIFICATIONS =====================
const Notifications = {
  async init() {
    const notifs = await appel('/notifications');
    const vues = JSON.parse(localStorage.getItem('gdf_notifs_vues') || '[]');
    const nonVues = notifs.filter(n => !vues.includes(n.id));
    const badge = document.getElementById('badge-notifs');
    badge.textContent = nonVues.length;
    badge.classList.toggle('masque', nonVues.length === 0);
    document.getElementById('btn-notifs').addEventListener('click', () => {
      if (notifs.length === 0) { toast('Aucune notification pour le moment'); return; }
      notifs.slice(0, 3).forEach((n, i) => setTimeout(() => toast(`🔔 ${n.titre} — ${n.contenu}`, 5000), i * 300));
      localStorage.setItem('gdf_notifs_vues', JSON.stringify(notifs.map(n => n.id)));
      badge.classList.add('masque');
    });
  },
};

// ===================== INITIALISATION GÉNÉRALE =====================
document.addEventListener('DOMContentLoaded', async () => {
  Theme.init();
  Navigation.init();
  Boutique.init();
  Compte.init();
  Chat.init();
  Avis.init();
  Notifications.init();
  Panier.majBadge();

  document.getElementById('btn-panier').addEventListener('click', () => Panier.ouvrir());
  document.getElementById('btn-fermer-panier').addEventListener('click', () => Panier.fermer());
  document.getElementById('voile-panier').addEventListener('click', () => Panier.fermer());
  document.getElementById('btn-compte').addEventListener('click', () => Navigation.aller('compte'));
  document.getElementById('btn-fermer-commande').addEventListener('click', () => Commande.fermer());
  document.getElementById('voile-commande').addEventListener('click', () => Commande.fermer());
});
