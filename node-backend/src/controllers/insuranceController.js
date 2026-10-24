const prisma = require('../config/database');
const { parseDateOnly, formatDateOnly, todayDateOnly } = require('../utils/dateOnly');

const formatINR = (val) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(parseFloat(val) || 0);

/** Date-only fields must leave the API as YYYY-MM-DD, never an ISO instant. */
const serializePolicy = (policy) => ({
  ...policy,
  renewalDate: formatDateOnly(policy.renewalDate),
  formattedCoverage: formatINR(policy.coverageAmount),
  formattedPremium: formatINR(policy.premium),
});

/**
 * GET /api/v1/insurance
 */
const getInsurancePolicies = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const policies = await prisma.insurancePolicy.findMany({
      where: { userId },
      orderBy: { renewalDate: 'asc' },
    });

    // Coverage and premiums describe the cover that is actually in force.
    // Inactive policies stay visible in the list but must not inflate summary
    // totals while `activePolicies` excludes them.
    const activePolicies = policies.filter((p) => p.isActive);
    const totalCoverage = activePolicies.reduce((sum, p) => sum + parseFloat(p.coverageAmount || 0), 0);
    const annualPremium = activePolicies.reduce((sum, p) => {
      const prem = parseFloat(p.premium || 0);
      if (p.premiumCycle === 'MONTHLY') return sum + (prem * 12);
      if (p.premiumCycle === 'QUARTERLY') return sum + (prem * 4);
      if (p.premiumCycle === 'HALF_YEARLY') return sum + (prem * 2);
      return sum + prem;
    }, 0);

    const today = todayDateOnly();
    const upcomingRenewals = activePolicies
      .filter((p) => {
        const renewal = formatDateOnly(p.renewalDate);
        return renewal && renewal >= today;
      })
      .sort((a, b) => String(formatDateOnly(a.renewalDate)).localeCompare(String(formatDateOnly(b.renewalDate))));

    return res.status(200).json({
      success: true,
      data: {
        policies: policies.map(serializePolicy),
        summary: {
          totalPolicies: policies.length,
          activePolicies: activePolicies.length,
          inactivePolicies: policies.length - activePolicies.length,
          totalCoverage,
          formattedTotalCoverage: formatINR(totalCoverage),
          annualPremium,
          formattedAnnualPremium: formatINR(annualPremium),
          nextRenewal: upcomingRenewals[0] ? formatDateOnly(upcomingRenewals[0].renewalDate) : null,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/insurance
 */
const createInsurancePolicy = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { policyName, insurer, policyType, coverageAmount, premium, premiumCycle, renewalDate } = req.body;

    if (!policyName || !coverageAmount || !premium || !renewalDate) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Policy name, coverage, premium, and renewal date are required.' },
      });
    }

    const policy = await prisma.insurancePolicy.create({
      data: {
        userId,
        policyName: policyName.trim(),
        insurer: insurer ? insurer.trim() : null,
        policyType: policyType || 'LIFE',
        coverageAmount: parseFloat(coverageAmount),
        premium: parseFloat(premium),
        premiumCycle: premiumCycle || 'ANNUAL',
        renewalDate: parseDateOnly(renewalDate, 'renewalDate'),
        isActive: true,
      },
    });

    return res.status(201).json({
      success: true,
      data: {
        ...serializePolicy(policy),
        message: 'Insurance policy added successfully.',
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
 * GET /api/v1/insurance/:id
 */
const getInsurancePolicy = async (req, res, next) => {
  try {
    const policy = await prisma.insurancePolicy.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!policy) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Insurance policy not found.' } });
    }

    return res.status(200).json({
      success: true,
      data: serializePolicy(policy),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/insurance/:id
 */
const updateInsurancePolicy = async (req, res, next) => {
  try {
    const policy = await prisma.insurancePolicy.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!policy) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Insurance policy not found.' } });
    }

    const { policyName, insurer, policyType, coverageAmount, premium, premiumCycle, renewalDate, isActive } = req.body;

    const updated = await prisma.insurancePolicy.update({
      where: { id: req.params.id },
      data: {
        ...(policyName && { policyName: policyName.trim() }),
        ...(insurer !== undefined && { insurer: insurer ? insurer.trim() : null }),
        ...(policyType && { policyType }),
        ...(coverageAmount !== undefined && { coverageAmount: parseFloat(coverageAmount) }),
        ...(premium !== undefined && { premium: parseFloat(premium) }),
        ...(premiumCycle && { premiumCycle }),
        ...(renewalDate && { renewalDate: parseDateOnly(renewalDate, 'renewalDate') }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        ...serializePolicy(updated),
        message: 'Policy updated successfully.',
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
 * DELETE /api/v1/insurance/:id
 */
const deleteInsurancePolicy = async (req, res, next) => {
  try {
    const policy = await prisma.insurancePolicy.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!policy) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Insurance policy not found.' } });
    }

    await prisma.insurancePolicy.delete({ where: { id: req.params.id } });

    return res.status(200).json({ success: true, data: { message: 'Insurance policy removed.' } });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getInsurancePolicies,
  createInsurancePolicy,
  getInsurancePolicy,
  updateInsurancePolicy,
  deleteInsurancePolicy,
};
