import { Service, User, AffiliateWithStats } from './data';

export interface SitemapUrlEntry {
  loc: string;
  lastmod?: string;
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
  title?: string;
  category?: 'core' | 'service' | 'affiliate' | 'tool' | 'legal';
}

export const DEFAULT_BASE_URL = 'https://digidocs.ma';

/**
 * Generates an array of crawlable URL entries for all public pages, services,
 * calculators, and affiliate/parrain landing pages.
 */
export function getAllIndexedRoutes(
  services: Service[] = [],
  affiliates: (User | AffiliateWithStats)[] = [],
  baseUrl: string = DEFAULT_BASE_URL
): SitemapUrlEntry[] {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const today = new Date().toISOString().split('T')[0];

  const routes: SitemapUrlEntry[] = [
    // Core landing & sections
    {
      loc: `${cleanBase}/`,
      lastmod: today,
      changefreq: 'daily',
      priority: 1.0,
      title: 'Accueil — Plateforme de Saisie, Numérisation & Gestion Documentaire',
      category: 'core'
    },
    {
      loc: `${cleanBase}/#services`,
      lastmod: today,
      changefreq: 'weekly',
      priority: 0.9,
      title: 'Catalogue des Services Documentaires & Numérisation',
      category: 'core'
    },
    {
      loc: `${cleanBase}/#simulator`,
      lastmod: today,
      changefreq: 'weekly',
      priority: 0.85,
      title: 'Simulateur de Devis & Calculateur Tarifaire Instantané',
      category: 'tool'
    },
    {
      loc: `${cleanBase}/#workflow`,
      lastmod: today,
      changefreq: 'monthly',
      priority: 0.8,
      title: 'Notre Processus de Production & Contrôle Qualité',
      category: 'core'
    },
    {
      loc: `${cleanBase}/#parrainage`,
      lastmod: today,
      changefreq: 'weekly',
      priority: 0.85,
      title: 'Programme de Parrainage & Affiliation Officiel',
      category: 'affiliate'
    },
    {
      loc: `${cleanBase}/#tarifs`,
      lastmod: today,
      changefreq: 'weekly',
      priority: 0.8,
      title: 'Grille Tarifaire Transparente & Délais de Livraison',
      category: 'core'
    },
    {
      loc: `${cleanBase}/#faq`,
      lastmod: today,
      changefreq: 'monthly',
      priority: 0.7,
      title: 'Foire Aux Questions & Démarches Légales CNDP',
      category: 'core'
    },
    {
      loc: `${cleanBase}/#contact`,
      lastmod: today,
      changefreq: 'monthly',
      priority: 0.7,
      title: 'Contact & Support Client Dédié au Maroc',
      category: 'core'
    }
  ];

  // Dynamic Service Landing URLs
  const activeServices = services.filter(s => s.isActive !== false);
  for (const srv of activeServices) {
    const slug = srv.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    routes.push({
      loc: `${cleanBase}/?service=${encodeURIComponent(srv.id)}&slug=${slug}`,
      lastmod: today,
      changefreq: 'weekly',
      priority: 0.85,
      title: `${srv.name} — Tarif & Commande Directe`,
      category: 'service'
    });
  }

  // Dynamic Sponsor / Parrain Affiliate Landing URLs
  const activeAffiliates = affiliates.filter(a => a.active !== false);
  const seenCodes = new Set<string>();

  for (const aff of activeAffiliates) {
    const code = (aff.affiliateCode || aff.id || '').toUpperCase();
    if (!code || seenCodes.has(code)) continue;
    seenCodes.add(code);

    const sponsorName = aff.name || 'Ambassadeur Agréé';
    const city = aff.city || 'Maroc';

    routes.push({
      loc: `${cleanBase}/?parrain=${encodeURIComponent(code)}`,
      lastmod: today,
      changefreq: 'weekly',
      priority: 0.75,
      title: `Parrainage ${sponsorName} (${city}) — 10% de Réduction Immédiate`,
      category: 'affiliate'
    });
  }

  return routes;
}

/**
 * Builds standard XML sitemap output conforming to sitemaps.org schema.
 */
export function generateSitemapXml(
  services: Service[] = [],
  affiliates: (User | AffiliateWithStats)[] = [],
  baseUrl: string = DEFAULT_BASE_URL
): string {
  const routes = getAllIndexedRoutes(services, affiliates, baseUrl);

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n`;
  xml += `        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n`;
  xml += `        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"\n`;
  xml += `        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9\n`;
  xml += `        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">\n`;

  for (const r of routes) {
    xml += `  <url>\n`;
    xml += `    <loc>${escapeXml(r.loc)}</loc>\n`;
    if (r.lastmod) {
      xml += `    <lastmod>${r.lastmod}</lastmod>\n`;
    }
    if (r.changefreq) {
      xml += `    <changefreq>${r.changefreq}</changefreq>\n`;
    }
    if (r.priority !== undefined) {
      xml += `    <priority>${r.priority.toFixed(2)}</priority>\n`;
    }
    xml += `  </url>\n`;
  }

  xml += `</urlset>\n`;
  return xml;
}

/**
 * Builds standard robots.txt output
 */
export function generateRobotsTxt(baseUrl: string = DEFAULT_BASE_URL): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `# robots.txt for DigiDocs Hub / ROA Services
User-agent: *
Allow: /
Allow: /?parrain=*
Allow: /?ref=*
Allow: /?service=*
Disallow: /api/
Disallow: /admin
Disallow: /checkout/session
Disallow: /internal/

# Sitemap Location
Sitemap: ${cleanBase}/sitemap.xml
`;
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}
