// GitHub Issue webhook 接收端：收 issue 事件 -> 存 KV -> 供 Muse 定时取
// 需要绑定：KV namespace -> ISSUE_QUEUE；Secret：WEBHOOK_SECRET

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/webhook') {
      return handleWebhook(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/queue') {
      return handleQueue(env);
    }
    if (request.method === 'POST' && url.pathname === '/ack') {
      return handleAck(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('github-issue-bridge ok', { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  },
};

async function handleWebhook(request, env) {
  const event = request.headers.get('X-GitHub-Event');
  const signature = request.headers.get('X-Hub-Signature-256');
  const bodyText = await request.text();

  // 验签：只有带正确签名的 GitHub 请求才接受，防止别人伪造
  if (!(await verifySignature(env.WEBHOOK_SECRET, bodyText, signature))) {
    return json({ ok: false, error: 'bad signature' }, 401);
  }
  if (event !== 'issues') return json({ ok: true, ignored: 'not issues event' });

  const payload = JSON.parse(bodyText);
  if (payload.action !== 'opened') return json({ ok: true, ignored: `action=${payload.action}` });
  if (payload.sender?.type === 'Bot') return json({ ok: true, ignored: 'bot' });

  const issue = payload.issue;
  const repo = payload.repository.full_name;
  const key = `pending:${repo}:${issue.number}`;
  await env.ISSUE_QUEUE.put(
    key,
    JSON.stringify({
      key,
      repo,
      number: issue.number,
      title: issue.title,
      body: issue.body || '',
      html_url: issue.html_url,
      user: issue.user?.login,
      labels: (issue.labels || []).map((l) => l.name),
      created_at: issue.created_at,
      received_at: new Date().toISOString(),
    }),
    { expirationTtl: 7 * 24 * 3600 } // 7 天后自动过期，防止堆积
  );

  return json({ ok: true, stored: key });
}

// Muse 定时来取待处理的 issue
async function handleQueue(env) {
  const listed = await env.ISSUE_QUEUE.list({ prefix: 'pending:' });
  const items = [];
  for (const k of listed.keys) {
    const v = await env.ISSUE_QUEUE.get(k.name);
    if (v) items.push(JSON.parse(v));
  }
  items.sort((a, b) => a.received_at.localeCompare(b.received_at));
  return json({ ok: true, count: items.length, items });
}

// Muse 处理完一个 issue 后调用，删掉它，避免重复处理
async function handleAck(request, env) {
  const { key } = await request.json().catch(() => ({}));
  if (!key || !key.startsWith('pending:')) {
    return json({ ok: false, error: 'bad key' }, 400);
  }
  await env.ISSUE_QUEUE.delete(key);
  return json({ ok: true, deleted: key });
}

async function verifySignature(secret, payload, signature) {
  if (!secret || !signature || !signature.startsWith('sha256=')) return false;
  const sigHex = signature.slice(7);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== sigHex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sigHex.charCodeAt(i);
  return diff === 0;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
