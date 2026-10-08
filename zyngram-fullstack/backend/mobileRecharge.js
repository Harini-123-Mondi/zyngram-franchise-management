const RECHARGE_OPERATORS = [
  { id: 'AIRTEL', name: 'Airtel' },
  { id: 'JIO', name: 'Jio' },
  { id: 'VI', name: 'Vi' },
  { id: 'BSNL', name: 'BSNL' }
];

const RECHARGE_CIRCLES = [
  'Andhra Pradesh', 'Assam', 'Bihar & Jharkhand', 'Chennai', 'Delhi & NCR',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu & Kashmir', 'Karnataka',
  'Kerala', 'Kolkata', 'Madhya Pradesh & Chhattisgarh', 'Maharashtra & Goa',
  'Mumbai', 'North East', 'Odisha', 'Punjab', 'Rajasthan', 'Tamil Nadu',
  'Uttar Pradesh (East)', 'Uttar Pradesh (West)', 'West Bengal'
];

function validateRechargeOrder(input) {
  if (!input || typeof input !== 'object') return 'Recharge details are required.';
  const mobile = typeof input.mobileNumber === 'string'
    ? input.mobileNumber.replace(/[\s()-]/g, '')
    : '';
  if (!/^(?:\+91)?[6-9]\d{9}$/.test(mobile)) {
    return 'Enter a valid Indian mobile number.';
  }
  if (!RECHARGE_OPERATORS.some((operator) => operator.id === input.operator)) {
    return 'Select a supported mobile operator.';
  }
  if (!RECHARGE_CIRCLES.includes(input.circle)) {
    return 'Select a supported telecom circle.';
  }
  const amount = Number(input.amount);
  if (input.amount === undefined || input.amount === null || String(input.amount).trim() === '' ||
      !Number.isFinite(amount) || amount < 10 || amount > 5000 ||
      Math.round(amount * 100) !== amount * 100) {
    return 'Recharge amount must be between ₹10 and ₹5,000 with up to two decimal places.';
  }
  return null;
}

module.exports = { RECHARGE_CIRCLES, RECHARGE_OPERATORS, validateRechargeOrder };
