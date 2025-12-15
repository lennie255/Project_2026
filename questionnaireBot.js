// questionnaireBot.js
function createQuestionnaire({ sendText, sendOptions, store, llm }) {
  
  const QUIZ = {
    id: "prearmy-volunteer-fit",
    title: "שאלון התאמה קצר (5 שאלות)",
    questions: [
      // : תחומי עניין
      {
        id: "q1",
        type: "choice",
        text: "איזה תחום מדבר אלייך יותר?",
        options: [
          { id: "tech",   label: "טכנולוגיה / מחשבים / מתמטיקה", points: 5 },
          { id: "social", label: "חברתי / חינוך / סיוע לאנשים",   points: 2 },
          { id: "outdoor",label: "טבע / שטח / אתגר פיזי",         points: 4 },
        ],
      },
      // : סגנון עשייה
      {
        id: "q2",
        type: "choice",
        text: "איזה סוג פעילות את/ה מעדיף/ה?",
        options: [
          { id: "problem", label: "פתרון בעיות ולמידה עצמית", points: 4 },
          { id: "guide",   label: "ליווי, הדרכה ותמיכה באנשים", points: 2 },
          { id: "lead",    label: "ארגון/מנהיגות/תיאום משימות", points: 3 },
        ],
      },
      //  סביבת עבודה מועדפת
      {
        id: "q3",
        type: "choice",
        text: "איפה היית רוצה לפעול ?",
        options: [
          { id: "lab",   label: "סביבת מחשב / מעבדה / פרויקטים טכנולוגיים", points: 5 },
          { id: "people",label: "קהילה / קשר בין-אישי / חניכה",  points: 2 },
          { id: "field", label: "שטח / לוגיסטיקה / אירועי שטח", points: 3 },
        ],
      },
      //  רמת מחויבות
      {
        id: "q4",
        type: "choice",
        text: "כמה אינטנסיביות ומחויבות מתאימות לך?",
        options: [
          { id: "high",   label: "גבוהה (לו\"ז צפוף ועמוס)", points: 4 },
          { id: "medium", label: "בינונית (איזון בין לימודים/בית לפעילות)", points: 3 },
          { id: "low",    label: "קצרה/גמישה (מפגשים נקודתיים)", points: 1 },
        ],
      },
      //  עבודה בצוות או לבד
      {
        id: "q5",
        type: "choice",
        text: "עבודה בצוות או באופן עצמאי?",
        options: [
          { id: "team",  label: "צוות",     points: 3 },
          { id: "solo",  label: "עצמאית",   points: 2 },
          { id: "both",  label: "גם וגם",   points: 4 },
        ],
      },

      //שאלה פתוחה להוסיף 
      {
        id: "q6",
        type: "open",
        text: "האם יש עוד משהו להוסיף על עצמך?",
        scoring: {
          mode: "keywords",
          max: 8, base: 0, min: 0,
          positive: [
            // טכנולוגי/מתמטי
            { terms: ["מחשבים","תכנות","קוד","אלגוריתמים","מתמטיקה","פיזיקה","סייבר","רובוטיקה"], weight: 3 },
            // חברתי
            { terms: ["חברים","קהילה","חינוך","הדרכה","קשישים","ילדים","לעזור לאנשים","התנדבות"], weight: 2 },
            // ספורט/שטח
            { terms: ["פעילות גופנית","ספורט","כושר","שטח","טבע","טיולים"], weight: 2 },
          ],
          negative: [{ terms: ["אין","לא היה","אין לי"], weight: 2 }],
        }
      },
    ],
    
    bands: [
      { min: 0,  max: 9,  key:"social", label: "התאמה חברתית",   summary: "כדאי להתמקד במסגרות עם עשייה חברתית ישירה." },
      { min: 10, max: 20, key:"tech",   label: "התאמה טכנולוגית", summary: "כדאי לשקול מסגרות טכנולוגיות/מתמטיות." },
      { min: 21, max: 100,key:"other",  label: "התאמה גבוהה במיוחד", summary: "אפשר לכוון גם למסגרות מאתגרות מסוגים שונים." },
    ],
  };

 //לכלול את שאלה שש
  const enableOpenQuestion = false; 
//במידה ומכבים את שש אז לסנן אותה החוצה 
  if (!enableOpenQuestion) {
    QUIZ.questions = QUIZ.questions.filter(q => q.id !== "q6");
  }

  
 
  
  const memory = new Map();
  const getState = async (uid) => {
    if (store?.get) return (await store.get(uid)) || { step:0,total:0,answers:[],active:false };
    if (!memory.has(uid)) memory.set(uid, { step:0,total:0,answers:[],active:false });
    return memory.get(uid);
  };
  const setState = async (uid, v) => store?.set ? store.set(uid, v) : memory.set(uid, v);

 
 
  const normalize = (txt="") =>
    txt.toString().toLowerCase()
      .replace(/[\u0591-\u05C7]/g, "")     // ניקוד עברי
      .replace(/[^\p{L}\p{N}\s]/gu, " ");  // סימנים

  function scoreByKeywords(answer, rules) {
    const text = normalize(answer);
    let score = rules.base ?? 0;
    for (const g of (rules.positive || []))
      if (g.terms.some(t => text.includes(normalize(t)))) score += g.weight || 0;
    for (const g of (rules.negative || []))
      if (g.terms.some(t => text.includes(normalize(t)))) score -= g.weight || 0;
    if (typeof rules.min === "number") score = Math.max(rules.min, score);
    if (typeof rules.max === "number") score = Math.min(rules.max, score);
    return score;
  }

  async function scoreByLLM(answer, scoring) {
    if (!llm) return 0;
    const prompt = [
      { role: "system", content: `Return ONLY minified JSON: {"score":number}. Score must be 0..${scoring.max}` },
      { role: "user",   content: JSON.stringify({ rubric: scoring.rubric, max: scoring.max, answer }) }
    ];
    const raw = await llm(prompt);
    try { const { score } = JSON.parse(raw); return Math.max(0, Math.min(scoring.max, Number(score) || 0)); }
    catch { return 0; }
  }

  const bandFor  = (t) => QUIZ.bands.find(b => t >= b.min && t <= b.max) || QUIZ.bands.at(-1);
  const currentQ = (s) => QUIZ.questions[s.step];

  
  async function start(uid) {
    const s = await getState(uid);
    s.active = true; s.step = 0; s.total = 0; s.answers = [];
    await setState(uid, s);
    await sendText(uid, `נתחיל ב"${QUIZ.title}" — 5 שאלות קצרות${enableOpenQuestion ? " (+שאלה פתוחה אופציונלית)" : ""}.`);
    await askNext(uid);
    return true;
  }

  async function askNext(uid) {
    const s = await getState(uid);
    const q = currentQ(s);
    if (!q) return finish(uid);
    if (q.type === "choice") {
      await sendOptions(uid, q.text, q.options.map(o => ({ id:o.id, label:o.label })));
    } else {
      await sendText(uid, q.text + "\n(ענה/י בטקסט חופשי)");
    }
  }

  async function handle(uid, { message, payload }) {
    const s = await getState(uid);
    const normalized = (message || "").toString().trim().toLowerCase();
    const wantsStart = payload === "START_QUIZ" || /(^|\/)(start|quiz|שאלון|התחל שאלון)/.test(normalized);
    if (!s.active) { if (wantsStart) return start(uid); return false; }

    const q = currentQ(s);
    if (!q) { await finish(uid); return true; }

    if (q.type === "choice") {
      let chosen = payload && q.options.find(o => o.id === payload);
      if (!chosen && message) {
        const idx = parseInt(normalized, 10);
        if (!isNaN(idx) && idx >= 1 && idx <= q.options.length) chosen = q.options[idx - 1];
        if (!chosen) chosen = q.options.find(o => o.label.toLowerCase().includes(normalized));
      }
      if (!chosen) {
        await sendText(uid, "נא לבחור אפשרות או להקליד את המספר תשובה ");
        await askNext(uid); return true;
      }
      s.answers.push({ qid:q.id, type:"choice", optionId:chosen.id, label:chosen.label, points:chosen.points });
      s.total += chosen.points; s.step += 1; await setState(uid, s);
      return (s.step < QUIZ.questions.length) ? await askNext(uid) : await finish(uid);
    }

    if (q.type === "open") {
      const answer = (message || "").trim();
      if (!answer) { await sendText(uid, "נא לענות תשובה קצרה יותר "); return true; }
      let pts = 0;
      if (q.scoring?.mode === "keywords") pts = scoreByKeywords(answer, q.scoring);
      else if (q.scoring?.mode === "llm") pts = await scoreByLLM(answer, q.scoring);
      s.answers.push({ qid:q.id, type:"open", text:answer, points:pts });
      s.total += pts; s.step += 1; await setState(uid, s);
      return (s.step < QUIZ.questions.length) ? await askNext(uid) : await finish(uid);
    }

    return false;
  }

  
  const RECOMMENDATIONS = {
    tech: [
      "מכינות/מסגרות עם דגש טכנולוגי/מחשובי/מתמטי",
      "התנדבות בהוראת תכנות לנוער / מרכזי מחשבים קהילתיים",
      "פרויקטי רובוטיקה/סייבר לנוער, עזרה בהכנה לבגרות מתמטיקה"
    ],
    social: [
      "התנדבות חברתית: סיוע לקשישים/ילדים, חונכות וליווי, קהילה ורווחה",
      "הדרכה בתנועות נוער, פרויקטי קהילה ושיקום",
      "מרכזי תמיכה ושירות לאוכלוסיות מוחלשות"
    ],
    other: [
      "מסגרות מאתגרות / שטח ולוגיסטיקה / סביבה וקיימות",
      "כיתות מנהיגות צעירה, פרויקטים ייעודיים בקהילה",
      "מסגרות חירום/סיוע בשטח (בהתאם לגיל וכללים), התנדבות חקלאית"
    ]
  };

  

  async function finish(uid) {
    const s = await getState(uid);
    const band = bandFor(s.total);

   
    const track = (s.total > 20) ? 'other' : (s.total > 10) ? 'tech' : 'social';
    const suggestions = RECOMMENDATIONS[track];

    const breakdown = s.answers.map(a =>
      a.type === "choice"
        ? `• ${a.label} (+${a.points})`
        : `• תשובה פתוחה: "${a.text.slice(0,80)}${a.text.length>80?'…':''}" (+${a.points})`
    ).join("\n");

    const msg = [
      "המלצות לפי הפרופיל שלך:",
      ...suggestions.map((x,i)=>`${i+1}. ${x}`),
      "",
      "פירוט תשובות:",
      breakdown
    ].join("\n");

    await sendText(uid, msg);
    s.active = false; await setState(uid, s);
  }

  async function reset(uid)    { await setState(uid, { step:0,total:0,answers:[],active:false }); }
  async function isActive(uid) { return (await getState(uid)).active; }

  return { handle, start, reset, isActive };
}

module.exports = { createQuestionnaire };
