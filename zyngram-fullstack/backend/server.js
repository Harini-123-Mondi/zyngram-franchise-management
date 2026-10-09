require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const { createOrderId } = require('./orderId');
const { buildCustomerAttribution, validateCustomerRegistration } = require('./customerRegistration');
const {
  DIGITAL_HIERARCHY,
  PHYSICAL_HIERARCHY,
  parentLevelFor,
  parsePolygon,
  resolveFranchiseMapping,
} = require('./geoMapping');
const { createUserCodeAssignments, createUserId } = require('./generateReadableUserId');
const { latestSchemaVersion, runMigrations } = require('./databaseMigrations');
const { RECHARGE_CIRCLES, RECHARGE_OPERATORS, validateRechargeOrder } = require('./mobileRecharge');
const {
  calculateCommissions: createCommissionEntries,
  calculateCommissionsInTransaction,
  settleCommission
} = require('./commissionEngine');
const {
  canAccessFranchise,
  canCaptureLocation,
  canReadCommissionOwner,
  hasRole,
  matchesActiveAccount
} = require('./accessControl');

const DAY12_READINESS_TASKS = [
  'production-readiness-audit',
  'production-database-migration',
  'franchise-hierarchy-deployment',
  'customer-registration-geo-mapping',
  'live-service-order-flow',
  'commission-ledger-system',
  'employee-management-integration',
  'admin-franchise-dashboards',
  'production-security-testing',
  'live-deployment-demonstration'
];

const DAY12_DELIVERABLES = [
  'live-complete-system',
  'production-frontend-url',
  'production-backend-api',
  'production-database',
  'customer-registration-geo-mapping',
  'franchise-hierarchy-attribution',
  'mobile-recharge-workflow',
  'commission-wallet-ledger',
  'franchise-owner-dashboard',
  'admin-dashboard',
  'employee-management',
  'rbac',
  'reports-audit-logs',
  'security-test-report',
  'deployment-documentation',
  'github-repository'
];

function isValidCoordinate(value, minimum, maximum) {
  if (value === undefined || value === null || String(value).trim() === '') return false;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= minimum && coordinate <= maximum;
}

function resolveMappingForCoordinates(connection, latitude, longitude, callback) {
  connection.all('SELECT id, level, name, parent_id, status FROM franchises', [], (franchiseError, franchises) => {
    if (franchiseError) return callback(franchiseError);
    connection.all('SELECT id, franchise_id, geometry, version, status FROM geo_boundaries', [], (boundaryError, boundaries) => {
      if (boundaryError) return callback(boundaryError);
      try {
        callback(null, resolveFranchiseMapping(franchises, boundaries, latitude, longitude));
      } catch (error) {
        callback(error);
      }
    });
  });
}

function isValidProfilePhoto(value) {
  if (!value) return true;
  if (typeof value !== 'string' || value.length > 2 * 1024 * 1024 ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return false;
  }
  return Buffer.from(value.slice('data:image/jpeg;base64,'.length), 'base64').length <= 1.5 * 1024 * 1024;
}

function resolveEmployeeDocumentPath(storedPath) {
  if (typeof storedPath !== 'string') return null;
  const normalizedPath = storedPath.replace(/[\\/]+/g, path.sep);
  const legacyPrefix = `uploads${path.sep}employee-documents${path.sep}`;
  if (!normalizedPath.startsWith(legacyPrefix)) return null;
  const fileName = normalizedPath.slice(legacyPrefix.length);
  if (!fileName || path.basename(fileName) !== fileName) return null;
  return path.join(employeeDocumentsDirectory, fileName);
}

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'zyngram-secret-key-change-in-production';
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
let databaseReady = false;

// Middleware
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '8mb' }));
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || databaseReady) return next();
  res.status(503).json({ status: 'NOT_READY', error: 'Database initialization is in progress' });
});

// Email configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'your-email@gmail.com',
    pass: process.env.SMTP_PASS || 'your-app-password'
  }
});

// Send email function
async function sendEmail(to, subject, text) {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@zyngram.com',
      to,
      subject,
      text
    });
    return { success: true };
  } catch (error) {
    console.error('Email error:', error);
    return { success: false, error: error.message };
  }
}

// Database setup
const dbPath = process.env.DATABASE_PATH
  ? path.resolve(__dirname, process.env.DATABASE_PATH)
  : path.join(__dirname, 'zyngram.db');
const uploadsDirectory = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, 'uploads'));
const employeeDocumentsDirectory = path.join(uploadsDirectory, 'employee-documents');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    db.configure('busyTimeout', 5000);
    db.run('PRAGMA foreign_keys = ON', (pragmaError) => {
      if (pragmaError) {
        console.error('Failed to enable SQLite foreign-key enforcement:', pragmaError.message);
        process.exitCode = 1;
        return;
      }
      db.get('PRAGMA foreign_keys', (checkError, row) => {
        if (checkError || row.foreign_keys !== 1) {
          console.error('SQLite foreign-key enforcement is not enabled:', checkError?.message || 'PRAGMA returned disabled');
          process.exitCode = 1;
          return;
        }
        console.log('Connected to SQLite database with foreign-key enforcement');
        initializeDatabase();
      });
    });
  }
});

// Initialize database tables
function initializeDatabase() {
  const tables = [
    // Users table
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      user_code TEXT UNIQUE,
      name TEXT NOT NULL,
      mobile TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    
    // UserLocations table
    `CREATE TABLE IF NOT EXISTS user_locations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy REAL,
      country TEXT,
      state TEXT,
      district TEXT,
      city TEXT,
      pin TEXT,
      source TEXT,
      captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    
    // Franchises table
    `CREATE TABLE IF NOT EXISTS franchises (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      name TEXT NOT NULL,
      owner_id TEXT,
      parent_id TEXT,
      status TEXT DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (parent_id) REFERENCES franchises(id)
    )`,
    
    // GeoBoundaries table
    `CREATE TABLE IF NOT EXISTS geo_boundaries (
      id TEXT PRIMARY KEY,
      franchise_id TEXT NOT NULL,
      geometry TEXT,
      version INTEGER DEFAULT 1,
      status TEXT DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (franchise_id) REFERENCES franchises(id)
    )`,
    
    // Orders table
    `CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      service_id TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'PENDING',
      location_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES users(id),
      FOREIGN KEY (location_id) REFERENCES user_locations(id)
    )`,
    
    // OrderAttribution table
    `CREATE TABLE IF NOT EXISTS order_attribution (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      point_id TEXT,
      center_id TEXT,
      hub_id TEXT,
      command_id TEXT,
      mapping_version INTEGER,
      coordinates TEXT,
      attributed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    )`,
    
    // CommissionRules table
    `CREATE TABLE IF NOT EXISTS commission_rules (
      id TEXT PRIMARY KEY,
      service_category TEXT NOT NULL,
      level TEXT NOT NULL,
      rate REAL NOT NULL,
      rate_type TEXT DEFAULT 'PERCENTAGE',
      effective_from DATETIME,
      effective_to DATETIME,
      version INTEGER DEFAULT 1,
      status TEXT DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    
    // CommissionLedger table
    `CREATE TABLE IF NOT EXISTS commission_ledger (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      level TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      rate REAL NOT NULL,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (rule_id) REFERENCES commission_rules(id)
    )`,
    
    // Wallet/Ledger table
    `CREATE TABLE IF NOT EXISTS wallet_ledger (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      reference_id TEXT,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    )`,
    
    // AuditLogs table
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      actor TEXT NOT NULL,
      role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      result TEXT,
      metadata TEXT
    )`,
    
    // Employee Management Tables - Day 11
    
    // Departments table
    `CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    
    // Designations table
    `CREATE TABLE IF NOT EXISTS designations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      department_id TEXT,
      description TEXT,
      status TEXT DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (department_id) REFERENCES departments(id)
    )`,
    
    // Employees table
    `CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      employee_id TEXT UNIQUE NOT NULL,
      zin_id TEXT UNIQUE,
      name TEXT NOT NULL,
      profile_photo TEXT,
      mobile TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      date_of_birth DATE,
      gender TEXT,
      address TEXT,
      state TEXT,
      district TEXT,
      department_id TEXT,
      designation_id TEXT,
      employment_type TEXT,
      joining_date DATE NOT NULL,
      reporting_manager_id TEXT,
      work_location_id TEXT,
      franchise_id TEXT,
      status TEXT DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (department_id) REFERENCES departments(id),
      FOREIGN KEY (designation_id) REFERENCES designations(id),
      FOREIGN KEY (reporting_manager_id) REFERENCES employees(id),
      FOREIGN KEY (franchise_id) REFERENCES franchises(id)
    )`,
    
    // Employee Documents table
    `CREATE TABLE IF NOT EXISTS employee_documents (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      document_type TEXT NOT NULL,
      document_name TEXT,
      file_path TEXT,
      status TEXT DEFAULT 'PENDING',
      expiry_date DATE,
      uploaded_by TEXT,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    )`,
    
    // Attendance table
    `CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      date DATE NOT NULL,
      check_in_time DATETIME,
      check_out_time DATETIME,
      work_location_id TEXT,
      attendance_status TEXT,
      working_hours REAL,
      remarks TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    )`,
    
    // Leave Requests table
    `CREATE TABLE IF NOT EXISTS leave_requests (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      leave_type TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      reason TEXT,
      supporting_document TEXT,
      status TEXT DEFAULT 'PENDING',
      approved_by TEXT,
      approved_at DATETIME,
      rejection_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    )`,
    
    // Targets table
    `CREATE TABLE IF NOT EXISTS targets (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      department_id TEXT,
      designation_id TEXT,
      target_period TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_value REAL NOT NULL,
      achievement REAL DEFAULT 0,
      achievement_percentage REAL DEFAULT 0,
      status TEXT DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (department_id) REFERENCES departments(id),
      FOREIGN KEY (designation_id) REFERENCES designations(id)
    )`,
    
    // Performance Records table
    `CREATE TABLE IF NOT EXISTS performance_records (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      target_id TEXT,
      period TEXT NOT NULL,
      rating REAL,
      attendance_percentage REAL,
      remarks TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (target_id) REFERENCES targets(id)
    )`,
    
    // Work Locations table
    `CREATE TABLE IF NOT EXISTS work_locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      city TEXT,
      state TEXT,
      pin TEXT,
      status TEXT DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    
    // Employee Franchise Mapping table
    `CREATE TABLE IF NOT EXISTS employee_franchise_mapping (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      franchise_id TEXT NOT NULL,
      is_primary BOOLEAN DEFAULT TRUE,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (franchise_id) REFERENCES franchises(id)
    )`,
    
    // Notifications table
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      type TEXT,
      is_read BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`
  ];
  
  const initializationStatements = [
    ...tables,
    `CREATE TABLE IF NOT EXISTS day12_readiness (
      task_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'NOT_STARTED'
        CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETE')),
      score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 10),
      evidence TEXT NOT NULL DEFAULT '',
      updated_by TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS day12_deliverables (
      deliverable_id TEXT PRIMARY KEY,
      verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
      evidence TEXT NOT NULL DEFAULT '',
      updated_by TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  ];
  let tableIndex = 0;
  const createNextTable = () => {
    if (tableIndex >= initializationStatements.length) {
      return runMigrations(db, (migrationError, version) => {
        if (migrationError) {
          console.error('Database migration failed:', migrationError.message);
          process.exitCode = 1;
          return;
        }

        DAY12_READINESS_TASKS.forEach((taskId) => {
          db.run('INSERT OR IGNORE INTO day12_readiness (task_id) VALUES (?)', [taskId], (seedError) => {
            if (seedError) console.error(`Failed to initialize Day 12 readiness task ${taskId}:`, seedError.message);
          });
        });
        DAY12_DELIVERABLES.forEach((deliverableId) => {
          db.run('INSERT OR IGNORE INTO day12_deliverables (deliverable_id) VALUES (?)', [deliverableId], (seedError) => {
            if (seedError) console.error(`Failed to initialize Day 12 deliverable ${deliverableId}:`, seedError.message);
          });
        });

        initializeAdministrator(() => {
          databaseReady = true;
          console.log(`Database schema is ready at version ${version}`);
        });
      });
    }

    db.run(initializationStatements[tableIndex], (tableError) => {
      if (tableError) {
        console.error(`Failed to create database table ${tableIndex + 1}:`, tableError.message);
        process.exitCode = 1;
        return;
      }
      tableIndex += 1;
      createNextTable();
    });
  };
  createNextTable();

  function initializeAdministrator(onReady) {
    const adminId = 'ADM001';
    const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ||
      (process.env.NODE_ENV === 'production' ? null : 'admin123');
    const hashedPassword = bootstrapPassword ? bcrypt.hashSync(bootstrapPassword, 10) : null;

    if (!hashedPassword) {
      console.error('BOOTSTRAP_ADMIN_PASSWORD is required to initialize the production administrator');
      process.exitCode = 1;
      return;
    }

    const failInitialization = (message, error) => {
      console.error(message, error.message);
      process.exitCode = 1;
    };

    const migrateUserCodes = () => {
      db.all('PRAGMA table_info(users)', [], (schemaError, columns) => {
        if (schemaError) {
          failInitialization('Failed to inspect users schema:', schemaError);
          return;
        }
        const populateCodes = () => {
          db.all('SELECT id, user_code FROM users ORDER BY created_at, id', [], (usersError, users) => {
            if (usersError) {
              failInitialization('Failed to load users for ID migration:', usersError);
              return;
            }
            for (const { id, userCode } of createUserCodeAssignments(users)) {
              db.run('UPDATE users SET user_code = ? WHERE id = ? AND user_code IS NULL', [userCode, id], (updateError) => {
                if (updateError) console.error(`Failed to assign readable ID to user ${id}:`, updateError.message);
              });
            }
            onReady();
          });
        };

        if (columns.some((column) => column.name === 'user_code')) {
          return populateCodes();
        }
        db.run('ALTER TABLE users ADD COLUMN user_code TEXT', (migrationError) => {
          if (migrationError) {
            failInitialization('Failed to add readable user ID column:', migrationError);
            return;
          }
          db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_code ON users(user_code)', (indexError) => {
            if (indexError) {
              failInitialization('Failed to index readable user IDs:', indexError);
              return;
            }
            populateCodes();
          });
        });
      });
    };

    db.get('SELECT id FROM users WHERE id = ?', [adminId], (lookupError, row) => {
      if (lookupError) {
        failInitialization('Failed to look up the bootstrap administrator:', lookupError);
        return;
      }
      if (row) {
        if (process.env.RESET_BOOTSTRAP_ADMIN_PASSWORD !== 'true') return migrateUserCodes();
        return db.run(
          'UPDATE users SET password = ? WHERE id = ?',
          [hashedPassword, adminId],
          (resetError) => {
            if (resetError) {
              failInitialization('Failed to reset the bootstrap administrator password:', resetError);
              return;
            }
            console.log('Bootstrap administrator password reset from environment');
            migrateUserCodes();
          }
        );
      }

      db.run(
        `INSERT INTO users (id, name, mobile, email, password, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [adminId, 'HQ Administrator', '+919999999999', 'admin@zyngram.com', hashedPassword, 'HQ_ADMIN', 'ACTIVE'],
        (insertError) => {
          if (insertError) {
            failInitialization('Error inserting admin:', insertError);
            return;
          }
          console.log('Default admin user created');
          migrateUserCodes();
        }
      );
    });
  }
}

