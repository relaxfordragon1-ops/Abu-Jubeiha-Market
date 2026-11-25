const ARABIC_INDIC_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

export function normalizeText(input: string): string {
  if (!input) return '';
  let out = input
    .toLowerCase()
    .trim()
    // Strip Arabic diacritics & tatweel
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    // Normalize Alef variants
    .replace(/[أإآ]/g, 'ا')
    // Normalize Teh Marbuta -> Heh
    .replace(/ة/g, 'ه')
    // Normalize Alef Maksura -> Yeh
    .replace(/ى/g, 'ي')
    // Normalize Waw/Yeh Hamza
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');

  out = out.replace(/[٠-٩]/g, (d) => ARABIC_INDIC_MAP[d] ?? d);
  // Collapse repeated whitespace & common punctuation
  return out.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

const SYNONYM_GROUPS: string[][] = [
  ['iphone', 'ايفون', 'أيفون', 'آيفون', 'تلفون ابل', 'apple'],
  ['samsung', 'سامسونج', 'جلاكسي', 'جالكسي', 'galaxy'],
  ['phone', 'mobile', 'smartphone', 'جوال', 'هاتف', 'موبايل', 'تلفون'],
  ['laptop', 'notebook', 'لابتوب', 'كمبيوتر', 'حاسوب', 'محمول'],
  ['tv', 'television', 'screen', 'تلفزيون', 'شاشه', 'شاشة'],
  ['toyota', 'تويوتا', 'هايلوكس', 'hilux', 'بوكس', 'لاندكروزر'],
  ['car', 'vehicle', 'سيارة', 'سياره', 'عربيه', 'عربة', 'موتر'],
  ['motorcycle', 'moto', 'دراجة', 'دراجه', 'موتر', 'ناريه'],
  ['rickshaw', 'tuktuk', 'ركشه', 'رقشه', 'ركشة', 'توك توك'],
  ['house', 'home', 'منزل', 'بيت', 'دار'],
  ['apartment', 'flat', 'شقة', 'شقه'],
  ['shop', 'store', 'محل', 'دكان', 'متجر'],
  ['land', 'plot', 'ارض', 'أرض', 'قطعة', 'قطعه', 'مربع'],
  ['rent', 'ايجار', 'إيجار', 'للايجار', 'اجار'],
  ['sale', 'sell', 'للبيع', 'بيع'],
  ['furniture', 'اثاث', 'أثاث', 'كنب', 'طقم', 'سرير', 'دولاب'],
  ['sesame', 'سمسم'],
  ['sorghum', 'ذره', 'ذرة', 'فتريته', 'طابت'],
  ['livestock', 'goat', 'sheep', 'cow', 'مواشي', 'ضأن', 'غنم', 'ماعز', 'بقر', 'ابقار'],
  ['solar', 'طاقه شمسيه', 'طاقة شمسية', 'الواح', 'انفرتر', 'بطاريه'],
  ['job', 'work', 'وظيفه', 'وظيفة', 'عمل', 'توظيف'],
  ['plumber', 'plumbing', 'سباك', 'سباكه', 'سباكة'],
  ['electrician', 'electrical', 'كهربائي', 'كهرباء'],
  ['carpenter', 'carpentry', 'نجار', 'نجاره', 'نجارة'],
  ['abu jubeiha', 'ابو جبيهة', 'أبو جبيهة', 'ابوجبيهة', 'ابوجبيهه'],
];

const NORMALIZED_SYNONYMS: Map<string, string[]> = new Map();
for (const group of SYNONYM_GROUPS) {
  const normGroup = group.map((term) => normalizeText(term)).filter(Boolean);
  for (const term of normGroup) {
    const existing = NORMALIZED_SYNONYMS.get(term) ?? [];
    NORMALIZED_SYNONYMS.set(term, Array.from(new Set([...existing, ...normGroup])));
  }
}

export function expandSearchTokens(query: string): string[][] {
  const norm = normalizeText(query);
  if (!norm) return [];
  const words = norm.split(' ').filter(Boolean);
  return words.map((word) => {
    const variants = new Set<string>([word]);
    const exactSyns = NORMALIZED_SYNONYMS.get(word);
    if (exactSyns) {
      for (const s of exactSyns) variants.add(s);
    }
    // Also check if word starts with Arabic definite article 'ال'
    if (word.startsWith('ال') && word.length > 3) {
      const stripped = word.slice(2);
      variants.add(stripped);
      const strippedSyns = NORMALIZED_SYNONYMS.get(stripped);
      if (strippedSyns) {
        for (const s of strippedSyns) variants.add(s);
      }
    } else if (/^[\u0621-\u064A]+$/.test(word)) {
      const withAl = `ال${word}`;
      const alSyns = NORMALIZED_SYNONYMS.get(withAl);
      if (alSyns) {
        for (const s of alSyns) variants.add(s);
      }
    }
    return Array.from(variants);
  });
}

export function matchesSmartSearch(
  query: string,
  fields: Array<string | null | undefined>
): boolean {
  const tokenGroups = expandSearchTokens(query);
  if (tokenGroups.length === 0) return true;
  const haystack = normalizeText(fields.filter(Boolean).join(' '));
  if (!haystack) return false;
  return tokenGroups.every((variants) =>
    variants.some((variant) => haystack.includes(variant))
  );
}

const PROHIBITED_TERMS = [
  'سلاح ناري',
  'أسلحة نارية',
  'اسلحه ناريه',
  'مسدس للبيع',
  'كلاشنكوف',
  'ذخيرة',
  'ذخيره',
  'مخدرات',
  'حشيش للبيع',
  'شبو',
  'تزوير',
  'عملة مزورة',
  'عمله مزوره',
  'وثائق مزورة',
  'غسيل أموال',
  'قمار',
  'مراهنات',
];

export function checkProhibitedContent(text: string): string | null {
  const normalized = normalizeText(text);
  for (const term of PROHIBITED_TERMS) {
    const normTerm = normalizeText(term);
    if (normalized.includes(normTerm)) {
      return `يحتوي النص على محتوى محظور وفق سياسة الأمان في سوق أبو جبيهة (${term})`;
    }
  }
  return null;
}
