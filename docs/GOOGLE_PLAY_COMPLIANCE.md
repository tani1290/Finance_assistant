# Google Play Code-Level Compliance — Phase 8

**Date:** 2026-10-26
**Repository:** `tani1290/Finance_assistant`
**Branch:** `finpro/pre-deployment-checkpoint`
**Baseline HEAD:** `97d5ae8560670f0857d3c746f242510eb1106da9` (Phase 7)
**Deployed backend:** `f6cdf9f` — health probes exempted from the general rate limiter (Phase 9 P0 fix), on top of `020a49d`/`574337d` (storage 404 passthrough); deployed 2026-10-26
**Deployed frontend:** `https://fin-pro-wheat.vercel.app`
**Android application ID:** `com.finpro.app.finpro_mobile`
**Status:** code-level work implemented, unit-tested and **deployed to production**.
The public legal pages and the deletion endpoint are live. **Still not Play-ready:**
production storage is non-durable, the database expires 2026-11-11, and no
physical-device run exists. Console declarations remain manual.

This document maps every Google Play requirement that has a code component to
the exact implementation and evidence. It does not claim Play approval. It does
not authorize a Play submission, a production deployment, a database migration,
or a purchase.

---

## 1. Scope and method

Only the public Google Play policy areas that Phase 7 targets are covered:

1. Public privacy policy.
2. Genuine account deletion (in-app and web).
3. SMS permission disclosure and consent.
4. Data Safety inputs.
5. Financial features and simulated payments.
6. Content rating and target audience.
7. Target API level, permissions, and packaging.

Rules applied while producing this report:

- Requirements were taken from current official Play documentation, not inferred
  from the manifest alone.
- A manifest permission is treated as a *declaration input*, not proof of data
  collection. Collection claims were verified in backend and mobile code.
- No legal entity, postal address, email address, retention period, or deletion
  capability was invented. The operator name and contact path are the verified
  ones already used by the project.
- No production user was deleted and no disposable data was written to
  production.
- Items that need Play Console work are marked **MANUAL ACTION REQUIRED**, not
  **PASS**.

### Status legend

| Status | Meaning |
|---|---|
| **PASS** | Verified in the working tree with code inspection and/or an automated test. |
| **FAIL** | A requirement is violated in the working tree. |
| **BLOCKED** | Cannot be completed without an owner decision, credentials, billing, or an external system. |
| **NOT TESTED** | Implementation exists but has no live/device/staging evidence yet. |
| **MANUAL ACTION REQUIRED** | Only a human in Play Console (or an equivalent console) can complete it. |

### Evidence types

| Type | Meaning |
|---|---|
| **Code** | Source change plus automated test or static inspection. |
| **Live** | Verified against a deployed endpoint or hosted page. |
| **Device** | Verified on a physical device or emulator. |
| **Manual** | Play Console / account-holder action. |

---

## 2. Requirement matrix

