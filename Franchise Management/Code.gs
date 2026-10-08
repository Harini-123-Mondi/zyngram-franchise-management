const USER_HEADERS = [
  "User ID", "Name", "Mobile", "Email", "State", "District", "City", "PIN", "Service",
  "Point ID", "Point", "Center ID", "Center", "Hub ID", "Hub", "Command ID", "Command",
  "Status", "Registration Date",
];
const FRANCHISE_HEADERS = [
  "Point ID", "Point Name", "Center ID", "Center Name", "Hub ID", "Hub Name",
  "Command ID", "Command Name", "State", "District", "City", "PIN", "Status",
];
const ADMIN_HEADERS = [
  "Admin ID", "Name", "Email", "Password", "Role", "Hub ID", "Center ID", "Status",
];
const AUDIT_LOG_HEADERS = [
  "Timestamp", "Admin ID", "Role", "Action", "Record ID", "Status", "Details",
];
const DATABASE_PROPERTY = "ZYNG_FRANCHISE_DATABASE_ID";
const REGISTRATION_SERVICES = ["Delivery", "Installation", "Repair", "General Service"];

function doGet() {
  ensureDatabase_();
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("Zyngram | Franchise Registration")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function setupDatabase() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = setupDatabase_();
    Logger.log("Franchise database ready: " + spreadsheet.getUrl());
    return { success: true, message: "Franchise database initialized. Its link is available in the Apps Script execution log." };
  } finally {
    lock.releaseLock();
  }
}

function setupDatabase_() {
  const properties = PropertiesService.getScriptProperties();
  const savedId = properties.getProperty(DATABASE_PROPERTY);
  if (savedId) {
    const existing = SpreadsheetApp.openById(savedId);
    initializeSheet_(existing, "Users", USER_HEADERS, []);
    initializeSheet_(existing, "Franchise", FRANCHISE_HEADERS, []);
    initializeSheet_(existing, "Admins", ADMIN_HEADERS, createStarterAdmins_());
    initializeSheet_(existing, "AuditLogs", AUDIT_LOG_HEADERS, []);
    return existing;
  }

  const spreadsheet = SpreadsheetApp.create("Zyngram Franchise Database");
  const firstSheet = spreadsheet.getSheets()[0];
  firstSheet.setName("Users");
  initializeSheet_(spreadsheet, "Users", USER_HEADERS, []);
  initializeSheet_(spreadsheet, "Franchise", FRANCHISE_HEADERS, createStarterFranchises_());
  initializeSheet_(spreadsheet, "Admins", ADMIN_HEADERS, createStarterAdmins_());
  initializeSheet_(spreadsheet, "AuditLogs", AUDIT_LOG_HEADERS, []);
  properties.setProperty(DATABASE_PROPERTY, spreadsheet.getId());
  return spreadsheet;
}

function ensureDatabase_() {
  if (PropertiesService.getScriptProperties().getProperty(DATABASE_PROPERTY)) {
    const spreadsheet = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty(DATABASE_PROPERTY));
    initializeSheet_(spreadsheet, "Users", USER_HEADERS, []);
    initializeSheet_(spreadsheet, "Franchise", FRANCHISE_HEADERS, []);
    initializeSheet_(spreadsheet, "Admins", ADMIN_HEADERS, []);
    initializeSheet_(spreadsheet, "AuditLogs", AUDIT_LOG_HEADERS, []);
    return spreadsheet;
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!PropertiesService.getScriptProperties().getProperty(DATABASE_PROPERTY)) {
      setupDatabase_();
    }
    const id = PropertiesService.getScriptProperties().getProperty(DATABASE_PROPERTY);
    return SpreadsheetApp.openById(id);
  } finally {
    lock.releaseLock();
  }
}

function initializeSheet_(spreadsheet, name, headers, starterRows) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground("#102b43")
      .setFontColor("#ffffff")
      .setFontWeight("bold");
    sheet.autoResizeColumns(1, headers.length);
  }
  if (name === "Franchise" && sheet.getLastRow() === 1 && starterRows.length) {
    sheet.getRange(2, 1, starterRows.length, headers.length).setValues(starterRows);
    sheet.getRange(2, 1, starterRows.length, headers.length).setNumberFormat("@");
  }
  if (name === "Admins" && sheet.getLastRow() === 1 && starterRows.length) {
    sheet.getRange(2, 1, starterRows.length, headers.length).setValues(starterRows);
    sheet.getRange(2, 1, starterRows.length, headers.length).setNumberFormat("@");
  }
  return sheet;
}

function createStarterFranchises_() {
  return [
    ["P001", "Hyderabad Central Point", "C001", "Center 01", "H001", "Hub 01", "CMD01", "Telangana Command", "Telangana", "Hyderabad", "Hyderabad", "500001", "ACTIVE"],
    ["P002", "Secunderabad Point", "C001", "Center 01", "H001", "Hub 01", "CMD01", "Telangana Command", "Telangana", "Hyderabad", "Secunderabad", "500003", "ACTIVE"],
    ["P003", "Guntur Point", "C002", "Center 02", "H002", "Hub 02", "CMD01", "Telangana Command", "Andhra Pradesh", "Guntur", "Guntur", "522001", "ACTIVE"],
  ];
}

