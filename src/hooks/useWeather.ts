import { useState, useEffect, useCallback } from 'react';

// Weather code to description and icon mapping
// Based on WMO Weather interpretation codes
const WEATHER_CODES: Record<number, { description: string; icon: string }> = {
  0: { description: 'Clear sky', icon: '☀️' },
  1: { description: 'Mainly clear', icon: '🌤️' },
  2: { description: 'Partly cloudy', icon: '⛅' },
  3: { description: 'Overcast', icon: '☁️' },
  45: { description: 'Fog', icon: '🌫️' },
  48: { description: 'Depositing rime fog', icon: '🌫️' },
  51: { description: 'Light drizzle', icon: '🌧️' },
  53: { description: 'Moderate drizzle', icon: '🌧️' },
  55: { description: 'Dense drizzle', icon: '🌧️' },
  56: { description: 'Light freezing drizzle', icon: '🌨️' },
  57: { description: 'Dense freezing drizzle', icon: '🌨️' },
  61: { description: 'Slight rain', icon: '🌧️' },
  63: { description: 'Moderate rain', icon: '🌧️' },
  65: { description: 'Heavy rain', icon: '🌧️' },
  66: { description: 'Light freezing rain', icon: '🌨️' },
  67: { description: 'Heavy freezing rain', icon: '🌨️' },
  71: { description: 'Slight snow', icon: '🌨️' },
  73: { description: 'Moderate snow', icon: '🌨️' },
  75: { description: 'Heavy snow', icon: '❄️' },
  77: { description: 'Snow grains', icon: '🌨️' },
  80: { description: 'Slight rain showers', icon: '🌦️' },
  81: { description: 'Moderate rain showers', icon: '🌦️' },
  82: { description: 'Violent rain showers', icon: '⛈️' },
  85: { description: 'Slight snow showers', icon: '🌨️' },
  86: { description: 'Heavy snow showers', icon: '❄️' },
  95: { description: 'Thunderstorm', icon: '⛈️' },
  96: { description: 'Thunderstorm with hail', icon: '⛈️' },
  99: { description: 'Thunderstorm with heavy hail', icon: '⛈️' },
};

export interface WeatherData {
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  description: string;
  icon: string;
  isDay: boolean;
  updatedAt: Date;
}

interface WeatherCache {
  data: WeatherData;
  expiry: number;
}

// Cache weather data for 10 minutes (keyed by rounded lat/lng)
const weatherCache = new Map<string, WeatherCache>();
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// Round coordinates to 2 decimal places for caching
const getCacheKey = (lat: number, lng: number): string => {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
};

export const useWeather = (latitude: number | null, longitude: number | null) => {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWeather = useCallback(async (lat: number, lng: number) => {
    const cacheKey = getCacheKey(lat, lng);
    
    // Check cache first
    const cached = weatherCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      setWeather(cached.data);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m&timezone=auto`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('Failed to fetch weather data');
      }

      const data = await response.json();
      
      if (!data.current) {
        throw new Error('Invalid weather data received');
      }

      const weatherCode = data.current.weather_code || 0;
      const weatherInfo = WEATHER_CODES[weatherCode] || { description: 'Unknown', icon: '❓' };

      const weatherData: WeatherData = {
        temperature: Math.round(data.current.temperature_2m),
        feelsLike: Math.round(data.current.apparent_temperature),
        humidity: data.current.relative_humidity_2m,
        windSpeed: Math.round(data.current.wind_speed_10m),
        weatherCode,
        description: weatherInfo.description,
        icon: weatherInfo.icon,
        isDay: data.current.is_day === 1,
        updatedAt: new Date(),
      };

      // Cache the result
      weatherCache.set(cacheKey, {
        data: weatherData,
        expiry: Date.now() + CACHE_DURATION,
      });

      setWeather(weatherData);
      setError(null);
    } catch (err) {
      console.error('Weather fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch weather');
      setWeather(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (latitude !== null && longitude !== null) {
      fetchWeather(latitude, longitude);
    } else {
      setWeather(null);
    }
  }, [latitude, longitude, fetchWeather]);

  const refresh = useCallback(() => {
    if (latitude !== null && longitude !== null) {
      // Clear cache for this location
      const cacheKey = getCacheKey(latitude, longitude);
      weatherCache.delete(cacheKey);
      fetchWeather(latitude, longitude);
    }
  }, [latitude, longitude, fetchWeather]);

  return { weather, loading, error, refresh };
};

// Utility function to get weather info by code
export const getWeatherInfo = (code: number) => {
  return WEATHER_CODES[code] || { description: 'Unknown', icon: '❓' };
};
