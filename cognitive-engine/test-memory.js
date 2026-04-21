import { synthesizeSkill, recallSkillTool } from './memory.js';

async function testMemorySequence() {
    console.log("Memory DB Sequence Start...");
    const oldRecall = await recallSkillTool.func("How do I connect to a postgres db?");
    console.log("Initial Recall State:", oldRecall.slice(0, 100));

    await synthesizeSkill(
        "Generate a postgres DB connection string setup snippet",
        "import pg from 'pg'; const pool = new pg.Pool({ ... });", 
        true
    );

    console.log("Synthesizer complete, querying memory block...");
    const newRecall = await recallSkillTool.func("How to connect to postgres?");
    
    console.log("\n✅ Verification Gate Memory Recall:");
    console.log(newRecall);
    
    process.exit(0);
}

testMemorySequence();
