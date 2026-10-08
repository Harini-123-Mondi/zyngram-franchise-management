# Zyngram Franchise Management System

Full-stack franchise management application with geo-mapping, multi-level commission engine, and role-based access control.

## Tech Stack

**Frontend:**
- React 18
- React Router DOM
- Axios
- Leaflet (Maps)
- React Leaflet
- Vite

**Backend:**
- Node.js
- Express.js
- SQLite3
- JWT (jsonwebtoken)
- bcryptjs
- uuid
- cors
- dotenv

## Architecture

```
zyngram-fullstack/
├── backend/
│   ├── server.js          # Express server with all API routes
│   ├── package.json       # Backend dependencies
│   ├── .env              # Environment variables
│   └── zyngram.db        # SQLite database (auto-created)
└── frontend/
    ├── src/
    │   ├── main.jsx      # React entry point
    │   ├── App.jsx       # Main app with routing
    │   ├── index.css     # Global styles
    │   └── components/
    │       ├── Login.jsx
    │       ├── Dashboard.jsx
    │       ├── UserManagement.jsx
    │       ├── FranchiseManagement.jsx
    │       ├── OrderManagement.jsx
    │       ├── CommissionLedger.jsx
    │       └── GeoMapping.jsx
    ├── index.html
    ├── package.json
    └── vite.config.js
```

## Installation

### Backend Setup

```bash
cd backend
npm install
```

Create `.env` file:
```
PORT=5000
NODE_ENV=development
JWT_SECRET=replace-with-a-random-secret-at-least-32-characters-long
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-strong-password
```

The development server allows localhost frontend origins. Production startup refuses to listen unless a strong `JWT_SECRET`, explicit `CORS_ORIGINS`, and a strong `BOOTSTRAP_ADMIN_PASSWORD` are configured. The known local demo administrator is development-only; never reuse its password or a development secret in production.

Start backend server:
```bash
npm start
# or for development with auto-reload
npm run dev
```

### Frontend Setup

```bash
cd frontend
npm install
```

Start frontend development server:
```bash
npm run dev
```

The frontend will run on `http://localhost:3000` with API proxy to `http://localhost:5000`.

## Database Schema

The local SQLite database creates the existing application tables idempotently at backend startup. Versioned migrations add customer/franchise-owner profiles, the Mobile Recharge seed, query indexes, database-level service references, transactional repair of orphaned legacy relationships, the physical/digital franchise hierarchy with order attribution, customer registration attribution snapshots, recharge processing history and a unique partial index for recharge idempotency keys (schema version 10). Invalid optional references are set to `NULL` and their original values are retained in `migration_quarantine`; invalid franchise rows are preserved but deactivated and quarantined. SQLite foreign-key enforcement is enabled, and `GET /api/health` reports database/schema readiness. A `DATABASE_PATH` environment variable can point SQLite at a persistent mounted volume; relative paths resolve from `backend/`.

Run `npm run db:verify` from `backend/` to verify the required 23 application tables, schema version, 18 critical indexes, required foreign-key relationships, hierarchy/service constraints, Mobile Recharge order-processing columns, order status history, order and customer physical/digital attribution columns, the no-franchise-assignment constraint for `UNMAPPED` customer locations, active `SVC001` Mobile Recharge seed, foreign-key integrity, SQLite integrity, and table row counts. The migration tests cover repeat application, profile backfill, seeds, quarantine/repair, service-reference enforcement, hierarchy validation, customer attribution constraints, recharge request validation, duplicate idempotency keys, foreign-key constraints, and rollback on failure.

This is a local SQLite migration and verification path, **not a production database deployment or a PostgreSQL migration**. The original base-table bootstrap and user-code alteration still need conversion into fully versioned forward/rollback migrations. Before live deployment, choose and authorize a managed production database, rehearse migrations against a sanitized copy of its data, review quarantined records and financial-ledger rules, and verify backup/restore and rollback. No production host or database credentials are configured in this workspace. Keep SQLite and uploaded documents on persistent storage for local operation; ephemeral server filesystems are not durable production storage.

### Franchise Hierarchies and Backend Mapping

