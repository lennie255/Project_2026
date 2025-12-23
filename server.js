// server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const morgan = require("morgan");
const fs = require("fs");

const OpenAI = require("openai");

// --- OpenAI init ---
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.warn(" Missing OPENAI_API_KEY. Chat will return an error message.");
}
const client = OPENAI_KEY ? new OpenAI({ apiKey: OPENAI_KEY }) : null;

// --- App init ---
const app = express();
app.use(morgan("dev"));
app.use(cors({ origin: true }));
app.use(express.json());

// --- Questionnaire ---
const { createQuestionnaire } = require("./questionnaireBot");

// זיכרון זמני לאיסוף הודעות שהשאלון “שולח”
const quizBuffers = new Map();
function pushToQuizBuffer(userId, text) {
  if (!quizBuffers.has(userId)) quizBuffers.set(userId, []);
  quizBuffers.get(userId).push(String(text ?? ""));
}

async function sendQuizText(userId, text) {
  pushToQuizBuffer(userId, text);
}

async function sendQuizOptions(userId, text, options) {
  const rendered =
    String(text ?? "") +
    "\n" +
    (options || []).map((o, i) => `${i + 1}. ${o.label}`).join("\n") +
    "\n(אפשר להשיב במספר או בטקסט)";
  pushToQuizBuffer(userId, rendered);
}

// כרגע השאלה הפתוחה אצלך כבויה, אבל נשאיר llm תקין אם תפעילי אותה בעתיד
async function llmForQuiz(messages) {
  if (!client) return '{"score":0}';
  try {
    const input = (messages || []).map((m) => `${m.role}: ${m.content}`).join("\n");
    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input,
    });
    return (resp.output_text || "").trim() || '{"score":0}';
  } catch (e) {
    console.error("llmForQuiz error:", e?.message || e);
    return '{"score":0}';
  }
}

const quiz = createQuestionnaire({
  sendText: sendQuizText,
  sendOptions: sendQuizOptions,
  llm: llmForQuiz,
});

function replyJson(res, reply, extra = {}, status = 200) {
  return res.status(status).json({ reply: String(reply ?? ""), ...extra });
}

// --- OpenAI chat helper (Responses API) ---
async function openAIChatReply(messages) {
  if (!client) return "אין חיבור ל-OpenAI כרגע (חסר OPENAI_API_KEY).";

  // בונים טקסט רציף מההיסטוריה (פשוט ואמין ל-Responses API)
  const transcript = (messages || [])
    .map((m) => {
      const role = m?.role || "user";
      const content = String(m?.content ?? "");
      return `${role}: ${content}`;
    })
    .join("\n");

  const resp = await client.responses.create({
    model: "gpt-4.1-mini",
    input: transcript,
  });

  return (resp.output_text || "").trim() || "לא התקבלה תשובה מהמודל. נסי שוב.";
}

// --- API routes ---
app.get("/api/ping", (_req, res) => res.json({ ok: true, t: Date.now() }));

app.post("/api/start-quiz", async (_req, res) => {
  try {
    const userId = "default";
    quizBuffers.set(userId, []);
    await quiz.start(userId);
    const reply = (quizBuffers.get(userId) || []).join("\n\n");
    return replyJson(res, reply, { quiz: true });
  } catch (e) {
    console.error("start-quiz error:", e);
    return replyJson(
      res,
      "לא הצלחתי להתחיל את השאלון. בדקי Logs.",
      { error: "failed_to_start_quiz" },
      500
    );
  }
});

app.post("/api/chat", async (req, res) => {
  const userId = "default";

  try {
    const { messages = [] } = req.body || {};
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const userText = String(lastUser?.content ?? "");

    // אם השאלון פעיל—ממשיכים שאלון בלבד
    const isActive = await quiz.isActive(userId);
    if (isActive) {
      quizBuffers.set(userId, []);
      await quiz.handle(userId, { message: userText, payload: null });
      const quizReply = (quizBuffers.get(userId) || []).join("\n\n") || "…";
      return replyJson(res, quizReply, { quiz: true });
    }

    // צ'אט רגיל דרך OpenAI
    const reply = await openAIChatReply(messages);
    return replyJson(res, reply);
  } catch (err) {
    console.error("Chat route error:", err);
    return replyJson(
      res,
      "יש תקלה זמנית בצ׳אט (שגיאת שרת). בדקי את ה-terminal לשגיאה המדויקת.",
      { error: "server_error", detail: err?.message || "unknown" },
      500
    );
  }
});

// --- Static files ---
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

console.log("publicDir:", publicDir);
console.log("index exists:", fs.existsSync(path.join(publicDir, "index.html")));

// --- Listen ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
