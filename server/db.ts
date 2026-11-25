import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'marketplace.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      phone TEXT DEFAULT '',
      location TEXT DEFAULT 'أبو جبيهة - الوسط',
      avatar_url TEXT DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'moderator', 'admin')),
      is_blocked INTEGER NOT NULL DEFAULT 0,
      is_verified_account INTEGER NOT NULL DEFAULT 0,
      is_sample INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name_ar TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'Package',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS subcategories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      name_ar TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(category_id, slug)
    );

    CREATE TABLE IF NOT EXISTS ads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      is_negotiable INTEGER NOT NULL DEFAULT 0,
      ad_type TEXT NOT NULL DEFAULT 'offer' CHECK(ad_type IN ('offer', 'wanted', 'job', 'announcement')),
      location TEXT NOT NULL,
      contact_phone TEXT NOT NULL,
      contact_whatsapp TEXT DEFAULT '',
      document_info TEXT DEFAULT '',
      has_verified_docs INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'sold')),
      rejection_reason TEXT DEFAULT '',
      is_featured INTEGER NOT NULL DEFAULT 0,
      is_sample INTEGER NOT NULL DEFAULT 0,
      views_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ad_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad_id INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ad_id INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, ad_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad_id INTEGER REFERENCES ads(id) ON DELETE SET NULL,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK(target_type IN ('ad', 'user')),
      target_ad_id INTEGER REFERENCES ads(id) ON DELETE CASCADE,
      target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      details TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'reviewed', 'dismissed')),
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      admin_note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_info TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS designated_staff (
      email TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK(role IN ('moderator', 'admin')),
      added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hero_promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad_id INTEGER REFERENCES ads(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      subtitle TEXT DEFAULT '',
      image_url TEXT NOT NULL,
      price_label TEXT DEFAULT '',
      location_label TEXT DEFAULT '',
      package_days INTEGER NOT NULL DEFAULT 7,
      amount_sdg INTEGER NOT NULL DEFAULT 10000,
      payment_method TEXT NOT NULL DEFAULT 'بنكك',
      payment_reference TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'paused', 'rejected', 'expired')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_sample INTEGER NOT NULL DEFAULT 0,
      starts_at TEXT DEFAULT '',
      expires_at TEXT DEFAULT '',
      admin_note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  seedDesignatedStaff();
  seedCategoriesAndSubcategories();
  seedSampleListings();
  seedSampleHeroPromotions();
}

function seedDesignatedStaff(): void {
  const initialAdmins = [
    'bossali8833@gmail.com',
    'alivnawai@gmail.com',
    'alinawai10010048@gmail.com',
  ];
  const insertStaff = db.prepare(
    "INSERT OR IGNORE INTO designated_staff (email, role) VALUES (?, 'admin')"
  );
  const upgradeExisting = db.prepare(
    "UPDATE users SET role = 'admin', is_verified_account = 1 WHERE email = ? AND is_sample = 0"
  );
  for (const email of initialAdmins) {
    const normalized = email.trim().toLowerCase();
    insertStaff.run(normalized);
    upgradeExisting.run(normalized);
  }
}

interface SeedCategory {
  slug: string;
  name_ar: string;
  icon: string;
  sort_order: number;
  subcategories: Array<{ slug: string; name_ar: string }>;
}

