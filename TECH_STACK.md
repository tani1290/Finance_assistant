# Technology Stack & Architecture

This document provides a comprehensive overview of the technologies, libraries, and external services used to build the **FinPro — Personal Finance & Investment Decision Support Platform**.

## 1. Backend Infrastructure

- **Node.js (v20+)**: The core JavaScript runtime used for the server, offering an event-driven, non-blocking I/O model.
- **Express.js (v4.21)**: A fast, unopinionated web framework for Node.js, used to build the RESTful API and serve static files.
- **Nodemon**: A utility that monitors for any changes in the source code and automatically restarts the server during development.
- **Security Middleware**: 
  - `helmet`: Helps secure Express apps by setting various HTTP headers.
  - `cors`: Provides Connect/Express middleware that can be used to enable CORS with various options.
  - `express-rate-limit`: Basic rate-limiting middleware to prevent brute-force attacks and DoS.

## 2. Database & ORM

- **PostgreSQL 17**: The primary relational database used to ensure ACID compliance, data integrity, and complex query support for financial transactions.
- **Prisma ORM (v5.22)**: A next-generation Node.js and TypeScript ORM. It provides a type-safe database client, automated migrations (`db push` / `migrate`), and a powerful data modeling language (`schema.prisma`).

## 3. Frontend Architecture

- **Vanilla JavaScript (ES6+)**: The frontend is built entirely using modern JavaScript features (Modules, Promises, async/await, Fetch API) without any heavy framework (like React or Angular) to ensure maximum speed and lightweight loading.
- **HTML5 & CSS3**: Utilizes custom CSS properties (variables), Flexbox, and Grid for a highly responsive, custom design system.
- **Single Page Application (SPA) Approach**: The UI is structured to load seamlessly using DOM manipulation and the History API, preventing full page reloads.

## 4. Authentication & Security

- **JSON Web Tokens (JWT)**: Used for stateless, secure user authentication (`jsonwebtoken`). Uses both short-lived Access Tokens and long-lived Refresh Tokens.
- **Bcrypt.js**: Used for securely hashing user passwords with salt (10 rounds) before storing them in the database.
- **Google OAuth 2.0**: Integrated for seamless single sign-on (SSO) capabilities.

## 5. Artificial Intelligence & Machine Learning

- **Google Gemini 1.5 Flash (`@google/generative-ai`)**: The core AI engine used to provide grounded, context-aware financial advice, 10-factor health scores, and dynamic what-if simulations based purely on the user's actual financial records.
- **Custom ML Engine**: Used in the legacy Django system for transaction categorization and regression testing.

## 6. External APIs & Market Data

- **Finnhub & Alpha Vantage**: Provides real-time market data, stock quotes, and historical charts for NSE/BSE and COMEX precious metals (Gold/Silver).
- **Marketaux API**: Delivers real-time global financial news and market sentiment analysis.
- **Exchange Rates**: Live interbank FX rates for USD to INR conversion.

## 7. Additional Tools & Integrations

- **Web Speech API**: Browser-native API used for the voice assistant, parsing spoken financial intents.
- **Tesseract OCR**: Used for reading and extracting data from uploaded receipts or invoices.
- **Docker & Docker Compose**: Containerization of the application and PostgreSQL database for isolated and reproducible deployments.
- **Jest & Supertest**: Frameworks used for comprehensive API testing and integration test suites.
- **GitHub Actions**: CI/CD pipeline automation for testing on every push.

---
*Maintained by Jinay Golecha & Students of VU.*
