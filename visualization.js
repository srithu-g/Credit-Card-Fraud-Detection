document.addEventListener('DOMContentLoaded', function() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (!currentUser) {
        window.location.href = 'index.html';
        return;
    }

    fetchDataAndCreateVisualizations(currentUser);
});

function fetchDataAndCreateVisualizations(currentUser) {
    const isAdmin = currentUser.role === 'admin';
    const endpoint = isAdmin ? '/transactions' : `/user-transactions/${currentUser.id}`;
    fetch(endpoint, { mode: 'cors' })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status} - ${response.statusText}`);
            return response.json();
        })
        .then(transactions => {
            console.log('Fetched transactions for visualization:', transactions);
            const stats = processTransactions(transactions);
            createPieChart(stats);
            createBarChart(stats);
        })
        .catch(error => {
            console.error('Error fetching transactions:', error);
            alert(`Error loading data. Please try again later or check server logs. Details: ${error.message}`);
        });
}

function processTransactions(transactions) {
    const stats = {
        fraudCount: 0,
        legitCount: 0,
        pendingCount: 0,
        locationStats: {}
    };

    if (!Array.isArray(transactions)) {
        console.error('Transactions is not an array:', transactions);
        return stats;
    }

    transactions.forEach(transaction => {
        if (transaction.status === 'fraud') stats.fraudCount++;
        else if (transaction.status === 'legit') stats.legitCount++;
        else stats.pendingCount++;

        const location = transaction.location || 'Unknown';
        stats.locationStats[location] = (stats.locationStats[location] || 0) + (transaction.status === 'fraud' ? 1 : 0);
    });

    return stats;
}

function createPieChart(stats) {
    const ctx = document.getElementById('fraudPieChart');
    if (!ctx) {
        console.error('Could not find fraudPieChart canvas');
        return;
    }

    if (window.fraudPieChart instanceof Chart) {
        window.fraudPieChart.destroy();
    }

    window.fraudPieChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: ['Legitimate', 'Fraudulent', 'Pending'],
            datasets: [{
                data: [stats.legitCount, stats.fraudCount, stats.pendingCount],
                backgroundColor: ['#2ecc71', '#e74c3c', '#f1c40f'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' },
                title: { display: true, text: 'Transaction Distribution', font: { size: 16 } }
            }
        }
    });
}

function createBarChart(stats) {
    const ctx = document.getElementById('locationBarChart');
    if (!ctx) {
        console.error('Could not find locationBarChart canvas');
        return;
    }

    if (window.fraudBarChart instanceof Chart) {
        window.fraudBarChart.destroy();
    }

    const locations = Object.keys(stats.locationStats);
    const counts = Object.values(stats.locationStats);

    window.fraudBarChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: locations,
            datasets: [{
                label: 'Number of Fraud Transactions',
                data: counts,
                backgroundColor: '#3498db',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Number of Fraud Transactions' } }
            },
            plugins: {
                legend: { display: false },
                title: { display: true, text: 'Fraud by Location', font: { size: 16 } }
            }
        }
    });
}

function refreshCharts() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    fetchDataAndCreateVisualizations(currentUser);
}