# Plan de migration progressive — Legacy `src/server.ts` → Nouvelle architecture `/api/v1`

**Profil** : DAVINCI (Principal Software Architect) — documentation + plan uniquement, aucune modification de code backend/frontend.
**Date** : 2026-08-30
**Cible** : Angular22 SPA → Express `/api/v1` → JWT/RBAC → Drizzle → Supabase PostgreSQL, multi-tenant (tenantId par table + RLS).

---

## 0. Résumé exécutif

Le repo contient deux couches backend qui cohabitent dans `src/server.ts` (4571 lignes, ~104 routes) :

- **Nouvelle archi** montée proprement sous **`/api/v1`** (`import { apiV1 } from './server/api'` + `app.use('/api/v1', apiV1)`, `src/server.ts:88-89`). Cette couche est **tenant-scoped + RBAC + JWT + Zod + helpers `ok/created/fail`**.
- **Legacy** sous **`/api`** (catch-all `app.use('/api', ...)` en fin de fichier, `src/server.ts:4534`) qui sert encore les ~18 écrans monolithiques du frontend (`src/app/app.ts` + `app.html` + `data.ts`), avec Firebase `db.json` et auth par token de session local (pas de tenantId explicite).

Le frontend Clients est le **seul** écran déjà reconnecté à `/api/v1` (via `src/app/core/api/clients.api.ts`). Tous les autres écrans appellent encore le legacy via `this.apiCall('/api/...')` dans `data.ts`.

**Objectif** : migrer domaine par domaine, un module à la fois, sans casser la prod, en gardant l'isolation tenant, jusqu'au retrait complet de `src/server.ts` (le backend legacy) — le build Angular exclut déjà `src/server` (`angular.json`/`tsconfig.app.json` modifiés).

---

## 1. Conventions de la nouvelle archi (à respecter pour chaque module)

Chaque nouveau module = 1 dossier `src/server/api/<domaine>.{router,service}.ts` + `validation/<domaine>.zod.ts` + montage dans `src/server/api/index.ts`.

- **Route** : `apiV1.use('/', <domaine>Router)` (préfixe `/api/v1` déjà posé).
- **Middleware par handler** : `authenticate` → `requireTenant` → `requirePerm('<domaine>.<action>')`.
- **Isolation tenant** : jamais de `tenant_id` côté client ; `stripTenantKeys()` + injection `req.auth!.tenantId` dans le service.
- **Validation** : Zod (schémas `Create*/Update*/Query*`), pas de body brut.
- **Réponse** : `ok / created / fail / badRequest` depuis `./response`.
- **Données** : Drizzle sur Supabase, colonne `tenantId` sur chaque table, RLS activée.
- **RBAC** : permissions granulaires `<domaine>.read|create|update|delete|manage` (voir `role`/`permission`/`rolePermission` dans `schema.ts`).

**Écarts legacy à corriger à la migration** : le legacy n'a pas de tenantId explicite (auth par `userId` de session), pas de RBAC fin, valide peu. Le nouveau doit **réinjecter le tenant** depuis le JWT et **ajouter les permissions** manquantes dans les seeds de rôles.

---

## 2. Cartographie des domaines (legacy → nouveau module)

Légende status : ✅ nouveau existant & E2E · 🟡 partiel/nouveau existe mais FE branche encore legacy · ❌ aucun module nouveau.
Légende priorité : P0 (sécurité/admin critiques) · P1 (cœur métier) · P2 (support) · P3 (annexe).

