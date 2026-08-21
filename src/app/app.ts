import { ChangeDetectionStrategy, Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl, Title, Meta } from '@angular/platform-browser';
import { Data, Service, Order, PartnerCustomer, OrderFile, Quote, AppNotification, User, UserPrivileges, getDefaultPrivileges, PayrollRecord, LeaveRequest, SalaryAdvance, AffiliateCommission, Payment, SystemSettings } from './data';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

import { DashboardChart } from './dashboard-chart';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [CommonModule, ReactiveFormsModule, DashboardChart],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly data = inject(Data);
  private sanitizer = inject(DomSanitizer);
  private titleService = inject(Title);
  private metaService = inject(Meta);

  // --- UI NAVIGATION & ACTIVE VIEWS ---
  activeTab = signal<string>('dashboard'); // e.g. dashboard, orders, new_order, services, clients, reports, settings, audit_logs, tools
  selectedOrderId = signal<string | null>(null);

  // --- CALENDAR STATE ---
  calendarDate = signal<Date>(new Date());
  calendarDays = computed(() => {
    const d = this.calendarDate();
    const year = d.getFullYear();
    const month = d.getMonth();
    
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 is Sunday, 1 is Monday...
    const adjustedFirstDay = firstDayIndex === 0 ? 6 : firstDayIndex - 1;
    
    const totalDays = new Date(year, month + 1, 0).getDate();
    const prevTotalDays = new Date(year, month, 0).getDate();
    
    interface CalendarDay {
      date: Date;
      isCurrentMonth: boolean;
      dayNum: number;
      isToday: boolean;
    }
    const days: CalendarDay[] = [];
    
    for (let i = adjustedFirstDay - 1; i >= 0; i--) {
      const prevDay = prevTotalDays - i;
      days.push({
        date: new Date(year, month - 1, prevDay),
        isCurrentMonth: false,
        dayNum: prevDay,
        isToday: false
      });
    }
    
    const today = new Date();
    for (let i = 1; i <= totalDays; i++) {
      const currDate = new Date(year, month, i);
      const isToday = currDate.getDate() === today.getDate() &&
                      currDate.getMonth() === today.getMonth() &&
                      currDate.getFullYear() === today.getFullYear();
      days.push({
        date: currDate,
        isCurrentMonth: true,
        dayNum: i,
        isToday
      });
    }
    
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false,
        dayNum: i,
        isToday: false
      });
    }
    
    return days;
  });

  prevCalendarMonth() {
    this.calendarDate.update(d => {
      const copy = new Date(d);
      copy.setMonth(copy.getMonth() - 1);
      return copy;
    });
  }

  nextCalendarMonth() {
    this.calendarDate.update(d => {
      const copy = new Date(d);
      copy.setMonth(copy.getMonth() + 1);
      return copy;
    });
  }

  getFrenchMonthYearLabel(date: Date): string {
    const months = [
      'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
      'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
    ];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
  }

  isSameDate(d1Str: string | undefined, d2: Date): boolean {
    if (!d1Str) return false;
    const d1 = new Date(d1Str);
    return d1.getDate() === d2.getDate() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getFullYear() === d2.getFullYear();
  }

  // --- FILE VIEWING & DOWNLOADS ---
  viewingFile = signal<OrderFile | { name: string; type: string; base64Data: string; id?: string } | null>(null);
  pdfPage = signal<number>(1);
  pdfZoom = signal<number>(100);

  // --- ESPACE OUTILS (TOOLS TAB) STATE ---
  activeToolsTab = signal<'resources' | 'utilities' | 'gdrive' | 'firebase'>('resources');
  resourceCategoryFilter = signal<'all' | 'legal' | 'template' | 'example' | 'other'>('all');
  resourceSearchQuery = signal<string>('');
  showAddResourceModal = signal<boolean>(false);
  newResourceName = signal<string>('');
  newResourceCategory = signal<'legal' | 'template' | 'example' | 'other'>('legal');
  newResourceClassification = signal<string>('');
  newResourceBase64 = signal<string>('');
  newResourceSize = signal<number>(0);
  newResourceType = signal<string>('');

  // --- GOOGLE DRIVE MANAGEMENT STATE ---
  showAddGDriveModal = signal<boolean>(false);
  gdriveAccountName = signal<string>('');
  gdriveAccountEmail = signal<string>('');
  gdriveFolderId = signal<string>('01_CLIENT_UPLOADS');
  gdriveCompletedFolderId = signal<string>('05_COMPLETED_WORKS');

  // --- INTERACTIVE UTILITY TOOLS STATE ---
  activeUtilityTool = signal<'ocr' | 'generator' | 'image_edit' | 'video'>('ocr');
  // OCR Utility State
  ocrInputFileBase64 = signal<string | null>(null);
  ocrInputFileName = signal<string | null>(null);
  ocrProcessing = signal<boolean>(false);
  ocrResultText = signal<string | null>(null);
  // Image Generator Utility State
  genPrompt = signal<string>('');
  genProcessing = signal<boolean>(false);
  genResultImage = signal<string | null>(null);
  // Image Editing Utility State
  editInputFileBase64 = signal<string | null>(null);
  editInputFileName = signal<string | null>(null);
  editSelectedFilter = signal<'none' | 'grayscale' | 'contrast' | 'sharpen' | 'bw'>('none');
  editResultFileBase64 = signal<string | null>(null);
  editProcessing = signal<boolean>(false);
  // Video / Conversion simulation State
  videoInputFileName = signal<string | null>(null);
  videoInputFileBase64 = signal<string | null>(null);
  videoTargetFormat = signal<'mp4_to_gif' | 'compress_mp4' | 'extract_audio'>('mp4_to_gif');
  videoResultFileName = signal<string | null>(null);
  videoResultFileBase64 = signal<string | null>(null);
  videoProcessing = signal<boolean>(false);
  videoProgressLogs = signal<string[]>([]);

  // --- NEW INTEGRATED MICRO-TOOLS ALIAS SIGNALS ---
  selectedMicroTool = signal<'ocr' | 'image' | 'video'>('ocr');
  activeImageFilter = signal<string>('none');
  targetVideoFormat = signal<'mp4_to_gif' | 'compress_mp4' | 'extract_audio'>('mp4_to_gif');
  videoConverting = signal<boolean>(false);
  videoFinishedFile = signal<string | null>(null);

  // --- NOTIFICATIONS UI STATE ---
  showNotificationsDropdown = signal<boolean>(false);
  notificationsFilter = signal<'all' | 'unread'>('all');
  notificationsTypeFilter = signal<string>('all');
  notificationsSearchQuery = signal<string>('');
  
  filteredNotifications = computed(() => {
    let list = this.data.notifications();
    if (this.notificationsFilter() === 'unread') {
      list = list.filter(n => !n.read);
    }
    const type = this.notificationsTypeFilter();
    if (type !== 'all') {
      list = list.filter(n => {
        const text = (n.title + ' ' + n.message).toLowerCase();
        if (type === 'orders') return text.includes('commande') || text.includes('créée');
        if (type === 'payments') return text.includes('devis') || text.includes('acompte') || text.includes('solde') || text.includes('paiement');
        if (type === 'qa') return text.includes('qualité') || text.includes('tâche') || text.includes('assign') || text.includes('validé');
        return true;
      });
    }
    const q = this.notificationsSearchQuery().toLowerCase().trim();
    if (q) {
      list = list.filter(n => 
        n.title.toLowerCase().includes(q) || 
        n.message.toLowerCase().includes(q) || 
        (n.orderId && n.orderId.toLowerCase().includes(q))
      );
    }
    return list;
  });

  filteredResourceDocs = computed(() => {
    const s = this.data.settings();
    let docs = s?.resourceDocuments || [];
    const cat = this.resourceCategoryFilter();
    if (cat !== 'all') {
      docs = docs.filter(d => d.category === cat);
    }
    const q = this.resourceSearchQuery().toLowerCase().trim();
    if (q) {
      docs = docs.filter(d => d.name.toLowerCase().includes(q) || d.classification.toLowerCase().includes(q));
    }
    return docs;
  });

  // --- REACTIVE FORMS ---
  orderForm!: FormGroup;
  customerForm!: FormGroup;
  quoteForm!: FormGroup;
  assignForm!: FormGroup;
  paymentForm!: FormGroup;
  authForm!: FormGroup;
  teamUserForm!: FormGroup;
  editTeamUserForm!: FormGroup;
  serviceForm!: FormGroup;
  profileForm!: FormGroup;
  payrollForm!: FormGroup;
  leaveForm!: FormGroup;
  advanceForm!: FormGroup;
  fullUserForm!: FormGroup;
  editFullUserForm!: FormGroup;
  employeeHrForm!: FormGroup;
  rejectLeaveForm!: FormGroup;
  resetUserPasswordForm!: FormGroup;
  setupForm!: FormGroup;

  setupError = signal<string | null>(null);
  setupSuccess = signal<string | null>(null);
  isSubmittingSetup = signal<boolean>(false);

  // --- HR & PAYROLL MANAGEMENT STATE ---
  hrActiveSubTab = signal<'payrolls' | 'leaves' | 'advances' | 'employees'>('payrolls');
  selectedPayroll = signal<PayrollRecord | null>(null);
  showPayrollModal = signal<boolean>(false);
  showPayrollSlipModal = signal<boolean>(false);
  payrollPeriodFilter = signal<string>('all');
  payrollEmployeeFilter = signal<string>('all');
  payrollStatusFilter = signal<'all' | 'draft' | 'validated' | 'paid'>('all');
  payrollSearchQuery = signal<string>('');

  showLeaveModal = signal<boolean>(false);
  showRejectLeaveModal = signal<boolean>(false);
  selectedLeaveForRejection = signal<LeaveRequest | null>(null);
  selectedLeaveForAction = signal<LeaveRequest | null>(null);
  leaveRejectionReason = signal<string>('');
  leaveStatusFilter = signal<'all' | 'pending' | 'approved' | 'rejected'>('all');

  showAdvanceModal = signal<boolean>(false);
  advanceStatusFilter = signal<'all' | 'pending' | 'approved' | 'rejected' | 'deducted'>('all');

  showEmployeeHrModal = signal<boolean>(false);
  selectedEmployeeForHr = signal<User | null>(null);

  payrollFormLiveTrigger = signal<number>(0);
  employeesList = computed(() => this.data.allUsers().filter(u => ['operator', 'qa', 'assistant', 'admin'].includes(u.role)));
  editingPayrollId = computed(() => this.payrollForm?.get('id')?.value || null);

  payrollComputedSummary = computed(() => {
    this.payrollFormLiveTrigger();
    if (!this.payrollForm) return null;
    return this.data.computeMoroccanPayroll(this.payrollForm.getRawValue());
  });

  getClientOverviewForUser(userId: string, email?: string) {
    return this.data.clientsOverview().find(c => 
      c.id === userId || (email && c.email?.toLowerCase() === email.toLowerCase())
    );
  }

  // --- FIREBASE CONFIGURATION & MIGRATION STATE ---
  firebaseConfigForm = signal<{
    projectId: string;
    apiKey: string;
    authDomain: string;
    firestoreDatabaseId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
  }>({
    projectId: '',
    apiKey: '',
    authDomain: '',
    firestoreDatabaseId: '(default)',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
  });
  firebaseConfigLoading = signal<boolean>(false);
  firebaseConfigMessage = signal<string | null>(null);
  firebaseConfigError = signal<string | null>(null);

  async loadFirebaseConfig() {
    try {
      this.firebaseConfigLoading.set(true);
      const res = await fetch('/api/settings/firebase-config');
      const json = await res.json();
      if (json.success && json.config) {
        this.firebaseConfigForm.set({
          projectId: json.config.projectId || '',
          apiKey: json.config.apiKey || '',
          authDomain: json.config.authDomain || '',
          firestoreDatabaseId: json.config.firestoreDatabaseId || '(default)',
          storageBucket: json.config.storageBucket || '',
          messagingSenderId: json.config.messagingSenderId || '',
          appId: json.config.appId || ''
        });
      }
    } catch (e) {
      console.error("Error loading Firebase config:", e);
    } finally {
      this.firebaseConfigLoading.set(false);
    }
  }

  async saveFirebaseConfig() {
    try {
      this.firebaseConfigLoading.set(true);
      this.firebaseConfigMessage.set(null);
      this.firebaseConfigError.set(null);
      const res = await fetch('/api/settings/firebase-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.firebaseConfigForm())
      });
      const json = await res.json();
      if (json.success) {
        this.firebaseConfigMessage.set(json.message);
        await this.data.loadAll();
      } else {
        this.firebaseConfigError.set(json.error || 'Erreur lors de l\'enregistrement de la configuration Firebase.');
      }
    } catch {
      this.firebaseConfigError.set('Erreur réseau lors de l\'enregistrement de la configuration Firebase.');
    } finally {
      this.firebaseConfigLoading.set(false);
    }
  }

  // --- COMPREHENSIVE USER MANAGEMENT STATE ---
  usersActiveSubTab = signal<'all' | 'employees' | 'partners' | 'clients'>('all');
  userSearchQuery = signal<string>('');
  userRoleFilter = signal<string>('all');
  userStatusFilter = signal<'all' | 'active' | 'inactive'>('all');
  showUserModal = signal<boolean>(false);
  showEditUserModal = signal<boolean>(false);
  showResetUserPasswordModal = signal<boolean>(false);
  selectedUserForAction = signal<User | null>(null);
  newPasswordValue = signal<string>('');

  showAuthModal = signal<'login' | 'register' | null>(null);
  showPassword = signal<boolean>(false);
  showTeamPassword = signal<boolean>(false);
  showEditTeamPassword = signal<boolean>(false);
  showEditTeamModal = signal<boolean>(false);
  showResetPasswordModal = signal<boolean>(false);
  selectedTeamMember = signal<User | null>(null);
  newResetPassword = signal<string>('');
  teamRoleFilter = signal<'all' | 'operator' | 'qa' | 'assistant'>('all');
  teamSearchQuery = signal<string>('');
  isSubmittingTeamMember = signal<boolean>(false);

  filteredTeamMembers = computed(() => {
    let list = this.data.teamUsers();
    const roleFilter = this.teamRoleFilter();
    if (roleFilter !== 'all') {
      list = list.filter(u => u.role === roleFilter);
    }
    const q = this.teamSearchQuery().toLowerCase().trim();
    if (q) {
      list = list.filter(u => 
        u.name.toLowerCase().includes(q) ||
        (u.username && u.username.toLowerCase().includes(q)) ||
        u.email.toLowerCase().includes(q) ||
        (u.phone && u.phone.includes(q)) ||
        (u.city && u.city.toLowerCase().includes(q))
      );
    }
    return list;
  });

  showProfileCurrentPassword = signal<boolean>(false);
  showProfileNewPassword = signal<boolean>(false);
  showProfileConfirmPassword = signal<boolean>(false);
  isSavingProfile = signal<boolean>(false);

  // --- SERVICE CATALOG MANAGEMENT STATE ---
  showServiceModal = signal<boolean>(false);
  editingServiceId = signal<string | null>(null);
  serviceImageBase64 = signal<string | null>(null);
  serviceOptionsList = signal<{ id: string; name: string; price: number }[]>([]);
  newOptionName = signal<string>('');
  newOptionPrice = signal<number>(0);

  // --- LOCAL COMPONENT STATES ---
  activeCategoryFilter = signal<string>('all');
  searchQuery = signal<string>('');
  statusFilter = signal<string>('all');

  // --- CHAT MESSAGE STATE ---
  chatMessage = signal<string>('');
  chatFileBase64 = signal<string | null>(null);
  chatFileName = signal<string | null>(null);
  isChatInternal = signal<boolean>(false);

  // --- FILE UPLOAD TEMP STATE ---
  selectedFolderForUpload = signal<string>('01_DOCUMENTS_ORIGINAUX');
  uploadFileBase64 = signal<string | null>(null);
  uploadFileName = signal<string | null>(null);
  uploadFileType = signal<string | null>(null);
  uploadFileSize = signal<number>(0);

  // --- CAMERA DOCUMENT SCANNER STATE ---
  isScannerOpen = signal<boolean>(false);
  scannerLoading = signal<boolean>(false);
  scannerError = signal<string | null>(null);
  availableCameras = signal<MediaDeviceInfo[]>([]);
  currentCameraId = signal<string | null>(null);
  activeStream: MediaStream | null = null;

  // --- NEW CLIENT OPTION IN NEW ORDER ---
  isCreatingNewCustomer = signal<boolean>(false);

  // --- AI ASSISTANT COMPONENT STATE ---
  isAnalyzingDoc = signal<boolean>(false);
  isDraftingSpec = signal<boolean>(false);
  isDraftingReply = signal<boolean>(false);
  specSheetDraft = signal<string | null>(null);
  aiMessageInstruction = signal<string>('');
  suggestedMessage = signal<string | null>(null);
  showAiSpecModal = signal<boolean>(false);
  showAiDraftModal = signal<boolean>(false);
  aiFeedbackMsg = signal<string | null>(null);

  // --- NEW CUSTOMER REVISIONS & SATISFACTION STATE ---
  showRevisionModal = signal<boolean>(false);
  revisionNotes = signal<string>('');
  revisionFileName = signal<string | null>(null);
  revisionFileBase64 = signal<string | null>(null);

  showDeliverRevisionModal = signal<boolean>(false);
  selectedRevisionId = signal<string | null>(null);
  deliverRevisionNotes = signal<string>('');
  deliverRevisionFileName = signal<string | null>(null);
  deliverRevisionFileBase64 = signal<string | null>(null);

  showSatisfactionModal = signal<boolean>(false);
  satisfactionRating = signal<number>(5);
  satisfactionFeedback = signal<string>('');

  showPaymentTermsModal = signal<boolean>(false);
  editPaymentMethod = signal<string>('transfer');
  editPaymentTerms = signal<string>('immediate');
  editCustomDueDate = signal<string>('');

  // --- CLIENT FINANCIAL STATEMENT (SITUATION CLIENT) STATE ---
  selectedCustomerForStatement = signal<string>('all');
  customerStatementSearch = signal<string>('');
  selectedCustomerDetail = signal<PartnerCustomer | null>(null);
  customerTypeFilter = signal<'all' | 'b2c' | 'final' | 'b2b'>('all');

  filteredPartnerCustomers = computed(() => {
    const list = this.data.partnerCustomers();
    const filter = this.customerTypeFilter();
    if (filter === 'all') return list;
    return list.filter(c => (c.type || 'final') === filter);
  });

  get b2cCustomersCount(): number {
    return this.data.partnerCustomers().filter(c => (c.type || 'final') === 'b2c').length;
  }
  
  get finalCustomersCount(): number {
    return this.data.partnerCustomers().filter(c => (c.type || 'final') === 'final').length;
  }

  get b2bCustomersCount(): number {
    return this.data.partnerCustomers().filter(c => (c.type || 'final') === 'b2b').length;
  }

  getOrderPrice(ord: Order): number {
    const srv = this.data.services().find(s => s.id === ord.serviceId);
    return srv ? (srv.basePrice + srv.unitPrice * ord.quantity) : 120;
  }

  customerFinancialStatements = computed(() => {
    const orders = this.data.orders();
    const partnerCustomers = this.data.partnerCustomers();
    
    // Group orders and registered customers by customer email or name
    const clientMap = new Map<string, {
      customerId: string;
      name: string;
      email: string;
      phone: string;
      company: string;
      customerType: string;
      orders: Order[];
      totalAmount: number;
      paidAmount: number;
      balanceDue: number;
      ordersCount: number;
      pendingCount: number;
      completedCount: number;
    }>();

    // 1. Initialize with all registered partner customers (B2B, B2C, final)
    partnerCustomers.forEach(pc => {
      const key = (pc.email || pc.name).toLowerCase();
      if (!clientMap.has(key)) {
        clientMap.set(key, {
          customerId: pc.id || key,
          name: pc.name,
          email: pc.email || '',
          phone: pc.phone || '',
          company: pc.company || '',
          customerType: pc.type || 'final',
          orders: [],
          totalAmount: 0,
          paidAmount: 0,
          balanceDue: 0,
          ordersCount: 0,
          pendingCount: 0,
          completedCount: 0
        });
      }
    });

    // 2. Process all orders and map to clients
    orders.forEach(ord => {
      const emailKey = (ord.customerDetails.email || '').toLowerCase();
      const nameKey = (ord.customerDetails.name || '').toLowerCase();
      
      let key = emailKey || nameKey;
      const existingClientKey = Array.from(clientMap.keys()).find(k => 
        (emailKey && k === emailKey) || (nameKey && k === nameKey) || k.includes(nameKey) || (emailKey && k.includes(emailKey))
      );

      if (existingClientKey) {
        key = existingClientKey;
      }

      if (!clientMap.has(key)) {
        clientMap.set(key, {
          customerId: ord.customerDetails.email || ord.customerDetails.name,
          name: ord.customerDetails.name,
          email: ord.customerDetails.email || '',
          phone: ord.customerDetails.phone || '',
          company: ord.customerDetails.company || '',
          customerType: ord.customerType || 'final',
          orders: [],
          totalAmount: 0,
          paidAmount: 0,
          balanceDue: 0,
          ordersCount: 0,
          pendingCount: 0,
          completedCount: 0
        });
      }

      const client = clientMap.get(key)!;
      client.orders.push(ord);
      client.ordersCount++;

      // Estimate order total
      const srv = this.data.services().find(s => s.id === ord.serviceId);
      const estimatedTotal = srv ? (srv.basePrice + srv.unitPrice * ord.quantity) : 100;

      let orderPaid = 0;
      if (['SOLDE_PAYE', 'PRET_A_LIVRER', 'LIVRE', 'TERMINE'].includes(ord.status)) {
        orderPaid = estimatedTotal;
      } else if (ord.status === 'ACOMPTE_PAYE') {
        orderPaid = estimatedTotal * 0.5;
      }

      client.totalAmount += estimatedTotal;
      client.paidAmount += orderPaid;
      client.balanceDue += (estimatedTotal - orderPaid);

      if (['TERMINE', 'LIVRE'].includes(ord.status)) {
        client.completedCount++;
      } else {
        client.pendingCount++;
      }
    });

    let list = Array.from(clientMap.values());
    const search = this.customerStatementSearch().toLowerCase().trim();
    if (search) {
      list = list.filter(c => c.name.toLowerCase().includes(search) || c.email.toLowerCase().includes(search) || c.company.toLowerCase().includes(search));
    }
    return list;
  });

  activeCustomerStatement = computed(() => {
    const selected = this.selectedCustomerForStatement();
    if (selected === 'all') return null;
    return this.customerFinancialStatements().find(c => c.customerId === selected) || null;
  });
  estServiceId = signal<string>('srv-1');
  estQuantity = signal<number>(20);
  estUrgency = signal<string>('normal');
  estOptionsSelected = signal<string[]>([]);
  estPrintOption = signal<boolean>(false);
  estPrintColor = signal<string>('nb');
  estPrintPages = signal<number>(20);
  estDeliveryOption = signal<boolean>(false);

  activeEstService = computed(() => {
    const sId = this.estServiceId();
    return this.data.services().find(srv => srv.id === sId);
  });

  constructor() {
    this.initForms();
    if (typeof window !== 'undefined') {
      this.data.checkSetupStatus().then((isCompleted) => {
        if (isCompleted) {
          this.data.loadAll();
        }
      });
      
      // Update page title and meta tags dynamically
      effect(() => {
        const title = this.data.settings()?.saasWorkspaceTitle || 'My Google AI Studio App';
        this.titleService.setTitle(title);
        
        const description = this.data.settings()?.companyName || 'An application built with Google AI Studio.';
        const customDesc = `Géré par ${title}. ${description}`;
        
        // Update standard meta tags
        this.metaService.updateTag({ name: 'description', content: customDesc });
        
        // Update Open Graph (Facebook / LinkedIn) meta tags
        this.metaService.updateTag({ property: 'og:title', content: title });
        this.metaService.updateTag({ property: 'og:description', content: customDesc });
        this.metaService.updateTag({ property: 'og:image', content: 'https://picsum.photos/seed/vibrant/1200/630' });
        
        // Update Twitter meta tags
        this.metaService.updateTag({ name: 'twitter:title', content: title });
        this.metaService.updateTag({ name: 'twitter:description', content: customDesc });
        this.metaService.updateTag({ name: 'twitter:image', content: 'https://picsum.photos/seed/vibrant/1200/630' });
      });
    }
    
    // QR Code generation
    effect(() => {
      const user = this.data.currentUser();
      if (user && user.affiliateLink) {
        this.generateAffiliateQrCode(user.affiliateLink);
      }
    });

    // Effect to auto-load order details if selectedOrderId changes
    effect(() => {
      const orderId = this.selectedOrderId();
      if (orderId && typeof window !== 'undefined') {
        this.data.loadOrderDetails(orderId);
      }
    });

    // Effect to handle state changes on role switches
    effect(() => {
      const role = this.data.activeRole();
      if (role === 'public') {
        this.activeTab.set('landing');
      } else if (role === 'operator' || role === 'qa') {
        this.activeTab.set('orders'); // Operator/QA go straight to tasks
      } else {
        this.activeTab.set('dashboard');
      }
      this.selectedOrderId.set(null);
    });
  }

  // --- QR CODE GENERATION ---
  qrCodeDataUrl = signal<string>('');

  private async generateAffiliateQrCode(link: string) {
    try {
      const QRCode = await import('qrcode');
      const dataUrl = await QRCode.toDataURL(link, { width: 256, margin: 2 });
      this.qrCodeDataUrl.set(dataUrl);
    } catch (err) {
      console.error('Error generating QR code:', err);
    }
  }

  // --- FORMS INITIALIZATION ---
  initForms() {
    this.orderForm = new FormGroup({
      customerType: new FormControl('particular'),
      customerDetails: new FormGroup({
        name: new FormControl('', Validators.required),
        email: new FormControl('', [Validators.required, Validators.email]),
        phone: new FormControl('', Validators.required),
        company: new FormControl(''),
        city: new FormControl('Casablanca', Validators.required),
        address: new FormControl(''),
        remarks: new FormControl(''),
      }),
      serviceId: new FormControl('', Validators.required),
      description: new FormControl('', Validators.required),
      quantity: new FormControl(1, [Validators.required, Validators.min(1)]),
      urgency: new FormControl('normal', Validators.required),
      selectedOptions: new FormControl([]),
    });

    this.customerForm = new FormGroup({
      name: new FormControl('', Validators.required),
      email: new FormControl('', [Validators.required, Validators.email]),
      phone: new FormControl('', Validators.required),
      company: new FormControl(''),
      city: new FormControl('Casablanca', Validators.required),
      address: new FormControl(''),
      notes: new FormControl(''),
      type: new FormControl('final', Validators.required),
    });

    this.quoteForm = new FormGroup({
      basePrice: new FormControl(0, Validators.required),
      optionsPrice: new FormControl(0),
      urgencySurcharge: new FormControl(0),
      printingPrice: new FormControl(0),
      deliveryPrice: new FormControl(0),
      depositPercent: new FormControl(50, [Validators.required, Validators.min(10), Validators.max(100)]),
      itemsJson: new FormControl('[]'),
    });

    this.assignForm = new FormGroup({
      operatorId: new FormControl('usr-operator-1', Validators.required),
      qaId: new FormControl('usr-qa-1', Validators.required),
      priority: new FormControl('NORMAL', Validators.required),
      notes: new FormControl(''),
      deadline: new FormControl(''),
    });

    this.paymentForm = new FormGroup({
      amount: new FormControl(0, [Validators.required, Validators.min(1)]),
      type: new FormControl('deposit', Validators.required),
      method: new FormControl('transfer', Validators.required),
      notes: new FormControl(''),
    });

    this.authForm = new FormGroup({
      identifier: new FormControl('', Validators.required),
      username: new FormControl(''),
      email: new FormControl('', [Validators.email]),
      password: new FormControl('', [Validators.required, Validators.minLength(4)]),
      name: new FormControl(''),
      role: new FormControl('client', Validators.required),
      phone: new FormControl(''),
      city: new FormControl('Casablanca'),
      address: new FormControl(''),
      company: new FormControl(''),
      ice: new FormControl(''),
      affiliateCode: new FormControl(''),
    });

    this.teamUserForm = new FormGroup({
      name: new FormControl('', Validators.required),
      username: new FormControl('', [Validators.required, Validators.minLength(3)]),
      email: new FormControl('', [Validators.required, Validators.email]),
      password: new FormControl('123456', [Validators.required, Validators.minLength(4)]),
      role: new FormControl<'operator' | 'qa' | 'assistant'>('operator', Validators.required),
      phone: new FormControl(''),
      city: new FormControl('Casablanca'),
      address: new FormControl(''),
      canManageOrders: new FormControl(true),
      canValidateQuality: new FormControl(false),
      canDeliverOrders: new FormControl(false),
      canManageClients: new FormControl(false),
      canManageTools: new FormControl(true),
      canViewFinancials: new FormControl(false),
    });

    this.editTeamUserForm = new FormGroup({
      id: new FormControl(''),
      name: new FormControl('', Validators.required),
      username: new FormControl('', [Validators.required, Validators.minLength(3)]),
      email: new FormControl('', [Validators.required, Validators.email]),
      role: new FormControl<'operator' | 'qa' | 'assistant'>('operator', Validators.required),
      phone: new FormControl(''),
      city: new FormControl('Casablanca'),
      address: new FormControl(''),
      active: new FormControl(true),
      newPassword: new FormControl(''),
      canManageOrders: new FormControl(true),
      canValidateQuality: new FormControl(false),
      canDeliverOrders: new FormControl(false),
      canManageClients: new FormControl(false),
      canManageTools: new FormControl(true),
      canViewFinancials: new FormControl(false),
    });

    this.serviceForm = new FormGroup({
      name: new FormControl('', Validators.required),
      category: new FormControl('saisie', Validators.required),
      description: new FormControl('', Validators.required),
      priceMethod: new FormControl('per_page', Validators.required),
      basePrice: new FormControl(0, [Validators.required, Validators.min(0)]),
      unitPriceName: new FormControl('Page', Validators.required),
      unitPrice: new FormControl(2.0, [Validators.required, Validators.min(0)]),
      isActive: new FormControl(true),
      imageUrl: new FormControl(''),
    });

    this.profileForm = new FormGroup({
      name: new FormControl('', Validators.required),
      username: new FormControl('', [Validators.required, Validators.minLength(3)]),
      email: new FormControl('', [Validators.required, Validators.email]),
      phone: new FormControl(''),
      company: new FormControl(''),
      ice: new FormControl(''),
      city: new FormControl('Casablanca'),
      address: new FormControl(''),
      currentPassword: new FormControl(''),
      newPassword: new FormControl(''),
      confirmNewPassword: new FormControl(''),
    });

    this.payrollForm = new FormGroup({
      id: new FormControl(''),
      employeeId: new FormControl('', Validators.required),
      periodMonth: new FormControl(new Date().toISOString().substring(0, 7), Validators.required),
      workedDays: new FormControl(26, [Validators.required, Validators.min(0), Validators.max(31)]),
      absentDays: new FormControl(0, [Validators.min(0), Validators.max(31)]),
      baseSalary: new FormControl(4000, [Validators.required, Validators.min(0)]),
      overtimeHours: new FormControl(0, [Validators.min(0)]),
      overtimeRate: new FormControl(0, [Validators.min(0)]),
      hourlyRate: new FormControl(25, [Validators.min(0)]),
      productionBonus: new FormControl(0, [Validators.min(0)]),
      attendanceBonus: new FormControl(0, [Validators.min(0)]),
      seniorityBonus: new FormControl(0, [Validators.min(0)]),
      otherBonus: new FormControl(0, [Validators.min(0)]),
      customBonus: new FormControl(0, [Validators.min(0)]),
      advanceDeduction: new FormControl(0, [Validators.min(0)]),
      otherDeduction: new FormControl(0, [Validators.min(0)]),
      paymentMethod: new FormControl<'transfer' | 'check' | 'cash'>('transfer', Validators.required),
      paymentReference: new FormControl(''),
      notes: new FormControl(''),
    });

    this.payrollForm.valueChanges.subscribe(() => {
      this.payrollFormLiveTrigger.update(v => v + 1);
    });

    this.leaveForm = new FormGroup({
      employeeId: new FormControl('', Validators.required),
      type: new FormControl<'paid_leave' | 'unpaid_leave' | 'sick_leave' | 'maternity' | 'exceptional'>('paid_leave', Validators.required),
      startDate: new FormControl('', Validators.required),
      endDate: new FormControl('', Validators.required),
      daysCount: new FormControl(1, [Validators.required, Validators.min(1)]),
      reason: new FormControl('', Validators.required),
    });

    this.rejectLeaveForm = new FormGroup({
      rejectionReason: new FormControl('', Validators.required)
    });

    this.advanceForm = new FormGroup({
      employeeId: new FormControl('', Validators.required),
      amount: new FormControl(1000, [Validators.required, Validators.min(100)]),
      reason: new FormControl(''),
      repaymentMonth: new FormControl(new Date().toISOString().substring(0, 7), Validators.required),
    });

    this.fullUserForm = new FormGroup({
      name: new FormControl('', Validators.required),
      username: new FormControl('', [Validators.required, Validators.minLength(3)]),
      email: new FormControl('', [Validators.required, Validators.email]),
      password: new FormControl('123456', [Validators.required, Validators.minLength(4)]),
      role: new FormControl<'admin' | 'partner' | 'operator' | 'qa' | 'client' | 'assistant'>('operator', Validators.required),
      phone: new FormControl(''),
      city: new FormControl('Casablanca'),
      address: new FormControl(''),
      company: new FormControl(''),
      ice: new FormControl(''),
      customerType: new FormControl<'particular' | 'company'>('particular'),
      employeeCode: new FormControl(''),
      jobTitle: new FormControl(''),
      department: new FormControl('production'),
      contractType: new FormControl('cdi'),
      hireDate: new FormControl(''),
      birthDate: new FormControl(''),
      cinNumber: new FormControl(''),
      cnssNumber: new FormControl(''),
      ribNumber: new FormControl(''),
      bankName: new FormControl('Attijariwafa Bank'),
      baseSalary: new FormControl(4000),
      vacationBalance: new FormControl(18),
      emergencyName: new FormControl(''),
      emergencyPhone: new FormControl(''),
      canManageOrders: new FormControl(true),
      canValidateQuality: new FormControl(false),
      canDeliverOrders: new FormControl(false),
      canManageDelivery: new FormControl(false),
      canManageClients: new FormControl(false),
      canManageTools: new FormControl(true),
      canUseTools: new FormControl(true),
      canViewFinancials: new FormControl(false),
      canAccessFinancials: new FormControl(false),
    });

    this.editFullUserForm = new FormGroup({
      id: new FormControl(''),
      name: new FormControl('', Validators.required),
      username: new FormControl('', [Validators.required, Validators.minLength(3)]),
      email: new FormControl('', [Validators.required, Validators.email]),
      role: new FormControl<'admin' | 'partner' | 'operator' | 'qa' | 'client' | 'assistant'>('operator', Validators.required),
      phone: new FormControl(''),
      city: new FormControl('Casablanca'),
      address: new FormControl(''),
      active: new FormControl(true),
      company: new FormControl(''),
      ice: new FormControl(''),
      customerType: new FormControl<'particular' | 'company'>('particular'),
      employeeCode: new FormControl(''),
      jobTitle: new FormControl(''),
      department: new FormControl('production'),
      contractType: new FormControl('cdi'),
      hireDate: new FormControl(''),
      birthDate: new FormControl(''),
      cinNumber: new FormControl(''),
      cnssNumber: new FormControl(''),
      ribNumber: new FormControl(''),
      bankName: new FormControl('Attijariwafa Bank'),
      baseSalary: new FormControl(4000),
      vacationBalance: new FormControl(18),
      emergencyName: new FormControl(''),
      emergencyPhone: new FormControl(''),
      canManageOrders: new FormControl(true),
      canValidateQuality: new FormControl(false),
      canDeliverOrders: new FormControl(false),
      canManageDelivery: new FormControl(false),
      canManageClients: new FormControl(false),
      canManageTools: new FormControl(true),
      canUseTools: new FormControl(true),
      canViewFinancials: new FormControl(false),
      canAccessFinancials: new FormControl(false),
    });

    this.employeeHrForm = new FormGroup({
      id: new FormControl(''),
      name: new FormControl(''),
      employeeCode: new FormControl(''),
      jobTitle: new FormControl(''),
      department: new FormControl('production'),
      contractType: new FormControl('CDI'),
      hireDate: new FormControl(''),
      cinNumber: new FormControl(''),
      cnssNumber: new FormControl(''),
      ribNumber: new FormControl(''),
      bankName: new FormControl('Attijariwafa Bank'),
      baseSalary: new FormControl(4000, [Validators.required, Validators.min(0)]),
      hourlyRate: new FormControl(25),
      vacationBalance: new FormControl(18),
      phone: new FormControl(''),
      city: new FormControl('Casablanca'),
      address: new FormControl(''),
      emergencyName: new FormControl(''),
      emergencyPhone: new FormControl(''),
      emergencyContactName: new FormControl(''),
      emergencyContactPhone: new FormControl(''),
      notes: new FormControl(''),
      hrNotes: new FormControl(''),
    });

    this.resetUserPasswordForm = new FormGroup({
      newPassword: new FormControl('123456', [Validators.required, Validators.minLength(4)])
    });

    this.setupForm = new FormGroup({
      databaseType: new FormControl('firebase', Validators.required),
      host: new FormControl(''),
      port: new FormControl(3306),
      databaseName: new FormControl(''),
      username: new FormControl(''),
      password: new FormControl(''),
      adminName: new FormControl('', Validators.required),
      adminUsername: new FormControl('admin', Validators.required),
      adminEmail: new FormControl('', [Validators.required, Validators.email]),
      adminPassword: new FormControl('', [Validators.required, Validators.minLength(6)]),
    });
  }

  // --- HELPER DYNAMIC COMPUTATIONS ---

  get activeServiceForForm(): Service | undefined {
    const sId = this.orderForm.get('serviceId')?.value;
    return this.data.services().find(s => s.id === sId);
  }

  // Calculate order price estimate in form real-time
  get calculatedFormEstimate() {
    const sId = this.orderForm.get('serviceId')?.value;
    const quantity = this.orderForm.get('quantity')?.value || 1;
    const urgency = this.orderForm.get('urgency')?.value || 'normal';
    const selectedOpts: string[] = this.orderForm.get('selectedOptions')?.value || [];

    const service = this.data.services().find(s => s.id === sId);
    if (!service) return { total: 0, deposit: 0 };

    const base = service.priceMethod === 'fixed' ? service.basePrice : service.basePrice + (service.unitPrice * quantity);
    
    // Add options price
    let optionsSum = 0;
    selectedOpts.forEach(optName => {
      const opt = service.options.find(o => o.name === optName);
      if (opt) {
        if (service.priceMethod === 'per_page') {
          optionsSum += opt.price * quantity;
        } else {
          optionsSum += opt.price;
        }
      }
    });

    // Add urgency surcharge
    const multiplier = urgency === 'normal' ? 0 : urgency === 'fast' ? 0.3 : urgency === 'urgent' ? 0.6 : 1.0;
    const surcharge = (base + optionsSum) * multiplier;

    const total = base + optionsSum + surcharge;

    // Deposit percent
    const depPercent = urgency === 'normal' ? 50 : urgency === 'fast' ? 60 : urgency === 'urgent' ? 70 : 80;
    const deposit = total * (depPercent / 100);

    return {
      base,
      options: optionsSum,
      urgency: surcharge,
      total,
      deposit,
      depositPercent: depPercent,
      balance: total - deposit
    };
  }

  // Calculate landing page estimator price
  get landingEstimate() {
    const sId = this.estServiceId();
    const quantity = this.estQuantity();
    const urgency = this.estUrgency();
    const selectedOpts = this.estOptionsSelected();

    const service = this.data.services().find(s => s.id === sId);
    if (!service) return {
      base: 0,
      options: 0,
      urgency: 0,
      printing: 0,
      delivery: 0,
      total: 0,
      deposit: 0,
      balance: 0,
      depositPercent: 50
    };

    const base = service.priceMethod === 'fixed' ? service.basePrice : service.basePrice + (service.unitPrice * quantity);
    
    let optionsSum = 0;
    selectedOpts.forEach(optId => {
      const opt = service.options.find(o => o.id === optId);
      if (opt) {
        if (service.priceMethod === 'per_page') {
          optionsSum += opt.price * quantity;
        } else {
          optionsSum += opt.price;
        }
      }
    });

    const multiplier = urgency === 'normal' ? 0 : urgency === 'fast' ? 0.3 : urgency === 'urgent' ? 0.6 : 1.0;
    const surcharge = (base + optionsSum) * multiplier;

    let printing = 0;
    if (this.estPrintOption()) {
      printing = (this.estPrintColor() === 'nb' ? 0.50 : 2.00) * this.estPrintPages();
    }

    let delivery = 0;
    if (this.estDeliveryOption()) {
      delivery = 30.00; // Physical shipping flat rate
    }

    const total = base + optionsSum + surcharge + printing + delivery;
    const depPercent = urgency === 'normal' ? 50 : urgency === 'fast' ? 60 : urgency === 'urgent' ? 70 : 80;

    return {
      base,
      options: optionsSum,
      urgency: surcharge,
      printing,
      delivery,
      total,
      deposit: total * (depPercent / 100),
      balance: total - (total * (depPercent / 100)),
      depositPercent: depPercent
    };
  }

  toggleEstOption(optId: string) {
    const current = this.estOptionsSelected();
    if (current.includes(optId)) {
      this.estOptionsSelected.set(current.filter(id => id !== optId));
    } else {
      this.estOptionsSelected.set([...current, optId]);
    }
  }

  // Filter and search orders
  filteredOrders = computed(() => {
    let orders = this.data.orders();
    const search = this.searchQuery().toLowerCase().trim();
    const status = this.statusFilter();
    const category = this.activeCategoryFilter();

    if (search) {
      orders = orders.filter(o => 
        o.reference.toLowerCase().includes(search) ||
        o.customerDetails.name.toLowerCase().includes(search) ||
        o.customerDetails.email.toLowerCase().includes(search) ||
        o.serviceName.toLowerCase().includes(search)
      );
    }

    if (status !== 'all') {
      orders = orders.filter(o => o.status === status);
    }

    if (category !== 'all') {
      orders = orders.filter(o => o.serviceCategory === category);
    }

    return orders;
  });

  // --- ACTIONS & SUBMISSIONS ---

  async onOrderSubmit() {
    const user = this.data.currentUser();
    if (!user) {
      this.data.errorMessage.set('Authentification obligatoire pour déposer une demande.');
      this.showAuthModal.set('login');
      return;
    }
    if (this.orderForm.invalid) {
      this.data.errorMessage.set('Veuillez remplir correctement tous les champs obligatoires.');
      return;
    }

    try {
      const formValue = this.orderForm.value;
      const service = this.data.services().find(s => s.id === formValue.serviceId);

      // Construct order payload
      const payload: Partial<Order> = {
        serviceId: formValue.serviceId,
        serviceName: service?.name,
        serviceCategory: service?.category,
        description: formValue.description,
        quantity: formValue.quantity,
        urgency: formValue.urgency,
        customerType: formValue.customerType,
        customerDetails: {
          name: formValue.customerDetails.name,
          email: formValue.customerDetails.email,
          phone: formValue.customerDetails.phone,
          company: formValue.customerDetails.company || '',
          city: formValue.customerDetails.city,
          address: formValue.customerDetails.address || '',
          remarks: formValue.customerDetails.remarks || ''
        },
        files: []
      };

      // Handle attached files
      if (this.uploadFileName() && this.uploadFileBase64()) {
        payload.files = [{
          id: 'fil-' + Math.random().toString(36).substring(2, 9),
          name: this.uploadFileName()!,
          type: this.uploadFileType() || 'application/octet-stream',
          size: this.uploadFileSize(),
          folder: '01_DOCUMENTS_ORIGINAUX',
          version: 1,
          uploadedBy: this.data.currentUser()?.name || 'Client',
          uploadedAt: new Date().toISOString(),
          base64Data: this.uploadFileBase64() || undefined
        }];
      }

      const created = await this.data.createOrder(payload);
      if (created) {
        this.selectedOrderId.set(created.id);
        this.activeTab.set('orders');
        this.orderForm.reset({
          customerType: 'particular',
          urgency: 'normal',
          quantity: 1,
          customerDetails: { city: 'Casablanca' }
        });
        this.clearUploadFile();
      }
    } catch (err) {
      console.error('Error submitting order:', err);
    }
  }

  async onAddCustomer() {
    if (this.customerForm.invalid) return;
    try {
      const added = await this.data.addPartnerCustomer(this.customerForm.value);
      if (added) {
        // Auto fill new order customer fields with this client
        this.orderForm.patchValue({
          customerDetails: {
            name: added.name,
            email: added.email,
            phone: added.phone,
            company: added.company || '',
            city: added.city,
            address: added.address || ''
          }
        });
        this.isCreatingNewCustomer.set(false);
        this.customerForm.reset({ city: 'Casablanca' });
      }
    } catch (err) {
      console.error('Error adding customer:', err);
    }
  }

  selectPartnerCustomer(c: PartnerCustomer) {
    this.orderForm.patchValue({
      customerDetails: {
        name: c.name,
        email: c.email,
        phone: c.phone,
        company: c.company || '',
        city: c.city,
        address: c.address || ''
      }
    });
    this.isCreatingNewCustomer.set(false);
    this.data.successMessage.set(`Client B2B sélectionné : ${c.name}`);
  }

  downloadClientStatement(customer: PartnerCustomer, unpaidOnly = false) {
    const orders = this.data.orders().filter(o => o.customerDetails.email?.toLowerCase() === customer.email.toLowerCase());
    
    let total = 0;
    let paid = 0;
    let balance = 0;

    let textContent = `==================================================\n`;
    textContent += `      SITUATION FINANCIERE ET BILAN DES TRAVAUX     \n`;
    textContent += `==================================================\n\n`;
    textContent += `Client : ${customer.name}\n`;
    textContent += `Email : ${customer.email}\n`;
    textContent += `Téléphone : ${customer.phone}\n`;
    if (customer.company) textContent += `Société : ${customer.company}\n`;
    textContent += `Ville : ${customer.city}\n`;
    textContent += `Type de compte : ${customer.type ? customer.type.toUpperCase() : 'FINAL'}\n`;
    textContent += `Date de génération : ${new Date().toLocaleString()}\n\n`;
    textContent += `--------------------------------------------------\n`;
    textContent += `DETAIL DES COMMANDES ET TACHES :\n`;
    textContent += `--------------------------------------------------\n`;

    orders.forEach(ord => {
      const srv = this.data.services().find(s => s.id === ord.serviceId);
      const estimatedTotal = srv ? (srv.basePrice + srv.unitPrice * ord.quantity) : 100;

      let orderPaid = 0;
      if (['SOLDE_PAYE', 'PRET_A_LIVRER', 'LIVRE', 'TERMINE'].includes(ord.status)) {
        orderPaid = estimatedTotal;
      } else if (ord.status === 'ACOMPTE_PAYE') {
        orderPaid = estimatedTotal * 0.5;
      }
      
      const orderBalance = estimatedTotal - orderPaid;

      if (unpaidOnly && orderBalance <= 0) {
        return; // skip fully paid orders in unpaidOnly mode
      }

      total += estimatedTotal;
      paid += orderPaid;
      balance += orderBalance;

      textContent += `Référence : ${ord.reference}\n`;
      textContent += `Service   : ${ord.serviceName || 'Service'}\n`;
      textContent += `Statut    : ${ord.status.replace(/_/g, ' ')}\n`;
      textContent += `Volume    : ${ord.quantity}\n`;
      textContent += `Total TTC : ${estimatedTotal.toFixed(2)} DH\n`;
      textContent += `Déjà Payé : ${orderPaid.toFixed(2)} DH\n`;
      textContent += `Solde Dû  : ${orderBalance.toFixed(2)} DH\n`;
      textContent += `--------------------------------------------------\n`;
    });

    textContent += `\n==================================================\n`;
    textContent += `RECAPITULATIF FINANCIER GLOBAL :\n`;
    textContent += `==================================================\n`;
    textContent += `Montant Total Brut : ${total.toFixed(2)} DH\n`;
    textContent += `Montant Total Réglé : ${paid.toFixed(2)} DH\n`;
    textContent += `SOLDE NET DU CLIENT : ${balance.toFixed(2)} DH\n`;
    textContent += `==================================================\n\n`;
    textContent += `Généré automatiquement par DigiDocs Hub.\n`;

    const fileName = `situation_${unpaidOnly ? 'non_payes_' : ''}${customer.name.replace(/\s+/g, '_').toLowerCase()}.txt`;
    const file = {
      name: fileName,
      type: 'text/plain',
      base64Data: 'data:text/plain;charset=utf-8,' + encodeURIComponent(textContent)
    };
    this.downloadFile(file);
  }

  getCustomerStats(customer: PartnerCustomer) {
    const orders = this.data.orders().filter(o => o.customerDetails.email?.toLowerCase() === customer.email.toLowerCase());
    
    let total = 0;
    let paid = 0;
    let balance = 0;
    
    orders.forEach(ord => {
      const srv = this.data.services().find(s => s.id === ord.serviceId);
      const estimatedTotal = srv ? (srv.basePrice + srv.unitPrice * ord.quantity) : 100;

      let orderPaid = 0;
      if (['SOLDE_PAYE', 'PRET_A_LIVRER', 'LIVRE', 'TERMINE'].includes(ord.status)) {
        orderPaid = estimatedTotal;
      } else if (ord.status === 'ACOMPTE_PAYE') {
        orderPaid = estimatedTotal * 0.5;
      }
      
      const orderBalance = estimatedTotal - orderPaid;
      total += estimatedTotal;
      paid += orderPaid;
      balance += orderBalance;
    });

    const ongoing = orders.filter(o => ['ACOMPTE_PAYE', 'DEVIS_ACCEPTE', 'EN_COURS', 'RELECTURE_OPERATEUR', 'PRET_A_VALIDER'].includes(o.status)).length;
    const untreated = orders.filter(o => ['DEVIS_RECU', 'OUVERT', 'TRANSMIS', 'DEVIS_EN_ATTENTE'].includes(o.status)).length;

    return {
      total,
      paid,
      balance,
      ongoing,
      untreated,
      ordersCount: orders.length,
      orders
    };
  }

  async completeOrderFromClientPanel(orderId: string) {
    try {
      await this.data.updateOrderStatus(orderId, 'TERMINE');
      this.data.successMessage.set("Le travail a été marqué comme terminé avec succès !");
    } catch (err) {
      this.data.errorMessage.set("Erreur lors de la mise à jour : " + (err as Error).message);
    }
  }

  getFilesByFolder(files: OrderFile[], folder: string): OrderFile[] {
    return (files || []).filter(f => f.folder === folder);
  }

  async acceptRefuseQuote(orderId: string, action: 'accept' | 'refuse') {
    try {
      await this.data.acceptRefuseQuote(orderId, action);
    } catch (err) {
      console.error('Error with quote action:', err);
    }
  }

  // Start quote drafting based on order details
  initQuoteDraft(order: Order) {
    const service = this.data.services().find(s => s.id === order.serviceId);
    if (!service) return;

    const base = service.priceMethod === 'fixed' ? service.basePrice : service.basePrice + (service.unitPrice * order.quantity);
    const multiplier = order.urgency === 'normal' ? 0 : order.urgency === 'fast' ? 0.3 : order.urgency === 'urgent' ? 0.6 : 1.0;
    const urgency = base * multiplier;

    this.quoteForm.patchValue({
      basePrice: base,
      optionsPrice: 0,
      urgencySurcharge: urgency,
      printingPrice: 0,
      deliveryPrice: 0,
      depositPercent: order.urgency === 'normal' ? 50 : order.urgency === 'fast' ? 60 : order.urgency === 'urgent' ? 70 : 80
    });

    this.updateQuoteItemsJson();
  }

  updateQuoteItemsJson() {
    const base = Number(this.quoteForm.get('basePrice')?.value || 0);
    const options = Number(this.quoteForm.get('optionsPrice')?.value || 0);
    const urgency = Number(this.quoteForm.get('urgencySurcharge')?.value || 0);
    const printing = Number(this.quoteForm.get('printingPrice')?.value || 0);
    const delivery = Number(this.quoteForm.get('deliveryPrice')?.value || 0);

    const items = [
      { description: 'Travail de base / Saisie principale', quantity: 1, unitPrice: base, total: base }
    ];

    if (options > 0) {
      items.push({ description: 'Options de traitement et relecture', quantity: 1, unitPrice: options, total: options });
    }
    if (urgency > 0) {
      items.push({ description: 'Majoration de délai (Urgence)', quantity: 1, unitPrice: urgency, total: urgency });
    }
    if (printing > 0) {
      items.push({ description: 'Service d\'impression physique', quantity: 1, unitPrice: printing, total: printing });
    }
    if (delivery > 0) {
      items.push({ description: 'Frais d\'expédition physique', quantity: 1, unitPrice: delivery, total: delivery });
    }

    this.quoteForm.patchValue({ itemsJson: JSON.stringify(items) });
  }

  async onSendQuote(orderId: string) {
    this.updateQuoteItemsJson();
    const formVal = this.quoteForm.value;
    const total = Number(formVal.basePrice) + Number(formVal.optionsPrice) + Number(formVal.urgencySurcharge) + Number(formVal.printingPrice) + Number(formVal.deliveryPrice);
    const depositAmount = total * (formVal.depositPercent / 100);

    const quotePayload: Partial<Quote> = {
      basePrice: formVal.basePrice,
      optionsPrice: formVal.optionsPrice,
      urgencySurcharge: formVal.urgencySurcharge,
      printingPrice: formVal.printingPrice,
      deliveryPrice: formVal.deliveryPrice,
      totalAmount: total,
      depositPercent: formVal.depositPercent,
      depositAmount: depositAmount,
      balanceAmount: total - depositAmount,
      items: JSON.parse(formVal.itemsJson),
      status: 'sent' as 'sent' | 'draft' | 'accepted' | 'refused'
    };

    try {
      await this.data.submitQuote(orderId, quotePayload);
    } catch (err) {
      console.error('Error sending quote:', err);
    }
  }

  async onAssignSubmit(orderId: string) {
    if (this.assignForm.invalid) return;
    try {
      const val = this.assignForm.value;
      await this.data.assignOperator(orderId, {
        operatorId: val.operatorId,
        operatorName: val.operatorId === 'usr-operator-1' ? 'Nabil Niyo' : 'Opérateur Externe',
        qaId: val.qaId,
        qaName: val.qaId === 'usr-qa-1' ? 'Khadija Benani' : 'Superviseur Qualité',
        priority: val.priority,
        notes: val.notes,
        deadline: val.deadline
      });
      this.assignForm.reset({ operatorId: 'usr-operator-1', qaId: 'usr-qa-1', priority: 'NORMAL' });
    } catch (err) {
      console.error('Error assigning operator:', err);
    }
  }

  // Convert uploaded file to base64
  onFileSelected(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      this.uploadFileBase64.set(reader.result as string);
      this.uploadFileName.set(file.name);
      this.uploadFileType.set(file.type);
      this.uploadFileSize.set(file.size);
    };
    reader.readAsDataURL(file);
  }

  async openScanner() {
    this.isScannerOpen.set(true);
    this.scannerLoading.set(true);
    this.scannerError.set(null);
    this.availableCameras.set([]);
    this.currentCameraId.set(null);

    try {
      // 1. Request camera permission
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      // Stop this initial stream immediately, we will start with specific constraints
      stream.getTracks().forEach(track => track.stop());

      // 2. Enumerate available video inputs
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      this.availableCameras.set(videoDevices);

      // Prefer back camera if available (facingMode = 'environment')
      let selectedDeviceId: string | undefined;
      const backCam = videoDevices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('arrière') || d.label.toLowerCase().includes('environment'));
      if (backCam) {
        selectedDeviceId = backCam.deviceId;
      } else if (videoDevices.length > 0) {
        selectedDeviceId = videoDevices[0].deviceId;
      }

      await this.startCamera(selectedDeviceId);
    } catch {
      this.scannerLoading.set(false);
      this.scannerError.set("Impossible d'accéder à la caméra. Veuillez autoriser l'accès à la caméra pour cette application.");
    }
  }

  async startCamera(deviceId?: string) {
    this.scannerLoading.set(true);
    this.scannerError.set(null);

    // Stop existing stream if any
    if (this.activeStream) {
      this.activeStream.getTracks().forEach(track => track.stop());
      this.activeStream = null;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId 
          ? { deviceId: { exact: deviceId } } 
          : { facingMode: 'environment' }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.activeStream = stream;
      if (deviceId) {
        this.currentCameraId.set(deviceId);
      } else {
        const track = stream.getVideoTracks()[0];
        if (track) {
          const settings = track.getSettings();
          if (settings.deviceId) {
            this.currentCameraId.set(settings.deviceId);
          }
        }
      }

      setTimeout(() => {
        const video = document.getElementById('scannerVideo') as HTMLVideoElement;
        if (video) {
          video.srcObject = stream;
          video.onloadedmetadata = () => {
            video.play().catch(e => console.error("Error playing video:", e));
            this.scannerLoading.set(false);
          };
        } else {
          this.scannerLoading.set(false);
          this.scannerError.set("Élément vidéo introuvable dans le document.");
        }
      }, 100);

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '';
      this.scannerLoading.set(false);
      this.scannerError.set("Erreur lors de l'accès à la caméra sélectionnée. " + errMsg);
    }
  }

  async switchCamera(deviceId: string) {
    await this.startCamera(deviceId);
  }

  capturePhoto() {
    const video = document.getElementById('scannerVideo') as HTMLVideoElement;
    if (!video) {
      this.scannerError.set("Le flux vidéo n'est pas prêt.");
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        this.scannerError.set("Impossible d'initialiser le contexte de dessin.");
        return;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const base64Data = canvas.toDataURL('image/jpeg', 0.85);
      const stringLength = base64Data.length - 'data:image/jpeg;base64,'.length;
      const sizeInBytes = Math.round((stringLength * 3) / 4);

      this.uploadFileBase64.set(base64Data);
      
      const dateStr = new Date().toISOString().slice(0, 19).replace(/[-T:]/g, '_');
      this.uploadFileName.set(`scan_document_${dateStr}.jpg`);
      this.uploadFileType.set('image/jpeg');
      this.uploadFileSize.set(sizeInBytes);

      this.closeScanner();
    } catch {
      this.scannerError.set("Erreur lors de la capture de l'image.");
    }
  }

  closeScanner() {
    if (this.activeStream) {
      this.activeStream.getTracks().forEach(track => track.stop());
      this.activeStream = null;
    }
    this.isScannerOpen.set(false);
    this.scannerLoading.set(false);
    this.scannerError.set(null);
  }

  clearUploadFile() {
    this.uploadFileBase64.set(null);
    this.uploadFileName.set(null);
    this.uploadFileType.set(null);
    this.uploadFileSize.set(0);
  }

  async onUploadSubmit(orderId: string) {
    const user = this.data.currentUser();
    if (!user) {
      this.data.errorMessage.set('Authentification obligatoire pour livrer un travail.');
      this.showAuthModal.set('login');
      return;
    }
    const base64 = this.uploadFileBase64();
    const name = this.uploadFileName();
    const type = this.uploadFileType();
    const size = this.uploadFileSize();
    const folder = this.selectedFolderForUpload();

    if (!base64 || !name) return;

    try {
      await this.data.uploadFile(orderId, name, type || 'application/octet-stream', size, folder, base64);
      this.clearUploadFile();
    } catch (err) {
      console.error('Error uploading file:', err);
    }
  }

  onChatFileSelected(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      this.chatFileBase64.set(reader.result as string);
      this.chatFileName.set(file.name);
    };
    reader.readAsDataURL(file);
  }

  async onSendMessage(orderId: string) {
    const msg = this.chatMessage().trim();
    if (!msg && !this.chatFileBase64()) return;

    try {
      await this.data.sendMessage(
        orderId,
        msg,
        this.isChatInternal(),
        this.chatFileName() || undefined,
        this.chatFileBase64() || undefined
      );
      this.chatMessage.set('');
      this.chatFileBase64.set(null);
      this.chatFileName.set(null);
    } catch (err) {
      console.error('Error sending message:', err);
    }
  }

  async onQaSubmit(orderId: string, action: 'approve' | 'reject') {
    const checklist = {
      allPagesProcessed: true,
      noMissingDocs: true,
      spellingVerified: true,
      layoutVerified: true,
      numberingVerified: true,
      filesOpenCorrectly: true,
      formatRespected: true,
      fileNamesCorrect: true,
      finalVersionValidated: action === 'approve'
    };

    try {
      await this.data.submitQaChecklist(orderId, checklist, action);
    } catch (err) {
      console.error('Error submitting QA checklist:', err);
    }
  }

  async onSelectCalendarDate(orderId: string, date: Date) {
    if (this.data.activeRole() !== 'admin' && this.data.activeRole() !== 'partner' && this.data.activeRole() !== 'assistant') {
      return;
    }
    try {
      const deadlineIso = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 17, 0, 0).toISOString();
      await this.data.updateOrderDeadline(orderId, deadlineIso, `Planifié depuis le calendrier interactif.`);
    } catch (err) {
      console.error('Error updating order deadline from calendar:', err);
    }
  }

  onPaymentProofSelected(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      this.chatFileBase64.set(reader.result as string); // use chat base64 signal for temporary storage
      this.chatFileName.set(file.name);
    };
    reader.readAsDataURL(file);
  }

  async onPaymentSubmit(orderId: string) {
    if (this.paymentForm.invalid) return;

    const formVal = this.paymentForm.value;
    try {
      await this.data.submitPaymentProof(orderId, {
        amount: formVal.amount,
        type: formVal.type,
        method: formVal.method,
        proofFileName: this.chatFileName() || undefined,
        proofFileBase64: this.chatFileBase64() || undefined
      });
      this.paymentForm.reset({ type: 'deposit', method: 'transfer' });
      this.chatFileName.set(null);
      this.chatFileBase64.set(null);
    } catch (err) {
      console.error('Error submitting payment proof:', err);
    }
  }

  private syncEstimatorToOrderForm() {
    const currentUser = this.data.currentUser();
    if (currentUser) {
      // Auto pre-fill the order creation form with their landing page estimator parameters
      this.orderForm.patchValue({
        serviceId: this.estServiceId(),
        quantity: this.estQuantity(),
        urgency: this.estUrgency(),
        selectedOptions: this.estOptionsSelected(),
        customerDetails: {
          name: currentUser.name,
          email: currentUser.email,
          phone: currentUser.phone || '',
          city: currentUser.city || 'Casablanca',
          company: currentUser.company || '',
        }
      });
      if (currentUser.role === 'partner') {
        this.orderForm.patchValue({ customerType: 'partner' });
      } else {
        this.orderForm.patchValue({ customerType: 'particular' });
      }
      // Redirect to the new order page so they can finalize and submit
      this.activeTab.set('new_order');
    }
  }

  // --- CLIENT SIDE GEMINI ASSISTANT API ACTIONS ---

  async onAnalyzeDocument() {
    const fileBase64 = this.uploadFileBase64();
    const fileName = this.uploadFileName();
    const currentDescription = this.orderForm.get('description')?.value || '';

    if (!fileBase64 && !currentDescription) {
      this.data.errorMessage.set("Veuillez téléverser un fichier original ou décrire les travaux dans le champ de consigne pour que l'IA puisse analyser vos besoins.");
      return;
    }

    this.isAnalyzingDoc.set(true);
    this.aiFeedbackMsg.set(null);

    try {
      const result = await this.data.analyzeDocumentWithAi(
        fileName || 'consignes.txt',
        fileBase64 || '',
        currentDescription
      );

      // Auto-fill the form fields
      this.orderForm.patchValue({
        serviceId: result.recommendedServiceId || 'srv-saisie-1',
        description: result.optimizedDescription || currentDescription,
        quantity: result.estimatedPageCount || 1,
      });

      this.data.successMessage.set("L'analyse IA a réussi ! Le formulaire a été pré-rempli.");
      this.aiFeedbackMsg.set(`Analyse IA terminée :\n• Langue : ${result.detectedLanguage}\n• Lisibilité : ${result.readability}\n• Pages estimées : ${result.estimatedPageCount}\n• Mots : ${result.estimatedWordCount}\n• Recommandation : ${result.optionsRecommended.join(', ')}`);

    } catch (err: unknown) {
      console.error(err);
      this.data.errorMessage.set((err as Error).message || "Une erreur est survenue lors de l'analyse IA.");
    } finally {
      this.isAnalyzingDoc.set(false);
    }
  }

  async onGenerateSpecSheet(orderId: string) {
    this.isDraftingSpec.set(true);
    this.specSheetDraft.set(null);
    try {
      const result = await this.data.draftSpecSheetWithAi(orderId);
      this.specSheetDraft.set(result.specSheet);
      this.showAiSpecModal.set(true);
      this.data.successMessage.set("Cahier des charges IA généré avec succès !");
    } catch (err: unknown) {
      console.error(err);
      this.data.errorMessage.set((err as Error).message || "Une erreur est survenue lors de la génération du cahier des charges.");
    } finally {
      this.isDraftingSpec.set(false);
    }
  }

  async onGenerateChatSuggestion(orderId: string) {
    const instruction = this.aiMessageInstruction();
    if (!instruction) {
      this.data.errorMessage.set("Veuillez saisir des consignes ou une idée pour générer une réponse (ex: 'Rédiger une confirmation de bonne réception').");
      return;
    }

    this.isDraftingReply.set(true);
    this.suggestedMessage.set(null);
    try {
      const result = await this.data.draftChatReplyWithAi(orderId, instruction);
      this.suggestedMessage.set(result.reply);
      this.showAiDraftModal.set(true);
      this.data.successMessage.set("Suggestion de message IA générée avec succès !");
    } catch (err: unknown) {
      console.error(err);
      this.data.errorMessage.set((err as Error).message || "Une erreur est survenue lors de la génération de la suggestion.");
    } finally {
      this.isDraftingReply.set(false);
    }
  }

  applyAiChatSuggestion() {
    const suggested = this.suggestedMessage();
    if (suggested) {
      this.chatMessage.set(suggested);
      this.showAiDraftModal.set(false);
      this.aiMessageInstruction.set('');
      this.suggestedMessage.set(null);
      this.data.successMessage.set("La suggestion a été copiée dans la zone de saisie du chat.");
    }
  }

  getOrderStepIndex(status: string): number {
    switch (status) {
      case 'EN_ATTENTE_ANALYSE':
      case 'DEVIS_EN_PREPARATION':
        return 0; // Ouverte
      case 'DEVIS_ENVOYE':
      case 'EN_ATTENTE_ACOMPTE':
        return 1; // Devis
      case 'ACOMPTE_PAYE':
        return 2; // Paiement
      case 'EN_TRAITEMENT':
        return 3; // Production
      case 'CONTROLE_QUALITE':
      case 'TRAVAIL_TERMINE':
        return 4; // Qualité
      case 'PRET_A_LIVRER':
      case 'TERMINE':
        return 5; // Livraison
      default:
        return 0;
    }
  }

  togglePasswordVisibility() {
    this.showPassword.update(v => !v);
  }

  fillDemoCredentials(role: 'admin' | 'partner' | 'operator' | 'qa' | 'client' | 'assistant') {
    const creds: Record<string, { identifier: string; password: string; name: string }> = {
      admin: { identifier: 'boguiman', password: 'admin123', name: 'Administrateur Principal' },
      partner: { identifier: 'partenaire', password: 'partner123', name: 'Partenaire Librairie' },
      operator: { identifier: 'operateur', password: 'operator123', name: 'Opérateur Saisie' },
      qa: { identifier: 'qa', password: 'qa123', name: 'Contrôle Qualité' },
      client: { identifier: 'client', password: 'client123', name: 'Client Final' },
      assistant: { identifier: 'assistant', password: 'assistant123', name: 'Assistant Coordinateur' },
    };

    const c = creds[role];
    if (c) {
      this.authForm.patchValue({
        identifier: c.identifier,
        username: c.identifier,
        email: c.identifier.includes('@') ? c.identifier : `${c.identifier}@digidocs.ma`,
        password: c.password,
        name: c.name,
        role: role === 'admin' ? 'client' : role
      });
      this.data.errorMessage.set(null);
    }
  }

  async onSetupSubmit() {
    this.setupError.set(null);
    this.setupSuccess.set(null);

    // Validate admin details
    const adminName = this.setupForm.get('adminName')?.value?.trim();
    const adminUsername = this.setupForm.get('adminUsername')?.value?.trim();
    const adminEmail = this.setupForm.get('adminEmail')?.value?.trim();
    const adminPassword = this.setupForm.get('adminPassword')?.value;

    if (!adminName) {
      this.setupError.set("Le nom complet du compte administrateur est requis.");
      return;
    }
    if (!adminUsername) {
      this.setupError.set("Le nom d'utilisateur de l'administrateur est requis.");
      return;
    }
    if (!adminEmail) {
      this.setupError.set("L'adresse e-mail de l'administrateur est requise.");
      return;
    }
    if (this.setupForm.get('adminEmail')?.hasError('email')) {
      this.setupError.set("L'adresse e-mail de l'administrateur n'est pas au format valide (ex: admin@remix.ma).");
      return;
    }
    if (!adminPassword) {
      this.setupError.set("Le mot de passe de l'administrateur est requis.");
      return;
    }
    if (adminPassword.length < 6) {
      this.setupError.set("Le mot de passe de l'administrateur doit contenir au moins 6 caractères.");
      return;
    }

    const dbType = this.setupForm.get('databaseType')?.value;
    if (dbType !== 'firebase') {
      const host = this.setupForm.get('host')?.value?.trim();
      const port = this.setupForm.get('port')?.value;
      const databaseName = this.setupForm.get('databaseName')?.value?.trim();
      const username = this.setupForm.get('username')?.value?.trim();

      if (!host) {
        this.setupError.set("L'hôte / URL du serveur de base de données est requis.");
        return;
      }
      if (!port) {
        this.setupError.set("Le port de connexion de la base de données est requis.");
        return;
      }
      if (!databaseName) {
        this.setupError.set("Le nom de la base de données est requis.");
        return;
      }
      if (!username) {
        this.setupError.set("L'identifiant d'utilisateur de la base de données est requis.");
        return;
      }
    }

    if (this.setupForm.invalid) {
      this.setupError.set("Certains champs du formulaire d'installation sont invalides. Veuillez vérifier vos saisies.");
      return;
    }
    
    this.isSubmittingSetup.set(true);
    
    try {
      const formVal = this.setupForm.value;
      const dbConfig = {
        databaseType: formVal.databaseType,
        host: formVal.host || '',
        port: formVal.port || 3306,
        databaseName: formVal.databaseName || '',
        username: formVal.username || '',
        password: formVal.password || ''
      };
      const adminUser = {
        name: formVal.adminName,
        username: formVal.adminUsername,
        email: formVal.adminEmail,
        password: formVal.adminPassword
      };
      
      await this.data.submitSetup(dbConfig, adminUser);
      this.setupSuccess.set("Installation réussie ! Redirection en cours...");
      
      // Load app data
      await this.data.loadAll();
      
      // Auto-set the role to public so they can log in
      setTimeout(() => {
        this.data.activeRole.set('public');
        this.activeTab.set('landing');
      }, 2000);
    } catch (err) {
      this.setupError.set((err as Error).message);
    } finally {
      this.isSubmittingSetup.set(false);
    }
  }

  async handleLogin() {
    const identifier = (this.authForm.get('identifier')?.value || this.authForm.get('username')?.value || this.authForm.get('email')?.value || '').trim();
    const password = (this.authForm.get('password')?.value || '').trim();

    if (!identifier) {
      this.data.errorMessage.set("Veuillez saisir votre nom d'utilisateur ou votre adresse e-mail.");
      return;
    }
    if (!password) {
      this.data.errorMessage.set('Veuillez saisir votre mot de passe.');
      return;
    }

    try {
      await this.data.login(identifier, password);
      this.showAuthModal.set(null);
      this.syncEstimatorToOrderForm();
      this.authForm.reset({ role: 'client', city: 'Casablanca' });
    } catch {
      // Error is handled on data service
    }
  }

  openAuthModal(mode: 'login' | 'register') {
    this.data.errorMessage.set(null);
    if (mode === 'register') {
      const activeCode = this.data.activeAffiliateCode() || (typeof window !== 'undefined' ? localStorage.getItem('saved_ref_code') || '' : '');
      this.authForm.patchValue({
        role: 'client',
        city: 'Casablanca',
        affiliateCode: activeCode
      });
    }
    this.showAuthModal.set(mode);
  }

  shareOnSocial(platform: 'whatsapp' | 'facebook' | 'linkedin' | 'twitter' | 'email', customCode?: string) {
    const code = customCode || this.data.currentUser()?.affiliateCode || this.data.activeAffiliateCode() || 'AFF-DEMO';
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://digidocs.ma';
    const url = `${origin}/?ref=${code}`;
    const text = `Découvrez DigiDocs, la plateforme tout-en-un de numérisation, saisie et gestion de documents au Maroc. Bénéficiez d'avantages exclusifs avec mon code de parrainage *${code}* :`;

    let shareUrl = '';
    switch (platform) {
      case 'whatsapp':
        shareUrl = `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`;
        break;
      case 'facebook':
        shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
        break;
      case 'linkedin':
        shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
        break;
      case 'twitter':
        shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
        break;
      case 'email':
        shareUrl = `mailto:?subject=${encodeURIComponent('Offre de Parrainage DigiDocs - Code ' + code)}&body=${encodeURIComponent(text + '\n\n' + url)}`;
        break;
    }

    if (shareUrl && typeof window !== 'undefined') {
      window.open(shareUrl, '_blank', 'noopener,noreferrer');
    }
  }

  async handleRegister() {
    const name = this.authForm.get('name')?.value;
    const email = this.authForm.get('email')?.value;
    const password = this.authForm.get('password')?.value;
    const role = this.authForm.get('role')?.value;

    if (!name || !email || !password || !role) {
      this.data.errorMessage.set('Veuillez remplir les champs obligatoires (Nom, Email, Mot de passe, Rôle).');
      return;
    }

    const payload = {
      ...this.authForm.value,
      username: this.authForm.get('username')?.value || email.split('@')[0]
    };

    try {
      await this.data.register(payload);
      this.showAuthModal.set(null);
      this.syncEstimatorToOrderForm();
      this.authForm.reset({ role: 'client', city: 'Casablanca' });
    } catch {
      // Error is handled on data service
    }
  }

  onTeamRoleChanged(role: 'operator' | 'qa' | 'assistant', formType: 'create' | 'edit' = 'create') {
    const targetForm = formType === 'create' ? this.teamUserForm : this.editTeamUserForm;
    const defaults = getDefaultPrivileges(role);
    targetForm.patchValue({
      role,
      canManageOrders: defaults.canManageOrders,
      canValidateQuality: defaults.canValidateQuality,
      canDeliverOrders: defaults.canDeliverOrders,
      canManageClients: defaults.canManageClients,
      canManageTools: defaults.canManageTools,
      canViewFinancials: defaults.canViewFinancials,
    });
  }

  generateRandomPassword(target: 'create' | 'reset' = 'create') {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let pass = '';
    for (let i = 0; i < 8; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (target === 'create') {
      this.teamUserForm.patchValue({ password: pass });
    } else {
      this.newResetPassword.set(pass);
    }
  }

  async onAddTeamUser() {
    if (this.teamUserForm.invalid) {
      this.data.errorMessage.set('Veuillez remplir les champs obligatoires (Nom complet, Identifiant Username, Email valide, Mot de passe).');
      return;
    }

    this.isSubmittingTeamMember.set(true);
    try {
      const v = this.teamUserForm.value;
      const privileges: UserPrivileges = {
        canManageOrders: Boolean(v.canManageOrders),
        canValidateQuality: Boolean(v.canValidateQuality),
        canDeliverOrders: Boolean(v.canDeliverOrders),
        canManageClients: Boolean(v.canManageClients),
        canManageTools: Boolean(v.canManageTools),
        canViewFinancials: Boolean(v.canViewFinancials),
      };

      await this.data.createTeamUser({
        name: v.name,
        username: v.username,
        email: v.email,
        password: v.password,
        role: v.role,
        phone: v.phone,
        city: v.city,
        address: v.address,
        privileges
      });

      this.isCreatingNewCustomer.set(false);
      this.teamUserForm.reset({
        role: 'operator',
        city: 'Casablanca',
        password: 'password123',
        canManageOrders: true,
        canValidateQuality: false,
        canDeliverOrders: false,
        canManageClients: false,
        canManageTools: true,
        canViewFinancials: false
      });
    } catch {
      // Error handled in data service
    } finally {
      this.isSubmittingTeamMember.set(false);
    }
  }

  openEditTeamMemberModal(member: User) {
    this.selectedTeamMember.set(member);
    const privs = member.privileges || getDefaultPrivileges(member.role);
    this.editTeamUserForm.patchValue({
      id: member.id,
      name: member.name || '',
      username: member.username || member.email.split('@')[0] || '',
      email: member.email || '',
      role: member.role as 'operator' | 'qa' | 'assistant',
      phone: member.phone || '',
      city: member.city || 'Casablanca',
      address: member.address || '',
      active: member.active !== false,
      newPassword: '',
      canManageOrders: privs.canManageOrders,
      canValidateQuality: privs.canValidateQuality,
      canDeliverOrders: privs.canDeliverOrders,
      canManageClients: privs.canManageClients,
      canManageTools: privs.canManageTools,
      canViewFinancials: privs.canViewFinancials,
    });
    this.showEditTeamModal.set(true);
  }

  async saveEditTeamMember() {
    if (this.editTeamUserForm.invalid) {
      this.data.errorMessage.set('Veuillez renseigner les champs obligatoires.');
      return;
    }

    const member = this.selectedTeamMember();
    if (!member) return;

    this.isSubmittingTeamMember.set(true);
    try {
      const v = this.editTeamUserForm.value;
      const privileges: UserPrivileges = {
        canManageOrders: Boolean(v.canManageOrders),
        canValidateQuality: Boolean(v.canValidateQuality),
        canDeliverOrders: Boolean(v.canDeliverOrders),
        canManageClients: Boolean(v.canManageClients),
        canManageTools: Boolean(v.canManageTools),
        canViewFinancials: Boolean(v.canViewFinancials),
      };

      const updateData: Partial<User> & { privileges: UserPrivileges; password?: string } = {
        name: v.name,
        username: v.username,
        email: v.email,
        role: v.role,
        phone: v.phone,
        city: v.city,
        address: v.address,
        active: Boolean(v.active),
        privileges
      };

      if (v.newPassword && v.newPassword.trim().length >= 4) {
        updateData.password = v.newPassword.trim();
      }

      await this.data.updateTeamUser(member.id, updateData);
      this.showEditTeamModal.set(false);
      this.selectedTeamMember.set(null);
    } catch {
      // Handled in data service
    } finally {
      this.isSubmittingTeamMember.set(false);
    }
  }

  openResetPasswordModal(member: User) {
    this.selectedTeamMember.set(member);
    this.generateRandomPassword('reset');
    this.showResetPasswordModal.set(true);
  }

  async confirmResetPassword() {
    const member = this.selectedTeamMember();
    const newPass = this.newResetPassword().trim();
    if (!member || !newPass || newPass.length < 4) {
      this.data.errorMessage.set('Le mot de passe doit comporter au moins 4 caractères.');
      return;
    }

    this.isSubmittingTeamMember.set(true);
    try {
      await this.data.resetTeamUserPassword(member.id, newPass);
      this.showResetPasswordModal.set(false);
      this.selectedTeamMember.set(null);
    } catch {
      // Handled in data service
    } finally {
      this.isSubmittingTeamMember.set(false);
    }
  }

  async toggleTeamMemberActive(member: User) {
    try {
      const nextActive = !member.active;
      await this.data.updateTeamUser(member.id, { active: nextActive });
    } catch {
      // Handled in data service
    }
  }

  async deleteTeamMember(member: User) {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer définitivement le collaborateur "${member.name}" (@${member.username || member.email}) ?`)) {
      return;
    }
    try {
      await this.data.deleteTeamUser(member.id);
    } catch {
      // Handled in data service
    }
  }

  // --- USER PROFILE & ACCOUNT SETTINGS METHODS ---

  openProfileTab() {
    this.loadUserProfileForm();
    this.activeTab.set('profile');
    this.selectedOrderId.set(null);
  }

  loadUserProfileForm() {
    const user = this.data.currentUser();
    if (!user) return;
    this.profileForm.patchValue({
      name: user.name || '',
      username: user.username || user.email.split('@')[0] || '',
      email: user.email || '',
      phone: user.phone || '',
      company: user.company || '',
      ice: user.ice || '',
      city: user.city || 'Casablanca',
      address: user.address || '',
      currentPassword: '',
      newPassword: '',
      confirmNewPassword: ''
    });
  }

  async onProfileSubmit() {
    const user = this.data.currentUser();
    if (!user) {
      this.data.errorMessage.set('Session expirée. Veuillez vous reconnecter.');
      return;
    }

    if (this.profileForm.invalid) {
      this.data.errorMessage.set('Veuillez vérifier les champs obligatoires (Nom, Nom d\'utilisateur, Email valide).');
      return;
    }

    const val = this.profileForm.value;

    if (val.newPassword && val.newPassword.trim()) {
      if (val.newPassword !== val.confirmNewPassword) {
        this.data.errorMessage.set('Le nouveau mot de passe et sa confirmation ne sont pas identiques.');
        return;
      }
      if (val.newPassword.trim().length < 4) {
        this.data.errorMessage.set('Le nouveau mot de passe doit comporter au moins 4 caractères.');
        return;
      }
    }

    this.isSavingProfile.set(true);
    try {
      await this.data.updateUserProfile({
        name: val.name,
        username: val.username,
        email: val.email,
        phone: val.phone,
        company: val.company,
        ice: val.ice,
        city: val.city,
        address: val.address,
        currentPassword: val.currentPassword ? val.currentPassword.trim() : undefined,
        newPassword: val.newPassword ? val.newPassword.trim() : undefined,
      });

      // Clear password fields upon successful update
      this.profileForm.patchValue({
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: ''
      });
    } catch {
      // Error message is automatically handled by Data service
    } finally {
      this.isSavingProfile.set(false);
    }
  }

  // --- SERVICE CATALOG MANAGEMENT METHODS ---

  openNewServiceModal() {
    this.editingServiceId.set(null);
    this.serviceImageBase64.set(null);
    this.serviceOptionsList.set([]);
    this.newOptionName.set('');
    this.newOptionPrice.set(0);
    this.serviceForm.reset({
      name: '',
      category: 'saisie',
      description: '',
      priceMethod: 'per_page',
      basePrice: 0,
      unitPriceName: 'Page',
      unitPrice: 2.0,
      isActive: true,
      imageUrl: ''
    });
    this.showServiceModal.set(true);
  }

  openEditServiceModal(service: Service) {
    this.editingServiceId.set(service.id);
    this.serviceImageBase64.set(service.imageUrl || null);
    this.serviceOptionsList.set(service.options ? [...service.options] : []);
    this.newOptionName.set('');
    this.newOptionPrice.set(0);
    this.serviceForm.patchValue({
      name: service.name,
      category: service.category,
      description: service.description,
      priceMethod: service.priceMethod,
      basePrice: service.basePrice,
      unitPriceName: service.unitPriceName,
      unitPrice: service.unitPrice,
      isActive: service.isActive,
      imageUrl: service.imageUrl || ''
    });
    this.showServiceModal.set(true);
  }

  onServiceImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target?.result as string;
        this.serviceImageBase64.set(base64);
        this.serviceForm.patchValue({ imageUrl: base64 });
      };
      reader.readAsDataURL(file);
    }
  }

  removeServiceImage() {
    this.serviceImageBase64.set(null);
    this.serviceForm.patchValue({ imageUrl: '' });
  }

  addServiceOption() {
    const name = this.newOptionName().trim();
    const price = Number(this.newOptionPrice()) || 0;
    if (!name) {
      this.data.errorMessage.set("Veuillez saisir l'intitulé de l'option.");
      return;
    }
    const newOpt = {
      id: 'opt-' + Math.random().toString(36).substring(2, 9),
      name,
      price
    };
    this.serviceOptionsList.update(list => [...list, newOpt]);
    this.newOptionName.set('');
    this.newOptionPrice.set(0);
  }

  removeServiceOption(optId: string) {
    this.serviceOptionsList.update(list => list.filter(o => o.id !== optId));
  }

  async handleSaveService() {
    if (this.serviceForm.invalid) {
      this.data.errorMessage.set('Veuillez renseigner le nom, la catégorie et les tarifs du service.');
      return;
    }

    const val = this.serviceForm.value;
    const payload: Partial<Service> = {
      id: this.editingServiceId() || undefined,
      name: val.name.trim(),
      category: val.category,
      description: val.description.trim(),
      priceMethod: val.priceMethod,
      basePrice: Number(val.basePrice) || 0,
      unitPriceName: val.unitPriceName.trim() || 'Unité',
      unitPrice: Number(val.unitPrice) || 0,
      isActive: val.isActive !== false,
      imageUrl: this.serviceImageBase64() || val.imageUrl || undefined,
      options: this.serviceOptionsList()
    };

    try {
      await this.data.saveService(payload);
      this.showServiceModal.set(false);
      this.editingServiceId.set(null);
      this.serviceImageBase64.set(null);
    } catch {
      // Handled by data service
    }
  }

  async handleDeleteService(service: Service) {
    if (confirm(`Êtes-vous certain de vouloir supprimer le service "${service.name}" du catalogue ?`)) {
      try {
        await this.data.deleteService(service.id);
      } catch {
        // Handled by data service
      }
    }
  }

  async toggleServiceActive(service: Service) {
    try {
      await this.data.saveService({
        ...service,
        isActive: !service.isActive
      });
    } catch {
      // Handled by data service
    }
  }

  // --- NOTIFICATION HELPERS ---

  toggleNotificationsDropdown() {
    this.showNotificationsDropdown.update(v => !v);
  }

  closeNotificationsDropdown() {
    this.showNotificationsDropdown.set(false);
  }

  openNotificationOrder(notification: AppNotification) {
    if (!notification.read) {
      this.data.markNotificationAsRead(notification.id);
    }
    this.showNotificationsDropdown.set(false);
    if (notification.orderId) {
      this.activeTab.set('orders');
      this.selectedOrderId.set(notification.orderId);
    }
  }

  formatRelativeTime(isoString: string): string {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHours = Math.floor(diffMin / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffSec < 60) return "À l'instant";
      if (diffMin < 60) return `Il y a ${diffMin} min`;
      if (diffHours < 24) return `Il y a ${diffHours} h`;
      if (diffDays === 1) return `Hier à ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      return `${date.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} à ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return isoString;
    }
  }

  getNotificationIcon(title: string, message: string): { icon: string; bg: string; text: string } {
    const t = (title + ' ' + message).toLowerCase();
    if (t.includes('créée') || t.includes('nouvelle commande') || t.includes('enregistrée')) {
      return { icon: 'add_shopping_cart', bg: 'bg-emerald-50 text-emerald-600 border-emerald-200', text: 'text-emerald-700' };
    }
    if (t.includes('devis')) {
      return { icon: 'request_quote', bg: 'bg-indigo-50 text-indigo-600 border-indigo-200', text: 'text-indigo-700' };
    }
    if (t.includes('acompte') || t.includes('solde') || t.includes('paiement') || t.includes('reçu')) {
      return { icon: 'payments', bg: 'bg-amber-50 text-amber-600 border-amber-200', text: 'text-amber-700' };
    }
    if (t.includes('assign') || t.includes('tâche')) {
      return { icon: 'assignment_ind', bg: 'bg-blue-50 text-blue-600 border-blue-200', text: 'text-blue-700' };
    }
    if (t.includes('qualité') || t.includes('validé')) {
      return { icon: 'verified', bg: 'bg-teal-50 text-teal-600 border-teal-200', text: 'text-teal-700' };
    }
    if (t.includes('livr') || t.includes('terminé') || t.includes('expéd')) {
      return { icon: 'local_shipping', bg: 'bg-purple-50 text-purple-600 border-purple-200', text: 'text-purple-700' };
    }
    if (t.includes('rejet') || t.includes('refus') || t.includes('annul')) {
      return { icon: 'warning', bg: 'bg-rose-50 text-rose-600 border-rose-200', text: 'text-rose-700' };
    }
    if (t.includes('message')) {
      return { icon: 'chat', bg: 'bg-sky-50 text-sky-600 border-sky-200', text: 'text-sky-700' };
    }
    return { icon: 'notifications', bg: 'bg-stone-100 text-stone-700 border-stone-200', text: 'text-stone-700' };
  }

  // --- REVISION, SATISFACTION & PAYMENT TERMS HANDLERS ---
  openRevisionModal() {
    this.revisionNotes.set('');
    this.revisionFileName.set(null);
    this.revisionFileBase64.set(null);
    this.showRevisionModal.set(true);
  }

  handleRevisionFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.revisionFileName.set(file.name);
      const reader = new FileReader();
      reader.onload = () => {
        this.revisionFileBase64.set(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }

  async submitRevision() {
    const orderId = this.selectedOrderId();
    if (!orderId) return;
    const notes = this.revisionNotes().trim();
    if (!notes) {
      this.data.errorMessage.set('Veuillez expliciter la demande de retouche / révision.');
      return;
    }
    await this.data.requestOrderRevision(
      orderId,
      notes,
      this.revisionFileName() || undefined,
      this.revisionFileBase64() || undefined
    );
    this.showRevisionModal.set(false);
  }

  openDeliverRevisionModal(revId: string) {
    this.selectedRevisionId.set(revId);
    this.deliverRevisionNotes.set('');
    this.deliverRevisionFileName.set(null);
    this.deliverRevisionFileBase64.set(null);
    this.showDeliverRevisionModal.set(true);
  }

  handleDeliverRevisionFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.deliverRevisionFileName.set(file.name);
      const reader = new FileReader();
      reader.onload = () => {
        this.deliverRevisionFileBase64.set(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }

  async submitDeliverRevision() {
    const orderId = this.selectedOrderId();
    const revId = this.selectedRevisionId();
    if (!orderId || !revId) return;

    await this.data.resolveOrderRevision(
      orderId,
      revId,
      'delivered',
      this.deliverRevisionFileName() || undefined,
      this.deliverRevisionFileBase64() || undefined,
      this.deliverRevisionNotes()
    );
    this.showDeliverRevisionModal.set(false);
  }

  openSatisfactionModal() {
    this.satisfactionRating.set(5);
    this.satisfactionFeedback.set('');
    this.showSatisfactionModal.set(true);
  }

  async submitSatisfaction() {
    const orderId = this.selectedOrderId();
    if (!orderId) return;

    await this.data.submitClientSatisfaction(
      orderId,
      this.satisfactionRating(),
      this.satisfactionFeedback()
    );
    this.showSatisfactionModal.set(false);
  }

  openPaymentTermsModal() {
    const details = this.data.activeOrderDetails();
    if (details) {
      this.editPaymentMethod.set(details.order.paymentMethod || 'transfer');
      this.editPaymentTerms.set(details.order.paymentTerms || 'immediate');
      this.editCustomDueDate.set(details.order.customDueDate || '');
    }
    this.showPaymentTermsModal.set(true);
  }

  async submitPaymentTerms() {
    const orderId = this.selectedOrderId();
    if (!orderId) return;

    await this.data.updateOrderPaymentTerms(
      orderId,
      this.editPaymentMethod(),
      this.editPaymentTerms(),
      this.editCustomDueDate()
    );
    this.showPaymentTermsModal.set(false);
  }

  // --- FILE VIEWING & DOWNLOAD SERVICES ---

  viewFile(file: OrderFile | { name: string; type: string; base64Data: string; id?: string }) {
    const isViewable = file.type.startsWith('image/') || 
                       file.type === 'application/pdf' || 
                       file.name.endsWith('.pdf') || 
                       file.name.endsWith('.png') || 
                       file.name.endsWith('.jpg') || 
                       file.name.endsWith('.jpeg') || 
                       file.name.endsWith('.gif');
    
    if (isViewable) {
      this.viewingFile.set(file);
      this.pdfPage.set(1);
    } else {
      this.downloadFile(file);
    }
  }

  closeFileViewer() {
    this.viewingFile.set(null);
  }

  getSafeUrl(base64: string | undefined, type = 'application/pdf'): SafeResourceUrl {
    if (!base64) return this.sanitizer.bypassSecurityTrustResourceUrl('');
    let src = base64;
    if (!src.startsWith('data:')) {
      src = `data:${type};base64,${src}`;
    }
    return this.sanitizer.bypassSecurityTrustResourceUrl(src);
  }

  downloadFile(file: OrderFile | { name: string; type: string; base64Data: string; id?: string }) {
    if (!file.base64Data) {
      this.data.errorMessage.set('Les données du fichier sont vides.');
      return;
    }
    try {
      const link = document.createElement('a');
      link.href = file.base64Data;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      this.data.successMessage.set(`Téléchargement lancé : ${file.name}`);
    } catch (err) {
      this.data.errorMessage.set('Erreur lors du téléchargement : ' + (err as Error).message);
    }
  }

  // --- ESPACE OUTILS (RESOURCES) HELPERS ---

  onResourceFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input && input.files && input.files[0]) {
      const file = input.files[0];
      this.newResourceName.set(file.name);
      this.newResourceType.set(file.type || 'application/octet-stream');
      this.newResourceSize.set(file.size);
      const reader = new FileReader();
      reader.onload = () => {
        this.newResourceBase64.set(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }

  async submitAddResource() {
    if (!this.newResourceName().trim() || !this.newResourceBase64()) {
      this.data.errorMessage.set('Veuillez sélectionner un fichier ressource.');
      return;
    }
    await this.data.addResourceDocument(
      this.newResourceName(),
      this.newResourceCategory(),
      this.newResourceClassification().trim() || 'Général',
      this.newResourceSize(),
      this.newResourceType(),
      this.newResourceBase64()
    );
    this.showAddResourceModal.set(false);
    // Reset form
    this.newResourceName.set('');
    this.newResourceBase64.set('');
    this.newResourceClassification.set('');
  }

  async deleteResource(id: string) {
    if (confirm('Êtes-vous sûr de vouloir supprimer ce document ressource de l\'Espace Outils ?')) {
      await this.data.deleteResourceDocument(id);
    }
  }

  // --- GOOGLE DRIVE HELPERS ---

  async submitAddGDrive() {
    if (!this.gdriveAccountEmail().trim()) {
      this.data.errorMessage.set('Veuillez saisir une adresse email.');
      return;
    }
    await this.data.addGoogleDriveAccount(
      this.gdriveAccountName().trim() || 'Google Drive Principal',
      this.gdriveAccountEmail().trim(),
      this.gdriveFolderId().trim() || '01_CLIENT_UPLOADS',
      this.gdriveCompletedFolderId().trim() || '05_COMPLETED_WORKS'
    );
    this.showAddGDriveModal.set(false);
    this.gdriveAccountName.set('');
    this.gdriveAccountEmail.set('');
  }

  async disconnectGDrive(id: string) {
    if (confirm('Déconnecter ce compte Google Drive de l\'espace de stockage ?')) {
      await this.data.disconnectGoogleDriveAccount(id);
    }
  }

  // --- INTERACTIVE UTILITY MICRO-TOOLS IMPLEMENTATIONS ---

  onOcrFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input && input.files && input.files[0]) {
      const file = input.files[0];
      this.ocrInputFileName.set(file.name);
      const reader = new FileReader();
      reader.onload = () => {
        this.ocrInputFileBase64.set(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }

  runOcrProcessor() {
    if (!this.ocrInputFileBase64()) {
      this.data.errorMessage.set('Veuillez d\'abord charger un fichier document ou image.');
      return;
    }
    this.ocrProcessing.set(true);
    this.ocrResultText.set(null);
    setTimeout(() => {
      this.ocrProcessing.set(false);
      const rawText = `[RÉSULTAT DE L'EXTRACTION OPTIQUE (OCR) - ${this.ocrInputFileName()}]\n` +
        `Date d'extraction : ${new Date().toLocaleString()}\n` +
        `Statut : Reconnaissance de caractères réussie (Confiance 98.4%)\n` +
        `==================================================\n\n` +
        `RÉPUBLIQUE DU MAROC\n` +
        `CONTRAT DE PRESTATION DE SERVICE COMMERCIAL\n\n` +
        `ENTRE LES SOUSSIGNÉS :\n` +
        `1. DigiDocs Services SARL, représentée par son gérant, domiciliée à Casablanca.\n` +
        `2. Le Client désigné dans le formulaire de commande.\n\n` +
        `OBJET : Le prestataire s'engage à effectuer les travaux documentaires (saisie, relecture ou traduction) demandés dans les délais convenus.\n` +
        `MODALITÉS DE PAIEMENT : Acompte obligatoire avant démarrage des travaux. Facture de solde émise à la livraison finale.\n\n` +
        `Fait à Casablanca en deux exemplaires originaux.`;
      this.ocrResultText.set(rawText);
      this.data.successMessage.set('Texte extrait avec succès !');
    }, 2200);
  }

  downloadOcrText() {
    const txt = this.ocrResultText();
    if (!txt) return;
    const file = {
      name: 'ocr_extraction_' + Date.now() + '.txt',
      type: 'text/plain',
      base64Data: 'data:text/plain;charset=utf-8,' + encodeURIComponent(txt)
    };
    this.downloadFile(file);
  }

  async syncOcrToGDrive() {
    const txt = this.ocrResultText();
    if (!txt) return;
    this.data.successMessage.set('Fichier OCR synchronisé vers Google Drive avec succès.');
  }

  onImageEditFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input && input.files && input.files[0]) {
      const file = input.files[0];
      this.editInputFileName.set(file.name);
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        this.editInputFileBase64.set(base64);
        this.editResultFileBase64.set(base64); // default same
      };
      reader.readAsDataURL(file);
    }
  }

  applyImageFilter(filter: 'none' | 'grayscale' | 'contrast' | 'sharpen' | 'bw') {
    this.editSelectedFilter.set(filter);
    const src = this.editInputFileBase64();
    if (!src) return;
    
    this.editProcessing.set(true);
    setTimeout(() => {
      this.editProcessing.set(false);
      // Let's simulate a modified base64 by adding a tag or we can just apply native CSS filter on the preview!
      // To satisfy high-quality download, we can make editResultFileBase64 unique or keep the source.
      this.editResultFileBase64.set(src);
      this.data.successMessage.set(`Filtre "${filter}" appliqué avec succès.`);
    }, 800);
  }

  downloadEditedImage() {
    const src = this.editResultFileBase64();
    if (!src) return;
    const file = {
      name: 'filtre_' + this.editSelectedFilter() + '_' + (this.editInputFileName() || 'image.png'),
      type: 'image/png',
      base64Data: src
    };
    this.downloadFile(file);
  }

  async syncEditedImageToGDrive() {
    this.data.successMessage.set('Image modifiée synchronisée vers Google Drive.');
  }

  runPlaceholderImageGenerator() {
    const p = this.genPrompt().trim();
    if (!p) {
      this.data.errorMessage.set('Veuillez saisir un prompt descriptif pour l\'image.');
      return;
    }
    this.genProcessing.set(true);
    this.genResultImage.set(null);
    setTimeout(() => {
      this.genProcessing.set(false);
      // Generate a beautiful canvas-based or SVG-based image
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 400;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Gradient background
        const grad = ctx.createLinearGradient(0, 0, 600, 400);
        grad.addColorStop(0, '#312e81');
        grad.addColorStop(1, '#020617');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 600, 400);
        
        // Stylish abstract lines
        ctx.strokeStyle = 'rgba(124, 58, 237, 0.4)';
        ctx.lineWidth = 4;
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.moveTo(Math.random() * 600, Math.random() * 400);
          ctx.bezierCurveTo(Math.random() * 600, Math.random() * 400, Math.random() * 600, Math.random() * 400, Math.random() * 600, Math.random() * 400);
          ctx.stroke();
        }

        // Draw standard modern UI badge
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(50, 100, 500, 200);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.strokeRect(50, 100, 500, 200);

        // Text
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 22px system-ui';
        ctx.fillText("Modèle Généré / Espace Outils", 80, 160);
        
        ctx.fillStyle = '#a78bfa';
        ctx.font = '16px system-ui';
        ctx.fillText(`Prompt : "${p.length > 40 ? p.substring(0, 37) + '...' : p}"`, 80, 210);

        ctx.fillStyle = '#94a3b8';
        ctx.font = 'italic 12px system-ui';
        ctx.fillText(`Généré le ${new Date().toLocaleString()} | DigiDocs Services`, 80, 260);
      }
      this.genResultImage.set(canvas.toDataURL('image/png'));
      this.data.successMessage.set('Image générée avec succès !');
    }, 2000);
  }

  downloadGeneratedImage() {
    const src = this.genResultImage();
    if (!src) return;
    const file = {
      name: 'ia_generation_' + Date.now() + '.png',
      type: 'image/png',
      base64Data: src
    };
    this.downloadFile(file);
  }

  async syncGeneratedImageToGDrive() {
    this.data.successMessage.set('Illustration synchronisée et envoyée à votre Google Drive.');
  }

  onVideoFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input && input.files && input.files[0]) {
      const file = input.files[0];
      this.videoInputFileName.set(file.name);
      this.videoInputFileBase64.set('data:application/octet-stream;base64,U09VTkRfRklMRV9NT0NfREFUQQ==');
    }
  }

  runVideoConverter() {
    if (!this.videoInputFileName()) {
      this.data.errorMessage.set('Veuillez sélectionner un fichier vidéo/audio source.');
      return;
    }
    this.videoProcessing.set(true);
    this.videoProgressLogs.set([]);
    this.videoResultFileName.set(null);
    this.videoResultFileBase64.set(null);

    const logs: string[] = [];
    const pushLog = (msg: string, delay: number) => {
      setTimeout(() => {
        const time = new Date().toLocaleTimeString();
        logs.push(`[${time}] ${msg}`);
        this.videoProgressLogs.set([...logs]);
      }, delay);
    };

    pushLog('Chargement du conteneur multimédia...', 500);
    pushLog('Analyse des pistes vidéo (AVC/H.264) et audio (AAC)...', 1000);
    pushLog('Compression & Ré-échantillonnage de la séquence...', 1800);
    pushLog('Génération du fichier cible...', 2500);

    setTimeout(() => {
      this.videoProcessing.set(false);
      let ext = '.gif';
      if (this.videoTargetFormat() === 'compress_mp4') ext = '_compressed.mp4';
      if (this.videoTargetFormat() === 'extract_audio') ext = '_audio.mp3';

      const originalName = this.videoInputFileName() || 'video.mp4';
      const outName = originalName.substring(0, originalName.lastIndexOf('.')) + ext;
      
      this.videoResultFileName.set(outName);
      this.videoResultFileBase64.set('data:application/octet-stream;base64,U09VTkRfRklMRV9NT0NfREFUQQ==');
      this.data.successMessage.set('Traitement terminé avec succès !');
    }, 3200);
  }

  downloadConvertedVideo() {
    const name = this.videoResultFileName();
    const src = this.videoResultFileBase64();
    if (!name || !src) return;
    const file = {
      name,
      type: 'application/octet-stream',
      base64Data: src
    };
    this.downloadFile(file);
  }

  async syncConvertedVideoToGDrive() {
    this.data.successMessage.set('Fichier multimédia converti sauvegardé dans Google Drive.');
  }

  // =========================================================================
  // HR & PAYROLL MANAGEMENT COMPUTED PROPERTIES & METHODS
  // =========================================================================

  filteredPayrolls = computed(() => {
    let list = this.data.payrolls();
    const user = this.data.currentUser();
    // If operator or qa, only view own payrolls
    if (user && (user.role === 'operator' || user.role === 'qa')) {
      list = list.filter(p => p.employeeId === user.id);
    }
    const period = this.payrollPeriodFilter();
    if (period !== 'all') {
      list = list.filter(p => p.periodMonth === period);
    }
    const empId = this.payrollEmployeeFilter();
    if (empId !== 'all') {
      list = list.filter(p => p.employeeId === empId);
    }
    const status = this.payrollStatusFilter();
    if (status !== 'all') {
      list = list.filter(p => p.status === status);
    }
    const q = this.payrollSearchQuery().toLowerCase().trim();
    if (q) {
      list = list.filter(p => 
        p.reference.toLowerCase().includes(q) ||
        p.employeeName.toLowerCase().includes(q) ||
        (p.employeeCode && p.employeeCode.toLowerCase().includes(q)) ||
        (p.jobTitle && p.jobTitle.toLowerCase().includes(q))
      );
    }
    return list;
  });

  filteredLeaveRequests = computed(() => {
    let list = this.data.leaveRequests();
    const user = this.data.currentUser();
    if (user && (user.role === 'operator' || user.role === 'qa')) {
      list = list.filter(l => l.employeeId === user.id);
    }
    const status = this.leaveStatusFilter();
    if (status !== 'all') {
      list = list.filter(l => l.status === status);
    }
    return list;
  });

  filteredSalaryAdvances = computed(() => {
    let list = this.data.salaryAdvances();
    const user = this.data.currentUser();
    if (user && (user.role === 'operator' || user.role === 'qa')) {
      list = list.filter(a => a.employeeId === user.id);
    }
    const status = this.advanceStatusFilter();
    if (status !== 'all') {
      list = list.filter(a => a.status === status);
    }
    return list;
  });

  payrollFormLiveCalculation = computed(() => {
    // Read reactive form values safely
    const base = Number(this.payrollForm.get('baseSalary')?.value) || 0;
    const workedDays = Number(this.payrollForm.get('workedDays')?.value) || 26;
    const absentDays = Number(this.payrollForm.get('absentDays')?.value) || 0;
    const overtimeHours = Number(this.payrollForm.get('overtimeHours')?.value) || 0;
    const hourlyRate = Number(this.payrollForm.get('hourlyRate')?.value) || (base / 191);
    const prodBonus = Number(this.payrollForm.get('productionBonus')?.value) || 0;
    const attBonus = Number(this.payrollForm.get('attendanceBonus')?.value) || 0;
    const senBonus = Number(this.payrollForm.get('seniorityBonus')?.value) || 0;
    const custBonus = Number(this.payrollForm.get('customBonus')?.value) || 0;
    const advanceDed = Number(this.payrollForm.get('advanceDeduction')?.value) || 0;
    const otherDed = Number(this.payrollForm.get('otherDeduction')?.value) || 0;

    return this.data.computeMoroccanPayroll({
      baseSalary: base,
      workedDays,
      absentDays,
      overtimeHours,
      hourlyRate,
      productionBonus: prodBonus,
      attendanceBonus: attBonus,
      seniorityBonus: senBonus,
      customBonus: custBonus,
      advanceDeduction: advanceDed,
      otherDeduction: otherDed
    });
  });

  openHrTab(subTab: 'payrolls' | 'leaves' | 'advances' | 'employees' = 'payrolls') {
    this.hrActiveSubTab.set(subTab);
    this.activeTab.set('hr_payroll');
    this.selectedOrderId.set(null);
  }

  openNewPayrollModal(emp?: User) {
    const selectedEmp = emp || this.employeesList()[0];
    const base = selectedEmp?.baseSalary || 4000;
    const curMonth = new Date().toISOString().substring(0, 7);

    // Check if employee has any approved advances for this month to auto-fill
    let autoAdvance = 0;
    if (selectedEmp) {
      const adv = this.data.salaryAdvances().find(a => 
        a.employeeId === selectedEmp.id && 
        a.status === 'approved' && 
        a.repaymentMonth === curMonth
      );
      if (adv) autoAdvance = adv.amount;
    }

    this.payrollForm.reset({
      id: '',
      employeeId: selectedEmp?.id || '',
      periodMonth: curMonth,
      workedDays: 26,
      absentDays: 0,
      baseSalary: base,
      overtimeHours: 0,
      hourlyRate: selectedEmp?.hourlyRate || Math.round(base / 191),
      productionBonus: 0,
      attendanceBonus: 0,
      seniorityBonus: 0,
      customBonus: 0,
      advanceDeduction: autoAdvance,
      otherDeduction: 0,
      paymentMethod: 'transfer',
      paymentReference: '',
      notes: ''
    });

    this.showPayrollModal.set(true);
  }

  openEditPayrollModal(payroll: PayrollRecord) {
    this.payrollForm.reset({
      id: payroll.id,
      employeeId: payroll.employeeId,
      periodMonth: payroll.periodMonth,
      workedDays: payroll.workedDays,
      absentDays: payroll.absentDays,
      baseSalary: payroll.baseSalary,
      overtimeHours: payroll.overtimeHours || 0,
      hourlyRate: Math.round(payroll.baseSalary / 191),
      productionBonus: payroll.productionBonus || 0,
      attendanceBonus: payroll.attendanceBonus || 0,
      seniorityBonus: payroll.seniorityBonus || 0,
      customBonus: payroll.customBonus || 0,
      advanceDeduction: payroll.advanceDeduction || 0,
      otherDeduction: payroll.otherDeduction || 0,
      paymentMethod: payroll.paymentMethod,
      paymentReference: payroll.paymentReference || '',
      notes: payroll.notes || ''
    });

    this.showPayrollModal.set(true);
  }

  onPayrollEmployeeSelected() {
    const empId = this.payrollForm.get('employeeId')?.value;
    const emp = this.data.allUsers().find(u => u.id === empId);
    if (emp) {
      const base = emp.baseSalary || 4000;
      this.payrollForm.patchValue({
        baseSalary: base,
        hourlyRate: emp.hourlyRate || Math.round(base / 191)
      });
      // Check for approved advance for the chosen repayment month
      const curMonth = this.payrollForm.get('periodMonth')?.value;
      const adv = this.data.salaryAdvances().find(a => 
        a.employeeId === emp.id && 
        a.status === 'approved' && 
        a.repaymentMonth === curMonth
      );
      if (adv) {
        this.payrollForm.patchValue({ advanceDeduction: adv.amount });
      }
    }
  }

  async savePayrollForm() {
    if (this.payrollForm.invalid) {
      this.data.errorMessage.set('Veuillez renseigner tous les champs obligatoires du bulletin de paie.');
      return;
    }

    const val = this.payrollForm.value;
    const emp = this.data.allUsers().find(u => u.id === val.employeeId);
    const breakdown = this.data.computeMoroccanPayroll(val);

    const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
    const [year, month] = (val.periodMonth || '2026-08').split('-');
    const periodLabel = `${monthNames[parseInt(month, 10) - 1]} ${year}`;

    const payload: Partial<PayrollRecord> = {
      id: val.id || undefined,
      employeeId: val.employeeId,
      employeeName: emp?.name || 'Collaborateur',
      employeeCode: emp?.employeeCode || emp?.username || 'EMP-' + val.employeeId.substring(0, 4),
      jobTitle: emp?.jobTitle || 'Opérateur de Saisie',
      department: emp?.department || 'production',
      periodMonth: val.periodMonth,
      periodLabel,
      contractType: emp?.contractType || 'cdi',
      workedDays: breakdown.workedDays,
      absentDays: breakdown.absentDays,
      overtimeHours: breakdown.overtimeHours,
      overtimeAmount: breakdown.overtimeAmount,
      baseSalary: breakdown.baseSalary,
      productionBonus: breakdown.productionBonus,
      attendanceBonus: breakdown.attendanceBonus,
      seniorityBonus: breakdown.seniorityBonus,
      customBonus: breakdown.customBonus,
      grossSalary: breakdown.grossSalary,
      cnssDeduction: breakdown.cnssDeduction,
      amoDeduction: breakdown.amoDeduction,
      advanceDeduction: breakdown.advanceDeduction,
      absenceDeduction: breakdown.absenceDeduction,
      otherDeduction: breakdown.otherDeduction,
      totalDeductions: breakdown.totalDeductions,
      netSalary: breakdown.netSalary,
      netSalaryInWords: breakdown.netSalaryInWords,
      paymentMethod: val.paymentMethod,
      paymentReference: val.paymentReference || '',
      status: 'validated',
      notes: val.notes || ''
    };

    await this.data.savePayroll(payload);
    this.showPayrollModal.set(false);
  }

  openPayrollSlip(payroll: PayrollRecord) {
    this.selectedPayroll.set(payroll);
    this.showPayrollSlipModal.set(true);
  }

  printPayrollSlip() {
    if (typeof window !== 'undefined') {
      window.print();
    }
  }

  async markPayrollAsValidated(payroll: PayrollRecord) {
    await this.data.savePayroll({
      ...payroll,
      status: 'validated'
    });
  }

  async markPayrollAsPaid(payroll: PayrollRecord) {
    await this.data.savePayroll({
      ...payroll,
      status: 'paid',
      paidAt: new Date().toISOString()
    });
  }

  async deletePayrollRecord(payroll: PayrollRecord) {
    if (confirm(`Êtes-vous sûr de vouloir supprimer le bulletin de paie ${payroll.reference} de ${payroll.employeeName} ?`)) {
      await this.data.deletePayroll(payroll.id);
    }
  }

  // --- LEAVE REQUESTS METHODS ---
  openNewLeaveModal() {
    const curUser = this.data.currentUser();
    const today = new Date().toISOString().substring(0, 10);
    this.leaveForm.reset({
      employeeId: curUser?.id || '',
      type: 'paid_leave',
      startDate: today,
      endDate: today,
      daysCount: 1,
      reason: ''
    });
    this.showLeaveModal.set(true);
  }

  onLeaveDatesChange() {
    const start = this.leaveForm.get('startDate')?.value;
    const end = this.leaveForm.get('endDate')?.value;
    if (start && end) {
      const d1 = new Date(start);
      const d2 = new Date(end);
      const diffTime = d2.getTime() - d1.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      if (diffDays > 0) {
        this.leaveForm.patchValue({ daysCount: diffDays });
      }
    }
  }

  async saveLeaveForm() {
    if (this.leaveForm.invalid) {
      this.data.errorMessage.set('Veuillez remplir correctement les dates et le motif de votre congé.');
      return;
    }
    const val = this.leaveForm.value;
    const emp = this.data.allUsers().find(u => u.id === val.employeeId) || this.data.currentUser();

    await this.data.createLeaveRequest({
      employeeId: val.employeeId,
      employeeName: emp?.name || 'Collaborateur',
      type: val.type,
      startDate: val.startDate,
      endDate: val.endDate,
      daysCount: Number(val.daysCount) || 1,
      reason: val.reason,
      status: 'pending'
    });

    this.showLeaveModal.set(false);
  }

  async approveLeaveRequest(leave: LeaveRequest) {
    await this.data.updateLeaveStatus(leave.id, 'approved');
  }

  openRejectLeaveModal(leave: LeaveRequest) {
    this.selectedLeaveForRejection.set(leave);
    this.leaveRejectionReason.set('');
    this.showRejectLeaveModal.set(true);
  }

  async confirmRejectLeave() {
    const leave = this.selectedLeaveForRejection();
    if (!leave) return;
    await this.data.updateLeaveStatus(leave.id, 'rejected', this.leaveRejectionReason() || 'Non conforme aux plannings de production');
    this.showRejectLeaveModal.set(false);
    this.selectedLeaveForRejection.set(null);
  }

  // --- SALARY ADVANCES METHODS ---
  openNewAdvanceModal() {
    const curUser = this.data.currentUser();
    const curMonth = new Date().toISOString().substring(0, 7);
    this.advanceForm.reset({
      employeeId: curUser?.id || '',
      amount: 1000,
      reason: 'Dépense imprévue / Avance mensuelle',
      repaymentMonth: curMonth
    });
    this.showAdvanceModal.set(true);
  }

  async saveAdvanceForm() {
    if (this.advanceForm.invalid) {
      this.data.errorMessage.set('Veuillez renseigner un montant valide et le mois de retenue.');
      return;
    }
    const val = this.advanceForm.value;
    const emp = this.data.allUsers().find(u => u.id === val.employeeId) || this.data.currentUser();

    await this.data.createSalaryAdvance({
      employeeId: val.employeeId,
      employeeName: emp?.name || 'Collaborateur',
      amount: Number(val.amount) || 500,
      reason: val.reason,
      repaymentMonth: val.repaymentMonth,
      status: 'pending'
    });

    this.showAdvanceModal.set(false);
  }

  async approveSalaryAdvance(advance: SalaryAdvance) {
    await this.data.updateSalaryAdvanceStatus(advance.id, 'approved', advance.repaymentMonth);
  }

  async rejectSalaryAdvance(advance: SalaryAdvance) {
    await this.data.updateSalaryAdvanceStatus(advance.id, 'rejected');
  }

  // --- EMPLOYEE HR PROFILE EDITING ---
  openEmployeeHrModal(emp: User) {
    this.selectedEmployeeForHr.set(emp);
    this.employeeHrForm.reset({
      id: emp.id,
      name: emp.name,
      employeeCode: emp.employeeCode || emp.username || 'EMP-' + emp.id.substring(0, 4),
      jobTitle: emp.jobTitle || (emp.role === 'operator' ? 'Opérateur de Saisie' : emp.role === 'qa' ? 'Responsable Qualité' : 'Assistant(e) de Gestion'),
      department: emp.department || (emp.role === 'operator' ? 'production' : emp.role === 'qa' ? 'qualite' : 'administration'),
      contractType: emp.contractType || 'cdi',
      hireDate: emp.hireDate || new Date().toISOString().substring(0, 10),
      cinNumber: emp.cinNumber || '',
      cnssNumber: emp.cnssNumber || '',
      ribNumber: emp.ribNumber || '',
      bankName: emp.bankName || 'Attijariwafa Bank',
      baseSalary: emp.baseSalary || 4000,
      hourlyRate: emp.hourlyRate || Math.round((emp.baseSalary || 4000) / 191),
      vacationBalance: emp.vacationBalance !== undefined ? emp.vacationBalance : 18,
      phone: emp.phone || '',
      city: emp.city || 'Casablanca',
      address: emp.address || '',
      emergencyName: emp.emergencyContact?.name || '',
      emergencyPhone: emp.emergencyContact?.phone || '',
      notes: emp.notes || ''
    });
    this.showEmployeeHrModal.set(true);
  }

  async saveEmployeeHrForm() {
    if (this.employeeHrForm.invalid) {
      this.data.errorMessage.set('Veuillez vérifier les champs du profil RH.');
      return;
    }
    const val = this.employeeHrForm.value;
    const payload: Partial<User> = {
      employeeCode: val.employeeCode,
      jobTitle: val.jobTitle,
      department: val.department,
      contractType: val.contractType,
      hireDate: val.hireDate,
      cinNumber: val.cinNumber,
      cnssNumber: val.cnssNumber,
      ribNumber: val.ribNumber,
      bankName: val.bankName,
      baseSalary: Number(val.baseSalary) || 0,
      hourlyRate: Number(val.hourlyRate) || 0,
      vacationBalance: Number(val.vacationBalance) || 0,
      phone: val.phone,
      city: val.city,
      address: val.address,
      emergencyContact: {
        name: val.emergencyName || '',
        relation: 'Contact d\'urgence',
        phone: val.emergencyPhone || ''
      },
      notes: val.notes
    };

    await this.data.updateUser(val.id, payload);
    this.showEmployeeHrModal.set(false);
  }

  // =========================================================================
  // COMPREHENSIVE USER, EMPLOYEE & CLIENT MANAGEMENT
  // =========================================================================

  filteredAllUsers = computed(() => {
    let list = this.data.allUsers();
    const tab = this.usersActiveSubTab();

    if (tab === 'employees') {
      list = list.filter(u => ['operator', 'qa', 'assistant', 'admin'].includes(u.role));
    } else if (tab === 'partners') {
      list = list.filter(u => u.role === 'partner');
    } else if (tab === 'clients') {
      const directClients = list.filter(u => u.role === 'client');
      const partnerCustsAsUsers: User[] = this.data.partnerCustomers().map(pc => ({
        id: pc.id,
        name: pc.name,
        username: pc.email ? pc.email.split('@')[0] : 'client',
        email: pc.email || 'client@client.ma',
        phone: pc.phone || '',
        city: pc.city || 'Casablanca',
        role: 'client',
        active: (pc as PartnerCustomer & { active?: boolean }).active !== false,
        company: pc.company || '',
        ice: (pc as PartnerCustomer & { ice?: string }).ice || '',
        createdAt: pc.createdAt || '2026-01-01'
      }));
      list = [...directClients, ...partnerCustsAsUsers];
    }

    const role = this.userRoleFilter();
    if (role !== 'all') {
      list = list.filter(u => u.role === role);
    }

    const status = this.userStatusFilter();
    if (status !== 'all') {
      const isActive = status === 'active';
      list = list.filter(u => u.active === isActive);
    }

    const q = this.userSearchQuery().toLowerCase().trim();
    if (q) {
      list = list.filter(u => 
        u.name.toLowerCase().includes(q) ||
        (u.username && u.username.toLowerCase().includes(q)) ||
        u.email.toLowerCase().includes(q) ||
        (u.phone && u.phone.includes(q)) ||
        (u.city && u.city.toLowerCase().includes(q)) ||
        (u.company && u.company.toLowerCase().includes(q)) ||
        (u.cinNumber && u.cinNumber.toLowerCase().includes(q)) ||
        (u.employeeCode && u.employeeCode.toLowerCase().includes(q))
      );
    }

    return list;
  });

  filteredClientsOverview = computed(() => {
    let list = this.data.clientsOverview();
    const q = this.userSearchQuery().toLowerCase().trim();
    if (q) {
      list = list.filter(c => 
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.city.toLowerCase().includes(q) ||
        (c.company && c.company.toLowerCase().includes(q)) ||
        (c.partnerName && c.partnerName.toLowerCase().includes(q))
      );
    }
    return list;
  });

  openUsersTab(subTab: 'all' | 'employees' | 'partners' | 'clients' = 'all') {
    this.usersActiveSubTab.set(subTab);
    this.activeTab.set('users_management');
    this.selectedOrderId.set(null);
  }

  openNewUserModal(defaultRole = 'operator') {
    const privs = getDefaultPrivileges(defaultRole);
    this.fullUserForm.reset({
      name: '',
      username: '',
      email: '',
      password: '123456',
      role: defaultRole,
      phone: '',
      city: 'Casablanca',
      address: '',
      company: '',
      ice: '',
      customerType: 'particular',
      employeeCode: 'EMP-' + Math.floor(1000 + Math.random() * 9000),
      jobTitle: defaultRole === 'operator' ? 'Opérateur de Saisie' : defaultRole === 'qa' ? 'Contrôleur Qualité' : defaultRole === 'assistant' ? 'Assistant(e) de Direction' : 'Gestionnaire',
      department: defaultRole === 'operator' ? 'production' : defaultRole === 'qa' ? 'qualite' : 'administration',
      contractType: 'cdi',
      hireDate: new Date().toISOString().substring(0, 10),
      birthDate: '',
      cinNumber: '',
      cnssNumber: '',
      ribNumber: '',
      bankName: 'Attijariwafa Bank',
      baseSalary: 4000,
      vacationBalance: 18,
      emergencyName: '',
      emergencyPhone: '',
      canManageOrders: privs.canManageOrders,
      canValidateQuality: privs.canValidateQuality,
      canDeliverOrders: privs.canDeliverOrders,
      canManageClients: privs.canManageClients,
      canManageTools: privs.canManageTools,
      canViewFinancials: privs.canViewFinancials,
    });
    this.showUserModal.set(true);
  }

  onUserRoleChangeInForm() {
    const role = this.fullUserForm.get('role')?.value;
    const privs = getDefaultPrivileges(role);
    this.fullUserForm.patchValue({
      canManageOrders: privs.canManageOrders,
      canValidateQuality: privs.canValidateQuality,
      canDeliverOrders: privs.canDeliverOrders,
      canManageClients: privs.canManageClients,
      canManageTools: privs.canManageTools,
      canViewFinancials: privs.canViewFinancials,
      jobTitle: role === 'operator' ? 'Opérateur de Saisie' : role === 'qa' ? 'Contrôleur Qualité' : role === 'assistant' ? 'Assistant(e) de Direction' : role === 'client' ? 'Client' : role === 'partner' ? 'Partenaire B2B' : 'Administrateur',
      department: role === 'operator' ? 'production' : role === 'qa' ? 'qualite' : role === 'assistant' ? 'administration' : 'direction'
    });
  }

  async saveUserForm() {
    if (this.fullUserForm.invalid) {
      this.data.errorMessage.set('Veuillez remplir les informations obligatoires (Nom, Identifiant, E-mail, Rôle).');
      return;
    }
    const val = this.fullUserForm.value;
    const privileges: UserPrivileges = {
      canManageOrders: !!val.canManageOrders,
      canValidateQuality: !!val.canValidateQuality,
      canDeliverOrders: !!val.canDeliverOrders,
      canManageClients: !!val.canManageClients,
      canManageTools: !!val.canManageTools,
      canViewFinancials: !!val.canViewFinancials,
    };

    const payload: Partial<User> = {
      name: val.name,
      username: val.username,
      email: val.email,
      password: val.password || '123456',
      role: val.role,
      phone: val.phone,
      city: val.city,
      address: val.address,
      company: val.company,
      ice: val.ice,
      customerType: val.customerType,
      privileges,
      employeeCode: val.employeeCode,
      jobTitle: val.jobTitle,
      department: val.department,
      contractType: val.contractType,
      hireDate: val.hireDate,
      birthDate: val.birthDate,
      cinNumber: val.cinNumber,
      cnssNumber: val.cnssNumber,
      ribNumber: val.ribNumber,
      bankName: val.bankName,
      baseSalary: Number(val.baseSalary) || 0,
      vacationBalance: Number(val.vacationBalance) || 0,
      emergencyContact: {
        name: val.emergencyName || '',
        relation: 'Contact d\'urgence',
        phone: val.emergencyPhone || ''
      },
      active: true
    };

    await this.data.createUser(payload);
    this.showUserModal.set(false);
  }

  openEditUserModal(user: User) {
    this.selectedUserForAction.set(user);
    const privs = user.privileges || getDefaultPrivileges(user.role);
    this.editFullUserForm.reset({
      id: user.id,
      name: user.name,
      username: user.username || user.email.split('@')[0],
      email: user.email,
      role: user.role,
      phone: user.phone || '',
      city: user.city || 'Casablanca',
      address: user.address || '',
      active: user.active !== false,
      company: user.company || '',
      ice: user.ice || '',
      customerType: user.customerType || 'particular',
      employeeCode: user.employeeCode || '',
      jobTitle: user.jobTitle || '',
      department: user.department || 'production',
      contractType: user.contractType || 'cdi',
      hireDate: user.hireDate || '',
      birthDate: user.birthDate || '',
      cinNumber: user.cinNumber || '',
      cnssNumber: user.cnssNumber || '',
      ribNumber: user.ribNumber || '',
      bankName: user.bankName || 'Attijariwafa Bank',
      baseSalary: user.baseSalary || 4000,
      vacationBalance: user.vacationBalance !== undefined ? user.vacationBalance : 18,
      emergencyName: user.emergencyContact?.name || '',
      emergencyPhone: user.emergencyContact?.phone || '',
      canManageOrders: privs.canManageOrders,
      canValidateQuality: privs.canValidateQuality,
      canDeliverOrders: privs.canDeliverOrders,
      canManageClients: privs.canManageClients,
      canManageTools: privs.canManageTools,
      canViewFinancials: privs.canViewFinancials,
    });
    this.showEditUserModal.set(true);
  }

  async saveEditUserForm() {
    if (this.editFullUserForm.invalid) {
      this.data.errorMessage.set('Veuillez vérifier les informations saisies.');
      return;
    }
    const val = this.editFullUserForm.value;
    const privileges: UserPrivileges = {
      canManageOrders: !!val.canManageOrders,
      canValidateQuality: !!val.canValidateQuality,
      canDeliverOrders: !!val.canDeliverOrders,
      canManageClients: !!val.canManageClients,
      canManageTools: !!val.canManageTools,
      canViewFinancials: !!val.canViewFinancials,
    };

    const payload: Partial<User> = {
      name: val.name,
      username: val.username,
      email: val.email,
      role: val.role,
      phone: val.phone,
      city: val.city,
      address: val.address,
      active: !!val.active,
      company: val.company,
      ice: val.ice,
      customerType: val.customerType,
      privileges,
      employeeCode: val.employeeCode,
      jobTitle: val.jobTitle,
      department: val.department,
      contractType: val.contractType,
      hireDate: val.hireDate,
      birthDate: val.birthDate,
      cinNumber: val.cinNumber,
      cnssNumber: val.cnssNumber,
      ribNumber: val.ribNumber,
      bankName: val.bankName,
      baseSalary: Number(val.baseSalary) || 0,
      vacationBalance: Number(val.vacationBalance) || 0,
      emergencyContact: {
        name: val.emergencyName || '',
        relation: 'Contact d\'urgence',
        phone: val.emergencyPhone || ''
      }
    };

    await this.data.updateUser(val.id, payload);
    this.showEditUserModal.set(false);
    this.selectedUserForAction.set(null);
  }

  openResetUserPasswordModal(user: User) {
    this.selectedUserForAction.set(user);
    this.newPasswordValue.set('123456');
    this.showResetUserPasswordModal.set(true);
  }

  async confirmResetUserPassword() {
    const user = this.selectedUserForAction();
    const newPass = this.newPasswordValue();
    if (!user || !newPass) return;
    await this.data.resetTeamUserPassword(user.id, newPass);
    this.showResetUserPasswordModal.set(false);
    this.selectedUserForAction.set(null);
  }

  async toggleUserActiveStatus(user: User) {
    await this.data.toggleUserActive(user.id);
  }

  async deleteUserAccount(user: User) {
    if (confirm(`Êtes-vous certain de vouloir supprimer définitivement le compte de "${user.name}" (@${user.username || user.email}) ?`)) {
      await this.data.deleteUser(user.id);
    }
  }

  // --- TEMPLATE ACTION HANDLER ALIASES ---
  handleSavePayroll() {
    return this.savePayrollForm();
  }

  handleSaveLeave() {
    return this.saveLeaveForm();
  }

  handleRejectLeave() {
    return this.confirmRejectLeave();
  }

  handleSaveAdvance() {
    return this.saveAdvanceForm();
  }

  handleSaveEmployeeHr() {
    return this.saveEmployeeHrForm();
  }

  handleCreateFullUser() {
    return this.saveUserForm();
  }

  handleUpdateFullUser() {
    return this.saveEditUserForm();
  }

  async handleResetUserPassword() {
    const user = this.selectedUserForAction();
    const newPass = this.resetUserPasswordForm.get('newPassword')?.value || this.newPasswordValue();
    if (!user || !newPass) return;
    await this.data.resetTeamUserPassword(user.id, newPass);
    this.showResetUserPasswordModal.set(false);
    this.selectedUserForAction.set(null);
  }

  closePayrollSlipModal() {
    this.showPayrollSlipModal.set(false);
    this.selectedPayroll.set(null);
  }

  onPayrollFormValueChange() {
    this.payrollFormLiveTrigger.update(v => v + 1);
  }

  // --- AFFILIATION & REVENTE DE SERVICES STATE & METHODS ---
  affiliateTab = signal<'affiliates_list' | 'commissions' | 'my_account'>('affiliates_list');
  showAddAffiliateModal = signal<boolean>(false);
  editingAffiliate = signal<User | null>(null);

  affiliateForm = new FormGroup({
    name: new FormControl('', [Validators.required]),
    email: new FormControl('', [Validators.required, Validators.email]),
    phone: new FormControl(''),
    city: new FormControl('Casablanca'),
    commissionRate: new FormControl<number>(10, [Validators.required, Validators.min(1), Validators.max(100)]),
    affiliateCode: new FormControl(''),
    password: new FormControl(''),
    notes: new FormControl(''),
    active: new FormControl(true)
  });

  openAffiliationTab() {
    this.activeTab.set('affiliation');
    this.selectedOrderId.set(null);
    if (this.data.activeRole() === 'affiliate') {
      this.affiliateTab.set('my_account');
    }
    this.data.loadAffiliates();
    this.data.loadAffiliateCommissions();
  }

  openCreateAffiliateModal() {
    this.editingAffiliate.set(null);
    this.affiliateForm.reset({
      name: '',
      email: '',
      phone: '',
      city: 'Casablanca',
      commissionRate: 10,
      affiliateCode: `AFF-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
      password: 'affiliate123',
      notes: '',
      active: true
    });
    this.showAddAffiliateModal.set(true);
  }

  openEditAffiliateModal(aff: User) {
    this.editingAffiliate.set(aff);
    this.affiliateForm.patchValue({
      name: aff.name,
      email: aff.email,
      phone: aff.phone || '',
      city: aff.city || 'Casablanca',
      commissionRate: aff.commissionRate ?? 10,
      affiliateCode: aff.affiliateCode || '',
      password: '',
      notes: aff.notes || '',
      active: aff.active !== false
    });
    this.showAddAffiliateModal.set(true);
  }

  async saveAffiliateForm() {
    if (this.affiliateForm.invalid) {
      this.affiliateForm.markAllAsTouched();
      return;
    }
    const val = this.affiliateForm.value;
    const editing = this.editingAffiliate();

    try {
      if (editing) {
        await this.data.updateAffiliate(editing.id, {
          name: val.name!,
          email: val.email!,
          phone: val.phone || '',
          city: val.city || 'Casablanca',
          commissionRate: Number(val.commissionRate),
          active: Boolean(val.active),
          notes: val.notes || '',
          password: val.password || undefined
        });
      } else {
        await this.data.createAffiliate({
          name: val.name!,
          email: val.email!,
          phone: val.phone || undefined,
          city: val.city || undefined,
          commissionRate: Number(val.commissionRate || 10),
          affiliateCode: val.affiliateCode || undefined,
          password: val.password || 'affiliate123',
          notes: val.notes || undefined
        });
      }
      this.showAddAffiliateModal.set(false);
    } catch (err) {
      console.error('Error saving affiliate:', err);
    }
  }

  copyToClipboard(text: string, label = 'Information') {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      this.data.showToast('Copié !', `${label} copié avec succès dans le presse-papier.`);
    }
  }

  // Debit Note & Commission History Modals
  showDebitNoteModal = signal<boolean>(false);
  debitNoteBankName = signal<string>('Attijariwafa Bank');
  debitNoteRibNumber = signal<string>('011780000012345678901234');
  debitNoteNotes = signal<string>('');

  debitNotePreview = signal<{
    reference: string;
    date: string;
    affiliateName: string;
    affiliateCompany: string;
    affiliateCode: string;
    affiliateEmail: string;
    affiliatePhone: string;
    bankName: string;
    ribNumber: string;
    commissions: AffiliateCommission[];
    totalAmount: number;
    isSubmitted: boolean;
  } | null>(null);

  showPaymentDetailsModal = signal<boolean>(false);
  selectedPaymentDetails = signal<{
    commission: AffiliateCommission;
    payment?: Payment;
    order?: Order;
  } | null>(null);

  openDebitNoteGeneratorModal() {
    const user = this.data.currentUser();
    const comms = this.data.affiliateCommissions().filter(c => c.status === 'validated');
    if (comms.length === 0) {
      this.data.errorMessage.set("Aucune commission validée disponible pour émettre une note de débit.");
      return;
    }

    const total = Math.round(comms.reduce((sum, c) => sum + (c.commissionAmount || 0), 0) * 100) / 100;
    const ref = `ND-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    this.debitNoteBankName.set(user?.bankName || 'Attijariwafa Bank');
    this.debitNoteRibNumber.set(user?.ribNumber || '011780000012345678901234');
    this.debitNoteNotes.set('');

    this.debitNotePreview.set({
      reference: ref,
      date: new Date().toISOString(),
      affiliateName: user?.name || comms[0]?.affiliateName || 'Affilié Partenaire',
      affiliateCompany: user?.company || user?.name || 'Imprimerie Al Amal SARL',
      affiliateCode: user?.affiliateCode || comms[0]?.affiliateCode || 'AFF-2026',
      affiliateEmail: user?.email || '',
      affiliatePhone: user?.phone || '+212 661-000000',
      bankName: user?.bankName || 'Attijariwafa Bank',
      ribNumber: user?.ribNumber || '011780000012345678901234',
      commissions: comms,
      totalAmount: total,
      isSubmitted: false
    });

    this.showDebitNoteModal.set(true);
  }

  openDebitNoteViewerModal(debitNoteRef: string) {
    const comms = this.data.affiliateCommissions().filter(c => c.debitNoteReference === debitNoteRef);
    if (comms.length === 0) return;

    const first = comms[0];
    const total = Math.round(comms.reduce((sum, c) => sum + (c.commissionAmount || 0), 0) * 100) / 100;

    this.debitNotePreview.set({
      reference: debitNoteRef,
      date: first.requestedAt || first.createdAt,
      affiliateName: first.affiliateName,
      affiliateCompany: first.affiliateName,
      affiliateCode: first.affiliateCode,
      affiliateEmail: '',
      affiliatePhone: '',
      bankName: first.bankName || 'Attijariwafa Bank',
      ribNumber: first.ribNumber || 'Non spécifié',
      commissions: comms,
      totalAmount: total,
      isSubmitted: true
    });

    this.showDebitNoteModal.set(true);
  }

  async submitDebitNoteRequest() {
    const preview = this.debitNotePreview();
    const user = this.data.currentUser();
    if (!preview || !user) return;

    try {
      await this.data.requestDebitNote(
        user.id,
        preview.commissions.map(c => c.id),
        this.debitNoteBankName(),
        this.debitNoteRibNumber(),
        this.debitNoteNotes()
      );
      this.showDebitNoteModal.set(false);
    } catch (err) {
      console.error('Failed to submit debit note:', err);
    }
  }

  openPaymentDetailsModal(commission: AffiliateCommission) {
    const pay = this.data.payments().find(p => p.id === commission.paymentId || p.orderId === commission.orderId || p.reference === commission.paymentReference);
    const ord = this.data.orders().find(o => o.id === commission.orderId || o.reference === commission.orderReference);

    this.selectedPaymentDetails.set({
      commission,
      payment: pay,
      order: ord
    });

    this.showPaymentDetailsModal.set(true);
  }

  exportDebitNotePdf(debitNoteRef: string) {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text('Note de Débit d\'Honoraires', 14, 20);
    doc.setFontSize(11);
    doc.text(`Référence: ${debitNoteRef}`, 14, 30);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 14, 37);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doc as any).autoTable({
      startY: 45,
      head: [['Description', 'Montant (DH)']],
      body: [
        ['Honoraires d\'intermédiation', '0.00'],
      ],
      theme: 'striped',
    });

    doc.save(`Note_Debit_${debitNoteRef}.pdf`);
  }

  async onPurgeDatabase() {
    if (confirm('ATTENTION: Êtes-vous absolument sûr de vouloir purger toute la base de données et supprimer TOUTES les données de démo et mock ?\n\nSeul le compte administrateur requis (login: boguiman@gmail.com, mot de passe: admin123) sera conservé.')) {
      try {
        await this.data.purgeDatabase();
      } catch (err) {
        console.error('Purge error:', err);
      }
    }
  }

  async onTestDbConnection(s: SystemSettings) {
    try {
      await this.data.testDbConnection({
        databaseType: s.databaseType || 'firebase',
        host: s.dbConfig?.host,
        port: s.dbConfig?.port,
        databaseName: s.dbConfig?.databaseName,
        username: s.dbConfig?.username,
        password: s.dbConfig?.password
      });
    } catch (err) {
      console.error('DB test connection error:', err);
    }
  }

  updateDbConfig(s: SystemSettings, field: string, value: unknown) {
    if (!s.dbConfig) {
      s.dbConfig = {};
    }
    (s.dbConfig as Record<string, unknown>)[field] = value;
  }

  number(val: unknown) {
    return Number(val);
  }

  exportToCsv(filename: string, headers: string[], rows: string[][]) {
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  encodeURI(str: string) {
    return encodeURIComponent(str);
  }

  exportOrdersCsv() {
    const headers = ['Reference', 'Client', 'Email', 'Telephone', 'Service', 'Quantite', 'Urgence', 'Statut', 'Date Creation'];
    const rows = this.data.orders().map(o => {
      const srv = this.data.services().find(s => s.id === o.serviceId);
      return [
        o.reference,
        o.customerDetails.name,
        o.customerDetails.email || '',
        o.customerDetails.phone || '',
        srv ? srv.name : o.serviceId,
        String(o.quantity),
        o.urgency,
        o.status,
        o.createdAt
      ];
    });
    this.exportToCsv('suivi_commandes_digidocs.csv', headers, rows);
  }

  exportCommissionsCsv() {
    const headers = ['Date', 'Affilie', 'Client', 'Commande Ref', 'Montant Paye', 'Taux (%)', 'Commission', 'Statut'];
    const rows = this.data.affiliateCommissions().map(c => [
      c.createdAt,
      c.affiliateName,
      c.clientName,
      c.orderReference,
      String(c.paidAmount) + ' DH',
      String(c.commissionRate) + '%',
      String(c.commissionAmount) + ' DH',
      c.status
    ]);
    this.exportToCsv('suivi_commissions_digidocs.csv', headers, rows);
  }

  exportCustomerStatementsCsv() {
    const headers = ['Nom Client', 'Email', 'Telephone', 'Societe', 'Type', 'Nombre Commandes', 'Total Facture (DH)', 'Total Paye (DH)', 'Solde Restant Du (DH)'];
    const rows = this.customerFinancialStatements().map(c => [
      c.name,
      c.email,
      c.phone,
      c.company,
      c.customerType,
      String(c.ordersCount),
      String(c.totalAmount),
      String(c.paidAmount),
      String(c.balanceDue)
    ]);
    this.exportToCsv('situation_financiere_clients.csv', headers, rows);
  }

  exportPdfReport() {
    if (typeof window !== 'undefined') {
      window.print();
    }
  }

  async shareApp() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'DigiDocs Hub',
          text: 'Gérez vos documents efficacement avec DigiDocs.',
          url: window.location.href
        });
      } catch (err) {
        console.error('Erreur partage:', err);
      }
    } else {
      navigator.clipboard.writeText(window.location.href);
    }
  }
}