function createStarterAdmins_() {
  return [
    ["ADM001", "HQ Administrator", "admin@zyngram.com", "admin123", "HQ_ADMIN", "", "", "ACTIVE"],
    ["ADM002", "Hub Administrator", "hubadmin@zyngram.com", "hub123", "HUB_ADMIN", "H001", "", "ACTIVE"],
    ["ADM003", "Center Administrator", "centeradmin@zyngram.com", "center123", "CENTER_ADMIN", "H001", "C001", "ACTIVE"],
    ["ADM004", "New Admin", "newadmin@zyngram.com", "newadmin123", "HQ_ADMIN", "", "", "ACTIVE"],
  ];
}

function logAudit(adminId, role, action, recordId, status, details) {
  const spreadsheet = ensureDatabase_();
  const sheet = spreadsheet.getSheetByName("AuditLogs");
  const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const row = [timestamp, adminId || "", role || "", action || "", recordId || "", status || "", details || ""];
  const nextRow = sheet.getLastRow() + 1;
  sheet.getRange(nextRow, 1, 1, row.length).setValues([row]);
}

function loginAdmin(email, password) {
  if (!email || !password) {
    throw new Error("Email and password are required.");
  }
  
  const spreadsheet = ensureDatabase_();
  const sheet = spreadsheet.getSheetByName("Admins");
  const admins = readRows_(sheet, ADMIN_HEADERS);
  
  const admin = admins.find(function (record) {
    return record.Email.toLowerCase() === email.toLowerCase() &&
           record.Password === password &&
           record.Status === "ACTIVE";
  });
  
  if (!admin) {
    logAudit("", "", "LOGIN_ATTEMPT", email, "FAILED", "Invalid credentials");
    throw new Error("Invalid credentials or account is inactive.");
  }
  
  logAudit(admin["Admin ID"], admin.Role, "LOGIN", admin["Admin ID"], "SUCCESS", "Admin logged in");
  
  return {
    success: true,
    adminId: admin["Admin ID"],
    name: admin.Name,
    email: admin.Email,
    role: admin.Role,
    hubId: admin["Hub ID"] || "",
    centerId: admin["Center ID"] || "",
  };
}

function getAdmins() {
  const spreadsheet = ensureDatabase_();
  const sheet = spreadsheet.getSheetByName("Admins");
  const admins = readRows_(sheet, ADMIN_HEADERS);
  return admins.map(function (admin) {
    return {
      adminId: admin["Admin ID"],
      name: admin.Name,
      email: admin.Email,
      role: admin.Role,
      hubId: admin["Hub ID"] || "",
      centerId: admin["Center ID"] || "",
      status: admin.Status,
    };
  });
}

function getFranchises() {
  const spreadsheet = ensureDatabase_();
  return getFranchises_(spreadsheet);
}

function searchFranchises(query) {
  const spreadsheet = ensureDatabase_();
  const franchises = getFranchises_(spreadsheet);
  if (!query || query.trim() === "") return franchises;
  
  const normalizedQuery = normalize_(query);
  return franchises.filter(function (franchise) {
    return normalize_(franchise.pointId).includes(normalizedQuery) ||
           normalize_(franchise.pointName).includes(normalizedQuery) ||
           normalize_(franchise.centerName).includes(normalizedQuery) ||
           normalize_(franchise.hubName).includes(normalizedQuery) ||
           normalize_(franchise.city).includes(normalizedQuery) ||
           normalize_(franchise.pin).includes(normalizedQuery);
  });
}

function addFranchise(data) {
  const spreadsheet = ensureDatabase_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = spreadsheet.getSheetByName("Franchise");
    const franchises = getFranchises_(spreadsheet);
    
    if (franchises.some(function (f) { return f.pointId === data.pointId; })) {
      throw new Error("A franchise with this Point ID already exists.");
    }
    
    const row = [
      data.pointId, data.pointName, data.centerId, data.centerName,
      data.hubId, data.hubName, data.commandId, data.commandName,
      data.state, data.district, data.city, data.pin, "ACTIVE"
    ];
    const nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, row.length).setNumberFormat("@");
    sheet.getRange(nextRow, 1, 1, row.length).setValues([row]);
    
    return { success: true, message: "Franchise added successfully." };
  } finally {
    lock.releaseLock();
  }
}

