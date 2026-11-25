export const BOOTSTRAP_ADMIN_EMAILS = [
  'bossali8833@gmail.com',
  'alivnawai@gmail.com',
  'alinawai10010048@gmail.com',
];

const ARABIC_INDIC_MAP: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

export function normalizeSearchText(input: string): string {
  if (!input) return '';
  let text = input.toLowerCase().trim();
  text = text.replace(/[٠-٩۰-۹]/g, (ch) => ARABIC_INDIC_MAP[ch] ?? ch);
  text = text.replace(/[\u064B-\u065F\u0670\u0640]/g, '');
  text = text
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
  text = text.replace(/[^\p{L}\p{N}\s]+/gu, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

const SYNONYM_GROUPS: string[][] = [
  ['ايفون', 'أيفون', 'آيفون', 'iphone', 'apple', 'ابل'],
  ['سامسونج', 'جلاكسي', 'جالكسي', 'samsung', 'galaxy'],
  ['شاومي', 'ريدمي', 'xiaomi', 'redmi'],
  ['هواوي', 'huawei'],
  ['تلفون', 'موبايل', 'هاتف', 'جوال', 'جهاز', 'phone', 'mobile', 'smartphone'],
  ['لابتوب', 'كمبيوتر', 'حاسوب', 'laptop', 'pc', 'macbook', 'hp', 'dell', 'lenovo'],
  ['تلفزيون', 'شاشه', 'شاشة', 'tv', 'screen'],
  ['بيت', 'منزل', 'دار', 'حوش', 'house', 'home'],
  ['شقه', 'شقة', 'apartment', 'flat'],
  ['دكان', 'محل', 'متجر', 'shop', 'store'],
  ['مخزن', 'مستودع', 'warehouse'],
  ['ارض', 'أرض', 'قطعه', 'قطعة', 'land', 'plot'],
  ['سياره', 'سيارة', 'عربه', 'عربة', 'موتر', 'car', 'vehicle', 'auto'],
  ['تويوتا', 'toyota', 'هايلوكس', 'hilux', 'بوكس', 'لاندكروزر'],
  ['هيونداي', 'hyundai', 'اكسنت', 'accent'],
  ['ركشه', 'ركشة', 'توك توك', 'rickshaw'],
  ['موتر', 'دراجه', 'دراجة', 'موتور', 'motorcycle', 'bike'],
  ['طاقه', 'طاقة', 'شمسيه', 'شمسية', 'انفرتر', 'بطاريه', 'بطارية', 'solar'],
  ['ثلاجه', 'ثلاجة', 'غساله', 'غسالة', 'مكيف', 'fridge', 'ac'],
  ['سمسم', 'ذره', 'ذرة', 'فول', 'محاصيل', 'زراعه', 'زراعة', 'crops'],
  ['غنم', 'ماعز', 'بقر', 'ابل', 'ماشيه', 'ماشية', 'livestock'],
  ['وظيفه', 'وظيفة', 'عمل', 'توظيف', 'شغل', 'job', 'vacancy'],
  ['مطلوب', 'ابحث', 'أبحث', 'wanted'],
];

const SYNONYM_INDEX = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  const normalizedGroup = Array.from(new Set(group.map(normalizeSearchText).filter(Boolean)));
  for (const term of normalizedGroup) {
    SYNONYM_INDEX.set(term, normalizedGroup);
  }
}

export function buildQueryTokenGroups(rawQuery: string): string[][] {
  const normalized = normalizeSearchText(rawQuery);
  if (!normalized) return [];
  const tokens = normalized.split(' ').filter((t) => t.length >= 1);
  return tokens.map((token) => {
    const expansions = new Set<string>([token]);
    const exactGroup = SYNONYM_INDEX.get(token);
    if (exactGroup) exactGroup.forEach((g) => expansions.add(g));
    if (token.startsWith('ال') && token.length > 3) {
      const stripped = token.slice(2);
      expansions.add(stripped);
      const strippedGroup = SYNONYM_INDEX.get(stripped);
      if (strippedGroup) strippedGroup.forEach((g) => expansions.add(g));
    }
    return Array.from(expansions);
  });
}

export function matchesSearchTokens(searchableFields: string[], rawQuery: string): boolean {
  const tokenGroups = buildQueryTokenGroups(rawQuery);
  if (tokenGroups.length === 0) return true;
  const normalizedHaystack = normalizeSearchText(searchableFields.filter(Boolean).join(' '));
  return tokenGroups.every((alternatives) =>
    alternatives.some((alt) => normalizedHaystack.includes(alt))
  );
}

const PROHIBITED_TERMS = [
  'سلاح', 'أسلحة', 'اسلحه', 'مسدس', 'بندقية', 'بندقيه', 'ذخيرة', 'ذخيره', 'متفجرات',
  'مخدرات', 'حشيش', 'ترامادول', 'كبتاجون', 'خمور', 'كحول', 'قمار', 'مراهنات', 'غسيل أموال',
];

export function checkProhibitedContent(text: string): string | null {
  const normalized = normalizeSearchText(text);
  for (const term of PROHIBITED_TERMS) {
    const normTerm = normalizeSearchText(term);
    if (normTerm && normalized.includes(normTerm)) {
      return term;
    }
  }
  return null;
}

export const DEFAULT_CATEGORIES_SEED = [
  {
    id: 'phones-electronics',
    slug: 'phones-electronics',
    nameAr: 'الهواتف والإلكترونيات',
    icon: 'Smartphone',
    sortOrder: 1,
    subcategories: [
      { id: 'mobile-phones', slug: 'mobile-phones', nameAr: 'هواتف محمولة' },
      { id: 'laptops', slug: 'laptops', nameAr: 'أجهزة كمبيوتر ولابتوب' },
      { id: 'tvs-screens', slug: 'tvs-screens', nameAr: 'تلفزيونات وشاشات' },
      { id: 'electrical-appliances', slug: 'electrical-appliances', nameAr: 'أجهزة كهربائية' },
      { id: 'accessories', slug: 'accessories', nameAr: 'إكسسوارات' },
    ],
  },
  {
    id: 'properties-rent',
    slug: 'properties-rent',
    nameAr: 'عقارات للإيجار',
    icon: 'KeyRound',
    sortOrder: 2,
    subcategories: [
      { id: 'houses-rent', slug: 'houses-rent', nameAr: 'منازل' },
      { id: 'apartments-rent', slug: 'apartments-rent', nameAr: 'شقق' },
      { id: 'shops-rent', slug: 'shops-rent', nameAr: 'محلات تجارية' },
      { id: 'offices-rent', slug: 'offices-rent', nameAr: 'مكاتب' },
      { id: 'warehouses-rent', slug: 'warehouses-rent', nameAr: 'مستودعات ومخازن' },
    ],
  },
  {
    id: 'properties-sale',
    slug: 'properties-sale',
    nameAr: 'عقارات للبيع',
    icon: 'Building2',
    sortOrder: 3,
    subcategories: [
      { id: 'houses-sale', slug: 'houses-sale', nameAr: 'منازل' },
      { id: 'buildings-sale', slug: 'buildings-sale', nameAr: 'عمارات' },
      { id: 'commercial-shops-sale', slug: 'commercial-shops-sale', nameAr: 'محلات تجارية' },
    ],
  },
  {
    id: 'land',
    slug: 'land',
    nameAr: 'الأراضي',
    icon: 'MapPin',
    sortOrder: 4,
    subcategories: [
      { id: 'land-plots', slug: 'land-plots', nameAr: 'قطع أراضي للبيع' },
      { id: 'residential-land', slug: 'residential-land', nameAr: 'أراضي سكنية' },
      { id: 'agricultural-land', slug: 'agricultural-land', nameAr: 'أراضي زراعية' },
      { id: 'commercial-land', slug: 'commercial-land', nameAr: 'أراضي تجارية' },
    ],
  },
  {
    id: 'cars-transport',
    slug: 'cars-transport',
    nameAr: 'السيارات والمواصلات',
    icon: 'Car',
    sortOrder: 5,
    subcategories: [
      { id: 'cars', slug: 'cars', nameAr: 'سيارات' },
      { id: 'motorcycles', slug: 'motorcycles', nameAr: 'دراجات نارية' },
      { id: 'rickshaws', slug: 'rickshaws', nameAr: 'ركشات' },
      { id: 'spare-parts', slug: 'spare-parts', nameAr: 'قطع غيار' },
    ],
  },
  {
    id: 'furniture-home',
    slug: 'furniture-home',
    nameAr: 'الأثاث ومستلزمات المنزل',
    icon: 'Sofa',
    sortOrder: 6,
    subcategories: [
      { id: 'new-used-furniture', slug: 'new-used-furniture', nameAr: 'أثاث جديد ومستعمل' },
      { id: 'household-equipment', slug: 'household-equipment', nameAr: 'أدوات ومستلزمات منزلية' },
    ],
  },
  {
    id: 'agriculture-livestock',
    slug: 'agriculture-livestock',
    nameAr: 'الزراعة والثروة الحيوانية',
    icon: 'Sprout',
    sortOrder: 7,
    subcategories: [
      { id: 'agricultural-crops', slug: 'agricultural-crops', nameAr: 'محاصيل زراعية' },
      { id: 'livestock', slug: 'livestock', nameAr: 'ثروة حيوانية' },
      { id: 'agricultural-equipment', slug: 'agricultural-equipment', nameAr: 'معدات زراعية' },
      { id: 'agricultural-supplies', slug: 'agricultural-supplies', nameAr: 'مستلزمات زراعية' },
    ],
  },
  {
    id: 'services-businesses',
    slug: 'services-businesses',
    nameAr: 'الخدمات والأعمال',
    icon: 'Wrench',
    sortOrder: 8,
    subcategories: [
      { id: 'electrical-services', slug: 'electrical-services', nameAr: 'خدمات كهربائية' },
      { id: 'plumbing', slug: 'plumbing', nameAr: 'سباكة' },
      { id: 'carpentry', slug: 'carpentry', nameAr: 'نجارة' },
      { id: 'maintenance-technicians', slug: 'maintenance-technicians', nameAr: 'فنيو صيانة' },
      { id: 'professional-services', slug: 'professional-services', nameAr: 'خدمات مهنية متنوعة' },
    ],
  },
  {
    id: 'miscellaneous',
    slug: 'miscellaneous',
    nameAr: 'متفرقات',
    icon: 'Package',
    sortOrder: 9,
    subcategories: [
      { id: 'general-items', slug: 'general-items', nameAr: 'إعلانات عامة ومتنوعة' },
    ],
  },
  {
    id: 'wanted',
    slug: 'wanted',
    nameAr: 'قسم المطلوبات',
    icon: 'SearchCheck',
    sortOrder: 10,
    subcategories: [
      { id: 'wanted-housing', slug: 'wanted-housing', nameAr: 'مطلوب منزل أو شقة' },
      { id: 'wanted-electronics', slug: 'wanted-electronics', nameAr: 'مطلوب هاتف أو جهاز' },
      { id: 'wanted-land', slug: 'wanted-land', nameAr: 'مطلوب قطعة أرض' },
      { id: 'wanted-other', slug: 'wanted-other', nameAr: 'مطلوبات أخرى' },
    ],
  },
  {
    id: 'jobs',
    slug: 'jobs',
    nameAr: 'الوظائف والتوظيف',
    icon: 'Briefcase',
    sortOrder: 11,
    subcategories: [
      { id: 'job-vacancies', slug: 'job-vacancies', nameAr: 'وظائف شاغرة' },
      { id: 'skilled-labor', slug: 'skilled-labor', nameAr: 'عمالة وحرفيون' },
    ],
  },
  {
    id: 'community',
    slug: 'community',
    nameAr: 'إعلانات المجتمع',
    icon: 'Megaphone',
    sortOrder: 12,
    subcategories: [
      { id: 'events-occasions', slug: 'events-occasions', nameAr: 'فعاليات ومناسبات' },
      { id: 'lost-found', slug: 'lost-found', nameAr: 'مفقودات وموجودات' },
      { id: 'community-announcements', slug: 'community-announcements', nameAr: 'إعلانات مجتمعية عامة' },
      { id: 'local-news', slug: 'local-news', nameAr: 'أخبار وأنشطة محلية' },
    ],
  },
];
