import fs from 'fs';
import path from 'path';

export class AntigravityBridgeLLM {
  constructor(options) {
    this.modelName = options.model || "antigravity-bridge";
    this.temperature = options.temperature || 0;
  }

  // Fallback for LangChain base models
  withStructuredOutput(schema) {
    const that = this;
    return {
      invoke: async (messages) => {
        const resultText = await that.invoke(messages);
        try {
           return JSON.parse(resultText);
        } catch(e) {
           return { raw: resultText }; // fallback
        }
      }
    }
  }

  async invoke(messages) {
    const promptId = "req_" + Date.now();
    const reqPath = path.join('/tmp', promptId + '.json');
    const resPath = path.join('/tmp', promptId + '_response.json');
    
    // Format messages natively
    let promptString = '';
    if (Array.isArray(messages)) {
       promptString = messages.map(m => `[ROLE: ${m._getType ? m._getType() : 'user'}]\n${m.content || m.text || JSON.stringify(m)}`).join('\n\n');
    } else {
       promptString = String(messages.content || messages);
    }
    
    fs.writeFileSync(reqPath, JSON.stringify({
      model: this.modelName,
      question: promptString
    }, null, 2));
    
    console.log(`\n\x1b[36m[BRIDGE: ${this.modelName}]\x1b[0m Prompt written to ${reqPath}. Waiting for Antigravity...`);
    
    // Poll loop
    while (!fs.existsSync(resPath)) {
      await new Promise(r => setTimeout(r, 2000));
    }
    
    const response = fs.readFileSync(resPath, 'utf-8');
    console.log(`\x1b[32m[BRIDGE]\x1b[0m Response received from Antigravity! Continuing pipeline...\n`);
    
    // Return in Langchain format
    return {
      content: response,
      text: response
    };
  }
}
