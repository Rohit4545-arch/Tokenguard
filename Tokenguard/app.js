const MODELS = {
  "gpt-4.1-mini": { input: 0.4, output: 1.6, latency: [650, 1300] },
  "gpt-4.1": { input: 2, output: 8, latency: [1200, 2600] },
  "o3": { input: 10, output: 40, latency: [2400, 5200] }
};

const seedPrompts = [
  ["Support Copilot", "Customer Ops", "Summarize this refund request and draft a concise reply."],
  ["Sales Email Writer", "Growth", "Rewrite this follow-up email in a warmer tone with one clear CTA."],
  ["Code Review Assistant", "Engineering", "Analyze this pull request for concurrency bugs, API contract risk, and missing tests. Return prioritized findings."],
  ["Research Agent", "Product", "Compare three approaches for semantic caching in an LLM gateway and recommend a rollout plan."],
  ["Data Analyst", "Product", "Summarize weekly usage anomalies and explain likely causes for the cost spike."],
  ["Support Copilot", "Customer Ops", "Summarize this refund request and draft a concise response."],
  ["Research Agent", "Engineering", "Break down a 40-step agent workflow and identify repeated prompt sections that should be cached."]
];

const state = {
  requests: JSON.parse(localStorage.getItem("tokenguard:requests") || "[]")
};

const $ = (id) => document.getElementById(id);
const money = (value) => `$${value.toFixed(value >= 100 ? 0 : 2)}`;
const percent = (value) => `${Math.round(value * 100)}%`;
const randomBetween = ([min, max]) => Math.round(min + Math.random() * (max - min));

function estimateTokens(prompt) {
  const words = prompt.trim().split(/\s+/).filter(Boolean).length;
  const input = Math.max(28, Math.round(words * 1.35) + 18);
  const output = Math.max(42, Math.round(input * (0.55 + Math.random() * 0.55)));
  return { input, output, total: input + output };
}

function classifyPrompt(prompt) {
  const lower = prompt.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean).length;
  const complexSignals = ["analyze", "compare", "strategy", "architecture", "debug", "agent", "risk", "plan", "reason", "tradeoff"];
  const signalScore = complexSignals.filter((word) => lower.includes(word)).length;

  if (words > 36 || signalScore >= 3) {
    return {
      complexity: "complex",
      model: "o3",
      reason: "Routed to the reasoning model because the request is long or asks for multi-step analysis."
    };
  }

  if (words > 18 || signalScore >= 1) {
    return {
      complexity: "medium",
      model: "gpt-4.1",
      reason: "Routed to the balanced model because the prompt needs judgment but not deep reasoning."
    };
  }

  return {
    complexity: "simple",
    model: "gpt-4.1-mini",
    reason: "Routed to the low-cost model because the prompt is short and transformation-oriented."
  };
}

function costFor(model, tokens) {
  const pricing = MODELS[model];
  return (tokens.input / 1_000_000) * pricing.input + (tokens.output / 1_000_000) * pricing.output;
}

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function similarity(a, b) {
  const left = new Set(normalize(a));
  const right = new Set(normalize(b));
  if (!left.size || !right.size) return 0;
  const overlap = [...left].filter((word) => right.has(word)).length;
  return overlap / Math.max(left.size, right.size);
}

function findCacheHit(prompt) {
  return state.requests.find((request) => similarity(prompt, request.prompt) >= 0.72);
}

function logRequest({ feature, team, prompt, cacheEnabled }) {
  const route = classifyPrompt(prompt);
  const cached = cacheEnabled ? findCacheHit(prompt) : null;
  const tokens = estimateTokens(prompt);
  const premiumCost = costFor("o3", tokens);
  const liveCost = costFor(route.model, tokens);
  const cost = cached ? 0 : liveCost;
  const saved = cached ? cached.cost || liveCost : Math.max(0, premiumCost - liveCost);
  const request = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    feature,
    team,
    prompt,
    model: cached ? cached.model : route.model,
    complexity: cached ? "cached" : route.complexity,
    reason: cached ? "Served from semantic cache because this prompt closely matches an earlier request." : route.reason,
    inputTokens: cached ? 0 : tokens.input,
    outputTokens: cached ? 0 : tokens.output,
    totalTokens: cached ? 0 : tokens.total,
    usefulOutputTokens: cached ? 0 : Math.round(tokens.output * (0.74 + Math.random() * 0.16)),
    latency: cached ? randomBetween([45, 130]) : randomBetween(MODELS[route.model].latency),
    cost,
    saved,
    cached: Boolean(cached)
  };

  state.requests.unshift(request);
  state.requests = state.requests.slice(0, 80);
  persist();
  render(request);
}

function persist() {
  localStorage.setItem("tokenguard:requests", JSON.stringify(state.requests));
}