The physical tree is `Point → Center → Hub → Command → HQ`; the independent digital tree is `Node → Zone → Territory → Region → Nation`. HQ Admins can only create a child below an active parent at the required level. SQLite triggers also reject invalid tier/parent combinations and boundaries attached to anything other than a Point or Node. Save one active GeoJSON boundary for each Point/Node leaf; `GET /api/geo/franchise-map` resolves both trees independently from coordinates and returns `MAPPED`, `UNMAPPED`, `AMBIGUOUS`, or `INCOMPLETE` for each.

Order confirmation ignores any client-supplied franchise IDs and coordinates. The backend resolves both hierarchies from the order's saved customer location and stores the resulting physical and digital chain in its attribution snapshot. Confirmation is rejected if either hierarchy is missing or ambiguous. The demo-boundary action creates sample trees and polygons for local verification only; its sample coverage is not a real service area.

### Customer Registration and Geo-Mapping

Customers can register at `/register`. The browser requests GPS permission, and the form requires both a successful location capture and explicit location consent before it submits. `POST /api/auth/register/customer` validates the profile and coordinates, creates the account/profile/location in one database transaction, resolves the saved coordinates against active franchise hierarchies and active boundaries, and records a customer attribution snapshot. In this application's current model, `ACTIVE` franchises with an `ACTIVE` Point/Node boundary are the eligible (approved-for-mapping) units.

A customer is `MAPPED` only when both complete physical and digital hierarchies resolve. Otherwise registration still succeeds with `UNMAPPED`; all franchise and boundary assignment columns are stored as `NULL`, while the raw mapping results and captured coordinates remain in the snapshot for review. Registration never accepts a customer-selected franchise ID. Customers see their own saved mapping at `/dashboard`; `GET /api/customers/me/attribution` only returns the authenticated customer's latest result. Customers can use **Refresh GPS & remap** to explicitly capture their current location and create a new server-calculated attribution snapshot. If no active approved boundaries cover that GPS, the customer remains `UNMAPPED` and recharge stays disabled. The browser's GPS value is client-provided and is not device-attested, and SMS/mobile verification and production anti-abuse controls are not configured.

### Mobile Recharge and Order Processing

Customers with a `MAPPED` saved location can place a Mobile Recharge order from `/dashboard`. The form requires an Indian mobile number, supported operator (Airtel, Jio, Vi, or BSNL), a telecom circle, and an amount from ₹10 through ₹5,000. The backend derives the customer ID and location from the authenticated profile, rechecks the current saved location against both active franchise hierarchies, and rejects invalid or unmapped requests. It creates an order ID, records service, amount, customer/location, operator/circle, mapping snapshot, processing reference and timestamps, and persists `PENDING → PROCESSING → SIMULATED_SUCCESS` status history atomically.

**This is a local backend simulation only:** `SIMULATED_SUCCESS` is not a successful telecom recharge. No provider API, mobile-network transaction, customer charge, or money movement is configured. Do not present the demo status as a live recharge. Both recharge creation APIs require a client-generated `Idempotency-Key` header; reusing a key returns HTTP 409 and does not create a second order. Customer APIs are `GET /api/recharge/options`, `POST /api/recharge/orders`, and `GET /api/recharge/orders`; they require an authenticated `CUSTOMER` role. HQ Admins have a Mobile Recharge dashboard section backed by `GET /api/admin/recharge/orders`, which returns recent recharge order details, customer/location, attribution snapshot, and status history; the endpoint is HQ Admin-only. Recharge order creation and any commission entries for currently assigned franchise owners commit in one database transaction. The local demo franchises have no assigned owners, so local orders correctly produce no commission entries until valid ownership is configured.

### Tables

