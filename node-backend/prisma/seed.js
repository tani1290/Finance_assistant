/**
 * Jinay Finance AI / FinPro — High-Fidelity 3-Year Account Database Seeder
 * Simulates a realistic, comprehensive 3-year-old active financial account
 * populating all entities: Accounts, Transactions (36 months), Portfolios,
 * Budgets, Goals, Loans, Cards, Insurance, Subscriptions, Health History,
 * Simulations, Tasks, and Mobile SMS Candidates.
 *
 * Owner: Jinay Golecha (jinay_golecha)
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Helper to generate dates in past
function monthsAgo(m, day = 15) {
  const d = new Date();
  d.setMonth(d.getMonth() - m);
  d.setDate(day);
  return d;
}

function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

async function main() {
  console.log('🌱 Starting FinPro 3-Year Account Comprehensive Seeder...\n');

  // ============================================================
  // 1. PRIMARY 3-YEAR DEMO USER (36 MONTHS OLD)
  // ============================================================
  const demoEmail = 'demo@example.com';
  const hashedPassword = await bcrypt.hash('DemoPassword123!', 10);
  const accountCreatedDate = monthsAgo(36, 1); // 3 Years ago

  // Clean existing demo data to ensure a fresh, consistent 3-year history
  const existingUser = await prisma.user.findUnique({ where: { email: demoEmail } });
  if (existingUser) {
    console.log('  ♻️  Clearing previous demo records for pristine 3-year timeline...');
    await prisma.user.delete({ where: { id: existingUser.id } });
  }

  const demoUser = await prisma.user.create({
    data: {
      email: demoEmail,
      username: 'demouser',
      password: hashedPassword,
      firstName: 'Arjun',
      lastName: 'Sharma',
      phone: '+91 98765 43210',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
      role: 'PREMIUM_USER',
      isPremium: true,
      isActive: true,
      country: 'India',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      createdAt: accountCreatedDate,
      lastLoginAt: new Date(),
      profile: {
        create: {
          occupation: 'Senior Product Manager',
          bio: 'FinTech professional & disciplined wealth builder. Active FinPro user for 3 years.',
          dateOfBirth: new Date('1996-05-14'),
          createdAt: accountCreatedDate,
        },
      },
    },
    include: { profile: true },
  });

  console.log(`  👤 Created 3-year-old account: ${demoUser.email} (ID: ${demoUser.id})`);

  // ============================================================
  // 2. FINANCIAL PROFILE & MASTER PLAN
  // ============================================================
  await prisma.financialProfile.create({
    data: {
      userId: demoUser.id,
      age: 30,
      city: 'Bengaluru',
      country: 'India',
      monthlySalary: 165000,
      otherMonthlyIncome: 15000,
      estimatedMonthlyExpenses: 62000,
      currentSavings: 885420,
      emergencyFund: 500000,
      totalDebt: 142800,
      riskProfile: 'MODERATE',
      budgetMethod: 'FIFTY_THIRTY_TWENTY',
      financialPriorities: 'Home Down Payment, Wealth Compounding, Tax Optimization',
      isOnboardingComplete: true,
      createdAt: accountCreatedDate,
    },
  });

  await prisma.financialPlan.create({
    data: {
      userId: demoUser.id,
      income: 180000,
      expenses: 62000,
      savingsTarget: 35000,
      emergencyFundTarget: 500000,
      investmentTarget: 60000,
      debtRepaymentTarget: 25250,
      financialHealthScore: 88,
      riskProfile: 'Moderate',
      budgetMethod: '50/30/20',
      planSummary: '3-year disciplined wealth strategy: 50% Needs, 30% Wants, 20% Long-term Equity & Bullion compounding.',
      createdAt: accountCreatedDate,
    },
  });

  // ============================================================
  // 3. FINANCIAL ACCOUNTS (ACROSS 3 INSTITUTIONS)
  // ============================================================
  const salaryAcc = await prisma.financialAccount.create({
    data: {
      userId: demoUser.id,
      name: 'HDFC Corporate Salary Account',
      institution: 'HDFC Bank',
      accountType: 'SAVINGS',
      accountNumberMasked: '•••• 4589',
      balance: 385420.00,
      currency: 'INR',
      createdAt: accountCreatedDate,
    },
  });

  const emergencyAcc = await prisma.financialAccount.create({
    data: {
      userId: demoUser.id,
      name: 'ICICI Emergency Reserve (High Yield)',
      institution: 'ICICI Bank',
      accountType: 'SAVINGS',
      accountNumberMasked: '•••• 7120',
      balance: 500000.00,
      currency: 'INR',
      createdAt: monthsAgo(32),
    },
  });

  const tradingAcc = await prisma.financialAccount.create({
    data: {
      userId: demoUser.id,
      name: 'Zerodha Trading Balance',
      institution: 'Zerodha Broking Ltd',
      accountType: 'OTHER',
      accountNumberMasked: '•••• ZR01',
      balance: 145000.00,
      currency: 'INR',
      createdAt: monthsAgo(34),
    },
  });

  const walletAcc = await prisma.financialAccount.create({
    data: {
      userId: demoUser.id,
      name: 'PhonePe / UPI Digital Wallet',
      institution: 'YES Bank UPI',
      accountType: 'WALLET',
      accountNumberMasked: '•••• 9871',
      balance: 8450.00,
      currency: 'INR',
      createdAt: accountCreatedDate,
    },
  });

  console.log('  🏦 Initialized 4 bank & investment accounts.');

  // ============================================================
  // 4. TRANSACTION CATEGORIES
  // ============================================================
  const categoryNames = [
    { name: 'Salary & Income', type: 'INCOME', icon: 'money-dollar-circle-line', color: '#10b981' },
    { name: 'Housing & Rent', type: 'EXPENSE', icon: 'home-line', color: '#6366f1' },
    { name: 'Food & Dining', type: 'EXPENSE', icon: 'restaurant-line', color: '#f59e0b' },
    { name: 'Groceries & Provisions', type: 'EXPENSE', icon: 'shopping-cart-line', color: '#ec4899' },
    { name: 'Utilities & Bills', type: 'EXPENSE', icon: 'flashlight-line', color: '#06b6d4' },
    { name: 'Transportation & Fuel', type: 'EXPENSE', icon: 'car-line', color: '#8b5cf6' },
    { name: 'Investments & SIP', type: 'EXPENSE', icon: 'line-chart-line', color: '#3b82f6' },
    { name: 'Loan EMI Payment', type: 'EXPENSE', icon: 'bank-card-line', color: '#ef4444' },
    { name: 'Shopping & Electronics', type: 'EXPENSE', icon: 'shopping-bag-line', color: '#14b8a6' },
    { name: 'Healthcare & Wellness', type: 'EXPENSE', icon: 'heart-pulse-line', color: '#e11d48' },
    { name: 'Entertainment & Outings', type: 'EXPENSE', icon: 'movie-line', color: '#a855f7' },
    { name: 'Subscriptions & SaaS', type: 'EXPENSE', icon: 'repeat-line', color: '#64748b' },
  ];

  const categories = {};
  for (const cat of categoryNames) {
    const c = await prisma.category.create({
      data: {
        userId: demoUser.id,
        name: cat.name,
        categoryType: cat.type,
        icon: cat.icon,
        color: cat.color,
        createdAt: accountCreatedDate,
      },
    });
    categories[cat.name] = c.id;
  }

  // ============================================================
  // 5. 36 MONTHS (3 YEARS) OF REALISTIC TRANSACTION CHRONOLOGY
  // ============================================================
  const transactionsData = [];

  // Simulate salary progression over 3 years:
  // Months 36 to 25 (Year 1): ₹1,20,000 / month
  // Months 24 to 13 (Year 2): ₹1,45,000 / month
  // Months 12 to 0  (Year 3): ₹1,65,000 / month
  for (let m = 36; m >= 0; m--) {
    let salaryAmt = 120000;
    let rentAmt = 26000;
    if (m <= 24 && m > 12) {
      salaryAmt = 145000;
      rentAmt = 28000;
    } else if (m <= 12) {
      salaryAmt = 165000;
      rentAmt = 30000;
    }

    // 1. Monthly Salary Credit (1st of month)
    transactionsData.push({
      userId: demoUser.id,
      accountId: salaryAcc.id,
      categoryId: categories['Salary & Income'],
      amount: salaryAmt,
      transactionType: 'INCOME',
      description: 'Monthly Salary Credit',
      merchant: 'Infosys Technologies Payroll',
      paymentMethod: 'NEFT',
      aiCategory: 'Salary & Income',
      date: monthsAgo(m, 1),
    });

    // 2. Monthly Apartment Rent (3rd of month)
    transactionsData.push({
      userId: demoUser.id,
      accountId: salaryAcc.id,
      categoryId: categories['Housing & Rent'],
      amount: rentAmt,
      transactionType: 'EXPENSE',
      description: 'Apartment Monthly Rent',
      merchant: 'Prestige Falcon Estates',
      paymentMethod: 'UPI',
      aiCategory: 'Housing & Rent',
      date: monthsAgo(m, 3),
    });

    // 3. Car Loan EMI (5th of month) - Started 30 months ago
    if (m <= 30) {
      transactionsData.push({
        userId: demoUser.id,
        accountId: salaryAcc.id,
        categoryId: categories['Loan EMI Payment'],
        amount: 25250,
        transactionType: 'EXPENSE',
        description: 'Auto Loan Monthly EMI Debit',
        merchant: 'HDFC Auto Finance',
        paymentMethod: 'NACH Autopay',
        aiCategory: 'Loan EMI Payment',
        date: monthsAgo(m, 5),
      });
    }

    // 4. Monthly Equity SIPs (7th of month)
    transactionsData.push({
      userId: demoUser.id,
      accountId: salaryAcc.id,
      categoryId: categories['Investments & SIP'],
      amount: 25000,
      transactionType: 'INVESTMENT',
      description: 'UTI Nifty 50 Index Fund Monthly SIP',
      merchant: 'UTI Mutual Fund',
      paymentMethod: 'ECS Autopay',
      aiCategory: 'Investments & SIP',
      date: monthsAgo(m, 7),
    });

    transactionsData.push({
      userId: demoUser.id,
      accountId: salaryAcc.id,
      categoryId: categories['Investments & SIP'],
      amount: 15000,
      transactionType: 'INVESTMENT',
      description: 'Parag Parikh Flexi Cap Fund Monthly SIP',
      merchant: 'PPFAS Mutual Fund',
      paymentMethod: 'ECS Autopay',
      aiCategory: 'Investments & SIP',
      date: monthsAgo(m, 7),
    });

    // 5. Utility Bills (10th of month)
    transactionsData.push({
      userId: demoUser.id,
      accountId: salaryAcc.id,
      categoryId: categories['Utilities & Bills'],
      amount: 2850 + (m % 5) * 180,
      transactionType: 'EXPENSE',
      description: 'BESCOM Monthly Electricity Bill',
      merchant: 'Bangalore Electricity Supply Co.',
      paymentMethod: 'Auto Debit',
      aiCategory: 'Utilities & Bills',
      date: monthsAgo(m, 10),
    });

    transactionsData.push({
      userId: demoUser.id,
      accountId: salaryAcc.id,
      categoryId: categories['Utilities & Bills'],
      amount: 1179,
      transactionType: 'EXPENSE',
      description: 'Airtel Xstream Fiber High-Speed Internet',
      merchant: 'Bharti Airtel Ltd',
      paymentMethod: 'Credit Card',
      aiCategory: 'Utilities & Bills',
      date: monthsAgo(m, 12),
    });

    // 6. Groceries & Supermarket (15th of month)
    transactionsData.push({
      userId: demoUser.id,
      accountId: salaryAcc.id,
      categoryId: categories['Groceries & Provisions'],
      amount: 8500 + (m % 4) * 450,
      transactionType: 'EXPENSE',
      description: 'Monthly Family Pantry & Household Provisions',
      merchant: 'Nature Basket Supermarket',
      paymentMethod: 'Debit Card',
      aiCategory: 'Groceries & Provisions',
      date: monthsAgo(m, 15),
    });

    // 7. Dining & Food Deliveries (Weekends)
    transactionsData.push({
      userId: demoUser.id,
      accountId: walletAcc.id,
      categoryId: categories['Food & Dining'],
      amount: 1450 + (m % 3) * 220,
      transactionType: 'EXPENSE',
      description: 'Weekend Dining & Gourmet Dinner',
      merchant: 'Toit Brewpub Indiranagar',
      paymentMethod: 'UPI',
      aiCategory: 'Food & Dining',
      date: monthsAgo(m, 19),
    });

    transactionsData.push({
      userId: demoUser.id,
      accountId: walletAcc.id,
      categoryId: categories['Food & Dining'],
      amount: 680 + (m % 6) * 90,
      transactionType: 'EXPENSE',
      description: 'Online Dinner Delivery',
      merchant: 'Swiggy Food Delivery',
      paymentMethod: 'UPI',
      aiCategory: 'Food & Dining',
      date: monthsAgo(m, 24),
    });

    // 8. Fuel & Transit (26th of month)
    transactionsData.push({
      userId: demoUser.id,
      accountId: salaryAcc.id,
      categoryId: categories['Transportation & Fuel'],
      amount: 3200 + (m % 3) * 250,
      transactionType: 'EXPENSE',
      description: 'Vehicle High-Octane Fuel Refill',
      merchant: 'Indian Oil Corporation',
      paymentMethod: 'Credit Card',
      aiCategory: 'Transportation & Fuel',
      date: monthsAgo(m, 26),
    });

    // 9. Digital Subscriptions (Netflix / Spotify / iCloud)
    transactionsData.push({
      userId: demoUser.id,
      accountId: salaryAcc.id,
      categoryId: categories['Subscriptions & SaaS'],
      amount: 649,
      transactionType: 'EXPENSE',
      description: 'Netflix 4K Ultra HD Plan',
      merchant: 'Netflix Entertainment Services',
      paymentMethod: 'Credit Card',
      aiCategory: 'Subscriptions & SaaS',
      date: monthsAgo(m, 28),
    });

    // 10. Annual Performance Bonus credits in March of each year
    if (m === 25) { // March 2024
      transactionsData.push({
        userId: demoUser.id,
        accountId: salaryAcc.id,
        categoryId: categories['Salary & Income'],
        amount: 150000,
        transactionType: 'INCOME',
        description: 'Annual Performance Appraisal Bonus FY24',
        merchant: 'Infosys Technologies',
        paymentMethod: 'Direct Deposit',
        aiCategory: 'Salary & Income',
        date: monthsAgo(25, 28),
      });
    } else if (m === 13) { // March 2025
      transactionsData.push({
        userId: demoUser.id,
        accountId: salaryAcc.id,
        categoryId: categories['Salary & Income'],
        amount: 210000,
        transactionType: 'INCOME',
        description: 'Annual Performance Appraisal Bonus FY25',
        merchant: 'Infosys Technologies',
        paymentMethod: 'Direct Deposit',
        aiCategory: 'Salary & Income',
        date: monthsAgo(13, 28),
      });
    } else if (m === 1) { // March 2026
      transactionsData.push({
        userId: demoUser.id,
        accountId: salaryAcc.id,
        categoryId: categories['Salary & Income'],
        amount: 275000,
        transactionType: 'INCOME',
        description: 'Annual Performance Appraisal Bonus FY26',
        merchant: 'Infosys Technologies',
        paymentMethod: 'Direct Deposit',
        aiCategory: 'Salary & Income',
        date: monthsAgo(1, 28),
      });
    }
  }

  // Bulk insert all 450+ transactions
  await prisma.transaction.createMany({ data: transactionsData });
  console.log(`  💳 Populated ${transactionsData.length} authentic transactions spanning 36 continuous months.`);

  // ============================================================
  // 6. HISTORICAL & ACTIVE BUDGETS (36 MONTHS)
  // ============================================================
  const budgetEntries = [];
  const now = new Date();
  for (let m = 0; m < 36; m++) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - m);
    const bMonth = d.getMonth() + 1;
    const bYear = d.getFullYear();

    budgetEntries.push(
      { userId: demoUser.id, categoryName: 'Housing & Rent', monthlyLimit: 32000, month: bMonth, year: bYear, createdAt: d },
      { userId: demoUser.id, categoryName: 'Food & Dining', monthlyLimit: 18000, month: bMonth, year: bYear, createdAt: d },
      { userId: demoUser.id, categoryName: 'Groceries & Provisions', monthlyLimit: 12000, month: bMonth, year: bYear, createdAt: d },
      { userId: demoUser.id, categoryName: 'Utilities & Bills', monthlyLimit: 6000, month: bMonth, year: bYear, createdAt: d },
      { userId: demoUser.id, categoryName: 'Transportation & Fuel', monthlyLimit: 7500, month: bMonth, year: bYear, createdAt: d },
      { userId: demoUser.id, categoryName: 'Entertainment & Outings', monthlyLimit: 6000, month: bMonth, year: bYear, createdAt: d }
    );
  }

  await prisma.budget.createMany({ data: budgetEntries });
  console.log(`  📊 Created ${budgetEntries.length} monthly category budgets over 3 years.`);

  // ============================================================
  // 7. SAVINGS GOALS (COMPLETED & ACTIVE MILESTONES)
  // ============================================================
  await prisma.goal.createMany({
    data: [
      {
        userId: demoUser.id,
        name: 'Emergency Fund (6 Months Liquid Runway)',
        goalType: 'EMERGENCY_FUND',
        targetAmount: 500000,
        currentAmount: 500000,
        monthlyContribution: 20000,
        priority: 'HIGH',
        status: 'COMPLETED',
        targetDate: monthsAgo(12),
        createdAt: monthsAgo(35),
      },
      {
        userId: demoUser.id,
        name: 'Apple MacBook Pro M3 Workstation',
        goalType: 'OTHER',
        targetAmount: 220000,
        currentAmount: 220000,
        monthlyContribution: 25000,
        priority: 'MEDIUM',
        status: 'COMPLETED',
        targetDate: monthsAgo(18),
        createdAt: monthsAgo(28),
      },
      {
        userId: demoUser.id,
        name: 'Bengaluru 3-BHK Home Down Payment',
        goalType: 'HOME',
        targetAmount: 2500000,
        currentAmount: 1650000,
        monthlyContribution: 45000,
        priority: 'HIGH',
        status: 'ACTIVE',
        targetDate: new Date('2027-12-31'),
        createdAt: monthsAgo(24),
      },
      {
        userId: demoUser.id,
        name: 'European Alps Vacation & Tour',
        goalType: 'VACATION',
        targetAmount: 350000,
        currentAmount: 240000,
        monthlyContribution: 15000,
        priority: 'MEDIUM',
        status: 'ACTIVE',
        targetDate: new Date('2027-06-15'),
        createdAt: monthsAgo(14),
      },
    ],
  });
  console.log('  🎯 Seeded 4 savings goals (2 completed milestones + 2 active high-value targets).');

  // ============================================================
  // 8. INVESTMENT PORTFOLIO & DIVERSIFIED HOLDINGS (3-YR COMPOUNDING)
  // ============================================================
  const portfolio = await prisma.portfolio.create({
    data: {
      userId: demoUser.id,
      totalInvested: 1480000.00,
      currentValue: 2165400.00,
      createdAt: monthsAgo(34),
    },
  });

  await prisma.investment.createMany({
    data: [
      {
        portfolioId: portfolio.id,
        symbol: 'RELIANCE',
        name: 'Reliance Industries Ltd',
        assetType: 'STOCK',
        quantity: 80,
        averageBuyPrice: 1120.50,
        createdAt: monthsAgo(32),
      },
      {
        portfolioId: portfolio.id,
        symbol: 'TCS',
        name: 'Tata Consultancy Services Ltd',
        assetType: 'STOCK',
        quantity: 45,
        averageBuyPrice: 3250.00,
        createdAt: monthsAgo(28),
      },
      {
        portfolioId: portfolio.id,
        symbol: 'HDFCBANK',
        name: 'HDFC Bank Ltd',
        assetType: 'STOCK',
        quantity: 110,
        averageBuyPrice: 1435.00,
        createdAt: monthsAgo(30),
      },
      {
        portfolioId: portfolio.id,
        symbol: 'INFY',
        name: 'Infosys Ltd',
        assetType: 'STOCK',
        quantity: 120,
        averageBuyPrice: 1380.00,
        createdAt: monthsAgo(26),
      },
      {
        portfolioId: portfolio.id,
        symbol: 'UTI_NIFTY50',
        name: 'UTI Nifty 50 Index Fund Direct Growth',
        assetType: 'MUTUAL_FUND',
        quantity: 3200,
        averageBuyPrice: 148.50,
        createdAt: monthsAgo(35),
      },
      {
        portfolioId: portfolio.id,
        symbol: 'PPFAS_FLEXICAP',
        name: 'Parag Parikh Flexi Cap Fund Direct Growth',
        assetType: 'MUTUAL_FUND',
        quantity: 2100,
        averageBuyPrice: 54.20,
        createdAt: monthsAgo(30),
      },
      {
        portfolioId: portfolio.id,
        symbol: 'GOLD24K',
        name: '24K Digital Gold Bullion (Physical Vault)',
        assetType: 'GOLD',
        quantity: 45.0, // 45 grams
        averageBuyPrice: 5850.00, // bought early, now ~13,688/g!
        createdAt: monthsAgo(33),
      },
      {
        portfolioId: portfolio.id,
        symbol: 'SILVER_SPOT',
        name: '999 Fine Silver Bar (1 Kilogram)',
        assetType: 'SILVER',
        quantity: 1.0, // 1 kg
        averageBuyPrice: 72000.00,
        createdAt: monthsAgo(24),
      },
    ],
  });

  await prisma.marketWatchlist.createMany({
    data: [
      { userId: demoUser.id, symbol: 'RELIANCE', name: 'Reliance Industries Ltd' },
      { userId: demoUser.id, symbol: 'TCS', name: 'Tata Consultancy Services' },
      { userId: demoUser.id, symbol: 'AAPL', name: 'Apple Inc.' },
      { userId: demoUser.id, symbol: 'BTCUSDT', name: 'Bitcoin (Crypto)' },
    ],
  });
  console.log('  📈 Created portfolio holdings demonstrating 3-year CAGR appreciation.');

  // ============================================================
  // 9. LOANS & AMORTIZATION (CAR LOAN 30 MONTHS INTO 36-MO TENURE)
  // ============================================================
  const carLoanStartDate = monthsAgo(30);
  await prisma.loan.create({
    data: {
      userId: demoUser.id,
      lenderName: 'HDFC Auto Finance Ltd',
      loanType: 'CAR',
      principalAmount: 800000.00,
      interestRate: 8.50,
      tenureMonths: 36,
      startDate: carLoanStartDate,
      emiAmount: 25250.00,
      outstandingBalance: 142800.00, // Only 6 installments left!
      status: 'ACTIVE',
      createdAt: carLoanStartDate,
    },
  });
  console.log('  🚗 Seeded active Car Loan (30 of 36 installments amortized).');

  // ============================================================
  // 10. INSURANCE POLICIES
  // ============================================================
  await prisma.insurancePolicy.createMany({
    data: [
      {
        userId: demoUser.id,
        policyName: 'HDFC Life Click 2 Protect 3D Plus',
        insurer: 'HDFC Life Insurance Co.',
        policyType: 'LIFE',
        policyNumber: 'HD-C2P-981240',
        beneficiary: 'Priya Sharma (Spouse)',
        coverageAmount: 15000000.00, // ₹1.5 Crore
        premium: 18500.00,
        premiumCycle: 'ANNUAL',
        renewalDate: new Date('2027-04-15'),
        isActive: true,
        createdAt: monthsAgo(34),
      },
      {
        userId: demoUser.id,
        policyName: 'HDFC ERGO Optima Secure Floater',
        insurer: 'HDFC ERGO General Insurance',
        policyType: 'HEALTH',
        policyNumber: 'HE-OS-451299',
        beneficiary: 'Family (Self + Spouse)',
        coverageAmount: 1500000.00, // ₹15 Lakhs
        premium: 16200.00,
        premiumCycle: 'ANNUAL',
        renewalDate: new Date('2026-11-20'),
        isActive: true,
        createdAt: monthsAgo(30),
      },
      {
        userId: demoUser.id,
        policyName: 'TATA AIG Comprehensive Auto Protect',
        insurer: 'TATA AIG Insurance',
        policyType: 'MOTOR',
        policyNumber: 'TA-AP-778102',
        coverageAmount: 650000.00,
        premium: 11800.00,
        premiumCycle: 'ANNUAL',
        renewalDate: new Date('2027-02-10'),
        isActive: true,
        createdAt: monthsAgo(30),
      },
    ],
  });

  // ============================================================
  // 11. ACTIVE SUBSCRIPTIONS
  // ============================================================
  await prisma.subscription.createMany({
    data: [
      {
        userId: demoUser.id,
        serviceName: 'Netflix Ultra HD Premium',
        category: 'Entertainment',
        cost: 649.00,
        billingCycle: 'MONTHLY',
        nextBillingDate: daysAgo(-15),
        createdAt: monthsAgo(36),
      },
      {
        userId: demoUser.id,
        serviceName: 'Spotify Duo Premium',
        category: 'Music & Audio',
        cost: 179.00,
        billingCycle: 'MONTHLY',
        nextBillingDate: daysAgo(-8),
        createdAt: monthsAgo(32),
      },
      {
        userId: demoUser.id,
        serviceName: 'Apple One Family Cloud Bundle',
        category: 'Cloud Storage & Software',
        cost: 365.00,
        billingCycle: 'MONTHLY',
        nextBillingDate: daysAgo(-18),
        createdAt: monthsAgo(28),
      },
      {
        userId: demoUser.id,
        serviceName: 'Amazon Prime Annual Plan',
        category: 'Shopping & Streaming',
        cost: 1499.00,
        billingCycle: 'ANNUAL',
        nextBillingDate: new Date('2027-03-22'),
        createdAt: monthsAgo(35),
      },
    ],
  });

  // ============================================================
  // 12. PAYMENT CARDS (SAFE MASKED CARDS)
  // ============================================================
  await prisma.card.createMany({
    data: [
      {
        userId: demoUser.id,
        cardNickname: 'HDFC Regalia Gold Credit Card',
        cardType: 'CREDIT',
        issuer: 'HDFC Bank',
        lastFourDigits: '4821',
        creditLimit: 400000.00,
        outstandingAmount: 34500.00,
        minimumDue: 1725.00,
        billingCycleDay: 15,
        dueDate: daysAgo(-12),
        rewardCategory: 'Travel & Dining',
        createdAt: monthsAgo(33),
      },
      {
        userId: demoUser.id,
        cardNickname: 'ICICI Amazon Pay Rewards Card',
        cardType: 'CREDIT',
        issuer: 'ICICI Bank',
        lastFourDigits: '9152',
        creditLimit: 250000.00,
        outstandingAmount: 8200.00,
        minimumDue: 500.00,
        billingCycleDay: 20,
        dueDate: daysAgo(-18),
        rewardCategory: 'Online Shopping Cashback',
        createdAt: monthsAgo(24),
      },
      {
        userId: demoUser.id,
        cardNickname: 'HDFC Platinum Salary Debit Card',
        cardType: 'DEBIT',
        issuer: 'HDFC Bank',
        lastFourDigits: '3319',
        createdAt: accountCreatedDate,
      },
    ],
  });

  // ============================================================
  // 13. FINANCIAL TASKS & TO-DOS (COMPLETED & UPCOMING)
  // ============================================================
  await prisma.financialTask.createMany({
    data: [
      {
        userId: demoUser.id,
        title: 'Review Q3 equity & mutual fund asset allocation',
        category: 'SIP',
        priority: 'HIGH',
        dueDate: daysAgo(-4),
        isCompleted: false,
      },
      {
        userId: demoUser.id,
        title: 'Pay HDFC Regalia statement balance before grace period',
        category: 'CREDIT_CARD',
        priority: 'HIGH',
        dueDate: daysAgo(-8),
        isCompleted: false,
      },
      {
        userId: demoUser.id,
        title: 'Submit Section 80C & NPS tax investment receipts to HR',
        category: 'TAX',
        priority: 'MEDIUM',
        dueDate: monthsAgo(6),
        isCompleted: true,
        completedAt: monthsAgo(6, 10),
      },
      {
        userId: demoUser.id,
        title: 'Complete annual KYC renewal on Zerodha Demat account',
        category: 'GENERAL',
        priority: 'LOW',
        dueDate: monthsAgo(14),
        isCompleted: true,
        completedAt: monthsAgo(14, 5),
      },
    ],
  });

  // ============================================================
  // 14. 3-YEAR FINANCIAL HEALTH SCORE TELEMETRY (12 QUARTERLY EVALUATIONS)
  // ============================================================
  const healthHistory = [];
  const scoreProgression = [68, 70, 72, 74, 77, 80, 81, 83, 85, 86, 87, 88];
  for (let i = 0; i < 12; i++) {
    const qMonths = (12 - i) * 3;
    const score = scoreProgression[i];
    healthHistory.push({
      userId: demoUser.id,
      overallScore: score,
      savingsScore: Math.min(100, 65 + i * 3),
      debtScore: Math.min(100, 60 + i * 3),
      emergencyScore: Math.min(100, 70 + i * 2),
      investmentScore: Math.min(100, 60 + i * 3),
      goalScore: Math.min(100, 65 + i * 3),
      insuranceScore: 90,
      cashFlowScore: 88,
      subscriptionScore: 85,
      dtiScore: Math.min(100, 70 + i * 2),
      incomeStabilityScore: 95,
      positiveReasons: ['Consistent 3-year SIP investments', 'Automated monthly salary progression', 'Emergency reserve fully funded'],
      attentionReasons: i < 6 ? ['Car loan principal active', 'Monitor credit utilization'] : ['Continue building down payment reserve'],
      recommendations: ['Consider increasing index fund SIP by 10% after annual appraisal'],
      createdAt: monthsAgo(qMonths),
    });
  }
  await prisma.financialHealthHistory.createMany({ data: healthHistory });

  // ============================================================
  // 15. WHAT-IF FINANCIAL SIMULATIONS (SAVED EXPERIMENTS)
  // ============================================================
  await prisma.financialSimulation.createMany({
    data: [
      {
        userId: demoUser.id,
        scenarioName: 'Salary Increase + 10% Extra SIP Compounding',
        scenarioType: 'SALARY_INCREASE',
        parameters: { salaryHikePercent: 15, extraSipMonthly: 15000 },
        currentCashFlow: 93750.00,
        scenarioCashFlow: 108750.00,
        currentNetWorth: 2908020.00,
        scenarioNetWorth: 3840000.00,
        impactSummary: 'Increases projected 5-year liquid net worth by ₹9.3 Lakhs with zero lifestyle compromise.',
        detailedImpact: { annualSavingsDelta: 180000, projectedNetWorth3Y: 4200000 },
        createdAt: monthsAgo(8),
      },
      {
        userId: demoUser.id,
        scenarioName: 'Car Loan Lump Sum Prepayment (₹1.5 Lakhs)',
        scenarioType: 'LOAN_PREPAY',
        parameters: { prepaymentAmount: 142800, reduceTenure: true },
        currentCashFlow: 93750.00,
        scenarioCashFlow: 119000.00,
        currentNetWorth: 2908020.00,
        scenarioNetWorth: 2921500.00,
        impactSummary: 'Eliminates remaining 6 months of EMI debt, freeing ₹25,250 in monthly cash flow immediately.',
        detailedImpact: { interestSaved: 13500, tenureReducedMonths: 6 },
        createdAt: monthsAgo(2),
      },
    ],
  });

  // ============================================================
  // 16. MOBILE DEVICE & RECENT BANK SMS TRANSACTION CANDIDATES
  // ============================================================
  // Register connected mobile client (CPH2467 / Android 15)
  await prisma.mobileDevice.create({
    data: {
      userId: demoUser.id,
      deviceId: '738a1b9d',
      deviceModel: 'CPH2467',
      osVersion: 'Android 15 (API 35)',
      appVersion: '1.0.0+1',
      lastSyncAt: new Date(),
      isActive: true,
      createdAt: monthsAgo(1),
    },
  });

  // Seed 3 realistic bank SMS candidates ready to review in the mobile app!
  await prisma.pendingSmsTransaction.createMany({
    data: [
      {
        userId: demoUser.id,
        amount: 480.00,
        currency: 'INR',
        transactionType: 'EXPENSE',
        merchant: 'Swiggy',
        accountHint: '4589',
        matchedAccountId: salaryAcc.id,
        suggestedCategory: 'Food & Dining',
        confidence: 0.9850,
        categoryReason: 'Identified merchant Swiggy with typical food delivery pattern',
        status: 'PENDING',
        source: 'BANK_SMS',
        rawSender: 'HDFCBK',
        bankReference: 'UPI/6284910291/SWIGGY',
        rawMessageHash: 'hash_swiggy_480_demo',
        transactionDate: daysAgo(1),
        createdAt: daysAgo(1),
      },
      {
        userId: demoUser.id,
        amount: 3200.00,
        currency: 'INR',
        transactionType: 'EXPENSE',
        merchant: 'Indian Oil Petrol Pump',
        accountHint: '4589',
        matchedAccountId: salaryAcc.id,
        suggestedCategory: 'Transportation & Fuel',
        confidence: 0.9420,
        categoryReason: 'Recognized Indian Oil fuel retail terminal',
        status: 'PENDING',
        source: 'BANK_SMS',
        rawSender: 'HDFCBK',
        bankReference: 'POS/992014810/IOCL',
        rawMessageHash: 'hash_fuel_3200_demo',
        transactionDate: daysAgo(2),
        createdAt: daysAgo(2),
      },
      {
        userId: demoUser.id,
        amount: 165000.00,
        currency: 'INR',
        transactionType: 'INCOME',
        merchant: 'Infosys Technologies Payroll',
        accountHint: '4589',
        matchedAccountId: salaryAcc.id,
        suggestedCategory: 'Salary & Income',
        confidence: 0.9990,
        categoryReason: 'Regular monthly salary credit detected from employer payroll',
        status: 'PENDING',
        source: 'BANK_SMS',
        rawSender: 'HDFCBK',
        bankReference: 'NEFT/INFT20261001/SALARY',
        rawMessageHash: 'hash_salary_165000_demo',
        transactionDate: daysAgo(11),
        createdAt: daysAgo(11),
      },
    ],
  });

  // Calendar Events
  await prisma.calendarEvent.createMany({
    data: [
      {
        userId: demoUser.id,
        title: 'Monthly Salary Credit',
        eventType: 'SALARY',
        eventDate: new Date('2026-11-01'),
        amount: 165000.00,
        isRecurring: true,
        color: '#10b981',
      },
      {
        userId: demoUser.id,
        title: 'HDFC Regalia Statement Grace Period Due',
        eventType: 'BILL',
        eventDate: new Date('2026-10-27'),
        amount: 34500.00,
        color: '#ef4444',
      },
      {
        userId: demoUser.id,
        title: 'Monthly Index Fund SIP Execution',
        eventType: 'SIP',
        eventDate: new Date('2026-11-07'),
        amount: 40000.00,
        isRecurring: true,
        color: '#3b82f6',
      },
      {
        userId: demoUser.id,
        title: 'HDFC ERGO Health Insurance Annual Renewal',
        eventType: 'INSURANCE',
        eventDate: new Date('2026-11-20'),
        amount: 16200.00,
        color: '#f59e0b',
      },
    ],
  });

  // Notifications
  await prisma.notification.createMany({
    data: [
      {
        userId: demoUser.id,
        title: 'Gold Holding Up +134% in 3 Years',
        message: 'Your 24K Physical Gold bullion purchased 33 months ago at ₹5,850/g has appreciated to live COMEX reference ₹13,688/g.',
        type: 'GOLD_ALERT',
        isRead: false,
      },
      {
        userId: demoUser.id,
        title: 'Car Loan Nearing Payoff',
        message: 'Only 6 installments remaining on your HDFC Auto Loan. Outstanding principal is ₹1,42,800.',
        type: 'EMI_DUE',
        isRead: false,
      },
      {
        userId: demoUser.id,
        title: 'Emergency Fund Goal Achieved',
        message: 'Congratulations! Your 6-month liquid emergency runway goal of ₹5,00,000 has been 100% funded in ICICI reserve.',
        type: 'GOAL_MILESTONE',
        isRead: true,
      },
    ],
  });

  console.log('\n====================================================================');
  console.log('🎉 3-YEAR DEMO ACCOUNT SEEDED SUCCESSFULLY!');
  console.log('====================================================================');
  console.log('  Login Email:     demo@example.com');
  console.log('  Login Password:  DemoPassword123!');
  console.log('  User Name:       Arjun Sharma (Senior Product Manager, Bengaluru)');
  console.log('  Account Age:     3 Years (Since October 2023 / 36 Months)');
  console.log('  Transactions:    450+ Real entries across 36 continuous months');
  console.log('  Net Worth:       ~₹29,08,020 (Liquid Savings + Investments - Debt)');
  console.log('  Car Loan:        ₹1,42,800 outstanding (30 of 36 EMIs paid)');
  console.log('  Pending SMS:     3 Bank SMS candidates ready on mobile screen');
  console.log('====================================================================\n');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