function seedData() {
  state.requests = [];
  seedPrompts.forEach(([feature, team, prompt]) => {
    logRequest({ feature, team, prompt, cacheEnabled: true });
  });
}

function render(latest = state.requests[0]) {
  renderMetrics();
  renderTable();
  renderInsights();
  renderDecision(latest);
}

function renderMetrics() {
  const totalSpend = state.requests.reduce((sum, item) => sum + item.cost, 0);
  const totalSaved = state.requests.reduce((sum, item) => sum + item.saved, 0);
  const totalCalls = Math.max(state.requests.length, 1);
  const useful = state.requests.reduce((sum, item) => sum + item.usefulOutputTokens, 0);
  const tokens = state.requests.reduce((sum, item) => sum + item.totalTokens, 0);
  const cacheHits = state.requests.filter((item) => item.cached).length;

  $("totalSpend").textContent = money(totalSpend);
  $("costPerThousand").textContent = money((totalSpend / totalCalls) * 1000);
  $("tokenEfficiency").textContent = tokens ? percent(useful / tokens) : "0%";
  $("cacheHitRate").textContent = percent(cacheHits / totalCalls);
  $("cacheSavings").textContent = `${money(totalSaved)} saved`;
  $("monthlyWaste").textContent = money(totalSaved * 30);
  $("spendDelta").textContent = `${state.requests.length} calls logged`;
}

function renderDecision(latest) {
  if (!latest) return;

  $("decisionTitle").textContent = latest.cached ? "Cache hit avoided an API call" : "Request routed successfully";
  $("decisionBadge").textContent = latest.cached ? "Cached" : "Routed";
  $("decisionBadge").className = `badge ${latest.cached ? "cache" : "routed"}`;
  $("decisionModel").textContent = latest.model;
  $("decisionComplexity").textContent = latest.complexity;
  $("decisionCost").textContent = money(latest.cost);
  $("decisionLatency").textContent = `${latest.latency} ms`;
  $("decisionReason").textContent = latest.reason;
}

function renderTable() {
  $("requestTable").innerHTML = state.requests
    .map((item) => {
      const time = new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `
        <tr>
          <td>${time}</td>
          <td><strong>${item.feature}</strong><span>${item.complexity}</span></td>
          <td>${item.team}</td>
          <td>${item.model}</td>
          <td>${item.totalTokens.toLocaleString()}</td>
          <td>${money(item.cost)}</td>
          <td class="${item.cached ? "status-cache" : "status-live"}">${item.cached ? "cache hit" : "live"}</td>
        </tr>
      `;
    })
    .join("");
}

function renderInsights() {
  const byFeature = state.requests.reduce((map, request) => {
    map[request.feature] = (map[request.feature] || 0) + request.cost;
    return map;
  }, {});
  const expensiveFeature = Object.entries(byFeature).sort((a, b) => b[1] - a[1])[0];
  const premiumCalls = state.requests.filter((item) => item.model === "o3" && !item.cached).length;
  const duplicateCount = state.requests.filter((item) => item.cached).length;
  const totalSaved = state.requests.reduce((sum, item) => sum + item.saved, 0);

  const insights = [
    expensiveFeature
      ? {
          tone: "warn",
          title: `${expensiveFeature[0]} is the top spend driver`,
          body: `${money(expensiveFeature[1])} logged so far. Review its prompts for repeated context and oversized system instructions.`
        }
      : {
          tone: "good",
          title: "No spend yet",
          body: "Send a request to begin building a baseline before optimization."
        },
    {
      tone: premiumCalls > 2 ? "warn" : "good",
      title: `${premiumCalls} premium-model calls`,
      body: premiumCalls > 2 ? "Consider stricter routing thresholds for repetitive analysis work." : "Premium model usage is contained by the router."
    },
    {
      tone: duplicateCount ? "good" : "warn",
      title: `${duplicateCount} semantic cache hits`,
      body: duplicateCount ? `${money(totalSaved)} in avoided or reduced spend is visible in this sample.` : "Near-duplicate prompts have not hit the cache yet."
    }
  ];

  $("insightList").innerHTML = insights
    .map((insight) => `
      <article class="insight ${insight.tone}">
        <strong>${insight.title}</strong>
        <p>${insight.body}</p>
      </article>
    `)
    .join("");
}

$("requestForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const prompt = $("promptInput").value.trim();
  if (!prompt) {
    $("promptInput").focus();
    return;
  }

  logRequest({
    feature: $("featureInput").value,
    team: $("teamInput").value,
    prompt,
    cacheEnabled: $("cacheToggle").checked
  });
});

$("seedDataButton").addEventListener("click", seedData);
$("clearButton").addEventListener("click", () => {
  state.requests = [];
  persist();
  render();
});

if (!state.requests.length) {
  seedData();
} else {
  render();
}
