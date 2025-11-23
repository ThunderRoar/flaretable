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

app.listen(process.env.PORT ?? 8787, () => {
  console.log('Server ready');
});