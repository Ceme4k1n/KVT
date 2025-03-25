const sqlite3 = require('sqlite3').verbose()
const config = require('../config/config')

class DatabaseService {
  constructor() {
    this.db = new sqlite3.Database(config.database.path)
    this.init()
  }

  init() {
    this.db.serialize(() => {
      // Таблица датчиков
      this.db.run(`CREATE TABLE IF NOT EXISTS sensors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                zones_count INTEGER NOT NULL,
                temp_threshold_min REAL,
                temp_threshold_max REAL,
                humidity_threshold_min REAL,
                humidity_threshold_max REAL
            )`)

      // Таблица измерений
      this.db.run(`CREATE TABLE IF NOT EXISTS measurements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sensor_id INTEGER,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                temperature REAL,
                humidity REAL,
                FOREIGN KEY (sensor_id) REFERENCES sensors(id)
            )`)

      // Таблица статусов
      this.db.run(`CREATE TABLE IF NOT EXISTS statuses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sensor_id INTEGER,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                status INTEGER,
                FOREIGN KEY (sensor_id) REFERENCES sensors(id)
            )`)

      // Таблица настроек
      this.db.run(`CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                value TEXT NOT NULL
            )`)
    })
  }

  // Методы для работы с датчиками
  async getSensors() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM sensors', [], (err, rows) => {
        if (err) reject(err)
        else resolve(rows)
      })
    })
  }

  async getSensor(id) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM sensors WHERE id = ?', [id], (err, row) => {
        if (err) reject(err)
        else resolve(row)
      })
    })
  }

  async addSensor(sensor) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO sensors (name, zones_count, temp_threshold_min, temp_threshold_max, 
                humidity_threshold_min, humidity_threshold_max) 
                VALUES (?, ?, ?, ?, ?, ?)`,
        [sensor.name, sensor.zones_count, sensor.temp_threshold_min, sensor.temp_threshold_max, sensor.humidity_threshold_min, sensor.humidity_threshold_max],
        function (err) {
          if (err) reject(err)
          else resolve(this.lastID)
        }
      )
    })
  }

  async updateSensor(id, sensor) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE sensors 
                SET name = ?, zones_count = ?, temp_threshold_min = ?, 
                temp_threshold_max = ?, humidity_threshold_min = ?, 
                humidity_threshold_max = ?
                WHERE id = ?`,
        [sensor.name, sensor.zones_count, sensor.temp_threshold_min, sensor.temp_threshold_max, sensor.humidity_threshold_min, sensor.humidity_threshold_max, id],
        (err) => {
          if (err) reject(err)
          else resolve()
        }
      )
    })
  }

  // Методы для работы с измерениями
  async addMeasurement(sensorId, temperature, humidity) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO measurements (sensor_id, temperature, humidity)
                VALUES (?, ?, ?)`,
        [sensorId, temperature, humidity],
        function (err) {
          if (err) reject(err)
          else resolve(this.lastID)
        }
      )
    })
  }

  async getMeasurements(sensorId, period) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM measurements 
                WHERE sensor_id = ? 
                AND timestamp >= datetime('now', ?)
                ORDER BY timestamp DESC`,
        [sensorId, period],
        (err, rows) => {
          if (err) reject(err)
          else resolve(rows)
        }
      )
    })
  }

  // Методы для работы со статусами
  async addStatus(sensorId, status) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO statuses (sensor_id, status)
                VALUES (?, ?)`,
        [sensorId, status],
        function (err) {
          if (err) reject(err)
          else resolve(this.lastID)
        }
      )
    })
  }

  async getLatestStatus(sensorId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM statuses 
                WHERE sensor_id = ? 
                ORDER BY timestamp DESC 
                LIMIT 1`,
        [sensorId],
        (err, row) => {
          if (err) reject(err)
          else resolve(row)
        }
      )
    })
  }

  // Методы для работы с настройками
  async getSettings() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM settings', [], (err, rows) => {
        if (err) reject(err)
        else {
          const settings = {}
          rows.forEach((row) => {
            settings[row.key] = JSON.parse(row.value)
          })
          resolve(settings)
        }
      })
    })
  }

  async updateSettings(settings) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')

      Object.entries(settings).forEach(([key, value]) => {
        stmt.run(key, JSON.stringify(value))
      })

      stmt.finalize((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  // Методы для работы с логами
  async getLogs(limit = 100) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM logs 
                ORDER BY timestamp DESC 
                LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) reject(err)
          else resolve(rows)
        }
      )
    })
  }

  async addLog(level, message) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO logs (level, message)
                VALUES (?, ?)`,
        [level, message],
        function (err) {
          if (err) reject(err)
          else resolve(this.lastID)
        }
      )
    })
  }

  close() {
    this.db.close()
  }
}

module.exports = new DatabaseService()
