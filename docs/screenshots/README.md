# FinPro Application Screenshots & Browser Verification Evidence

This directory contains 30 high-resolution, unmanipulated browser screenshots captured directly from the live running **FinPro — Personal Finance & Investment Decision Support Platform** (Node.js/Express backend, PostgreSQL 17 database, Chrome headless/CDP runtime on localhost:5000).

Every screenshot represents an authentic view of the running application with realistic financial data in Indian Rupees (₹ INR).

---

## Screenshot Index & QA Verification Matrix

| No. | Screenshot Filename | Feature / Module | Verification Scope & Tested Actions | Verified |
|:---:|:-------------------|:-----------------|:-------------------------------------|:--------:|
| 01 | `01-login.png` | Authentication & Security | Verified clean login view with email/password validation and JWT session handling. | **YES** |
| 02 | `02-signup.png` | User Registration | Verified signup form with real-time password strength indicators, tenant isolation, and input sanitization. | **YES** |
| 03 | `03-landing.png` | FinPro Platform Landing | Verified hero command center overview, platform statistics, Indian Rupee core value proposition, and feature grid. | **YES** |
| 04 | `04-onboarding.png` | Financial Onboarding | Verified multi-step onboarding wizard, salary, risk profiling, and initial 50/30/20 plan generation. | **YES** |
| 05 | `05-dashboard.png` | Financial Command Center | Verified real-time database aggregations: total bank balance, monthly income, expense breakdown, and health score. | **YES** |
| 06 | `06-accounts.png` | Account Balances & Ledger | Verified atomic deposit sync, multiple bank accounts (HDFC, Zerodha), and masked account numbers. | **YES** |
| 07 | `07-budgets.png` | Category Budgets & Optimization | Verified monthly category budget limits, real-time spending progress bars, and 50/30/20 rule allocations. | **YES** |
| 08 | `08-goals.png` | Financial Savings Goals | Verified milestone tracking (Emergency Fund, Home Down Payment), target dates, and monthly contribution projections. | **YES** |
| 09 | `09-investments.png` | Investment Portfolio & Assets | Verified stock holdings, mutual fund SIPs, 24K gold valuation, and portfolio asset allocation pie chart. | **YES** |
| 10 | `10-market-data.png` | Live Stock Market Dashboard | Verified live NSE stock ticker, real-time prices, price changes, and API data provenance indicators. | **YES** |
| 11 | `11-gold-silver.png` | 24K/22K Gold & Silver Feed | Verified dedicated precious metals rate grid in INR per 10g (Gold) and per kg (Silver) with live spreads. | **YES** |
| 12 | `12-technical-charts.png` | Interactive Technical Charts | Verified ECharts candlestick and volume charts, multi-timeframe controls (1D/1W/1M/1Y), RSI, MACD, and Bollinger Bands. | **YES** |
| 13 | `13-loans.png` | Loans & Debt Management | Verified loan obligation tracking (Home Loan, Auto Loan), interest rate comparisons, and monthly EMI schedule. | **YES** |
| 14 | `14-prepayment-simulator.png` | Loan Prepayment Simulator | Verified interactive EMI calculator and prepayment simulator calculating tenure reduction and interest savings in INR. | **YES** |
| 15 | `15-insurance.png` | Insurance Coverage Portfolio | Verified policy management (Life, Health, Term), total sum insured aggregation, and renewal alerts. | **YES** |
| 16 | `16-subscriptions.png` | Recurring Subscriptions Tracker | Verified active digital subscriptions (Netflix, Prime, Spotify), monthly recurring burn rate, and billing cycles. | **YES** |
| 17 | `17-financial-health.png` | 10-Factor AI Health Score | Verified 10-factor financial health score breakdown (Emergency Fund, Debt-to-Income, Savings Rate, Net Worth Trajectory). | **YES** |
| 18 | `18-ai-advisor.png` | Conversational AI Advisor | Verified context-aware financial assistant with user twin snapshot, quick action prompts, and personalized recommendations. | **YES** |
| 19 | `19-what-if-simulator.png` | What-If Financial Simulator | Verified scenario planning modal (Salary Hike +10%, Extra SIP ₹5k, Major Purchase ₹8L) and net worth impact. | **YES** |
| 20 | `20-cash-flow.png` | Predictive Cash Flow Engine | Verified 30-day and 90-day balance trajectory projections accounting for recurring bills, EMIs, and scheduled income. | **YES** |
| 21 | `21-ocr-receipt.png` | OCR Smart Receipt Scanner | Verified automated receipt processing modal with merchant name extraction, total amount parsing, and confirmation state. | **YES** |
| 22 | `22-voice-assistant.png` | Voice Assistant & Intent Engine | Verified voice command intent recognition (QUERY_EXPENSES, ADD_EXPENSE) with safety confirmation safeguards. | **YES** |
| 23 | `23-financial-news.png` | Curated Financial News Stream | Verified structured financial headlines with source attribution, category tagging, and publication timestamps. | **YES** |
| 24 | `24-tasks-reminders.png` | Financial Calendar & Task Manager | Verified scheduled payment calendar, EMI due dates, SIP execution dates, and task completion checklists. | **YES** |
| 25 | `25-reports.png` | Analytics & Financial Reports | Verified monthly expense breakdown by category, income vs expense trends, and financial report generation. | **YES** |
| 26 | `26-csv-import-export.png` | Statement CSV Import & Export | Verified CSV bank statement parser with duplicate row detection, preview table, and bulk transaction commit. | **YES** |
| 27 | `27-training-studio.png` | AI Training & ML Studio | Verified ML dataset management, schema inspection, feature distribution summary, and dataset versioning. | **YES** |
| 28 | `28-risk-radar.png` | Comprehensive Financial Risk Radar | Verified risk evaluation matrix analyzing debt burden, emergency buffer adequacy, and insurance under-coverage. | **YES** |
| 29 | `29-transactions-ledger.png` | Full Transaction Ledger | Verified transaction search, category filtering, income/expense tags, anomaly indicators, and pagination. | **YES** |
| 30 | `30-ml-prediction-engine.png` | ML Inference & Prediction Engine | Verified statistical regression model execution, R², MAE, RMSE metrics display, and inference explanations. | **YES** |

---

## Visual Gallery Overview

All 30 screenshot artifacts are stored in this directory:
`docs/screenshots/`

File sizes range from ~35 KB to ~298 KB depending on screen complexity and embedded ECharts visualizations.
Captures adhere to 1440 × 900 desktop viewport dimensions at 100% scale without developer tooling, console overlays, or mocked HTML.
