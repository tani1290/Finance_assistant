# FinPro Design System Specification

## 1. Executive Summary & Design Philosophy
FinPro's design language balances **trust, computational elegance, and calm utility**. Finance applications frequently suffer from high visual friction, screaming alerts, and garish neon accents. FinPro avoids those anti-patterns in favor of a **deliberate, refined aesthetic** inspired by modern institutional wealth platforms and premier consumer fintech applications.

Key Design Tenets:
1. **Clarity First**: Information density without visual clutter. Key figures (net worth, cashflow, pending alerts) are prominently legible at a glance.
2. **Subtle Depth**: Content layers use soft card surfaces, 1px perimeter borders, and refined translucent fills rather than harsh shadows.
3. **Calm Palette**: Emerald primary accents signify growth and financial health without neon distraction.
4. **Platform Parity**: Web CSS variables map directly to Flutter Material 3 tokens.

---

## 2. Color Palette & Cross-Platform Token Mapping

| Token Name | Web CSS Variable | Hex / RGBA | Flutter `AppColors` Equivalent | Purpose |
|---|---|---|---|---|
| **Primary Base** | `--primary` | `#10b981` | `AppColors.primary` | Primary action buttons, positive indicators, active tabs |
| **Primary Light** | `--primary-light` | `#34d399` / `#ecfdf5` | `AppColors.primaryLight` | Accents on dark surfaces, badges, highlights |
| **Primary Dark** | `--primary-dark` | `#059669` | `AppColors.primaryDark` | Gradient endpoints, deep hover states |
| **Dark Background**| `--bg` (dark mode) | `#0a0f1d` | `AppColors.darkBg` | Mobile root scaffold & dark mode page background |
| **Dark Surface** | `--surface` (dark) | `#111827` | `AppColors.darkSurface` | Elevated cards, dialog backgrounds, bottom nav |
| **Dark Surface Elevated** | `--surface-2` (dark) | `#1f2937` | `AppColors.darkSurfaceElevated` | Sub-cards, input field fills, action chips |
| **Dark Border** | `--border` (dark) | `#1f293d` | `AppColors.darkBorder` | Perimeter card dividers, input borders (1px) |
| **Dark Text 1** | `--text` (dark) | `#f9fafb` | `AppColors.darkTextPrimary` | High-emphasis headers, balances, primary labels |
| **Dark Text 2** | `--muted` (dark) | `#9ca3af` | `AppColors.darkTextSecondary` | Subtitles, helper text, timestamps, labels |
| **Dark Text Muted**| `--muted-light` | `#6b7280` | `AppColors.darkTextMuted` | Placeholders, inactive icons, masked digits |
| **Income / Success** | `--success` | `#10b981` | `AppColors.income` | Credit transactions, positive ROI, on-budget status |
| **Expense / Danger** | `--danger` | `#ef4444` | `AppColors.expense` | Debit transactions, budget overrun, critical alerts |
| **Warning** | `--warning` | `#f59e0b` | `AppColors.warning` | Pending review alerts, loan prepayment caution |
| **Info / Transfer** | `--info` | `#3b82f6` | `AppColors.transfer` | Account-to-account transfers, cloud status probes |

---

## 3. Typography Scale & Hierarchy

FinPro utilizes **Inter** as its primary typeface across all web and mobile screens, supplemented by **Outfit** for landing headers and **JetBrains Mono** for masked account numbers and telemetry.

### Type Scale
- **Display 1**: 28px–32px, Weight 700 / Bold, Letter-spacing -0.02em (Net worth overview, splash title).
- **Heading 1**: 22px–24px, Weight 700 / Bold, Letter-spacing -0.01em (Page headers, screen titles).
- **Heading 2**: 18px–20px, Weight 600 / SemiBold (Section titles, modal headers).
- **Subheading**: 15px–16px, Weight 600 / Medium (Card headers, transaction titles).
- **Body Regular**: 14px, Weight 400 / Normal, Line-height 1.5 (General content, descriptions).
- **Body Medium**: 13px–14px, Weight 500 / Medium (Form labels, button text).
- **Caption / Meta**: 11px–12px, Weight 500 / Regular (Timestamps, categories, badge labels).
- **Monospace Metric**: Tabular numbers for financial balance strings with localized Rupee (`₹`) symbols.

---

## 4. Component Standards

### 4.1 Financial Cards
- **Corner Radius**: `16px` (`BorderRadius.circular(16)` in Flutter, `border-radius: 14px` in CSS).
- **Border**: 1px solid `AppColors.darkBorder` / `var(--border)`.
- **Background**: `AppColors.darkSurface` (`#111827`) with optional 12% primary tint gradient for hero cards.
- **Padding**: Uniform `16px` or `20px` internally.

### 4.2 Status Badges
Status indicators must pair color with shape/text for accessible identification:
- **Income / Confirmed**: Emerald green fill (`rgba(16, 185, 129, 0.15)`), solid green text (`#10b981`), `+₹...` prefix.
- **Expense / Debit**: Red fill (`rgba(239, 68, 68, 0.15)`), red text (`#ef4444`), `-₹...` prefix.
- **Pending Review**: Amber fill (`rgba(245, 158, 11, 0.15)`), amber text (`#f59e0b`), clock / alert icon.

### 4.3 Action Buttons
- **Primary Action**: Emerald gradient (`#10b981` to `#059669`), white text, bold 14px, subtle hover elevate (`-1px`).
- **Secondary Action**: Bordered button (`#1f2937` background, 1px border), secondary text color.
- **Danger Action**: Red ghost or filled button for candidate rejection and account deactivation.

---

## 5. Mobile & Android Considerations
- **Status Bar & Navigation Bar**: Dark immersive mode (`SystemUiOverlayStyle.dark`), system navigation bars blend into `AppColors.darkBg`.
- **Bottom Navigation**: 5 canonical tabs (Dashboard, Transactions, SMS Inbox, AI Advisor, Settings). Active items display emerald glow pill with high-contrast icon.
- **Haptics**: Subtle haptic feedback (`HapticFeedback.lightImpact()`) on confirming or rejecting pending transactions.
