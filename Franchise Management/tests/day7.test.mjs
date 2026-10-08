import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

class FakeRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    Object.assign(this, { sheet, row, column, rowCount, columnCount });
  }
  setValues(values) {
    values.forEach((row, rowOffset) => {
      const index = this.row - 1 + rowOffset;
      while (this.sheet.rows.length <= index) this.sheet.rows.push([]);
      row.forEach((value, columnOffset) => { this.sheet.rows[index][this.column - 1 + columnOffset] = value; });
    });
    return this;
  }
  getDisplayValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) => {
        const value = this.sheet.rows[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset] ?? "";
        return value instanceof Date ? value.toISOString().replace("T", " ").slice(0, 19) : String(value);
      }),
    );
  }
  setNumberFormat() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setFontWeight() { return this; }
}

class FakeSheet {
  constructor(name, spreadsheet) { this.name = name; this.spreadsheet = spreadsheet; this.rows = []; }
  setName(name) {
    this.spreadsheet.sheets.delete(this.name);
    this.name = name;
    this.spreadsheet.sheets.set(name, this);
  }
  getLastRow() { return this.rows.length; }
  getRange(row, column, rowCount, columnCount) { return new FakeRange(this, row, column, rowCount, columnCount); }
  setFrozenRows() {}
  autoResizeColumns() {}
}

class FakeSpreadsheet {
  constructor(id) {
    this.id = id;
    this.sheets = new Map();
    this.insertSheet("Sheet1");
  }
  getSheets() { return [...this.sheets.values()]; }
  getSheetByName(name) { return this.sheets.get(name) ?? null; }
  insertSheet(name) {
    if (this.sheets.has(name)) throw new Error(`Sheet ${name} already exists.`);
    const sheet = new FakeSheet(name, this);
    this.sheets.set(name, sheet);
    return sheet;
  }
  getId() { return this.id; }
  getUrl() { return `https://docs.google.test/spreadsheets/d/${this.id}`; }
}

async function makeApp() {
  const source = await readFile(new URL("../Code.gs", import.meta.url), "utf8");
  const properties = new Map();
  const spreadsheets = new Map();
  let id = 0;
  const context = vm.createContext({
    console,
    Logger: { log() {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties.get(key) ?? null,
      setProperty: (key, value) => properties.set(key, value),
    }) },
    SpreadsheetApp: {
      create: () => {
        const spreadsheet = new FakeSpreadsheet(`sheet-${++id}`);
        spreadsheets.set(spreadsheet.getId(), spreadsheet);
        return spreadsheet;
      },
      openById: (spreadsheetId) => {
        const spreadsheet = spreadsheets.get(spreadsheetId);
        if (!spreadsheet) throw new Error("Spreadsheet not found.");
        return spreadsheet;
      },
    },
    Utilities: {
      formatDate: (date, _timeZone, pattern) => pattern === "yyyyMMdd"
        ? date.toISOString().slice(0, 10).replaceAll("-", "")
        : date.toISOString().replace("T", " ").slice(0, 19),
      getUuid: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    },
    Session: { getScriptTimeZone: () => "UTC" },
    HtmlService: {},
  });
  vm.runInContext(source, context, { filename: "Code.gs" });
  return { app: context, spreadsheets, properties };
}

const customer = (overrides = {}) => ({
  name: "Priya Kumar",
  mobile: "+91 98765 43210",
  email: "priya@example.com",
  state: "Telangana",
  district: "Hyderabad",
  city: "Hyderabad",
  pin: "500001",
  service: "Delivery",
  ...overrides,
});

test("database setup creates both sheets and the required sample franchise hierarchy", async () => {
  const { app, spreadsheets } = await makeApp();
  const result = app.setupDatabase();
  assert.equal(result.success, true);
  const spreadsheet = [...spreadsheets.values()][0];
  assert.deepEqual([...spreadsheet.sheets.keys()], ["Users", "Franchise"]);
  const franchiseSheet = spreadsheet.getSheetByName("Franchise");
  assert.equal(franchiseSheet.getLastRow(), 4);
  assert.equal(new Set(franchiseSheet.rows.slice(1).map((row) => row[0])).size, 3);
  assert.equal(new Set(franchiseSheet.rows.slice(1).map((row) => row[2])).size, 2);
  assert.equal(new Set(franchiseSheet.rows.slice(1).map((row) => row[4])).size, 2);
  assert.equal(new Set(franchiseSheet.rows.slice(1).map((row) => row[6])).size, 1);
});

