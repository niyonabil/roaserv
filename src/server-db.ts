import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, doc, getDoc, getDocs, setDoc, collection, deleteDoc } from 'firebase/firestore';

// --- HELPER TO CLEAN UNDEFINED VALUES FOR FIRESTORE ---
export function cleanFirestoreData<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map(item => cleanFirestoreData(item)) as unknown as T;
  }
  if (typeof data === 'object' && !(data instanceof Date)) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        cleaned[key] = cleanFirestoreData(value);
      }
    }
    return cleaned as T;
  }
  return data;
}

// --- DATABASE INTERFACES ---

export interface UserPrivileges {
  canManageOrders: boolean;
  canValidateQuality: boolean;
  canDeliverOrders: boolean;
  canManageClients: boolean;
  canManageTools: boolean;
  canViewFinancials: boolean;
}

export function getDefaultPrivileges(role: 'admin' | 'partner' | 'operator' | 'qa' | 'client' | 'assistant' | string): UserPrivileges {
  switch (role) {
    case 'admin':
      return {
        canManageOrders: true,
        canValidateQuality: true,
        canDeliverOrders: true,
        canManageClients: true,
        canManageTools: true,
        canViewFinancials: true,
      };
    case 'assistant':
      return {
        canManageOrders: true,
        canValidateQuality: true,
        canDeliverOrders: true,
        canManageClients: true,
        canManageTools: true,
        canViewFinancials: true,
      };
    case 'qa':
      return {
        canManageOrders: true,
        canValidateQuality: true,
        canDeliverOrders: true,
        canManageClients: false,
        canManageTools: true,
        canViewFinancials: false,
      };
    case 'operator':
      return {
        canManageOrders: true,
        canValidateQuality: false,
        canDeliverOrders: false,
        canManageClients: false,
        canManageTools: true,
        canViewFinancials: false,
      };
    case 'partner':
      return {
        canManageOrders: true,
        canValidateQuality: false,
        canDeliverOrders: false,
        canManageClients: true,
        canManageTools: true,
        canViewFinancials: true,
      };
    default:
      return {
        canManageOrders: false,
        canValidateQuality: false,
        canDeliverOrders: false,
        canManageClients: false,
        canManageTools: false,
        canViewFinancials: false,
      };
  }
}

export interface User {
  id: string;
  name: string;
  username?: string;
  email: string;
  password?: string;
  role: 'admin' | 'partner' | 'operator' | 'qa' | 'client' | 'assistant' | 'affiliate';
  privileges?: UserPrivileges;
  company?: string;
  ice?: string;
  phone?: string;
  address?: string;
  city?: string;
  active: boolean;
  geminiApiKey?: string;
  createdByUserId?: string;
  createdByRole?: 'client' | 'partner' | 'admin';
  createdAt?: string;
  // --- Affiliate Fields ---
  affiliateCode?: string;
  affiliateLink?: string;
  commissionRate?: number; // e.g. 10 (%)
  affiliateStatus?: 'active' | 'inactive';
  referredByAffiliateCode?: string;
  referredByAffiliateId?: string;
  // --- Employee & HR Fields ---
  employeeCode?: string; // Matricule (ex: EMP-001)
  jobTitle?: string; // Poste (ex: Opérateur de saisie principal, Responsable Contrôle Qualité, Assistante Administrative)
  department?: 'production' | 'qualite' | 'administration' | 'support' | 'commercial' | 'direction';
  contractType?: 'cdi' | 'cdd' | 'freelance' | 'stage' | 'interim';
  hireDate?: string;
  birthDate?: string;
  cinNumber?: string; // Carte d'Identité Nationale (ex: BK123456)
  cnssNumber?: string; // Numéro d'immatriculation CNSS
  ribNumber?: string; // RIB bancaire 24 chiffres
  bankName?: string; // Nom de la banque
  baseSalary?: number; // Salaire de base mensuel en DH
  hourlyRate?: number; // Taux horaire (si applicable)
  pieceRate?: number; // Tarif par page traitée
  vacationBalance?: number; // Solde de congés restants (en jours)
  emergencyContact?: { name: string; relation: string; phone: string };
  notes?: string;
  status?: 'active' | 'inactive' | 'on_leave' | 'suspended';
  // --- Client profile fields ---
  customerType?: 'particular' | 'company' | 'partner';
  clientNotes?: string;
}

export interface PayrollRecord {
  id: string;
  reference: string; // e.g. PAY-2026-08-001
  employeeId: string;
  employeeName: string;
  employeeCode?: string;
  jobTitle?: string;
  department?: string;
  periodMonth: string; // "2026-08"
  periodLabel: string; // "Août 2026"
  contractType?: string;
  workedDays: number;
  absentDays: number;
  overtimeHours: number;
  overtimeAmount: number;
  hourlyRate?: number;
  baseSalary: number;
  productionBonus: number;
  attendanceBonus: number;
  seniorityBonus: number;
  customBonus: number;
  grossSalary: number;
  cnssDeduction: number;
  amoDeduction: number;
  advanceDeduction: number;
  absenceDeduction: number;
  otherDeduction: number;
  totalDeductions: number;
  netSalary: number;
  netSalaryInWords?: string;
  paymentMethod: 'transfer' | 'cash' | 'cheque';
  paymentReference?: string;
  status: 'draft' | 'validated' | 'paid';
  paidAt?: string;
  notes?: string;
  generatedBy?: string;
  createdAt: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  type: 'paid_leave' | 'sick_leave' | 'unpaid_leave' | 'exceptional' | 'maternity_paternity';
  startDate: string;
  endDate: string;
  daysCount: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  createdAt: string;
}

