require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { latestSchemaVersion } = require('./databaseMigrations');

const expectedTables = [
  'users', 'customers', 'franchise_owners', 'franchises', 'geo_boundaries',
  'user_locations', 'customer_attributions', 'services', 'orders', 'order_status_history', 'order_attribution', 'commission_rules',
  'commission_ledger', 'wallet_ledger', 'employees', 'departments', 'designations',
  'attendance', 'leave_requests', 'targets', 'employee_documents', 'notifications', 'audit_logs',
  'chat_messages', 'assistant_messages'
];

const relationshipTables = [...new Set([...expectedTables, 'employee_franchise_mapping'])];

const requiredIndexes = [
  'idx_users_status', 'idx_franchises_level_status', 'idx_geo_boundaries_franchise_status',
  'idx_orders_customer_created', 'idx_commission_ledger_order_owner_level',
  'idx_orders_idempotency_key',
  'idx_wallet_ledger_reference_type', 'idx_employees_franchise_status',
  'idx_attendance_employee_date', 'idx_leave_requests_employee_status',
  'idx_targets_employee_status', 'idx_employee_documents_employee',
  'idx_audit_logs_timestamp', 'idx_notifications_user_read_created',
  'idx_customer_attributions_customer_created', 'idx_customer_attributions_location',
  'idx_order_status_history_order_created', 'idx_commission_rules_effective_lookup',
  'idx_chat_messages_created', 'idx_assistant_messages_user_created'
];

const requiredForeignKeys = [
  ['customers', 'user_id', 'users'],
  ['franchise_owners', 'user_id', 'users'],
  ['user_locations', 'user_id', 'users'],
  ['customer_attributions', 'customer_id', 'customers'],
  ['customer_attributions', 'location_id', 'user_locations'],
  ['customer_attributions', 'point_id', 'franchises'],
  ['customer_attributions', 'center_id', 'franchises'],
  ['customer_attributions', 'hub_id', 'franchises'],
  ['customer_attributions', 'command_id', 'franchises'],
  ['customer_attributions', 'hq_id', 'franchises'],
  ['customer_attributions', 'physical_boundary_id', 'geo_boundaries'],
  ['customer_attributions', 'node_id', 'franchises'],
  ['customer_attributions', 'zone_id', 'franchises'],
  ['customer_attributions', 'territory_id', 'franchises'],
  ['customer_attributions', 'region_id', 'franchises'],
  ['customer_attributions', 'nation_id', 'franchises'],
  ['customer_attributions', 'digital_boundary_id', 'geo_boundaries'],
  ['franchises', 'owner_id', 'users'],
  ['franchises', 'parent_id', 'franchises'],
  ['geo_boundaries', 'franchise_id', 'franchises'],
  ['orders', 'customer_id', 'users'],
  ['orders', 'location_id', 'user_locations'],
  ['order_status_history', 'order_id', 'orders'],
  ['order_attribution', 'order_id', 'orders'],
  ['commission_ledger', 'order_id', 'orders'],
  ['commission_ledger', 'owner_id', 'users'],
  ['commission_ledger', 'rule_id', 'commission_rules'],
  ['wallet_ledger', 'owner_id', 'users'],
  ['employees', 'department_id', 'departments'],
  ['employees', 'designation_id', 'designations'],
  ['employees', 'reporting_manager_id', 'employees'],
  ['employees', 'franchise_id', 'franchises'],
  ['designations', 'department_id', 'departments'],
  ['attendance', 'employee_id', 'employees'],
  ['leave_requests', 'employee_id', 'employees'],
  ['targets', 'employee_id', 'employees'],
  ['targets', 'department_id', 'departments'],
  ['targets', 'designation_id', 'designations'],
  ['employee_documents', 'employee_id', 'employees'],
  ['notifications', 'user_id', 'users'],
  ['chat_messages', 'sender_id', 'users'],
  ['assistant_messages', 'user_id', 'users'],
  ['employee_franchise_mapping', 'employee_id', 'employees'],
  ['employee_franchise_mapping', 'franchise_id', 'franchises']
];

const requiredAttributionColumns = [
  'point_id', 'center_id', 'hub_id', 'command_id', 'hq_id',
  'node_id', 'digital_mapping_version', 'zone_id', 'territory_id', 'region_id', 'nation_id'
];

const requiredCustomerAttributionColumns = [
  'customer_id', 'location_id', 'status', 'coordinates',
  'point_id', 'center_id', 'hub_id', 'command_id', 'hq_id',
  'physical_boundary_id', 'physical_mapping_version',
  'node_id', 'zone_id', 'territory_id', 'region_id', 'nation_id',
  'digital_boundary_id', 'digital_mapping_version',
  'physical_result', 'digital_result', 'location_consent_at'
];

const requiredRechargeOrderColumns = [
  'subscriber_mobile', 'operator', 'circle',
  'processing_reference', 'processed_at', 'processing_message', 'idempotency_key'
];

