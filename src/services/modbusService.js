const { SerialPort } = require('serialport')
const config = require('../config/config')

class ModbusService {
  constructor() {
    this.port = null
    this.requestQueue = []
    this.isProcessing = false
    this.deviceAddress = config.modbus.deviceAddress
  }

  async init() {
    try {
      this.port = new SerialPort({
        path: config.modbus.port,
        baudRate: config.modbus.baudRate,
        dataBits: config.modbus.dataBits,
        parity: config.modbus.parity,
        stopBits: config.modbus.stopBits,
      })

      this.port.on('open', () => {
        console.log('Порт Modbus открыт')
        this.processQueue()
      })

      this.port.on('error', (err) => {
        console.error('Ошибка порта Modbus:', err)
      })

      this.port.on('data', (data) => {
        this.handleResponse(data)
      })
    } catch (error) {
      console.error('Ошибка инициализации Modbus:', error)
      throw error
    }
  }

  async readTemperature(sensorNumber) {
    const register = 30000 + (sensorNumber - 1)
    return this.readRegister(register)
  }

  async readHumidity(sensorNumber) {
    const register = 30001 + (sensorNumber - 1)
    return this.readRegister(register)
  }

  async readStatus(sensorNumber) {
    const register = 40000 + (sensorNumber - 1)
    return this.readRegister(register)
  }

  async readRegister(register) {
    return new Promise((resolve, reject) => {
      const request = this.createModbusRequest(3, register, 1)
      this.addToQueue(request, (response) => {
        if (response.error) {
          reject(response.error)
        } else {
          resolve(this.decodeValue(response.data))
        }
      })
    })
  }

  createModbusRequest(functionCode, startRegister, registerCount) {
    const buffer = Buffer.alloc(12)
    buffer[0] = this.deviceAddress
    buffer[1] = functionCode
    buffer[2] = (startRegister >> 8) & 0xff
    buffer[3] = startRegister & 0xff
    buffer[4] = (registerCount >> 8) & 0xff
    buffer[5] = registerCount & 0xff

    // Расчет CRC
    const crc = this.calculateCRC(buffer.slice(0, 6))
    buffer[6] = crc & 0xff
    buffer[7] = (crc >> 8) & 0xff

    return buffer
  }

  calculateCRC(data) {
    let crc = 0xffff
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i]
      for (let j = 0; j < 8; j++) {
        if (crc & 0x0001) {
          crc = (crc >> 1) ^ 0xa001
        } else {
          crc >>= 1
        }
      }
    }
    return crc
  }

  decodeValue(data) {
    const value = (data[0] << 8) | data[1]
    return value / 256
  }

  addToQueue(request, callback) {
    this.requestQueue.push({ request, callback })
    if (!this.isProcessing) {
      this.processQueue()
    }
  }

  async processQueue() {
    if (this.requestQueue.length === 0) {
      this.isProcessing = false
      return
    }

    this.isProcessing = true
    const { request, callback } = this.requestQueue[0]

    try {
      await this.write(request)
      // Ожидание ответа обрабатывается в handleResponse
    } catch (error) {
      callback({ error })
      this.requestQueue.shift()
      this.processQueue()
    }
  }

  async write(data) {
    return new Promise((resolve, reject) => {
      this.port.write(data, (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  handleResponse(data) {
    if (this.requestQueue.length === 0) return

    const { callback } = this.requestQueue[0]

    // Проверка CRC
    const receivedCRC = (data[data.length - 1] << 8) | data[data.length - 2]
    const calculatedCRC = this.calculateCRC(data.slice(0, data.length - 2))

    if (receivedCRC !== calculatedCRC) {
      callback({ error: 'Ошибка CRC' })
      this.requestQueue.shift()
      this.processQueue()
      return
    }

    // Проверка адреса устройства и кода функции
    if (data[0] !== this.deviceAddress) {
      callback({ error: 'Неверный адрес устройства' })
      this.requestQueue.shift()
      this.processQueue()
      return
    }

    // Проверка кода функции
    if (data[1] !== 3) {
      callback({ error: 'Неверный код функции' })
      this.requestQueue.shift()
      this.processQueue()
      return
    }

    // Проверка длины данных
    const dataLength = data[2]
    if (data.length !== dataLength + 5) {
      callback({ error: 'Неверная длина данных' })
      this.requestQueue.shift()
      this.processQueue()
      return
    }

    // Извлечение данных
    const responseData = data.slice(3, 3 + dataLength)
    callback({ data: responseData })

    this.requestQueue.shift()
    this.processQueue()
  }

  async close() {
    if (this.port && this.port.isOpen) {
      await this.port.close()
    }
  }
}

module.exports = new ModbusService()
