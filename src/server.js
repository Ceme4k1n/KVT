const ModbusRTU = require('modbus-serial')
const express = require('express')
const winston = require('winston')
const fs = require('fs')
const path = require('path')

const Database = require('./database')
const db = new Database()

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

async function loadSensorNames() {
  const sensors = await db.fetchAllSensors() // Получаем все названия датчиков из базы
  const sensorMap = {}

  sensors.forEach((sensor) => {
    sensorMap[sensor.id] = sensor.name // Создаем отображение id - name
  })

  return sensorMap // Возвращаем объект с названиями датчиков
}

app.use(express.json())
app.use(express.static('public'))

const client = new ModbusRTU()
const sensorData = []

async function saveToDatabase(data) {
  try {
    for (const sensor of data) {
      await db.saveMeasurement(sensor.id, sensor.name, sensor.temperature, sensor.humidity, sensor.status)
    }
  } catch (error) {
    logger.error('Ошибка при сохранении в базу данных:', error)
  }
}

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
      try {
        const sensorNames = await loadSensorNames()

        for (let i = 0; i < 10; i++) {
          const temperatureAddress = 30000 + i * 2 // Температура
          const humidityAddress = 30001 + i * 2 // Влага
          const statusAddress = 40000 + i // Статус

          const temperatureData = await client.readHoldingRegisters(temperatureAddress, 1)
          const humidityData = await client.readHoldingRegisters(humidityAddress, 1)
          const statusData = await client.readHoldingRegisters(statusAddress, 1)

          sensorData[i] = {
            id: i + 1,
            name: sensorNames[i + 1] || `Датчик ${i + 1}`, // Используем имя из базы или создаем новое
            temperature: temperatureData.data[0] / 256,
            humidity: humidityData.data[0] / 256,
            status: (statusData.data[0] / 256) | 0,
            timestamp: new Date().toISOString(),
          }
        }
        console.log(sensorNames)

        logger.info('Данные с датчиков', sensorData)
        await saveToDatabase(sensorData) // Сохраняем данные в базу данных
      } catch (err) {
        console.error(`Ошибка при чтении датчиков: ${err.message}`)
      }
    }, 5000)
  } catch (err) {
    console.error('Ошибка при подключении:', err)
  }
}

async function displayMeasurements() {
  try {
    const measurements = await db.fetchMeasurements()
    console.log('Данные из таблицы measurements:', measurements)
  } catch (error) {
    console.error('Ошибка при выводе данных из базы данных:', error)
  }
}

startReading().then(() => {
  displayMeasurements() // Выводим данные из базы данных
})
app.get('/api/sensors', async (req, res) => {
  try {
    res.json(sensorData)
  } catch (error) {
    logger.error('Ошибка при получении данных с датчиков:', error)
    res.status(500).json({ error: 'Ошибка при получении данных' })
  }
})

app.get('/api/logs', (req, res) => {
  try {
    const logFile = path.join(__dirname, '../logs/modbus.log')
    const logs = fs
      .readFileSync(logFile, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch (e) {
          return line
        }
      })
    res.json(logs)
  } catch (error) {
    res.status(500).json({ error: 'Ошибка при чтении логов' })
  }
})

app.put('/api/sensors', async (req, res) => {
  const { id, name, temperatureMin, temperatureMax, humidityMin, humidityMax } = req.body

  try {
    await db.saveSensorName(id, name)

    await db.saveThreshold(id, temperatureMin, temperatureMax, humidityMin, humidityMax)

    res.json({ message: 'Информация о датчике обновлена' })
  } catch (error) {
    logger.error('Ошибка при обновлении датчика:', error)
    res.status(500).json({ error: 'Ошибка при обновлении датчика' })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`)
})

process.on('SIGINT', () => {
  client.close(() => {
    console.log('Соединение закрыто')
    process.exit()
  })
})
