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
const sensorStatus = {} // Объект для отслеживания состояния датчиков
const notificationTimes = {} // Объект для хранения времени последнего уведомления о превышении
let isPortOpen = false // Добавлено: флаг для отслеживания состояния порта
let isReadingActive = false // Флаг для отслеживания активности чтения данных

async function sendTelegramNotification(sensorName, temperature, humidity, threshold) {
  const message = `Пороговое значение превышено для датчика ${sensorName}:\nТемпература: ${temperature.toFixed(1)}°C MAX:${threshold.temperature_max}, MIN:${threshold.temperature_min}\nВлажность: ${humidity.toFixed(1)}% MAX:${threshold.humidity_max}, MIN:${threshold.humidity_min}`
  await bot.sendMessage(chatId, message)
}

async function sendReturningToNormalNotification(sensorName, temperature, humidity) {
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
  isReadingActive = true // Устанавливаем флаг о том, что чтение активно
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
    console.log('Подключение к Modbus устройству успешно')

    await client.setID(1)

    return new Promise((resolve) => {
      const intervalId = setInterval(async () => {
        try {
          const sensorNames = await loadSensorNames()
          const thresholds = await db.fetchAllThreshold()

          const thresholdMap = {}
          thresholds.forEach((threshold) => {
            thresholdMap[threshold.sensor_id] = threshold // создаём карту порогов по id датчика
          })

          for (let i = 0; i < connectionSettings.sensors_number; i++) {
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
            }

            console.log(sensorData[i])
          }

          await saveToDatabase(sensorData)
        } catch (err) {
          logger.error(`Ошибка при чтении датчиков: ${err.message}`)
          isReadingActive = false
          clearInterval(intervalId)
          resolve()
        }
      }, 10000)

      setTimeout(() => {
        clearInterval(intervalId)
        isReadingActive = false
        console.log('Чтение данных завершено по таймауту')
        resolve()
      }, 60000)
    })
  } catch (err) {
    console.error('Ошибка при подключении:', err)
    isReadingActive = false
  }
}

async function reconnectModbusClient(connectionSettings) {
  let retryCount = 0
  const maxRetries = 5 // Максимальное количество попыток
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

// Вызываем функцию
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
  const { connect_rtu, baudRate, parity, stopBits, dataBits, tgUserId, tgToken, proxy, useTelegram, useProxy } = req.body
  console.log(req.body)

  try {
    const proxyValue = useProxy === 'true' ? proxy : ''
    const tgTokenValue = useTelegram === 'true' ? tgToken : ''

    // Сохраняем настройки в БД
    await db.saveConnectionSettings(connect_rtu, baudRate, parity, stopBits, dataBits, tgUserId, tgTokenValue, proxyValue)

    if (isReadingActive) {
      await new Promise((resolve) => {
        const checkActiveInterval = setInterval(() => {
          if (!isReadingActive) {
            clearInterval(checkActiveInterval)
            resolve() // Завершаем, когда чтение завершено
          }
        }, 100)
      })
    }

    // Закрываем текущее соединение
    if (isPortOpen) {
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
  client.close(() => {
    console.log('Соединение закрыто')
    process.exit()
  })
})
