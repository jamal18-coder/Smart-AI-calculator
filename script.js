/* ============================================================
   NOVA SMART CALCULATOR — SCRIPT
   Organized into clearly commented sections:
   1. State & DOM refs
   2. Expression engine (parsing/evaluation)
   3. Display & input handling
   4. Button ripple + sound effects
   5. History (localStorage)
   6. Natural language ("AI") parser
   7. Voice input/output (Web Speech API)
   8. Auto-suggestions
   9. Tools (currency/unit/age/EMI/BMI)
   10. Theme switcher
   11. Background particles
   12. Keyboard support
   13. Init
   ============================================================ */

/* ===================== 1. STATE & DOM REFS ===================== */

const state = {
  expression: '',        // raw expression string shown/edited
  lastResult: null,      // last computed numeric result
  mode: 'standard',      // 'standard' | 'scientific' | 'ai'
  history: [],           // [{expr, result, time}]
  isListening: false,
};

const el = {
  expression: document.getElementById('expression'),
  result: document.getElementById('result'),
  ghostPreview: document.getElementById('ghostPreview'),
  display: document.getElementById('display'),
  keypad: document.getElementById('keypad'),
  sciRow: document.getElementById('sciRow'),
  aiPanel: document.getElementById('aiPanel'),
  aiInput: document.getElementById('aiInput'),
  aiSend: document.getElementById('aiSend'),
  aiSuggestions: document.getElementById('aiSuggestions'),
  aiAnswer: document.getElementById('aiAnswer'),
  modePills: document.querySelectorAll('.mode-pill'),
  historyPanel: document.getElementById('historyPanel'),
  historyList: document.getElementById('historyList'),
  historySearch: document.getElementById('historySearch'),
  historyToggle: document.getElementById('historyToggle'),
  closeHistory: document.getElementById('closeHistory'),
  clearHistory: document.getElementById('clearHistory'),
  toolsPanel: document.getElementById('toolsPanel'),
  toolsToggle: document.getElementById('toolsToggle'),
  closeTools: document.getElementById('closeTools'),
  toolsGrid: document.getElementById('toolsGrid'),
  toolContent: document.getElementById('toolContent'),
  themeToggle: document.getElementById('themeToggle'),
  themeIcon: document.getElementById('themeIcon'),
  micBtn: document.getElementById('micBtn'),
  copyBtn: document.getElementById('copyBtn'),
  speakBtn: document.getElementById('speakBtn'),
  aiOrb: document.getElementById('aiOrb'),
  toast: document.getElementById('toast'),
  particlesCanvas: document.getElementById('particles'),
};

/* ===================== 2. EXPRESSION ENGINE ===================== */

/**
 * Converts our display-friendly symbols (×, ÷, π, e) into JS-evaluable
 * tokens, then safely evaluates using a hand-rolled recursive-descent
 * parser (NOT eval/Function — keeps things safe and lets us support
 * factorial, implicit multiplication, and scientific functions cleanly).
 */
class CalcError extends Error {}

function tokenize(expr) {
  // Normalize visual operators to internal tokens
  const cleaned = expr
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/π/g, 'PI')
    .replace(/√/g, 'sqrt')
    .replace(/\s+/g, '');

  const tokens = [];
  let i = 0;
  const isDigit = (c) => c >= '0' && c <= '9';
  const isAlpha = (c) => /[a-zA-Z]/.test(c);

  while (i < cleaned.length) {
    const c = cleaned[i];

    if (isDigit(c) || c === '.') {
      let num = '';
      while (i < cleaned.length && (isDigit(cleaned[i]) || cleaned[i] === '.')) {
        num += cleaned[i];
        i++;
      }
      tokens.push({ type: 'num', value: parseFloat(num) });
      continue;
    }

    if (isAlpha(c)) {
      let word = '';
      while (i < cleaned.length && isAlpha(cleaned[i])) {
        word += cleaned[i];
        i++;
      }
      tokens.push({ type: 'word', value: word });
      continue;
    }

    if ('+-*/^!%()'.includes(c)) {
      tokens.push({ type: 'op', value: c });
      i++;
      continue;
    }

    // Unknown character — skip defensively
    i++;
  }
  return tokens;
}

/**
 * Recursive-descent parser/evaluator.
 * Grammar (highest to lowest precedence handled innermost):
 *   expr   := term (('+'|'-') term)*
 *   term   := factor (('*'|'/') factor)*
 *   factor := unary ('^' unary)*      (right-assoc power)
 *   unary  := ('-')? postfix
 *   postfix:= primary ('!' | '%')*
 *   primary:= number | constant | function '(' expr ')' | '(' expr ')'
 */
