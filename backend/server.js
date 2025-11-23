import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

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

// POST /sonar-generate
// Body: { prompt: string, model?: string }
// Calls Perplexity's Sonar model via OpenRouter's chat completions endpoint.
app.post('/sonar-generate', async (req, res) => {
  const prompt = req.body?.prompt;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'request body must include string "prompt"' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OR_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'openrouter api key must be set in env (OPENROUTER_API_KEY or OR_API_KEY)' });
  }

  // Default model name; user or env may override
  const model = req.body?.model || process.env.OPENROUTER_PERPLEXITY_MODEL || 'perplexity/sonar';

  const url = 'https://openrouter.ai/api/v1/chat/completions';

  try {
    const bodyPayload = {
      model,
      messages: [
        { role: 'system', content: req.body.system || 'You are a helpful assistant' },
        { role: 'user', content: prompt },
      ],
      temperature: req.body.temperature ?? 0.2,
      max_tokens: req.body.max_output_tokens ?? 512,
      // Add JSON schema response_format for structured output
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "semester_dates",
          strict: true,
          schema: {
            type: "object",
            properties: {
              semester_start: {
                type: "object",
                properties: {
                  year: { type: "integer" },
                  month: { type: "integer" },
                  day: { type: "integer" }
                },
                required: ["year", "month", "day"]
              },
              semester_end: {
                type: "object",
                properties: {
                  year: { type: "integer" },
                  month: { type: "integer" },
                  day: { type: "integer" }
                },
                required: ["year", "month", "day"]
              }
            },
            required: ["semester_start", "semester_end"]
          }
        }
      }
    };

    const orRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyPayload),
    });

    const body = await orRes.json().catch(() => null);
    if (!orRes.ok) return res.status(orRes.status).json(body ?? { error: 'openrouter returned non-JSON response' });

    const shouldParse = req.body?.response_format?.type === 'json_schema' || req.body?.parse_json === true;
    if (shouldParse) {
      try {
        const rawText = body?.choices?.[0]?.message?.content ?? body?.choices?.[0]?.text ?? body?.output?.[0]?.content?.[0]?.text ?? null;
        if (!rawText) {
          return res.json({ success: false, error: 'no textual content found to parse', raw: body });
        }
        const cleaned = String(rawText).trim().replace(/^``````$/g, '').trim();
        const parsed = JSON.parse(cleaned);
        return res.json({ success: true, parsed, raw: body });
      } catch (err) {
        console.error('failed to parse model JSON output', err);
        return res.status(502).json({ error: 'failed to parse JSON from model output', detail: String(err), raw: body });
      }
    }

    return res.json(body);
  } catch (err) {
    console.error('sonar-generate error', err);
    return res.status(500).json({ error: 'internal error', detail: String(err) });
  }
});

app.listen(process.env.PORT ?? 8787, () => {
  console.log('Server ready');
});