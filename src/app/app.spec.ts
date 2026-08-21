import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('Remix Gestion de Travaux Numériques Unit Tests', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the App component successfully', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should initialize with correct default view and state signals', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app.showAuthModal()).toBeNull();
    expect(app.isAnalyzingDoc()).toBe(false);
    expect(app.isDraftingSpec()).toBe(false);
    expect(app.isDraftingReply()).toBe(false);
    expect(app.showAiSpecModal()).toBe(false);
    expect(app.showAiDraftModal()).toBe(false);
    expect(app.isCreatingNewCustomer()).toBe(false);
  });

  it('should calculate estimated price based on service, quantity and urgency in landingEstimate', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    // Seed services for isolated unit testing
    app.data.services.set([
      {
        id: 'srv-1',
        name: 'Saisie de manuscrit',
        category: 'saisie',
        description: 'Saisie de manuscrits vers Word',
        priceMethod: 'per_page',
        basePrice: 0,
        unitPriceName: 'Page',
        unitPrice: 2.00,
        isActive: true,
        options: [
          { id: 'opt-1-1', name: 'Correction avancée', price: 0.50 }
        ]
      }
    ]);

    app.estServiceId.set('srv-1');
    app.estQuantity.set(20);
    app.estUrgency.set('normal');
    app.estPrintOption.set(false);
    app.estDeliveryOption.set(false);
    app.estOptionsSelected.set([]);

    const estimate = app.landingEstimate;
    expect(estimate).toBeDefined();
    expect(estimate.total).toBe(40);
    expect(estimate.depositPercent).toBe(50);
    expect(estimate.deposit).toBe(20);
  });

  it('should apply urgency surcharges and add-on options in landingEstimate', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    app.data.services.set([
      {
        id: 'srv-1',
        name: 'Saisie de manuscrit',
        category: 'saisie',
        description: 'Saisie de manuscrits vers Word',
        priceMethod: 'per_page',
        basePrice: 0,
        unitPriceName: 'Page',
        unitPrice: 2.00,
        isActive: true,
        options: [
          { id: 'opt-1-1', name: 'Correction avancée', price: 0.50 }
        ]
      }
    ]);

    app.estServiceId.set('srv-1');
    app.estQuantity.set(10);
    app.estUrgency.set('urgent'); // Urgency surcharge (+60%)
    app.estPrintOption.set(true); // +0.5/page
    app.estPrintColor.set('nb');
    app.estPrintPages.set(10);
    app.estDeliveryOption.set(true); // +30 DH

    const estimate = app.landingEstimate;
    expect(estimate.base).toBe(20);
    expect(estimate.urgency).toBe(12); // 20 * 0.6 = 12
    expect(estimate.printing).toBe(5); // 0.5 * 10 = 5
    expect(estimate.delivery).toBe(30);
    expect(estimate.total).toBe(67); // 20 + 12 + 5 + 30
    expect(estimate.depositPercent).toBe(70);
  });

  it('should toggle options in estimator', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    expect(app.estOptionsSelected().includes('opt-1-1')).toBe(false);
    app.toggleEstOption('opt-1-1');
    expect(app.estOptionsSelected().includes('opt-1-1')).toBe(true);
    app.toggleEstOption('opt-1-1');
    expect(app.estOptionsSelected().includes('opt-1-1')).toBe(false);
  });

  it('should validate auth and order reactive forms with username and password', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    // Auth Form validation
    expect(app.authForm.valid).toBe(false);
    app.authForm.patchValue({
      identifier: 'boguiman',
      password: 'admin'
    });
    expect(app.authForm.valid).toBe(true);

    // Test demo fill
    app.fillDemoCredentials('admin');
    expect(app.authForm.get('identifier')?.value).toBe('boguiman');
    expect(app.authForm.get('password')?.value).toBe('admin123');

    // Test password toggle
    expect(app.showPassword()).toBe(false);
    app.togglePasswordVisibility();
    expect(app.showPassword()).toBe(true);
    app.togglePasswordVisibility();
    expect(app.showPassword()).toBe(false);

    // Order Form validation
    expect(app.orderForm.controls['serviceId'].valid).toBe(false);
    app.orderForm.patchValue({
      serviceId: 'srv-1',
      quantity: 15,
      description: 'Numérisation et saisie de registre',
      urgency: 'normal'
    });
    expect(app.orderForm.controls['serviceId'].valid).toBe(true);
    expect(app.orderForm.controls['quantity'].valid).toBe(true);
  });

  it('should handle AI modal states and suggestion application to chat', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    // Set suggestion
    app.suggestedMessage.set('Bonjour, votre travail de saisie a été validé.');
    app.showAiDraftModal.set(true);

    expect(app.showAiDraftModal()).toBe(true);
    expect(app.suggestedMessage()).toBe('Bonjour, votre travail de saisie a été validé.');

    // Apply suggestion to chat
    app.applyAiChatSuggestion();

    expect(app.chatMessage()).toBe('Bonjour, votre travail de saisie a été validé.');
    expect(app.showAiDraftModal()).toBe(false);
    expect(app.suggestedMessage()).toBeNull();
  });

  it('should categorize order files correctly by directory folder', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    const mockFiles = [
      {
        id: 'f-1',
        name: 'scan_original.pdf',
        type: 'application/pdf',
        size: 1024 * 1024,
        folder: '01_DOCUMENTS_ORIGINAUX' as const,
        version: 1,
        uploadedBy: 'Client',
        uploadedAt: new Date().toISOString()
      },
      {
        id: 'f-2',
        name: 'transcription_v1.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 250000,
        folder: '05_VERSION_FINALE' as const,
        version: 1,
        uploadedBy: 'Opérateur',
        uploadedAt: new Date().toISOString()
      }
    ];

    const originalFiles = app.getFilesByFolder(mockFiles, '01_DOCUMENTS_ORIGINAUX');
    expect(originalFiles.length).toBe(1);
    expect(originalFiles[0].name).toBe('scan_original.pdf');

    const finalFiles = app.getFilesByFolder(mockFiles, '05_VERSION_FINALE');
    expect(finalFiles.length).toBe(1);
    expect(finalFiles[0].name).toBe('transcription_v1.docx');

    const emptyFolder = app.getFilesByFolder(mockFiles, '07_PREUVES');
    expect(emptyFolder.length).toBe(0);
  });

  it('should manage service form, options, and modal states for catalog CRUD', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;

    // Open new service modal
    app.openNewServiceModal();
    expect(app.showServiceModal()).toBe(true);
    expect(app.editingServiceId()).toBeNull();
    expect(app.serviceForm.get('name')?.value).toBe('');

    // Add option
    app.newOptionName.set('Reliure spirale');
    app.newOptionPrice.set(15);
    app.addServiceOption();
    expect(app.serviceOptionsList().length).toBe(1);
    expect(app.serviceOptionsList()[0].name).toBe('Reliure spirale');
    expect(app.serviceOptionsList()[0].price).toBe(15);

    // Remove option
    const optId = app.serviceOptionsList()[0].id;
    app.removeServiceOption(optId);
    expect(app.serviceOptionsList().length).toBe(0);

    // Open edit modal for existing service
    const existingService = {
      id: 'srv-edit-test',
      name: 'Service Test Édition',
      category: 'conversion' as const,
      description: 'Description test',
      priceMethod: 'per_page' as const,
      basePrice: 10,
      unitPriceName: 'Feuille',
      unitPrice: 5,
      isActive: true,
      imageUrl: 'https://example.com/img.jpg',
      options: [{ id: 'opt-x', name: 'Option X', price: 2 }]
    };

    app.openEditServiceModal(existingService);
    expect(app.showServiceModal()).toBe(true);
    expect(app.editingServiceId()).toBe('srv-edit-test');
    expect(app.serviceForm.get('name')?.value).toBe('Service Test Édition');
    expect(app.serviceImageBase64()).toBe('https://example.com/img.jpg');
    expect(app.serviceOptionsList().length).toBe(1);

    // Remove image
    app.removeServiceImage();
    expect(app.serviceImageBase64()).toBeNull();
    expect(app.serviceForm.get('imageUrl')?.value).toBe('');
  });
});
