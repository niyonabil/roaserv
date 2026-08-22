import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, computed, effect, viewChild, OnDestroy, AfterViewInit, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { Data, Service, CoverageLocationPoint, MOROCCAN_REGIONS, MOROCCAN_MAJOR_CITIES, COVERAGE_COUNTRIES } from './data';

@Component({
  selector: 'app-coverage-map',
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <!-- HEADER & COVERAGE OVERVIEW BANNER -->
      <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div class="absolute -right-12 -top-12 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div class="absolute right-1/3 -bottom-16 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div class="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div class="space-y-2 max-w-2xl">
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 text-xs font-semibold uppercase tracking-wider border border-blue-400/20">
              <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Réseau Géographique & Couverture Multi-Niveaux
            </div>
            <h2 class="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Carte des Services & Disponibilité Géographique
            </h2>
            <p class="text-slate-300 text-sm sm:text-base leading-relaxed">
              Consultez la disponibilité en temps réel de nos prestations : par <strong>pays</strong> (International & Maroc), par <strong>région</strong> (les 12 régions marocaines), par <strong>ville</strong> et par <strong>rue/quartier</strong> avec nos hubs, agences et points relais.
            </p>
          </div>

          <!-- Quick Stat Chips -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full lg:w-auto shrink-0">
            <!-- Card 1: Services Actifs -->
            <div class="bg-white/[0.08] backdrop-blur-md border border-white/15 rounded-2xl p-4 flex flex-col items-center justify-center text-center hover:bg-white/[0.12] transition duration-300 relative group overflow-hidden min-w-[120px] sm:min-w-[140px] shadow-lg shadow-black/10">
              <div class="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
              <div class="w-9 h-9 rounded-full bg-blue-500/25 text-blue-300 flex items-center justify-center mb-2 shadow-inner">
                <span class="material-icons text-base">layers</span>
              </div>
              <span class="text-[10px] sm:text-[11px] text-blue-200/90 font-bold tracking-wide uppercase whitespace-nowrap">Services Actifs</span>
              <span class="text-xl sm:text-2xl font-black text-white mt-1 tracking-tight">{{ data.services().length }}</span>
            </div>

            <!-- Card 2: Régions Couvertes -->
            <div class="bg-white/[0.08] backdrop-blur-md border border-white/15 rounded-2xl p-4 flex flex-col items-center justify-center text-center hover:bg-white/[0.12] transition duration-300 relative group overflow-hidden min-w-[120px] sm:min-w-[140px] shadow-lg shadow-black/10">
              <div class="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
              <div class="w-9 h-9 rounded-full bg-emerald-500/25 text-emerald-300 flex items-center justify-center mb-2 shadow-inner">
                <span class="material-icons text-base">explore</span>
              </div>
              <span class="text-[10px] sm:text-[11px] text-emerald-200/90 font-bold tracking-wide uppercase whitespace-nowrap">Régions</span>
              <span class="text-xl sm:text-2xl font-black text-emerald-400 mt-1 tracking-tight">12 / 12</span>
            </div>

            <!-- Card 3: Hubs & Agences -->
            <div class="bg-white/[0.08] backdrop-blur-md border border-white/15 rounded-2xl p-4 flex flex-col items-center justify-center text-center hover:bg-white/[0.12] transition duration-300 relative group overflow-hidden min-w-[120px] sm:min-w-[140px] shadow-lg shadow-black/10">
              <div class="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
              <div class="w-9 h-9 rounded-full bg-indigo-500/25 text-indigo-300 flex items-center justify-center mb-2 shadow-inner">
                <span class="material-icons text-base">domain</span>
              </div>
              <span class="text-[10px] sm:text-[11px] text-indigo-200/90 font-bold tracking-wide uppercase whitespace-nowrap">Hubs & Agences</span>
              <span class="text-xl sm:text-2xl font-black text-indigo-300 mt-1 tracking-tight">{{ allLocations().length }}</span>
            </div>

            <!-- Card 4: International -->
            <div class="bg-white/[0.08] backdrop-blur-md border border-white/15 rounded-2xl p-4 flex flex-col items-center justify-center text-center hover:bg-white/[0.12] transition duration-300 relative group overflow-hidden min-w-[120px] sm:min-w-[140px] shadow-lg shadow-black/10">
              <div class="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
              <div class="w-9 h-9 rounded-full bg-purple-500/25 text-purple-300 flex items-center justify-center mb-2 shadow-inner">
                <span class="material-icons text-base">language</span>
              </div>
              <span class="text-[10px] sm:text-[11px] text-purple-200/90 font-bold tracking-wide uppercase whitespace-nowrap">International</span>
              <span class="text-xl sm:text-2xl font-black text-purple-300 mt-1 tracking-tight">10+ Pays</span>
            </div>
          </div>
        </div>
      </div>

      <!-- MAIN LAYOUT: FILTERS & CHECKER + MAP -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        <!-- LEFT PANEL: FILTERS & VERIFIER (4 COLS) -->
        <div class="lg:col-span-4 space-y-6">

          <!-- 1. SERVICE AVAILABILITY CHECKER TOOL -->
          <div class="bg-white rounded-3xl border border-slate-200/80 p-5 sm:p-6 shadow-sm">
            <div class="flex items-center gap-2.5 pb-4 border-b border-slate-100">
              <div class="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-base">
                <span class="material-icons text-lg">verified</span>
              </div>
              <div>
                <h3 class="font-bold text-slate-800 text-base">Vérificateur de Disponibilité</h3>
                <p class="text-xs text-slate-500">Testez l'éligibilité pour votre adresse exacte</p>
              </div>
            </div>

            <div class="mt-4 space-y-3.5">
              <!-- Service select -->
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">Prestation demandée</label>
                <select 
                  [ngModel]="selectedVerifierServiceId()" 
                  (ngModelChange)="selectedVerifierServiceId.set($event)"
                  class="w-full text-xs sm:text-sm rounded-xl border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition py-2 px-3">
                  <option value="all">Tous les services du catalogue</option>
                  @for (srv of data.services(); track srv.id) {
                    <option [value]="srv.id">{{ srv.name }} ({{ srv.basePrice }} DH + {{ srv.unitPrice }} DH/{{ srv.unitPriceName }})</option>
                  }
                </select>
              </div>

              <!-- Country -->
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">Pays</label>
                <select 
                  [ngModel]="verifierCountry()" 
                  (ngModelChange)="onVerifierCountryChange($event)"
                  class="w-full text-xs sm:text-sm rounded-xl border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition py-2 px-3">
                  @for (c of countries; track c) {
                    <option [value]="c">{{ c }}</option>
                  }
                </select>
              </div>

              @if (verifierCountry() === 'Maroc') {
                <!-- Region -->
                <div>
                  <label class="block text-xs font-semibold text-slate-700 mb-1">Région</label>
                  <select 
                    [ngModel]="verifierRegion()" 
                    (ngModelChange)="verifierRegion.set($event)"
                    class="w-full text-xs sm:text-sm rounded-xl border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition py-2 px-3">
                    <option value="">Toutes les régions</option>
                    @for (r of regions; track r) {
                      <option [value]="r">{{ r }}</option>
                    }
                  </select>
                </div>

                <!-- City -->
                <div>
                  <label class="block text-xs font-semibold text-slate-700 mb-1">Ville</label>
                  <div class="relative">
                    <input 
                      type="text" 
                      [ngModel]="verifierCity()" 
                      (ngModelChange)="verifierCity.set($event)"
                      list="cities-list"
                      placeholder="Ex: Casablanca, Rabat, Marrakech..."
                      class="w-full text-xs sm:text-sm rounded-xl border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition py-2 px-3" />
                    <datalist id="cities-list">
                      @for (city of cities; track city) {
                        <option [value]="city"></option>
                      }
                    </datalist>
                  </div>
                </div>

                <!-- Street / Address -->
                <div>
                  <label class="block text-xs font-semibold text-slate-700 mb-1">Rue / Quartier / Agence (Optionnel)</label>
                  <input 
                    type="text" 
                    [ngModel]="verifierStreet()" 
                    (ngModelChange)="verifierStreet.set($event)"
                    placeholder="Ex: Boulevard d'Anfa, Agdal, Maarif..."
                    class="w-full text-xs sm:text-sm rounded-xl border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition py-2 px-3" />
                </div>
              }

              <!-- Action Button -->
              <button 
                type="button" 
                (click)="triggerVerification()"
                class="w-full mt-2 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs sm:text-sm font-semibold shadow-md shadow-blue-500/20 transition cursor-pointer">
                <span class="material-icons text-base">travel_explore</span>
                <span>Vérifier l'Éligibilité & Délais</span>
              </button>
            </div>

            <!-- RESULT CARD -->
            @if (verificationResult()) {
              @let res = verificationResult()!;
              <div class="mt-4 p-4 rounded-2xl border transition-all duration-300" [ngClass]="res.isEligible ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900' : 'bg-amber-50/70 border-amber-200 text-amber-900'">
                <div class="flex items-start gap-2.5">
                  <div class="w-6 h-6 rounded-full flex items-center justify-center text-white shrink-0 mt-0.5" [ngClass]="res.isEligible ? 'bg-emerald-600' : 'bg-amber-600'">
                    <span class="material-icons text-sm">{{ res.isEligible ? 'check' : 'info' }}</span>
                  </div>
                  <div class="space-y-1 text-xs">
                    <div class="font-bold text-sm">{{ res.title }}</div>
                    <p class="text-slate-700 leading-snug">{{ res.details }}</p>
                    
                    <div class="pt-2 flex flex-wrap gap-1.5 items-center">
                      <span class="px-2 py-0.5 rounded-full text-[11px] font-semibold" [ngClass]="res.badgeClass">
                        Périmètre : {{ res.scope }}
                      </span>
                      <span class="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 text-[11px] font-medium">
                        ⏱️ {{ res.estimatedDelay }}
                      </span>
                    </div>

                    @if (res.isEligible) {
                      <div class="pt-2">
                        <span class="text-[11px] font-semibold text-slate-800 block mb-1">Modes de délivrance :</span>
                        <div class="flex flex-wrap gap-1">
                          @for (m of res.deliveryModes; track m) {
                            <span class="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[10px] text-slate-700 font-medium">
                              {{ getDeliveryModeLabel(m) }}
                            </span>
                          }
                        </div>
                      </div>

                      <button 
                        type="button" 
                        (click)="onSelectServiceForOrder()"
                        class="w-full mt-3 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm transition flex items-center justify-center gap-1.5 cursor-pointer">
                        <span class="material-icons text-sm">shopping_bag</span>
                        <span>Commander ce service dans cette zone</span>
                      </button>
                    }
                  </div>
                </div>
              </div>
            }
          </div>

          <!-- 2. QUICK MAP CONTROLS & SCOPES -->
          <div class="bg-white rounded-3xl border border-slate-200/80 p-5 shadow-sm space-y-4">
            <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
              <span class="material-icons text-blue-600 text-base">center_focus_strong</span>
              Vues & Cadrages Rapides
            </h3>
            <div class="grid grid-cols-2 gap-2">
              <button 
                type="button"
                (click)="focusMapZone('morocco')"
                class="px-3 py-2 text-xs font-medium rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 transition text-left cursor-pointer">
                <span>🇲🇦</span> Tout le Maroc
              </button>
              <button 
                type="button"
                (click)="focusMapZone('casablanca')"
                class="px-3 py-2 text-xs font-medium rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 transition text-left cursor-pointer">
                <span>🏙️</span> Casablanca
              </button>
              <button 
                type="button"
                (click)="focusMapZone('rabat')"
                class="px-3 py-2 text-xs font-medium rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 transition text-left cursor-pointer">
                <span>🏛️</span> Rabat & Région
              </button>
              <button 
                type="button"
                (click)="focusMapZone('marrakech')"
                class="px-3 py-2 text-xs font-medium rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 transition text-left cursor-pointer">
                <span>🌴</span> Marrakech & Sud
              </button>
              <button 
                type="button"
                (click)="focusMapZone('tanger')"
                class="px-3 py-2 text-xs font-medium rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 transition text-left cursor-pointer">
                <span>🚢</span> Tanger & Nord
              </button>
              <button 
                type="button"
                (click)="focusMapZone('international')"
                class="px-3 py-2 text-xs font-medium rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 flex items-center gap-1.5 transition text-left cursor-pointer">
                <span>🌍</span> International
              </button>
            </div>
          </div>

        </div>

        <!-- RIGHT PANEL: INTERACTIVE LEAFLET MAP & LOCATION LIST (8 COLS) -->
        <div class="lg:col-span-8 space-y-6">

          <!-- MAP CONTAINER CARD -->
          <div class="bg-white rounded-3xl border border-slate-200/80 p-4 sm:p-5 shadow-sm flex flex-col">
            
            <!-- Map Filter Toolbar -->
            <div class="flex flex-wrap items-center justify-between gap-3 pb-4 mb-3 border-b border-slate-100">
              <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded-full bg-blue-600"></span>
                <span class="font-bold text-slate-800 text-sm sm:text-base">Carte Interactive des Implémentations</span>
                <span class="text-xs text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full font-medium">
                  {{ filteredLocations().length }} points actifs
                </span>
              </div>

              <!-- Filter by location type -->
              <div class="flex items-center gap-1.5 text-xs">
                <button 
                  type="button"
                  (click)="locationTypeFilter.set('all')"
                  [class]="locationTypeFilter() === 'all' ? 'bg-slate-900 text-white font-semibold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
                  class="px-2.5 py-1 rounded-lg transition cursor-pointer">
                  Tous
                </button>
                <button 
                  type="button"
                  (click)="locationTypeFilter.set('hub')"
                  [class]="locationTypeFilter() === 'hub' ? 'bg-blue-600 text-white font-semibold' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'"
                  class="px-2.5 py-1 rounded-lg transition cursor-pointer">
                  Hubs
                </button>
                <button 
                  type="button"
                  (click)="locationTypeFilter.set('agency')"
                  [class]="locationTypeFilter() === 'agency' ? 'bg-emerald-600 text-white font-semibold' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'"
                  class="px-2.5 py-1 rounded-lg transition cursor-pointer">
                  Agences
                </button>
                <button 
                  type="button"
                  (click)="locationTypeFilter.set('relay_point')"
                  [class]="locationTypeFilter() === 'relay_point' ? 'bg-indigo-600 text-white font-semibold' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'"
                  class="px-2.5 py-1 rounded-lg transition cursor-pointer">
                  Relais
                </button>
              </div>
            </div>

            <!-- Leaflet Container -->
            <div class="relative w-full h-[460px] sm:h-[520px] rounded-2xl overflow-hidden border border-slate-200/80 shadow-inner bg-slate-100">
              <div #mapContainer class="w-full h-full"></div>

              <!-- Map Legend Overlay -->
              <div class="absolute bottom-3 left-3 z-[400] bg-white/95 backdrop-blur-md rounded-2xl p-3 shadow-lg border border-slate-200/80 text-xs space-y-1.5 max-w-xs">
                <div class="font-bold text-slate-800 text-[11px] uppercase tracking-wider">Légende de la carte</div>
                <div class="flex items-center gap-2">
                  <span class="w-3 h-3 rounded-full bg-blue-600 shrink-0"></span>
                  <span class="text-slate-600">Hub Central / Traitement 24h</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="w-3 h-3 rounded-full bg-emerald-600 shrink-0"></span>
                  <span class="text-slate-600">Agence Régionale & Dépôt</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="w-3 h-3 rounded-full bg-indigo-600 shrink-0"></span>
                  <span class="text-slate-600">Point Relais Express</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="w-3 h-3 rounded-full bg-purple-600 shrink-0"></span>
                  <span class="text-slate-600">Hub International</span>
                </div>
              </div>
            </div>

            <!-- SELECTED LOCATION DETAIL MODAL / DRAWER -->
            @if (activeSelectedLocation()) {
              @let loc = activeSelectedLocation()!;
              <div class="mt-4 p-4 rounded-2xl bg-gradient-to-r from-blue-50/80 to-indigo-50/80 border border-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div class="space-y-1">
                  <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider" 
                      [ngClass]="loc.type === 'hub' ? 'bg-blue-600 text-white' : loc.type === 'agency' ? 'bg-emerald-600 text-white' : 'bg-indigo-600 text-white'">
                      {{ loc.type === 'hub' ? 'Hub Principal' : loc.type === 'agency' ? 'Agence Régionale' : 'Point Relais' }}
                    </span>
                    <h4 class="font-bold text-slate-900 text-sm sm:text-base">{{ loc.name }}</h4>
                  </div>
                  <p class="text-xs text-slate-600">
                    📍 <strong>{{ loc.streetAddress || loc.city }}</strong> — {{ loc.city }}, {{ loc.region }} ({{ loc.country }})
                  </p>
                  <p class="text-xs text-blue-800 font-medium">
                    ⚡ Rayon d'action : <strong>{{ loc.radiusKm }} km</strong> | ⏱️ Délais : <strong>{{ loc.deliveryDelay }}</strong> | 📞 {{ loc.phone }}
                  </p>
                </div>

                <div class="flex items-center gap-2 shrink-0">
                  <button 
                    type="button" 
                    (click)="focusOnLocation(loc)"
                    class="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition flex items-center gap-1 cursor-pointer">
                    <span class="material-icons text-sm">my_location</span>
                    <span>Centrer</span>
                  </button>
                  <button 
                    type="button" 
                    (click)="activeSelectedLocation.set(null)"
                    class="px-2.5 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-600 text-xs font-semibold border border-slate-200 transition cursor-pointer">
                    Fermer
                  </button>
                </div>
              </div>
            }

          </div>

          <!-- LIST OF HUBS & AGENCIES BY REGION -->
          <div class="bg-white rounded-3xl border border-slate-200/80 p-5 sm:p-6 shadow-sm space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-bold text-slate-800 text-base">Répertoire des Agences & Points de Contact</h3>
                <p class="text-xs text-slate-500">Adresses précises et zones de couverture immédiate</p>
              </div>
              <span class="text-xs font-semibold text-slate-600 bg-slate-100 px-3 py-1 rounded-full">
                {{ filteredLocations().length }} établissements
              </span>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              @for (loc of filteredLocations(); track loc.id) {
                <div 
                  (click)="focusOnLocation(loc)"
                  class="p-4 rounded-2xl border border-slate-200/70 hover:border-blue-400 hover:shadow-md bg-slate-50/50 hover:bg-white transition duration-200 cursor-pointer group flex flex-col justify-between">
                  <div class="space-y-1.5">
                    <div class="flex items-center justify-between">
                      <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                        [ngClass]="loc.type === 'hub' ? 'bg-blue-100 text-blue-700' : loc.type === 'agency' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'">
                        {{ loc.type }}
                      </span>
                      <span class="text-[11px] text-slate-500 font-medium">📍 {{ loc.city }}</span>
                    </div>
                    <div class="font-bold text-slate-800 text-sm group-hover:text-blue-600 transition">
                      {{ loc.name }}
                    </div>
                    <div class="text-xs text-slate-600 line-clamp-1">
                      {{ loc.streetAddress }}
                    </div>
                  </div>

                  <div class="mt-3 pt-3 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-500">
                    <span>⚡ Rayon : {{ loc.radiusKm }} km</span>
                    <span class="text-blue-600 font-semibold flex items-center gap-0.5">
                      Voir sur carte <span class="material-icons text-xs">arrow_forward</span>
                    </span>
                  </div>
                </div>
              }
            </div>
          </div>

        </div>

      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class CoverageMap implements AfterViewInit, OnDestroy {
  readonly data = inject(Data);
  readonly mapContainer = viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  selectService = output<string>();
  customLocations = input<CoverageLocationPoint[] | null>(null);

  constructor() {
    effect(() => {
      const locs = this.filteredLocations();
      if (this.mapInstance) {
        this.renderMapLocations();
      }
    });
  }

  // Lookup constants
  readonly regions = MOROCCAN_REGIONS;
  readonly cities = MOROCCAN_MAJOR_CITIES;
  readonly countries = COVERAGE_COUNTRIES;

  // Filter and Verifier signals
  selectedVerifierServiceId = signal<string>('all');
  verifierCountry = signal<string>('Maroc');
  verifierRegion = signal<string>('');
  verifierCity = signal<string>('Casablanca');
  verifierStreet = signal<string>("Boulevard d'Anfa");
  locationTypeFilter = signal<string>('all');

  activeSelectedLocation = signal<CoverageLocationPoint | null>(null);

  verificationResult = signal<{
    isEligible: boolean;
    scope: string;
    badgeClass: string;
    title: string;
    details: string;
    deliveryModes: string[];
    estimatedDelay: string;
  } | null>(null);

  allLocations = computed(() => this.customLocations() ?? this.data.coverageLocations());

  filteredLocations = computed(() => {
    const list = this.allLocations();
    const typeFilter = this.locationTypeFilter();
    if (typeFilter === 'all') return list;
    return list.filter(l => l.type === typeFilter);
  });

  private mapInstance: any = null;
  private markersLayer: any = null;
  private circlesLayer: any = null;

  ngAfterViewInit() {
    if (typeof window !== 'undefined') {
      // Defer slightly to ensure container layout is calculated
      setTimeout(() => {
        this.initLeafletMap();
        this.triggerVerification();
      }, 100);
    }
  }

  ngOnDestroy() {
    if (this.mapInstance) {
      try {
        this.mapInstance.remove();
      } catch (e) {
        console.warn('Map cleanup error:', e);
      }
    }
  }

  onVerifierCountryChange(c: string) {
    this.verifierCountry.set(c);
    if (c !== 'Maroc') {
      this.verifierRegion.set('');
      this.verifierCity.set('');
      this.verifierStreet.set('');
      this.focusMapZone('international');
    } else {
      this.verifierCity.set('Casablanca');
      this.verifierStreet.set("Boulevard d'Anfa");
      this.focusMapZone('morocco');
    }
    this.triggerVerification();
  }

  triggerVerification() {
    const sId = this.selectedVerifierServiceId();
    const country = this.verifierCountry();
    const region = this.verifierRegion();
    const city = this.verifierCity();
    const street = this.verifierStreet();

    let targetService = this.data.services().find(s => s.id === sId);
    if (!targetService) {
      // Default to first service for testing
      targetService = this.data.services()[0];
    }

    if (targetService) {
      const res = this.data.checkServiceCoverage(targetService, country, region, city, street);
      this.verificationResult.set(res);
    }
  }

  getDeliveryModeLabel(mode: string): string {
    const map: Record<string, string> = {
      digital_download: 'Téléchargement Direct',
      email: 'Envoi E-mail Sécurisé',
      express_courier: 'Coursier Express à Domicile',
      agency_pickup: 'Retrait en Agence',
      postal_shipping: 'Courrier Postal Recommandé',
      international_express: 'DHL / Express International'
    };
    return map[mode] || mode;
  }

  onSelectServiceForOrder() {
    const sId = this.selectedVerifierServiceId();
    if (sId && sId !== 'all') {
      this.selectService.emit(sId);
    } else if (this.data.services().length > 0) {
      this.selectService.emit(this.data.services()[0].id);
    }
  }

  private async initLeafletMap() {
    const container = this.mapContainer()?.nativeElement;
    if (!container) return;

    try {
      const L = await import('leaflet');

      // Moroccan central coords: [31.7917, -7.0926], Zoom 6
      this.mapInstance = L.map(container, {
        center: [31.7917, -7.0926],
        zoom: 6,
        zoomControl: true,
        scrollWheelZoom: false
      });

      // Add OpenStreetMap tile layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18
      }).addTo(this.mapInstance);

      this.markersLayer = L.layerGroup().addTo(this.mapInstance);
      this.circlesLayer = L.layerGroup().addTo(this.mapInstance);

      this.renderMapLocations();

      // Ensure proper resizing after render
      setTimeout(() => {
        this.mapInstance?.invalidateSize();
      }, 300);

    } catch (err) {
      console.error('Failed to initialize Leaflet map:', err);
    }
  }

  private async renderMapLocations() {
    if (!this.mapInstance || !this.markersLayer || !this.circlesLayer) return;

    const L = await import('leaflet');

    this.markersLayer.clearLayers();
    this.circlesLayer.clearLayers();

    const locs = this.filteredLocations();

    locs.forEach(loc => {
      // Pin color based on type
      let pinColor = '#2563eb'; // blue for hub
      let circleColor = '#3b82f6';
      if (loc.type === 'agency') {
        pinColor = '#059669'; // emerald
        circleColor = '#10b981';
      } else if (loc.type === 'relay_point') {
        pinColor = '#6366f1'; // indigo
        circleColor = '#818cf8';
      }

      const customIcon = L.divIcon({
        className: 'custom-map-pin',
        html: `
          <div style="background-color: ${pinColor}; width: 28px; height: 28px; border-radius: 9999px; display: flex; align-items: center; justify-content: center; color: white; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3); border: 2px solid white;">
            <span style="font-size: 14px; font-weight: bold;">${loc.type === 'hub' ? '★' : '📍'}</span>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14]
      });

      const marker = L.marker([loc.lat, loc.lng], { icon: customIcon });

      const popupContent = `
        <div style="padding: 12px; max-width: 260px;">
          <div style="font-size: 10px; font-weight: bold; text-transform: uppercase; color: ${pinColor}; letter-spacing: 0.5px;">${loc.type.toUpperCase()}</div>
          <div style="font-size: 14px; font-weight: bold; color: #0f172a; margin-top: 2px;">${loc.name}</div>
          <div style="font-size: 12px; color: #475569; margin-top: 4px;">📍 ${loc.streetAddress || loc.city}</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 6px; border-top: 1px solid #e2e8f0; padding-top: 6px;">
            <div>⚡ <strong>Rayon :</strong> ${loc.radiusKm || 25} km</div>
            <div>⏱️ <strong>Délai :</strong> ${loc.deliveryDelay || 'Express'}</div>
            <div>📞 <strong>Contact :</strong> ${loc.phone || '+212 522-000000'}</div>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);

      marker.on('click', () => {
        this.activeSelectedLocation.set(loc);
      });

      this.markersLayer.addLayer(marker);

      // Add radius circle
      if (loc.radiusKm && loc.radiusKm > 0) {
        const circle = L.circle([loc.lat, loc.lng], {
          radius: loc.radiusKm * 1000,
          color: circleColor,
          fillColor: circleColor,
          fillOpacity: 0.12,
          weight: 1.5,
          dashArray: '4, 6'
        });
        this.circlesLayer.addLayer(circle);
      }
    });
  }

  focusOnLocation(loc: CoverageLocationPoint) {
    this.activeSelectedLocation.set(loc);
    if (this.mapInstance) {
      this.mapInstance.flyTo([loc.lat, loc.lng], 13, {
        duration: 1.2
      });
    }
  }

  focusMapZone(zone: 'morocco' | 'casablanca' | 'rabat' | 'marrakech' | 'tanger' | 'international') {
    if (!this.mapInstance) return;

    switch (zone) {
      case 'morocco':
        this.mapInstance.flyTo([31.7917, -7.0926], 6, { duration: 1 });
        break;
      case 'casablanca':
        this.mapInstance.flyTo([33.5892, -7.6186], 12, { duration: 1 });
        break;
      case 'rabat':
        this.mapInstance.flyTo([34.0195, -6.8361], 12, { duration: 1 });
        break;
      case 'marrakech':
        this.mapInstance.flyTo([31.6346, -8.0139], 12, { duration: 1 });
        break;
      case 'tanger':
        this.mapInstance.flyTo([35.7767, -5.8039], 12, { duration: 1 });
        break;
      case 'international':
        this.mapInstance.flyTo([46.2276, 2.2137], 4, { duration: 1 });
        break;
    }
  }
}
