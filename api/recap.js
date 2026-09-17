// In-memory store. This resets on cold start, which is fine for a live demo:
// the POST (from ElevenLabs) and the GET (from your browser tab) happen
// seconds apart, so the same warm serverless instance serves both.
// Not meant for production durability -- just for this demo.
let latestRecap = null;

export default function handler(req, res) {
  // Allow the browser page to poll this from the same origin -- no CORS
  // headers needed since both live on the same Vercel deployment. If you
  // ever host the frontend elsewhere, add CORS headers here.

  if (req.method === 'POST') {
    const { summary } = req.body || {};
    latestRecap = {
      summary: summary || 'No summary provided',
      timestamp: new Date().toISOString(),
    };
    return res.status(200).json({ status: 'ok', received: latestRecap });
  }

  if (req.method === 'GET') {
    return res.status(200).json({ recap: latestRecap });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
