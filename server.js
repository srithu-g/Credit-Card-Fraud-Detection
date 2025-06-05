const express = require("express");
const mysql = require('mysql2');
const bodyParser = require("body-parser");
const cors = require("cors");
const app = express();
const port = 3001;
app.use(cors());
app.use(bodyParser.json());
app.post("/login", (req, res) => {
    const { username, password } = req.body;
    db.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, results) => {
        if (err || !results.length) return res.json({ success: false, message: err ? 'Database error' : 'Invalid credentials' });
        const user = results[0];
        res.json({
            success: true,
            user: { id: user.id, username, role: user.role || (username === 'admin1' ? 'admin' : 'user') }
        });
    });
});

app.get('/user-transactions/:userId', (req, res) => {
    const userId = req.params.userId;
    db.query('SELECT phone_number FROM users WHERE id = ?', [userId], (err, userResults) => {
        if (err || !userResults.length) return res.status(500).json({ error: 'User not found' });
        const phoneNumber = userResults[0].phone_number;
        const query = `
            SELECT DISTINCT t.id AS transaction_id, 
                   CAST(COALESCE(t.amount, 0) AS DECIMAL(10,2)) AS amount, 
                   COALESCE(t.location, 'Unknown') AS location, 
                   COALESCE(t.status, 'pending') AS status, 
                   sn.created_at 
            FROM transactions t
            INNER JOIN sms_notifications sn ON sn.transaction_id = t.id AND sn.phone_number = t.phone_number
            WHERE t.phone_number = ?
            ORDER BY sn.created_at DESC, t.id DESC
        `;
        db.query(query, [phoneNumber], (err, results) => {
            if (err) {
                console.error('Error fetching transactions:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            console.log(`Fetched ${results.length} transactions with SMS for userId ${userId}:`, results);
            res.json(results);
        });
    });
});

app.get('/user-stats/:userId', (req, res) => {
    const userId = req.params.userId;
    db.query('SELECT phone_number FROM users WHERE id = ?', [userId], (err, userResults) => {
        if (err || !userResults.length) return res.status(500).json({ error: 'User not found' });
        const phoneNumber = userResults[0].phone_number;
        const statsQuery = `
            SELECT 
                COUNT(DISTINCT CASE WHEN t.status = 'pending' THEN t.id END) AS fraud_count,
                SUM(CASE WHEN t.status = 'pending' THEN t.amount ELSE 0 END) AS total_fraud_amount
            FROM transactions t
            WHERE t.phone_number = ?
        `;
        const legitQuery = `
            SELECT COUNT(DISTINCT t.id) AS legit_count
            FROM transactions t
            WHERE t.phone_number = ? AND t.status = 'legit'
        `;
        const pendingQuery = `
            SELECT COUNT(DISTINCT t.id) AS pending_count
            FROM transactions t
            WHERE t.phone_number = ? AND t.status = 'pending'
        `;
        db.query(statsQuery, [phoneNumber], (err, fraudResults) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            db.query(legitQuery, [phoneNumber], (err, legitResults) => {
                if (err) return res.status(500).json({ error: 'Database error' });
                db.query(pendingQuery, [phoneNumber], (err, pendingResults) => {
                    if (err) return res.status(500).json({ error: 'Database error' });
                    res.json({
                        fraud_count: fraudResults[0].fraud_count || 0,
                        legit_count: legitResults[0].legit_count || 0,
                        pending_count: pendingResults[0].pending_count || 0,
                        total_fraud_amount: fraudResults[0].total_fraud_amount || 0
                    });
                });
            });
        });
    });
});

app.get('/transactions', (req, res) => {
    db.query('SELECT * FROM transactions', (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(results);
    });
});

app.get('/sms-transactions', (req, res) => {
    const phoneNumber = req.query.phoneNumber;
    const query = 'SELECT transaction_id, phone_number, created_at FROM sms_notifications WHERE phone_number = ? ORDER BY created_at DESC';
    db.query(query, [phoneNumber], (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(results);
    });
});

app.post("/update-status", (req, res) => {
    const { id, status } = req.body;
    db.query('UPDATE transactions SET status = ? WHERE id = ?', [status, id], (err, result) => {
        if (err) return res.json({ success: false, message: 'Database error' });
        if (result.affectedRows > 0) {
            res.json({ success: true });
        } else {
            res.json({ success: false, message: 'Transaction not found' });
        }
    });
});

const { spawn } = require('child_process');
app.post("/transactions", (req, res) => {
    const { amount, location, userId, phoneNumber } = req.body;
    const pythonProcess = spawn('python', ['fraud_detection.py', '--predict', amount, location]);
    let output = '';
    pythonProcess.stdout.on('data', (data) => output += data);
    pythonProcess.stderr.on('data', (data) => console.error(data.toString()));
    pythonProcess.on('close', (code) => {
        if (code !== 0) return res.json({ success: false, message: 'Prediction failed' });
        const isFraud = output.includes('Fraud');
        db.query('INSERT INTO transactions (user_id, amount, location, status, phone_number, is_fraud) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, amount, location, isFraud ? 'pending' : 'legit', phoneNumber, isFraud ? 1 : 0], (err, result) => {
                if (err) return res.json({ success: false, message: 'Database error' });
                res.json({ success: true, id: result.insertId });
            });
    });
});

app.get('/visualization-data', (req, res) => {
    const userId = req.query.userId;
    db.query('SELECT phone_number FROM users WHERE id = ?', [userId], (err, userResults) => {
        if (err || !userResults.length) return res.status(500).json({ error: 'User not found' });
        const phoneNumber = userResults[0].phone_number;
        const distributionQuery = `
            SELECT t.status, COUNT(DISTINCT t.id) as count 
            FROM transactions t
            WHERE t.phone_number = ?
            GROUP BY t.status
        `;
        const fraudByLocationQuery = `
            SELECT t.location, COUNT(DISTINCT t.id) as fraud_count 
            FROM transactions t
            WHERE t.phone_number = ? AND t.status = 'pending'
            GROUP BY t.location
        `;
        db.query(distributionQuery, [phoneNumber], (err, distResults) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            db.query(fraudByLocationQuery, [phoneNumber], (err, locResults) => {
                if (err) return res.status(500).json({ error: 'Database error' });
                res.json({
                    transaction_distribution: distResults,
                    fraud_by_location: locResults
                });
            });
        });
    });
});

app.use(express.static('.'));

const db = mysql.createConnection({
    host: "localhost",
    user: "",
    password: "",
    database: "fraud_detection"
});

db.connect((err) => {
    if (err) console.error('MySQL Error:', err);
    else console.log('MySQL Connected');
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Server error' });
});

app.listen(port, () => console.log(`Server at http://localhost:${port}`));