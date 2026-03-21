// DEPRECATED: Do not use this file. Use backend/server.js as the main entry point.
throw new Error('This file is deprecated. Use backend/server.js as the main entry point.');

require('dotenv').config();
const express = require('express');
const app = express();
// --- Simple in-memory rate limiting and pending transaction tracking by msisdn ---
const stkRateLimit = new Map(); // msisdn -> timestamp
const stkPendingTx = new Map(); // msisdn -> { txId, createdAt }

require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 1000;
const axios = require('axios');

// Manual test endpoint to simulate payment result callback (for debugging)
// Best practice: directly invoke the callback logic
app.post('/api/manual_callback', (req, res) => {
  const { txId, status, msisdn } = req.body;
  if (!txId || !status || !msisdn) {
    return res.status(400).json({ success: false, message: 'txId, status, msisdn required' });
  }
  // Call the same logic as the real callback
	// Normalize status
	let normStatus = String(status).trim().toUpperCase();
	// Expanded list of failure statuses to include common user-cancelled and wrong PIN values
	const failureStatuses = [
		"FAILED", "CANCELLED", "REVERSED", "DECLINED",
		"USER_CANCELLED", "USERCANCELLED", "USER CANCELLED",
		"WRONG_PIN", "WRONGPIN", "WRONG PIN",
		"REQUEST_CANCELLED_BY_USER", "REQUEST CANCELLED BY USER",
		"REQUEST_CANCELLED", "REQUEST CANCELLED",
		"AUTHENTICATION_FAILED", "AUTHENTICATION FAILED"
	];
	if (["SUCCESS", "COMPLETED"].includes(normStatus)) {
		normStatus = 'COMPLETED';
	} else if (failureStatuses.includes(normStatus)) {
		normStatus = 'FAILED';
	} else {
		normStatus = 'PENDING';
	}
  // Idempotency: only update if new or status changed
  const prev = txStore.get(txId);
  if (!prev || prev.status !== normStatus) {
    txStore.set(txId, { status: normStatus, msisdn, updatedAt: Date.now() });
  }
  // Always clear pending tx if completed/failed
  if (stkPendingTx.has(msisdn)) {
    const pending = stkPendingTx.get(msisdn);
    if (pending && pending.txId === txId) {
      stkPendingTx.delete(msisdn);
    }
  }
  console.log('Manual callback simulated:', { txId, status: normStatus, msisdn });
  return res.json({ success: true, simulated: true });
});

// --- Robust CORS Middleware ---
const allowedOrigins = [
    'http://localhost:1002',
    'https://extrracash.vercel.app'
];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.get('/api/health', (req, res) => res.send('ok'));

// Load environment variables
const trimEnv = (v) => typeof v === 'string' ? v.trim() : v;
const HASKBACK_API_KEY = trimEnv(process.env.HASKBACK_API_KEY); // h263185iGVRZY
const HASKBACK_API_URL = trimEnv(process.env.HASKBACK_API_URL);
const HASKBACK_PARTYB = trimEnv(process.env.HASKBACK_PARTYB); // 6165928
const HASKBACK_ACCOUNT_ID = trimEnv(process.env.HASKBACK_ACCOUNT_ID); // HP329627
const HASKBACK_CALLBACK_URL = trimEnv(process.env.HASKBACK_CALLBACK_URL); // https://your-new-frontend-domain.com/api/haskback_callback
const HASKBACK_ACCOUNT_REFERENCE = trimEnv(process.env.HASKBACK_ACCOUNT_REFERENCE); // NewApp
const HASKBACK_TRANSACTION_DESC = trimEnv(process.env.HASKBACK_TRANSACTION_DESC); // NewApp loan processing fee


// --- Simple in-memory rate limiting and pending transaction tracking by msisdn ---
const stkRateLimit = new Map(); // msisdn -> timestamp
const stkPendingTx = new Map(); // msisdn -> { txId, createdAt }
const txStore = new Map(); // txId -> { status, msisdn, amount, partyB, createdAt, updatedAt, ...extra }
const TX_STATUS_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

