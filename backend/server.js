const express = require('express');
const axios = require('axios');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.disable('x-powered-by');
app.use(cors({
  origin: [
    'https://instantmkoponow.vercel.app',
    'http://localhost:3000'
  ],
  credentials: true
}));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'hashback-backend' });
});
// Hashback payment initiation endpoint
app.post('/api/haskback_push', async (req, res) => {
  try {
    const { msisdn, amount, reference, transactionDesc, partyB } = req.body;
    if (!msisdn || !amount) {
      return res.status(400).json({ success: false, message: 'Missing msisdn or amount' });
    }
    // Build payload, prefer frontend values if present, else .env
    const payload = {
      msisdn,
      amount,
      accountId: process.env.HASKBACK_ACCOUNT_ID,
      callbackUrl: process.env.HASKBACK_CALLBACK_URL,
      accountReference: reference || process.env.HASKBACK_ACCOUNT_REFERENCE,
      transactionDesc: transactionDesc || process.env.HASKBACK_TRANSACTION_DESC,
      partyB: partyB || process.env.HASKBACK_PARTYB,
    };

    // Log payload for debugging (remove in production if sensitive)
    console.log('Sending payload to Haskback:', payload);

    const response = await axios.post(process.env.HASKBACK_API_URL + '/initiatestk', payload, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.HASKBACK_API_KEY,
      },
      timeout: 15000,
    });
    return res.json(response.data);
  } catch (error) {
    // Improved error logging
    if (error.response) {
      console.error('Haskback API error:', error.response.status, error.response.data);
      return res.status(500).json({
        success: false,
        message: error.response.data?.message || error.response.data || error.message,
        status: error.response.status,
        data: error.response.data,
      });
    } else {
      console.error('Haskback API error:', error.message);
      return res.status(500).json({ success: false, message: error.message });
    }
  }
});

// Hashback callback endpoint
app.post('/api/haskback_callback', (req, res) => {
  // Process callback from Hashback here
  res.json({ success: true });
});

// Start server
app.listen(PORT, () => {
  console.log(`Hashback server running on port ${PORT}`);
});


