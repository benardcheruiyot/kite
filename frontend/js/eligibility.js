const nameRegex = /^[a-zA-Z\s.'-]{2,}$/;
const phoneRegex = /^(?:\+?254|0)[17]\d{8}$/;
const idRegex = /^\d{7,10}$/;

function handleSubmit(e) {
    e.preventDefault();
    const f = e.target;
    const name = f.name.value.trim();
    const phone = f.phone_number.value.trim();
    const id = f.id_number.value.trim();
    const type = f.loan_type.value;

    if (!nameRegex.test(name)) {
        return Swal.fire('Invalid Name', 'Please enter your full name (letters only)', 'error');
    }
    if (!phoneRegex.test(phone)) {
        return Swal.fire('Invalid Phone', 'Please enter a valid Safaricom number (07XXXXXXXX)', 'error');
    }
    if (!idRegex.test(id)) {
        return Swal.fire('Invalid ID', 'Please enter a valid Kenyan ID (7-10 digits)', 'error');
    }
    if (!type) {
        return Swal.fire('Missing Loan Type', 'Please select your loan purpose', 'error');
    }

    // Store data
    sessionStorage.setItem('myLoan', JSON.stringify({
        name,
        phone_number: phone,
        id_number: id,
        loan_type: type
    }));

    // Show loading
    Swal.fire({
        title: 'Checking Eligibility',
        html: 'We\'re verifying your details...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    // Simulate API check
    setTimeout(() => {
        Swal.close();
        window.location.href = '/apply';
    }, 2500);
}

// Fill form if returning
window.onload = () => {
    const data = JSON.parse(sessionStorage.getItem('myLoan') || '{}');
    if (data.name) {
        document.getElementById('name').value = data.name;
        document.getElementById('name').dispatchEvent(new Event('input'));
    }
    if (data.phone_number) {
        document.getElementById('phone_number').value = data.phone_number;
        document.getElementById('phone_number').dispatchEvent(new Event('input'));
    }
    if (data.id_number) {
        document.getElementById('id_number').value = data.id_number;
        document.getElementById('id_number').dispatchEvent(new Event('input'));
    }
    if (data.loan_type) {
        document.getElementById('loan_type').value = data.loan_type;
    }
};
