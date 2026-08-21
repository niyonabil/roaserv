# PRD : Sprint de Test & Validation (QA Sprint) — DigiDocs Hub

**Produit :** DigiDocs Hub (Plateforme SaaS B2B/B2C)
**Type de Sprint :** Sprint de Test (Quality Assurance & User Acceptance Testing)
**Durée estimée :** 1 à 2 semaines
**Cible :** Équipes QA, Développeurs, et Utilisateurs Bêta (Partenaires B2B)

---

## 1. Objectifs du Sprint de Test
L'objectif principal de ce sprint n'est pas de développer de nouvelles fonctionnalités, mais de **casser, stresser et valider** les flux critiques existants. Nous devons nous assurer que :
1. Le cycle de vie d'une commande (de la création à la livraison) est robuste et sans faille.
2. Le système de rôles (RBAC) bloque strictement les accès non autorisés.
3. Les outils interactifs (Timeline, Calendrier de planification) réagissent parfaitement aux changements d'états.
4. Le déploiement dynamique (Assistant d'installation et Marque Blanche) fonctionne de bout en bout.

---

## 2. Périmètre du Sprint (Scope)
Les tests se concentreront exclusivement sur les **5 modules critiques** définis dans le PRD fonctionnel de l'application :
* **Module 1 :** Assistant d'Installation Initial (Setup Wizard)
* **Module 2 :** Cycle de vie des commandes & Gestion des statuts
* **Module 3 :** Timeline dynamique (Barre de progression)
* **Module 4 :** Calendrier Interactif (Re-planification des deadlines)
* **Module 5 :** Personnalisation SaaS & Meta SEO

---

## 3. Scénarios de Test Critiques (User Stories de Test)

### 3.1 Tests de l'Assistant d'Installation & Base de données
**Contexte :** Simuler un déploiement sur une nouvelle instance vierge (ex: Vercel / Cloud Run).
* **Test 1.1 (Interception) :** Si l'app n'est pas configurée, vérifier que toutes les URLs (même `/dashboard`) redirigent vers l'Assistant d'Installation.
* **Test 1.2 (Saisie sécurisée) :** Vérifier que la saisie des identifiants ne laisse aucune trace dans les logs du navigateur (Console/Network).
* **Test 1.3 (Création Super-Admin) :** Vérifier que le premier compte créé via le setup obtient bien tous les droits `Administrateur` et que l'assistant se verrouille définitivement après succès.

### 3.2 Tests du Contrôle d'Accès (RBAC) & Sécurité
**Contexte :** Vérifier l'étanchéité des rôles.
* **Test 2.1 (Opérateur Saisie) :** Se connecter en tant qu'Opérateur. Vérifier qu'il est **impossible** de voir les montants des devis, factures, et qu'il ne peut voir que les commandes qui lui sont assignées au statut `EN_TRAITEMENT`.
* **Test 2.2 (Contrôleur Qualité) :** Vérifier que le QA peut rejeter un travail, ce qui renvoie automatiquement la commande au statut `EN_TRAITEMENT` avec une notification pour l'opérateur.
* **Test 2.3 (Partenaire B2B) :** Vérifier qu'un client partenaire ne peut voir QUE ses propres dossiers et ne peut en aucun cas modifier un statut de production (seulement consulter).
* **Test 2.4 (Sécurité Admin) :** Vérifier qu'une tentative de suppression du compte Super-Admin (ex: ID `usr-admin-1` ou username `boguiman`) est bloquée par le backend et renvoie l'erreur appropriée.

### 3.3 Tests du Cycle de Vie des Commandes (End-to-End)
**Contexte :** Traverser les 9 statuts d'une commande sans erreur.
* **Test 3.1 (Création & Devis) :** Le Client crée une commande ➡️ L'Assistant(e) génère un devis ➡️ La commande passe en `DEVIS_ENVOYE`.
* **Test 3.2 (Paiement d'Acompte) :** Simuler le paiement de l'acompte ➡️ La commande bascule automatiquement en `ACOMPTE_PAYE`.
* **Test 3.3 (Validation & Livraison) :** L'Opérateur téléverse le fichier traité ➡️ Le QA valide (`PRET_A_LIVRER`) ➡️ Le Client B2C télécharge le livrable ➡️ La commande se clôture (`TERMINE`).

### 3.4 Tests de l'Interface Dynamique (Timeline & Calendrier)
**Contexte :** Valider l'UX et la réactivité des composants métier.
* **Test 4.1 (Synchronisation Timeline) :** Vérifier que chaque changement de statut en base de données fait avancer ou reculer dynamiquement la ligne bleue de la Timeline, sans nécessiter de rafraîchissement de la page.
* **Test 4.2 (Infobulles) :** Survoler les étapes futures et passées sur la Timeline pour vérifier l'apparition immédiate des tooltips explicatifs.
* **Test 4.3 (Planification 1-Clic) :** En tant qu'Administrateur, cliquer sur un jour futur dans le Calendrier. Vérifier que :
  - La date de livraison (`deadline`) se met à jour en base de données.
  - Une notification ou trace d'audit est générée.
  - La sélection visuelle sur le calendrier s'actualise.
* **Test 4.4 (Restriction du Calendrier) :** Vérifier qu'un Opérateur de saisie voit le calendrier en "lecture seule" et que ses clics ne modifient pas la date de livraison.

### 3.5 Tests de Personnalisation SaaS & Meta Tags (Marque Blanche)
**Contexte :** Valider la configuration "Multi-Tenant" ou Marque Blanche.
* **Test 5.1 (Mise à jour en temps réel) :** Depuis l'espace Admin, changer le nom du Workspace de "DigiDocs" à "DocuPro". Vérifier que la NavBar, le Footer, et le logo se mettent à jour.
* **Test 5.2 (SEO & SSR) :** Inspecter le code source de la page (ou utiliser un outil validateur). Confirmer que les balises `<title>`, `<meta property="og:title">` et `<meta name="twitter:title">` reflètent le nouveau nom généré par Angular SSR.

---

## 4. Critères d'Acceptation du Sprint (Definition of Done - DoD)
Pour que ce Sprint de Test soit considéré comme réussi et validé, les conditions suivantes doivent être remplies :
1. **Zéro Bug Bloquant (P0/P1) :** Aucune erreur 500 sur le serveur Express (API), aucun crash d'écran blanc côté Angular.
2. **Fuite de données :** Aucune clé secrète (ex: Firebase DB) ne doit être exposée dans l'onglet réseau (`Network`) du navigateur.
3. **Responsive Design Validé :** Le tableau de bord de la commande, la timeline horizontale et le calendrier doivent s'adapter proprement sur une résolution mobile et tablette sans chevauchement.
4. **Logs d'Audit :** 100% des modifications de statuts de commandes ou de deadlines génèrent une ligne d'historique avec la date, l'heure et l'utilisateur responsable.
