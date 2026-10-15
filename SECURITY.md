# 🔒 Security Policy — FinPro

## 1. Supported Versions

| Version | Supported          | Status |
| ------- | ------------------ | ------ |
| 1.0.x   | :white_check_mark: | Active release |
| < 1.0   | :x:                | Deprecated |

---

## 2. Reporting a Vulnerability

The FinPro engineering team takes security, user privacy, and PCI-DSS data hygiene seriously. If you discover a security vulnerability, please follow responsible disclosure practices:

1. **Do NOT open a public GitHub issue** with sensitive vulnerability details.
2. Email the project maintainer directly at **jinaygolecha.dev@gmail.com** (or open a private security advisory on GitHub).
3. Include:
   - Description of the vulnerability
   - Steps to reproduce or proof-of-concept
   - Potential impact
4. We aim to acknowledge reports within 48 hours and provide patches promptly.

---

## 3. Environment & Secret Hygiene

- **Never commit `.env` files, API keys, or database passwords** to the repository.
- Use `.env.example` templates with generic placeholders (`YOUR_PASSWORD`, `YOUR_API_KEY`).
- In production, set environment variables via secure container secrets, cloud environment dashboards, or secret managers.
- Rotate any credential that is accidentally disclosed immediately.

---

## 4. Authentication & Data Protection

- Passwords are encrypted using salted `bcrypt` hashing with a minimum of 10 salt rounds.
- Session tokens use cryptographically signed JSON Web Tokens (JWT) with separate access and refresh token lifecycles.
- All API routes enforce tenant-level data isolation via authenticated `req.user.id`.

---

## 5. Active Cybersecurity Controls & Defense-in-Depth

| Layer | Control / Mechanism | Protection Target |
| :--- | :--- | :--- |
| **HTTP Headers** | `X-Content-Type-Options: nosniff` | MIME-type sniffing attacks |
| **Frame Guard** | `X-Frame-Options: SAMEORIGIN` / CSP `frame-ancestors` | Clickjacking and UI redressing |
| **Content Security** | Strict CSP policy on Web SPA & static poster | Stored & Reflected Cross-Site Scripting (XSS) |
| **Browser Sandbox** | `Permissions-Policy` (camera, mic, geo blocked) | Malicious device API abuse |
| **Parameter Hygiene** | HTTP Parameter Pollution (HPP) defense | Query array confusion attacks |
| **Input Sanitization** | Recursive payload string & object sanitization | Injection of `<script>`, `<iframe>`, `javascript:` vectors |
| **Rate Limiting** | Tiered rate limiter (200 req/15m general, 100 req/15m auth) | DoS and brute-force credential stuffing |
| **Fingerprinting** | `X-Powered-By` disabled | Technology stack reconnaissance |
| **Transport Security** | HSTS (`Strict-Transport-Security`) in production | SSL/TLS downgrade attacks |

