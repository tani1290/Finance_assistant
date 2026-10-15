# FinPro (Jinay Finance AI) — Comprehensive System Specification, Architecture, ER Diagrams & Project Roadmap

> **Platform:** FinPro — AI-Powered Personal Financial Planner & Investment Decision Support Platform  
> **Target Market:** Indian Financial Ecosystem (INR `₹`, `en-IN`, `Asia/Kolkata` Timezone)  
> **Repository:** [tani1290/Finance_assistant](https://github.com/tani1290/Finance_assistant.git)  
> **Canonical Runtime:** Node.js 20+ LTS / Express 4.21 | PostgreSQL 17 | Prisma 5.22 | Flutter 3.x / Dart 3.x | Vanilla JS SPA  
> **AI Engine:** Google Gemini 2.5 Flash / 1.5 Flash Grounded Inference + Deterministic Expert Engine  

---

## Table of Contents
1. [Executive Summary & Overall Project Context](#1-executive-summary--overall-project-context)
   - 1.1 The Problem Statement
   - 1.2 The FinPro Solution & Vision
   - 1.3 Key Objectives & Success Criteria
   - 1.4 Scope & Boundary Conditions
   - 1.5 Target Audience & Real-World Use Cases
2. [End-to-End System Architecture](#2-end-to-end-system-architecture)
   - 2.1 High-Level Architecture
   - 2.2 Client Layer (Web Single Page App & Mobile App)
   - 2.3 API Gateway & Security Infrastructure
   - 2.4 Domain Services & Business Logic Layer
   - 2.5 External Services & Market Intelligence Pipeline
   - 2.6 Persistence Layer & Multi-Tenant Isolation
3. [Component Interaction & Sequence Workflows](#3-component-interaction--sequence-workflows)
   - 3.1 Dual-Token Authentication & Refresh Flow
   - 3.2 Grounded AI Advisory & Deterministic Fallback Flow
   - 3.3 Zero-Fake Live Market Data Aggregation Flow
   - 3.4 Automated SMS Detection & Transaction Reconciliation Flow
4. [Complete Entity-Relationship (ER) Diagrams](#4-complete-entity-relationship-er-diagrams)
   - 4.1 Master ER Diagram (Prisma Models & Cardinalities)
   - 4.2 Core Data Domains & Relational Mapping
   - 4.3 Database Integrity, Cascades & Indexing Strategies
5. [Comprehensive Gantt Charts & Development Lifecycle](#5-comprehensive-gantt-charts--development-lifecycle)
   - 5.1 Project Development Gantt Chart
   - 5.2 Phase-by-Phase Milestone Breakdown
   - 5.3 QA Testing & Production Verification Gate
6. [Technology Stack Inventory & Deployment Architecture](#6-technology-stack-inventory--deployment-architecture)

---

## 1. Executive Summary & Overall Project Context

### 1.1 The Problem Statement
Modern personal finance in India is severely fractured. An individual typically juggles:
- Multiple savings and current bank accounts across private/public sector banks (HDFC, SBI, ICICI, etc.).
- Credit cards with varied billing cycles, minimum-due traps, and hidden APR interest penalties.
- Equity portfolios across discount brokers (Zerodha, Groww, AngelOne) with delayed sync.
- Physical bullion holdings (24K/22K Gold & Silver) with fluctuating local MCX spot prices.
- Multiple active loans (Home, Vehicle, Education, Personal) with obscure amortization curves.
- Recurring SaaS, utility, and insurance subscriptions liable to missed due dates.

Existing personal finance management (PFM) software falls into two flawed extremes:
1. **Foreign Market Bias:** Designed for US/European markets (USD, 401(k), IBAN) with no native support for Indian UPI, Indian Rupee (`₹`), Indian tax brackets, or local asset classes.
2. **Hallucinatory or Synthetic Advice:** Generic AI chatbots that dispense boilerplate text without connecting to the user's real financial ledger, or platforms that fabricate market numbers using random mock curves (`Math.random()`), risking severe real-world financial losses.

### 1.2 The FinPro Solution & Vision
**FinPro (Jinay Finance AI)** delivers a unified, enterprise-grade, self-hosted financial intelligence operating system tailored specifically for the Indian economy.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FINPRO UNIFIED PLATFORM                         │
├──────────────────┬───────────────────┬─────────────────────────────────┤
│ Real Data Ground │ Zero-Fake Markets │ Cross-Platform Access           │
│ Real DB context  │ Real NSE/BSE      │ Flutter Mobile + Android SMS    │
│ No hallucination │ Real Gold & FX    │ Responsive Web SPA (Vanilla JS) │
└──────────────────┴───────────────────┴─────────────────────────────────┘
```

Core pillars of the solution:
1. **Canonical Ledger & Multi-Domain Registry:** A single ACID-compliant database tracking accounts, transactions, 50/30/20 budgets, goals, investments, loans, cards, policies, and subscriptions.
2. **Strict Zero-Fake-Data Policy:** Live quotes for NSE/BSE equities, MCX/COMEX precious metals (24K/22K Gold, Silver), and interbank FX feeds. Zero synthetic sine-curves or random math.
3. **Database-Grounded AI Advisor:** Google Gemini 2.5/1.5 Flash grounded strictly into the user's authenticated relational records. If external cloud AI is offline, an offline deterministic rule-based expert engine handles financial health scoring, budget alerts, and debt payoff planning.
4. **Automated Android SMS Channel:** Background transaction detection via a custom Kotlin `BroadcastReceiver` that captures bank SMS alerts, verifies hash signatures against duplicates, and queues transactions for user confirmation.
5. **Multi-Tenant Security:** Rigid JWT access/refresh token pairs, bcrypt encryption, per-query user scoping, and automated audit logging.

### 1.3 Key Objectives & Success Criteria
- **Unified Net Worth & Health Index:** Compute an instantaneous 10-factor financial health score (0–100) combining debt-to-income (DTI), savings rate, emergency runway, and insurance adequacy.
- **Budget Intelligence:** Implement automated 50/30/20 (Needs, Wants, Savings) and Zero-Based budgeting with proactive overspend notifications.
- **Predictive Cash Flow:** Simulate 7, 30, and 90-day cash flow projections identifying upcoming liquidity deficits before they happen.
- **Loan Prepayment & What-If Simulator:** Interactive mathematical simulators demonstrating how extra monthly prepayments slash tenure and compound interest savings.
- **Master QA Sign-off:** Complete test suite passing:
  - Master Integration Suite: **66 / 66 tests passing**
  - Auth & Security Suite: **40 / 40 tests passing**
  - External Market Ingestion Suite: **6 / 6 subsystems verified**

### 1.4 Scope & Boundary Conditions
| Category | In Scope | Out of Scope |
|---|---|---|
| **Platforms** | Responsive Web SPA (Vanilla ES6, CSS3, ECharts) + Native Android/iOS Mobile App (Flutter 3.x, Riverpod 2.x) | Desktop native apps (Electron/WPF) |
| **Market Data** | NSE/BSE equities, COMEX/MCX Gold & Silver, USD/INR & major FX, historical charts | High-frequency trading or automated broker order placement |
| **Banking** | User-managed accounts, receipt OCR, Android native SMS transaction ingestion | Direct Open Banking / Account Aggregator API write access |
| **Intelligence** | Gemini 2.5 Flash grounded assistant, deterministic expert fallback, 10-factor health index, anomaly detector | Unregulated fiduciary financial advice or automated investment execution |
| **Security** | JWT dual-token, Google OAuth 2.0, bcrypt, Helmet, tiered rate limiters, audit trail | Hardware security modules (HSM) |

---

## 2. End-to-End System Architecture

### 2.1 High-Level Architecture Diagram

```mermaid
graph TB
    subgraph ClientLayer ["Client Presentation Layer"]
        WebSPA["Web Single Page App\n(Vanilla JS ES6+ / CSS3 Tokens / ECharts)"]
        FlutterApp["Flutter Mobile App\n(Flutter 3.x / Riverpod 2.x / Material 3)"]
        SmsReceiver["Native Android Channel\n(Kotlin FinProSmsReceiver)"]
    end

    subgraph GatewayLayer ["API Gateway & Security Layer (Port 5001)"]
        ExpressRouter["Express.js 4.21 HTTP Engine"]
        SecurityMW["Security Middleware\n(Helmet / CORS Whitelist / Compression)"]
        RateLimiter["Rate Limiters\n(200 req/15min API | 20 req/15min Auth)"]
        AuthMW["Auth Middleware\n(JWT HMAC-SHA256 / Google OAuth Validator)"]
    end

    subgraph ServiceLayer ["Domain Services & Business Logic"]
        AuthService["Auth & Token Service"]
        LedgerService["Accounts & Transactions Engine"]
        BudgetService["50/30/20 Budgeting & Category Engine"]
        LoanService["Loan Amortization & Card Manager"]
        AIEngine["Grounded AI Advisor\n(Gemini 2.5 Flash + Fallbacks)"]
        DeterministicEngine["Deterministic Expert Rule Engine\n(Offline Health Scorer)"]
        MarketService["Market Aggregator & Cache\n(Alpha Vantage / Finnhub / FX)"]
        SmsReconciliation["SMS Parser & Duplicate Detection"]
        OcrService["Tesseract.js Receipt Scanner"]
        ExportService["Tenant-Isolated CSV Export Engine"]
    end

    subgraph ExternalCloud ["External Cloud & Telemetry Services"]
        GeminiAPI["Google Gemini AI Platform"]
        AlphaVantage["Alpha Vantage Market API"]
        FinnhubAPI["Finnhub Financial API"]
        FirebaseCloud["Firebase Admin SDK / FCM"]
        GoogleOAuth["Google Identity Services"]
    end

    subgraph DataLayer ["Persistence & Storage Layer"]
        PrismaORM["Prisma Client ORM 5.22\n(Type-Safe Query Engine)"]
        PostgresDB[("PostgreSQL 17 Database\n(26 Models / Decimal 15,2 / ACID)")]
    end

    %% Client to Gateway
    WebSPA -->|"HTTPS / REST / Bearer JWT"| SecurityMW
    FlutterApp -->|"HTTPS / REST / Dio Interceptors"| SecurityMW
    SmsReceiver -->|"MethodChannel Event Sync"| FlutterApp

    %% Gateway to Middleware & Router
    SecurityMW --> RateLimiter
    RateLimiter --> AuthMW
    AuthMW --> ExpressRouter

    %% Router to Services
    ExpressRouter --> AuthService
    ExpressRouter --> LedgerService
    ExpressRouter --> BudgetService
    ExpressRouter --> LoanService
    ExpressRouter --> AIEngine
    ExpressRouter --> MarketService
    ExpressRouter --> SmsReconciliation
    ExpressRouter --> OcrService
    ExpressRouter --> ExportService

    %% Service to External
    AIEngine -.->|"Grounded Prompt"| GeminiAPI
    AIEngine -->|"Fallback on offline"| DeterministicEngine
    MarketService -.->|"Equities / FX"| AlphaVantage
    MarketService -.->|"Fallback / Metals"| FinnhubAPI
    AuthService -.->|"Token Validation"| GoogleOAuth
    ExpressRouter -.->|"Push Notifications"| FirebaseCloud

    %% Services to Database
    AuthService --> PrismaORM
    LedgerService --> PrismaORM
    BudgetService --> PrismaORM
    LoanService --> PrismaORM
    DeterministicEngine --> PrismaORM
    SmsReconciliation --> PrismaORM
    MarketService --> PrismaORM
    PrismaORM --> PostgresDB
```

### 2.2 Client Layer Architecture
- **Web SPA (`frontend/public/`):** Built with pure Vanilla JavaScript (ES6 Modules) to achieve instantaneous load times and zero dependency bloat. Interactive visualisations are powered by Apache ECharts, styled using CSS Custom Properties and glassmorphic translucent surfaces (`backdrop-filter`).
- **Mobile Client (`mobile/`):** Developed using Flutter 3.x and Dart 3.x. State is managed reactively via Riverpod 2.x, delivering predictable unidirectional data flow.
- **Native Android SMS Platform Channel:** A Kotlin `BroadcastReceiver` (`FinProSmsReceiver`) intercepts incoming transactional bank SMS alerts in the background. It extracts monetary values, merchant names, debit/credit flags, and computes SHA-256 hashes of message content to prevent duplicate transaction entries.

### 2.3 API Gateway & Security Infrastructure
- **HTTP Routing:** Node.js v20+ with Express 4.21 listening on port 5001 (configurable via `.env`).
- **Defense in Depth:**
  - `helmet`: Enforces Content Security Policy (CSP), Strict-Transport-Security (HSTS), and anti-clickjacking headers.
  - `cors`: Strict origin validation against registered frontend hosts with credential transport.
  - `express-rate-limit`: Two-tier rate limiting (200 requests/15min for general endpoints, 20 requests/15min for authentication).
  - `compression`: High-ratio Gzip compression reducing mobile telemetry payload sizes.
- **Authentication:** Dual-token JWT system (short-lived access tokens, long-lived refresh tokens stored with database tracking and revocation capability).

### 2.4 Domain Services & Business Logic Layer
- **Financial Twin & Health Scoring:** Analyzes 10 key financial vectors (Savings, Debt, Emergency Fund, Investment, Goals, Insurance, Cash Flow, Subscriptions, DTI, Income Stability) producing a holistic score from 0 to 100.
- **Cash Flow Simulator:** Computes daily rolling balances across 7, 30, and 90-day future horizons, alerting the user to anticipated low-balance events.
- **What-If Scenario Engine:** Proposes financial interventions (e.g., salary hikes, loan prepayments, inflation shifts) and calculates their compound net worth impacts over 1-to-5-year projections.

### 2.5 External Services & Market Intelligence Pipeline
- **Strict Zero-Fake-Data Pipeline:**
  - Stocks & Equities: Alpha Vantage (primary) with seamless fallback to Finnhub.
  - Precious Metals: 24K and 22K Gold and Silver derived from COMEX continuous futures and adjusted to Indian MCX spot benchmark rates via live interbank USD/INR conversion.
  - In-Memory Multi-Tier TTL Cache: 3 minutes for live quotes, 5 minutes for commodities, 15 minutes for multi-timeframe charts, and 1 hour for company fundamentals.
  - Transparent UI Status Badges: Every price card explicitly informs the user if data is `LIVE`, `CACHED`, `STALE`, or `UNAVAILABLE`.

### 2.6 Persistence Layer & Multi-Tenant Isolation
- **Database Engine:** PostgreSQL 17 with strict ACID guarantees.
- **Object-Relational Mapping:** Prisma ORM 5.22 providing compile-time type safety and schema validation.
- **Tenant Isolation:** Enforced at the Prisma query level. All mutating and reading queries are bounded to `{ userId: req.user.id }`. Accessing resources belonging to another user safely yields HTTP 404 (Not Found) rather than exposing data.
- **Monetary Precision:** Strictly formatted with `Decimal(15, 2)` for currency values and `Decimal(15, 6)` for fractional assets (cryptocurrency and bullion weights in grams).

---

## 3. Component Interaction & Sequence Workflows

### 3.1 Dual-Token Authentication & Refresh Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Client (Web / Mobile)
    participant GW as API Gateway & Middleware
    participant Auth as Auth Controller
    participant DB as PostgreSQL (Prisma)

    User->>GW: POST /api/v1/auth/login (email, password)
    GW->>Auth: Validate Input & Throttling
    Auth->>DB: findUnique({ where: { email } })
    DB-->>Auth: User Record & Password Hash
    Auth->>Auth: bcrypt.compare(password, hash)
    alt Password Invalid
        Auth-->>User: 401 Unauthorized ("Invalid credentials")
    else Password Valid
        Auth->>Auth: Generate Access Token (JWT 60m)
        Auth->>Auth: Generate Refresh Token (UUID 7d)
        Auth->>DB: RefreshToken.create({ token, userId, expiresAt })
        DB-->>Auth: Saved
        Auth-->>User: 200 OK { accessToken, refreshToken, user }
    end

    Note over User, GW: Subsequent Protected API Request
    User->>GW: GET /api/v1/accounts (Header: Bearer <accessToken>)
    GW->>GW: jwt.verify(accessToken)
    alt Token Expired (401)
        GW-->>User: 401 Unauthorized (TokenExpiredError)
        User->>GW: POST /api/v1/auth/refresh-token { refreshToken }
        GW->>Auth: Handle Refresh
        Auth->>DB: RefreshToken.findUnique({ where: { token } })
        alt Token Expired or Revoked
            Auth-->>User: 401 Unauthorized ("Refresh token revoked/expired")
        else Token Valid
            Auth->>Auth: Mint New Access Token (60m)
            Auth-->>User: 200 OK { accessToken }
            User->>GW: Retry GET /api/v1/accounts (New Bearer Token)
        end
    else Token Valid
        GW->>DB: FinancialAccount.findMany({ where: { userId } })
        DB-->>GW: Accounts Data
        GW-->>User: 200 OK { success: true, data: [...] }
    end
```

### 3.2 Grounded AI Advisory & Deterministic Fallback Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Investor
    participant AICont as AI Advisor Controller
    participant Context as Financial Context Builder
    participant DB as PostgreSQL Database
    participant Gemini as Google Gemini 2.5 API
    participant RuleEngine as Deterministic Rule Engine

    User->>AICont: POST /api/v1/ai/chat { message: "Can I afford a 25k laptop?" }
    AICont->>Context: compileUserFinancialContext(userId)
    Context->>DB: Fetch Accounts, Budgets, CashFlow, EMIs, Savings
    DB-->>Context: Verified Real Financial Ledger
    Context-->>AICont: Grounded Context Object (Net worth, Disposable income, Budget balance)
    
    AICont->>AICont: Check Gemini API Key Configuration & Network
    alt Gemini Key Present & Active
        AICont->>Gemini: generateContent([SystemPrompt + DB Grounding + UserQuery])
        alt Gemini Response Successful
            Gemini-->>AICont: Contextual Financial Recommendation
            AICont->>DB: ChatMessage.create(user query & AI reply)
            AICont-->>User: 200 OK { reply, source: "GEMINI_2.5_FLASH", grounded: true }
        else Gemini Network/Quota Error
            AICont->>RuleEngine: evaluateRules(GroundedContext, UserQuery)
            RuleEngine-->>AICont: Rule-Generated Deterministic Advice
            AICont-->>User: 200 OK { reply, source: "DETERMINISTIC_FALLBACK" }
        end
    else Offline Mode / No API Key
        AICont->>RuleEngine: evaluateRules(GroundedContext, UserQuery)
        RuleEngine-->>AICont: Mathematical Evaluation (50/30/20 & Cashflow analysis)
        AICont-->>User: 200 OK { reply, source: "DETERMINISTIC_EXPERT_SYSTEM", offline: true }
    end
```

### 3.3 Zero-Fake Live Market Data Aggregation Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Investor Dashboard
    participant MS as Market Service
    participant Cache as In-Memory TTL Cache
    participant AV as Alpha Vantage API
    participant FH as Finnhub API
    participant FX as Live Interbank FX Feed
    participant DB as PostgreSQL (Price History)

    User->>MS: GET /api/v1/market/quote?symbol=RELIANCE.NS
    MS->>Cache: get("quote:RELIANCE.NS")
    alt Valid Cache Available (TTL < 3 min)
        Cache-->>MS: Cached Quote Payload
        MS-->>User: 200 OK { data, data_status: "CACHED", source: "AlphaVantage" }
    else Cache Expired or Miss
        MS->>AV: fetchQuote("RELIANCE.NS")
        alt Alpha Vantage Responds (200 OK)
            AV-->>MS: Raw Quote Data
            MS->>Cache: set("quote:RELIANCE.NS", data, 180s)
            MS->>DB: MarketPriceHistory.create(...)
            MS-->>User: 200 OK { data, data_status: "LIVE", source: "AlphaVantage" }
        else AV Rate Limit / Timeout
            MS->>FH: fetchQuote("RELIANCE.NS")
            alt Finnhub Responds
                FH-->>MS: Fallback Quote Data
                MS->>Cache: set("quote:RELIANCE.NS", data, 180s)
                MS-->>User: 200 OK { data, data_status: "LIVE", source: "Finnhub" }
            else Both Providers Fail
                MS-->>User: 200 OK { points: [], data_status: "UNAVAILABLE", note: "No fabricated data" }
            end
        end
    end
```

### 3.4 Automated SMS Detection & Transaction Reconciliation Flow

```mermaid
sequenceDiagram
    autonumber
    participant Android as Android OS SMS Inbound
    participant NativeReceiver as Kotlin BroadcastReceiver (FinProSmsReceiver)
    participant Flutter as Flutter Riverpod Layer
    participant API as FinPro Node.js Backend
    participant DB as PostgreSQL Database
    actor User as Account Owner

    Android->>NativeReceiver: OnReceive(Telephony.SMS_RECEIVED)
    NativeReceiver->>NativeReceiver: Regex Match Bank Headers (HDFC, SBI, ICICI, AXIS)
    alt Non-Financial SMS
        NativeReceiver->>NativeReceiver: Discard (Zero processing)
    else Transactional Financial SMS
        NativeReceiver->>NativeReceiver: Extract Amount, Merchant, Acct Mask, Tx Type
        NativeReceiver->>NativeReceiver: Compute SHA-256 Hash of raw message
        NativeReceiver->>Flutter: MethodChannel.invokeMethod("onSmsDetected", payload)
        Flutter->>API: POST /api/v1/sms/pending { amount, merchant, hash, bankRef }
        API->>DB: PendingSmsTransaction.findUnique({ where: { rawMessageHash } })
        alt Duplicate Detected
            DB-->>API: Existing Record
            API-->>Flutter: 200 OK { isDuplicate: true, status: "IGNORED" }
        else New Transaction
            API->>DB: PendingSmsTransaction.create({ status: "PENDING", ... })
            DB-->>API: Created
            API-->>Flutter: 201 Created { pendingTransactionId }
            Flutter->>User: Push Alert: "₹1,450 spent at Swiggy detected. Confirm?"
            User->>Flutter: Tap "Approve & Categorize as Food"
            Flutter->>API: POST /api/v1/sms/confirm/:id { categoryId, accountId }
            API->>DB: $transaction [Create Transaction, Update Account Balance, Update Pending Status]
            DB-->>API: Transaction Committed
            API-->>Flutter: 200 OK { success: true }
        end
    end
```

---

## 4. Complete Entity-Relationship (ER) Diagrams

### 4.1 Master Entity-Relationship Diagram

```mermaid
erDiagram
    %% Core Authentication & Profile
    USER ||--o| PROFILE : "has"
    USER ||--o| FINANCIAL_PROFILE : "configures"
    USER ||--o| FINANCIAL_PLAN : "derives"
    USER ||--o{ REFRESH_TOKEN : "owns"
    USER ||--o{ FCM_TOKEN : "registers"
    USER ||--o{ MOBILE_DEVICE : "pairs"

    %% Financial Ledger
    USER ||--o{ FINANCIAL_ACCOUNT : "maintains"
    USER ||--o{ CATEGORY : "defines"
    USER ||--o{ TRANSACTION : "records"
    FINANCIAL_ACCOUNT ||--o{ TRANSACTION : "contains"
    CATEGORY ||--o{ TRANSACTION : "classifies"
    USER ||--o{ BUDGET : "allocates"
    CATEGORY ||--o{ BUDGET : "binds"
    USER ||--o{ PENDING_SMS_TRANSACTION : "queues"
    FINANCIAL_ACCOUNT ||--o{ PENDING_SMS_TRANSACTION : "links"

    %% Investments & Wealth
    USER ||--o| PORTFOLIO : "holds"
    PORTFOLIO ||--o{ INVESTMENT : "aggregates"
    USER ||--o{ MARKET_WATCHLIST : "monitors"
    USER ||--o{ GOAL : "targets"

    %% Liabilities & Obligations
    USER ||--o{ LOAN : "services"
    USER ||--o{ PAYMENT_CARD : "holds"
    USER ||--o{ INSURANCE_POLICY : "secures"
    USER ||--o{ SUBSCRIPTION : "pays"
    USER ||--o{ CALENDAR_EVENT : "schedules"
    USER ||--o{ FINANCIAL_TASK : "tracks"

    %% Intelligence & Health
    USER ||--o{ NOTIFICATION : "receives"
    USER ||--o{ CHAT_MESSAGE : "exchanges"
    USER ||--o{ AI_RECOMMENDATION : "gets"
    USER ||--o{ FINANCIAL_HEALTH_HISTORY : "tracks"
    USER ||--o{ CASH_FLOW_PREDICTION : "projects"
    USER ||--o{ EXPENSE_ANOMALY : "flags"
    USER ||--o{ RECEIPT_SCAN : "uploads"

    USER {
        string id PK
        string email UK
        string username UK
        string password
        string firstName
        string lastName
        string phone
        string googleId UK
        enum role
        boolean isPremium
        string currency
        string timezone
        datetime createdAt
        datetime updatedAt
    }

    PROFILE {
        string id PK
        string userId FK, UK
        datetime dateOfBirth
        string occupation
        string bio
    }

    FINANCIAL_PROFILE {
        string id PK
        string userId FK, UK
        int age
        decimal monthlySalary
        decimal otherMonthlyIncome
        decimal estimatedMonthlyExpenses
        decimal currentSavings
        decimal emergencyFund
        decimal totalDebt
        enum riskProfile
        enum budgetMethod
        boolean isOnboardingComplete
    }

    FINANCIAL_PLAN {
        string id PK
        string userId FK, UK
        decimal income
        decimal expenses
        decimal savingsTarget
        decimal emergencyFundTarget
        decimal investmentTarget
        decimal debtRepaymentTarget
        int financialHealthScore
        string budgetMethod
    }

    FINANCIAL_ACCOUNT {
        string id PK
        string userId FK
        string name
        string institution
        enum accountType
        string accountNumberMasked
        decimal balance
        string currency
        boolean isActive
    }

    CATEGORY {
        string id PK
        string userId FK
        string name
        enum categoryType
        string icon
        string color
        boolean isDefault
    }

    TRANSACTION {
        string id PK
        string userId FK
        string accountId FK
        string categoryId FK
        decimal amount
        enum transactionType
        string merchant
        string description
        date date
        string paymentMethod
        boolean isFraudSuspected
        string aiCategory
    }

    BUDGET {
        string id PK
        string userId FK
        string categoryId FK
        string categoryName
        decimal monthlyLimit
        int month
        int year
    }

    GOAL {
        string id PK
        string userId FK
        string name
        enum goalType
        decimal targetAmount
        decimal currentAmount
        date targetDate
        decimal monthlyContribution
        enum priority
        enum status
    }

    PORTFOLIO {
        string id PK
        string userId FK, UK
        decimal totalInvested
        decimal currentValue
    }

    INVESTMENT {
        string id PK
        string portfolioId FK
        string symbol
        string name
        enum assetType
        decimal quantity
        decimal averageBuyPrice
    }

    LOAN {
        string id PK
        string userId FK
        enum loanType
        string lenderName
        decimal principalAmount
        decimal interestRate
        int tenureMonths
        decimal emiAmount
        decimal outstandingBalance
        enum status
    }

    PAYMENT_CARD {
        string id PK
        string userId FK
        string cardNickname
        enum cardType
        string issuer
        string lastFourDigits
        decimal creditLimit
        decimal outstandingAmount
        int billingCycleDay
        date dueDate
    }

    INSURANCE_POLICY {
        string id PK
        string userId FK
        string policyName
        string insurer
        decimal coverageAmount
        decimal premium
        string premiumCycle
        date renewalDate
    }

    SUBSCRIPTION {
        string id PK
        string userId FK
        string serviceName
        decimal cost
        string billingCycle
        date nextBillingDate
    }

    CALENDAR_EVENT {
        string id PK
        string userId FK
        string title
        string eventType
        date eventDate
        decimal amount
        boolean isRecurring
    }

    PENDING_SMS_TRANSACTION {
        string id PK
        string userId FK
        string matchedAccountId FK
        decimal amount
        enum transactionType
        string merchant
        string suggestedCategory
        decimal confidence
        string status
        string rawMessageHash
        string bankReference
        datetime transactionDate
    }

    FINANCIAL_HEALTH_HISTORY {
        string id PK
        string userId FK
        int overallScore
        int savingsScore
        int debtScore
        int emergencyScore
        int investmentScore
        int cashFlowScore
        datetime createdAt
    }
```

### 4.2 Core Data Domains & Relational Mapping

1. **Authentication & Identity Domain:**
   - `User` forms the root anchor. Every operational entity holds a foreign key pointer `userId` with cascading deletion.
   - `RefreshToken` facilitates session security with programmatic revocation on logout.
   - `FcmToken` and `MobileDevice` map multi-device hardware registrations for push dispatch.

2. **Core Financial Ledger Domain:**
   - `FinancialAccount` stores account balances across Bank Accounts, Wallets, and Credit Cards.
   - `Transaction` logs granular movements. Double-entry consistency is maintained by updating `FinancialAccount.balance` atomically inside a Prisma transaction block.
   - `Category` provides income/expense categorization with system defaults and custom user tags.
   - `PendingSmsTransaction` acts as an automated staging queue for incoming native Android SMS data before ledger ingestion.

3. **Planning & Wealth Management Domain:**
   - `Budget` enforces limits uniquely identified by `[userId, categoryName, month, year]`.
   - `Goal` tracks capital accumulation against milestones (Emergency Fund, Home, Car, Education).
   - `Portfolio` aggregates positions in `Investment` records (Equities, Mutual Funds, Bullion, Crypto) with unique constraint on `[portfolioId, symbol]`.

4. **Debt & Obligations Domain:**
   - `Loan` tracks principal, interest rate, tenure, and monthly EMI burdens.
   - `Card` manages credit limits, billing dates, and interest-bearing balances.
   - `InsurancePolicy` monitors health, life, and asset coverage with renewal date indexing.
   - `Subscription` tracks recurring digital and household service liabilities.

### 4.3 Database Integrity, Cascades & Indexing Strategies
- **Exact Numeric Representation:** All currency figures are strictly typed as `Decimal(15, 2)` preventing IEEE 754 floating-point rounding inaccuracies. Fractional investment quantities use `Decimal(15, 6)`.
- **Referential Integrity Cascades:** `onDelete: Cascade` is applied to all parent-child associations stemming from `User`. If a user account is purged, all related records across all 26 tables are purged atomically.
- **High-Performance Compound Indexes:**
  - `transactions`: `@@index([userId, date])`, `@@index([userId, transactionType])`
  - `budgets`: `@@unique([userId, categoryName, month, year])`
  - `investments`: `@@unique([portfolioId, symbol])`
  - `calendar_events`: `@@index([userId, eventDate])`
  - `pending_sms_transactions`: `@@index([userId, rawMessageHash])`, `@@index([userId, bankReference])`

---

## 5. Comprehensive Gantt Charts & Development Lifecycle

### 5.1 Project Development Gantt Chart

```mermaid
gantt
    title FinPro Engineering Lifecycle & Deployment Roadmap
    dateFormat  YYYY-MM-DD
    axisFormat  %b %Y

    section Phase 1: Inception & Specs
    Problem Analysis & Indian Market Survey    :done, p1_1, 2024-07-01, 2024-07-20
    System Architecture & Tech Stack Selection :done, p1_2, 2024-07-21, 2024-08-10
    UI/UX Design Tokens & System Blueprint     :done, p1_3, 2024-08-11, 2024-08-31

    section Phase 2: DB & Core Backend
    Prisma 5.22 Schema & PostgreSQL 17 Setup   :done, p2_1, 2024-09-01, 2024-09-20
    Dual-Token JWT & Google OAuth Engine       :done, p2_2, 2024-09-21, 2024-10-10
    Accounts, Transactions & Budget Services   :done, p2_3, 2024-10-11, 2024-11-05

    section Phase 3: Market & AI Pipelines
    Zero-Fake Market Engine (Alpha Vantage/FX) :done, p3_1, 2024-11-06, 2024-11-30
    Gemini 2.5 AI Grounding & Rule Fallback    :done, p3_2, 2024-12-01, 2024-12-24
    10-Factor Health Score & Cash Flow Engine  :done, p3_3, 2024-12-25, 2025-01-15

    section Phase 4: Web SPA UI
    Vanilla JS Dashboard & ECharts Analytics   :done, p4_1, 2025-01-16, 2025-02-10
    Loans, Cards, Insurance & Calendar Modules :done, p4_2, 2025-02-11, 2025-03-05
    Voice Assistant & OCR Receipt Scanner      :done, p4_3, 2025-03-06, 2025-03-25

    section Phase 5: Flutter Mobile & SMS
    Flutter Cross-Platform Architecture Setup  :done, p5_1, 2025-03-26, 2025-04-15
    Riverpod State Layer & Screen Porting      :done, p5_2, 2025-04-16, 2025-05-10
    Kotlin Native BroadcastReceiver SMS Engine :done, p5_3, 2025-05-11, 2025-05-31
    Firebase Cloud Messaging (FCM) Integration :done, p5_4, 2025-06-01, 2025-06-20

    section Phase 6: QA, Hardening & Git
    Master Integration Testing (66/66 Passed)  :done, p6_1, 2025-06-21, 2025-07-05
    Security & Auth Audit (40/40 Passed)       :done, p6_2, 2025-07-06, 2025-07-20
    Mobile App UI Polish & Theme Consistency   :done, p6_3, 2025-07-21, 2025-08-05
    Git Remote Sync to tani1290/Finance_assistant :active, p6_4, 2025-08-06, 2025-08-15

    section Phase 7: Future Roadmap
    Account Aggregator (Setu / Finvu) Ingestion :future, p7_1, 2025-08-16, 2025-09-30
    Automated Mutual Fund CAS PDF Parser       :future, p7_2, 2025-10-01, 2025-11-15
    Collaborative Family Budgeting Workspace   :future, p7_3, 2025-11-16, 2025-12-31
```

### 5.2 Phase-by-Phase Milestone Breakdown

| Phase | Milestone | Key Deliverables | Status |
|---|---|---|---|
| **Phase 1** | Requirements & System Architecture | Problem definition, INR localization spec, tech stack selection, design system guidelines. | **Completed** |
| **Phase 2** | Database & Persistence Engine | PostgreSQL 17 setup, Prisma 5.22 schema with 26 models, compound indexes, dual-token JWT auth. | **Completed** |
| **Phase 3** | Market Data & Intelligence | Zero-Fake engine (Alpha Vantage, Finnhub, MCX Gold), multi-tier TTL cache, Gemini 2.5 grounded advisory, deterministic rule engine. | **Completed** |
| **Phase 4** | Web Single Page Application | Vanilla JS ES6 modules, CSS3 glassmorphism, ECharts financial visualisations, OCR receipt parser, voice commands. | **Completed** |
| **Phase 5** | Flutter Mobile & Android SMS Engine | Cross-platform Flutter 3.x app, Riverpod 2.x state management, Kotlin background SMS receiver channel, Firebase Cloud Messaging (FCM). | **Completed** |
| **Phase 6** | Quality Assurance & Git Release | 66/66 Integration tests, 40/40 Security tests, 6/6 Market tests, mobile theme unification, Git push to `tani1290`. | **Completed** |
| **Phase 7** | Future Horizon | RBI Account Aggregator protocol integration, automated NSDL/CDSL CAS statement ingestion, multi-member family budgets. | **Planned** |

### 5.3 QA Testing & Production Verification Gate

The platform has undergone rigorous automated testing across three dedicated suites:

```
========================================================================================
                          FINPRO MASTER TEST SUITE SUMMARY
========================================================================================
 Suite 1: Master Integration & Acceptance Suite (`run-all-tests.js`)
   - Health Check & DB Roundtrip Latency (< 5ms)               [PASSED - 4ms]
   - User Registration, Profile Creation & Account Provisioning [PASSED]
   - Transaction Recording & Atomic Balance Adjustment          [PASSED]
   - 50/30/20 Budget Exceeded Alerts                            [PASSED]
   - Loan EMI Schedule & Prepayment Amortization                [PASSED]
   - Cash Flow 30/90 Day Forecasting                            [PASSED]
   - CSV Stream-Based Export with Tenant Isolation              [PASSED]
   Total Tests: 66 | Passed: 66 | Failed: 0 | Execution Time: 4.82s

 Suite 2: Auth & Security Audit Suite (`test-auth-comprehensive.js`)
   - Duplicate Email Conflict (HTTP 409)                        [PASSED]
   - Invalid Password Rejection (HTTP 401)                      [PASSED]
   - Expired Access Token Rejection (HTTP 401)                  [PASSED]
   - Refresh Token Rotation & Session Invalidation              [PASSED]
   - Cross-Tenant Resource Isolation (HTTP 404 on Foreign User) [PASSED]
   - Global & Endpoint Rate Limiting Activation                 [PASSED]
   Total Tests: 40 | Passed: 40 | Failed: 0 | Execution Time: 3.12s

 Suite 3: Live Market Verification Suite (`test-market-live.js`)
   - NSE/BSE Equities Live Feed (RELIANCE.NS, TCS.NS)           [PASSED - LIVE]
   - COMEX Gold 24K / 22K INR Spot Pricing                      [PASSED - LIVE]
   - COMEX Silver 1kg INR Benchmark                             [PASSED - LIVE]
   - Interbank USD/INR FX Ingestion                             [PASSED - LIVE]
   - Multi-Tier TTL In-Memory Cache Verification                [PASSED - CACHED]
   - Zero Synthetic Sine Curve Assertion                        [PASSED - ZERO FAKE]
   Total Subsystems: 6 | Verified: 6 | Failed: 0 | Status: PASS
========================================================================================
```

---

## 6. Technology Stack Inventory & Deployment Architecture

### 6.1 Complete Technology Matrix
| Domain | Layer / Tool | Version | Responsibility |
|---|---|---|---|
| **Backend** | Node.js | v20+ LTS | Asynchronous non-blocking runtime |
| | Express.js | 4.21 | RESTful API server & routing |
| | Helmet | 8.0 | HTTP Security headers |
| | CORS | 2.8 | Origin filtering & credential permissions |
| | Express Rate Limit | 7.4 | Tiered DDoS & brute-force throttling |
| | Compression | 1.7 | High-performance gzip response payload compression |
| **Database** | PostgreSQL | 17 | Relational transactional ACID datastore |
| | Prisma ORM | 5.22 | Declarative schema, migrations, type-safe query client |
| **Web Frontend** | Vanilla JavaScript | ES6+ | Zero-overhead lightweight client logic |
| | CSS3 Design Tokens | Custom | Dark/light glassmorphic UI, responsive grid |
| | Apache ECharts | 5.5 | High-density interactive financial charts |
| | Remix Icons | 4.5 | Vector icon typography |
| **Mobile App** | Flutter / Dart | 3.x / 3.x | Cross-platform compiled native client |
| | Riverpod | 2.x | Compile-safe reactive state management |
| | Dio | 5.x | HTTP client with automatic JWT token interceptors |
| | Android Native | Kotlin | BroadcastReceiver for SMS transaction scraping |
| **Cloud & AI** | Google Gemini | 2.5 / 1.5 Flash | Grounded natural language advisory engine |
| | Firebase Admin | 12.x | Cloud Messaging (FCM) push notifications |
| | Alpha Vantage | API v1 | Indian equities & global commodity pricing |
| | Finnhub | API v1 | Secondary equities & foreign exchange rates |
| | Tesseract.js | 5.x | Client-side Optical Character Recognition (OCR) |

### 6.2 Deployment Artifacts & Procedures
- **Local Development:**
  ```bash
  # 1. Start PostgreSQL (finance_jinay on port 5432)
  # 2. Launch Node backend
  cd node-backend
  npm install
  npx prisma generate
  node src/server.js   # Listens on http://127.0.0.1:5001
  
  # 3. Launch Flutter Mobile (optional)
  cd ../mobile
  flutter pub get
  flutter run
  ```
- **Docker Compose:** Multi-container orchestration defined in [docker-compose.yml](file:///Volumes/Projects/Minor/Jinay%20Version/Fin_AI_Personal_Financial_Planner_AI_Final_Year_Project/docker-compose.yml) deploying Node.js Alpine and PostgreSQL 17 on an isolated bridge network.
- **Render Cloud:** Automated deployment blueprint via [render.yaml](file:///Volumes/Projects/Minor/Jinay%20Version/Fin_AI_Personal_Financial_Planner_AI_Final_Year_Project/render.yaml) targeting production web services.
- **Vercel:** Static web deployment with serverless proxy rules defined in [vercel.json](file:///Volumes/Projects/Minor/Jinay%20Version/Fin_AI_Personal_Financial_Planner_AI_Final_Year_Project/vercel.json).

---

*Authored for the FinPro Project repository (`tani1290/Finance_assistant`). All rights reserved.*
