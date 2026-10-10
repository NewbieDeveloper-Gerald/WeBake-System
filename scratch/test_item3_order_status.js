'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Testing Item 3: Rename "Track Order" to "Order Status"...');

const filesToCheck = [
  'frontend/customer/html/home.html',
  'frontend/customer/html/products.html',
  'frontend/customer/html/track.html',
  'frontend/customer/html/login.html',
  'frontend/customer/html/register.html',
  'frontend/customer/js/dashboard.js',
  'frontend/customer/js/modals.js',
  'frontend/customer/js/utils.js',
  'frontend/customer/js/main.js',
  'backend/src/services/emailTemplates.js'
];

let failures = 0;
for (const relPath of filesToCheck) {
  const content = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    // Check for visible text (ignoring HTML comments, internal JS code comments, and attributes like data-track-order-open)
    const stripped = line.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/g, '');
    // Check if stripped line contains customer visible "Track Order" or "Track your order" or "Track this order"
    if (/>\s*Track\s*Order\s*</i.test(stripped) ||
        /<title>Track Order/i.test(stripped) ||
        /'Track Order'/i.test(stripped) ||
        /"Track Order"/i.test(stripped) ||
        /Track your order/i.test(stripped) ||
        /Track this order/i.test(stripped) ||
        /btn\(trackUrl,\s*'Track/i.test(stripped)) {
      console.error(`FAIL: ${relPath}:${idx + 1}: ${line.trim()}`);
      failures++;
    }
  });
}

assert.strictEqual(failures, 0, 'No customer-facing instances of "Track Order" should remain');
console.log('✔ All customer-facing "Track Order" text successfully verified as replaced');

// Verify positive matches for "Order Status"
const utilsContent = fs.readFileSync(path.join(__dirname, '../frontend/customer/js/utils.js'), 'utf8');
assert(utilsContent.includes("'nav.track': 'Order Status'"), "utils.js has 'nav.track': 'Order Status'");
assert(utilsContent.includes("'tr.lookup': 'Check your order status'"), "utils.js has 'tr.lookup': 'Check your order status'");

const homeContent = fs.readFileSync(path.join(__dirname, '../frontend/customer/html/home.html'), 'utf8');
assert(homeContent.includes('>Order Status</a>'), "home.html has >Order Status</a>");

const trackContent = fs.readFileSync(path.join(__dirname, '../frontend/customer/html/track.html'), 'utf8');
assert(trackContent.includes('<title>Order Status — WeBake</title>'), "track.html has Order Status title");
assert(trackContent.includes('>Order Status</h3>'), "track.html has Order Status heading");

console.log('All Item 3 tests passed successfully!');

