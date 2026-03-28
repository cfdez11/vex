// <stdin>
import { reactive, watch, computed } from "/_vexjs/services/reactive.js";
import { effect } from "/_vexjs/services/reactive.js";
import { html } from "/_vexjs/services/html.js";
var metadata = null;
function hydrateClientComponent(marker, incomingProps = {}) {
  const weatherCodes = {
    0: { description: "Cielo despejado", icon: "\u2600\uFE0F", color: "text-yellow-500" },
    1: { description: "Mayormente despejado", icon: "\u{1F324}\uFE0F", color: "text-yellow-400" },
    2: { description: "Parcialmente nublado", icon: "\u26C5", color: "text-gray-400" },
    3: { description: "Nublado", icon: "\u2601\uFE0F", color: "text-gray-500" },
    45: { description: "Niebla", icon: "\u{1F32B}\uFE0F", color: "text-gray-400" },
    48: { description: "Niebla con escarcha", icon: "\u{1F32B}\uFE0F", color: "text-blue-300" },
    51: { description: "Llovizna ligera", icon: "\u{1F326}\uFE0F", color: "text-blue-400" },
    53: { description: "Llovizna moderada", icon: "\u{1F327}\uFE0F", color: "text-blue-500" },
    55: { description: "Llovizna intensa", icon: "\u{1F327}\uFE0F", color: "text-blue-600" },
    61: { description: "Lluvia ligera", icon: "\u{1F326}\uFE0F", color: "text-blue-500" },
    63: { description: "Lluvia moderada", icon: "\u{1F327}\uFE0F", color: "text-blue-600" },
    65: { description: "Lluvia intensa", icon: "\u26C8\uFE0F", color: "text-blue-700" },
    71: { description: "Nieve ligera", icon: "\u2744\uFE0F", color: "text-blue-200" },
    73: { description: "Nieve moderada", icon: "\u{1F328}\uFE0F", color: "text-blue-300" },
    75: { description: "Nieve intensa", icon: "\u2744\uFE0F", color: "text-blue-400" },
    95: { description: "Tormenta", icon: "\u26C8\uFE0F", color: "text-purple-600" }
  };
  const cities = {
    madrid: { lat: 40.4168, lon: -3.7038, timezone: "Europe/Madrid", name: "Madrid" },
    barcelona: { lat: 41.3851, lon: 2.1734, timezone: "Europe/Madrid", name: "Barcelona" },
    londres: { lat: 51.5074, lon: -0.1278, timezone: "Europe/London", name: "Londres" },
    nuevayork: { lat: 40.7128, lon: -74.006, timezone: "America/New_York", name: "Nueva York" },
    paris: { lat: 48.8566, lon: 2.3522, timezone: "Europe/Paris", name: "Paris" },
    tokio: { lat: 35.6762, lon: 139.6503, timezone: "Asia/Tokyo", name: "Tokio" }
  };
  const state = reactive({
    status: "idle",
    // idle | loading | success | error
    data: null,
    error: null,
    selectedCity: "madrid"
  });
  function getWeatherInfo(code) {
    return weatherCodes[code] || {
      description: "Desconocido",
      icon: "\u2753",
      color: "text-gray-500"
    };
  }
  async function fetchWeather(cityName, signal) {
    state.status = "loading";
    state.error = null;
    try {
      const city = cities[cityName];
      if (!city) throw new Error(`Ciudad ${cityName} no encontrada`);
      const url = "https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({
        latitude: city.lat,
        longitude: city.lon,
        current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
        hourly: "temperature_2m,precipitation_probability,weather_code",
        daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum",
        timezone: city.timezone,
        forecast_days: 5
      });
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error("API Error");
      const data = await response.json();
      state.data = {
        location: {
          name: city.name,
          latitude: data.latitude,
          longitude: data.longitude,
          timezone: data.timezone
        },
        current: {
          temperature: Math.round(data.current.temperature_2m),
          humidity: data.current.relative_humidity_2m,
          apparentTemperature: Math.round(data.current.apparent_temperature),
          precipitation: data.current.precipitation,
          weatherCode: data.current.weather_code,
          windSpeed: Math.round(data.current.wind_speed_10m * 10) / 10
        },
        daily: data.daily.time.slice(0, 5).map((date, index) => ({
          date: new Date(date).toLocaleDateString("es-ES", {
            weekday: "short",
            day: "numeric",
            month: "short"
          }),
          weatherCode: data.daily.weather_code[index],
          tempMax: Math.round(data.daily.temperature_2m_max[index]),
          tempMin: Math.round(data.daily.temperature_2m_min[index]),
          precipitation: data.daily.precipitation_sum[index]
        })),
        hourly: {
          next24h: data.hourly.time.slice(0, 24).map((time, index) => ({
            time: new Date(time).toLocaleTimeString("es-ES", {
              hour: "2-digit",
              minute: "2-digit"
            }),
            temperature: Math.round(data.hourly.temperature_2m[index]),
            precipitation: data.hourly.precipitation_probability[index],
            weatherCode: data.hourly.weather_code[index]
          }))
        },
        lastUpdated: (/* @__PURE__ */ new Date()).toLocaleString("es-ES")
      };
      state.status = "success";
    } catch (err) {
      state.status = "error";
      state.error = err.message;
      state.data = null;
    }
  }
  watch(
    () => state.selectedCity,
    async (city, _, onCleanup) => {
      if (!city) return;
      const controller = new AbortController();
      onCleanup(() => controller.abort());
      await fetchWeather(city, controller.signal);
    },
    { immediate: true }
  );
  function changeCity(city) {
    state.selectedCity = city;
  }
  const currentWeather = computed(
    () => state.data ? getWeatherInfo(state.data.current?.weatherCode) : null
  );
  const wrapper = document.createElement("vex-root");
  marker.replaceWith(wrapper);
  function render() {
    const node = html`<div>
    <!-- Header -->
    <div class="bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl p-6 text-white shadow-lg">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 class="text-3xl font-bold mb-2">🌤️ Weather in ${state.data?.location?.name}</h2>
          <p class="text-blue-100">Data loaded from client (real-time API)</p>
        </div>

        <div class="flex flex-wrap gap-2">
          ${Object.keys(cities).map((city) => html`<button @click="${() => changeCity(city)}"
            class="px-3 py-2 rounded-lg text-sm font-medium transition-all"
            :class='${state.selectedCity === city ? "bg-white text-blue-600" : "bg-blue-600 text-white hover:bg-blue-700"}'>
            ${cities[city]?.name}
          </button>`)}
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div x-if="${state.status === "loading" || state.status === "idle"}" class="flex items-center justify-center py-12">
      <div class="text-center space-y-4">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
        <p class="text-gray-600">Cargando datos meteorológicos...</p>
      </div>
    </div>

    <!-- Error -->
    <div x-else-if="${state.status === "error"}" class="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
      <div class="text-red-500 text-4xl mb-4">❌</div>
      <h3 class="text-red-800 font-bold text-lg mb-2">Error al cargar el clima</h3>
      <p class="text-red-600 mb-4">${state.error}</p>
      <button @click="${() => fetchWeather(state.selectedCity)}"
        class="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg transition-colors">
        Reintentar
      </button>
    </div>

    <!-- No data -->
    <div x-else-if="${!state.data}" class="text-center py-12" >
      No hay datos disponibles
    </div>

    <div x-else class="space-y-8">
      <!-- Current Weather -->
      <div>
        <h3 class="text-xl font-bold text-gray-800 mb-4">Current Weather</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

          <!-- Temperatura -->
          <div class="bg-white rounded-lg shadow-md p-6 border-l-4 border-blue-500">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-gray-500 text-sm font-medium">Temperatura</p>
                <p class="text-3xl font-bold text-gray-800">${state.data?.current?.temperature}°C</p>
                <p class="text-gray-400 text-sm">Sensación: ${state.data?.current?.apparentTemperature}°C</p>
              </div>
              <div class="text-4xl" :class='${currentWeather.color}'>${currentWeather.icon}</div>
            </div>
          </div>

          <!-- Humedad -->
          <div class="bg-white rounded-lg shadow-md p-6 border-l-4 border-green-500">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-gray-500 text-sm font-medium">Humedad</p>
                <p class="text-3xl font-bold text-gray-800">${state.data?.current?.humidity}%</p>
                <p class="text-gray-400 text-sm">${currentWeather.description}</p>
              </div>
              <div class="text-4xl text-green-500">💧</div>
            </div>
          </div>

          <!-- Viento -->
          <div class="bg-white rounded-lg shadow-md p-6 border-l-4 border-purple-500">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-gray-500 text-sm font-medium">Viento</p>
                <p class="text-3xl font-bold text-gray-800">${state.data?.current?.windSpeed} km/h</p>
                <p class="text-gray-400 text-sm">Velocidad del viento</p>
              </div>
              <div class="text-4xl text-purple-500">💨</div>
            </div>
          </div>

          <!-- Precipitación -->
          <div class="bg-white rounded-lg shadow-md p-6 border-l-4 border-orange-500">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-gray-500 text-sm font-medium">Precipitación</p>
                <p class="text-3xl font-bold text-gray-800">${state.data?.current?.precipitation} mm</p>
                <p class="text-gray-400 text-sm">Actual</p>
              </div>
              <div class="text-4xl text-orange-500">🌧️</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>`;
    wrapper.replaceChildren(node);
  }
  effect(() => render());
  return wrapper;
}
export {
  hydrateClientComponent,
  metadata
};