// Audit logging function
function logAudit(actor, role, action, entity, entityId, result, metadata) {
  const logId = uuidv4();
  db.run(
    `INSERT INTO audit_logs (id, actor, role, action, entity, entity_id, result, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [logId, actor, role, action, entity, entityId, result, JSON.stringify(metadata)],
    (err) => {
      if (err) console.error('Audit log error:', err.message);
    }
  );
}

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    db.get('SELECT id, role, status FROM users WHERE id = ?', [user.id], (userError, currentUser) => {
      if (userError) {
        console.error('Authenticated account lookup failed:', userError.message);
        return res.status(503).json({ error: 'Authentication is temporarily unavailable' });
      }
      if (!matchesActiveAccount(user, currentUser)) {
        return res.status(401).json({ error: 'Account is inactive or authorization has changed' });
      }
      req.user = { ...user, role: currentUser.role };
      if (currentUser.role !== 'FRANCHISE_OWNER') return next();

      db.all(
        "SELECT id FROM franchises WHERE owner_id = ? AND status = 'ACTIVE' ORDER BY id",
        [currentUser.id],
        (scopeError, franchises) => {
          if (scopeError) {
            console.error('Franchise owner scope lookup failed:', scopeError.message);
            return res.status(503).json({ error: 'Authorization scope is temporarily unavailable' });
          }
          req.user.franchiseIds = franchises.map((franchise) => franchise.id);
          req.user.franchiseId = req.user.franchiseIds[0] || null;
          next();
        }
      );
    });
  });
}

// Middleware to check role-based access
function checkRole(allowedRoles) {
  return (req, res, next) => {
    if (!hasRole(req.user, allowedRoles)) {
      logAudit(req.user.id, req.user.role, 'UNAUTHORIZED_ACCESS', null, null, 'FAILED', { endpoint: req.path });
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function getFranchiseScopeFilter(user, column) {
  if (user.role === 'HQ_ADMIN') return { clause: '1=1', params: [] };
  const franchiseIds = user.role === 'FRANCHISE_OWNER' ? user.franchiseIds : [];
  if (!franchiseIds?.length) return null;
  return {
    clause: `${column} IN (${franchiseIds.map(() => '?').join(', ')})`,
    params: franchiseIds
  };
}

function getAttributionScopeFilter(user, alias) {
  const franchiseIds = user.role === 'FRANCHISE_OWNER' ? user.franchiseIds : [];
  if (!franchiseIds?.length) return null;
  const columns = [
    'point_id', 'center_id', 'hub_id', 'command_id', 'hq_id',
    'node_id', 'zone_id', 'territory_id', 'region_id', 'nation_id'
  ];
  const placeholders = franchiseIds.map(() => '?').join(', ');
  return {
    clause: `(${columns.map((column) => `${alias}.${column} IN (${placeholders})`).join(' OR ')})`,
    params: columns.flatMap(() => franchiseIds)
  };
}

// API Routes

// Auth routes
app.post('/api/auth/register/customer', (req, res) => {
  const registration = {
    name: req.body?.name,
    email: req.body?.email,
    mobile: req.body?.mobile,
    password: req.body?.password,
    latitude: req.body?.latitude,
    longitude: req.body?.longitude,
    accuracy: req.body?.accuracy,
    locationConsent: req.body?.locationConsent
  };
  const validationError = validateCustomerRegistration(registration);
  if (validationError) return res.status(400).json({ error: validationError });

  const name = registration.name.trim();
  const email = registration.email.trim().toLowerCase();
  const mobile = registration.mobile.replace(/[\s()-]/g, '');
  const latitude = Number(registration.latitude);
  const longitude = Number(registration.longitude);
  const accuracy = registration.accuracy == null ? null : Number(registration.accuracy);
  const passwordHash = bcrypt.hashSync(registration.password, 10);
  const locationId = uuidv4();
  const attributionId = uuidv4();
  const registrationDb = new sqlite3.Database(dbPath, (connectionError) => {
    if (connectionError) {
      console.error('Customer registration database connection failed:', connectionError.message);
      return res.status(500).json({ error: 'Customer registration is temporarily unavailable' });
    }
    registrationDb.configure('busyTimeout', 5000);
    registrationDb.run('PRAGMA foreign_keys = ON', (pragmaError) => {
      if (pragmaError) {
        console.error('Customer registration could not enable foreign keys:', pragmaError.message);
        return registrationDb.close(() => res.status(500).json({ error: 'Customer registration is temporarily unavailable' }));
      }
      registrationDb.run('BEGIN IMMEDIATE', (beginError) => {
        if (beginError) {
          console.error('Customer registration transaction could not start:', beginError.message);
          return registrationDb.close(() => res.status(500).json({ error: 'Customer registration is temporarily unavailable' }));
        }
        let transactionOpen = true;
        const rollback = (status, message, error) => {
          if (error) console.error('Customer registration failed:', error.message);
          const finish = () => registrationDb.close((closeError) => {
            if (closeError) console.error('Customer registration connection close failed:', closeError.message);
            if (!res.headersSent) res.status(status).json({ error: message });
          });
          if (!transactionOpen) return finish();
          registrationDb.run('ROLLBACK', (rollbackError) => {
            transactionOpen = false;
            if (rollbackError) console.error('Customer registration rollback failed:', rollbackError.message);
            finish();
          });
        };

        resolveMappingForCoordinates(registrationDb, latitude, longitude, (mappingError, mapping) => {
          if (mappingError) {
            return rollback(500, 'Could not map the submitted GPS location against saved franchise boundaries', mappingError);
          }
          let attribution;
          try {
            attribution = buildCustomerAttribution(mapping);
          } catch (error) {
            return rollback(500, 'Could not create a valid customer attribution snapshot', error);
          }
          registrationDb.all('SELECT id, user_code FROM users', [], (usersError, users) => {
            if (usersError) return rollback(500, 'Could not create the customer account', usersError);
            const userId = createUserId(users.flatMap((userRow) => [userRow.id, userRow.user_code]));
            const userCode = userId;
            const customerStatements = [
              {
                sql: `INSERT INTO users (id, user_code, name, mobile, email, password, role, status)
                      VALUES (?, ?, ?, ?, ?, ?, 'CUSTOMER', 'ACTIVE')`,
                params: [userId, userCode, name, mobile, email, passwordHash]
              },
              {
                sql: `INSERT INTO customers (id, user_id, name, mobile, email, status)
                      VALUES (?, ?, ?, ?, ?, 'ACTIVE')`,
                params: [userId, userId, name, mobile, email]
              },
              {
                sql: `INSERT INTO user_locations
                      (id, user_id, latitude, longitude, accuracy, source)
                      VALUES (?, ?, ?, ?, ?, 'CUSTOMER_REGISTRATION_GPS')`,
                params: [locationId, userId, latitude, longitude, accuracy]
              },
              {
                sql: `INSERT INTO customer_attributions (
                        id, customer_id, location_id, status, coordinates,
                        point_id, center_id, hub_id, command_id, hq_id,
                        physical_boundary_id, physical_mapping_version,
                        node_id, zone_id, territory_id, region_id, nation_id,
                        digital_boundary_id, digital_mapping_version,
                        physical_result, digital_result
                      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                params: [
                  attributionId, userId, locationId, attribution.status,
                  JSON.stringify({ latitude, longitude }),
                  attribution.point_id, attribution.center_id, attribution.hub_id,
                  attribution.command_id, attribution.hq_id,
                  attribution.physical_boundary_id, attribution.physical_mapping_version,
                  attribution.node_id, attribution.zone_id, attribution.territory_id,
                  attribution.region_id, attribution.nation_id,
                  attribution.digital_boundary_id, attribution.digital_mapping_version,
                  attribution.physical_result, attribution.digital_result
                ]
              }
            ];
            const insertNext = (index) => {
              if (index === customerStatements.length) {
                return registrationDb.run('COMMIT', (commitError) => {
                  if (commitError) return rollback(500, 'Customer registration could not be committed', commitError);
                  transactionOpen = false;
                  registrationDb.close((closeError) => {
                    if (closeError) {
                      console.error('Customer registration connection close failed:', closeError.message);
                      return res.status(500).json({ error: 'Registration was saved; sign in with your new account to continue' });
                    }
                    const token = jwt.sign(
                      { id: userId, email, role: 'CUSTOMER' },
                      JWT_SECRET,
                      { expiresIn: '24h' }
                    );
                    logAudit(userId, 'CUSTOMER', 'CUSTOMER_REGISTER', userId, null, 'SUCCESS', {
                      locationId,
                      attributionId,
                      mappingStatus: attribution.status
                    });
                    res.status(201).json({
                      token,
                      user: { id: userId, name, email, role: 'CUSTOMER' },
                      customer: { id: userId, status: 'ACTIVE' },
                      location: { id: locationId, latitude, longitude, accuracy },
                      attribution: {
                        id: attributionId,
                        status: attribution.status,
                        physical: mapping.physical,
                        digital: mapping.digital
                      },
                      message: attribution.status === 'MAPPED'
                        ? 'Customer registered and mapped to active franchise boundaries.'
                        : 'Customer registered, but this GPS location is UNMAPPED. No franchise was assigned.'
                    });
                  });
                });
              }
              const statement = customerStatements[index];
              registrationDb.run(statement.sql, statement.params, (insertError) => {
                if (insertError) {
                  const isDuplicate = insertError.code === 'SQLITE_CONSTRAINT';
                  return rollback(
                    isDuplicate ? 409 : 500,
                    isDuplicate
                      ? 'An account with this email or mobile number already exists.'
                      : 'Could not save the customer registration and attribution snapshot.',
                    insertError
                  );
                }
                insertNext(index + 1);
              });
            };
            insertNext(0);
          });
        });
      });
    });
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  
  db.get('SELECT * FROM users WHERE lower(email) = ?', [normalizedEmail], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!user) {
      logAudit('', '', 'LOGIN_ATTEMPT', email, null, 'FAILED', { reason: 'User not found' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const validPassword = bcrypt.compareSync(password, user.password);
    if (!validPassword) {
      logAudit(user.id, user.role, 'LOGIN_ATTEMPT', email, null, 'FAILED', { reason: 'Invalid password' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    if (user.status !== 'ACTIVE') {
      logAudit(user.id, user.role, 'LOGIN_ATTEMPT', email, null, 'FAILED', { reason: 'Account inactive' });
      return res.status(401).json({ error: 'Account is inactive' });
    }
    
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    logAudit(user.id, user.role, 'LOGIN', user.id, null, 'SUCCESS', null);
    
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  });
});

app.post('/api/auth/logout', authenticateToken, (req, res) => {
  logAudit(req.user.id, req.user.role, 'LOGOUT', req.user.id, null, 'SUCCESS', null);
  res.json({ message: 'Logged out successfully' });
});

app.get('/api/me', authenticateToken, (req, res) => {
  db.get('SELECT id, name, email, role, status FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err || !user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  });
});

app.get('/api/chat/messages', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  db.all(
    `SELECT m.id, m.message, m.created_at, u.id AS sender_id, u.name AS sender_name, u.role AS sender_role
     FROM chat_messages m
     JOIN users u ON u.id = m.sender_id
     ORDER BY m.created_at DESC, m.rowid DESC
     LIMIT 100`,
    [],
    (err, messages) => {
      if (err) {
        console.error('Zynpi messages lookup failed:', err.message);
        return res.status(500).json({ error: 'Failed to load Zynpi messages' });
      }
      res.json(messages.reverse());
    }
  );
});

app.post('/api/chat/messages', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message || message.length > 2000) {
    return res.status(400).json({ error: 'Message must contain 1 to 2000 characters' });
  }

  const messageId = uuidv4();
  db.run(
    'INSERT INTO chat_messages (id, sender_id, message) VALUES (?, ?, ?)',
    [messageId, req.user.id, message],
    function (err) {
      if (err) {
        console.error('Zynpi message save failed:', err.message);
        return res.status(500).json({ error: 'Failed to send message' });
      }
      logAudit(req.user.id, req.user.role, 'CHAT_MESSAGE_CREATE', 'ZYNPI', messageId, 'SUCCESS', null);
      db.get(
        `SELECT m.id, m.message, m.created_at, u.id AS sender_id, u.name AS sender_name, u.role AS sender_role
         FROM chat_messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.id = ?`,
        [messageId],
        (lookupError, savedMessage) => {
          if (lookupError || !savedMessage) {
            console.error('Zynpi saved message lookup failed:', lookupError?.message || 'Message not found');
            return res.status(500).json({ error: 'Message was saved but could not be loaded' });
          }
          res.status(201).json(savedMessage);
        }
      );
    }
  );
});

app.get('/api/chat/assistant/messages', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  db.all(
    `SELECT id, role, message, created_at
     FROM assistant_messages
     WHERE user_id = ?
     ORDER BY created_at DESC, rowid DESC
     LIMIT 60`,
    [req.user.id],
    (err, messages) => {
      if (err) {
        console.error('Zynpi assistant history lookup failed:', err.message);
        return res.status(500).json({ error: 'Failed to load your assistant conversation' });
      }
      res.json(messages.reverse());
    }
  );
});

app.post('/api/chat/assistant/messages', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), async (req, res) => {
  const prompt = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!prompt || prompt.length > 2000) {
    return res.status(400).json({ error: 'Message must contain 1 to 2000 characters' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'AI assistant is not configured. Add OPENAI_API_KEY to the backend .env file and restart the backend.' });
  }

  db.all(
    `SELECT role, message FROM assistant_messages
     WHERE user_id = ?
     ORDER BY created_at DESC, rowid DESC
     LIMIT 12`,
    [req.user.id],
    async (historyError, recentRows) => {
      if (historyError) {
        console.error('Zynpi assistant context lookup failed:', historyError.message);
        return res.status(500).json({ error: 'Could not prepare your assistant conversation' });
      }

      const context = recentRows.reverse().map((row) => ({
        role: row.role,
        content: row.message
      }));
      context.push({ role: 'user', content: prompt });

      let assistantReply;
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'You are Zynpi, a concise assistant for the Zyngram franchise management app. Help with app navigation, franchise operations, customer registration and mapping, mobile recharge orders, commissions, employees, attendance, leave, targets, and reports. Do not claim you can perform actions or access private account data; guide the user to the appropriate dashboard feature instead.'
              },
              ...context
            ],
            max_tokens: 500
          }),
          signal: AbortSignal.timeout(45000)
        });
        const result = await response.json();
        if (!response.ok) {
          console.error('OpenAI assistant request failed with status:', response.status);
          if (response.status === 401 || response.status === 403) {
            return res.status(502).json({ error: 'OpenAI rejected the configured API key. Check OPENAI_API_KEY in the backend environment.' });
          }
          if (response.status === 429) {
            return res.status(503).json({ error: 'OpenAI rate limit or quota reached. Check your OpenAI billing and try again.' });
          }
          return res.status(502).json({ error: 'The AI assistant provider could not answer right now. Try again shortly.' });
        }
        assistantReply = result.choices?.[0]?.message?.content?.trim();
        if (!assistantReply) {
          console.error('OpenAI assistant returned an empty response');
          return res.status(502).json({ error: 'The AI assistant returned an empty answer. Please try again.' });
        }
      } catch (providerError) {
        console.error('OpenAI assistant request failed:', providerError.name === 'TimeoutError' ? 'request timed out' : providerError.message);
        return res.status(502).json({
          error: providerError.name === 'TimeoutError'
            ? 'The AI assistant took too long to respond. Try again.'
            : 'Could not connect to the AI assistant provider. Check the backend network and try again.'
        });
      }

      const userMessageId = uuidv4();
      const assistantMessageId = uuidv4();
      db.serialize(() => {
        db.run('BEGIN IMMEDIATE', (beginError) => {
          if (beginError) {
            console.error('Zynpi assistant save transaction failed:', beginError.message);
            return res.status(500).json({ error: 'Could not save the assistant conversation' });
          }
          db.run(
            'INSERT INTO assistant_messages (id, user_id, role, message) VALUES (?, ?, ?, ?)',
            [userMessageId, req.user.id, 'user', prompt],
            (userInsertError) => {
              if (userInsertError) return rollbackAssistantMessages(userInsertError);
              db.run(
                'INSERT INTO assistant_messages (id, user_id, role, message) VALUES (?, ?, ?, ?)',
                [assistantMessageId, req.user.id, 'assistant', assistantReply],
                (assistantInsertError) => {
                  if (assistantInsertError) return rollbackAssistantMessages(assistantInsertError);
                  db.run('COMMIT', (commitError) => {
                    if (commitError) return rollbackAssistantMessages(commitError);
                    logAudit(req.user.id, req.user.role, 'AI_ASSISTANT_MESSAGE', 'ZYNPI', assistantMessageId, 'SUCCESS', null);
                    res.status(201).json({
                      messages: [
                        { id: userMessageId, role: 'user', message: prompt },
                        { id: assistantMessageId, role: 'assistant', message: assistantReply }
                      ]
                    });
                  });
                }
              );
            }
          );
        });
      });

      function rollbackAssistantMessages(error) {
        console.error('Zynpi assistant messages could not be saved:', error.message);
        db.run('ROLLBACK', () => res.status(500).json({ error: 'Could not save the assistant response. Please try again.' }));
      }
    }
  );
});

app.get('/api/customers/me/attribution', authenticateToken, checkRole(['CUSTOMER']), (req, res) => {
  db.get(
    `SELECT a.status, a.physical_result, a.digital_result, a.coordinates, a.location_id
     FROM customer_attributions a
     JOIN customers c ON c.id = a.customer_id
     WHERE c.user_id = ?
     ORDER BY a.rowid DESC
     LIMIT 1`,
    [req.user.id],
    (err, attribution) => {
      if (err) return res.status(500).json({ error: 'Failed to load customer location attribution' });
      if (!attribution) return res.status(404).json({ error: 'No saved customer location attribution was found' });
      try {
        res.json({
          status: attribution.status,
          physical: JSON.parse(attribution.physical_result),
          digital: JSON.parse(attribution.digital_result),
          location: {
            id: attribution.location_id,
            ...JSON.parse(attribution.coordinates)
          }
        });
      } catch (parseError) {
        console.error('Customer attribution snapshot could not be read:', parseError.message);
        res.status(500).json({ error: 'Saved customer attribution data is invalid' });
      }
    }
  );
});

app.post('/api/customers/me/location', authenticateToken, checkRole(['CUSTOMER']), (req, res) => {
  const { latitude, longitude, accuracy, locationConsent } = req.body;
  if (locationConsent !== true) {
    return res.status(400).json({ error: 'Location consent is required before refreshing your location.' });
  }
  if (!isValidCoordinate(latitude, -90, 90) || !isValidCoordinate(longitude, -180, 180) ||
      (accuracy !== undefined && accuracy !== null &&
       (String(accuracy).trim() === '' || !Number.isFinite(Number(accuracy)) ||
        Number(accuracy) < 0 || Number(accuracy) > 100000))) {
    return res.status(400).json({ error: 'Valid GPS coordinates and accuracy are required.' });
  }

  const locationId = uuidv4();
  const attributionId = uuidv4();
  const locationDb = new sqlite3.Database(dbPath, (connectionError) => {
    if (connectionError) {
      console.error('Customer location refresh database connection failed:', connectionError.message);
      return res.status(500).json({ error: 'Location refresh is temporarily unavailable.' });
    }
    locationDb.configure('busyTimeout', 5000);
    locationDb.run('PRAGMA foreign_keys = ON', (pragmaError) => {
      if (pragmaError) {
        console.error('Customer location refresh could not enable foreign keys:', pragmaError.message);
        return locationDb.close(() => res.status(500).json({ error: 'Location refresh is temporarily unavailable.' }));
      }
      locationDb.run('BEGIN IMMEDIATE', (beginError) => {
        if (beginError) {
          console.error('Customer location refresh transaction could not start:', beginError.message);
          return locationDb.close(() => res.status(500).json({ error: 'Location refresh is temporarily unavailable.' }));
        }

        const rollback = (status, message, error) => {
          if (error) console.error('Customer location refresh failed:', error.message);
          locationDb.run('ROLLBACK', (rollbackError) => {
            if (rollbackError) console.error('Customer location refresh rollback failed:', rollbackError.message);
            locationDb.close((closeError) => {
              if (closeError) console.error('Customer location refresh connection close failed:', closeError.message);
              if (!res.headersSent) res.status(status).json({ error: message });
            });
          });
        };

        locationDb.get('SELECT id FROM customers WHERE user_id = ?', [req.user.id], (customerError, customer) => {
          if (customerError) return rollback(500, 'Could not validate the customer account.', customerError);
          if (!customer) return rollback(404, 'Customer account was not found.', null);

          resolveMappingForCoordinates(locationDb, Number(latitude), Number(longitude), (mappingError, mapping) => {
            if (mappingError) {
              return rollback(500, 'Could not map your GPS location against approved franchise boundaries.', mappingError);
            }
            let attribution;
            try {
              attribution = buildCustomerAttribution(mapping);
            } catch (error) {
              return rollback(500, 'Could not create a valid location attribution snapshot.', error);
            }

            const attributionParams = [
              attributionId, req.user.id, locationId, attribution.status,
              JSON.stringify({ latitude: Number(latitude), longitude: Number(longitude) }),
              attribution.point_id, attribution.center_id, attribution.hub_id,
              attribution.command_id, attribution.hq_id,
              attribution.physical_boundary_id, attribution.physical_mapping_version,
              attribution.node_id, attribution.zone_id, attribution.territory_id,
              attribution.region_id, attribution.nation_id,
              attribution.digital_boundary_id, attribution.digital_mapping_version,
              attribution.physical_result, attribution.digital_result
            ];

            locationDb.run(
              `INSERT INTO user_locations (id, user_id, latitude, longitude, accuracy, source)
               VALUES (?, ?, ?, ?, ?, 'CUSTOMER_LOCATION_REFRESH')`,
              [locationId, req.user.id, Number(latitude), Number(longitude), accuracy == null ? null : Number(accuracy)],
              (locationError) => {
                if (locationError) return rollback(500, 'Could not save your GPS location.', locationError);
                locationDb.run(
                  `INSERT INTO customer_attributions (
                    id, customer_id, location_id, status, coordinates,
                    point_id, center_id, hub_id, command_id, hq_id,
                    physical_boundary_id, physical_mapping_version,
                    node_id, zone_id, territory_id, region_id, nation_id,
                    digital_boundary_id, digital_mapping_version,
                    physical_result, digital_result
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  attributionParams,
                  (attributionError) => {
                    if (attributionError) return rollback(500, 'Could not save your franchise mapping snapshot.', attributionError);
                    locationDb.run('COMMIT', (commitError) => {
                      if (commitError) return rollback(500, 'Your location update could not be committed.', commitError);
                      locationDb.close((closeError) => {
                        if (closeError) console.error('Customer location refresh connection close failed:', closeError.message);
                        logAudit(req.user.id, 'CUSTOMER', 'CUSTOMER_LOCATION_REFRESH', locationId, null, 'SUCCESS', {
                          attributionId,
                          mappingStatus: attribution.status
                        });
                        res.json({
                          status: attribution.status,
                          location: { id: locationId, latitude: Number(latitude), longitude: Number(longitude) },
                          attribution: {
                            status: attribution.status,
                            physical: mapping.physical,
                            digital: mapping.digital
                          },
                          message: attribution.status === 'MAPPED'
                            ? 'Location refreshed and mapped to active franchise boundaries.'
                            : 'Location refreshed, but no approved franchise boundary matched. No franchise was assigned.'
                        });
                      });
                    });
                  }
                );
              }
            );
          });
        });
      });
    });
  });
});

// Location routes
app.post('/api/locations/capture', authenticateToken, (req, res) => {
  const { userId, latitude, longitude, accuracy, country, state, district, city, pin, source } = req.body;

  if (!userId || !isValidCoordinate(latitude, -90, 90) || !isValidCoordinate(longitude, -180, 180)) {
    return res.status(400).json({ error: 'A valid user ID, latitude, and longitude are required' });
  }
  if (!canCaptureLocation(req.user, userId)) {
    logAudit(req.user.id, req.user.role, 'LOCATION_CAPTURE_UNAUTHORIZED', userId, null, 'FAILED', {});
    return res.status(403).json({ error: 'You can only save a location for your own account' });
  }

  db.get('SELECT id FROM users WHERE id = ?', [userId], (userError, user) => {
    if (userError) return res.status(500).json({ error: 'Failed to validate location owner' });
    if (!user) return res.status(400).json({ error: 'Select an existing user before saving this location' });

  const locationId = uuidv4();
  db.run(
    `INSERT INTO user_locations (id, user_id, latitude, longitude, accuracy, country, state, district, city, pin, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [locationId, userId, Number(latitude), Number(longitude), accuracy || null, country || null, state || null, district || null, city || null, pin || null, source || null],
    (err) => {
      if (err) {
        console.error('Location capture failed:', err.message);
        return res.status(500).json({ error: 'Failed to save location' });
      }
      logAudit(req.user.id, req.user.role, 'LOCATION_CAPTURE', locationId, null, 'SUCCESS', { latitude, longitude });
      res.json({ id: locationId, message: 'Location captured successfully' });
    }
  );
  });
});

app.post('/api/geo/reverse-geocode', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { latitude, longitude } = req.body;
  if (!isValidCoordinate(latitude, -90, 90) || !isValidCoordinate(longitude, -180, 180)) {
    return res.status(400).json({ error: 'Valid latitude and longitude are required' });
  }
  res.json({
    configured: false,
    country: null,
    state: null,
    district: null,
    city: null,
    pin: null,
    message: 'Address lookup is not configured. Coordinates are mapped only against saved franchise boundaries.',
  });
});

app.get('/api/geo/franchise-map', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  if (!isValidCoordinate(req.query.latitude, -90, 90) || !isValidCoordinate(req.query.longitude, -180, 180)) {
    return res.status(400).json({ error: 'Valid latitude and longitude are required' });
  }
  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);
  resolveMappingForCoordinates(db, latitude, longitude, (mappingError, mapping) => {
    if (mappingError) {
      console.error('Franchise mapping failed:', mappingError.message);
      return res.status(500).json({ error: 'A saved franchise boundary is invalid or could not be loaded.' });
    }
    res.json(mapping);
  });
});

app.get('/api/geo/boundaries', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  db.all(
    `SELECT b.id, b.franchise_id, b.geometry, b.version, b.status, f.name AS franchise_name
     FROM geo_boundaries b JOIN franchises f ON f.id = b.franchise_id
     ORDER BY f.name, b.version DESC`,
    [],
    (err, boundaries) => {
      if (err) return res.status(500).json({ error: 'Failed to load franchise boundaries' });
      res.json(boundaries);
    }
  );
});

app.post('/api/geo/boundaries', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { franchise_id, geometry } = req.body;
  let polygon;
  try {
    polygon = parsePolygon(geometry);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  if (!franchise_id) return res.status(400).json({ error: 'Select a Point franchise for this boundary' });
  db.get("SELECT id, level FROM franchises WHERE id = ? AND level IN ('POINT', 'NODE') AND status = 'ACTIVE'", [franchise_id], (franchiseError, franchise) => {
    if (franchiseError) return res.status(500).json({ error: 'Failed to validate boundary franchise' });
    if (!franchise) return res.status(400).json({ error: 'The selected franchise must be an active Point or Node' });
    const id = uuidv4();
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE', (beginError) => {
        if (beginError) return res.status(500).json({ error: 'Could not start boundary update' });
        db.get('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM geo_boundaries WHERE franchise_id = ?', [franchise_id], (versionError, row) => {
          if (versionError) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: 'Failed to create boundary version' });
          }
          db.run('UPDATE geo_boundaries SET status = ? WHERE franchise_id = ? AND status = ?', ['INACTIVE', franchise_id, 'ACTIVE'], (updateError) => {
            if (updateError) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Failed to update existing boundary' });
            }
            db.run(
              'INSERT INTO geo_boundaries (id, franchise_id, geometry, version, status) VALUES (?, ?, ?, ?, ?)',
              [id, franchise_id, JSON.stringify(polygon), row.version, 'ACTIVE'],
              (insertError) => {
                if (insertError) {
                  db.run('ROLLBACK');
                  console.error('Franchise boundary save failed:', insertError.message);
                  return res.status(500).json({ error: 'Failed to save franchise boundary' });
                }
                db.run('COMMIT', (commitError) => {
                  if (commitError) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Failed to commit franchise boundary' });
                  }
                  logAudit(req.user.id, req.user.role, 'GEO_BOUNDARY_CREATE', id, null, 'SUCCESS', { franchise_id, version: row.version });
                  res.json({ id, franchise_id, version: row.version, message: 'Franchise boundary saved successfully' });
                });
              });
            }
          );
        });
      });
    });
  });
});

