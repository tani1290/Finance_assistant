/**
 * EMI Calculator & Financial Math Utilities
 * Owner: Jinay Golecha (jinay_golecha)
 */

/**
 * Standard EMI formula: P * r * (1+r)^n / ((1+r)^n - 1)
 * @param {number} principal - Loan amount
 * @param {number} annualRate - Annual interest rate (e.g., 8.5 for 8.5%)
 * @param {number} tenureMonths - Loan tenure in months
 * @returns {number} Monthly EMI amount
 */
const calculateEMI = (principal, annualRate, tenureMonths) => {
  if (!annualRate || annualRate === 0) {
    return tenureMonths > 0 ? principal / tenureMonths : principal;
  }
  const r = annualRate / 100 / 12; // Monthly interest rate
  const n = tenureMonths;
  const emi = principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  return Math.round(emi * 100) / 100;
};

/**
 * Calculate total interest paid over the loan period
 */
const calculateTotalInterest = (principal, annualRate, tenureMonths) => {
  const emi = calculateEMI(principal, annualRate, tenureMonths);
  const totalPayment = emi * tenureMonths;
  return Math.round((totalPayment - principal) * 100) / 100;
};

/**
 * Simulate prepayment: calculate interest saved and months reduced
 * @param {number} principal - Outstanding balance
 * @param {number} annualRate - Annual interest rate
 * @param {number} tenureMonths - Remaining tenure in months
 * @param {number} prepaymentAmount - One-time prepayment amount
 */
const simulatePrepayment = (principal, annualRate, tenureMonths, prepaymentAmount) => {
  if (prepaymentAmount >= principal) {
    const interestSaved = calculateTotalInterest(principal, annualRate, tenureMonths);
    return {
      monthsSaved: tenureMonths,
      interestSaved: Math.round(interestSaved * 100) / 100,
      newPrincipal: 0,
      newEmi: 0,
    };
  }

  const emi = calculateEMI(principal, annualRate, tenureMonths);
  const newPrincipal = principal - prepaymentAmount;
  const r = annualRate / 100 / 12;

  // New tenure: n = -log(1 - r*P/EMI) / log(1+r)
  let newTenure;
  try {
    const val = 1 - (r * newPrincipal / emi);
    if (val <= 0) {
      newTenure = 1;
    } else {
      newTenure = Math.ceil(-Math.log(val) / Math.log(1 + r));
    }
  } catch {
    newTenure = Math.max(1, tenureMonths - 12);
  }

  const monthsSaved = Math.max(0, tenureMonths - newTenure);
  const interestSaved = monthsSaved * emi;

  return {
    monthsSaved,
    interestSaved: Math.round(interestSaved * 100) / 100,
    newPrincipal: Math.round(newPrincipal * 100) / 100,
    newEmi: Math.round(calculateEMI(newPrincipal, annualRate, newTenure) * 100) / 100,
    newTenure,
  };
};

/**
 * Calculate Financial Health Score (0-100)
 */
const calculateHealthScore = ({
  monthlyIncome = 0,
  monthlyExpenses = 0,
  totalSavings = 0,
  totalDebt = 0,
  totalInvestments = 0,
  emergencyFund = 0,
}) => {
  let score = 50; // Base score

  // Savings rate: 20%+ = +20, 10-20% = +10, <10% = 0
  const savingsRate = monthlyIncome > 0 ? (monthlyIncome - monthlyExpenses) / monthlyIncome : 0;
  if (savingsRate >= 0.2) score += 20;
  else if (savingsRate >= 0.1) score += 10;
  else if (savingsRate < 0) score -= 15;

  // Emergency fund: 6 months expenses = +15
  const monthsOfExpenses = monthlyExpenses > 0 ? emergencyFund / monthlyExpenses : 0;
  if (monthsOfExpenses >= 6) score += 15;
  else if (monthsOfExpenses >= 3) score += 8;

  // Debt to income: <30% = +10, >60% = -15
  const dti = monthlyIncome > 0 ? totalDebt / (monthlyIncome * 12) : 0;
  if (dti < 0.3) score += 10;
  else if (dti > 0.6) score -= 15;

  // Investments: any = +5
  if (totalInvestments > 0) score += 5;

  return Math.max(0, Math.min(100, Math.round(score)));
};

module.exports = { calculateEMI, simulatePrepayment, calculateHealthScore };
