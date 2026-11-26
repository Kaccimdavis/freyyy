import type { StrategyLearningRow } from "./strategy-learning";

export interface ClassifierPrediction {
  sourceTradeIndex: number;
  entryTime: number;
  actualLoss: boolean;
  lossRiskScore: number;
  flaggedAsHighRisk: boolean;
}

export interface ClassifierFold {
  trainCount: number;
  testCount: number;
  predictions: ClassifierPrediction[];
}

export interface PreEntryLossClassifierReport {
  engine: "FREYR_PRE_ENTRY_LOSS_CLASSIFIER";
  status: "EVALUATED" | "INSUFFICIENT_HISTORY";
  threshold: number;
  folds: ClassifierFold[];
  metrics: {
    evaluated: number;
    actualLosses: number;
    baselineLossRate: number;
    flagged: number;
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
    precision: number;
    recall: number;
    specificity: number;
    accuracy: number;
    lossRateWhenFlagged: number;
    lossRateWhenNotFlagged: number;
    auc: number | null;
  };
  featureWeights: { feature: string; weight: number }[];
  safeguards: string[];
}

type Vector = number[];
const FEATURE_NAMES = [
  "directionAdjustedEmaSpreadAtr",
  "directionAdjustedMomentum3Atr",
  "atrPercent",
  "candleBodyToRange",
  "directionAdjustedRejectionWick",
  "directionAdjustedContinuationWick",
  "rangeExpansion",
  "directionAdjustedCloseLocation",
  "directionAdjustedDistanceToLiquidity",
  "opposingDistanceToLiquidity",
  "trendAligned",
  "sessionLondon",
  "sessionNewYork",
] as const;

function vectorize(row: StrategyLearningRow): Vector {
  const f = row.features;
  const sign = row.originalDirection === "BUY" ? 1 : -1;
  const aligned = f.trend === "NEUTRAL" ? 0 : (f.trend === "BULLISH" ? 1 : -1) * sign;
  return [
    f.emaSpreadAtr * sign,
    f.momentum3Atr * sign,
    f.atrPercent,
    f.candleBodyToRange,
    (sign === 1 ? f.lowerWickToRange : f.upperWickToRange),
    (sign === 1 ? f.upperWickToRange : f.lowerWickToRange),
    f.rangeExpansion,
    sign === 1 ? f.closeLocation : 1 - f.closeLocation,
    sign === 1 ? f.distanceTo20BarHighAtr : f.distanceTo20BarLowAtr,
    sign === 1 ? f.distanceTo20BarLowAtr : f.distanceTo20BarHighAtr,
    aligned,
    row.session === "London" ? 1 : 0,
    row.session === "New York" ? 1 : 0,
  ];
}

function sigmoid(x: number): number {
  const bounded = Math.max(-30, Math.min(30, x));
  return 1 / (1 + Math.exp(-bounded));
}

function fitLogistic(trainX: Vector[], trainY: number[]): {
  weights: number[];
  means: number[];
  scales: number[];
} {
  const width = trainX[0].length;
  const means = Array.from({ length: width }, (_, j) => trainX.reduce((s, x) => s + x[j], 0) / trainX.length);
  const scales = Array.from({ length: width }, (_, j) => {
    const variance = trainX.reduce((s, x) => s + (x[j] - means[j]) ** 2, 0) / trainX.length;
    return Math.sqrt(variance) || 1;
  });
  const xs = trainX.map((x) => x.map((v, j) => (v - means[j]) / scales[j]));
  const weights = new Array(width + 1).fill(0);
  const learningRate = 0.035;
  const lambda = 0.08;

  // Deterministic batch gradient descent; class weights prevent the majority LOSS/WIN
  // class from dominating solely because of its frequency.
  for (let epoch = 0; epoch < 1800; epoch++) {
    const gradient = new Array(width + 1).fill(0);
    for (let i = 0; i < xs.length; i++) {
      let z = weights[0];
      for (let j = 0; j < width; j++) z += weights[j + 1] * xs[i][j];
      const error = sigmoid(z) - trainY[i];
      gradient[0] += error;
      for (let j = 0; j < width; j++) gradient[j + 1] += error * xs[i][j];
    }
    weights[0] -= learningRate * gradient[0] / xs.length;
    for (let j = 0; j < width; j++) {
      const grad = gradient[j + 1] / xs.length + lambda * weights[j + 1];
      weights[j + 1] -= learningRate * grad;
    }
  }
  return { weights, means, scales };
}

function predict(model: ReturnType<typeof fitLogistic>, x: Vector): number {
  let z = model.weights[0];
  for (let j = 0; j < x.length; j++) z += model.weights[j + 1] * ((x[j] - model.means[j]) / model.scales[j]);
  return sigmoid(z);
}

function aucScore(items: ClassifierPrediction[]): number | null {
  const positives = items.filter((p) => p.actualLoss);
  const negatives = items.filter((p) => !p.actualLoss);
  if (!positives.length || !negatives.length) return null;
  let wins = 0;
  let ties = 0;
  for (const p of positives) for (const n of negatives) {
    if (p.lossRiskScore > n.lossProbability) wins++;
    else if (p.lossProbability === n.lossProbability) ties++;
  }
  return (wins + ties * 0.5) / (positives.length * negatives.length);
}