function evaluateExpression(rawExpr) {
  if (!rawExpr || !rawExpr.trim()) return 0;

  const tokens = tokenize(rawExpr);
  let pos = 0;

  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  function parseExpr() {
    let left = parseTerm();
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = consume().value;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm() {
    let left = parseFactor();
    while (
      peek() &&
      (
        (peek().type === 'op' && (peek().value === '*' || peek().value === '/')) ||
        (peek().type === 'num') ||
        (peek().type === 'word') ||
        (peek().type === 'op' && peek().value === '(')
      )
    ) {
      if (peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
        const op = consume().value;
        const right = parseFactor();
        left = op === '*' ? left * right : safeDivide(left, right);
      } else {
        // implicit multiplication, e.g. "2π", "3(4+5)", "2sqrt(4)"
        const right = parseFactor();
        left = left * right;
      }
    }
    return left;
  }

  function parseFactor() {
    let base = parseUnary();
    if (peek() && peek().type === 'op' && peek().value === '^') {
      consume();
      const exponent = parseFactor(); // right-associative
      base = Math.pow(base, exponent);
    }
    return base;
  }

  function parseUnary() {
    if (peek() && peek().type === 'op' && peek().value === '-') {
      consume();
      return -parsePostfix();
    }
    if (peek() && peek().type === 'op' && peek().value === '+') {
      consume();
      return parsePostfix();
    }
    return parsePostfix();
  }

  function parsePostfix() {
    let value = parsePrimary();
    while (peek() && peek().type === 'op' && (peek().value === '!' || peek().value === '%')) {
      const op = consume().value;
      value = op === '!' ? factorial(value) : value / 100;
    }
    return value;
  }

  function parsePrimary() {
    const tok = peek();
    if (!tok) throw new CalcError('Unexpected end of expression');

    if (tok.type === 'num') {
      consume();
      return tok.value;
    }

    if (tok.type === 'op' && tok.value === '(') {
      consume();
      const value = parseExpr();
      if (!(peek() && peek().type === 'op' && peek().value === ')')) {
        throw new CalcError('Missing closing bracket');
      }
      consume(); // ')'
      return value;
    }

    if (tok.type === 'word') {
      consume();
      const fn = tok.value.toLowerCase();

      // Constants
      if (fn === 'pi') return Math.PI;
      if (fn === 'e') return Math.E;

      // Functions expect a following parenthesized argument
      if (peek() && peek().type === 'op' && peek().value === '(') {
        consume(); // '('
        const arg = parseExpr();
        if (!(peek() && peek().type === 'op' && peek().value === ')')) {
          throw new CalcError('Missing closing bracket');
        }
        consume(); // ')'
        return applyFunction(fn, arg);
      }
      throw new CalcError('Unknown identifier "' + fn + '"');
    }

    throw new CalcError('Unexpected token');
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new CalcError('Unexpected trailing input');
  if (typeof result !== 'number' || !isFinite(result)) throw new CalcError('Math error');
  return result;
}

function safeDivide(a, b) {
  if (b === 0) throw new CalcError('Cannot divide by zero');
  return a / b;
}

function factorial(n) {
  if (n < 0 || Math.floor(n) !== n) throw new CalcError('Factorial needs a non-negative integer');
  if (n > 170) throw new CalcError('Number too large');
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

// sin/cos/tan operate in degrees, matching typical calculator-app UX
function applyFunction(name, arg) {
  switch (name) {
    case 'sin': return Math.sin(degToRad(arg));
    case 'cos': return Math.cos(degToRad(arg));
    case 'tan': return Math.tan(degToRad(arg));
    case 'log': return Math.log10(arg);
    case 'ln': return Math.log(arg);
    case 'sqrt':
      if (arg < 0) throw new CalcError('Cannot take square root of a negative number');
      return Math.sqrt(arg);
    default: throw new CalcError('Unknown function "' + name + '"');
  }
}

function degToRad(deg) { return (deg * Math.PI) / 180; }

/* ===================== 3. DISPLAY & INPUT HANDLING ===================== */

function renderExpression() {
  el.expression.textContent = state.expression;
  updateGhostPreview();
}

/** Live calculation preview shown faintly under the main result */
function updateGhostPreview() {
  if (!state.expression.trim()) {
    el.ghostPreview.classList.remove('show');
    return;
  }
  try {
    const value = evaluateExpression(state.expression);
    el.ghostPreview.textContent = '= ' + formatNumber(value);
    el.ghostPreview.classList.add('show');
  } catch {
    el.ghostPreview.classList.remove('show');
  }
}

function formatNumber(n) {
  if (Number.isInteger(n)) return n.toString();
  // Avoid long floating point tails; trim to 10 significant digits
  return parseFloat(n.toPrecision(10)).toString();
}

/** Number counting animation: briefly pops the display text as it lands */
function animateResultIn(text) {
  el.result.textContent = text;
  el.result.classList.remove('count-up');
  void el.result.offsetWidth; // restart animation
  el.result.classList.add('count-up');
}

function showError(message) {
  el.result.textContent = 'Error';
  el.result.classList.add('error');
  setTimeout(() => el.result.classList.remove('error'), 400);
  showToast(message || 'Something went wrong');
}

function appendToExpression(value) {
  state.expression += value;
  renderExpression();
}

function clearAll() {
  state.expression = '';
  state.lastResult = null;
  el.result.textContent = '0';
  el.expression.textContent = '';
  el.ghostPreview.classList.remove('show');
}

function backspace() {
  state.expression = state.expression.slice(0, -1);
  renderExpression();
}

function calculatePercent() {
  appendToExpression('%');
}

function runEquals() {
  if (!state.expression.trim()) return;
  try {
    const value = evaluateExpression(state.expression);
    const formatted = formatNumber(value);

    el.display.classList.add('calculating'); // triggers glow pulse
    setTimeout(() => el.display.classList.remove('calculating'), 650);

    animateResultIn(formatted);
    addHistory(state.expression, formatted);

    state.lastResult = value;
    state.expression = formatted; // allow chaining further ops on the result
    el.expression.textContent = state.expression + ' =';
    el.ghostPreview.classList.remove('show');
  } catch (err) {
    showError(err.message);
  }
}

/* Button click router */
function handleButton(btn) {
  const value = btn.dataset.value;
  const action = btn.dataset.action;

  if (value !== undefined) {
    appendToExpression(value);
    return;
  }

  switch (action) {
    case 'clear': clearAll(); break;
    case 'backspace': backspace(); break;
    case 'percent': calculatePercent(); break;
    case 'equals': runEquals(); break;
    case 'sqrt': appendToExpression('√('); break;
    case 'sin': appendToExpression('sin('); break;
    case 'cos': appendToExpression('cos('); break;
    case 'tan': appendToExpression('tan('); break;
    case 'log': appendToExpression('log('); break;
    case 'ln': appendToExpression('ln('); break;
    case 'pow': appendToExpression('^'); break;
    case 'fact': appendToExpression('!'); break;
  }
}

/* ===================== 4. RIPPLE + SOUND EFFECTS ===================== */

/**
 * Lightweight click sound synthesized via WebAudio — no external assets
 * needed, keeps the app self-contained and production-friendly.
 */
let audioCtx = null;
function playClickSound() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 720;
    gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.08);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.08);
  } catch {
    /* Audio not available — fail silently, never block functionality */
  }
}

