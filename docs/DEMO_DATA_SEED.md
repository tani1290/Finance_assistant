# FinPro — 3-Year Account Demo Data & Simulation Guide
**Project:** FinPro — Personal Financial & Investment Decision Support Platform  
**Target User:** Arjun Sharma (`demo@example.com`)  
**Account Age:** **3 Years (36 Continuous Months — October 2023 to Present)**  
**Status:** **ACTIVE & SEEDED**

---

## 1. Quick Access & Credentials

| Credential | Value |
|---|---|
| **Web Portal** | `http://127.0.0.1:5001/login.html` (Local) or deployed Vercel URL |
| **Email Address** | `demo@example.com` |
| **Password** | `DemoPassword123!` |
| **Account Name** | **Arjun Sharma** |
| **Occupation** | Senior Product Manager (Bengaluru) |
| **Role** | `PREMIUM_USER` |

---

## 2. 3-Year Financial Profile & Summary

Arjun Sharma's account simulates 36 months of disciplined personal financial growth, career progression, and multi-asset wealth compounding:

```
┌────────────────────────────────────────────────────────────────────────┐
│               ARJUN SHARMA — 3-YEAR FINANCIAL SNAPSHOT                 │
├────────────────────────────┬─────────────────────────────┬─────────────┤
│   Gross Monthly Inflow     │   Current Net Worth         │ Health Score│
│   ₹1,80,000 / month        │   ₹29,08,020                │   88 / 100  │
│   (₹1.65L salary + ₹15K div│   (Liquid + Assets - Debt)  │  (Tier: A+) │
├────────────────────────────┼─────────────────────────────┼─────────────┤
│   Liquid Savings & Bank    │   Investment Portfolio      │ Active Debt │
│   ₹8,93,870 (4 Accounts)   │   ₹21,65,400 (Stocks + Gold)│ ₹1,42,800   │
└────────────────────────────┴─────────────────────────────┴─────────────┘
```

### 3-Year Career & Salary Progression
- **Year 1 (Months 36–25):** ₹1,20,000 / month salary + ₹1.5L annual appraisal bonus
- **Year 2 (Months 24–13):** ₹1,45,000 / month salary + ₹2.1L annual appraisal bonus
- **Year 3 (Months 12–Present):** ₹1,65,000 / month salary + ₹2.75L annual appraisal bonus

---

## 3. Seeded Entities & Field-by-Field Breakdown

### 3.1 Financial Accounts (4 Institutions)

| Account Name | Institution | Type | Masked Number | Current Balance |
|---|---|---|---|---|
| **HDFC Corporate Salary Account** | HDFC Bank | `SAVINGS` | `•••• 4589` | **₹3,85,420.00** |
| **ICICI Emergency Reserve** | ICICI Bank | `SAVINGS` | `•••• 7120` | **₹5,00,000.00** |
| **Zerodha Trading Balance** | Zerodha Broking | `OTHER` | `•••• ZR01` | **₹1,45,000.00** |
| **PhonePe UPI Digital Wallet** | YES Bank UPI | `WALLET` | `•••• 9871` | **₹8,450.00** |

---

### 3.2 440+ Transactions Across 36 Months

The database contains over **440 real transaction records** spanning from October 2023 to the present:

1. **Monthly Incomes (1st of month):**
   - 36 consecutive monthly salary deposits from *Infosys Technologies Payroll*.
   - 3 annual performance bonus credits in March of each year.
2. **Monthly Fixed Expenses:**
   - **Apartment Rent (3rd of month):** ₹26,000 (Y1) → ₹28,000 (Y2) → ₹30,000 (Y3) to *Prestige Falcon Estates*.
   - **Auto Loan EMI (5th of month):** ₹25,250 to *HDFC Auto Finance* for 30 consecutive months.
   - **Equity SIPs (7th of month):** ₹25,000 (UTI Nifty 50) + ₹15,000 (Parag Parikh Flexi Cap).
   - **Electricity Bill (10th of month):** ₹2,850 to ₹3,570 to *BESCOM*.
   - **Broadband Bill (12th of month):** ₹1,179 to *Airtel Xstream Fiber*.
3. **Variable & Lifestyle Expenses:**
   - **Pantry & Groceries (15th of month):** ₹8,500 to ₹9,850 to *Nature's Basket*.
   - **Weekend Dining (19th of month):** ₹1,450 to ₹1,890 to *Toit Brewpub Indiranagar*.
   - **Swiggy Deliveries (24th of month):** ₹680 to ₹1,130.
   - **Fuel & Commute (26th of month):** ₹3,200 to ₹3,700 to *Indian Oil Corporation*.
   - **Digital Subscriptions (28th of month):** ₹649 to *Netflix 4K*.

---

### 3.3 Investment Portfolio (3-Year Compounding Returns)

- **Total Invested Capital:** ₹14,80,000.00  
- **Current Portfolio Value:** **₹21,65,400.00** (~18.5% annualized CAGR)

