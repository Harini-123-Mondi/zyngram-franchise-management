const migrations = [
  {
    version: 1,
    name: 'baseline-existing-schema',
    statements: []
  },
  {
    version: 2,
    name: 'add-query-indexes',
    statements: [
      'CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)',
      'CREATE INDEX IF NOT EXISTS idx_user_locations_user_id ON user_locations(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_franchises_level_status ON franchises(level, status)',
      'CREATE INDEX IF NOT EXISTS idx_franchises_parent_id ON franchises(parent_id)',
      'CREATE INDEX IF NOT EXISTS idx_geo_boundaries_franchise_status ON geo_boundaries(franchise_id, status)',
      'CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_order_attribution_order_id ON order_attribution(order_id)',
      'CREATE INDEX IF NOT EXISTS idx_commission_ledger_owner_status ON commission_ledger(owner_id, status)',
      'CREATE INDEX IF NOT EXISTS idx_employees_franchise_status ON employees(franchise_id, status)',
      'CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id, date)',
      'CREATE INDEX IF NOT EXISTS idx_leave_requests_employee_status ON leave_requests(employee_id, status)',
      'CREATE INDEX IF NOT EXISTS idx_targets_employee_status ON targets(employee_id, status)',
      'CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON employee_documents(employee_id)'
    ]
  },
  {
    version: 3,
    name: 'add-customer-owner-and-service-catalog',
    statements: [
      `CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        mobile TEXT NOT NULL,
        email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS franchise_owners (
        user_id TEXT PRIMARY KEY,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS services (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `INSERT OR IGNORE INTO services (id, name, category, status)
       VALUES ('SVC001', 'Mobile Recharge', 'RECHARGE', 'ACTIVE')`,
      `INSERT OR IGNORE INTO customers (id, user_id, name, mobile, email, status)
       SELECT id, id, name, mobile, email, COALESCE(status, 'ACTIVE')
       FROM users WHERE lower(role) = 'customer'`,
      `INSERT OR IGNORE INTO franchise_owners (user_id)
       SELECT id FROM users WHERE lower(role) = 'franchise_owner'`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_ledger_order_owner_level
       ON commission_ledger(order_id, owner_id, level)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_ledger_reference_type
       ON wallet_ledger(reference_id, entry_type) WHERE reference_id IS NOT NULL`
    ]
  },
  {
    version: 4,
    name: 'repair-legacy-relations-and-verify-operational-schema',
    statements: [
      `CREATE TABLE IF NOT EXISTS migration_quarantine (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        migration_name TEXT NOT NULL,
        source_table TEXT NOT NULL,
        source_row_id TEXT NOT NULL,
        original_data TEXT NOT NULL,
        reason TEXT NOT NULL,
        quarantined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `INSERT INTO migration_quarantine (migration_name, source_table, source_row_id, original_data, reason)
       SELECT 'repair-legacy-relations-and-verify-operational-schema', 'franchises', id,
         json_object('id', id, 'owner_id', owner_id),
         'owner_id did not reference an existing user'
       FROM franchises f
       WHERE owner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = f.owner_id)`,
      `UPDATE franchises SET owner_id = NULL
       WHERE owner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = franchises.owner_id)`,
      `INSERT INTO migration_quarantine (migration_name, source_table, source_row_id, original_data, reason)
       SELECT 'repair-legacy-relations-and-verify-operational-schema', 'orders', id,
         json_object('id', id, 'location_id', location_id),
         'location_id did not reference an existing user location'
       FROM orders o
       WHERE location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_locations l WHERE l.id = o.location_id)`,
      `UPDATE orders SET location_id = NULL
       WHERE location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_locations l WHERE l.id = orders.location_id)`,
      `INSERT INTO migration_quarantine (migration_name, source_table, source_row_id, original_data, reason)
       SELECT 'repair-legacy-relations-and-verify-operational-schema', 'targets', id,
         json_object('id', id, 'department_id', department_id),
         'department_id did not reference an existing department'
       FROM targets t
       WHERE department_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM departments d WHERE d.id = t.department_id)`,
      `UPDATE targets SET department_id = NULL
       WHERE department_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM departments d WHERE d.id = targets.department_id)`,
      `INSERT INTO migration_quarantine (migration_name, source_table, source_row_id, original_data, reason)
       SELECT 'repair-legacy-relations-and-verify-operational-schema', 'targets', id,
         json_object('id', id, 'designation_id', designation_id),
         'designation_id did not reference an existing designation'
       FROM targets t
       WHERE designation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM designations d WHERE d.id = t.designation_id)`,
      `UPDATE targets SET designation_id = NULL
       WHERE designation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM designations d WHERE d.id = targets.designation_id)`,
      `INSERT INTO migration_quarantine (migration_name, source_table, source_row_id, original_data, reason)
       SELECT 'repair-legacy-relations-and-verify-operational-schema', 'employee_franchise_mapping', CAST(m.rowid AS TEXT),
         json_object('employee_id', employee_id, 'franchise_id', franchise_id),
         'employee-franchise mapping referenced a missing employee or franchise'
       FROM employee_franchise_mapping m
       WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = m.employee_id)
          OR NOT EXISTS (SELECT 1 FROM franchises f WHERE f.id = m.franchise_id)`,
      `DELETE FROM employee_franchise_mapping
       WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = employee_franchise_mapping.employee_id)
          OR NOT EXISTS (SELECT 1 FROM franchises f WHERE f.id = employee_franchise_mapping.franchise_id)`,
      'CREATE INDEX IF NOT EXISTS idx_geo_boundaries_franchise_version ON geo_boundaries(franchise_id, version)',
      'CREATE INDEX IF NOT EXISTS idx_commission_rules_lookup ON commission_rules(service_category, level, status, effective_from)',
      'CREATE INDEX IF NOT EXISTS idx_wallet_ledger_owner_created ON wallet_ledger(owner_id, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_action ON audit_logs(actor, action)',
      'CREATE INDEX IF NOT EXISTS idx_designations_department_status ON designations(department_id, status)',
      'CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created ON notifications(user_id, is_read, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_performance_records_employee_period ON performance_records(employee_id, period)',
      'CREATE INDEX IF NOT EXISTS idx_work_locations_status ON work_locations(status)',
      `CREATE TRIGGER IF NOT EXISTS trg_orders_service_insert
       BEFORE INSERT ON orders
       WHEN NOT EXISTS (SELECT 1 FROM services WHERE id = NEW.service_id)
       BEGIN
         SELECT RAISE(ABORT, 'orders.service_id must reference an existing service');
       END`,
      `CREATE TRIGGER IF NOT EXISTS trg_orders_service_update
       BEFORE UPDATE OF service_id ON orders
       WHEN NOT EXISTS (SELECT 1 FROM services WHERE id = NEW.service_id)
       BEGIN
         SELECT RAISE(ABORT, 'orders.service_id must reference an existing service');
       END`
    ]
  },
  {
    version: 5,
    name: 'add-independent-digital-franchise-hierarchy',
    statements: [
       `INSERT INTO migration_quarantine (migration_name, source_table, source_row_id, original_data, reason)
        SELECT 'add-independent-digital-franchise-hierarchy', 'franchises', f.id,
          json_object('id', f.id, 'level', f.level, 'name', f.name, 'parent_id', f.parent_id, 'status', f.status),
          'franchise tier or parent level did not follow a supported physical or digital hierarchy'
        FROM franchises f
        WHERE COALESCE(NOT (
          (f.level = 'HQ' AND f.parent_id IS NULL) OR
          (f.level = 'NATION' AND f.parent_id IS NULL) OR
          (f.level = 'COMMAND' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = f.parent_id AND p.level = 'HQ')) OR
          (f.level = 'HUB' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = f.parent_id AND p.level = 'COMMAND')) OR
          (f.level = 'CENTER' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = f.parent_id AND p.level = 'HUB')) OR
          (f.level = 'POINT' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = f.parent_id AND p.level = 'CENTER')) OR
          (f.level = 'REGION' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = f.parent_id AND p.level = 'NATION')) OR
          (f.level = 'TERRITORY' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = f.parent_id AND p.level = 'REGION')) OR
          (f.level = 'ZONE' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = f.parent_id AND p.level = 'TERRITORY')) OR
          (f.level = 'NODE' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = f.parent_id AND p.level = 'ZONE'))
        ), 1)`,
       `UPDATE franchises SET status = 'INACTIVE'
        WHERE COALESCE(NOT (
          (level = 'HQ' AND parent_id IS NULL) OR
          (level = 'NATION' AND parent_id IS NULL) OR
          (level = 'COMMAND' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = franchises.parent_id AND p.level = 'HQ')) OR
          (level = 'HUB' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = franchises.parent_id AND p.level = 'COMMAND')) OR
          (level = 'CENTER' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = franchises.parent_id AND p.level = 'HUB')) OR
          (level = 'POINT' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = franchises.parent_id AND p.level = 'CENTER')) OR
          (level = 'REGION' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = franchises.parent_id AND p.level = 'NATION')) OR
          (level = 'TERRITORY' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = franchises.parent_id AND p.level = 'REGION')) OR
          (level = 'ZONE' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = franchises.parent_id AND p.level = 'TERRITORY')) OR
          (level = 'NODE' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = franchises.parent_id AND p.level = 'ZONE'))
        ), 1)`,
       'ALTER TABLE order_attribution ADD COLUMN hq_id TEXT REFERENCES franchises(id)',
       'ALTER TABLE order_attribution ADD COLUMN node_id TEXT REFERENCES franchises(id)',
       'ALTER TABLE order_attribution ADD COLUMN zone_id TEXT REFERENCES franchises(id)',
       'ALTER TABLE order_attribution ADD COLUMN territory_id TEXT REFERENCES franchises(id)',
       'ALTER TABLE order_attribution ADD COLUMN region_id TEXT REFERENCES franchises(id)',
       'ALTER TABLE order_attribution ADD COLUMN nation_id TEXT REFERENCES franchises(id)',
       `CREATE TRIGGER IF NOT EXISTS trg_franchise_hierarchy_insert
        BEFORE INSERT ON franchises
        WHEN COALESCE(NOT (
          (NEW.level = 'HQ' AND NEW.parent_id IS NULL) OR
          (NEW.level = 'NATION' AND NEW.parent_id IS NULL) OR
          (NEW.level = 'COMMAND' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = NEW.parent_id AND p.level = 'HQ' AND p.status = 'ACTIVE')) OR
          (NEW.level = 'HUB' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = NEW.parent_id AND p.level = 'COMMAND' AND p.status = 'ACTIVE')) OR
          (NEW.level = 'CENTER' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = NEW.parent_id AND p.level = 'HUB' AND p.status = 'ACTIVE')) OR
          (NEW.level = 'POINT' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = NEW.parent_id AND p.level = 'CENTER' AND p.status = 'ACTIVE')) OR
          (NEW.level = 'REGION' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = NEW.parent_id AND p.level = 'NATION' AND p.status = 'ACTIVE')) OR
          (NEW.level = 'TERRITORY' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = NEW.parent_id AND p.level = 'REGION' AND p.status = 'ACTIVE')) OR
          (NEW.level = 'ZONE' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = NEW.parent_id AND p.level = 'TERRITORY' AND p.status = 'ACTIVE')) OR
          (NEW.level = 'NODE' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = NEW.parent_id AND p.level = 'ZONE' AND p.status = 'ACTIVE'))
        ), 1)
        BEGIN
          SELECT RAISE(ABORT, 'invalid franchise level or parent level');
        END`,
       `CREATE TRIGGER IF NOT EXISTS trg_franchise_hierarchy_update
        BEFORE UPDATE OF level, parent_id ON franchises
        WHEN COALESCE(NOT (
          (NEW.level = 'HQ' AND NEW.parent_id IS NULL) OR
          (NEW.level = 'NATION' AND NEW.parent_id IS NULL) OR
          (NEW.level = 'COMMAND' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = NEW.parent_id AND p.level = 'HQ' AND p.status = 'ACTIVE')) OR
          (NEW.level = 'HUB' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = NEW.parent_id AND p.level = 'COMMAND' AND p.status = 'ACTIVE')) OR
          (NEW.level = 'CENTER' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = NEW.parent_id AND p.level = 'HUB' AND p.status = 'ACTIVE')) OR
          (NEW.level = 'POINT' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = NEW.parent_id AND p.level = 'CENTER' AND p.status = 'ACTIVE')) OR
          (NEW.level = 'REGION' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = NEW.parent_id AND p.level = 'NATION' AND p.status = 'ACTIVE')) OR
          (NEW.level = 'TERRITORY' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = NEW.parent_id AND p.level = 'REGION' AND p.status = 'ACTIVE')) OR
          (NEW.level = 'ZONE' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = NEW.parent_id AND p.level = 'TERRITORY' AND p.status = 'ACTIVE')) OR
          (NEW.level = 'NODE' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = NEW.parent_id AND p.level = 'ZONE' AND p.status = 'ACTIVE'))
        ), 1)
        BEGIN
          SELECT RAISE(ABORT, 'invalid franchise level or parent level');
        END`,
       `CREATE TRIGGER IF NOT EXISTS trg_geo_boundary_leaf_insert
        BEFORE INSERT ON geo_boundaries
        WHEN NOT EXISTS (SELECT 1 FROM franchises f WHERE f.id = NEW.franchise_id AND f.level IN ('POINT', 'NODE'))
        BEGIN
          SELECT RAISE(ABORT, 'geo boundary must belong to a Point or Node franchise');
        END`,
       `CREATE TRIGGER IF NOT EXISTS trg_geo_boundary_leaf_update
        BEFORE UPDATE OF franchise_id ON geo_boundaries
        WHEN NOT EXISTS (SELECT 1 FROM franchises f WHERE f.id = NEW.franchise_id AND f.level IN ('POINT', 'NODE'))
        BEGIN
          SELECT RAISE(ABORT, 'geo boundary must belong to a Point or Node franchise');
        END`
    ]
  },
  {
    version: 6,
    name: 'record-independent-digital-mapping-version',
    statements: [
      'ALTER TABLE order_attribution ADD COLUMN digital_mapping_version INTEGER'
    ]
  },
  {
    version: 7,
    name: 'add-customer-registration-attribution-snapshots',
    statements: [
      `CREATE TABLE IF NOT EXISTS customer_attributions (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        location_id TEXT NOT NULL REFERENCES user_locations(id),
        status TEXT NOT NULL CHECK (status IN ('MAPPED', 'UNMAPPED')),
        coordinates TEXT NOT NULL,
        point_id TEXT REFERENCES franchises(id),
        center_id TEXT REFERENCES franchises(id),
        hub_id TEXT REFERENCES franchises(id),
        command_id TEXT REFERENCES franchises(id),
        hq_id TEXT REFERENCES franchises(id),
        physical_boundary_id TEXT REFERENCES geo_boundaries(id),
        physical_mapping_version INTEGER,
        node_id TEXT REFERENCES franchises(id),
        zone_id TEXT REFERENCES franchises(id),
        territory_id TEXT REFERENCES franchises(id),
        region_id TEXT REFERENCES franchises(id),
        nation_id TEXT REFERENCES franchises(id),
        digital_boundary_id TEXT REFERENCES geo_boundaries(id),
        digital_mapping_version INTEGER,
        physical_result TEXT NOT NULL,
        digital_result TEXT NOT NULL,
        location_consent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (
          (status = 'MAPPED' AND point_id IS NOT NULL AND center_id IS NOT NULL AND
           hub_id IS NOT NULL AND command_id IS NOT NULL AND hq_id IS NOT NULL AND
           physical_boundary_id IS NOT NULL AND physical_mapping_version IS NOT NULL AND
           node_id IS NOT NULL AND zone_id IS NOT NULL AND territory_id IS NOT NULL AND
           region_id IS NOT NULL AND nation_id IS NOT NULL AND digital_boundary_id IS NOT NULL AND
           digital_mapping_version IS NOT NULL)
          OR
          (status = 'UNMAPPED' AND point_id IS NULL AND center_id IS NULL AND hub_id IS NULL AND
           command_id IS NULL AND hq_id IS NULL AND physical_boundary_id IS NULL AND
           physical_mapping_version IS NULL AND node_id IS NULL AND zone_id IS NULL AND
           territory_id IS NULL AND region_id IS NULL AND nation_id IS NULL AND
           digital_boundary_id IS NULL AND digital_mapping_version IS NULL)
        )
      )`,
      'CREATE INDEX IF NOT EXISTS idx_customer_attributions_customer_created ON customer_attributions(customer_id, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_customer_attributions_location ON customer_attributions(location_id)'
    ]
  },
  {
    version: 8,
    name: 'add-mobile-recharge-order-processing',
    statements: [
      "ALTER TABLE orders ADD COLUMN subscriber_mobile TEXT",
      "ALTER TABLE orders ADD COLUMN operator TEXT",
      "ALTER TABLE orders ADD COLUMN circle TEXT",
      "ALTER TABLE orders ADD COLUMN processing_reference TEXT",
      "ALTER TABLE orders ADD COLUMN processed_at DATETIME",
      "ALTER TABLE orders ADD COLUMN processing_message TEXT",
      `CREATE TABLE IF NOT EXISTS order_status_history (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'SIMULATED_SUCCESS', 'FAILED')),
        message TEXT NOT NULL,
        reference TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      'CREATE INDEX IF NOT EXISTS idx_order_status_history_order_created ON order_status_history(order_id, created_at)'
    ]
  },
  {
    version: 9,
    name: 'seed-configurable-demo-recharge-commission-rules',
    statements: [
      `INSERT OR IGNORE INTO commission_rules
        (id, service_category, level, rate, rate_type, effective_from, version, status)
       VALUES
        ('DEMO-RECHARGE-POINT-v1', 'RECHARGE', 'POINT', 0.05, 'PERCENTAGE', CURRENT_TIMESTAMP, 1, 'ACTIVE'),
        ('DEMO-RECHARGE-CENTER-v1', 'RECHARGE', 'CENTER', 0.03, 'PERCENTAGE', CURRENT_TIMESTAMP, 1, 'ACTIVE'),
        ('DEMO-RECHARGE-HUB-v1', 'RECHARGE', 'HUB', 0.02, 'PERCENTAGE', CURRENT_TIMESTAMP, 1, 'ACTIVE'),
        ('DEMO-RECHARGE-COMMAND-v1', 'RECHARGE', 'COMMAND', 0.01, 'PERCENTAGE', CURRENT_TIMESTAMP, 1, 'ACTIVE')`,
      'CREATE INDEX IF NOT EXISTS idx_commission_rules_effective_lookup ON commission_rules(service_category, level, status, effective_from, effective_to)'
    ]
  },
  {
    version: 10,
    name: 'add-mobile-recharge-idempotency',
    statements: [
      'ALTER TABLE orders ADD COLUMN idempotency_key TEXT',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL'
    ]
  }
];

