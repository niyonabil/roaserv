import { Injectable, signal, computed } from '@angular/core';

// --- TYPES REPLICATED FROM BACKEND ---

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
    case 'affiliate':
      return {
        canManageOrders: false,
        canValidateQuality: false,
        canDeliverOrders: false,
        canManageClients: false,
        canManageTools: false,
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

  // Affiliate profile fields
  affiliateCode?: string;
  affiliateLink?: string;
  commissionRate?: number;
  affiliateStatus?: 'active' | 'inactive';
  referredByAffiliateCode?: string;
  referredByAffiliateId?: string;

  // HR & Employee profile fields
  employeeCode?: string;
  jobTitle?: string;
  department?: 'production' | 'qualite' | 'administration' | 'commercial' | 'direction' | 'technique';
  contractType?: 'cdi' | 'cdd' | 'anapec' | 'freelance' | 'stage';
  hireDate?: string;
  birthDate?: string;
  cinNumber?: string;
  cnssNumber?: string;
  ribNumber?: string;
  bankName?: string;
  baseSalary?: number;
  hourlyRate?: number;
  pieceRate?: number;
  vacationBalance?: number;
  emergencyContact?: {
    name: string;
    relation: string;
    phone: string;
  };
  notes?: string;

  // Client Specific fields
  customerType?: 'particular' | 'company';
  clientNotes?: string;
}

export interface PayrollRecord {
  id: string;
  reference: string;
  employeeId: string;
  employeeName: string;
  employeeCode?: string;
  jobTitle?: string;
  department?: string;
  periodMonth: string;
  periodLabel?: string;
  contractType?: string;
  cinNumber?: string;
  cnssNumber?: string;
  workedDays: number;
  absentDays: number;
  overtimeHours?: number;
  hourlyRate?: number;
  overtimeRate?: number;
  overtimeAmount?: number;
  baseSalary: number;
  productionBonus?: number;
  attendanceBonus?: number;
  seniorityBonus?: number;
  otherBonus?: number;
  customBonus?: number;
  grossSalary: number;
  cnssDeduction: number;
  amoDeduction: number;
  advanceDeduction: number;
  absenceDeduction: number;
  otherDeduction: number;
  totalDeductions: number;
  netSalary: number;
  netSalaryInWords?: string;
  netSalaryWords?: string;
  paymentMethod: 'transfer' | 'check' | 'cash';
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
  type: 'paid_leave' | 'unpaid_leave' | 'sick_leave' | 'maternity' | 'exceptional';
  startDate: string;
  endDate: string;
  daysCount: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
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
  repaymentMonth: string;
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
  commissionRate: number;
  commissionAmount: number;
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

export interface AffiliateWithStats extends User {
  affiliateCode: string;
  affiliateLink: string;
  commissionRate: number;
  clientsCount: number;
  referredClientsCount?: number;
  ordersCount: number;
  paidOrdersCount: number;
  totalRevenue: number;
  pendingCommissions: number;
  validatedCommissions: number;
  paidCommissions: number;
  cancelledCommissions: number;
  totalCommissions: number;
  totalCommissionAmount?: number;
}

export interface ClientOverviewItem {
  id: string;
  type: 'direct_client' | 'b2b_partner' | 'partner_customer';
  customerType: 'particular' | 'company';
  name: string;
  username?: string;
  email: string;
  phone: string;
  city: string;
  company?: string;
  ice?: string;
  partnerName?: string;
  partnerId?: string;
  ordersCount: number;
  totalSpent: number;
  paidAmount?: number;
  solde?: number;
  unpaidAmount: number;
  advanceAmount?: number;
  active: boolean;
  clientNotes?: string;
  createdAt: string;
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
  type?: 'final' | 'b2c' | 'b2b';
}

export interface ServiceOption {
  id: string;
  name: string;
  price: number;
}

export interface Service {
  id: string;
  name: string;
  category: 'saisie' | 'conversion' | 'mise_en_forme' | 'traitement' | 'impression' | 'livraison';
  description: string;
  priceMethod: 'fixed' | 'per_page' | 'per_word' | 'per_hour' | 'hybrid';
  basePrice: number;
  unitPriceName: string;
  unitPrice: number;
  isActive: boolean;
  options: ServiceOption[];
  imageUrl?: string;
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
  base64Data?: string;
}

export interface OrderMessage {
  id: string;
  senderName: string;
  senderRole: string;
  message: string;
  timestamp: string;
  isInternal: boolean;
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
  rating?: number;
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
  referenceNumber?: string;
  dueDate?: string;
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
  currency: string;
  taxRate: number;
  globalGeminiApiKey?: string;
  globalGeminiApiKeyEnabled?: boolean;
  depositRules: {
    normal: number;
    fast: number;
    urgent: number;
    very_urgent: number;
  };
  urgencySurcharges: {
    normal: number;
    fast: number;
    urgent: number;
    very_urgent: number;
  };
  saasWorkspaceTitle?: string;
  databaseType?: 'firebase' | 'supabase' | 'mysql' | 'mariadb';
  isSetupCompleted?: boolean;
  whatsappSupportLink?: string;
  telegramSupportLink?: string;
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
  partnerId?: string;
  serviceId: string;
  serviceName: string;
  serviceCategory: string;
  description: string;
  quantity: number;
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
  affiliateId?: string;
  affiliateCode?: string;
  affiliateName?: string;
  commissionRate?: number;
  createdAt: string;
  updatedAt: string;
  deadline?: string;
}

export interface DashboardStats {
  total: number;
  brouillon: number;
  demandes: number;
  devis: number;
  enCours: number;
  qualityControl: number;
  completed: number;
  done: number;
  annules: number;
  urgent: number;
  caTotal: number;
  acomptesRecus: number;
  soldesAttente: number;
  commissionTotal: number;
}

export const DEFAULT_SERVICES: Service[] = [
  {
    id: "srv-1",
    name: "Saisie de manuscrit manuscrit vers Word",
    category: "saisie",
    description: "Transformation de manuscrits rédigés à la main en documents Word parfaitement formatés.",
    priceMethod: "per_page",
    basePrice: 0,
    unitPriceName: "Page",
    unitPrice: 2.00,
    isActive: true,
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
    unitPrice: 80.00,
    isActive: true,
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
    unitPrice: 0.05,
    isActive: true,
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
    options: [
      { id: "opt-6-1", name: "Indexation et signets cliquables (+20 DH)", price: 20.00 }
    ]
  }
];

@Injectable({
  providedIn: 'root'
})
export class Data {
  // --- SIGNALS FOR GLOBAL STATE ---
  isSetupCompleted = signal<boolean>(true);

  async checkSetupStatus() {
    try {
      const res = await fetch('/api/setup/status');
      const data = await res.json();
      this.isSetupCompleted.set(!!data.isSetupCompleted);
      return !!data.isSetupCompleted;
    } catch {
      this.isSetupCompleted.set(false);
      return false;
    }
  }

  async submitSetup(dbConfig: Record<string, unknown>, adminUser: Record<string, unknown>) {
    const res = await fetch('/api/setup/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dbConfig, adminUser })
    });
    
