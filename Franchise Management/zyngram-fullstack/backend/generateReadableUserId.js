function createUserId(existingIds) {
  const highestId = existingIds.reduce((highest, id) => {
    const match = /^USR(\d+)$/.exec(id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `USR${String(highestId + 1).padStart(3, '0')}`;
}

function createUserCodeAssignments(rows) {
  const assignedCodes = new Set(rows.map((row) => row.user_code).filter(Boolean));
  const reservedIds = rows.flatMap((row) => [row.id, row.user_code]).filter(Boolean);
  const assignments = [];

  for (const row of rows) {
    if (row.user_code) continue;
    const userCode = /^[A-Z]{2,}\d+$/.test(row.id) && !assignedCodes.has(row.id)
      ? row.id
      : createUserId(reservedIds);
    assignments.push({ id: row.id, userCode });
    assignedCodes.add(userCode);
    reservedIds.push(userCode);
  }

  return assignments;
}

module.exports = { createUserCodeAssignments, createUserId };