function spawnRipple(target, clientX, clientY) {
  const rect = target.getBoundingClientRect();
  const ripple = document.createElement('span');
  const size = Math.max(rect.width, rect.height) * 1.2;
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = size + 'px';
  ripple.style.left = ((clientX ?? rect.left + rect.width / 2) - rect.left - size / 2) + 'px';
  ripple.style.top = ((clientY ?? rect.top + rect.height / 2) - rect.top - size / 2) + 'px';
  target.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}

function bindButtonEffects(container) {
  container.querySelectorAll('.btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      spawnRipple(btn, e.clientX, e.clientY);
      playClickSound();
      handleButton(btn);
    });
  });
}

/* ===================== 5. HISTORY (localStorage) ===================== */

const HISTORY_KEY = 'nova_calc_history';

function loadHistory() {
  try {
    state.history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    state.history = [];
  }
}

function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
}

function addHistory(expr, result) {
  const entry = { expr, result, time: new Date().toISOString() };
  state.history.unshift(entry);
  if (state.history.length > 100) state.history.pop(); // cap history size
  saveHistory();
  renderHistory(el.historySearch.value);
}

function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? ('Today, ' + timeStr) : (d.toLocaleDateString() + ' ' + timeStr);
}

function renderHistory(filter) {
  filter = filter || '';
  const items = filter
    ? state.history.filter((h) =>
        h.expr.toLowerCase().includes(filter.toLowerCase()) ||
        String(h.result).toLowerCase().includes(filter.toLowerCase())
      )
    : state.history;

  if (!items.length) {
    el.historyList.innerHTML = '<div class="history-empty">No calculations ' +
      (filter ? 'match your search' : 'yet. Try one!') + '</div>';
    return;
  }

  el.historyList.innerHTML = items
    .map((h) =>
      '<div class="history-item" data-expr="' + encodeURIComponent(h.expr) + '">' +
        '<div class="history-expr">' + escapeHtml(h.expr) + '</div>' +
        '<div class="history-result">' + escapeHtml(String(h.result)) + '</div>' +
        '<div class="history-time">' + formatTime(h.time) + '</div>' +
      '</div>'
    )
    .join('');

  // Tapping a history item loads it back into the calculator
  el.historyList.querySelectorAll('.history-item').forEach((node) => {
    node.addEventListener('click', () => {
      state.expression = decodeURIComponent(node.dataset.expr);
      renderExpression();
      closePanel(el.historyPanel);
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ===================== 6. NATURAL LANGUAGE ("AI") PARSER ===================== */

/**
 * Lightweight rule-based NLP — no external API required, fully offline.
 * Recognizes common phrasings and converts them into evaluable expressions.
 * Keeps "Smart AI Features" functional without network access or API keys.
 */
const numberWords = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

function extractNumbers(text) {
  // Replace spelled-out small numbers with digits first, then pull all numbers
  let processed = text;
  Object.keys(numberWords).forEach((word) => {
    processed = processed.replace(new RegExp('\\b' + word + '\\b', 'gi'), numberWords[word]);
  });
  const matches = processed.match(/-?\d+(\.\d+)?/g);
  return { numbers: matches ? matches.map(Number) : [], processed };
}

/**
 * Tries a series of pattern matchers against the natural-language query.
 * Returns { expr, explanation } on success, or null if nothing matched
 * (caller falls back to treating the input as a raw expression).
 */
function parseNaturalLanguage(rawText) {
  const text = rawText.trim().toLowerCase();
  const { numbers } = extractNumbers(text);

  // "X% of Y" / "what is 20% of 500"
  let m = text.match(/(-?\d+(\.\d+)?)\s*%\s*of\s*(-?\d+(\.\d+)?)/);
  if (m) {
    const pct = parseFloat(m[1]);
    const base = parseFloat(m[3]);
    return { expr: pct + '%*' + base, explanation: pct + '% of ' + base };
  }

  // "add X and Y" / "sum of X and Y" / "X plus Y"
  if (/\badd\b|\bsum\b|\bplus\b/.test(text) && numbers.length >= 2) {
    return { expr: numbers.join('+'), explanation: 'Adding ' + numbers.join(' and ') };
  }

  // "subtract X from Y" / "X minus Y" / "difference between X and Y"
  m = text.match(/subtract\s+(-?\d+(\.\d+)?)\s+from\s+(-?\d+(\.\d+)?)/);
  if (m) {
    return { expr: m[3] + '-' + m[1], explanation: 'Subtracting ' + m[1] + ' from ' + m[3] };
  }
  if (/\bminus\b|\bdifference\b|\bsubtract\b/.test(text) && numbers.length >= 2) {
    return { expr: numbers[0] + '-' + numbers[1], explanation: 'Subtracting ' + numbers[1] + ' from ' + numbers[0] };
  }

  // "multiply X by Y" / "X times Y" / "product of X and Y"
  if (/\bmultipl(y|ied)\b|\btimes\b|\bproduct\b/.test(text) && numbers.length >= 2) {
    return { expr: numbers.join('*'), explanation: 'Multiplying ' + numbers.join(' and ') };
  }

  // "divide X by Y" / "X divided by Y" / "quotient of X and Y"
  if (/\bdivide(d)?\b|\bquotient\b/.test(text) && numbers.length >= 2) {
    return { expr: numbers[0] + '/' + numbers[1], explanation: 'Dividing ' + numbers[0] + ' by ' + numbers[1] };
  }

  // "square root of X"
  m = text.match(/square\s*root\s*of\s*(-?\d+(\.\d+)?)/);
  if (m) return { expr: 'sqrt(' + m[1] + ')', explanation: 'Square root of ' + m[1] };

  // "cube root of X"
  m = text.match(/cube\s*root\s*of\s*(-?\d+(\.\d+)?)/);
  if (m) return { expr: m[1] + '^(1/3)', explanation: 'Cube root of ' + m[1] };

  // "X squared" / "X cubed"
  m = text.match(/(-?\d+(\.\d+)?)\s*squared/);
  if (m) return { expr: m[1] + '^2', explanation: m[1] + ' squared' };
  m = text.match(/(-?\d+(\.\d+)?)\s*cubed/);
  if (m) return { expr: m[1] + '^3', explanation: m[1] + ' cubed' };

  // "X to the power of Y" / "X power Y"
  m = text.match(/(-?\d+(\.\d+)?)\s*(to the )?power( of)?\s*(-?\d+(\.\d+)?)/);
  if (m) return { expr: m[1] + '^' + m[5], explanation: m[1] + ' to the power of ' + m[5] };

  // "factorial of X" / "X factorial"
  m = text.match(/factorial\s*of\s*(\d+)/) || text.match(/(\d+)\s*factorial/);
  if (m) return { expr: m[1] + '!', explanation: 'Factorial of ' + m[1] };

  // "sin/cos/tan/log/ln of X"
  m = text.match(/(sin|cos|tan|log|ln)\s*(of)?\s*(-?\d+(\.\d+)?)/);
  if (m) return { expr: m[1] + '(' + m[3] + ')', explanation: m[1] + ' of ' + m[3] };

  // "what is X% off Y" (discount phrasing)
  m = text.match(/(-?\d+(\.\d+)?)\s*%\s*off\s*(-?\d+(\.\d+)?)/);
  if (m) {
    const pct = parseFloat(m[1]);
    const base = parseFloat(m[3]);
    return { expr: base + '-(' + pct + '%*' + base + ')', explanation: pct + '% off ' + base };
  }

  // Fallback: if the text already looks like a bare math expression, just clean it
  const stripped = text.replace(/what\s*is|calculate|evaluate|\?/g, '').trim();
  if (/^[\d\s+\-*/^().%]+$/.test(stripped) && stripped) {
    return { expr: stripped, explanation: 'Evaluating ' + stripped };
  }

  return null;
}

function runAiQuery(rawText) {
  if (!rawText.trim()) return;
  const parsed = parseNaturalLanguage(rawText);

  if (!parsed) {
    el.aiAnswer.innerHTML = 'Hmm, I couldn\u2019t quite parse that. Try phrasing it like <em>"20% of 500"</em> or <em>"square root of 144"</em>.';
    return;
  }

  try {
    const value = evaluateExpression(parsed.expr);
    const formatted = formatNumber(value);
    el.aiAnswer.innerHTML = parsed.explanation + ' = <strong>' + escapeHtml(formatted) + '</strong>';
    addHistory(rawText, formatted);
    speakText(formatted);

    // Reflect the result on the main display too
    state.expression = formatted;
    state.lastResult = value;
    animateResultIn(formatted);
    el.expression.textContent = rawText + ' =';
  } catch (err) {
    el.aiAnswer.textContent = "I understood the question, but couldn't compute it: " + err.message;
  }
}

/* ===================== 7. VOICE INPUT/OUTPUT ===================== */

let recognition = null;
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognitionAPI) {
  recognition = new SpeechRecognitionAPI();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    // Route voice input straight through the natural-language parser
    el.aiInput.value = transcript;
    switchMode('ai');
    runAiQuery(transcript);
  };

  recognition.onerror = () => {
    showToast('Voice input failed — please try again');
  };

  recognition.onend = () => {
    state.isListening = false;
    el.micBtn.classList.remove('listening');
  };
} else {
  el.micBtn.style.display = 'none';
}

function toggleVoiceInput() {
  if (!recognition) {
    showToast('Voice input is not supported in this browser');
    return;
  }
  if (state.isListening) {
    recognition.stop();
    return;
  }
  state.isListening = true;
  el.micBtn.classList.add('listening');
  recognition.start();
}

function speakText(text) {
  if (!('speechSynthesis' in window)) {
    showToast('Voice output is not supported in this browser');
    return;
  }
  const utterance = new SpeechSynthesisUtterance('The answer is ' + text);
  utterance.rate = 1;
  utterance.pitch = 1;
  window.speechSynthesis.cancel(); // stop any prior utterance
  window.speechSynthesis.speak(utterance);
}

/* ===================== 8. AUTO-SUGGESTIONS ===================== */

const aiSuggestionBank = [
  'What is 20% of 500?',
  'Square root of 144',
  'Add 45 and 67',
  '15% off 1200',
  '7 to the power of 3',
  'Factorial of 6',
  'sin of 30',
  'log of 1000',
];

function renderAiSuggestions(filterText) {
  filterText = (filterText || '').toLowerCase();
  const matches = filterText
    ? aiSuggestionBank.filter((s) => s.toLowerCase().includes(filterText))
    : aiSuggestionBank.slice(0, 4);

  el.aiSuggestions.innerHTML = matches
    .slice(0, 4)
    .map((s) => '<button class="suggestion-chip" data-suggestion="' + escapeHtml(s) + '">' + escapeHtml(s) + '</button>')
    .join('');

  el.aiSuggestions.querySelectorAll('.suggestion-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      el.aiInput.value = chip.dataset.suggestion;
      runAiQuery(chip.dataset.suggestion);
    });
  });
}

