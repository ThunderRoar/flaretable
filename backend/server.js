import express from 'express';
import fetch from 'node-fetch'; // Make sure to `npm install node-fetch`
import 'dotenv/config';

const app = express();
// Use a larger limit to handle potentially large HTML payloads
app.use(express.json({ limit: '10mb' }));

// --- INTERNAL AI PROCESSING ENDPOINT ---
// This endpoint does the actual work of calling the Cloudflare AI.
// It is called by our own /cf-generate endpoint.
app.post('/api/process-with-ai', async (req, res) => {
  const prompt = req.body?.prompt;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Internal endpoint requires a string "prompt"' });
  }

  const model = process.env.CLOUDFLARE_MODEL || '@cf/meta/llama-3.1-8b-instruct-fast';
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !token) {
    console.error('Cloudflare credentials are not set in the environment.');
    return res.status(500).json({ error: 'Server is not configured correctly.' });
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  
  try {
    const aiResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Cloudflare AI API Error:', errorText);
      throw new Error(`Cloudflare AI API responded with status ${aiResponse.status}`);
    }

    const aiResult = await aiResponse.json();
    const icsContent = aiResult.result?.response;

    if (!icsContent) {
      throw new Error('AI did not return valid .ics content in the response.');
    }

    // Convert the raw .ics text to base64
    const base64Ics = Buffer.from(icsContent).toString('base64');

    // Send the final base64 encoded data back
    res.status(200).json({ base64: base64Ics });

  } catch (error) {
    console.error('Error in /api/process-with-ai:', error.message);
    res.status(500).json({ error: 'Failed to process request with AI.' });
  }
});


// --- PUBLIC-FACING ENDPOINT ---
// This is the endpoint your browser extension calls.
app.post('/cf-generate', async (req, res) => {
  const { html } = req.body;
  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'Request body must include string "html"' });
  }

  // 1. Create a detailed prompt for the AI model
  const prompt = `
    Based on the following text content from a webpage, generate a valid iCalendar (.ics) file.
    The .ics file should include all events found in the text, with their summaries (titles), start times (DTSTART), and end times (DTEND).
    Ensure the output is ONLY the raw .ics file content, starting with "BEGIN:VCALENDAR" and ending with "END:VCALENDAR". Do not include any other text, explanations, or markdown code fences.

    Webpage Text:
    ---
    ${html}
    ---
  `;

  try {
    // 2. Call our own internal AI endpoint to do the processing
    const internalApiResponse = await fetch(`http://localhost:${port}/api/process-with-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });

    if (!internalApiResponse.ok) {
      // If the internal call fails, pass its error along
      const errorBody = await internalApiResponse.json();
      return res.status(internalApiResponse.status).json(errorBody);
    }

    // 3. Get the JSON response (with base64 data) from the internal endpoint
    const finalData = await internalApiResponse.json();

    // 4. Send the final response back to the browser extension
    res.status(200).json(finalData);

  } catch (error) {
    console.error('Error in /cf-generate orchestrator:', error.message);
    res.status(500).json({ error: 'Failed to orchestrate AI request.' });
  }
});

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});