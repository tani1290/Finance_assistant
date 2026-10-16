/**
 * FinPro — Real Machine Learning Transaction Categorization Engine
 * In-process high-speed inference with TF-IDF and Softmax Logistic Regression
 * Trained via Python Scikit-Learn Pipeline with User Feedback Active Learning
 * Owner: Jinay Golecha (jinay_golecha)
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const prisma = require('../config/database');

const ARTIFACTS_PATH = path.join(__dirname, '..', '..', 'ml_engine', 'model_artifacts.json');
const PYTHON_PATH = path.join(__dirname, '..', '..', '..', '.venv', 'Scripts', 'python.exe');
const TRAIN_SCRIPT = path.join(__dirname, '..', '..', 'ml_engine', 'train_transaction_classifier.py');

class MLCategorizerService {
  constructor() {
    this.artifacts = null;
    this.confidenceThreshold = 0.50; // Threshold below which category requires review
    this.loadArtifacts();
  }

  loadArtifacts() {
    try {
      if (fs.existsSync(ARTIFACTS_PATH)) {
        const raw = fs.readFileSync(ARTIFACTS_PATH, 'utf8');
        this.artifacts = JSON.parse(raw);
        console.log(`[ML] Loaded transaction classifier model (${this.artifacts.classes.length} classes, acc: ${(this.artifacts.metrics.accuracy * 100).toFixed(1)}%)`);
      } else {
        console.warn('[ML] Model artifacts not found yet at:', ARTIFACTS_PATH);
      }
    } catch (err) {
      console.error('[ML] Failed to load model artifacts:', err.message);
    }
  }

  tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    const normalized = text.toLowerCase().replace(/[^\w\s]/g, ' ');
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const ngrams = [...tokens];
    // Add bigrams
    for (let i = 0; i < tokens.length - 1; i++) {
      ngrams.push(`${tokens[i]} ${tokens[i + 1]}`);
    }
    return ngrams;
  }

  predict(description, amount = 0, transactionType = 'EXPENSE') {
    if (!this.artifacts) {
      this.loadArtifacts();
    }

    if (!this.artifacts || !description) {
      return {
        category: 'General',
        predictedCategory: 'General',
        confidence: 0,
        status: 'UNAVAILABLE',
        source: 'fallback_heuristic',
      };
    }

    const { classes, vocabulary, idf, coef, intercept } = this.artifacts;
    const tokens = this.tokenize(description);

    // Compute TF
    const tf = {};
    for (const t of tokens) {
      tf[t] = (tf[t] || 0) + 1;
    }

    // Sparse TF-IDF Vector
    const featureIndices = [];
    const featureValues = [];
    let normSq = 0;

    for (const [token, count] of Object.entries(tf)) {
      if (vocabulary[token] !== undefined) {
        const idx = vocabulary[token];
        const sublinearTf = 1 + Math.log(count);
        const tfidfVal = sublinearTf * idf[idx];
        featureIndices.push(idx);
        featureValues.push(tfidfVal);
        normSq += tfidfVal * tfidfVal;
      }
    }

    // L2 Normalization
    const l2Norm = Math.sqrt(normSq) || 1.0;
    const normalizedValues = featureValues.map(v => v / l2Norm);

    // Compute log-odds for each class: score_k = intercept_k + sum(coef_k,j * x_j)
    const numClasses = classes.length;
    const logits = new Array(numClasses);

    for (let k = 0; k < numClasses; k++) {
      let score = intercept[k] || 0;
      const classCoef = coef[k];
      for (let f = 0; f < featureIndices.length; f++) {
        score += classCoef[featureIndices[f]] * normalizedValues[f];
      }
      logits[k] = score;
    }

    // Softmax to obtain true probabilities
    const maxLogit = Math.max(...logits);
    const expScores = logits.map(l => Math.exp(l - maxLogit));
    const sumExp = expScores.reduce((a, b) => a + b, 0);
    const probs = expScores.map(e => e / sumExp);

    // Find best class
    let bestIdx = 0;
    let maxProb = 0;
    for (let i = 0; i < numClasses; i++) {
      if (probs[i] > maxProb) {
        maxProb = probs[i];
        bestIdx = i;
      }
    }

    const predictedClass = classes[bestIdx];

    // Confidence is a 0–1 probability — NOT a percentage. This must stay a
    // fraction because it is compared against `confidenceThreshold` (0.50),
    // persisted to `PendingSmsTransaction.confidence` (@db.Decimal(5,4), whose
    // maximum magnitude is 9.9999), and rendered by both clients as a fraction
    // (web: `confidence * 100`; mobile: parsed as a double defaulting to 0.8).
    // Emitting a percentage here used to overflow that column and fail the
    // entire SMS ingestion with a 500 whenever the ML fallback was reached.
    const confidence = Math.round(maxProb * 1000) / 1000;
    const isConfident = maxProb >= this.confidenceThreshold;

    // Top 3 candidate classes (probabilities, also 0–1).
    const topCandidates = classes
      .map((c, i) => ({ category: c, probability: Math.round(probs[i] * 1000) / 1000 }))
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 3);

    return {
      category: isConfident ? predictedClass : 'Needs Review',
      predictedCategory: predictedClass,
      confidence,
      isConfident,
      status: isConfident ? 'HIGH_CONFIDENCE' : 'NEEDS_REVIEW',
      topCandidates,
      source: 'supervised_logistic_regression_ml',
      modelMetrics: this.artifacts.metrics,
    };
  }

  /**
   * User Feedback Loop: Store corrected category feedback in PostgreSQL
   * Enables active learning and future retraining
   */
  async recordCorrection({ userId, transactionId, merchant, description, originalCategory, correctedCategory }) {
    if (!userId || !correctedCategory) return null;
    try {
      return await prisma.transactionCategoryCorrection.create({
        data: {
          userId,
          merchant: merchant || null,
          description: description || null,
          originalCategory: originalCategory || 'General',
          correctedCategory,
        },
      });
    } catch (err) {
      console.warn('[ML] Notice recording category correction:', err.message);
      return null;
    }
  }

  async recordFeedback({ userId, transactionId, originalPrediction, correctedCategory, confidence, text }) {
    return this.recordCorrection({
      userId,
      transactionId,
      merchant: text,
      description: text,
      originalCategory: originalPrediction,
      correctedCategory,
    });
  }

  /**
   * Triggers the offline Python retraining pipeline with latest corrections
   */
  async retrainModel() {
    return new Promise((resolve, reject) => {
      const pyExe = fs.existsSync(PYTHON_PATH) ? PYTHON_PATH : 'python';
      const child = spawn(pyExe, [TRAIN_SCRIPT], { cwd: path.dirname(TRAIN_SCRIPT) });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', d => (stdout += d));
      child.stderr.on('data', d => (stderr += d));

      child.on('close', code => {
        if (code === 0) {
          this.loadArtifacts();
          resolve({ success: true, stdout, metrics: this.artifacts?.metrics });
        } else {
          reject(new Error(`Retraining exited with code ${code}: ${stderr || stdout}`));
        }
      });
    });
  }

  getModelStatus() {
    return {
      ready: !!this.artifacts,
      algorithm: 'Supervised Logistic Regression with TF-IDF',
      classes: this.artifacts?.classes || [],
      classCount: this.artifacts?.classes?.length || 0,
      metrics: this.artifacts?.metrics || null,
      confidenceThreshold: this.confidenceThreshold,
    };
  }

  getStats() {
    return {
      modelLoaded: !!this.artifacts,
      algorithm: 'Supervised Logistic Regression with TF-IDF',
      classesCount: this.artifacts?.classes?.length || 0,
      featuresCount: Object.keys(this.artifacts?.vocabulary || {}).length,
      feedbackCount: 0,
      metrics: this.artifacts?.metrics || null,
    };
  }
}

const mlCategorizerService = new MLCategorizerService();
module.exports = mlCategorizerService;
