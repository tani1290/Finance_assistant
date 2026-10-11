import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE

def create_deck():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    # Color Palette
    PAPER = RGBColor(250, 246, 239)
    INK = RGBColor(24, 34, 48)
    TEAL = RGBColor(13, 125, 124)
    TERRA = RGBColor(216, 93, 38)
    WHITE = RGBColor(255, 253, 248)
    INK_SOFT = RGBColor(71, 84, 103)
    CARD_BG = RGBColor(243, 237, 225)
    DARK_CARD = RGBColor(15, 23, 42)

    blank_layout = prs.slide_layouts[6]

    def add_bg(slide, color=PAPER):
        bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
        bg.fill.solid()
        bg.fill.fore_color.rgb = color
        bg.line.color.rgb = color
        return bg

    def add_header(slide, slide_num, category, title, dark=False):
        txBox = slide.shapes.add_textbox(Inches(0.8), Inches(0.4), Inches(11.7), Inches(0.4))
        tf = txBox.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = f"{slide_num:02d} — {category.upper()}"
        p.font.size = Pt(11)
        p.font.bold = True
        p.font.color.rgb = TEAL if not dark else RGBColor(127, 209, 207)

        txBox2 = slide.shapes.add_textbox(Inches(0.8), Inches(0.75), Inches(11.7), Inches(0.8))
        tf2 = txBox2.text_frame
        tf2.word_wrap = True
        p2 = tf2.paragraphs[0]
        p2.text = title
        p2.font.size = Pt(24)
        p2.font.bold = True
        p2.font.color.rgb = INK if not dark else WHITE

    def add_card(slide, left, top, width, height, bg_color=CARD_BG, border_color=None):
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
        card.fill.solid()
        card.fill.fore_color.rgb = bg_color
        if border_color:
            card.line.color.rgb = border_color
            card.line.width = Pt(1.5)
        else:
            card.line.color.rgb = bg_color
        return card

    # ==================== SLIDE 1: TITLE ====================
    slide1 = prs.slides.add_slide(blank_layout)
    add_bg(slide1, INK)

    tb = slide1.shapes.add_textbox(Inches(1.0), Inches(1.2), Inches(11.3), Inches(2.2))
    tf = tb.text_frame
    tf.word_wrap = True
    
    p = tf.paragraphs[0]
    p.text = "FinPro: AI-Powered Personal Financial Planner"
    p.font.size = Pt(36)
    p.font.bold = True
    p.font.color.rgb = WHITE

    p2 = tf.add_paragraph()
    p2.text = "Grounded Financial Intelligence, Real-Time Market Integration & Robo-Advisory for Indian Retail Investors"
    p2.font.size = Pt(18)
    p2.font.color.rgb = RGBColor(127, 209, 207)
    p2.space_before = Pt(12)

    add_card(slide1, Inches(1.0), Inches(3.8), Inches(11.333), Inches(2.8), bg_color=DARK_CARD, border_color=TEAL)
    tb_team = slide1.shapes.add_textbox(Inches(1.2), Inches(4.0), Inches(10.9), Inches(2.4))
    tf_team = tb_team.text_frame
    tf_team.word_wrap = True

    p = tf_team.paragraphs[0]
    p.text = "PROJECT TEAM & ROLL NUMBERS (ACADEMIC YEAR 2026–2027)"
    p.font.size = Pt(12)
    p.font.bold = True
    p.font.color.rgb = TERRA

    members = [
        "31232127 — Tanishq Agrawal",
        "31230035 — Jinay Golecha",
        "31232021 — Partha Nallelu",
        "31231521 — Diksha Choraghe",
        "31231787 — Parth Hande"
    ]
    for m in members:
        p = tf_team.add_paragraph()
        p.text = f"• {m}"
        p.font.size = Pt(13)
        p.font.color.rgb = WHITE
        p.space_before = Pt(4)

    # ==================== SLIDE 2: PROBLEM ====================
    slide2 = prs.slides.add_slide(blank_layout)
    add_bg(slide2)
    add_header(slide2, 2, "Problem Statement & Context", "The Triple Crisis in Retail Financial Decision Making")

    stats = [
        ("100M+ Demat Accounts", "Massive retail participant influx into Indian markets post-2020.", TEAL),
        ("76% Illiteracy Rate", "SEBI & RBI surveys reveal acute gaps in risk & debt management.", TERRA),
        ("Zero Unified OS", "Investments, loans, and budgets remain siloed in fragmented apps.", INK)
    ]
    for i, (st, desc, col) in enumerate(stats):
        left = Inches(0.8 + i * 3.9)
        add_card(slide2, left, Inches(1.8), Inches(3.7), Inches(2.2), bg_color=WHITE, border_color=col)
        tb = slide2.shapes.add_textbox(left + Inches(0.2), Inches(2.0), Inches(3.3), Inches(1.8))
        tf = tb.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = st
        p.font.size = Pt(20)
        p.font.bold = True
        p.font.color.rgb = col
        p2 = tf.add_paragraph()
        p2.text = desc
        p2.font.size = Pt(13)
        p2.font.color.rgb = INK_SOFT
        p2.space_before = Pt(8)

    add_card(slide2, Inches(0.8), Inches(4.3), Inches(5.7), Inches(2.6), bg_color=CARD_BG, border_color=TERRA)
    tb1 = slide2.shapes.add_textbox(Inches(1.0), Inches(4.5), Inches(5.3), Inches(2.2))
    tf1 = tb1.text_frame
    tf1.word_wrap = True
    p = tf1.paragraphs[0]
    p.text = "❌ Existing Tooling Pitfalls"
    p.font.bold = True
    p.font.size = Pt(15)
    p.font.color.rgb = TERRA
    for text in ["Western bias (401k, USD equities)", "Generic LLMs hallucinate numbers", "Opaque black-box risk scores"]:
        p = tf1.add_paragraph()
        p.text = f"• {text}"
        p.font.size = Pt(13)
        p.font.color.rgb = INK

    add_card(slide2, Inches(6.8), Inches(4.3), Inches(5.7), Inches(2.6), bg_color=WHITE, border_color=TEAL)
    tb2 = slide2.shapes.add_textbox(Inches(7.0), Inches(4.5), Inches(5.3), Inches(2.2))
    tf2 = tb2.text_frame
    tf2.word_wrap = True
    p = tf2.paragraphs[0]
    p.text = "✔ FinPro Grounded Solution"
    p.font.bold = True
    p.font.size = Pt(15)
    p.font.color.rgb = TEAL
    for text in ["India-native (NSE/BSE, MCX Gold, INR)", "Gemini Flash grounded strictly in ledger", "Transparent 10-Factor Health Engine"]:
        p = tf2.add_paragraph()
        p.text = f"• {text}"
        p.font.size = Pt(13)
        p.font.color.rgb = INK

    def create_content_slide(num, cat, title, items, subtitle=""):
        s = prs.slides.add_slide(blank_layout)
        add_bg(s)
        add_header(s, num, cat, title)
        
        y = Inches(1.8)
        if subtitle:
            tb_sub = s.shapes.add_textbox(Inches(0.8), Inches(1.5), Inches(11.7), Inches(0.4))
            tf_sub = tb_sub.text_frame
            p = tf_sub.paragraphs[0]
            p.text = subtitle
            p.font.size = Pt(14)
            p.font.color.rgb = INK_SOFT
            y = Inches(2.0)

        for heading, bullets in items:
            add_card(s, Inches(0.8), y, Inches(11.733), Inches(1.1 + len(bullets)*0.35), bg_color=WHITE, border_color=TEAL)
            tb = s.shapes.add_textbox(Inches(1.0), y + Inches(0.15), Inches(11.333), Inches(0.8 + len(bullets)*0.35))
            tf = tb.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            p.text = heading
            p.font.bold = True
            p.font.size = Pt(16)
            p.font.color.rgb = TEAL
            
            for b in bullets:
                p_b = tf.add_paragraph()
                p_b.text = f"• {b}"
                p_b.font.size = Pt(13)
                p_b.font.color.rgb = INK
                p_b.space_before = Pt(3)
            
            y += Inches(1.3 + len(bullets)*0.35)
        return s

    # Slide 3: Lit Survey
    create_content_slide(3, "Academic Foundation", "Literature Survey: 22 Papers Across 5 Core Domains", [
        ("Domain 1: Financial LLMs & NLP (6 Papers, 27%)", ["BloombergGPT (50B), FinGPT (LoRA), MarketSenseAI (GPT-4 Alpha), Du et al."]),
        ("Domain 2: Stock Market Prediction (4 Papers, 18%)", ["Gu et al. (Charting by Machines, JFE), Wang et al. (Two-Stage LSTM+Mean-CVaR, ESWA)"]),
        ("Domain 3 & 4: Robo-Advisory & Cloud Security (8 Papers, 36%)", ["Rossi & Utkus (Vanguard empirical study, JFE), Rai & Thakkar (IEEE SCOReD), Banerjee (SEM India)"])
    ])

    # Slide 4: Key Insights
    create_content_slide(4, "Key Literature Insights", "Empirical Findings That Shape FinPro's Architecture", [
        ("Grounded RAG vs. 50B Pretraining (FinGPT, Yang et al.)", ["LoRA fine-tuning & ledger-injected RAG match 50B domain model accuracy at <1% training cost."]),
        ("Novice Welfare Gains (Rossi & Utkus 2024, Vanguard)", ["Robo-advisory provides the highest Sharpe ratio enhancement for previously unhedged novice retail investors."]),
        ("Indian Adoption Determinants (Banerjee 2025, SEM N=387)", ["Technology readiness & financial literacy drive adoption; solved via transparent factor scoring and educational tooltips."])
    ])

    # Slide 5: Research Gaps
    create_content_slide(5, "Critical Research Gaps", "8 Systematic Gaps Identified Across Current Literature", [
        ("Gap 1 (Critical): Absence of End-to-End Retail OS", ["Literature discusses NLP, prediction, and robo-advisory in silos. FinPro is the first complete unified OS."]),
        ("Gap 2 (High): Underrepresentation of Indian Market Mechanics", ["Existing tools omit NSE/BSE stocks, MCX 24K/22K Gold, Silver in INR, SIPs, and Lakhs/Crores math."]),
        ("Gap 3 & 7: Explainability & Cybersecurity Deficit", ["FinPro replaces opaque scores with a transparent 10-factor model, JWT auth, and strict multi-tenant isolation."])
    ])

    # Slide 6: Architecture Layer Stack
    create_content_slide(6, "Layered Architecture", "4-Tier Full-Stack Production Architecture", [
        ("Tier 1 & 2: Presentation & Gateway Security", ["Vanilla JS Single Page Application (sub-100ms load) + Node.js 22 LTS Express API Gateway with Helmet & JWT."]),
        ("Tier 3 & 4: Business Logic & Relational Persistence", ["Google Gemini Flash (Context RAG) + Financial Twin Engine + PostgreSQL 17 DB with 28 Prisma models."])
    ])

    # Slide 7: Layer-Wise Architecture (NEW)
    create_content_slide(7, "Layer-Wise Architecture", "4-Tier Layer-Wise Software Architecture & Data Flow", [
        ("Layer 1 · Presentation & Layer 2 · Gateway Security", ["Vanilla JS ES6+ SPA (Apache ECharts, Voice & OCR Vision) ➔ Node.js 22 Express API Gateway (Dual JWT HS256, Helmet, Rate Limiter)."]),
        ("Layer 3 · Business AI Logic & Layer 4 · Data Persistence", ["Financial Twin Engine (10-Factor Health + Predictor) + Gemini 1.5 Flash Grounded RAG ➔ PostgreSQL 17 DB (28 Prisma Models, Decimal precision, Docker cloud)."])
    ])

    # Slide 8: Project Planning & Gantt Chart (Updated from image)
    create_content_slide(8, "Project Planning", "FINPRO — Project Gantt Chart (Jul – Dec 2026)", [
        ("Structured 6-Phase Development Schedule & Status", [
            "1. Requirement & Literature Study (July 2026): COMPLETED [Weeks 1–4]",
            "2. System & Cloud Architecture (July–August 2026): COMPLETED [Weeks 3–8]",
            "3. Full-Stack Application Development (August–September 2026): IN PROGRESS [Weeks 5–11]",
            "4. AI, Finance & Data Features (September–October 2026): IN PROGRESS [Weeks 9–15]",
            "5. Cloud Deployment, CI/CD & Testing (October–November 2026): NOT STARTED [Weeks 13–20]",
            "6. Final Testing, Docs & Presentation (December 2026): NOT STARTED [Weeks 21–24]"
        ]),
        ("Project Stack & Team Responsibilities (Today: 11 Sep 2026)", [
            "Stack: Node.js • Express • PostgreSQL • Prisma • Docker • GCP Cloud Run • GitHub Actions",
            "Team: Tanishq Agrawal (AI), Jinay Golecha (Twin), Partha Nallelu (DB), Diksha Choraghe (UI), Parth Hande (Feeds)"
        ])
    ])

    # Slide 9: Feasibility Analysis (NEW)
    create_content_slide(9, "Feasibility Assessment", "4-Pillar Engineering Feasibility Assessment", [
        ("Technical & Economic Feasibility (98% / 95%)", [
            "Technical: Node.js 22 LTS, PostgreSQL 17, Prisma ORM, Gemini 1.5 Flash RAG, OCR & Web Speech APIs.",
            "Economic: GCP Cloud Run serverless scale-to-zero container hosting ($0 idle cost) + ~$0.0001 per AI query."
        ]),
        ("Operational, Legal & Security Feasibility (96% / 94%)", [
            "Operational: Hands-free voice logs, OCR receipt scanning & SMS parsing for low-friction adoption.",
            "Legal & Security: AES-256 encryption, strict tenant isolation, SEBI non-fiduciary disclaimers & 66/66 Jest tests."
        ])
    ])

    # Slide 10: Cloud Infrastructure
    create_content_slide(10, "Cloud Infrastructure", "Cloud-Native Infrastructure & Serverless Containers", [
        ("Docker Containerization & Multi-Stage Alpine Builds", ["Immutable node:22-alpine Docker containers (180MB footprint) for zero environment drift."]),
        ("Serverless Auto-Scaling (GCP Cloud Run / AWS ECS)", ["Scales automatically from 0 to 100+ container instances during volatility spikes with zero idle cost."]),
        ("Managed Cloud Database-as-a-Service (DBaaS)", ["PostgreSQL 17 on Supabase / Cloud SQL with SSL connection pooling, automated backups & point-in-time recovery."])
    ])

    # Slide 11: Cloud DevOps
    create_content_slide(11, "Cloud DevOps & Storage", "Cloud Object Storage, AIaaS & Automated CI/CD", [
        ("Cloud Object Storage (AWS S3 / GCP Cloud Storage)", ["Receipt images for Tesseract OCR stored in encrypted cloud buckets using 15-min pre-signed temporary URLs."]),
        ("Cloud AI Inference (Google Cloud Vertex AI)", ["Low-latency Gemini Flash REST/gRPC endpoints with strict JSON Schema output enforcement."]),
        ("Automated GitHub Actions CI/CD Pipeline", [".github/workflows/deploy.yml runs secret audits, Jest tests, Docker build & zero-downtime cloud deploy."])
    ])

    # Slide 12: Financial Twin
    create_content_slide(12, "Core Innovation", "The Financial Twin Engine & 10-Factor Health Score", [
        ("10-Factor Algorithmic Health Engine (0–100 Scale)", ["Computes Savings Rate, Emergency Runway (6m), DTI (<35%), Goal Velocity, Credit Utilization & Anomaly Frequency."]),
        ("30 & 90-Day Cash Flow Predictor & What-If Simulator", ["Forecasts future bank balances and models SIP compounding across 8%, 12%, and 15% growth regimes."])
    ])

    # Slide 13: Grounded AI Advisory
    create_content_slide(13, "AI Advisory Engine", "Audited Context RAG vs. Dangerous Hallucinations", [
        ("Audited Ledger Injection (Gemini Flash RAG)", ["Prepends verified Net Worth, Liquid Cash, Monthly Burn, DTI, and 10-Factor Score directly into prompt context."]),
        ("Factual System Guardrails & Deterministic Fallback", ["Gemini forbidden from inventing numbers outside injected JSON. Fallback rule engine fires if quotas exhausted."])
    ])

    # Slide 14: Market Feeds
    create_content_slide(14, "Market Intelligence", "Real-Time Equity & Commodity Feed Engine", [
        ("NSE/BSE Equities & Precious Metals in INR", ["Live quotes via Alpha Vantage + Finnhub; COMEX continuous Gold (GC=F) & Silver spot converted dynamically to INR/g."]),
        ("Zero Synthetic Data & Sub-Second Cache Map", ["Explicit provider status (LIVE/CACHED/STALE). 3-min TTL for quotes, 15-min for charts prevents rate-limit exhaustion."])
    ])

    # Slide 15: Multimodal Features
    create_content_slide(15, "Multimodal Features", "Frictionless Ingestion Across Five Modalities", [
        ("Web Speech Voice & Tesseract OCR Receipt Ingestion", ["Spoken expense logging & receipt image scanning with mandatory safety confirmation modals."]),
        ("50/30/20 Budgets & PCI-Compliant Credit Card Tracking", ["Needs/Wants/Savings splits + masked card management (•••• 4321) with zero full PAN or CVV storage."])
    ])

    # Slide 16: User Journey
    create_content_slide(16, "User Journey Walkthrough", "5-Step Workflow from Ingestion to Financial Freedom", [
        ("Step 1 & 2: Onboarding & Multi-Modal Ingestion", ["3-step baseline survey establishes DTI; voice, OCR, or atomic bank sync ingests transactions."]),
        ("Step 3, 4 & 5: Evaluation, Cash Flow Prediction & AI Advice", ["Financial Twin scores metrics, cash flow predictor models upcoming debits, and Gemini Flash provides fiduciary advice."])
    ])

    # Slide 17: Conclusion & Roadmap
    create_content_slide(17, "Conclusion & Roadmap", "Prototype Ready Today, Evolving Tomorrow", [
        ("Current Production Status", ["Prototype-ready full-stack system with Node.js 22 LTS, PostgreSQL 17, Gemini Flash & Docker containerization."]),
        ("Future Roadmap & Frontiers", ["Automated Bank SMS / Text Message Parser, Multilingual Support (Hindi, Marathi, Gujarati) & SEBI Sandbox Testing."])
    ])

    prs.save("/Volumes/Projects/Minor/Jinay Version/Fin_AI_Personal_Financial_Planner_AI_Final_Year_Project/lit_Survey/FinPro_AI_Financial_Planner_Deck.pptx")
    print("Successfully generated 17-slide PowerPoint deck: FinPro_AI_Financial_Planner_Deck.pptx")

if __name__ == "__main__":
    create_deck()