// Periodically clean up old txStore entries (best practice)
setInterval(() => {
	const now = Date.now();
	for (const [txId, tx] of txStore.entries()) {
		if (tx.updatedAt && now - tx.updatedAt > TX_STATUS_EXPIRY) {
			txStore.delete(txId);
		}
	}
}, 60 * 60 * 1000); // every hour
const STK_RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const STK_PENDING_TX_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Cleanup old pending transactions and rate limit entries every minute
function cleanupStaleTransactions() {
    const now = Date.now();
    // Clean pending transactions (more aggressively: 2.5 min instead of 5 min)
    for (const [msisdn, val] of stkPendingTx.entries()) {
        if (!val || !val.createdAt || now - val.createdAt > (STK_PENDING_TX_TIMEOUT / 2)) {
            stkPendingTx.delete(msisdn);
        }
    }
    // Clean rate limit entries (same window as STK_RATE_LIMIT_WINDOW)
    for (const [msisdn, ts] of stkRateLimit.entries()) {
        if (now - ts > STK_RATE_LIMIT_WINDOW) {
            stkRateLimit.delete(msisdn);
        }
    }
}
setInterval(cleanupStaleTransactions, 30 * 1000); // Run every 30 seconds

app.post('/api/haskback_push', async (req, res) => {
	   console.log('Received /api/haskback_push:', req.body);
	   // Detailed logging for debugging
	   try {
		   const { msisdn, amount, reference, partyB } = req.body;
		   if (!msisdn || !amount || !reference) {
			   console.error('Missing required fields:', req.body);
		   }
		   if (!partyB) {
			   console.warn('partyB (till number) not provided in request, will use default from env.');
		   }
	   } catch (logErr) {
		   console.error('Error logging request body:', logErr);
	   }
	let { msisdn, amount, reference, partyB } = req.body;
	// Normalize msisdn early for rate limiting
	msisdn = String(msisdn).replace(/\D/g, '');
	if (msisdn.startsWith('0')) {
		msisdn = '254' + msisdn.substring(1);
	} else if (msisdn.startsWith('7') || msisdn.startsWith('1')) {
		msisdn = '254' + msisdn;
	} else if (!msisdn.startsWith('254')) {
		msisdn = '254' + msisdn;
	}
	// Block if there is a pending transaction for this msisdn
	if (stkPendingTx.has(msisdn)) {
		return res.status(429).json({ success: false, message: 'You have a pending transaction. Please complete it before initiating a new one.' });
	}
	// Rate limit: 1 request per msisdn per minute, but allow immediate retry if last tx failed/cancelled/wrong pin/user cancelled
	const now = Date.now();
	const last = stkRateLimit.get(msisdn) || 0;
	let lastTxId = null;
	let lastTxStatus = null;
	// Try to get last txId from pending or txStore
	if (stkPendingTx.has(msisdn)) {
		lastTxId = stkPendingTx.get(msisdn).txId;
	} else {
		// Find the most recent tx for this msisdn in txStore
		for (const [txId, tx] of txStore.entries()) {
			if (tx.msisdn === msisdn && (!lastTxId || (tx.updatedAt && tx.updatedAt > (txStore.get(lastTxId)?.updatedAt || 0)))) {
				lastTxId = txId;
			}
		}
	}
	if (lastTxId && txStore.has(lastTxId)) {
		lastTxStatus = String(txStore.get(lastTxId).status || '').toUpperCase();
	}
	// Allow immediate retry if last tx is FAILED, CANCELLED, REVERSED, DECLINED, USER_CANCELLED, WRONG_PIN, AUTHENTICATION_FAILED
	const retryableStatuses = [
		'FAILED', 'CANCELLED', 'REVERSED', 'DECLINED',
		'USER_CANCELLED', 'USERCANCELLED', 'USER CANCELLED',
		'WRONG_PIN', 'WRONGPIN', 'WRONG PIN',
		'REQUEST_CANCELLED_BY_USER', 'REQUEST CANCELLED BY USER',
		'REQUEST_CANCELLED', 'REQUEST CANCELLED',
		'AUTHENTICATION_FAILED', 'AUTHENTICATION FAILED'
	];
	if (now - last < STK_RATE_LIMIT_WINDOW && !retryableStatuses.includes(lastTxStatus)) {
		return res.status(429).json({ success: false, message: 'Too many STK requests. Please wait a minute before trying again.' });
	}
	stkRateLimit.set(msisdn, now);
	// Validate required fields
	if (!msisdn || !amount || !reference) {
		console.error('Missing required fields:', req.body);
		return res.status(400).json({ success: false, message: 'msisdn, amount, and reference are required.' });
	}
	// Use partyB from request, else from env
	partyB = partyB || HASKBACK_PARTYB;
	// Validate all Hashback fields
	const requiredFields = {
		api_key: HASKBACK_API_KEY,
		account_id: HASKBACK_ACCOUNT_ID,
		amount,
		msisdn,
		reference,
		partyB,
		callback_url: HASKBACK_CALLBACK_URL,
		account_reference: HASKBACK_ACCOUNT_REFERENCE,
		transaction_desc: HASKBACK_TRANSACTION_DESC
	};
	for (const [k, v] of Object.entries(requiredFields)) {
		if (!v || typeof v === 'string' && v.trim() === '') {
			console.error(`Missing or empty field: ${k}`);
			return res.status(400).json({ success: false, message: `Missing or empty field: ${k}` });
		}
	}
	if (!msisdn || !amount || !reference) {
		console.error('Missing required fields:', req.body);
		return res.status(400).json({ success: false, message: 'msisdn, amount, and reference are required.' });
	}
	// Force msisdn to 254XXXXXXXXX format
	msisdn = String(msisdn).replace(/\D/g, '');
	if (msisdn.startsWith('0')) {
		msisdn = '254' + msisdn.substring(1);
	} else if (msisdn.startsWith('7') || msisdn.startsWith('1')) {
		msisdn = '254' + msisdn;
	} else if (!msisdn.startsWith('254')) {
		msisdn = '254' + msisdn;
	}
	// Use partyB from request, else from env
	partyB = partyB || HASKBACK_PARTYB;
	if (!partyB) {
		console.error('Missing partyB (till number)');
		return res.status(400).json({ success: false, message: 'partyB (till number) is required.' });
	}
	try {
		const payload = requiredFields;
		console.log('Sending to Hashback API:', payload);
		const response = await axios.post(
			`${HASKBACK_API_URL}/initiatestk`,
			payload
		);
		// Store transaction for status tracking
		const txId = response.data?.checkout_id || response.data?.transaction_id || response.data?.id || `${msisdn}_${Date.now()}`;
		stkPendingTx.set(msisdn, { txId, createdAt: Date.now() });
		if (typeof txStore !== 'undefined') {
			txStore.set(txId, { status: 'PENDING', msisdn, amount, partyB, createdAt: Date.now() });
		}
		res.json({ success: true, data: response.data, txId });
	} catch (error) {
		console.error('Haskback STK Push Error:', error);
		if (error.response && error.response.data) {
			console.error('Hashback API error response:', error.response.data);
		}
		// Clean up pending tx if failed to initiate
		stkPendingTx.delete(msisdn);
		res.status(500).json({ success: false, error: error.response?.data || error.message });
	}
});