| # | Domaine legacy (`src/server.ts` routes) | Nouveau module `/api/v1` | Status | Priorité | Écrans FE à reconnecter (`src/app`) |
|---|---|---|---|---|---|
| 1 | Auth: `POST /api/auth/login`, `POST /api/auth/register` (361, 405) | `auth` (`/api/v1/auth/login`, `/register-tenant`, `/refresh`, `/logout`) | ✅ existant | P0 | Login déjà `/api/v1` (clients.api.ts). Déprécier legacy register. |
| 2 | Users: `GET/PUT/DELETE /api/users`, `:id/profile`, `:id/toggle-active`, `:id/reset-password` (506–860) | **`users`** (CRUD) + `roles` (déjà `/users/:id/roles`) | ❌ manque CRUD users | P0 | Écran Users (`usersActiveSubTab`) — `loadAllUsers/createUser/updateUser/deleteUser/updateUserProfile/resetPassword` |
| 3 | Clients overview: `GET /api/clients/overview` (1194) ; Partners: `GET/POST /api/partners/customers` (1483) | `clients` (`/api/v1/clients`) | ✅ existant | P1 | Clients ✅ fait. Partners/customers → mapper comme `client` de type partenaire (ajouter discriminateur). |
| 4 | Services: `GET/POST/PUT/DELETE /api/services` (1292–1483) ; Service categories (1327–1393) | **`services`** (`serviceCatalog` table existe) | ❌ manque | P1 | Écran Services (`services` tabs) — `loadServices/saveService/deleteService`, `loadServiceCategories/...` |
| 5 | Orders: `GET/POST /api/orders` + 14 sous-routes `:id/status|deadline|quote|quote/action|assign|upload|messages|qa|pay|revisions|satisfaction|payment-terms` (1552–2800) | **`orders`** (`project`/`serviceItem`/`productionJob`/`jobStatusHistory` tables existent) | ❌ manque (gros module) | P1 | Écran Commandes (Orders) — `loadOrders/createOrder/updateOrder*`, fichiers, messages, QA, paiement |
| 6 | Billing: `GET /api/payments` (1578) ; `POST /api/orders/:id/pay` (2318) ; quotes via orders | `billing` (`/quotes`,`/invoices`,`/payments`,`/refunds`) | ✅ existant | P1 | Écran Paiements — `loadPayments`. Lier orders→devis→facture (FK `orderId`/`projectId`). |
| 7 | Stock: `/api/print/materials`, `/api/print/stock-movements` (3744–3811) | `stock` (`/stock`,`/stock/movements`,`/stock/alerts`) | ✅ existant | P1 | Onglet Print/Stock — `loadMaterials/createMaterial/movement/loadStockMovements` |
| 8 | Machines: `/api/print/machines`, `/counter-readings` (3652–3744) | `machines` (`/machines`,`:id/counters`,`:id/maintenance`,`/estimate`) | ✅ existant | P1 | Onglet Print/Machines/Counters — `loadMachines/createMachine/counterReading` |
| 9 | Delivery: `/api/print/deliveries` (3819–3868) | `delivery` (`/deliveries`,`:id/attempts`) | ✅ existant | P1 | Onglet Print/Deliveries — `loadDeliveries/createDelivery/updateDelivery` |
| 10 | Pricing/Print config: `/api/print/pricing`, `/quote-preview` (3868–3895) | **`pricing`** (`pricingConfig`/`machineCost` tables existent) | ❌ manque | P1 | Onglet Print/Pricing — `loadPricing/savePricing`, `quote-preview` |
| 11 | Affiliates: `/api/affiliates*`, `/affiliate-commissions*` (2708–3141) | `affiliates` (`/affiliates`,`:id/referrals|commissions|summary`,`/commissions/:id/status`) | ✅ existant | P1 | Écran Affiliés + Commissions — `loadAffiliates/loadAffiliateCommissions/activate/convert-balance` |
| 12 | Notifications: `/api/notifications*` (185–251) | **`notifications`** (`notification`/`notificationRule` tables existent) | ❌ manque | P2 | Écran Notifications — `loadNotifications/read/read-all/delete` |
| 13 | HR/Payroll: `/api/payrolls`, `/leave-requests`, `/salary-advances` (860–1194) | **`hr`** (tables `payroll`/`leave`/`salaryAdvance` à créer) | ❌ manque | P2 | Onglet RH (`hrActiveSubTab`) — `loadPayrolls/savePayroll/deletePayroll`, `loadLeaveRequests`, `loadSalaryAdvances` |
| 14 | Dashboard/Stats: `/api/dashboard/stats` (3141) ; `/api/print/dashboard` (3895) | **`dashboard`** | ❌ manque | P2 | Écran Dashboard — `loadStats`, `loadPrintDashboard` |
| 15 | Audit logs: `/api/audit-logs` (3203) | **`audit`** (`auditLog` table existe) | ❌ manque | P2 | Écran Audit (admin) — `loadAuditLogs` |
| 16 | Settings: `/api/settings`, `/gdrive/accounts`, `/resources`, `/firebase-config` (3213–3991) | **`settings`** (`config` table existe) | ❌ manque | P3 | Écran Settings — `loadSettings/saveSettings`, gdrive, resources, firebase-config |
| 17 | AI assistant: `/api/ai/analyze-document`, `/draft-spec`, `/message-assistant` (4198–4389) | **`ai`** | ❌ manque | P3 | Onglet IA — `data.ts` appels `/api/ai/*` |
| 18 | Setup/Onboarding: `/api/setup/status`, `/setup/submit` (266–361, doublons 3991) | partie `auth/register-tenant` ou **`setup`** | ❌ manque | P3 | Écran Setup — `loadSetup/submitSetup` |
| 19 | Dev/Ops: `/api/reset`, `/database/purge`, `/database/test-connection`, `/api/init`, `robots.txt`, `sitemap.xml` (3930–4422) | **NON migré** (outils serveur) — à sécuriser/restreindre, jamais exposé en `/api/v1` | ❌ volontairement exclu | P3 | Aucun (outils). Garder hors tenant, protéger par env/secret. |