test("mapping normalizes location text and refuses missing or ambiguous matches", async () => {
  const { app, spreadsheets } = await makeApp();
  const mapped = app.getFranchiseMapping({ state: " telangana ", district: "HYDERABAD", city: "hyderabad", pin: "500001" });
  assert.equal(mapped.status, "MAPPED");
  assert.equal(mapped.hierarchy.point.id, "P001");
  assert.equal(mapped.hierarchy.center.name, "Center 01");
  assert.equal(app.getFranchiseMapping({ state: "Telangana", district: "Hyderabad", city: "Hyderabad", pin: "000000" }).status, "NOT MAPPED");

  const spreadsheet = [...spreadsheets.values()][0];
  const franchiseSheet = spreadsheet.getSheetByName("Franchise");
  franchiseSheet.rows.push([...franchiseSheet.rows[1]]);
  franchiseSheet.rows[4][0] = "P004";
  assert.equal(app.getFranchiseMapping({ state: "Telangana", district: "Hyderabad", city: "Hyderabad", pin: "500001" }).status, "AMBIGUOUS");
  franchiseSheet.rows.length = 1;
  assert.equal(app.getFranchiseMapping({ state: "Telangana", district: "Hyderabad", city: "Hyderabad", pin: "500001" }).status, "NOT MAPPED");
});

test("registration saves mapped and unmapped customers and blocks duplicate mobile or email", async () => {
  const { app, spreadsheets } = await makeApp();
  const mapped = app.registerUser(customer());
  assert.equal(mapped.status, "MAPPED");
  assert.equal(mapped.hierarchy.point.name, "Hyderabad Central Point");
  assert.match(mapped.userId, /^USR-\d{8}-[A-F0-9]{8}$/);
  assert.throws(() => app.registerUser(customer({ mobile: "+9198-76543210", email: "different@example.com" })), /mobile number is already registered/i);
  assert.throws(() => app.registerUser(customer({ mobile: "9876500000", email: "PRIYA@example.com" })), /email address is already registered/i);

  const unmapped = app.registerUser(customer({
    name: "Unmapped User", mobile: "9876500001", email: "unmapped@example.com",
    state: "Telangana", district: "Hyderabad", city: "Unknown", pin: "500099",
  }));
  assert.equal(unmapped.status, "NOT MAPPED");
  const users = [...spreadsheets.values()][0].getSheetByName("Users");
  assert.equal(users.getLastRow(), 3);
  assert.equal(users.rows[1][17], "MAPPED");
  assert.equal(users.rows[2][17], "NOT MAPPED");
});

test("dashboard aggregates by Center and Hub and omits customer contact details", async () => {
  const { app } = await makeApp();
  app.registerUser(customer());
  app.registerUser(customer({
    name: "Second User", mobile: "9876500001", email: "second@example.com",
    state: "Telangana", district: "Hyderabad", city: "Secunderabad", pin: "500003",
  }));
  app.registerUser(customer({
    name: "Unmapped User", mobile: "9876500002", email: "third@example.com",
    city: "Somewhere", pin: "500099",
  }));
  const dashboard = app.getDashboardData();
  assert.equal(dashboard.totalUsers, 3);
  assert.equal(dashboard.mappedUsers, 2);
  assert.equal(dashboard.unmappedUsers, 1);
  assert.equal(dashboard.franchiseUnits, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(dashboard.usersByCenter)), [{ name: "Center 01", count: 2 }]);
  assert.equal(dashboard.usersByHub[0].name, "Hub 01");
  assert.equal(dashboard.recentRegistrations.length, 3);
  assert.equal("email" in dashboard.recentRegistrations[0], false);
  assert.equal("mobile" in dashboard.recentRegistrations[0], false);
  assert.equal("name" in dashboard.recentRegistrations[0], false);
});

test("server rejects invalid fields and escapes formula-like user content", async () => {
  const { app, spreadsheets } = await makeApp();
  assert.throws(() => app.registerUser(customer({ name: " " })), /Name is required/);
  assert.throws(() => app.registerUser(customer({ mobile: "123" })), /valid mobile number/);
  assert.throws(() => app.registerUser(customer({ email: "not-an-email" })), /valid email address/);
  assert.throws(() => app.registerUser(customer({ pin: "12AB" })), /PIN code/);
  assert.throws(() => app.registerUser(customer({ service: "Unsupported" })), /valid service category/);

  app.registerUser(customer({ name: '=HYPERLINK("https://example.invalid", "click")' }));
  const savedName = [...spreadsheets.values()][0].getSheetByName("Users").rows[1][1];
  assert.equal(savedName.startsWith("'="), true);
});