/* ===================== 9. TOOLS ===================== */

/* ---- Currency Converter ---- */
// Static approximate rates (relative to USD) so the tool works fully offline.
// In production, this would call a live FX API; offline rates keep the
// feature usable without network dependency or exposing an API key.
const CURRENCY_RATES = {
  USD: 1, EUR: 0.93, GBP: 0.79, INR: 86.3, JPY: 156.2,
  AUD: 1.52, CAD: 1.37, CNY: 7.25, AED: 3.67, SGD: 1.35,
};

function renderCurrencyTool() {
  el.toolContent.innerHTML =
    '<div class="tool-row">' +
      '<div class="tool-field"><label>Amount</label><input type="number" id="curAmount" value="100" /></div>' +
      '<div class="tool-field"><label>From</label><select id="curFrom">' + currencyOptions('USD') + '</select></div>' +
    '</div>' +
    '<div class="tool-field"><label>To</label><select id="curTo">' + currencyOptions('INR') + '</select></div>' +
    '<button class="tool-btn" id="curConvert">Convert</button>' +
    '<div class="tool-result" id="curResult">—</div>' +
    '<div style="font-size:0.7rem;color:var(--text-faint);text-align:center;">Rates are approximate static reference values (offline)</div>';

  document.getElementById('curConvert').addEventListener('click', () => {
    const amount = parseFloat(document.getElementById('curAmount').value) || 0;
    const from = document.getElementById('curFrom').value;
    const to = document.getElementById('curTo').value;
    const usd = amount / CURRENCY_RATES[from];
    const converted = usd * CURRENCY_RATES[to];
    document.getElementById('curResult').textContent =
      amount + ' ' + from + ' = ' + formatNumber(converted) + ' ' + to;
  });
}

