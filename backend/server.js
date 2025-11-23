import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

app.post('/sentiment', async (req, res) => {
  const text = req.body.text ?? 'I like you. I love you';

  const cfRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/huggingface/distilbert-sst-2-int8`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    },
  );

  if (!cfRes.ok) return res.status(cfRes.status).json(await cfRes.json());
  res.json(await cfRes.json());
});

// POST /cf-generate
// Body: { prompt: string, model?: string }
// Calls Cloudflare's AI run endpoint for the configured model
app.post('/cf-generate', async (req, res) => {
  const prompt = req.body?.prompt;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'request body must include string "prompt"' });
  }

  // Default to Llama (Cloudflare Meta Llama instruct model)
  const model = req.body?.model || process.env.CLOUDFLARE_MODEL || '@cf/meta/llama-3.1-8b-instruct-fast';

  // Accept multiple env var names for flexibility (older code used CF_* vars)
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_TOKEN || process.env.CLOUDFLARE_AUTH_TOKEN;

  if (!accountId || !token) {
    return res.status(500).json({ error: 'cloudflare account id and token must be set in env (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN or CF_ACCOUNT_ID / CF_TOKEN)' });
  }

  // If the model string starts with '@' we will call the ai/run endpoint for that exact model path
  // (e.g. @cf/meta/..., @hf/...). Otherwise we fallback to the responses endpoint.
  const isRunModel = typeof model === 'string' && model.startsWith('@');

  try {
    let url;
    let bodyPayload;

    if (isRunModel) {
      // Example: https://api.cloudflare.com/client/v4/accounts/<ACCOUNT>/ai/run/@cf/meta/llama-3.1-8b-instruct-fast
      url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

      // Build messages payload matching the Cloudflare run endpoint examples
      const systemMsg = req.body.system || 'You are a friendly assistant';
      bodyPayload = {
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user', content: prompt },
        ],
      };
    } else {
      // Fallback to the responses endpoint for other models
      url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/responses`;
      bodyPayload = {
        input: prompt,
        model: model,
        temperature: req.body.temperature ?? 0.2,
        max_output_tokens: req.body.max_output_tokens ?? 512,
      };
    }

    const cfRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyPayload),
    });

    const body = await cfRes.json().catch(() => null);
    if (!cfRes.ok) return res.status(cfRes.status).json(body ?? { error: 'cloudflare returned non-JSON response' });

    return res.json(body);
  } catch (err) {
    console.error('cf-generate error', err);
    return res.status(500).json({ error: 'internal error', detail: String(err) });
  }
});

app.listen(process.env.PORT ?? 8787, () => {
  console.log('Server ready');
});