app.post('/api/geo/demo-boundary', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const demoFranchises = [
    ['DEMO-HQ', 'HQ', 'Demo Headquarters', null],
    ['DEMO-CMD', 'COMMAND', 'Demo Telangana Command', 'DEMO-HQ'],
    ['DEMO-HUB', 'HUB', 'Demo Hyderabad Hub', 'DEMO-CMD'],
    ['DEMO-CTR', 'CENTER', 'Demo Hyderabad Center', 'DEMO-HUB'],
    ['DEMO-PNT', 'POINT', 'Demo Madhapur Point', 'DEMO-CTR'],
    ['DEMO-NAT', 'NATION', 'Demo Nation', null],
    ['DEMO-REG', 'REGION', 'Demo South Region', 'DEMO-NAT'],
    ['DEMO-TER', 'TERRITORY', 'Demo Telangana Territory', 'DEMO-REG'],
    ['DEMO-ZON', 'ZONE', 'Demo Hyderabad Zone', 'DEMO-TER'],
    ['DEMO-NOD', 'NODE', 'Demo Madhapur Node', 'DEMO-ZON'],
  ];
  const geometry = {
    type: 'Polygon',
    coordinates: [[[78.50, 17.43], [78.54, 17.43], [78.54, 17.47], [78.50, 17.47], [78.50, 17.43]]],
  };
  const createBoundary = () => {
    const leaves = ['DEMO-PNT', 'DEMO-NOD'];
    const saveNextBoundary = (index, versions) => {
      if (index >= leaves.length) {
        return db.run('COMMIT', (commitError) => {
          if (commitError) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: 'Failed to save demo franchise boundaries' });
          }
          logAudit(req.user.id, req.user.role, 'GEO_DEMO_BOUNDARY_CREATE', 'DEMO-PNT', null, 'SUCCESS', {
            physicalVersion: versions[0],
            digitalVersion: versions[1],
          });
          res.json({
            message: 'Demo physical and digital franchise hierarchies and Hyderabad boundaries are ready. The sample polygon is for testing, not real coverage.',
            versions: { physical: versions[0], digital: versions[1] },
          });
        });
      }
      const franchiseId = leaves[index];
      db.get('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM geo_boundaries WHERE franchise_id = ?', [franchiseId], (versionError, row) => {
        if (versionError) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Failed to prepare demo boundary versions' });
        }
        db.run(
          'UPDATE geo_boundaries SET status = ? WHERE franchise_id = ? AND status = ?',
          ['INACTIVE', franchiseId, 'ACTIVE'],
          (updateError) => {
            if (updateError) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Failed to replace existing demo boundaries' });
            }
            db.run(
              'INSERT INTO geo_boundaries (id, franchise_id, geometry, version, status) VALUES (?, ?, ?, ?, ?)',
              [uuidv4(), franchiseId, JSON.stringify(geometry), row.version, 'ACTIVE'],
              (insertError) => {
                if (insertError) {
                  db.run('ROLLBACK');
                  console.error('Demo boundary setup failed:', insertError.message);
                  return res.status(500).json({ error: 'Failed to create demo boundary' });
                }
                saveNextBoundary(index + 1, [...versions, row.version]);
              }
            );
          }
        );
      });
    };
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE', (beginError) => {
        if (beginError) return res.status(500).json({ error: 'Could not start demo boundary setup' });
        saveNextBoundary(0, []);
      });
    });
  };
  const insertDemoFranchise = (index) => {
    if (index === demoFranchises.length) return createBoundary();
    const [id, level, name, parent_id] = demoFranchises[index];
    db.run(
      `INSERT INTO franchises (id, level, name, parent_id) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET level = excluded.level, name = excluded.name, parent_id = excluded.parent_id, status = 'ACTIVE'`,
      [id, level, name, parent_id],
      (err) => {
        if (err) {
          console.error('Demo franchise setup failed:', err.message);
          return res.status(500).json({ error: 'Failed to create demo franchise hierarchy' });
        }
        insertDemoFranchise(index + 1);
      }
    );
  };
  insertDemoFranchise(0);
});

app.post('/api/geo/demo-customer-coverage', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { customerId } = req.body;
  if (typeof customerId !== 'string' || !customerId.trim()) {
    return res.status(400).json({ error: 'Customer ID is required to create demo-only coverage.' });
  }

  db.get(
    `SELECT c.id AS customerId, c.status AS customerStatus, u.status AS userStatus,
            l.id AS locationId, l.latitude, l.longitude
     FROM customers c
     JOIN users u ON u.id = c.user_id
     JOIN user_locations l ON l.user_id = c.user_id
     WHERE c.user_id = ?
     ORDER BY l.rowid DESC
     LIMIT 1`,
    [customerId.trim()],
    (customerError, customer) => {
      if (customerError) return res.status(500).json({ error: 'Could not load the customer saved GPS location.' });
      if (!customer || customer.customerStatus !== 'ACTIVE' || customer.userStatus !== 'ACTIVE') {
        return res.status(404).json({ error: 'An active customer with a saved GPS location is required.' });
      }

      const latitude = Number(customer.latitude);
      const longitude = Number(customer.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return res.status(400).json({ error: 'The customer does not have valid saved GPS coordinates.' });
      }
      const offset = 0.005;
      const geometry = {
        type: 'Polygon',
        coordinates: [[
          [longitude - offset, latitude - offset],
          [longitude + offset, latitude - offset],
          [longitude + offset, latitude + offset],
          [longitude - offset, latitude + offset],
          [longitude - offset, latitude - offset]
        ]]
      };
      const demoFranchises = [
        ['DEMO-HQ', 'HQ', 'Demo Headquarters', null],
        ['DEMO-CMD', 'COMMAND', 'Demo Telangana Command', 'DEMO-HQ'],
        ['DEMO-HUB', 'HUB', 'Demo Hyderabad Hub', 'DEMO-CMD'],
        ['DEMO-CTR', 'CENTER', 'Demo Hyderabad Center', 'DEMO-HUB'],
        ['DEMO-PNT', 'POINT', 'Demo Customer Test Point', 'DEMO-CTR'],
        ['DEMO-NAT', 'NATION', 'Demo Nation', null],
        ['DEMO-REG', 'REGION', 'Demo South Region', 'DEMO-NAT'],
        ['DEMO-TER', 'TERRITORY', 'Demo Telangana Territory', 'DEMO-REG'],
        ['DEMO-ZON', 'ZONE', 'Demo Hyderabad Zone', 'DEMO-TER'],
        ['DEMO-NOD', 'NODE', 'Demo Customer Test Node', 'DEMO-ZON']
      ];
      const rollback = (message, error) => {
        if (error) console.error('Demo customer coverage failed:', error.message);
        db.run('ROLLBACK', (rollbackError) => {
          if (rollbackError) console.error('Demo customer coverage rollback failed:', rollbackError.message);
          if (!res.headersSent) res.status(500).json({ error: message });
        });
      };

      db.serialize(() => {
        db.run('BEGIN IMMEDIATE', (beginError) => {
          if (beginError) return res.status(500).json({ error: 'Could not start demo coverage setup.' });
          const upsertFranchise = (index) => {
            if (index >= demoFranchises.length) return saveBoundary(0, []);
            const [id, level, name, parentId] = demoFranchises[index];
            db.run(
              `INSERT INTO franchises (id, level, name, parent_id, status)
               VALUES (?, ?, ?, ?, 'ACTIVE')
               ON CONFLICT(id) DO UPDATE SET
                 level = excluded.level, name = excluded.name,
                 parent_id = excluded.parent_id, status = 'ACTIVE'`,
              [id, level, name, parentId],
              (error) => error ? rollback('Could not create demo franchise hierarchies.', error) : upsertFranchise(index + 1)
            );
          };
          const saveBoundary = (index, versions) => {
            const leaves = ['DEMO-PNT', 'DEMO-NOD'];
            if (index >= leaves.length) return saveAttribution(versions);
            const franchiseId = leaves[index];
            db.get(
              'SELECT COALESCE(MAX(version), 0) + 1 AS version FROM geo_boundaries WHERE franchise_id = ?',
              [franchiseId],
              (versionError, row) => {
                if (versionError) return rollback('Could not prepare demo boundary versions.', versionError);
                db.run(
                  'UPDATE geo_boundaries SET status = ? WHERE franchise_id = ? AND status = ?',
                  ['INACTIVE', franchiseId, 'ACTIVE'],
                  (updateError) => {
                    if (updateError) return rollback('Could not replace the previous demo boundary.', updateError);
                    db.run(
                      'INSERT INTO geo_boundaries (id, franchise_id, geometry, version, status) VALUES (?, ?, ?, ?, ?)',
                      [uuidv4(), franchiseId, JSON.stringify(geometry), row.version, 'ACTIVE'],
                      (insertError) => insertError
                        ? rollback('Could not save the demo customer boundary.', insertError)
                        : saveBoundary(index + 1, [...versions, row.version])
                    );
                  }
                );
              }
            );
          };
          const saveAttribution = (versions) => {
            resolveMappingForCoordinates(db, latitude, longitude, (mappingError, mapping) => {
              if (mappingError) return rollback('Could not map the demo customer GPS.', mappingError);
              let attribution;
              try {
                attribution = buildCustomerAttribution(mapping);
              } catch (error) {
                return rollback('Could not create the demo customer attribution snapshot.', error);
              }
              if (attribution.status !== 'MAPPED') {
                return rollback('The demo coverage did not produce complete physical and digital mappings.', null);
              }
              const attributionId = uuidv4();
              db.run(
                `INSERT INTO customer_attributions (
                  id, customer_id, location_id, status, coordinates,
                  point_id, center_id, hub_id, command_id, hq_id,
                  physical_boundary_id, physical_mapping_version,
                  node_id, zone_id, territory_id, region_id, nation_id,
                  digital_boundary_id, digital_mapping_version,
                  physical_result, digital_result
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  attributionId, customer.customerId, customer.locationId, attribution.status,
                  JSON.stringify({ latitude, longitude }),
                  attribution.point_id, attribution.center_id, attribution.hub_id,
                  attribution.command_id, attribution.hq_id,
                  attribution.physical_boundary_id, attribution.physical_mapping_version,
                  attribution.node_id, attribution.zone_id, attribution.territory_id,
                  attribution.region_id, attribution.nation_id,
                  attribution.digital_boundary_id, attribution.digital_mapping_version,
                  attribution.physical_result, attribution.digital_result
                ],
                (insertError) => {
                  if (insertError) return rollback('Could not save the demo attribution snapshot.', insertError);
                  db.run('COMMIT', (commitError) => {
                    if (commitError) return rollback('Could not commit demo customer coverage.', commitError);
                    logAudit(req.user.id, req.user.role, 'GEO_DEMO_CUSTOMER_COVERAGE', customer.customerId, null, 'SUCCESS', {
                      locationId: customer.locationId,
                      attributionId,
                      physicalBoundaryVersion: versions[0],
                      digitalBoundaryVersion: versions[1],
                      coverageRadiusDegrees: offset,
                      demoOnly: true
                    });
                    res.json({
                      status: attribution.status,
                      demoOnly: true,
                      customerId: customer.customerId,
                      location: { id: customer.locationId, latitude, longitude },
                      attribution: { physical: mapping.physical, digital: mapping.digital },
                      message: 'Clearly labeled demo-only boundaries were created around the saved GPS. This is not a real franchise assignment or live service coverage.'
                    });
                  });
                }
              );
            });
          };
          upsertFranchise(0);
        });
      });
    }
  );
});

// User routes
app.post('/api/users', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { name, mobile, email, password, role } = req.body;
  const allowedUserRoles = ['HQ_ADMIN', 'COMMAND_ADMIN', 'HUB_ADMIN', 'CENTER_ADMIN', 'FRANCHISE_OWNER'];
  
  if (!name || !mobile || !email || typeof password !== 'string' || !role) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (!allowedUserRoles.includes(role)) {
    return res.status(400).json({ error: 'Select a supported administrative or franchise-owner role' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long' });
  }
  
  const hashedPassword = bcrypt.hashSync(password, 10);
  const normalizedEmail = String(email).trim().toLowerCase();
  const insertUser = (attempt = 0) => {
    db.all('SELECT id, user_code FROM users', [], (listError, rows) => {
      if (listError) {
        console.error('Could not generate user ID:', listError.message);
        return res.status(500).json({ error: 'Failed to generate a user ID' });
      }
      const reservedIds = rows.flatMap((row) => [row.id, row.user_code]);
      const pendingCodes = createUserCodeAssignments(rows).map((assignment) => assignment.userCode);
      const userId = createUserId([...reservedIds, ...pendingCodes]);
      db.run(
        `INSERT INTO users (id, user_code, name, mobile, email, password, role) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, userId, name, mobile, normalizedEmail, hashedPassword, role],
        async (err) => {
          if (err) {
            if (err.message.includes('users.id') && attempt < 5) {
              return insertUser(attempt + 1);
            }
            if (err.message.includes('UNIQUE')) {
              return res.status(400).json({ error: 'Mobile or email already exists' });
            }
            console.error('User creation failed:', err.message);
            return res.status(500).json({ error: 'Failed to create user' });
          }
          const finishUserCreation = async () => {
            logAudit(req.user.id, req.user.role, 'USER_CREATE', userId, null, 'SUCCESS', { name, role });

            const emailBody = `Welcome to Zyngram Franchise System\n\n` +
              `Dear ${name},\n\n` +
              `Your account has been created successfully.\n\n` +
              `User ID: ${userId}\n` +
              `Role: ${role}\n` +
              `Email: ${normalizedEmail}\n\n` +
              `Please sign in with this email and the password provided by your administrator.\n\n` +
              `Best regards,\nZyngram Team`;

            const emailResult = await sendEmail(normalizedEmail, 'Welcome to Zyngram', emailBody);
            if (emailResult.success) {
              logAudit(req.user.id, req.user.role, 'EMAIL_SENT', userId, null, 'SUCCESS', { to: normalizedEmail });
            } else {
              logAudit(req.user.id, req.user.role, 'EMAIL_SENT', userId, null, 'FAILED', { error: emailResult.error });
            }

            res.status(201).json({ id: userId, user_code: userId, message: `User created successfully. User ID: ${userId}` });
          };

          if (role !== 'FRANCHISE_OWNER') return finishUserCreation();
          db.run('INSERT INTO franchise_owners (user_id) VALUES (?)', [userId], (profileError) => {
            if (profileError) {
              console.error('Franchise owner profile creation failed:', profileError.message);
              return db.run('DELETE FROM users WHERE id = ?', [userId], (cleanupError) => {
                if (cleanupError) console.error('Failed to remove incomplete franchise owner account:', cleanupError.message);
                res.status(500).json({ error: 'Failed to create the franchise owner profile' });
              });
            }
            finishUserCreation();
          });
        }
      );
    });
  };
  insertUser();
});

app.put('/api/users/:id/password', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { password } = req.body;
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long' });
  }
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Use your account password recovery process to change your own password' });
  }
  db.run('UPDATE users SET password = ? WHERE id = ?', [bcrypt.hashSync(password, 10), req.params.id], function (err) {
    if (err) {
      console.error('Admin password reset failed:', err.message);
      return res.status(500).json({ error: 'Failed to reset user password' });
    }
    if (!this.changes) return res.status(404).json({ error: 'User not found' });
    logAudit(req.user.id, req.user.role, 'USER_PASSWORD_RESET', req.params.id, null, 'SUCCESS', null);
    res.json({ message: 'Password reset successfully. Share the new password with the user securely.' });
  });
});

app.get('/api/users', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { search, role, status } = req.query;
  let query = 'SELECT id, user_code, name, mobile, email, role, status, created_at FROM users WHERE 1=1';
  const params = [];
  
  if (search) {
    query += ' AND (user_code LIKE ? OR name LIKE ? OR mobile LIKE ? OR email LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  
  if (role) {
    query += ' AND role = ?';
    params.push(role);
  }
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  db.all(query, params, (err, users) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch users' });
    }
    res.json(users);
  });
});

app.get('/api/users/:id', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  db.get('SELECT id, user_code, name, mobile, email, role, status, created_at FROM users WHERE id = ?', [req.params.id], (err, user) => {
    if (err || !user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  });
});

// Franchise routes
app.post('/api/franchises', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { level, name, ownerId, parentId } = req.body;
  const levelPrefixes = {
    POINT: 'P',
    CENTER: 'C',
    HUB: 'H',
    COMMAND: 'CMD',
    HQ: 'HQ',
    NODE: 'NOD',
    ZONE: 'ZON',
    TERRITORY: 'TER',
    REGION: 'REG',
    NATION: 'NAT',
  };
  const requiredParentLevel = parentLevelFor(level);
  if (requiredParentLevel === undefined || !String(name || '').trim()) {
    return res.status(400).json({ error: 'A valid franchise level and name are required' });
  }
  if (requiredParentLevel === null && parentId) {
    return res.status(400).json({ error: `${level} must be a root franchise and cannot have a parent` });
  }
  if (requiredParentLevel && !parentId) {
    return res.status(400).json({ error: `${level} must have an active ${requiredParentLevel} parent` });
  }

  const createFranchise = () => {
    const prefix = levelPrefixes[level];
    db.get('SELECT id FROM franchises WHERE id LIKE ? ORDER BY id DESC LIMIT 1', [`${prefix}%`], (err, row) => {
      if (err) return res.status(500).json({ error: 'Failed to generate franchise ID' });
      const suffix = row ? Number.parseInt(row.id.slice(prefix.length), 10) : 0;
      const franchiseId = `${prefix}${String(Number.isFinite(suffix) ? suffix + 1 : 1).padStart(3, '0')}`;

      db.run(
        'INSERT INTO franchises (id, level, name, owner_id, parent_id) VALUES (?, ?, ?, ?, ?)',
        [franchiseId, level, String(name).trim(), ownerId || null, parentId || null],
        (insertError) => {
          if (insertError) {
            if (insertError.message.includes('invalid franchise level or parent level')) {
              return res.status(400).json({ error: `Select an active ${requiredParentLevel || 'root'} parent for this hierarchy level` });
            }
            console.error('Franchise creation failed:', insertError.message);
            return res.status(500).json({ error: 'Failed to create franchise' });
          }
          logAudit(req.user.id, req.user.role, 'FRANCHISE_CREATE', franchiseId, null, 'SUCCESS', { level, name });
          res.status(201).json({ id: franchiseId, message: 'Franchise created successfully' });
        }
      );
    });
  };

  if (!requiredParentLevel) return createFranchise();
  db.get(
    'SELECT id FROM franchises WHERE id = ? AND level = ? AND status = ?',
    [parentId, requiredParentLevel, 'ACTIVE'],
    (parentError, parent) => {
      if (parentError) return res.status(500).json({ error: 'Failed to validate parent franchise' });
      if (!parent) return res.status(400).json({ error: `Select an active ${requiredParentLevel} parent` });
      createFranchise();
    }
  );
});

app.get('/api/franchises', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const { level, status } = req.query;
  let query = 'SELECT * FROM franchises WHERE 1=1';
  const params = [];

  if (req.user.role === 'FRANCHISE_OWNER') {
    const scope = getFranchiseScopeFilter(req.user, 'id');
    if (!scope) return res.status(403).json({ error: 'Franchise owner scope is not configured' });
    query += ` AND ${scope.clause}`;
    params.push(...scope.params);
  }
  
  if (level) {
    query += ' AND level = ?';
    params.push(level);
  }
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  db.all(query, params, (err, franchises) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch franchises' });
    }
    res.json(franchises);
  });
});

app.get('/api/franchises/:id', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  db.get('SELECT * FROM franchises WHERE id = ?', [req.params.id], (err, franchise) => {
    if (err || !franchise) {
      return res.status(404).json({ error: 'Franchise not found' });
    }
    if (!checkFranchiseScope(req, franchise.id)) {
      return res.status(403).json({ error: 'Cannot view a franchise outside your authorized scope' });
    }
    res.json(franchise);
  });
});