function searchUsers(query, statusFilter) {
  const spreadsheet = ensureDatabase_();
  const sheet = spreadsheet.getSheetByName("Users");
  const users = readRows_(sheet, USER_HEADERS);
  
  let results = users;
  const normalizedQuery = normalize_(query);
  
  if (query && query.trim() !== "") {
    results = results.filter(function (user) {
      return normalize_(user["User ID"]).includes(normalizedQuery) ||
             normalize_(user.Name).includes(normalizedQuery) ||
             normalize_(user.Mobile).includes(normalizedQuery) ||
             normalize_(user.Email).includes(normalizedQuery) ||
             normalize_(user.City).includes(normalizedQuery) ||
             normalize_(user.Point).includes(normalizedQuery) ||
             normalize_(user.Center).includes(normalizedQuery) ||
             normalize_(user.Hub).includes(normalizedQuery);
    });
  }
  
  if (statusFilter && statusFilter !== "") {
    results = results.filter(function (user) { return user.Status === statusFilter; });
  }
  
  return results.map(function (user) {
    return {
      userId: user["User ID"],
      name: user.Name,
      mobile: user.Mobile,
      email: user.Email,
      state: user.State,
      district: user.District,
      city: user.City,
      pin: user.PIN,
      service: user.Service,
      pointId: user["Point ID"],
      point: user.Point,
      centerId: user["Center ID"],
      center: user.Center,
      hubId: user["Hub ID"],
      hub: user.Hub,
      commandId: user["Command ID"],
      command: user.Command,
      status: user.Status,
      registrationDate: formatDate_(user["Registration Date"]),
    };
  });
}

function getUserDetails(userId) {
  const spreadsheet = ensureDatabase_();
  const sheet = spreadsheet.getSheetByName("Users");
  const users = readRows_(sheet, USER_HEADERS);
  
  const user = users.find(function (u) { return u["User ID"] === userId; });
  if (!user) throw new Error("User not found.");
  
  return {
    userId: user["User ID"],
    name: user.Name,
    mobile: user.Mobile,
    email: user.Email,
    state: user.State,
    district: user.District,
    city: user.City,
    pin: user.PIN,
    service: user.Service,
    pointId: user["Point ID"],
    point: user.Point,
    centerId: user["Center ID"],
    center: user.Center,
    hubId: user["Hub ID"],
    hub: user.Hub,
    commandId: user["Command ID"],
    command: user.Command,
    status: user.Status,
    registrationDate: formatDate_(user["Registration Date"]),
  };
}

function getDashboardData(admin) {
  const spreadsheet = ensureDatabase_();
  const users = readRows_(spreadsheet.getSheetByName("Users"), USER_HEADERS);
  const franchises = getFranchises_(spreadsheet).filter(function (item) { return item.status === "ACTIVE"; });
  
  // Apply role-based filtering
  let filteredUsers = users;
  if (admin && admin.role) {
    if (admin.role === "CENTER_ADMIN" && admin.centerId) {
      filteredUsers = users.filter(function (user) { return user["Center ID"] === admin.centerId; });
    } else if (admin.role === "HUB_ADMIN" && admin.hubId) {
      filteredUsers = users.filter(function (user) { return user["Hub ID"] === admin.hubId; });
    }
    // HQ_ADMIN sees all users
  }
  
  const mappedUsers = filteredUsers.filter(function (user) { return user.Status === "MAPPED"; });
  const today = new Date().toDateString();
  const todayRegistrations = filteredUsers.filter(function (user) {
    return new Date(user["Registration Date"]).toDateString() === today;
  });
  
  return {
    totalUsers: filteredUsers.length,
    mappedUsers: mappedUsers.length,
    unmappedUsers: filteredUsers.length - mappedUsers.length,
    todayRegistrations: todayRegistrations.length,
    franchiseUnits: franchises.length,
    usersByCenter: countBy_(mappedUsers, "Center"),
    usersByHub: countBy_(mappedUsers, "Hub"),
    recentRegistrations: filteredUsers
      .sort(function (a, b) { return new Date(b["Registration Date"]).getTime() - new Date(a["Registration Date"]).getTime(); })
      .slice(0, 10)
      .map(function (user) {
        return {
          userId: user["User ID"],
          point: user.Point || "",
          center: user.Center || "",
          registeredAt: formatDate_(user["Registration Date"]),
          status: user.Status,
        };
      }),
  };
}

