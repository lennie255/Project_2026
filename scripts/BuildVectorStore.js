require("dotenv").config();
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const KNOWLEDGE_DIR = path.join(__dirname, "..", "knowledge");

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY in .env");
  }

 
  const vs = await client.vectorStores.create({ name: "mechina-volunteering-kb" });
  console.log(" VECTOR_STORE_ID =", vs.id);


  const allowed = new Set([".txt",".md",".pdf",".html",".csv",".json",".docx"]);
  const fileNames = fs.readdirSync(KNOWLEDGE_DIR).filter((f) => {
  const full = path.join(KNOWLEDGE_DIR, f);
  if (!fs.statSync(full).isFile()) return false;
  return allowed.has(path.extname(f).toLowerCase());
});

  if (fileNames.length === 0) {
    throw new Error("No files found in /knowledge");
  }

  const fileIds = [];
  for (const name of fileNames) {
    const fullPath = path.join(KNOWLEDGE_DIR, name);

    const uploaded = await client.files.create({
      file: fs.createReadStream(fullPath),
      purpose: "assistants",
    });

    fileIds.push(uploaded.id);
    console.log("⬆ uploaded:", name, "->", uploaded.id);
  }

 
  await client.vectorStores.fileBatches.create(vs.id, { file_ids: fileIds });

  console.log("\n Done!");
  console.log("Put this in your .env:");
  console.log(`VECTOR_STORE_ID=${vs.id}`);
}

main().catch((e) => {
  console.error("❌ Error:", e.message || e);
  process.exit(1);
});