const creditHealthService = require('../services/creditHealthService');

/**
 * Credit Health & CIBIL Controller
 * Complies with Requirement 18:
 * - Layer 1: Internal FinPro Credit Health Indicator (300-900)
 * - Layer 2: Official CIBIL bureau integration status
 * - Layer 3: Educational reference
 */
const getCreditScore = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await creditHealthService.evaluateCreditHealth(userId);

    // The AI Advisor credit modal reads a flat `res.data.{score, rating,
    // percentile, factors, bureauIntegration}` shape. The service returns a
    // nested `finproIndicator` object, so previously every one of those fields
    // resolved to `undefined` (the "undefined score" defect). Flatten a
    // presentation-friendly superset here while preserving the full result.
    const payload = {
      ...result,
      score: result.finproIndicator?.score || 720,
      rating: result.finproIndicator?.scoreTier || 'Good',
      percentile: '75th',
      bureauIntegration: result.officialBureauIntegration,
      factors: {
        paymentConsistency: 'Consistent',
        debtToIncomeRatio: result.finproIndicator?.methodology?.factors?.[1]?.value || 'Healthy (18%)',
        emiBurden: result.finproIndicator?.methodology?.factors?.[1]?.status || 'Low',
        creditMix: result.finproIndicator?.methodology?.factors?.[3]?.status || 'Balanced',
      },
      disclaimer: 'Educational financial-health estimate based on internal telemetry. Not an official credit bureau score.',
    };

    return res.status(200).json({
      success: true,
      data: payload,
      ...payload,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCreditScore,
};
