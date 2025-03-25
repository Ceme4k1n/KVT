const express = require('express')
const path = require('path')
const { SerialPort } = require('serialport')
const sqlite3 = require('sqlite3').verbose()
const winston = require('winston')
const TelegramBot = require('node-telegram-bot-api')
const nodemailer = require('nodemailer')

// Инициализация логгера
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.File({ filename: 'logs/error.log', level: 'error' }), new winston.transports.File({ filename: 'logs/combined.log' })],
})

if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple(),
    })
  )
}

// Инициализация Express
const app = express()
const port = process.env.PORT || 3000

// Middleware
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// Инициализация базы данных
const db = new sqlite3.Database('kvt.db', (err) => {
  if (err) {
    logger.error('Ошибка подключения к базе данных:', err)
    return
  }
  logger.info('Подключение к базе данных успешно')
  initDatabase()
})

// Инициализация Modbus
let serialPort
function initModbus() {
  const portName = process.platform === 'win32' ? 'COM1' : '/dev/ttymcx0'
  serialPort = new SerialPort({
    path: portName,
    baudRate: 115200,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
  })

  serialPort.on('open', () => {
    logger.info('Порт Modbus открыт')
  })

  serialPort.on('error', (err) => {
    logger.error('Ошибка порта Modbus:', err)
  })
}

// Инициализация базы данных
function initDatabase() {
  db.serialize(() => {
    // Таблица датчиков
    db.run(`CREATE TABLE IF NOT EXISTS sensors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            zones_count INTEGER NOT NULL,
            temp_threshold_min REAL,
            temp_threshold_max REAL,
            humidity_threshold_min REAL,
            humidity_threshold_max REAL
        )`)

    // Таблица измерений
    db.run(`CREATE TABLE IF NOT EXISTS measurements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sensor_id INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            temperature REAL,
            humidity REAL,
            FOREIGN KEY (sensor_id) REFERENCES sensors(id)
        )`)

    // Таблица статусов
    db.run(`CREATE TABLE IF NOT EXISTS statuses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sensor_id INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            status INTEGER,
            FOREIGN KEY (sensor_id) REFERENCES sensors(id)
        )`)
  })
}

// API маршруты
app.get('/api/sensors', (req, res) => {
  db.all('SELECT * FROM sensors', [], (err, rows) => {
    if (err) {
      logger.error('Ошибка получения списка датчиков:', err)
      res.status(500).json({ error: 'Внутренняя ошибка сервера' })
      return
    }
    res.json(rows)
  })
})

app.get('/api/measurements/:sensorId', (req, res) => {
  const { sensorId } = req.params
  const { period } = req.query
  const query = `
        SELECT * FROM measurements 
        WHERE sensor_id = ? 
        AND timestamp >= datetime('now', ?)
        ORDER BY timestamp DESC
    `

  db.all(query, [sensorId, period], (err, rows) => {
    if (err) {
      logger.error('Ошибка получения измерений:', err)
      res.status(500).json({ error: 'Внутренняя ошибка сервера' })
      return
    }
    res.json(rows)
  })
})

// Запуск сервера
app.listen(port, () => {
  logger.info(`Сервер запущен на порту ${port}`)
  initModbus()
})