// Order routes
app.get('/api/orders/options', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  db.all(
    `SELECT u.id, u.user_code, u.name, u.email
     FROM users u
     JOIN customers c ON c.user_id = u.id AND c.status = 'ACTIVE'
     WHERE u.role = 'CUSTOMER' AND u.status = 'ACTIVE'
     ORDER BY u.name, u.id`,
    [],
    (customerError, customers) => {
      if (customerError) return res.status(500).json({ error: 'Could not load active order customers' });
      db.all(
        "SELECT id, name, category FROM services WHERE status = 'ACTIVE' ORDER BY name, id",
        [],
        (serviceError, services) => {
          if (serviceError) return res.status(500).json({ error: 'Could not load active order services' });
          db.all(
            `SELECT l.id, l.user_id AS customerId, l.latitude, l.longitude
             FROM user_locations l
             WHERE l.rowid = (
               SELECT latest.rowid FROM user_locations latest
               WHERE latest.user_id = l.user_id
               ORDER BY latest.rowid DESC LIMIT 1
             )
             ORDER BY l.user_id`,
            [],
            (locationError, locations) => {
              if (locationError) return res.status(500).json({ error: 'Could not load customer locations' });
              res.json({ customers, services, locations });
            }
          );
        }
      );
    }
  );
});

app.post('/api/orders', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { customerId, serviceId, amount, locationId } = req.body;
  const numericAmount = Number(amount);

  if (!customerId || !serviceId || amount === undefined || amount === null ||
      String(amount).trim() === '' || !Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'Customer ID, service ID, and amount are required' });
  }

  db.get(
    `SELECT u.id FROM users u
     JOIN customers c ON c.user_id = u.id AND c.status = 'ACTIVE'
     WHERE u.id = ? AND u.role = 'CUSTOMER' AND u.status = 'ACTIVE'`,
    [customerId],
    (customerError, customer) => {
      if (customerError) return res.status(500).json({ error: 'Could not validate the order customer' });
      if (!customer) return res.status(400).json({ error: 'Select an active customer account before creating an order' });
      db.get("SELECT id FROM services WHERE id = ? AND status = 'ACTIVE'", [serviceId], (serviceError, service) => {
        if (serviceError) return res.status(500).json({ error: 'Could not validate the order service' });
        if (!service) return res.status(400).json({ error: 'Select an active service before creating an order' });
        const createOrder = () => {
          const orderId = createOrderId(new Date(), uuidv4());
          db.run(
            `INSERT INTO orders (id, customer_id, service_id, amount, location_id) VALUES (?, ?, ?, ?, ?)`,
            [orderId, customerId, serviceId, numericAmount, locationId || null],
            (err) => {
              if (err) {
                console.error('Order creation failed:', err.message);
                return res.status(500).json({ error: 'Failed to create order' });
              }
              logAudit(req.user.id, req.user.role, 'ORDER_CREATE', orderId, null, 'SUCCESS', {
                customerId, serviceId, amount: numericAmount, locationId: locationId || null
              });
              res.status(201).json({ id: orderId, orderId, message: 'Order created successfully' });
            }
          );
        };
        if (!locationId) return createOrder();
        db.get('SELECT id FROM user_locations WHERE id = ? AND user_id = ?', [locationId, customerId], (locationError, location) => {
          if (locationError) return res.status(500).json({ error: 'Could not validate customer location' });
          if (!location) return res.status(400).json({ error: 'Select a saved location belonging to this customer' });
          createOrder();
        });
      });
    }
  );
});

app.get('/api/orders', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { customerId, status } = req.query;
  let query = 'SELECT * FROM orders WHERE 1=1';
  const params = [];
  
  if (customerId) {
    query += ' AND customer_id = ?';
    params.push(customerId);
  }
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  db.all(query, params, (err, orders) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch orders' });
    }
    res.json(orders);
  });
});

app.get('/api/recharge/options', authenticateToken, checkRole(['CUSTOMER']), (req, res) => {
  db.get(
    "SELECT id, name, category FROM services WHERE id = 'SVC001' AND status = 'ACTIVE'",
    [],
    (err, service) => {
      if (err) return res.status(500).json({ error: 'Could not load Mobile Recharge service options' });
      if (!service) return res.status(503).json({ error: 'Mobile Recharge service is not active' });
      res.json({ service, operators: RECHARGE_OPERATORS, circles: RECHARGE_CIRCLES, providerMode: 'DEMO_SIMULATION' });
    }
  );
});

app.get('/api/admin/recharge/options', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  db.all(
    `SELECT u.id, u.name, u.email
     FROM users u
     JOIN customers c ON c.user_id = u.id AND c.status = 'ACTIVE'
     WHERE u.role = 'CUSTOMER' AND u.status = 'ACTIVE'
     ORDER BY u.name, u.id`,
    [],
    (err, customers) => {
      if (err) return res.status(500).json({ error: 'Could not load active customers for recharge' });
      db.get("SELECT id, name FROM services WHERE id = 'SVC001' AND status = 'ACTIVE'", [], (serviceError, service) => {
        if (serviceError) return res.status(500).json({ error: 'Could not load Mobile Recharge service' });
        if (!service) return res.status(503).json({ error: 'Mobile Recharge service is not active' });
        res.json({
          customers,
          service,
          operators: RECHARGE_OPERATORS,
          circles: RECHARGE_CIRCLES,
          providerMode: 'DEMO_SIMULATION'
        });
      });
    }
  );
});

app.post('/api/admin/recharge/orders', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const validationError = validateRechargeOrder(req.body);
  if (validationError) return res.status(400).json({ error: validationError });
  if (typeof req.body.customerId !== 'string' || !req.body.customerId.trim()) {
    return res.status(400).json({ error: 'Select an active customer for this recharge request.' });
  }
  const idempotencyKey = req.get('Idempotency-Key');
  if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
    return res.status(400).json({ error: 'A valid Idempotency-Key header is required for recharge requests.' });
  }

  const customerId = req.body.customerId.trim();
  const mobileNumber = req.body.mobileNumber.replace(/[\s()-]/g, '').replace(/^\+91/, '');
  const amount = Number(req.body.amount);
  const { operator, circle } = req.body;
  const rechargeDb = new sqlite3.Database(dbPath, (connectionError) => {
    if (connectionError) {
      console.error('Admin recharge database connection failed:', connectionError.message);
      return res.status(500).json({ error: 'Recharge processing is temporarily unavailable.' });
    }
    rechargeDb.configure('busyTimeout', 5000);
    rechargeDb.run('PRAGMA foreign_keys = ON', (pragmaError) => {
      if (pragmaError) {
        console.error('Admin recharge could not enable foreign keys:', pragmaError.message);
        return rechargeDb.close(() => res.status(500).json({ error: 'Recharge processing is temporarily unavailable.' }));
      }
      rechargeDb.run('BEGIN IMMEDIATE', (beginError) => {
        if (beginError) {
          console.error('Admin recharge transaction could not start:', beginError.message);
          return rechargeDb.close(() => res.status(500).json({ error: 'Recharge processing is temporarily unavailable.' }));
        }
        const rollback = (status, message, error) => {
          const duplicateRequest = /UNIQUE constraint failed: orders\.idempotency_key/.test(error?.message || '');
          if (error) console.error('Admin Mobile Recharge failed:', error.message);
          rechargeDb.run('ROLLBACK', (rollbackError) => {
            if (rollbackError) console.error('Admin Mobile Recharge rollback failed:', rollbackError.message);
            rechargeDb.close((closeError) => {
              if (closeError) console.error('Admin recharge connection close failed:', closeError.message);
              if (!res.headersSent) {
                res.status(duplicateRequest ? 409 : status).json({
                  error: duplicateRequest ? 'This recharge request was already accepted. Refresh the order list before retrying.' : message,
                  duplicateRequest
                });
              }
            });
          });
        };

        rechargeDb.get(
          `SELECT c.id AS customerId, c.status AS customerStatus, u.status AS userStatus,
                  l.id AS locationId, l.latitude, l.longitude
           FROM customers c
           JOIN users u ON u.id = c.user_id
           JOIN user_locations l ON l.user_id = c.user_id
           WHERE c.user_id = ?
           ORDER BY l.rowid DESC
           LIMIT 1`,
          [customerId],
          (customerError, customer) => {
            if (customerError) return rollback(500, 'Could not load the selected customer GPS location.', customerError);
            if (!customer || customer.customerStatus !== 'ACTIVE' || customer.userStatus !== 'ACTIVE') {
              return rollback(400, 'Select an active customer with a saved GPS location.', null);
            }
            rechargeDb.get("SELECT id, name FROM services WHERE id = 'SVC001' AND status = 'ACTIVE'", [], (serviceError, service) => {
              if (serviceError) return rollback(500, 'Could not validate Mobile Recharge service.', serviceError);
              if (!service) return rollback(503, 'Mobile Recharge service is not active.', null);
              resolveMappingForCoordinates(rechargeDb, customer.latitude, customer.longitude, (mappingError, mapping) => {
                if (mappingError) return rollback(500, 'Could not verify customer franchise mapping.', mappingError);
                if (mapping.physical.status !== 'MAPPED' || mapping.digital.status !== 'MAPPED') {
                  return rollback(409, 'Recharge is blocked: the selected customer GPS is UNMAPPED. No franchise was assigned.', null);
                }

                const orderId = createOrderId(new Date(), uuidv4());
                const reference = `DEMO-${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
                const now = new Date().toISOString();
                const physical = mapping.physical;
                const digital = mapping.digital;
                let commissionEntriesCreated = 0;
                const steps = [
                  (next) => rechargeDb.run(
                    `INSERT INTO orders (
                      id, customer_id, service_id, amount, status, location_id,
                      subscriber_mobile, operator, circle, processing_reference,
                      processed_at, processing_message, idempotency_key
                    ) VALUES (?, ?, 'SVC001', ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [orderId, customerId, amount, customer.locationId, mobileNumber, operator, circle, reference, now,
                      'Recharge accepted by local Admin demo simulation; no telco provider was contacted.', idempotencyKey],
                    next
                  ),
                  (next) => rechargeDb.run(
                    'INSERT INTO order_status_history (id, order_id, status, message, reference) VALUES (?, ?, ?, ?, ?)',
                    [uuidv4(), orderId, 'PENDING', 'HQ Admin accepted the recharge request for backend validation.', reference],
                    next
                  ),
                  (next) => rechargeDb.run(
                    'INSERT INTO order_status_history (id, order_id, status, message, reference) VALUES (?, ?, ?, ?, ?)',
                    [uuidv4(), orderId, 'PROCESSING', 'Backend verified active customer, saved location, Mobile Recharge service, and both franchise hierarchies.', reference],
                    next
                  ),
                  (next) => rechargeDb.run(
                    `INSERT INTO order_attribution (
                      id, order_id, point_id, center_id, hub_id, command_id, mapping_version, coordinates,
                      hq_id, node_id, digital_mapping_version, zone_id, territory_id, region_id, nation_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                      uuidv4(), orderId, physical.point.id, physical.center.id, physical.hub.id,
                      physical.command.id, physical.mappingVersion,
                      JSON.stringify({ latitude: customer.latitude, longitude: customer.longitude }),
                      physical.hq.id, digital.node.id, digital.mappingVersion,
                      digital.zone.id, digital.territory.id, digital.region.id, digital.nation.id
                    ],
                    next
                  ),
                  (next) => {
                    calculateCommissionsInTransaction(rechargeDb, {
                      orderId,
                      actorId: req.user.id,
                      levels: [
                        { id: physical.point.id, level: 'POINT' },
                        { id: physical.center.id, level: 'CENTER' },
                        { id: physical.hub.id, level: 'HUB' },
                        { id: physical.command.id, level: 'COMMAND' }
                      ]
                    }).then(({ created }) => {
                      commissionEntriesCreated = created.length;
                      next(null);
                    }).catch(next);
                  },
                  (next) => rechargeDb.run(
                    'UPDATE orders SET status = ? WHERE id = ? AND status = ?',
                    ['SIMULATED_SUCCESS', orderId, 'PENDING'],
                    function (updateError) {
                      if (updateError) return next(updateError);
                      if (this.changes !== 1) return next(new Error('Recharge order status changed during Admin processing.'));
                      next(null);
                    }
                  ),
                  (next) => rechargeDb.run(
                    'INSERT INTO order_status_history (id, order_id, status, message, reference) VALUES (?, ?, ?, ?, ?)',
                    [uuidv4(), orderId, 'SIMULATED_SUCCESS', 'Admin demo simulation completed. This is not a real mobile recharge.', reference],
                    next
                  )
                ];
                let index = 0;
                const runNext = (error) => {
                  if (error) return rollback(500, 'Could not safely save the Admin recharge order and attribution.', error);
                  if (index < steps.length) return steps[index++](runNext);
                  rechargeDb.run('COMMIT', (commitError) => {
                    if (commitError) return rollback(500, 'Admin recharge order could not be committed.', commitError);
                    rechargeDb.close((closeError) => {
                      if (closeError) console.error('Admin recharge connection close failed:', closeError.message);
                      logAudit(req.user.id, req.user.role, 'MOBILE_RECHARGE_ADMIN_SIMULATED', orderId, null, 'SUCCESS', {
                        customerId, locationId: customer.locationId, operator, circle, amount,
                        commissionEntriesCreated, providerMode: 'DEMO_SIMULATION'
                      });
                      res.status(201).json({
                        orderId, customerId, locationId: customer.locationId,
                        service: { id: service.id, name: service.name }, mobileNumber, operator, circle,
                        amount, status: 'SIMULATED_SUCCESS', createdAt: now, processedAt: now,
                        processingReference: reference, commissionEntriesCreated, providerMode: 'DEMO_SIMULATION',
                        providerWarning: 'No telco provider was contacted. No money was charged and no recharge was sent.'
                      });
                    });
                  });
                };
                runNext(null);
              });
            });
          }
        );
      });
    });
  });
});

app.get('/api/admin/recharge/orders', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  db.all(
    `SELECT o.id AS orderId, o.customer_id AS customerId, u.name AS customerName, u.email AS customerEmail,
            o.location_id AS locationId, s.name AS serviceName, o.amount, o.status,
            o.subscriber_mobile AS mobileNumber, o.operator, o.circle,
            (SELECT COUNT(*) FROM commission_ledger cl WHERE cl.order_id = o.id) AS commissionEntries,
            (SELECT COALESCE(SUM(cl.amount), 0) FROM commission_ledger cl WHERE cl.order_id = o.id) AS commissionAmount,
            o.processing_reference AS processingReference, o.processed_at AS processedAt,
            o.processing_message AS processingMessage, o.created_at AS createdAt,
            l.latitude, l.longitude, a.point_id AS pointId, a.center_id AS centerId,
            a.hub_id AS hubId, a.command_id AS commandId, a.hq_id AS hqId,
            a.mapping_version AS physicalMappingVersion, a.node_id AS nodeId,
            a.zone_id AS zoneId, a.territory_id AS territoryId,
            a.region_id AS regionId, a.nation_id AS nationId,
            a.digital_mapping_version AS digitalMappingVersion,
            p.name AS pointName, ce.name AS centerName, h.name AS hubName,
            cmd.name AS commandName, hq.name AS hqName, n.name AS nodeName,
            z.name AS zoneName, t.name AS territoryName,
            r.name AS regionName, nat.name AS nationName
     FROM orders o
     JOIN users u ON u.id = o.customer_id
     JOIN services s ON s.id = o.service_id
     LEFT JOIN user_locations l ON l.id = o.location_id AND l.user_id = o.customer_id
     LEFT JOIN order_attribution a ON a.order_id = o.id
     LEFT JOIN franchises p ON p.id = a.point_id
     LEFT JOIN franchises ce ON ce.id = a.center_id
     LEFT JOIN franchises h ON h.id = a.hub_id
     LEFT JOIN franchises cmd ON cmd.id = a.command_id
     LEFT JOIN franchises hq ON hq.id = a.hq_id
     LEFT JOIN franchises n ON n.id = a.node_id
     LEFT JOIN franchises z ON z.id = a.zone_id
     LEFT JOIN franchises t ON t.id = a.territory_id
     LEFT JOIN franchises r ON r.id = a.region_id
     LEFT JOIN franchises nat ON nat.id = a.nation_id
     WHERE o.service_id = 'SVC001' AND o.subscriber_mobile IS NOT NULL
     ORDER BY o.rowid DESC
     LIMIT 200`,
    [],
    (err, orders) => {
      if (err) return res.status(500).json({ error: 'Could not load Mobile Recharge orders' });
      const result = [];
      let index = 0;
      const loadHistory = () => {
        if (index >= orders.length) return res.json(result);
        const order = orders[index++];
        db.all(
          `SELECT status, message, reference, created_at AS createdAt
           FROM order_status_history WHERE order_id = ? ORDER BY rowid`,
          [order.orderId],
          (historyError, history) => {
            if (historyError) return res.status(500).json({ error: 'Could not load Mobile Recharge status history' });
            result.push({
              ...order,
              franchiseMapping: {
                physical: [
                  { id: order.pointId, name: order.pointName, level: 'POINT' },
                  { id: order.centerId, name: order.centerName, level: 'CENTER' },
                  { id: order.hubId, name: order.hubName, level: 'HUB' },
                  { id: order.commandId, name: order.commandName, level: 'COMMAND' },
                  { id: order.hqId, name: order.hqName, level: 'HQ' }
                ],
                digital: [
                  { id: order.nodeId, name: order.nodeName, level: 'NODE' },
                  { id: order.zoneId, name: order.zoneName, level: 'ZONE' },
                  { id: order.territoryId, name: order.territoryName, level: 'TERRITORY' },
                  { id: order.regionId, name: order.regionName, level: 'REGION' },
                  { id: order.nationId, name: order.nationName, level: 'NATION' }
                ],
                physicalMappingVersion: order.physicalMappingVersion,
                digitalMappingVersion: order.digitalMappingVersion
              },
              statusHistory: history
            });
            loadHistory();
          }
        );
      };
      loadHistory();
    }
  );
});

app.get('/api/recharge/orders', authenticateToken, checkRole(['CUSTOMER']), (req, res) => {
  db.all(
    `SELECT o.id AS orderId, o.customer_id AS customerId, o.location_id AS locationId,
            o.service_id AS serviceId, s.name AS serviceName, o.amount, o.status,
            o.subscriber_mobile AS mobileNumber, o.operator, o.circle,
            (SELECT COUNT(*) FROM commission_ledger cl WHERE cl.order_id = o.id) AS commissionEntries,
            (SELECT COALESCE(SUM(cl.amount), 0) FROM commission_ledger cl WHERE cl.order_id = o.id) AS commissionAmount,
            o.processing_reference AS processingReference, o.processed_at AS processedAt,
            o.processing_message AS processingMessage, o.created_at AS createdAt,
            l.latitude, l.longitude, a.point_id AS pointId, a.center_id AS centerId,
            a.hub_id AS hubId, a.command_id AS commandId, a.hq_id AS hqId,
            a.mapping_version AS physicalMappingVersion, a.node_id AS nodeId,
            a.zone_id AS zoneId, a.territory_id AS territoryId,
            a.region_id AS regionId, a.nation_id AS nationId,
            a.digital_mapping_version AS digitalMappingVersion,
            p.name AS pointName, ce.name AS centerName, h.name AS hubName,
            cmd.name AS commandName, hq.name AS hqName, n.name AS nodeName,
            z.name AS zoneName, t.name AS territoryName,
            r.name AS regionName, nat.name AS nationName
     FROM orders o
     JOIN services s ON s.id = o.service_id
     JOIN user_locations l ON l.id = o.location_id AND l.user_id = o.customer_id
     JOIN order_attribution a ON a.order_id = o.id
     LEFT JOIN franchises p ON p.id = a.point_id
     LEFT JOIN franchises ce ON ce.id = a.center_id
     LEFT JOIN franchises h ON h.id = a.hub_id
     LEFT JOIN franchises cmd ON cmd.id = a.command_id
     LEFT JOIN franchises hq ON hq.id = a.hq_id
     LEFT JOIN franchises n ON n.id = a.node_id
     LEFT JOIN franchises z ON z.id = a.zone_id
     LEFT JOIN franchises t ON t.id = a.territory_id
     LEFT JOIN franchises r ON r.id = a.region_id
     LEFT JOIN franchises nat ON nat.id = a.nation_id
     WHERE o.customer_id = ? AND o.service_id = 'SVC001'
     ORDER BY o.created_at DESC, o.id DESC`,
    [req.user.id],
    (err, orders) => {
      if (err) return res.status(500).json({ error: 'Could not load your Mobile Recharge orders' });
      const result = [];
      let index = 0;
      const loadHistory = () => {
        if (index >= orders.length) return res.json(result);
        const order = orders[index++];
        db.all(
          `SELECT status, message, reference, created_at AS createdAt
           FROM order_status_history WHERE order_id = ? ORDER BY rowid`,
          [order.orderId],
          (historyError, history) => {
            if (historyError) return res.status(500).json({ error: 'Could not load recharge processing history' });
            result.push({
              ...order,
              franchiseMapping: {
                physical: [
                  { id: order.pointId, name: order.pointName, level: 'POINT' },
                  { id: order.centerId, name: order.centerName, level: 'CENTER' },
                  { id: order.hubId, name: order.hubName, level: 'HUB' },
                  { id: order.commandId, name: order.commandName, level: 'COMMAND' },
                  { id: order.hqId, name: order.hqName, level: 'HQ' }
                ],
                digital: [
                  { id: order.nodeId, name: order.nodeName, level: 'NODE' },
                  { id: order.zoneId, name: order.zoneName, level: 'ZONE' },
                  { id: order.territoryId, name: order.territoryName, level: 'TERRITORY' },
                  { id: order.regionId, name: order.regionName, level: 'REGION' },
                  { id: order.nationId, name: order.nationName, level: 'NATION' }
                ],
                physicalMappingVersion: order.physicalMappingVersion,
                digitalMappingVersion: order.digitalMappingVersion
              },
              statusHistory: history
            });
            loadHistory();
          }
        );
      };
      loadHistory();
    }
  );
});

app.post('/api/recharge/orders', authenticateToken, checkRole(['CUSTOMER']), (req, res) => {
  const validationError = validateRechargeOrder(req.body);
  if (validationError) return res.status(400).json({ error: validationError });
  const idempotencyKey = req.get('Idempotency-Key');
  if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
    return res.status(400).json({ error: 'A valid Idempotency-Key header is required for recharge requests.' });
  }

  const mobileNumber = req.body.mobileNumber.replace(/[\s()-]/g, '').replace(/^\+91/, '');
  const amount = Number(req.body.amount);
  const operator = req.body.operator;
  const circle = req.body.circle;
  const registrationDb = new sqlite3.Database(dbPath, (connectionError) => {
    if (connectionError) {
      console.error('Recharge processing database connection failed:', connectionError.message);
      return res.status(500).json({ error: 'Recharge processing is temporarily unavailable' });
    }
    registrationDb.configure('busyTimeout', 5000);
    registrationDb.run('PRAGMA foreign_keys = ON', (pragmaError) => {
      if (pragmaError) {
        console.error('Recharge processing could not enable foreign keys:', pragmaError.message);
        return registrationDb.close(() => res.status(500).json({ error: 'Recharge processing is temporarily unavailable' }));
      }
      registrationDb.run('BEGIN IMMEDIATE', (beginError) => {
        if (beginError) {
          console.error('Recharge processing transaction could not start:', beginError.message);
          return registrationDb.close(() => res.status(500).json({ error: 'Recharge processing is temporarily unavailable' }));
        }
        const rollback = (status, message, error) => {
          const duplicateRequest = /UNIQUE constraint failed: orders\.idempotency_key/.test(error?.message || '');
          if (error) console.error('Mobile Recharge order failed:', error.message);
          registrationDb.run('ROLLBACK', (rollbackError) => {
            if (rollbackError) console.error('Mobile Recharge order rollback failed:', rollbackError.message);
            registrationDb.close((closeError) => {
              if (closeError) console.error('Recharge processing connection close failed:', closeError.message);
              if (!res.headersSent) {
                res.status(duplicateRequest ? 409 : status).json({
                  error: duplicateRequest ? 'This recharge request was already accepted. Refresh your order history before retrying.' : message,
                  duplicateRequest
                });
              }
            });
          });
        };

        registrationDb.get(
          `SELECT c.id AS customerId, c.status AS customerStatus, u.status AS userStatus,
                  l.id AS locationId, l.latitude, l.longitude
           FROM customers c
           JOIN users u ON u.id = c.user_id
           JOIN user_locations l ON l.user_id = c.user_id
           WHERE c.user_id = ?
           ORDER BY l.rowid DESC
           LIMIT 1`,
          [req.user.id],
          (customerError, customer) => {
            if (customerError) return rollback(500, 'Could not load your registered customer location', customerError);
            if (!customer || customer.customerStatus !== 'ACTIVE' || customer.userStatus !== 'ACTIVE') {
              return rollback(403, 'An active customer profile and saved GPS location are required to recharge');
            }
            registrationDb.get("SELECT id FROM services WHERE id = 'SVC001' AND status = 'ACTIVE'", [], (serviceError, service) => {
              if (serviceError) return rollback(500, 'Could not validate Mobile Recharge service', serviceError);
              if (!service) return rollback(503, 'Mobile Recharge service is not active');
              resolveMappingForCoordinates(registrationDb, customer.latitude, customer.longitude, (mappingError, mapping) => {
                if (mappingError) return rollback(500, 'Could not verify saved franchise mapping', mappingError);
                if (mapping.physical.status !== 'MAPPED' || mapping.digital.status !== 'MAPPED') {
                  return rollback(409, 'Recharge is unavailable because your saved location is UNMAPPED. No franchise will be assigned.', null);
                }

                const orderId = createOrderId(new Date(), uuidv4());
                const processingReference = `DEMO-${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
                const now = new Date().toISOString();
                const physical = mapping.physical;
                const digital = mapping.digital;
                let commissionEntriesCreated = 0;
                const steps = [
                  (next) => registrationDb.run(
                    `INSERT INTO orders (
                      id, customer_id, service_id, amount, status, location_id,
                      subscriber_mobile, operator, circle, processing_reference,
                      processed_at, processing_message, idempotency_key
                    ) VALUES (?, ?, 'SVC001', ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [orderId, req.user.id, amount, customer.locationId, mobileNumber, operator, circle, processingReference, now,
                      'Recharge accepted by local simulation; no telco provider was contacted.', idempotencyKey],
                    next
                  ),
                  (next) => registrationDb.run(
                    'INSERT INTO order_status_history (id, order_id, status, message, reference) VALUES (?, ?, ?, ?, ?)',
                    [uuidv4(), orderId, 'PENDING', 'Recharge request accepted and validated.', processingReference],
                    next
                  ),
                  (next) => registrationDb.run(
                    'INSERT INTO order_status_history (id, order_id, status, message, reference) VALUES (?, ?, ?, ?, ?)',
                    [uuidv4(), orderId, 'PROCESSING', 'Backend verified customer, saved location, active Mobile Recharge service, and both franchise hierarchies.', processingReference],
                    next
                  ),
                  (next) => registrationDb.run(
                    `INSERT INTO order_attribution (
                      id, order_id, point_id, center_id, hub_id, command_id, mapping_version, coordinates,
                      hq_id, node_id, digital_mapping_version, zone_id, territory_id, region_id, nation_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                      uuidv4(), orderId, physical.point.id, physical.center.id, physical.hub.id,
                      physical.command.id, physical.mappingVersion,
                      JSON.stringify({ latitude: customer.latitude, longitude: customer.longitude }),
                      physical.hq.id, digital.node.id, digital.mappingVersion, digital.zone.id,
                      digital.territory.id, digital.region.id, digital.nation.id
                    ],
                    next
                  ),
                  (next) => {
                    calculateCommissionsInTransaction(registrationDb, {
                      orderId,
                      actorId: req.user.id,
                      levels: [
                        { id: physical.point.id, level: 'POINT' },
                        { id: physical.center.id, level: 'CENTER' },
                        { id: physical.hub.id, level: 'HUB' },
                        { id: physical.command.id, level: 'COMMAND' }
                      ]
                    }).then(({ created }) => {
                      commissionEntriesCreated = created.length;
                      next(null);
                    }).catch(next);
                  },
                  (next) => registrationDb.run(
                    'UPDATE orders SET status = ? WHERE id = ? AND status = ?',
                    ['SIMULATED_SUCCESS', orderId, 'PENDING'],
                    function (updateError) {
                      if (updateError) return next(updateError);
                      if (this.changes !== 1) return next(new Error('Recharge order status changed during processing'));
                      next(null);
                    }
                  ),
                  (next) => registrationDb.run(
                    'INSERT INTO order_status_history (id, order_id, status, message, reference) VALUES (?, ?, ?, ?, ?)',
                    [uuidv4(), orderId, 'SIMULATED_SUCCESS', 'Local demo processing completed. This is not a real mobile recharge.', processingReference],
                    next
                  )
                ];
                let stepIndex = 0;
                const executeNext = (stepError) => {
                  if (stepError) return rollback(500, 'Recharge processing could not save the order and attribution safely', stepError);
                  if (stepIndex >= steps.length) {
                    return registrationDb.run('COMMIT', (commitError) => {
                      if (commitError) return rollback(500, 'Recharge order could not be committed', commitError);
                      registrationDb.close((closeError) => {
                        if (closeError) {
                          console.error('Recharge processing connection close failed:', closeError.message);
                          return res.status(500).json({ error: 'Recharge was recorded; refresh your order history to confirm status' });
                        }
                        logAudit(req.user.id, req.user.role, 'MOBILE_RECHARGE_SIMULATED', orderId, null, 'SUCCESS', {
                          customerId: req.user.id,
                          locationId: customer.locationId,
                          operator,
                          circle,
                          amount,
                          commissionEntriesCreated,
                          mappingVersion: { physical: physical.mappingVersion, digital: digital.mappingVersion },
                          providerMode: 'DEMO_SIMULATION'
                        });
                        res.status(201).json({
                          orderId,
                          customerId: req.user.id,
                          locationId: customer.locationId,
                          service: { id: service.id, name: 'Mobile Recharge' },
                          mobileNumber,
                          operator,
                          circle,
                          amount,
                          status: 'SIMULATED_SUCCESS',
                          createdAt: now,
                          processedAt: now,
                          commissionEntriesCreated,
                          processingReference,
                          providerMode: 'DEMO_SIMULATION',
                          providerWarning: 'No telco provider was contacted. No money was charged and no recharge was sent.',
                          franchiseMapping: {
                            physical,
                            digital
                          }
                        });
                      });
                    });
                  }
                  const step = steps[stepIndex++];
                  step(executeNext);
                };
                executeNext(null);
              });
            });
          }
        );
      });
    });
  });
});