export interface SalaryAdvance {
  id: string;
  employeeId: string;
  employeeName: string;
  amount: number;
  requestDate: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'deducted';
  repaymentMonth: string; // e.g. "2026-08"
  approvedBy?: string;
  approvedAt?: string;
}

export interface AffiliateCommission {
  id: string;
  reference?: string;
  affiliateId: string;
  affiliateName: string;
  affiliateCode: string;
  clientId: string;
  clientName: string;
  orderId: string;
  orderReference: string;
  serviceName: string;
  paymentId?: string;
  paymentReference?: string;
  orderTotalAmount: number;
  paidAmount: number;
  paymentAmount?: number;
  commissionRate: number; // percentage e.g. 10
  commissionAmount: number; // calculated e.g. 10
  status: 'pending' | 'validated' | 'requested' | 'paid' | 'cancelled';
  createdAt: string;
  validatedAt?: string;
  requestedAt?: string;
  paidAt?: string;
  debitNoteReference?: string;
  bankName?: string;
  ribNumber?: string;
  notes?: string;
}

export interface PartnerCustomer {
  id: string;
  partnerId: string;
  name: string;
  email: string;
  phone: string;
  company?: string;
  city: string;
  address?: string;
  notes?: string;
  createdAt: string;
}

export interface ServiceOption {
  id: string;
  name: string;
  price: number;
}

export type ServiceCoverageScope = 'international' | 'national' | 'regional' | 'city' | 'street';

export interface Service {
  id: string;
  name: string;
  category: 'saisie' | 'conversion' | 'mise_en_forme' | 'traitement' | 'impression' | 'livraison';
  description: string;
  priceMethod: 'fixed' | 'per_page' | 'per_word' | 'per_hour' | 'hybrid';
  basePrice: number;
  unitPriceName: string; // e.g., 'Page', 'Mot', 'Heure'
  unitPrice: number;
  isActive: boolean;
  options: ServiceOption[];
  imageUrl?: string;
  // Geographic Availability & Location
  coverageScope?: ServiceCoverageScope; // 'international' | 'national' | 'regional' | 'city' | 'street'
  countries?: string[]; // e.g. ['Maroc', 'France', 'Belgique', 'Canada']
  regions?: string[]; // e.g. ['Casablanca-Settat', 'Rabat-Salé-Kénitra']
  cities?: string[]; // e.g. ['Casablanca', 'Rabat', 'Marrakech', 'Tanger']
  street?: string; // e.g. "14 Boulevard d'Anfa, Maarif"
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  coverageNotes?: string;
}

export interface OrderFile {
  id: string;
  name: string;
  type: string;
  size: number;
  folder: '01_DOCUMENTS_ORIGINAUX' | '02_DOCUMENTS_SUPPLEMENTAIRES' | '03_TRAVAIL_EN_COURS' | '04_PREVISUALISATION' | '05_VERSION_FINALE' | '06_FACTURES' | '07_PREUVES' | '08_LIVRAISON';
  version: number;
  uploadedBy: string;
  uploadedAt: string;
  base64Data?: string; // Stored locally for simulation
}

export interface OrderMessage {
  id: string;
  senderName: string;
  senderRole: string;
  message: string;
  timestamp: string;
  isInternal: boolean; // separate client chat from internal team notes
  fileName?: string;
  fileBase64?: string;
}

export interface OrderTask {
  id: string;
  operatorId: string;
  operatorName: string;
  qaId?: string;
  qaName?: string;
  deadline: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | 'CRITICAL';
  completed: boolean;
  notes?: string;
}

export interface QuoteItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Quote {
  id: string;
  reference: string;
  orderId: string;
  basePrice: number;
  optionsPrice: number;
  urgencySurcharge: number;
  printingPrice: number;
  deliveryPrice: number;
  totalAmount: number;
  depositPercent: number;
  depositAmount: number;
  balanceAmount: number;
  status: 'draft' | 'sent' | 'accepted' | 'refused';
  validityDate: string;
  items: QuoteItem[];
}

export interface OrderRevision {
  id: string;
  revisionNumber: number;
  requestedBy: string;
  requestedByRole: string;
  notes: string;
  attachmentName?: string;
  attachmentBase64?: string;
  status: 'pending' | 'in_progress' | 'delivered' | 'accepted' | 'rejected';
  createdAt: string;
  resolvedAt?: string;
  deliveredFileName?: string;
  deliveredFileBase64?: string;
  adminResponseNotes?: string;
}

export interface ClientSatisfaction {
  isSatisfied: boolean;
  rating?: number; // 1 to 5
  feedback?: string;
  validatedAt?: string;
}

export interface Invoice {
  id: string;
  reference: string;
  orderId: string;
  quoteId: string;
  amount: number;
  type: 'deposit' | 'balance' | 'full';
  status: 'unpaid' | 'paid';
  date: string;
}

export interface Payment {
  id: string;
  reference: string;
  orderId: string;
  orderReference?: string;
  amount: number;
  type?: 'deposit' | 'balance' | 'full';
  method?: 'cash' | 'transfer' | 'cheque' | 'bill_of_exchange' | 'cod' | 'online' | 'manual';
  paymentMethod?: string;
  status: 'pending' | 'verified' | 'rejected';
  referenceNumber?: string; // Check number, transfer ref, LCN number
  dueDate?: string; // Due date for check or bill of exchange
  proofFileName?: string;
  proofFileBase64?: string;
  proofUrl?: string;
  date?: string;
  paymentDate?: string;
  verifiedAt?: string;
  notes?: string;
}

