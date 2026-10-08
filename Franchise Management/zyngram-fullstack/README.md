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
JWT_SECRET=zyngram-secret-key-change-in-production
NODE_ENV=development
```

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

### Tables

1. **users** - User accounts and roles
2. **user_locations** - Captured GPS locations
3. **franchises** - Franchise hierarchy (Point → Center → Hub → Command)
4. **geo_boundaries** - Geographic boundaries for franchises
5. **orders** - Customer orders
6. **order_attribution** - Immutable attribution snapshots
7. **commission_rules** - Commission rate configuration
8. **commission_ledger** - Commission calculations
9. **wallet_ledger** - Wallet transactions
10. **audit_logs** - System audit trail

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
- `POST /api/orders` - Create order
- `GET /api/orders` - List orders
- `GET /api/orders/:id` - Get order details
- `POST /api/orders/:id/confirm` - Confirm order with attribution

### Commissions
- `GET /api/commissions` - List commissions with filters
- `GET /api/commissions/:ownerId` - Get owner commissions
- `PUT /api/commissions/:id/settle` - Settle commission (HQ Admin only)

### Dashboard
- `GET /api/dashboard` - Dashboard metrics
- `GET /api/reports/commissions` - Commission reports

### Audit
- `GET /api/audit-logs` - Get audit logs (HQ Admin only)

## Features

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
