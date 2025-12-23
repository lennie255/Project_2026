// חיבור השרתים
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const morgan = require('morgan');

//open ai עם המשתמש והקוד שהוזן על פי המשתמש שפתחתי 
let OpenAI, client;
try {
  OpenAI = require('openai');
  if (process.env.OPENAI_API_KEY) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} catch {}

//יצירת מופע שרת
const app = express();
app.use(morgan('dev')); //הדפסת לוגים של בקשות 
app.use(cors({ origin: true }));
app.use(express.json());

// חיבור לשאלון  
const { createQuestionnaire } = require('./questionnaireBot');
//זיכרון זמני לכל משתמש לאסוף את ההודעות 
const quizBuffers = new Map();
function pushToQuizBuffer(userId, text) {
  if (!quizBuffers.has(userId)) quizBuffers.set(userId, []);
  quizBuffers.get(userId).push(text);
}

async function sendQuizText(userId, text) { pushToQuizBuffer(userId, text); } //העברת השאלון 
async function sendQuizOptions(userId, text, options) {
  const rendered = text + '\n' +
    options.map((o,i)=>`${i+1}. ${o.label}`).join('\n') +
    '\n(אפשר להשיב במספר או בטקסט)';
  pushToQuizBuffer(userId, rendered);
}
async function llmForQuiz(messages) {
  if (!client) return '{"score":0}';
  const resp = await client.responses.create({ model: 'gpt-4o-mini', input: messages });
  return resp.output_text || '{"score":0}';
}
const quiz = createQuestionnaire({ sendText: sendQuizText, sendOptions: sendQuizOptions, llm: llmForQuiz });

// נתיבי API
app.get('/api/ping', (_req, res) => res.json({ ok: true, t: Date.now() }));

app.post('/api/start-quiz', async (_req, res) => {
  try {
    const userId = 'default'; //מאתחל
    quizBuffers.set(userId, []);
    await quiz.start(userId); //קורא להתחיל 
    const reply = (quizBuffers.get(userId) || []).join('\n\n'); //מחזיר תוצאות 
    return res.json({ reply, quiz: true });
  } catch (e) {
    console.error('start-quiz error:', e);
    return res.status(500).json({ error: 'failed_to_start_quiz' });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { messages = [] } = req.body || {};
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const userText = (lastUser?.content || '').toString();
    const userId = 'default';

    const startRequested = /(^|\/)(start|quiz|שאלון|התחל שאלון)/i.test(userText);
    const isActive = await quiz.isActive(userId);
    if (startRequested || isActive) {
      quizBuffers.set(userId, []);
      if (startRequested && !isActive) await quiz.start(userId);
      else await quiz.handle(userId, { message: userText, payload: null });
      const quizReply = (quizBuffers.get(userId) || []).join('\n\n') || '…';
      return res.json({ reply: quizReply, quiz: true });
    }

    if (client) {
      const response = await client.responses.create({
  model: 'gpt-4o-mini',
  input: [
    {
      role: 'system',
      content:
        'You are a helpful assistant about Israeli mechinot (pre-army programs) and volunteering. Use the knowledge base when answering. If the answer is not in the knowledge base, say you are not sure.'
    },
    ...messages
  ],
  tools: [{ type: "file_search" }],
  tool_resources: {
    file_search: {
      vector_store_ids: [process.env.VECTOR_STORE_ID],
    },
  },
});
      return res.json({ reply: response.output_text });
    } else {
      return res.json({ reply: ' . לחצו "התחל שאלון" כדי להתחיל' });
    }
    //טיפול בשגיאות 
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'server_error', detail: err?.message || 'unknown' });
  }
});


app.get('/__debug', (req, res) => {
  res.json({
    ok: true,
    hostHeader: req.headers.host,
    url: req.originalUrl,
    serverCwd: process.cwd(),
    staticDir: path.join(__dirname, 'public'),
  });
});

//קבצים סטטים ודף בית 
// קבצים סטטיים ודף בית (מותאם ל-Render)
const fs = require('fs');
const publicDir = path.join(__dirname, 'public');

app.use(express.static(publicDir));

app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// לוגים לבדיקה ב-Render (אפשר למחוק אחרי שעובד)
console.log('publicDir:', publicDir);
console.log('index exists:', fs.existsSync(path.join(publicDir, 'index.html')));
const PORT = process.env.PORT || 3000;
//לפתוח דרך גוגל 
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

//אם רוציפ לפתוח ישר דרך פה 
//app.listen(PORT, () => {
 // console.log(`Open your app at: http://localhost:${PORT}`);
//});

