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
        const sensorNames = await loadSensorNames() // Загружаем названия датчиков из базы
        const thresholds = await db.fetchAllThreshold() // Загружаем пороговые значения

        const thresholdMap = {}
        thresholds.forEach((threshold) => {
          thresholdMap[threshold.sensor_id] = threshold // создаём карту порогов по id датчика
        })

        for (let i = 0; i < 10; i++) {
          const temperatureAddress = 30000 + i * 2 // Температура
          const humidityAddress = 30001 + i * 2 // Влага
          const statusAddress = 40000 + i // Статус

          const temperatureData = await client.readHoldingRegisters(temperatureAddress, 1)
          const humidityData = await client.readHoldingRegisters(humidityAddress, 1)
          const statusData = await client.readHoldingRegisters(statusAddress, 1)

          const sensorId = i + 1
          const temperature = temperatureData.data[0] / 256
          const humidity = humidityData.data[0] / 256
          const status = (statusData.data[0] / 256) | 0

          // Проверяем пороговые значения
          const threshold = thresholdMap[sensorId]
          let isOutOfBounds = false

          if (threshold) {
            if (temperature < threshold.temperature_min || temperature > threshold.temperature_max || humidity < threshold.humidity_min || humidity > threshold.humidity_max) {
              isOutOfBounds = true // Если данные выходят за порог
              logger.warn(`Пороговое значение превышено для датчика ${sensorNames[sensorId]}: Температура ${temperature.toFixed(1)}°C, Влажность ${humidity.toFixed(1)}%`) // Логируем предупреждение
            }
          }

          sensorData[i] = {
            id: sensorId,
            name: sensorNames[sensorId] || `Датчик ${sensorId}`,
            temperature: temperature,
            humidity: humidity,
            status: status,
            timestamp: new Date().toISOString(),
            isOutOfBounds: isOutOfBounds, // Указываем, выходит ли значение за пределы
          }
        }

        await saveToDatabase(sensorData) // Сохраняем данные в базу данных
      } catch (err) {
        logger.error(`Ошибка при чтении датчиков: ${err.message}`) // Логируем ошибки
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

async function displayThresholds() {
  try {
    const thresholds = await db.fetchAllThreshold()
    console.log('Данные из таблицы thresholds:', thresholds)
  } catch (error) {
    console.error('Ошибка при выводе данных из базы данных:', error)
  }
}

startReading().then(() => {
  //displayMeasurements() // Выводим данные из базы данных
  displayThresholds()
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

app.get('/api/measurements', async (req, res) => {
  const { sensorId, hours } = req.query

  if (!sensorId || !hours) {
    return res.status(400).json({ error: 'Отсутствуют идентификатор датчика или часы.' })
  }

  const timestampLimit = new Date()
  timestampLimit.setHours(timestampLimit.getHours() - hours) // Устанавливаем временной предел

  try {
    const measurements = await db.fetchMeasurementsBySensorAndTime(sensorId, timestampLimit)
    res.json(measurements)
  } catch (error) {
    logger.error('Ошибка при получении измерений:', error)
    res.status(500).json({ error: 'Ошибка при получении измерений.' })
  }
})

app.put('/api/sensors', async (req, res) => {
  const { id, name, temperatureMin, temperatureMax, humidityMin, humidityMax } = req.body

  try {
    if (id && name) {
      await db.saveSensorName(id, name)
      console.log('Изменил только имя')
    }
    if (temperatureMin && temperatureMax && humidityMin && humidityMax) {
      await db.saveThreshold(id, temperatureMin, temperatureMax, humidityMin, humidityMax)
      console.log('Изменил только датчики')
    }

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