app.get('/api/orders/:id', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  db.get('SELECT * FROM orders WHERE id = ?', [req.params.id], (err, order) => {
    if (err || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(order);
  });
});

app.post('/api/orders/:id/confirm', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const orderId = req.params.id;
  db.get(
    `SELECT o.*, l.latitude, l.longitude
     FROM orders o
     LEFT JOIN user_locations l ON l.id = o.location_id AND l.user_id = o.customer_id
     WHERE o.id = ?`,
    [orderId],
    (err, order) => {
    if (err || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (order.status !== 'PENDING') {
      return res.status(400).json({ error: 'Order already confirmed' });
    }

    if (!order.location_id || !Number.isFinite(order.latitude) || !Number.isFinite(order.longitude)) {
      return res.status(409).json({ error: 'Order cannot be confirmed until it has a valid saved customer location' });
    }

    resolveMappingForCoordinates(db, order.latitude, order.longitude, (mappingError, mapping) => {
        if (mappingError) {
          console.error('Order franchise mapping failed:', mappingError.message);
          return res.status(500).json({ error: 'A saved franchise boundary is invalid or could not be loaded.' });
        }
        if (mapping.physical.status !== 'MAPPED') {
          return res.status(409).json({ error: `Order has no complete physical franchise mapping: ${mapping.physical.message}` });
        }
        if (mapping.digital.status !== 'MAPPED') {
          return res.status(409).json({ error: `Order has no complete digital franchise mapping: ${mapping.digital.message}` });
        }

        const physical = mapping.physical;
        const digital = mapping.digital;
        const attributionId = uuidv4();
        db.run(
          `INSERT INTO order_attribution (
            id, order_id, point_id, center_id, hub_id, command_id, mapping_version, coordinates,
            hq_id, node_id, digital_mapping_version, zone_id, territory_id, region_id, nation_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            attributionId,
            orderId,
            physical.point.id,
            physical.center.id,
            physical.hub.id,
            physical.command.id,
            physical.mappingVersion,
            JSON.stringify({ latitude: order.latitude, longitude: order.longitude }),
            physical.hq.id,
            digital.node.id,
            digital.mappingVersion,
            digital.zone.id,
            digital.territory.id,
            digital.region.id,
            digital.nation.id,
          ],
          (attributionError) => {
            if (attributionError) {
              console.error('Order attribution creation failed:', attributionError.message);
              return res.status(500).json({ error: 'Failed to create backend-resolved attribution' });
            }
            createCommissionEntries(db, {
              orderId,
              actorId: req.user.id,
              levels: [
                { id: physical.point.id, level: 'POINT' },
                { id: physical.center.id, level: 'CENTER' },
                { id: physical.hub.id, level: 'HUB' },
                { id: physical.command.id, level: 'COMMAND' }
              ]
            }).then(({ created }) => {
              db.run('UPDATE orders SET status = ? WHERE id = ? AND status = ?', ['CONFIRMED', orderId, 'PENDING'], function (updateError) {
                if (updateError) return res.status(500).json({ error: 'Failed to update order status' });
                if (this.changes !== 1) return res.status(409).json({ error: 'Order status changed before confirmation' });

                created.forEach((entry) => {
                  logAudit(req.user.id, 'SYSTEM', 'COMMISSION_CALC', entry.id, null, 'SUCCESS', {
                    orderId,
                    level: entry.level,
                    ruleId: entry.ruleId,
                    rate: entry.rate,
                    amount: entry.amount
                  });
                });
                logAudit(req.user.id, req.user.role, 'ORDER_CONFIRM', orderId, null, 'SUCCESS', {
                  attributionId,
                  physicalPointId: physical.point.id,
                  digitalNodeId: digital.node.id,
                  commissionEntriesCreated: created.length
                });
                res.json({
                  message: 'Order confirmed with backend-resolved physical and digital attribution',
                  attributionId,
                  commissionEntriesCreated: created.length
                });
              });
            }).catch((commissionError) => {
              console.error('Commission calculation failed:', commissionError.message);
              res.status(500).json({ error: 'Order commission rules could not be applied; order remains unconfirmed' });
            });
          }
        );
    });
  });
});

// Commission routes
app.get('/api/commission-rules', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  db.all(
    `SELECT id, service_category AS serviceCategory, level, rate, rate_type AS rateType,
            effective_from AS effectiveFrom, effective_to AS effectiveTo,
            version, status, created_at AS createdAt
     FROM commission_rules
     ORDER BY service_category, level, effective_from DESC, version DESC`,
    [],
    (err, rules) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch commission rules' });
      res.json(rules);
    }
  );
});

app.post('/api/commission-rules', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { serviceCategory, level, rate, effectiveFrom, effectiveTo } = req.body || {};
  const supportedLevels = ['POINT', 'CENTER', 'HUB', 'COMMAND'];
  const numericRate = Number(rate);
  const startDate = effectiveFrom ? new Date(effectiveFrom) : new Date();
  const endDate = effectiveTo ? new Date(effectiveTo) : null;
  if (typeof serviceCategory !== 'string' || !/^[A-Z][A-Z0-9_]{1,39}$/.test(serviceCategory) ||
      !supportedLevels.includes(level) || !Number.isFinite(numericRate) ||
      numericRate < 0 || numericRate > 1 || Number.isNaN(startDate.getTime()) ||
      (endDate && (Number.isNaN(endDate.getTime()) || endDate <= startDate))) {
    return res.status(400).json({ error: 'Provide a service category, supported franchise level, rate from 0 to 1, and valid effective dates' });
  }

  db.get(
    'SELECT COALESCE(MAX(version), 0) + 1 AS version FROM commission_rules WHERE service_category = ? AND level = ?',
    [serviceCategory, level],
    (versionError, versionRow) => {
      if (versionError) return res.status(500).json({ error: 'Could not determine the next commission rule version' });
      const ruleId = `RULE-${uuidv4()}`;
      db.run(
        `INSERT INTO commission_rules
          (id, service_category, level, rate, rate_type, effective_from, effective_to, version, status)
         VALUES (?, ?, ?, ?, 'PERCENTAGE', ?, ?, ?, 'ACTIVE')`,
        [ruleId, serviceCategory, level, numericRate, startDate.toISOString(), endDate ? endDate.toISOString() : null, versionRow.version],
        (insertError) => {
          if (insertError) {
            console.error('Commission rule creation failed:', insertError.message);
            return res.status(500).json({ error: 'Failed to create commission rule' });
          }
          logAudit(req.user.id, req.user.role, 'COMMISSION_RULE_CREATE', ruleId, null, 'SUCCESS', {
            serviceCategory, level, rate: numericRate, version: versionRow.version
          });
          res.status(201).json({ id: ruleId, serviceCategory, level, rate: numericRate, version: versionRow.version });
        }
      );
    }
  );
});

app.get('/api/commissions', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const { ownerId, status } = req.query;
  let query = 'SELECT * FROM commission_ledger WHERE 1=1';
  const params = [];

  if (req.user.role === 'FRANCHISE_OWNER') {
    const franchiseIds = req.user.franchiseIds || [];
    if (!franchiseIds.length) return res.status(403).json({ error: 'Franchise owner scope is not configured' });
    query += ` AND owner_id IN (SELECT owner_id FROM franchises WHERE id IN (${franchiseIds.map(() => '?').join(', ')}) AND owner_id IS NOT NULL)`;
    params.push(...franchiseIds);
  }

  if (ownerId) {
    if (req.user.role === 'FRANCHISE_OWNER' && !canReadCommissionOwner(req.user, ownerId)) {
      return res.status(403).json({ error: 'Cannot view commission records outside your franchise scope' });
    }
    query += ' AND owner_id = ?';
    params.push(ownerId);
  }
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  db.all(query, params, (err, commissions) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch commissions' });
    }
    res.json(commissions);
  });
});

app.get('/api/commissions/:ownerId', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const { ownerId } = req.params;
  if (req.user.role === 'FRANCHISE_OWNER' && !canReadCommissionOwner(req.user, ownerId)) {
    return res.status(403).json({ error: 'Cannot view commission records outside your franchise scope' });
  }
  let query = 'SELECT * FROM commission_ledger WHERE owner_id = ?';
  const params = [ownerId];
  if (req.user.role === 'FRANCHISE_OWNER') {
    const franchiseIds = req.user.franchiseIds || [];
    if (!franchiseIds.length) return res.status(403).json({ error: 'Franchise owner scope is not configured' });
    query += ` AND owner_id IN (SELECT owner_id FROM franchises WHERE id IN (${franchiseIds.map(() => '?').join(', ')}) AND owner_id IS NOT NULL)`;
    params.push(...franchiseIds);
  }
  db.all(query, params, (err, commissions) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch commissions' });
    }
    res.json(commissions);
  });
});

app.put('/api/commissions/:id/settle', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const commissionId = req.params.id;
  settleCommission(db, commissionId).then((commission) => {
    logAudit(req.user.id, req.user.role, 'COMMISSION_SETTLE', commissionId, null, 'SUCCESS', {
      ownerId: commission.owner_id,
      amount: commission.amount
    });
    res.json({ message: 'Commission settled and wallet credit recorded atomically' });
  }).catch((error) => {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Commission settlement failed:', error.message);
    res.status(500).json({ error: 'Failed to settle commission and record wallet credit' });
  });
});

// Dashboard routes
app.get('/api/health', (req, res) => {
  if (!databaseReady) {
    return res.status(503).json({ status: 'NOT_READY', database: 'NOT_READY' });
  }
  db.get('PRAGMA foreign_keys', (foreignKeyError, foreignKeyRow) => {
    if (foreignKeyError) {
      return res.status(503).json({ status: 'NOT_READY', database: 'UNAVAILABLE' });
    }
    db.get('SELECT MAX(version) AS schemaVersion FROM schema_migrations', (schemaError, schemaRow) => {
      if (schemaError || schemaRow.schemaVersion !== latestSchemaVersion || foreignKeyRow.foreign_keys !== 1) {
        return res.status(503).json({ status: 'NOT_READY', database: 'NOT_READY' });
      }
      res.json({
        status: 'OK',
        database: 'OK',
        schemaVersion: schemaRow.schemaVersion
      });
    });
  });
});

app.get('/api/dashboard', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const scope = getFranchiseScopeFilter(req.user, 'e.franchise_id');
  if (!scope) return res.status(403).json({ error: 'Franchise owner scope is not configured' });
  const ownerScope = req.user.role === 'FRANCHISE_OWNER';
  const orderAttributionScope = getAttributionScopeFilter(req.user, 'oa');
  const customerAttributionScope = getAttributionScopeFilter(req.user, 'ca');
  const scopedOrder = ownerScope
    ? `EXISTS (
        SELECT 1 FROM order_attribution oa
        WHERE oa.order_id = o.id AND ${orderAttributionScope.clause}
      )`
    : '1=1';
  const orderParams = ownerScope ? orderAttributionScope.params : [];
  const customerScope = ownerScope
    ? `EXISTS (
        SELECT 1 FROM customer_attributions ca
        WHERE ca.customer_id = c.id AND ca.status = 'MAPPED'
          AND ${customerAttributionScope.clause}
      )`
    : '1=1';
  const customerParams = ownerScope ? customerAttributionScope.params : [];
  const count = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row.count));
  });
  const sum = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(Number(row.amount || 0)));
  });
  const countQueries = [
    count(`SELECT COUNT(*) AS count FROM customers c WHERE ${customerScope}`, customerParams),
    count(`SELECT COUNT(*) AS count FROM orders o WHERE ${scopedOrder}`, orderParams),
    count(`SELECT COUNT(*) AS count FROM orders o WHERE o.status = 'PENDING' AND ${scopedOrder}`, orderParams),
    count(`SELECT COUNT(*) AS count FROM orders o WHERE o.status IN ('CONFIRMED', 'SIMULATED_SUCCESS') AND ${scopedOrder}`, orderParams),
    count(ownerScope
      ? `SELECT COUNT(*) AS count FROM commission_ledger WHERE owner_id = ? AND status = 'PENDING'`
      : `SELECT COUNT(*) AS count FROM commission_ledger WHERE status = 'PENDING'`,
    ownerScope ? [req.user.id] : []),
    count(ownerScope
      ? `SELECT COUNT(*) AS count FROM commission_ledger WHERE owner_id = ? AND status = 'SETTLED'`
      : `SELECT COUNT(*) AS count FROM commission_ledger WHERE status = 'SETTLED'`,
    ownerScope ? [req.user.id] : []),
    count(`SELECT COUNT(*) AS count FROM employees e WHERE ${scope.clause}`, scope.params),
    count(`SELECT COUNT(*) AS count FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.date = ? AND ${scope.clause}`, [getIndiaDateString(), ...scope.params]),
    count(`SELECT COUNT(*) AS count FROM leave_requests lr
      JOIN employees e ON e.id = lr.employee_id
      WHERE lr.status = 'PENDING' AND ${scope.clause}`, scope.params),
    count(`SELECT COUNT(*) AS count FROM targets t
      JOIN employees e ON e.id = t.employee_id
      WHERE t.status = 'ACTIVE' AND ${scope.clause}`, scope.params)
  ];
  const amountQuery = sum(
    `SELECT COALESCE(SUM(o.amount), 0) AS amount FROM orders o WHERE ${scopedOrder}`,
    orderParams
  );
  if (!ownerScope) {
    countQueries.push(
      count('SELECT COUNT(*) AS count FROM users WHERE role = ?', ['FRANCHISE_OWNER']),
      count('SELECT COUNT(*) AS count FROM franchises WHERE status = ?', ['ACTIVE']),
      count('SELECT COUNT(*) AS count FROM users'),
      count(`SELECT COUNT(*) AS count FROM customer_attributions WHERE status = 'UNMAPPED'`)
    );
  }

  const amountIndex = countQueries.length;
  Promise.all([...countQueries, amountQuery]).then((values) => {
    res.json({
      totalCustomers: values[0],
      totalOrders: values[1],
      pendingOrders: values[2],
      confirmedOrders: values[3],
      pendingCommissions: values[4],
      settledCommissions: values[5],
      totalEmployees: values[6],
      attendanceToday: values[7],
      pendingLeaves: values[8],
      activeTargets: values[9],
      totalOrderAmount: values[amountIndex],
      ...(ownerScope
        ? { franchiseCount: req.user.franchiseIds.length }
        : {
            totalFranchiseOwners: values[10],
            totalFranchises: values[11],
            totalUsers: values[12],
            unmappedCustomers: values[13],
            pendingActions: values[8] + values[13]
          })
    });
  }).catch((error) => {
    console.error('Dashboard metrics query failed:', error.message);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  });
});

app.get('/api/franchise/customers', authenticateToken, checkRole(['FRANCHISE_OWNER']), (req, res) => {
  const scope = getAttributionScopeFilter(req.user, 'ca');
  if (!scope) return res.status(403).json({ error: 'Franchise owner scope is not configured' });
  db.all(
    `WITH latest AS (
       SELECT customer_id, MAX(rowid) AS attribution_rowid
       FROM customer_attributions
       WHERE status = 'MAPPED'
       GROUP BY customer_id
     )
     SELECT c.id AS customer_id, c.name, c.mobile, c.email, c.status,
       ca.location_id, ca.point_id, ca.node_id, ca.created_at AS mapped_at
     FROM latest l
     JOIN customer_attributions ca ON ca.rowid = l.attribution_rowid
     JOIN customers c ON c.id = ca.customer_id
     WHERE ${scope.clause}
     ORDER BY ca.created_at DESC
     LIMIT 100`,
    scope.params,
    (error, customers) => {
      if (error) {
        console.error('Franchise customer query failed:', error.message);
        return res.status(500).json({ error: 'Failed to fetch franchise customers' });
      }
      res.json(customers);
    }
  );
});

app.get('/api/franchise/orders', authenticateToken, checkRole(['FRANCHISE_OWNER']), (req, res) => {
  const scope = getAttributionScopeFilter(req.user, 'oa');
  if (!scope) return res.status(403).json({ error: 'Franchise owner scope is not configured' });
  db.all(
    `SELECT o.id AS order_id, o.status, o.amount, o.created_at, o.subscriber_mobile,
       o.operator, o.circle, c.name AS customer_name, c.mobile AS customer_mobile,
       s.name AS service_name, oa.point_id, oa.node_id
     FROM orders o
     JOIN order_attribution oa ON oa.order_id = o.id
     LEFT JOIN customers c ON c.id = o.customer_id
     LEFT JOIN services s ON s.id = o.service_id
     WHERE ${scope.clause}
     ORDER BY o.created_at DESC
     LIMIT 100`,
    scope.params,
    (error, orders) => {
      if (error) {
        console.error('Franchise order query failed:', error.message);
        return res.status(500).json({ error: 'Failed to fetch franchise orders' });
      }
      res.json(orders);
    }
  );
});

app.get('/api/franchise/services', authenticateToken, checkRole(['FRANCHISE_OWNER']), (req, res) => {
  db.all(
    `SELECT id, name, category FROM services WHERE status = 'ACTIVE' ORDER BY name`,
    [],
    (error, services) => {
      if (error) {
        console.error('Franchise service query failed:', error.message);
        return res.status(500).json({ error: 'Failed to fetch available services' });
      }
      res.json(services);
    }
  );
});

app.get('/api/day12/readiness', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  db.all(
    'SELECT task_id AS taskId, status, score, evidence, updated_by AS updatedBy, updated_at AS updatedAt FROM day12_readiness ORDER BY rowid',
    [],
    (err, tasks) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch Day 12 readiness tasks' });
      }

      const completedTasks = tasks.filter((task) => task.status === 'COMPLETE').length;
      res.json({
        totalMarks: tasks.reduce((total, task) => total + task.score, 0),
        possibleMarks: 100,
        completedTasks,
        totalTasks: DAY12_READINESS_TASKS.length,
        tasks
      });
    }
  );
});

app.put('/api/day12/readiness/:taskId', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { taskId } = req.params;
  const { status, score, evidence = '' } = req.body;

  if (!DAY12_READINESS_TASKS.includes(taskId)) {
    return res.status(404).json({ error: 'Day 12 readiness task not found' });
  }
  if (!['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETE'].includes(status)) {
    return res.status(400).json({ error: 'A valid readiness status is required' });
  }
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    return res.status(400).json({ error: 'Score must be a whole number from 0 to 10' });
  }
  if (typeof evidence !== 'string' || evidence.length > 2000) {
    return res.status(400).json({ error: 'Evidence must be text of no more than 2000 characters' });
  }

  db.run(
    `UPDATE day12_readiness
     SET status = ?, score = ?, evidence = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
     WHERE task_id = ?`,
    [status, score, evidence.trim(), req.user.id, taskId],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to update Day 12 readiness task' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Day 12 readiness task not found' });
      }

      logAudit(req.user.id, req.user.role, 'DAY12_READINESS_UPDATE', taskId, null, 'SUCCESS', {
        status,
        score
      });
      res.json({ message: 'Day 12 readiness task updated' });
    }
  );
});

app.get('/api/day12/deliverables', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  db.all(
    `SELECT deliverable_id AS deliverableId, verified, evidence,
      updated_by AS updatedBy, updated_at AS updatedAt
     FROM day12_deliverables ORDER BY rowid`,
    [],
    (err, deliverables) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch Day 12 deliverables' });
      }
      res.json({
        verifiedCount: deliverables.filter((item) => item.verified === 1).length,
        totalDeliverables: DAY12_DELIVERABLES.length,
        deliverables
      });
    }
  );
});

app.put('/api/day12/deliverables/:deliverableId', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { deliverableId } = req.params;
  const { verified, evidence = '' } = req.body;

  if (!DAY12_DELIVERABLES.includes(deliverableId)) {
    return res.status(404).json({ error: 'Day 12 deliverable not found' });
  }
  if (typeof verified !== 'boolean') {
    return res.status(400).json({ error: 'Verified must be true or false' });
  }
  if (typeof evidence !== 'string' || evidence.length > 2000) {
    return res.status(400).json({ error: 'Evidence must be text of no more than 2000 characters' });
  }

  db.run(
    `UPDATE day12_deliverables
     SET verified = ?, evidence = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
     WHERE deliverable_id = ?`,
    [verified ? 1 : 0, evidence.trim(), req.user.id, deliverableId],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to update Day 12 deliverable' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Day 12 deliverable not found' });
      }
      logAudit(req.user.id, req.user.role, 'DAY12_DELIVERABLE_UPDATE', deliverableId, null, 'SUCCESS', {
        verified
      });
      res.json({ message: 'Day 12 deliverable updated' });
    }
  );
});

app.get('/api/reports/commissions', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const { startDate, endDate } = req.query;
  let query = 'SELECT * FROM commission_ledger WHERE 1=1';
  const params = [];

  if (req.user.role === 'FRANCHISE_OWNER') {
    const franchiseIds = req.user.franchiseIds || [];
    if (!franchiseIds.length) return res.status(403).json({ error: 'Franchise owner scope is not configured' });
    query += ` AND owner_id IN (SELECT owner_id FROM franchises WHERE id IN (${franchiseIds.map(() => '?').join(', ')}) AND owner_id IS NOT NULL)`;
    params.push(...franchiseIds);
  }
  
  if (startDate) {
    query += ' AND created_at >= ?';
    params.push(startDate);
  }
  
  if (endDate) {
    query += ' AND created_at <= ?';
    params.push(endDate);
  }
  
  db.all(query, params, (err, commissions) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch commission report' });
    }
    res.json(commissions);
  });
});

// Audit logs route
app.get('/api/audit-logs', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { action, actor } = req.query;
  let query = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];
  
  if (action) {
    query += ' AND action = ?';
    params.push(action);
  }
  
  if (actor) {
    query += ' AND actor = ?';
    params.push(actor);
  }
  
  query += ' ORDER BY timestamp DESC LIMIT 100';
  
  db.all(query, params, (err, logs) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
    res.json(logs);
  });
});

// Reports routes - Day 9 features
app.get('/api/reports/franchise-performance', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const customerQuery = `SELECT c.id, c.created_at, ca.status AS mapping_status,
      ca.center_id, ca.hub_id, ca.command_id
    FROM customers c
    LEFT JOIN (
      SELECT current.customer_id, current.status, current.center_id, current.hub_id, current.command_id
      FROM customer_attributions current
      JOIN (
        SELECT customer_id, MAX(rowid) AS latest_rowid
        FROM customer_attributions
        GROUP BY customer_id
      ) latest ON latest.latest_rowid = current.rowid
    ) ca ON ca.customer_id = c.id`;
  Promise.all([
    new Promise((resolve, reject) => db.all(customerQuery, [], (error, customers) => error ? reject(error) : resolve(customers))),
    new Promise((resolve, reject) => db.get(
      "SELECT COUNT(*) AS count FROM franchises WHERE status = 'ACTIVE'",
      [],
      (error, row) => error ? reject(error) : resolve(row.count)
    ))
  ]).then(([customers, totalFranchiseUnits]) => {
    const mappedCustomers = customers.filter((customer) => customer.mapping_status === 'MAPPED');
    const unmappedCustomers = customers.length - mappedCustomers.length;
    const byCenter = {};
    const byHub = {};
    const byCommand = {};
    mappedCustomers.forEach((customer) => {
      if (customer.center_id) byCenter[customer.center_id] = (byCenter[customer.center_id] || 0) + 1;
      if (customer.hub_id) byHub[customer.hub_id] = (byHub[customer.hub_id] || 0) + 1;
      if (customer.command_id) byCommand[customer.command_id] = (byCommand[customer.command_id] || 0) + 1;
    });
    const topCenters = Object.entries(byCenter)
      .map(([id, count]) => ({ id, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 5);
    const topHubs = Object.entries(byHub)
      .map(([id, count]) => ({ id, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 5);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const activeCustomers = customers.filter((customer) => new Date(customer.created_at) >= thirtyDaysAgo);
    const mappingRate = customers.length > 0
      ? Math.round((mappedCustomers.length / customers.length) * 100)
      : 0;

    res.json({
      totalFranchiseUnits,
      totalCustomers: customers.length,
      mappedCustomers: mappedCustomers.length,
      unmappedCustomers,
      activeCustomers: activeCustomers.length,
      totalUsers: customers.length,
      mappedUsers: mappedCustomers.length,
      unmappedUsers: unmappedCustomers,
      activeUsers: activeCustomers.length,
      registrationsByCenter: byCenter,
      registrationsByHub: byHub,
      registrationsByCommand: byCommand,
      topCenters,
      topHubs,
      mappingRate
    });
  }).catch((error) => {
    console.error('Franchise performance report failed:', error.message);
    res.status(500).json({ error: 'Failed to fetch franchise performance report' });
  });
});

app.get('/api/reports/date-range', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { rangeType, customStartDate, customEndDate } = req.query;
  const now = new Date();
  let startDate, endDate, rangeLabel;
  switch (rangeType) {
    case 'today':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      rangeLabel = 'Today';
      break;
    case 'yesterday':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
      rangeLabel = 'Yesterday';
      break;
    case 'last7days':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      rangeLabel = 'Last 7 Days';
      break;
    case 'last30days':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      rangeLabel = 'Last 30 Days';
      break;
    case 'custom':
      if (!isValidIsoDate(customStartDate) || !isValidIsoDate(customEndDate) || customStartDate > customEndDate) {
        return res.status(400).json({ error: 'Custom start and end dates must be valid and in chronological order' });
      }
      startDate = new Date(`${customStartDate}T00:00:00`);
      endDate = new Date(`${customEndDate}T23:59:59.999`);
      rangeLabel = 'Custom Range';
      break;
    default:
      return res.status(400).json({ error: 'Invalid date range type' });
  }

  const customerQuery = `SELECT c.created_at, ca.status AS mapping_status
    FROM customers c
    LEFT JOIN (
      SELECT current.customer_id, current.status
      FROM customer_attributions current
      JOIN (
        SELECT customer_id, MAX(rowid) AS latest_rowid
        FROM customer_attributions
        GROUP BY customer_id
      ) latest ON latest.latest_rowid = current.rowid
    ) ca ON ca.customer_id = c.id`;
  db.all(customerQuery, [], (error, customers) => {
    if (error) {
      console.error('Customer registration report failed:', error.message);
      return res.status(500).json({ error: 'Failed to fetch customer registration report' });
    }
    const customersInRange = customers.filter((customer) => {
      const registeredAt = new Date(customer.created_at);
      return registeredAt >= startDate && registeredAt <= endDate;
    });
    const mappedCount = customersInRange.filter((customer) => customer.mapping_status === 'MAPPED').length;
    res.json({
      rangeLabel,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      totalRegistrations: customersInRange.length,
      mappedRegistrations: mappedCount,
      unmappedRegistrations: customersInRange.length - mappedCount,
      activeRegistrations: customersInRange.length
    });
  });
});

// Export Users API - Day 9 feature
app.get('/api/users/export', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { query, status, startDate, endDate } = req.query;
  
  db.all('SELECT * FROM users', (err, users) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch users' });
    }
    
    let filteredUsers = users;
    if (req.user.role === 'CENTER_ADMIN' && req.user.centerId) {
      filteredUsers = users.filter(u => u.center_id === req.user.centerId);
    } else if (req.user.role === 'HUB_ADMIN' && req.user.hubId) {
      filteredUsers = users.filter(u => u.hub_id === req.user.hubId);
    }
    
    if (query && query.trim() !== '') {
      const normalizedQuery = query.toLowerCase();
      filteredUsers = filteredUsers.filter(u => 
        (u.id && u.id.toLowerCase().includes(normalizedQuery)) ||
        (u.name && u.name.toLowerCase().includes(normalizedQuery)) ||
        (u.mobile && u.mobile.toLowerCase().includes(normalizedQuery)) ||
        (u.email && u.email.toLowerCase().includes(normalizedQuery))
      );
    }
    
    if (status && status !== '') {
      filteredUsers = filteredUsers.filter(u => u.status === status);
    }
    
    if (startDate && startDate !== '') {
      const start = new Date(startDate);
      filteredUsers = filteredUsers.filter(u => new Date(u.created_at) >= start);
    }
    
    if (endDate && endDate !== '') {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filteredUsers = filteredUsers.filter(u => new Date(u.created_at) <= end);
    }
    
    logAudit(req.user.id, req.user.role, 'USER_EXPORT', null, null, 'SUCCESS', { count: filteredUsers.length });
    
    res.json({
      success: true,
      users: filteredUsers,
      recordCount: filteredUsers.length,
      exportedAt: new Date().toISOString()
    });
  });
});

// Automated triggers - Day 9 features
app.post('/api/triggers/daily-summary', authenticateToken, checkRole(['HQ_ADMIN']), async (req, res) => {
  db.all('SELECT * FROM users', (err, users) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch users' });
    }
    
    db.all('SELECT * FROM franchises WHERE status = "ACTIVE"', (err, franchises) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch franchises' });
      }
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayRegistrations = users.filter(u => new Date(u.created_at) >= today);
      const mappedUsers = users.filter(u => u.status === 'MAPPED');
      const unmappedUsers = users.filter(u => u.status === 'NOT MAPPED');
      
      const summary = `Daily Summary Report - ${today.toISOString().split('T')[0]}\n\n` +
        `Total Users: ${users.length}\n` +
        `Mapped Users: ${mappedUsers.length}\n` +
        `Unmapped Users: ${unmappedUsers.length}\n` +
        `Today's Registrations: ${todayRegistrations.length}\n` +
        `Active Franchise Units: ${franchises.length}\n\n` +
        `Mapping Rate: ${users.length > 0 ? Math.round((mappedUsers.length / users.length) * 100) : 0}%`;
      
      logAudit('SYSTEM', 'TRIGGER', 'DAILY_SUMMARY', null, null, 'SUCCESS', { summary });
      
      // Send to HQ Admins
      db.all('SELECT * FROM users WHERE role = "HQ_ADMIN" AND status = "ACTIVE"', async (err, admins) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to fetch admins' });
        }
        
        for (const admin of admins) {
          await sendEmail(admin.email, 'Zyngram Daily Summary Report', summary);
        }
        
        res.json({ success: true, summary, sentTo: admins.length });
      });
    });
  });
});

