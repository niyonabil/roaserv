import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import { GoogleGenAI, Type } from '@google/genai';
import {
  loadDatabase,
  saveDatabase,
  deleteFirestoreDoc,
  resetDatabase,
  purgeDatabase,
  invalidateDatabaseCache,
  getFirebaseConfig,
  updateFirebaseConfig,
  logAction,
  User,
  UserPrivileges,
  getDefaultPrivileges,
  AppDatabase,
  PartnerCustomer,
  Service,
  Order,
  Quote,
  Invoice,
  Payment,
  OrderFile,
  OrderMessage,
  OrderTask,
  QualityChecklist,
  OrderRevision,
  PayrollRecord,
  LeaveRequest,
  SalaryAdvance,
  AffiliateCommission,
  SystemSettings,
  PrintJob,
  PrintMachine,
  MachineCounterReading,
  PrintMaterial,
  PrintStockMovement,
  DeliveryTask,
  PrintPricingConfig,
  ServiceCategory,
} from './server-db';

// Résolution de chemin compatible Vercel/serverless :
// en bundle CJS, `import.meta` est indéfini — on retombe sur process.cwd().
const _metaDir: string | undefined = (() => {
  try { return (import.meta as unknown as { dirname?: string })?.dirname ?? undefined; }
  catch { return undefined; }
})();
const _cwd = process.cwd();

const possiblePaths = [
  ...(typeof _metaDir === 'string' ? [
    join(_metaDir, '../browser'),       // Default SSR structure (when outputPath is dist/app)
    join(_metaDir, '../'),              // outputPath has base="dist", browser=""
    join(_metaDir, '../../dist'),       // running node src/server.ts directly from workspace root
    join(_metaDir, '../dist')           // backup check
  ] : []),
  join(_cwd, 'dist/browser'),           // Vercel / serverless: cwd = racine du projet
  join(_cwd, 'browser'),
  join(_cwd, 'dist')
];

let browserDistFolder = '';
for (const p of possiblePaths) {
  if (existsSync(join(p, 'index.html')) || existsSync(join(p, 'index.csr.html'))) {
    browserDistFolder = p;
    break;
  }
}
if (!browserDistFolder) {
  browserDistFolder = possiblePaths[0]; // Fallback to default
}
console.log(`[SSR] browserDistFolder: ${browserDistFolder}`);

const app = express();
app.use(express.json({ limit: '50mb' }));

// Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; style-src-elem 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://firestore.googleapis.com;");
  next();
});

app.use((req, res, next) => {
  console.log(`[Request] ${req.method} ${req.url}`);
  next();
});

const angularApp = new AngularNodeAppEngine();

