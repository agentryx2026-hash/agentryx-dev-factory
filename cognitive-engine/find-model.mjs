import https from 'https';
import 'dotenv/config';

https.get('https://generativelanguage.googleapis.com/v1beta/models?key=' + process.env.GEMINI_API_KEY, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const models = JSON.parse(data).models;
    const embedModels = models.filter(m => m.supportedGenerationMethods.includes('embedContent'));
    console.log(embedModels.map(m => m.name));
  });
});