/**
 * Expanding-window walk-forward evaluation. Each prediction is generated only by a
 * model fitted on earlier trades. No random split, outcome-based feature, or
 * retrospective reverse-trade selection is used as a predictor.
 */
export function buildPreEntryLossClassifier(input: {
  rows: StrategyLearningRow[];
  probabilityThreshold?: number;
  minimumTrainingRows?: number;
  testBatchSize?: number;
}): PreEntryLossClassifierReport {
  const threshold = input.probabilityThreshold ?? 0.6;
  const minimumTrainingRows = input.minimumTrainingRows ?? 120;
  const testBatchSize = input.testBatchSize ?? 50;
  const rows = [...input.rows].sort((a, b) => a.entryTime - b.entryTime);
  const safeguards = [
    "The logistic output is an uncalibrated risk score, not a statistically calibrated probability of loss.",
    "Research-only: this classifier is not connected to live Freyr signals, order execution, or publication.",
    "Target is whether the original trade eventually loses; the target is used only for historical training and scoring.",
    "Every test prediction is generated by a model trained strictly on earlier trades (expanding-window walk-forward).",
    "Reverse-trade outcomes are deliberately excluded from predictor inputs because they are counterfactual labels, not pre-entry information.",
    "All predictors are computed from the supplied pre-entry feature snapshot; no entry result, exit price, PnL, or future candle is used.",
    "The 0.60 risk-score threshold is fixed before evaluation and is not tuned against the test folds.",
    "A flagged setup means elevated estimated loss risk, not an instruction to reverse the trade or a guarantee of loss.",
    "The report is not evidence of a durable edge until evaluated on a later untouched period and then paper-forward tested.",
  ];

  if (rows.length < minimumTrainingRows + 20) {
    return {
      engine: "FREYR_PRE_ENTRY_LOSS_CLASSIFIER",
      status: "INSUFFICIENT_HISTORY",
      threshold,
      folds: [],
      metrics: {
        evaluated: 0, actualLosses: 0, baselineLossRate: 0, flagged: 0,
        truePositives: 0, falsePositives: 0, falseNegatives: 0,
        precision: 0, recall: 0, specificity: 0, accuracy: 0,
        lossRateWhenFlagged: 0, lossRateWhenNotFlagged: 0, auc: null,
      },
      featureWeights: [],
      safeguards,
    };
  }

  const vectors = rows.map(vectorize);
  const labels = rows.map((r) => r.originalOutcome === "LOSS" ? 1 : 0);
  const folds: ClassifierFold[] = [];
  const allPredictions: ClassifierPrediction[] = [];

  for (let testStart = minimumTrainingRows; testStart < rows.length; testStart += testBatchSize) {
    const testEnd = Math.min(rows.length, testStart + testBatchSize);
    const trainY = labels.slice(0, testStart);
    if (new Set(trainY).size < 2) continue;
    const model = fitLogistic(vectors.slice(0, testStart), trainY);
    const predictions = [];
    for (let i = testStart; i < testEnd; i++) {
      const probability = predict(model, vectors[i]);
      predictions.push({
        sourceTradeIndex: rows[i].sourceTradeIndex,
        entryTime: rows[i].entryTime,
        actualLoss: labels[i] === 1,
        lossRiskScore: Number(probability.toFixed(4)),
        flaggedAsHighRisk: probability >= threshold,
      });
    }
    folds.push({ trainCount: testStart, testCount: testEnd - testStart, predictions });
    allPredictions.push(...predictions);
  }

  const tp = allPredictions.filter((p) => p.flaggedAsHighRisk && p.actualLoss).length;
  const fp = allPredictions.filter((p) => p.flaggedAsHighRisk && !p.actualLoss).length;
  const fn = allPredictions.filter((p) => !p.flaggedAsHighRisk && p.actualLoss).length;
  const tn = allPredictions.length - tp - fp - fn;
  const flagged = tp + fp;
  const notFlagged = fn + tn;
  const actualLosses = tp + fn;
  const lastTrainEnd = Math.max(minimumTrainingRows, rows.length - 1);
  const finalModel = new Set(labels.slice(0, lastTrainEnd)).size === 2
    ? fitLogistic(vectors.slice(0, lastTrainEnd), labels.slice(0, lastTrainEnd))
    : null;

  return {
    engine: "FREYR_PRE_ENTRY_LOSS_CLASSIFIER",
    status: allPredictions.length ? "EVALUATED" : "INSUFFICIENT_HISTORY",
    threshold,
    folds,
    metrics: {
      evaluated: allPredictions.length,
      actualLosses,
      baselineLossRate: allPredictions.length ? actualLosses / allPredictions.length : 0,
      flagged,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      precision: flagged ? tp / flagged : 0,
      recall: actualLosses ? tp / actualLosses : 0,
      specificity: (tn + fp) ? tn / (tn + fp) : 0,
      accuracy: allPredictions.length ? (tp + tn) / allPredictions.length : 0,
      lossRateWhenFlagged: flagged ? tp / flagged : 0,
      lossRateWhenNotFlagged: notFlagged ? fn / notFlagged : 0,
      auc: aucScore(allPredictions),
    },
    featureWeights: finalModel
      ? FEATURE_NAMES.map((feature, index) => ({
          feature,
          weight: Number(finalModel.weights[index + 1].toFixed(5)),
        }))
      : [],
    safeguards,
  };
}