// Endpoint to clear pending tx when completed/failed (should be called by status polling or callback)
app.post('/api/clear_pending_tx', (req, res) => {
	const { msisdn, txId } = req.body;
	if (!msisdn) return res.status(400).json({ success: false, message: 'msisdn required' });
	const pending = stkPendingTx.get(msisdn);
	if (pending && (pending.txId === txId || !txId)) {
		stkPendingTx.delete(msisdn);
		return res.json({ success: true });
	}
	res.status(400).json({ success: false, message: 'txId does not match pending transaction' });
});


// Endpoint to check payment status for msisdn and txId
// Robust status endpoint (best practice)
app.post('/api/haskback_status', (req, res) => {
	console.log('Status check:', req.body);
	let { msisdn, txId } = req.body;
	if (!msisdn || !txId) {
		return res.status(400).json({ status: 'FAILED', message: 'msisdn and txId required' });
	}
	msisdn = String(msisdn).replace(/\D/g, '');
	if (msisdn.startsWith('0')) {
		msisdn = '254' + msisdn.substring(1);
	} else if (msisdn.startsWith('7') || msisdn.startsWith('1')) {
		msisdn = '254' + msisdn;
	} else if (!msisdn.startsWith('254')) {
		msisdn = '254' + msisdn;
	}
	const now = Date.now();
	// Check txStore for real status
	if (txStore.has(txId)) {
		const tx = txStore.get(txId);
		if (tx.status === 'COMPLETED') {
			return res.json({ status: 'COMPLETED', message: 'Payment completed.' });
		} else if (tx.status === 'FAILED') {
			return res.json({ status: 'FAILED', message: 'Payment failed or cancelled.' });
		} else {
			// Still pending, but check for expiry
			if (tx.updatedAt && now - tx.updatedAt > STK_PENDING_TX_TIMEOUT) {
				txStore.set(txId, { ...tx, status: 'FAILED', updatedAt: now });
				return res.json({ status: 'FAILED', message: 'Transaction timed out.' });
			}
			return res.json({ status: 'PENDING', message: 'Transaction is still pending.' });
		}
	}
	// Fallback to pending tx logic
	const pending = stkPendingTx.get(msisdn);
	if (!pending || !pending.txId || pending.txId !== txId) {
		return res.json({ status: 'FAILED', message: 'No pending transaction found.' });
	}
	if (now - pending.createdAt > STK_PENDING_TX_TIMEOUT) {
		stkPendingTx.delete(msisdn);
		return res.json({ status: 'FAILED', message: 'Transaction timed out.' });
	}
	return res.json({ status: 'PENDING', message: 'Transaction is still pending.' });
});