app.post('/api/triggers/unmapped-users', authenticateToken, checkRole(['HQ_ADMIN']), async (req, res) => {
  db.all('SELECT * FROM users WHERE status = "NOT MAPPED"', (err, unmappedUsers) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch users' });
    }
    
    if (unmappedUsers.length === 0) {
      logAudit('SYSTEM', 'TRIGGER', 'UNMAPPED_CHECK', null, null, 'SUCCESS', { count: 0 });
      return res.json({ success: true, message: 'No unmapped users' });
    }
    
    const message = `Unmapped Users Alert\n\n` +
      `There are ${unmappedUsers.length} unmapped users in the system.\n` +
      `Please review and assign appropriate franchises.\n\n` +
      `Unmapped Users:\n` +
      unmappedUsers.slice(0, 10).map(u => `- ${u.id}: ${u.name} (${u.email})`).join('\n') +
      (unmappedUsers.length > 10 ? `\n... and ${unmappedUsers.length - 10} more` : '');
    
    logAudit('SYSTEM', 'TRIGGER', 'UNMAPPED_CHECK', null, null, 'SUCCESS', { count: unmappedUsers.length });
    
    // Send to HQ Admins
    db.all('SELECT * FROM users WHERE role = "HQ_ADMIN" AND status = "ACTIVE"', async (err, admins) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch admins' });
      }
      
      for (const admin of admins) {
        await sendEmail(admin.email, 'Zyngram Unmapped Users Alert', message);
      }
      
      res.json({ success: true, unmappedCount: unmappedUsers.length, sentTo: admins.length });
    });
  });
});

// Employee Management APIs - Day 11

// Helper function to check franchise scope for Franchise Owner
function checkFranchiseScope(req, franchiseId) {
  return canAccessFranchise(req.user, franchiseId);
}

