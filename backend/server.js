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
// Calls Cloudflare's AI run endpoint for the configured model (default: gpt-oss-20b)
app.post('/cf-generate', async (req, res) => {
  const prompt = req.body?.prompt;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'request body must include string "prompt"' });
  }

  const model = req.body?.model || process.env.CLOUDFLARE_MODEL || '@cf/openai/gpt-oss-20b';
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_TOKEN;

  if (!accountId || !token) {
    return res.status(500).json({ error: 'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set in env' });
  }

  // Cloudflare AI run endpoint pattern. The exact model path may vary per Cloudflare naming conventions.
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/responses`;

  try {
    const cfRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // basic body that most Cloudflare AI run endpoints accept; adjust fields as your model requires
        input: prompt,
        model: model,
        // temperature/other generation params may be supported depending on model
        temperature: req.body.temperature ?? 0.2,
        max_output_tokens: req.body.max_output_tokens ?? 512,
      }),
    });

    const body = await cfRes.json().catch(() => null);
    if (!cfRes.ok) return res.status(cfRes.status).json(body ?? { error: 'cloudflare returned non-JSON response' });

    // Return the Cloudflare response as-is. If you want a simplified shape, we can extract it here.
    return res.json(body);
  } catch (err) {
    console.error('cf-generate error', err);
    return res.status(500).json({ error: 'internal error', detail: String(err) });
  }
});

app.listen(process.env.PORT ?? 8787, () => {
  console.log('Server ready');
});