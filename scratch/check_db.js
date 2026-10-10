'use strict';
const { query } = require('../backend/src/config/db');

(async () => {
  const res = await query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'orders' ORDER BY ordinal_position;");
  console.log(res.rows);
  process.exit(0);
})();

