const { createApp } = Vue

const app = createApp({
  data() {
    return {
      currentView: 'dashboard',
      sensors: [],
      settings: {
        temperature: {
          min: 15,
          max: 25,
        },
        humidity: {
          min: 30,
          max: 60,
        },
      },
      logs: [],
      charts: {},
      updateInterval: null,
    }
  },
  methods: {
    showDashboard() {
      this.currentView = 'dashboard'
      this.updateSensorsData()
    },
    showSettings() {
      this.currentView = 'settings'
      this.loadSettings()
    },
    showLogs() {
      this.currentView = 'logs'
      this.loadLogs()
    },
    openControllerSettings() {
      window.open('/bolid_web_cfg', '_blank')
    },
    async updateSensorsData() {
      try {
        const response = await fetch('/api/sensors')
        this.sensors = await response.json()
        this.updateCharts()
      } catch (error) {
        console.error('Ошибка получения данных датчиков:', error)
      }
    },
    async loadSettings() {
      try {
        const response = await fetch('/api/settings')
        this.settings = await response.json()
      } catch (error) {
        console.error('Ошибка загрузки настроек:', error)
      }
    },
    async saveSettings() {
      try {
        await fetch('/api/settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(this.settings),
        })
        alert('Настройки сохранены')
      } catch (error) {
        console.error('Ошибка сохранения настроек:', error)
        alert('Ошибка сохранения настроек')
      }
    },
    async loadLogs() {
      try {
        const response = await fetch('/api/logs')
        this.logs = await response.json()
      } catch (error) {
        console.error('Ошибка загрузки логов:', error)
      }
    },
    updateCharts() {
      this.sensors.forEach((sensor) => {
        const chartId = `chart-${sensor.id}`
        if (!this.charts[chartId]) {
          this.initChart(chartId)
        }
        this.updateChartData(chartId, sensor)
      })
    },
    initChart(chartId) {
      const ctx = document.getElementById(chartId).getContext('2d')
      this.charts[chartId] = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Температура',
              data: [],
              borderColor: '#e74c3c',
              tension: 0.1,
            },
            {
              label: 'Влажность',
              data: [],
              borderColor: '#3498db',
              tension: 0.1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: false,
            },
          },
        },
      })
    },
    async updateChartData(chartId, sensor) {
      try {
        const response = await fetch(`/api/measurements/${sensor.id}?period=-1h`)
        const measurements = await response.json()

        const chart = this.charts[chartId]
        chart.data.labels = measurements.map((m) => new Date(m.timestamp).toLocaleTimeString())
        chart.data.datasets[0].data = measurements.map((m) => m.temperature)
        chart.data.datasets[1].data = measurements.map((m) => m.humidity)
        chart.update()
      } catch (error) {
        console.error('Ошибка обновления графика:', error)
      }
    },
    isTemperatureWarning(sensor) {
      return sensor.temperature < this.settings.temperature.min || sensor.temperature > this.settings.temperature.max
    },
    isHumidityWarning(sensor) {
      return sensor.humidity < this.settings.humidity.min || sensor.humidity > this.settings.humidity.max
    },
    getStatusClass(status) {
      switch (status) {
        case 0:
          return 'status-normal'
        case 1:
          return 'status-warning'
        case 2:
          return 'status-error'
        default:
          return ''
      }
    },
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
    },
    formatTimestamp(timestamp) {
      return new Date(timestamp).toLocaleString()
    },
    startAutoUpdate() {
      this.updateInterval = setInterval(() => {
        if (this.currentView === 'dashboard') {
          this.updateSensorsData()
        }
      }, 5000)
    },
    stopAutoUpdate() {
      if (this.updateInterval) {
        clearInterval(this.updateInterval)
        this.updateInterval = null
      }
    },
  },
  mounted() {
    this.startAutoUpdate()
  },
  beforeUnmount() {
    this.stopAutoUpdate()
  },
})

app.mount('#app')
