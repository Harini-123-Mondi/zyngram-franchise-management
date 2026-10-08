const { v4: uuidv4 } = require('uuid');
const transactionQueues = new WeakMap();

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) return reject(error);
      resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

async function executeTransaction(db, operation) {
  await run(db, 'BEGIN IMMEDIATE');
  try {
    const result = await operation();
    await run(db, 'COMMIT');
    return result;
  } catch (error) {
    try {
      await run(db, 'ROLLBACK');
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
}

function withTransaction(db, operation) {
  const previous = transactionQueues.get(db) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => executeTransaction(db, operation));
  transactionQueues.set(db, current);
  return current;
}

async function calculateCommissionsInTransaction(db, { orderId, levels, actorId }) {
  const order = await get(
    db,
    `SELECT o.amount, s.category AS serviceCategory
     FROM orders o JOIN services s ON s.id = o.service_id
     WHERE o.id = ?`,
    [orderId]
  );
  if (!order) throw new Error('Commission order or service was not found');
  if (!Number.isFinite(Number(order.amount)) || Number(order.amount) < 0) {
    throw new Error('Commission order amount is invalid');
  }

  const created = [];
  for (const { id: franchiseId, level } of levels) {
    if (!franchiseId) continue;
    const franchise = await get(db, 'SELECT owner_id FROM franchises WHERE id = ?', [franchiseId]);
    if (!franchise) throw new Error(`Commission franchise ${franchiseId} was not found`);
    if (!franchise.owner_id) continue;

    const rule = await get(
      db,
      `SELECT id, rate, rate_type FROM commission_rules
       WHERE service_category = ? AND level = ? AND status = 'ACTIVE'
         AND (effective_from IS NULL OR datetime(effective_from) <= CURRENT_TIMESTAMP)
         AND (effective_to IS NULL OR datetime(effective_to) > CURRENT_TIMESTAMP)
       ORDER BY effective_from DESC, version DESC, created_at DESC
       LIMIT 1`,
      [order.serviceCategory, level]
    );
    if (!rule) throw new Error(`No active commission rule for ${order.serviceCategory}/${level}`);
    if (rule.rate_type !== 'PERCENTAGE' || !Number.isFinite(Number(rule.rate)) ||
        Number(rule.rate) < 0 || Number(rule.rate) > 1) {
      throw new Error(`Commission rule ${rule.id} has an unsupported rate configuration`);
    }

    const rate = Number(rule.rate);
    const amount = Math.round(Number(order.amount) * rate * 100) / 100;
    const ledgerId = uuidv4();
    const result = await run(
      db,
      `INSERT OR IGNORE INTO commission_ledger
        (id, order_id, owner_id, level, rule_id, rate, amount, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [ledgerId, orderId, franchise.owner_id, level, rule.id, rate, amount]
    );
    if (result.changes === 1) {
      created.push({ id: ledgerId, orderId, ownerId: franchise.owner_id, level, ruleId: rule.id, rate, amount });
    }
  }

  return { created, actorId };
}

function calculateCommissions(db, parameters) {
  return withTransaction(db, () => calculateCommissionsInTransaction(db, parameters));
}

async function settleCommission(db, commissionId) {
  return withTransaction(db, async () => {
    const commission = await get(db, 'SELECT * FROM commission_ledger WHERE id = ?', [commissionId]);
    if (!commission) {
      const error = new Error('Commission not found');
      error.statusCode = 404;
      throw error;
    }
    if (commission.status !== 'PENDING') {
      const error = new Error('Commission already processed');
      error.statusCode = 409;
      throw error;
    }

    const update = await run(
      db,
      "UPDATE commission_ledger SET status = 'SETTLED' WHERE id = ? AND status = 'PENDING'",
      [commissionId]
    );
    if (update.changes !== 1) {
      const error = new Error('Commission status changed before settlement');
      error.statusCode = 409;
      throw error;
    }
    await run(
      db,
      `INSERT INTO wallet_ledger (id, owner_id, entry_type, reference_id, amount, status)
       VALUES (?, ?, 'CREDIT', ?, ?, 'SETTLED')`,
      [uuidv4(), commission.owner_id, commissionId, commission.amount]
    );
    return commission;
  });
}

module.exports = { calculateCommissions, calculateCommissionsInTransaction, settleCommission };