// Create Employee
app.post('/api/employees', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const {
    employee_id, zin_id, name, profile_photo, mobile, email, date_of_birth,
    gender, address, state, district, department_id, designation_id,
    employment_type, joining_date, reporting_manager_id, work_location_id,
    franchise_id
  } = req.body;
  
  if (!employee_id || !name || !mobile || !email || !joining_date) {
    return res.status(400).json({ error: 'Employee ID, name, mobile, email, and joining date are required' });
  }
  if (!isValidProfilePhoto(profile_photo)) {
    return res.status(400).json({ error: 'Profile photo must be a resized JPEG image smaller than 1.5 MB' });
  }
  
  // Check franchise scope for Franchise Owner
  if (req.user.role === 'FRANCHISE_OWNER' && !checkFranchiseScope(req, franchise_id)) {
    logAudit(req.user.id, req.user.role, 'EMPLOYEE_CREATE_UNAUTHORIZED', null, null, 'FAILED', { franchise_id });
    return res.status(403).json({ error: 'Cannot create employee outside your franchise scope' });
  }
  if (req.user.role === 'FRANCHISE_OWNER' && !req.user.franchiseId) {
    return res.status(403).json({ error: 'Franchise owner scope is not configured' });
  }
  
  const id = uuidv4();
  const optionalFields = [
    zin_id, profile_photo, date_of_birth, gender, address, state, district,
    department_id, designation_id, employment_type, reporting_manager_id,
    work_location_id, franchise_id,
  ].map((value) => value || null);
  db.run(
    `INSERT INTO employees (id, employee_id, zin_id, name, profile_photo, mobile, email, date_of_birth, gender, address, state, district, department_id, designation_id, employment_type, joining_date, reporting_manager_id, work_location_id, franchise_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, employee_id, optionalFields[0], name, optionalFields[1], mobile, email, optionalFields[2], optionalFields[3], optionalFields[4], optionalFields[5], optionalFields[6], optionalFields[7], optionalFields[8], optionalFields[9], joining_date, optionalFields[10], optionalFields[11], optionalFields[12]],
    (err) => {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'Employee ID, ZIN ID, mobile number, or email already exists' });
        }
        console.error('Employee creation failed:', err.message);
        return res.status(500).json({ error: 'Failed to create employee' });
      }
      
      // Create franchise mapping
      if (franchise_id) {
        const mappingId = uuidv4();
        db.run(
          `INSERT INTO employee_franchise_mapping (id, employee_id, franchise_id) VALUES (?, ?, ?)`,
          [mappingId, id, franchise_id]
        );
      }
      
      logAudit(req.user.id, req.user.role, 'EMPLOYEE_CREATE', id, null, 'SUCCESS', { employee_id, name, franchise_id });
      res.json({ id, message: 'Employee created successfully' });
    }
  );
});

// Get Employees with search, filter, pagination
app.get('/api/employees', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const {
    search, department_id, designation_id, franchise_id, status,
    employment_type, state, district, page = 1, limit = 50, sort_by = 'created_at', sort_order = 'DESC'
  } = req.query;
  const sortableColumns = new Set([
    'created_at', 'updated_at', 'employee_id', 'name', 'joining_date', 'status'
  ]);
  const pageNumber = Number(page);
  const pageSize = Number(limit);
  if (!sortableColumns.has(sort_by) || !['ASC', 'DESC'].includes(String(sort_order).toUpperCase())) {
    return res.status(400).json({ error: 'Invalid employee sort field or direction' });
  }
  if (!Number.isInteger(pageNumber) || pageNumber < 1 ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return res.status(400).json({ error: 'Page must be positive and limit must be between 1 and 100' });
  }
  
  let query = 'SELECT * FROM employees WHERE 1=1';
  const params = [];
  
  // Franchise scope check
  if (req.user.role === 'FRANCHISE_OWNER') {
    const franchiseIds = req.user.franchiseIds || [];
    if (!franchiseIds.length) return res.status(403).json({ error: 'Franchise owner scope is not configured' });
    query += ` AND franchise_id IN (${franchiseIds.map(() => '?').join(', ')})`;
    params.push(...franchiseIds);
  }
  
  if (search) {
    query += ' AND (employee_id LIKE ? OR name LIKE ? OR mobile LIKE ? OR email LIKE ?)';
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern, searchPattern);
  }
  
  if (department_id) {
    query += ' AND department_id = ?';
    params.push(department_id);
  }
  
  if (designation_id) {
    query += ' AND designation_id = ?';
    params.push(designation_id);
  }
  
  if (franchise_id && req.user.role === 'HQ_ADMIN') {
    query += ' AND franchise_id = ?';
    params.push(franchise_id);
  }
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  if (employment_type) {
    query += ' AND employment_type = ?';
    params.push(employment_type);
  }
  
  if (state) {
    query += ' AND state = ?';
    params.push(state);
  }
  
  if (district) {
    query += ' AND district = ?';
    params.push(district);
  }
  
  // Count total
  const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
  
  // Add sorting and pagination
  query += ` ORDER BY ${sort_by} ${String(sort_order).toUpperCase()}`;
  const offset = (pageNumber - 1) * pageSize;
  query += ' LIMIT ? OFFSET ?';
  params.push(pageSize, offset);
  
  db.get(countQuery, params.slice(0, params.length - 2), (err, countResult) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to count employees' });
    }
    
    db.all(query, params, (err, employees) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch employees' });
      }
      
      res.json({
        employees,
        total: countResult.total,
        page: pageNumber,
        limit: pageSize,
        totalPages: Math.ceil(countResult.total / pageSize)
      });
    });
  });
});

// Get Single Employee
app.get('/api/employees/:id', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  db.get('SELECT * FROM employees WHERE id = ?', [req.params.id], (err, employee) => {
    if (err || !employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    // Franchise scope check
    if (req.user.role === 'FRANCHISE_OWNER' && !checkFranchiseScope(req, employee.franchise_id)) {
      logAudit(req.user.id, req.user.role, 'EMPLOYEE_VIEW_UNAUTHORIZED', req.params.id, null, 'FAILED', {});
      return res.status(403).json({ error: 'Cannot view employee outside your franchise scope' });
    }
    
    res.json(employee);
  });
});

// Update Employee
app.put('/api/employees/:id', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const {
    name, profile_photo, mobile, email, date_of_birth, gender, address,
    state, district, department_id, designation_id, employment_type,
    reporting_manager_id, work_location_id, franchise_id
  } = req.body;
  if (Object.prototype.hasOwnProperty.call(req.body, 'profile_photo') && !isValidProfilePhoto(profile_photo)) {
    return res.status(400).json({ error: 'Profile photo must be a resized JPEG image smaller than 1.5 MB' });
  }
  
  db.get('SELECT * FROM employees WHERE id = ?', [req.params.id], (err, employee) => {
    if (err || !employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    // Franchise scope check
    if (req.user.role === 'FRANCHISE_OWNER' && !checkFranchiseScope(req, employee.franchise_id)) {
      logAudit(req.user.id, req.user.role, 'EMPLOYEE_UPDATE_UNAUTHORIZED', req.params.id, null, 'FAILED', {});
      return res.status(403).json({ error: 'Cannot update employee outside your franchise scope' });
    }
    if (req.user.role === 'FRANCHISE_OWNER' &&
        Object.prototype.hasOwnProperty.call(req.body, 'franchise_id') &&
        !checkFranchiseScope(req, franchise_id)) {
      logAudit(req.user.id, req.user.role, 'EMPLOYEE_UPDATE_UNAUTHORIZED', req.params.id, null, 'FAILED', { franchise_id });
      return res.status(403).json({ error: 'Cannot assign an employee outside your franchise scope' });
    }
    
    const updates = [];
    const params = [];
    
    if (name) { updates.push('name = ?'); params.push(name); }
    if (Object.prototype.hasOwnProperty.call(req.body, 'profile_photo')) { updates.push('profile_photo = ?'); params.push(profile_photo || null); }
    if (mobile) { updates.push('mobile = ?'); params.push(mobile); }
    if (email) { updates.push('email = ?'); params.push(email); }
    if (date_of_birth) { updates.push('date_of_birth = ?'); params.push(date_of_birth); }
    if (gender) { updates.push('gender = ?'); params.push(gender); }
    if (address) { updates.push('address = ?'); params.push(address); }
    if (state) { updates.push('state = ?'); params.push(state); }
    if (district) { updates.push('district = ?'); params.push(district); }
    if (department_id) { updates.push('department_id = ?'); params.push(department_id); }
    if (designation_id) { updates.push('designation_id = ?'); params.push(designation_id); }
    if (employment_type) { updates.push('employment_type = ?'); params.push(employment_type); }
    if (reporting_manager_id) { updates.push('reporting_manager_id = ?'); params.push(reporting_manager_id); }
    if (work_location_id) { updates.push('work_location_id = ?'); params.push(work_location_id); }
    if (franchise_id) { updates.push('franchise_id = ?'); params.push(franchise_id); }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id);
    
    if (updates.length === 1) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    db.run(
      `UPDATE employees SET ${updates.join(', ')} WHERE id = ?`,
      params,
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to update employee' });
        }
        
        logAudit(req.user.id, req.user.role, 'EMPLOYEE_UPDATE', req.params.id, null, 'SUCCESS', { updates });
        res.json({ message: 'Employee updated successfully' });
      }
    );
  });
});

// Update Employee Status (Soft Delete)
app.patch('/api/employees/:id/status', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const { status } = req.body;
  
  if (!status || !['ACTIVE', 'INACTIVE', 'RESIGNED', 'TERMINATED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be ACTIVE, INACTIVE, RESIGNED, or TERMINATED' });
  }
  
  db.get('SELECT * FROM employees WHERE id = ?', [req.params.id], (err, employee) => {
    if (err || !employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    // Franchise scope check
    if (req.user.role === 'FRANCHISE_OWNER' && !checkFranchiseScope(req, employee.franchise_id)) {
      logAudit(req.user.id, req.user.role, 'EMPLOYEE_STATUS_UNAUTHORIZED', req.params.id, null, 'FAILED', {});
      return res.status(403).json({ error: 'Cannot update status of employee outside your franchise scope' });
    }
    
    db.run(
      'UPDATE employees SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, req.params.id],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to update employee status' });
        }
        
        logAudit(req.user.id, req.user.role, 'EMPLOYEE_STATUS_UPDATE', req.params.id, null, 'SUCCESS', { oldStatus: employee.status, newStatus: status });
        res.json({ message: 'Employee status updated successfully' });
      }
    );
  });
});

// Department Management APIs

// Create Department
app.post('/api/departments', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { name, description } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Department name is required' });
  }
  
  const id = uuidv4();
  
  db.run(
    'INSERT INTO departments (id, name, description) VALUES (?, ?, ?)',
    [id, name, description],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to create department' });
      }
      
      logAudit(req.user.id, req.user.role, 'DEPARTMENT_CREATE', id, null, 'SUCCESS', { name });
      res.json({ id, message: 'Department created successfully' });
    }
  );
});

// Get All Departments
app.get('/api/departments', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const { status } = req.query;
  let query = 'SELECT * FROM departments WHERE 1=1';
  const params = [];
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY name';
  
  db.all(query, params, (err, departments) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch departments' });
    }
    res.json(departments);
  });
});

// Update Department
app.put('/api/departments/:id', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { name, description } = req.body;
  
  db.get('SELECT * FROM departments WHERE id = ?', [req.params.id], (err, department) => {
    if (err || !department) {
      return res.status(404).json({ error: 'Department not found' });
    }
    
    const updates = [];
    const params = [];
    
    if (name) { updates.push('name = ?'); params.push(name); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id);
    
    db.run(
      `UPDATE departments SET ${updates.join(', ')} WHERE id = ?`,
      params,
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to update department' });
        }
        
        logAudit(req.user.id, req.user.role, 'DEPARTMENT_UPDATE', req.params.id, null, 'SUCCESS', { updates });
        res.json({ message: 'Department updated successfully' });
      }
    );
  });
});

// Update Department Status
app.patch('/api/departments/:id/status', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { status } = req.body;
  
  if (!status || !['ACTIVE', 'INACTIVE'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be ACTIVE or INACTIVE' });
  }
  
  db.run(
    'UPDATE departments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [status, req.params.id],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to update department status' });
      }
      
      logAudit(req.user.id, req.user.role, 'DEPARTMENT_STATUS_UPDATE', req.params.id, null, 'SUCCESS', { status });
      res.json({ message: 'Department status updated successfully' });
    }
  );
});

// Designation Management APIs

// Create Designation
app.post('/api/designations', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { name, department_id, description } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Designation name is required' });
  }
  
  const id = uuidv4();
  
  db.run(
    'INSERT INTO designations (id, name, department_id, description) VALUES (?, ?, ?, ?)',
    [id, name, department_id || null, description],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to create designation' });
      }
      
      logAudit(req.user.id, req.user.role, 'DESIGNATION_CREATE', id, null, 'SUCCESS', { name, department_id });
      res.json({ id, message: 'Designation created successfully' });
    }
  );
});

// Get All Designations
app.get('/api/designations', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const { department_id, status } = req.query;
  let query = 'SELECT * FROM designations WHERE 1=1';
  const params = [];
  
  if (department_id) {
    query += ' AND department_id = ?';
    params.push(department_id);
  }
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY name';
  
  db.all(query, params, (err, designations) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch designations' });
    }
    res.json(designations);
  });
});

// Update Designation
app.put('/api/designations/:id', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { name, department_id, description } = req.body;
  
  db.get('SELECT * FROM designations WHERE id = ?', [req.params.id], (err, designation) => {
    if (err || !designation) {
      return res.status(404).json({ error: 'Designation not found' });
    }
    
    const updates = [];
    const params = [];
    
    if (name) { updates.push('name = ?'); params.push(name); }
    if (department_id !== undefined) { updates.push('department_id = ?'); params.push(department_id); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id);
    
    db.run(
      `UPDATE designations SET ${updates.join(', ')} WHERE id = ?`,
      params,
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to update designation' });
        }
        
        logAudit(req.user.id, req.user.role, 'DESIGNATION_UPDATE', req.params.id, null, 'SUCCESS', { updates });
        res.json({ message: 'Designation updated successfully' });
      }
    );
  });
});

// Update Designation Status
app.patch('/api/designations/:id/status', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { status } = req.body;
  
  if (!status || !['ACTIVE', 'INACTIVE'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be ACTIVE or INACTIVE' });
  }
  
  db.run(
    'UPDATE designations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [status, req.params.id],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to update designation status' });
      }
      
      logAudit(req.user.id, req.user.role, 'DESIGNATION_STATUS_UPDATE', req.params.id, null, 'SUCCESS', { status });
      res.json({ message: 'Designation status updated successfully' });
    }
  );
});

// Attendance Management APIs

function getIndiaDateString() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function isValidIsoDate(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

// Check-in
app.post('/api/attendance/check-in', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const { employee_id, work_location_id, latitude, longitude } = req.body;
  
  if (!employee_id) {
    return res.status(400).json({ error: 'Employee ID is required' });
  }
  
  const today = getIndiaDateString();
  const now = new Date().toISOString();
  
  db.get('SELECT franchise_id, status FROM employees WHERE id = ?', [employee_id], (employeeErr, employee) => {
    if (employeeErr) {
      return res.status(500).json({ error: 'Failed to verify employee before check-in' });
    }
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    if (employee.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'Only active employees can be checked in' });
    }
    if (!checkFranchiseScope(req, employee.franchise_id)) {
      return res.status(403).json({ error: 'Cannot check in an employee outside your franchise scope' });
    }

  // Check if already checked in today
  db.get(
    `SELECT a.*, e.franchise_id FROM attendance a
     JOIN employees e ON e.id = a.employee_id
     WHERE a.employee_id = ? AND a.date = ?`,
    [employee_id, today],
    (err, existing) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to check attendance' });
      }
      
      if (existing) {
        return res.status(400).json({ error: 'Already checked in today' });
      }
      
      const id = uuidv4();
      
      db.run(
        'INSERT INTO attendance (id, employee_id, date, check_in_time, work_location_id, attendance_status) VALUES (?, ?, ?, ?, ?, ?)',
        [id, employee_id, today, now, work_location_id, 'PRESENT'],
        (err) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to check in' });
          }
          
          logAudit(req.user.id, req.user.role, 'ATTENDANCE_CHECK_IN', id, null, 'SUCCESS', { employee_id, date: today });
          res.json({ id, message: 'Checked in successfully', checkInTime: now });
        }
      );
    }
  );
  });
});

// Check-out
app.post('/api/attendance/check-out', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const { employee_id } = req.body;
  
  if (!employee_id) {
    return res.status(400).json({ error: 'Employee ID is required' });
  }
  
  const today = getIndiaDateString();
  const now = new Date().toISOString();
  
  db.get(
    `SELECT a.*, e.franchise_id FROM attendance a
     JOIN employees e ON e.id = a.employee_id
     WHERE a.employee_id = ? AND a.date = ?`,
    [employee_id, today],
    (err, attendance) => {
      if (err || !attendance) {
        return res.status(404).json({ error: 'No check-in record found for today' });
      }
      if (!checkFranchiseScope(req, attendance.franchise_id)) {
        return res.status(403).json({ error: 'Cannot check out an employee outside your franchise scope' });
      }
      
      if (attendance.check_out_time) {
        return res.status(400).json({ error: 'Already checked out today' });
      }
      
      // Calculate working hours
      const checkIn = new Date(attendance.check_in_time);
      const checkOut = new Date(now);
      const workingHours = ((checkOut - checkIn) / (1000 * 60 * 60)).toFixed(2);
      
      db.run(
    'UPDATE attendance SET check_out_time = ?, working_hours = ? WHERE id = ?',
    [now, workingHours, attendance.id],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to check out' });
      }
      
      logAudit(req.user.id, req.user.role, 'ATTENDANCE_CHECK_OUT', attendance.id, null, 'SUCCESS', { employee_id, workingHours });
      res.json({ message: 'Checked out successfully', checkOutTime: now, workingHours });
    }
  );
  });
});

// Get Attendance Records
app.get('/api/attendance', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const { employee_id, start_date, end_date, status } = req.query;
  
  let query = 'SELECT a.*, e.name as employee_name, e.employee_id as emp_id FROM attendance a JOIN employees e ON a.employee_id = e.id WHERE 1=1';
  const params = [];
  
  // Franchise scope check
  const scope = getFranchiseScopeFilter(req.user, 'e.franchise_id');
  if (!scope) return res.status(403).json({ error: 'Franchise owner scope is not configured' });
  if (req.user.role !== 'HQ_ADMIN') {
    query += ` AND ${scope.clause}`;
    params.push(...scope.params);
  }
  
  if (employee_id) {
    query += ' AND a.employee_id = ?';
    params.push(employee_id);
  }
  
  if (start_date) {
    query += ' AND a.date >= ?';
    params.push(start_date);
  }
  
  if (end_date) {
    query += ' AND a.date <= ?';
    params.push(end_date);
  }
  
  if (status) {
    query += ' AND a.attendance_status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY a.date DESC, a.check_in_time DESC';
  
  db.all(query, params, (err, attendance) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch attendance' });
    }
    res.json(attendance);
  });
});

// Get Attendance Summary
app.get('/api/attendance/summary', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const { employee_id, start_date, end_date } = req.query;
  
  let query = 'SELECT a.attendance_status, COUNT(*) as count FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE 1=1';
  const params = [];
  
  const scope = getFranchiseScopeFilter(req.user, 'e.franchise_id');
  if (!scope) return res.status(403).json({ error: 'Franchise owner scope is not configured' });
  if (req.user.role !== 'HQ_ADMIN') {
    query += ` AND ${scope.clause}`;
    params.push(...scope.params);
  }
  if (employee_id) {
    query += ' AND a.employee_id = ?';
    params.push(employee_id);
  }
  
  if (start_date) {
    query += ' AND a.date >= ?';
    params.push(start_date);
  }
  
  if (end_date) {
    query += ' AND a.date <= ?';
    params.push(end_date);
  }
  
  query += ' GROUP BY a.attendance_status';
  
  db.all(query, params, (err, summary) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch attendance summary' });
    }
    
    const result = {
      present: 0,
      absent: 0,
      halfDay: 0,
      leave: 0,
      holiday: 0,
      weekOff: 0
    };
    
    summary.forEach(row => {
      const status = row.attendance_status.toUpperCase();
      if (status === 'PRESENT') result.present = row.count;
      else if (status === 'ABSENT') result.absent = row.count;
      else if (status === 'HALF DAY') result.halfDay = row.count;
      else if (status === 'LEAVE') result.leave = row.count;
      else if (status === 'HOLIDAY') result.holiday = row.count;
      else if (status === 'WEEK OFF') result.weekOff = row.count;
    });
    
    const total = result.present + result.absent + result.halfDay + result.leave;
    result.attendancePercentage = total > 0 ? Math.round(((result.present + result.halfDay * 0.5) / total) * 100) : 0;
    
    res.json(result);
  });
});

// Leave Management APIs

// Create Leave Request
app.post('/api/leaves', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const { employee_id, leave_type, start_date, end_date, reason, supporting_document } = req.body;

  if (!employee_id || !leave_type || !start_date || !end_date) {
    return res.status(400).json({ error: 'Employee ID, leave type, start date, and end date are required' });
  }
  const allowedLeaveTypes = ['Sick Leave', 'Casual Leave', 'Earned Leave', 'Maternity Leave', 'Paternity Leave'];
  const isValidDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!allowedLeaveTypes.includes(leave_type)) {
    return res.status(400).json({ error: 'Select a valid leave type' });
  }
  if (!isValidDate(start_date) || !isValidDate(end_date)) {
    return res.status(400).json({ error: 'Enter valid start and end dates' });
  }
  if (end_date < start_date) {
    return res.status(400).json({ error: 'End date cannot be before start date' });
  }

  db.get('SELECT id, franchise_id FROM employees WHERE id = ? AND status = ?', [employee_id, 'ACTIVE'], (employeeError, employee) => {
    if (employeeError) {
      console.error('Leave request employee lookup failed:', employeeError.message);
      return res.status(500).json({ error: 'Could not validate the selected employee' });
    }
    if (!employee) {
      return res.status(400).json({ error: 'Select an existing active employee before submitting a leave request' });
    }
    if (!checkFranchiseScope(req, employee.franchise_id)) {
      return res.status(403).json({ error: 'Cannot submit a leave request outside your franchise scope' });
    }

    const id = uuidv4();
    db.run(
      'INSERT INTO leave_requests (id, employee_id, leave_type, start_date, end_date, reason, supporting_document) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, employee_id, leave_type, start_date, end_date, reason || null, supporting_document || null],
      (err) => {
        if (err) {
          console.error('Leave request creation failed:', err.message);
          return res.status(500).json({ error: 'Failed to create leave request' });
        }

        logAudit(req.user.id, req.user.role, 'LEAVE_REQUEST', id, null, 'SUCCESS', { employee_id, leave_type, start_date, end_date });
        res.json({ id, message: 'Leave request created successfully' });
      }
    );
  });
});

// Get Leave Requests
app.get('/api/leaves', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const { employee_id, status } = req.query;
  
  let query = 'SELECT lr.*, e.name as employee_name, e.employee_id as emp_id FROM leave_requests lr JOIN employees e ON lr.employee_id = e.id WHERE 1=1';
  const params = [];
  
  // Franchise scope check
  const scope = getFranchiseScopeFilter(req.user, 'e.franchise_id');
  if (!scope) return res.status(403).json({ error: 'Franchise owner scope is not configured' });
  if (req.user.role !== 'HQ_ADMIN') {
    query += ` AND ${scope.clause}`;
    params.push(...scope.params);
  }
  
  if (employee_id) {
    query += ' AND lr.employee_id = ?';
    params.push(employee_id);
  }
  
  if (status) {
    query += ' AND lr.status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY lr.created_at DESC';
  
  db.all(query, params, (err, leaves) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch leave requests' });
    }
    res.json(leaves);
  });
});

// Approve Leave Request
app.patch('/api/leaves/:id/approve', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const leaveId = req.params.id;
  
  db.get('SELECT * FROM leave_requests WHERE id = ?', [leaveId], (err, leave) => {
    if (err || !leave) {
      return res.status(404).json({ error: 'Leave request not found' });
    }
    
    if (leave.status !== 'PENDING') {
      return res.status(400).json({ error: 'Leave request already processed' });
    }

    db.get('SELECT franchise_id FROM employees WHERE id = ?', [leave.employee_id], (employeeError, employee) => {
      if (employeeError) return res.status(500).json({ error: 'Failed to validate leave request scope' });
      if (!employee || !checkFranchiseScope(req, employee.franchise_id)) {
        return res.status(403).json({ error: 'Cannot approve a leave request outside your franchise scope' });
      }

    db.run(
      'UPDATE leave_requests SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['APPROVED', req.user.id, leaveId],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to approve leave request' });
        }
        
        logAudit(req.user.id, req.user.role, 'LEAVE_APPROVE', leaveId, null, 'SUCCESS', { employee_id: leave.employee_id });
        res.json({ message: 'Leave request approved successfully' });
      }
    );
    });
  });
});

// Reject Leave Request
app.patch('/api/leaves/:id/reject', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const { rejection_reason } = req.body;
  const leaveId = req.params.id;
  
  db.get('SELECT * FROM leave_requests WHERE id = ?', [leaveId], (err, leave) => {
    if (err || !leave) {
      return res.status(404).json({ error: 'Leave request not found' });
    }
    
    if (leave.status !== 'PENDING') {
      return res.status(400).json({ error: 'Leave request already processed' });
    }

    db.get('SELECT franchise_id FROM employees WHERE id = ?', [leave.employee_id], (employeeError, employee) => {
      if (employeeError) return res.status(500).json({ error: 'Failed to validate leave request scope' });
      if (!employee || !checkFranchiseScope(req, employee.franchise_id)) {
        return res.status(403).json({ error: 'Cannot reject a leave request outside your franchise scope' });
      }

    db.run(
      'UPDATE leave_requests SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, rejection_reason = ? WHERE id = ?',
      ['REJECTED', req.user.id, rejection_reason, leaveId],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to reject leave request' });
        }
        
        logAudit(req.user.id, req.user.role, 'LEAVE_REJECT', leaveId, null, 'SUCCESS', { employee_id: leave.employee_id, reason: rejection_reason });
        res.json({ message: 'Leave request rejected successfully' });
      }
    );
    });
  });
});

// Targets & KPIs APIs

// Create Target
app.post('/api/targets', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const {
    employee_id, department_id, designation_id, target_period,
    target_type, target_value
  } = req.body;
  
  if (!employee_id || !target_period || !target_type ||
      !Number.isFinite(Number(target_value)) || Number(target_value) <= 0) {
    return res.status(400).json({ error: 'Employee ID, target period, target type, and target value are required' });
  }

  db.get('SELECT franchise_id FROM employees WHERE id = ?', [employee_id], (employeeError, employee) => {
    if (employeeError) return res.status(500).json({ error: 'Failed to validate target employee' });
    if (!employee) return res.status(404).json({ error: 'Target employee not found' });
    if (!checkFranchiseScope(req, employee.franchise_id)) {
      return res.status(403).json({ error: 'Cannot create a target outside your franchise scope' });
    }
    const id = uuidv4();
    db.run(
    'INSERT INTO targets (id, employee_id, department_id, designation_id, target_period, target_type, target_value) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, employee_id, department_id || null, designation_id || null, target_period, target_type, Number(target_value)],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to create target' });
      }
      
      logAudit(req.user.id, req.user.role, 'TARGET_CREATE', id, null, 'SUCCESS', { employee_id, target_type, target_value });
      res.json({ id, message: 'Target created successfully' });
    }
  );
  });
});

// Get Targets
app.get('/api/targets', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const { employee_id, department_id, designation_id, status } = req.query;
  
  let query = 'SELECT t.*, e.name as employee_name, e.employee_id as emp_id FROM targets t JOIN employees e ON t.employee_id = e.id WHERE 1=1';
  const params = [];
  
  // Franchise scope check
  const scope = getFranchiseScopeFilter(req.user, 'e.franchise_id');
  if (!scope) return res.status(403).json({ error: 'Franchise owner scope is not configured' });
  if (req.user.role !== 'HQ_ADMIN') {
    query += ` AND ${scope.clause}`;
    params.push(...scope.params);
  }
  
  if (employee_id) {
    query += ' AND t.employee_id = ?';
    params.push(employee_id);
  }
  
  if (department_id) {
    query += ' AND t.department_id = ?';
    params.push(department_id);
  }
  
  if (designation_id) {
    query += ' AND t.designation_id = ?';
    params.push(designation_id);
  }
  
  if (status) {
    query += ' AND t.status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY t.target_period DESC';
  
  db.all(query, params, (err, targets) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch targets' });
    }
    res.json(targets);
  });
});

// Update Target
app.put('/api/targets/:id', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const { achievement, achievement_percentage, status } = req.body;

  if (achievement !== undefined && (!Number.isFinite(achievement) || achievement < 0)) {
    return res.status(400).json({ error: 'Achievement must be a number greater than or equal to 0' });
  }
  
  db.get('SELECT * FROM targets WHERE id = ?', [req.params.id], (err, target) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch target' });
    }
    if (!target) {
      return res.status(404).json({ error: 'Target not found' });
    }
    db.get('SELECT franchise_id FROM employees WHERE id = ?', [target.employee_id], (employeeError, employee) => {
      if (employeeError) return res.status(500).json({ error: 'Failed to validate target scope' });
      if (!employee || !checkFranchiseScope(req, employee.franchise_id)) {
        return res.status(403).json({ error: 'Cannot update a target outside your franchise scope' });
      }
    
    const updates = [];
    const params = [];
    
    if (achievement !== undefined) {
      updates.push('achievement = ?');
      params.push(achievement);
      updates.push('achievement_percentage = ?');
      params.push(target.target_value > 0 ? Math.round((achievement / target.target_value) * 100) : 0);
    }
    if (achievement_percentage !== undefined && achievement === undefined) {
      updates.push('achievement_percentage = ?');
      params.push(achievement_percentage);
    }
    if (status) { updates.push('status = ?'); params.push(status); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id);
    
    db.run(
      `UPDATE targets SET ${updates.join(', ')} WHERE id = ?`,
      params,
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to update target' });
        }
        
        logAudit(req.user.id, req.user.role, 'TARGET_UPDATE', req.params.id, null, 'SUCCESS', { updates });
        res.json({ message: 'Target updated successfully' });
      }
    );
    });
  });
});

// Document Management APIs

// Upload Document
app.post('/api/employees/:id/documents', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const employeeId = req.params.id;
  const { document_type, document_name, file_data, expiry_date } = req.body;
  const fileMatch = typeof file_data === 'string'
    ? file_data.match(/^data:(application\/pdf|image\/jpeg|image\/png|image\/webp);base64,([A-Za-z0-9+/]+={0,2})$/)
    : null;
  const allowedTypes = ['ID Proof', 'Address Proof', 'Qualification', 'Offer Letter', 'Experience Letter', 'Other'];
  
  if (!allowedTypes.includes(document_type)) {
    return res.status(400).json({ error: 'Select a valid document type' });
  }
  if (!fileMatch) {
    return res.status(400).json({ error: 'Select a PDF, JPG, PNG, or WebP document to upload' });
  }
  const fileBuffer = Buffer.from(fileMatch[2], 'base64');
  if (!fileBuffer.length || fileBuffer.length > 5 * 1024 * 1024) {
    return res.status(400).json({ error: 'Document must be between 1 byte and 5 MB' });
  }
  const fileSignatures = {
    'application/pdf': fileBuffer.subarray(0, 5).toString() === '%PDF-',
    'image/jpeg': fileBuffer[0] === 0xff && fileBuffer[1] === 0xd8 && fileBuffer[2] === 0xff,
    'image/png': fileBuffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/webp': fileBuffer.subarray(0, 4).toString() === 'RIFF'
      && fileBuffer.subarray(8, 12).toString() === 'WEBP'
  };
  if (!fileSignatures[fileMatch[1]]) {
    return res.status(400).json({ error: 'File contents do not match the selected document type' });
  }
  if (expiry_date && !isValidIsoDate(expiry_date)) {
    return res.status(400).json({ error: 'Expiry date must be a valid date' });
  }
  
  // Check employee access
  db.get('SELECT * FROM employees WHERE id = ?', [employeeId], (err, employee) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to verify employee for document upload' });
    }
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    // Franchise scope check
    if (!checkFranchiseScope(req, employee.franchise_id)) {
      logAudit(req.user.id, req.user.role, 'DOCUMENT_UPLOAD_UNAUTHORIZED', employeeId, null, 'FAILED', {});
      return res.status(403).json({ error: 'Cannot upload document for employee outside your franchise scope' });
    }
    
    const id = uuidv4();
    const extensions = {
      'application/pdf': '.pdf',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp'
    };
    const fileName = `${id}${extensions[fileMatch[1]]}`;
    const relativePath = `uploads/employee-documents/${fileName}`;
    const absolutePath = path.join(employeeDocumentsDirectory, fileName);
    const uploadDirectory = path.dirname(absolutePath);

    fs.promises.mkdir(uploadDirectory, { recursive: true })
      .then(() => fs.promises.writeFile(absolutePath, fileBuffer, { flag: 'wx' }))
      .then(() => new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO employee_documents (id, employee_id, document_type, document_name, file_path, expiry_date, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, employeeId, document_type, document_name || null, relativePath, expiry_date || null, req.user.id],
          (insertError) => insertError ? reject(insertError) : resolve()
        );
      }))
      .then(() => {
        logAudit(req.user.id, req.user.role, 'DOCUMENT_UPLOAD', id, null, 'SUCCESS', { employeeId, document_type });
        res.json({ id, message: 'Document uploaded successfully' });
      })
      .catch((uploadError) => {
        fs.promises.unlink(absolutePath).catch((cleanupError) => {
          if (cleanupError.code !== 'ENOENT') console.error('Failed to remove incomplete document upload:', cleanupError.message);
        });
        console.error('Document upload failed:', uploadError.message);
        res.status(500).json({ error: 'Failed to save uploaded document' });
      });
  });
});

// Get all employee documents
app.get('/api/employees/all/documents', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  let query = `SELECT ed.*, e.name AS employee_name, e.employee_id AS employee_code, e.franchise_id
    FROM employee_documents ed
    JOIN employees e ON e.id = ed.employee_id`;
  const params = [];

  if (req.user.role === 'FRANCHISE_OWNER') {
    const franchiseIds = req.user.franchiseIds || [];
    if (!franchiseIds.length) return res.status(403).json({ error: 'Franchise owner scope is not configured' });
    query += ` WHERE e.franchise_id IN (${franchiseIds.map(() => '?').join(', ')})`;
    params.push(...franchiseIds);
  }
  query += ' ORDER BY ed.uploaded_at DESC';

  db.all(query, params, (err, documents) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch documents' });
    }
    res.json(documents);
  });
});

// Download an employee document
app.get('/api/documents/:id/download', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  db.get(
    'SELECT ed.*, e.franchise_id FROM employee_documents ed JOIN employees e ON e.id = ed.employee_id WHERE ed.id = ?',
    [req.params.id],
    (err, document) => {
      if (err) return res.status(500).json({ error: 'Failed to find document' });
      if (!document) return res.status(404).json({ error: 'Document not found' });
      if (!checkFranchiseScope(req, document.franchise_id)) {
        return res.status(403).json({ error: 'Cannot download a document outside your franchise scope' });
      }

      const absolutePath = resolveEmployeeDocumentPath(document.file_path);
      if (!absolutePath) {
        return res.status(404).json({ error: 'Document file not found' });
      }
      res.download(absolutePath, document.document_name || path.basename(absolutePath), (downloadError) => {
        if (downloadError && !res.headersSent) {
          if (downloadError.code === 'ENOENT') return res.status(404).json({ error: 'Document file not found' });
          console.error('Document download failed:', downloadError.message);
          return res.status(500).json({ error: 'Failed to download document' });
        }
      });
    }
  );
});

// Get Employee Documents
app.get('/api/employees/:id/documents', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const employeeId = req.params.id;
  
  db.get('SELECT * FROM employees WHERE id = ?', [employeeId], (err, employee) => {
    if (err || !employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    // Franchise scope check
    if (!checkFranchiseScope(req, employee.franchise_id)) {
      return res.status(403).json({ error: 'Cannot view documents for employee outside your franchise scope' });
    }
    
    db.all('SELECT * FROM employee_documents WHERE employee_id = ? ORDER BY uploaded_at DESC', [employeeId], (err, documents) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch documents' });
      }
      res.json(documents);
    });
  });
});

// Delete Document
app.delete('/api/documents/:id', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const documentId = req.params.id;
  
  db.get('SELECT ed.*, e.franchise_id FROM employee_documents ed JOIN employees e ON ed.employee_id = e.id WHERE ed.id = ?', [documentId], (err, document) => {
    if (err || !document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    // Franchise scope check
    if (!checkFranchiseScope(req, document.franchise_id)) {
      logAudit(req.user.id, req.user.role, 'DOCUMENT_DELETE_UNAUTHORIZED', documentId, null, 'FAILED', {});
      return res.status(403).json({ error: 'Cannot delete document outside your franchise scope' });
    }
    
    db.run('DELETE FROM employee_documents WHERE id = ?', [documentId], (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to delete document' });
      }

      const absolutePath = resolveEmployeeDocumentPath(document.file_path);
      if (absolutePath) {
        fs.promises.unlink(absolutePath).catch((fileError) => {
          if (fileError.code !== 'ENOENT') console.error('Failed to remove deleted document file:', fileError.message);
        });
      }

      logAudit(req.user.id, req.user.role, 'DOCUMENT_DELETE', documentId, null, 'SUCCESS', { employee_id: document.employee_id });
      res.json({ message: 'Document deleted successfully' });
    });
  });
});

// Employee Reports APIs

// Employee Summary Report
app.get('/api/reports/employee-summary', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  let query = 'SELECT * FROM employees e WHERE 1=1';
  const params = [];
  
  const scope = getFranchiseScopeFilter(req.user, 'e.franchise_id');
  if (!scope) return res.status(403).json({ error: 'Franchise owner scope is not configured' });
  if (req.user.role !== 'HQ_ADMIN') {
    query += ` AND ${scope.clause}`;
    params.push(...scope.params);
  }
  
  db.all(query, params, (err, employees) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch employees' });
    }
    
    const total = employees.length;
    const active = employees.filter(e => e.status === 'ACTIVE').length;
    const inactive = employees.filter(e => e.status === 'INACTIVE').length;
    const resigned = employees.filter(e => e.status === 'RESIGNED').length;
    const terminated = employees.filter(e => e.status === 'TERMINATED').length;
    
    // Department-wise
    const byDepartment = {};
    employees.forEach(e => {
      if (e.department_id) {
        byDepartment[e.department_id] = (byDepartment[e.department_id] || 0) + 1;
      }
    });
    
    // Designation-wise
    const byDesignation = {};
    employees.forEach(e => {
      if (e.designation_id) {
        byDesignation[e.designation_id] = (byDesignation[e.designation_id] || 0) + 1;
      }
    });
    
    // Franchise-wise
    const byFranchise = {};
    employees.forEach(e => {
      if (e.franchise_id) {
        byFranchise[e.franchise_id] = (byFranchise[e.franchise_id] || 0) + 1;
      }
    });
    
    res.json({
      total,
      active,
      inactive,
      resigned,
      terminated,
      byDepartment,
      byDesignation,
      byFranchise
    });
  });
});

// Attendance Report
app.get('/api/reports/attendance', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  const { start_date, end_date } = req.query;
  if ((start_date && !isValidIsoDate(start_date)) || (end_date && !isValidIsoDate(end_date))) {
    return res.status(400).json({ error: 'Start and end dates must be valid YYYY-MM-DD dates' });
  }
  if (start_date && end_date && start_date > end_date) {
    return res.status(400).json({ error: 'Start date must be on or before the end date' });
  }
  
  let query = 'SELECT a.*, e.name as employee_name, e.employee_id, e.franchise_id FROM attendance a JOIN employees e ON a.employee_id = e.id WHERE 1=1';
  const params = [];
  
  const scope = getFranchiseScopeFilter(req.user, 'e.franchise_id');
  if (!scope) return res.status(403).json({ error: 'Franchise owner scope is not configured' });
  if (req.user.role !== 'HQ_ADMIN') {
    query += ` AND ${scope.clause}`;
    params.push(...scope.params);
  }
  
  if (start_date) {
    query += ' AND a.date >= ?';
    params.push(start_date);
  }
  
  if (end_date) {
    query += ' AND a.date <= ?';
    params.push(end_date);
  }
  
  db.all(query, params, (err, attendance) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch attendance' });
    }
    
    const present = attendance.filter(a => a.attendance_status?.trim().toUpperCase() === 'PRESENT').length;
    const absent = attendance.filter(a => a.attendance_status?.trim().toUpperCase() === 'ABSENT').length;
    const halfDay = attendance.filter(a => a.attendance_status?.trim().toUpperCase() === 'HALF DAY').length;
    const leave = attendance.filter(a => a.attendance_status?.trim().toUpperCase() === 'LEAVE').length;
    const total = present + absent + halfDay + leave;
    const attendancePercentage = total > 0 ? Math.round(((present + halfDay * 0.5) / total) * 100) : 0;
    
    res.json({
      total,
      present,
      absent,
      halfDay,
      leave,
      attendancePercentage,
      records: attendance
    });
  });
});

// Target Achievement Report
app.get('/api/reports/targets', authenticateToken, checkRole(['HQ_ADMIN', 'FRANCHISE_OWNER']), (req, res) => {
  let query = 'SELECT t.*, e.name as employee_name, e.employee_id, e.franchise_id FROM targets t JOIN employees e ON t.employee_id = e.id WHERE 1=1';
  const params = [];
  
  const scope = getFranchiseScopeFilter(req.user, 'e.franchise_id');
  if (!scope) return res.status(403).json({ error: 'Franchise owner scope is not configured' });
  if (req.user.role !== 'HQ_ADMIN') {
    query += ` AND ${scope.clause}`;
    params.push(...scope.params);
  }
  
  db.all(query, params, (err, targets) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch targets' });
    }
    
    const total = targets.length;
    const achieved = targets.filter(t => t.achievement_percentage >= 100).length;
    const belowTarget = targets.filter(t => t.achievement_percentage < 100 && t.achievement_percentage >= 50).length;
    const poor = targets.filter(t => t.achievement_percentage < 50).length;
    
    const totalTargetValue = targets.reduce((sum, t) => sum + (t.target_value || 0), 0);
    const totalAchievement = targets.reduce((sum, t) => sum + (t.achievement || 0), 0);
    const overallAchievementPercentage = totalTargetValue > 0 ? Math.round((totalAchievement / totalTargetValue) * 100) : 0;
    
    res.json({
      total,
      achieved,
      belowTarget,
      poor,
      totalTargetValue,
      totalAchievement,
      overallAchievementPercentage,
      targets
    });
  });
});

// Franchise Employee Report
app.get('/api/reports/franchise-employees', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  db.all('SELECT f.id, f.name, f.level, COUNT(e.id) as employee_count FROM franchises f LEFT JOIN employees e ON f.id = e.franchise_id WHERE f.status = "ACTIVE" GROUP BY f.id', (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch franchise employee report' });
    }
    
    // Get active employees per franchise
    db.all('SELECT f.id, COUNT(e.id) as active_count FROM franchises f LEFT JOIN employees e ON f.id = e.franchise_id AND e.status = "ACTIVE" WHERE f.status = "ACTIVE" GROUP BY f.id', (err, activeResults) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch active employees' });
      }
      
      const activeMap = {};
      activeResults.forEach(r => activeMap[r.id] = r.active_count);
      
      const report = results.map(r => ({
        ...r,
        activeEmployees: activeMap[r.id] || 0
      }));
      
      res.json(report);
    });
  });
});

// Start server only with explicit production secrets and browser origins.
const productionConfigErrors = process.env.NODE_ENV === 'production'
  ? [
      !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 ||
        process.env.JWT_SECRET === 'zyngram-secret-key-change-in-production'
        ? 'JWT_SECRET must be set to at least 32 characters'
        : null,
      !process.env.CORS_ORIGINS ? 'CORS_ORIGINS must contain the deployed frontend origin' : null,
      !process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD.length < 12
        ? 'BOOTSTRAP_ADMIN_PASSWORD must be set to at least 12 characters'
        : null
    ].filter(Boolean)
  : [];

if (productionConfigErrors.length) {
  console.error(`Refusing production startup: ${productionConfigErrors.join('; ')}`);
  process.exitCode = 1;
} else {
  app.listen(PORT, () => {
    console.log(`Zyngram Backend Server running on port ${PORT}`);
  });
}
