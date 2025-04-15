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

      // Таблица для хранения настроек подключения
      this.db.run(`CREATE TABLE IF NOT EXISTS connection_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sensors_number INTEGER DEFAULT 10,
                connect_rtu TEXT DEFAULT 'COM4',
                baudRate INTEGER CHECK (baudRate IN (9600, 115200, 19200, 38400)),
                parity TEXT DEFAULT 'none',
                stopBits INTEGER DEFAULT 1,
                dataBits INTEGER DEFAULT 8,
                tgUserId INTEGER,
                tgToken TEXT,
                proxy TEXT
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

  saveSensorName(sensorId, name) {
    return new Promise((resolve, reject) => {
      this.db.run('INSERT OR REPLACE INTO sensors (id, name) VALUES (?, ?)', [sensorId, name], (err) => {
        console.log(sensorId, name)

        if (err) {
          logger.error('Ошибка сохранения названия датчика:', err)
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
        console.log('Сохранил пороговые температуры')
        if (err) {
          logger.error('Ошибка сохранения пороговых значений:', err)
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  fetchAllThreshold() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM thresholds ORDER BY sensor_id DESC', [], (err, rows) => {
        if (err) {
          logger.error('Ошибка при получении измерений:', err)
          reject(err)
        } else {
          resolve(rows)
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

  fetchAllSensors() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM sensors', [], (err, rows) => {
        if (err) {
          logger.error('Ошибка при получении названий датчиков:', err)
          reject(err)
        } else {
          resolve(rows)
        }
      })
    })
  }

  fetchMeasurementsBySensorAndTime(sensorId, timestampLimit) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM measurements 
        WHERE sensor_id = ? AND timestamp >= ?
        ORDER BY timestamp ASC
      `
      this.db.all(query, [sensorId, timestampLimit.toISOString()], (err, rows) => {
        if (err) {
          logger.error('Ошибка при получении измерений по датчику:', err)
          reject(err)
        } else {
          resolve(rows)
        }
      })
    })
  }

  saveConnectionSettings(connect_rtu, baudRate, parity, stopBits, dataBits, tgUserId, tgToken, proxy) {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM connection_settings WHERE id = ?`, [1], (err, row) => {
        if (err) {
          logger.error('Ошибка при проверке существования записи:', err)
          return reject(err)
        }

        if (row) {
          const updates = []
          const parameters = []

          if (connect_rtu !== undefined && connect_rtu !== '') {
            updates.push('connect_rtu = ?')
            parameters.push(connect_rtu)
          }
          if (baudRate !== undefined && baudRate !== '') {
            updates.push('baudRate = ?')
            parameters.push(baudRate)
          }
          if (parity !== undefined && parity !== '') {
            updates.push('parity = ?')
            parameters.push(parity)
          }
          if (stopBits !== undefined && stopBits !== '') {
            updates.push('stopBits = ?')
            parameters.push(stopBits)
          }
          if (dataBits !== undefined && dataBits !== '') {
            updates.push('dataBits = ?')
            parameters.push(dataBits)
          }
          if (tgUserId !== undefined && tgUserId !== '') {
            updates.push('tgUserId = ?')
            parameters.push(tgUserId)
          }
          updates.push('tgToken = ?')
          parameters.push(tgToken)

          updates.push('proxy = ?')
          parameters.push(proxy)

          if (updates.length > 0) {
            const sql = `UPDATE connection_settings SET ${updates.join(', ')} WHERE id = ?`
            parameters.push(row.id) // Добавляем ID записи в параметры
            this.db.run(sql, parameters, (err) => {
              if (err) {
                logger.error('Ошибка обновления настроек подключения:', err)
                return reject(err)
              }
              resolve()
            })
          } else {
            resolve()
          }
        } else {
          this.db.run(
            `INSERT INTO connection_settings (connect_rtu, baudRate, parity, stopBits, dataBits,tgUserId, tgToken, proxy) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [connect_rtu || null, baudRate || null, parity || null, stopBits || null, dataBits || null, tgUserId || null, tgToken || null, proxy || null],
            (err) => {
              if (err) {
                logger.error('Ошибка сохранения новых настроек подключения:', err)
                return reject(err)
              }
              console.log('Создал новую')
              resolve()
            }
          )
        }
      })
    })
  }

  getConnectionSettings() {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM connection_settings WHERE id = ?`, [1], (err, row) => {
        if (err) {
          logger.error('Ошибка при получении настроек подключения:', err)
          return reject(err)
        }
        resolve(row)
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
