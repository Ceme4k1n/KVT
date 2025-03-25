const modbusService = require('./modbusService')
const databaseService = require('./databaseService')
const notificationService = require('./notificationService')
const config = require('../config/config')

class SensorService {
  constructor() {
    this.sensors = []
    this.updateInterval = null
    this.init()
  }

  async init() {
    try {
      await modbusService.init()
      this.sensors = await databaseService.getSensors()
      this.startMonitoring()
    } catch (error) {
      console.error('Ошибка инициализации сервиса датчиков:', error)
      await databaseService.addLog('error', `Ошибка инициализации сервиса датчиков: ${error.message}`)
    }
  }

  startMonitoring() {
    // Обновление данных каждые 5 секунд
    this.updateInterval = setInterval(async () => {
      await this.updateSensorsData()
    }, 5000)
  }

  async updateSensorsData() {
    for (const sensor of this.sensors) {
      try {
        // Чтение температуры
        const temperature = await modbusService.readTemperature(sensor.id)
        await this.processTemperature(sensor, temperature)

        // Чтение влажности
        const humidity = await modbusService.readHumidity(sensor.id)
        await this.processHumidity(sensor, humidity)

        // Чтение статуса
        const status = await modbusService.readStatus(sensor.id)
        await this.processStatus(sensor, status)

        // Сохранение измерений
        await databaseService.addMeasurement(sensor.id, temperature, humidity)
      } catch (error) {
        console.error(`Ошибка обновления данных датчика ${sensor.id}:`, error)
        await databaseService.addLog('error', `Ошибка обновления данных датчика ${sensor.id}: ${error.message}`)
      }
    }
  }

  async processTemperature(sensor, temperature) {
    const thresholds = await databaseService.getSensor(sensor.id)

    if (temperature < thresholds.temp_threshold_min || temperature > thresholds.temp_threshold_max) {
      await notificationService.sendTemperatureAlert(sensor, temperature)
    }
  }

  async processHumidity(sensor, humidity) {
    const thresholds = await databaseService.getSensor(sensor.id)

    if (humidity < thresholds.humidity_threshold_min || humidity > thresholds.humidity_threshold_max) {
      await notificationService.sendHumidityAlert(sensor, humidity)
    }
  }

  async processStatus(sensor, status) {
    const latestStatus = await databaseService.getLatestStatus(sensor.id)

    if (!latestStatus || latestStatus.status !== status) {
      await databaseService.addStatus(sensor.id, status)
      await notificationService.sendStatusAlert(sensor, status)
    }
  }

  async addSensor(sensor) {
    try {
      const id = await databaseService.addSensor(sensor)
      this.sensors.push({ ...sensor, id })
      return id
    } catch (error) {
      console.error('Ошибка добавления датчика:', error)
      await databaseService.addLog('error', `Ошибка добавления датчика: ${error.message}`)
      throw error
    }
  }

  async updateSensor(id, sensor) {
    try {
      await databaseService.updateSensor(id, sensor)
      const index = this.sensors.findIndex((s) => s.id === id)
      if (index !== -1) {
        this.sensors[index] = { ...sensor, id }
      }
    } catch (error) {
      console.error('Ошибка обновления датчика:', error)
      await databaseService.addLog('error', `Ошибка обновления датчика: ${error.message}`)
      throw error
    }
  }

  async getSensor(id) {
    return this.sensors.find((s) => s.id === id)
  }

  async getAllSensors() {
    return this.sensors
  }

  async getMeasurements(sensorId, period) {
    return databaseService.getMeasurements(sensorId, period)
  }

  async getLatestStatus(sensorId) {
    return databaseService.getLatestStatus(sensorId)
  }

  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval)
      this.updateInterval = null
    }
    modbusService.close()
  }
}

module.exports = new SensorService()