const DEFAULT_CATEGORIES: SeedCategory[] = [
  {
    slug: 'phones-electronics',
    name_ar: 'الهواتف والإلكترونيات',
    icon: 'Smartphone',
    sort_order: 1,
    subcategories: [
      { slug: 'mobile-phones', name_ar: 'هواتف محمولة' },
      { slug: 'laptops', name_ar: 'أجهزة كمبيوتر ولابتوب' },
      { slug: 'tvs-screens', name_ar: 'تلفزيونات وشاشات' },
      { slug: 'electrical-appliances', name_ar: 'أجهزة كهربائية' },
      { slug: 'accessories', name_ar: 'إكسسوارات' },
    ],
  },
  {
    slug: 'properties-rent',
    name_ar: 'عقارات للإيجار',
    icon: 'KeyRound',
    sort_order: 2,
    subcategories: [
      { slug: 'houses-rent', name_ar: 'منازل' },
      { slug: 'apartments-rent', name_ar: 'شقق' },
      { slug: 'shops-rent', name_ar: 'محلات تجارية' },
      { slug: 'offices-rent', name_ar: 'مكاتب' },
      { slug: 'warehouses-rent', name_ar: 'مستودعات ومخازن' },
    ],
  },
  {
    slug: 'properties-sale',
    name_ar: 'عقارات للبيع',
    icon: 'Building2',
    sort_order: 3,
    subcategories: [
      { slug: 'houses-sale', name_ar: 'منازل' },
      { slug: 'buildings-sale', name_ar: 'عمارات' },
      { slug: 'commercial-shops-sale', name_ar: 'محلات تجارية' },
    ],
  },
  {
    slug: 'land',
    name_ar: 'الأراضي',
    icon: 'MapPin',
    sort_order: 4,
    subcategories: [
      { slug: 'land-plots', name_ar: 'قطع أراضي للبيع' },
      { slug: 'residential-land', name_ar: 'أراضي سكنية' },
      { slug: 'agricultural-land', name_ar: 'أراضي زراعية' },
      { slug: 'commercial-land', name_ar: 'أراضي تجارية' },
    ],
  },
  {
    slug: 'cars-transport',
    name_ar: 'السيارات والمواصلات',
    icon: 'Car',
    sort_order: 5,
    subcategories: [
      { slug: 'cars', name_ar: 'سيارات' },
      { slug: 'motorcycles', name_ar: 'دراجات نارية' },
      { slug: 'rickshaws', name_ar: 'ركشات' },
      { slug: 'spare-parts', name_ar: 'قطع غيار' },
    ],
  },
  {
    slug: 'furniture-home',
    name_ar: 'الأثاث ومستلزمات المنزل',
    icon: 'Sofa',
    sort_order: 6,
    subcategories: [
      { slug: 'new-used-furniture', name_ar: 'أثاث جديد ومستعمل' },
      { slug: 'household-equipment', name_ar: 'أدوات ومستلزمات منزلية' },
    ],
  },
  {
    slug: 'agriculture-livestock',
    name_ar: 'الزراعة والثروة الحيوانية',
    icon: 'Sprout',
    sort_order: 7,
    subcategories: [
      { slug: 'agricultural-crops', name_ar: 'محاصيل زراعية' },
      { slug: 'livestock', name_ar: 'ثروة حيوانية' },
      { slug: 'agricultural-equipment', name_ar: 'معدات زراعية' },
      { slug: 'agricultural-supplies', name_ar: 'مستلزمات زراعية' },
    ],
  },
  {
    slug: 'services-business',
    name_ar: 'الخدمات والأعمال',
    icon: 'Wrench',
    sort_order: 8,
    subcategories: [
      { slug: 'electrical-services', name_ar: 'خدمات كهرباء' },
      { slug: 'plumbing', name_ar: 'سباكة' },
      { slug: 'carpentry', name_ar: 'نجارة' },
      { slug: 'maintenance-technicians', name_ar: 'فنيو صيانة' },
      { slug: 'various-services', name_ar: 'خدمات مهنية متنوعة' },
    ],
  },
  {
    slug: 'miscellaneous',
    name_ar: 'متفرقات',
    icon: 'LayoutGrid',
    sort_order: 9,
    subcategories: [{ slug: 'general-misc', name_ar: 'إعلانات عامة متنوعة' }],
  },
  {
    slug: 'wanted',
    name_ar: 'قسم المطلوبات',
    icon: 'SearchCheck',
    sort_order: 10,
    subcategories: [
      { slug: 'wanted-property', name_ar: 'عقار أو منزل مطلوب' },
      { slug: 'wanted-electronics', name_ar: 'هاتف أو إلكترونيات مطلوبة' },
      { slug: 'wanted-land', name_ar: 'أرض مطلوبة' },
      { slug: 'wanted-other', name_ar: 'مطلوبات أخرى' },
    ],
  },
  {
    slug: 'jobs',
    name_ar: 'الوظائف والتوظيف',
    icon: 'Briefcase',
    sort_order: 11,
    subcategories: [
      { slug: 'job-vacancies', name_ar: 'وظائف شاغرة' },
      { slug: 'freelance-opportunities', name_ar: 'فرص عمل حرة ومهنية' },
    ],
  },
  {
    slug: 'community',
    name_ar: 'إعلانات المجتمع',
    icon: 'Megaphone',
    sort_order: 12,
    subcategories: [
      { slug: 'events-occasions', name_ar: 'مناسبات وفعاليات' },
      { slug: 'lost-found', name_ar: 'مفقودات ومعثورات' },
      { slug: 'general-announcements', name_ar: 'إعلانات مجتمعية عامة' },
      { slug: 'local-news', name_ar: 'أخبار وأنشطة محلية' },
    ],
  },
];