export interface DeliveryDetails {
  method: 'digital' | 'email' | 'physical_partner' | 'physical_shipper';
  name?: string;
  phone?: string;
  address?: string;
  city?: string;
  district?: string;
  trackingNumber?: string;
  status: 'preparation' | 'shipped' | 'delivering' | 'delivered';
}

export interface QualityChecklist {
  allPagesProcessed: boolean;
  noMissingDocs: boolean;
  spellingVerified: boolean;
  layoutVerified: boolean;
  numberingVerified: boolean;
  filesOpenCorrectly: boolean;
  formatRespected: boolean;
  fileNamesCorrect: boolean;
  finalVersionValidated: boolean;
  validatedBy?: string;
  validatedAt?: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: string;
  details: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  orderId?: string;
  orderReference?: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface SystemSettings {
  companyName: string;
  logoUrl?: string;
  address: string;
  phone: string;
  email: string;
  currency: string; // default DH
  taxRate: number; // default 0
  globalGeminiApiKey?: string;
  globalGeminiApiKeyEnabled?: boolean;
  depositRules: {
    normal: number; // e.g. 50
    fast: number; // e.g. 60
    urgent: number; // e.g. 70
    very_urgent: number; // e.g. 80
  };
  urgencySurcharges: {
    normal: number; // 0%
    fast: number; // 30%
    urgent: number; // 60%
    very_urgent: number; // 100%
  };
  saasWorkspaceTitle?: string;
  databaseType?: 'firebase' | 'supabase' | 'mysql' | 'mariadb';
  isSetupCompleted?: boolean;
  dbConfig?: {
    host?: string;
    port?: number;
    databaseName?: string;
    username?: string;
    password?: string;
    connected?: boolean;
    lastTestedAt?: string;
  };
  googleDriveAccounts?: {
    id: string;
    name: string;
    email: string;
    folderId?: string;
    completedFolderId?: string;
    status: 'connected' | 'disconnected';
    createdAt: string;
  }[];
  resourceDocuments?: {
    id: string;
    name: string;
    category: 'legal' | 'template' | 'example' | 'other';
    classification: string;
    uploadedBy: string;
    uploadedAt: string;
    size: number;
    type: string;
    base64Data: string;
    externalUrl?: string;
  }[];
  googleDriveTransferLogs?: {
    id: string;
    timestamp: string;
    accountName: string;
    fileName: string;
    type: 'client_upload' | 'completed_work' | 'resource_doc';
    status: 'success' | 'failed';
    details: string;
  }[];
}

export interface Order {
  id: string;
  reference: string;
  customerType: 'particular' | 'company' | 'partner';
  customerDetails: {
    name: string;
    email: string;
    phone: string;
    company?: string;
    city: string;
    address?: string;
    remarks?: string;
  };
  partnerId?: string; // if created by partner
  serviceId: string;
  serviceName: string;
  serviceCategory: string;
  description: string;
  quantity: number; // pages, hours, etc.
  urgency: 'normal' | 'fast' | 'urgent' | 'very_urgent';
  status:
    | 'BROUILLON'
    | 'DEMANDE_ENVOYEE'
    | 'EN_ATTENTE_ANALYSE'
    | 'DEVIS_EN_PREPARATION'
    | 'DEVIS_ENVOYE'
    | 'EN_ATTENTE_ACCEPTATION'
    | 'ACCEPTE'
    | 'EN_ATTENTE_ACOMPTE'
    | 'ACOMPTE_PAYE'
    | 'DOCUMENTS_RECLUS'
    | 'EN_FILE_ATTENTE'
    | 'EN_TRAITEMENT'
    | 'CONTROLE_QUALITE'
    | 'TRAVAIL_TERMINE'
    | 'EN_ATTENTE_SOLDE'
    | 'SOLDE_PAYE'
    | 'PRET_A_LIVRER'
    | 'LIVRE'
    | 'TERMINE'
    | 'ANNULE'
    | 'REFUSE'
    | 'BLOQUE'
    | 'EN_ATTENTE_INFOS'
    | 'EN_ATTENTE_DOCUMENT';
  files: OrderFile[];
  messages: OrderMessage[];
  tasks: OrderTask[];
  quoteId?: string;
  delivery?: DeliveryDetails;
  qualityChecklist?: QualityChecklist;
  paymentMethod?: 'cash' | 'transfer' | 'cheque' | 'bill_of_exchange' | 'cod' | 'online';
  paymentTerms?: 'immediate' | 'cod' | 'net_7' | 'net_15' | 'net_30' | 'net_60' | 'net_90' | 'custom';
  customDueDate?: string;
  revisions?: OrderRevision[];
  clientSatisfaction?: ClientSatisfaction;
  // --- Affiliate Fields ---
  affiliateId?: string;
  affiliateCode?: string;
  affiliateName?: string;
  commissionRate?: number;
  createdAt: string;
  updatedAt: string;
  deadline?: string;
}

export interface AppDatabase {
  users: User[];
  partners: User[];
  partnerCustomers: PartnerCustomer[];
  services: Service[];
  orders: Order[];
  quotes: Quote[];
  invoices: Invoice[];
  payments: Payment[];
  auditLogs: AuditLog[];
  notifications: AppNotification[];
  payrolls: PayrollRecord[];
  leaveRequests: LeaveRequest[];
  salaryAdvances: SalaryAdvance[];
  affiliateCommissions: AffiliateCommission[];
  settings: SystemSettings;
}

// --- FIREBASE INITIALIZATION ---

let firebaseConfig: Record<string, string>;

try {
  const configPath = join(process.cwd(), 'firebase-applet-config.json');
  if (existsSync(configPath)) {
    firebaseConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  } else if (process.env['FIREBASE_CONFIG']) {
    firebaseConfig = JSON.parse(process.env['FIREBASE_CONFIG']!);
  } else {
    firebaseConfig = {
      projectId: "reflecting-pattern-d79b0",
      appId: "1:893983542054:web:324dcf1b928b8dfe3f0fe7",
      apiKey: "AIzaSyDouXst_SDb_C6dy9oHGp14osC9knBMjAo",
      authDomain: "reflecting-pattern-d79b0.firebaseapp.com",
      firestoreDatabaseId: "ai-studio-remixgestiondetr-a8f577d6-5c9e-4145-aab5-07d8f9ac7af4",
      storageBucket: "reflecting-pattern-d79b0.firebasestorage.app",
      messagingSenderId: "893983542054",
      measurementId: "",
      oAuthClientId: "893983542054-mpcrs32ohq38rfi85dt7iotlcrisi186.apps.googleusercontent.com",
      recaptchaSiteKey: ""
    };
  }
} catch {
  firebaseConfig = {
    projectId: "reflecting-pattern-d79b0",
    appId: "1:893983542054:web:324dcf1b928b8dfe3f0fe7",
    apiKey: "AIzaSyDouXst_SDb_C6dy9oHGp14osC9knBMjAo",
    authDomain: "reflecting-pattern-d79b0.firebaseapp.com",
    firestoreDatabaseId: "ai-studio-remixgestiondetr-a8f577d6-5c9e-4145-aab5-07d8f9ac7af4",
    storageBucket: "reflecting-pattern-d79b0.firebasestorage.app",
    messagingSenderId: "893983542054",
    measurementId: "",
    oAuthClientId: "893983542054-mpcrs32ohq38rfi85dt7iotlcrisi186.apps.googleusercontent.com",
    recaptchaSiteKey: ""
  };
}

const firebaseApp = initializeApp(firebaseConfig);
export const db = initializeFirestore(firebaseApp, {
  experimentalForceLongPolling: true
}, firebaseConfig['firestoreDatabaseId'] || 'ai-studio-remixgestiondetr-a8f577d6-5c9e-4145-aab5-07d8f9ac7af4');
export const auth = getAuth(firebaseApp);

async function ensureAuthenticated() {
  // Server runs in a secure backend environment; no client-side anonymous auth is required.
  return Promise.resolve();
}

// --- ERROR HANDLING ---

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
} as const;

