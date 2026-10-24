const prisma = require('../config/database');
const { formatINR } = require('../utils/inr');
const { calculateEMI, simulatePrepayment } = require('../utils/financialMath');
const { parseDateOnly, formatDateOnly, todayDateOnly } = require('../utils/dateOnly');

const serializeLoan = (loan) => ({
  ...loan,
  startDate: formatDateOnly(loan.startDate),
  formattedPrincipal: formatINR(loan.principalAmount),
  formattedEMI: formatINR(loan.emiAmount),
  formattedOutstanding: formatINR(loan.outstandingBalance),
});

/**
 * GET /api/v1/loans
 */
const getLoans = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const loans = await prisma.loan.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const totalOutstanding = loans.reduce((s, l) => s + parseFloat(l.outstandingBalance || 0), 0);
    const totalEMI = loans.filter(l => l.status === 'ACTIVE').reduce((s, l) => s + parseFloat(l.emiAmount || 0), 0);

    return res.status(200).json({
      success: true,
      data: {
        totalOutstanding,
        formattedTotalOutstanding: formatINR(totalOutstanding),
        totalMonthlyEMI: totalEMI,
        formattedTotalMonthlyEMI: formatINR(totalEMI),
        loans: loans.map((l) => ({
          id: l.id,
          loanType: l.loanType,
          lenderName: l.lenderName,
          principalAmount: parseFloat(l.principalAmount),
          formattedPrincipal: formatINR(l.principalAmount),
          interestRate: parseFloat(l.interestRate),
          tenureMonths: l.tenureMonths,
          startDate: formatDateOnly(l.startDate),
          emiAmount: parseFloat(l.emiAmount || 0),
          formattedEMI: formatINR(l.emiAmount || 0),
          outstandingBalance: parseFloat(l.outstandingBalance),
          formattedOutstanding: formatINR(l.outstandingBalance),
          status: l.status,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/loans
 */
const createLoan = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { loanType = 'PERSONAL', lenderName, principalAmount, interestRate, tenureMonths, startDate } = req.body;

    const principal = parseFloat(principalAmount);
    const rate = parseFloat(interestRate);
    const tenure = parseInt(tenureMonths);

    if (!principal || !rate || !tenure) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Principal amount, interest rate, and tenure are required.' },
      });
    }

    const emi = calculateEMI(principal, rate, tenure);

    const loan = await prisma.loan.create({
      data: {
        userId,
        loanType,
        lenderName: lenderName?.trim() || null,
        principalAmount: principal,
        interestRate: rate,
        tenureMonths: tenure,
        startDate: startDate ? parseDateOnly(startDate, 'startDate') : parseDateOnly(todayDateOnly()),
        emiAmount: emi,
        outstandingBalance: principal,
        status: 'ACTIVE',
      },
    });

    return res.status(201).json({
      success: true,
      data: {
        ...serializeLoan(loan),
        message: `Loan added! Monthly EMI: ${formatINR(emi)}`,
      },
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
    }
    next(error);
  }
};

/**
 * POST /api/v1/loans/prepayment-simulate
 */
const simulatePrepaymentHandler = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { loanId, prepaymentAmount } = req.body;

    const prepayment = parseFloat(prepaymentAmount);
    if (!prepayment || prepayment <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Prepayment amount must be greater than zero.' },
      });
    }

    let principal, rate, tenure;

    if (loanId) {
      const loan = await prisma.loan.findFirst({ where: { id: loanId, userId } });
      if (!loan) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Loan not found.' },
        });
      }
      principal = parseFloat(loan.outstandingBalance);
      rate = parseFloat(loan.interestRate);
      tenure = loan.tenureMonths;
    } else {
      const { principalAmount: p, interestRate: r, tenureMonths: t } = req.body;
      const parsedP = parseFloat(p);
      const parsedR = parseFloat(r);
      const parsedT = parseInt(t);

      if (!p || !r || !t || isNaN(parsedP) || isNaN(parsedR) || isNaN(parsedT) || parsedP <= 0 || parsedR <= 0 || parsedT <= 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Must provide either loanId or valid (principalAmount, interestRate, tenureMonths).',
          },
        });
      }

      principal = parsedP;
      rate = parsedR;
      tenure = parsedT;
    }

    const result = simulatePrepayment(principal, rate, tenure, prepayment);

    return res.status(200).json({
      success: true,
      data: {
        originalPrincipal: principal,
        formattedOriginalPrincipal: formatINR(principal),
        prepaymentAmount: prepayment,
        formattedPrepayment: formatINR(prepayment),
        monthsSaved: result.monthsSaved,
        interestSaved: result.interestSaved,
        formattedInterestSaved: formatINR(result.interestSaved),
        newEMI: result.newEmi,
        formattedNewEMI: formatINR(result.newEmi),
        summary: `By prepaying ${formatINR(prepayment)}, you save approximately ${formatINR(result.interestSaved)} in interest and reduce your loan by ${result.monthsSaved} months!`,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/loans/calculate-emi
 * Quick EMI calculator without saving
 */
const calculateEMIHandler = async (req, res, next) => {
  try {
    const { principal, interestRate, tenureMonths } = req.body;
    const p = parseFloat(principal);
    const r = parseFloat(interestRate);
    const n = parseInt(tenureMonths);

    if (!p || !r || !n) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Principal, interest rate, and tenure are required.' },
      });
    }

    const emi = calculateEMI(p, r, n);
    const totalPayment = emi * n;
    const totalInterest = totalPayment - p;

    return res.status(200).json({
      success: true,
      data: {
        emi,
        formattedEMI: formatINR(emi),
        totalPayment,
        formattedTotalPayment: formatINR(totalPayment),
        totalInterest,
        formattedTotalInterest: formatINR(totalInterest),
        principal: p,
        formattedPrincipal: formatINR(p),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/loans/:id
 */
const getLoan = async (req, res, next) => {
  try {
    const loan = await prisma.loan.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!loan) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Loan not found.' } });
    }
    return res.status(200).json({
      success: true,
      data: serializeLoan(loan),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/loans/:id
 */
const updateLoan = async (req, res, next) => {
  try {
    const loan = await prisma.loan.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!loan) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Loan not found.' } });
    }

    const { loanType, lenderName, principalAmount, interestRate, tenureMonths, outstandingBalance, status } = req.body;
    const principal = principalAmount !== undefined ? parseFloat(principalAmount) : parseFloat(loan.principalAmount);
    const rate = interestRate !== undefined ? parseFloat(interestRate) : parseFloat(loan.interestRate);
    const tenure = tenureMonths !== undefined ? parseInt(tenureMonths) : loan.tenureMonths;
    const emi = calculateEMI(principal, rate, tenure);

    const updated = await prisma.loan.update({
      where: { id: req.params.id },
      data: {
        ...(loanType && { loanType }),
        ...(lenderName !== undefined && { lenderName: lenderName?.trim() || null }),
        ...(principalAmount !== undefined && { principalAmount: principal }),
        ...(interestRate !== undefined && { interestRate: rate }),
        ...(tenureMonths !== undefined && { tenureMonths: tenure }),
        ...(outstandingBalance !== undefined && { outstandingBalance: parseFloat(outstandingBalance) }),
        ...(status && { status }),
        emiAmount: emi,
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        ...serializeLoan(updated),
        message: 'Loan updated successfully.',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/loans/:id
 */
const deleteLoan = async (req, res, next) => {
  try {
    const loan = await prisma.loan.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!loan) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Loan not found.' } });
    }

    await prisma.loan.delete({ where: { id: req.params.id } });
    return res.status(200).json({ success: true, data: { message: 'Loan deleted successfully.' } });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getLoans,
  getLoan,
  createLoan,
  updateLoan,
  deleteLoan,
  simulatePrepaymentHandler,
  calculateEMIHandler,
};
