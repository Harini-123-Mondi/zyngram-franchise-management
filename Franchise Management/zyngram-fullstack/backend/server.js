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
const { parsePolygon, resolveFranchiseMapping } = require('./geoMapping');
const { createUserCodeAssignments, createUserId } = require('./generateReadableUserId');

function isValidCoordinate(value, minimum, maximum) {
  if (value === undefined || value === null || String(value).trim() === '') return false;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= minimum && coordinate <= maximum;
}

function isValidProfilePhoto(value) {
  if (!value) return true;
  if (typeof value !== 'string' || value.length > 2 * 1024 * 1024 ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return false;
  }
  return Buffer.from(value.slice('data:image/jpeg;base64,'.length), 'base64').length <= 1.5 * 1024 * 1024;
}

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'zyngram-secret-key-change-in-production';

// Middleware
app.use(cors());
app.use(express.json({ limit: '8mb' }));

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
const dbPath = path.join(__dirname, 'zyngram.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
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
  
  tables.forEach((tableSQL) => {
    db.run(tableSQL, (err) => {
      if (err) {
        console.error('Error creating table:', err.message);
      }
    });
  });
  
  // Insert default admin user
  const adminId = 'ADM001';
  const hashedPassword = bcrypt.hashSync('admin123', 10);

  const migrateUserCodes = () => {
    db.all('PRAGMA table_info(users)', [], (schemaError, columns) => {
      if (schemaError) {
        console.error('Failed to inspect users schema:', schemaError.message);
        return;
      }
      const populateCodes = () => {
        db.all('SELECT id, user_code FROM users ORDER BY created_at, id', [], (usersError, users) => {
          if (usersError) {
            console.error('Failed to load users for ID migration:', usersError.message);
            return;
          }
          for (const { id, userCode } of createUserCodeAssignments(users)) {
            db.run('UPDATE users SET user_code = ? WHERE id = ? AND user_code IS NULL', [userCode, id], (updateError) => {
              if (updateError) console.error(`Failed to assign readable ID to user ${id}:`, updateError.message);
            });
          }
        });
      };

      if (columns.some((column) => column.name === 'user_code')) {
        return populateCodes();
      }
      db.run('ALTER TABLE users ADD COLUMN user_code TEXT', (migrationError) => {
        if (migrationError) {
          console.error('Failed to add readable user ID column:', migrationError.message);
          return;
        }
        db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_code ON users(user_code)', (indexError) => {
          if (indexError) {
            console.error('Failed to index readable user IDs:', indexError.message);
            return;
          }
          populateCodes();
        });
      });
    });
  };
  
  db.get('SELECT id FROM users WHERE id = ?', [adminId], (err, row) => {
    if (!row) {
      db.run(
        `INSERT INTO users (id, name, mobile, email, password, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [adminId, 'HQ Administrator', '+919999999999', 'admin@zyngram.com', hashedPassword, 'HQ_ADMIN', 'ACTIVE'],
        (err) => {
          if (err) console.error('Error inserting admin:', err.message);
          else console.log('Default admin user created');
          migrateUserCodes();
        }
      );
    } else {
      migrateUserCodes();
    }
  });
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
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Middleware to check role-based access
function checkRole(allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      logAudit(req.user.id, req.user.role, 'UNAUTHORIZED_ACCESS', null, null, 'FAILED', { endpoint: req.path });
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// API Routes

// Auth routes
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

// Location routes
app.post('/api/locations/capture', authenticateToken, (req, res) => {
  const { userId, latitude, longitude, accuracy, country, state, district, city, pin, source } = req.body;

  if (!userId || !isValidCoordinate(latitude, -90, 90) || !isValidCoordinate(longitude, -180, 180)) {
    return res.status(400).json({ error: 'A valid user ID, latitude, and longitude are required' });
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

app.post('/api/geo/reverse-geocode', authenticateToken, (req, res) => {
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

app.get('/api/geo/franchise-map', authenticateToken, (req, res) => {
  if (!isValidCoordinate(req.query.latitude, -90, 90) || !isValidCoordinate(req.query.longitude, -180, 180)) {
    return res.status(400).json({ error: 'Valid latitude and longitude are required' });
  }
  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);
  db.all('SELECT id, level, name, parent_id, status FROM franchises', [], (franchiseError, franchises) => {
    if (franchiseError) return res.status(500).json({ error: 'Failed to load franchise hierarchy' });
    db.all('SELECT franchise_id, geometry, version, status FROM geo_boundaries', [], (boundaryError, boundaries) => {
      if (boundaryError) return res.status(500).json({ error: 'Failed to load franchise boundaries' });
      try {
        res.json(resolveFranchiseMapping(franchises, boundaries, latitude, longitude));
      } catch (error) {
        console.error('Franchise mapping failed:', error.message);
        res.status(500).json({ error: 'A saved franchise boundary is invalid. Review its GeoJSON before mapping.' });
      }
    });
  });
});

app.get('/api/geo/boundaries', authenticateToken, (req, res) => {
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
  db.get('SELECT id FROM franchises WHERE id = ? AND level = ? AND status = ?', [franchise_id, 'POINT', 'ACTIVE'], (franchiseError, franchise) => {
    if (franchiseError) return res.status(500).json({ error: 'Failed to validate Point franchise' });
    if (!franchise) return res.status(400).json({ error: 'The selected franchise must be an active Point' });
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
  ];
  const geometry = {
    type: 'Polygon',
    coordinates: [[[78.50, 17.43], [78.54, 17.43], [78.54, 17.47], [78.50, 17.47], [78.50, 17.43]]],
  };
  const createBoundary = () => {
    db.serialize(() => {
      db.run('BEGIN IMMEDIATE', (beginError) => {
        if (beginError) return res.status(500).json({ error: 'Could not start demo boundary setup' });
        db.get('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM geo_boundaries WHERE franchise_id = ?', ['DEMO-PNT'], (versionError, row) => {
          if (versionError) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: 'Failed to prepare demo boundary' });
          }
          db.run(
            'UPDATE geo_boundaries SET status = ? WHERE franchise_id = ? AND status = ?',
            ['INACTIVE', 'DEMO-PNT', 'ACTIVE'],
            (updateError) => {
              if (updateError) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: 'Failed to replace demo boundary' });
              }
              db.run(
                'INSERT INTO geo_boundaries (id, franchise_id, geometry, version, status) VALUES (?, ?, ?, ?, ?)',
                [uuidv4(), 'DEMO-PNT', JSON.stringify(geometry), row.version, 'ACTIVE'],
                (insertError) => {
                  if (insertError) {
                    db.run('ROLLBACK');
                    console.error('Demo boundary setup failed:', insertError.message);
                    return res.status(500).json({ error: 'Failed to create demo boundary' });
                  }
                  db.run('COMMIT', (commitError) => {
                    if (commitError) {
                      db.run('ROLLBACK');
                      return res.status(500).json({ error: 'Failed to save demo boundary' });
                    }
                    logAudit(req.user.id, req.user.role, 'GEO_DEMO_BOUNDARY_CREATE', 'DEMO-PNT', null, 'SUCCESS', { version: row.version });
                    res.json({ message: 'Demo franchise hierarchy and Hyderabad boundary are ready. The sample polygon is for testing, not real coverage.', version: row.version });
                  });
                }
              );
            }
          );
        });
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

// User routes
app.post('/api/users', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const { name, mobile, email, password, role } = req.body;
  
  if (!name || !mobile || !email || typeof password !== 'string' || !role) {
    return res.status(400).json({ error: 'All fields are required' });
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

          res.json({ id: userId, user_code: userId, message: `User created successfully. User ID: ${userId}` });
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

app.get('/api/users', authenticateToken, (req, res) => {
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

app.get('/api/users/:id', authenticateToken, (req, res) => {
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
  
  if (!level || !name) {
    return res.status(400).json({ error: 'Level and name are required' });
  }
  
  // Generate franchise ID based on level
  const prefix = level === 'POINT' ? 'P' : level === 'CENTER' ? 'C' : level === 'HUB' ? 'H' : 'CMD';
  
  db.get(`SELECT id FROM franchises WHERE id LIKE '${prefix}%' ORDER BY id DESC LIMIT 1`, (err, row) => {
    let nextNum = 1;
    if (row) {
      const lastNum = parseInt(row.id.replace(prefix, ''));
      nextNum = lastNum + 1;
    }
    const franchiseId = `${prefix}${String(nextNum).padStart(3, '0')}`;
    
    db.run(
      `INSERT INTO franchises (id, level, name, owner_id, parent_id) VALUES (?, ?, ?, ?, ?)`,
      [franchiseId, level, name, ownerId || null, parentId || null],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to create franchise' });
        }
        logAudit(req.user.id, req.user.role, 'FRANCHISE_CREATE', franchiseId, null, 'SUCCESS', { level, name });
        res.json({ id: franchiseId, message: 'Franchise created successfully' });
      }
    );
  });
});

app.get('/api/franchises', authenticateToken, (req, res) => {
  const { level, status } = req.query;
  let query = 'SELECT * FROM franchises WHERE 1=1';
  const params = [];
  
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

app.get('/api/franchises/:id', authenticateToken, (req, res) => {
  db.get('SELECT * FROM franchises WHERE id = ?', [req.params.id], (err, franchise) => {
    if (err || !franchise) {
      return res.status(404).json({ error: 'Franchise not found' });
    }
    res.json(franchise);
  });
});

// Order routes
app.post('/api/orders', authenticateToken, (req, res) => {
  const { customerId, serviceId, amount, locationId } = req.body;
  
  if (!customerId || !serviceId || !amount) {
    return res.status(400).json({ error: 'Customer ID, service ID, and amount are required' });
  }
  
  const orderId = createOrderId(new Date(), uuidv4());
  
  db.run(
    `INSERT INTO orders (id, customer_id, service_id, amount, location_id) VALUES (?, ?, ?, ?, ?)`,
    [orderId, customerId, serviceId, amount, locationId || null],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to create order' });
      }
      logAudit(req.user.id, req.user.role, 'ORDER_CREATE', orderId, null, 'SUCCESS', { customerId, amount });
      res.status(201).json({ id: orderId, orderId, message: 'Order created successfully' });
    }
  );
});

app.get('/api/orders', authenticateToken, (req, res) => {
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

app.get('/api/orders/:id', authenticateToken, (req, res) => {
  db.get('SELECT * FROM orders WHERE id = ?', [req.params.id], (err, order) => {
    if (err || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(order);
  });
});

app.post('/api/orders/:id/confirm', authenticateToken, (req, res) => {
  const orderId = req.params.id;
  const { pointId, centerId, hubId, commandId, coordinates, mappingVersion } = req.body;
  
  db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, order) => {
    if (err || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (order.status !== 'PENDING') {
      return res.status(400).json({ error: 'Order already confirmed' });
    }
    
    // Create attribution snapshot
    const attributionId = uuidv4();
    db.run(
      `INSERT INTO order_attribution (id, order_id, point_id, center_id, hub_id, command_id, mapping_version, coordinates) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [attributionId, orderId, pointId, centerId, hubId, commandId, mappingVersion, JSON.stringify(coordinates)],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to create attribution' });
        }
        
        // Update order status
        db.run('UPDATE orders SET status = ? WHERE id = ?', ['CONFIRMED', orderId], (err) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to update order status' });
          }
          
          // Calculate commissions for each level
          calculateCommissions(orderId, pointId, centerId, hubId, commandId, order.amount, req.user.id);
          
          logAudit(req.user.id, req.user.role, 'ORDER_CONFIRM', orderId, null, 'SUCCESS', { attributionId });
          res.json({ message: 'Order confirmed successfully', attributionId });
        });
      }
    );
  });
});

