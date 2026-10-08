# Day 8 - Task 10: Final Live Demonstration Guide

## Demonstration Flow

### 1. Setup and Deployment
1. Open [script.google.com](https://script.google.com)
2. Create new Apps Script project
3. Copy files:
   - `Code.gs` → Code.gs
   - `Index.html` → Index.html
   - `Styles.html` → Styles.html
   - `appsscript.json` → appsscript.json (in Project Settings)
4. Run `setupDatabase` function
5. Authorize Google Sheets permissions
6. Check execution log for spreadsheet URL
7. Deploy → New deployment → Web app
8. Set "Execute as" to your account
9. Set access to "Only myself" or organization
10. Copy deployment URL

---

### 2. Login Demonstration

**Step 1: Access the Application**
- Open the deployment URL
- Show login page with default credentials displayed

**Step 2: Wrong Credentials Test**
- Enter wrong email: `wrong@zyngram.com` / `admin123`
- Show error: "Invalid credentials or account is inactive"
- Enter wrong password: `admin@zyngram.com` / `wrongpass`
- Show error: "Invalid credentials or account is inactive"

**Step 3: Empty Fields Test**
- Submit with empty email
- Show error: "Email and password are required"
- Submit with empty password
- Show error: "Email and password are required"

**Step 4: Successful Login (HQ Admin)**
- Enter: `admin@zyngram.com` / `admin123`
- Show successful login
- Display user info: "HQ Administrator (HQ ADMIN)"
- Show navigation menu appears
- Redirect to Dashboard

---

### 3. Role-Based Access Demonstration

**Step 1: HQ Admin (Full Access)**
- Show Dashboard with all users across all centers/hubs
- Navigate to Users tab
- Search users - show all users visible
- Navigate to Franchise tab
- Show all franchises

**Step 2: Logout and Login as Hub Admin**
- Click Logout button
- Login: `hubadmin@zyngram.com` / `hub123`
- Show user info: "Hub Administrator (HUB ADMIN)"
- Navigate to Dashboard
- Explain: Only sees users from Hub H001
- Navigate to Users tab
- Search users - only Hub H001 users visible

**Step 3: Logout and Login as Center Admin**
- Click Logout button
- Login: `centeradmin@zyngram.com` / `center123`
- Show user info: "Center Administrator (CENTER ADMIN)"
- Navigate to Dashboard
- Explain: Only sees users from Center C001
- Navigate to Users tab
- Search users - only Center C001 users visible

**Step 4: Return to HQ Admin**
- Logout and login as HQ Admin for remaining demo

---

### 4. Dashboard Demonstration

**Step 1: Metrics Overview**
- Show 5 metrics:
  - Total Customers
  - Mapped Users
  - Not Mapped
  - Today's Registrations
  - Franchise Units

**Step 2: Charts**
- Show "Users by Center" bar chart
- Explain: Visual distribution across centers
- Show "Users by Hub" bar chart
- Explain: Visual distribution across hubs

**Step 3: Recent Registrations**
- Show recent registrations table
- Explain: Names, phone numbers, emails omitted for privacy
- Show User ID, Franchise, Registration Date, Mapping Status

**Step 4: Refresh**
- Click Refresh button
- Show data reloads

---

### 5. Franchise Management Demonstration

**Step 1: View All Franchises**
- Navigate to Franchise tab
- Show franchise list table
- Explain columns: Point ID, Point Name, Center, Hub, Command, Location, Status

**Step 2: Search Franchises**
- Enter "Hyderabad" in search
- Show filtered results
- Enter "P001" in search
- Show filtered results
- Clear search to show all

**Step 3: Explain Backend**
- Explain: `getFranchises()` function
- Explain: `searchFranchises(query)` function
- Explain: Data stored in Franchise sheet

---

### 6. User Management Demonstration

**Step 1: View All Users**
- Navigate to Users tab
- Show user list table
- Explain columns: User ID, Name, Mobile, Email, City, Point, Center, Status

**Step 2: Search Users**
- Enter user name in search
- Show filtered results
- Enter mobile number in search
- Show filtered results
- Enter city in search
- Show filtered results

**Step 3: Filter by Status**
- Select "Mapped" from filter dropdown
- Show only mapped users
- Select "Not Mapped" from filter dropdown
- Show only unmapped users
- Select "All Status"
- Show all users

**Step 4: View User Details**
- Click on a user row
- Show User Details view
- Explain all fields displayed:
  - User ID, Name, Mobile, Email
  - Location: State, District, City, PIN
  - Service category
  - Hierarchy: Point, Center, Hub, Command (with IDs)
  - Status
  - Registration Date
- Click "Back to Users" to return

---

### 7. Registration Demonstration

**Step 1: Navigate to Registration**
- Click Registration tab
- Show registration form

**Step 2: Fill Form**
- Enter customer details:
  - Name: "Test Customer"
  - Mobile: "+91 99999 99999"
  - Email: "test@example.com"
  - State: "Telangana"
  - District: "Hyderabad"
  - City: "Hyderabad"
  - PIN: "500001"
  - Service: "Delivery"

**Step 3: Show Franchise Mapping**
- Explain: Franchise match preview updates automatically
- Show mapped hierarchy: Point, Center, Hub, Command

**Step 4: Submit Registration**
- Click "Register customer"
- Show loading overlay
- Display success modal with User ID
- Show hierarchy information
- Click "Done"

**Step 5: Verify in Dashboard**
- Navigate to Dashboard
- Show "Today's Registrations" increased by 1
- Show "Total Customers" increased by 1
- Show "Recent Registrations" includes new user

---

### 8. Technical Explanation

**Session Handling**
- Explain: Client-side session using JavaScript variable
- Explain: User info stored in `currentUser` variable
- Explain: Session lost on browser refresh (acceptable for Day 8 scope)

**Server-Side Authorization**
- Explain: Role-based filtering in `getDashboardData(admin)`
- Explain: Role-based filtering in `searchUsers(query, filter, admin)`
- Explain: HQ Admin sees all, Hub Admin sees hub users, Center Admin sees center users
- Explain: Authorization enforced in backend, not just UI

**google.script.run**
- Explain: Asynchronous communication between client and server
- Explain: `runServer()` wrapper function
- Explain: Success and error handlers
- Explain: No direct API calls, uses Google Apps Script infrastructure

**Direct Backend Calls**
- Explain: All functions called via `google.script.run`
- Explain: No REST API endpoints
- Explain: Functions execute in Google's server environment

**Password Security**
- Explain: Passwords stored in Google Sheet (for demo purposes)
- Explain: Password field type="password" in HTML
- Explain: Passwords never exposed in client-side code
- Explain: Passwords only sent to server during login
- Explain: Production should use hashed passwords

**Concurrency**
- Explain: `LockService.getScriptLock()` used in critical sections
- Explain: Prevents duplicate registrations
- Explain: Prevents duplicate franchise additions
- Explain: Lock timeout: 30 seconds

**Future Production Migration**
- Explain: Move from Google Sheets to proper database (PostgreSQL, MySQL)
- Explain: Implement proper session tokens (JWT)
- Explain: Add server-side authentication middleware
- Explain: Implement REST API with Express.js or similar
- Explain: Add proper password hashing (bcrypt)
- Explain: Implement CSRF protection
- Explain: Add rate limiting
- Explain: Implement audit logging
- Explain: Use environment variables for sensitive data

---

### 9. Logout Demonstration

**Step 1: Click Logout**
- Click Logout button
- Show session cleared
- Show user info hidden
- Show navigation hidden
- Redirect to login page

**Step 2: Verify Session Ended**
- Try to navigate (buttons hidden)
- Show login page displayed

---

### 10. Summary

**Key Features Demonstrated:**
1. ✅ Login with credential validation
2. ✅ Session management (login/logout)
3. ✅ Role-based access control (3 roles)
4. ✅ Dashboard with 5 metrics and 2 charts
5. ✅ Franchise management (view, search)
6. ✅ User management (search, filter, details)
7. ✅ Customer registration with franchise mapping
8. ✅ Server-side authorization
9. ✅ Input validation
10. ✅ Duplicate prevention

**Technical Highlights:**
- Google Apps Script + Google Sheets architecture
- Client-side session management
- Server-side role-based filtering
- Asynchronous communication with google.script.run
- Lock-based concurrency control
- Password security (no exposure in frontend)

**Day 8 Complete!** 🎉
