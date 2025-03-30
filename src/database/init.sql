CREATE DATABASE IF NOT EXISTS kvt_db;
USE kvt_db;

CREATE TABLE IF NOT EXISTS sensor_data (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sensor_id INT NOT NULL,
    temperature FLOAT,
    humidity FLOAT,
    status INT,
    timestamp DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
); 