1. **users** - User accounts and roles
2. **customers** - Customer profiles linked to user accounts
3. **franchise_owners** - Franchise owner profiles linked to user accounts
4. **franchises** - Physical and independent digital franchise hierarchies
5. **geo_boundaries** - Geographic boundaries for franchises
6. **user_locations** - Captured GPS locations
7. **customer_attributions** - GPS-based physical/digital mapping snapshots with explicit `UNMAPPED` status
8. **services** - Service catalog, including the initial Mobile Recharge entry
9. **orders** - Customer orders
10. **order_status_history** - Recharge processing status transitions
11. **order_attribution** - Franchise attribution snapshots
12. **commission_rules** - Commission rate configuration
13. **commission_ledger** - Commission calculations
14. **wallet_ledger** - Wallet transactions
15. **employees** - Employee records
16. **departments** - Employee departments
17. **designations** - Employee designations
18. **attendance** - Employee attendance
19. **leave_requests** - Leave applications and decisions
20. **targets** - Employee targets/KPIs
21. **employee_documents** - Employee document metadata
22. **notifications** - User notifications
23. **audit_logs** - System audit trail

Supporting tables include work locations, employee/franchise mappings, performance records, migration history/quarantine, and Day 12 API progress. These remain separate from the verified 22-table operational inventory.

New orders receive a readable ID in `ORD-YYYYMMDD-XXXXXXXXXXXX` format. The date uses India Standard Time, and the unique suffix is generated on the backend. The same ID is returned from `POST /api/orders`, shown in the order-created confirmation, and stored as the order's primary key.

### Default Admin

