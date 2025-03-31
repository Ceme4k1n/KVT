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

app.use(express.json())
app.use(express.static('public'))

const client = new ModbusRTU()

const sensorData = []

async function saveToDatabase(data) {
  try {
    for (const sensor of data) {
      await db.saveMeasurement(sensor.id, sensor.temperature, sensor.humidity)
      await db.saveStatus(sensor.id, sensor.status)
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

          sensorData[i].temperature = temperatureData.data[0] / 256
          sensorData[i].humidity = humidityData.data[0] / 256
          sensorData[i].status = (statusData.data[0] / 256) | 0
          sensorData[i].timestamp = new Date().toISOString()
        } catch (err) {
          console.error(`Ошибка при чтении датчика ${i + 1}: ${err.message}`)
        }
      }

      logger.info('Данные с датчиков', sensorData)
      await saveToDatabase(sensorData)
    }, 5000)
  } catch (err) {
    console.error('Ошибка при подключении:', err)
  }
}

startReading()

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

//Данные с датчиков {"0":{"humidity":34,"id":1,"status":165,"temperature":24,"timestamp":"2025-03-27T11:11:39.600Z"},"1":{"humidity":34,"id":2,"status":165,"temperature":24,"timestamp":"2025-03-27T11:11:40.048Z"},"2":{"humidity":36.0625,"id":3,"status":165,"temperature":24.8125,"timestamp":"2025-03-27T11:11:40.107Z"},"3":{"humidity":35,"id":4,"status":165,"temperature":24,"timestamp":"2025-03-27T11:11:40.699Z"},"4":{"humidity":35,"id":5,"status":76,"temperature":24,"timestamp":"2025-03-27T11:11:41.189Z"},"5":{"humidity":35,"id":6,"status":71,"temperature":24,"timestamp":"2025-03-27T11:11:41.637Z"},"6":{"humidity":35,"id":7,"status":165,"temperature":24,"timestamp":"2025-03-27T11:11:42.247Z"},"7":{"humidity":35,"id":8,"status":165,"temperature":24,"timestamp":"2025-03-27T11:11:42.779Z"},"8":{"humidity":35,"id":9,"status":165,"temperature":24,"timestamp":"2025-03-27T11:11:43.309Z"},"9":{"humidity":34,"id":10,"status":165,"temperature":24,"timestamp":"2025-03-27T11:11:43.960Z"},"timestamp":"2025-03-27T11:11:43.962Z"}