**Tables schema orphelines** (définies dans `src/db/schema.ts` mais sans routeur nouveau) → à rattacher aux modules ci-dessus : `clientContact`, `serviceCatalog`, `pricingConfig`, `project`, `serviceItem`, `jobStatusHistory`, `productionJob`, `batch`, `stockReservation`, `purchaseOrder(+Line)`, `purchaseReceipt`, `creditNote`, `commissionPayout`, `fileAsset`, `fileVersion`, `notification(Rule)`, `config`, `auditLog`.

---

## 3. Ordre recommandé de migration (par phases)

Priorité = sécurité/admin d'abord, puis cœur métier, puis support, puis annexes. Chaque phase livre **un module complet** (routeur + service + validation + montage + reconnexion FE + E2E) avant de passer au suivant. Ne jamais retirer une route legacy tant que le FE n'est pas basculé et les E2E verts.

### Phase A — Fondations & admin (P0) — à finaliser
- [ ] **Users CRUD** (#2) : créer `users.router/service.ts` sous `/api/v1/users` (`createUser/updateUser/deleteUser/:id/profile/toggle-active/reset-password`), RBAC `manage_users`. Seed des rôles existants. Reconnecter écran Users.
- [ ] **Auth legacy deprecation** (#1) : marquer `POST /api/auth/register` legacy comme déprécié (log + 301 vers `/api/v1/auth/register-tenant`), garder `login` legacy en miroir tant que d'autres écrans ne sont pas tous sur JWT.

### Phase B — Cœur métier (P1)
- [ ] **Services & Service Categories** (#4) → `/api/v1/services`, `/service-categories`. Reconnecter écran Services.
- [ ] **Pricing** (#10) → `/api/v1/pricing` + `/quote-preview`. Reconnecter onglet Print/Pricing.
- [ ] **Orders / Production** (#5, le plus gros) → `/api/v1/orders` couvrant `productionJob`+`serviceItem`+`jobStatusHistory`+`project`, toutes les sous-routes legacy (`status/deadline/quote/assign/upload/messages/qa/pay/revisions/satisfaction/payment-terms`). Reconnecter écran Commandes. **Dépend de** Clients(#3✅), Services(#4), Pricing(#10), Machines(#8✅).
- [ ] **Billing linkage** (#6) : ajouter FK `orderId`/`projectId` sur `quotation`/`invoice`/`payment` et le endpoint `POST /api/v1/orders/:id/pay` qui crée un `payment`+`invoice`. Reconnecter écran Paiements.

### Phase C — Modules impression déjà neufs mais FE branché legacy (P1)
- [ ] **Stock** (#7) : reconnecter FE Print/Stock vers `/api/v1/stock` (adapter types `PrintMaterial`→`material`, `PrintStockMovement`→`stockMovement`).
- [ ] **Machines** (#8) : reconnecter FE Print/Machines/Counters vers `/api/v1/machines`.
- [ ] **Delivery** (#9) : reconnecter FE Print/Deliveries vers `/api/v1/deliveries` (`DeliveryTask`→`delivery`).

### Phase D — Support & visibilité (P2)
- [ ] **Notifications** (#12) → `/api/v1/notifications` (`notification`/`notificationRule`). Reconnecter écran Notifications.
- [ ] **Dashboard/Stats** (#14) → `/api/v1/dashboard` (agrégats tenant-scoped). Reconnecter Dashboard.
- [ ] **Audit** (#15) → `/api/v1/audit` (lecture seule admin). Reconnecter écran Audit.
- [ ] **HR/Payroll** (#13) → créer tables `payroll`/`leaveRequest`/`salaryAdvance` + `/api/v1/hr`. Reconnecter onglet RH.

### Phase E — Annexes (P3)
- [ ] **Settings** (#16) → `/api/v1/settings` (`config`), gdrive/resources/firebase-config. Reconnecter écran Settings.
- [ ] **AI** (#17) → `/api/v1/ai`. Reconnecter onglet IA.
- [ ] **Setup/Onboarding** (#18) → fusionner dans `auth/register-tenant` ou `/api/v1/setup`. Reconnecter écran Setup.
- [ ] **Dev/Ops** (#19) : isoler `/api/reset`,`/database/*`,`/init` derrière garde d'env (ex: `ALLOW_DEV_ENDPOINTS`), jamais sous `/api/v1`. `robots.txt`/`sitemap.xml` restent statiques.

### Phase F — Retrait legacy
- [ ] Quand **tous** les écrans FE pointent sur `/api/v1` et les E2E legacy sont supprimés : supprimer les routes legacy de `src/server.ts`, puis supprimer `src/server.ts` (et `server-db.ts`/Firebase), et retirer le catch-all `app.use('/api', ...)` (ligne 4534).
- [ ] Supprimer `db.json` / Firebase de la prod.

---

## 4. Écrans frontend à reconnecter (checklist `src/app`)

Le frontend est un monolithe (`app.ts` + `app.html` + `data.ts`). Chaque méthode `data.ts` ci-dessous doit être repointée de `/api/...` vers `/api/v1/...` (ou nouveau module) et ses types alignés sur les schémas Drizzle :

- [x] **Clients** ✅ (`core/api/clients.api.ts`, `/api/v1/clients`)
- [ ] **Users** : `loadAllUsers, createUser, updateUser, deleteUser, updateUserProfile, resetPassword` → `/api/v1/users`
- [ ] **Partners/Customers** : `loadPartnerCustomers, createPartnerCustomer` → `/api/v1/clients?type=partner`
- [ ] **Services** : `loadServices, saveService, deleteService, loadServiceCategories, createServiceCategory, updateServiceCategory, deleteServiceCategory` → `/api/v1/services`
- [ ] **Orders** : `loadOrders, createOrder, loadOrderDetails, updateOrderStatus/Deadline/PaymentTerms, uploadOrderFile, deleteOrderFile, orderMessages/QA, orderPay, revisions, satisfaction` → `/api/v1/orders`
- [ ] **Payments** : `loadPayments` → `/api/v1/billing/payments`
- [ ] **Affiliates** : `loadAffiliates, createAffiliate, updateAffiliate, loadAffiliateCommissions, updateCommissionStatus, requestActivation, activate, convertBalance, loadPublicSponsorByCode` → `/api/v1/affiliates`
- [ ] **Print/Jobs** : `loadPrintJobs, createPrintJob, updatePrintJob, consumeJob` → à évaluer : fusionner dans Orders(#5) ou garder `/api/v1/machines`+nouveau `/api/v1/jobs`
- [ ] **Print/Machines** : `loadMachines, createMachine, updateMachine, counterReading, loadCounterReadings` → `/api/v1/machines`
- [ ] **Print/Materials/Stock** : `loadMaterials, createMaterial, materialMovement, loadStockMovements` → `/api/v1/stock`
- [ ] **Print/Deliveries** : `loadDeliveries, createDelivery, updateDelivery` → `/api/v1/deliveries`
- [ ] **Print/Pricing** : `loadPricing, savePricing, quotePreview, loadPrintDashboard` → `/api/v1/pricing` + `/api/v1/dashboard`
- [ ] **Notifications** : `loadNotifications, readNotification, readAll, deleteNotification` → `/api/v1/notifications`
- [ ] **HR** : `loadPayrolls, savePayroll, deletePayroll, loadLeaveRequests, createLeaveRequest, updateLeaveStatus, loadSalaryAdvances, createSalaryAdvance, updateSalaryAdvanceStatus` → `/api/v1/hr`
- [ ] **Dashboard/Stats** : `loadStats` → `/api/v1/dashboard`
- [ ] **Settings** : `loadSettings, saveSettings, gdrive accounts, resources, firebase-config` → `/api/v1/settings`
- [ ] **Setup** : `loadSetupStatus, submitSetup` → `/api/v1/setup` ou `auth/register-tenant`
- [ ] **AI** : `data.ts` appels `/api/ai/*` → `/api/v1/ai`

**Note FE** : `app.ts` ligne 623/648 appelle `/api/settings/firebase-config` — à basculer en `/api/v1/settings/firebase-config`. Le helper `apiCall()` dans `data.ts` (ligne ~1621) construit les URLs ; centraliser le préfixe (`/api/v1`) et l'injection du `Authorization: Bearer` (JWT stocké par `clients.api.ts`) pour tous les écrans migrés.

---

## 5. Garde-fous (ne jamais casser)

1. **Montage sans collision** : `/api/v1` est déjà séparé de `/api` (legacy) — garder ce découpage jusqu'au retrait. Ne pas ajouter de route `/api/*` nouvelle.
2. **Tenant toujours injecté** : chaque service prend `tenantId` en 1er arg, jamais depuis le body. `stripTenantKeys()` obligatoire.
3. **RBAC** : ajouter les permissions manquantes dans les seeds de rôles (ex: `users.*`, `services.*`, `orders.*`, `hr.*`, `notifications.*`, `dashboard.*`, `audit.*`, `settings.*`, `ai.*`). Vérifier qu'aucun rôle légitime ne perd l'accès.
4. **Parité contrat** : pour chaque route legacy migrée, maintenir le même shape de réponse (ou versionner) pour ne pas casser le FE pendant la transition. Préférer : migrer BE + FE du domaine ensemble, puis supprimer la route legacy.
5. **E2E par domaine** : reprendre le standard « 69/69 E2E » par module avant `COMPLETED`. Pas de mock/hardcoded (backend réel Supabase).
6. **RLS** : vérifier la policy par table avant ouverture du module en prod.
7. **Dev/Ops** : `#19` jamais exposé en `/api/v1`, protégé par `ALLOW_DEV_ENDPOINTS` en env.

---

## 6. Critères de fin de migration (retrait de `src/server.ts`)

- [ ] 0 appel `/api/` (legacy) restant dans `src/app/**` (tout pointe `/api/v1`).
- [ ] Tous les domaines #1–#18 livrés avec routeur + service + validation + E2E verts.
- [ ] RLS vérifiée sur chaque table multi-tenant.
- [ ] `db.json`/Firebase supprimés de la prod ; `src/server.ts` + `server-db.ts` supprimés ; build Angular ne référence plus `src/server`.
- [ ] Documentation `docs/api-*.md` mise à jour par domaine.

---

## Annexe A — Routes legacy recensées (`src/server.ts`, numéros de ligne)

- Notifications : 185, 199, 216, 234, 251
- Setup status/submit : 266, 276 (doublons 3991, 4008)
- Auth login/register : 361, 405
- Users CRUD/profile/toggle/reset : 506, 578, 604, 735, 760, 794
- Payrolls : 860, 882, 932, 967
- Leave-requests : 998, 1017, 1054
- Salary-advances : 1099, 1121, 1158
- Clients overview : 1194
- Services : 1292, 1393, 1428, 1457
- Service-categories : 1327, 1334, 1357, 1379
- Partners/customers : 1483, 1524
- Orders + 14 sous-routes : 1552, 1578, 1587, 1607, 1731, 1850, 1892, 1961, 2031, 2084, 2172, 2206, 2318, 2527, 2582, 2638, 2680
- Affiliates : 2708, 2752, 2805, 2855, 2887, 2914, 2947
- Affiliate-commissions : 3012, 3036, 3108
- Dashboard stats : 3141
- Audit-logs : 3203
- Settings (+gdrive/resources/firebase-config) : 3213, 3231, 3251, 3282, 3307, 3362, 3961, 3971
- Print jobs/machines/counters/materials/stock/deliveries/pricing/quote-preview/dashboard : 3525, 3532, 3584, 3611, 3652, 3659, 3685, 3697, 3704, 3744, 3751, 3779, 3811, 3819, 3826, 3855, 3868, 3875, 3885, 3895
- Reset/database/init/test-connection : 3930, 3942, 3961, 4121, 4147
- AI : 4199, 4289, 4344
- Statics : 4398 (robots.txt), 4422 (sitemap.xml)
- Catch-all legacy : 4534 (`app.use('/api', ...)`)

## Annexe B — Modules neufs déjà présents (`src/server/api/`)

`auth.router` (login/register-tenant/refresh/logout), `roles.router` (me/permissions/roles/users/:id/roles), `clients.router` (+contacts, tenant-scoped), `stock.router`, `machines.router`, `billing.router` (quotes/invoices/payments/refunds), `delivery.router`, `affiliates.router`. Montés dans `index.ts` sous `/api/v1`.
