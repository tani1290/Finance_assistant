# Artificial Intelligence in Personal Financial Planning: A Comprehensive Literature Survey

> **Draft Version 1.0** — September 2026  
> *[Author Names] · [Institution Name] · [Department]*  
> *Final Year Project — AI-Powered Personal Financial Planner*

---

## Abstract

The convergence of artificial intelligence (AI), machine learning (ML), and large language models (LLMs) with personal finance has emerged as one of the most transformative developments in financial technology over the past decade. This paper presents a comprehensive literature survey synthesising **22 seminal and recent research works** spanning the period 2023–2026, covering five interconnected domains: (1) large language models and natural language processing applied to financial data, (2) stock market prediction using AI/ML techniques, (3) robo-advisory systems and automated portfolio management, (4) cloud computing infrastructure for financial AI deployments, and (5) algorithmic trading and its market implications.

Through systematic analysis of peer-reviewed articles sourced from leading venues including *arXiv*, *Journal of Financial Economics*, *Expert Systems with Applications*, *Journal of Business Research*, and IEEE conferences, this survey identifies critical research gaps including the lack of integrated, end-to-end AI financial assistant systems tailored for retail investors in emerging markets (particularly India), insufficient explainability in AI-driven financial decisions, underexplored multimodal financial data fusion, and limited longitudinal validation of robo-advisory outcomes. The survey further proposes a unified conceptual framework for the development of a *FinAI Personal Financial Planner* that bridges LLM-based conversational intelligence with predictive analytics, portfolio optimisation, and cloud-native deployment.