const latestSchemaVersion = migrations[migrations.length - 1].version;

function runMigrations(db, callback) {
  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      (tableError) => {
        if (tableError) return callback(tableError);

        db.all('SELECT version FROM schema_migrations ORDER BY version', [], (readError, rows) => {
          if (readError) return callback(readError);

          const appliedVersions = new Set(rows.map((row) => row.version));
          const pendingMigrations = migrations.filter((migration) => !appliedVersions.has(migration.version));
          if (rows.some((row) => row.version > latestSchemaVersion)) {
            return callback(new Error('Database schema version is newer than this application supports'));
          }

          const applyNext = (index) => {
            if (index >= pendingMigrations.length) {
              return callback(null, latestSchemaVersion);
            }

            const migration = pendingMigrations[index];
            db.run('BEGIN IMMEDIATE', (beginError) => {
              if (beginError) return callback(beginError);

              const executeStatement = (statementIndex) => {
                if (statementIndex >= migration.statements.length) {
                  return db.run(
                    'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
                    [migration.version, migration.name],
                    (recordError) => {
                      if (recordError) {
                        return db.run('ROLLBACK', () => callback(recordError));
                      }
                      db.run('COMMIT', (commitError) => {
                        if (commitError) {
                          return db.run('ROLLBACK', () => callback(commitError));
                        }
                        applyNext(index + 1);
                      });
                    }
                  );
                }

                db.run(migration.statements[statementIndex], (statementError) => {
                  if (statementError) {
                    return db.run('ROLLBACK', () => callback(statementError));
                  }
                  executeStatement(statementIndex + 1);
                });
              };

              executeStatement(0);
            });
          };

          applyNext(0);
        });
      }
    );
  });
}

module.exports = { latestSchemaVersion, runMigrations };
