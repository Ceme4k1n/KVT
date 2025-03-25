const nodemailer = require('nodemailer')
const TelegramBot = require('node-telegram-bot-api')
const config = require('../config/config')
const databaseService = require('./databaseService')

class NotificationService {
  constructor() {
    this.emailTransporter = null
    this.telegramBot = null
    this.init()
  }

  init() {
    // Инициализация email транспорта
    if (config.notifications.email.enabled) {
      this.emailTransporter = nodemailer.createTransport({
        host: config.notifications.email.host,
        port: config.notifications.email.port,
        secure: config.notifications.email.secure,
        auth: config.notifications.email.auth,
      })
    }

    // Инициализация Telegram бота
    if (config.notifications.telegram.enabled) {
      this.telegramBot = new TelegramBot(config.notifications.telegram.botToken, { polling: false })
    }
  }

  async sendEmail(subject, text, html) {
    if (!this.emailTransporter) return

    try {
      await this.emailTransporter.sendMail({
        from: config.notifications.email.auth.user,
        to: config.notifications.email.recipients.join(', '),
        subject: subject,
        text: text,
        html: html,
      })
    } catch (error) {
      console.error('Ошибка отправки email:', error)
      await databaseService.addLog('error', `Ошибка отправки email: ${error.message}`)
    }
  }

  async sendTelegramMessage(message) {
    if (!this.telegramBot) return

    try {
      await this.telegramBot.sendMessage(config.notifications.telegram.chatId, message)
    } catch (error) {
      console.error('Ошибка отправки сообщения в Telegram:', error)
      await databaseService.addLog('error', `Ошибка отправки сообщения в Telegram: ${error.message}`)
    }
  }

  async sendTemperatureAlert(sensor, temperature) {
    const thresholds = await databaseService.getSensor(sensor.id)
    const message = `Внимание! Температура датчика "${sensor.name}" (${sensor.id}) ` + `выходит за пределы допустимого диапазона: ${temperature}°C\n` + `Допустимый диапазон: ${thresholds.temp_threshold_min}°C - ${thresholds.temp_threshold_max}°C`

    await this.sendEmail('Предупреждение о температуре', message, `<h2>Предупреждение о температуре</h2><p>${message}</p>`)

    await this.sendTelegramMessage(message)
  }

  async sendHumidityAlert(sensor, humidity) {
    const thresholds = await databaseService.getSensor(sensor.id)
    const message = `Внимание! Влажность датчика "${sensor.name}" (${sensor.id}) ` + `выходит за пределы допустимого диапазона: ${humidity}%\n` + `Допустимый диапазон: ${thresholds.humidity_threshold_min}% - ${thresholds.humidity_threshold_max}%`

    await this.sendEmail('Предупреждение о влажности', message, `<h2>Предупреждение о влажности</h2><p>${message}</p>`)

    await this.sendTelegramMessage(message)
  }

  async sendStatusAlert(sensor, status) {
    const statusText = this.getStatusText(status)
    const message = `Изменение статуса датчика "${sensor.name}" (${sensor.id}): ${statusText}`

    await this.sendEmail('Изменение статуса датчика', message, `<h2>Изменение статуса датчика</h2><p>${message}</p>`)

    await this.sendTelegramMessage(message)
  }

  getStatusText(status) {
    switch (status) {
      case 0:
        return 'Норма'
      case 1:
        return 'Предупреждение'
      case 2:
        return 'Ошибка'
      default:
        return 'Неизвестно'
    }
  }

  async sendDailyReport() {
    const sensors = await databaseService.getSensors()
    let report = '<h2>Ежедневный отчет</h2><table border="1">'
    report += '<tr><th>Датчик</th><th>Температура</th><th>Влажность</th><th>Статус</th></tr>'

    for (const sensor of sensors) {
      const latestMeasurement = await databaseService.getMeasurements(sensor.id, '-1d')
      const latestStatus = await databaseService.getLatestStatus(sensor.id)

      if (latestMeasurement.length > 0) {
        const measurement = latestMeasurement[0]
        report += `<tr>
                    <td>${sensor.name}</td>
                    <td>${measurement.temperature}°C</td>
                    <td>${measurement.humidity}%</td>
                    <td>${this.getStatusText(latestStatus?.status || 0)}</td>
                </tr>`
      }
    }

    report += '</table>'

    await this.sendEmail('Ежедневный отчет', 'См. вложение HTML', report)

    await this.sendTelegramMessage('Ежедневный отчет отправлен на email')
  }
}

module.exports = new NotificationService()
