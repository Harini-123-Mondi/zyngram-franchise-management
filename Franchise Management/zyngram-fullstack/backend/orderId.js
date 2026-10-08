function createOrderId(date = new Date(), uniqueId) {
  const indiaDate = new Date(date.getTime() + 330 * 60 * 1000);
  const datePart = indiaDate.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = String(uniqueId).replace(/-/g, '').slice(0, 12).toUpperCase();

  if (!/^[0-9A-F]{12}$/.test(suffix)) {
    throw new Error('A valid unique ID is required to create an order ID.');
  }

  return `ORD-${datePart}-${suffix}`;
}

module.exports = { createOrderId };
