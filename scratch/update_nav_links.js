'use strict';
const fs = require('fs');
const path = require('path');

const dir = 'frontend/admin/html';
fs.readdirSync(dir).filter(f => f.endsWith('.html') && f !== 'inventory.html').forEach(f => {
  const p = path.join(dir, f);
  let content = fs.readFileSync(p, 'utf8');
  if (content.includes('href="inventory.html"')) {
    content = content.split('href="inventory.html"').join('href="products.html#section-stock-adjustment"');
    fs.writeFileSync(p, content, 'utf8');
    console.log('Updated ' + f);
  }
});