function searchUsers(filters, admin) {
  const spreadsheet = ensureDatabase_();
  const sheet = spreadsheet.getSheetByName("Users");
  let users = readRows_(sheet, USER_HEADERS);
  
  // Apply role-based filtering
  if (admin && admin.role) {
    if (admin.role === "CENTER_ADMIN" && admin.centerId) {
      users = users.filter(function (user) { return user["Center ID"] === admin.centerId; });
    } else if (admin.role === "HUB_ADMIN" && admin.hubId) {
      users = users.filter(function (user) { return user["Hub ID"] === admin.hubId; });
    }
  }
  
  let results = users;
  
  // Apply text search
  if (filters.query && filters.query.trim() !== "") {
    const normalizedQuery = normalize_(filters.query);
    results = results.filter(function (user) {
      return normalize_(user["User ID"]).includes(normalizedQuery) ||
             normalize_(user.Name).includes(normalizedQuery) ||
             normalize_(user.Mobile).includes(normalizedQuery) ||
             normalize_(user.Email).includes(normalizedQuery) ||
             normalize_(user.City).includes(normalizedQuery) ||
             normalize_(user.Point).includes(normalizedQuery) ||
             normalize_(user.Center).includes(normalizedQuery) ||
             normalize_(user.Hub).includes(normalizedQuery);
    });
  }
  
  // Apply status filter
  if (filters.status && filters.status !== "") {
    results = results.filter(function (user) { return user.Status === filters.status; });
  }
  
  // Apply state filter
  if (filters.state && filters.state !== "") {
    results = results.filter(function (user) { return normalize_(user.State) === normalize_(filters.state); });
  }
  
  // Apply city filter
  if (filters.city && filters.city !== "") {
    results = results.filter(function (user) { return normalize_(user.City) === normalize_(filters.city); });
  }
  
  // Apply point filter
  if (filters.point && filters.point !== "") {
    results = results.filter(function (user) { return user["Point ID"] === filters.point; });
  }
  
  // Apply center filter
  if (filters.center && filters.center !== "") {
    results = results.filter(function (user) { return user["Center ID"] === filters.center; });
  }
  
  // Apply hub filter
  if (filters.hub && filters.hub !== "") {
    results = results.filter(function (user) { return user["Hub ID"] === filters.hub; });
  }
  
  // Apply date range filter
  if (filters.startDate && filters.startDate !== "") {
    const startDate = new Date(filters.startDate);
    results = results.filter(function (user) {
      return new Date(user["Registration Date"]) >= startDate;
    });
  }
  
  if (filters.endDate && filters.endDate !== "") {
    const endDate = new Date(filters.endDate);
    endDate.setHours(23, 59, 59, 999);
    results = results.filter(function (user) {
      return new Date(user["Registration Date"]) <= endDate;
    });
  }
  
  return results.map(function (user) {
    return {
      userId: user["User ID"],
      name: user.Name,
      mobile: user.Mobile,
      email: user.Email,
      state: user.State,
      district: user.District,
      city: user.City,
      pin: user.PIN,
      service: user.Service,
      pointId: user["Point ID"],
      point: user.Point,
      centerId: user["Center ID"],
      center: user.Center,
      hubId: user["Hub ID"],
      hub: user.Hub,
      commandId: user["Command ID"],
      command: user.Command,
      status: user.Status,
      registrationDate: formatDate_(user["Registration Date"]),
    };
  });
}

function getFranchiseMapping(location) {
  const clean = validateLocation_(location);
  const spreadsheet = ensureDatabase_();
  const franchises = getFranchises_(spreadsheet);
  const matches = franchises.filter(function (franchise) {
    return franchise.status === "ACTIVE" &&
      normalize_(franchise.state) === normalize_(clean.state) &&
      normalize_(franchise.district) === normalize_(clean.district) &&
      normalize_(franchise.city) === normalize_(clean.city) &&
      normalize_(franchise.pin) === normalize_(clean.pin);
  });

  if (!matches.length) {
    return { status: "NOT MAPPED", message: "No active franchise matches this State, District, City and PIN.", hierarchy: null };
  }
  if (matches.length > 1) {
    return { status: "AMBIGUOUS", message: "More than one active franchise matches this location. Ask an administrator to correct the franchise data.", hierarchy: null };
  }

  const franchise = matches[0];
  const hierarchy = {
    point: { id: franchise.pointId, name: franchise.pointName },
    center: { id: franchise.centerId, name: franchise.centerName },
    hub: { id: franchise.hubId, name: franchise.hubName },
    command: { id: franchise.commandId, name: franchise.commandName },
  };
  const complete = Object.keys(hierarchy).every(function (level) {
    return hierarchy[level].id && hierarchy[level].name;
  });
  if (!complete) {
    return { status: "INCOMPLETE", message: "The matching franchise row is missing part of its hierarchy.", hierarchy: hierarchy };
  }
  return { status: "MAPPED", message: "Location matched an active physical franchise.", hierarchy: hierarchy };
}

function checkDuplicateUser(data) {
  const mobile = normalizeMobile_(data && data.mobile);
  const email = normalizeEmail_(data && data.email);
  if (!mobile && !email) return { mobileExists: false, emailExists: false };

  const sheet = ensureDatabase_().getSheetByName("Users");
  const users = readRows_(sheet, USER_HEADERS);
  return {
    mobileExists: Boolean(mobile && users.some(function (user) { return normalizeMobile_(user.Mobile) === mobile; })),
    emailExists: Boolean(email && users.some(function (user) { return normalizeEmail_(user.Email) === email; })),
  };
}

