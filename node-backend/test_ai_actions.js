const aiActionService = require('./src/services/aiActionService');
const assert = require('assert');

async function runTests() {
  console.log('🧪 Starting AI Action Service Tests...\n');

  // Test 1: Intent Detection
  console.log('1️⃣ Testing Intent Detection:');
  const addQuery = 'add 10000 expense as bday party for 15/oct 26 , paid. by cash';
  const intentAdd = aiActionService.parseActionIntent(addQuery);
  assert.strictEqual(intentAdd?.type, 'ADD_TRANSACTION', 'Should detect ADD_TRANSACTION');
  console.log('  ✅ "add 10000 expense as bday party for 15/oct 26 , paid. by cash" -> ADD_TRANSACTION');

  const viewQuery1 = 'view user data';
  const intentView1 = aiActionService.parseActionIntent(viewQuery1);
  assert.strictEqual(intentView1?.type, 'VIEW_DATA', 'Should detect VIEW_DATA for "view user data"');
  console.log('  ✅ "view user data" -> VIEW_DATA');

  const viewQuery2 = 'veriw user data';
  const intentView2 = aiActionService.parseActionIntent(viewQuery2);
  assert.strictEqual(intentView2?.type, 'VIEW_DATA', 'Should detect VIEW_DATA for typo "veriw user data"');
  console.log('  ✅ "veriw user data" (typo handled) -> VIEW_DATA');

  const removeQuery = 'remove bday party expense';
  const intentRemove = aiActionService.parseActionIntent(removeQuery);
  assert.strictEqual(intentRemove?.type, 'DELETE_TRANSACTION', 'Should detect DELETE_TRANSACTION');
  console.log('  ✅ "remove bday party expense" -> DELETE_TRANSACTION');

  const editQuery = 'edit bday party expense to 8000';
  const intentEdit = aiActionService.parseActionIntent(editQuery);
  assert.strictEqual(intentEdit?.type, 'EDIT_TRANSACTION', 'Should detect EDIT_TRANSACTION');
  console.log('  ✅ "edit bday party expense to 8000" -> EDIT_TRANSACTION');

  const conversationalQuery = 'How much can I afford for a house in Mumbai?';
  const intentConv = aiActionService.parseActionIntent(conversationalQuery);
  assert.strictEqual(intentConv, null, 'Conversational query should return null to pass to RAG');
  console.log('  ✅ "How much can I afford for a house in Mumbai?" -> null (routes to RAG)\n');

  // Test 2: Natural Date Parsing
  console.log('2️⃣ Testing Natural Date Parsing:');
  const d1 = aiActionService.parseNaturalDate('15/oct 26');
  assert.strictEqual(d1.getUTCFullYear(), 2026, 'Year should be 2026');
  assert.strictEqual(d1.getUTCMonth(), 9, 'Month should be Oct (9)');
  assert.strictEqual(d1.getUTCDate(), 15, 'Date should be 15');
  console.log('  ✅ "15/oct 26" ->', d1.toISOString());

  const d2 = aiActionService.parseNaturalDate('15/10/2026');
  assert.strictEqual(d2.getUTCFullYear(), 2026, 'Year should be 2026');
  assert.strictEqual(d2.getUTCDate(), 15, 'Date should be 15');
  console.log('  ✅ "15/10/2026" ->', d2.toISOString());

  const d3 = aiActionService.parseNaturalDate('yesterday');
  assert.ok(d3 instanceof Date, 'Should return valid Date');
  console.log('  ✅ "yesterday" ->', d3.toISOString());

  // Test 3: Category Inference
  console.log('\n3️⃣ Testing Category Inference:');
  assert.strictEqual(aiActionService.inferCategory('bday party'), 'Events & Entertainment');
  assert.strictEqual(aiActionService.inferCategory('supermarket groceries'), 'Groceries');
  assert.strictEqual(aiActionService.inferCategory('starbucks coffee'), 'Food & Dining');
  assert.strictEqual(aiActionService.inferCategory('monthly salary', 'INCOME'), 'Salary');
  console.log('  ✅ All categories inferred accurately.');

  console.log('\n🎉 ALL AI ACTION TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
