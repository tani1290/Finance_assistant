const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');

const dashboard = require('../controllers/dashboardController');
const accounts = require('../controllers/accountController');
const transactions = require('../controllers/transactionController');
const budgets = require('../controllers/budgetController');
const goals = require('../controllers/goalController');
const investments = require('../controllers/investmentController');
const loans = require('../controllers/loanController');
const insurance = require('../controllers/insuranceController');
const subscriptions = require('../controllers/subscriptionController');
const analytics = require('../controllers/analyticsController');
const ai = require('../controllers/aiController');
const simulations = require('../controllers/simulationController');
const ocrImport = require('../controllers/ocrImportController');
const onboarding = require('../controllers/onboardingController');
const exports_ = require('../controllers/exportController');
const training = require('../controllers/trainingController');
const cards = require('../controllers/cardController');
const tasks = require('../controllers/taskController');
const news = require('../controllers/newsController');
const storage = require('../controllers/storageController');
const creditHealth = require('../controllers/creditHealthController');
const gst = require('../controllers/gstController');
const sms = require('../controllers/smsController');
const mobileSync = require('../controllers/mobileSyncController');
const notificationRoutes = require('./notificationRoutes');

// Apply auth to all routes below
router.use(authenticate);

// FCM Push Notifications
router.use('/notifications', notificationRoutes);

// Dashboard
router.get('/dashboard', dashboard.getDashboard);

// Onboarding
router.post('/onboarding', onboarding.submitOnboarding);
router.get('/onboarding/status', onboarding.getOnboardingStatus);