export type OperationType = typeof OperationType[keyof typeof OperationType];

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- DB STORAGE LOGIC VIA FIRESTORE ---

// --- DB CACHING VARIABLES ---
let cachedDatabaseState: AppDatabase | null = null;
let cacheTimestamp = 0;
let activeLoadPromise: Promise<AppDatabase> | null = null;
const CACHE_TTL_MS = 4000; // 4 seconds cache TTL

export function invalidateDatabaseCache(): void {
  cachedDatabaseState = null;
  cacheTimestamp = 0;
  activeLoadPromise = null;
}

export function getFirebaseConfig(): Record<string, string> {
  return firebaseConfig || {};
}

export function updateFirebaseConfig(newConfig: Record<string, string>): boolean {
  try {
    const configPath = join(process.cwd(), 'firebase-applet-config.json');
    writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');
    firebaseConfig = { ...firebaseConfig, ...newConfig };
    console.log("Firebase config updated on disk successfully.");
    invalidateDatabaseCache();
    return true;
  } catch (err) {
    console.error("Error updating Firebase config on disk:", err);
    return false;
  }
}

export function loadDatabase(): Promise<AppDatabase> {
  const now = Date.now();
  
  if (cachedDatabaseState && (now - cacheTimestamp < CACHE_TTL_MS)) {
    return Promise.resolve(cachedDatabaseState);
  }
  
  if (activeLoadPromise) {
    return activeLoadPromise;
  }
  
  activeLoadPromise = (async () => {
    await ensureAuthenticated();
    try {
      const [
      usersSnap,
      partnerCustomersSnap,
      servicesSnap,
      ordersSnap,
      quotesSnap,
      invoicesSnap,
      paymentsSnap,
      auditLogsSnap,
      notificationsSnap,
      payrollsSnap,
      leaveRequestsSnap,
      salaryAdvancesSnap,
      affiliateCommissionsSnap,
      settingsSnap
    ] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'partnerCustomers')),
      getDocs(collection(db, 'services')),
      getDocs(collection(db, 'orders')),
      getDocs(collection(db, 'quotes')),
      getDocs(collection(db, 'invoices')),
      getDocs(collection(db, 'payments')),
      getDocs(collection(db, 'auditLogs')),
      getDocs(collection(db, 'notifications')),
      getDocs(collection(db, 'payrolls')),
      getDocs(collection(db, 'leaveRequests')),
      getDocs(collection(db, 'salaryAdvances')),
      getDocs(collection(db, 'affiliateCommissions')),
      getDoc(doc(db, 'settings', 'global'))
    ]);

    const users: User[] = [];
    usersSnap.forEach(d => users.push(d.data() as User));

    const partnerCustomers: PartnerCustomer[] = [];
    partnerCustomersSnap.forEach(d => partnerCustomers.push(d.data() as PartnerCustomer));

    const services: Service[] = [];
    servicesSnap.forEach(d => services.push(d.data() as Service));

    const orders: Order[] = [];
    ordersSnap.forEach(d => orders.push(d.data() as Order));

    const quotes: Quote[] = [];
    quotesSnap.forEach(d => quotes.push(d.data() as Quote));

    const invoices: Invoice[] = [];
    invoicesSnap.forEach((d: any) => invoices.push(d.data() as Invoice));

    const payments: Payment[] = [];
    paymentsSnap.forEach(d => payments.push(d.data() as Payment));

    const auditLogs: AuditLog[] = [];
    auditLogsSnap.forEach(d => auditLogs.push(d.data() as AuditLog));

    const notifications: AppNotification[] = [];
    notificationsSnap.forEach(d => notifications.push(d.data() as AppNotification));

    const payrolls: PayrollRecord[] = [];
    payrollsSnap.forEach(d => payrolls.push(d.data() as PayrollRecord));

    const leaveRequests: LeaveRequest[] = [];
    leaveRequestsSnap.forEach(d => leaveRequests.push(d.data() as LeaveRequest));

    const salaryAdvances: SalaryAdvance[] = [];
    salaryAdvancesSnap.forEach(d => salaryAdvances.push(d.data() as SalaryAdvance));

    const affiliateCommissions: AffiliateCommission[] = [];
    affiliateCommissionsSnap.forEach(d => affiliateCommissions.push(d.data() as AffiliateCommission));

    let settings: SystemSettings;
    if (settingsSnap.exists()) {
      settings = settingsSnap.data() as SystemSettings;
    } else {
      const seeded = getSeededDatabase();
      settings = seeded.settings;
      await setDoc(doc(db, 'settings', 'global'), cleanFirestoreData(settings));
    }

    if (users.length === 0 && services.length === 0 && orders.length === 0) {
      console.log("Database is empty, seeding Firestore database...");
      const seeded = getSeededDatabase();
      await saveDatabase(seeded);
      return seeded;
    }

    // Ensure primary administrator account is always present
    const defaultAdmins: User[] = [
      {
        id: "usr-admin-1",
        name: "Administrateur Principal (Boguiman)",
        username: "boguiman",
        email: "boguiman@gmail.com",
        password: "admin123",
        role: "admin",
        phone: "+212 661-000001",
        city: "Casablanca",
        employeeCode: "DIR-001",
        jobTitle: "Directeur Général",
        department: "direction",
        contractType: "cdi",
        hireDate: "2024-01-01",
        cinNumber: "BK100200",
        cnssNumber: "123456789",
        ribNumber: "011780000012345678901234",
        bankName: "Attijariwafa Bank",
        baseSalary: 18000,
        vacationBalance: 22,
        active: true
      }
    ];

    for (const admin of defaultAdmins) {
      const existing = users.find(u => 
        u.email.toLowerCase() === admin.email.toLowerCase() || 
        (u.username && admin.username && u.username.toLowerCase() === admin.username.toLowerCase())
      );
      if (!existing) {
        users.push(admin);
        await setDoc(doc(db, 'users', admin.id), cleanFirestoreData(admin));
      } else {
        let updated = false;
        if (!existing.password || !existing.username) {
          existing.password = existing.password || admin.password;
          existing.username = existing.username || admin.username;
          updated = true;
        }
        if (!existing.employeeCode && admin.employeeCode) {
          existing.employeeCode = admin.employeeCode;
          existing.jobTitle = admin.jobTitle;
          existing.department = admin.department;
          existing.contractType = admin.contractType;
          existing.baseSalary = admin.baseSalary;
          existing.hireDate = admin.hireDate;
          existing.cinNumber = admin.cinNumber;
          existing.cnssNumber = admin.cnssNumber;
          existing.ribNumber = admin.ribNumber;
          existing.bankName = admin.bankName;
          existing.vacationBalance = admin.vacationBalance;
          updated = true;
        }
        if (updated) {
          await setDoc(doc(db, 'users', existing.id), cleanFirestoreData(existing));
        }
      }
    }

    const resultState = {
      users,
      partners: users.filter(u => u.role === 'partner'),
      partnerCustomers,
      services,
      orders,
      quotes,
      invoices,
      payments,
      auditLogs,
      notifications,
      payrolls,
      leaveRequests,
      salaryAdvances,
      affiliateCommissions,
      settings
    };
    cachedDatabaseState = resultState;
    cacheTimestamp = Date.now();
    return resultState;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, 'database_load');
    throw err;
  } finally {
    activeLoadPromise = null;
  }
  })();
  return activeLoadPromise;
}