function verifyCustomerAttributionSchema(db, callback) {
  db.all('PRAGMA table_info(customer_attributions)', (schemaError, columns) => {
    if (schemaError) return callback(schemaError);
    const columnNames = new Set(columns.map((column) => column.name));
    const missingColumns = requiredCustomerAttributionColumns.filter((column) => !columnNames.has(column));
    if (missingColumns.length) {
      return callback(new Error(`Missing customer attribution columns: ${missingColumns.join(', ')}`));
    }

    db.get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'customer_attributions'", (constraintError, table) => {
      if (constraintError) return callback(constraintError);
      if (!table?.sql.includes("status = 'UNMAPPED'") ||
          !table.sql.includes('point_id IS NULL') ||
          !table.sql.includes('node_id IS NULL')) {
        return callback(new Error('Customer attribution table is missing its no-assignment constraint for UNMAPPED registrations'));
      }
      callback(null);
    });
  });
}

function verifyRechargeOrderSchema(db, callback) {
  db.all('PRAGMA table_info(orders)', (schemaError, columns) => {
    if (schemaError) return callback(schemaError);
    const columnNames = new Set(columns.map((column) => column.name));
    const missingColumns = requiredRechargeOrderColumns.filter((column) => !columnNames.has(column));
    if (missingColumns.length) {
      return callback(new Error(`Missing Mobile Recharge order columns: ${missingColumns.join(', ')}`));
    }
    callback(null);
  });
}

