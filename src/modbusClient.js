const ModbusRTU = require('modbus-serial')
const winston = require('winston')

// Настройка логгера
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.File({ filename: 'logs/modbus.log' })],
})

class ModbusClient {
  constructor(sensorCount = 10) {
    this.client = new ModbusRTU()
    this.sensorCount = sensorCount
    this.sensorData = []
    this.isConnected = false
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

      return {
        id: sensorNumber,
        temperature: temperatureData.data[0] / 256,
        humidity: humidityData.data[0] / 256,
        status: statusData.data[0],
        timestamp: new Date().toISOString(),
      }
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
