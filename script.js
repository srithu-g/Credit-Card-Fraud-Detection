document.addEventListener('DOMContentLoaded', () => {
    let currentUser = JSON.parse(localStorage.getItem('currentUser')) || null;

    window.login = async function(event) {
        event.preventDefault();
        const form = event.target;
        const { username, password } = { username: form.username.value, password: form.password.value };
        const error = document.getElementById('error');
        form.querySelector('button[type="submit"]').disabled = true;

        try {
            console.log('Attempting login with:', { username, password });
            const response = await fetch('http://localhost:3001/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            const data = await response.json();
            console.log('Login response:', data);

            if (data.success) {
                currentUser = data.user;
                console.log('Logged in:', currentUser);
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                window.location.href = `dashboard.html?userId=${currentUser.id}`;
            } else {
                error.textContent = data.message || 'Login failed';
                error.style.display = 'block';
            }
        } catch (err) {
            error.textContent = 'Login failed: ' + err.message;
            error.style.display = 'block';
            console.error('Login error:', err);
        } finally {
            form.querySelector('button[type="submit"]').disabled = false;
        }
    };

    window.logout = function() {
        currentUser = null;
        localStorage.removeItem('currentUser');
        window.location.href = 'index.html'; // Updated to redirect to index.html
    };

    async function loadTransactions() {
        if (!currentUser) {
            console.warn('No user, redirecting');
            window.location.href = 'index.html'; // Updated to redirect to index.html
            return;
        }

        const userId = new URLSearchParams(window.location.search).get('userId') || currentUser.id;
        console.log('Loading transactions for userId:', userId);

        try {
            const response = await fetch(`http://localhost:3001/user-transactions/${userId}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            const transactions = await response.json();
            console.log('Fetched transactions:', transactions);

            const table = document.getElementById('transaction-table');
            if (!table) {
                console.error('Table not found');
                alert('Table error');
                return;
            }

            table.innerHTML = transactions.length ? transactions.map(t => `
                <tr>
                    <td>${t.transaction_id || 'N/A'}</td>
                    <td>$${parseFloat(t.amount || 0).toFixed(2)}</td>
                    <td>${t.location || 'N/A'}</td>
                    <td><span class="status-${t.status || 'pending'}">${t.status || 'pending'}</span></td>
                    <td>
                        <button onclick="updateStatus(${t.transaction_id}, 'legit')" ${t.status === 'fraud' || !t.status ? 'disabled' : ''}>Legit</button>
                        <button onclick="updateStatus(${t.transaction_id}, 'fraud')" ${t.status === 'legit' || !t.status ? 'disabled' : ''}>Fraud</button>
                    </td>
                </tr>
            `).join('') : '<tr><td colspan="5">No transactions with SMS</td></tr>';

            updateStats(transactions);
        } catch (err) {
            console.error('Fetch error:', err);
            alert('Failed to load transactions: ' + err.message);
        }
    }

    window.updateStatus = async function(id, status) {
        try {
            const response = await fetch('http://localhost:3001/update-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status })
            });
            const result = await response.json();
            if (result.success) {
                loadTransactions(); // Refresh the table and stats
            } else {
                alert(result.message || 'Failed to update status');
            }
        } catch (err) {
            console.error('Update error:', err);
            alert('Error updating status: ' + err.message);
        }
    };

    function updateStats(transactions) {
        const fraudCount = transactions.filter(t => t.status === 'fraud').length;
        document.getElementById('total-fraud').textContent = fraudCount;
        document.getElementById('total-legitimate').textContent = transactions.filter(t => t.status === 'legit').length;
        document.getElementById('pending-reviews').textContent = transactions.filter(t => t.status === 'pending').length;
        document.getElementById('total-fraud-amount').textContent = `$${transactions.filter(t => t.status === 'fraud').reduce((s, t) => s + (parseFloat(t.amount) || 0), 0).toFixed(2)}`;
    }

    window.refreshData = loadTransactions;

    if (document.getElementById('transaction-table')) {
        loadTransactions();
    }

    document.querySelectorAll('.logout-btn').forEach(btn => btn.addEventListener('click', logout));
    document.querySelector('.refresh-btn').addEventListener('click', refreshData);
});