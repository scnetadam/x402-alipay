/**
 * x402-Alipay Cloudflare Worker v2.0
 * 纯 Cloudflare 方案，无需服务器
 *
 * 环境变量 (Secrets):
 *   ALIPAY_APP_ID          - 支付宝沙箱 APPID
 *   ALIPAY_APP_PRIVATE_KEY - 应用私钥 (PKCS8, 换行符用 \n 代替)
 *   ALIPAY_PUBLIC_KEY      - 支付宝公钥 (PEM, 换行符用 \n 代替)
 *
 * KV Namespace: X402_ORDERS
 */

// ======================== PEM 解析 ========================

function pemToDer(pem, header, footer) {
  const b64 = pem
    .replaceAll('\r', '')
    .replace(header, '')
    .replace(footer, '')
    .replace(/\s+/g, '');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

function derToPem(der, header, footer) {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = b64.match(/.{1,64}/g).join('\n');
  return `${header}\n${lines}\n${footer}`;
}

// ======================== 密钥导入 ========================

let _privKey = null;
let _pubKey = null;

async function getPrivateKey() {
  if (_privKey) return _privKey;
  let pem = ALIPAY_APP_PRIVATE_KEY;
  // 支持的格式：PKCS8 (BEGIN PRIVATE KEY) 或 PKCS1 (BEGIN RSA PRIVATE KEY)
  if (pem.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    pem = derToPem(new Uint8Array(pemToDer(pem, '-----BEGIN RSA PRIVATE KEY-----', '-----END RSA PRIVATE KEY-----')), '-----BEGIN PRIVATE KEY-----', '-----END PRIVATE KEY-----');
  }
  _privKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(pem, '-----BEGIN PRIVATE KEY-----', '-----END PRIVATE KEY-----'),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return _privKey;
}

async function getPublicKey() {
  if (_pubKey) return _pubKey;
  _pubKey = await crypto.subtle.importKey(
    'spki',
    pemToDer(ALIPAY_PUBLIC_KEY, '-----BEGIN PUBLIC KEY-----', '-----END PUBLIC KEY-----'),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return _pubKey;
}

// ======================== 签名 / 验签 ========================

async function signParams(params) {
  const keys = Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== '' && params[k] != null)
    .sort();
  const str = keys.map((k) => `${k}=${params[k]}`).join('&');
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    await getPrivateKey(),
    new TextEncoder().encode(str)
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function verifyAlipaySign(params, sign) {
  const keys = Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== '')
    .sort();
  const str = keys.map((k) => `${k}=${params[k]}`).join('&');
  const sigBuf = Uint8Array.from(atob(sign), (c) => c.charCodeAt(0));
  return crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    await getPublicKey(),
    sigBuf,
    new TextEncoder().encode(str)
  );
}

// ======================== 工具 ========================

function now() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function genTradeNo() {
  const d = new Date();
  const ts = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
  const rand = Math.random().toString(36).substring(2, 10);
  return `x402_${ts}_${rand}`;
}

const GATEWAY = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
const SITE = 'https://ai-worker-proxy.13616007538.workers.dev';

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json;charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html;charset=utf-8' },
  });
}

// ======================== KV 操作 ========================

async function kvGet(k) {
  try { return await X402_ORDERS.get(k, 'json'); }
  catch { return null; }
}

async function kvPut(k, v) {
  await X402_ORDERS.put(k, JSON.stringify(v), { expirationTtl: 86400 });
}

// ======================== 支付宝 API ========================

async function createPayUrl(amount, subject, tradeNo) {
  const bc = JSON.stringify({
    out_trade_no: tradeNo,
    total_amount: amount,
    subject: subject,
    product_code: 'FAST_INSTANT_TRADE_PAY',
  });
  const p = {
    app_id: ALIPAY_APP_ID,
    method: 'alipay.trade.page.pay',
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: now(),
    version: '1.0',
    notify_url: `${SITE}/alipay/notify`,
    return_url: `${SITE}/pay/${tradeNo}`,
    biz_content: bc,
  };
  p.sign = await signParams(p);
  return GATEWAY + '?' + Object.entries(p).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

async function queryAlipay(tradeNo) {
  const bc = JSON.stringify({ out_trade_no: tradeNo });
  const p = {
    app_id: ALIPAY_APP_ID,
    method: 'alipay.trade.query',
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: now(),
    version: '1.0',
    biz_content: bc,
  };
  p.sign = await signParams(p);
  try {
    const r = await fetch(GATEWAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(p),
    });
    const j = await r.json();
    return j?.alipay_trade_query_response || null;
  } catch {
    return null;
  }
}

// ======================== 路由 ========================

async function handleHome() {
  return json({
    message: 'x402-Alipay Demo',
    version: '2.0-worker',
    site: SITE,
    endpoints: {
      'GET /api/data': 'protected data (requires payment)',
      'GET /pay/:trade_no': 'payment page',
      'GET /orders/:trade_no/status': 'check payment status',
      'POST /alipay/notify': 'Alipay async notification',
    },
  });
}

