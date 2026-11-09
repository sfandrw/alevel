// A-Level Terminal: saves progress for the Cloudflare Pages version.
// Needs a D1 database bound to the Pages project with the variable name DB (see README.md).
// Optional: add a variable called PASSCODE to the project and the tracker will ask for it once per device.

const APP = "a-level-terminal";
const DOC_ID = /^(state|m-\d{4}-\d{2}|qs-\d{4}-\d{2}-\d{2}|cs-\d{4}-\d{2}-\d{2})$/;
const MAX_DOC = 256 * 1024;
const MAX_FAILS = 10;     // wrong passcodes allowed per address...
const FAIL_WINDOW = 600;  // ...in this many seconds

const json = (status, obj, headers) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, headers || {})
  });

// Tables are created the first time the database is used, so there's nothing to set up by hand.
let ready = null;
function setup(db) {
  if (!ready) {
    ready = db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY, body TEXT NOT NULL, rev INTEGER NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)"),
      db.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('rev', 0)"),
      db.prepare("CREATE TABLE IF NOT EXISTS fails (ip TEXT NOT NULL, at INTEGER NOT NULL)")
    ]).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

function matches(request, etag) {
  return (request.headers.get("If-None-Match") || "").split(",").map((t) => t.trim().replace(/^W\//, "")).includes(etag);
}

async function same(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const p = new Uint8Array(x), q = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < p.length; i++) d |= p[i] ^ q[i];
  return d === 0;
}

// Returns a refusal Response, or null when the request may go ahead.
async function checkPasscode(request, env) {
  const pass = String(env.PASSCODE || "").trim();
  if (!pass) return null;
  const db = env.DB;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Math.floor(Date.now() / 1000);
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM fails WHERE ip = ?1 AND at > ?2").bind(ip, now - FAIL_WINDOW).first("n");
  if (recent >= MAX_FAILS) return json(429, { error: "too_many_attempts" });
  let supplied = request.headers.get("X-Passcode") || "";
  try { supplied = decodeURIComponent(supplied); } catch (e) {}
  if (await same(supplied.trim(), pass)) return null;
  await db.batch([
    db.prepare("INSERT INTO fails (ip, at) VALUES (?1, ?2)").bind(ip, now),
    db.prepare("DELETE FROM fails WHERE at <= ?1").bind(now - FAIL_WINDOW)
  ]);
  await new Promise((r) => setTimeout(r, 500));
  return json(401, { error: "passcode" });
}

function rowToDoc(row) {
  try { const d = JSON.parse(row.body); d._rev = row.rev; return d; } catch (e) { return null; }
}

async function listDocs(request, db) {
  const cur = await db.prepare("SELECT v FROM meta WHERE k = 'rev'").first("v");
  const tag = '"' + cur + '"';
  if (matches(request, tag)) return new Response(null, { status: 304, headers: { ETag: tag, "Cache-Control": "no-store" } });
  const [a, b] = await db.batch([db.prepare("SELECT v FROM meta WHERE k = 'rev'"), db.prepare("SELECT id, body, rev FROM docs")]);
  const rev = a.results[0].v;
  const docs = {};
  for (const row of b.results) { const d = rowToDoc(row); if (d) docs[row.id] = d; }
  return json(200, { docs, rev }, { ETag: '"' + rev + '"' });
}

// Each save carries the revision it was based on (_rev). If someone else saved in between,
// nothing is written and the current copy goes back (409) so the page can merge both.
async function saveDoc(request, db, id) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_DOC) return json(413, { error: "too_big" });
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_DOC) return json(413, { error: "too_big" });
  let value;
  try { value = JSON.parse(text); } catch (e) { return json(400, { error: "bad_json" }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return json(400, { error: "bad_json" });
  const base = value._rev === undefined || value._rev === null ? null : Number(value._rev);
  delete value._rev;
  const body = JSON.stringify(value);
  const res = await db.batch([
    db.prepare("SELECT v FROM meta WHERE k = 'rev'"),
    db.prepare("UPDATE meta SET v = v + 1 WHERE k = 'rev' AND (SELECT rev FROM docs WHERE id = ?1) IS ?2").bind(id, base),
    db.prepare(
      "INSERT INTO docs (id, body, rev) SELECT ?1, ?3, v FROM meta WHERE k = 'rev' AND (SELECT rev FROM docs WHERE id = ?1) IS ?2 " +
      "ON CONFLICT (id) DO UPDATE SET body = excluded.body, rev = excluded.rev"
    ).bind(id, base, body),
    db.prepare("SELECT v FROM meta WHERE k = 'rev'"),
    db.prepare("SELECT body, rev FROM docs WHERE id = ?1").bind(id)
  ]);
  const prev = res[0].results[0].v, now = res[3].results[0].v;
  if (now === prev + 1) return json(200, { ok: true, rev: now, prev });
  const row = res[4].results[0];
  return json(409, { error: "conflict", doc: row ? rowToDoc(row) : null });
}

async function deleteDoc(db, id) {
  const res = await db.batch([
    db.prepare("SELECT v FROM meta WHERE k = 'rev'"),
    db.prepare("UPDATE meta SET v = v + 1 WHERE k = 'rev' AND EXISTS (SELECT 1 FROM docs WHERE id = ?1)").bind(id),
    db.prepare("DELETE FROM docs WHERE id = ?1").bind(id),
    db.prepare("SELECT v FROM meta WHERE k = 'rev'")
  ]);
  return json(200, { ok: true, rev: res[3].results[0].v, prev: res[0].results[0].v });
}

export async function onRequest({ request, env, params }) {
  const parts = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const route = parts.join("/");
  const method = request.method;

  if (route === "ping") {
    if (!env.DB) return json(200, { app: APP, ok: false, need: "DB", host: "cloudflare" });
    try { await setup(env.DB); } catch (e) { return json(200, { app: APP, ok: false, need: "DB", host: "cloudflare" }); }
    return json(200, { app: APP, ok: true, host: "cloudflare" });
  }
  if (!env.DB) return json(503, { error: "no_database" });
  await setup(env.DB);
  const refused = await checkPasscode(request, env);
  if (refused) return refused;

  if (route === "docs") {
    if (method !== "GET") return json(405, { error: "method" });
    return listDocs(request, env.DB);
  }
  const m = /^docs\/([^/]+)$/.exec(route);
  if (!m) return json(404, { error: "not_found" });
  let id = m[1];
  try { id = decodeURIComponent(id); } catch (e) {}
  if (!DOC_ID.test(id)) return json(404, { error: "not_found" });
  if (method === "PUT") return saveDoc(request, env.DB, id);
  if (method === "DELETE") return deleteDoc(env.DB, id);
  return json(405, { error: "method" });
}
