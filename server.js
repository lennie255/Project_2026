// server.js (מתוקן: בלי Vector Store + בלי "No reply" אחרי השאלון)
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const morgan = require('morgan');
const fs = require('fs');

// OpenAI
let OpenAI, client;
try {
  OpenAI = require('openai');
  if (process.env.OPENAI_API_KEY) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
} catch (e) {
  console.warn('OpenAI init failed:', e?.message || e);
}

// יצירת מופע שרת
const app = express();
app.use(morgan('dev'));
app.use(cors({ origin: true }));
app.use(express.json());

// חיבור לשאלון
const { createQuestionnaire } = require('./questionnaireBot');

// זיכרון זמני לכל משתמש לאסוף את ההודעות
const quizBuffers = new Map();
function pushToQuizBuffer(userId, text) {
  if (!quizBuffers.has(userId)) quizBuffers.set(userId, []);
  quizBuffers.get(userId).push(String(text ?? ''));
}

async function sendQuizText(userId, text) { pushToQuizBuffer(userId, text); }
async function sendQuizOptions(userId, text, options) {
  const rendered =
    String(text ?? '') + '\n' +
    (options || []).map((o, i) => `${i + 1}. ${o.label}`).join('\n') +
    '\n(אפשר להשיב במספר או בטקסט)';
  pushToQuizBuffer(userId, rendered);
}

async function llmForQuiz(messages) {
  if (!client) return '{"score":0}';
  try {
    const resp = await client.responses.create({
      model: 'gpt-4o-mini',
      input: messages
    });
    return resp.output_text || '{"score":0}';
  } catch (e) {
    console.error('llmForQuiz OpenAI error:', e?.message || e);
    return '{"score":0}';
  }
}

const quiz = createQuestionnaire({
  sendText: sendQuizText,
  sendOptions: sendQuizOptions,
  llm: llmForQuiz
});

// עוזר: תמיד מחזיר reply כדי שלא יופיע "No reply" בפרונט
function replyJson(res, reply, extra = {}, status = 200) {
  return res.status(status).json({ reply: String(reply ?? ''), ...extra });
}

// נתיבי API
app.get('/api/ping', (_req, res) => res.json({ ok: true, t: Date.now() }));

app.post('/api/start-quiz', async (_req, res) => {
  try {
    const userId = 'default';
    quizBuffers.set(userId, []);
    await quiz.start(userId);
    const reply = (quizBuffers.get(userId) || []).join('\n\n');
    return replyJson(res, reply, { quiz: true });
  } catch (e) {
    console.error('start-quiz error:', e);
    return replyJson(res, 'לא הצלחתי להתחיל את השאלון. בדקי Logs.', { error: 'failed_to_start_quiz' }, 500);
  }
});

app.post('/api/chat', async (req, res) => {
  const userId = 'default';

  try {
    const { messages = [] } = req.body || {};
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const userText = (lastUser?.content || '').toString();

    // אם השאלון פעיל—ממשיכים רק את השאלון
    const isActive = await quiz.isActive(userId);
    if (isActive) {
      quizBuffers.set(userId, []);
      await quiz.handle(userId, { message: userText, payload: null });
      const quizReply = (quizBuffers.get(userId) || []).join('\n\n') || '…';
      return replyJson(res, quizReply, { quiz: true });
    }

    // צ'אט רגיל (ללא מקורות / Vector Store)
    if (!client) {
      return replyJson(
        res,
        'אין חיבור ל-OpenAI כרגע (חסר OPENAI_API_KEY או שהספרייה לא נטענה).'
      );
    }

    // לוגים מועילים כדי להבין בעיות
    console.log('[chat] hasKey:', !!process.env.OPENAI_API_KEY, 'hasClient:', !!client);

    // קריאה ל-OpenAI עם try/catch פנימי כדי לא ליפול ל-"No reply"
    try {
      const response = await client.responses.create({
        model: 'gpt-4o-mini',
        input: [
          { role: 'system', content: 'You are a helpful assistant. Answer normally like ChatGPT.' },
          ...messages
        ]
      });

      const replyText = (response.output_text || '').trim();
      return replyJson(res, replyText || 'לא התקבלה תשובה מהמודל. נסי שוב.');

    } catch (e) {
      console.error('OpenAI error:', e?.message || e);
      return replyJson(
        res,
        'שגיאה בחיבור ל-OpenAI. בדקי OPENAI_API_KEY, חיבור לאינטרנט, ומגבלות שימוש.',
        { error: 'openai_error', detail: e?.message || 'unknown' },
        500
      );
    }

  } catch (err) {
    console.error('Chat route error:', err);
    // תמיד reply כדי שהפרונט לא יציג "No reply"
    return replyJson(
      res,
      'יש תקלה זמנית בצ׳אט (שגיאת שרת). בדקי את ה-terminal לשגיאה המדויקת.',
      { error: 'server_error', detail: err?.message || 'unknown' },
      500
    );
  }
});

app.get('/__debug', (req, res) => {
  res.json({
    ok: true,
    hostHeader: req.headers.host,
    url: req.originalUrl,
    serverCwd: process.cwd(),
    dirname: __dirname,
    staticDir: path.join(__dirname, 'public'),
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
  });
});

// קבצים סטטיים ודף בית (מותאם ל-Render)
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

console.log('publicDir:', publicDir);
console.log('index exists:', fs.existsSync(path.join(publicDir, 'index.html')));

// השרת שעליו נמצאים
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