async function handleApiData(request) {
  const url = new URL(request.url);
  const tradeNo = request.headers.get('x402-trade-no') || url.searchParams.get('trade_no');

  if (tradeNo) {
    // 查本地 KV
    const order = await kvGet(tradeNo);
    if (order?.status === 'paid') {
      return json({ message: 'protected data', value: 42, trade_no: tradeNo });
    }

    // 查支付宝
    const qr = await queryAlipay(tradeNo);
    if (qr?.trade_status === 'TRADE_SUCCESS') {
      await kvPut(tradeNo, { trade_no: tradeNo, status: 'paid', amount: order?.amount || '0.01', paid_at: now() });
      return json({ message: 'protected data', value: 42, trade_no: tradeNo });
    }
  }

  // 402 — 生成支付链接
  const tn = genTradeNo();
  const amt = '0.01';
  const payUrl = await createPayUrl(amt, 'API data fee', tn);
  await kvPut(tn, { trade_no: tn, status: 'pending', amount: amt, created_at: now() });

  return json({
    error: 'payment_required',
    message: `Payment ${amt} CNY required`,
    trade_no: tn,
    amount: amt,
    pay_url: payUrl,
  }, 402);
}

async function handlePay(tradeNo) {
  const order = await kvGet(tradeNo);
  const isPaid = order?.status === 'paid';
  let payUrl = '#';

  if (!isPaid) {
    const amt = order?.amount || '0.01';
    payUrl = await createPayUrl(amt, 'API data fee', tradeNo);
    if (!order) {
      await kvPut(tradeNo, { trade_no: tradeNo, status: 'pending', amount: amt, created_at: now() });
    }
  }

  return html(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:520px;margin:60px auto;text-align:center;padding:0 20px}
h1{font-size:28px;margin-bottom:4px}.sub{color:#888;font-size:14px;margin-bottom:24px}
.card{background:#f6f6f6;border-radius:14px;padding:36px 24px;margin:20px 0}
.price{font-size:52px;font-weight:700;color:#1677ff}.price-label{color:#999;font-size:14px;margin-top:4px}
.pay-btn{display:inline-block;margin-top:20px;padding:16px 50px;background:#1677ff;color:#fff;border-radius:10px;font-size:18px;text-decoration:none;font-weight:500}
.pay-btn:hover{background:#4096ff}
.tip{color:#999;font-size:13px;margin-top:14px}
.mono{font-family:monospace;font-size:12px;color:#666;word-break:break-all;background:#eee;padding:8px 12px;border-radius:6px;display:inline-block}
.oid{font-size:11px;color:#bbb;margin-top:24px;word-break:break-all}
</style></head><body>
<h1>x402</h1><p class="sub">Pay-per-use API gateway</p>
<div class="card">
<div class="price">${isPaid ? '✓' : (order?.amount||'0.01')}</div>
<div class="price-label">${isPaid ? 'Payment Successful' : 'API data access (CNY)'}</div>
${isPaid ? '' : (payUrl !== '#' ? `<a class="pay-btn" href="${payUrl}" target="_blank">Alipay</a>` : '')}
</div>
${isPaid ? `<p class="tip">Use this curl command:</p><span class="mono">curl -H "x402-trade-no: ${tradeNo}" ${SITE}/api/data</span>` : '<p class="tip">Pay via Alipay sandbox App or scan QR code</p>'}
<p class="oid">${tradeNo} · ${isPaid ? 'paid' : 'pending'}</p>
${isPaid ? '' : `<script>setInterval(async()=>{const r=await fetch('/orders/${tradeNo}/status').then(r=>r.json());if(r.status==='paid')location.reload()},3000)</script>`}
</body></html>`);
}

async function handleOrderStatus(tradeNo) {
  const order = await kvGet(tradeNo);
  if (order?.status === 'paid') return json({ trade_no: tradeNo, status: 'paid' });

  const qr = await queryAlipay(tradeNo);
  if (qr?.trade_status === 'TRADE_SUCCESS') {
    await kvPut(tradeNo, { ...order, trade_no: tradeNo, status: 'paid', paid_at: now() });
    return json({ trade_no: tradeNo, status: 'paid' });
  }
  return json({ trade_no: tradeNo, status: 'pending' });
}

async function handleNotify(request) {
  const form = await request.formData();
  const params = {};
  for (const [k, v] of form.entries()) params[k] = v;

  const sign = params.sign;
  delete params.sign;

  const ok = await verifyAlipaySign(params, sign);
  if (!ok) return new Response('fail', { status: 200 });

  const tn = params.out_trade_no;
  const tradeStatus = params.trade_status;

  if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
    const order = await kvGet(tn);
    await kvPut(tn, { ...order, trade_no: tn, status: 'paid', paid_at: now(), notify_data: params });
  }

  return new Response('success', { status: 200 });
}

// ======================== fetch 入口 ========================

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': '*' },
        });
      }

      if (pathname === '/' || pathname === '') return handleHome();
      if (pathname === '/api/data') return handleApiData(request);
      if (pathname.startsWith('/pay/')) return handlePay(pathname.slice(5));
      if (pathname.startsWith('/orders/') && pathname.endsWith('/status')) return handleOrderStatus(pathname.slice(8, -7));
      if (pathname === '/alipay/notify' && request.method === 'POST') return handleNotify(request);

      return json({ error: 'not_found' }, 404);
    } catch (e) {
      return json({ error: 'internal_error', message: e.message }, 500);
    }
  },
};