function registerUser(data, admin) {
  const user = validateRegistration_(data);
  const spreadsheet = ensureDatabase_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = spreadsheet.getSheetByName("Users");
    const existingUsers = readRows_(sheet, USER_HEADERS);
    if (existingUsers.some(function (record) { return normalizeMobile_(record.Mobile) === user.mobile; })) {
      logAudit(admin ? admin.adminId : "", admin ? admin.role : "", "USER_REGISTRATION", user.mobile, "FAILED", "Duplicate mobile");
      throw new Error("A customer with this mobile number is already registered.");
    }
    if (existingUsers.some(function (record) { return normalizeEmail_(record.Email) === user.email; })) {
      logAudit(admin ? admin.adminId : "", admin ? admin.role : "", "USER_REGISTRATION", user.email, "FAILED", "Duplicate email");
      throw new Error("A customer with this email address is already registered.");
    }

    const mapping = getFranchiseMapping(user);
    const userId = "USR-" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd") +
      "-" + Utilities.getUuid().replace(/-/g, "").substring(0, 8).toUpperCase();
    const registeredAt = new Date();
    const hierarchy = mapping.hierarchy || {};
    const row = [
      userId, safeCell_(user.name), safeCell_(user.mobile), safeCell_(user.email),
      safeCell_(user.state), safeCell_(user.district), safeCell_(user.city), safeCell_(user.pin),
      safeCell_(user.service), hierarchy.point && hierarchy.point.id || "", hierarchy.point && hierarchy.point.name || "",
      hierarchy.center && hierarchy.center.id || "", hierarchy.center && hierarchy.center.name || "",
      hierarchy.hub && hierarchy.hub.id || "", hierarchy.hub && hierarchy.hub.name || "",
      hierarchy.command && hierarchy.command.id || "", hierarchy.command && hierarchy.command.name || "",
      mapping.status === "MAPPED" ? "MAPPED" : "NOT MAPPED", registeredAt,
    ];
    const nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, row.length).setNumberFormat("@");
    sheet.getRange(nextRow, 1, 1, row.length).setValues([row]);
    sheet.getRange(nextRow, USER_HEADERS.length).setNumberFormat("yyyy-mm-dd hh:mm:ss");

    logAudit(admin ? admin.adminId : "", admin ? admin.role : "", "USER_REGISTRATION", userId, "SUCCESS", "User registered: " + user.name);

    // Send email notification
    const emailBody = "Registration Confirmation\n\n" +
      "Dear " + user.name + ",\n\n" +
      "Thank you for registering with Zyngram Franchise System.\n\n" +
      "Your User ID: " + userId + "\n" +
      "Registration Date: " + Utilities.formatDate(registeredAt, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss") + "\n" +
      "Service: " + user.service + "\n" +
      "Location: " + user.city + ", " + user.district + ", " + user.state + " - " + user.pin + "\n\n";
    
    if (mapping.status === "MAPPED" && hierarchy) {
      emailBody += "Assigned Franchise:\n" +
        "Point: " + (hierarchy.point.name || "—") + " (ID: " + (hierarchy.point.id || "—") + ")\n" +
        "Center: " + (hierarchy.center.name || "—") + " (ID: " + (hierarchy.center.id || "—") + ")\n" +
        "Hub: " + (hierarchy.hub.name || "—") + " (ID: " + (hierarchy.hub.id || "—") + ")\n\n";
    } else {
      emailBody += "Status: Not Mapped - Our team will assign a franchise soon.\n\n";
    }
    
    emailBody += "If you did not register for this service, please ignore this email.\n\n" +
      "Best regards,\nZyngram Franchise Team";
    
    try {
      MailApp.sendEmail(user.email, "Zyngram Registration Confirmation", emailBody);
      logAudit(admin ? admin.adminId : "", admin ? admin.role : "", "EMAIL_SENT", userId, "SUCCESS", "Registration email sent to " + user.email);
    } catch (emailError) {
      logAudit(admin ? admin.adminId : "", admin ? admin.role : "", "EMAIL_SENT", userId, "FAILED", "Email failed: " + emailError.message);
    }

    return {
      success: true,
      userId: userId,
      status: mapping.status === "MAPPED" ? "MAPPED" : "NOT MAPPED",
      message: mapping.message,
      hierarchy: mapping.status === "MAPPED" ? mapping.hierarchy : null,
      registeredAt: Utilities.formatDate(registeredAt, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
    };
  } finally {
    lock.releaseLock();
  }
}

function logoutAdmin(adminId, role) {
  logAudit(adminId, role, "LOGOUT", adminId, "SUCCESS", "Admin logged out");
  return { success: true };
}

function getDashboardData() {
  const spreadsheet = ensureDatabase_();
  const users = readRows_(spreadsheet.getSheetByName("Users"), USER_HEADERS);
  const franchises = getFranchises_(spreadsheet).filter(function (item) { return item.status === "ACTIVE"; });
  const mappedUsers = users.filter(function (user) { return user.Status === "MAPPED"; });
  const today = new Date().toDateString();
  const todayRegistrations = users.filter(function (user) {
    return new Date(user["Registration Date"]).toDateString() === today;
  });
  
  return {
    totalUsers: users.length,
    mappedUsers: mappedUsers.length,
    unmappedUsers: users.length - mappedUsers.length,
    todayRegistrations: todayRegistrations.length,
    franchiseUnits: franchises.length,
    usersByCenter: countBy_(mappedUsers, "Center"),
    usersByHub: countBy_(mappedUsers, "Hub"),
    recentRegistrations: users
      .sort(function (a, b) { return new Date(b["Registration Date"]).getTime() - new Date(a["Registration Date"]).getTime(); })
      .slice(0, 10)
      .map(function (user) {
        return {
          userId: user["User ID"],
          point: user.Point || "",
          center: user.Center || "",
          registeredAt: formatDate_(user["Registration Date"]),
          status: user.Status,
        };
      }),
  };
}

