'use strict';

const ingredientService = require('../backend/src/services/ingredientService');

(async () => {
  try {
    console.log('--- 1. Testing list() on fresh DB ---');
    const initialList = await ingredientService.list();
    console.log('Initial count:', initialList.ingredients.length, 'Summary:', initialList.summary);

    console.log('--- 2. Testing create() with initial stock ---');
    const created = await ingredientService.create({
      name: 'Test All-Purpose Flour (Scratch)',
      unit: 'kg',
      stock_quantity: 25.5,
      reorder_level: 10,
      cost_per_unit: 55.0,
      supplier: 'San Miguel Mills',
      expiry_date: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10), // Expiring in 5 days
      storage_location: 'Shelf B-1',
    }, 'test-admin@webake.com');

    console.log('Created ingredient:', {
      id: created.id,
      name: created.name,
      stock_quantity: created.stock_quantity,
      unit: created.unit,
      stock_status: created.stock_status,
      is_expiring_soon: created.is_expiring_soon,
    });

    console.log('--- 3. Testing adjustStock() with restock ---');
    const restocked = await ingredientService.adjustStock(created.id, {
      type: 'restock',
      quantity: 10,
      unitCost: 54.0,
      supplier: 'San Miguel Mills',
      reason: 'Batch delivery receipt #1234',
    }, 'test-admin@webake.com');
    console.log('After restock balance:', restocked.ingredient.stock_quantity, 'Movement:', restocked.movement.movement_type);

    console.log('--- 4. Testing adjustStock() with usage ---');
    const used = await ingredientService.adjustStock(created.id, {
      type: 'usage',
      quantity: 5.5,
      reason: 'Baking 100 bundles Spanish Bread',
    }, 'test-admin@webake.com');
    console.log('After usage balance:', used.ingredient.stock_quantity, 'Expected: 30.000');

    console.log('--- 5. Testing insufficient stock exception ---');
    try {
      await ingredientService.adjustStock(created.id, {
        type: 'usage',
        quantity: 100,
        reason: 'Overdraw test',
      }, 'test-admin@webake.com');
      console.error('FAIL: Should have thrown insufficient stock!');
      process.exit(1);
    } catch (err) {
      console.log('SUCCESS: Overdraw blocked with error:', err.message);
    }

    console.log('--- 6. Testing movements history ---');
    const hist = await ingredientService.movements(created.id, { limit: 10, offset: 0 });
    console.log(`Movements logged: ${hist.total} records`);
    hist.movements.forEach((m, idx) => {
      console.log(`  [${idx + 1}] ${m.movement_type}: ${m.quantity_change} (${m.quantity_before} -> ${m.quantity_after}) Reason: ${m.reason}`);
    });

    console.log('--- 7. Testing cleanup (delete test ingredient) ---');
    await ingredientService.remove(created.id);
    console.log('Cleanup successful!');

    console.log('ALL INGREDIENT TESTS PASSED CLEANLY!');
    process.exit(0);
  } catch (err) {
    console.error('Test failed with error:', err);
    process.exit(1);
  }
})();