// Callback endpoint for Haskback to notify payment result
// Haskback payment result callback endpoint (best practice)
app.post('/api/haskback_callback', (req, res) => {
	// Log all callback events for audit/debug
	console.log('Haskback callback received:', req.body);
	const { txId, status, msisdn, ...extra } = req.body;
	if (!txId || !status || !msisdn) {
		return res.status(400).json({ success: false, message: 'txId, status, and msisdn required' });
	}
	// Normalize status (best practice)
	let normStatus = String(status).trim().toUpperCase();
	// Expanded list of failure statuses to include common user-cancelled and wrong PIN values
	const failureStatuses = [
	  "FAILED", "CANCELLED", "REVERSED", "DECLINED",
	  "USER_CANCELLED", "USERCANCELLED", "USER CANCELLED",
	  "WRONG_PIN", "WRONGPIN", "WRONG PIN",
	  "REQUEST_CANCELLED_BY_USER", "REQUEST CANCELLED BY USER",
	  "REQUEST_CANCELLED", "REQUEST CANCELLED",
	  "AUTHENTICATION_FAILED", "AUTHENTICATION FAILED"
	];
	if (["SUCCESS", "COMPLETED"].includes(normStatus)) {
		normStatus = 'COMPLETED';
	} else if (failureStatuses.includes(normStatus)) {
		normStatus = 'FAILED';
	} else {
		normStatus = 'PENDING';
	}
	// Idempotency: only update if new or status changed
	const prev = txStore.get(txId);
	if (!prev || prev.status !== normStatus) {
		txStore.set(txId, { status: normStatus, msisdn, ...extra, updatedAt: Date.now() });
	}
	// Always clear pending tx if completed/failed (best practice)
	if (stkPendingTx.has(msisdn)) {
		const pending = stkPendingTx.get(msisdn);
		if (pending && pending.txId === txId) {
			stkPendingTx.delete(msisdn);
		}
	}
	return res.json({ success: true });
});
app.listen(PORT, () => console.log('Listening on', PORT));