function seedCategoriesAndSubcategories(): void {
  const countRow = db.prepare('SELECT COUNT(*) as c FROM categories').get() as { c: number };
  if (countRow.c > 0) return;

  const insertCat = db.prepare(
    'INSERT INTO categories (slug, name_ar, icon, sort_order, is_active) VALUES (?, ?, ?, ?, 1)'
  );
  const insertSub = db.prepare(
    'INSERT INTO subcategories (category_id, slug, name_ar, sort_order, is_active) VALUES (?, ?, ?, ?, 1)'
  );

  const tx = db.transaction(() => {
    for (const cat of DEFAULT_CATEGORIES) {
      const res = insertCat.run(cat.slug, cat.name_ar, cat.icon, cat.sort_order);
      const catId = Number(res.lastInsertRowid);
      cat.subcategories.forEach((sub, idx) => {
        insertSub.run(catId, sub.slug, sub.name_ar, idx + 1);
      });
    }
  });
  tx();
}

function seedSampleListings(): void {
  const adCount = db.prepare('SELECT COUNT(*) as c FROM ads').get() as { c: number };
  if (adCount.c > 0) return;

  // Demonstration sample accounts (locked from password login with unreachable random hash, clearly tagged is_sample = 1)
  const createSampleHash = () => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(crypto.randomBytes(32).toString('hex'), salt, 64).toString('hex');
    return `${salt}:${hash}`;
  };

  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password_hash, phone, location, role, is_verified_account, is_sample)
    VALUES (?, ?, ?, ?, ?, 'user', ?, 1)
  `);

  const u1 = Number(
    insertUser.run(
      'أحمد كمال التجاني (حساب نموذجي)',
      'sample.ahmed@abujubeiha.local',
      createSampleHash(),
      '+249912345601',
      'أبو جبيهة - حي المطار',
      1
    ).lastInsertRowid
  );
  const u2 = Number(
    insertUser.run(
      'فاطمة الطيب آدم (حساب نموذجي)',
      'sample.fatima@abujubeiha.local',
      createSampleHash(),
      '+249912345602',
      'أبو جبيهة - السوق الكبير',
      1
    ).lastInsertRowid
  );
  const u3 = Number(
    insertUser.run(
      'عبدالله محمد النور (حساب نموذجي)',
      'sample.abdallah@abujubeiha.local',
      createSampleHash(),
      '+249912345603',
      'أبو جبيهة - حي السلام',
      0
    ).lastInsertRowid
  );

  const getCatId = (slug: string) =>
    (db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug) as { id: number }).id;
  const getSubId = (catId: number, slug: string) =>
    (
      db
        .prepare('SELECT id FROM subcategories WHERE category_id = ? AND slug = ?')
        .get(catId, slug) as { id: number }
    ).id;

  const insertAd = db.prepare(`
    INSERT INTO ads (
      user_id, category_id, subcategory_id, title, description, price, is_negotiable,
      ad_type, location, contact_phone, contact_whatsapp, document_info, has_verified_docs,
      status, is_featured, is_sample, views_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, 1, ?)
  `);
  const insertImg = db.prepare('INSERT INTO ad_images (ad_id, url, sort_order) VALUES (?, ?, ?)');

  const cPhones = getCatId('phones-electronics');
  const cRent = getCatId('properties-rent');
  const cSale = getCatId('properties-sale');
  const cLand = getCatId('land');
  const cCars = getCatId('cars-transport');
  const cFurniture = getCatId('furniture-home');
  const cAgri = getCatId('agriculture-livestock');
  const cServices = getCatId('services-business');
  const cWanted = getCatId('wanted');
  const cJobs = getCatId('jobs');
  const cCommunity = getCatId('community');

  const tx = db.transaction(() => {
    const a1 = Number(
      insertAd.run(
        u1,
        cPhones,
        getSubId(cPhones, 'mobile-phones'),
        'سامسونج جلاكسي S23 بحالة ممتازة - 256 جيجا',
        'هاتف Samsung Galaxy S23 نظيف جداً، استخدام خفيف، ذاكرة 256 جيجا، بطارية ممتازة، مع الشاحن الأصلي والعلبة. متاح للمعاينة في السوق الكبير بأبو جبيهة.',
        950000,
        1,
        'offer',
        'أبو جبيهة - السوق الكبير',
        '+249912345601',
        '+249912345601',
        '',
        0,
        1,
        42
      ).lastInsertRowid
    );
    insertImg.run(a1, '/src/assets/images/sample_smartphone_1795626052495.jpg', 1);

    const a2 = Number(
      insertAd.run(
        u2,
        cSale,
        getSubId(cSale, 'houses-sale'),
        'منزل سكني حديث في حي المطار مساحة 400 متر',
        'منزل مشيد بالطوب الأحمر والأسمنت، يتكون من 3 غرف نوم وصالة كبيرة ومطبخ وحمامين وفناء واسع به شجرة نيم وظل. قريب من الطريق الرئيسي والخدمات.',
        48000000,
        1,
        'offer',
        'أبو جبيهة - حي المطار',
        '+249912345602',
        '+249912345602',
        'شهادة بحث رسمية - درجة ثالثة - خالية من النزاعات',
        1,
        1,
        67
      ).lastInsertRowid
    );
    insertImg.run(a2, '/src/assets/images/sample_house_1795626053999.jpg', 1);

    const a3 = Number(
      insertAd.run(
        u1,
        cCars,
        getSubId(cCars, 'cars'),
        'تويوتا هايلوكس دبل كاب موديل 2020 نظيفة',
        'عربة Toyota Hilux دبل كاب جاز بحالة ميكانيكية ممتازة، تكييف ثلاجة، إطارات جديدة، جاهزة للسفر والعمل داخل وخارج أبو جبيهة.',
        36500000,
        1,
        'offer',
        'أبو جبيهة - موقف السيارات',
        '+249912345601',
        '+249912345601',
        '',
        0,
        1,
        85
      ).lastInsertRowid
    );
    insertImg.run(a3, '/src/assets/images/sample_vehicle_1795626053840.jpg', 1);

    const a4 = Number(
      insertAd.run(
        u3,
        cAgri,
        getSubId(cAgri, 'agricultural-crops'),
        'سمسم أبيض وذرة فتريتة إنتاج الموسم الجديد',
        'متوفر 50 جوال سمسم أبيض نقي ومغربل + 80 جوال ذرة فتريتة درجة أولى من مزارع جنوب كردفان، السعر للجوال الواحد مع إمكانية التوصيل داخل أبو جبيهة.',
        145000,
        1,
        'offer',
        'أبو جبيهة - سوق المحاصيل',
        '+249912345603',
        '+249912345603',
        '',
        0,
        1,
        34
      ).lastInsertRowid
    );
    insertImg.run(a4, '/src/assets/images/sample_crops_1795626054031.jpg', 1);

    const a5 = Number(
      insertAd.run(
        u2,
        cFurniture,
        getSubId(cFurniture, 'new-used-furniture'),
        'طقم جلوس خشب مهوقني طبيعي 7 مقاعد مع طربيزة',
        'طقم صالون متين مصنوع من خشب المهوقني عالي الجودة مع تنجيد كتان مريح وطربيزة وسط محفورة. بحالة شبه جديدة.',
        1250000,
        1,
        'offer',
        'أبو جبيهة - حي السلام',
        '+249912345602',
        '+249912345602',
        '',
        0,
        0,
        29
      ).lastInsertRowid
    );
    insertImg.run(a5, '/src/assets/images/sample_furniture_1795626054149.jpg', 1);

    const a6 = Number(
      insertAd.run(
        u2,
        cRent,
        getSubId(cRent, 'houses-rent'),
        'منزل عائلي للإيجار الشهري - غرفتين وهول في حي النصر',
        'منزل نظيف ومريح للعائلات، كهرباء ومياه متوفرة، حوش مسور، قريب من المدرسة والمسجد.',
        220000,
        0,
        'offer',
        'أبو جبيهة - حي النصر',
        '+249912345602',
        '+249912345602',
        'عقد إيجار موثق لدى محامي',
        0,
        0,
        51
      ).lastInsertRowid
    );
    insertImg.run(a6, '/src/assets/images/sample_house_1795626053999.jpg', 1);

    insertAd.run(
      u1,
      cLand,
      getSubId(cLand, 'residential-land'),
      'قطعة أرض سكنية ناصية مساحة 500 متر مربع - مربع 4',
      'قطعة أرض مميزة تفتح على شارعين رئيسيين، أرض مستوية، جاهزة للبناء فوراً في مخطط سكني هادئ ومأهول.',
      16000000,
      1,
      'offer',
      'أبو جبيهة - الامتداد الشرقي',
      '+249912345601',
      '+249912345601',
      'تخصيص رسمي وشهادة حيازة موثقة من محلية أبو جبيهة - المساحة 500 م²',
      1,
      0,
      38
    );

    insertAd.run(
      u3,
      cServices,
      getSubId(cServices, 'electrical-services'),
      'فني تركيب وصيانة منظومات الطاقة الشمسية والكهرباء',
      'تركيب ألواح الطاقة الشمسية، الإنفرترات، البطاريات، وتمديدات المنازل والمحلات التجارية في أبو جبيهة والقرى المجاورة بأسعار مناسبة وضمان على العمل.',
      35000,
      1,
      'offer',
      'أبو جبيهة - جميع الأحياء',
      '+249912345603',
      '+249912345603',
      '',
      0,
      0,
      19
    );

    insertAd.run(
      u3,
      cWanted,
      getSubId(cWanted, 'wanted-electronics'),
      'مطلوب هاتف آيفون 13 أو 14 نظيف بسعر مناسب',
      'أبحث عن شراء هاتف iPhone 13 أو iPhone 14 بحالة ممتازة ونسبة بطارية فوق 85% في أبو جبيهة. الدفع كاش عند المعاينة.',
      850000,
      1,
      'wanted',
      'أبو جبيهة - الوسط',
      '+249912345603',
      '+249912345603',
      '',
      0,
      0,
      16
    );

    insertAd.run(
      u2,
      cJobs,
      getSubId(cJobs, 'job-vacancies'),
      'مطلوب محاسب/ة لمتجر مواد غذائية ومستلزمات زراعية',
      'مطلوب محاسب بدوام كامل في السوق الكبير بأبو جبيهة، يفضل من لديه خبرة في برامج الحسابات وإدارة المخزون. الراتب يحدد بعد المقابلة.',
      0,
      0,
      'job',
      'أبو جبيهة - السوق الكبير',
      '+249912345602',
      '+249912345602',
      '',
      0,
      0,
      24
    );

    insertAd.run(
      u1,
      cCommunity,
      getSubId(cCommunity, 'lost-found'),
      'تنويه: العثور على بطاقة قومية ومفاتيح قرب السوق الكبير',
      'تم العثور على حافظة صغيرة بها أوراق ثبوتية ومفتاح دراجة نارية بالقرب من موقف أبو جبيهة الرئيسي. يرجى من صاحبها التواصل لتسليمها بعد التحقق.',
      0,
      0,
      'announcement',
      'أبو جبيهة - السوق الكبير',
      '+249912345601',
      '+249912345601',
      '',
      0,
      0,
      31
    );
  });
  tx();
}

function seedSampleHeroPromotions(): void {
  const existingCount = (db.prepare('SELECT COUNT(*) as c FROM hero_promotions').get() as { c: number }).c;
  if (existingCount > 0) return;

  const sampleFeatured = db
    .prepare(
      `SELECT a.id, a.user_id, a.title, a.price, a.location,
              (SELECT url FROM ad_images WHERE ad_id = a.id ORDER BY sort_order ASC LIMIT 1) as image_url
       FROM ads a
       WHERE a.is_sample = 1 AND a.is_featured = 1 AND a.status = 'approved'
       ORDER BY a.id ASC
       LIMIT 4`
    )
    .all() as Array<{
    id: number;
    user_id: number;
    title: string;
    price: number;
    location: string;
    image_url: string | null;
  }>;

  if (sampleFeatured.length === 0) return;

  const insertHero = db.prepare(
    `INSERT INTO hero_promotions (
      ad_id, user_id, title, subtitle, image_url, price_label, location_label,
      package_days, amount_sdg, payment_method, payment_reference, status,
      sort_order, is_sample, starts_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'بنكك', 'DEMO-HERO', 'active', ?, 1, datetime('now'), datetime('now', '+30 days'))`
  );

  sampleFeatured.forEach((ad, idx) => {
    if (!ad.image_url) return;
    const priceLabel =
      ad.price > 0 ? `${new Intl.NumberFormat('en-US').format(ad.price)} ج.س` : 'عرض مميز';
    insertHero.run(
      ad.id,
      ad.user_id,
      ad.title,
      'إعلان مميز في واجهة سوق أبو جبيهة',
      ad.image_url,
      priceLabel,
      ad.location,
      30,
      30000,
      idx + 1
    );
  });
}