function getFranchisePerformanceReport(admin) {
  const spreadsheet = ensureDatabase_();
  const users = readRows_(spreadsheet.getSheetByName("Users"), USER_HEADERS);
  const franchises = getFranchises_(spreadsheet).filter(function (item) { return item.status === "ACTIVE"; });
  
  let filteredUsers = users;
  if (admin && admin.role) {
    if (admin.role === "CENTER_ADMIN" && admin.centerId) {
      filteredUsers = users.filter(function (user) { return user["Center ID"] === admin.centerId; });
    } else if (admin.role === "HUB_ADMIN" && admin.hubId) {
      filteredUsers = users.filter(function (user) { return user["Hub ID"] === admin.hubId; });
    }
  }
  
  const mappedUsers = filteredUsers.filter(function (user) { return user.Status === "MAPPED"; });
  const unmappedUsers = filteredUsers.filter(function (user) { return user.Status === "NOT MAPPED"; });
  
  const byCenter = countBy_(mappedUsers, "Center");
  const byHub = countBy_(mappedUsers, "Hub");
  const byCommand = countBy_(mappedUsers, "Command");
  
  const topCenters = byCenter.sort(function (a, b) { return b.count - a.count; }).slice(0, 5);
  const topHubs = byHub.sort(function (a, b) { return b.count - a.count; }).slice(0, 5);
  
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const activeUsers = filteredUsers.filter(function (user) {
    return new Date(user["Registration Date"]) >= thirtyDaysAgo;
  });
  
  return {
    totalFranchiseUnits: franchises.length,
    totalUsers: filteredUsers.length,
    mappedUsers: mappedUsers.length,
    unmappedUsers: unmappedUsers.length,
    activeUsers: activeUsers.length,
    registrationsByCenter: byCenter,
    registrationsByHub: byHub,
    registrationsByCommand: byCommand,
    topCenters: topCenters,
    topHubs: topHubs,
    mappingRate: filteredUsers.length > 0 ? Math.round((mappedUsers.length / filteredUsers.length) * 100) : 0,
  };
}

function getDateReport(rangeType, customStartDate, customEndDate, admin) {
  const spreadsheet = ensureDatabase_();
  const users = readRows_(spreadsheet.getSheetByName("Users"), USER_HEADERS);
  
  let filteredUsers = users;
  if (admin && admin.role) {
    if (admin.role === "CENTER_ADMIN" && admin.centerId) {
      filteredUsers = users.filter(function (user) { return user["Center ID"] === admin.centerId; });
    } else if (admin.role === "HUB_ADMIN" && admin.hubId) {
      filteredUsers = users.filter(function (user) { return user["Hub ID"] === admin.hubId; });
    }
  }
  
  const now = new Date();
  let startDate, endDate;
  let rangeLabel;
  
  switch (rangeType) {
    case "today":
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      rangeLabel = "Today";
      break;
    case "yesterday":
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
      rangeLabel = "Yesterday";
      break;
    case "last7days":
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      rangeLabel = "Last 7 Days";
      break;
    case "last30days":
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      rangeLabel = "Last 30 Days";
      break;
    case "custom":
      startDate = new Date(customStartDate);
      endDate = new Date(customEndDate);
      endDate.setHours(23, 59, 59, 999);
      rangeLabel = "Custom Range";
      break;
    default:
      throw new Error("Invalid date range type.");
  }
  
  const usersInRange = filteredUsers.filter(function (user) {
    const regDate = new Date(user["Registration Date"]);
    return regDate >= startDate && regDate <= endDate;
  });
  
  const mappedInRange = usersInRange.filter(function (user) { return user.Status === "MAPPED"; });
  const unmappedInRange = usersInRange.filter(function (user) { return user.Status === "NOT MAPPED"; });
  
  return {
    rangeLabel: rangeLabel,
    startDate: Utilities.formatDate(startDate, Session.getScriptTimeZone(), "yyyy-MM-dd"),
    endDate: Utilities.formatDate(endDate, Session.getScriptTimeZone(), "yyyy-MM-dd"),
    totalRegistrations: usersInRange.length,
    mappedRegistrations: mappedInRange.length,
    unmappedRegistrations: unmappedInRange.length,
    activeRegistrations: usersInRange.length,
    registrationsByCenter: countBy_(mappedInRange, "Center"),
    registrationsByHub: countBy_(mappedInRange, "Hub"),
    registrationsByCommand: countBy_(mappedInRange, "Command"),
  };
}

