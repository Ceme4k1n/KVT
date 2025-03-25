module.exports = {
  // Настройки Modbus
  modbus: {
    port: process.platform === 'win32' ? 'COM1' : '/dev/ttymcx0',
    baudRate: 115200,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    timeout: 1000,
    deviceAddress: 1,
  },

  // Настройки базы данных
  database: {
    path: 'kvt.db',
  },

  // Настройки уведомлений
  notifications: {
    email: {
      enabled: false,
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: {
        user: 'user@example.com',
        pass: 'password',
      },
      recipients: ['admin@example.com'],
    },
    telegram: {
      enabled: false,
      botToken: 'YOUR_BOT_TOKEN',
      chatId: 'YOUR_CHAT_ID',
    },
  },

  // Пороговые значения по умолчанию
  thresholds: {
    temperature: {
      min: 15,
      max: 25,
    },
    humidity: {
      min: 30,
      max: 60,
    },
  },

  // Настройки логирования
  logging: {
    level: 'info',
    file: {
      error: 'logs/error.log',
      combined: 'logs/combined.log',
    },
  },

  // Настройки веб-интерфейса
  web: {
    port: 3000,
    updateInterval: 5000, // Интервал обновления данных в мс
  },
}
