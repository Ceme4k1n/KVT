const express = require('express')
const ModbusClient = require('./modbusClient')
const Database = require('./database')
const winston = require('winston')

// Настройка логгера
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.File({ filename: 'logs/server.log' }), new winston.transports.Console()],
})

const app = express()
const port = process.env.PORT || 3000

// Инициализация компонентов
const modbusClient = new ModbusClient(10) // По умолчанию КВТ-10
const database = new Database()

// Middleware для парсинга JSON
app.use(express.json())

// Статические файлы
app.use(express.static('public'))

// API endpoints
app.get('/api/sensors', async (req, res) => {
  try {
    const data = await modbusClient.readAllSensors()
    res.json(data)
  } catch (error) {
    logger.error('Ошибка при получении данных с датчиков:', error)
    res.status(500).json({ error: 'Ошибка при получении данных' })
  }
})

app.get('/api/measurements', async (req, res) => {
  try {
    const measurements = await database.getLatestMeasurements()
    res.json(measurements)
  } catch (error) {
    logger.error('Ошибка при получении измерений:', error)
    res.status(500).json({ error: 'Ошибка при получении измерений' })
  }
})

// Запуск сервера
app.listen(port, async () => {
  logger.info(`Сервер запущен на порту ${port}`)

  // Подключение к Modbus
  const connected = await modbusClient.connect()
  if (!connected) {
    logger.error('Не удалось подключиться к Modbus устройству')
    process.exit(1)
  }

  // Запуск периодического опроса датчиков
  setInterval(async () => {
    try {
      const sensorData = await modbusClient.readAllSensors()

      // Сохранение данных в базу
      for (const sensor of sensorData) {
        await database.saveMeasurement(sensor.id, sensor.temperature, sensor.humidity)
        await database.saveStatus(sensor.id, sensor.status)
      }

      logger.info('Данные успешно получены и сохранены')
    } catch (error) {
      logger.error('Ошибка при опросе датчиков:', error)
    }
  }, 1500) // Опрос каждые 1.5 секунды
})

// Обработка завершения работы
process.on('SIGINT', () => {
  logger.info('Завершение работы сервера')
  modbusClient.disconnect()
  database.close()
  process.exit()
})