    let data: Record<string, unknown> = {};
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error("La réponse du serveur n'est pas au format JSON valide.");
      }
    } else if (!res.ok) {
      throw new Error(`Erreur HTTP ${res.status} de l'installation (réponse vide).`);
    }
    
    if (!res.ok) {
      const errVal = (data['error'] as string) || "Une erreur est survenue lors de l'installation.";
      throw new Error(errVal);
    }
    this.isSetupCompleted.set(true);
    return data;
  }

  currentUser = signal<User | null>(null);
  activeRole = signal<'public' | 'client' | 'partner' | 'operator' | 'qa' | 'admin' | 'assistant' | 'affiliate'>('public');

  services = signal<Service[]>(DEFAULT_SERVICES);
  orders = signal<Order[]>([]);
  payments = signal<Payment[]>([]);
  activeOrderDetails = signal<{
    order: Order;
    quote?: Quote;
    invoices: Invoice[];
    payments: Payment[];
  } | null>(null);

  partnerCustomers = signal<PartnerCustomer[]>([]);
  teamUsers = signal<User[]>([]);
  allUsers = signal<User[]>([]);
  payrolls = signal<PayrollRecord[]>([]);
  leaveRequests = signal<LeaveRequest[]>([]);
  salaryAdvances = signal<SalaryAdvance[]>([]);
  clientsOverview = signal<ClientOverviewItem[]>([]);

  // --- CLIENT & PARTNER SOLDE COMPUTED STATS ---
  directClientsOverview = computed(() => this.clientsOverview().filter(c => c.type === 'direct_client'));
  b2bPartnersOverview = computed(() => this.clientsOverview().filter(c => c.type === 'b2b_partner'));

  directClientsTotalSpent = computed(() => this.directClientsOverview().reduce((sum, c) => sum + (c.totalSpent || 0), 0));
  directClientsTotalPaid = computed(() => this.directClientsOverview().reduce((sum, c) => sum + (c.paidAmount || 0), 0));
  directClientsSolde = computed(() => this.directClientsTotalPaid() - this.directClientsTotalSpent());
  directClientsAdvances = computed(() => this.directClientsOverview().reduce((sum, c) => sum + Math.max(0, (c.paidAmount || 0) - (c.totalSpent || 0)), 0));
  directClientsUnpaid = computed(() => this.directClientsOverview().reduce((sum, c) => sum + Math.max(0, (c.totalSpent || 0) - (c.paidAmount || 0)), 0));

  b2bPartnersTotalSpent = computed(() => this.b2bPartnersOverview().reduce((sum, c) => sum + (c.totalSpent || 0), 0));
  b2bPartnersTotalPaid = computed(() => this.b2bPartnersOverview().reduce((sum, c) => sum + (c.paidAmount || 0), 0));
  b2bPartnersSolde = computed(() => this.b2bPartnersTotalPaid() - this.b2bPartnersTotalSpent());
  b2bPartnersAdvances = computed(() => this.b2bPartnersOverview().reduce((sum, c) => sum + Math.max(0, (c.paidAmount || 0) - (c.totalSpent || 0)), 0));
  b2bPartnersUnpaid = computed(() => this.b2bPartnersOverview().reduce((sum, c) => sum + Math.max(0, (c.totalSpent || 0) - (c.paidAmount || 0)), 0));

  totalClientsSolde = computed(() => this.directClientsSolde() + this.b2bPartnersSolde());
  totalClientsAdvances = computed(() => this.directClientsAdvances() + this.b2bPartnersAdvances());
  totalClientsUnpaid = computed(() => this.directClientsUnpaid() + this.b2bPartnersUnpaid());

  currentUserSoldeItem = computed(() => {
    const user = this.currentUser();
    if (!user) return null;
    return this.clientsOverview().find(c => c.id === user.id || (user.email && c.email?.toLowerCase() === user.email?.toLowerCase())) || null;
  });

  // Affiliation Signals
  affiliates = signal<AffiliateWithStats[]>([]);
  affiliateCommissions = signal<AffiliateCommission[]>([]);
  activeAffiliateCode = signal<string | null>(null);

  operatorCount = computed(() => this.allUsers().filter(u => u.role === 'operator').length);
  qaCount = computed(() => this.allUsers().filter(u => u.role === 'qa').length);
  assistantCount = computed(() => this.allUsers().filter(u => u.role === 'assistant').length);
  employeeCount = computed(() => this.allUsers().filter(u => ['operator', 'qa', 'assistant', 'admin'].includes(u.role)).length);
  clientCount = computed(() => this.allUsers().filter(u => u.role === 'client').length + this.partnerCustomers().length);
  partnerCount = computed(() => this.allUsers().filter(u => u.role === 'partner').length);
  affiliateCount = computed(() => this.affiliates().length);
  activeAffiliateCount = computed(() => this.affiliates().filter(a => a.active && a.affiliateStatus !== 'inactive').length);
  
  totalAffiliateCommissions = computed(() => this.affiliateCommissions().filter(c => c.status === 'validated' || c.status === 'paid').reduce((sum, c) => sum + c.commissionAmount, 0));
  pendingAffiliateCommissions = computed(() => this.affiliateCommissions().filter(c => c.status === 'pending').reduce((sum, c) => sum + c.commissionAmount, 0));
  paidAffiliateCommissions = computed(() => this.affiliateCommissions().filter(c => c.status === 'paid').reduce((sum, c) => sum + c.commissionAmount, 0));
  validatedAffiliateCommissionsCount = computed(() => this.affiliateCommissions().filter(c => c.status === 'validated').length);
  validatedAffiliateCommissions = computed(() => this.affiliateCommissions().filter(c => c.status === 'validated').reduce((sum, c) => sum + c.commissionAmount, 0));

  pendingLeaveRequestsCount = computed(() => this.leaveRequests().filter(l => l.status === 'pending').length);
  pendingSalaryAdvancesCount = computed(() => this.salaryAdvances().filter(a => a.status === 'pending').length);
  totalPayrollBudget = computed(() => this.payrolls().reduce((sum, p) => sum + (p.netSalary || 0), 0));

  hrStats = computed(() => {
    const totalEmployees = this.allUsers().filter(u => ['operator', 'qa', 'assistant', 'admin'].includes(u.role)).length;
    const activePayrolls = this.payrolls().length;
    const totalPayrollAmount = this.payrolls().reduce((sum, p) => sum + (p.netSalary || 0), 0);
    const totalNetSalaries = totalPayrollAmount;
    const totalGrossSalaries = this.payrolls().reduce((sum, p) => sum + (p.grossSalary || p.baseSalary || 0), 0);
    const totalCnss = this.payrolls().reduce((sum, p) => sum + (p.cnssDeduction || 0), 0);
    const totalAmo = this.payrolls().reduce((sum, p) => sum + (p.amoDeduction || 0), 0);
    const pendingLeaves = this.leaveRequests().filter(l => l.status === 'pending').length;
    const approvedLeavesThisMonth = this.leaveRequests().filter(l => l.status === 'approved').length;
    const pendingAdvances = this.salaryAdvances().filter(a => a.status === 'pending').length;
    const pendingAdvancesCount = pendingAdvances;
    const totalAdvancesAmount = this.salaryAdvances().filter(a => a.status === 'approved' || a.status === 'pending').reduce((sum, a) => sum + (a.amount || 0), 0);
    const activeAdvancesAmount = this.salaryAdvances().filter(a => a.status === 'approved').reduce((sum, a) => sum + (a.amount || 0), 0);
    return {
      totalEmployees,
      activePayrolls,
      totalPayrollAmount,
      totalNetSalaries,
      totalGrossSalaries,
      totalCnss,
      totalAmo,
      pendingLeaves,
      approvedLeavesThisMonth,
      pendingAdvances,
      pendingAdvancesCount,
      totalAdvancesAmount,
      activeAdvancesAmount
    };
  });

  auditLogs = signal<AuditLog[]>([]);
  settings = signal<SystemSettings | null>(null);
  dashboardStats = signal<DashboardStats | null>(null);
  notifications = signal<AppNotification[]>([]);
  toastNotifications = signal<AppNotification[]>([]);
  unreadNotificationsCount = computed(() => this.notifications().filter(n => !n.read).length);

  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private knownNotificationIds = new Set<string>();

  isLoading = signal<boolean>(false);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  constructor() {
    this.initFromLocalStorage();
    this.startPolling();
  }

  private initFromLocalStorage() {
    if (typeof window !== 'undefined') {
      // Check URL parameters for referral code (?ref=... or ?aff=...)
      try {
        const params = new URLSearchParams(window.location.search);
        const ref = params.get('ref') || params.get('aff') || params.get('affiliate') || params.get('code');
        if (ref) {
          const cleanCode = ref.trim().toUpperCase();
          localStorage.setItem('digidocs_ref_code', cleanCode);
          this.activeAffiliateCode.set(cleanCode);
        } else {
          const savedRef = localStorage.getItem('digidocs_ref_code');
          if (savedRef) {
            this.activeAffiliateCode.set(savedRef);
          }
        }
      } catch (e) {
        console.warn('Could not parse URL search parameters for affiliate code:', e);
      }

      const storedUser = localStorage.getItem('digidocs_user');
      const storedRole = localStorage.getItem('digidocs_role');
      if (storedUser) {
        try {
          const userObj = JSON.parse(storedUser);
          this.currentUser.set(userObj);
          if (storedRole) {
            this.activeRole.set(storedRole as 'public' | 'client' | 'partner' | 'operator' | 'qa' | 'admin' | 'assistant' | 'affiliate');
          } else {
            this.activeRole.set(userObj.role);
          }
        } catch (err) {
          console.error('Error parsing stored user:', err);
        }
      }
    }
  }

  // --- API CALL HELPERS ---

  private async apiCall<T>(url: string, options?: RequestInit, silent = false): Promise<T> {
    if (!silent) {
      this.isLoading.set(true);
      this.errorMessage.set(null);
    }
    try {
      let resolvedUrl = url;
      if (typeof window === 'undefined') {
        if (url.startsWith('/')) {
          resolvedUrl = `http://127.0.0.1:3000${url}`;
        }
      }
      const res = await fetch(resolvedUrl, {
        headers: {
          'Content-Type': 'application/json',
          ...(options?.headers || {})
        },
        ...options
      });
      const text = await res.text();
      let data: Record<string, unknown> = {};
      if (text) {
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          if (!res.ok) {
            throw new Error(`Erreur HTTP ${res.status}`);
          }
        }
      }

      if (!res.ok) {
        const errVal = (data['error'] as string) || `Erreur HTTP ${res.status}`;
        throw new Error(errVal);
      }
      return data as T;
    } catch (err) {
      const msg = (err as Error).message || 'Erreur inconnue';
      // Only set UI error message on client-side if not silent
      if (typeof window !== 'undefined' && !silent) {
        this.errorMessage.set(msg);
      }
      throw err;
    } finally {
      if (!silent) {
        this.isLoading.set(false);
      }
    }
  }

  // --- CORE SERVICES ---

  async login(identifier: string, password?: string): Promise<User> {
    const res = await this.apiCall<{ user: User; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, email: identifier, username: identifier, password })
    });
    this.currentUser.set(res.user);
    this.activeRole.set(res.user.role);
    if (typeof window !== 'undefined') {
      localStorage.setItem('digidocs_user', JSON.stringify(res.user));
      localStorage.setItem('digidocs_role', res.user.role);
    }
    this.successMessage.set(`Bienvenue, ${res.user.name}`);
    this.loadAll();
    return res.user;
  }

  async register(formData: {
    name: string;
    username?: string;
    email: string;
    password?: string;
    role: 'client' | 'partner' | 'operator' | 'qa' | 'assistant';
    phone?: string;
    city?: string;
    address?: string;
    company?: string;
    ice?: string;
    affiliateCode?: string;
    refCode?: string;
  }): Promise<User> {
    const res = await this.apiCall<{ user: User; token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(formData)
    });
    this.currentUser.set(res.user);
    this.activeRole.set(res.user.role);
    if (typeof window !== 'undefined') {
      localStorage.setItem('digidocs_user', JSON.stringify(res.user));
      localStorage.setItem('digidocs_role', res.user.role);
    }
    this.successMessage.set(`Inscription réussie ! Bienvenue, ${res.user.name}`);
    this.loadAll();
    return res.user;
  }

  async updateUserProfile(profileData: {
    name: string;
    username?: string;
    email: string;
    phone?: string;
    city?: string;
    address?: string;
    company?: string;
    ice?: string;
    currentPassword?: string;
    newPassword?: string;
    geminiApiKey?: string;
  }): Promise<User> {
    const user = this.currentUser();
    if (!user) throw new Error('Utilisateur non connecté');

    const res = await this.apiCall<{ user: User; message: string }>(`/api/users/${user.id}/profile`, {
      method: 'PUT',
      body: JSON.stringify(profileData)
    });

    this.currentUser.set(res.user);
    if (typeof window !== 'undefined') {
      localStorage.setItem('digidocs_user', JSON.stringify(res.user));
    }
    this.successMessage.set(res.message || 'Profil mis à jour avec succès.');
    return res.user;
  }

  logout() {
    this.currentUser.set(null);
    this.activeRole.set('public');
    this.notifications.set([]);
    this.toastNotifications.set([]);
    this.knownNotificationIds.clear();
    if (typeof window !== 'undefined') {
      localStorage.removeItem('digidocs_user');
      localStorage.removeItem('digidocs_role');
    }
  }

  startPolling() {
    if (typeof window === 'undefined') return;
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
    }
    // Poll every 20 seconds for new notifications & order updates
    this.pollingTimer = setInterval(() => {
      const user = this.currentUser();
      if (user && this.activeRole() !== 'public') {
        this.loadNotifications(true);
      }
    }, 20000);
  }

  stopPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  async loadNotifications(isPolling = false) {
    const user = this.currentUser();
    if (!user) return;
    try {
      // Notifications loading is always silent to avoid popup interruption
      const list = await this.apiCall<AppNotification[]>(`/api/notifications?userId=${user.id}`, undefined, true);
      
      // If polling and we find brand new unread notifications that were not seen before, trigger toasts!
      if (isPolling && this.knownNotificationIds.size > 0) {
        const brandNew = list.filter(n => !n.read && !this.knownNotificationIds.has(n.id));
        if (brandNew.length > 0) {
          // Add to toast notifications
          this.toastNotifications.update(prev => [...brandNew, ...prev].slice(0, 4));
          
          // Also refresh orders and dashboard stats silently in background
          this.loadOrders(true);
          this.loadStats(true);
          if (this.activeOrderDetails()) {
            const activeId = this.activeOrderDetails()!.order.id;
            if (brandNew.some(n => n.orderId === activeId)) {
              this.loadOrderDetails(activeId, true);
            }
          }

          // Auto-dismiss toasts after 7 seconds
          setTimeout(() => {
            brandNew.forEach(bn => this.dismissToast(bn.id));
          }, 7000);
        }
      }

      // Update known notifications set
      list.forEach(n => this.knownNotificationIds.add(n.id));
      this.notifications.set(list);
    } catch (err) {
      // Ignore background notification polling errors silently
      if (!isPolling) {
        console.warn('Failed to load notifications:', err);
      }
    }
  }

  dismissToast(notificationId: string) {
    this.toastNotifications.update(list => list.filter(t => t.id !== notificationId));
  }

  showToast(title: string, message: string) {
    const toast: AppNotification = {
      id: 'toast-' + Math.random().toString(36).substring(2, 9),
      userId: this.currentUser()?.id || '',
      title,
      message,
      read: false,
      createdAt: new Date().toISOString()
    };
    this.toastNotifications.update(prev => [toast, ...prev].slice(0, 4));
    setTimeout(() => {
      this.dismissToast(toast.id);
    }, 6000);
  }

  async markNotificationAsRead(notificationId: string) {
    await this.apiCall<{ success: boolean }>(`/api/notifications/${notificationId}/read`, {
      method: 'POST'
    }, true);
    this.notifications.update(list => list.map(n => n.id === notificationId ? { ...n, read: true } : n));
    this.dismissToast(notificationId);
  }

  async markAllNotificationsAsRead() {
    const user = this.currentUser();
    if (!user) return;
    await this.apiCall<{ success: boolean }>(`/api/notifications/read-all`, {
      method: 'POST',
      body: JSON.stringify({ userId: user.id })
    }, true);
    this.notifications.update(list => list.map(n => ({ ...n, read: true })));
    this.toastNotifications.set([]);
    this.successMessage.set('Toutes les notifications ont été marquées comme lues.');
  }

  async deleteNotification(notificationId: string) {
    await this.apiCall<{ success: boolean }>(`/api/notifications/${notificationId}`, {
      method: 'DELETE'
    }, true);
    this.notifications.update(list => list.filter(n => n.id !== notificationId));
    this.dismissToast(notificationId);
  }

  async clearReadNotifications() {
    const user = this.currentUser();
    if (!user) return;
    await this.apiCall<{ success: boolean }>(`/api/notifications?userId=${user.id}`, {
      method: 'DELETE'
    }, true);
    this.notifications.update(list => list.filter(n => !n.read));
    this.successMessage.set('Notifications lues supprimées.');
  }

  // Load everything needed according to active role
  async loadAll() {
    try {
      const user = this.currentUser();
      const role = this.activeRole();
      
      const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
      
      // Batch 1: Essential data
      await this.loadServices(true);
      await this.loadSettings(true);
      
      if (role !== 'public' && user) {
        // Batch 2: Core functional data
        await this.loadOrders(true);
        await this.loadPayments(true);
        await this.loadStats(true);
        await this.loadNotifications(true);
        await delay(200); // Throttling
        
        // Batch 3: Admin/Partner/Assistant/HR/Affiliate
        if (role === 'admin' || role === 'assistant') {
          await this.loadAuditLogs(true);
          await this.loadAllUsers(true);
          await this.loadClientsOverview(true);
        }
        if (role === 'partner' || role === 'admin' || role === 'assistant') {
          await this.loadPartnerCustomers(true);
        }
        if (role === 'admin' || role === 'partner' || role === 'client' || role === 'assistant') {
          await this.loadTeamUsers(true);
        }
        
        await delay(200); // Throttling
        
        // Load HR records
        if (['admin', 'assistant', 'operator', 'qa'].includes(role)) {
          await this.loadPayrolls(true);
          await this.loadLeaveRequests(true);
          await this.loadSalaryAdvances(true);
        }
        // Load Affiliate data
        if (role === 'admin' || role === 'assistant' || role === 'affiliate') {
          await this.loadAffiliates(true);
          await this.loadAffiliateCommissions(role === 'affiliate' ? user.id : undefined, true);
        }
      }
    } catch (err) {
      console.error('Failed to load initial workspace data:', err);
    }
  }

  // --- PAYMENTS METHOD ---
  async loadPayments(silent = false) {
    try {
      const data = await this.apiCall<Payment[]>('/api/payments', undefined, silent);
      this.payments.set(data);
      return data;
    } catch (err) {
      if (!silent) console.warn('Could not load payments:', err);
      return [];
    }
  }

  // --- AFFILIATION METHODS ---
  async loadAffiliates(silent = false) {
    try {
      const data = await this.apiCall<AffiliateWithStats[]>('/api/affiliates', undefined, silent);
      this.affiliates.set(data);
      return data;
    } catch (err) {
      if (!silent) console.warn('Could not load affiliates:', err);
      return [];
    }
  }

  async loadAffiliateCommissions(affiliateId?: string, silent = false) {
    try {
      const query = affiliateId ? `?affiliateId=${encodeURIComponent(affiliateId)}` : '';
      const data = await this.apiCall<AffiliateCommission[]>(`/api/affiliate-commissions${query}`, undefined, silent);
      this.affiliateCommissions.set(data);
      return data;
    } catch (err) {
      if (!silent) console.warn('Could not load affiliate commissions:', err);
      return [];
    }
  }

  async createAffiliate(affiliateData: {
    name: string;
    email: string;
    phone?: string;
    city?: string;
    commissionRate?: number;
    affiliateCode?: string;
    password?: string;
    notes?: string;
  }) {
    try {
      const newAff = await this.apiCall<User>('/api/affiliates', {
        method: 'POST',
        body: JSON.stringify(affiliateData)
      });
      this.successMessage.set(`Compte affilié "${newAff.name}" créé avec succès.`);
      await this.loadAffiliates(true);
      await this.loadAllUsers(true);
      return newAff;
    } catch (err) {
      this.errorMessage.set((err as Error).message);
      throw err;
    }
  }

  async updateAffiliate(id: string, updateData: Partial<User>) {
    try {
      const updated = await this.apiCall<User>(`/api/affiliates/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updateData)
      });
      this.successMessage.set(`Profil de l'affilié mis à jour.`);
      await this.loadAffiliates(true);
      await this.loadAllUsers(true);
      return updated;
    } catch (err) {
      this.errorMessage.set((err as Error).message);
      throw err;
    }
  }

  async updateCommissionStatus(id: string, status: 'validated' | 'requested' | 'paid' | 'cancelled', notes?: string) {
    try {
      const updated = await this.apiCall<AffiliateCommission>(`/api/affiliate-commissions/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status, notes })
      });
      const statusLabels: Record<string, string> = {
        validated: 'Validée',
        requested: 'Demandée (Note de Débit)',
        paid: 'Payée (Virement Effectué)',
        cancelled: 'Annulée'
      };
      this.successMessage.set(`Statut de la commission mis à jour vers: ${statusLabels[status] || status}.`);
      await this.loadAffiliateCommissions(undefined, true);
      await this.loadAffiliates(true);
      return updated;
    } catch (err) {
      this.errorMessage.set((err as Error).message);
      throw err;
    }
  }

  async requestDebitNote(affiliateId: string, commissionIds?: string[], bankName?: string, ribNumber?: string, notes?: string) {
    try {
      const res = await this.apiCall<{
        success: boolean;
        debitNoteReference: string;
        date: string;
        totalAmount: number;
        commissionsCount: number;
        affiliateName: string;
        affiliateCode: string;
        bankName: string;
        ribNumber: string;
        updatedCommissions: AffiliateCommission[];
      }>('/api/affiliate-commissions/request-debit-note', {
        method: 'POST',
        body: JSON.stringify({ affiliateId, commissionIds, bankName, ribNumber, notes })
      });

      this.successMessage.set(`Note de Débit #${res.debitNoteReference} émise et transmise avec succès pour un montant total de ${res.totalAmount} DH (${res.commissionsCount} commission(s)).`);
      await this.loadAffiliateCommissions(undefined, true);
      await this.loadAffiliates(true);
      return res;
    } catch (err) {
      this.errorMessage.set((err as Error).message);
      throw err;
    }
  }

  async loadTeamUsers(silent = false) {
    const user = this.currentUser();
    if (!user) return;
    const url = (user.role === 'admin' || user.role === 'assistant')
      ? `/api/users?role=admin` 
      : `/api/users?createdByUserId=${user.id}`;
    const members = await this.apiCall<User[]>(url, undefined, silent);
    this.teamUsers.set(members);
  }

  async createTeamUser(userData: {
    name: string;
    username: string;
    email: string;
    password?: string;
    role: 'operator' | 'qa' | 'assistant';
    phone?: string;
    city?: string;
    address?: string;
    privileges?: UserPrivileges;
  }) {
    const user = this.currentUser();
    if (!user) return;
    const payload = {
      ...userData,
      password: userData.password || '123456',
      createdByUserId: user.id,
      createdByRole: user.role
    };
    const res = await this.apiCall<{ user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    this.teamUsers.update(prev => [...prev, res.user]);
    this.successMessage.set(`Collaborateur "${res.user.name}" (@${res.user.username || res.user.email}) créé avec succès.`);
    return res.user;
  }

  async updateTeamUser(userId: string, updateData: Partial<User>) {
    const user = this.currentUser();
    const payload = {
      ...updateData,
      updatedByUserId: user?.id,
      updatedByName: user?.name
    };
    const res = await this.apiCall<{ user: User; message: string }>(`/api/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    this.teamUsers.update(list => list.map(u => u.id === userId ? res.user : u));
    this.successMessage.set(res.message || `Collaborateur "${res.user.name}" mis à jour avec succès.`);
    return res.user;
  }

  async loadAllUsers(silent = false) {
    try {
      const users = await this.apiCall<User[]>('/api/users?all=true', undefined, silent);
      if (users && Array.isArray(users)) {
        this.allUsers.set(users);
        const user = this.currentUser();
        if (user?.role === 'admin' || user?.role === 'assistant') {
          this.teamUsers.set(users.filter(u => ['operator', 'qa', 'assistant', 'admin'].includes(u.role)));
        } else if (user?.role === 'partner') {
          this.teamUsers.set(users.filter(u => u.createdByUserId === user.id));
        }
      }
    } catch (err) {
      if (!silent) console.warn('Could not refresh all users:', err);
    }
  }

  async createUser(userData: Partial<User>) {
    const user = this.currentUser();
    const payload = {
      ...userData,
      password: userData.password || '123456',
      createdByUserId: user?.id,
      createdByRole: user?.role
    };
    const res = await this.apiCall<{ user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    this.allUsers.update(prev => [...prev, res.user]);
    this.teamUsers.update(prev => [...prev, res.user]);
    this.successMessage.set(`Compte "${res.user.name}" (@${res.user.username || res.user.email}) créé avec succès.`);
    return res.user;
  }

  async updateUser(userId: string, updateData: Partial<User>) {
    const user = this.currentUser();
    const payload = {
      ...updateData,
      updatedByUserId: user?.id,
      updatedByName: user?.name
    };
    const res = await this.apiCall<{ user: User; message: string }>(`/api/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    this.allUsers.update(list => list.map(u => u.id === userId ? res.user : u));
    this.teamUsers.update(list => list.map(u => u.id === userId ? res.user : u));
    if (this.currentUser()?.id === userId) {
      this.currentUser.set(res.user);
      localStorage.setItem('digidocs_user', JSON.stringify(res.user));
    }
    this.successMessage.set(res.message || `Fiche de "${res.user.name}" mise à jour avec succès.`);
    return res.user;
  }

  async toggleUserActive(userId: string) {
    const user = this.currentUser();
    const res = await this.apiCall<{ success: boolean; active: boolean; user: User }>(`/api/users/${userId}/toggle-active`, {
      method: 'PUT',
      body: JSON.stringify({
        updatedByUserId: user?.id,
        updatedByName: user?.name
      })
    });
    this.allUsers.update(list => list.map(u => u.id === userId ? { ...u, active: res.active } : u));
    this.teamUsers.update(list => list.map(u => u.id === userId ? { ...u, active: res.active } : u));
    this.successMessage.set(`Statut du compte mis à jour: ${res.active ? 'Actif' : 'Inactif'}.`);
    return res;
  }

  async deleteUser(userId: string) {
    const user = this.currentUser();
    const res = await this.apiCall<{ success: boolean; id: string; message: string }>(
      `/api/users/${userId}?deletedByUserId=${user?.id || ''}&deletedByName=${encodeURIComponent(user?.name || '')}`,
      { method: 'DELETE' }
    );
    this.allUsers.update(list => list.filter(u => u.id !== userId));
    this.teamUsers.update(list => list.filter(u => u.id !== userId));
    this.affiliates.update(list => list.filter(a => a.id !== userId));
    this.partnerCustomers.update(list => list.filter(c => c.id !== userId));
    this.clientsOverview.update(list => list.filter(c => c.id !== userId));
    this.successMessage.set(res.message || 'Utilisateur ou client supprimé.');
    return res;
  }

  // --- PAYROLL METHODS ---
  async loadPayrolls(silent = false) {
    const user = this.currentUser();
    if (!user) return;
    const url = (user.role === 'admin' || user.role === 'assistant')
      ? '/api/payrolls'
      : `/api/payrolls?employeeId=${user.id}`;
    const list = await this.apiCall<PayrollRecord[]>(url, undefined, silent);
    if (list && Array.isArray(list)) {
      this.payrolls.set(list);
    }
  }

  async savePayroll(payrollData: Partial<PayrollRecord>) {
    const user = this.currentUser();
    const isEdit = !!payrollData.id;
    const url = isEdit
      ? `/api/payrolls/${payrollData.id}?authorId=${user?.id || ''}&authorName=${encodeURIComponent(user?.name || '')}`
      : `/api/payrolls?authorId=${user?.id || ''}&authorName=${encodeURIComponent(user?.name || '')}`;

    const saved = await this.apiCall<PayrollRecord>(url, {
      method: isEdit ? 'PUT' : 'POST',
      body: JSON.stringify(payrollData)
    });

    if (isEdit) {
      this.payrolls.update(list => list.map(p => p.id === saved.id ? saved : p));
      this.successMessage.set(`Bulletin de paie "${saved.reference}" mis à jour.`);
    } else {
      this.payrolls.update(prev => [saved, ...prev]);
      this.successMessage.set(`Bulletin de paie généré avec succès pour ${saved.employeeName} (${saved.netSalary.toFixed(2)} DH).`);
    }
    return saved;
  }

  async deletePayroll(payrollId: string) {
    const user = this.currentUser();
    await this.apiCall<{ success: boolean; id: string }>(
      `/api/payrolls/${payrollId}?authorId=${user?.id || ''}&authorName=${encodeURIComponent(user?.name || '')}`,
      { method: 'DELETE' }
    );
    this.payrolls.update(list => list.filter(p => p.id !== payrollId));
    this.successMessage.set('Bulletin de paie supprimé.');
  }

  // --- LEAVE REQUESTS METHODS ---
  async loadLeaveRequests(silent = false) {
    const user = this.currentUser();
    if (!user) return;
    const url = (user.role === 'admin' || user.role === 'assistant')
      ? '/api/leave-requests'
      : `/api/leave-requests?employeeId=${user.id}`;
    const list = await this.apiCall<LeaveRequest[]>(url, undefined, silent);
    if (list && Array.isArray(list)) {
      this.leaveRequests.set(list);
    }
  }

  async createLeaveRequest(leaveData: Partial<LeaveRequest>) {
    const saved = await this.apiCall<LeaveRequest>('/api/leave-requests', {
      method: 'POST',
      body: JSON.stringify(leaveData)
    });
    this.leaveRequests.update(prev => [saved, ...prev]);
    this.successMessage.set(`Demande de congé déposée pour ${saved.daysCount} jour(s).`);
    return saved;
  }

  async updateLeaveStatus(leaveId: string, status: 'approved' | 'rejected' | 'cancelled', rejectionReason?: string) {
    const user = this.currentUser();
    const updated = await this.apiCall<LeaveRequest>(`/api/leave-requests/${leaveId}`, {
      method: 'PUT',
      body: JSON.stringify({
        status,
        reviewedBy: user?.name || 'Direction RH',
        rejectionReason
      })
    });
    this.leaveRequests.update(list => list.map(l => l.id === leaveId ? updated : l));
    // If approved, refresh all users to reflect updated vacation balance
    if (status === 'approved') {
      this.loadAllUsers(true);
    }
    this.successMessage.set(`Demande de congé ${status === 'approved' ? 'approuvée avec succès' : 'refusée'}.`);
    return updated;
  }

  // --- SALARY ADVANCES METHODS ---
  async loadSalaryAdvances(silent = false) {
    const user = this.currentUser();
    if (!user) return;
    const url = (user.role === 'admin' || user.role === 'assistant')
      ? '/api/salary-advances'
      : `/api/salary-advances?employeeId=${user.id}`;
    const list = await this.apiCall<SalaryAdvance[]>(url, undefined, silent);
    if (list && Array.isArray(list)) {
      this.salaryAdvances.set(list);
    }
  }

  async createSalaryAdvance(advanceData: Partial<SalaryAdvance>) {
    const saved = await this.apiCall<SalaryAdvance>('/api/salary-advances', {
      method: 'POST',
      body: JSON.stringify(advanceData)
    });
    this.salaryAdvances.update(prev => [saved, ...prev]);
    this.successMessage.set(`Demande d'avance de ${saved.amount} DH transmise à la direction.`);
    return saved;
  }

  async updateSalaryAdvanceStatus(advanceId: string, status: 'approved' | 'rejected' | 'deducted', repaymentMonth?: string) {
    const user = this.currentUser();
    const updated = await this.apiCall<SalaryAdvance>(`/api/salary-advances/${advanceId}`, {
      method: 'PUT',
      body: JSON.stringify({
        status,
        approvedBy: user?.name || 'Direction RH',
        repaymentMonth
      })
    });
    this.salaryAdvances.update(list => list.map(a => a.id === advanceId ? updated : a));
    this.successMessage.set(`Acompte de salaire mis à jour (${status}).`);
    return updated;
  }

  // --- CLIENTS 360° OVERVIEW METHODS ---
  async loadClientsOverview(silent = false) {
    try {
      const list = await this.apiCall<ClientOverviewItem[]>('/api/clients/overview', undefined, silent);
      if (list && Array.isArray(list)) {
        this.clientsOverview.set(list);
      }
    } catch (err) {
      if (!silent) console.warn('Could not refresh clients overview:', err);
    }
  }

  // --- DASHBOARD CHARTS DATA ---
  getDashboardStats() {
    const payments = this.payments();
    const commissions = this.affiliateCommissions();
    const clients = this.partnerCustomers();
    
    // Grouping by Month (Y-M)
    const monthlyData: Record<string, { revenue: number; commissions: number }> = {};
    
    payments.filter(p => p.status === 'verified').forEach(p => {
      const month = (p.paymentDate || p.date || '').substring(0, 7); // YYYY-MM
      if (!month) return;
      if (!monthlyData[month]) monthlyData[month] = { revenue: 0, commissions: 0 };
      monthlyData[month].revenue += p.amount || 0;
    });
    
    commissions.forEach(c => {
      const month = c.createdAt.substring(0, 7); // YYYY-MM
      if (!monthlyData[month]) monthlyData[month] = { revenue: 0, commissions: 0 };
      monthlyData[month].commissions += c.commissionAmount || 0;
    });

    const chartData = Object.keys(monthlyData).sort().map(month => ({
      month,
      revenue: monthlyData[month].revenue,
      commissions: monthlyData[month].commissions
    }));

    // Simple top balances calculation (approximation)
    const topBalances = clients
      .map(c => ({ name: c.name, balance: 0 })) // Placeholder
      .slice(0, 5);

    return { chartData, topBalances };
  }

  // Helper: Number to French words for pay slips
  numberToFrenchWords(amount: number): string {
    const units = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
    const teens = ['dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
    const tens = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante-dix', 'quatre-vingts', 'quatre-vingt-dix'];

    function convertUnderHundred(n: number): string {
      if (n === 0) return '';
      if (n < 10) return units[n];
      if (n >= 10 && n < 20) return teens[n - 10];
      const ten = Math.floor(n / 10);
      const unit = n % 10;
      if (ten === 7) return 'soixante-' + teens[unit];
      if (ten === 9) return 'quatre-vingt-' + teens[unit];
      if (unit === 0) return tens[ten];
      if (unit === 1 && ten !== 8) return tens[ten] + ' et un';
      return tens[ten] + '-' + units[unit];
    }

    function convertUnderThousand(n: number): string {
      if (n === 0) return '';
      const hundred = Math.floor(n / 100);
      const remainder = n % 100;
      let res = '';
      if (hundred === 1) res = 'cent';
      else if (hundred > 1) res = units[hundred] + ' cent' + (remainder === 0 ? 's' : '');
      if (remainder > 0) {
        res += (res ? ' ' : '') + convertUnderHundred(remainder);
      }
      return res;
    }

    const integerPart = Math.floor(amount);
    const decimalPart = Math.round((amount - integerPart) * 100);

    if (integerPart === 0) return 'Zéro Dirhams';

    let result = '';
    const thousands = Math.floor(integerPart / 1000);
    const remainderUnits = integerPart % 1000;

    if (thousands === 1) {
      result = 'mille';
    } else if (thousands > 1) {
      result = convertUnderThousand(thousands) + ' mille';
    }

    if (remainderUnits > 0) {
      result += (result ? ' ' : '') + convertUnderThousand(remainderUnits);
    }

    // Capitalize first letter
    result = result.charAt(0).toUpperCase() + result.slice(1) + ' Dirhams';

    if (decimalPart > 0) {
      result += ' et ' + convertUnderHundred(decimalPart) + ' centimes';
    }

    return result;
  }

  // Helper: Moroccan standard payroll computation
  computeMoroccanPayroll(params: Record<string, unknown>) {
    const raw = params || {};
    const base = Number(raw['baseSalary']) || 0;
    const workedDays = typeof raw['workedDays'] === 'number' ? raw['workedDays'] : (Number(raw['workedDays']) || 26);
    const absentDays = Number(raw['absentDays']) || 0;
    const dayRate = base > 0 ? base / 26 : 0;
    const absenceDeduction = +(absentDays * dayRate).toFixed(2);

    const hourlyRate = Number(raw['hourlyRate']) || (base > 0 ? Math.round(base / 191) : 25);
    const overtimeHours = Number(raw['overtimeHours']) || 0;
    const overtimeRate = Number(raw['overtimeRate']) || +(hourlyRate * 1.25).toFixed(2);
    const overtimeAmount = +(overtimeHours * overtimeRate).toFixed(2);

    const prodBonus = Number(raw['productionBonus']) || 0;
    const attBonus = Number(raw['attendanceBonus']) || 0;
    const senBonus = Number(raw['seniorityBonus']) || 0;
    const otherBonus = Number(raw['otherBonus']) || Number(raw['customBonus']) || 0;
    const custBonus = otherBonus;

    const grossSalary = Math.max(0, +(base - (workedDays < 26 || absentDays > 0 ? absenceDeduction : 0) + overtimeAmount + prodBonus + attBonus + senBonus + custBonus).toFixed(2));

    // CNSS: 4.48% (Capped at 6000 DH base)
    const cnssBase = Math.min(6000, grossSalary);
    const cnssDeduction = +(cnssBase * 0.0448).toFixed(2);

    // AMO: 2.26% (Uncapped)
    const amoDeduction = +(grossSalary * 0.0226).toFixed(2);

    const advanceDeduction = Number(raw['advanceDeduction']) || 0;
    const otherDeduction = Number(raw['otherDeduction']) || 0;

    const totalDeductions = +(cnssDeduction + amoDeduction + advanceDeduction + otherDeduction).toFixed(2);
    const netSalary = Math.max(0, +(grossSalary - totalDeductions).toFixed(2));
    const netSalaryInWords = this.numberToFrenchWords(netSalary);

    return {
      workedDays,
      absentDays,
      overtimeHours,
      overtimeRate,
      overtimeAmount,
      baseSalary: base,
      productionBonus: prodBonus,
      attendanceBonus: attBonus,
      seniorityBonus: senBonus,
      customBonus: custBonus,
      otherBonus,
      grossSalary,
      cnssDeduction,
      amoDeduction,
      advanceDeduction,
      absenceDeduction,
      otherDeduction,
      totalDeductions,
      netSalary,
      netSalaryWords: netSalaryInWords,
      netSalaryInWords
    };
  }

  async resetTeamUserPassword(userId: string, newPassword: string) {
    const user = this.currentUser();
    const res = await this.apiCall<{ success: boolean; message: string }>(`/api/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({
        newPassword,
        updatedByUserId: user?.id,
        updatedByName: user?.name
      })
    });
    this.successMessage.set(res.message || 'Mot de passe réinitialisé avec succès.');
    return res;
  }

  async deleteTeamUser(userId: string) {
    return this.deleteUser(userId);
  }

  async loadServices(silent = false) {
    try {
      const s = await this.apiCall<Service[]>('/api/services', undefined, silent);
      if (s && Array.isArray(s)) {
        this.services.set(s);
      }
    } catch (err) {
      if (!silent) console.warn('Could not refresh remote services:', err);
    }
  }

  async saveService(serviceData: Partial<Service>) {
    const user = this.currentUser();
    const isEdit = !!serviceData.id;
    const url = isEdit
      ? `/api/services/${serviceData.id}?userId=${user?.id || ''}&userName=${encodeURIComponent(user?.name || '')}`
      : `/api/services?userId=${user?.id || ''}&userName=${encodeURIComponent(user?.name || '')}`;
    
    const saved = await this.apiCall<Service>(url, {
      method: isEdit ? 'PUT' : 'POST',
      body: JSON.stringify(serviceData)
    });

    if (isEdit) {
      this.services.update(list => list.map(s => s.id === saved.id ? saved : s));
      this.successMessage.set(`Service "${saved.name}" mis à jour avec succès.`);
    } else {
      this.services.update(list => [...list, saved]);
      this.successMessage.set(`Nouveau service "${saved.name}" ajouté au catalogue.`);
    }
    return saved;
  }

  async deleteService(serviceId: string) {
    const user = this.currentUser();
    await this.apiCall<{ success: boolean; id: string }>(`/api/services/${serviceId}?userId=${user?.id || ''}&userName=${encodeURIComponent(user?.name || '')}`, {
      method: 'DELETE'
    });
    this.services.update(list => list.filter(s => s.id !== serviceId));
    this.successMessage.set('Service supprimé du catalogue avec succès.');
  }

  async loadSettings(silent = false) {
    const s = await this.apiCall<SystemSettings>('/api/settings', undefined, silent);
    this.settings.set(s);
  }

  async loadPartnerCustomers(silent = false) {
    const user = this.currentUser();
    if (!user) return;
    const role = this.activeRole();
    const url = (role === 'admin' || role === 'assistant')
      ? '/api/partners/customers'
      : `/api/partners/customers?partnerId=${user.id}`;
    const c = await this.apiCall<PartnerCustomer[]>(url, undefined, silent);
    this.partnerCustomers.set(c);
  }

  async addPartnerCustomer(customer: Partial<PartnerCustomer>) {
    const user = this.currentUser();
    if (!user) return;
    customer.partnerId = user.id;
    const added = await this.apiCall<PartnerCustomer>('/api/partners/customers', {
      method: 'POST',
      body: JSON.stringify(customer)
    });
    this.partnerCustomers.update(prev => [...prev, added]);
    this.successMessage.set(`Client "${added.name}" créé avec succès.`);
    return added;
  }

  async loadOrders(silent = false) {
    const user = this.currentUser();
    if (!user) return;
    const role = this.activeRole();

    let queryParam = '';
    if (role === 'partner') {
      queryParam = `?partnerId=${user.id}`;
    } else if (role === 'client') {
      queryParam = `?clientId=${user.id}`;
    } else if (role === 'operator') {
      queryParam = `?operatorId=${user.id}`;
    } else if (role === 'qa') {
      queryParam = `?qaId=${user.id}`;
    }

    const o = await this.apiCall<Order[]>(`/api/orders${queryParam}`, undefined, silent);
    this.orders.set(o);
  }

  async loadOrderDetails(id: string, silent = false) {
    const d = await this.apiCall<{
      order: Order;
      quote?: Quote;
      invoices: Invoice[];
      payments: Payment[];
    }>(`/api/orders/${id}`, undefined, silent);
    this.activeOrderDetails.set(d);
    return d;
  }

  async createOrder(order: Partial<Order>) {
    const user = this.currentUser();
    if (user && this.activeRole() === 'partner') {
      order.partnerId = user.id;
      order.customerType = 'partner';
    } else if (user && this.activeRole() === 'client') {
      order.customerType = 'particular';
      order.customerDetails = {
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        city: user.city || 'Rabat',
        address: user.address || ''
      };
    }
    if (this.activeAffiliateCode() && !order.affiliateCode) {
      order.affiliateCode = this.activeAffiliateCode()!;
    }
    const created = await this.apiCall<Order>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(order)
    });
    this.orders.update(prev => [created, ...prev]);
    this.successMessage.set(`Commande ${created.reference} soumise avec succès.`);
    this.loadStats(true);
    this.loadNotifications(true);
    return created;
  }

  async updateOrderStatus(id: string, status: string) {
    const user = this.currentUser();
    const updated = await this.apiCall<Order>(`/api/orders/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({
        status,
        userId: user?.id || 'system',
        userName: user?.name || 'Système'
      })
    });
    this.orders.update(prev => prev.map(o => o.id === id ? { ...o, status: updated.status } : o));
    if (this.activeOrderDetails()?.order.id === id) {
      this.activeOrderDetails.update(prev => prev ? { ...prev, order: { ...prev.order, status: updated.status } } : null);
    }
    this.successMessage.set(`Statut mis à jour : ${status.replace(/_/g, ' ')}`);
    this.loadStats(true);
    this.loadNotifications(true);
  }

  async updateOrderDeadline(id: string, deadline: string, notes?: string) {
    const user = this.currentUser();
    const updated = await this.apiCall<Order>(`/api/orders/${id}/deadline`, {
      method: 'POST',
      body: JSON.stringify({
        deadline,
        notes: notes || '',
        userId: user?.id || 'system',
        userName: user?.name || 'Système'
      })
    });
    this.orders.update(prev => prev.map(o => o.id === id ? { ...o, deadline: updated.deadline } : o));
    if (this.activeOrderDetails()?.order.id === id) {
      this.activeOrderDetails.update(prev => prev ? { ...prev, order: { ...prev.order, deadline: updated.deadline, tasks: updated.tasks } } : null);
    }
    this.successMessage.set(`Date limite mise à jour : ${new Date(deadline).toLocaleDateString('fr-FR')}`);
    this.loadStats(true);
    this.loadNotifications(true);
  }

  async submitQuote(orderId: string, quoteData: Partial<Quote>) {
    const user = this.currentUser();
    const res = await this.apiCall<{ order: Order; quote: Quote }>(`/api/orders/${orderId}/quote?userId=${user?.id}&userName=${user?.name}`, {
      method: 'POST',
      body: JSON.stringify(quoteData)
    });
    if (this.activeOrderDetails()?.order.id === orderId) {
      this.activeOrderDetails.update(prev => prev ? { ...prev, order: res.order, quote: res.quote } : null);
    }
    this.successMessage.set(`Devis ${res.quote.reference} envoyé avec succès.`);
    this.loadOrders(true);
    this.loadStats(true);
    this.loadNotifications(true);
  }

  async acceptRefuseQuote(orderId: string, action: 'accept' | 'refuse') {
    const user = this.currentUser();
    const res = await this.apiCall<{ order: Order; quote: Quote }>(`/api/orders/${orderId}/quote/action`, {
      method: 'POST',
      body: JSON.stringify({
        action,
        userId: user?.id || 'client',
        userName: user?.name || 'Client'
      })
    });
    if (this.activeOrderDetails()?.order.id === orderId) {
      this.activeOrderDetails.update(prev => prev ? { ...prev, order: res.order, quote: res.quote } : null);
    }
    this.successMessage.set(action === 'accept' ? 'Devis accepté ! En attente du paiement de l\'acompte.' : 'Devis refusé.');
    this.loadOrders(true);
    this.loadStats(true);
    this.loadNotifications(true);
    await this.loadOrderDetails(orderId, true); // refresh invoices/payments
  }

  async assignOperator(orderId: string, assignData: Record<string, unknown>) {
    const user = this.currentUser();
    const order = await this.apiCall<Order>(`/api/orders/${orderId}/assign`, {
      method: 'POST',
      body: JSON.stringify({
        ...assignData,
        userId: user?.id,
        userName: user?.name
      })
    });
    if (this.activeOrderDetails()?.order.id === orderId) {
      this.activeOrderDetails.update(prev => prev ? { ...prev, order } : null);
    }
    this.successMessage.set(`Commande assignée à l'opérateur.`);
    this.loadOrders(true);
    this.loadStats(true);
    this.loadNotifications(true);
  }

  async uploadFile(orderId: string, name: string, type: string, size: number, folder: string, base64Data: string) {
    const user = this.currentUser();
    const order = await this.apiCall<Order>(`/api/orders/${orderId}/upload`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        type,
        size,
        folder,
        base64Data,
        uploadedBy: user?.name || 'Inconnu'
      })
    });
    if (this.activeOrderDetails()?.order.id === orderId) {
      this.activeOrderDetails.update(prev => prev ? { ...prev, order } : null);
    }
    this.successMessage.set(`Fichier "${name}" ajouté dans ${folder.replace(/_/g, ' ')}`);
  }

  async sendMessage(orderId: string, message: string, isInternal = false, fileName?: string, fileBase64?: string) {
    const user = this.currentUser();
    const order = await this.apiCall<Order>(`/api/orders/${orderId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        senderName: user?.name || 'Client',
        senderRole: this.activeRole(),
        message,
        isInternal,
        fileName,
        fileBase64
      })
    });
    if (this.activeOrderDetails()?.order.id === orderId) {
      this.activeOrderDetails.update(prev => prev ? { ...prev, order } : null);
    }
  }

  async submitQaChecklist(orderId: string, checklist: Partial<QualityChecklist>, action: 'approve' | 'reject') {
    const user = this.currentUser();
    const order = await this.apiCall<Order>(`/api/orders/${orderId}/qa`, {
      method: 'POST',
      body: JSON.stringify({
        checklist,
        validatedBy: user?.name || 'Qualiticien',
        action
      })
    });
    if (this.activeOrderDetails()?.order.id === orderId) {
      this.activeOrderDetails.update(prev => prev ? { ...prev, order } : null);
    }
    this.successMessage.set(action === 'approve' ? 'Contrôle qualité approuvé !' : 'Travail refusé et renvoyé pour corrections.');
    this.loadOrders(true);
    this.loadStats(true);
    this.loadNotifications(true);
    await this.loadOrderDetails(orderId, true);
  }

  async submitPaymentProof(orderId: string, payload: { amount: number; type: 'deposit' | 'balance'; method: string; proofFileName?: string; proofFileBase64?: string }) {
    const user = this.currentUser();
    const res = await this.apiCall<{ order: Order; quote: Quote; payments: Payment[] }>(`/api/orders/${orderId}/pay`, {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        userId: user?.id,
        userName: user?.name,
        action: 'submit_proof'
      })
    });
    if (this.activeOrderDetails()?.order.id === orderId) {
      this.activeOrderDetails.update(prev => prev ? { ...prev, order: res.order, quote: res.quote, payments: res.payments } : null);
    }
    this.successMessage.set(`Preuve de paiement soumise. Un administrateur va la valider.`);
    this.loadOrders(true);
    this.loadStats(true);
    this.loadNotifications(true);
  }

  async requestOrderRevision(orderId: string, notes: string, attachmentName?: string, attachmentBase64?: string) {
    const user = this.currentUser();
    const order = await this.apiCall<Order>(`/api/orders/${orderId}/revisions`, {
      method: 'POST',
      body: JSON.stringify({
        notes,
        requestedBy: user?.name || 'Client',
        requestedByRole: this.activeRole(),
        attachmentName,
        attachmentBase64
      })
    });
    if (this.activeOrderDetails()?.order.id === orderId) {
      this.activeOrderDetails.update(prev => prev ? { ...prev, order } : null);
    }
    this.successMessage.set('Demande de révision envoyée avec succès.');
    this.loadOrders(true);
    this.loadNotifications(true);
  }

  async resolveOrderRevision(orderId: string, revId: string, status: string, deliveredFileName?: string, deliveredFileBase64?: string, adminResponseNotes?: string) {
    const order = await this.apiCall<Order>(`/api/orders/${orderId}/revisions/${revId}`, {
      method: 'PUT',
      body: JSON.stringify({
        status,
        deliveredFileName,
        deliveredFileBase64,
        adminResponseNotes
      })
    });
    if (this.activeOrderDetails()?.order.id === orderId) {
      this.activeOrderDetails.update(prev => prev ? { ...prev, order } : null);
    }
    this.successMessage.set('Révision enregistrée et livrée.');
    this.loadOrders(true);
    this.loadNotifications(true);
  }

  async submitClientSatisfaction(orderId: string, rating: number, feedback?: string, isSatisfied = true) {
    const order = await this.apiCall<Order>(`/api/orders/${orderId}/satisfaction`, {
      method: 'POST',
      body: JSON.stringify({
        rating,
        feedback,
        isSatisfied
      })
    });
    if (this.activeOrderDetails()?.order.id === orderId) {
      this.activeOrderDetails.update(prev => prev ? { ...prev, order } : null);
    }
    this.successMessage.set('Merci ! Votre avis et validation ont été pris en compte.');
    this.loadOrders(true);
    this.loadNotifications(true);
  }

  async updateOrderPaymentTerms(orderId: string, paymentMethod: string, paymentTerms: string, customDueDate?: string) {
    const order = await this.apiCall<Order>(`/api/orders/${orderId}/payment-terms`, {
      method: 'PUT',
      body: JSON.stringify({
        paymentMethod,
        paymentTerms,
        customDueDate
      })
    });
    if (this.activeOrderDetails()?.order.id === orderId) {
      this.activeOrderDetails.update(prev => prev ? { ...prev, order } : null);
    }
    this.successMessage.set('Modalités et délais de paiement mis à jour.');
    this.loadOrders(true);
  }

  async verifyPayment(orderId: string, paymentId: string, approve: boolean) {
    const user = this.currentUser();
    const res = await this.apiCall<{ order: Order; quote: Quote; payments: Payment[] }>(`/api/orders/${orderId}/pay`, {
      method: 'POST',
      body: JSON.stringify({
        paymentId,
        approve,
        userId: user?.id,
        userName: user?.name,
        action: 'verify_payment'
      })
    });
    if (this.activeOrderDetails()?.order.id === orderId) {
      this.activeOrderDetails.update(prev => prev ? { ...prev, order: res.order, quote: res.quote, payments: res.payments } : null);
    }
    this.successMessage.set(approve ? 'Paiement validé avec succès.' : 'Paiement refusé.');
    this.loadOrders(true);
    this.loadStats(true);
    this.loadNotifications(true);
    await this.loadOrderDetails(orderId, true);
  }

  async loadStats(silent = false) {
    const user = this.currentUser();
    const stats = await this.apiCall<DashboardStats>(`/api/dashboard/stats?role=${this.activeRole()}&userId=${user?.id || ''}`, undefined, silent);
    this.dashboardStats.set(stats);
  }

  async loadAuditLogs(silent = false) {
    const logs = await this.apiCall<AuditLog[]>('/api/audit-logs', undefined, silent);
    this.auditLogs.set(logs);
  }

  async saveSettings(settingsData: Partial<SystemSettings>) {
    const user = this.currentUser();
    const s = await this.apiCall<SystemSettings>(`/api/settings?userId=${user?.id || ''}&userName=${user?.name || ''}`, {
      method: 'POST',
      body: JSON.stringify(settingsData)
    });
    this.settings.set(s);
    this.successMessage.set('Paramètres mis à jour.');
  }

  async resetDb() {
    const user = this.currentUser();
    await this.apiCall<{ success: boolean }>('/api/reset', {
      method: 'POST',
      body: JSON.stringify({
        userId: user?.id,
        userName: user?.name
      })
    });
    this.successMessage.set('Base de données réinitialisée aux valeurs démo.');
    await this.loadAll();
    if (this.activeOrderDetails()) {
      const activeId = this.activeOrderDetails()!.order.id;
      await this.loadOrderDetails(activeId);
    }
  }

  async purgeDatabase() {
    const user = this.currentUser();
    if (!user || user.role !== 'admin') {
      throw new Error("Action réservée aux administrateurs.");
    }
    const res = await this.apiCall<{ success: boolean; message: string }>('/api/database/purge', {
      method: 'POST',
      body: JSON.stringify({ userId: user.id, userName: user.name })
    });
    this.successMessage.set(res.message || 'Base de données purgée. Seul le compte administrateur boguiman@gmail.com est actif.');
    await this.loadAll();
    return res;
  }

  async testDbConnection(configData: { databaseType: string; host?: string; port?: number; databaseName?: string; username?: string; password?: string }) {
    const res = await this.apiCall<{ success: boolean; connected: boolean; message: string }>('/api/database/test-connection', {
      method: 'POST',
      body: JSON.stringify(configData)
    });
    this.successMessage.set(res.message);
    await this.loadAll();
    return res;
  }

  // --- CLIENT SIDE GEMINI ASSISTANT API CALLS ---

  async analyzeDocumentWithAi(fileName: string, fileBase64: string, description: string) {
    return await this.apiCall<{
      detectedLanguage: string;
      estimatedPageCount: number;
      estimatedWordCount: number;
      readability: string;
      recommendedServiceId: string;
      optimizedDescription: string;
      optionsRecommended: string[];
    }>('/api/ai/analyze-document', {
      method: 'POST',
      body: JSON.stringify({ fileName, fileBase64, description })
    });
  }

  async draftSpecSheetWithAi(orderId: string) {
    return await this.apiCall<{ specSheet: string }>('/api/ai/draft-spec', {
      method: 'POST',
      body: JSON.stringify({ orderId })
    });
  }

  async addGoogleDriveAccount(name: string, email: string, folderId?: string, completedFolderId?: string) {
    const user = this.currentUser();
    const s = await this.apiCall<SystemSettings>(`/api/settings/gdrive/accounts`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        email,
        folderId,
        completedFolderId,
        userId: user?.id,
        userName: user?.name
      })
    });
    this.settings.set(s);
    this.successMessage.set(`Compte Google Drive "${email}" connecté avec succès.`);
  }

  async disconnectGoogleDriveAccount(id: string) {
    const user = this.currentUser();
    const s = await this.apiCall<SystemSettings>(`/api/settings/gdrive/accounts/${id}?userId=${user?.id || ''}&userName=${user?.name || ''}`, {
      method: 'DELETE'
    });
    this.settings.set(s);
    this.successMessage.set(`Compte Google Drive déconnecté.`);
  }

  async addResourceDocument(name: string, category: 'legal' | 'template' | 'example' | 'other', classification: string, size: number, type: string, base64Data: string) {
    const user = this.currentUser();
    const s = await this.apiCall<SystemSettings>(`/api/settings/resources`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        category,
        classification,
        uploadedBy: user?.name || 'Administrateur',
        size,
        type,
        base64Data,
        userId: user?.id,
        userName: user?.name
      })
    });
    this.settings.set(s);
    this.successMessage.set(`Document ressource "${name}" ajouté.`);
  }

  async deleteResourceDocument(id: string) {
    const user = this.currentUser();
    const s = await this.apiCall<SystemSettings>(`/api/settings/resources/${id}?userId=${user?.id || ''}&userName=${user?.name || ''}`, {
      method: 'DELETE'
    });
    this.settings.set(s);
    this.successMessage.set(`Document ressource supprimé.`);
  }

  async draftChatReplyWithAi(orderId: string, instruction: string) {
    return await this.apiCall<{ reply: string }>('/api/ai/message-assistant', {
      method: 'POST',
      body: JSON.stringify({ orderId, instruction })
    });
  }
}


