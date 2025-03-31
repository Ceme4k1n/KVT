const sqlite3 = require('sqlite3').verbose()
const winston = require('winston')

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.File({ filename: 'logs/database.log' })],
})

class Database {
  constructor() {
    this.db = new sqlite3.Database('kvt.db', (err) => {
      if (err) {
        logger.error('Ошибка при подключении к базе данных:', err)
        return
      }
      logger.info('Подключение к базе данных успешно')
      this.initTables()
    })
  }

  initTables() {
    this.db.serialize(() => {
      // Таблица измерений
      this.db.run(`CREATE TABLE IF NOT EXISTS measurements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sensor_id INTEGER,
                sensor_name TEXT,
                temperature REAL,
                humidity REAL,
                status INTEGER,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`)

      // Таблица пороговых значений
      this.db.run(`CREATE TABLE IF NOT EXISTS thresholds (
                sensor_id INTEGER PRIMARY KEY,
                temperature_min REAL,
                temperature_max REAL,
                humidity_min REAL,
                humidity_max REAL
            )`)

      // Таблица для хранения названий датчиков (по желанию)
      this.db.run(`CREATE TABLE IF NOT EXISTS sensors (
                id INTEGER PRIMARY KEY,
                name TEXT
            )`)
    })
  }

  saveMeasurement(sensorId, sensorName, temperature, humidity, status) {
    return new Promise((resolve, reject) => {
      this.db.run('INSERT INTO measurements (sensor_id, sensor_name, temperature, humidity, status) VALUES (?, ?, ?, ?, ?)', [sensorId, sensorName, temperature, humidity, status], (err) => {
        if (err) {
          logger.error('Ошибка сохранения измерения:', err)
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  saveThreshold(sensorId, temperatureMin, temperatureMax, humidityMin, humidityMax) {
    return new Promise((resolve, reject) => {
      this.db.run('INSERT OR REPLACE INTO thresholds (sensor_id, temperature_min, temperature_max, humidity_min, humidity_max) VALUES (?, ?, ?, ?, ?)', [sensorId, temperatureMin, temperatureMax, humidityMin, humidityMax], (err) => {
        if (err) {
          logger.error('Ошибка сохранения пороговых значений:', err)
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  fetchMeasurements() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM measurements ORDER BY timestamp DESC', [], (err, rows) => {
        if (err) {
          logger.error('Ошибка при получении измерений:', err)
          reject(err)
        } else {
          resolve(rows)
        }
      })
    })
  }

  close() {
    this.db.close((err) => {
      if (err) {
        logger.error('Ошибка при закрытии базы данных:', err)
      } else {
        logger.info('База данных закрыта')
      }
    })
  }
}

module.exports = Database