function currencyOptions(selected) {
  return Object.keys(CURRENCY_RATES)
    .map((c) => '<option value="' + c + '"' + (c === selected ? ' selected' : '') + '>' + c + '</option>')
    .join('');
}

/* ---- Unit Converter ---- */
const UNIT_GROUPS = {
  length: { base: 'm', units: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mile: 1609.34, yard: 0.9144, foot: 0.3048, inch: 0.0254 } },
  weight: { base: 'kg', units: { kg: 1, g: 0.001, mg: 0.000001, lb: 0.453592, oz: 0.0283495, ton: 1000 } },
  temperature: { base: 'c', units: { c: 'c', f: 'f', k: 'k' } }, // handled specially
};

function renderUnitTool() {
  el.toolContent.innerHTML =
    '<div class="tool-field"><label>Category</label><select id="unitCategory">' +
      '<option value="length">Length</option><option value="weight">Weight</option><option value="temperature">Temperature</option>' +
    '</select></div>' +
    '<div class="tool-row">' +
      '<div class="tool-field"><label>Value</label><input type="number" id="unitValue" value="1" /></div>' +
      '<div class="tool-field"><label>From</label><select id="unitFrom"></select></div>' +
    '</div>' +
    '<div class="tool-field"><label>To</label><select id="unitTo"></select></div>' +
    '<button class="tool-btn" id="unitConvert">Convert</button>' +
    '<div class="tool-result" id="unitResult">—</div>';

  const categorySelect = document.getElementById('unitCategory');
  const fromSelect = document.getElementById('unitFrom');
  const toSelect = document.getElementById('unitTo');

  function populateUnitOptions() {
    const group = UNIT_GROUPS[categorySelect.value];
    const opts = Object.keys(group.units).map((u) => '<option value="' + u + '">' + u + '</option>').join('');
    fromSelect.innerHTML = opts;
    toSelect.innerHTML = opts;
    if (toSelect.options.length > 1) toSelect.selectedIndex = 1;
  }
  populateUnitOptions();
  categorySelect.addEventListener('change', populateUnitOptions);

  document.getElementById('unitConvert').addEventListener('click', () => {
    const category = categorySelect.value;
    const value = parseFloat(document.getElementById('unitValue').value) || 0;
    const from = fromSelect.value;
    const to = toSelect.value;
    let result;

    if (category === 'temperature') {
      result = convertTemperature(value, from, to);
    } else {
      const group = UNIT_GROUPS[category];
      const base = value * group.units[from];
      result = base / group.units[to];
    }
    document.getElementById('unitResult').textContent =
      value + ' ' + from + ' = ' + formatNumber(result) + ' ' + to;
  });
}