export async function saveDatabase(databaseState: AppDatabase): Promise<void> {
  cachedDatabaseState = databaseState;
  cacheTimestamp = Date.now();
  await ensureAuthenticated();
  try {
    const promises: Promise<void>[] = [];

    databaseState.users.forEach(u => {
      promises.push(setDoc(doc(db, 'users', u.id), cleanFirestoreData(u)));
    });
    databaseState.partnerCustomers.forEach(pc => {
      promises.push(setDoc(doc(db, 'partnerCustomers', pc.id), cleanFirestoreData(pc)));
    });
    databaseState.services.forEach(s => {
      promises.push(setDoc(doc(db, 'services', s.id), cleanFirestoreData(s)));
    });
    databaseState.orders.forEach(o => {
      promises.push(setDoc(doc(db, 'orders', o.id), cleanFirestoreData(o)));
    });
    databaseState.quotes.forEach(q => {
      promises.push(setDoc(doc(db, 'quotes', q.id), cleanFirestoreData(q)));
    });
    databaseState.invoices.forEach(i => {
      promises.push(setDoc(doc(db, 'invoices', i.id), cleanFirestoreData(i)));
    });
    databaseState.payments.forEach(p => {
      promises.push(setDoc(doc(db, 'payments', p.id), cleanFirestoreData(p)));
    });
    databaseState.auditLogs.forEach(al => {
      promises.push(setDoc(doc(db, 'auditLogs', al.id), cleanFirestoreData(al)));
    });
    if (databaseState.notifications) {
      databaseState.notifications.forEach(n => {
        promises.push(setDoc(doc(db, 'notifications', n.id), cleanFirestoreData(n)));
      });
    }
    if (databaseState.payrolls) {
      databaseState.payrolls.forEach(pay => {
        promises.push(setDoc(doc(db, 'payrolls', pay.id), cleanFirestoreData(pay)));
      });
    }
    if (databaseState.leaveRequests) {
      databaseState.leaveRequests.forEach(lr => {
        promises.push(setDoc(doc(db, 'leaveRequests', lr.id), cleanFirestoreData(lr)));
      });
    }
    if (databaseState.salaryAdvances) {
      databaseState.salaryAdvances.forEach(sa => {
        promises.push(setDoc(doc(db, 'salaryAdvances', sa.id), cleanFirestoreData(sa)));
      });
    }
    if (databaseState.affiliateCommissions) {
      databaseState.affiliateCommissions.forEach(ac => {
        promises.push(setDoc(doc(db, 'affiliateCommissions', ac.id), cleanFirestoreData(ac)));
      });
    }

    promises.push(setDoc(doc(db, 'settings', 'global'), cleanFirestoreData(databaseState.settings)));

    await Promise.all(promises);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'database_save');
    throw err;
  }
}

