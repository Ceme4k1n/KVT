const winston = require('winston')

// Настройка логгера
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'logs/modbus.log' }),
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
  ],
})

class ModbusClient {
  constructor(sensorCount = 10) {
    this.sensorCount = sensorCount
    this.sensorData = []
    this.isConnected = false
    logger.info(`Инициализация эмулятора Modbus с ${sensorCount} датчиками`)
  }

  async connect() {
    try {
      // Имитация задержки подключения
      await new Promise((resolve) => setTimeout(resolve, 1000))
      this.isConnected = true
      logger.info('Подключение к эмулированному Modbus устройству успешно')
      return true
    } catch (err) {
      logger.error('Ошибка при подключении:', err)
      return false
    }
  }

  // Генерация случайного числа в заданном диапазоне
  randomInRange(min, max) {
    return Math.random() * (max - min) + min
  }

  // Генерация случайного статуса (0 - норма, 1 - предупреждение, 2 - ошибка)
  randomStatus() {
    const rand = Math.random()
    if (rand < 0.8) return 0 // 80% шанс нормального статуса
    if (rand < 0.95) return 1 // 15% шанс предупреждения
    return 2 // 5% шанс ошибки
  }

  async readSensorData(sensorNumber) {
    try {
      // Имитация задержки чтения
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Генерация случайных данных
      const temperature = this.randomInRange(15, 30) // Температура от 15 до 30°C
      const humidity = this.randomInRange(30, 70) // Влажность от 30 до 70%
      const status = this.randomStatus()

      const data = {
        id: sensorNumber,
        temperature: temperature,
        humidity: humidity,
        status: status,
        timestamp: new Date().toISOString(),
      }

      // Логирование данных датчика
      const statusText = status === 0 ? 'Норма' : status === 1 ? 'Предупреждение' : 'Ошибка'
      logger.info(`Датчик ${sensorNumber}: Температура=${temperature.toFixed(1)}°C, Влажность=${humidity.toFixed(1)}%, Статус=${statusText}`)

      return data
    } catch (err) {
      logger.error(`Ошибка при чтении датчика ${sensorNumber}:`, err)
      return null
    }
  }

  async readAllSensors() {
    if (!this.isConnected) {
      logger.error('Modbus клиент не подключен')
      return []
    }

    this.sensorData = []
    const promises = []

    for (let i = 1; i <= this.sensorCount; i++) {
      promises.push(this.readSensorData(i))
    }

    const results = await Promise.all(promises)
    this.sensorData = results.filter((data) => data !== null)

    // Логирование общего состояния
    const normalCount = this.sensorData.filter((s) => s.status === 0).length
    const warningCount = this.sensorData.filter((s) => s.status === 1).length
    const errorCount = this.sensorData.filter((s) => s.status === 2).length

    logger.info(`Общее состояние: Норма=${normalCount}, Предупреждения=${warningCount}, Ошибки=${errorCount}`)

    return this.sensorData
  }

  disconnect() {
    if (this.isConnected) {
      this.isConnected = false
      logger.info('Соединение с эмулированным Modbus устройством закрыто')
    }
  }
}

module.exports = ModbusClient