| Symbol | Asset Name | Asset Type | Quantity | Avg Buy Price | Current Reference | 3-Year Performance |
|---|---|---|---|---|---|---|
| `RELIANCE` | Reliance Industries Ltd | `STOCK` | 80 shares | ₹1,120.50 | ~₹1,322.00 | **+18.0%** (bonus split adjusted) |
| `TCS` | Tata Consultancy Services | `STOCK` | 45 shares | ₹3,250.00 | ~₹3,540.00 | **+8.9%** |
| `HDFCBANK` | HDFC Bank Ltd | `STOCK` | 110 shares | ₹1,435.00 | ~₹1,680.00 | **+17.1%** |
| `INFY` | Infosys Ltd | `STOCK` | 120 shares | ₹1,380.00 | ~₹1,510.00 | **+9.4%** |
| `UTI_NIFTY50` | UTI Nifty 50 Index Fund | `MUTUAL_FUND`| 3,200 units | ₹148.50 | ~₹195.00 | **+31.3%** |
| `PPFAS_FLEXICAP`| Parag Parikh Flexi Cap Fund | `MUTUAL_FUND`| 2,100 units | ₹54.20 | ~₹78.50 | **+44.8%** |
| `GOLD24K` | 24K Digital Gold Bullion | `GOLD` | 45.0 grams | ₹5,850.00 / g | ~₹13,688.00 / g | **+134.0%** (Major Capital Gain!) |
| `SILVER_SPOT` | 999 Fine Silver Bar | `SILVER` | 1.0 kg | ₹72,000.00 / kg | ~₹2,00,620.00 / kg | **+178.6%** |

---

### 3.4 Car Loan Amortization (30 of 36 EMIs Paid)

- **Lender:** HDFC Auto Finance Ltd
- **Original Principal:** ₹8,00,000.00
- **Interest Rate:** 8.50% p.a.
- **Tenure:** 36 months (Started 30 months ago)
- **Monthly EMI:** **₹25,250.00**
- **Installments Paid:** 30 / 36
- **Outstanding Balance:** **₹1,42,800.00** (Only 6 months remaining until 100% debt-free!)

---

### 3.5 Savings Goals Progression

1. **Emergency Fund (6 Months Liquid Runway):**
   - Target: ₹5,00,000 | Current: ₹5,00,000 | **Status: COMPLETED** (Stored in ICICI high-yield savings)
2. **Apple MacBook Pro M3 Workstation:**
   - Target: ₹2,20,000 | Current: ₹2,20,000 | **Status: COMPLETED** (Achieved 18 months ago)
3. **Bengaluru 3-BHK Home Down Payment:**
   - Target: ₹25,00,000 | Current: **₹16,50,000** | Monthly Contribution: ₹45,000 | **Status: ACTIVE** (66% achieved)
4. **European Alps Vacation & Tour:**
   - Target: ₹3,50,000 | Current: **₹2,40,000** | Monthly Contribution: ₹15,000 | **Status: ACTIVE** (68% achieved)

---

### 3.6 Insurance Policies & Protection

- **Life Insurance:** *HDFC Life Click 2 Protect 3D Plus* — ₹1.5 Crore sum assured (Annual premium: ₹18,500).
- **Health Insurance:** *HDFC ERGO Optima Secure Floater* — ₹15 Lakhs family floater cover (Annual premium: ₹16,200).
- **Motor Insurance:** *TATA AIG Comprehensive Auto Protect* — ₹6.5 Lakhs IDV (Annual premium: ₹11,800).

---

### 3.7 Payment Cards (Safe Masked Cards)

- **HDFC Regalia Gold Credit Card:** Limit: ₹4,00,000 | Balance: ₹34,500 | Utilization: **8.6%** (Excellent credit health).
- **ICICI Amazon Pay Rewards Card:** Limit: ₹2,50,000 | Balance: ₹8,200 | Utilization: **3.2%**.
- **HDFC Platinum Salary Debit Card:** Masked `•••• 3319`.

---

### 3.8 3-Year Health Score Telemetry (12 Quarters)

Tracks financial maturity quarter-over-quarter:
- **Q1 (Oct 2023):** 68 / 100 (Car loan new, emergency fund partial)
- **Q4 (Jul 2024):** 74 / 100 (Emergency fund reached 50%)
- **Q8 (Jul 2025):** 81 / 100 (MacBook goal completed, salary hike)
- **Q12 (Present):** **88 / 100 (Tier A+)** (Debt almost zero, ₹21L+ investment portfolio, 6 months liquid runway)

---

### 3.9 Mobile App Bank SMS Pending Candidates

Three recent realistic bank transactions are ready to test directly in the mobile app's **SMS Detection Screen**:

1. **Swiggy Food Order:** ₹480.00 — Auto-matched to HDFC Salary (`•••• 4589`), Suggested Category: `Food & Dining` (98.5% confidence).
2. **Indian Oil Fuel Refill:** ₹3,200.00 — Suggested Category: `Transportation & Fuel` (94.2% confidence).
3. **Employer Salary Credit:** ₹1,65,000.00 — Suggested Category: `Salary & Income` (99.9% confidence).

---

## 4. How to Reset / Re-run the Seeder

At any time, you can re-run the seed script to reset the account to this pristine state:

```bash
cd node-backend
node prisma/seed.js
```
