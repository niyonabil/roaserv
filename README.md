# ROA Services — Plateforme SaaS multi-tenant (imprimerie & services)

Plateforme de gestion pour une imprimerie / services : clients, devis, factures,
paiements, stock, machines, livraisons, affiliés — multi-tenant, sécurisée.

## Architecture

```
Angular 22 (SPA statique)  ──>  Express API (/api/v1)  ──>  JWT + RBAC
                                                  │
                                                  └──>  Drizzle ORM  ──>  Supabase PostgreSQL
```

- **Frontend** : Angular 22 (monolith), build statique dans `dist/browser`.
- **Backend** : Express dans `src/server/api/*` (modules tenant-scoped), bundlé
  en `dist/api-bundle.cjs` (serverless Vercel) ou servi en local par `dist/api-test.cjs`.
- **Auth** : JWT access + refresh, bcrypt, RBAC (`requirePerm(verb)`).
- **DB** : Supabase PostgreSQL 17, pooler transaction. Chaque table métier a
  `tenant_id` (isolation applicative) + RLS PostgreSQL (défense-en-profondeur).

## Modules livrés (nouvelle architecture)

| Domaine | Routes | Permissions |
|---|---|---|
| Auth / RBAC | `/api/auth/login`, `/api/roles`, `/api/permissions`, `/api/me` | — |
| Clients | `/api/v1/clients` CRUD | `clients.*` |
| Billing | `/api/v1/quotes`, `/invoices`, `/payments` (+ items/refunds) | `billing.*` |
| Stock & Imprimerie | `/api/v1/stock`, `/stock/movements`, `/machines` | `stock.*`, `machines.*` |
| Livraison | `/api/v1/deliveries` (+ attempts) | `delivery.*` |
| Affiliés | `/api/v1/affiliates` (+ referrals/commissions) | `affiliates.*` |

> Le legacy `src/server.ts` (104 routes Firebase) est en cours de migration
> progressive — voir `docs/MIGRATION_PLAN.md`.

## Prérequis

- **Node.js 24+** (testé avec Node 24.15.0).
- **PostgreSQL 17** (Supabase recommandé) avec les 46 tables migrées + seed exécuté.
- **npm**.

## Configuration de la base de données

La connexion est lue depuis les variables d'environnement (jamais commitées) :

| Variable | Description | Exemple |
|---|---|---|
| `DATABASE_URL` | Pooler Supabase PostgreSQL | `postgresql://postgres.<project>:<pwd>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres` |
| `JWT_SECRET` | Clé HS256 des access tokens | chaîne aléatoire ≥ 32 chars |
| `JWT_REFRESH_SECRET` | Clé HS256 des refresh tokens | chaîne aléatoire ≥ 32 chars |
| `JWT_EXPIRES_IN` | Durée access token (s) | `900` |
| `JWT_REFRESH_EXPIRES_IN` | Durée refresh token (s) | `2592000` |
| `PORT` | Port du serveur API local | `4100` |

### 1. Créer la base (Supabase)

- Créez un projet Supabase, récupérez l'URL du **pooler transaction** (port 6543).
- Appliquez les migrations Drizzle : `npx drizzle-kit migrate` (génère les 46 tables).
- Activez le RLS (optionnel mais recommandé) : `psql "$DATABASE_URL" -f scripts/enable-rls.sql`
- Peupler le tenant par défaut + admin : `npx tsx scripts/seed.ts`
  (idempotent — redonne toujours toutes les permissions au rôle `admin`).

### 2. Variables locales (PowerShell)

```powershell
$env:DATABASE_URL="postgresql://postgres.<project>:<pwd>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"
$env:JWT_SECRET="roa_services_super_secret_change_me_xxxxxxxx"
$env:JWT_REFRESH_SECRET="roa_services_refresh_secret_xxxxxxxx"
$env:PORT="4100"
```

(Bash / Git Bash) :
```bash
export DATABASE_URL="postgresql://..."
export JWT_SECRET="..."
export JWT_REFRESH_SECRET="..."
export PORT=4100
```