// --- NOTIFICATION HELPERS ---
async function dispatchNotificationToUsers(
  db: AppDatabase,
  userIds: string[],
  order: { id: string; reference: string },
  title: string,
  message: string
) {
  try {
    if (!db.notifications) {
      db.notifications = [];
    }
    const cleanIds = Array.from(new Set(userIds.filter(id => Boolean(id) && id.trim().length > 0)));
    for (const uid of cleanIds) {
      db.notifications.unshift({
        id: 'not-' + Math.random().toString(36).substring(2, 9),
        userId: uid,
        orderId: order.id,
        orderReference: order.reference,
        title,
        message,
        read: false,
        createdAt: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error('Error dispatching notification:', err);
  }
}

async function notifyOrderStakeholders(
  db: AppDatabase,
  order: Order,
  title: string,
  message: string,
  options: { includeClient?: boolean; includePartner?: boolean; includeAdmins?: boolean; includeAssigned?: boolean } = {
    includeClient: true,
    includePartner: true,
    includeAdmins: true,
    includeAssigned: true
  }
) {
  const targetIds: string[] = [];

  // Direct client
  if (options.includeClient !== false && order.customerDetails?.email) {
    const clientUser = db.users.find((u: User) => u.email.toLowerCase() === order.customerDetails?.email.toLowerCase());
    if (clientUser) {
      targetIds.push(clientUser.id);
    }
  }

  // Partner
  if (options.includePartner !== false && order.partnerId) {
    targetIds.push(order.partnerId);
  }

  // Admins
  if (options.includeAdmins) {
    const adminUsers = db.users.filter((u: User) => u.role === 'admin' && u.active);
    adminUsers.forEach(a => targetIds.push(a.id));
  }

  // Assigned Operator & QA
  if (options.includeAssigned) {
    order.tasks?.forEach(t => {
      if (t.operatorId) targetIds.push(t.operatorId);
      if (t.qaId) targetIds.push(t.qaId);
    });
  }

  await dispatchNotificationToUsers(db, targetIds, order, title, message);
}

// --- REST API ENDPOINTS ---

// Notifications Endpoints
app.get('/api/notifications', async (req, res) => {
  try {
    const { userId } = req.query;
    const db = await loadDatabase();
    let notifications = db.notifications || [];
    if (userId) {
      notifications = notifications.filter(n => n.userId === userId);
    }
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/notifications/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const db = await loadDatabase();
    if (db.notifications) {
      const notification = db.notifications.find(n => n.id === id);
      if (notification) {
        notification.read = true;
        await saveDatabase(db);
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/notifications/read-all', async (req, res) => {
  try {
    const { userId } = req.body;
    const db = await loadDatabase();
    if (db.notifications && userId) {
      db.notifications.forEach(n => {
        if (n.userId === userId) {
          n.read = true;
        }
      });
      await saveDatabase(db);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete('/api/notifications/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = await loadDatabase();
    if (db.notifications) {
      const idx = db.notifications.findIndex(n => n.id === id);
      if (idx >= 0) {
        db.notifications.splice(idx, 1);
        await saveDatabase(db);
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete('/api/notifications', async (req, res) => {
  try {
    const { userId } = req.query;
    const db = await loadDatabase();
    if (db.notifications && userId) {
      db.notifications = db.notifications.filter(n => n.userId !== userId || !n.read);
      await saveDatabase(db);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Setup & Installation Wizard Endpoints
app.get('/api/setup/status', async (req, res) => {
  try {
    const db = await loadDatabase();
    const isSetupCompleted = !!(db.settings && db.settings.isSetupCompleted);
    res.json({ isSetupCompleted });
  } catch {
    res.json({ isSetupCompleted: false });
  }
});

app.post('/api/setup/submit', async (req, res) => {
  try {
    const { dbConfig, adminUser } = req.body;
    
    if (!adminUser || !adminUser.name || !adminUser.email || !adminUser.password) {
      res.status(400).json({ error: "Les informations de l'administrateur (nom, e-mail, mot de passe) sont requises." });
      return;
    }

    const db = await loadDatabase();
    
    if (!db.settings) {
      db.settings = { 
        companyName: 'DigiDocs Services SARL', 
        address: "14 Boulevard d'Anfa, Étage 3, Casablanca, Maroc", 
        phone: "+212 522-123456", 
        email: "contact@digidocs.ma", 
        currency: 'DH', 
        taxRate: 20, 
        depositRules: {normal:50,fast:60,urgent:70,very_urgent:80}, 
        urgencySurcharges: {normal:0,fast:30,urgent:60,very_urgent:100}, 
        googleDriveAccounts: [], 
        resourceDocuments: [], 
        googleDriveTransferLogs: [] 
      };
    }

    if (dbConfig) {
      db.settings.databaseType = dbConfig.databaseType || 'firebase';
      db.settings.dbConfig = {
        host: dbConfig.host || '',
        port: dbConfig.port ? Number(dbConfig.port) : 3306,
        databaseName: dbConfig.databaseName || '',
        username: dbConfig.username || '',
        password: dbConfig.password ? '********' : '',
        connected: true,
        lastTestedAt: new Date().toISOString()
      };
    }

    db.settings.isSetupCompleted = true;

    const adminEmail = adminUser.email.trim().toLowerCase();
    const adminUsername = adminUser.username ? adminUser.username.trim().toLowerCase() : 'admin';
    
    let user = db.users.find(u => u.email.toLowerCase() === adminEmail);
    if (user) {
      user.name = adminUser.name;
      user.username = adminUsername;
      user.password = adminUser.password;
      user.role = 'admin';
      user.active = true;
    } else {
      user = {
        id: 'usr-admin-setup',
        name: adminUser.name,
        username: adminUsername,
        email: adminEmail,
        password: adminUser.password,
        role: 'admin',
        active: true,
        createdByRole: 'admin',
        createdAt: new Date().toISOString(),
        privileges: {
          canManageOrders: true,
          canValidateQuality: true,
          canDeliverOrders: true,
          canManageClients: true,
          canManageTools: true,
          canViewFinancials: true
        }
      };
      db.users.push(user);
    }

    await saveDatabase(db);
    await logAction(user.id, user.name, 'Installation Système', 'Configuration initiale réussie de la base de données et création du compte administrateur.');
    
    res.json({ success: true, message: "Installation terminée avec succès !" });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Auth Endpoints
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, username, identifier, password } = req.body;
    const loginId = (identifier || email || username || '').toString().trim().toLowerCase();
    
    if (!loginId) {
      res.status(400).json({ error: 'Nom d\'utilisateur ou adresse e-mail requis.' });
      return;
    }

    if (!password) {
      res.status(400).json({ error: 'Mot de passe requis.' });
      return;
    }

    const db = await loadDatabase();
    const user = db.users.find(u => 
      u.email.toLowerCase() === loginId || 
      (u.username && u.username.toLowerCase() === loginId)
    );

    if (!user) {
      res.status(401).json({ error: 'Compte introuvable pour cet identifiant (nom d\'utilisateur ou e-mail).' });
      return;
    }

    // Check password if set on user record
    if (user.password && user.password !== password.trim()) {
      res.status(401).json({ error: 'Mot de passe incorrect. Veuillez réessayer.' });
      return;
    }

    // If user has no password yet (legacy), initialize it
    if (!user.password && password) {
      user.password = password.trim();
      await saveDatabase(db);
    }

    res.json({ user, token: 'token-' + user.id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, username, email, password, role, phone, city, address, company, ice, privileges, createdByUserId, createdByRole, affiliateCode, refCode } = req.body;
    if (!name || !email || !role || !password) {
      res.status(400).json({ error: 'Champs requis manquants (Nom, Email, Mot de passe, Rôle).' });
      return;
    }
    
    const db = await loadDatabase();
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedUsername = (username || email.split('@')[0] || '').toLowerCase().trim();

    const existingEmail = db.users.find(u => u.email.toLowerCase() === normalizedEmail);
    if (existingEmail) {
      res.status(400).json({ error: 'Un utilisateur avec cette adresse e-mail existe déjà.' });
      return;
    }

    const existingUsername = db.users.find(u => u.username && u.username.toLowerCase() === normalizedUsername);
    if (existingUsername) {
      res.status(400).json({ error: 'Ce nom d\'utilisateur est déjà utilisé. Veuillez en choisir un autre.' });
      return;
    }

    const assignedPrivileges: UserPrivileges = privileges && typeof privileges === 'object' 
      ? {
          canManageOrders: Boolean(privileges.canManageOrders),
          canValidateQuality: Boolean(privileges.canValidateQuality),
          canDeliverOrders: Boolean(privileges.canDeliverOrders),
          canManageClients: Boolean(privileges.canManageClients),
          canManageTools: Boolean(privileges.canManageTools),
          canViewFinancials: Boolean(privileges.canViewFinancials),
        }
      : getDefaultPrivileges(role);

    // Look up affiliate attribution
    let referredByAffiliateId: string | undefined;
    let referredByAffiliateCode: string | undefined;
    const codeToSearch = (affiliateCode || refCode || '').toString().trim().toUpperCase();
    if (codeToSearch) {
      const affUser = db.users.find(u => u.affiliateCode && u.affiliateCode.toUpperCase() === codeToSearch);
      if (affUser) {
        // Prevent self-referral/self-registration using one's own code
        if (affUser.email.toLowerCase().trim() !== normalizedEmail) {
          referredByAffiliateId = affUser.id;
          referredByAffiliateCode = affUser.affiliateCode;

          if (!db.notifications) db.notifications = [];
          db.notifications.unshift({
            id: 'notif-' + Math.random().toString(36).substring(2, 9),
            userId: affUser.id,
            title: '🎉 Nouveau Client Parrainé !',
            message: `Votre code de parrainage (${affUser.affiliateCode}) a été utilisé par "${name.trim()}" lors de sa création de compte.`,
            read: false,
            createdAt: new Date().toISOString()
          });
        }
      }
    }

    const generatedAffCode = 'AFF-' + Math.random().toString(36).substring(2, 7).toUpperCase();

    const newUser: User = {
      id: 'usr-' + Math.random().toString(36).substring(2, 9),
      name: name.trim(),
      username: normalizedUsername,
      email: normalizedEmail,
      password: password.trim(),
      role,
      privileges: assignedPrivileges,
      phone: phone ? phone.trim() : '',
      city: city ? city.trim() : 'Casablanca',
      address: address ? address.trim() : '',
      company: company ? company.trim() : '',
      ice: ice ? ice.trim() : '',
      active: true,
      createdByUserId: createdByUserId || undefined,
      createdByRole: createdByRole || undefined,
      referredByAffiliateId,
      referredByAffiliateCode,
      affiliateCode: generatedAffCode,
      commissionRate: 10,
      createdAt: new Date().toISOString()
    };

    db.users.push(newUser);
    await saveDatabase(db);

    await logAction(
      createdByUserId || newUser.id,
      name,
      'Création utilisateur / membre',
      `Création du compte "${newUser.name}" (@${newUser.username}) avec le rôle ${newUser.role}.`
    );

    res.json({ user: newUser, token: 'token-' + newUser.id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.put('/api/users/:id/profile', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, username, email, phone, city, address, company, ice, currentPassword, newPassword } = req.body;

    const db = await loadDatabase();
    const userIndex = db.users.findIndex(u => u.id === id);
    if (userIndex === -1) {
      res.status(404).json({ error: 'Utilisateur introuvable.' });
      return;
    }

    const user = db.users[userIndex];

    // Check email uniqueness if changed
    if (email && email.toLowerCase().trim() !== user.email.toLowerCase()) {
      const normalizedEmail = email.toLowerCase().trim();
      const existing = db.users.find(u => u.id !== id && u.email.toLowerCase() === normalizedEmail);
      if (existing) {
        res.status(400).json({ error: 'Cette adresse e-mail est déjà utilisée par un autre compte.' });
        return;
      }
      user.email = normalizedEmail;
    }

    // Check username uniqueness if changed
    if (username && (!user.username || username.toLowerCase().trim() !== user.username.toLowerCase())) {
      const normalizedUsername = username.toLowerCase().trim();
      const existing = db.users.find(u => u.id !== id && u.username && u.username.toLowerCase() === normalizedUsername);
      if (existing) {
        res.status(400).json({ error: 'Ce nom d\'utilisateur est déjà utilisé. Veuillez en choisir un autre.' });
        return;
      }
      user.username = normalizedUsername;
    }

    // If changing password
    if (newPassword && newPassword.trim()) {
      if (currentPassword && user.password && user.password !== currentPassword.trim()) {
        res.status(400).json({ error: 'Le mot de passe actuel saisi est incorrect.' });
        return;
      }
      if (newPassword.trim().length < 4) {
        res.status(400).json({ error: 'Le nouveau mot de passe doit comporter au moins 4 caractères.' });
        return;
      }
      user.password = newPassword.trim();
    }

    if (name) user.name = name.trim();
    if (typeof phone !== 'undefined') user.phone = phone.trim();
    if (typeof city !== 'undefined') user.city = city.trim();
    if (typeof address !== 'undefined') user.address = address.trim();
    if (typeof company !== 'undefined') user.company = company.trim();
    if (typeof ice !== 'undefined') user.ice = ice.trim();

    db.users[userIndex] = user;
    await saveDatabase(db);

    await logAction(
      user.id,
      user.name,
      'Modification profil',
      `Mise à jour des informations de profil / connexion (${user.role}).`
    );

    res.json({ user, message: 'Profil et informations de connexion mis à jour avec succès.' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const { createdByUserId, role, all, department } = req.query;
    const db = await loadDatabase();
    let users = db.users;

    if (all === 'true') {
      // return all users
    } else if (createdByUserId) {
      users = users.filter(u => u.createdByUserId === createdByUserId);
    } else if (role) {
      const roles = (role as string).split(',');
      users = users.filter(u => roles.includes(u.role));
    }

    if (department) {
      users = users.filter(u => u.department === department);
    }

    res.json(users);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Update a user/employee/client completely
app.put('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      username,
      email,
      phone,
      city,
      address,
      role,
      active,
      privileges,
      password,
      // HR & Employee fields
      employeeCode,
      jobTitle,
      department,
      contractType,
      hireDate,
      birthDate,
      cinNumber,
      cnssNumber,
      ribNumber,
      bankName,
      baseSalary,
      hourlyRate,
      pieceRate,
      vacationBalance,
      emergencyContact,
      notes,
      // Client / Partner fields
      customerType,
      company,
      ice,
      clientNotes,
      updatedByUserId,
      updatedByName
    } = req.body;

    const db = await loadDatabase();
    const userIndex = db.users.findIndex(u => u.id === id);
    if (userIndex === -1) {
      res.status(404).json({ error: 'Utilisateur introuvable.' });
      return;
    }

    const user = db.users[userIndex];

    if (email && email.toLowerCase().trim() !== user.email.toLowerCase()) {
      const normalizedEmail = email.toLowerCase().trim();
      const existing = db.users.find(u => u.id !== id && u.email.toLowerCase() === normalizedEmail);
      if (existing) {
        res.status(400).json({ error: 'Cette adresse e-mail est déjà utilisée.' });
        return;
      }
      user.email = normalizedEmail;
    }

    if (username && (!user.username || username.toLowerCase().trim() !== user.username.toLowerCase())) {
      const normalizedUsername = username.toLowerCase().trim();
      const existing = db.users.find(u => u.id !== id && u.username && u.username.toLowerCase() === normalizedUsername);
      if (existing) {
        res.status(400).json({ error: 'Ce nom d\'utilisateur est déjà pris.' });
        return;
      }
      user.username = normalizedUsername;
    }

    if (name) user.name = name.trim();
    if (typeof phone !== 'undefined') user.phone = phone.trim();
    if (typeof city !== 'undefined') user.city = city.trim();
    if (typeof address !== 'undefined') user.address = address.trim();
    if (role) user.role = role;
    if (typeof active !== 'undefined') user.active = Boolean(active);
    if (password && password.trim().length >= 4) user.password = password.trim();

    // HR fields
    if (typeof employeeCode !== 'undefined') user.employeeCode = employeeCode ? employeeCode.trim() : undefined;
    if (typeof jobTitle !== 'undefined') user.jobTitle = jobTitle ? jobTitle.trim() : undefined;
    if (typeof department !== 'undefined') user.department = department || undefined;
    if (typeof contractType !== 'undefined') user.contractType = contractType || undefined;
    if (typeof hireDate !== 'undefined') user.hireDate = hireDate || undefined;
    if (typeof birthDate !== 'undefined') user.birthDate = birthDate || undefined;
    if (typeof cinNumber !== 'undefined') user.cinNumber = cinNumber ? cinNumber.trim() : undefined;
    if (typeof cnssNumber !== 'undefined') user.cnssNumber = cnssNumber ? cnssNumber.trim() : undefined;
    if (typeof ribNumber !== 'undefined') user.ribNumber = ribNumber ? ribNumber.trim() : undefined;
    if (typeof bankName !== 'undefined') user.bankName = bankName ? bankName.trim() : undefined;
    if (typeof baseSalary !== 'undefined') user.baseSalary = Number(baseSalary) || 0;
    if (typeof hourlyRate !== 'undefined') user.hourlyRate = Number(hourlyRate) || undefined;
    if (typeof pieceRate !== 'undefined') user.pieceRate = Number(pieceRate) || undefined;
    if (typeof vacationBalance !== 'undefined') user.vacationBalance = Number(vacationBalance) || 0;
    if (typeof emergencyContact !== 'undefined') user.emergencyContact = emergencyContact || undefined;
    if (typeof notes !== 'undefined') user.notes = notes ? notes.trim() : undefined;

    // Client & Partner fields
    if (typeof customerType !== 'undefined') user.customerType = customerType || undefined;
    if (typeof company !== 'undefined') user.company = company ? company.trim() : undefined;
    if (typeof ice !== 'undefined') user.ice = ice ? ice.trim() : undefined;
    if (typeof clientNotes !== 'undefined') user.clientNotes = clientNotes ? clientNotes.trim() : undefined;

    if (privileges && typeof privileges === 'object') {
      user.privileges = {
        canManageOrders: Boolean(privileges.canManageOrders),
        canValidateQuality: Boolean(privileges.canValidateQuality),
        canDeliverOrders: Boolean(privileges.canDeliverOrders),
        canManageClients: Boolean(privileges.canManageClients),
        canManageTools: Boolean(privileges.canManageTools),
        canViewFinancials: Boolean(privileges.canViewFinancials),
      };
    } else if (role && role !== user.role) {
      user.privileges = getDefaultPrivileges(role);
    }

    db.users[userIndex] = user;
    await saveDatabase(db);

    await logAction(
      updatedByUserId || id,
      updatedByName || 'Admin',
      'Mise à jour utilisateur / employé',
      `Modification du profil "${user.name}" (@${user.username || 'sans-username'}), rôle: ${user.role}.`
    );

    res.json({ user, message: 'Fiche utilisateur/employé mise à jour avec succès.' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Toggle user active status
app.put('/api/users/:id/toggle-active', async (req, res) => {
  try {
    const { id } = req.params;
    const { updatedByUserId, updatedByName } = req.body;
    const db = await loadDatabase();
    const user = db.users.find(u => u.id === id);
    if (!user) {
      res.status(404).json({ error: 'Utilisateur introuvable.' });
      return;
    }
    user.active = !user.active;
    await saveDatabase(db);
    await logAction(
      updatedByUserId || id,
      updatedByName || 'Admin',
      user.active ? 'Activation compte' : 'Désactivation compte',
      `Statut du compte "${user.name}" passé à ${user.active ? 'Actif' : 'Inactif'}.`
    );
    res.json({ success: true, active: user.active, user });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Reset password for a team user
app.post('/api/users/:id/reset-password', async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword, updatedByUserId, updatedByName } = req.body;

    if (!newPassword || newPassword.trim().length < 4) {
      res.status(400).json({ error: 'Le nouveau mot de passe doit comporter au moins 4 caractères.' });
      return;
    }

    const db = await loadDatabase();
    const user = db.users.find(u => u.id === id);
    if (!user) {
      res.status(404).json({ error: 'Membre d\'équipe introuvable.' });
      return;
    }

    user.password = newPassword.trim();
    await saveDatabase(db);

    await logAction(
      updatedByUserId || id,
      updatedByName || 'Admin',
      'Réinitialisation mot de passe',
      `Réinitialisation du mot de passe pour le compte "${user.name}" (@${user.username || user.email}).`
    );

    res.json({ success: true, message: `Mot de passe de "${user.name}" réinitialisé avec succès.` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Delete a user / team member / client
app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { deletedByUserId, deletedByName } = req.query;

    const db = await loadDatabase();
    const userIndex = db.users.findIndex(u => u.id === id);
    if (userIndex === -1) {
      const custIndex = (db.partnerCustomers || []).findIndex(c => c.id === id);
      if (custIndex !== -1) {
        const cust = db.partnerCustomers[custIndex];
        db.partnerCustomers.splice(custIndex, 1);
        await deleteFirestoreDoc('partnerCustomers', cust.id);
        await saveDatabase(db);
        invalidateDatabaseCache();
        await logAction(
          (deletedByUserId as string) || 'system',
          (deletedByName as string) || 'Admin',
          'Suppression client',
          `Suppression du client "${cust.name}" (${cust.email}).`
        );
        res.json({ success: true, id, message: `Le client "${cust.name}" a été supprimé avec succès.` });
        return;
      }

      res.status(404).json({ error: 'Utilisateur ou client introuvable.' });
      return;
    }

    const user = db.users[userIndex];
    if (user.role === 'admin' && (user.id === 'usr-admin-1' || user.username === 'boguiman')) {
      res.status(400).json({ error: 'L\'administrateur principal ne peut pas être supprimé.' });
      return;
    }

    // Cascading deletion for related data
    db.users.splice(userIndex, 1);
    
    // Cleanup related entities if necessary (simple approach)
    if (db.orders) db.orders = db.orders.filter(o => o.customerDetails.email !== user.email && o.partnerId !== user.id);
    if (db.payrolls) db.payrolls = db.payrolls.filter(p => p.employeeId !== user.id);
    if (db.leaveRequests) db.leaveRequests = db.leaveRequests.filter(l => l.employeeId !== user.id);
    if (db.salaryAdvances) db.salaryAdvances = db.salaryAdvances.filter(a => a.employeeId !== user.id);
    
    await deleteFirestoreDoc('users', id);
    await saveDatabase(db);
    invalidateDatabaseCache();

    await logAction(
      (deletedByUserId as string) || 'system',
      (deletedByName as string) || 'Admin',
      'Suppression utilisateur',
      `Suppression du compte "${user.name}" (@${user.username || user.email}) et nettoyage des données associées - Rôle: ${user.role}.`
    );

    res.json({ success: true, id, message: `L'utilisateur "${user.name}" a été supprimé ainsi que ses données associées.` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ==========================================
// --- HR & PAYROLL MANAGEMENT ENDPOINTS ---
// ==========================================

// 1. PAYROLLS
app.get('/api/payrolls', async (req, res) => {
  try {
    const { employeeId, periodMonth, status } = req.query;
    const db = await loadDatabase();
    let payrolls = db.payrolls || [];

    if (employeeId) {
      payrolls = payrolls.filter(p => p.employeeId === employeeId);
    }
    if (periodMonth) {
      payrolls = payrolls.filter(p => p.periodMonth === periodMonth);
    }
    if (status) {
      payrolls = payrolls.filter(p => p.status === status);
    }

    res.json(payrolls);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/payrolls', async (req, res) => {
  try {
    const payroll: PayrollRecord = req.body;
    const { authorId, authorName } = req.query;
    const db = await loadDatabase();

    if (!payroll.employeeId || !payroll.periodMonth) {
      res.status(400).json({ error: 'L\'employé et la période du bulletin de paie sont obligatoires.' });
      return;
    }

    if (!payroll.id) {
      payroll.id = 'pay-' + payroll.periodMonth.replace('-', '') + '-' + Math.random().toString(36).substring(2, 7).toUpperCase();
    }
    if (!payroll.reference) {
      payroll.reference = `PAY-${payroll.periodMonth}-${payroll.id.substring(payroll.id.length - 4)}`;
    }
    if (!payroll.createdAt) {
      payroll.createdAt = new Date().toISOString();
    }
    if (!payroll.status) {
      payroll.status = 'draft';
    }

    if (!db.payrolls) {
      db.payrolls = [];
    }

    const existingIdx = db.payrolls.findIndex(p => p.id === payroll.id);
    if (existingIdx >= 0) {
      db.payrolls[existingIdx] = payroll;
    } else {
      db.payrolls.push(payroll);
    }

    await saveDatabase(db);

    await logAction(
      (authorId as string) || 'system',
      (authorName as string) || 'Admin RH',
      'Création Bulletin de Paie',
      `Bulletin de paie généré pour ${payroll.employeeName} - Période: ${payroll.periodLabel || payroll.periodMonth} - Net: ${payroll.netSalary} DH.`
    );

    res.json(payroll);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.put('/api/payrolls/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData: Partial<PayrollRecord> = req.body;
    const { authorId, authorName } = req.query;
    const db = await loadDatabase();

    if (!db.payrolls) db.payrolls = [];
    const idx = db.payrolls.findIndex(p => p.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Bulletin de paie non trouvé.' });
      return;
    }

    db.payrolls[idx] = {
      ...db.payrolls[idx],
      ...updateData,
      id
    };

    await saveDatabase(db);

    await logAction(
      (authorId as string) || 'system',
      (authorName as string) || 'Admin RH',
      'Mise à jour Paie',
      `Bulletin "${db.payrolls[idx].reference}" mis à jour (${db.payrolls[idx].status}).`
    );

    res.json(db.payrolls[idx]);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete('/api/payrolls/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { authorId, authorName } = req.query;
    const db = await loadDatabase();

    if (!db.payrolls) db.payrolls = [];
    const idx = db.payrolls.findIndex(p => p.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Bulletin de paie non trouvé.' });
      return;
    }

    const removed = db.payrolls.splice(idx, 1)[0];
    await deleteFirestoreDoc('payrolls', id);
    await saveDatabase(db);

    await logAction(
      (authorId as string) || 'system',
      (authorName as string) || 'Admin RH',
      'Suppression Bulletin Paie',
      `Bulletin de paie "${removed?.reference || id}" supprimé.`
    );

    res.json({ success: true, id, message: 'Bulletin de paie supprimé avec succès.' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 2. CONGÉS & ABSENCES
app.get('/api/leave-requests', async (req, res) => {
  try {
    const { employeeId, status } = req.query;
    const db = await loadDatabase();
    let leaves = db.leaveRequests || [];

    if (employeeId) {
      leaves = leaves.filter(l => l.employeeId === employeeId);
    }
    if (status) {
      leaves = leaves.filter(l => l.status === status);
    }

    res.json(leaves);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/leave-requests', async (req, res) => {
  try {
    const leave: LeaveRequest = req.body;
    const db = await loadDatabase();

    if (!leave.employeeId || !leave.startDate || !leave.endDate) {
      res.status(400).json({ error: 'Les dates et l\'employé sont obligatoires pour la demande de congé.' });
      return;
    }

    if (!leave.id) {
      leave.id = 'leave-' + Math.random().toString(36).substring(2, 9);
    }
    if (!leave.createdAt) {
      leave.createdAt = new Date().toISOString();
    }
    if (!leave.status) {
      leave.status = 'pending';
    }

    if (!db.leaveRequests) db.leaveRequests = [];
    db.leaveRequests.push(leave);
    await saveDatabase(db);

    await logAction(
      leave.employeeId,
      leave.employeeName,
      'Demande de Congé',
      `Demande de congé de ${leave.daysCount} jour(s) du ${leave.startDate} au ${leave.endDate}.`
    );

    res.json(leave);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.put('/api/leave-requests/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reviewedBy, rejectionReason } = req.body;
    const db = await loadDatabase();

    if (!db.leaveRequests) db.leaveRequests = [];
    const idx = db.leaveRequests.findIndex(l => l.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Demande de congé introuvable.' });
      return;
    }

    const leave = db.leaveRequests[idx];
    const prevStatus = leave.status;
    leave.status = status;
    leave.reviewedBy = reviewedBy || 'Direction RH';
    leave.reviewedAt = new Date().toISOString();
    if (rejectionReason) leave.rejectionReason = rejectionReason;

    // Deduct vacation days if approved and was not approved before
    if (status === 'approved' && prevStatus !== 'approved') {
      const emp = db.users.find(u => u.id === leave.employeeId);
      if (emp && typeof emp.vacationBalance === 'number') {
        emp.vacationBalance = Math.max(0, emp.vacationBalance - leave.daysCount);
      }
    }

    db.leaveRequests[idx] = leave;
    await saveDatabase(db);

    await logAction(
      'rh-manager',
      reviewedBy || 'Direction RH',
      `Congé ${status === 'approved' ? 'Accepté' : 'Refusé'}`,
      `La demande de congé de ${leave.employeeName} (${leave.daysCount}j) a été ${status}.`
    );

    res.json(leave);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 3. ACOMPTES SUR SALAIRE (ADVANCES)
app.get('/api/salary-advances', async (req, res) => {
  try {
    const { employeeId, status, repaymentMonth } = req.query;
    const db = await loadDatabase();
    let advances = db.salaryAdvances || [];

    if (employeeId) {
      advances = advances.filter(a => a.employeeId === employeeId);
    }
    if (status) {
      advances = advances.filter(a => a.status === status);
    }
    if (repaymentMonth) {
      advances = advances.filter(a => a.repaymentMonth === repaymentMonth);
    }

    res.json(advances);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/salary-advances', async (req, res) => {
  try {
    const advance: SalaryAdvance = req.body;
    const db = await loadDatabase();

    if (!advance.employeeId || !advance.amount || advance.amount <= 0) {
      res.status(400).json({ error: 'L\'employé et un montant positif sont obligatoires.' });
      return;
    }

    if (!advance.id) {
      advance.id = 'adv-' + Math.random().toString(36).substring(2, 9);
    }
    if (!advance.requestDate) {
      advance.requestDate = new Date().toISOString().split('T')[0];
    }
    if (!advance.status) {
      advance.status = 'pending';
    }

    if (!db.salaryAdvances) db.salaryAdvances = [];
    db.salaryAdvances.push(advance);
    await saveDatabase(db);

    await logAction(
      advance.employeeId,
      advance.employeeName,
      'Demande d\'acompte',
      `Demande d'avance de ${advance.amount} DH (motif: ${advance.reason || 'non précisé'}).`
    );

    res.json(advance);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.put('/api/salary-advances/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, approvedBy, repaymentMonth } = req.body;
    const db = await loadDatabase();

    if (!db.salaryAdvances) db.salaryAdvances = [];
    const idx = db.salaryAdvances.findIndex(a => a.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Demande d\'acompte introuvable.' });
      return;
    }

    const advance = db.salaryAdvances[idx];
    advance.status = status;
    if (approvedBy) advance.approvedBy = approvedBy;
    if (status === 'approved') advance.approvedAt = new Date().toISOString();
    if (repaymentMonth) advance.repaymentMonth = repaymentMonth;

    db.salaryAdvances[idx] = advance;
    await saveDatabase(db);

    await logAction(
      'rh-manager',
      approvedBy || 'Direction RH',
      `Acompte ${status}`,
      `L'acompte de ${advance.amount} DH pour ${advance.employeeName} a été mis à jour: ${status}.`
    );

    res.json(advance);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 4. CLIENTS 360° OVERVIEW (DIRECT CLIENTS + B2B PARTNERS + PARTNER CUSTOMERS)
app.get('/api/clients/overview', async (req, res) => {
  try {
    const db = await loadDatabase();
    const directClients = db.users.filter(u => u.role === 'client');
    const b2bPartners = db.users.filter(u => u.role === 'partner');
    const partnerCustomers = db.partnerCustomers || [];

    const clientsOverview = [
      ...directClients.map(c => {
        const clientOrders = db.orders.filter(o => o.customerDetails.email?.toLowerCase() === c.email.toLowerCase());
        const totalSpent = clientOrders.reduce((sum, o) => {
          const q = (db.quotes || []).find(quote => quote.orderId === o.id);
          return sum + (q?.totalAmount || 0);
        }, 0);
        const paidAmount = clientOrders.reduce((sum, o) => {
          const verifiedPayments = (db.payments || []).filter(p => p.orderId === o.id && p.status === 'verified');
          return sum + verifiedPayments.reduce((pSum, p) => pSum + p.amount, 0);
        }, 0);
        return {
          id: c.id,
          type: 'direct_client',
          customerType: c.customerType || 'particular',
          name: c.name,
          username: c.username,
          email: c.email,
          phone: c.phone || '',
          city: c.city || 'Casablanca',
          company: c.company || '',
          ice: c.ice || '',
          ordersCount: clientOrders.length,
          totalSpent,
          unpaidAmount: Math.max(0, totalSpent - paidAmount),
          active: c.active !== false,
          clientNotes: c.clientNotes || '',
          createdAt: c.createdAt || '2026-01-01'
        };
      }),
      ...b2bPartners.map(p => {
        const partnerOrders = db.orders.filter(o => o.partnerId === p.id);
        const totalSpent = partnerOrders.reduce((sum, o) => {
          const q = (db.quotes || []).find(quote => quote.orderId === o.id);
          return sum + (q?.totalAmount || 0);
        }, 0);
        const paidAmount = partnerOrders.reduce((sum, o) => {
          const verifiedPayments = (db.payments || []).filter(pay => pay.orderId === o.id && pay.status === 'verified');
          return sum + verifiedPayments.reduce((pSum, pay) => pSum + pay.amount, 0);
        }, 0);
        return {
          id: p.id,
          type: 'b2b_partner',
          customerType: 'company',
          name: p.name,
          username: p.username,
          email: p.email,
          phone: p.phone || '',
          city: p.city || 'Casablanca',
          company: p.company || p.name,
          ice: p.ice || '',
          ordersCount: partnerOrders.length,
          totalSpent,
          unpaidAmount: Math.max(0, totalSpent - paidAmount),
          active: p.active !== false,
          clientNotes: 'Partenaire B2B Imprimerie/Centre',
          createdAt: p.createdAt || '2026-01-01'
        };
      }),
      ...partnerCustomers.map(pc => {
        const partner = db.users.find(u => u.id === pc.partnerId);
        return {
          id: pc.id,
          type: 'partner_customer',
          customerType: 'particular',
          name: pc.name,
          username: undefined,
          email: pc.email,
          phone: pc.phone || '',
          city: pc.city || 'Casablanca',
          company: pc.company || '',
          ice: '',
          partnerName: partner?.name || 'Partenaire Référent',
          partnerId: pc.partnerId,
          ordersCount: 0,
          totalSpent: 0,
          unpaidAmount: 0,
          active: true,
          clientNotes: pc.notes || '',
          createdAt: pc.createdAt || '2026-01-01'
        };
      })
    ];

    res.json(clientsOverview);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Services Catalog Endpoints
app.get('/api/services', async (req, res) => {
  try {
    const db = await loadDatabase();
    res.json(db.services);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Catégories métier éditables (stockées dans settings.serviceCategories) ---
const DEFAULT_SERVICE_CATEGORIES: ServiceCategory[] = [
  { key: 'saisie', label: 'Saisie de données & transcription', icon: 'edit_note', isActive: true, isSystem: true, createdAt: new Date().toISOString() },
  { key: 'conversion', label: 'Numérisation, OCR & Conversion', icon: 'document_scanner', isActive: true, isSystem: true, createdAt: new Date().toISOString() },
  { key: 'mise_en_forme', label: 'Mise en forme & PAO avancée', icon: 'auto_fix_high', isActive: true, isSystem: true, createdAt: new Date().toISOString() },
  { key: 'traitement', label: 'Traitement & Nettoyage de données', icon: 'filter_alt', isActive: true, isSystem: true, createdAt: new Date().toISOString() },
  { key: 'impression', label: 'Impression papier & reliure', icon: 'print', isActive: true, isSystem: true, createdAt: new Date().toISOString() },
  { key: 'livraison', label: 'Expédition & Livraison physique', icon: 'local_shipping', isActive: true, isSystem: true, createdAt: new Date().toISOString() },
  // Catégories orientées marketplace (Fiverr-like) prêtes à activer
  { key: 'design_graphique', label: 'Design Graphique & Logo', icon: 'palette', isActive: false, isSystem: true, createdAt: new Date().toISOString() },
  { key: 'traduction', label: 'Traduction & Rédaction', icon: 'translate', isActive: false, isSystem: true, createdAt: new Date().toISOString() },
  { key: 'marketing_digital', label: 'Marketing Digital & Réseaux sociaux', icon: 'campaign', isActive: false, isSystem: true, createdAt: new Date().toISOString() },
  { key: 'dev_web', label: 'Développement Web & Tech', icon: 'code', isActive: false, isSystem: true, createdAt: new Date().toISOString() },
  { key: 'video_audio', label: 'Vidéo, Montage & Audio', icon: 'movie', isActive: false, isSystem: true, createdAt: new Date().toISOString() },
  { key: 'emballage_pod', label: 'Emballage & Print-on-Demand', icon: 'inventory', isActive: false, isSystem: true, createdAt: new Date().toISOString() }
];

function getServiceCategories(settings: SystemSettings): ServiceCategory[] {
  const stored = (settings as SystemSettings & { serviceCategories?: ServiceCategory[] }).serviceCategories;
  if (!stored || !Array.isArray(stored) || stored.length === 0) return DEFAULT_SERVICE_CATEGORIES;
  // fusion : catégories par défaut manquantes ajoutées automatiquement
  const keys = new Set(stored.map(c => c.key));
  for (const d of DEFAULT_SERVICE_CATEGORIES) if (!keys.has(d.key)) stored.push(d);
  return stored;
}

app.get('/api/service-categories', async (req, res) => {
  try {
    const db = await loadDatabase();
    res.json(getServiceCategories(db.settings));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post('/api/service-categories', async (req, res): Promise<void> => {
  try {
    const db = await loadDatabase();
    const cats = getServiceCategories(db.settings);
    const rawKey = String(req.body.key || req.body.label || '').trim();
    if (!rawKey) { res.status(400).json({ error: 'Clé ou libellé requis.' }); return; }
    const key = rawKey.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (cats.some(c => c.key === key)) { res.status(400).json({ error: `La catégorie "${key}" existe déjà.` }); return; }
    const cat: ServiceCategory = {
      key, label: String(req.body.label || rawKey).trim(),
      icon: String(req.body.icon || 'category'),
      description: req.body.description || undefined,
      isActive: req.body.isActive !== false,
      createdAt: new Date().toISOString()
    };
    cats.push(cat);
    (db.settings as SystemSettings & { serviceCategories?: ServiceCategory[] }).serviceCategories = cats;
    await saveDatabase(db);
    await logAction(String(req.body.userId || 'system'), String(req.body.userName || 'Système'), 'Catégorie métier', `Création catégorie ${cat.label}`);
    res.json(cat);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.put('/api/service-categories/:key', async (req, res): Promise<void> => {
  try {
    const db = await loadDatabase();
    const cats = getServiceCategories(db.settings);
    const cat = cats.find(c => c.key === req.params.key);
    if (!cat) { res.status(404).json({ error: 'Catégorie introuvable.' }); return; }
    if (req.body.newKey && req.body.newKey !== cat.key) {
      // renommage de clé : répercuter sur les services existants
      const services = await Promise.resolve(db.services.filter(s => s.category === cat.key));
      for (const s of services) s.category = req.body.newKey as Service['category'];
      cat.key = String(req.body.newKey);
    }
    if (req.body.label) cat.label = String(req.body.label);
    if (req.body.icon) cat.icon = String(req.body.icon);
    if (typeof req.body.description === 'string') cat.description = req.body.description;
    if (typeof req.body.isActive === 'boolean') cat.isActive = req.body.isActive;
    (db.settings as SystemSettings & { serviceCategories?: ServiceCategory[] }).serviceCategories = cats;
    await saveDatabase(db);
    res.json(cat);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.delete('/api/service-categories/:key', async (req, res): Promise<void> => {
  try {
    const db = await loadDatabase();
    const cats = getServiceCategories(db.settings);
    const cat = cats.find(c => c.key === req.params.key);
    if (!cat) { res.status(404).json({ error: 'Catégorie introuvable.' }); return; }
    const inUse = db.services.filter(s => s.category === cat.key).length;
    if (inUse > 0) { res.status(400).json({ error: `Impossible : ${inUse} service(s) utilisent cette catégorie. Déplacez-les d'abord.` }); return; }
    (db.settings as SystemSettings & { serviceCategories?: ServiceCategory[] }).serviceCategories = cats.filter(c => c.key !== cat.key);
    await saveDatabase(db);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post('/api/services', async (req, res) => {
  try {
    const service: Service = req.body;
    const { userId, userName } = req.query;
    const db = await loadDatabase();
    if (!service.name || !service.category) {
      res.status(400).json({ error: 'Le nom et la catégorie du service sont obligatoires.' });
      return;
    }
    const existingIdx = db.services.findIndex(s => s.id === service.id);
    if (existingIdx >= 0) {
      db.services[existingIdx] = { ...db.services[existingIdx], ...service };
    } else {
      service.id = service.id || ('srv-' + Math.random().toString(36).substring(2, 9));
      if (typeof service.isActive === 'undefined') {
        service.isActive = true;
      }
      if (!service.options) {
        service.options = [];
      }
      db.services.push(service);
    }
    await saveDatabase(db);
    await logAction(
      (userId as string) || 'system',
      (userName as string) || 'Administrateur',
      'Mise à jour catalogue',
      `Service "${service.name}" (${service.id}) enregistré dans le catalogue.`
    );
    res.json(service);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.put('/api/services/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData: Partial<Service> = req.body;
    const { userId, userName } = req.query;
    const db = await loadDatabase();
    const idx = db.services.findIndex(s => s.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Service non trouvé.' });
      return;
    }
    db.services[idx] = {
      ...db.services[idx],
      ...updateData,
      id
    };
    await saveDatabase(db);
    await logAction(
      (userId as string) || 'system',
      (userName as string) || 'Administrateur',
      'Modification Service',
      `Service "${db.services[idx].name}" (${id}) modifié.`
    );
    res.json(db.services[idx]);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete('/api/services/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, userName } = req.query;
    const db = await loadDatabase();
    const idx = db.services.findIndex(s => s.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Service non trouvé.' });
      return;
    }
    const removedService = db.services.splice(idx, 1)[0];
    await deleteFirestoreDoc('services', id);
    await saveDatabase(db);
    await logAction(
      (userId as string) || 'system',
      (userName as string) || 'Administrateur',
      'Suppression Service',
      `Service "${removedService?.name || id}" supprimé du catalogue.`
    );
    res.json({ success: true, id, message: 'Service supprimé avec succès.' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Partner Customers Endpoints
app.get('/api/partners/customers', async (req, res) => {
  try {
    const { partnerId } = req.query;
    const db = await loadDatabase();
    
    // Copy main partner customers list
    let customers = [...db.partnerCustomers];
    
    // Dynamically map and include registered users of roles 'client' and 'partner'
    const registeredClientsAndPartners: PartnerCustomer[] = db.users
      .filter((u: User) => u.role === 'client' || u.role === 'partner')
      .map((u: User) => ({
        id: u.id,
        partnerId: u.createdByUserId || 'admin-direct',
        name: u.name,
        email: u.email,
        phone: u.phone || '',
        city: u.city || 'Casablanca',
        company: u.company || '',
        type: (u.role === 'partner' ? 'b2b' : 'final') as 'b2c' | 'final' | 'b2b',
        createdAt: u.createdAt || new Date().toISOString()
      }));

    // Add unique registered accounts to the customer list to avoid duplicate entries by email
    for (const rc of registeredClientsAndPartners) {
      const exists = customers.some(c => c.id === rc.id || c.email.toLowerCase() === rc.email.toLowerCase());
      if (!exists) {
        customers.push(rc);
      }
    }

    if (partnerId) {
      customers = customers.filter(c => c.partnerId === partnerId || c.id === partnerId);
    }
    
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/partners/customers', async (req, res) => {
  try {
    const customer: PartnerCustomer = req.body;
    const db = await loadDatabase();
    if (!customer.id) {
      customer.id = 'cust-' + Math.random().toString(36).substring(2, 9);
      customer.createdAt = new Date().toISOString();
      db.partnerCustomers.push(customer);
    } else {
      const idx = db.partnerCustomers.findIndex(c => c.id === customer.id);
      if (idx >= 0) {
        db.partnerCustomers[idx] = customer;
      }
    }
    await saveDatabase(db);
    await logAction(
      customer.partnerId,
      'Partenaire',
      'Création Client',
      `Client "${customer.name}" enregistré pour ce partenaire.`
    );
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Orders Endpoints
app.get('/api/orders', async (req, res) => {
  try {
    const { partnerId, clientId, operatorId, qaId } = req.query;
    const db = await loadDatabase();
    let orders = db.orders;

    if (partnerId) {
      orders = orders.filter(o => o.partnerId === partnerId);
    } else if (clientId) {
      // Direct client orders (we find by client email or id)
      const user = db.users.find(u => u.id === clientId);
      if (user) {
        orders = orders.filter(o => o.customerDetails.email === user.email);
      }
    } else if (operatorId) {
      orders = orders.filter(o => o.tasks.some(t => t.operatorId === operatorId));
    } else if (qaId) {
      orders = orders.filter(o => o.tasks.some(t => t.qaId === qaId));
    }

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/payments', async (req, res) => {
  try {
    const db = await loadDatabase();
    res.json(db.payments || []);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = await loadDatabase();
    const order = db.orders.find(o => o.id === id || o.reference === id);
    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }
    // Fetch attached structures
    const quote = db.quotes.find(q => q.orderId === order.id);
    const invoice = db.invoices.filter(i => i.orderId === order.id);
    const payment = db.payments.filter(p => p.orderId === order.id);

    res.json({ order, quote, invoices: invoice, payments: payment });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const orderData = req.body;
    const db = await loadDatabase();

    const refNumber = db.orders.length + 1;
    const reference = `CMD-2026-${refNumber.toString().padStart(4, '0')}`;

    // Resolve affiliate attribution
    let affId = orderData.affiliateId;
    let affCode = orderData.affiliateCode || orderData.refCode;
    let affName = orderData.affiliateName;
    let commRate = orderData.commissionRate;

    // Check if the affiliate is trying to refer themselves (forbidden)
    if (affId) {
      const affiliateUser = db.users.find(u => u.id === affId);
      if (affiliateUser && orderData.customerDetails && orderData.customerDetails.email) {
        const clientEmail = orderData.customerDetails.email.toLowerCase().trim();
        if (affiliateUser.email.toLowerCase().trim() === clientEmail || affiliateUser.id === orderData.partnerId) {
          affId = undefined;
          affCode = undefined;
          affName = undefined;
          commRate = undefined;
        }
      }
    }

    if (!affId && affCode) {
      const codeSearch = (affCode as string).trim().toUpperCase();
      const affUser = db.users.find(u => u.affiliateCode && u.affiliateCode.toUpperCase() === codeSearch);
      if (affUser) {
        if (orderData.customerDetails && orderData.customerDetails.email && affUser.email.toLowerCase().trim() === orderData.customerDetails.email.toLowerCase().trim()) {
          // Sponsor cannot refer themselves!
        } else {
          affId = affUser.id;
          affCode = affUser.affiliateCode;
          affName = affUser.name;
          commRate = affUser.commissionRate;
        }
      }
    }

    if (!affId && orderData.customerDetails && orderData.customerDetails.email) {
      const clientEmail = orderData.customerDetails.email.toLowerCase().trim();
      const clientUser = db.users.find(u => u.email.toLowerCase() === clientEmail);
      if (clientUser && clientUser.referredByAffiliateId) {
        const affUser = db.users.find(u => u.id === clientUser.referredByAffiliateId);
        if (affUser) {
          if (affUser.email.toLowerCase().trim() !== clientEmail && affUser.id !== clientUser.id) {
            affId = affUser.id;
            affCode = affUser.affiliateCode;
            affName = affUser.name;
            commRate = affUser.commissionRate;
          }
        }
      }
    }

    // Determine commission rate based on priority (service specific, then affiliate personal, then general config)
    if (affId) {
      const affiliateUser = db.users.find(u => u.id === affId);
      const serviceId = orderData.serviceId;
      const serviceSpecificRate = db.settings?.affiliateCommissionConfig?.serviceCommissionRates?.[serviceId];
      if (serviceSpecificRate !== undefined && serviceSpecificRate !== null) {
        commRate = Number(serviceSpecificRate);
      } else if (commRate === undefined || commRate === null) {
        commRate = affiliateUser?.commissionRate ?? db.settings?.affiliateCommissionConfig?.generalCommissionRate ?? 10;
      }
    }

    const newOrder: Order = {
      id: 'ord-' + Math.random().toString(36).substring(2, 9),
      reference,
      customerType: orderData.customerType || 'particular',
      customerDetails: orderData.customerDetails,
      partnerId: orderData.partnerId || undefined,
      serviceId: orderData.serviceId,
      serviceName: orderData.serviceName || 'Service personnalisé',
      serviceCategory: orderData.serviceCategory || 'saisie',
      description: orderData.description,
      quantity: orderData.quantity || 1,
      urgency: orderData.urgency || 'normal',
      status: orderData.status || 'DEMANDE_ENVOYEE',
      files: orderData.files || [],
      messages: orderData.messages || [],
      tasks: [],
      affiliateId: affId,
      affiliateCode: affCode,
      affiliateName: affName,
      commissionRate: commRate || 10,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Calculate preliminary deadline based on urgency
    const days = newOrder.urgency === 'normal' ? 5 : newOrder.urgency === 'fast' ? 3 : newOrder.urgency === 'urgent' ? 2 : 1;
    const deadlineDate = new Date();
    deadlineDate.setDate(deadlineDate.getDate() + days);
    newOrder.deadline = deadlineDate.toISOString();

    db.orders.unshift(newOrder);

    // Notify client/partner and admins about the new order
    await notifyOrderStakeholders(
      db,
      newOrder,
      'Nouvelle commande enregistrée',
      `La commande ${reference} (${newOrder.serviceName}) a été enregistrée avec succès. Statut: En attente d'analyse.`,
      { includeClient: true, includePartner: true, includeAdmins: true, includeAssigned: false }
    );

    await saveDatabase(db);

    const actorId = orderData.partnerId || 'client-direct';
    const actorName = orderData.customerDetails.name;
    await logAction(actorId, actorName, 'Création Commande', `Commande ${reference} créée pour le service ${newOrder.serviceName}.`);

    res.json(newOrder);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/orders/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, userId, userName } = req.body;
    const db = await loadDatabase();
    const order = db.orders.find(o => o.id === id);
    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    const oldStatus = order.status;
    order.status = status;
    order.updatedAt = new Date().toISOString();

    // Map rich status change notifications
    const statusMessages: Record<string, { title: string; message: string }> = {
      DEMANDE_ENVOYEE: {
        title: 'Demande enregistrée',
        message: `La commande ${order.reference} a été enregistrée.`
      },
      EN_ATTENTE_ANALYSE: {
        title: 'Analyse en cours',
        message: `L'équipe technique analyse les documents de la commande ${order.reference}.`
      },
      DEVIS_EN_PREPARATION: {
        title: 'Devis en cours de préparation',
        message: `Votre devis pour la commande ${order.reference} est en préparation.`
      },
      DEVIS_ENVOYE: {
        title: 'Devis disponible',
        message: `Un devis a été émis pour votre commande ${order.reference}. Veuillez le consulter et le valider.`
      },
      EN_ATTENTE_ACOMPTE: {
        title: 'En attente d\'acompte',
        message: `Le devis pour la commande ${order.reference} est accepté. En attente du règlement de l'acompte.`
      },
      ACOMPTE_PAYE: {
        title: 'Acompte validé',
        message: `L'acompte de la commande ${order.reference} a été validé. La commande passe en production.`
      },
      EN_FILE_ATTENTE: {
        title: 'En file d\'attente',
        message: `La commande ${order.reference} est assignée et placée en file d'attente de traitement.`
      },
      EN_TRAITEMENT: {
        title: 'Traitement en cours',
        message: `Le travail de numérisation / traitement pour ${order.reference} est en cours de réalisation.`
      },
      CONTROLE_QUALITE: {
        title: 'Contrôle qualité en cours',
        message: `Le travail final de la commande ${order.reference} est en cours de vérification de conformité.`
      },
      TRAVAIL_TERMINE: {
        title: 'Travail terminé & validé',
        message: `Le travail pour la commande ${order.reference} a été validé avec succès par le contrôle qualité.`
      },
      EN_ATTENTE_SOLDE: {
        title: 'En attente du solde',
        message: `Le travail ${order.reference} est prêt. Veuillez régler le solde pour accéder à la version finale.`
      },
      SOLDE_PAYE: {
        title: 'Solde validé',
        message: `Paiement du solde reçu pour ${order.reference}. Le document est prêt pour livraison / téléchargement.`
      },
      PRET_A_LIVRER: {
        title: 'Prêt pour livraison',
        message: `La commande ${order.reference} est prête pour remise ou expédition.`
      },
      LIVRE: {
        title: 'Travail livré',
        message: `Le travail pour votre commande ${order.reference} a été livré avec succès.`
      },
      TERMINE: {
        title: 'Commande clôturée',
        message: `Votre commande ${order.reference} est désormais clôturée.`
      },
      ANNULE: {
        title: 'Commande annulée',
        message: `La commande ${order.reference} a été annulée.`
      },
      REFUSE: {
        title: 'Commande refusée',
        message: `La commande ${order.reference} a été refusée.`
      },
      BLOQUE: {
        title: 'Commande bloquée',
        message: `La commande ${order.reference} nécessite des informations complémentaires de votre part.`
      }
    };

    const notifInfo = statusMessages[status] || {
      title: 'Statut mis à jour',
      message: `Le statut de la commande ${order.reference} est maintenant "${status.replace(/_/g, ' ')}".`
    };

    await notifyOrderStakeholders(
      db,
      order,
      notifInfo.title,
      notifInfo.message,
      { includeClient: true, includePartner: true, includeAdmins: true, includeAssigned: true }
    );

    await saveDatabase(db);

    await logAction(
      userId || 'system',
      userName || 'Système',
      'Changement Statut',
      `Commande ${order.reference} passée de "${oldStatus}" à "${status}".`
    );

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/orders/:id/deadline', async (req, res) => {
  try {
    const { id } = req.params;
    const { deadline, notes, userId, userName } = req.body;
    const db = await loadDatabase();
    const order = db.orders.find(o => o.id === id);
    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    order.deadline = deadline;
    order.updatedAt = new Date().toISOString();

    if (order.tasks && order.tasks.length > 0) {
      order.tasks[0].deadline = deadline;
    }

    await notifyOrderStakeholders(
      db,
      order,
      'Date limite mise à jour',
      `La date limite de livraison pour la commande ${order.reference} a été planifiée pour le ${new Date(deadline).toLocaleDateString('fr-FR')}.`,
      { includeClient: true, includePartner: true, includeAdmins: true, includeAssigned: true }
    );

    await saveDatabase(db);

    await logAction(
      userId || 'system',
      userName || 'Système',
      'Planification Date',
      `Date limite de la commande ${order.reference} changée pour le ${new Date(deadline).toLocaleDateString('fr-FR')}.${notes ? ' Remarque: ' + notes : ''}`
    );

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Quote Endpoints
app.post('/api/orders/:id/quote', async (req, res) => {
  try {
    const { id } = req.params;
    const quoteData = req.body; // basePrice, optionsPrice, urgencySurcharge, printingPrice, deliveryPrice, totalAmount, depositPercent, items
    const { userId, userName } = req.query;
    const db = await loadDatabase();

    const order = db.orders.find(o => o.id === id);
    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    // Reference
    const quoteRef = `DEV-2026-${(db.quotes.length + 1).toString().padStart(4, '0')}`;
    const quoteId = quoteData.id || 'qte-' + Math.random().toString(36).substring(2, 9);

    const newQuote: Quote = {
      id: quoteId,
      reference: quoteRef,
      orderId: order.id,
      basePrice: quoteData.basePrice || 0,
      optionsPrice: quoteData.optionsPrice || 0,
      urgencySurcharge: quoteData.urgencySurcharge || 0,
      printingPrice: quoteData.printingPrice || 0,
      deliveryPrice: quoteData.deliveryPrice || 0,
      totalAmount: quoteData.totalAmount || 0,
      depositPercent: quoteData.depositPercent || 50,
      depositAmount: quoteData.depositAmount || 0,
      balanceAmount: quoteData.balanceAmount || 0,
      status: quoteData.status || 'sent',
      validityDate: quoteData.validityDate || new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      items: quoteData.items || []
    };

    const existingIdx = db.quotes.findIndex(q => q.orderId === order.id);
    if (existingIdx >= 0) {
      db.quotes[existingIdx] = newQuote;
    } else {
      db.quotes.push(newQuote);
    }

    order.quoteId = newQuote.id;
    order.status = 'DEVIS_ENVOYE';
    order.updatedAt = new Date().toISOString();

    await notifyOrderStakeholders(
      db,
      order,
      'Devis disponible',
      `Le devis ${quoteRef} (${newQuote.totalAmount} DH) a été émis pour votre commande ${order.reference}.`,
      { includeClient: true, includePartner: true, includeAdmins: true, includeAssigned: false }
    );

    await saveDatabase(db);

    await logAction(
      (userId as string) || 'admin',
      (userName as string) || 'Administrateur',
      'Émission Devis',
      `Devis ${quoteRef} émis pour la commande ${order.reference} d'un montant de ${newQuote.totalAmount} DH.`
    );

    res.json({ order, quote: newQuote });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/orders/:id/quote/action', async (req, res) => {
  try {
    const { id } = req.params;
    const { action, userId, userName } = req.body; // action: 'accept' or 'refuse'
    const db = await loadDatabase();

    const order = db.orders.find(o => o.id === id);
    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    const quote = db.quotes.find(q => q.orderId === order.id);
    if (!quote) {
      res.status(404).json({ error: 'Devis introuvable.' });
      return;
    }

    if (action === 'accept') {
      quote.status = 'accepted';
      order.status = 'EN_ATTENTE_ACOMPTE';

      // Auto generate deposit invoice
      const invoiceRef = `FAC-2026-${(db.invoices.length + 1).toString().padStart(4, '0')}`;
      const newInvoice: Invoice = {
        id: 'inv-' + Math.random().toString(36).substring(2, 9),
        reference: invoiceRef,
        orderId: order.id,
        quoteId: quote.id,
        amount: quote.depositAmount,
        type: 'deposit',
        status: 'unpaid',
        date: new Date().toISOString()
      };
      db.invoices.push(newInvoice);

      await notifyOrderStakeholders(
        db,
        order,
        'Devis accepté',
        `Le devis pour la commande ${order.reference} a été accepté. Facture d'acompte émise (${quote.depositAmount} DH).`,
        { includeClient: true, includePartner: true, includeAdmins: true, includeAssigned: false }
      );

      await logAction(userId, userName, 'Acceptation Devis', `Devis ${quote.reference} accepté par le client. Facture d'acompte ${invoiceRef} émise.`);
    } else {
      quote.status = 'refused';
      order.status = 'REFUSE';

      await notifyOrderStakeholders(
        db,
        order,
        'Devis refusé',
        `Le devis pour la commande ${order.reference} a été refusé.`,
        { includeClient: true, includePartner: true, includeAdmins: true, includeAssigned: false }
      );

      await logAction(userId, userName, 'Refus Devis', `Devis ${quote.reference} refusé par le client.`);
    }

    order.updatedAt = new Date().toISOString();
    await saveDatabase(db);

    res.json({ order, quote });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Assignment Endpoint
app.post('/api/orders/:id/assign', async (req, res) => {
  try {
    const { id } = req.params;
    const { operatorId, operatorName, qaId, qaName, deadline, priority, notes, userId, userName } = req.body;
    const db = await loadDatabase();

    const order = db.orders.find(o => o.id === id);
    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    const task: OrderTask = {
      id: 'tsk-' + Math.random().toString(36).substring(2, 9),
      operatorId,
      operatorName,
      qaId,
      qaName,
      deadline: deadline || order.deadline || new Date().toISOString(),
      priority: priority || 'NORMAL',
      completed: false,
      notes
    };

    order.tasks = [task]; // assign or replace
    order.status = 'EN_FILE_ATTENTE';
    order.updatedAt = new Date().toISOString();

    // Notify assigned operator and QA as well as admins & client
    await notifyOrderStakeholders(
      db,
      order,
      'Commande assignée',
      `La commande ${order.reference} a été assignée à ${operatorName} (Contrôleur: ${qaName || 'Non défini'}).`,
      { includeClient: true, includePartner: true, includeAdmins: true, includeAssigned: true }
    );

    await saveDatabase(db);

    await logAction(
      userId,
      userName,
      'Assignation Travail',
      `Commande ${order.reference} assignée à l'opérateur ${operatorName} (Contrôleur: ${qaName || 'Non défini'}).`
    );

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Upload Document Endpoint
app.post('/api/orders/:id/upload', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, size, folder, base64Data, uploadedBy } = req.body;
    const db = await loadDatabase();

    const order = db.orders.find(o => o.id === id);
    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    // Determine next version of file if same name exists
    const existingCount = order.files.filter(f => f.name === name && f.folder === folder).length;
    const version = existingCount + 1;

    const newFile: OrderFile = {
      id: 'fil-' + Math.random().toString(36).substring(2, 9),
      name,
      type,
      size,
      folder,
      version,
      uploadedBy,
      uploadedAt: new Date().toISOString(),
      base64Data
    };

    order.files.push(newFile);
    order.updatedAt = new Date().toISOString();

    // Real / Simulated external Google Drive backup copying
    const driveAccounts = db.settings.googleDriveAccounts || [];
    const activeAccounts = driveAccounts.filter(a => a.status === 'connected');
    if (activeAccounts.length > 0) {
      if (!db.settings.googleDriveTransferLogs) {
        db.settings.googleDriveTransferLogs = [];
      }
      for (const account of activeAccounts) {
        const logId = 'log-' + Math.random().toString(36).substring(2, 9);
        const folderLabel = folder === '05_VERSION_FINALE' ? 'Travaux Terminés' : 'Dépôt Clients';
        db.settings.googleDriveTransferLogs.push({
          id: logId,
          timestamp: new Date().toISOString(),
          accountName: account.name,
          fileName: name,
          type: folder === '05_VERSION_FINALE' ? 'completed_work' : 'client_upload',
          status: 'success',
          details: `Fichier sauvegardé et synchronisé vers Google Drive (${account.email}) -> Dossier "${folderLabel}" (ID de document: gdrive_${Math.random().toString(36).substring(2, 12)})`
        });
      }
    }

    // Side effect: If operator uploads to 05_VERSION_FINALE, progress the order to QC
    if (folder === '05_VERSION_FINALE' && order.status === 'EN_TRAITEMENT') {
      order.status = 'CONTROLE_QUALITE';
      // Create empty QA checklist if none exists
      if (!order.qualityChecklist) {
        order.qualityChecklist = {
          allPagesProcessed: false,
          noMissingDocs: false,
          spellingVerified: false,
          layoutVerified: false,
          numberingVerified: false,
          filesOpenCorrectly: false,
          formatRespected: false,
          fileNamesCorrect: false,
          finalVersionValidated: false
        };
      }
    }

    await saveDatabase(db);

    await logAction(
      uploadedBy,
      'Utilisateur',
      'Fichier déposé',
      `Fichier "${name}" (v${version}) ajouté dans le dossier [${folder}] pour la commande ${order.reference}.`
    );

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Messages & Chat Endpoints
app.post('/api/orders/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { senderName, senderRole, message, isInternal, fileName, fileBase64 } = req.body;
    const db = await loadDatabase();

    const order = db.orders.find(o => o.id === id);
    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    const newMessage: OrderMessage = {
      id: 'msg-' + Math.random().toString(36).substring(2, 9),
      senderName,
      senderRole,
      message,
      timestamp: new Date().toISOString(),
      isInternal: !!isInternal,
      fileName,
      fileBase64
    };

    order.messages.push(newMessage);
    order.updatedAt = new Date().toISOString();
    await saveDatabase(db);

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Quality Control Verification Checklist
app.post('/api/orders/:id/qa', async (req, res) => {
  try {
    const { id } = req.params;
    const { checklist, validatedBy, action } = req.body; // action: 'approve' or 'reject'
    const db = await loadDatabase();

    const order = db.orders.find(o => o.id === id);
    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    const previousChecklist = order.qualityChecklist || {} as QualityChecklist;
    const updatedChecklist: QualityChecklist = {
      ...previousChecklist,
      ...checklist,
      validatedBy: action === 'approve' ? validatedBy : undefined,
      validatedAt: action === 'approve' ? new Date().toISOString() : undefined
    };

    order.qualityChecklist = updatedChecklist;
    order.updatedAt = new Date().toISOString();

    if (action === 'approve') {
      order.status = 'TRAVAIL_TERMINE';
      if (order.tasks[0]) {
        order.tasks[0].completed = true;
      }

      // Real / Simulated external Google Drive backup copying of finished works
      const driveAccounts = db.settings.googleDriveAccounts || [];
      const activeAccounts = driveAccounts.filter(a => a.status === 'connected');
      if (activeAccounts.length > 0) {
        if (!db.settings.googleDriveTransferLogs) {
          db.settings.googleDriveTransferLogs = [];
        }
        const finalFiles = order.files.filter(f => f.folder === '05_VERSION_FINALE');
        for (const file of finalFiles) {
          for (const account of activeAccounts) {
            const logId = 'log-' + Math.random().toString(36).substring(2, 9);
            db.settings.googleDriveTransferLogs.push({
              id: logId,
              timestamp: new Date().toISOString(),
              accountName: account.name,
              fileName: file.name,
              type: 'completed_work',
              status: 'success',
              details: `Travail terminé "${file.name}" archivé vers Google Drive (${account.email}) -> Dossier "Travaux Terminés"`
            });
          }
        }
      }

      // Trigger notification
      await notifyOrderStakeholders(
        db,
        order,
        'Travail terminé & validé',
        `Le contrôle de qualité a été validé avec succès pour votre commande ${order.reference}. Le travail est prêt.`,
        { includeClient: true, includePartner: true, includeAdmins: true, includeAssigned: true }
      );

      // Generate Balance Invoice (Solde)
      const quote = db.quotes.find(q => q.orderId === order.id);
      if (quote) {
        const balanceRef = `FAC-2026-${(db.invoices.length + 1).toString().padStart(4, '0')}`;
        const balanceInvoice: Invoice = {
          id: 'inv-' + Math.random().toString(36).substring(2, 9),
          reference: balanceRef,
          orderId: order.id,
          quoteId: quote.id,
          amount: quote.balanceAmount,
          type: 'balance',
          status: 'unpaid',
          date: new Date().toISOString()
        };
        db.invoices.push(balanceInvoice);

        await logAction(
          validatedBy,
          'Contrôle Qualité',
          'Validation Qualité OK',
          `Contrôle qualité validé pour ${order.reference}. Commande passe en "TRAVAIL_TERMINE", facture de solde ${balanceRef} émise.`
        );
      }
    } else if (action === 'reject') {
      order.status = 'EN_TRAITEMENT'; // Redirection to Treatment

      await notifyOrderStakeholders(
        db,
        order,
        'Travail retourné pour corrections',
        `Le contrôle qualité a relevé des points à corriger sur la commande ${order.reference}.`,
        { includeClient: false, includePartner: false, includeAdmins: true, includeAssigned: true }
      );

      await logAction(
        validatedBy,
        'Contrôle Qualité',
        'Contrôle Qualité Échec',
        `Travail refusé lors du contrôle qualité pour ${order.reference}. Retourné en traitement avec corrections requises.`
      );
    }

    await saveDatabase(db);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Manual Payment Recording and Verification
app.post('/api/orders/:id/pay', async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, type, method, proofFileName, proofFileBase64, userId, userName, action } = req.body;
    const db = await loadDatabase();

    const order = db.orders.find(o => o.id === id);
    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    const quote = db.quotes.find(q => q.orderId === order.id);
    if (!quote) {
      res.status(404).json({ error: 'Devis introuvable.' });
      return;
    }

    if (action === 'submit_proof') {
      // Client submits payment proof
      const paymentRef = `REC-2026-${(db.payments.length + 1).toString().padStart(4, '0')}`;
      const newPayment: Payment = {
        id: 'pay-' + Math.random().toString(36).substring(2, 9),
        reference: paymentRef,
        orderId: order.id,
        amount,
        type, // 'deposit' | 'balance'
        method,
        status: 'pending',
        proofFileName,
        proofFileBase64,
        date: new Date().toISOString(),
        notes: `Preuve soumise par le client. Attente validation.`
      };
      db.payments.push(newPayment);

      // Save files representation
      if (proofFileName) {
        order.files.push({
          id: 'fil-' + Math.random().toString(36).substring(2, 9),
          name: proofFileName,
          type: 'image/jpeg',
          size: 200000,
          folder: '07_PREUVES',
          version: 1,
          uploadedBy: userName,
          uploadedAt: new Date().toISOString(),
          base64Data: proofFileBase64
        });
      }

      order.status = type === 'deposit' ? 'EN_ATTENTE_ACOMPTE' : 'EN_ATTENTE_SOLDE';
      order.updatedAt = new Date().toISOString();

      await notifyOrderStakeholders(
        db,
        order,
        'Preuve de paiement soumise',
        `Preuve de paiement de l'${type === 'deposit' ? 'acompte' : 'solde'} (${amount} DH) déposée pour ${order.reference}. En attente de validation administrative.`,
        { includeClient: true, includePartner: true, includeAdmins: true, includeAssigned: false }
      );

      await logAction(userId, userName, 'Preuve paiement', `Preuve de paiement de l'${type === 'deposit' ? 'acompte' : 'solde'} (${amount} DH) soumise pour ${order.reference}.`);
    } else if (action === 'verify_payment') {
      // Admin approves or rejects the payment
      const { paymentId, approve } = req.body;
      const paymentObj = db.payments.find(p => p.id === paymentId);
      if (!paymentObj) {
        res.status(404).json({ error: 'Paiement introuvable.' });
        return;
      }

      if (approve) {
        paymentObj.status = 'verified';
        paymentObj.notes = `Paiement vérifié et approuvé par ${userName}.`;

        // Update invoices associated
        const invoiceObj = db.invoices.find(i => i.orderId === order.id && i.type === paymentObj.type);
        if (invoiceObj) {
          invoiceObj.status = 'paid';
        }

        if (paymentObj.type === 'deposit') {
          order.status = 'ACOMPTE_PAYE'; // triggers readiness for production!
          await notifyOrderStakeholders(
            db,
            order,
            'Acompte validé',
            `Le paiement de l'acompte (${paymentObj.amount} DH) pour votre commande ${order.reference} a été validé. La production démarre.`,
            { includeClient: true, includePartner: true, includeAdmins: true, includeAssigned: true }
          );
        } else {
          order.status = 'SOLDE_PAYE'; // ready for delivery!
          await notifyOrderStakeholders(
            db,
            order,
            'Solde validé',
            `Le paiement du solde (${paymentObj.amount} DH) pour votre commande ${order.reference} a été validé. Commande prête pour livraison.`,
            { includeClient: true, includePartner: true, includeAdmins: true, includeAssigned: true }
          );
        }

        await logAction(userId, userName, 'Validation paiement', `Paiement ${paymentObj.reference} de ${paymentObj.amount} DH validé pour la commande ${order.reference}.`);

        // --- AFFILIATE COMMISSION AUTOMATIC CALCULATION ---
        let affId = order.affiliateId;
        let affCode = order.affiliateCode;
        if (!affId && order.customerDetails && order.customerDetails.email) {
          const clientUser = db.users.find(u => u.email.toLowerCase() === order.customerDetails.email.toLowerCase());
          if (clientUser && clientUser.referredByAffiliateId) {
            affId = clientUser.referredByAffiliateId;
            affCode = clientUser.referredByAffiliateCode;
          }
        }

        if (affId) {
          const affiliateUser = db.users.find(u => u.id === affId);
          if (affiliateUser && affiliateUser.active !== false && affiliateUser.affiliateStatus !== 'inactive') {
            const orderEmail = (order.customerDetails?.email || '').toLowerCase().trim();
            const affEmail = (affiliateUser.email || '').toLowerCase().trim();

            // Guard: No self-commissions on own account or own orders!
            if (orderEmail === affEmail || affiliateUser.id === order.partnerId) {
              console.warn(`[Affiliation] Auto-commission blocked for self-purchase/own account: ${affEmail}`);
            } else {
              // Resolve rate by priority: service specific, then order saved, then affiliate rate, then general rate, then fallback 10
              let rate = 10;
              const serviceId = order.serviceId;
              const serviceSpecificRate = db.settings?.affiliateCommissionConfig?.serviceCommissionRates?.[serviceId];
              
              if (serviceSpecificRate !== undefined && serviceSpecificRate !== null) {
                rate = Number(serviceSpecificRate);
              } else if (order.commissionRate !== undefined && order.commissionRate !== null) {
                rate = order.commissionRate;
              } else if (affiliateUser.commissionRate !== undefined && affiliateUser.commissionRate !== null) {
                rate = affiliateUser.commissionRate;
              } else if (db.settings?.affiliateCommissionConfig?.generalCommissionRate !== undefined) {
                rate = db.settings.affiliateCommissionConfig.generalCommissionRate;
              }

              const commAmount = Math.round((paymentObj.amount * (rate / 100)) * 100) / 100;

              if (!db.affiliateCommissions) db.affiliateCommissions = [];

              const existingComm = db.affiliateCommissions.find(c => c.paymentId === paymentObj.id || (c.orderId === order.id && c.paymentReference === paymentObj.reference));
              if (!existingComm) {
                const newComm: AffiliateCommission = {
                  id: 'comm-' + Math.random().toString(36).substring(2, 9),
                  affiliateId: affiliateUser.id,
                  affiliateName: affiliateUser.name,
                  affiliateCode: affiliateUser.affiliateCode || affCode || 'AFF',
                  clientId: order.customerDetails.email || 'client',
                  clientName: order.customerDetails.name,
                  orderId: order.id,
                  orderReference: order.reference,
                  serviceName: order.serviceName,
                  paymentId: paymentObj.id,
                  paymentReference: paymentObj.reference,
                  orderTotalAmount: (quote && quote.totalAmount) || paymentObj.amount,
                  paidAmount: paymentObj.amount,
                  commissionRate: rate,
                  commissionAmount: commAmount,
                  status: 'validated',
                  createdAt: new Date().toISOString(),
                  validatedAt: new Date().toISOString(),
                  notes: `Commission de ${rate}% calculée automatiquement sur le paiement validé ${paymentObj.reference} (${paymentObj.amount} DH)`
                };
                db.affiliateCommissions.push(newComm);
              } else {
                existingComm.status = 'validated';
                existingComm.paidAmount = paymentObj.amount;
                existingComm.commissionRate = rate;
                existingComm.commissionAmount = commAmount;
                existingComm.validatedAt = new Date().toISOString();
              }
            }
          }
        }
      } else {
        paymentObj.status = 'rejected';
        paymentObj.notes = `Refusé par l'administrateur.`;

        if (db.affiliateCommissions) {
          const existingComm = db.affiliateCommissions.find(c => c.paymentId === paymentObj.id);
          if (existingComm) {
            existingComm.status = 'cancelled';
          }
        }
        await notifyOrderStakeholders(
          db,
          order,
          'Paiement rejeté',
          `Le paiement de ${paymentObj.amount} DH pour votre commande ${order.reference} a été rejeté. Veuillez vérifier vos justificatifs.`,
          { includeClient: true, includePartner: true, includeAdmins: true, includeAssigned: false }
        );
        await logAction(userId, userName, 'Refus paiement', `Paiement ${paymentObj.reference} refusé pour la commande ${order.reference}.`);
      }

      order.updatedAt = new Date().toISOString();
    }

    await saveDatabase(db);
    res.json({ order, quote, payments: db.payments.filter(p => p.orderId === order.id) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Revisions & Client Satisfaction Endpoints
app.post('/api/orders/:id/revisions', async (req, res) => {
  try {
    const { id } = req.params;
    const { requestedBy, requestedByRole, notes, attachmentName, attachmentBase64 } = req.body;
    const db = await loadDatabase();

    const order = db.orders.find(o => o.id === id);
    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    if (!order.revisions) {
      order.revisions = [];
    }

    const revNum = order.revisions.length + 1;
    const newRev: OrderRevision = {
      id: 'rev-' + Math.random().toString(36).substring(2, 9),
      revisionNumber: revNum,
      requestedBy: requestedBy || 'Client',
      requestedByRole: requestedByRole || 'client',
      notes,
      attachmentName,
      attachmentBase64,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    order.revisions.push(newRev);
    order.updatedAt = new Date().toISOString();

    // Notify team
    await notifyOrderStakeholders(
      db,
      order,
      'Demande de révision reçue',
      `Le client a formulé une demande de retouche / révision #${revNum} pour la commande ${order.reference}.`,
      { includeClient: true, includePartner: true, includeAdmins: true, includeAssigned: true }
    );

    await saveDatabase(db);
    await logAction(
      requestedBy || 'client',
      requestedBy || 'Client',
      'Demande Révision',
      `Demande de révision #${revNum} créée pour la commande ${order.reference}.`
    );

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.put('/api/orders/:id/revisions/:revId', async (req, res) => {
  try {
    const { id, revId } = req.params;
    const { status, deliveredFileName, deliveredFileBase64, adminResponseNotes } = req.body;
    const db = await loadDatabase();

    const order = db.orders.find(o => o.id === id);
    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    const revision = (order.revisions || []).find(r => r.id === revId);
    if (!revision) {
      res.status(404).json({ error: 'Révision introuvable.' });
      return;
    }

    revision.status = status || 'delivered';
    if (adminResponseNotes) revision.adminResponseNotes = adminResponseNotes;
    if (deliveredFileName) revision.deliveredFileName = deliveredFileName;
    if (deliveredFileBase64) revision.deliveredFileBase64 = deliveredFileBase64;
    revision.resolvedAt = new Date().toISOString();

    // If file attached, push to files under 05_VERSION_FINALE
    if (deliveredFileName) {
      order.files.push({
        id: 'fil-' + Math.random().toString(36).substring(2, 9),
        name: `[Révision #${revision.revisionNumber}] ${deliveredFileName}`,
        type: 'application/octet-stream',
        size: 250000,
        folder: '05_VERSION_FINALE',
        version: revision.revisionNumber + 1,
        uploadedBy: 'Équipe de production',
        uploadedAt: new Date().toISOString(),
        base64Data: deliveredFileBase64
      });
    }

    order.updatedAt = new Date().toISOString();

    await notifyOrderStakeholders(
      db,
      order,
      'Révision livrée',
      `La révision #${revision.revisionNumber} pour la commande ${order.reference} a été livrée et est disponible dans vos documents.`,
      { includeClient: true, includePartner: true, includeAdmins: true, includeAssigned: true }
    );

    await saveDatabase(db);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/orders/:id/satisfaction', async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, feedback, isSatisfied } = req.body;
    const db = await loadDatabase();

    const order = db.orders.find(o => o.id === id);
    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    order.clientSatisfaction = {
      isSatisfied: isSatisfied !== undefined ? isSatisfied : true,
      rating: rating || 5,
      feedback: feedback || '',
      validatedAt: new Date().toISOString()
    };

    if (order.status === 'LIVRE' || order.status === 'TRAVAIL_TERMINE') {
      order.status = 'TERMINE';
    }

    order.updatedAt = new Date().toISOString();

    await notifyOrderStakeholders(
      db,
      order,
      'Satisfaction client validée',
      `Le client a validé sa satisfaction à 100% (Note: ${order.clientSatisfaction.rating}/5) pour la commande ${order.reference}.`,
      { includeClient: true, includePartner: true, includeAdmins: true, includeAssigned: true }
    );

    await saveDatabase(db);
    await logAction('client', order.customerDetails.name, 'Validation Satisfaction', `Satisfaction client enregistrée (${rating}/5) pour ${order.reference}.`);

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.put('/api/orders/:id/payment-terms', async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentMethod, paymentTerms, customDueDate } = req.body;
    const db = await loadDatabase();

    const order = db.orders.find(o => o.id === id);
    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    if (paymentMethod) order.paymentMethod = paymentMethod;
    if (paymentTerms) order.paymentTerms = paymentTerms;
    if (customDueDate) order.customDueDate = customDueDate;

    order.updatedAt = new Date().toISOString();

    await saveDatabase(db);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- AFFILIATION & REVENTE DE SERVICES API ENDPOINTS ---

// Public Affiliate / Sponsor Info endpoint for the landing page (no auth required)
app.get('/api/affiliates/public/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const db = await loadDatabase();
    const search = (code || '').trim().toUpperCase();
    
    // Find user by affiliateCode or id or username
    const aff = db.users.find(u => 
      (u.affiliateCode && u.affiliateCode.toUpperCase() === search) ||
      u.id.toUpperCase() === search ||
      (u.username && u.username.toUpperCase() === search)
    );

    if (!aff) {
      res.status(404).json({ error: 'Code parrain introuvable' });
      return;
    }

    const affCode = aff.affiliateCode || `AFF-${aff.id.substring(0, 5).toUpperCase()}`;
    const ordersAttributed = db.orders.filter(o => o.affiliateCode && o.affiliateCode.toUpperCase() === affCode.toUpperCase()).length;

    res.json({
      id: aff.id,
      name: aff.name,
      username: aff.username || aff.name.toLowerCase().replace(/\s+/g, '.'),
      email: aff.email,
      phone: aff.phone || '+212 600-000000',
      city: aff.city || 'Casablanca / Maroc',
      affiliateCode: affCode,
      affiliateLink: `?ref=${affCode}`,
      role: aff.role,
      active: aff.active !== false,
      affiliateStatus: aff.affiliateStatus || 'active',
      commissionRate: aff.commissionRate ?? 10,
      totalOrdersCompleted: ordersAttributed,
      bio: aff.notes || `Ambassadeur Partenaire officiel DigiDocs. Je vous recommande nos services de saisie, conversion OCR, mise en page et traitement documentaire. Profitez d'une remise exclusive avec mon code parrain !`,
      specialDiscountPercentage: 10
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// List all affiliates with computed performance stats
app.get('/api/affiliates', async (req, res) => {
  try {
    const db = await loadDatabase();
    const affiliatesList = db.users.filter(u => u.role === 'affiliate' || Boolean(u.affiliateCode));

    const enriched = affiliatesList.map(aff => {
      const code = (aff.affiliateCode || '').toUpperCase();

      // Referred clients (excluding self-referrals/self-accounts)
      const clients = db.users.filter(u => 
        (u.referredByAffiliateId === aff.id || (code && u.referredByAffiliateCode && u.referredByAffiliateCode.toUpperCase() === code)) &&
        u.id !== aff.id &&
        u.email.toLowerCase().trim() !== aff.email.toLowerCase().trim()
      );

      // Orders attributed
      const orders = db.orders.filter(o => o.affiliateId === aff.id || (code && o.affiliateCode && o.affiliateCode.toUpperCase() === code) || clients.some(c => c.email && o.customerDetails && o.customerDetails.email && c.email.toLowerCase() === o.customerDetails.email.toLowerCase()));

      // Commissions
      const commissions = (db.affiliateCommissions || []).filter(c => c.affiliateId === aff.id || (code && c.affiliateCode && c.affiliateCode.toUpperCase() === code));

      const verifiedPayments = db.payments.filter(p => p.status === 'verified' && orders.some(o => o.id === p.orderId));
      const totalRevenue = verifiedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

      const pendingCommissions = commissions.filter(c => c.status === 'pending').reduce((sum, c) => sum + c.commissionAmount, 0);
      const validatedCommissions = commissions.filter(c => c.status === 'validated').reduce((sum, c) => sum + c.commissionAmount, 0);
      const paidCommissions = commissions.filter(c => c.status === 'paid').reduce((sum, c) => sum + c.commissionAmount, 0);
      const cancelledCommissions = commissions.filter(c => c.status === 'cancelled').reduce((sum, c) => sum + c.commissionAmount, 0);

      return {
        ...aff,
        affiliateCode: aff.affiliateCode || `AFF-${aff.id.substring(0, 5).toUpperCase()}`,
        affiliateLink: aff.affiliateLink || `?ref=${aff.affiliateCode || aff.id}`,
        commissionRate: aff.commissionRate ?? 10,
        clientsCount: clients.length,
        ordersCount: orders.length,
        paidOrdersCount: verifiedPayments.length,
        totalRevenue,
        pendingCommissions,
        validatedCommissions,
        paidCommissions,
        cancelledCommissions,
        totalCommissions: validatedCommissions + paidCommissions
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Create new affiliate account
app.post('/api/affiliates', async (req, res) => {
  try {
    const { name, email, phone, city, commissionRate, affiliateCode, password, notes } = req.body;
    if (!name || !email) {
      res.status(400).json({ error: 'Le nom et l\'adresse e-mail de l\'affilié sont obligatoires.' });
      return;
    }

    const db = await loadDatabase();
    const normalizedEmail = email.toLowerCase().trim();
    if (db.users.some(u => u.email.toLowerCase() === normalizedEmail)) {
      res.status(400).json({ error: 'Adresse e-mail déjà enregistrée.' });
      return;
    }

    const code = (affiliateCode || `AFF-${Math.random().toString(36).substring(2, 7)}`).toUpperCase().trim();
    if (db.users.some(u => u.affiliateCode && u.affiliateCode.toUpperCase() === code)) {
      res.status(400).json({ error: 'Ce code d\'affilié existe déjà. Veuillez en choisir un autre.' });
      return;
    }

    const newAffiliate: User = {
      id: 'usr-aff-' + Math.random().toString(36).substring(2, 9),
      name: name.trim(),
      username: email.split('@')[0].toLowerCase().trim(),
      email: normalizedEmail,
      password: password ? password.trim() : 'affiliate123',
      role: 'affiliate',
      phone: phone ? phone.trim() : '',
      city: city ? city.trim() : 'Casablanca',
      active: true,
      affiliateStatus: 'active',
      affiliateCode: code,
      affiliateLink: `?ref=${code}`,
      commissionRate: typeof commissionRate === 'number' ? commissionRate : 10,
      notes: notes || '',
      createdAt: new Date().toISOString()
    };

    db.users.push(newAffiliate);
    await saveDatabase(db);
    await logAction('admin', 'Administrateur', 'Création Affilié', `Compte affilié "${newAffiliate.name}" créé avec le code ${code} et un taux de ${newAffiliate.commissionRate}%.`);

    res.json(newAffiliate);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Update affiliate settings (commission %, active status, name, etc.)
app.put('/api/affiliates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, city, commissionRate, affiliateStatus, active, notes, password } = req.body;
    const db = await loadDatabase();

    const user = db.users.find(u => u.id === id);
    if (!user) {
      res.status(404).json({ error: 'Affilié introuvable.' });
      return;
    }

    if (name) user.name = name.trim();
    if (email) user.email = email.toLowerCase().trim();
    if (phone !== undefined) user.phone = phone.trim();
    if (city !== undefined) user.city = city.trim();
    if (commissionRate !== undefined) user.commissionRate = Number(commissionRate);
    if (affiliateStatus !== undefined) user.affiliateStatus = affiliateStatus;
    if (active !== undefined) user.active = Boolean(active);
    if (notes !== undefined) user.notes = notes;
    if (password && password.trim()) user.password = password.trim();

    await saveDatabase(db);
    await logAction('admin', 'Administrateur', 'Modification Affilié', `Mise à jour du profil affilié "${user.name}".`);

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Request affiliate activation by a client or partner
app.post('/api/affiliates/request-activation', async (req, res) => {
  try {
    const { userId } = req.body;
    const db = await loadDatabase();
    const user = db.users.find(u => u.id === userId);
    if (!user) {
      res.status(404).json({ error: 'Utilisateur introuvable.' });
      return;
    }
    user.affiliateStatus = 'pending';
    if (!user.affiliateCode) {
      const code = `AFF-${Math.random().toString(36).substring(2, 7)}`.toUpperCase();
      user.affiliateCode = code;
      user.affiliateLink = `?ref=${code}`;
    }
    if (user.commissionRate === undefined) {
      user.commissionRate = db.settings?.affiliateCommissionConfig?.generalCommissionRate || 10;
    }
    await saveDatabase(db);
    await logAction(user.id, user.name, 'Demande Affiliation', `L'utilisateur ${user.name} a demandé l'activation de son compte d'affiliation.`);
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Admin/Assistant activate or deactivate affiliate
app.post('/api/affiliates/:id/activate', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, commissionRate } = req.body; // 'active' | 'inactive'
    const db = await loadDatabase();
    const user = db.users.find(u => u.id === id);
    if (!user) {
      res.status(404).json({ error: 'Utilisateur introuvable.' });
      return;
    }
    user.affiliateStatus = status;
    if (status === 'active') {
      if (!user.affiliateCode) {
        const code = `AFF-${Math.random().toString(36).substring(2, 7)}`.toUpperCase();
        user.affiliateCode = code;
        user.affiliateLink = `?ref=${code}`;
      }
      if (user.role === 'client') {
        user.role = 'affiliate';
      }
    }
    if (commissionRate !== undefined) {
      user.commissionRate = Number(commissionRate);
    }
    await saveDatabase(db);
    await logAction('admin', 'Administrateur', 'Activation Affilié', `Le compte d'affiliation de ${user.name} a été défini sur ${status}.`);
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Convert affiliate commission balance to advance balance (solde avance)
app.post('/api/affiliates/convert-balance', async (req, res) => {
  try {
    const { userId, amount } = req.body;
    const db = await loadDatabase();
    const user = db.users.find(u => u.id === userId);
    if (!user) {
      res.status(404).json({ error: 'Utilisateur introuvable.' });
      return;
    }

    const commissions = (db.affiliateCommissions || []).filter(c => c.affiliateId === userId && c.status === 'validated');
    const totalValidated = commissions.reduce((sum, c) => sum + c.commissionAmount, 0);

    const amountToConvert = Number(amount) > 0 ? Number(amount) : totalValidated;
    if (amountToConvert <= 0) {
      res.status(400).json({ error: 'Aucune commission validée disponible à convertir.' });
      return;
    }

    if (amountToConvert > totalValidated + 0.01) {
      res.status(400).json({ error: `Montant supérieur au solde de commissions validées disponibles (${totalValidated} DH).` });
      return;
    }

    let remainingToCover = amountToConvert;
    for (const c of commissions) {
      if (remainingToCover <= 0) break;
      if (c.commissionAmount <= remainingToCover) {
        c.status = 'paid';
        c.paymentReference = 'CONVERSION_AVANCE_SERVICES';
        remainingToCover -= c.commissionAmount;
      } else {
        c.commissionAmount -= remainingToCover;
        db.affiliateCommissions.push({
          ...c,
          id: 'com-conv-' + Math.random().toString(36).substring(2, 9),
          commissionAmount: remainingToCover,
          status: 'paid',
          paymentReference: 'CONVERSION_AVANCE_SERVICES'
        });
        remainingToCover = 0;
      }
    }

    user.advanceBalance = (user.advanceBalance || 0) + amountToConvert;
    if (!user.advanceHistory) {
      user.advanceHistory = [];
    }
    user.advanceHistory.push({
      id: 'adv-' + Math.random().toString(36).substring(2, 9),
      amount: amountToConvert,
      date: new Date().toISOString(),
      note: `Conversion de ${amountToConvert.toFixed(2)} DH depuis les commissions d'affiliation validées.`
    });

    await saveDatabase(db);
    await logAction(user.id, user.name, 'Conversion Commissions', `Conversion de ${amountToConvert.toFixed(2)} DH de commissions en avance sur solde.`);

    res.json({ success: true, user, convertedAmount: amountToConvert, newAdvanceBalance: user.advanceBalance });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get commissions list
app.get('/api/affiliate-commissions', async (req, res) => {
  try {
    const { affiliateId, status } = req.query;
    const db = await loadDatabase();
    let commissions = db.affiliateCommissions || [];

    if (affiliateId) {
      const aff = db.users.find(u => u.id === affiliateId || u.affiliateCode === affiliateId);
      const code = aff?.affiliateCode || affiliateId;
      commissions = commissions.filter(c => c.affiliateId === affiliateId || (code && c.affiliateCode && c.affiliateCode.toUpperCase() === (code as string).toUpperCase()));
    }

    if (status) {
      commissions = commissions.filter(c => c.status === status);
    }

    commissions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json(commissions);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Generate Debit Note / Request Payment for Validated Commissions
app.post('/api/affiliate-commissions/request-debit-note', async (req, res) => {
  try {
    const { affiliateId, commissionIds, bankName, ribNumber, notes } = req.body;
    const db = await loadDatabase();

    const user = db.users.find(u => u.id === affiliateId || u.affiliateCode === affiliateId);
    if (!user) {
      res.status(404).json({ error: 'Compte affilié introuvable.' });
      return;
    }

    if (bankName) user.bankName = bankName;
    if (ribNumber) user.ribNumber = ribNumber;

    let targetCommissions = (db.affiliateCommissions || []).filter(c => 
      (c.affiliateId === user.id || (user.affiliateCode && c.affiliateCode && c.affiliateCode.toUpperCase() === user.affiliateCode.toUpperCase())) &&
      c.status === 'validated'
    );

    if (commissionIds && Array.isArray(commissionIds) && commissionIds.length > 0) {
      targetCommissions = targetCommissions.filter(c => commissionIds.includes(c.id));
    }

    if (targetCommissions.length === 0) {
      res.status(400).json({ error: 'Aucune commission validée disponible pour l\'émission d\'une note de débit.' });
      return;
    }

    const debitNoteRef = `ND-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const nowIso = new Date().toISOString();
    const totalAmount = Math.round(targetCommissions.reduce((sum, c) => sum + (c.commissionAmount || 0), 0) * 100) / 100;

    targetCommissions.forEach(c => {
      c.status = 'requested';
      c.requestedAt = nowIso;
      c.debitNoteReference = debitNoteRef;
      c.bankName = bankName || user.bankName || 'Attijariwafa Bank';
      c.ribNumber = ribNumber || user.ribNumber || 'Non spécifié';
      if (notes) c.notes = (c.notes ? c.notes + ' | ' : '') + `Note de Débit #${debitNoteRef}`;
    });

    if (!db.notifications) db.notifications = [];
    db.notifications.unshift({
      id: 'notif-' + Math.random().toString(36).substring(2, 9),
      userId: 'usr-admin-1',
      title: 'Demande de Règlement d\'Affiliation',
      message: `📄 Note de Débit #${debitNoteRef} reçue de ${user.name} (${user.affiliateCode}) pour un montant total de ${totalAmount} DH (${targetCommissions.length} commission(s)).`,
      read: false,
      createdAt: nowIso
    });

    await saveDatabase(db);
    await logAction(user.id, user.name, 'Émission Note de Débit', `Note de Débit #${debitNoteRef} transmise pour un montant de ${totalAmount} DH (${targetCommissions.length} commission(s)).`);

    res.json({
      success: true,
      debitNoteReference: debitNoteRef,
      date: nowIso,
      totalAmount,
      commissionsCount: targetCommissions.length,
      affiliateName: user.name,
      affiliateCode: user.affiliateCode,
      bankName: user.bankName,
      ribNumber: user.ribNumber,
      updatedCommissions: targetCommissions
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Update commission status (validate, pay, cancel, request)
app.put('/api/affiliate-commissions/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const db = await loadDatabase();

    const comm = (db.affiliateCommissions || []).find(c => c.id === id);
    if (!comm) {
      res.status(404).json({ error: 'Commission introuvable.' });
      return;
    }

    comm.status = status;
    if (notes) comm.notes = notes;

    if (status === 'validated') {
      comm.validatedAt = new Date().toISOString();
    } else if (status === 'requested') {
      comm.requestedAt = new Date().toISOString();
    } else if (status === 'paid') {
      comm.paidAt = new Date().toISOString();
    }

    await saveDatabase(db);
    await logAction('admin', 'Administrateur', 'Mise à jour Commission', `Statut commission de ${comm.affiliateName} (${comm.commissionAmount} DH) mis à jour vers: ${status}.`);

    res.json(comm);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Dashboard statistics
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const { role, userId } = req.query;
    const db = await loadDatabase();

    let filteredOrders = db.orders;
    if (role === 'partner') {
      filteredOrders = db.orders.filter(o => o.partnerId === userId);
    } else if (role === 'client') {
      const userObj = db.users.find(u => u.id === userId);
      if (userObj) {
        filteredOrders = db.orders.filter(o => o.customerDetails.email === userObj.email);
      }
    } else if (role === 'operator') {
      filteredOrders = db.orders.filter(o => o.tasks.some(t => t.operatorId === userId));
    } else if (role === 'qa') {
      filteredOrders = db.orders.filter(o => o.tasks.some(t => t.qaId === userId));
    }

    // Counts
    const stats = {
      total: filteredOrders.length,
      brouillon: filteredOrders.filter(o => o.status === 'BROUILLON').length,
      demandes: filteredOrders.filter(o => o.status === 'DEMANDE_ENVOYEE' || o.status === 'EN_ATTENTE_ANALYSE').length,
      devis: filteredOrders.filter(o => o.status === 'DEVIS_EN_PREPARATION' || o.status === 'DEVIS_ENVOYE').length,
      enCours: filteredOrders.filter(o => o.status === 'ACOMPTE_PAYE' || o.status === 'EN_FILE_ATTENTE' || o.status === 'EN_TRAITEMENT').length,
      qualityControl: filteredOrders.filter(o => o.status === 'CONTROLE_QUALITE').length,
      completed: filteredOrders.filter(o => o.status === 'TRAVAIL_TERMINE' || o.status === 'SOLDE_PAYE' || o.status === 'PRET_A_LIVRER').length,
      done: filteredOrders.filter(o => o.status === 'TERMINE' || o.status === 'LIVRE').length,
      annules: filteredOrders.filter(o => o.status === 'ANNULE' || o.status === 'REFUSE').length,
      urgent: filteredOrders.filter(o => o.urgency === 'urgent' || o.urgency === 'very_urgent').length,
      // Finances
      caTotal: 0,
      acomptesRecus: 0,
      soldesAttente: 0,
      commissionTotal: 0
    };

    // Calculate finances
    const allQuotes = db.quotes;
    const orderIdsFiltered = new Set(filteredOrders.map(o => o.id));

    allQuotes.forEach(q => {
      if (orderIdsFiltered.has(q.orderId)) {
        if (q.status === 'accepted') {
          stats.caTotal += q.totalAmount;
          stats.acomptesRecus += q.depositAmount;
          stats.soldesAttente += q.balanceAmount;
          if (role === 'partner') {
            stats.commissionTotal += q.totalAmount * 0.20; // 20% partner commission simulated
          }
        }
      }
    });

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Audit Logs Endpoint
app.get('/api/audit-logs', async (req, res) => {
  try {
    const db = await loadDatabase();
    res.json(db.auditLogs);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Settings Endpoints
app.get('/api/settings', async (req, res) => {
  try {
    const db = await loadDatabase();
    if (!db.settings.affiliateCommissionConfig) {
      db.settings.affiliateCommissionConfig = {
        generalCommissionRate: 10,
        minimumPayoutAmount: 100,
        serviceCommissionRates: {},
        isAffiliateSystemEnabled: true
      };
      await saveDatabase(db);
    }
    res.json(db.settings);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const settings = req.body;
    const { userId, userName } = req.query;
    const db = await loadDatabase();
    db.settings = { ...db.settings, ...settings };
    await saveDatabase(db);
    await logAction(
      (userId as string) || 'admin',
      (userName as string) || 'Administrateur',
      'Mise à jour paramètres',
      'Paramètres système mis à jour.'
    );
    res.json(db.settings);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Google Drive - Add Account
app.post('/api/settings/gdrive/accounts', async (req, res) => {
  try {
    const { name, email, folderId, completedFolderId, userId, userName } = req.body;
    const db = await loadDatabase();
    if (!db.settings.googleDriveAccounts) {
      db.settings.googleDriveAccounts = [];
    }
    const newAccount = {
      id: 'gdr-' + Math.random().toString(36).substring(2, 9),
      name: name || 'Google Drive',
      email: email || 'drive@company.com',
      folderId: folderId || 'root',
      completedFolderId: completedFolderId || 'completed',
      status: 'connected' as const,
      createdAt: new Date().toISOString()
    };
    db.settings.googleDriveAccounts.push(newAccount);
    await saveDatabase(db);
    await logAction(
      userId || 'admin',
      userName || 'Administrateur',
      'Connexion Google Drive',
      `Compte Google Drive "${email}" connecté pour l'archivage automatique.`
    );
    res.json(db.settings);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Google Drive - Disconnect Account
app.delete('/api/settings/gdrive/accounts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, userName } = req.query;
    const db = await loadDatabase();
    if (db.settings.googleDriveAccounts) {
      const account = db.settings.googleDriveAccounts.find(a => a.id === id);
      db.settings.googleDriveAccounts = db.settings.googleDriveAccounts.filter(a => a.id !== id);
      await saveDatabase(db);
      if (account) {
        await logAction(
          (userId as string) || 'admin',
          (userName as string) || 'Administrateur',
          'Déconnexion Google Drive',
          `Compte Google Drive "${account.email}" déconnecté.`
        );
      }
    }
    res.json(db.settings);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Resource Documents - Upload/Add Document
app.post('/api/settings/resources', async (req, res) => {
  try {
    const { name, category, classification, uploadedBy, size, type, base64Data, userId, userName } = req.body;
    const db = await loadDatabase();
    if (!db.settings.resourceDocuments) {
      db.settings.resourceDocuments = [];
    }
    const newDoc = {
      id: 'res-' + Math.random().toString(36).substring(2, 9),
      name,
      category,
      classification,
      uploadedBy,
      uploadedAt: new Date().toISOString(),
      size,
      type,
      base64Data,
      externalUrl: `https://drive.google.com/open?id=gdrive_${Math.random().toString(36).substring(2, 12)}`
    };
    db.settings.resourceDocuments.push(newDoc);

    // Also trigger copy to Google Drive log if accounts connected
    const driveAccounts = db.settings.googleDriveAccounts || [];
    const activeAccounts = driveAccounts.filter(a => a.status === 'connected');
    if (activeAccounts.length > 0) {
      if (!db.settings.googleDriveTransferLogs) {
        db.settings.googleDriveTransferLogs = [];
      }
      for (const account of activeAccounts) {
        db.settings.googleDriveTransferLogs.push({
          id: 'log-' + Math.random().toString(36).substring(2, 9),
          timestamp: new Date().toISOString(),
          accountName: account.name,
          fileName: name,
          type: 'resource_doc',
          status: 'success',
          details: `Modèle ressource sauvegardé dans Google Drive (${account.email}) -> Dossier "Ressources Partagées"`
        });
      }
    }

    await saveDatabase(db);
    await logAction(
      userId || 'admin',
      userName || 'Administrateur',
      'Ajout Document Ressource',
      `Document ressource "${name}" ajouté à l'Espace Outils.`
    );
    res.json(db.settings);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Resource Documents - Delete Document
app.delete('/api/settings/resources/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, userName } = req.query;
    const db = await loadDatabase();
    if (db.settings.resourceDocuments) {
      const doc = db.settings.resourceDocuments.find(d => d.id === id);
      db.settings.resourceDocuments = db.settings.resourceDocuments.filter(d => d.id !== id);
      await saveDatabase(db);
      if (doc) {
        await logAction(
          (userId as string) || 'admin',
          (userName as string) || 'Administrateur',
          'Suppression Document Ressource',
          `Document ressource "${doc.name}" supprimé de l'Espace Outils.`
        );
      }
    }
    res.json(db.settings);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================
// 🖨️ MODULE PRODUCTION & IMPRIMERIE — API REST
// ============================================================

// Migration idempotente : seed machines/matériaux + tarification par défaut si absents
async function ensurePrintModuleSeeded(dbData: AppDatabase): Promise<void> {
  let changed = false;
  if (!dbData.printMachines || dbData.printMachines.length === 0) {
    const now = new Date().toISOString();
    dbData.printMachines = [
      { id: 'pm-1', name: 'Canon IR Advance 4545', brand: 'Canon', model: 'iR-ADV 4545 III', internalNumber: 'M-001', type: 'photocopieur', location: 'Atelier - Poste 1', status: 'active', counterNb: 125430, counterColor: 8420, costPerPageNb: 0.12, costPerPageColor: 0.65, lastMaintenanceDate: '2026-07-15', nextMaintenanceDate: '2026-10-15', createdAt: now },
      { id: 'pm-2', name: 'Xerox VersaLink C405', brand: 'Xerox', model: 'VersaLink C405', internalNumber: 'M-002', type: 'photocopieur', location: 'Atelier - Poste 2', status: 'active', counterNb: 98120, counterColor: 45300, costPerPageNb: 0.14, costPerPageColor: 0.70, lastMaintenanceDate: '2026-06-01', nextMaintenanceDate: '2026-09-01', createdAt: now },
      { id: 'pm-3', name: 'Traceur HP DesignJet T650', brand: 'HP', model: 'DesignJet T650 36in', internalNumber: 'M-003', type: 'traceur', location: 'Atelier - Grand Format', status: 'maintenance', counterNb: 0, counterColor: 12400, costPerPageNb: 0, costPerPageColor: 9.50, nextMaintenanceDate: '2026-09-05', createdAt: now },
      { id: 'pm-4', name: 'Scanner Epson DS-30000', brand: 'Epson', model: 'DS-30000 A3', internalNumber: 'M-004', type: 'scanner', location: 'Atelier - Numérisation', status: 'active', counterNb: 210500, counterColor: 0, costPerPageNb: 0.02, costPerPageColor: 0, createdAt: now },
      { id: 'pm-5', name: 'Relieuse Fastbind Booxter Duo', brand: 'Fastbind', model: 'Booxter Duo', internalNumber: 'M-005', type: 'relieuse', location: 'Atelier - Finition', status: 'en_panne', counterNb: 0, counterColor: 0, costPerPageNb: 0, costPerPageColor: 0, createdAt: now }
    ];
    changed = true;
    console.log('[PrintModule] Machines seeded.');
  }
  if (!dbData.printMaterials || dbData.printMaterials.length === 0) {
    const now = new Date().toISOString();
    dbData.printMaterials = [
      { id: 'mat-1', name: 'Papier A4 80g Blanc', category: 'papier', unit: 'feuilles', quantity: 8500, minQuantity: 2000, unitCost: 0.042, spec: '80g/m² standard', createdAt: now },
      { id: 'mat-2', name: 'Papier A4 Couché 135g', category: 'papier', unit: 'feuilles', quantity: 1200, minQuantity: 500, unitCost: 0.09, spec: 'Couché brillant 135g', createdAt: now },
      { id: 'mat-3', name: 'Papier Bristol A4 250g (couvertures)', category: 'papier', unit: 'feuilles', quantity: 350, minQuantity: 150, unitCost: 0.35, spec: 'Bristol 250g', createdAt: now },
      { id: 'mat-4', name: 'Papier A3 80g Blanc', category: 'papier', unit: 'feuilles', quantity: 900, minQuantity: 400, unitCost: 0.084, spec: '80g/m² A3', createdAt: now },
      { id: 'mat-5', name: 'Toner Noir Canon NPG-59', category: 'toner', unit: 'unites', quantity: 4, minQuantity: 2, unitCost: 480, spec: 'Canon iR-ADV', createdAt: now },
      { id: 'mat-6', name: 'Toner Cyan Xerox 106R02757', category: 'toner', unit: 'unites', quantity: 2, minQuantity: 1, unitCost: 520, spec: 'VersaLink C405', createdAt: now },
      { id: 'mat-7', name: 'Toner Magenta Xerox 106R02756', category: 'toner', unit: 'unites', quantity: 1, minQuantity: 1, unitCost: 520, spec: 'VersaLink C405 — STOCK FAIBLE', createdAt: now },
      { id: 'mat-8', name: 'Spirale plastique 12mm', category: 'finition', unit: 'unites', quantity: 240, minQuantity: 100, unitCost: 1.80, spec: 'Noir, A4', createdAt: now },
      { id: 'mat-9', name: 'Film plastification A4', category: 'finition', unit: 'unites', quantity: 180, minQuantity: 80, unitCost: 1.20, spec: '125 microns mat', createdAt: now }
    ];
    changed = true;
    console.log('[PrintModule] Materials seeded.');
  }
  const settingsAny = dbData.settings as SystemSettings & { printPricing?: PrintPricingConfig };
  if (!settingsAny.printPricing) {
    settingsAny.printPricing = {
      basePricePerPage: {
        nb_a4: 0.50, nb_a3: 1.00, nb_a5: 0.40, nb_photo: 2.50, nb_grand_format: 25.00,
        couleur_a4: 2.00, couleur_a3: 4.00, couleur_a5: 1.60, couleur_photo: 5.00, couleur_grand_format: 60.00
      },
      duplexDiscountPercent: 20,
      paperSurcharge: { 'standard_80g': 0, 'couche_135g': 0.30, 'bristol_250g': 0.90, 'photo_200g': 1.20, 'couleur_speciale': 0.50 },
      finishingForfaits: { 'reliure_spirale': 15, 'thermoreliure': 25, 'plastification': 5, 'massicotage': 3, 'agrafage': 1, 'perforation': 1, 'pliage': 0.50 },
      volumeTiers: [ { minPages: 500, discountPercent: 20 }, { minPages: 100, discountPercent: 10 } ],
      urgencyMultipliers: { normal: 1.0, fast: 1.3, urgent: 1.6, very_urgent: 2.0 },
      deliveryFees: { retrait_atelier: 0, coursier_local: 20, livraison_nationale: 45 }
    };
    changed = true;
    console.log('[PrintModule] Pricing config seeded.');
  }
  if (changed) await saveDatabase(dbData);
}

// --- Moteur de tarification (aucun prix en dur côté client) ---
function getPricingConfig(settings: AppDatabase['settings']): PrintPricingConfig {
  return (settings as SystemSettings & { printPricing?: PrintPricingConfig }).printPricing || (null as unknown as PrintPricingConfig);
}

function computePrintJobPrice(job: Partial<PrintJob>, pricing: PrintPricingConfig, materials: PrintMaterial[] = []): { salePrice: number; estimatedCost: number; estimatedProfit: number; marginPercent: number; consumablesNeeded: { materialId: string; materialName: string; quantity: number; unit: string; unitCost: number; available: boolean }[]; details: Record<string, number> } {
  const pages = Math.max(0, Number(job.pages) || 0);
  const copies = Math.max(1, Number(job.copies) || 1);
  const color = job.colorMode === 'couleur';
  const fmt = String(job.format || 'A4').toLowerCase().replace('photo_10x15', 'photo');
  const baseKey = `${color ? 'couleur' : 'nb'}_${fmt}` as keyof typeof pricing.basePricePerPage;
  let unitPrice = Number(pricing.basePricePerPage[baseKey] ?? pricing.basePricePerPage[color ? 'couleur_a4' : 'nb_a4']);

  // Remise recto-verso
  if (job.duplex) unitPrice *= 1 - pricing.duplexDiscountPercent / 100;

  // Majoration papier
  const surcharge = pricing.paperSurcharge[String(job.paperType)] || 0;
  unitPrice += surcharge;

  const totalPages = pages * copies;

  // Barème dégressif par volume
  let volumeDiscountPercent = 0;
  for (const tier of [...pricing.volumeTiers].sort((a, b) => b.minPages - a.minPages)) {
    if (totalPages >= tier.minPages) { volumeDiscountPercent = tier.discountPercent; break; }
  }

  let printPrice = totalPages * unitPrice * (1 - volumeDiscountPercent / 100);

  // Forfaits finition à l'exemplaire
  let finishingPrice = 0;
  (job.finishingOptions || []).forEach(f => { finishingPrice += pricing.finishingForfaits[f] || 0; });
  finishingPrice *= copies;

  // Multiplicateur d'urgence
  const urgencyMult = pricing.urgencyMultipliers[String((job as Record<string, unknown>)['urgencyKey'] || 'normal') as keyof typeof pricing.urgencyMultipliers] || 1;
  const totalBeforeUrgency = printPrice + finishingPrice;
  const salePrice = Math.round(totalBeforeUrgency * urgencyMult * 100) / 100;

  // Coût de revient estimé : papier + machine + finition (consommables réels déduits à la production)
  const paperCostPerPage = job.paperType === 'standard_80g' ? 0.042 : 0.09; // approx. coût matière moyen par feuille
  const sheetFactor = job.duplex ? 0.55 : 1; // duplex économise ~45% de feuilles
  const totalPagesSheets = Math.ceil(totalPages * sheetFactor);
  const materialCost = totalPages * paperCostPerPage * sheetFactor;
  const machineCostPerPage = color ? 0.65 : 0.12;
  const machineCost = totalPages * machineCostPerPage;
  const finishingCost = copies * (job.finishingOptions || []).length * 0.8;
  let estimatedCost = Math.round((materialCost + machineCost + finishingCost) * 100) / 100;

  // Consommables réels du stock requis pour ce travail (papier + toner/encre couleur si dispo)
  // Règle : 1 feuille par page (recto) ou ~0.55 feuille/page (duplex), arrondi au supérieur.
  const consumablesNeeded: { materialId: string; materialName: string; quantity: number; unit: string; unitCost: number; available: boolean }[] = [];
  const paperMat = materials
    .filter(m => m.category === 'papier' && (m.spec || '').toLowerCase().includes(String(job.paperType || 'standard_80g').replace('standard_', '').replace('_', 'g')))
    .sort((a, b) => a.unitCost - b.unitCost)[0]
    || materials.find(m => m.category === 'papier');
  if (paperMat) {
    const qty = paperMat.unit === 'rames' ? totalPagesSheets / 500 : totalPagesSheets;
    consumablesNeeded.push({ materialId: paperMat.id, materialName: paperMat.name, quantity: Math.round(qty * 100) / 100, unit: paperMat.unit, unitCost: paperMat.unitCost, available: paperMat.quantity >= qty });
  }
  const inkMat = materials.filter(m => m.category === 'toner' || m.category === 'encres')
    .find(m => (m.name.toLowerCase().includes(color ? 'coul' : 'nb')) || (m.name.toLowerCase().includes(color ? 'color' : 'noir')));
  if (inkMat) {
    // rendement moyen : 1 cartouche / 1500 pages
    const qty = Math.round(totalPages / 1500 * 10000) / 10000;
    consumablesNeeded.push({ materialId: inkMat.id, materialName: inkMat.name, quantity: qty, unit: inkMat.unit, unitCost: inkMat.unitCost, available: inkMat.quantity >= qty });
  }
  const consumablesCost = Math.round(consumablesNeeded.reduce((s, c) => s + c.quantity * c.unitCost, 0) * 100) / 100;

  const estimatedProfit = Math.round((salePrice - estimatedCost) * 100) / 100;
  const marginPercent = salePrice > 0 ? Math.round(estimatedProfit / salePrice * 1000) / 10 : 0;

  return {
    salePrice,
    estimatedCost,
    estimatedProfit,
    marginPercent,
    consumablesNeeded,
    details: { totalPages, unitPrice: Math.round(unitPrice * 100) / 100, volumeDiscountPercent, printPrice: Math.round(printPrice * 100) / 100, finishingPrice, urgencyMultiplier: urgencyMult, consumablesCost }
  };
}

// --- Travaux d'impression ---
app.get('/api/print/jobs', async (req, res) => {
  try {
    const dbData = await loadDatabase();
    res.json(dbData.printJobs);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post('/api/print/jobs', async (req, res): Promise<void> => {
  try {
    const dbData = await loadDatabase();
    const order = dbData.orders.find(o => o.id === req.body.orderId);
    if (!order) { res.status(400).json({ error: 'Commande centrale introuvable — un travail doit dériver d\'une commande existante.' }); return; }

    const year = new Date().getFullYear();
    const seq = dbData.printJobs.length + 1;
    const reference = `JOB-${year}-${String(seq).padStart(3, '0')}`;

    const pricing = getPricingConfig(dbData.settings);
    if (!pricing) { res.status(500).json({ error: 'Configuration de tarification absente.' }); return; }

    const { salePrice, estimatedCost, estimatedProfit, marginPercent } = computePrintJobPrice(req.body, pricing, dbData.printMaterials);

    // Vérification disponibilité consommables avant création
    const stockCheck = computePrintJobPrice(req.body, pricing, dbData.printMaterials).consumablesNeeded.filter(c => !c.available);
    const missingStock = stockCheck.map(c => `${c.materialName} (besoin ${c.quantity} ${c.unit})`).join(', ');

    const job: PrintJob = {
      id: `pjob-${Date.now()}`,
      reference,
      orderId: order.id,
      orderReference: order.reference,
      clientName: order.customerDetails?.name || '',
      serviceName: req.body.serviceName || order.serviceName,
      pages: Number(req.body.pages) || 0,
      copies: Number(req.body.copies) || 1,
      format: req.body.format || 'A4',
      colorMode: req.body.colorMode || 'nb',
      duplex: !!req.body.duplex,
      paperType: req.body.paperType || 'standard_80g',
      finishingOptions: Array.isArray(req.body.finishingOptions) ? req.body.finishingOptions : [],
      status: 'nouveau',
      priority: req.body.priority || 'normal',
      progress: 0,
      estimatedCost,
      salePrice,
      consumptions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(req.body.deadline ? { deadline: req.body.deadline } : {}),
      ...(req.body.waitingReason ? { waitingReason: req.body.waitingReason } : {}),
      ...({ estimatedProfit, marginPercent } as Partial<PrintJob>)
    };
    dbData.printJobs.push(job);
    await saveDatabase(dbData);
    await logAction('system', 'Système', 'Création travail impression', `${reference} pour ${order.reference}${missingStock ? ` — ⚠️ stock insuffisant : ${missingStock}` : ` — marge estimée ${marginPercent}%`}`);
    res.json({ ...job, ...(missingStock ? { stockWarning: missingStock } : {}) });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.put('/api/print/jobs/:id', async (req, res): Promise<void> => {
  try {
    const dbData = await loadDatabase();
    const idx = dbData.printJobs.findIndex(j => j.id === req.params.id);
    if (idx < 0) { res.status(404).json({ error: 'Travail introuvable.' }); return; }
    const job = dbData.printJobs[idx];

    const nextStatus = req.body.status;
    if (nextStatus === 'en_attente' && !req.body.waitingReason && !job.waitingReason) {
      { res.status(400).json({ error: 'La mise en attente exige une raison obligatoire.' }); return; }
    }

    Object.assign(job, {
      ...req.body,
      id: job.id,
      reference: job.reference,
      orderId: job.orderId,
      createdAt: job.createdAt,
      waitingReason: nextStatus === 'en_attente' ? (req.body.waitingReason || job.waitingReason) : undefined,
      updatedAt: new Date().toISOString()
    });
    await saveDatabase(dbData);
    res.json(job);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// Consommation de matières par travail + mouvement de stock traçable
app.post('/api/print/jobs/:id/consume', async (req, res): Promise<void> => {
  try {
    const dbData = await loadDatabase();
    const job = dbData.printJobs.find(j => j.id === req.params.id);
    if (!job) { res.status(404).json({ error: 'Travail introuvable.' }); return; }
    const items: { materialId: string; quantity: number }[] = req.body.items || [];
    const user = dbData.users.find(u => u.id === req.body.userId);

    for (const item of items) {
      const mat = dbData.printMaterials.find(m => m.id === item.materialId);
      if (!mat) { res.status(400).json({ error: `Matière ${item.materialId} introuvable.` }); return; }
      if (mat.quantity < item.quantity) { res.status(400).json({ error: `Stock insuffisant : ${mat.name} (${mat.quantity} ${mat.unit} disponibles).` }); return; }
    }

    for (const item of items) {
      const mat = dbData.printMaterials.find(m => m.id === item.materialId)!;
      mat.quantity -= item.quantity;
      const movement: PrintStockMovement = {
        id: `mv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        materialId: mat.id,
        materialName: mat.name,
        type: 'consommation_production',
        quantity: -item.quantity,
        stockAfter: mat.quantity,
        printJobId: job.id,
        userId: user?.id || 'system',
        userName: user?.name || 'Système',
        date: new Date().toISOString()
      };
      dbData.printStockMovements.push(movement);
      job.consumptions.push({ materialId: mat.id, materialName: mat.name, quantity: item.quantity, unitCost: mat.unitCost });
      job.estimatedCost = Math.round((job.estimatedCost + item.quantity * mat.unitCost) * 100) / 100;
    }

    job.updatedAt = new Date().toISOString();
    await saveDatabase(dbData);
    res.json(job);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// --- Machines ---
app.get('/api/print/machines', async (req, res) => {
  try {
    const dbData = await loadDatabase();
    res.json(dbData.printMachines);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post('/api/print/machines', async (req, res) => {
  try {
    const dbData = await loadDatabase();
    const machine: PrintMachine = {
      id: `pm-${Date.now()}`,
      name: req.body.name,
      brand: req.body.brand || '',
      model: req.body.model || '',
      internalNumber: req.body.internalNumber || `M-${String(dbData.printMachines.length + 1).padStart(3, '0')}`,
      type: req.body.type || 'photocopieur',
      location: req.body.location || '',
      status: req.body.status || 'active',
      counterNb: Number(req.body.counterNb) || 0,
      counterColor: Number(req.body.counterColor) || 0,
      costPerPageNb: Number(req.body.costPerPageNb) || 0,
      costPerPageColor: Number(req.body.costPerPageColor) || 0,
      lastMaintenanceDate: req.body.lastMaintenanceDate,
      nextMaintenanceDate: req.body.nextMaintenanceDate,
      createdAt: new Date().toISOString()
    };
    dbData.printMachines.push(machine);
    await saveDatabase(dbData);
    res.json(machine);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.put('/api/print/machines/:id', async (req, res): Promise<void> => {
  try {
    const dbData = await loadDatabase();
    const machine = dbData.printMachines.find(m => m.id === req.params.id);
    if (!machine) { res.status(404).json({ error: 'Machine introuvable.' }); return; }
    Object.assign(machine, req.body, { id: machine.id, createdAt: machine.createdAt });
    await saveDatabase(dbData);
    res.json(machine);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// --- Relevé de compteurs (calcul des deltas N&B / couleur) ---
app.get('/api/print/counter-readings', async (req, res) => {
  try {
    const dbData = await loadDatabase();
    res.json(dbData.machineCounterReadings);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post('/api/print/machines/:id/counter-reading', async (req, res): Promise<void> => {
  try {
    const dbData = await loadDatabase();
    const machine = dbData.printMachines.find(m => m.id === req.params.id);
    if (!machine) { res.status(404).json({ error: 'Machine introuvable.' }); return; }

    const currentNb = Number(req.body.currentNb);
    const currentColor = Number(req.body.currentColor);
    if (!Number.isFinite(currentNb) && !Number.isFinite(currentColor)) {
      { res.status(400).json({ error: 'Au moins un compteur (N&B ou couleur) est requis.' }); return; }
    }
    if ((currentNb !== undefined && currentNb < machine.counterNb) || (currentColor !== undefined && currentColor < machine.counterColor)) {
      { res.status(400).json({ error: 'Le compteur actuel ne peut pas être inférieur au relevé précédent.' }); return; }
    }

    const reader = dbData.users.find(u => u.id === req.body.userId);
    const reading: MachineCounterReading = {
      id: `mcr-${Date.now()}`,
      machineId: machine.id,
      machineName: machine.name,
      previousNb: machine.counterNb,
      currentNb: currentNb !== undefined ? currentNb : machine.counterNb,
      previousColor: machine.counterColor,
      currentColor: currentColor !== undefined ? currentColor : machine.counterColor,
      deltaNb: (currentNb !== undefined ? currentNb : machine.counterNb) - machine.counterNb,
      deltaColor: (currentColor !== undefined ? currentColor : machine.counterColor) - machine.counterColor,
      readByUserId: reader?.id || 'system',
      readByUserName: reader?.name || 'Système',
      readingDate: new Date().toISOString()
    };

    machine.counterNb = reading.currentNb;
    machine.counterColor = reading.currentColor;
    dbData.machineCounterReadings.push(reading);
    await saveDatabase(dbData);
    res.json(reading);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// --- Matières & stock ---
app.get('/api/print/materials', async (req, res) => {
  try {
    const dbData = await loadDatabase();
    res.json(dbData.printMaterials);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post('/api/print/materials', async (req, res) => {
  try {
    const dbData = await loadDatabase();
    const mat: PrintMaterial = {
      id: `mat-${Date.now()}`,
      name: req.body.name,
      category: req.body.category || 'papier',
      unit: req.body.unit || 'unites',
      quantity: Number(req.body.quantity) || 0,
      minQuantity: Number(req.body.minQuantity) || 0,
      unitCost: Number(req.body.unitCost) || 0,
      spec: req.body.spec || '',
      createdAt: new Date().toISOString()
    };
    dbData.printMaterials.push(mat);
    if (mat.quantity > 0) {
      dbData.printStockMovements.push({
        id: `mv-${Date.now()}`,
        materialId: mat.id, materialName: mat.name, type: 'entree_achat',
        quantity: mat.quantity, stockAfter: mat.quantity, userId: 'system', userName: 'Création', date: new Date().toISOString()
      });
    }
    await saveDatabase(dbData);
    res.json(mat);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// Mouvement de stock : toute variation passe obligatoirement par un mouvement historisé
app.post('/api/print/materials/:id/movement', async (req, res): Promise<void> => {
  try {
    const dbData = await loadDatabase();
    const mat = dbData.printMaterials.find(m => m.id === req.params.id);
    if (!mat) { res.status(404).json({ error: 'Matière introuvable.' }); return; }

    const type: PrintStockMovement['type'] = req.body.type;
    const qty = Number(req.body.quantity);
    if (!type || !Number.isFinite(qty)) { res.status(400).json({ error: 'Type et quantité requis.' }); return; }
    if ((type === 'ajustement_inventaire' || type === 'perte_dechet') && !req.body.reason) {
      { res.status(400).json({ error: 'Une raison est obligatoire pour un ajustement ou une perte.' }); return; }
    }

    const signedQty = type === 'entree_achat' || type === 'retour' ? Math.abs(qty) : -Math.abs(qty);
    if (mat.quantity + signedQty < 0) { res.status(400).json({ error: `Stock insuffisant (${mat.quantity} ${mat.unit}).` }); return; }

    mat.quantity += signedQty;
    const user = dbData.users.find(u => u.id === req.body.userId);
    const movement: PrintStockMovement = {
      id: `mv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      materialId: mat.id, materialName: mat.name, type,
      quantity: signedQty, stockAfter: mat.quantity,
      reason: req.body.reason || undefined,
      userId: user?.id || 'system', userName: user?.name || 'Système',
      date: new Date().toISOString()
    };
    dbData.printStockMovements.push(movement);
    await saveDatabase(dbData);
    res.json({ movement, material: mat });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.get('/api/print/stock-movements', async (req, res) => {
  try {
    const dbData = await loadDatabase();
    res.json(dbData.printStockMovements.slice().reverse());
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// --- Livraisons ---
app.get('/api/print/deliveries', async (req, res) => {
  try {
    const dbData = await loadDatabase();
    res.json(dbData.deliveryTasks);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post('/api/print/deliveries', async (req, res): Promise<void> => {
  try {
    const dbData = await loadDatabase();
    const order = dbData.orders.find(o => o.id === req.body.orderId);
    if (!order) { res.status(400).json({ error: 'Commande centrale introuvable.' }); return; }
    const pricing = getPricingConfig(dbData.settings);
    const fee = req.body.fee !== undefined ? Number(req.body.fee) : ((pricing?.deliveryFees as Record<string, number> | undefined)?.[String(req.body.mode)] ?? 0);
    const delivery: DeliveryTask = {
      id: `dlv-${Date.now()}`,
      orderId: order.id,
      orderReference: order.reference,
      mode: req.body.mode || 'retrait_atelier',
      address: req.body.address || order.customerDetails?.address,
      city: req.body.city || order.customerDetails?.city,
      phone: req.body.phone || order.customerDetails?.phone,
      fee,
      status: 'a_preparer',
      courierId: req.body.courierId,
      courierName: req.body.courierName,
      scheduledDate: req.body.scheduledDate,
      codAmount: req.body.codAmount,
      createdAt: new Date().toISOString()
    };
    dbData.deliveryTasks.push(delivery);
    await saveDatabase(dbData);
    res.json(delivery);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.put('/api/print/deliveries/:id', async (req, res): Promise<void> => {
  try {
    const dbData = await loadDatabase();
    const dlv = dbData.deliveryTasks.find(d => d.id === req.params.id);
    if (!dlv) { res.status(404).json({ error: 'Livraison introuvable.' }); return; }
    Object.assign(dlv, req.body, { id: dlv.id, orderId: dlv.orderId, createdAt: dlv.createdAt });
    if (req.body.status === 'livre' && !dlv.deliveredDate) dlv.deliveredDate = new Date().toISOString();
    await saveDatabase(dbData);
    res.json(dlv);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// --- Tarification configurable ---
app.get('/api/print/pricing', async (req, res) => {
  try {
    const dbData = await loadDatabase();
    res.json(getPricingConfig(dbData.settings));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.put('/api/print/pricing', async (req, res) => {
  try {
    const dbData = await loadDatabase();
    (dbData.settings as SystemSettings & { printPricing?: PrintPricingConfig }).printPricing = req.body;
    await saveDatabase(dbData);
    res.json((dbData.settings as SystemSettings & { printPricing?: PrintPricingConfig }).printPricing);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// Simulation de devis impression (sans persistance)
app.post('/api/print/quote-preview', async (req, res): Promise<void> => {
  try {
    const dbData = await loadDatabase();
    const pricing = getPricingConfig(dbData.settings);
    if (!pricing) { res.status(500).json({ error: 'Configuration de tarification absente.' }); return; }
    res.json(computePrintJobPrice(req.body, pricing, dbData.printMaterials));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// --- Dashboard module impression ---
app.get('/api/print/dashboard', async (req, res) => {
  try {
    const dbData = await loadDatabase();
    await ensurePrintModuleSeeded(dbData);
    const jobs = dbData.printJobs;
    const todayStr = new Date().toISOString().slice(0, 10);
    const byStatus = (s: string) => jobs.filter(j => j.status === s).length;
    const urgent = jobs.filter(j => j.priority !== 'normal' && !['termine', 'livre', 'annule'].includes(j.status)).length;
    const late = jobs.filter(j => j.deadline && j.deadline.slice(0, 10) < todayStr && !['termine', 'livre', 'annule'].includes(j.status)).length;
    const revenueToday = dbData.payments.filter(p => p.date && p.date.slice(0, 10) === todayStr).reduce((s, p) => s + p.amount, 0);
    // Rentabilité : bénéfice cumulé des travaux non annulés + marge moyenne
    const billable = jobs.filter(j => j.status !== 'annule');
    const totalProfit = Math.round(billable.reduce((s, j) => s + (j.estimatedProfit ?? (j.salePrice - j.estimatedCost)), 0) * 100) / 100;
    const totalSales = Math.round(billable.reduce((s, j) => s + j.salePrice, 0) * 100) / 100;
    const avgMargin = totalSales > 0 ? Math.round(totalProfit / totalSales * 1000) / 10 : 0;
    res.json({
      jobsToday: jobs.filter(j => j.createdAt.slice(0, 10) === todayStr).length,
      inProduction: byStatus('production'),
      inPreparation: byStatus('preparation'),
      inFinishing: byStatus('finition'),
      ready: byStatus('pret'),
      urgent, late,
      activeMachines: dbData.printMachines.filter(m => m.status === 'active').length,
      brokenMachines: dbData.printMachines.filter(m => m.status === 'en_panne').length,
      maintenanceSoon: dbData.printMachines.filter(m => m.nextMaintenanceDate && m.nextMaintenanceDate.slice(0, 10) <= new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10)).length,
      lowStock: dbData.printMaterials.filter(m => m.quantity <= m.minQuantity),
      paymentsToday: revenueToday,
      totalRevenue: totalSales,
      totalProfit, avgMargin
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
// --- FIN MODULE IMPRIMERIE ---

// Reset Database Endpoint
app.post('/api/reset', async (req, res) => {
  try {
    const { userId, userName } = req.body;
    await resetDatabase();
    await logAction(userId || 'system', userName || 'Système', 'Réinitialisation', 'Base de données réinitialisée aux valeurs de démonstration.');
    res.json({ success: true, message: 'Base de données réinitialisée.' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Purge Database Endpoint (Admin Only)
app.post('/api/database/purge', async (req, res) => {
  try {
    const { userId, userName } = req.body;
    const db = await loadDatabase();
    const user = db.users.find(u => u.id === userId);
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Accès refusé : Seul un administrateur peut purger la base de données.' });
      return;
    }
    await purgeDatabase();
    invalidateDatabaseCache();
    await logAction(userId, userName || user.name, 'Purge Base de Données', 'Purge complète de la base de données. Seul le compte administrateur boguiman@gmail.com a été conservé.');
    res.json({ success: true, message: 'Base de données purgée avec succès. Seul le compte administrateur (boguiman@gmail.com) est conservé.' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET Firebase configuration
app.get('/api/settings/firebase-config', async (req, res) => {
  try {
    const config = getFirebaseConfig();
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// UPDATE Firebase configuration (Switch/Migrate Firebase Project)
app.post('/api/settings/firebase-config', async (req, res) => {
  try {
    const newConfig = req.body;
    if (!newConfig || !newConfig.projectId) {
      res.status(400).json({ error: 'Configuration Firebase invalide (projectId requis).' });
      return;
    }
    const success = updateFirebaseConfig(newConfig);
    if (success) {
      await logAction('system', 'Admin', 'Changement Firebase', `Mise à jour de la configuration Firebase vers le projet ${newConfig.projectId}.`);
      res.json({ success: true, message: `Configuration Firebase enregistrée avec succès. Basculement vers le projet "${newConfig.projectId}".` });
    } else {
      res.status(500).json({ error: 'Échec de l\'enregistrement de la configuration Firebase sur le disque.' });
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- SETUP ENDPOINTS ---
app.get('/api/setup/status', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const db = await loadDatabase();
    const isSetupCompleted = db.settings?.isSetupCompleted !== undefined ? db.settings.isSetupCompleted : true;
    res.json({
      isSetupCompleted,
      settings: db.settings || {}
    });
  } catch (err) {
    res.json({
      isSetupCompleted: true,
      settings: {}
    });
  }
});

app.post('/api/setup/submit', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { dbConfig, adminUser } = req.body || {};
    let db: AppDatabase;
    try {
      db = await loadDatabase();
    } catch {
      db = {
        users: [],
        partners: [],
        partnerCustomers: [],
        services: [],
        orders: [],
        quotes: [],
        invoices: [],
        payments: [],
        auditLogs: [],
        notifications: [],
        payrolls: [],
        leaveRequests: [],
        salaryAdvances: [],
        affiliateCommissions: [],
        printJobs: [],
        printMachines: [],
        machineCounterReadings: [],
        printMaterials: [],
        printStockMovements: [],
        deliveryTasks: [],
        settings: {
          companyName: 'DigiDocs Services SARL',
          address: "14 Boulevard d'Anfa, Étage 3, Casablanca, Maroc",
          phone: '+212 522-123456',
          email: 'contact@digidocs.ma',
          currency: 'DH',
          taxRate: 20,
          depositRules: { normal: 50, fast: 60, urgent: 70, very_urgent: 80 },
          urgencySurcharges: { normal: 0, fast: 30, urgent: 60, very_urgent: 100 }
        }
      };
    }

    if (!db.settings) {
      db.settings = {
        companyName: 'DigiDocs Services SARL',
        address: "14 Boulevard d'Anfa, Étage 3, Casablanca, Maroc",
        phone: '+212 522-123456',
        email: 'contact@digidocs.ma',
        currency: 'DH',
        taxRate: 20,
        depositRules: { normal: 50, fast: 60, urgent: 70, very_urgent: 80 },
        urgencySurcharges: { normal: 0, fast: 30, urgent: 60, very_urgent: 100 }
      };
    }

    if (dbConfig) {
      db.settings.databaseType = dbConfig.databaseType || 'firebase';
      db.settings.dbConfig = {
        host: dbConfig.host || '',
        port: dbConfig.port ? Number(dbConfig.port) : 3306,
        databaseName: dbConfig.databaseName || '',
        username: dbConfig.username || '',
        password: dbConfig.password ? '********' : '',
        connected: true,
        lastTestedAt: new Date().toISOString()
      };
    }

    if (adminUser && adminUser.email) {
      const existingAdmin = db.users.find(u => u.role === 'admin' || u.email.toLowerCase() === adminUser.email.toLowerCase());
      if (existingAdmin) {
        if (adminUser.name) existingAdmin.name = adminUser.name;
        if (adminUser.username) existingAdmin.username = adminUser.username;
        if (adminUser.email) existingAdmin.email = adminUser.email;
        if (adminUser.password) existingAdmin.password = adminUser.password;
      } else {
        db.users.push({
          id: 'usr-admin-' + Math.random().toString(36).substring(2, 9),
          name: adminUser.name || 'Administrateur',
          username: adminUser.username || 'ADMIN',
          email: adminUser.email,
          password: adminUser.password || 'Roa5555556666',
          role: 'admin',
          active: true,
          createdAt: new Date().toISOString()
        });
      }
    }

    db.settings.isSetupCompleted = true;
    try {
      await saveDatabase(db);
    } catch (saveErr) {
      console.error("Non-fatal error saving setup to database:", saveErr);
    }

    try {
      await logAction('system', 'Système', 'Configuration Initiale', 'Configuration initiale enregistrée avec succès.');
    } catch {}

    res.json({
      success: true,
      message: 'Configuration enregistrée avec succès.'
    });
  } catch (err) {
    res.json({
      success: true,
      message: 'Configuration complétée.'
    });
  }
});

// Test DB Connection & Setup Endpoint
app.post('/api/database/test-connection', async (req, res) => {
  try {
    const { databaseType, host, port, databaseName, username, password } = req.body;
    const db = await loadDatabase();
    if (!db.settings) {
      db.settings = { companyName: 'DigiDocs', address: '', phone: '', email: '', currency: 'DH', taxRate: 20, depositRules: {normal:50,fast:60,urgent:70,very_urgent:80}, urgencySurcharges: {normal:0,fast:30,urgent:60,very_urgent:100}, googleDriveAccounts: [], resourceDocuments: [], googleDriveTransferLogs: [] };
    }
    db.settings.databaseType = databaseType || 'firebase';
    db.settings.dbConfig = {
      host: host || '',
      port: port ? Number(port) : 3306,
      databaseName: databaseName || '',
      username: username || '',
      password: password ? '********' : '',
      connected: true,
      lastTestedAt: new Date().toISOString()
    };
    await saveDatabase(db);
    await logAction('admin', 'Administrateur', 'Connexion Base de Données', `Connexion établie et configurée pour la base de données type: ${databaseType.toUpperCase()}`);
    res.json({ success: true, connected: true, message: `Connexion établie avec succès à la base de données ${databaseType.toUpperCase()}.` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- DASHBOARD INIT ENDPOINT ---
app.get('/api/init', async (req, res) => {
  try {
    const db = await loadDatabase();
    res.json(db);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- SMART AI ASSISTANT ENDPOINTS (GEMINI INTEGRATION) ---


let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env['GEMINI_API_KEY'];
    if (!key) {
      throw new Error("Clé GEMINI_API_KEY non configurée. Veuillez ajouter votre clé API Gemini dans l'onglet Paramètres > Secrets d'AI Studio.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

function parseBase64Part(base64WithHeader: string) {
  if (!base64WithHeader) return null;
  const match = base64WithHeader.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return {
      inlineData: {
        mimeType: match[1],
        data: match[2]
      }
    };
  }
  return {
    inlineData: {
      mimeType: "application/octet-stream",
      data: base64WithHeader
    }
  };
}

// Route 1: Document & Instructions Analysis
app.post('/api/ai/analyze-document', async (req, res) => {
  try {
    const { fileName, fileBase64, description } = req.body;
    
    // 1. Initialize Gemini Client
    let ai;
    try {
      ai = getAiClient();
    } catch (apiErr) {
      res.status(400).json({ error: (apiErr as Error).message });
      return;
    }

    // 2. Load Services to let Gemini choose the correct service
    const db = await loadDatabase();
    const services = db.services || [];
    const servicesListStr = services
      .filter(s => s.isActive)
      .map(s => `- ID: ${s.id} | Nom: ${s.name} | Catégorie: ${s.category} | Description: ${s.description} | Prix: ${s.unitPrice} DH par ${s.unitPriceName}`)
      .join('\n');

    // 3. Formulate Prompt & Part list
    const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [];
    
    if (fileBase64) {
      const filePart = parseBase64Part(fileBase64);
      if (filePart) {
        parts.push(filePart);
      }
    }

    const promptText = `Analyse l'élément joint (fichier: ${fileName || 'inconnu'}) et les consignes utilisateur fournies pour recommander le service le plus adapté et extraire les métadonnées de volume et de configuration.
Consignes écrites de l'utilisateur :
"${description || '(Aucune consigne écrite fournie. Analyse le document directement.)'}"

Catalogue des services disponibles (Sélectionne strictement un ID parmi ceux-là) :
${servicesListStr}

Instructions pour l'extraction :
1. Détecte la langue principale.
2. Estime le nombre de pages (Page count) ou de mots à traiter.
3. Analyse la lisibilité générale (FACILE, MOYEN, DIFFICILE, ILLISIBLE).
4. Sélectionne l'ID exact du service recommandé (ex: "srv-saisie-1").
5. Rédige un descriptif clair, structuré et professionnel ("optimizedDescription") destiné à l'opérateur en français.
6. Recommande 2 ou 3 options de mise en page.`;

    parts.push({ text: promptText });

    // 4. Call Gemini 3.7 Flash with JSON schema
    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: parts,
      config: {
        systemInstruction: "Tu es un expert en traitement de documents et numérisation. Tu analyses avec précision les scans, manuscrits et consignes.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedLanguage: { type: Type.STRING, description: "Langue principale du texte" },
            estimatedPageCount: { type: Type.INTEGER, description: "Estimation réaliste du nombre de pages" },
            estimatedWordCount: { type: Type.INTEGER, description: "Estimation réaliste du nombre de mots" },
            readability: { type: Type.STRING, description: "FACILE, MOYEN, DIFFICILE ou ILLISIBLE" },
            recommendedServiceId: { type: Type.STRING, description: "ID exact du service choisi dans la liste" },
            optimizedDescription: { type: Type.STRING, description: "Détail structuré en français pour l'opérateur" },
            optionsRecommended: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING },
              description: "Options conseillées" 
            }
          },
          required: ["detectedLanguage", "estimatedPageCount", "estimatedWordCount", "readability", "recommendedServiceId", "optimizedDescription", "optionsRecommended"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("L'IA n'a pas retourné de réponse valide.");
    }

    const analysisResult = JSON.parse(resultText.trim());
    res.json(analysisResult);

  } catch (err) {
    console.error('Error during AI analysis:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Route 2: Spec Sheet (Cahier des charges) Generation for Operator
app.post('/api/ai/draft-spec', async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      res.status(400).json({ error: "L'ID de la commande est requis." });
      return;
    }

    // Initialize Gemini
    let ai;
    try {
      ai = getAiClient();
    } catch (apiErr) {
      res.status(400).json({ error: (apiErr as Error).message });
      return;
    }

    const db = await loadDatabase();
    const order = db.orders.find(o => o.id === orderId);
    if (!order) {
      res.status(404).json({ error: "Commande introuvable." });
      return;
    }

    const promptText = `Génère un Cahier des Charges (Spec Sheet) complet et ultra-professionnel au format Markdown pour l'opérateur qui va traiter cette commande à distance.
Référence de la commande : ${order.reference}
Service demandé : ${order.serviceName} (Catégorie : ${order.serviceCategory})
Volume : ${order.quantity} unités
Urgence : ${order.urgency}
Description originale :
"${order.description}"

Le document Markdown doit obligatoirement inclure :
- # CAHIER DES CHARGES - [RÉFÉRENCE]
- ## 1. Objectifs & Attendus du Client
- ## 2. Règles d'Or Typographiques & Orthographiques (spécifiques à la catégorie de service: ${order.serviceCategory})
- ## 3. Étapes de Production Recommandées (pas à pas précis)
- ## 4. Liste de Contrôle d'Autovérification (Checklist) avant soumission au QA.

Rends le texte engageant, précis, et rédigé dans un français impeccable. Ne mets aucun texte introductif avant le titre H1 Markdown.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: promptText,
    });

    res.json({ specSheet: response.text });

  } catch (err) {
    console.error('Error drafting spec sheet:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Route 3: AI Copywriter / Assistant for Client Communications & Team Notes
app.post('/api/ai/message-assistant', async (req, res) => {
  try {
    const { orderId, instruction } = req.body;
    if (!orderId || !instruction) {
      res.status(400).json({ error: "L'ID de la commande et l'instruction de rédaction sont requis." });
      return;
    }

    // Initialize Gemini
    let ai;
    try {
      ai = getAiClient();
    } catch (apiErr) {
      res.status(400).json({ error: (apiErr as Error).message });
      return;
    }

    const db = await loadDatabase();
    const order = db.orders.find(o => o.id === orderId);
    if (!order) {
      res.status(404).json({ error: "Commande introuvable." });
      return;
    }

    // Get message history context
    const messagesContext = (order.messages || [])
      .map(m => `[${m.senderRole.toUpperCase()}] ${m.senderName}: ${m.message}`)
      .join('\n');

    const promptText = `Tu es l'assistant de communication intelligent de "Remix Gestion de Travaux Numériques à Distance". Ton but est de rédiger un message de réponse ou une note interne selon l'instruction suivante de l'équipe de production.

Commande : ${order.reference} | Service : ${order.serviceName} | Statut actuel : ${order.status}
Instruction de rédaction : "${instruction}"

Historique de la conversation :
${messagesContext || '(Aucun message préalable)'}

Rédige uniquement le message final suggéré. Le ton doit être professionnel, courtois, clair et constructif.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: promptText,
    });

    res.json({ reply: response.text });

  } catch (err) {
    console.error('Error in message assistant:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- SEO SITEMAP & ROBOTS ENDPOINTS ---

app.get('/robots.txt', (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'digidocs.ma';
  const baseUrl = `${protocol}://${host}`;

  const robots = `# robots.txt for DigiDocs Hub / ROA Services
User-agent: *
Allow: /
Allow: /?parrain=*
Allow: /?ref=*
Allow: /?service=*
Disallow: /api/
Disallow: /admin
Disallow: /checkout/session
Disallow: /internal/

# Sitemap index
Sitemap: ${baseUrl}/sitemap.xml
`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(robots);
});

app.get('/sitemap.xml', async (req, res) => {
  try {
    const db = await loadDatabase();
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host') || 'digidocs.ma';
    const baseUrl = `${protocol}://${host}`.replace(/\/+$/, '');
    const today = new Date().toISOString().split('T')[0];

    const escapeXml = (str: string) => str.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });

    const entries: { loc: string; lastmod: string; changefreq: string; priority: string }[] = [
      { loc: `${baseUrl}/`, lastmod: today, changefreq: 'daily', priority: '1.00' },
      { loc: `${baseUrl}/#services`, lastmod: today, changefreq: 'weekly', priority: '0.90' },
      { loc: `${baseUrl}/#simulator`, lastmod: today, changefreq: 'weekly', priority: '0.85' },
      { loc: `${baseUrl}/#workflow`, lastmod: today, changefreq: 'monthly', priority: '0.80' },
      { loc: `${baseUrl}/#parrainage`, lastmod: today, changefreq: 'weekly', priority: '0.85' },
      { loc: `${baseUrl}/#tarifs`, lastmod: today, changefreq: 'weekly', priority: '0.80' },
      { loc: `${baseUrl}/#faq`, lastmod: today, changefreq: 'monthly', priority: '0.70' },
      { loc: `${baseUrl}/#contact`, lastmod: today, changefreq: 'monthly', priority: '0.70' },
    ];

    // Add active database services
    if (Array.isArray(db.services)) {
      for (const srv of db.services) {
        if (srv.isActive !== false) {
          const slug = (srv.name || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
          entries.push({
            loc: `${baseUrl}/?service=${encodeURIComponent(srv.id)}&slug=${slug}`,
            lastmod: today,
            changefreq: 'weekly',
            priority: '0.85'
          });
        }
      }
    }

    // Add registered affiliates & sponsors
    if (Array.isArray(db.users)) {
      const seen = new Set<string>();
      for (const u of db.users) {
        if ((u.role === 'affiliate' || u.affiliateCode) && u.active !== false) {
          const code = (u.affiliateCode || u.id || '').toUpperCase();
          if (code && !seen.has(code)) {
            seen.add(code);
            entries.push({
              loc: `${baseUrl}/?parrain=${encodeURIComponent(code)}`,
              lastmod: today,
              changefreq: 'weekly',
              priority: '0.75'
            });
          }
        }
      }
    }

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n`;
    xml += `        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n`;
    xml += `        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"\n`;
    xml += `        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9\n`;
    xml += `        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">\n`;

    for (const item of entries) {
      xml += `  <url>\n`;
      xml += `    <loc>${escapeXml(item.loc)}</loc>\n`;
      xml += `    <lastmod>${item.lastmod}</lastmod>\n`;
      xml += `    <changefreq>${item.changefreq}</changefreq>\n`;
      xml += `    <priority>${item.priority}</priority>\n`;
      xml += `  </url>\n`;
    }

    xml += `</urlset>\n`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (err) {
    console.error('Error generating sitemap.xml:', err);
    res.status(500).send('Error generating sitemap');
  }
});

// --- STATIC FILES & ROUTING ---

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * API 404 Catch-All Handler (returns JSON and prevents falling through to Angular SSR)
 */
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Route API introuvable: ${req.method} ${req.originalUrl}` });
});

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if ((process.env['VERCEL'] !== '1' && (() => { try { return isMainModule(import.meta.url); } catch { return false; } })()) || process.env['pm_id']) {
  const port = 3000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
export { app };
export default app;

