'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Testing Item 2: Landing Page Cart vs Product Page Cart parity...');

const homeHtml = fs.readFileSync(path.join(__dirname, '../frontend/customer/html/home.html'), 'utf8');
const productsHtml = fs.readFileSync(path.join(__dirname, '../frontend/customer/html/products.html'), 'utf8');
const componentsCss = fs.readFileSync(path.join(__dirname, '../frontend/customer/css/components.css'), 'utf8');

// 1. Verify Cart Sidebar Markup parity
function extractCartSidebar(html) {
  const match = html.match(/<!-- CART SIDEBAR -->([\s\S]*?)(?=<!--|$)/);
  assert(match, 'Cart sidebar markup should exist');
  return match[1].replace(/\r?\n\s*/g, ' ').trim();
}

const homeCart = extractCartSidebar(homeHtml);
const productsCart = extractCartSidebar(productsHtml);
assert.strictEqual(homeCart, productsCart, 'Cart sidebar HTML in home.html must match products.html exactly');
console.log('✔ Cart sidebar HTML in home.html matches products.html exactly');

// 2. Verify Navbar cart icon button parity
function extractCartIcon(html) {
  const match = html.match(/<button class="cart-icon" id="cart-icon"[\s\S]*?<\/button>/);
  assert(match, 'Navbar cart-icon should exist');
  return match[0].replace(/\r?\n\s*/g, ' ').trim();
}

assert.strictEqual(extractCartIcon(homeHtml), extractCartIcon(productsHtml), 'Navbar cart button in home.html must match products.html');
console.log('✔ Navbar cart button in home.html matches products.html');

// 3. Verify CSS components.css contains complete cart styling
const requiredSelectors = [
  '.cart-sidebar',
  '.cart-sidebar.active',
  '.cart-header',
  '.cart-body',
  '.cart-footer',
  '.cart-total',
  '.cart-selection-hint',
  '.cart-line',
  '.cart-line.is-selected',
  '.cart-line-select',
  '.cart-line-product',
  '.cart-line-ctrl',
  '.cart-order-qty',
  '.cart-quantity-wrap',
  '.quantity-options',
  '.cart-quantity-options',
  '.quantity-option',
  '#proceed-checkout:disabled'
];

for (const sel of requiredSelectors) {
  assert(componentsCss.includes(sel), `components.css must define ${sel}`);
}
console.log('✔ components.css contains all required cart and line item styling');

// 4. Verify responsive media queries in components.css
assert(componentsCss.includes('@media (max-width: 600px)'), 'components.css must contain max-width: 600px responsive rule');
assert(componentsCss.includes('@media (max-width: 480px)'), 'components.css must contain max-width: 480px responsive rule');
console.log('✔ components.css contains responsive rules for mobile/tablet');

// 5. Verify both pages link components.css and main.js
assert(homeHtml.includes('components.css') && productsHtml.includes('components.css'), 'Both pages link components.css');
assert(homeHtml.includes('main.js') && productsHtml.includes('main.js'), 'Both pages link main.js');
console.log('✔ Both pages load shared components.css and main.js');

console.log('All Item 2 checks passed successfully!');