function convertTemperature(value, from, to) {
  let celsius;
  if (from === 'c') celsius = value;
  else if (from === 'f') celsius = (value - 32) * (5 / 9);
  else celsius = value - 273.15; // from kelvin

  if (to === 'c') return celsius;
  if (to === 'f') return celsius * (9 / 5) + 32;
  return celsius + 273.15; // to kelvin
}

/* ---- Age Calculator ---- */
function renderAgeTool() {
  const today = new Date().toISOString().split('T')[0];
  el.toolContent.innerHTML =
    '<div class="tool-field"><label>Date of birth</label><input type="date" id="ageDob" max="' + today + '" /></div>' +
    '<button class="tool-btn" id="ageCalc">Calculate age</button>' +
    '<div class="tool-result" id="ageResult">—</div>';

  document.getElementById('ageCalc').addEventListener('click', () => {
    const dobValue = document.getElementById('ageDob').value;
    if (!dobValue) { showToast('Pick a date of birth first'); return; }

    const dob = new Date(dobValue);
    const now = new Date();
    let years = now.getFullYear() - dob.getFullYear();
    let months = now.getMonth() - dob.getMonth();
    let days = now.getDate() - dob.getDate();

    if (days < 0) {
      months -= 1;
      days += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    document.getElementById('ageResult').textContent =
      years + ' years, ' + months + ' months, ' + days + ' days';
  });
}

/* ---- EMI Calculator ---- */
function renderEmiTool() {
  el.toolContent.innerHTML =
    '<div class="tool-field"><label>Loan amount</label><input type="number" id="emiPrincipal" value="500000" /></div>' +
    '<div class="tool-row">' +
      '<div class="tool-field"><label>Interest rate (% p.a.)</label><input type="number" id="emiRate" value="9" step="0.1" /></div>' +
      '<div class="tool-field"><label>Tenure (months)</label><input type="number" id="emiTenure" value="36" /></div>' +
    '</div>' +
    '<button class="tool-btn" id="emiCalc">Calculate EMI</button>' +
    '<div class="tool-result" id="emiResult">—</div>';

  document.getElementById('emiCalc').addEventListener('click', () => {
    const P = parseFloat(document.getElementById('emiPrincipal').value) || 0;
    const annualRate = parseFloat(document.getElementById('emiRate').value) || 0;
    const n = parseFloat(document.getElementById('emiTenure').value) || 1;
    const r = annualRate / 12 / 100; // monthly interest rate

    let emi;
    if (r === 0) {
      emi = P / n;
    } else {
      emi = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    }
    const totalPayment = emi * n;
    const totalInterest = totalPayment - P;

    document.getElementById('emiResult').innerHTML =
      'Monthly EMI: ' + formatNumber(emi) + '<br>' +
      '<span style="font-size:0.78rem;color:var(--text-secondary);font-weight:500;">Total interest: ' + formatNumber(totalInterest) + '</span>';
  });
}

/* ---- BMI Calculator ---- */
function renderBmiTool() {
  el.toolContent.innerHTML =
    '<div class="tool-row">' +
      '<div class="tool-field"><label>Weight (kg)</label><input type="number" id="bmiWeight" value="70" /></div>' +
      '<div class="tool-field"><label>Height (cm)</label><input type="number" id="bmiHeight" value="170" /></div>' +
    '</div>' +
    '<button class="tool-btn" id="bmiCalc">Calculate BMI</button>' +
    '<div class="tool-result" id="bmiResult">—</div>';

  document.getElementById('bmiCalc').addEventListener('click', () => {
    const weight = parseFloat(document.getElementById('bmiWeight').value) || 0;
    const heightCm = parseFloat(document.getElementById('bmiHeight').value) || 1;
    const heightM = heightCm / 100;
    const bmi = weight / (heightM * heightM);

    let category;
    if (bmi < 18.5) category = 'Underweight';
    else if (bmi < 25) category = 'Normal weight';
    else if (bmi < 30) category = 'Overweight';
    else category = 'Obese';

    document.getElementById('bmiResult').innerHTML =
      formatNumber(bmi) + '<br><span style="font-size:0.78rem;color:var(--text-secondary);font-weight:500;">' + category + '</span>';
  });
}

const TOOL_RENDERERS = {
  currency: renderCurrencyTool,
  unit: renderUnitTool,
  age: renderAgeTool,
  emi: renderEmiTool,
  bmi: renderBmiTool,
};

function openTool(toolName) {
  el.toolsGrid.querySelectorAll('.tool-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.tool === toolName);
  });
  TOOL_RENDERERS[toolName]();
}

