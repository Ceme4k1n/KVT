const ModbusRTU = require('modbus-serial')
const express = require('express')
const winston = require('winston')

const app = express()

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
// Middleware для парсинга JSON
app.use(express.json())

// Статические файлы
app.use(express.static('public'))
// Создание экземпляра клиента Modbus
const client = new ModbusRTU()

// Массив для хранения данных с датчиков
const sensorData = []

// Функция для подключения и чтения данных
async function startReading() {
  try {
    await client.connectRTU('COM4', {
      baudRate: 115200,
      parity: 'none',
      stopBits: 1,
      dataBits: 8,
    })
    console.log('Подключение к Modbus устройству успешно')

    await client.setID(1)

    setInterval(async () => {
      // Инициализируем массив с начальными значениями
      for (let i = 0; i < 10; i++) {
        if (!sensorData[i]) {
          sensorData[i] = {
            id: i + 1,
            temperature: null,
            humidity: null,
            status: null,
            timestamp: new Date().toISOString(),
          }
        }
      }

      for (let i = 0; i < 10; i++) {
        const temperatureAddress = 30000 + i * 2 // Температура
        const humidityAddress = 30001 + i * 2 // Влага
        const statusAddress = 40000 + i // Статус

        try {
          const temperatureData = await client.readHoldingRegisters(temperatureAddress, 1)
          const humidityData = await client.readHoldingRegisters(humidityAddress, 1)
          const statusData = await client.readHoldingRegisters(statusAddress, 1)

          // Обновляем данные в массиве
          sensorData[i].temperature = temperatureData.data[0] / 256
          sensorData[i].humidity = humidityData.data[0] / 256
          sensorData[i].status = (statusData.data[0] / 256) | 0

          //logger.info(`Датчик ${i + 1}: Температура=${sensorData[i].temperature}°C, Влажность=${sensorData[i].humidity}%`)
        } catch (err) {
          console.error(`Ошибка при чтении датчика ${i + 1}: ${err.message}`)
        }
      }

      logger.info('Данные с датчиков', sensorData)
    }, 5000)
  } catch (err) {
    console.error('Ошибка при подключении:', err)
  }
}

// Запуск функции
startReading()

// API эндпоинт для получения данных
app.get('/api/sensors', async (req, res) => {
  try {
    // Возвращаем данные с датчиков
    res.json(sensorData)
  } catch (error) {
    logger.error('Ошибка при получении данных с датчиков:', error)
    res.status(500).json({ error: 'Ошибка при получении данных' })
  }
})

// Запуск сервера
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`)
})

// Обработка завершения процесса
process.on('SIGINT', () => {
  client.close(() => {
    console.log('Соединение закрыто')
    process.exit()
  })
})
