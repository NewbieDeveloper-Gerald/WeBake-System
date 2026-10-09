/**
 * Seed script (`npm run seed`).
 *
 * WHAT: Creates the minimum data a fresh database needs: the owner admin
 * account, the 8 products, sample reviews, and default settings.
 *
 * IDEMPOTENCY RULE: re-running seed must NEVER destroy real data. Every
 * insert uses ON CONFLICT DO NOTHING (or an existence check), so the second
 * run is a harmless no-op that prints "already exists" lines. Concretely:
 * - Never re-hashes/overwrites the admin password (would lock the owner out
 *   or silently reset it - password changes go through the reset link).
 * - Never touches product stock (would erase real inventory counts).
 * - Never overwrites settings the owner edited in the admin panel.
 *
 * Run order on a fresh database: 1) npm run migrate  2) npm run seed
 */

'use strict';

const { query } = require('../config/db');
const config = require('../config/env');
const { hashPassword } = require('../utils/password');

// 105 pesos, 25 pieces per bundle - confirmed business constants.
const PRODUCTS = [
  { name: 'Mamon', slug: 'mamon', desc: 'Soft and fluffy sponge cake, perfect for a snack or gift. Light, airy, and melt-in-your-mouth delicious.' },
  { name: 'Otap', slug: 'otap', desc: 'Crispy, flaky oval-shaped puff pastry with a caramelized sugar coating. A beloved bakery delicacy enjoyed by all ages.' },
  { name: 'Eggnog', slug: 'eggnog', desc: 'Sweet and crumbly meringue-based cookie, delicately baked to perfection. A classic bakery staple.' },
  { name: 'Butter Toast', slug: 'butter-toast', desc: 'Golden, crunchy butter-toasted bread slices with a rich, buttery flavor. Ideal for wholesale.' },
  { name: 'Broas', slug: 'broas', desc: 'Light, crisp ladyfinger biscuits with a delicate sweetness. Perfect with coffee or tea.' },
  { name: 'Butter Cookies', slug: 'butter-cookies', desc: 'Rich, buttery cookies with a crisp, melt-in-your-mouth texture. A classic sweet treat.' },
  { name: 'Cracklets', slug: 'cracklets', desc: 'Light and crunchy crackers with a savory, satisfying flavor. A simple snack for any time of day.' },
  { name: 'Jacobina', slug: 'jacobina', desc: 'Thin, crisp biscuits with a lightly sweet and buttery flavor. A classic snack favorite.' },
];

// Clearly-labeled SAMPLE content. is_seed = true distinguishes these rows when
// real customer reviews ship later (spec: display only for now).
const SAMPLE_REVIEWS = [
  {
    name: 'Sample Review - Nena, Marilao',
    rating: 5,
    en: 'The mamon is always soft and fresh. Our loyal buyers ask for Crumbs N Rolls by name.',
    fil: '',
  },
  {
    name: 'Sample Review - Tonyo, Meycauayan',
    rating: 5,
    en: 'Ordered 400 bundles of otap for our bakery. Crisp, well-packed, and delivered on time.',
    fil: '',
  },
  {
    name: 'Sample Review - Grace L., Santa Maria',
    rating: 4,
    en: 'Butter toast is a bestseller in our store. Consistent quality every single week.',
    fil: '',
  },
  {
    name: 'Sample Review - Pabling, Marilao',
    rating: 5,
    en: 'Fair wholesale price and honest bundle counts. Highly recommended for resellers.',
    fil: '',
  },
];

// Placeholder payment + business settings. The owner replaces the wallet
// numbers and QR paths in Settings (Phase 5) - no code change needed.
function defaultSettings() {
  return {
    gcash_number: '09000000000',
    paymaya_number: '09000000000',
    account_name: 'Juan D. (placeholder)',
    gcash_qr: 'assets/qr-gcash-placeholder.png',
    paymaya_qr: 'assets/qr-paymaya-placeholder.png',
    store_hours: '6:00 AM - 8:00 PM',
    bakery_address: '1356 Cordero St., Lambakin, Marilao, Bulacan',
    min_order_bundles: String(config.business.minOrderBundles),
    default_low_stock_pieces: String(config.business.defaultLowStockPieces),
  };
}

async function seedAdmin() {
  const email = config.seed.adminEmail;
  const password = config.seed.adminPassword;

  // Refuse to seed a weak/default password: a guessable owner password is the
  // single worst secret this system can hold.
  if (!password || password.length < 8 || password === 'change-me-before-seeding') {
    throw new Error(
      'Set a real ADMIN_PASSWORD (min 8 chars) in backend/.env before seeding. Refusing to create the owner account with a placeholder password.'
    );
  }

  const existing = await query('SELECT id FROM admins WHERE email = $1;', [email]);
  if (existing.rows.length > 0) {
    console.log(`[seed] admin already exists: ${email} (password untouched)`);
    return;
  }

  const passwordHash = await hashPassword(password);
  await query('INSERT INTO admins (email, password_hash) VALUES ($1, $2);', [email, passwordHash]);
  console.log(`[seed] admin created: ${email}`);
}

async function seedProducts() {
  for (const p of PRODUCTS) {
    // DO NOTHING preserves stock_pieces on re-runs (see file header).
    const res = await query(
      `INSERT INTO products (name, slug, description, price_bundle_centavos,
                              pieces_per_bundle, piece_price_centavos,
                              stock_pieces, low_stock_threshold_pieces, image_url)
       VALUES ($1, $2, $3, 10500, 25, 500, 0, $4, '')
       ON CONFLICT (name) DO NOTHING
       RETURNING id;`,
      [p.name, p.slug, p.desc, config.business.defaultLowStockPieces]
    );
    console.log(res.rows.length > 0 ? `[seed] product added: ${p.name}` : `[seed] product exists: ${p.name}`);
  }
}

async function seedReviews() {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM reviews WHERE is_seed = true;');
  if (rows[0].n > 0) {
    console.log(`[seed] sample reviews already present (${rows[0].n})`);
    return;
  }
  for (const r of SAMPLE_REVIEWS) {
    await query(
      'INSERT INTO reviews (display_name, rating, text_en, text_fil, is_seed) VALUES ($1, $2, $3, $4, true);',
      [r.name, r.rating, r.en, r.fil]
    );
  }
  console.log(`[seed] sample reviews added: ${SAMPLE_REVIEWS.length}`);
}

async function seedSettings() {
  const entries = Object.entries(defaultSettings());
  for (const [key, value] of entries) {
    // DO NOTHING protects owner edits (see file header).
    const res = await query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING key;',
      [key, value]
    );
    if (res.rows.length > 0) console.log(`[seed] setting added: ${key}`);
  }
  console.log('[seed] settings checked (existing values preserved).');
}

async function main() {
  console.log('[seed] starting...');
  await seedAdmin();
  await seedProducts();
  await seedReviews();
  await seedSettings();
  console.log('[seed] done.');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed] FAILED:', err.message);
      process.exit(1);
    });
}

module.exports = { main };
