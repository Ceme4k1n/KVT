const ModbusRTU = require('modbus-serial')
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
    this.client = new ModbusRTU()
    this.sensorCount = sensorCount
    this.sensorData = []
    this.isConnected = false
    logger.info(`Инициализация Modbus клиента с ${sensorCount} датчиками`)
  }

  async connect() {
    try {
      await this.client.connectRTU('COM4', {
        baudRate: 115200,
        parity: 'none',
        stopBits: 1,
        dataBits: 8,
      })
      await this.client.setID(1)
      this.isConnected = true
      logger.info('Подключение к Modbus устройству успешно')
      return true
    } catch (err) {
      logger.error('Ошибка при подключении:', err)
      return false
    }
  }

  async readSensorData(sensorNumber) {
    try {
      const m = sensorNumber - 1
      const temperatureAddress = 30000 + m
      const humidityAddress = 30001 + m
      const statusAddress = 40000 + m

      const [temperatureData, humidityData, statusData] = await Promise.all([this.client.readHoldingRegisters(temperatureAddress, 1), this.client.readHoldingRegisters(humidityAddress, 1), this.client.readHoldingRegisters(statusAddress, 1)])

      const temperature = temperatureData.data[0] / 256
      const humidity = humidityData.data[0] / 256
      const status = statusData.data[0]

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
      this.client.close()
      this.isConnected = false
      logger.info('Соединение с Modbus устройством закрыто')
    }
  }
}

module.exports = ModbusClient