- Email: `admin@zyngram.com`
- Password: `admin123`
- Role: `HQ_ADMIN`

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/me` - Get current user
- `PUT /api/users/:id/password` - Reset a user's password (HQ Admin only; minimum 8 characters)

### Location
- `POST /api/locations/capture` - Capture GPS location
- `POST /api/geo/reverse-geocode` - Coordinate validation; address lookup is not configured
- `GET /api/geo/franchise-map?latitude=...&longitude=...` - Resolve coordinates against active franchise boundaries
- `GET /api/geo/boundaries` - List saved boundaries
- `POST /api/geo/boundaries` - Save a versioned GeoJSON Polygon for an active Point (HQ Admin only)
- `POST /api/geo/demo-boundary` - Create the sample Hyderabad test hierarchy and boundary (HQ Admin only)

### Attendance & Leave
- `POST /api/attendance/check-in` and `POST /api/attendance/check-out` - Record an active employee's attendance
- `GET /api/attendance` and `GET /api/attendance/summary` - List attendance records and totals
- `GET /api/reports/attendance` - Attendance report with optional valid `start_date` and `end_date` (`YYYY-MM-DD`)
- `POST /api/leaves` - Submit a leave request for an existing active employee
- `GET /api/leaves` - List leave requests
- `PATCH /api/leaves/:id/approve` - Approve a pending leave request
- `PATCH /api/leaves/:id/reject` - Reject a pending leave request

Attendance reports summarize saved check-in records; an empty report means attendance has not been recorded for that date range. Use **Attendance → Check In Employee** to create a record. Start dates after end dates are rejected.

Employee profile pictures can be selected in the create/edit form. JPG, PNG, and WebP files up to 5 MB are resized in the browser and stored with employee details as a JPEG preview.

Employee documents can be uploaded as PDF, JPG, PNG, or WebP files up to 5 MB from **Targets → Documents**. Uploaded files are stored in the backend's `uploads/employee-documents` directory and can be downloaded or deleted from the documents list.

### Users
- `POST /api/users` - Create user (HQ Admin only)
- `GET /api/users` - List users with filters
- `GET /api/users/:id` - Get user details

New users are assigned a sequential, readable ID (`USR001`, `USR002`, ...). Older UUID primary keys are retained so user-location and franchise references are not broken; those accounts receive a separate readable User ID in the management list.

Each active account signs in with its own email and the password supplied by the HQ administrator at account creation. Emails are normalized to lowercase on account creation and login. To help a user who forgot their password, an HQ administrator can use **User Management → Reset password**; the new password is never emailed or logged.

### Franchises
- `POST /api/franchises` - Create franchise (HQ Admin only)
- `GET /api/franchises` - List franchises with filters
- `GET /api/franchises/:id` - Get franchise details

### Orders
- `GET /api/orders/options` - List active customers, services, and each customer's latest saved location for the HQ Admin order form
- `POST /api/orders` - Create order
- `GET /api/orders` - List orders
- `GET /api/orders/:id` - Get order details
- `POST /api/orders/:id/confirm` - Confirm order with attribution

### Mobile Recharge (authenticated customers)
- `GET /api/recharge/options` - Active Mobile Recharge service, supported operators and telecom circles
- `POST /api/recharge/orders` - Validate, attribute, and locally simulate a customer recharge order
- `GET /api/recharge/orders` - List the authenticated customer's recharge orders and status history
- `POST /api/customers/me/location` - Save a consented GPS refresh and recalculate the authenticated customer's attribution snapshot

### Mobile Recharge (HQ Admin)
- `GET /api/admin/recharge/options` - Active customers, service, operators, circles and demo provider mode
- `POST /api/admin/recharge/orders` - Validate customer GPS and both franchise mappings, then atomically create a simulated recharge order with attribution and status history
- `GET /api/admin/recharge/orders` - View the latest 200 Mobile Recharge orders with customer, location, attribution, and processing history
- `POST /api/geo/demo-customer-coverage` - Explicitly create clearly labeled demo-only Point/Node test boundaries around an active customer's latest saved GPS and record that customer's server-calculated demo attribution; never use this endpoint to represent real franchise coverage

### Commissions
- `GET /api/commission-rules` - List configured rules (HQ Admin only)
- `POST /api/commission-rules` - Add a versioned service-category/franchise-level percentage rule (HQ Admin only; rate is a fraction from 0 to 1)
- `GET /api/commissions` - List commissions with filters
- `GET /api/commissions/:ownerId` - Get owner commissions
- `PUT /api/commissions/:id/settle` - Atomically settle commission and add the wallet credit (HQ Admin only)

Order confirmation reads the latest effective active percentage rule from `commission_rules` for the service category and each physical franchise level. Commission rows are inserted transactionally and protected against duplicates by the order/owner/level unique index. Settlement and wallet credit are one transaction, with a unique wallet reference preventing duplicate credits. Migration v9 seeds the existing demo-only Mobile Recharge rates (Point 5%, Center 3%, Hub 2%, Command 1%) as database rules; these values require business approval and replacement before production financial use.

### Dashboard
- `GET /api/dashboard` - Dashboard metrics
- `GET /api/reports/commissions` - Commission reports

### Audit
- `GET /api/audit-logs` - Get audit logs (HQ Admin only)

## Features

### Day 12 Production Readiness Tracking

The Day 12 Readiness dashboard tab has been removed. The HQ Admin readiness APIs and existing SQLite assessment records are retained; no stored progress was deleted. Task 1's source-based findings, verified checks, and prioritized production blockers are documented in [DAY12_PRODUCTION_READINESS_REPORT.md](./DAY12_PRODUCTION_READINESS_REPORT.md).

Tasks 1, 3, and 4 (Production Readiness Audit, Franchise Hierarchy, and Customer Registration & Geo-Mapping) are recorded COMPLETE at 10/10 each based on local implementation and verification. Task 2 (Production Database & Migration) remains IN_PROGRESS at 0 pending an authorized production target, fully versioned base-schema rollout, and production backup/restore rehearsal; local SQLite schema v10 verification is not a production deployment.

Tasks 5 (Live Service & Order Flow) and 6 (Commission & Ledger) are recorded COMPLETE at 10/10 for the verified local simulation. The local Admin API flow was exercised through order creation and duplicate retry: one `SIMULATED_SUCCESS` order was stored and replaying its idempotency key returned HTTP 409. Task 6 covers configurable database-backed commission rules, duplicate-safe commission creation, and atomic wallet settlement; demo rates and franchise ownership require approval/configuration before financial use. Local schema version 10 verifies, but Task 2 (Production Database & Migration) remains IN_PROGRESS pending an authorized production target, fully versioned base-schema rollout, and production backup/restore rehearsal. Tasks 7 (Employee Management), 8 (Admin/Franchise Owner Dashboards), and 9 (Production Security & Testing) remain IN_PROGRESS with 0 marks assessed; required authorization, scope, dashboard metrics, and attack-test gates remain open. Task 10 (Final Live Deployment & Demonstration) is BLOCKED with 0 marks assessed because no production host/database, credentials, or release target is configured. Tracker total remains 50/100 across 5/10 complete tasks. A simulated success is not a live recharge: no telco provider, payment, or customer charge is configured.

HQ Admin API:
- `GET /api/day12/readiness` - Read the ten readiness items and current score.
- `PUT /api/day12/readiness/:taskId` - Save `status` (`NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, or `COMPLETE`), integer `score` (0–10), and `evidence` (up to 2,000 characters).
- `GET /api/day12/deliverables` - Read verification status and evidence for all 16 deliverables.
- `PUT /api/day12/deliverables/:deliverableId` - Save boolean `verified` and `evidence` (up to 2,000 characters) for one deliverable.

