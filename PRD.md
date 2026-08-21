# Document de Spécifications Fonctionnelles (PRD) — DigiDocs Hub

**Nom du Produit :** DigiDocs Hub (Personnalisable via l'interface d'administration)  
**Type d'Application :** Plateforme SaaS de sous-traitance documentaire B2B / B2C et gestion de dossiers  
**Frameworks & Technologies :** Angular (Zoneless, Standalone, Reactive Forms, Tailwind CSS v4+), Node.js, Express, Firestore / Multi-bases de données  
**Date du Document :** 20 août 2026

---

## 1. Vision & Objectifs du Produit

### 1.1 Contexte
La gestion et la saisie de documents en masse (sous-traitance de dossiers administratifs, de facturation ou médicaux) requièrent un contrôle rigoureux, un suivi de production transparent, et une collaboration étroite entre clients, partenaires B2B et équipes de production (opérateurs de saisie, contrôleurs qualité, administrateurs). 

### 1.2 Mission de DigiDocs Hub
**DigiDocs Hub** centralise le cycle de vie complet de la sous-traitance documentaire : de la soumission de la demande et de l'analyse des pièces jointes, à la tarification (génération automatique de devis), au traitement de saisie, à la validation qualité stricte, et enfin à la livraison sécurisée.

---

## 2. Personas & Rôles Utilisateurs

La plateforme propose un contrôle d'accès basé sur les rôles (**RBAC**) avec des privilèges finement configurés :

| Rôle | Description & Objectifs | Droits Clés |
| :--- | :--- | :--- |
| **Administrateur** | Gère l'infrastructure, les paramètres système, l'équipe et les finances. | Contrôle total, modification des deadlines, validation finale, configuration SaaS. |
| **Assistant(e)** | Coordonne la facturation, prépare les devis et assure la gestion administrative. | Création de devis, suivi des paiements, planification des dates de livraison. |
| **Contrôleur Qualité (QA)** | Garantit l'exactitude des données saisies avant la livraison finale. | Validation/Rejet des livrables, demandes de révision de saisie. |
| **Opérateur Saisie** | Traite les fichiers, saisit les données requises et téléverse les livrables. | Visualisation des tâches attribuées, téléversement de documents traités. |
| **Partenaire B2B** | Client entreprise récurrent qui délègue des flux importants de dossiers. | Soumission de dossiers en masse, suivi des devis, accès à l'espace documentaire. |
| **Client B2C** | Client final ponctuel effectuant une demande de traitement unique. | Création de commande, téléchargement des livrables finaux, paiement en ligne. |

---

## 3. Architecture Fonctionnelle & Modules Clés

```
[Assistant d'Installation] ──> [Connexion / Inscription]
                                       │
      ┌────────────────────────────────┼──────────────────────────────┐
      ▼                                ▼                              ▼
[Suivi de Production]         [Planification & Suivi]       [Administration & SaaS]
 - Cycle de vie des Commandes  - Timeline dynamique (6 étapes) - Paramètres du Titre
 - Devis & Facturation         - Calendrier Interactif         - Gestion d'Équipe
 - Espace Documentaire         - Micro-tooltips & Métadonnées  - Affiliation & Rapports
```

### 3.1 Module 1 : Assistant d'Installation Initial (Setup Wizard)
- **Objectif :** Garantir un déploiement autonome, simple et rapide sur des environnements Cloud comme Vercel ou Cloud Run.
- **Fonctionnement :** 
  - Si l'application détecte que l'état d'installation n'est pas complété, elle affiche un écran de configuration verrouillé.
  - Permet de choisir dynamiquement le moteur de persistance (**Firebase**, **Supabase**, **MySQL**, **MariaDB**).
  - Collecte les coordonnées de connexion de base de données de manière sécurisée.
  - Crée le premier compte Super-Administrateur.

### 3.2 Module 2 : Tableau de Bord & Cycle de Vie des Commandes
- **Statuts Gérés :**
  1. `EN_ATTENTE_ANALYSE` : Commande ouverte par le client, pièces jointes reçues.
  2. `DEVIS_EN_PREPARATION` : L'équipe commerciale évalue le coût.
  3. `DEVIS_ENVOYE` : Proposition tarifaire transmise au client.
  4. `EN_ATTENTE_ACOMPTE` : Validation de la commande conditionnée au paiement d'un acompte.
  5. `ACOMPTE_PAYE` : Versement reçu, dossier prêt pour la production.
  6. `EN_TRAITEMENT` : Opérateurs en cours de saisie des données documentaires.
  7. `CONTROLE_QUALITE` : Étape de double relecture et de vérification.
  8. `TRAVAIL_TERMINE` & `PRET_A_LIVRER` : Livrables finaux prêts pour téléchargement.
  9. `TERMINE` : Commande clôturée avec succès.

### 3.3 Module 3 : Barre de Progression de Suivi (Timeline)
- **Description :** Un composant horizontal élégant intégré en haut de la fiche détail d'une commande.
- **Fonctionnalités :**
  - Mappe l'état technique de la commande vers l'un des 6 jalons majeurs de production : **Ouverte**, **Devis**, **Paiement**, **Production**, **Qualité**, **Livraison**.
  - Dessine une ligne de progression fluide colorée en bleu avec des indicateurs circulaires réactifs.
  - Propose des infobulles (*tooltips*) explicatives détaillant les conditions pour valider l'étape en cours de survol.

### 3.4 Module 4 : Calendrier Interactif de Planification (Planning Calendar)
- **Description :** Calendrier mensuel intégré dans la barre latérale droite de la commande.
- **Fonctionnalités :**
  - Affiche visuellement la date limite de livraison actuelle (`deadline`) pour la commande active.
  - Offre un changement de mois fluide par boutons fléchés.
  - **Planification en 1-Clic :** Les administrateurs, assistants et partenaires peuvent cliquer sur n'importe quel jour du calendrier pour replanifier automatiquement la deadline de livraison. 
  - Enregistre l'historique d'audit et notifie l'ensemble des parties prenantes (techniciens, clients, gestionnaires).

### 3.5 Module 5 : Configuration SaaS & Personnalisation de Marque
- **Description :** Permet d'éditer l'identité visuelle de l'application depuis la page de Configuration.
- **Fonctionnalités :**
  - Le titre de l'espace de travail (`saasWorkspaceTitle`) est entièrement éditable.
  - **Propagation Réactive :** La modification du titre met à jour instantanément :
    - L'onglet du navigateur et la balise `<title>` en temps réel.
    - Le logo et le titre de la barre de navigation publique.
    - Les mentions de Copyright en pied de page.
    - L'injection automatique des balises SEO & réseaux sociaux (Open Graph et Twitter Card meta tags) pour optimiser la découvrabilité et les aperçus lors des partages de liens.

---

## 4. Spécifications Techniques & Sécurité

1. **Sécurisation des Clés API :** Toutes les opérations avec des plateformes tierces ou les clés privées s'effectuent sur le serveur Node/Express (`src/server.ts`), garantissant qu'aucune clé privée (comme `GEMINI_API_KEY`) ne transite sur le client Angular.
2. **Double Enregistrement & Sauvegarde :** Les changements de planification et de statuts génèrent des journaux d'audit rigoureux et mettent à jour les tâches des opérateurs afin d'éviter toute asymétrie d'information.
3. **Respect de l'Accessibilité (a11y) :** Les composants personnalisés (calendrier, timeline, assistant) utilisent des ratios de contraste certifiés WCAG AA, garantissant une lisibilité maximale en mode clair comme en mode sombre.