/* ===================== 10. THEME SWITCHER ===================== */

const THEME_KEY = 'nova_calc_theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  // Swap icon: sun for light, moon for dark
  el.themeIcon.innerHTML = theme === 'light'
    ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
    : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* ===================== 11. BACKGROUND PARTICLES ===================== */

/**
 * Lightweight canvas particle field for ambient depth. Particles drift
 * slowly upward and wrap around, giving a "floating" feeling without
 * being distracting or costly on low-end devices.
 */
function initParticles() {
  const canvas = el.particlesCanvas;
  const ctx = canvas.getContext('2d');
  let particles = [];
  let width, height;

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const COUNT = window.innerWidth < 600 ? 22 : 45;
  for (let i = 0; i < COUNT; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 2 + 0.6,
      speed: Math.random() * 0.4 + 0.1,
      drift: Math.random() * 0.6 - 0.3,
      opacity: Math.random() * 0.5 + 0.15,
    });
  }

  function tick() {
    ctx.clearRect(0, 0, width, height);
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    particles.forEach((p) => {
      p.y -= p.speed;
      p.x += p.drift;
      if (p.y < -10) { p.y = height + 10; p.x = Math.random() * width; }
      if (p.x < -10) p.x = width + 10;
      if (p.x > width + 10) p.x = -10;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = isLight
        ? 'rgba(124, 77, 255, ' + p.opacity * 0.5 + ')'
        : 'rgba(0, 229, 255, ' + p.opacity + ')';
      ctx.fill();
    });
    requestAnimationFrame(tick);
  }
  tick();
}

