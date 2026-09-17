// Thin wrapper around the Couchbase Capella Data API (REST, key-value only).
// Chosen over the stateful Node SDK because it fits serverless functions --
// no persistent connection pool to manage across cold starts, same reasoning
// that would have applied to Upstash Redis if we'd gone that route instead.
//
// Required env vars (set these in the Vercel project settings):
//   COUCHBASE_ENDPOINT   e.g. https://cb-xxxxxxxx.data.cloud.couchbase.com
//   COUCHBASE_USERNAME   Capella database (cluster access) username
//   COUCHBASE_PASSWORD   Capella database (cluster access) secret
// Optional (defaults shown):
//   COUCHBASE_BUCKET      case_partner
//   COUCHBASE_SCOPE       _default
//   COUCHBASE_COLLECTION  _default
//
// Until those are set, every helper below degrades gracefully -- callers
// check isConfigured() first and the API routes return a "not configured"
// response instead of throwing, so the demo keeps working (just without
// cross-session memory) if credentials aren't wired up yet.

const BASE = () => process.env.COUCHBASE_ENDPOINT;
const BUCKET = () => process.env.COUCHBASE_BUCKET || 'case_partner';
const SCOPE = () => process.env.COUCHBASE_SCOPE || '_default';
const COLLECTION = () => process.env.COUCHBASE_COLLECTION || '_default';
const USERNAME = () => process.env.COUCHBASE_USERNAME;
const PASSWORD = () => process.env.COUCHBASE_PASSWORD;

function authHeader() {
  const token = Buffer.from(`${USERNAME()}:${PASSWORD()}`).toString('base64');
  return `Basic ${token}`;
}

function docUrl(key) {
  return (
    `${BASE()}/v1/buckets/${BUCKET()}/scopes/${SCOPE()}/collections/${COLLECTION()}` +
    `/documents/${encodeURIComponent(key)}`
  );
}

export function isConfigured() {
  return Boolean(BASE() && USERNAME() && PASSWORD());
}

// Slug a display name into a stable document-key-safe user id.
// There's no real auth in this demo, so "the name the student types in"
// is the identity -- good enough to make the "welcome back" moment work.
export function slugify(name) {
  return (
    (name || 'guest')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'guest'
  );
}

export async function getDoc(key) {
  if (!isConfigured()) throw new Error('Couchbase not configured');
  const res = await fetch(docUrl(key), {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Couchbase GET ${key} failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  // The Data API wraps the document under different shapes depending on
  // version; unwrap the common ones so callers always get the plain doc.
  return body && body.content !== undefined ? body.content : body;
}

export async function upsertDoc(key, value) {
  if (!isConfigured()) throw new Error('Couchbase not configured');
  const headers = {
    Authorization: authHeader(),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const body = JSON.stringify(value);

  // PUT replaces an existing document; if it doesn't exist yet, fall back
  // to POST (insert). Try PUT first since updates are the common case once
  // a student has a profile.
  let res = await fetch(docUrl(key), { method: 'PUT', headers, body });
  if (res.status === 404) {
    res = await fetch(docUrl(key), { method: 'POST', headers, body });
  }
  if (!res.ok) {
    throw new Error(`Couchbase write ${key} failed: ${res.status} ${await res.text()}`);
  }
  return value;
}
