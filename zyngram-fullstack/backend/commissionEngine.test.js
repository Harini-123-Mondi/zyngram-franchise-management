const assert = require('node:assert/strict');
const test = require('node:test');
const sqlite3 = require('sqlite3').verbose();
const {
  calculateCommissions,
  calculateCommissionsInTransaction,
  settleCommission
} = require('./commissionEngine');

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (error) => error ? reject(error) : resolve());
  });
}

function execute(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (error) => error ? reject(error) : resolve());
  });
}

function query(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => error ? reject(error) : resolve());
  });
}

async function createCommissionDb() {
  const db = new sqlite3.Database(':memory:');
  await execute(db, `
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE services (id TEXT PRIMARY KEY, category TEXT NOT NULL);
    CREATE TABLE orders (id TEXT PRIMARY KEY, service_id TEXT NOT NULL REFERENCES services(id), amount REAL NOT NULL);
    CREATE TABLE franchises (id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id));
    CREATE TABLE commission_rules (
      id TEXT PRIMARY KEY, service_category TEXT NOT NULL, level TEXT NOT NULL, rate REAL NOT NULL,
      rate_type TEXT DEFAULT 'PERCENTAGE', effective_from TEXT, effective_to TEXT,
      version INTEGER DEFAULT 1, status TEXT DEFAULT 'ACTIVE', created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE commission_ledger (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), owner_id TEXT NOT NULL REFERENCES users(id),
      level TEXT NOT NULL, rule_id TEXT NOT NULL REFERENCES commission_rules(id),
      rate REAL NOT NULL, amount REAL NOT NULL, status TEXT DEFAULT 'PENDING',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_commission_ledger_order_owner_level
      ON commission_ledger(order_id, owner_id, level);
    CREATE TABLE wallet_ledger (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), entry_type TEXT NOT NULL,
      reference_id TEXT, amount REAL NOT NULL, status TEXT DEFAULT 'PENDING',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_wallet_ledger_reference_type
      ON wallet_ledger(reference_id, entry_type) WHERE reference_id IS NOT NULL;
    INSERT INTO users (id) VALUES ('owner-point'), ('owner-center'), ('owner-hub'), ('owner-command');
    INSERT INTO services (id, category) VALUES ('SVC001', 'RECHARGE');
    INSERT INTO orders (id, service_id, amount) VALUES ('order-1', 'SVC001', 100);
    INSERT INTO franchises (id, owner_id) VALUES
      ('point', 'owner-point'), ('center', 'owner-center'),
      ('hub', 'owner-hub'), ('command', 'owner-command');
    INSERT INTO commission_rules (id, service_category, level, rate, effective_from, version) VALUES
      ('rule-point', 'RECHARGE', 'POINT', 0.05, '2020-01-01 00:00:00', 1),
      ('rule-center', 'RECHARGE', 'CENTER', 0.03, '2020-01-01 00:00:00', 1),
      ('rule-hub', 'RECHARGE', 'HUB', 0.02, '2020-01-01 00:00:00', 1),
      ('rule-command', 'RECHARGE', 'COMMAND', 0.01, '2020-01-01 00:00:00', 1);
  `);
  return db;
}

const levels = [
  { id: 'point', level: 'POINT' },
  { id: 'center', level: 'CENTER' },
  { id: 'hub', level: 'HUB' },
  { id: 'command', level: 'COMMAND' }
];

test('calculates from configured rules and prevents duplicate commission entries', async () => {
  const db = await createCommissionDb();
  try {
    const results = await Promise.all([
      calculateCommissions(db, { orderId: 'order-1', levels, actorId: 'admin' }),
      calculateCommissions(db, { orderId: 'order-1', levels, actorId: 'admin' })
    ]);
    const rows = await query(db, 'SELECT level, rule_id AS ruleId, rate, amount FROM commission_ledger ORDER BY level');
    assert.deepEqual(results.map((result) => result.created.length).sort(), [0, 4]);
    assert.deepEqual(rows, [
      { level: 'CENTER', ruleId: 'rule-center', rate: 0.03, amount: 3 },
      { level: 'COMMAND', ruleId: 'rule-command', rate: 0.01, amount: 1 },
      { level: 'HUB', ruleId: 'rule-hub', rate: 0.02, amount: 2 },
      { level: 'POINT', ruleId: 'rule-point', rate: 0.05, amount: 5 }
    ]);
  } finally {
    await close(db);
  }
});

test('creates configured commission entries inside an existing order transaction', async () => {
  const db = await createCommissionDb();
  try {
    await run(db, 'BEGIN IMMEDIATE');
    const result = await calculateCommissionsInTransaction(db, {
      orderId: 'order-1',
      levels,
      actorId: 'admin'
    });
    assert.equal(result.created.length, 4);
    await run(db, 'COMMIT');
    const rows = await query(db, 'SELECT COUNT(*) AS count FROM commission_ledger');
    assert.equal(rows[0].count, 4);
  } catch (error) {
    await run(db, 'ROLLBACK');
    throw error;
  } finally {
    await close(db);
  }
});

test('rolls back commission creation when any hierarchy rule is missing', async () => {
  const db = await createCommissionDb();
  try {
    await execute(db, "DELETE FROM commission_rules WHERE level = 'HUB'");
    await assert.rejects(
      calculateCommissions(db, { orderId: 'order-1', levels, actorId: 'admin' }),
      /No active commission rule/
    );
    assert.deepEqual(await query(db, 'SELECT id FROM commission_ledger'), []);
  } finally {
    await close(db);
  }
});

test('settles commission and wallet credit atomically and rejects duplicate settlement', async () => {
  const db = await createCommissionDb();
  try {
    await calculateCommissions(db, { orderId: 'order-1', levels, actorId: 'admin' });
    const commission = (await query(db, "SELECT id FROM commission_ledger WHERE level = 'POINT'"))[0];
    await execute(db, `
      CREATE TRIGGER fail_wallet_credit BEFORE INSERT ON wallet_ledger
      BEGIN SELECT RAISE(ABORT, 'wallet unavailable'); END;
    `);
    await assert.rejects(settleCommission(db, commission.id), /wallet unavailable/);
    assert.deepEqual(await query(db, 'SELECT status FROM commission_ledger WHERE id = ?', [commission.id]), [{ status: 'PENDING' }]);
    assert.deepEqual(await query(db, 'SELECT id FROM wallet_ledger'), []);

    await execute(db, 'DROP TRIGGER fail_wallet_credit');
    await settleCommission(db, commission.id);
    assert.deepEqual(await query(db, 'SELECT status FROM commission_ledger WHERE id = ?', [commission.id]), [{ status: 'SETTLED' }]);
    assert.deepEqual(await query(db, 'SELECT owner_id, entry_type, reference_id, amount, status FROM wallet_ledger'), [{
      owner_id: 'owner-point', entry_type: 'CREDIT', reference_id: commission.id, amount: 5, status: 'SETTLED'
    }]);
    await assert.rejects(settleCommission(db, commission.id), (error) => error.statusCode === 409);
    assert.equal((await query(db, 'SELECT COUNT(*) AS count FROM wallet_ledger'))[0].count, 1);
  } finally {
    await close(db);
  }
});