export async function resetDatabase(): Promise<void> {
  cachedDatabaseState = null;
  cacheTimestamp = 0;
  await ensureAuthenticated();
  try {
    const [
      usersSnap,
      partnerCustomersSnap,
      servicesSnap,
      ordersSnap,
      quotesSnap,
      invoicesSnap,
      paymentsSnap,
      auditLogsSnap,
      notificationsSnap,
      payrollsSnap,
      leaveRequestsSnap,
      salaryAdvancesSnap,
      affiliateCommissionsSnap
    ] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'partnerCustomers')),
      getDocs(collection(db, 'services')),
      getDocs(collection(db, 'orders')),
      getDocs(collection(db, 'quotes')),
      getDocs(collection(db, 'invoices')),
      getDocs(collection(db, 'payments')),
      getDocs(collection(db, 'auditLogs')),
      getDocs(collection(db, 'notifications')),
      getDocs(collection(db, 'payrolls')),
      getDocs(collection(db, 'leaveRequests')),
      getDocs(collection(db, 'salaryAdvances')),
      getDocs(collection(db, 'affiliateCommissions'))
    ]);

    const deletePromises: Promise<void>[] = [];
    usersSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    partnerCustomersSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    servicesSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    ordersSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    quotesSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    invoicesSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    paymentsSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    auditLogsSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    notificationsSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    payrollsSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    leaveRequestsSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    salaryAdvancesSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    affiliateCommissionsSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    
    await Promise.all(deletePromises);
    
    const seeded = getSeededDatabase();
    await saveDatabase(seeded);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, 'database_reset');
    throw err;
  }
}

export async function purgeDatabase(): Promise<void> {
  await ensureAuthenticated();
  try {
    const [
      usersSnap,
      partnerCustomersSnap,
      servicesSnap,
      ordersSnap,
      quotesSnap,
      invoicesSnap,
      paymentsSnap,
      auditLogsSnap,
      notificationsSnap,
      payrollsSnap,
      leaveRequestsSnap,
      salaryAdvancesSnap,
      affiliateCommissionsSnap
    ] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'partnerCustomers')),
      getDocs(collection(db, 'services')),
      getDocs(collection(db, 'orders')),
      getDocs(collection(db, 'quotes')),
      getDocs(collection(db, 'invoices')),
      getDocs(collection(db, 'payments')),
      getDocs(collection(db, 'auditLogs')),
      getDocs(collection(db, 'notifications')),
      getDocs(collection(db, 'payrolls')),
      getDocs(collection(db, 'leaveRequests')),
      getDocs(collection(db, 'salaryAdvances')),
      getDocs(collection(db, 'affiliateCommissions'))
    ]);

    const deletePromises: Promise<void>[] = [];
    usersSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    partnerCustomersSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    servicesSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    ordersSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    quotesSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    invoicesSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    paymentsSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    auditLogsSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    notificationsSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    payrollsSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    leaveRequestsSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    salaryAdvancesSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));
    affiliateCommissionsSnap.forEach((d: any) => deletePromises.push(deleteDoc(d.ref)));

    await Promise.all(deletePromises);

    const adminUser: User = {
      id: 'usr-admin-boguiman',
      name: 'Administrateur Principal (Boguiman)',
      username: 'boguiman',
      email: 'boguiman@gmail.com',
      password: 'admin123',
      role: 'admin',
      privileges: getDefaultPrivileges('admin'),
      active: true,
      createdAt: new Date().toISOString()
    };

    const emptyDb: AppDatabase = {
      users: [adminUser],
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
      settings: {
        companyName: "DigiDocs Services SARL",
        address: "14 Boulevard d'Anfa, Étage 3, Casablanca, Maroc",
        phone: "+212 522-123456",
        email: "contact@digidocs.ma",
        currency: "DH",
        taxRate: 20,
        databaseType: 'firebase',
        dbConfig: { connected: true, lastTestedAt: new Date().toISOString() },
        depositRules: { normal: 50, fast: 60, urgent: 70, very_urgent: 80 },
        urgencySurcharges: { normal: 0, fast: 30, urgent: 60, very_urgent: 100 },
        saasWorkspaceTitle: "SAAS WORKSPACE",
        googleDriveAccounts: [],
        resourceDocuments: [],
        googleDriveTransferLogs: []
      }
    };

    await saveDatabase(emptyDb);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, 'database_purge');
    throw err;
  }
}

