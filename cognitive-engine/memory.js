import { Chroma } from "@langchain/community/vectorstores/chroma";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { DynamicTool } from "@langchain/core/tools";
import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

// 1. Database Connections
const pool = new Pool({
  user: "factory",
  host: "localhost",
  database: "pixel_factory",
  password: "factory_dev_2026",
  port: 5432,
});

const embeddings = new GoogleGenerativeAIEmbeddings({
  model: "gemini-embedding-001", // Supported V1beta Embeddings
  apiKey: process.env.GEMINI_API_KEY,
});

async function initVectorStore() {
  return new Chroma(embeddings, {
    collectionName: "skill_embeddings",
    url: "http://localhost:8000",
  });
}

// 2. Skill Synthesizer (Post-Task Write Path)
export async function synthesizeSkill(taskDescription, executedCode, success) {
  if (!success) return; // Only learn from successful runs

  console.log("-> 🧠 [Skill Synthesizer] Extracting execution trace to vector memory...");
  
  // Create document embedding
  const document = `Task Context: ${taskDescription}\nSolution: ${executedCode}`;
  
  // Store metadata to Postgres for relational lookups / reporting
  const query = `
    INSERT INTO skill_documents (agent_id, ticket_type, tech_stack, problem, solution, success) 
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING id;
  `;
  try {
    const res = await pool.query(query, ['charlie', 'feature', ['nodejs', 'postgres'], taskDescription, executedCode, true]);
    const pgId = res.rows[0].id;
    
    // Store exact code in Chroma for semantic retrieval
    const vectorStore = await initVectorStore();
    await vectorStore.addDocuments([
      { pageContent: document, metadata: { pgId, purpose: "coding_solution" } }
    ]);
    
    console.log("-> 🧠 [Memory Saved] Skill securely etched into Layer 5 Chroma DB.");
  } catch (err) {
    console.warn("-> ⚠️ Memory Write Failed (Postgres Schema may be missing):", err.message);
  }
}

// 3. Skill Retriever (Pre-Task Read Path Tool)
export const recallSkillTool = new DynamicTool({
  name: "recall_past_skills",
  description: "Searches the factory's long term ChromaDB memory for past solutions to similar issues. Input is a semantic query string.",
  func: async (queryStr) => {
    try {
      const vectorStore = await initVectorStore();
      const results = await vectorStore.similaritySearch(queryStr, 1);
      
      if (results.length > 0) {
        return `Found relevant historic skill memory:\n\n${results[0].pageContent}`;
      }
      return "No historical skills matched the current problem.";
    } catch (e) {
      return "Memory retrieval offline: " + e.message;
    }
  },
});
