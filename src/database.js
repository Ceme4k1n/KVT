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
                temperature REAL,
                humidity REAL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`)

      // Таблица статусов
      this.db.run(`CREATE TABLE IF NOT EXISTS statuses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sensor_id INTEGER,
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
    })
  }

  saveMeasurement(sensorId, temperature, humidity) {
    return new Promise((resolve, reject) => {
      this.db.run('INSERT INTO measurements (sensor_id, temperature, humidity) VALUES (?, ?, ?)', [sensorId, temperature, humidity], (err) => {
        if (err) {
          logger.error('Ошибка сохранения измерения:', err)
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  saveStatus(sensorId, status) {
    return new Promise((resolve, reject) => {
      this.db.run('INSERT INTO statuses (sensor_id, status) VALUES (?, ?)', [sensorId, status], (err) => {
        if (err) {
          logger.error('Ошибка сохранения статуса:', err)
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  getLatestMeasurements(limit = 100) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM measurements 
                 ORDER BY timestamp DESC 
                 LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) {
            logger.error('Ошибка получения измерений:', err)
            reject(err)
          } else {
            resolve(rows)
          }
        }
      )
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