export async function deleteFirestoreDoc(collectionName: string, id: string): Promise<void> {
  await ensureAuthenticated();
  try {
    await deleteDoc(doc(db, collectionName, id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, collectionName);
  }
}

export async function logAction(userId: string, userName: string, action: string, details: string): Promise<void> {
  await ensureAuthenticated();
  try {
    const log: AuditLog = {
      id: 'LOG-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
      timestamp: new Date().toISOString(),
      userId,
      userName,
      action,
      details
    };
    await setDoc(doc(db, 'auditLogs', log.id), log);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'auditLogs');
  }
}

// --- INITIAL DATA SEEDING ---

function getSeededDatabase(): AppDatabase {
  const defaultSettings: SystemSettings = {
    companyName: "DigiDocs Services SARL",
    logoUrl: "",
    address: "14 Boulevard d'Anfa, Étage 3, Casablanca, Maroc",
    phone: "+212 522-123456",
    email: "contact@digidocs.ma",
    currency: "DH",
    taxRate: 20, // 20% VAT in Morocco
    globalGeminiApiKey: "",
    globalGeminiApiKeyEnabled: true,
    depositRules: {
      normal: 50,
      fast: 60,
      urgent: 70,
      very_urgent: 80
    },
    urgencySurcharges: {
      normal: 0,
      fast: 30,
      urgent: 60,
      very_urgent: 100
    },
    saasWorkspaceTitle: "SAAS WORKSPACE",
    googleDriveAccounts: [],
    resourceDocuments: [],
    googleDriveTransferLogs: []
  };

  const services: Service[] = [
    {
      id: "srv-1",
      name: "Saisie de manuscrit manuscrit vers Word",
      category: "saisie",
      description: "Transformation de manuscrits rédigés à la main en documents Word parfaitement formatés.",
      priceMethod: "per_page",
      basePrice: 0,
      unitPriceName: "Page",
      unitPrice: 2.00, // 2 DH per page
      isActive: true,
      coverageScope: "international",
      countries: ["Maroc", "France", "Belgique", "Canada", "Suisse", "Sénégal", "Côte d'Ivoire"],
      regions: ["Casablanca-Settat", "Rabat-Salé-Kénitra", "Tanger-Tétouan-Al Hoceïma", "Marrakech-Safi", "Fès-Meknès", "Souss-Massa", "Oriental"],
      cities: ["Casablanca", "Rabat", "Marrakech", "Tanger", "Fès", "Agadir", "Oujda", "Kénitra", "Paris", "Bruxelles", "Montréal"],
      street: "14 Boulevard d'Anfa, Quartier Gauthier",
      postalCode: "20000",
      latitude: 33.589886,
      longitude: -7.633756,
      coverageNotes: "Disponible 100% en ligne à l'international et enlèvement physique possible.",
      options: [
        { id: "opt-1-1", name: "Correction de texte avancée (+0.5 DH/Page)", price: 0.50 },
        { id: "opt-1-2", name: "Mise en page professionnelle complexe (+0.5 DH/Page)", price: 0.50 },
        { id: "opt-1-3", name: "Insertion de table des matières et index (+20 DH fixe)", price: 20.00 }
      ]
    },
    {
      id: "srv-2",
      name: "Saisie de listes et tableaux Excel",
      category: "saisie",
      description: "Saisie, tri et classement de données manuscrites ou scannées dans des tableaux Excel complexes.",
      priceMethod: "per_hour",
      basePrice: 50,
      unitPriceName: "Heure",
      unitPrice: 80.00, // 80 DH per hour
      isActive: true,
      coverageScope: "national",
      countries: ["Maroc"],
      regions: ["Casablanca-Settat", "Rabat-Salé-Kénitra", "Tanger-Tétouan-Al Hoceïma", "Marrakech-Safi", "Fès-Meknès", "Souss-Massa", "Oriental", "Béni Mellal-Khénifra", "Drâa-Tafilalet", "Guelmim-Oued Noun", "Laâyoune-Sakia El Hamra", "Dakhla-Oued Ed-Dahab"],
      cities: ["Casablanca", "Rabat", "Salé", "Témara", "Marrakech", "Tanger", "Fès", "Meknès", "Agadir", "Oujda", "Kénitra", "Mohammedia", "El Jadida"],
      street: "Avenue Mohammed V, Centre d'Affaires",
      postalCode: "10000",
      latitude: 34.020882,
      longitude: -6.841650,
      coverageNotes: "Prise en charge partout sur le territoire national marocain.",
      options: [
        { id: "opt-2-1", name: "Formatage conditionnel & formules de calcul (+30 DH fixe)", price: 30.00 }
      ]
    },
    {
      id: "srv-3",
      name: "Conversion PDF vers Word/Excel avec OCR",
      category: "conversion",
      description: "Extraction de texte à partir de documents PDF ou scans non-éditables via un traitement OCR avancé et relecture.",
      priceMethod: "per_page",
      basePrice: 0,
      unitPriceName: "Page",
      unitPrice: 3.00,
      isActive: true,
      coverageScope: "international",
      countries: ["Maroc", "France", "Belgique", "Espagne", "Émirats Arabes Unis"],
      regions: ["Casablanca-Settat", "Rabat-Salé-Kénitra", "Tanger-Tétouan-Al Hoceïma", "Marrakech-Safi"],
      cities: ["Casablanca", "Rabat", "Tanger", "Marrakech", "Paris", "Lyon", "Marseille", "Dubaï"],
      street: "Boulevard Zerktouni, Maarif",
      postalCode: "20100",
      latitude: 33.582312,
      longitude: -7.632145,
      coverageNotes: "Traitement à distance instantané avec restitution numérique haute fidélité.",
      options: [
        { id: "opt-3-1", name: "Conservation stricte de la mise en page d'origine (+1 DH/Page)", price: 1.00 }
      ]
    },
    {
      id: "srv-4",
      name: "Mise en page Word de Mémoire/Livre",
      category: "mise_en_forme",
      description: "Mise aux normes académiques et éditoriales de rapports, mémoires ou livres (polices, marges, pagination, titres).",
      priceMethod: "per_page",
      basePrice: 50.00,
      unitPriceName: "Page",
      unitPrice: 1.50,
      isActive: true,
      coverageScope: "regional",
      countries: ["Maroc"],
      regions: ["Casablanca-Settat", "Rabat-Salé-Kénitra"],
      cities: ["Casablanca", "Mohammedia", "Rabat", "Salé", "Kénitra"],
      street: "Quartier des Hôpitaux, Rue Abdelkrim El Khattabi",
      postalCode: "20360",
      latitude: 33.568452,
      longitude: -7.620184,
      coverageNotes: "Idéal pour étudiants, universitaires et chercheurs des pôles Casa-Rabat.",
      options: [
        { id: "opt-4-1", name: "Pagination et gestion des en-têtes (+15 DH fixe)", price: 15.00 },
        { id: "opt-4-2", name: "Génération de sommaire dynamique (+10 DH fixe)", price: 10.00 }
      ]
    },
    {
      id: "srv-5",
      name: "Correction orthographique et relecture",
      category: "traitement",
      description: "Relecture approfondie pour correction de l'orthographe, de la syntaxe, de la grammaire et de la ponctuation.",
      priceMethod: "per_word",
      basePrice: 0,
      unitPriceName: "Mot",
      unitPrice: 0.05, // 0.05 DH per word
      isActive: true,
      coverageScope: "international",
      countries: ["Maroc", "France", "Belgique", "Suisse", "Canada", "Tunisie"],
      regions: ["Toutes les régions"],
      cities: ["Casablanca", "Rabat", "Paris", "Bruxelles", "Genève", "Tunis"],
      street: "Boulevard Massira Al Khadra",
      postalCode: "20100",
      latitude: 33.585642,
      longitude: -7.641258,
      coverageNotes: "Relecture experte multi-langues (Français, Arabe, Anglais) sans restriction géographique.",
      options: []
    },
    {
      id: "srv-6",
      name: "Fusion, Découpage et Indexation PDF",
      category: "traitement",
      description: "Regroupement de several fichiers PDF, réorganisation de l'ordre des pages et création de signets d'indexation.",
      priceMethod: "fixed",
      basePrice: 50.00,
      unitPriceName: "Travail",
      unitPrice: 0,
      isActive: true,
      coverageScope: "street",
      countries: ["Maroc"],
      regions: ["Casablanca-Settat"],
      cities: ["Casablanca"],
      street: "14 Boulevard d'Anfa, Étage 3, Bureau 12",
      postalCode: "20000",
      latitude: 33.593450,
      longitude: -7.625890,
      coverageNotes: "Atelier central d'ingénierie documentaire & numérisation sur place.",
      options: [
        { id: "opt-6-1", name: "Indexation et signets cliquables (+20 DH)", price: 20.00 }
      ]
    }
  ];

  const users: User[] = [
    {
      id: "usr-admin-1",
      name: "Administrateur Principal (Boguiman)",
      username: "boguiman",
      email: "boguiman@gmail.com",
      password: "admin123",
      role: "admin",
      phone: "+212 661-000001",
      city: "Casablanca",
      employeeCode: "DIR-001",
      jobTitle: "Directeur Général",
      department: "direction",
      contractType: "cdi",
      hireDate: "2024-01-01",
      cinNumber: "BK100200",
      cnssNumber: "123456789",
      ribNumber: "011780000012345678901234",
      bankName: "Attijariwafa Bank",
      baseSalary: 18000,
      vacationBalance: 22,
      active: true
    }
  ];

  return {
    users,
    partners: users.filter(u => u.role === 'partner'),
    partnerCustomers: [],
    services,
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
    settings: defaultSettings
  };
}