### 1. Authentication & RBAC
- JWT-based authentication
- Role-based access control (HQ_ADMIN, COMMAND_ADMIN, HUB_ADMIN, CENTER_ADMIN)
- Protected routes and API endpoints
- Server-side authorization

### 2. Geo-Mapping Engine
- Browser GPS capture
- Interactive map display (Leaflet)
- Versioned GeoJSON Polygon boundaries for active Point franchises
- Point-in-polygon matching with explicit unmapped, ambiguous, and incomplete-hierarchy results
- Point → Center → Hub → Command hierarchy resolution
- Optional location saving to an existing user; mapping preview does not require saving

Address reverse geocoding is intentionally not mocked: the endpoint reports that no address provider is configured instead of returning a fabricated address. HQ Admins can load a clearly labeled Hyderabad demo boundary from Geo Mapping, or save their own GeoJSON Polygon (`[longitude, latitude]` coordinate order). The demo test area is 17.43–17.47° N, 78.50–78.54° E and must not be treated as real franchise coverage.

### 3. User Management
- Create users with roles
- Search and filter users
- View user details
- Role-based access control

### 4. Franchise Management
- Create franchises at different levels
- Hierarchy support (parent-child relationships)
- Owner assignment
- Status management

### 5. Order Management
- Create orders
- Confirm orders with geo-attribution
- Immutable attribution snapshots
- Order status tracking

### 6. Multi-Level Commission Engine
- Configuration-driven commission rates
- Separate calculations for Point, Center, Hub, Command
- Commission ledger entries
- Idempotency protection
- Status lifecycle (PENDING → ELIGIBLE → SETTLED)

### 7. Wallet/Ledger
- Commission ledger view
- Settlement functionality
- Wallet transaction tracking
- Summary calculations

### 8. Dashboard
- System metrics
- Real-time statistics
- Commission summaries
- Order tracking

The dashboard's **Franchise Network** navigation link opens the existing Google Apps Script registration portal in a new tab. That portal continues to use its Google Sheets storage; its data does not automatically synchronize with this application's SQLite database.

### 9. Audit Logging
- All sensitive actions logged
- Failed attempt tracking
- Unauthorized access logging
- Complete audit trail

## Security

- Password hashing with bcrypt
- JWT token authentication
- Role-based access control
- Server-side authorization
- Input validation
- SQL injection protection (parameterized queries)
- Audit logging
- Immutable attribution snapshots

## Future Enhancements

For production deployment:

1. **Database Migration**
   - Move from SQLite to PostgreSQL
   - Implement proper migrations

2. **Geospatial Queries**
   - Use PostGIS for real boundary matching
   - Implement polygon-based geofencing

3. **Real Geocoding**
   - Integrate Google Maps API or OpenStreetMap Nominatim
   - Add address autocomplete

4. **Rate Limiting**
   - Implement API rate limiting
   - Add request throttling

5. **CSRF Protection**
   - Add CSRF tokens
   - Implement same-site cookies

6. **Session Management**
   - Refresh tokens
   - Session timeout

7. **Monitoring**
   - Error tracking (Sentry)
   - Performance monitoring
   - Log aggregation

8. **Testing**
   - Unit tests (Jest)
   - Integration tests
   - E2E tests (Playwright)

9. **Next.js + NestJS Migration**
   - Migrate frontend to Next.js
   - Migrate backend to NestJS
   - Implement proper module structure

## License

This is a training project for educational purposes.
