# 🤝 Contributing to FinPro

Thank you for your interest in contributing to **FinPro** (Personal Finance & Investment Decision Support Platform, Created by Students of VU)! This document outlines guidelines, branch strategies, and workflows for contributors.

---

## 1. Code of Conduct

- Be respectful, constructive, and collaborative.
- Write clean, well-tested code that adheres to standard JavaScript/Node.js conventions.
- Never commit credentials, passwords, or live API keys.

---

## 2. Development Setup

### Prerequisites
- **Node.js**: v22 LTS (specified in `.nvmrc`)
- **PostgreSQL**: 17 (local or via Docker)
- **Git**

### Step-by-Step Local Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/jinaygolecha/Fin_AI_Personal_Financial_Planner_AI_Final_Year_Project.git
   cd Fin_AI_Personal_Financial_Planner_AI_Final_Year_Project
   ```

2. **Environment Configuration**:
   ```bash
   # Windows PowerShell
   Copy-Item .env.example .env

   # macOS / Linux
   cp .env.example .env
   ```

3. **Install Dependencies & Initialize Database**:
   ```bash
   npm run setup
   ```

4. **Seed Sample Data (Optional)**:
   ```bash
   npm run db:seed
   ```

5. **Start Development Server**:
   ```bash
   npm run dev
   ```
   Open `http://127.0.0.1:5001/` in your browser.

---

## 3. Branching & Commit Conventions

### Branch Strategy
- `main`: Canonical, production-ready branch.
- `develop`: Integration branch for upcoming releases.
- `feature/<feature-name>`: New feature branches.
- `fix/<issue-name>`: Bug fix branches.

### Conventional Commits
Use standard commit prefixes:
- `feat:` A new feature
- `fix:` A bug fix
- `docs:` Documentation updates
- `style:` Code style/formatting changes
- `refactor:` Code refactoring without behavioral change
- `test:` Adding or updating tests
- `chore:` Maintenance, package updates, CI/CD changes

---

## 4. Testing

Always run the full acceptance test suite before submitting a pull request:
```bash
npm test
```

All 47+ test assertions must pass with 0 failures.

---

## 5. Submitting Pull Requests

1. Fork the repository and create your branch from `main`.
2. Ensure all tests pass (`npm test`).
3. Commit with descriptive messages.
4. Push to your fork and submit a Pull Request to `main`.
5. Clearly describe the changes and link any related issues.
