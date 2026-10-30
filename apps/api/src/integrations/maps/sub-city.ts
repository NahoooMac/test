// Maps the free-text district names geocoders return onto our 11 sub-city slugs.
// Spellings vary (Yandex, OSM, local usage), so each slug has several aliases.
const ALIASES: Record<string, string[]> = {
  bole: ['bole'],
  kirkos: ['kirkos', 'qirqos', 'kirqos'],
  yeka: ['yeka'],
  'nifas-silk-lafto': ['nifas silk', 'nefas silk', 'nifas silk lafto', 'nefas silk lafto'],
  arada: ['arada'],
  'addis-ketema': ['addis ketema'],
  lideta: ['lideta', 'ledeta', 'lidetta'],
  'kolfe-keranio': ['kolfe', 'kolfe keranio', 'kolfe keraniyo'],
  gullele: ['gullele', 'gulele'],
  'akaki-kality': ['akaki', 'akaky', 'kality', 'kaliti'],
  'lemi-kura': ['lemi kura', 'lemi'],
};

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .replace(/\bsub ?city\b/g, '')
    .trim();

export function matchSubCity(names: string[]): string | null {
  for (const raw of names) {
    const name = normalize(raw);
    for (const [slug, aliases] of Object.entries(ALIASES)) {
      if (aliases.some((a) => name === a || name.startsWith(`${a} `))) return slug;
    }
  }
  return null;
}
