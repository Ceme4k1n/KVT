const ModbusRTU = require('modbus-serial')
const express = require('express')
const winston = require('winston')
const fs = require('fs')
const path = require('path')
const TelegramBot = require('node-telegram-bot-api')
require('dotenv').config()

const Database = require('./database')
const db = new Database()

const app = express()
const chatId = 1029163005
let bot

async function initializeTelegramBot() {
  const connectionSettings = await db.getConnectionSettings()
  if (!connectionSettings) {
    throw new Error('Настройки подключения не найдены в базе данных.')
  }

  // Устанавливаем прокси, если он есть
  process.env.HTTPS_PROXY = connectionSettings.proxy || ''

  // Инициализируем Telegram-бота
  bot = new TelegramBot(connectionSettings.tgToken, { polling: true })
  bot.on('polling_error', (error) => {
    logger.error(`Ошибка Telegram бота: ${error.message}`)

    // Если ошибка связана с подключением, пытаемся пересоздать соединение
    if (botReconnectAttempts < maxReconnectAttempts) {
      botReconnectAttempts++
      setTimeout(() => {
        initializeTelegramBot()
          .then(() => {
            logger.info('Telegram бот успешно переподключен')
            botReconnectAttempts = 0 // сбрасываем счетчик попыток
          })
          .catch((e) => {
            logger.error('Не удалось переподключить Telegram бота:', e)
          })
      }, 5000) // Попробуем через 5 секунд
    }
  })
}

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
  const sensors = await db.fetchAllSensors()
  const sensorMap = {}

  sensors.forEach((sensor) => {
    sensorMap[sensor.id] = sensor.name
  })

  return sensorMap
}

app.use(express.json())
app.use(express.static('public'))

const client = new ModbusRTU()
const sensorData = []

async function sendTelegramNotification(sensorName, temperature, humidity) {
  const message = `Пороговое значение превышено для датчика ${sensorName}:\nТемпература: ${temperature.toFixed(1)}°C\nВлажность: ${humidity.toFixed(1)}%`
  await bot.sendMessage(chatId, message)
}

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
    const connectionSettings = await db.getConnectionSettings()
    if (!connectionSettings) {
      throw new Error('Настройки подключения не найдены в базе данных.')
    }
    console.log(connectionSettings)

    await client.connectRTU(connectionSettings.connect_rtu, {
      baudRate: connectionSettings.baudRate,
      parity: connectionSettings.parity,
      stopBits: connectionSettings.stopBits,
      dataBits: connectionSettings.dataBits,
    })
    isPortOpen = true

    // await client.connectRTU('COM4', {
    //   baudRate: 115200,
    //   parity: 'none',
    //   stopBits: 1,
    //   dataBits: 8,
    // })
    //Добавить адрес прибора
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

              await sendTelegramNotification(sensorNames[sensorId], temperature, humidity)
            }
          }

          sensorData[i] = {
            id: sensorId,
            name: sensorNames[sensorId] || `Датчик ${sensorId}`,
            temperature: temperature,
            humidity: humidity,
            status: status,
            timestamp: new Date().toISOString(),
            isOutOfBounds: isOutOfBounds,
            temperatureMax: threshold ? threshold.temperature_max : null,
            temperatureMin: threshold ? threshold.temperature_min : null,
            humidityMax: threshold ? threshold.humidity_max : null,
            humidityMin: threshold ? threshold.humidity_min : null,
          }
        }

        await saveToDatabase(sensorData)
      } catch (err) {
        if (err.message.includes('Port Not Open')) {
          logger.error(`Ошибка при чтении датчиков: ${err.message}, пытаемся переподключиться...`)
          await reconnectModbusClient(connectionSettings)
          // После переподключения продолжим попытки чтения
        }
        logger.error(`Ошибка при чтении датчиков: ${err.message}`)
      }
    }, 5000)
  } catch (err) {
    console.error('Ошибка при подключении:', err)
  }
}

// Функция для повторного подключения к Modbus
async function reconnectModbusClient(connectionSettings) {
  let retryCount = 0
  const maxRetries = 5 // Максимальное количество попыток переподключения
  while (retryCount < maxRetries) {
    try {
      await connectModbusClient(connectionSettings)
      console.log('Успешно переподключились к Modbus устройству')
      return // Выход из цикла, если переподключение прошло успешно
    } catch (err) {
      logger.error(`Ошибка переподключения к Modbus (попытка ${retryCount + 1}/${maxRetries}): ${err.message}`)
      await new Promise((resolve) => setTimeout(resolve, 3000)) // Ждем 3 секунды перед следующей попыткой
      retryCount++
    }
  }
  logger.error('Не удалось переподключиться к Modbus устройству после нескольких попыток.')
}

async function connectModbusClient(connectionSettings) {
  await client.connectRTU(connectionSettings.connect_rtu, {
    baudRate: connectionSettings.baudRate,
    parity: connectionSettings.parity,
    stopBits: connectionSettings.stopBits,
    dataBits: connectionSettings.dataBits,
  })
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

initializeTelegramBot()
  .then(() => {
    startReading().then(() => {
      displayThresholds()
    })
  })
  .catch((err) => {
    console.error('Ошибка инициализации Telegram бота:', err)
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

app.put('/api/settings', async (req, res) => {
  const { connect_rtu, baudRate, parity, stopBits, dataBits, tgToken, proxy } = req.body
  console.log(req.body)

  // Сохраняем настройки в базе данных
  try {
    await db.saveConnectionSettings(connect_rtu, baudRate, parity, stopBits, dataBits, tgToken, proxy)

    // Закрываем текущее соединение
    if (isPortOpen) {
      await client.close() // Закрываем только если порт открыт
      isPortOpen = false
    }

    // Перезапускаем чтение данных с новыми настройками
    await startReading()

    res.json({ message: 'Настройки успешно обновлены и соединение перезапущено.' })
  } catch (error) {
    console.error('Ошибка при обновлении настроек:', error)
    res.status(500).json({ error: 'Ошибка при обновлении настроек' })
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