**Keywords:** Artificial Intelligence, Personal Financial Planning, Large Language Models, Robo-Advisors, Stock Market Prediction, Portfolio Management, FinTech, Natural Language Processing, Machine Learning, Cloud Computing

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Scope and Methodology of Review](#2-scope-and-methodology)
3. [Literature Review](#3-literature-review)
   - 3.1 Large Language Models in Finance
   - 3.2 NLP Applications in Financial Decision Support
   - 3.3 Stock Market Prediction with AI/ML
   - 3.4 Portfolio Optimisation and AI-Powered Asset Management
   - 3.5 Robo-Advisory Systems: Technology, Adoption, and Impact
   - 3.6 Cloud Computing Infrastructure for Financial AI
   - 3.7 Algorithmic and High-Frequency Trading
4. [Comparative Analysis and Synthesis](#4-comparative-analysis)
5. [Research Gaps](#5-research-gaps)
6. [Summary](#6-summary)
7. [Conclusion](#7-conclusion)
8. [References](#8-references)

---

## 1. Introduction

The global personal finance management landscape is undergoing a paradigm shift. Traditional financial advisory services — predominantly delivered through human financial planners and static financial tools — are being rapidly supplemented, and in some cases replaced, by AI-powered systems capable of processing vast volumes of structured and unstructured financial data, generating personalised recommendations, and interacting with users in natural language [1][4]. The proliferation of smartphones, cloud computing, open financial data APIs, and increasingly capable foundation models has lowered the technical barriers for building sophisticated personal financial intelligence systems accessible to retail investors worldwide.

Global assets under management (AUM) by robo-advisory platforms reached an estimated **USD 1.8 trillion in 2023**, projected to exceed **USD 6 trillion by 2027** (Statista, 2024). Simultaneously, the integration of large language models (LLMs) such as GPT-4, BloombergGPT, and FinGPT into financial workflows has opened entirely new avenues for financial text analysis, conversational advisory, automated reporting, and investment signal generation [1][2][3]. The Indian financial market, in particular, presents a significant opportunity: with over 100 million demat account holders as of 2024 and growing retail investor participation, there exists a pressing need for accessible, intelligent, and personalised financial guidance systems calibrated for the Indian investment ecosystem [19].

Despite this momentum, the development of end-to-end AI financial planners that seamlessly combine:
- **Conversational natural language interfaces** powered by LLMs
- **Real-time stock market prediction and portfolio optimisation**
- **Robo-advisory capabilities** tailored to individual risk profiles
- **Explainable AI mechanisms** that build user trust
- **Scalable, cloud-native architectures** compliant with financial regulations

...remains a **largely unresolved challenge** in the academic and industrial literature. Most existing systems address one or two of these dimensions in isolation, leaving significant integration gaps that form the central motivation of this survey and the proposed *FinAI Personal Financial Planner* project.

### 1.1 Motivation

The proposed FinAI system aims to democratise financial planning by providing retail investors — particularly those in India with limited access to professional financial advisors — with an intelligent, personalised, and trustworthy AI-powered financial planning assistant. This survey maps the current state of knowledge across all constituent technology domains required to build such a system, identifies what has been achieved, what gaps exist, and what approaches are most promising for the proposed system's design.

### 1.2 Objectives of the Survey

1. To systematically review and synthesise the existing literature on AI applications in personal finance across five key domains.
2. To identify, categorise, and critically analyse methodological approaches, datasets used, and key results from 22 selected studies.
3. To identify persistent research gaps and underexplored areas relevant to an integrated AI personal financial planner.
4. To propose a conceptual integration framework drawing on insights from the reviewed literature.
5. To establish the academic foundation for the design decisions in the proposed FinAI system.

---

## 2. Scope and Methodology of Review

### 2.1 Review Protocol

This survey follows a structured, semi-systematic literature review methodology. Papers were sourced from two curated Excel datasets compiled specifically for this project (Table 1), supplemented by forward- and backward-citation tracing. Inclusion criteria required papers to be published in peer-reviewed journals, conference proceedings, or established preprint archives (arXiv) between 2023–2026, and to address at least one of the five identified domain areas.

### 2.2 Distribution of Reviewed Papers

**Table 1: Summary of Data Sources**

| Source File | Papers Covered | Year Range | Primary Focus |
|---|---|---|---|
| AI_Finance_Literature_Review_Papers_1-20_Combined.xlsx | Papers 1–20 | 2023–2025 | LLMs, NLP, Stock Prediction, Portfolio, Robo-Advisory, Cloud |
| Literature_Review.xlsx | Papers 21–22 | 2025–2026 | Algorithmic Trading, Market Microstructure |
| **Combined** | **22 papers** | **2023–2026** | **All five domains** |

**Table 2: Distribution by Domain**

| Domain | Papers | % of Total |
|---|---|---|
| LLMs and Financial NLP | 6 | 27.3% |
| Stock Market Prediction (AI/ML) | 4 | 18.2% |
| Portfolio Optimisation and Robo-Advisory | 6 | 27.3% |
| Cloud Computing (Financial AI Infrastructure) | 4 | 18.2% |
| Algorithmic and High-Frequency Trading | 2 | 9.1% |
| **Total** | **22** | **100%** |

**Table 3: Temporal Distribution**

| Year | Number of Papers |
|---|---|
| 2023 | 6 |
| 2024 | 12 |
| 2025 | 3 |
| 2026 | 1 |
| **Total** | **22** |

The preponderance of 2024 publications reflects the explosive growth of LLM-based financial research following the widespread availability of GPT-4 and comparable models in 2023.

---

## 3. Literature Review

### 3.1 Large Language Models in Finance

The emergence of large language models has fundamentally altered the landscape of AI in finance. This section reviews six papers directly addressing the design, training, evaluation, and application of LLMs for financial tasks.

#### 3.1.1 General Surveys and Taxonomies

**Li et al. [R1] — "Large Language Models in Finance: A Survey" (2023)**

This foundational survey provides a structured overview of LLM applications in financial NLP, synthesising research across financial analysis, forecasting, question answering, and decision support. The authors compare zero-shot/few-shot prompting, domain-specific fine-tuning, and full custom financial LLM development. Crucially, the paper proposes a decision framework for practitioners choosing between lightweight model adaptation and building a dedicated financial LLM from scratch.

The survey identifies five persistent challenges:
- **Data quality** — financial corpora are noisy, temporally sensitive, and often proprietary
- **Computational cost** — training large-scale financial LLMs demands enormous resources
- **Domain adaptation** — general LLMs exhibit suboptimal performance on specialised financial tasks
- **Reliability and hallucination** — LLMs can generate plausible but factually incorrect financial information
- **Privacy and regulatory compliance** — financial data is heavily regulated

**Du et al. [R4] — "Natural Language Processing in Finance: A Survey" (2024)**

This comprehensive survey maps financial NLP into ten distinct application areas (Table 4), providing the broadest taxonomic view in the reviewed literature. The paper demonstrates the evolution of financial NLP from narrow sentiment classification toward holistic systems capable of supporting investment decisions, regulatory compliance, ESG analysis, and user-facing conversational advisory.

**Table 4: Ten Application Areas of Financial NLP (Adapted from Du et al. [R4])**

| # | Application Area | Key Tasks | Representative Techniques |
|---|---|---|---|
| 1 | Financial Sentiment Analysis | Document classification, opinion mining | BERT, FinBERT, LLMs |
| 2 | Narrative Financial Processing | Earnings call analysis, MD&A parsing | Transformer models |
| 3 | Financial Forecasting | Price prediction, return prediction | LSTM, LLMs |
| 4 | Portfolio Management | Asset allocation, factor analysis | RL, NLP + optimisation |
| 5 | Question Answering | Financial QA, table understanding | GPT, RAG systems |
| 6 | Virtual Assistants and Chatbots | Conversational finance, robo-advisory | LLMs, dialogue systems |
| 7 | Risk Management | Credit scoring, fraud detection | NLP + ML classifiers |
| 8 | Regulatory Compliance | Contract review, AML, KYC | NLP pipelines |
| 9 | ESG and Sustainable Finance | ESG scoring, green bond analysis | Specialised LLMs |
| 10 | Explainable AI | Model interpretability | XAI + NLP |

#### 3.1.2 Domain-Specific Financial LLMs

**Wu et al. [R2] — "BloombergGPT: A Large Language Model for Finance" (2023)**

BloombergGPT represents the first publicly documented, large-scale (50-billion-parameter) LLM trained specifically for finance. The model is trained on a hybrid corpus of approximately 363 billion Bloomberg financial tokens combined with approximately 345 billion tokens from general-purpose datasets. Evaluation across financial and general-language benchmarks demonstrates that large-scale domain-specific pretraining substantially improves finance-specific task performance while maintaining competitive general-language capabilities.

**Yang et al. [R3] — "FinGPT: Open-Source Financial Large Language Models" (2023)**

In direct contrast to BloombergGPT's proprietary approach, FinGPT proposes an open-source, data-centric framework for building financial LLMs. The key technical innovation is the use of **Low-Rank Adaptation (LoRA)** for parameter-efficient fine-tuning of open-source base models on automatically curated financial data. Applications demonstrated include financial sentiment analysis, robo-advising, algorithmic trading, and financial analysis.

**Table 5: Comparison of Major Financial LLM Approaches**

| Model/Approach | Parameters | Training Data | Open Source | Key Strength | Key Limitation |
|---|---|---|---|---|---|
| BloombergGPT [R2] | 50B | Bloomberg (363B) + General (345B tokens) | No | High finance-task performance | Proprietary, not reproducible |
| FinGPT [R3] | Varies (LoRA fine-tuned) | Auto-curated open financial data | Yes | Reproducible, cost-efficient | May underperform proprietary models |
| GPT-4 [R7][R8] | Undisclosed | General + RLHF | Partial (API) | Strong general reasoning | Hallucination risk, high cost |
| FinBERT [R4] | 110M–340M | General + financial fine-tuning | Mostly yes | Established, well-tested | Narrow task performance |

#### 3.1.3 LLMs for Financial News and Market Signals

**Lopez-Lira and Tang [R7] — "Can ChatGPT Forecast Stock Price Movements?" (2023)**

This study directly tests whether GPT-generated scores derived from financial news headlines contain economically useful information for predicting stock returns. The findings report significant predictive relationships between GPT-generated sentiment scores and subsequent daily stock returns, with particularly strong effects for smaller-cap stocks and following negative news events.

**Fatouros et al. [R8] — "Can Large Language Models Beat Wall Street? MarketSenseAI" (2024)**

MarketSenseAI presents a comprehensive GPT-4-based investment framework integrating four distinct information streams: news summaries, financial fundamentals, price dynamics, and macroeconomic context. The system generates interpretable buy/hold/sell signals and is evaluated on S&P 100 stocks over 15 months, reporting excess alpha of 10–30% and cumulative returns up to 72%. The generation of *explanations alongside investment signals* is a notable design contribution directly applicable to the proposed FinAI system's transparency requirements.

> **Design Note:** MarketSenseAI demonstrates the feasibility of combining multiple financial information streams within a single LLM-powered decision system. Results must be independently validated before live advisory deployment.

---

### 3.2 NLP Applications in Financial Decision Support

**Gupta et al. [R5] — "Financial News Sentiment Analysis Using BERT and FinBERT" (2023)**

This paper examines comparative performance of general-purpose BERT and domain-specific FinBERT for classifying financial news sentiment. Fine-tuning on financial domain data substantially improves sentiment classification accuracy. The paper highlights challenges of implicit sentiment and domain-specific vocabulary in financial text.

**Huang et al. [R6] — "FinBERT: A Pre-trained Financial Language Representation Model" (2023)**

This study provides systematic evaluation of FinBERT across multiple financial NLP benchmarks, documenting superior performance over generic BERT for financial sentiment classification, financial QA, and named entity recognition. FinBERT is established as the de facto baseline for financial NLP tasks where full LLM deployment is cost-prohibitive.

---

### 3.3 Stock Market Prediction with AI/ML

#### 3.3.1 Deep Learning Architectures for Price Prediction

**Yadav et al. [R20] — "Advancements in AI and ML for Stock Market Prediction" (2024)**

This comprehensive analytical review organises the stock prediction literature by data types, evaluation metrics, and neural network structures. The review highlights the **fragmentation problem** in stock prediction research — multiple incompatible datasets, metrics, and model formulations make cross-study comparison virtually impossible.

**Table 6: AI/ML Approaches for Stock Market Prediction (Synthesised from [R20])**

| Approach | Architecture | Strengths | Limitations | Typical Metrics |
|---|---|---|---|---|
| RNN / LSTM | Sequential recurrent networks | Good for time-series dependencies | Vanishing gradient for long sequences | MSE, RMSE, MAE |
| CNN | Convolutional feature extraction | Captures local patterns in price charts | Limited temporal context | Accuracy, F1 |
| Transformer / Attention | Self-attention mechanism | Long-range dependencies, parallelisable | Data-hungry, computationally expensive | Sharpe ratio, alpha |
| Hybrid CNN-LSTM | Combined spatial + temporal | Complementary strengths | Complex tuning | MAPE, R-squared |
| Reinforcement Learning | Agent-based trading | Direct profit optimisation | High variance, unstable training | Cumulative return |
| LLM-based (GPT) | Foundation model + prompting | Rich information integration | Hallucination risk, high cost | Alpha, win rate |

**Gu et al. [R15] — "Charting by Machines" (2024)**

This study evaluates whether ML can extract useful predictive signals from historical stock price charts. ML forecasts strongly predict future cross-sectional stock returns, capturing information distinct from standard momentum and reversal factors. This finding validates the use of historical price pattern recognition as an input feature to portfolio construction models.

#### 3.3.2 Integrated Prediction and Portfolio Optimisation

**Wang, Zeng and Yuan [R16] — "Two-Stage Stock Portfolio Optimisation" (2024)**

This paper makes a significant contribution by treating stock prediction and portfolio construction as a **unified problem**. The proposed framework:

1. **Stage 1 (Prediction):** Applies Savitzky-Golay signal filtering for noise reduction, uses Sparrow Search Algorithm for LSTM hyperparameter optimisation, then performs LSTM price prediction.
2. **Stage 2 (Portfolio):** Feeds predictions into a mean-Conditional Value-at-Risk (CVaR) portfolio optimisation model.

**Figure 1: Two-Stage AI Portfolio Framework (Adapted from Wang et al. [R16])**

```
Raw Price Data
      |
      v
[Stage 1: Prediction]
  - Savitzky-Golay Signal Filtering
  - SSA Hyperparameter Optimisation
  - LSTM Price Prediction
      |
      v  [Predicted Returns + Uncertainty]
[Stage 2: Portfolio Optimisation]
  - Mean-CVaR Model
  - Risk Constraint at Confidence Levels
      |
      v
  Optimal Portfolio Weights
```

Experiments on CSI 300 data report R-squared of 0.9980 and cumulative portfolio returns of 7.54–9.38%, outperforming seven benchmark strategies.

---

### 3.4 Portfolio Optimisation and AI-Powered Asset Management

**Zhu, Vigren and Soderberg [R14] — "Implementing AI-Empowered Financial Advisory Services" (2024)**

This interdisciplinary systematic review of 132 articles develops an integrated framework for implementing AI-powered financial advisory services. The paper identifies critical success factors including algorithm quality, interface design, trust mechanisms, regulatory compliance, and organisational readiness. Importantly, it shifts attention from purely technical performance to **implementation and adoption** — essential for building a financial AI system that users will actually use and trust.

Key implementation dimensions identified:
- **Algorithm quality:** Accuracy, reliability, and robustness of underlying models
- **Interface design:** Usability, accessibility, and appropriate information disclosure
- **Trust mechanisms:** Transparency, explainability, and human oversight options
- **Regulatory compliance:** GDPR (EU), financial advisory regulations, disclosure requirements
- **Organisational readiness:** Staff training, change management, hybrid human-AI models

---

### 3.5 Robo-Advisory Systems: Technology, Adoption, and Impact

#### 3.5.1 Technology and Classification

**Cardillo and Chiappini [R18] — "Robo-Advisors: A Systematic Literature Review" (2024)**

This systematic review of 2017–2022 robo-advisor literature organises the field into four research streams:

**Table 7: Four Research Streams in Robo-Advisory Literature (Adapted from Cardillo and Chiappini [R18])**

| Research Stream | Key Questions | Representative Topics |
|---|---|---|
| Early Classification | What is a robo-advisor? Typologies? | Business models, fee structures, human-AI hybrids |
| Behavioural Issues | Who adopts? Why or why not? | Trust, financial literacy, risk tolerance, demographics |
| Performance | Do robo-advisors outperform human advisors? | Portfolio returns, Sharpe ratio, diversification |
| Algorithm Modelisation | How do they make decisions? | MPT, Black-Litterman, RL, ML approaches |

#### 3.5.2 Empirical Impact

**Rossi and Utkus [R17] — "The Diversification and Welfare Effects of Robo-Advising" (2024)**

Using anonymised proprietary Vanguard data, this study documents that robo-advice adoption leads to:
- Increased indexing (shift from active to passive funds)
- Reduced home bias (greater global diversification)
- Lower fees (shift to lower-cost instruments)
- Improved Sharpe ratios
- Significant investor time savings

Critically, **the largest benefits accrue to investors who were previously the least diversified** — implying AI-powered financial planning has the greatest welfare impact for retail investors with limited financial sophistication.

**Figure 2: Welfare Effects of Robo-Advisory Adoption (Rossi and Utkus [R17])**

```
Pre-Robo-Advisor                    |  Post-Robo-Advisor Adoption
------------------------------------|----------------------------------
High home bias                      |  Reduced home bias
Many individual stocks              |  Fewer, better-diversified holdings  
Active management fees              |  Lower-cost index funds
Lower Sharpe ratio                  |  Improved risk-adjusted returns
Time-intensive management           |  Significant time savings
------------------------------------|----------------------------------
Impact amplification: Largest gains for previously least-diversified investors
```

#### 3.5.3 Adoption in Emerging Markets

**Banerjee [R19] — "What Drives Retail Indian Investors to Robo-Advisors?" (2025)**

Using survey data from 387 Indian retail investors analysed through Structural Equation Modeling (SEM), this study identifies **technology readiness** and **financial literacy** as the two strongest predictors of robo-advisory adoption intention.

**Table 8: Predictors of Robo-Advisory Adoption Among Indian Retail Investors (Banerjee [R19])**

| Predictor | Relative Importance | Implication for FinAI System |
|---|---|---|
| Technology Readiness | High | Intuitive, mobile-first UI; progressive disclosure of complexity |
| Financial Literacy | High | In-app financial education; explainable recommendations |
| Social Influence | Moderate | Social proof features, community insights |
| Investor Type (active/passive) | Moderate | Personalisation engine adapting to investor style |
| Demographics | Low | Not a reliable predictor; avoid demographic-only segmentation |

---

### 3.6 Cloud Computing Infrastructure for Financial AI

**Rai and Thakkar [R9] — "Utilisation and Implications of Cloud Computing in the Banking Sector" (2023)**

This paper compares three major cloud service models (SaaS, PaaS, IaaS) and three major cloud providers (AWS, Microsoft Azure, Google Cloud Platform) in banking. Cloud adoption can improve scalability, flexibility, and cost efficiency, but financial institutions face additional requirements around security, data sovereignty, regulatory compliance, and vendor risk.

**Sharma et al. [R10] — "Scalability and Security Challenges of Cloud Computing in Banking" (2024)**

Using Technology Acceptance Model (TAM) with PLS-SEM on banking IT professional survey data, this study finds that operational efficiency and regulatory compliance positively support cloud scalability, while security concern effects vary by context. This suggests security challenges are real but contextual — not a blanket barrier to cloud adoption.

**Table 9: Cloud and Infrastructure Considerations for AI Financial Systems**

| Dimension | Key Challenge | Recommended Approach |
|---|---|---|
| Scalability | Variable load (trading hours, market events) | Auto-scaling cloud deployment (AWS/GCP) |
| Security | Data breaches, API attacks | Encryption at rest/in-transit, OAuth 2.0, WAF |
| Compliance | RBI/SEBI regulations, data localisation | India-region cloud deployments, audit logging |
| Latency | Real-time market data processing | Edge computing, low-latency APIs |
| Cost | LLM inference cost at scale | Model caching, smaller fine-tuned models for routine queries |
| Availability | 24/7 financial planning access | Multi-region redundancy, circuit breakers |

**Anand et al. [R11] — "Cybersecurity Challenges in Financial Institutions" (2023)**

This paper documents prevalent attack vectors for financial institutions: phishing, ransomware, API vulnerabilities, and insider threats. AI-powered financial systems introduce new attack surfaces through model serving APIs, training data pipelines, and user-facing interfaces.

**Kumar and Singh [R13] — "Blockchain and AI Integration for Secure Financial Transactions" (2024)**

This research explores combining blockchain's immutable ledger with AI for enhanced security and transparency. The paper identifies a longer-term architectural consideration: distributed ledger technology could provide transparent, tamper-proof records of AI financial recommendations — enhancing regulatory compliance and user trust.

---

### 3.7 Algorithmic and High-Frequency Trading

**Zhang [R21] — "The Role of Algorithmic Trading in the U.S. Stock Market" (2026)**

This comprehensive review synthesises empirical research on HFT across three domains: price efficiency, transaction costs, and market volatility. Zhang advances a unifying explanation centred on **endogenous liquidity provision** — HFT firms voluntarily supply liquidity when profitable and withdraw during stress events.

Under normal conditions: narrows spreads, accelerates price discovery, lowers transaction costs (Hendershott et al., 2011; Brogaard et al., 2014).
During market shocks: simultaneous withdrawal amplifies volatility (May 6, 2010 Flash Crash; Kirilenko et al., 2017).

**Gu [R22] — "The Changes in the Stock Market After Introducing Algorithmic Trading" (2025)**

This review traces the evolution of algorithmic trading:

**Figure 3: Evolution of Algorithmic Trading Volume in U.S. Equity Markets**

```
Year  | Algorithmic Trading Share
------|---------------------------
2000  | ~20%
2006  | ~30%
2010  | ~60%
2015  | ~85%
2019  | ~90-93%
2024+ | ~90%+ (estimated)

Source: Adapted from Kissell (2021) as cited in Gu [R22]
```

Key benefits: execution speed, reduced human bias, back-tested strategy development, democratised information access.
Key risks: infrastructure dependence (Knight Capital's USD 440 million loss in 45 minutes, 2012), flash crash amplification, limited adaptability to unprecedented market conditions.

> **Implication for FinAI:** Price prediction models that ignore HFT market microstructure effects may systematically underperform. The proposed system should incorporate transaction cost models and avoid strategies inherently disadvantaged by HFT liquidity withdrawal dynamics.

---

## 4. Comparative Analysis and Synthesis

### 4.1 Master Summary Table of All Reviewed Papers

**Table 10: Comprehensive Overview of All 22 Reviewed Papers**

| # | Authors (Year) | Title (Abbreviated) | Domain | Method | Key Dataset | Key Finding |
|---|---|---|---|---|---|---|
| 1 | Li et al. (2023) | LLMs in Finance: A Survey | LLM | Survey | Review (no new dataset) | Decision framework for financial LLM development |
| 2 | Wu et al. (2023) | BloombergGPT | LLM | Domain-specific LLM pretraining | Bloomberg 363B tokens | Finance-specific LLMs outperform general models |
| 3 | Yang et al. (2023) | FinGPT | LLM | Open-source + LoRA fine-tuning | Open financial data | Cost-efficient open-source financial LLM |
| 4 | Du et al. (2024) | NLP in Finance: A Survey | NLP/LLM | Taxonomy survey | Review (no new dataset) | 10-area taxonomy of financial NLP |
| 5 | Gupta et al. (2023) | Financial News Sentiment (BERT/FinBERT) | NLP | BERT fine-tuning | Financial news | FinBERT outperforms BERT for financial sentiment |
| 6 | Huang et al. (2023) | FinBERT | NLP | Pre-trained financial LM | Financial corpora | FinBERT as baseline for financial NLP tasks |
| 7 | Lopez-Lira and Tang (2023) | ChatGPT for Stock Prediction | LLM + Market | GPT sentiment scoring + return predictability | News + stock returns | GPT scores significantly predict daily returns |
| 8 | Fatouros et al. (2024) | MarketSenseAI | LLM + Market | GPT-4, zero-shot, multi-source | S&P 100 (15 months) | 10-30% excess alpha; interpretable signals |
| 9 | Rai and Thakkar (2023) | Cloud Computing in Banking | Cloud Infra | Comparative analysis | Industry/secondary data | Provider selection guidance for banks |
| 10 | Sharma et al. (2024) | Scalability and Security in Banking Cloud | Cloud Infra | TAM + PLS-SEM | IT professional survey | Operational efficiency supports cloud scalability |
| 11 | Anand et al. (2023) | Cybersecurity in Financial Institutions | Cloud/Security | Threat analysis | Case studies | New attack surfaces from AI-enabled systems |
| 12 | Sutton et al. (2024) | RL for Portfolio Management | Portfolio | Reinforcement learning | Simulated markets | RL adapts to regimes but has training instability |
| 13 | Kumar and Singh (2024) | Blockchain + AI for Secure Finance | Cloud/Security | Blockchain + AI integration | Prototype system | Immutable records enhance trust and compliance |
| 14 | Zhu et al. (2024) | AI-Empowered Financial Advisory Services | Robo-Advisory | Systematic review (132 papers) | Published literature | Integration framework for AI advisory |
| 15 | Gu et al. (2024) | Charting by Machines | Market Prediction | ML on historical price charts | Large-cap U.S. stocks | ML captures distinct signal beyond momentum |
| 16 | Wang et al. (2024) | Two-Stage Portfolio Optimisation | Portfolio + Prediction | LSTM + Mean-CVaR | CSI 300 index | R-sq=0.9980; 7.54-9.38% cumulative returns |
| 17 | Rossi and Utkus (2024) | Robo-Advising Diversification and Welfare | Robo-Advisory | Empirical + Boosted Regression Trees | Vanguard proprietary data | Robo-advice improves diversification, Sharpe ratio |
| 18 | Cardillo and Chiappini (2024) | Robo-Advisors: Systematic Review | Robo-Advisory | Systematic literature review | 2017-2022 literature | Four-stream framework for robo-advisory research |
| 19 | Banerjee (2025) | Indian Investors and Robo-Advisors | Robo-Advisory | SEM (IBM SPSS AMOS) | 387 Indian investors | Tech readiness + financial literacy drive adoption |
| 20 | Yadav et al. (2024) | AI/ML for Stock Market Prediction | Market Prediction | Comprehensive analysis + proposed methodology | Multiple review datasets | Unified methodology for stock prediction research |
| 21 | Zhang (2026) | Algorithmic Trading in U.S. Stock Market | Algo Trading | Structured literature review | 1970-2022 HFT studies | Endogenous liquidity provision unifies HFT effects |
| 22 | Gu (2025) | Stock Market After Algorithmic Trading | Algo Trading | Qualitative review | Secondary sources | Algo trading >90% of volume; DL is the frontier |

### 4.2 Cross-Domain Synthesis: Conceptual Architecture for FinAI

**Figure 4: Conceptual Architecture for FinAI Personal Financial Planner (Synthesised from Reviewed Literature)**

```
+==============================================================+
|            FinAI Personal Financial Planner                  |
|                  Conceptual Architecture                     |
+==============================================================+
|                                                              |
|  +----------------------------------------------------------+|
|  |                 USER INTERFACE LAYER                     ||
|  |  Conversational Chat | Dashboard | Portfolio | Reports   ||
|  +----------------------------|-----------------------------+|
|                               |                              |
|  +----------------------------|-----------------------------+|
|  |            AI REASONING AND NLP LAYER                   ||
|  |  LLM Engine (FinGPT/GPT-4) | FinBERT Sentiment          ||
|  |  Financial QA | Explanation | RAG Pipeline              ||
|  +-------+------------------+------------------+-----------+|
|           |                  |                  |            |
|  +--------+------+  +--------+-------+  +-------+---------+ |
|  | MARKET DATA   |  | PORTFOLIO      |  | RISK PROFILING  | |
|  | PREDICTION    |  | OPTIMISATION   |  | AND GOAL        | |
|  | LSTM / CNN    |  | Mean-CVaR /    |  | PLANNING        | |
|  | ML Models     |  | RL Agent       |  | SEM-based User  | |
|  +--------+------+  +--------+-------+  +-------+---------+ |
|           +------------------+-----------------+             |
|                               |                              |
|  +----------------------------|--------------------------+   |
|  |               DATA INGESTION LAYER                   |   |
|  | Market APIs | News | User Data | Economic Data       |   |
|  +----------------------------------------------------------+|
|                                                              |
|  +----------------------------------------------------------+|
|  |    CLOUD INFRASTRUCTURE (AWS/GCP — India Region)        ||
|  |  Security | Scalability | Compliance | Monitoring       ||
|  +----------------------------------------------------------+|
+==============================================================+

References: LLM Layer [R1-R8], Prediction [R15,R16,R20], 
            Portfolio [R12,R14,R16,R17], Cloud [R9,R10,R11,R13],
            Adoption [R18,R19]
```

### 4.3 Technology Readiness Assessment

**Table 11: Technology Readiness for FinAI Components**

| Component | Technology Readiness | Best-Supported Approaches | Remaining Challenges |
|---|---|---|---|
| Financial NLP / Sentiment | High | FinBERT, GPT-4 prompting | Multilingual (Hindi/regional) support |
| LLM Conversational Interface | High | FinGPT (open), GPT-4 API | Hallucination, cost at scale |
| Stock Price Prediction | Medium-High | LSTM, CNN-LSTM hybrids | Market regime generalisation |
| Portfolio Optimisation | Medium | Mean-CVaR, RL agents | Live deployment, transaction costs |
| Robo-Advisory | High (mature products) | Rule-based + ML hybrid | Retail trust, regulatory compliance |
| Cloud Infrastructure | High | AWS / Azure / GCP | Data localisation for India |
| Explainability | Low-Medium | SHAP, LIME, LLM explanations | User-interpretable and actionable output |

### 4.4 Methodological Approaches Across Domains

**Figure 5: Frequency of Methodological Approaches in Reviewed Papers**

```
Method Category                     | Papers Using | Representative Papers
------------------------------------|--------------|----------------------
Survey / Systematic Literature Review|     6        | [R1][R4][R18][R20][R21][R14]
Deep Learning (LSTM, CNN, Transformer)|    4        | [R7][R15][R16][R20]
LLM-based (GPT-4, FinGPT, BERT)     |     5        | [R2][R3][R6][R7][R8]
Statistical / SEM / PLS-SEM          |     3        | [R10][R19][R17]
Comparative / Case Analysis          |     4        | [R9][R11][R13][R22]
Reinforcement Learning               |     1        | [R12]
Empirical / Natural Experiment       |     2        | [R15][R17]
------------------------------------|--------------|----------------------
Note: Some papers span multiple categories
```

---

## 5. Research Gaps

Based on systematic analysis of all 22 reviewed papers, this survey identifies **eight critical research gaps** that motivate the proposed FinAI Personal Financial Planner system.

### Gap 1: Absence of End-to-End AI Personal Financial Planner Systems

**Identified from:** [R1][R3][R4][R14][R18]  
**Severity: Critical**

Despite extensive research on individual components — LLMs, portfolio optimisation, robo-advisory, and prediction models — **no reviewed paper presents an integrated, end-to-end AI personal financial planning system** that combines conversational intelligence, predictive analytics, portfolio management, and personalised financial planning in a single cohesive architecture. Existing systems are either component-specific or narrowly focused on institutional rather than retail applications.

**Implication for FinAI:** This is the **primary contribution** of the proposed system — integration of all five technology domains into a unified retail-facing financial planning assistant.

### Gap 2: Limited Personalisation for Indian Retail Investors

**Identified from:** [R19][R18][R17]  
**Severity: High**

Banerjee's [R19] study of Indian retail investor adoption is the only reviewed paper focused on the Indian market. The specific investment vehicles available to Indian retail investors (mutual funds, NSE/BSE equities, SIPs, PPF, NPS, fixed deposits), the regulatory environment (SEBI, IRDAI, RBI), and the multi-lingual nature of Indian users create a distinct context absent from the Western-centric majority of reviewed literature.

**Implication for FinAI:** India-specific financial data integration (NSE/BSE APIs, mutual fund NAV data), multilingual support, SEBI-compliant recommendation disclaimers, and localised user experience design.

### Gap 3: Explainability and Trust in AI Financial Recommendations

**Identified from:** [R1][R4][R8][R14][R18][R19]  
**Severity: High**

Multiple reviewed papers identify explainability as critical [R1][R4][R14], but only MarketSenseAI [R8] provides partial explainability through narrative justification. No reviewed paper demonstrates a comprehensive, user-interpretable explanation system for portfolio recommendations that has been empirically validated for its impact on user trust and adoption.

**Implication for FinAI:** LLM-generated rationale for all recommendations + SHAP/LIME for ML model output explanation. Emphasis on "why" behind every suggestion.

### Gap 4: Integration of Multi-Modal Financial Data

**Identified from:** [R7][R8][R15][R16][R20]  
**Severity: Medium-High**

While individual papers study news sentiment [R7], price charts [R15], fundamentals [R8], or macroeconomic data [R8] separately, **no reviewed paper demonstrates robust, validated multi-modal fusion** of all information types within a unified prediction or advisory framework optimised for retail deployment.

**Implication for FinAI:** Develop a data fusion pipeline combining real-time news sentiment, price history, fundamental ratios, and macroeconomic indicators — inspired by MarketSenseAI's architecture [R8].

### Gap 5: Longitudinal Validation of AI Financial Advisory Outcomes

**Identified from:** [R17][R18][R19]  
**Severity: Medium**

No reviewed paper provides long-term, multi-year, generalised empirical evidence of financial outcomes for retail users adopting AI-powered personal financial planning systems across diverse market conditions.

**Implication for FinAI:** Identified as a future work direction. The proposed system will include evaluation metrics designed to support longer-term outcome tracking.

### Gap 6: Cost-Efficient LLM Deployment for Scale

**Identified from:** [R1][R2][R3][R8]  
**Severity: Medium**

BloombergGPT [R2] is too expensive for most deployments. GPT-4 API [R8] incurs per-query costs unsustainable at retail scale. FinGPT [R3] proposes LoRA-based efficiency, but real-world performance in conversational financial advisory contexts has not been rigorously benchmarked.

**Implication for FinAI:** Tiered approach — FinGPT (LoRA fine-tuned) for routine queries; GPT-4 API for complex advisory tasks. Implement query caching and response templating for common scenarios.

### Gap 7: AI-Specific Cybersecurity for Financial Systems

**Identified from:** [R9][R10][R11][R13]  
**Severity: High**

The specific vulnerabilities of AI-powered financial systems — adversarial attacks on ML models, prompt injection attacks on LLMs, poisoning of financial training datasets — receive little systematic attention. Standard cybersecurity frameworks [R11] do not address AI-specific threat vectors.

**Implication for FinAI:** Security-by-design architecture: adversarial robustness in ML models, prompt injection prevention via input sanitisation, encrypted storage of all personal financial data, OAuth 2.0 authentication.

### Gap 8: Regulatory Compliance Framework for AI Financial Advisors

**Identified from:** [R1][R4][R9][R14][R18]  
**Severity: High**

SEBI's 2023 consultation paper on AI in securities markets and RBI's evolving FinTech regulation framework create a complex compliance environment. No reviewed paper provides a comprehensive framework for AI financial advisory systems that meets SEBI/RBI requirements while maintaining technical capabilities and user experience.

**Implication for FinAI:** Mandatory investment recommendation disclaimers (SEBI regulation), data localisation in India-region cloud, audit logs for all AI-generated financial advice, user consent flows for data processing.

### Summary of Research Gaps

**Table 12: Summary of Research Gaps and Implications for the Proposed FinAI System**

| Gap # | Gap Description | Severity | FinAI Response |
|---|---|---|---|
| 1 | No end-to-end AI personal financial planner | Critical | Primary motivation and contribution of the proposed system |
| 2 | Limited India-specific personalisation | High | India-specific data (NSE/BSE), multilingual support, SIP/MF integration |
| 3 | Insufficient explainability and trust mechanisms | High | LLM-generated explanations + SHAP for ML models |
| 4 | Multi-modal data fusion not validated | Medium-High | News + price + fundamentals integration (inspired by MarketSenseAI) |
| 5 | No longitudinal validation of advisory outcomes | Medium | Future work; build in outcome tracking from day one |
| 6 | LLM deployment cost unsustainable at scale | Medium | Tiered model strategy: FinGPT + GPT-4 hybrid |
| 7 | AI-specific cybersecurity underexplored | High | Adversarial robustness, prompt injection prevention, encrypted storage |
| 8 | Regulatory compliance framework absent | High | SEBI/RBI-compliant data handling, mandatory disclaimers |

---

## 6. Summary

This comprehensive literature survey synthesises **22 research works** spanning 2023–2026 across five core domains with direct implications for the development of an AI-powered Personal Financial Planner.

### 6.1 Key Findings by Domain

**Large Language Models and Financial NLP:**
- LLMs have demonstrated significant capability in financial text understanding, sentiment analysis, and investment signal generation [R1][R2][R3][R7][R8].
- Domain-specific financial LLMs (BloombergGPT, FinGPT) outperform general models on financial NLP tasks, but at vastly different resource requirements [R2][R3].
- LLM-based investment frameworks can generate alpha and provide interpretable signals, though results require independent validation [R8].
- Hallucination risk, computational cost, and regulatory compliance remain central challenges [R1][R4].

**AI/ML for Market Prediction:**
- LSTM and hybrid deep learning architectures remain the most validated for financial time-series prediction [R20].
- Integrated prediction + portfolio optimisation (Mean-CVaR) frameworks outperform standalone approaches [R16].
- Machine learning can capture predictive information in historical price data beyond standard technical indicators [R15].
- Fragmentation in datasets and metrics hinders reproducibility and cross-study comparison [R20].

**Robo-Advisory:**
- Robo-advisory empirically improves portfolio diversification, reduces costs, and saves investor time [R17].
- The research landscape spans four streams: classification, behaviour, performance, and algorithms [R18].
- In India, technology readiness and financial literacy are the primary adoption drivers [R19].
- Implementation challenges (trust, interface design, regulation) are as important as technical performance [R14].

**Cloud Infrastructure:**
- Cloud adoption in financial AI is feasible but must prioritise security, regulatory compliance, and data localisation [R9][R10].
- AI financial systems introduce new security vulnerabilities requiring specific mitigation strategies [R11].
- Blockchain integration offers longer-term transparency benefits [R13].

**Algorithmic Trading:**
- Algorithmic and HFT dynamics dominate modern equity markets (>90% of volume), shaping the microstructure in which any prediction or trading model operates [R21][R22].
- Understanding endogenous liquidity provision is essential for designing robust AI trading and portfolio strategies [R21].

### 6.2 Synthesis: State of the Art vs. Required Capabilities

**Table 13: State-of-the-Art vs. FinAI Required Capabilities**

| Capability | State-of-the-Art (from Literature) | Gap | FinAI Approach |
|---|---|---|---|
| Financial NLP | FinBERT, GPT-4 for English text | No Hindi/Indic support | FinBERT + GPT-4 API with planned multilingual extension |
| Conversational Advisory | MarketSenseAI (GPT-4, S&P 100) | No retail-facing system | FinGPT/GPT-4 hybrid conversational agent |
| Stock Prediction | LSTM+CVaR on CSI 300 (R-sq 0.9980) | No NSE/BSE-validated model | Retrain on NSE/BSE historical data |
| Portfolio Optimisation | Mean-CVaR, RL agents | No personalised retail system | Mean-CVaR integrated with user risk profile |
| Robo-Advisory | Vanguard system (Rossi and Utkus 2024) | No India-context system | Indian MF/equity portfolio recommendations |
| Explainability | MarketSenseAI narratives (partial) | No validated XAI for retail users | LLM rationale + SHAP for all outputs |
| Cloud Infrastructure | AWS/GCP banking guidelines | No AI-specific financial security framework | India-region GCP with security-by-design |

---

## 7. Conclusion

This literature survey establishes the academic foundation for the development of a *FinAI Personal Financial Planner* — an end-to-end AI-powered system combining LLM-based conversational intelligence, market prediction, portfolio optimisation, and personalised financial planning for Indian retail investors.

The reviewed literature conclusively demonstrates that:

**1. The technology components are individually mature.** LLMs can process financial language [R1][R2][R3][R4], ML models can predict market movements [R15][R16][R20], portfolio optimisation algorithms can allocate assets [R12][R16], robo-advisory systems can improve investor outcomes [R17], and cloud infrastructure can support scalable deployment [R9][R10].

**2. The integration gap is the central unresolved challenge.** No existing system combines all these components into a cohesive, retail-oriented, end-to-end personal financial planner — particularly one calibrated for the Indian market. This is the primary contribution of the proposed FinAI system.

**3. Explainability and user trust are not optional.** Empirical evidence from adoption studies [R19] and implementation frameworks [R14] confirms that technically superior AI systems fail to achieve impact if users cannot understand or trust their recommendations. The proposed system embeds explainability at every layer of the architecture.

**4. The Indian retail investor market is uniquely underserved.** With over 100 million demat account holders, growing financial awareness, and an active regulatory development environment, India represents an ideal and impactful deployment context for the proposed system [R19].

**5. Eight research gaps define the frontier** for the next generation of AI financial planning systems. The proposed FinAI system directly addresses Gaps 1 and 2 as primary contributions, with partial contributions toward Gaps 3, 4, 6, and 7. Gaps 5 and 8 are identified as future work directions.

> **This survey provides the theoretical and empirical basis for every major design decision in the proposed FinAI system. All technical claims in the design and implementation report are traceable to citations and findings documented herein.**

---

## 8. References

> References are formatted in APA 7th edition. DOIs are provided where available from source data.  
> References marked [*] require full citation verification from the original source documents.

### Primary References (Reviewed Papers)

**[R1]** Li, Y., et al. (2023). *Large language models in finance: A survey*. arXiv preprint arXiv:2311.10723. https://arxiv.org/abs/2311.10723

**[R2]** Wu, S., Irsoy, O., Lu, S., Dabravolski, V., Dredze, M., Gehrmann, S., Kambadur, P., Rosenberg, D., & Mann, G. (2023). *BloombergGPT: A large language model for finance*. arXiv preprint arXiv:2303.17564. https://arxiv.org/abs/2303.17564

**[R3]** Yang, H., Liu, X.-Y., & Wang, C. D. (2023). *FinGPT: Open-source financial large language models*. arXiv preprint arXiv:2306.06031. https://arxiv.org/abs/2306.06031

**[R4]** Du, K., et al. (2024). *Natural language processing in finance: A survey*. *Information Fusion*, 102755. https://doi.org/10.1016/j.inffus.2024.102755

**[R5]** Gupta, A., et al. (2023). *Financial news sentiment analysis using BERT and FinBERT*. [Full citation to be verified from source paper].*

**[R6]** Huang, A., Wang, H., & Yang, Y. (2023). *FinBERT: A pre-trained financial language representation model for financial communications*. [Full citation to be verified from source paper].*

**[R7]** Lopez-Lira, A., & Tang, Y. (2023). *Can ChatGPT forecast stock price movements? Return predictability and large language models*. arXiv preprint arXiv:2304.07619. https://arxiv.org/abs/2304.07619

**[R8]** Fatouros, G., Soldatos, J., Kouroumali, K., Makridis, G., & Kyriazis, D. (2024). *Can large language models beat Wall Street? Evaluating GPT-4's impact on financial decision-making with MarketSenseAI*. *Neural Computing and Applications*. https://doi.org/10.1007/s00521-024-10613-4

**[R9]** Rai, A., & Thakkar, P. (2023). *Utilisation and implications of cloud computing in the banking sector*. In *Proceedings of the 2023 IEEE SCOReD Conference*. https://doi.org/10.1109/SCOReD60679.2023.10563290

**[R10]** Sharma, R., et al. (2024). *Scalability and security challenges of cloud computing in the banking industry*. In *Proceedings of ICORIS 2024*. https://doi.org/10.1109/ICORIS63540.2024.10903765

**[R11]** Anand, P., et al. (2023). *Cybersecurity challenges in financial institutions*. [Full citation to be verified from source paper].*

**[R12]** Sutton, R., et al. (2024). *Reinforcement learning for portfolio management*. [Full citation to be verified from source paper].*

**[R13]** Kumar, A., & Singh, R. (2024). *Blockchain and AI integration for secure financial transactions*. [Full citation to be verified from source paper].*

**[R14]** Zhu, Z., Vigren, A., & Soderberg, I.-L. (2024). *Implementing artificial intelligence empowered financial advisory services: A literature review and critical research agenda*. *Journal of Business Research*, 174, 114494. https://doi.org/10.1016/j.jbusres.2023.114494

**[R15]** Gu, S., et al. (2024). *Charting by machines*. *Journal of Financial Economics*, 154, 103791. https://doi.org/10.1016/j.jfineco.2024.103791

**[R16]** Wang, J., Zeng, X., & Yuan, S. (2024). *Two-stage stock portfolio optimization based on AI-powered price prediction and mean-CVaR models*. *Expert Systems with Applications*, 255, 124555. https://doi.org/10.1016/j.eswa.2024.124555

**[R17]** Rossi, A. G., & Utkus, S. P. (2024). *The diversification and welfare effects of robo-advising*. *Journal of Financial Economics*, 154, 103869. https://doi.org/10.1016/j.jfineco.2024.103869

**[R18]** Cardillo, G., & Chiappini, H. (2024). *Robo-advisors: A systematic literature review*. *Finance Research Letters*, 62, 105119. https://doi.org/10.1016/j.frl.2024.105119

**[R19]** Banerjee, S. (2025). *Portfolio management with the help of AI: What drives retail Indian investors to robo-advisors?* *The Electronic Journal of Information Systems in Developing Countries*. https://doi.org/10.1002/isd2.12346

**[R20]** Yadav, A., et al. (2024). *Advancements in artificial intelligence and machine learning for stock market prediction: A comprehensive analysis of techniques and case studies*. *Procedia Computer Science*, 230. https://doi.org/10.1016/j.procs.2023.12.193

**[R21]** Zhang, Y. (2026). *The role of algorithmic trading in the U.S. stock market*. *Journal of Young Investigators*, 2(2). https://doi.org/10.67419/jyi.v2i2.14

**[R22]** Gu, L. (2025). *The changes in the stock market after introducing algorithmic trading*. *Advances in Economics and Management Research (DEBDA 2025)*. ISSN 2790-1661.

---

### Secondary References Cited Within Reviewed Papers

**[S1]** Brogaard, J., Hendershott, T., & Riordan, R. (2014). High-frequency trading and price discovery. *Review of Financial Studies*, 27(8), 2267-2306. https://doi.org/10.1093/rfs/hhu032

**[S2]** Hendershott, T., Jones, C. M., & Menkveld, A. J. (2011). Does algorithmic trading improve liquidity? *Journal of Finance*, 66(1), 1-33. https://doi.org/10.1111/j.1540-6261.2010.01624.x

**[S3]** Kirilenko, A., Kyle, A. S., Samadi, M., & Tuzun, T. (2017). The flash crash: High-frequency trading in an electronic market. *Journal of Finance*, 72(3), 967-998. https://doi.org/10.1111/jofi.12498

**[S4]** Boehmer, E., Jones, C. M., Zhang, X., & Zhang, X. (2021). Tracking retail investor activity. *Journal of Finance*, 76(5), 2249-2305. https://doi.org/10.1111/jofi.13033

**[S5]** Budish, E., Cramton, P., & Shim, J. (2015). The high-frequency trading arms race: Frequent batch auctions as a market design response. *Quarterly Journal of Economics*, 130(4), 1547-1621. https://doi.org/10.1093/qje/qjv027

**[S6]** Markowitz, H. (1952). Portfolio selection. *Journal of Finance*, 7(1), 77-91. https://doi.org/10.2307/2975974

---

### Editorial Notes for Authors

> The following items require attention before final submission:
> 
> 1. **Incomplete citations** [R5][R6][R11][R12][R13] — retrieve full author names, journal/conference names, volume, issue, and page numbers from the original PDFs.
> 2. **Figure rendering** — Figures 1-5 (shown as ASCII art/text tables) should be converted to proper vector graphics or charts for the final Word/LaTeX submission.
> 3. **Word count** — Approximately 8,000 words (main body, excluding references). Target for a final year project literature review is typically 4,000-8,000 words — this is at the upper end and may be condensed.
> 4. **Author names and affiliation** — Replace placeholder [Author Names] and [Institution Name] with actual details.
> 5. **Citation style** — If the target journal/institution requires IEEE or MLA style instead of APA 7th, the reference list will need reformatting.
> 6. **Table of Contents hyperlinks** — Should be active hyperlinks in the final Word/PDF document.
> 7. **Section 3.2 expansion** — Consider adding 1-2 more NLP papers if available to balance the section with the LLM section.
> 8. **Figure 5 (domain frequency)** — Convert to a proper bar chart showing the count of methodological approaches across the 22 papers.

---

*End of Literature Survey — Draft Version 1.0*

