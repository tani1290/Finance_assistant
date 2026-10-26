/**
 * INR (Indian Rupee) Formatting Utilities
 * Owner: Jinay Golecha (jinay_golecha)
 * Locale: en-IN | Currency: INR
 */

/**
 * Format a number as Indian Rupee with Indian numbering system
 * e.g., 150000 → "₹1,50,000.00"
 */
const formatINR = (amount, showDecimals = true) => {
  const num = parseFloat(amount) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(num);
};

module.exports = { formatINR };