// Accounts
router.get('/accounts', accounts.getAccounts);
router.post('/accounts', accounts.createAccount);
router.get('/accounts/:accountId', accounts.getAccount);
router.patch('/accounts/:accountId', accounts.updateAccount);
router.delete('/accounts/:accountId', accounts.deleteAccount);
router.post('/accounts/:accountId/deposit', accounts.depositMoney);
router.post('/accounts/deposit', async (req, res, next) => {
  const prisma = require('../config/database');
  let account = await prisma.financialAccount.findFirst({
    where: { userId: req.user.id, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!account) {
    account = await prisma.financialAccount.create({
      data: { userId: req.user.id, name: 'Primary Account', accountType: 'BANK', balance: 0, currency: 'INR' },
    });
  }
  req.params.accountId = account.id;
  accounts.depositMoney(req, res, next);
});

// Transactions
router.get('/transactions', transactions.getTransactions);
router.post('/transactions', transactions.createTransaction);
router.get('/transactions/:id', transactions.getTransaction);
router.patch('/transactions/:id', transactions.updateTransaction);
router.delete('/transactions/:id', transactions.deleteTransaction);
router.post('/transactions/voice', transactions.parseVoiceEntry);
router.post('/transactions/parse-text', transactions.parseTextEntry);

// Budgets
router.get('/budgets', budgets.getBudgets);
router.post('/budgets', budgets.createBudget);
router.patch('/budgets/:id', budgets.updateBudget);
router.delete('/budgets/:id', budgets.deleteBudget);

// Goals
router.get('/goals', goals.getGoals);
router.post('/goals', goals.createGoal);
router.get('/goals/:id', goals.getGoal);
router.patch('/goals/:id', goals.updateGoal);
router.patch('/goals/:id/contribute', goals.contributeToGoal);
router.delete('/goals/:id', goals.deleteGoal);

// Investments & Real-Time Market
router.get('/investments', investments.getInvestments);
router.get('/investments/portfolio', investments.getPortfolio);
router.post('/investments/buy', investments.buyInvestment);
router.patch('/investments/:id', investments.updateInvestment);
router.delete('/investments/:id', investments.deleteInvestment);
router.get('/market/quote', investments.getStockQuote);
router.get('/market/history', investments.getStockHistory);
router.get('/market/search', investments.searchStocks);
router.get('/market/metals', investments.getMetals);
router.get('/market/gold', investments.getGold);
router.get('/market/silver', investments.getSilver);
router.get('/market/popular', investments.getPopularStocks);
router.get('/market/news', investments.getMarketNews);
router.get('/market/profile', investments.getCompanyProfile);
router.get('/market/watchlist', investments.getWatchlist);
router.post('/market/watchlist', investments.addToWatchlist);
router.delete('/market/watchlist/:symbol', investments.removeFromWatchlist);

// Alpha Vantage — Advanced Market Data Routes
router.get('/market/dashboard', investments.getMarketDashboard);
router.get('/market/technicals', investments.getTechnicals);
router.get('/market/overview', investments.getCompanyOverview);
router.get('/market/earnings', investments.getEarnings);
router.get('/market/fx', investments.getFXRate);
router.get('/market/commodity', investments.getCommodity);

// Loans & Prepayment Simulator
router.get('/loans', loans.getLoans);
router.post('/loans', loans.createLoan);
router.get('/loans/:id', loans.getLoan);
router.patch('/loans/:id', loans.updateLoan);
router.delete('/loans/:id', loans.deleteLoan);
router.post('/loans/calculate-emi', loans.calculateEMIHandler);
router.post('/loans/prepayment-simulate', loans.simulatePrepaymentHandler);

// Insurance
router.get('/insurance', insurance.getInsurancePolicies);
router.post('/insurance', insurance.createInsurancePolicy);
router.get('/insurance/:id', insurance.getInsurancePolicy);
router.patch('/insurance/:id', insurance.updateInsurancePolicy);
router.delete('/insurance/:id', insurance.deleteInsurancePolicy);

// Subscriptions
router.get('/subscriptions', subscriptions.getSubscriptions);
router.post('/subscriptions', subscriptions.createSubscription);
router.patch('/subscriptions/:id', subscriptions.updateSubscription);
router.delete('/subscriptions/:id', subscriptions.deleteSubscription);

// Card Management (Phase 26)
router.get('/cards', cards.getCards);
router.post('/cards', cards.createCard);
router.get('/cards/:id', cards.getCard);
router.patch('/cards/:id', cards.updateCard);
router.delete('/cards/:id', cards.deleteCard);

// Financial Tasks & Reminders (Phase 29)
router.get('/tasks', tasks.getTasks);
router.post('/tasks', tasks.createTask);
router.patch('/tasks/:id', tasks.updateTask);
router.delete('/tasks/:id', tasks.deleteTask);

// Financial News (Phase 30 & 31)
router.get('/news', news.getNews);

// Analytics & Reports
router.get('/analytics', analytics.getAnalytics);
router.get('/reports/monthly', analytics.getMonthlyFinancialReport);

// Calendar
router.get('/calendar/events', analytics.getCalendarEvents);
router.post('/calendar/events', analytics.createCalendarEvent);
router.patch('/calendar/events/:id', analytics.updateCalendarEvent);
router.delete('/calendar/events/:id', analytics.deleteCalendarEvent);

// Notifications
router.get('/notifications', analytics.getNotifications);
router.post('/notifications', analytics.createNotification);
router.patch('/notifications/:id/read', analytics.markNotificationRead);
router.post('/notifications/read-all', analytics.markAllNotificationsRead);
router.delete('/notifications/:id', analytics.deleteNotification);

// AI Advisor & Intelligence
router.post('/ai/chat', ai.chat);
router.get('/ai/history', ai.getChatHistory);
router.delete('/ai/history', ai.clearChatHistory);
router.get('/ai/snapshot', ai.getFinancialSnapshot);
router.get('/ai/financial-health', analytics.getFinancialHealth);
router.get('/ai/credit-health', analytics.getCreditHealth);
router.get('/ai/cash-flow', analytics.getCashFlowPrediction);
router.get('/ai/anomalies', analytics.getExpenseAnomalies);
router.patch('/ai/anomalies/:id/feedback', analytics.submitAnomalyFeedback);
router.get('/ai/budget-optimize', analytics.getBudgetOptimization);
router.get('/ai/risk-radar', analytics.getRiskRadar);
router.get('/ai/investment-analysis', ai.getInvestmentAnalysis);
router.get('/ai/insurance-review', ai.getInsuranceReview);
router.get('/ai/recommendations', ai.getRecommendations);
router.post('/ai/recommendations/:id/feedback', ai.submitRecommendationFeedback);
router.post('/ai/voice-intent', ai.parseVoiceIntent);

// Simulations & Forecasting
router.post('/ai/simulate', simulations.simulateScenario);
router.get('/ai/simulations/history', simulations.getSimulationHistory);
router.post('/ai/retirement-plan', simulations.getRetirementPlan);
router.get('/ai/goals/:id/forecast', simulations.getGoalForecast);

// Receipts OCR & Bank Statement Import (Unified Ingestion Engine)
router.post('/receipts/scan', ocrImport.scanReceipt);
router.post('/receipts/confirm', ocrImport.confirmReceipt);
router.post('/import/bank-statement', ocrImport.parseBankStatement);
router.post('/import/statement-pdf', ocrImport.parseBankStatementPDF);
router.post('/import/confirm', ocrImport.confirmBankStatementImport);
router.post('/import/feedback', ocrImport.recordCategoryFeedback);

// CIBIL & Credit Score Intelligence (Requirement 18)
router.get('/credit-score', creditHealth.getCreditScore);

// GST Intelligence & Tax Breakdown (Requirements 19 & 20)
router.post('/gst/lookup', gst.lookupGSTIN);
router.post('/gst/calculate', gst.calculateGST);

// Exports
router.get('/export/transactions.csv', exports_.exportTransactionsCSV);
router.get('/export/accounts.csv', exports_.exportAccountsCSV);
router.get('/export/budgets.csv', exports_.exportBudgetsCSV);
router.get('/export/goals.csv', exports_.exportGoalsCSV);
router.get('/export/investments.csv', exports_.exportInvestmentsCSV);
router.get('/export/loans.csv', exports_.exportLoansCSV);
router.get('/export/insurance.csv', exports_.exportInsuranceCSV);
router.get('/export/subscriptions.csv', exports_.exportSubscriptionsCSV);
router.get('/export/summary.csv', exports_.exportSummaryCSV);

// Cloud Storage & Document Management (Phase 2)
router.post('/storage/upload', storage.uploadDocument);
router.get('/storage/status', storage.getStorageStatus);
router.get('/storage/file/*', storage.getFile);
router.delete('/storage/file/*', storage.deleteFile);

// Training Data Bot & ML Studio (Phases 15, 16, 17)
router.post('/training/datasets/upload', training.uploadDataset);
router.get('/training/datasets', training.getDatasets);
router.get('/training/datasets/:id', training.getDataset);
router.post('/training/datasets/:id/version', training.createDatasetVersion);
router.delete('/training/datasets/:id', training.deleteDataset);
router.post('/training/train', training.trainModel);
router.get('/training/runs', training.getTrainingRuns);
router.post('/training/predict', training.predict);
router.get('/training/predictions', training.getPredictionHistory);

// Mobile Device Management & Sync
router.post('/mobile/devices', mobileSync.registerDevice);
router.get('/mobile/sync', mobileSync.getMobileSyncState);

// Bank SMS Transaction Detection & Ingestion Engine
router.post('/sms/ingest', sms.ingestSms);
router.post('/sms/batch-ingest', sms.batchIngestSms);
router.get('/sms/pending', sms.getPendingSms);
router.post('/sms/pending/:id/confirm', sms.confirmPendingSms);
router.post('/sms/pending/:id/reject', sms.rejectPendingSms);
router.post('/sms/parse', sms.parsePreview);

module.exports = router;
