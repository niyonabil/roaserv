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
} from './server-db';

const possiblePaths = [
  join(import.meta.dirname, '../browser'),       // Default SSR structure (when outputPath is dist/app)
  join(import.meta.dirname, '../'),              // outputPath has base="dist", browser=""
  join(import.meta.dirname, '../../dist'),       // running node src/server.ts directly from workspace root
  join(import.meta.dirname, '../dist')           // backup check
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

    if (!affId && affCode) {
      const codeSearch = (affCode as string).trim().toUpperCase();
      const affUser = db.users.find(u => u.affiliateCode && u.affiliateCode.toUpperCase() === codeSearch);
      if (affUser) {
        affId = affUser.id;
        affCode = affUser.affiliateCode;
        affName = affUser.name;
        commRate = affUser.commissionRate || 10;
      }
    }

    if (!affId && orderData.customerDetails && orderData.customerDetails.email) {
      const clientEmail = orderData.customerDetails.email.toLowerCase().trim();
      const clientUser = db.users.find(u => u.email.toLowerCase() === clientEmail);
      if (clientUser && clientUser.referredByAffiliateId) {
        const affUser = db.users.find(u => u.id === clientUser.referredByAffiliateId);
        if (affUser) {
          affId = affUser.id;
          affCode = affUser.affiliateCode;
          affName = affUser.name;
          commRate = affUser.commissionRate || 10;
        }
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
            const rate = order.commissionRate || affiliateUser.commissionRate || 10;
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
                orderTotalAmount: quote.totalAmount || paymentObj.amount,
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
              existingComm.commissionAmount = commAmount;
              existingComm.validatedAt = new Date().toISOString();
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

// List all affiliates with computed performance stats
app.get('/api/affiliates', async (req, res) => {
  try {
    const db = await loadDatabase();
    const affiliatesList = db.users.filter(u => u.role === 'affiliate' || Boolean(u.affiliateCode));

    const enriched = affiliatesList.map(aff => {
      const code = (aff.affiliateCode || '').toUpperCase();

      // Referred clients
      const clients = db.users.filter(u => u.referredByAffiliateId === aff.id || (code && u.referredByAffiliateCode && u.referredByAffiliateCode.toUpperCase() === code));

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
if (isMainModule(import.meta.url) || process.env['pm_id']) {
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