function makeMockCheckoutId() {
  return `ws_CO_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

app.post('/api/stk_initiate', async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const amount = Number(req.body.amount);
    const ip = getClientIp(req);
    const rateKey = `${ip}:${phone}`;
    const rate = checkRateLimit(rateKey, STK_RATE_LIMIT_MAX, STK_RATE_LIMIT_WINDOW_MS);
    if (!rate.allowed) {
      return res.status(429).json({
        success: false,
        message: 'Too many STK requests. Please wait before retrying.',
        retryable: true,
        retryAfterMs: rate.retryAfterMs,
      });
    }

    if (!/^254[17]\d{8}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'Invalid phone number format' });
    }

    if (!Number.isFinite(amount) || amount < STK_MIN_AMOUNT || amount > STK_MAX_AMOUNT) {
      return res.status(400).json({
        success: false,
        message: `Invalid amount. Allowed range is ${STK_MIN_AMOUNT} to ${STK_MAX_AMOUNT}.`,
      });
    }

    if (DARAJA_MOCK) {
      const checkoutRequestId = makeMockCheckoutId();
      checkoutStore.set(checkoutRequestId, {
        status: 'PENDING',
        message: 'Mock STK initiated',
        amount: Math.round(amount),
        phone,
        pollCount: 0,
        updatedAt: new Date().toISOString(),
      });

      return res.json({
        success: true,
        mode: 'mock',
        data: {
          MerchantRequestID: `mock_${Date.now()}`,
          CheckoutRequestID: checkoutRequestId,
          ResponseCode: '0',
          ResponseDescription: 'Mock request accepted for processing',
          CustomerMessage: 'Success. Request accepted for processing',
        },
      });
    }

    const readiness = getReadiness();
    if (!readiness.ok) {
      return res.status(400).json({
        success: false,
        message: 'STK is not ready. Update backend/.env Daraja settings.',
        missing: readiness.missing,
      });
    }

    const shortCode = requiredEnv('DARAJA_SHORTCODE');
    const passkey = requiredEnv('DARAJA_PASSKEY');
    const callbackUrl = requiredEnv('DARAJA_CALLBACK_URL');
    const env = getDarajaEnv();
    const transactionType = getTransactionType();
    if (!transactionType) {
      return res.status(400).json({
        success: false,
        message: 'Invalid DARAJA_TRANSACTION_TYPE. Use CustomerPayBillOnline or CustomerBuyGoodsOnline.',
      });
    }
    const effectiveTransactionType = getEffectiveTransactionType(transactionType, env);
    const partyB = getPartyB(shortCode);

    const timestamp = getTimestampEAT();
    const password = buildPassword(shortCode, passkey, timestamp);
    const token = await getAccessToken();
    const base = darajaBaseUrl();

    const accountReference = process.env.DARAJA_ACCOUNT_REFERENCE || 'MkopoExtra';
    const transactionDesc = process.env.DARAJA_TRANSACTION_DESC || 'Loan processing fee';

    const payload = {
      BusinessShortCode: shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: effectiveTransactionType,
      Amount: Math.round(amount),
      PartyA: phone,
      PartyB: partyB,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: accountReference,
      TransactionDesc: transactionDesc,
    };

    const response = await requestWithRetry(() => axios.post(`${base}/mpesa/stkpush/v1/processrequest`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: DARAJA_HTTP_TIMEOUT_MS,
      validateStatus: () => true,
    }));

    const data = response.data;

    if (response.status >= 400) {
      const raw = typeof data === 'string' ? data : JSON.stringify(data || {});
      const message = data?.errorMessage || data?.ResponseDescription || 'Daraja rejected STK request';
      const retryable = isRetryableUpstreamFailure(response.status, message, raw);
      return res.status(502).json({
        success: false,
        message,
        upstreamStatus: response.status,
        upstreamBody: raw.slice(0, 500),
        retryable,
        retryAfterMs: retryable ? 2500 : 0,
      });
    }

    const checkoutRequestId = data.CheckoutRequestID;

    if (checkoutRequestId) {
      checkoutStore.set(checkoutRequestId, {
        status: 'PENDING',
        message: data.ResponseDescription || 'STK initiated',
        amount: Math.round(amount),
        phone,
        updatedAt: new Date().toISOString(),
      });
    }

    return res.json({ success: true, mode: 'live', data });
  } catch (error) {
    let message = error.response?.data?.errorMessage || error.response?.data?.ResponseDescription || error.message;
    let details = error.response?.data || null;
    // If Daraja returns HTML, log and include it in details for diagnosis
    if (error.response && typeof error.response.data === 'string' && error.response.data.trim().startsWith('<!DOCTYPE html')) {
      message = 'Daraja returned HTML error page (see details)';
      details = { html: error.response.data };
      console.error(`[${req.requestId}] STK initiate error: HTML page returned`, error.response.data);
    } else {
      console.error(`[${req.requestId}] STK initiate error:`, message, details);
    }
    const text = String(message || '').toLowerCase();
    const nonRetryable = text.includes('wrong credentials')
      || text.includes('agent number and store number entered do not match')
      || text.includes('invalid transactiontype')
      || text.includes('invalid access token');
    const retryable = !nonRetryable
      && (isRetryableAxiosError(error) || /timeout|temporarily unavailable|disconnect|connect error/i.test(String(message || '')));
    return res.status(500).json({
      success: false,
      message,
      details,
      retryable,
      retryAfterMs: retryable ? 2500 : 0,
    });
  }
});

app.post('/api/stk_status', async (req, res) => {
  try {
    const checkoutRequestId = String(req.body.checkoutRequestId || '').trim();
    if (!checkoutRequestId) {
      return res.status(400).json({ status: 'FAILED', message: 'checkoutRequestId is required' });
    }

    const cached = checkoutStore.get(checkoutRequestId);

    if (DARAJA_MOCK) {
      if (!cached) {
        return res.json({ status: 'PENDING', message: 'Mock transaction still processing' });
      }

      const nextPoll = Number(cached.pollCount || 0) + 1;
      const done = nextPoll >= 3;
      const status = done ? 'COMPLETED' : 'PENDING';
      const message = done ? 'Mock payment completed' : 'Mock transaction still processing';

      const updated = {
        ...cached,
        pollCount: nextPoll,
        status,
        message,
        updatedAt: new Date().toISOString(),
      };

      checkoutStore.set(checkoutRequestId, updated);
      return res.json({ status, message, data: updated });
    }

    if (cached && cached.status !== 'PENDING') {
      return res.json({ status: cached.status, message: cached.message || null, data: cached });
    }

    // Query Daraja for latest status when still pending.
    const shortCode = requiredEnv('DARAJA_SHORTCODE');
    const passkey = requiredEnv('DARAJA_PASSKEY');
    const timestamp = getTimestampEAT();
    const password = buildPassword(shortCode, passkey, timestamp);
    const token = await getAccessToken();
    const base = darajaBaseUrl();

    const queryPayload = {
      BusinessShortCode: shortCode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    };

    const queryResponse = await requestWithRetry(() => axios.post(`${base}/mpesa/stkpushquery/v1/query`, queryPayload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: DARAJA_HTTP_TIMEOUT_MS,
      validateStatus: () => true,
    }));

    const d = queryResponse.data || {};
    if (queryResponse.status >= 400) {
      return res.json({
        status: 'PENDING',
        message: d?.errorMessage || d?.ResponseDescription || `Status query upstream HTTP ${queryResponse.status}`,
      });
    }
    const resultCode = Number(d.ResultCode);

    let status = 'PENDING';
    if (Number.isFinite(resultCode)) {
      status = resultCode === 0 ? 'COMPLETED' : 'FAILED';
    }

    const record = {
      status,
      message: d.ResultDesc || d.ResponseDescription || 'Awaiting confirmation',
      resultCode: Number.isFinite(resultCode) ? resultCode : null,
      updatedAt: new Date().toISOString(),
    };
    checkoutStore.set(checkoutRequestId, record);

    return res.json({ status: record.status, message: record.message, data: d });
  } catch (error) {
    // Keep pending on transient backend/API issues so frontend can retry polling.
    return res.json({
      status: 'PENDING',
      message: error.response?.data?.errorMessage || error.message || 'Still processing',
    });
  }
});

app.post('/api/stk_callback', (req, res) => {
  try {
    const body = req.body?.Body?.stkCallback;
    if (!body) {
      return res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback payload' });
    }

    const checkoutRequestId = body.CheckoutRequestID;
    const resultCode = Number(body.ResultCode);
    const status = resultCode === 0 ? 'COMPLETED' : 'FAILED';

    checkoutStore.set(checkoutRequestId, {
      status,
      resultCode,
      message: body.ResultDesc || null,
      callbackData: body,
      updatedAt: new Date().toISOString(),
    });

    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (_error) {
    return res.status(500).json({ ResultCode: 1, ResultDesc: 'Callback processing error' });
  }
});

app.use((req, res) => {
  // Fallback for unknown API routes.
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'API route not found' });
  }
  return res.status(404).send('Not Found');
});

// --- Daraja Readiness Check ---
function getReadiness() {
  // Required env vars for Daraja
  const required = [
    'DARAJA_CONSUMER_KEY',
    'DARAJA_CONSUMER_SECRET',
    'DARAJA_SHORTCODE',
    'DARAJA_PASSKEY',
    'DARAJA_CALLBACK_URL',
    'DARAJA_TRANSACTION_TYPE',
  ];
  const missing = required.filter((k) => !process.env[k] || String(process.env[k]).includes('your_'));
  const configuredTransactionType = process.env.DARAJA_TRANSACTION_TYPE || null;
  // For sandbox, transaction type may be forced
  const effectiveTransactionType = configuredTransactionType === 'CustomerBuyGoodsOnline' ? 'CustomerPayBillOnline' : configuredTransactionType;
  return {
    ok: missing.length === 0,
    missing,
    configuredTransactionType,
    effectiveTransactionType,
  };
}

app.listen(PORT, () => {
  const readiness = getReadiness();
  console.log(`Daraja backend running at http://localhost:${PORT}`);
  console.log(`STK mode: ${typeof DARAJA_MOCK !== 'undefined' && DARAJA_MOCK ? 'MOCK' : 'LIVE'}`);
  if (typeof DARAJA_MOCK !== 'undefined' && !DARAJA_MOCK && readiness.configuredTransactionType !== readiness.effectiveTransactionType) {
    console.warn(`Using ${readiness.effectiveTransactionType} for sandbox compatibility (configured ${readiness.configuredTransactionType}).`);
  }
  if (typeof DARAJA_MOCK !== 'undefined' && !DARAJA_MOCK && !readiness.ok) {
    console.warn(`STK live mode is not ready. Missing/invalid: ${readiness.missing.join(', ')}`);
  }
});

app.use((err, _req, res, _next) => {
  const rid = _req?.requestId || 'no-request-id';
  console.error(`[${rid}] Unhandled server error:`, err.message);
  return res.status(500).json({ success: false, message: 'Internal server error' });
});