/* ===================== 12. KEYBOARD SUPPORT ===================== */

function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Don't hijack keystrokes while typing in a text input
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      if (e.key === 'Enter' && document.activeElement === el.aiInput) {
        runAiQuery(el.aiInput.value);
      }
      return;
    }

    const key = e.key;
    if (/^[0-9.]$/.test(key)) { appendToExpression(key); return; }
    if (key === '+') { appendToExpression('+'); return; }
    if (key === '-') { appendToExpression('-'); return; }
    if (key === '*') { appendToExpression('×'); return; }
    if (key === '/') { e.preventDefault(); appendToExpression('÷'); return; }
    if (key === '(' || key === ')') { appendToExpression(key); return; }
    if (key === '%') { appendToExpression('%'); return; }
    if (key === '^') { appendToExpression('^'); return; }
    if (key === 'Enter' || key === '=') { e.preventDefault(); runEquals(); return; }
    if (key === 'Backspace') { backspace(); return; }
    if (key === 'Escape') { clearAll(); return; }
  });
}

/* ===================== UTILITIES: TOAST & PANELS ===================== */

let toastTimeout = null;
function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.toast.classList.remove('show'), 2200);
}

function openPanel(panel) {
  // Close the other panel first so they never overlap awkwardly
  [el.historyPanel, el.toolsPanel].forEach((p) => { if (p !== panel) p.classList.remove('open'); });
  panel.classList.add('open');
}
function closePanel(panel) {
  panel.classList.remove('open');
}

/* ===================== MODE SWITCHING ===================== */

function switchMode(mode) {
  state.mode = mode;
  el.modePills.forEach((pill) => {
    const active = pill.dataset.mode === mode;
    pill.classList.toggle('active', active);
    pill.setAttribute('aria-selected', active);
  });

  el.sciRow.classList.toggle('visible', mode === 'scientific');
  el.aiPanel.classList.toggle('visible', mode === 'ai');
  el.keypad.style.display = mode === 'ai' ? 'none' : 'grid';

  if (mode === 'ai') {
    renderAiSuggestions('');
    setTimeout(() => el.aiInput.focus(), 200);
  }
}

/* ===================== 13. INIT ===================== */

function init() {
  // Restore persisted theme (default: dark)
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');

  loadHistory();
  renderHistory();

  bindButtonEffects(el.keypad);
  bindButtonEffects(el.sciRow);
  bindKeyboard();
  initParticles();

  // Mode pills
  el.modePills.forEach((pill) => pill.addEventListener('click', () => switchMode(pill.dataset.mode)));

  // AI panel interactions
  el.aiSend.addEventListener('click', () => runAiQuery(el.aiInput.value));
  el.aiInput.addEventListener('input', () => renderAiSuggestions(el.aiInput.value));
  el.aiOrb.addEventListener('click', () => switchMode('ai'));

  // Voice
  el.micBtn.addEventListener('click', toggleVoiceInput);
  el.speakBtn.addEventListener('click', () => {
    const text = el.result.textContent;
    if (text && text !== '0' && text !== 'Error') speakText(text);
  });

  // Copy result
  el.copyBtn.addEventListener('click', async () => {
    const text = el.result.textContent;
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied "' + text + '" to clipboard');
    } catch {
      showToast('Could not copy — try selecting manually');
    }
  });

  // History panel
  el.historyToggle.addEventListener('click', () => openPanel(el.historyPanel));
  el.closeHistory.addEventListener('click', () => closePanel(el.historyPanel));
  el.historySearch.addEventListener('input', () => renderHistory(el.historySearch.value));
  el.clearHistory.addEventListener('click', () => {
    state.history = [];
    saveHistory();
    renderHistory();
    showToast('History cleared');
  });

  // Tools panel
  el.toolsToggle.addEventListener('click', () => { openPanel(el.toolsPanel); openTool('currency'); });
  el.closeTools.addEventListener('click', () => closePanel(el.toolsPanel));
  el.toolsGrid.querySelectorAll('.tool-card').forEach((card) => {
    card.addEventListener('click', () => openTool(card.dataset.tool));
  });

  // Theme
  el.themeToggle.addEventListener('click', toggleTheme);

  // Initial display state
  clearAll();
}

document.addEventListener('DOMContentLoaded', init);