function exportUsers(filters, admin, adminId) {
  const spreadsheet = ensureDatabase_();
  const users = readRows_(spreadsheet.getSheetByName("Users"), USER_HEADERS);
  
  let filteredUsers = users;
  if (admin && admin.role) {
    if (admin.role === "CENTER_ADMIN" && admin.centerId) {
      filteredUsers = users.filter(function (user) { return user["Center ID"] === admin.centerId; });
    } else if (admin.role === "HUB_ADMIN" && admin.hubId) {
      filteredUsers = users.filter(function (user) { return user["Hub ID"] === admin.hubId; });
    }
  }
  
  if (filters.query && filters.query.trim() !== "") {
    const normalizedQuery = normalize_(filters.query);
    filteredUsers = filteredUsers.filter(function (user) {
      return normalize_(user["User ID"]).includes(normalizedQuery) ||
             normalize_(user.Name).includes(normalizedQuery) ||
             normalize_(user.Mobile).includes(normalizedQuery) ||
             normalize_(user.Email).includes(normalizedQuery) ||
             normalize_(user.City).includes(normalizedQuery) ||
             normalize_(user.Point).includes(normalizedQuery) ||
             normalize_(user.Center).includes(normalizedQuery) ||
             normalize_(user.Hub).includes(normalizedQuery);
    });
  }
  
  if (filters.status && filters.status !== "") {
    filteredUsers = filteredUsers.filter(function (user) { return user.Status === filters.status; });
  }
  
  if (filters.startDate && filters.startDate !== "") {
    const startDate = new Date(filters.startDate);
    filteredUsers = filteredUsers.filter(function (user) {
      return new Date(user["Registration Date"]) >= startDate;
    });
  }
  
  if (filters.endDate && filters.endDate !== "") {
    const endDate = new Date(filters.endDate);
    endDate.setHours(23, 59, 59, 999);
    filteredUsers = filteredUsers.filter(function (user) {
      return new Date(user["Registration Date"]) <= endDate;
    });
  }
  
  const exportSpreadsheet = SpreadsheetApp.create("Zyngram Users Export - " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"));
  const sheet = exportSpreadsheet.getSheets()[0];
  sheet.setName("Users");
  
  sheet.getRange(1, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS]);
  sheet.getRange(1, 1, 1, USER_HEADERS.length).setFontWeight("bold").setBackground("#4a86e8").setFontColor("white");
  
  const data = filteredUsers.map(function (user) {
    return USER_HEADERS.map(function (header) { return user[header] || ""; });
  });
  if (data.length > 0) {
    sheet.getRange(2, 1, data.length, data[0].length).setValues(data);
  }
  
  sheet.autoResizeColumns(1, USER_HEADERS.length);
  
  logAudit(adminId, admin ? admin.role : "", "USER_EXPORT", exportSpreadsheet.getId(), "SUCCESS", "Exported " + filteredUsers.length + " users");
  
  return {
    success: true,
    spreadsheetId: exportSpreadsheet.getId(),
    spreadsheetUrl: exportSpreadsheet.getUrl(),
    recordCount: filteredUsers.length,
  };
}

function dailySummaryReportTrigger() {
  const spreadsheet = ensureDatabase_();
  const users = readRows_(spreadsheet.getSheetByName("Users"), USER_HEADERS);
  const franchises = getFranchises_(spreadsheet).filter(function (item) { return item.status === "ACTIVE"; });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayRegistrations = users.filter(function (user) {
    return new Date(user["Registration Date"]) >= today;
  });
  const mappedUsers = users.filter(function (user) { return user.Status === "MAPPED"; });
  const unmappedUsers = users.filter(function (user) { return user.Status === "NOT MAPPED"; });
  
  const summary = "Daily Summary Report - " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd") + "\n\n" +
    "Total Users: " + users.length + "\n" +
    "Mapped Users: " + mappedUsers.length + "\n" +
    "Unmapped Users: " + unmappedUsers.length + "\n" +
    "Today's Registrations: " + todayRegistrations.length + "\n" +
    "Active Franchise Units: " + franchises.length + "\n\n" +
    "Mapping Rate: " + (users.length > 0 ? Math.round((mappedUsers.length / users.length) * 100) : 0) + "%";
  
  logAudit("SYSTEM", "TRIGGER", "DAILY_SUMMARY", "", "SUCCESS", "Daily summary report generated");
  
  const admins = readRows_(spreadsheet.getSheetByName("Admins"), ADMIN_HEADERS);
  const hqAdmins = admins.filter(function (admin) { return admin.Role === "HQ_ADMIN" && admin.Status === "ACTIVE"; });
  hqAdmins.forEach(function (admin) {
    MailApp.sendEmail(admin.Email, "Zyngram Daily Summary Report", summary);
  });
  
  return { success: true, summary: summary };
}