## Lancer en local

### Backend (API)
```bash
npm run build:api          # génère dist/api-bundle.cjs
# ou le bundle de test (avec listen intégré) :
npx esbuild src/server/api/bootstrap.ts --bundle --platform=node --format=cjs \
  --outfile=dist/api-test.cjs --external:pg --external:bcryptjs \
  --external:jsonwebtoken --external:drizzle-orm
node dist/api-test.cjs     # écoute sur $PORT (4100)
```

### Frontend (Angular dev)
```bash
npm install
npm run dev                # ng serve sur http://localhost:3000
```

### Tout-en-un (Electron desktop)
Voir `electron/` — l'appli démarre backend + frontend au lancement et les
ferme proprement à la fermeture. Configuration via `roaserv.config.json`
(URL DB, ports, chemins) — éditable avec l'outil `config-tool/`.

## Version desktop (Electron)

L'appli desktop démarre **backend + frontend dans le même processus** au lancement
et les **ferme proprement à la fermeture** de la fenêtre (aucun daemon orphelin).

### Build + lancement
```bash
npm run electron:build     # build:api (bundle) + ng build (frontend statique)
cd electron && npm install  # 1re fois : installe electron + electron-builder
npm run electron:start      # build puis lance l'appli desktop
```

### Configuration (BDD)
L'appli lit la config dans cet ordre :
1. variables d'env (`DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ROA_PORT`)
2. fichier `roaserv.config.json` (à la racine) — éditable via l'outil `config-tool/`
3. valeurs par défaut (port **4180**)

Copiez `roaserv.config.example.json` → `roaserv.config.json` et renseignez votre
URL Supabase + secrets JWT. **Ce fichier est git-ignoré** (contient des secrets).

```json
{
  "databaseUrl": "postgresql://postgres.<project>:<pwd>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
  "jwtSecret": "longue_chaine_aleatoire_32+_chars",
  "jwtRefreshSecret": "autre_longue_chaine_aleatoire",
  "port": 4180
}
```

### Comportement démarrer / arrêter
- **Au démarrage** : `electron/main.js` monte `apiV1` (backend) sous `/api/v1`,
  sert `dist/browser` (frontend Angular), écoute sur `ROA_PORT`, ouvre la fenêtre.
- **À la fermeture** : `app.on('window-all-closed')` → `app.quit()` → le process
  Node se termine → le serveur Express s'arrête. Aucun process enfant à tuer.

### Packaging (Windows .exe / installer)
```bash
cd electron && npm install && npx electron-builder --win nsis
```
Génère `release/ROA Services Setup.exe`.

> Note : le port **3000** est souvent occupé par une autre app sur la machine de
> dev — utilisez **5173** pour `ng serve` (`npm run dev:fe`) et **4180** pour
> l'Electron (défaut). Le frontend buildé (dist/browser) ne dépend d'aucun port.


```bash
export DATABASE_URL=... JWT_SECRET=... JWT_REFRESH_SECRET=...
node scripts/e2e-auth.cjs            # 13/13
node scripts/e2e-clients.cjs         # 23/23
node scripts/e2e-billing-stock.cjs  # 19/19
node scripts/e2e-delivery-affiliates.cjs  # 14/14
node scripts/verify-rls.cjs          # validation RLS (read-only)
```

## Déploiement

- **Vercel** : branché sur le repo GitHub `niyonabil/roaserv` (branche `main`).
  `vercel-build` = `ng build` + `build:api`. Le serverless `api/index.ts` monte
  `apiV1`. Variables d'env à configurer dans le dashboard Vercel.
- URL prod : https://roaserv-niyonabils-projects.vercel.app

## Sécurité

- Isolation multi-tenant applicative (tout query filtré par `tenantId` JWT) + RLS.
- RBAC côté serveur (`requirePerm`), jamais seul masquage UI.
- Validation Zod à la frontière, erreurs 400/401/403/404/409.
- Rate-limit sur `/api/auth/login` (brute-force).
- Voir `docs/security-hardening.md` et `docs/MIGRATION_PLAN.md`.