| ID | Requirement | Status | Type | Evidence | Remaining action | Owner | Official doc |
|---|---|---|---|---|---|---|---|
| PP-1 | A privacy policy is publicly reachable without sign-in | **PASS** | Live | `frontend/public/privacy.html` is deployed. `GET https://fin-pro-wheat.vercel.app/privacy.html` returns **200** signed out, with a viewport meta tag and effective date 2026-10-24. | None for the web URL; keep it in sync with the app. | Repo owner | [Privacy policy](https://support.google.com/googleplay/android-developer/answer/9859455) |
| PP-2 | Policy is linked in-app and on the store listing | **PASS** | Code | `mobile/lib/shared/widgets/legal_footer.dart` on login/register/onboarding; Settings → Legal & data → Privacy Policy; `mobile/lib/core/legal/legal_links.dart` holds the HTTPS URL. | Paste the same URL into the Play listing. | Repo owner | [Privacy policy](https://support.google.com/googleplay/android-developer/answer/9859455) |
| PP-3 | Policy states what is collected, why, how it is shared, retention, deletion, and contact | **PASS** | Code | `frontend/public/privacy.html` sections 2–10. Collection claims cross-checked against backend models and AI service. | Keep in sync with any future data change. | Repo owner | [User data](https://support.google.com/googleplay/android-developer/answer/10144311) |
| PP-4 | Policy discloses third-party AI processing | **PASS** | Code | `privacy.html` §4 names Google Gemini and the categories sent (name, email, message, conversation, financial snapshot, tool results). Backend uses `GEMINI_API_KEY`. | None. | Repo owner | [User data](https://support.google.com/googleplay/android-developer/answer/10144311) |
| PP-5 | Policy discloses that payments are simulated | **PASS** | Code | `privacy.html` §7; `docs/` payment simulator docs; server gates `PAYMENT_SIMULATOR_ENABLED` and `PAYMENT_SIMULATOR_ALLOW_PRODUCTION` are absent from `render.yaml`. | Declare "financial features" accurately in Console. | Repo owner | [Financial features](https://support.google.com/googleplay/android-developer/answer/13849271) |
| PP-6 | Policy is responsive and readable on mobile | **PASS** | Code | `frontend/public/assets/css/legal.css` defines a responsive single-column layout and viewport meta tag. | Spot-check on a phone after deploy. | Repo owner | [Privacy policy](https://support.google.com/googleplay/android-developer/answer/9859455) |
| AD-1 | Users can delete their account in the app | **PASS** | Code | Settings → Delete account → `mobile/lib/features/legal/delete_account_screen.dart` → `AuthNotifier.deleteAccount` → `DELETE /api/v1/auth/account`. | Verify on a device against the deployed API. | Repo owner | [Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111) |
| AD-2 | A public web resource lets users request deletion | **PASS** | Live | `https://fin-pro-wheat.vercel.app/delete-account.html` returns **200** signed out and explains both the in-app and web paths. The same authenticated endpoint was exercised against the live backend with a synthetic account: delete → `200 {deleted:true}`, old token → 401, login after delete → 401. The browser UI itself was not click-driven; the API contract it calls was verified live. | Optionally click through the page once in a browser before submission. | Repo owner | [Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111) |
| AD-3 | Deletion is genuine, not deactivation | **PASS** | Code | `authService.deleteAccount` issues `prisma.user.delete`; every user-owned relation is `onDelete: Cascade`; no soft-delete flag exists. | None. | Repo owner | [Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111) |
| AD-4 | Deletion removes uploaded files, not just database rows | **PASS** | Code | `storageService.deletePrefix('users/<id>/')` and `exports/<id>/` run before the row delete; prefixes are allowlisted. `storageProductionFailClosed.test.js` 6/6. | None. | Repo owner | [Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111) |
| AD-5 | Deletion is authenticated and scoped to the caller | **PASS** | Code | Route uses `authenticate`; user ID comes only from the token; no client-supplied user ID is accepted. `accountDeletion.test.js` 9/9. | None. | Repo owner | [Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111) |
| AD-6 | Password accounts re-verify before deletion | **PASS** | Code | `bcrypt.compare` against the stored hash; missing password → `PASSWORD_REQUIRED`; mismatch → `INVALID_CREDENTIALS` 401. | None. | Repo owner | [Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111) |
| AD-7 | Passwordless accounts cannot be deleted by a stale session | **PASS** | Code | Requires a valid access token plus the exact `DELETE` confirmation; the mobile client refreshes `/auth/me` first and opts out of 401 auto-refresh for the delete call. | None. | Repo owner | [Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111) |
| AD-8 | Partial failure does not silently half-delete | **PASS** | Code | Files are removed first; a storage failure returns 503 `PROVIDER_UNAVAILABLE` and the account row remains. Public and in-app copy now say files already removed cannot be restored. | None. | Repo owner | [Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111) |
| AD-9 | Retries are idempotent | **PASS** | Code | Concurrent `P2025` maps to `{ deleted: true, alreadyDeleted: true }`; test covers it. | None. | Repo owner | [Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111) |
| AD-10 | Deletion is rate-limited | **PASS** | Code | 5 requests/hour limiter on `DELETE /api/v1/auth/account` in `app.js`; 429 `ACCOUNT_DELETION_RATE_LIMITED`. | None. | Repo owner | [Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111) |
| SMS-1 | Only the minimum SMS permission is declared | **PASS** | Code | `AndroidManifest.xml` declares `RECEIVE_SMS` only; `READ_SMS` removed; receiver exported only with `BROADCAST_SMS`. | Declare the permission in Console. | Repo owner | [SMS policy](https://support.google.com/googleplay/android-developer/answer/10208820) |
| SMS-2 | Prominent disclosure precedes the runtime prompt | **PASS** | Code | `privacy_permissions_screen.dart` opens a blocking disclosure dialog; the OS prompt is only requested after "Agree & continue". `privacy_permissions_screen_test.dart` proves no `requestSmsPermission` call before consent. | None. | Repo owner | [SMS policy](https://support.google.com/googleplay/android-developer/answer/10208820) |
| SMS-3 | Consent is affirmative and off by default | **PASS** | Code | Switch starts off; native `ENABLED_KEY` defaults to `false`; consent stored as `unknown` until the user acts. | None. | Repo owner | [SMS policy](https://support.google.com/googleplay/android-developer/answer/10208820) |
| SMS-4 | Declining persists and is not re-prompted | **PASS** | Code | `SmsConsentStore` writes `declined`; screen shows "you previously declined"; no automatic dialog on entry. | None. | Repo owner | [SMS policy](https://support.google.com/googleplay/android-developer/answer/10208820) |
| SMS-5 | The app works without SMS access | **PASS** | Code | Manual entry, budgets, investments, and AI are independent of the receiver; UI states "FinPro works fully without SMS access"; denied-permission test stays usable. | None. | Repo owner | [SMS policy](https://support.google.com/googleplay/android-developer/answer/10208820) |
| SMS-6 | SMS content is minimised server-side | **PASS** | Code | Backend stores amount, merchant, sender, timestamp, and a one-way `rawMessageHash`; the full body is not persisted as a pending transaction. Receiver debug log no longer prints the body. | None. | Repo owner | [User data](https://support.google.com/googleplay/android-developer/answer/10144311) |
| SMS-7 | Permissions Declaration Form submitted | **MANUAL ACTION REQUIRED** | Manual | Not a code artifact. | Complete the SMS/`RECEIVE_SMS` declaration with the disclosure text and a demo video. | Repo owner | [Permissions declaration](https://support.google.com/googleplay/android-developer/answer/9888170) |
| DS-1 | Data Safety form matches actual collection | **MANUAL ACTION REQUIRED** | Manual | Section 6 below is the verified input list. | Enter each data type, purpose, sharing, encryption, and deletion answer in Console. | Repo owner | [Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469) |
| DS-2 | Data is encrypted in transit | **PASS** | Code | Production API base is HTTPS (`AppEnvironment.productionBaseUrl`); `vercel.json` proxies to the HTTPS Render host; no cleartext opt-in in the manifest. | Confirm no `usesCleartextTraffic="true"` appears in the merged manifest after rebuild. | Repo owner | [Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469) |
| DS-3 | Users can request deletion of their data | **PASS** | Code | See AD-1/AD-2. The Data Safety answer is "Yes" with the in-app path and the web URL. | Enter the URL in Console. | Repo owner | [Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469) |
| FIN-1 | Financial-feature declaration is accurate | **MANUAL ACTION REQUIRED** | Manual | The app is a personal finance tracker; payments are simulated and no real money moves. | Complete the Financial features declaration and keep the "simulated" wording. | Repo owner | [Financial features](https://support.google.com/googleplay/android-developer/answer/13849271) |
| FIN-2 | No real payment credential is collected | **PASS** | Code | Simulator only; policy warns users not to enter real card/UPI/bank credentials; no payment SDK is present. | None. | Repo owner | [Financial features](https://support.google.com/googleplay/android-developer/answer/13849271) |
| CR-1 | Content rating questionnaire completed | **MANUAL ACTION REQUIRED** | Manual | No code artifact. | Complete the IARC questionnaire; the app has no user-generated public content or gambling. | Repo owner | [Content rating](https://support.google.com/googleplay/android-developer/answer/9859655) |
| CR-2 | Target audience and children declaration | **MANUAL ACTION REQUIRED** | Manual | Policy states the app is not directed to under-18s. | Select the target age group and "not designed for children" in Console. | Repo owner | [Content rating](https://support.google.com/googleplay/android-developer/answer/9859655) |
| API-1 | Target API level meets the current requirement | **PASS** | Code | Rebuilt APK reports `targetSdkVersion='36'`, `compileSdkVersion='36'`, `minSdkVersion='24'`. | None. | Repo owner | [Target API](https://support.google.com/googleplay/android-developer/answer/11926878) |
| API-2 | Permissions are declared, not inferred | **PASS** | Code | Source manifest lists `INTERNET`, `ACCESS_NETWORK_STATE`, `POST_NOTIFICATIONS`, `RECEIVE_SMS`. The rebuilt APK's merged manifest adds `WAKE_LOCK`, `com.google.android.c2dm.permission.RECEIVE`, `com.google.android.gms.permission.AD_ID`, `ACCESS_ADSERVICES_ATTRIBUTION`, `ACCESS_ADSERVICES_AD_ID`, `BIND_GET_INSTALL_REFERRER_SERVICE`, `READ_GSERVICES`, and the app's own `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` from Firebase. No `READ_SMS`. | Declare the advertising ID / analytics collection in Data Safety and the Advertising ID section. | Repo owner | [Permissions declaration](https://support.google.com/googleplay/android-developer/answer/9888170) |
| PKG-1 | Release is signed with the release key, not debug | **PASS** | Code | Rebuilt APK v2 signature valid; signer `CN=FinPro, OU=FinPro Mobile, O=FinPro, L=Pune, ST=Maharashtra, C=IN`; certificate SHA-256 `5302c89b5c214d169d2affa1650103039f3d7ec1e5bc0aceb50b2f092c4e3d7a`; AAB `jar verified`. Phase 8 artifact SHA-256: APK `16b5516a0d225f506141bf5eac67e83ccc854448e9448b3c32c50e8282352187`, AAB `7b796a91ef0cadd73658be8957e4a97af9d05bf621fb7402dab4478108260753`. | Re-verify before upload; enroll in Play App Signing. | Repo owner | [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756) |
| PKG-2 | Play App Signing is enrolled | **MANUAL ACTION REQUIRED** | Manual | No Console access in this environment. | Enroll the app in Play App Signing and upload the AAB. | Repo owner | [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756) |
| PKG-3 | Backups do not exfiltrate financial data | **PASS** | Code | `android:allowBackup="false"` and `android:fullBackupContent="false"`. | Re-confirm on the rebuilt artifact. | Repo owner | [User data](https://support.google.com/googleplay/android-developer/answer/10144311) |
| PKG-4 | No debuggable release and no cleartext traffic | **PASS** | Code | Rebuilt APK manifest has no `debuggable` flag and no `usesCleartextTraffic` opt-in. | Re-confirm before upload. | Repo owner | [Target API](https://support.google.com/googleplay/android-developer/answer/11926878) |
| SEC-1 | No signing material, service-account key, or secret is tracked | **PASS** | Code | `mobile/android/key.properties` and `finpro-release.jks` are ignored; `google-services.json` is a client config, not a service-account key; no `.env` with values is tracked. | Re-scan the release tree before upload. | Repo owner | [User data](https://support.google.com/googleplay/android-developer/answer/10144311) |
| SEC-2 | Production storage is durable and private | **BLOCKED** | Live | Production health reports `storageProvider:"local"`, `durable:false`, `ephemeral:true`; uploads are lost on redeploy. The S3 code path is implemented and passed a 22-check harness against a local MinIO server (upload/download byte equality, cross-tenant denial, prefix isolation, restart persistence, outage fail-closed, fallback policy). No production bucket or credentials exist. | Provision durable private object storage, set `STORAGE_PROVIDER=s3` + `S3_*`, migrate existing files, re-check `/api/v1/health/storage` for `durable:true`. No code change required. | Repo owner | — |
| SEC-3 | Database does not expire before review | **BLOCKED** | Live | Render Postgres `finpro-db` is on the **free plan** and expires **2026-11-11T11:24:01Z**; Render deletes it and all data after a 14-day grace period (2026-11-25T11:24:01Z). Free Postgres has no backups. A verified encrypted backup + isolated restore exists (`BACKUP_DR.md` §13.1). The cheapest paid plan is `0.1c-256mb` at **$6/month**. | Owner must authorise the paid plan change (`render pg update finpro-db --plan 0.1c-256mb --confirm`) or a migration before 2026-11-11. Billing change. | Repo owner | — |
| TEST-1 | Device smoke test of the Phase 7 flows | **NOT TESTED** | Device | No device or emulator attached during this phase. | Install the signed APK and exercise privacy links, SMS consent, and deletion on a test account. | Repo owner | — |
| TEST-2 | Staging end-to-end deletion | **NOT TESTED** | Live | No staging environment exists. | Create a disposable staging account, delete it, and confirm cascade and storage cleanup. | Repo owner | — |
| TEST-3 | Read-only production smoke after deploy | **PASS** | Live | Phase 8 deploy verified: `/api/v1/health`, `/health/live`, `/health/dependencies`, `/health/ready`, `/health/database`, `/health/storage` all 200; legal pages 200; unauthenticated `DELETE /api/v1/auth/account` → 401; authenticated lifecycle, simulator gating, and idempotency smoke all passed with a synthetic account that was deleted afterwards. | Re-run after any redeploy; see §11. | Repo owner | — |

---

## 3. Privacy policy

### 3.1 Location and access

- Authoritative page: `frontend/public/privacy.html`.
- Production URL: `https://fin-pro-wheat.vercel.app/privacy.html`.
- The page is static, needs no session, and is not behind the API proxy.
- The app links to it from `LegalLinks.privacyPolicy` and shows a mirrored
  summary in `mobile/lib/features/legal/privacy_policy_screen.dart`.

### 3.2 Content verified against code

| Policy claim | Code evidence |
|---|---|
| Name, username, email, country, timezone, currency | `User` model and registration/profile endpoints. |
| bcrypt password hash, no plain-text password | `bcrypt.hash` on register; `password` never returned by `sanitizeUser`. |
| No Google sign-in | No Google auth route; no client ID flow. |
| No optional phone collection | No endpoint writes `User.phone`. |
| Financial records and user-created content | Prisma models and CRUD controllers. |
| Gemini receives name, email, message, history, snapshot, tool results | `aiService`/`aiTools` request construction. |
| SMS suggestion stores amount, merchant, sender, timestamp, hash | `pendingSms` persistence path. |
| Simulated payments only | Simulator routes and server flags. |
| Firebase Analytics/Crashlytics may collect usage, crash, installation ID, permitted ad identifiers | Firebase plugins in `pubspec.yaml`. |
| Cascade deletion of user-owned records | `onDelete: Cascade` across the schema. |
| No sale of personal data | No ad/analytics resale code path. |

### 3.3 Contact path

The policy uses the verified public issue tracker
`https://github.com/tani1290/Finance_assistant/issues` and the operator name
already used by the project. No email address or postal address was invented.

---

## 4. Account deletion

### 4.1 Backend contract

`DELETE /api/v1/auth/account` (authenticated):

Request body:

```json
{ "confirmation": "DELETE", "password": "current-password-if-any" }
```

Responses:

| Case | Status | Code |
|---|---|---|
| Deleted | 200 | `{ deleted: true, alreadyDeleted: false }` |
| Concurrent/retry | 200 | `{ deleted: true, alreadyDeleted: true }` |
| Missing confirmation | 400 | `CONFIRMATION_REQUIRED` |
| Password account without password | 400 | `PASSWORD_REQUIRED` |
| Wrong password | 401 | `INVALID_CREDENTIALS` |
| Unknown user | 401 | `USER_NOT_FOUND` |
| Storage cleanup failed | 503 | `PROVIDER_UNAVAILABLE` |
| Too many attempts | 429 | `ACCOUNT_DELETION_RATE_LIMITED` |

### 4.2 Order of operations

1. Validate the exact `DELETE` confirmation.
2. Load the user and, if a password hash exists, verify the password.
3. Delete `users/<userId>/` and `exports/<userId>/` from storage.
4. In one transaction, delete refresh tokens and the user row.
5. Let Prisma cascade every user-owned relation.
6. Treat a concurrent `P2025` as an idempotent success.

Files are removed before the row so a storage failure cannot leave orphaned
objects after the account is gone. The trade-off — some files may be removed
before a later failure — is disclosed in the policy and in both clients.

### 4.3 Client paths

- **Android:** Profile & Settings → Delete account. Requires an exact `DELETE`
  string, an acknowledgement checkbox, and the current password when the
  account has one. Refreshes `/auth/me` first, then calls the endpoint with
  automatic 401 refresh disabled so a wrong password does not destroy the
  session. On success it navigates to the public `/account-deleted` screen
  before clearing local credentials.
- **Web:** `/delete-account.html` requires sign-in, then calls the same
  endpoint with the same confirmation rules. The success state is shown while
  signed out.

### 4.4 What is deleted

Profile and account row, financial accounts, transactions, budgets, goals,
investments, loans, insurance policies, subscriptions, cards, calendar events,
tasks, notifications, AI conversations and recommendations, receipt scans,
exports, push tokens, device records, pending SMS suggestions, refresh sessions,
and account audit records. All are user-owned Prisma relations with cascade
delete.

### 4.5 Limits

- No audit record survives because `AuditLog.userId` is required and cascades.
- Infrastructure backups may retain copies until overwritten; the policy says
  so and commits not to use them to recreate an account.
- The web path needs a working sign-in. Users who cannot sign in are directed
  to the in-app path or the public support tracker.

---

## 5. SMS permission and disclosure

### 5.1 Declaration

- Permission: `android.permission.RECEIVE_SMS` only.
- `READ_SMS` was removed.
- Historical inbox scanning was removed; only new incoming messages are read
  while detection is enabled.
- The receiver is exported only with `android.permission.BROADCAST_SMS`.

### 5.2 Disclosure sequence

1. User opens Privacy & Permissions. Nothing is requested on entry.
2. The switch is off.
3. Tapping "Enable bank SMS detection" opens a non-dismissible dialog that
   explains what is read, what is sent, what is stored, and that the app works
   without it.
4. Only "Agree & continue" requests the Android permission.
5. "Not now" persists `declined` and does not call the permission API.
6. If Android denies the permission, the switch stays off and the app remains
   usable.
7. If the native preference write fails, the UI never claims detection is on.

### 5.3 Data handling

- Incoming SMS is filtered on-device for bank-like senders and OTP/promotional
  noise.
- Potentially relevant text is sent to the backend for parsing.
- The backend stores the proposed transaction, sender, timestamp, amount,
  merchant, and a one-way message hash. It does not persist the full body as a
  pending transaction.
- The user reviews every suggestion before it becomes a transaction.
- The full SMS body is no longer written to the debug log.

### 5.4 What remains manual

The Play Permissions Declaration Form and the Data Safety answers for SMS. The
form needs the disclosure text and a short demo video showing the disclosure
before the system prompt. This report does not substitute for that form.

---

## 6. Data Safety inputs

This is the verified input list for the Console form. It is not a submitted
declaration.

| Data type | Collected | Shared | Purpose | Optional | Deletion |
|---|---|---|---|---|---|
| Name | Yes | Gemini (AI requests) | Account, AI personalisation | No | Yes |
| Email | Yes | Gemini (AI requests) | Account, AI personalisation | No | Yes |
| User IDs | Yes | No | Account, sync | No | Yes |
| Passwords (hash) | Yes | No | Authentication | No | Yes |
| Financial info (accounts, transactions, budgets, goals, loans, insurance, investments) | Yes | Gemini (snapshot/tool results when AI is used) | App functionality | No | Yes |
| Messages (AI chat) | Yes | Gemini | AI functionality | Yes | Yes |
| Photos/files (receipts, exports) | Yes, user-initiated | No | App functionality | Yes | Yes |
| App activity / in-app actions | Yes | Firebase Analytics | Analytics | Yes (device settings) | Yes |
| Crash logs | Yes | Firebase Crashlytics | Diagnostics | Yes (device settings) | Yes |
| Device or other IDs (push token, installation ID, permitted ad ID) | Yes | Firebase | Push, analytics, diagnostics | Partly | Yes |
| SMS or MMS | Yes, optional | FinPro backend | Transaction suggestions | Yes | Yes |
| Contacts / location / health | No | — | — | — | — |

Notes for the form:

- Data is encrypted in transit.
- Users can request deletion in-app and on the web.
- The app does not sell data.
- The app does not connect to banks or move real money.
- Advertising identifiers are collected only through Firebase Analytics and only
  as permitted by device settings; the Play "Advertising ID" declaration must
  match that.

---

## 7. Financial features

- FinPro is a personal finance and investment **tracker and planner**.
- The "payment simulator" is synthetic. It never contacts a bank, UPI, card
  network, or payment processor.
- Server flags `PAYMENT_SIMULATOR_ENABLED` and
  `PAYMENT_SIMULATOR_ALLOW_PRODUCTION` must both be true to run it in
  production; neither is present in `render.yaml`.
- Simulator writes are server-authoritative, idempotent, and ledger-backed.
  Failed or pending payments never debit.
- The policy tells users not to enter real card numbers, UPI PINs, bank
  passwords, or other payment credentials.
- The Console Financial features declaration is still manual. The declaration
  must not describe the app as a money transmitter, lender, or broker.

---

## 8. Content rating and target audience

- No public user-generated content feed, chat with strangers, gambling, or
  mature content.
- AI output is advisory and requires confirmation before any data change.
- The policy states the app is not directed to children under 18.
- The IARC questionnaire and target-audience selection are manual.

---

## 9. Target API, permissions, and packaging

| Item | Value | Evidence |
|---|---|---|
| Application ID | `com.finpro.app.finpro_mobile` | `android/app/build.gradle.kts` |
| versionCode / versionName | 1 / 1.0.0 | `pubspec.yaml` (`1.0.0+1`) |
| minSdk | 24 | Rebuilt APK `aapt` output |
| compileSdk / targetSdk | 36 / 36 | Rebuilt APK `aapt` output |
| Source permissions | `INTERNET`, `ACCESS_NETWORK_STATE`, `POST_NOTIFICATIONS`, `RECEIVE_SMS` | `AndroidManifest.xml` |
| Merged permissions added by libraries | `WAKE_LOCK`, `c2dm.RECEIVE`, `AD_ID`, `ACCESS_ADSERVICES_ATTRIBUTION`, `ACCESS_ADSERVICES_AD_ID`, `BIND_GET_INSTALL_REFERRER_SERVICE`, `READ_GSERVICES`, app `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | Rebuilt APK `aapt dump permissions` |
| Backup | Disabled | `allowBackup=false`, `fullBackupContent=false` in the rebuilt APK |
| Cleartext | Not opted in | Rebuilt APK manifest |
| Debuggable | Absent in release | Rebuilt APK manifest |
| Signing | Release key, v2 | Rebuilt APK/apksigner + `jarsigner -verify` |

The merged manifest adds Firebase/analytics permissions, including
`com.google.android.gms.permission.AD_ID`. Data Safety and the Advertising ID
declaration must reflect that. `READ_SMS` is absent.

---

## 10. Security and secret hygiene

- HTTPS for all production API traffic.
- bcrypt password hashing; short-lived access tokens with rotating refresh
  tokens.
- Every financial record and file is scoped to the authenticated user.
- Storage prefixes are allowlisted and derived only from the token's user ID.
- Production storage fails closed instead of silently writing to ephemeral
  local disk.
- Signing material and `key.properties` are untracked and ignored.
- `google-services.json` is a client configuration file, not a service-account
  key.
- No `.env` file with real values is tracked.

---

## 11. Verification log

Commands run for this phase (all from the repository root unless noted):

```bash
# Flutter static analysis
cd mobile && flutter analyze

# Phase 7 targeted tests (8 files)
cd mobile && flutter test test/legal_links_test.dart test/sms_consent_test.dart \
  test/sms_platform_channel_test.dart test/external_link_test.dart \
  test/legal_footer_test.dart test/delete_account_screen_test.dart \
  test/privacy_permissions_screen_test.dart test/auth_route_guard_test.dart

# Full Flutter suite
cd mobile && flutter test

# Backend deletion and storage tests
cd node-backend && DATABASE_URL='postgresql://postgres@127.0.0.1:5432/finpro_sim_verify_20261024' \
  NODE_ENV=test npx jest --runInBand src/__tests__/accountDeletion.test.js \
  src/__tests__/storageProductionFailClosed.test.js

# Signed artifact inspection (after rebuild)
apksigner verify --print-certs <apk>
jarsigner -verify -verbose -certs <aab>
aapt dump badging <apk>
```

Recorded results:

| Check | Result |
|---|---|
| `flutter analyze` | No issues found |
| Phase 7 targeted Flutter tests | 49 passed, 0 failed |
| Full Flutter suite | 239 passed, 0 failed |
| `accountDeletion.test.js` | 9 passed, 0 failed |
| `storageProductionFailClosed.test.js` | 6 passed, 0 failed |
| Existing storage/health suites | 44 passed, 0 failed |
| Full backend Jest (Phase 8 tree, `020a49d`) | 35 suites, 572 tests passed |
| Acceptance suite | 166 passed, 0 failed |
| SMS/mobile suite | 41 passed, 0 failed |
| Cloud verification / failure suites | 29 / 17 passed, 0 failed |
| Transfer verifier | 62 passed, 0 failed |
| Deposit verifier | 32 passed, 0 failed |
| Storage/health suites after the 404 fix | 6 suites, 68 tests passed |
| Prisma migrations on disposable DB | 11 applied, schema up to date, no drift |
| Rebuilt AAB | `jar verified`; SHA-256 `7b796a91...60753` |
| Rebuilt APK | v2 signature valid; no debug; targetSdk 36; SHA-256 `16b5516a...52187` |

Live checks against the **Phase 8 production deploy** (`020a49d`). Read-only probes are
marked; the lifecycle, simulator, storage-404 and idempotency checks used a disposable
synthetic account and left no residue.

| Check | Result |
|---|---|
| `GET https://fin-pro-wheat.vercel.app/` | 200 |
| `GET /privacy.html`, `/terms.html`, `/delete-account.html` | 200; viewport meta; effective date 2026-10-24; internal links work |
| `GET /simulator.html` | 200 |
| `GET /api/v1/health`, `/health/live`, `/health/dependencies`, `/health/ready`, `/health/database`, `/health/storage` | 200; DB connected; `storageProvider:"local"`, `durable:false`, `ephemeral:true` |
| Unauthenticated simulator API | 401 |
| Unauthenticated `DELETE /api/v1/auth/account` | 401 (route exists; no longer 404) |
| Registration → `/auth/me` → delete (wrong confirmation 400, wrong password 401, correct 200) | PASS |
| Old token after deletion / login after deletion | 401 / 401 |
| Authenticated `/simulator/status` | `enabled:false`, `production:true`, `synthetic:true`, disabled reason present |
| `POST /simulator/seed` authenticated | 403 `SIMULATOR_DISABLED` |
| Transfer and deposit idempotency replays | Same transaction id, no double ledger effect |
| CORS preflight from both deployed origins | 204 with `access-control-allow-origin` |
| `GET /storage/file/.../<missing>` authenticated (disposable account) | 404 `File not found in storage` — provider 404 passed through, not a 503 |
| Production DB after cleanup | Baseline row counts restored; 0 test residue |

Note: bare `/health` and `/ready` return the SPA `index.html` (200), not health
JSON. The real probes are the `/api/v1/health/*` paths above.

The read-only probes did not create, modify, or delete production data. The
lifecycle/simulator/idempotency checks used synthetic accounts and were cleaned up.

---

## 12. Blockers and manual actions

### 12.1 Blockers that prevent a Play-ready claim

| Blocker | Impact | Needed decision |
|---|---|---|
| Render Postgres expires **2026-11-11** | The backend stops working after expiry; review could fail. | Owner must authorise a paid plan change or migration before that date. |
| Production storage is `local` | Uploaded files are not durable and are lost on redeploy. | Owner must provide durable private object storage credentials and approve the migration. No code change needed. |
| No physical-device evidence | SMS permission flow, external links and deletion UI are widget-tested only. | Owner must provide a test device or emulator, or accept the residual risk explicitly. |
| Manual frontend deploy | `vercel --prod` is not Git-integrated, so a push does not update the web app. | Owner must run the CLI deploy after frontend changes and verify the live host. |

### 12.2 Manual Play Console actions

1. Privacy policy URL.
2. Account deletion URL.
3. Data Safety form (use §6).
4. SMS Permissions Declaration with disclosure text and demo video.
5. Financial features declaration.
6. Content rating questionnaire.
7. Target audience and children declaration.
8. Advertising ID declaration.
9. Play App Signing enrollment.
10. Upload the signed AAB and complete the release review.

### 12.3 What this phase deliberately did not do

- It did not submit the app to Play.
- It did not create a Play Console listing.
- It did not upgrade or migrate the production database.
- It did not switch storage providers.
- It did not enable the production payment simulator.
- It did not delete a production account.
- It did not invent legal text, an address, an email, or a retention period.

---

## 13. Sign-off statement

The Phase 8 code and deploy satisfy the **code-level** and **live-reachability**
parts of the Play requirements listed above, with automated coverage for the privacy
links, SMS consent sequence, fail-closed channel behaviour, external-link safety, and
deletion validation, plus a live synthetic-account lifecycle check against the
deployed backend.

The app is **not** Play-ready while the blockers in §12.1 remain — durable storage,
the database expiry, and hardware verification. No statement of Play approval, policy
acceptance, or production readiness is made here.
