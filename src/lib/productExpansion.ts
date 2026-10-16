// Splits product totals (which list bundles and replacements as their own
// line items) into counts of the physical base products that need packing,
// e.g. "Galaxy Projector + Sunset Lamp Bundle" counts as one Galaxy Projector
// and one Sunset Lamp. Matching is keyword based on the product name, so new
// bundles made of known products are picked up automatically.

export interface ExpandedProductSource {
  name: string;
  units: number;
  kind: 'single' | 'bundle' | 'replacement';
}

export interface ExpandedProductTotal {
  key: string;
  label: string;
  total: number;
  fromSingles: number;
  fromBundles: number;
  fromReplacements: number;
  // Units per variant (e.g. Wired / Rechargeable). Units whose variant could
  // not be determined are not included here.
  variants: Record<string, number>;
  sources: ExpandedProductSource[];
  // False for names that don't match any known base product (accessories,
  // unknown items); these are carried over unchanged.
  isBaseProduct: boolean;
}

interface BaseProduct {
  key: string;
  label: string;
  match: RegExp;
  variant?: (name: string) => string | undefined;
}

const BASE_PRODUCTS: BaseProduct[] = [
  {
    key: 'galaxy',
    label: 'Galaxy Projector',
    match: /\bgalaxy\b/,
  },
  {
    key: 'sunset',
    label: 'Sunset Lamp',
    match: /\bsunset\b/,
  },
  {
    key: 'wave',
    label: 'Wave Projector',
    match: /\bwave\b/,
    variant: (name) => {
      if (/\bwired\b/.test(name)) return 'Wired';
      if (/\b(rechargeable|wireless)\b/.test(name)) return 'Rechargeable';
      return undefined;
    },
  },
  {
    key: 'aurora',
    label: 'Aurora Lamp',
    match: /\baurora\b/,
  },
  {
    key: 'nova',
    label: 'Nova',
    match: /\bnova\b/,
  },
  {
    key: 'crystal',
    label: 'AstroSphere Crystal Lamp',
    match: /\b(astrosphere|crystal lamp)\b/,
    variant: (name) => {
      // The product title itself mentions "Moon Lamp & Saturn Lamp"; the
      // actual variant is whatever follows it.
      const rest = name.replace(/moon lamp\s*&\s*saturn lamp/, ' ');
      if (/\bsolar system\b/.test(rest)) return 'Solar System';
      if (/\bsaturn\b/.test(rest)) return 'Saturn';
      if (/\bmoon\b/.test(rest)) return 'Moon';
      return undefined;
    },
  },
];

// Accessories that mention a lamp name (e.g. "Remote (Sunset Lamp)") must not
// be counted as the lamp itself.
const ACCESSORY_PATTERN = /\b(remote|charger|cable|adapter|battery|batteries)\b/;

const normalizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

export const getBaseProductComponents = (productName: string) => {
  const name = normalizeName(productName);
  if (!name || ACCESSORY_PATTERN.test(name)) return [];

  return BASE_PRODUCTS.filter((p) => p.match.test(name)).map((p) => ({
    product: p,
    variant: p.variant?.(name),
  }));
};

export const expandProductTotals = (
  totals: Record<string, { total: number }>
): ExpandedProductTotal[] => {
  const expanded: Record<string, ExpandedProductTotal> = {};

  const getEntry = (key: string, label: string, isBaseProduct: boolean) => {
    if (!expanded[key]) {
      expanded[key] = {
        key,
        label,
        total: 0,
        fromSingles: 0,
        fromBundles: 0,
        fromReplacements: 0,
        variants: {},
        sources: [],
        isBaseProduct,
      };
    }
    return expanded[key];
  };

  for (const [name, { total: units }] of Object.entries(totals)) {
    if (!units) continue;

    const components = getBaseProductComponents(name);

    if (components.length === 0) {
      const entry = getEntry(`other:${name}`, name, false);
      entry.total += units;
      entry.fromSingles += units;
      entry.sources.push({ name, units, kind: 'single' });
      continue;
    }

    const kind: ExpandedProductSource['kind'] =
      components.length > 1
        ? 'bundle'
        : /\breplacement\b/i.test(name)
          ? 'replacement'
          : 'single';

    for (const { product, variant } of components) {
      const entry = getEntry(product.key, product.label, true);
      entry.total += units;
      if (kind === 'bundle') entry.fromBundles += units;
      else if (kind === 'replacement') entry.fromReplacements += units;
      else entry.fromSingles += units;
      if (variant) entry.variants[variant] = (entry.variants[variant] || 0) + units;
      entry.sources.push({ name, units, kind });
    }
  }

  return Object.values(expanded)
    .map((entry) => ({
      ...entry,
      sources: [...entry.sources].sort((a, b) => b.units - a.units),
    }))
    .sort((a, b) => {
      if (a.isBaseProduct !== b.isBaseProduct) return a.isBaseProduct ? -1 : 1;
      return b.total - a.total;
    });
};