function unmappedUserNotificationTrigger() {
  const spreadsheet = ensureDatabase_();
  const users = readRows_(spreadsheet.getSheetByName("Users"), USER_HEADERS);
  const unmappedUsers = users.filter(function (user) { return user.Status === "NOT MAPPED"; });
  
  if (unmappedUsers.length === 0) {
    logAudit("SYSTEM", "TRIGGER", "UNMAPPED_CHECK", "", "SUCCESS", "No unmapped users found");
    return { success: true, message: "No unmapped users" };
  }
  
  const message = "Unmapped Users Alert\n\n" +
    "There are " + unmappedUsers.length + " unmapped users in the system.\n" +
    "Please review and assign appropriate franchises.\n\n" +
    "Unmapped Users:\n" +
    unmappedUsers.slice(0, 10).map(function (user) {
      return "- " + user["User ID"] + ": " + user.Name + " (" + user.City + ", " + user.State + ")";
    }).join("\n") +
    (unmappedUsers.length > 10 ? "\n... and " + (unmappedUsers.length - 10) + " more" : "");
  
  logAudit("SYSTEM", "TRIGGER", "UNMAPPED_CHECK", "", "SUCCESS", "Found " + unmappedUsers.length + " unmapped users");
  
  const admins = readRows_(spreadsheet.getSheetByName("Admins"), ADMIN_HEADERS);
  const hqAdmins = admins.filter(function (admin) { return admin.Role === "HQ_ADMIN" && admin.Status === "ACTIVE"; });
  hqAdmins.forEach(function (admin) {
    MailApp.sendEmail(admin.Email, "Zyngram Unmapped Users Alert", message);
  });
  
  return { success: true, unmappedCount: unmappedUsers.length };
}

function getFranchises_(spreadsheet) {
  spreadsheet = spreadsheet || ensureDatabase_();
  return readRows_(spreadsheet.getSheetByName("Franchise"), FRANCHISE_HEADERS).map(function (row) {
    return {
      pointId: row["Point ID"],
      pointName: row["Point Name"],
      centerId: row["Center ID"],
      centerName: row["Center Name"],
      hubId: row["Hub ID"],
      hubName: row["Hub Name"],
      commandId: row["Command ID"],
      commandName: row["Command Name"],
      state: row.State,
      district: row.District,
      city: row.City,
      pin: String(row.PIN || ""),
      status: String(row.Status || "").toUpperCase(),
    };
  });
}

function readRows_(sheet, headers) {
  if (!sheet) throw new Error("A required database sheet is missing. Run setupDatabase() from the Apps Script editor.");
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getDisplayValues();
  return values.map(function (row) {
    return headers.reduce(function (record, header, index) {
      record[header] = row[index] || "";
      return record;
    }, {});
  });
}

function countBy_(users, field) {
  const counts = {};
  users.forEach(function (user) {
    const name = String(user[field] || "").trim() || "Unassigned";
    counts[name] = (counts[name] || 0) + 1;
  });
  return Object.keys(counts).sort().map(function (name) { return { name: name, count: counts[name] }; });
}

function validateRegistration_(data) {
  if (!data || typeof data !== "object") throw new Error("Registration details are required.");
  const user = {
    name: requiredText_(data.name, "Name", 100),
    mobile: normalizeMobile_(requiredText_(data.mobile, "Mobile number", 16)),
    email: normalizeEmail_(requiredText_(data.email, "Email address", 150)),
    state: requiredText_(data.state, "State", 60),
    district: requiredText_(data.district, "District", 60),
    city: requiredText_(data.city, "City", 60),
    pin: requiredText_(data.pin, "PIN code", 10),
    service: requiredText_(data.service, "Service category", 40),
  };
  if (!/^\+?[0-9]{8,15}$/.test(user.mobile)) throw new Error("Enter a valid mobile number with 8–15 digits.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) throw new Error("Enter a valid email address.");
  if (!/^[0-9]{4,10}$/.test(user.pin)) throw new Error("PIN code must contain 4–10 digits.");
  if (REGISTRATION_SERVICES.indexOf(user.service) === -1) throw new Error("Choose a valid service category.");
  return user;
}

function validateLocation_(data) {
  if (!data || typeof data !== "object") throw new Error("Location details are required.");
  return {
    state: requiredText_(data.state, "State", 60),
    district: requiredText_(data.district, "District", 60),
    city: requiredText_(data.city, "City", 60),
    pin: requiredText_(data.pin, "PIN code", 10),
  };
}

function requiredText_(value, label, maxLength) {
  if (typeof value !== "string") throw new Error(label + " is required.");
  const text = value.trim();
  if (!text) throw new Error(label + " is required.");
  if (text.length > maxLength) throw new Error(label + " must not exceed " + maxLength + " characters.");
  return text;
}

function normalize_(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeMobile_(value) {
  return String(value || "").trim().replace(/^'/, "").replace(/[\s()-]/g, "");
}

function normalizeEmail_(value) {
  return String(value || "").trim().toLowerCase();
}

function safeCell_(value) {
  const text = String(value == null ? "" : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function formatDate_(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return String(value || "");
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
}