function verifyDatabase(db, callback) {
  db.serialize(() => {
    db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'", (tableError, tableRows) => {
      if (tableError) return callback(tableError);
      const tables = new Set(tableRows.map((row) => row.name));
      const missingTables = expectedTables.filter((table) => !tables.has(table));
      if (!tables.has('employee_franchise_mapping')) missingTables.push('employee_franchise_mapping');
      if (missingTables.length) return callback(new Error(`Missing required database tables: ${missingTables.join(', ')}`));

      db.all("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'", (indexError, indexRows) => {
        if (indexError) return callback(indexError);
        const indexes = new Set(indexRows.map((row) => row.name));
        const missingIndexes = requiredIndexes.filter((index) => !indexes.has(index));
        if (missingIndexes.length) return callback(new Error(`Missing required database indexes: ${missingIndexes.join(', ')}`));

        const actualForeignKeys = new Set();
        let tableIndex = 0;
        const checkTableForeignKeys = () => {
          if (tableIndex >= relationshipTables.length) return finishForeignKeyChecks();
          const table = relationshipTables[tableIndex++];
          db.all(`PRAGMA foreign_key_list("${table}")`, (foreignKeyError, rows) => {
            if (foreignKeyError) return callback(foreignKeyError);
            rows.forEach((row) => actualForeignKeys.add(`${table}.${row.from}->${row.table}`));
            checkTableForeignKeys();
          });
        };
        const finishForeignKeyChecks = () => {
          const missingForeignKeys = requiredForeignKeys.filter(([table, column, parent]) => (
            !actualForeignKeys.has(`${table}.${column}->${parent}`)
          ));
          if (missingForeignKeys.length) {
            return callback(new Error(`Missing required foreign-key relationships: ${missingForeignKeys.map(([table, column, parent]) => `${table}.${column}->${parent}`).join(', ')}`));
          }

          db.all("SELECT name FROM sqlite_master WHERE type = 'trigger'", (triggerError, triggerRows) => {
            if (triggerError) return callback(triggerError);
            const triggers = new Set(triggerRows.map((row) => row.name));
            const requiredTriggers = [
              'trg_orders_service_insert',
              'trg_orders_service_update',
              'trg_franchise_hierarchy_insert',
              'trg_franchise_hierarchy_update',
              'trg_geo_boundary_leaf_insert',
              'trg_geo_boundary_leaf_update'
            ];
            const missingTriggers = requiredTriggers.filter((trigger) => !triggers.has(trigger));
            if (missingTriggers.length) {
              return callback(new Error(`Missing required hierarchy/service constraints: ${missingTriggers.join(', ')}`));
            }
            db.all('PRAGMA table_info(order_attribution)', (columnError, columns) => {
              if (columnError) return callback(columnError);
              const actualColumns = new Set(columns.map((column) => column.name));
              const missingColumns = requiredAttributionColumns.filter((column) => !actualColumns.has(column));
              if (missingColumns.length) {
                return callback(new Error(`Missing order attribution hierarchy columns: ${missingColumns.join(', ')}`));
              }
            db.get('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations', (versionError, versionRow) => {
              if (versionError) return callback(versionError);
              if (versionRow.version !== latestSchemaVersion) {
                return callback(new Error(`Database schema version ${versionRow.version} does not match required version ${latestSchemaVersion}`));
              }

              db.get("SELECT COUNT(*) AS count FROM services WHERE id = 'SVC001' AND name = 'Mobile Recharge' AND status = 'ACTIVE'", (seedError, seedRow) => {
                if (seedError) return callback(seedError);
                if (seedRow.count !== 1) return callback(new Error('Required active Mobile Recharge service seed is missing'));

                db.get('PRAGMA foreign_keys', (foreignKeyModeError, foreignKeyMode) => {
                  if (foreignKeyModeError) return callback(foreignKeyModeError);
                  if (foreignKeyMode.foreign_keys !== 1) {
                    return callback(new Error('SQLite foreign-key enforcement is disabled on this connection'));
                  }

                  db.all('PRAGMA foreign_key_check', (foreignKeyError, foreignKeyRows) => {
                    if (foreignKeyError) return callback(foreignKeyError);
                    if (foreignKeyRows.length) {
                      return callback(new Error(`Database has ${foreignKeyRows.length} foreign-key violation(s)`));
                    }

                    db.get(
                      `SELECT COUNT(*) AS count FROM franchises f
                       WHERE f.status = 'ACTIVE' AND COALESCE(NOT (
                         (f.level = 'HQ' AND f.parent_id IS NULL) OR
                         (f.level = 'NATION' AND f.parent_id IS NULL) OR
                         (f.level = 'COMMAND' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = f.parent_id AND p.level = 'HQ' AND p.status = 'ACTIVE')) OR
                         (f.level = 'HUB' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = f.parent_id AND p.level = 'COMMAND' AND p.status = 'ACTIVE')) OR
                         (f.level = 'CENTER' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = f.parent_id AND p.level = 'HUB' AND p.status = 'ACTIVE')) OR
                         (f.level = 'POINT' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = f.parent_id AND p.level = 'CENTER' AND p.status = 'ACTIVE')) OR
                         (f.level = 'REGION' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = f.parent_id AND p.level = 'NATION' AND p.status = 'ACTIVE')) OR
                         (f.level = 'TERRITORY' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = f.parent_id AND p.level = 'REGION' AND p.status = 'ACTIVE')) OR
                         (f.level = 'ZONE' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = f.parent_id AND p.level = 'TERRITORY' AND p.status = 'ACTIVE')) OR
                         (f.level = 'NODE' AND EXISTS (SELECT 1 FROM franchises p WHERE p.id = f.parent_id AND p.level = 'ZONE' AND p.status = 'ACTIVE'))
                       ), 1)`,
                      (hierarchyError, hierarchyRow) => {
                      if (hierarchyError) return callback(hierarchyError);
                      if (hierarchyRow.count) return callback(new Error(`Database has ${hierarchyRow.count} active franchise hierarchy violation(s)`));
                    db.get('PRAGMA integrity_check', (integrityError, integrityRow) => {
                      if (integrityError) return callback(integrityError);
                      if (integrityRow.integrity_check !== 'ok') {
                        return callback(new Error(`SQLite integrity check failed: ${integrityRow.integrity_check}`));
                      }

                      const counts = {};
                      let countIndex = 0;
                      const countNext = () => {
                        if (countIndex >= expectedTables.length) {
                          return callback(null, {
                            status: 'OK',
                            schemaVersion: versionRow.version,
                            tableCount: expectedTables.length,
                            verifiedIndexes: requiredIndexes.length,
                            verifiedForeignKeys: requiredForeignKeys.length,
                            serviceReferenceConstraints: requiredTriggers.length,
                            mobileRechargeSeed: 'OK',
                            foreignKeyViolations: 0,
                            integrity: 'ok',
                            recordCounts: counts
                          });
                        }

                        const countTable = expectedTables[countIndex++];
                        db.get(`SELECT COUNT(*) AS count FROM "${countTable}"`, (countError, row) => {
                          if (countError) return callback(countError);
                          counts[countTable] = row.count;
                          countNext();
                        });
                      };
                      countNext();
                    });
                    });
                  });
                });
              });
            });
            });
            });
        };
        verifyCustomerAttributionSchema(db, (schemaError) => {
          if (schemaError) return callback(schemaError);
          verifyRechargeOrderSchema(db, (rechargeSchemaError) => {
            if (rechargeSchemaError) return callback(rechargeSchemaError);
            checkTableForeignKeys();
          });
        });
      });
    });
  });
}

if (require.main === module) {
  const databasePath = process.env.DATABASE_PATH
    ? path.resolve(__dirname, process.env.DATABASE_PATH)
    : path.join(__dirname, 'zyngram.db');
  const db = new sqlite3.Database(databasePath, (openError) => {
    if (openError) {
      console.error(`Database verification failed: ${openError.message}`);
      process.exitCode = 1;
      return;
    }
    db.configure('busyTimeout', 5000);
    db.run('PRAGMA foreign_keys = ON', (pragmaError) => {
      if (pragmaError) {
        console.error(`Database verification failed: ${pragmaError.message}`);
        process.exitCode = 1;
        return db.close();
      }
      verifyDatabase(db, (verificationError, report) => {
        if (verificationError) {
          console.error(`Database verification failed: ${verificationError.message}`);
          process.exitCode = 1;
        } else {
          console.log(JSON.stringify(report, null, 2));
        }
        db.close((closeError) => {
          if (closeError) {
            console.error(`Failed to close database after verification: ${closeError.message}`);
            process.exitCode = 1;
          }
        });
      });
    });
  });
}

module.exports = { verifyDatabase };