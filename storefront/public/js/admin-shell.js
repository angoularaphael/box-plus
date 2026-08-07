/* =====================================================================
   LE PANNEAU — la refonte, posée PAR-DESSUS l'existant.

   RÈGLE DE CE FICHIER : il n'ouvre pas admin.js et n'en réécrit pas une
   ligne. Un autre développeur travaille sur la logique métier de ce dépôt
   en ce moment ; toucher au même fichier que lui garantissait le conflit.
   Tout ce qui suit ENVELOPPE : on ajoute une ossature, des états, du tri,
   des retours d'action — et quand il faut charger des données, on clique
   l'ancien onglet caché, pour réutiliser SA logique de chargement au lieu
   d'en écrire une deuxième qui divergerait le premier jour.

   CE QUE ÇA CORRIGE, ET QUI SE MESURE DANS L'ANCIEN PANNEAU :
   1. Il s'ouvrait sur « Offres », un catalogue. On n'ouvre pas son
      backoffice le matin pour lire un catalogue : on l'ouvre pour savoir
      ce qui demande une action. → l'écran « Aujourd'hui ».
   2. Quatre-vingt-quatre inscriptions tombaient dans un tableau sans tri.
      Au-delà de vingt lignes, un tableau sans tri est une archive, pas un
      outil. → tri sur chaque colonne, au clic ET au clavier.
   3. Aucun retour après une action : on cliquait, rien ne bougeait, on
      recliquait. → une réponse visible pour chaque action.
   4. Écran blanc pendant le chargement, qui se lit comme une panne.
      → des barres à la forme du contenu qui arrive.
   5. Des tableaux à dix colonnes sur un téléphone de 375 px, alors que le
      panneau se consulte au comptoir. → chaque ligne devient une carte.
   ===================================================================== */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) =>
    String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  /* ------------------------------------------------------------------
     LES RETOURS D'ACTION.
     Publiés sur `window.panToast` pour que n'importe quel bout du panneau
     puisse s'en servir — y compris du code écrit après celui-ci.
     ------------------------------------------------------------------ */
  let bacToasts = null;
  function toast(texte, type) {
    if (!bacToasts) {
      bacToasts = document.createElement("div");
      bacToasts.className = "pan-toasts";
      document.body.appendChild(bacToasts);
    }
    const t = document.createElement("div");
    t.className = "pan-toast" + (type ? ` pan-toast--${type}` : "");
    /* `role=status` et non `alert` : on informe, on n'interrompt pas la
       lecture en cours d'un lecteur d'écran. */
    t.setAttribute("role", "status");
    t.innerHTML = `<span>${esc(texte)}</span><button type="button" class="pan-toast__x" aria-label="Fermer">×</button>`;
    t.querySelector(".pan-toast__x").onclick = () => t.remove();
    bacToasts.appendChild(t);
    setTimeout(() => t.remove(), type === "err" ? 8000 : 4200);
  }
  window.panToast = toast;

  /* ==================================================================
     1. L'OSSATURE
     ================================================================== */
  const SECTIONS = [
    { id: "aujourdhui", label: "Aujourd’hui", ico: "M3 12h4l3 8 4-16 3 8h4" },
    { id: "inscriptions", label: "Inscriptions", ico: "M4 5h16M4 12h16M4 19h10", onglet: "contracts" },
    { id: "ventes", label: "Ventes", ico: "M4 19V9m5 10V5m5 14v-7m5 7V8", onglet: "stats" },
    { id: "catalogue", label: "Catalogue", ico: "M4 6h16v12H4zM4 10h16", onglet: "offers" },
    { id: "reglages", label: "Réglages", ico: "M12 15a3 3 0 100-6 3 3 0 000 6zM4 12h2m12 0h2M12 4v2m0 12v2" },
  ];

  let courante = "aujourdhui";

  function poserOssature() {
    const panneau = $("#adminPanel");
    if (!panneau) return;
    document.body.classList.add("pan");

    const ancienneBarre = $("#adminTabs");
    const ancienHaut = $(".admin-topbar");
    const utilisateur = $("#adminUserLine")?.textContent || "";

    /* L'ancienne barre reste dans le document — admin.js branche ses
       écouteurs dessus et c'est par elle qu'on déclenche les chargements.
       On la retire seulement de l'affichage et du parcours au clavier. */
    if (ancienneBarre) {
      ancienneBarre.style.display = "none";
      ancienneBarre.setAttribute("aria-hidden", "true");
      $$(".admin-tab", ancienneBarre).forEach((b) => (b.tabIndex = -1));
    }
    if (ancienHaut) ancienHaut.style.display = "none";

    const rail = document.createElement("nav");
    rail.className = "pan-rail";
    rail.setAttribute("aria-label", "Sections du panneau");
    rail.innerHTML =
      `<div class="pan-rail__brand">
         <span class="pan-rail__mark" aria-hidden="true">BC</span>
         <span class="pan-rail__name">Boutique<small>${esc(utilisateur || "Administration")}</small></span>
       </div>` +
      SECTIONS.map((s) =>
        `<button type="button" class="pan-nav${s.id === courante ? " is-on" : ""}" data-sec="${s.id}" aria-current="${s.id === courante}">
           <svg class="pan-nav__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${s.ico}"/></svg>
           <span>${esc(s.label)}</span>
           <span class="pan-nav__n" data-n="${s.id}" hidden>0</span>
         </button>`).join("") +
      `<div class="pan-rail__foot"><button type="button" class="btn secondary sm" id="panLogout" style="width:100%">Déconnexion</button></div>`;

    const shell = document.createElement("div");
    shell.className = "pan-shell";
    const main = document.createElement("div");
    main.className = "pan-main";

    panneau.parentNode.insertBefore(shell, panneau);
    shell.appendChild(rail);
    shell.appendChild(main);
    main.appendChild(panneau);
    panneau.classList.remove("admin-layout");
    const couche = $(".admin-layout", panneau);
    if (couche) couche.style.display = "contents";

    $("#panLogout").onclick = () => $("#logoutBtn")?.click();
    $$(".pan-nav", rail).forEach((b) => (b.onclick = () => aller(b.dataset.sec)));
  }

  /** Va à une section. Les anciens onglets font le chargement des données. */
  function aller(id) {
    const sec = SECTIONS.find((s) => s.id === id);
    if (!sec) return;
    courante = id;

    $$(".pan-nav").forEach((b) => {
      const on = b.dataset.sec === id;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-current", String(on));
    });

    /* On clique l'ancien onglet : il montre SA section et lance SON
       chargement (loadOrders, loadMateriel, initStats). Zéro duplication. */
    if (sec.onglet) {
      const vieux = $(`.admin-tab[data-tab="${sec.onglet}"]`);
      if (vieux) vieux.click();
    } else {
      ["tabOffers", "tabMateriel", "tabContracts", "tabStats"].forEach((x) => {
        const el = document.getElementById(x);
        if (el) el.hidden = true;
      });
    }

    $$(".pan-screen").forEach((e) => (e.hidden = e.dataset.sec !== id));
    if (id === "aujourdhui") chargerAujourdhui();
    if (id === "catalogue") majSousOnglet();
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    history.replaceState(null, "", `/admin/#${id}`);
  }
  window.panAller = aller;

  /* ==================================================================
     2. L'ÉCRAN DU MATIN
     ================================================================== */
  const EUR = (c) => (Number(c || 0) / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  function ecranAujourdhui() {
    const s = document.createElement("section");
    s.className = "pan-screen";
    s.dataset.sec = "aujourdhui";
    s.innerHTML = `
      <div class="pan-head">
        <div>
          <h1>Aujourd’hui</h1>
          <p>Ce qui demande une décision maintenant. Le reste attend.</p>
        </div>
      </div>
      <div class="pan-kpis" id="panKpis">
        <div class="pan-kpi"><span class="pan-kpi__l">Chargement</span><span class="pan-kpi__v">—</span></div>
        <div class="pan-kpi"><span class="pan-kpi__l">Chargement</span><span class="pan-kpi__v">—</span></div>
        <div class="pan-kpi"><span class="pan-kpi__l">Chargement</span><span class="pan-kpi__v">—</span></div>
        <div class="pan-kpi"><span class="pan-kpi__l">Chargement</span><span class="pan-kpi__v">—</span></div>
      </div>
      <div class="pan-bloc">
        <div class="pan-bloc__head">
          <div>
            <h2 class="pan-bloc__title">À traiter</h2>
            <p class="pan-bloc__desc">Paiement en échec, accès bloqué, ou dossier signé qui attend d’être transmis.</p>
          </div>
          <div class="pan-bloc__tools">
            <button type="button" class="btn secondary sm" id="panRefresh">Actualiser</button>
          </div>
        </div>
        <div class="pan-bloc__body" id="panAFaire">
          <div class="pan-squelette"><span></span><span></span><span></span><span></span></div>
        </div>
      </div>
      <div class="pan-bloc">
        <div class="pan-bloc__head">
          <div>
            <h2 class="pan-bloc__title">Dernières inscriptions</h2>
            <p class="pan-bloc__desc">Les huit derniers dossiers ouverts, du plus récent au plus ancien.</p>
          </div>
        </div>
        <div class="pan-bloc__body" id="panDernieres">
          <div class="pan-squelette"><span></span><span></span><span></span></div>
        </div>
      </div>`;
    return s;
  }

  /* La reponse tient quelques secondes en memoire. Mesure au reseau :
     en arrivant sur /admin/#contracts, `/api/admin/orders` partait DEUX
     fois — une par admin.js, une par l'ecran du matin. Meme reponse, deux
     attentes, deux fois la charge. Huit secondes : assez pour que les deux
     ecrans se servent, trop peu pour afficher un chiffre perime. */
  let cacheCommandes = null;
  let cacheAt = 0;
  async function lireCommandes() {
    if (cacheCommandes && Date.now() - cacheAt < 8000) return cacheCommandes;
    const r = await fetch("/api/admin/orders", { credentials: "include" });
    const d = await r.json();
    cacheCommandes = d.orders || [];
    cacheAt = Date.now();
    return cacheCommandes;
  }
  /** Le bouton « Actualiser » doit VRAIMENT actualiser : il vide le cache. */
  function oublierCommandes() { cacheCommandes = null; }

  const LIB_ETAPE = { 1: "Offre", 2: "Salle", 3: "Identité", 4: "Paiement", 5: "IBAN", 6: "Dossier", 7: "Signature", 8: "Confirmé" };

  function dateCourte(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  }

  async function chargerAujourdhui() {
    const zoneA = $("#panAFaire");
    const zoneD = $("#panDernieres");
    if (!zoneA) return;

    let commandes = [];
    let places = null;
    try {
      commandes = await lireCommandes();
    } catch {
      zoneA.innerHTML = `<div class="pan-vide"><p class="pan-vide__t">La liste n’a pas pu être chargée</p><p class="pan-vide__d">Vérifiez la connexion, puis réessayez avec « Actualiser ».</p></div>`;
      return;
    }
    try {
      const r = await fetch("/api/admin/offre-rentree", { credentials: "include" });
      const d = await r.json();
      if (d.ok) places = d;
    } catch { /* le compteur est optionnel : on continue sans */ }

    /* Ce qui demande une action, dans cet ordre : l'argent qui n'est pas
       rentré, l'accès bloqué, puis les dossiers signés non transmis. */
    const impayes = commandes.filter((o) => o.payment_status && o.payment_status !== "paid");
    const bloques = commandes.filter((o) => o.access_blocked);
    const aTransmettre = commandes.filter((o) => o.signed && !o.dispatched);
    const aFaire = [...new Map([...impayes, ...bloques, ...aTransmettre].map((o) => [o.order_id, o])).values()];

    const semaine = Date.now() - 7 * 864e5;
    const recentes = commandes.filter((o) => new Date(o.created_at).getTime() >= semaine).length;

    peindreKpis(aFaire.length, impayes.length, recentes, places);
    peindreAFaire(zoneA, aFaire);
    peindreDernieres(zoneD, commandes);

    const pastille = $('.pan-nav__n[data-n="inscriptions"]');
    if (pastille) {
      pastille.textContent = String(aFaire.length);
      pastille.hidden = aFaire.length === 0;   // « 0 » est du bruit, pas une information
    }
  }

  function peindreKpis(nAFaire, nImpayes, nSemaine, places) {
    const box = $("#panKpis");
    if (!box) return;
    const tuile = (l, v, s, cls, sec) =>
      `<${sec ? "button type=\"button\"" : "div"} class="pan-kpi${cls ? " " + cls : ""}"${sec ? ` data-va="${sec}"` : ""}>
         <span class="pan-kpi__l">${esc(l)}</span>
         <span class="pan-kpi__v">${esc(v)}</span>
         <span class="pan-kpi__s">${esc(s)}</span>
       </${sec ? "button" : "div"}>`;
    box.innerHTML =
      tuile("À traiter", nAFaire, nAFaire ? "Dossiers qui attendent une décision" : "Rien ne traîne. Bonne journée.", nAFaire ? "pan-kpi--alerte" : "pan-kpi--ok", "inscriptions") +
      tuile("Paiements en échec", nImpayes, nImpayes ? "À relancer avant que l’accès saute" : "Tout est encaissé", nImpayes ? "pan-kpi--alerte" : "pan-kpi--ok", "inscriptions") +
      tuile("Cette semaine", nSemaine, "Dossiers ouverts sur sept jours", "", "ventes") +
      tuilePlaces(places);
    function tuilePlaces(p) {
      /* Trois etats, et surtout PAS deux. Un compteur jamais regle
         affichait « Complet — les sites n'affichent plus rien » : le
         patron aurait lu que son offre etait epuisee alors qu'il ne
         l'avait simplement jamais ouverte. Zero et « pas encore » se
         ressemblent dans les donnees, jamais dans la tete du lecteur. */
      if (!p || !p.reglage || !p.reglage.maj) {
        return tuile("Places de rentrée", "—", "Jamais réglées : les sites n’affichent aucun compteur", "", "reglages");
      }
      if (p.affiche <= 0) {
        return tuile("Places de rentrée", "0", "Complet — les sites n’affichent plus rien", "pan-kpi--alerte", "reglages");
      }
      return tuile("Places de rentrée", p.affiche,
        p.affiche <= 5 ? "Bientôt complet — pensez à réajuster" : "Ce que les sites affichent",
        p.affiche <= 5 ? "pan-kpi--alerte" : "", "reglages");
    }
    $$("button.pan-kpi", box).forEach((b) => (b.onclick = () => aller(b.dataset.va)));
  }

  function peindreAFaire(zone, liste) {
    if (!liste.length) {
      zone.innerHTML = `<div class="pan-vide">
        <p class="pan-vide__t">Rien à traiter</p>
        <p class="pan-vide__d">Aucun paiement en échec, aucun accès bloqué, aucun dossier en attente de transmission.</p>
      </div>`;
      return;
    }
    zone.innerHTML = `<div class="pan-tablewrap"><table class="pan-table pan-table--cartes">
      <thead><tr><th>Adhérent</th><th>Offre</th><th>Salle</th><th>Motif</th><th>Ouvert le</th><th></th></tr></thead>
      <tbody>${liste.slice(0, 25).map((o) => {
        const motif = o.payment_status && o.payment_status !== "paid"
          ? `<span class="pan-tag pan-tag--ko">Paiement ${esc(o.payment_status === "failed" ? "refusé" : o.payment_status)}</span>`
          : o.access_blocked
            ? `<span class="pan-tag pan-tag--ko">Accès bloqué</span>`
            : `<span class="pan-tag pan-tag--att">Signé, à transmettre</span>`;
        return `<tr>
          <td data-l="Adhérent"><strong>${esc(o.name)}</strong><br><span style="color:var(--pan-mute);font-size:12px">${esc(o.email)}</span></td>
          <td data-l="Offre">${esc(o.product)}</td>
          <td data-l="Salle">${esc(o.gym || "—")}</td>
          <td data-l="Motif">${motif}</td>
          <td data-l="Ouvert le">${esc(dateCourte(o.created_at))}</td>
          <td data-l=""><a class="btn sm secondary" href="mailto:${encodeURIComponent(o.email)}">Écrire</a></td>
        </tr>`;
      }).join("")}</tbody></table></div>`;
    if (liste.length > 25) {
      zone.insertAdjacentHTML("beforeend",
        `<p class="pan-bloc__desc" style="padding:12px 16px;margin:0">Les 25 premiers sur ${liste.length}. La liste complète est dans « Inscriptions ».</p>`);
    }
  }

  function peindreDernieres(zone, commandes) {
    if (!zone) return;
    const tri = [...commandes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 8);
    if (!tri.length) {
      zone.innerHTML = `<div class="pan-vide"><p class="pan-vide__t">Aucune inscription pour l’instant</p><p class="pan-vide__d">Les dossiers ouverts depuis la boutique apparaîtront ici.</p></div>`;
      return;
    }
    zone.innerHTML = `<div class="pan-tablewrap"><table class="pan-table pan-table--cartes">
      <thead><tr><th>Adhérent</th><th>Offre</th><th>Étape</th><th>Paiement</th><th>Ouvert le</th></tr></thead>
      <tbody>${tri.map((o) => `<tr>
        <td data-l="Adhérent"><strong>${esc(o.name)}</strong></td>
        <td data-l="Offre">${esc(o.product)}</td>
        <td data-l="Étape"><span class="pan-tag pan-tag--neutre">${esc(LIB_ETAPE[o.step] || o.step)}</span></td>
        <td data-l="Paiement">${o.payment_status === "paid"
          ? '<span class="pan-tag pan-tag--ok">Payé</span>'
          : `<span class="pan-tag pan-tag--att">${esc(o.payment_status || "en attente")}</span>`}</td>
        <td data-l="Ouvert le">${esc(dateCourte(o.created_at))}</td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  /* ==================================================================
     3. RÉGLAGES — on y DÉPLACE les blocs qui n'ont rien à faire dans un
        catalogue : les places de l'offre, et la mise en avant.
        Un déplacement de nœud, pas une copie : admin.js retrouve ses
        éléments par identifiant, ses écouteurs survivent intacts.
     ================================================================== */
  function ecranReglages() {
    const s = document.createElement("section");
    s.className = "pan-screen";
    s.dataset.sec = "reglages";
    s.hidden = true;
    s.innerHTML = `<div class="pan-head"><div>
        <h1>Réglages</h1>
        <p>Ce que les sites du club affichent, et ce qui remonte en page d’accueil.</p>
      </div></div><div id="panReglagesHote"></div>`;
    return s;
  }

  function deplacerVersReglages() {
    const hote = $("#panReglagesHote");
    if (!hote) return;
    const blocPlaces = $("#savePlaces")?.closest(".admin-section");
    const blocUne = $("#saveFeatured")?.closest(".admin-section");
    [blocPlaces, blocUne].forEach((b) => { if (b) hote.appendChild(b); });
  }

  /* ==================================================================
     4. LE CATALOGUE — deux sous-écrans, sans quitter la section.
     ================================================================== */
  function poserSousOnglets() {
    const cible = $("#tabOffers");
    if (!cible || $("#panSousCat")) return;
    const barre = document.createElement("div");
    barre.id = "panSousCat";
    barre.className = "pan-filtres";
    barre.style.margin = "0 0 16px";
    barre.innerHTML =
      `<button type="button" class="pan-filtre is-on" data-sous="offers">Les offres</button>
       <button type="button" class="pan-filtre" data-sous="materiel">Le matériel</button>`;
    cible.parentNode.insertBefore(barre, cible);
    $$(".pan-filtre", barre).forEach((b) => (b.onclick = () => {
      const vieux = $(`.admin-tab[data-tab="${b.dataset.sous}"]`);
      if (vieux) vieux.click();
      majSousOnglet();
    }));
  }

  function majSousOnglet() {
    const barre = $("#panSousCat");
    if (!barre) return;
    barre.hidden = courante !== "catalogue";
    const surMateriel = !$("#tabMateriel")?.hidden;
    $$(".pan-filtre", barre).forEach((b) =>
      b.classList.toggle("is-on", (b.dataset.sous === "materiel") === surMateriel));
  }

  /* ==================================================================
     5. LES TABLEAUX EXISTANTS — triables, cherchables, lisibles au doigt.

     admin.js réécrit ses tableaux par innerHTML à chaque chargement : nos
     ajouts seraient effacés. On observe donc le corps du tableau et on
     réapplique après chaque rendu. C'est la seule façon d'enrichir sans
     toucher au fichier de l'autre développeur.
     ================================================================== */
  function texteCellule(td) {
    return (td?.innerText || "").trim().toLowerCase();
  }

  /** Compare deux cellules : les nombres et les dates en nombres, le reste
      en texte. Trier « 10 € » avant « 9 € » est un tri qui ment. */
  function comparer(a, b) {
    const nb = (t) => {
      const m = t.replace(/\s| /g, "").match(/-?\d+(?:[.,]\d+)?/);
      return m ? parseFloat(m[0].replace(",", ".")) : null;
    };
    const na = nb(a), nbb = nb(b);
    if (na !== null && nbb !== null && na !== nbb) return na - nbb;
    return a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" });
  }

  function enrichirTableau(table) {
    if (!table || table.dataset.panPret) return;
    table.dataset.panPret = "1";
    table.classList.add("pan-table", "pan-table--cartes");

    const entetes = $$("thead th", table);
    entetes.forEach((th, i) => {
      const libelle = th.textContent.trim();
      if (!libelle) return;                       // colonne d'actions : rien à trier
      th.innerHTML = `<button type="button" class="pan-th-sort">${esc(libelle)}</button>`;
      th.querySelector(".pan-th-sort").onclick = () => {
        const sens = th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending";
        entetes.forEach((x) => x.removeAttribute("aria-sort"));
        th.setAttribute("aria-sort", sens);
        const corps = $("tbody", table);
        const lignes = [...corps.rows];
        lignes.sort((l1, l2) => {
          const r = comparer(texteCellule(l1.cells[i]), texteCellule(l2.cells[i]));
          return sens === "ascending" ? r : -r;
        });
        lignes.forEach((l) => corps.appendChild(l));
      };
    });

    /* Le libellé de colonne voyage avec la cellule : c'est lui qui rend la
       ligne lisible quand elle devient une carte, sur téléphone. */
    const libelles = entetes.map((th) => th.textContent.trim());
    const etiqueter = () => {
      $$("tbody tr", table).forEach((tr) => {
        [...tr.cells].forEach((td, i) => {
          /* Une cellule en colspan est un MESSAGE qui traverse le tableau,
             pas la valeur d'une colonne : lui coller « Référence » devant
             sur telephone serait un contresens. */
          if (Number(td.getAttribute("colspan") || 1) > 1) return;
          if (!td.hasAttribute("data-l")) td.setAttribute("data-l", libelles[i] || "");
        });
      });
    };
    etiqueter();
    new MutationObserver(etiqueter).observe($("tbody", table), { childList: true });
  }

  /* ------------------------------------------------------------------
     LE CHAMP DE RECHERCHE — habille, et surtout EFFACABLE.

     Il existait deja et filtrait bien. Deux manques : rien ne signalait
     que c'etait un champ de recherche (pas d'icone, la meme boite grise
     que les autres), et surtout, une recherche sans resultat laissait un
     tableau VIDE. Un tableau vide se lit comme une panne — il faut dire
     que c'est la recherche qui n'a rien trouve, et comment en sortir.
     ------------------------------------------------------------------ */
  const LOUPE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';

  function habillerRecherche(input) {
    if (!input || input.dataset.panPret) return;
    input.dataset.panPret = "1";
    const boite = document.createElement("div");
    boite.className = "pan-search";
    input.parentNode.insertBefore(boite, input);
    boite.appendChild(input);
    boite.insertAdjacentHTML("afterbegin", LOUPE);
    input.classList.remove("admin-search");
    input.removeAttribute("style");
    /* `type=search` donne la croix d'effacement native ; sans elle, on
       efface caractere par caractere pour revenir a la liste complete. */
    input.type = "search";
  }

  /** Un tableau vide DIT pourquoi il est vide, et comment en sortir. */
  function surveillerVide(table, chercheur) {
    const corps = $("tbody", table);
    if (!corps) return;
    const colonnes = $$("thead th", table).length || 1;
    /* admin.js pose DEJA sa propre ligne quand il ne trouve rien
       (« Aucune inscription trouvee », une cellule en colspan). Elle dit
       qu'il n'y a rien, jamais comment en sortir — et quand on vient de
       taper une recherche, c'est precisement la seule chose utile. On la
       reconnait a son colspan et on la remplace. */
    const estLigneVideAncienne = (r) =>
      !r.dataset.panVide &&   /* ← jamais la notre : sinon on la supprime, on la repose, sans fin */
      r.cells.length === 1 && Number(r.cells[0].getAttribute("colspan") || 1) > 1;

    const verifier = () => {
      const vraiesLignes = [...corps.rows].filter((r) => !r.dataset.panVide && !estLigneVideAncienne(r));
      const dejaLa = corps.querySelector("tr[data-pan-vide]");
      if (vraiesLignes.length) { dejaLa?.remove(); return; }
      [...corps.rows].filter(estLigneVideAncienne).forEach((r) => r.remove());
      if (dejaLa) return;
      const q = (chercheur?.value || "").trim();
      const tr = document.createElement("tr");
      tr.dataset.panVide = "1";
      tr.innerHTML = `<td colspan="${colonnes}" style="padding:0">
        <div class="pan-vide">
          <p class="pan-vide__t">${q ? "Aucun résultat pour « " + esc(q) + " »" : "Rien à afficher"}</p>
          <p class="pan-vide__d">${q
            ? "Essayez un nom, un email ou une référence — ou effacez la recherche pour tout revoir."
            : "Cette liste se remplira dès la première entrée."}</p>
        </div></td>`;
      corps.appendChild(tr);
    };
    verifier();
    new MutationObserver(verifier).observe(corps, { childList: true });
    chercheur?.addEventListener("input", () => setTimeout(verifier, 0));
  }

  /* ==================================================================
     6. DÉMARRAGE
     ================================================================== */
  function demarrer() {
    const panneau = $("#adminPanel");
    if (!panneau || panneau.dataset.panPose) return;
    panneau.dataset.panPose = "1";

    poserOssature();
    const main = $(".pan-main");
    if (!main) return;
    main.insertBefore(ecranAujourdhui(), panneau);
    main.appendChild(ecranReglages());
    deplacerVersReglages();
    poserSousOnglets();

    $("#panRefresh").onclick = () => { oublierCommandes(); chargerAujourdhui(); toast("Liste actualisée", "ok"); };

    [["ordersTable", "ordersSearch"], ["materielTable", "materielSearch"]].forEach(([idT, idS]) => {
      const t = document.getElementById(idT);
      const s = document.getElementById(idS);
      habillerRecherche(s);
      if (t) { enrichirTableau(t); surveillerVide(t, s); }
    });

    /* La route d'arrivée : on respecte le fragment s'il en porte un
       (les anciens liens /admin/#contracts doivent continuer de marcher). */
    const frag = (location.hash || "").replace("#", "");
    const vieuxVersNeuf = { contracts: "inscriptions", stats: "ventes", offers: "catalogue", materiel: "catalogue" };
    const destination = SECTIONS.some((s) => s.id === frag) ? frag : (vieuxVersNeuf[frag] || "aujourdhui");
    aller(destination);
    /* La pastille d'alerte ne doit pas dependre de la page d'arrivee : on
       atterrit souvent sur /admin/#contracts depuis un lien, et le rail
       affichait alors « rien a traiter » sans avoir rien compte. */
    if (destination !== "aujourdhui") chargerAujourdhui();
  }

  /* Le panneau n'existe qu'une fois la session vérifiée : admin.js lève
     `hidden` sur #adminPanel à ce moment-là. On attend ce signal plutôt
     que de deviner un délai. */
  const panneau = document.getElementById("adminPanel");
  if (panneau && !panneau.hidden) demarrer();
  else if (panneau) {
    new MutationObserver((_, obs) => {
      if (!panneau.hidden) { obs.disconnect(); demarrer(); }
    }).observe(panneau, { attributes: true, attributeFilter: ["hidden"] });
  }
})();
