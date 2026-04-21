import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import 'dotenv/config';

async function testModel(name) {
  try {
    const model = new ChatGoogleGenerativeAI({ model: name, apiKey: process.env.GEMINI_API_KEY });
    await model.invoke("say hi");
    console.log("[OK]", name);
  } catch (e) {
    console.log("[ERR]", name, e.message.split('\n')[0]);
  }
}
async function run() {
  await testModel("gemini-1.5-flash");
  await testModel("gemini-1.5-pro");
  await testModel("gemini-1.0-pro");
}
run();
