import pandas as pd
import pickle
from sklearn.preprocessing import LabelEncoder, StandardScaler
import time
from datetime import datetime
import logging
from twilio.rest import Client
import mysql.connector

logging.basicConfig(filename='fraud_detection_log.log', level=logging.INFO, format='%(asctime)s - %(message)s')

account_sid = ''
auth_token = ''
client = Client(account_sid, auth_token)

db = mysql.connector.connect(
    host="localhost",
    user="",
    password="",
    database="fraud_detection"
)
cursor = db.cursor()

def send_fraud_alert_sms(transaction_id, amount, user_phone_number):
    cursor.execute("SELECT COUNT(*) FROM sms_notifications WHERE transaction_id = %s AND phone_number = %s", 
                   (transaction_id, user_phone_number))
    sms_count = cursor.fetchone()[0]
    
    if sms_count > 0:
        print(f"SMS already sent for Transaction ID {transaction_id} to {user_phone_number}. Skipping.")
        logging.info(f"SMS already sent for Transaction ID {transaction_id} to {user_phone_number}. Skipping.")
        return

    website_link = "https://b5cc-43-225-26-110.ngrok-free.app"
    message_body = (f"🚨 Alert: Transaction ID {transaction_id}, Amount: ${amount:.2f} "
                    f"flagged for review. Visit: {website_link}")
    try:
        message = client.messages.create(
            from_='whatsapp:+14155238886', 
            body=message_body,
            to=f'whatsapp:{user_phone_number}'
        )
        print(f"WhatsApp message sent to {user_phone_number}: {message.sid}")
        logging.info(f"WhatsApp message sent for Transaction ID {transaction_id} to {user_phone_number}: {message.sid}")
        query = "INSERT INTO sms_notifications (transaction_id, phone_number, created_at) VALUES (%s, %s, %s)"
        cursor.execute(query, (transaction_id, user_phone_number, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
        db.commit()
    except Exception as e:
        print(f"Error sending WhatsApp message to {user_phone_number}: {e}")
        logging.error(f"Error sending WhatsApp message for Transaction ID {transaction_id} to {user_phone_number}: {e}")

def preprocess_transaction(df, label_encoders=None, fit_encoders=False):
    df_processed = df.copy()
    df_processed['trans_date_trans_time'] = pd.to_datetime(df_processed['trans_date_trans_time'])
    df_processed['hour'] = df_processed['trans_date_trans_time'].dt.hour
    df_processed['day_of_week'] = df_processed['trans_date_trans_time'].dt.dayofweek
    df_processed['month'] = df_processed['trans_date_trans_time'].dt.month
    columns_to_drop = ['Unnamed: 0', 'trans_date_trans_time', 'cc_num', 'first', 'last', 
                       'street', 'city', 'dob', 'trans_num']
    df_processed = df_processed.drop(columns=columns_to_drop, errors='ignore')
    
    categorical_cols = ['merchant', 'category', 'gender', 'state', 'job']
    numerical_cols = ['amt', 'lat', 'long', 'city_pop', 'unix_time', 'merch_lat', 
                      'merch_long', 'hour', 'day_of_week', 'month']
    
    if fit_encoders or label_encoders is None:
        label_encoders = {col: LabelEncoder() for col in categorical_cols}
        for col in categorical_cols:
            df_processed[col] = label_encoders[col].fit_transform(df_processed[col])
    else:
        for col in categorical_cols:
            df_processed[col] = df_processed[col].map(
                lambda x: label_encoders[col].transform([x])[0] if x in label_encoders[col].classes_ else -1
            )
    
    df_processed[numerical_cols] = scaler.transform(df_processed[numerical_cols])
    df_processed['amt'] = df_processed['amt'].abs()
    
    trained_features = ['merchant', 'category', 'amt', 'gender', 'state', 'zip', 'lat', 
                        'long', 'city_pop', 'job', 'unix_time', 'merch_lat', 'merch_long', 
                        'hour', 'day_of_week', 'month']
    df_processed = df_processed[trained_features]
    return df_processed, label_encoders

def simulate_real_time_transactions(df, df_raw, model, delay=1):
    total_transactions = len(df)
    fraud_count = 0
    print(f"Starting real-time simulation with {total_transactions} transactions...")
    
    user_mapping = {
        '': 1,  
        '': 2  
    }
    
    for idx, (index, transaction) in enumerate(df.iterrows()):
        transaction_df = pd.DataFrame([transaction])
        is_fraud = model.predict(transaction_df)[0]
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        amount = transaction['amt']
        log_message = (f"Transaction {idx + 1}/{total_transactions} | "
                      f"Amount: ${amount:.2f} | "
                      f"Predicted: {'Fraud' if is_fraud else 'Legitimate'}")
        logging.info(log_message)
        print(f"{timestamp} - {log_message}")
        
        actual_class = df_raw.iloc[idx]['is_fraud']
        status = 'pending'  
        location = df_raw.iloc[idx]['city'] or 'Unknown'
        phone_number = df_raw.iloc[idx]['phone_number']
        user_id = user_mapping.get(phone_number, (idx % 2) + 1)

        query = "INSERT INTO transactions (user_id, amount, location, status, phone_number, is_fraud, timestamp) VALUES (%s, %s, %s, %s, %s, %s, %s)"
        cursor.execute(query, (user_id, amount, location, status, phone_number, int(actual_class), timestamp))
        db.commit()
        cursor.execute("SELECT LAST_INSERT_ID()")
        transaction_id = cursor.fetchone()[0]

        print(f"🚨 ALERT: Transaction ID {transaction_id} flagged for review.")
        send_fraud_alert_sms(transaction_id, amount, phone_number)
        
        if actual_class == 1:
            fraud_count += 1
        
        time.sleep(delay)
    
    print(f"\nSimulation Complete!")
    print(f"Total Transactions Processed: {total_transactions}")
    print(f"Fraudulent Transactions Detected: {fraud_count}")
    print(f"Legitimate Transactions: {total_transactions - fraud_count}")

if __name__ == "__main__":
    with open("voting_model.pkl", "rb") as model_file:
        model = pickle.load(model_file)
    with open("scaler.pkl", "rb") as scaler_file:
        scaler = pickle.load(scaler_file)

    df_raw = pd.read_csv("creditcard.csv")
    phone_numbers = ['', '']
    num_rows = len(df_raw)
    half = num_rows // 2
    remainder = num_rows % 2
    phone_list = ([phone_numbers[0]] * half + [phone_numbers[1]] * (half + remainder))[:num_rows]
    df_raw['phone_number'] = phone_list

    print("Phone number distribution:")
    print(df_raw['phone_number'].value_counts())

    df_preprocessed, label_encoders = preprocess_transaction(df_raw, fit_encoders=True)
    fraud_indices = df_raw[df_raw['is_fraud'] == 1].index
    if len(fraud_indices) >= 5:
        fraud_sample = df_preprocessed.loc[fraud_indices].sample(n=5, random_state=42)
        fraud_raw_sample = df_raw.loc[fraud_indices].sample(n=5, random_state=42)
    else:
        fraud_sample = df_preprocessed.loc[fraud_indices]
        fraud_raw_sample = df_raw.loc[fraud_indices]

    legit_indices = df_raw[df_raw['is_fraud'] == 0].index
    legit_sample = df_preprocessed.loc[legit_indices].sample(n=5, random_state=42)
    legit_raw_sample = df_raw.loc[legit_indices].sample(n=5, random_state=42)

    df_sample = pd.concat([fraud_sample, legit_sample]).reset_index(drop=True)
    df_raw_sample = pd.concat([fraud_raw_sample, legit_raw_sample]).reset_index(drop=True)
    simulate_real_time_transactions(df_sample, df_raw_sample, model, delay=0.5)
    cursor.close()
    db.close()