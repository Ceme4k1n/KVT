const ModbusRTU = require('modbus-serial')
const express = require('express')
const winston = require('winston')
const fs = require('fs')
const path = require('path')
const TelegramBot = require('node-telegram-bot-api')
require('dotenv').config()

const Database = require('./database')
const db = new Database()

const DEMO_MODE = true // ⚠️ Установи true для демонстрации без подключения к Modbus

const app = express()
let bot, chatId

async function initializeTelegramBot() {
  const connectionSettings = await db.getConnectionSettings()
  if (!connectionSettings) {
    throw new Error('Настройки подключения не найдены в базе данных.')
  }

  if (!connectionSettings.tgToken || connectionSettings.tgToken.trim() === '') {
    console.warn('Телеграм токен недоступен или пуст. Инициализация бота отменена, но чтение датчиков будет продолжено.')
    return
  }

  process.env.HTTPS_PROXY = connectionSettings.proxy || ''
  chatId = connectionSettings.tgUserId
  bot = new TelegramBot(connectionSettings.tgToken, { polling: true })

  bot.on('polling_error', (error) => {
    logger.error(`Ошибка Telegram бота: ${error.message}`)
    if (botReconnectAttempts < maxReconnectAttempts) {
      botReconnectAttempts++
      setTimeout(() => {
        initializeTelegramBot()
          .then(() => {
            logger.info('Telegram бот успешно переподключен')
            botReconnectAttempts = 0
          })
          .catch((e) => {
            logger.error('Не удалось переподключить Telegram бота:', e)
          })
      }, 5000)
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
const sensorStatus = {}
const notificationTimes = {}
let isPortOpen = false
let isReadingActive = false
let isReconnecting = false

async function sendTelegramNotification(sensorName, temperature, humidity, threshold) {
  if (!bot) return // ⬅️ добавлено
  const message = `Пороговое значение превышено для датчика ${sensorName}:\nТемпература: ${temperature.toFixed(1)}°C MAX:${threshold.temperature_max}, MIN:${threshold.temperature_min}\nВлажность: ${humidity.toFixed(1)}% MAX:${threshold.humidity_max}, MIN:${threshold.humidity_min}`
  await bot.sendMessage(chatId, message)
}

async function sendReturningToNormalNotification(sensorName, temperature, humidity) {
  if (!bot) return // ⬅️ добавлено
  const message = `Датчик ${sensorName} вернулся в норму:\nТемпература: ${temperature.toFixed(1)}°C\nВлажность: ${humidity.toFixed(1)}%`
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

    if (!DEMO_MODE) {
      await client.connectRTU(connectionSettings.connect_rtu, {
        baudRate: connectionSettings.baudRate,
        parity: connectionSettings.parity,
        stopBits: connectionSettings.stopBits,
        dataBits: connectionSettings.dataBits,
      })
      isPortOpen = true
      console.log('Подключение к Modbus устройству успешно')
      await client.setID(1)
    } else {
      console.log('⚠️ ДЕМО-РЕЖИМ: Подключение к Modbus отключено')
    }

    setInterval(async () => {
      try {
        const sensorNames = await loadSensorNames()
        const thresholds = await db.fetchAllThreshold()

        const thresholdMap = {}
        thresholds.forEach((threshold) => {
          thresholdMap[threshold.sensor_id] = threshold
        })

        for (let i = 0; i < connectionSettings.sensors_number; i++) {
          let temperature, humidity, status, request, response

          if (DEMO_MODE) {
            temperature = +(20 + Math.random() * 10).toFixed(2)
            humidity = +(40 + Math.random() * 20).toFixed(2)
            status = Math.random() > 0.1 ? 1 : 0

            request = `EMULATED-${i + 1}`
            response = `EMULATED: T=${temperature} H=${humidity}`
          } else {
            const temperatureAddress = 30000 + i * 2
            const humidityAddress = 30001 + i * 2
            const statusAddress = 40000 + i

            const temperatureData = await client.readHoldingRegisters(temperatureAddress, 1)
            const humidityData = await client.readHoldingRegisters(humidityAddress, 1)
            const statusData = await client.readHoldingRegisters(statusAddress, 1)

            temperature = temperatureData.data[0] / 256
            humidity = humidityData.data[0] / 256
            status = (statusData.data[0] / 256) | 0

            const humidityValue = humidityData.data[0]
            const hexValue = humidityValue.toString(16).toUpperCase().padStart(4, '0')
            const highPart = hexValue.slice(0, 2)
            const lowPart = hexValue.slice(2)

            request = `01.03.${humidityAddress.toString(16).toUpperCase()}.${connectionSettings.regNumbers.toString(16).toUpperCase()}`
            response = `01.03.${(humidityData.data.length * 2).toString(16).toUpperCase()}.${highPart}.${lowPart}`
          }

          const sensorId = i + 1
          const threshold = thresholdMap[sensorId]
          let isOutOfBounds = false

          if (threshold) {
            if (temperature < threshold.temperature_min || temperature > threshold.temperature_max || humidity < threshold.humidity_min || humidity > threshold.humidity_max) {
              isOutOfBounds = true
              logger.warn(`Пороговое значение превышено для датчика ${sensorNames[sensorId]}: Температура ${temperature.toFixed(1)}°C MAX:${threshold.temperature_max} MIN:${threshold.temperature_min}, Влажность ${humidity.toFixed(1)}% MAX:${threshold.humidity_max} MIN:${threshold.humidity_min}`)

              const now = Date.now()
              if (!notificationTimes[sensorId] || now - notificationTimes[sensorId] >= 3600000) {
                await sendTelegramNotification(sensorNames[sensorId], temperature, humidity, threshold)
                notificationTimes[sensorId] = now
              }

              sensorStatus[sensorId] = 'exceeded'
            } else {
              if (sensorStatus[sensorId] === 'exceeded') {
                sensorStatus[sensorId] = 'normal'
                await sendReturningToNormalNotification(sensorNames[sensorId], temperature, humidity)
                notificationTimes[sensorId] = null
              }
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
            request: request,
            response: response,
          }

          console.log(sensorData[i])
        }

        await saveToDatabase(sensorData)
      } catch (err) {
        if (err.message.includes('Port Not Open') && !isReconnecting) {
          logger.error(`Ошибка при чтении датчиков: ${err.message}, пытаемся переподключиться...`)
          isReconnecting = true
          await reconnectModbusClient(connectionSettings)
          isReconnecting = false
        }
        logger.error(`Ошибка при чтении датчиков: ${err.message}`)
      }
    }, 10000)
  } catch (err) {
    console.error('Ошибка при подключении:', err)
  }
}

async function reconnectModbusClient(connectionSettings) {
  let retryCount = 0
  const maxRetries = 5
  while (retryCount < maxRetries) {
    try {
      await connectModbusClient(connectionSettings)
      console.log('Успешно переподключились к Modbus устройству')
      return
    } catch (err) {
      logger.error(`Ошибка переподключения к Modbus (попытка ${retryCount + 1}/${maxRetries}): ${err.message}`)
      await new Promise((resolve) => setTimeout(resolve, 3000))
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
    return startReading().then(() => {
      displayThresholds()
    })
  })
  .catch((err) => {
    console.error('Ошибка инициализации Telegram бота:', err)
    startReading().then(() => {
      displayThresholds()
    })
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
  timestampLimit.setHours(timestampLimit.getHours() - hours)

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
  const { connect_rtu, baudRate, parity, stopBits, dataBits, regNumbers, tgUserId, tgToken, proxy, useTelegram, useProxy } = req.body
  console.log(req.body)

  try {
    const proxyValue = useProxy === 'true' ? proxy : ''
    const tgTokenValue = useTelegram === 'true' ? tgToken : ''

    await db.saveConnectionSettings(connect_rtu, baudRate, parity, stopBits, dataBits, regNumbers, tgUserId, tgTokenValue, proxyValue)

    if (isReadingActive) {
      await new Promise((resolve) => {
        const checkActiveInterval = setInterval(() => {
          if (!isReadingActive) {
            clearInterval(checkActiveInterval)
            resolve()
          }
        }, 100)
      })
    }

    if (isPortOpen && !DEMO_MODE) {
      await client.close()
      isPortOpen = false
    }

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
  if (!DEMO_MODE) {
    client.close(() => {
      console.log('Соединение закрыто')
      process.exit()
    })
  } else {
    process.exit()
  }
})