// Commission calculation function
function calculateCommissions(orderId, pointId, centerId, hubId, commandId, orderAmount, actorId) {
  const levels = [
    { id: pointId, level: 'POINT' },
    { id: centerId, level: 'CENTER' },
    { id: hubId, level: 'HUB' },
    { id: commandId, level: 'COMMAND' }
  ];
  
  levels.forEach(({ id, level }) => {
    if (!id) return;
    
    // Get franchise owner
    db.get('SELECT * FROM franchises WHERE id = ?', [id], (err, franchise) => {
      if (err || !franchise || !franchise.owner_id) return;
      
      // Get commission rule (mock - in production, query by service/category)
      const mockRate = level === 'POINT' ? 0.05 : level === 'CENTER' ? 0.03 : level === 'HUB' ? 0.02 : 0.01;
      const commissionAmount = orderAmount * mockRate;
      
      const ledgerId = uuidv4();
      const ruleId = 'RULE001';
      
      // Create комиссия ledger entry
      db.run(
        `INSERT INTO commission_ledger (id, order_id, owner_id, level, rule_id, rate, amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [ledgerId, orderId, franchise.owner_id, level, ruleId, mockRate, commissionAmount, 'PENDING'],
        (err) => {
          if (err) {
            console.error('Failed to create commission entry:', err);
          } else {
            logAudit(actorId, 'SYSTEM', 'COMMISSION_CALC', ledgerId, null, 'SUCCESS', { 
              orderId, 
              level, 
              amount: commissionAmount 
            });
          }
        }
      );
    });
  });
}

// Commission routes
app.get('/api/commissions', authenticateToken, (req, res) => {
  const { ownerId, status } = req.query;
  let query = 'SELECT * FROM commission_ledger WHERE 1=1';
  const params = [];
  
  if (ownerId) {
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

app.get('/api/commissions/:ownerId', authenticateToken, (req, res) => {
  db.all('SELECT * FROM commission_ledger WHERE owner_id = ?', [req.params.ownerId], (err, commissions) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch commissions' });
    }
    res.json(commissions);
  });
});

app.put('/api/commissions/:id/settle', authenticateToken, checkRole(['HQ_ADMIN']), (req, res) => {
  const commissionId = req.params.id;
  
  db.get('SELECT * FROM commission_ledger WHERE id = ?', [commissionId], (err, commission) => {
    if (err || !commission) {
      return res.status(404).json({ error: 'Commission not found' });
    }
    
    if (commission.status !== 'PENDING') {
      return res.status(400).json({ error: 'Commission already processed' });
    }
    
    db.run('UPDATE commission_ledger SET status = ? WHERE id = ?', ['SETTLED', commissionId], (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to settle commission' });
      }
      
      // Add to wallet ledger
      const walletId = uuidv4();
      db.run(
        `INSERT INTO wallet_ledger (id, owner_id, entry_type, reference_id, amount, status) VALUES (?, ?, ?, ?, ?, ?)`,
        [walletId, commission.owner_id, 'CREDIT', commissionId, commission.amount, 'SETTLED'],
        (err) => {
          if (err) {
            console.error('Failed to create wallet entry:', err);
          }
        }
      );
      
      logAudit(req.user.id, req.user.role, 'COMMISSION_SETTLE', commissionId, null, 'SUCCESS', { amount: commission.amount });
      res.json({ message: 'Commission settled successfully' });
    });
  });
});

// Dashboard routes
app.get('/api/dashboard', authenticateToken, (req, res) => {
  const queries = [
    'SELECT COUNT(*) as totalUsers FROM users',
    'SELECT COUNT(*) as totalFranchises FROM franchises',
    'SELECT COUNT(*) as totalOrders FROM orders',
    'SELECT COUNT(*) as pendingOrders FROM orders WHERE status = "PENDING"',
    'SELECT COUNT(*) as confirmedOrders FROM orders WHERE status = "CONFIRMED"',
    'SELECT COUNT(*) as pendingCommissions FROM commission_ledger WHERE status = "PENDING"',
    'SELECT COUNT(*) as settledCommissions FROM commission_ledger WHERE status = "SETTLED"'
  ];
  
  Promise.all(queries.map(q => new Promise((resolve, reject) => {
    db.get(q, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  }))).then(results => {
    res.json({
      totalUsers: results[0].totalUsers,
      totalFranchises: results[1].totalFranchises,
      totalOrders: results[2].totalOrders,
      pendingOrders: results[3].pendingOrders,
      confirmedOrders: results[4].confirmedOrders,
      pendingCommissions: results[5].pendingCommissions,
      settledCommissions: results[6].settledCommissions
    });
  }).catch(err => {
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  });
});

app.get('/api/reports/commissions', authenticateToken, (req, res) => {
  const { startDate, endDate } = req.query;
  let query = 'SELECT * FROM commission_ledger WHERE 1=1';
  const params = [];
  
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
app.get('/api/reports/franchise-performance', authenticateToken, (req, res) => {
  db.all('SELECT * FROM franchises WHERE status = "ACTIVE"', (err, franchises) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch franchises' });
    }
    
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
      
      const mappedUsers = filteredUsers.filter(u => u.status === 'MAPPED');
      const unmappedUsers = filteredUsers.filter(u => u.status === 'NOT MAPPED');
      
      const byCenter = {};
      const byHub = {};
      const byCommand = {};
      
      mappedUsers.forEach(u => {
        if (u.center_id) byCenter[u.center_id] = (byCenter[u.center_id] || 0) + 1;
        if (u.hub_id) byHub[u.hub_id] = (byHub[u.hub_id] || 0) + 1;
        if (u.command_id) byCommand[u.command_id] = (byCommand[u.command_id] || 0) + 1;
      });
      
      const topCenters = Object.entries(byCenter)
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      
      const topHubs = Object.entries(byHub)
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const activeUsers = filteredUsers.filter(u => new Date(u.created_at) >= thirtyDaysAgo);
      
      res.json({
        totalFranchiseUnits: franchises.length,
        totalUsers: filteredUsers.length,
        mappedUsers: mappedUsers.length,
        unmappedUsers: unmappedUsers.length,
        activeUsers: activeUsers.length,
        registrationsByCenter: byCenter,
        registrationsByHub: byHub,
        registrationsByCommand: byCommand,
        topCenters,
        topHubs,
        mappingRate: filteredUsers.length > 0 ? Math.round((mappedUsers.length / filteredUsers.length) * 100) : 0,
      });
    });
  });
});

app.get('/api/reports/date-range', authenticateToken, (req, res) => {
  const { rangeType, customStartDate, customEndDate } = req.query;
  
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
    
    const now = new Date();
    let startDate, endDate;
    let rangeLabel;
    
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
        startDate = new Date(customStartDate);
        endDate = new Date(customEndDate);
        endDate.setHours(23, 59, 59, 999);
        rangeLabel = 'Custom Range';
        break;
      default:
        return res.status(400).json({ error: 'Invalid date range type' });
    }
    
    const usersInRange = filteredUsers.filter(u => {
      const regDate = new Date(u.created_at);
      return regDate >= startDate && regDate <= endDate;
    });
    
    const mappedInRange = usersInRange.filter(u => u.status === 'MAPPED');
    const unmappedInRange = usersInRange.filter(u => u.status === 'NOT MAPPED');
    
    res.json({
      rangeLabel,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      totalRegistrations: usersInRange.length,
      mappedRegistrations: mappedInRange.length,
      unmappedRegistrations: unmappedInRange.length,
      activeRegistrations: usersInRange.length,
    });
  });
});

// Export Users API - Day 9 feature
app.get('/api/users/export', authenticateToken, (req, res) => {
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
  if (req.user.role === 'HQ_ADMIN') return true;
  if (req.user.role === 'FRANCHISE_OWNER' && req.user.franchiseId === franchiseId) return true;
  return false;
}

// Create Employee
app.post('/api/employees', authenticateToken, (req, res) => {
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
  if (req.user.role === 'FRANCHISE_OWNER' && franchise_id !== req.user.franchiseId) {
    logAudit(req.user.id, req.user.role, 'EMPLOYEE_CREATE_UNAUTHORIZED', null, null, 'FAILED', { franchise_id });
    return res.status(403).json({ error: 'Cannot create employee outside your franchise scope' });
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
app.get('/api/employees', authenticateToken, (req, res) => {
  const {
    search, department_id, designation_id, franchise_id, status,
    employment_type, state, district, page = 1, limit = 50, sort_by = 'created_at', sort_order = 'DESC'
  } = req.query;
  
  let query = 'SELECT * FROM employees WHERE 1=1';
  const params = [];
  
  // Franchise scope check
  if (req.user.role === 'FRANCHISE_OWNER') {
    query += ' AND franchise_id = ?';
    params.push(req.user.franchiseId);
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
  query += ` ORDER BY ${sort_by} ${sort_order}`;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  query += ' LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);
  
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
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(countResult.total / parseInt(limit))
      });
    });
  });
});

// Get Single Employee
app.get('/api/employees/:id', authenticateToken, (req, res) => {
  db.get('SELECT * FROM employees WHERE id = ?', [req.params.id], (err, employee) => {
    if (err || !employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    // Franchise scope check
    if (req.user.role === 'FRANCHISE_OWNER' && employee.franchise_id !== req.user.franchiseId) {
      logAudit(req.user.id, req.user.role, 'EMPLOYEE_VIEW_UNAUTHORIZED', req.params.id, null, 'FAILED', {});
      return res.status(403).json({ error: 'Cannot view employee outside your franchise scope' });
    }
    
    res.json(employee);
  });
});

// Update Employee
app.put('/api/employees/:id', authenticateToken, (req, res) => {
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
    if (req.user.role === 'FRANCHISE_OWNER' && employee.franchise_id !== req.user.franchiseId) {
      logAudit(req.user.id, req.user.role, 'EMPLOYEE_UPDATE_UNAUTHORIZED', req.params.id, null, 'FAILED', {});
      return res.status(403).json({ error: 'Cannot update employee outside your franchise scope' });
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
app.patch('/api/employees/:id/status', authenticateToken, (req, res) => {
  const { status } = req.body;
  
  if (!status || !['ACTIVE', 'INACTIVE', 'RESIGNED', 'TERMINATED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be ACTIVE, INACTIVE, RESIGNED, or TERMINATED' });
  }
  
  db.get('SELECT * FROM employees WHERE id = ?', [req.params.id], (err, employee) => {
    if (err || !employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    // Franchise scope check
    if (req.user.role === 'FRANCHISE_OWNER' && employee.franchise_id !== req.user.franchiseId) {
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
app.get('/api/departments', authenticateToken, (req, res) => {
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
app.get('/api/designations', authenticateToken, (req, res) => {
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
app.post('/api/attendance/check-in', authenticateToken, (req, res) => {
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
    'SELECT * FROM attendance WHERE employee_id = ? AND date = ?',
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
app.post('/api/attendance/check-out', authenticateToken, (req, res) => {
  const { employee_id } = req.body;
  
  if (!employee_id) {
    return res.status(400).json({ error: 'Employee ID is required' });
  }
  
  const today = getIndiaDateString();
  const now = new Date().toISOString();
  
  db.get(
    'SELECT * FROM attendance WHERE employee_id = ? AND date = ?',
    [employee_id, today],
    (err, attendance) => {
      if (err || !attendance) {
        return res.status(404).json({ error: 'No check-in record found for today' });
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
app.get('/api/attendance', authenticateToken, (req, res) => {
  const { employee_id, start_date, end_date, status } = req.query;
  
  let query = 'SELECT a.*, e.name as employee_name, e.employee_id as emp_id FROM attendance a JOIN employees e ON a.employee_id = e.id WHERE 1=1';
  const params = [];
  
  // Franchise scope check
  if (req.user.role === 'FRANCHISE_OWNER') {
    query += ' AND e.franchise_id = ?';
    params.push(req.user.franchiseId);
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
app.get('/api/attendance/summary', authenticateToken, (req, res) => {
  const { employee_id, start_date, end_date } = req.query;
  
  let query = 'SELECT attendance_status, COUNT(*) as count FROM attendance WHERE 1=1';
  const params = [];
  
  if (employee_id) {
    query += ' AND employee_id = ?';
    params.push(employee_id);
  }
  
  if (start_date) {
    query += ' AND date >= ?';
    params.push(start_date);
  }
  
  if (end_date) {
    query += ' AND date <= ?';
    params.push(end_date);
  }
  
  query += ' GROUP BY attendance_status';
  
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
app.post('/api/leaves', authenticateToken, (req, res) => {
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

  db.get('SELECT id FROM employees WHERE id = ? AND status = ?', [employee_id, 'ACTIVE'], (employeeError, employee) => {
    if (employeeError) {
      console.error('Leave request employee lookup failed:', employeeError.message);
      return res.status(500).json({ error: 'Could not validate the selected employee' });
    }
    if (!employee) {
      return res.status(400).json({ error: 'Select an existing active employee before submitting a leave request' });
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
app.get('/api/leaves', authenticateToken, (req, res) => {
  const { employee_id, status } = req.query;
  
  let query = 'SELECT lr.*, e.name as employee_name, e.employee_id as emp_id FROM leave_requests lr JOIN employees e ON lr.employee_id = e.id WHERE 1=1';
  const params = [];
  
  // Franchise scope check
  if (req.user.role === 'FRANCHISE_OWNER') {
    query += ' AND e.franchise_id = ?';
    params.push(req.user.franchiseId);
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
app.patch('/api/leaves/:id/approve', authenticateToken, (req, res) => {
  const leaveId = req.params.id;
  
  db.get('SELECT * FROM leave_requests WHERE id = ?', [leaveId], (err, leave) => {
    if (err || !leave) {
      return res.status(404).json({ error: 'Leave request not found' });
    }
    
    if (leave.status !== 'PENDING') {
      return res.status(400).json({ error: 'Leave request already processed' });
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

// Reject Leave Request
app.patch('/api/leaves/:id/reject', authenticateToken, (req, res) => {
  const { rejection_reason } = req.body;
  const leaveId = req.params.id;
  
  db.get('SELECT * FROM leave_requests WHERE id = ?', [leaveId], (err, leave) => {
    if (err || !leave) {
      return res.status(404).json({ error: 'Leave request not found' });
    }
    
    if (leave.status !== 'PENDING') {
      return res.status(400).json({ error: 'Leave request already processed' });
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

// Targets & KPIs APIs

// Create Target
app.post('/api/targets', authenticateToken, (req, res) => {
  const {
    employee_id, department_id, designation_id, target_period,
    target_type, target_value
  } = req.body;
  
  if (!employee_id || !target_period || !target_type || !target_value) {
    return res.status(400).json({ error: 'Employee ID, target period, target type, and target value are required' });
  }
  
  const id = uuidv4();
  
  db.run(
    'INSERT INTO targets (id, employee_id, department_id, designation_id, target_period, target_type, target_value) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, employee_id, department_id, designation_id, target_period, target_type, target_value],
    (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to create target' });
      }
      
      logAudit(req.user.id, req.user.role, 'TARGET_CREATE', id, null, 'SUCCESS', { employee_id, target_type, target_value });
      res.json({ id, message: 'Target created successfully' });
    }
  );
});

// Get Targets
app.get('/api/targets', authenticateToken, (req, res) => {
  const { employee_id, department_id, designation_id, status } = req.query;
  
  let query = 'SELECT t.*, e.name as employee_name, e.employee_id as emp_id FROM targets t JOIN employees e ON t.employee_id = e.id WHERE 1=1';
  const params = [];
  
  // Franchise scope check
  if (req.user.role === 'FRANCHISE_OWNER') {
    query += ' AND e.franchise_id = ?';
    params.push(req.user.franchiseId);
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
app.put('/api/targets/:id', authenticateToken, (req, res) => {
  const { achievement, achievement_percentage, status } = req.body;
  
  db.get('SELECT * FROM targets WHERE id = ?', [req.params.id], (err, target) => {
    if (err || !target) {
      return res.status(404).json({ error: 'Target not found' });
    }
    
    const updates = [];
    const params = [];
    
    if (achievement !== undefined) { updates.push('achievement = ?'); params.push(achievement); }
    if (achievement_percentage !== undefined) { updates.push('achievement_percentage = ?'); params.push(achievement_percentage); }
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

// Document Management APIs

// Upload Document
app.post('/api/employees/:id/documents', authenticateToken, (req, res) => {
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
    if (req.user.role === 'FRANCHISE_OWNER' && employee.franchise_id !== req.user.franchiseId) {
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
    const relativePath = path.join('uploads', 'employee-documents', `${id}${extensions[fileMatch[1]]}`);
    const absolutePath = path.join(__dirname, relativePath);
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
app.get('/api/employees/all/documents', authenticateToken, (req, res) => {
  let query = `SELECT ed.*, e.name AS employee_name, e.employee_id AS employee_code, e.franchise_id
    FROM employee_documents ed
    JOIN employees e ON e.id = ed.employee_id`;
  const params = [];

  if (req.user.role === 'FRANCHISE_OWNER') {
    query += ' WHERE e.franchise_id = ?';
    params.push(req.user.franchiseId);
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
app.get('/api/documents/:id/download', authenticateToken, (req, res) => {
  db.get(
    'SELECT ed.*, e.franchise_id FROM employee_documents ed JOIN employees e ON e.id = ed.employee_id WHERE ed.id = ?',
    [req.params.id],
    (err, document) => {
      if (err) return res.status(500).json({ error: 'Failed to find document' });
      if (!document) return res.status(404).json({ error: 'Document not found' });
      if (req.user.role === 'FRANCHISE_OWNER' && document.franchise_id !== req.user.franchiseId) {
        return res.status(403).json({ error: 'Cannot download a document outside your franchise scope' });
      }

      const documentRoot = path.resolve(__dirname, 'uploads', 'employee-documents');
      const absolutePath = path.resolve(__dirname, document.file_path || '');
      if (!absolutePath.startsWith(`${documentRoot}${path.sep}`)) {
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
app.get('/api/employees/:id/documents', authenticateToken, (req, res) => {
  const employeeId = req.params.id;
  
  db.get('SELECT * FROM employees WHERE id = ?', [employeeId], (err, employee) => {
    if (err || !employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    // Franchise scope check
    if (req.user.role === 'FRANCHISE_OWNER' && employee.franchise_id !== req.user.franchiseId) {
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
app.delete('/api/documents/:id', authenticateToken, (req, res) => {
  const documentId = req.params.id;
  
  db.get('SELECT ed.*, e.franchise_id FROM employee_documents ed JOIN employees e ON ed.employee_id = e.id WHERE ed.id = ?', [documentId], (err, document) => {
    if (err || !document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    // Franchise scope check
    if (req.user.role === 'FRANCHISE_OWNER' && document.franchise_id !== req.user.franchiseId) {
      logAudit(req.user.id, req.user.role, 'DOCUMENT_DELETE_UNAUTHORIZED', documentId, null, 'FAILED', {});
      return res.status(403).json({ error: 'Cannot delete document outside your franchise scope' });
    }
    
    db.run('DELETE FROM employee_documents WHERE id = ?', [documentId], (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to delete document' });
      }

      const documentRoot = path.resolve(__dirname, 'uploads', 'employee-documents');
      const absolutePath = path.resolve(__dirname, document.file_path || '');
      if (absolutePath.startsWith(`${documentRoot}${path.sep}`)) {
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
app.get('/api/reports/employee-summary', authenticateToken, (req, res) => {
  let query = 'SELECT * FROM employees WHERE 1=1';
  const params = [];
  
  // Franchise scope check
  if (req.user.role === 'FRANCHISE_OWNER') {
    query += ' AND franchise_id = ?';
    params.push(req.user.franchiseId);
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
app.get('/api/reports/attendance', authenticateToken, (req, res) => {
  const { start_date, end_date } = req.query;
  if ((start_date && !isValidIsoDate(start_date)) || (end_date && !isValidIsoDate(end_date))) {
    return res.status(400).json({ error: 'Start and end dates must be valid YYYY-MM-DD dates' });
  }
  if (start_date && end_date && start_date > end_date) {
    return res.status(400).json({ error: 'Start date must be on or before the end date' });
  }
  
  let query = 'SELECT a.*, e.name as employee_name, e.employee_id, e.franchise_id FROM attendance a JOIN employees e ON a.employee_id = e.id WHERE 1=1';
  const params = [];
  
  // Franchise scope check
  if (req.user.role === 'FRANCHISE_OWNER') {
    query += ' AND e.franchise_id = ?';
    params.push(req.user.franchiseId);
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
app.get('/api/reports/targets', authenticateToken, (req, res) => {
  let query = 'SELECT t.*, e.name as employee_name, e.employee_id, e.franchise_id FROM targets t JOIN employees e ON t.employee_id = e.id WHERE 1=1';
  const params = [];
  
  // Franchise scope check
  if (req.user.role === 'FRANCHISE_OWNER') {
    query += ' AND e.franchise_id = ?';
    params.push(req.user.franchiseId);
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

// Start server
app.listen(PORT, () => {
  console.log(`Zyngram Backend Server running on port ${PORT}`);
});
