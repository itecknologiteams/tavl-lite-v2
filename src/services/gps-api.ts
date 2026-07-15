import axios, { AxiosInstance } from 'axios';
import { reverseGeocode } from '@utils/geocoder';

class GPSApiClient {
  private client: AxiosInstance;
  private baseURL = 'http://webtrack.itecknologi.com/api';

  constructor() {
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 15000,
    });
  }

  async login(username: string, password: string): Promise<any> {
    const response = await this.client.get('/api_custom.php', {
      params: {
        cmd: 'login',
        username,
        password,
      },
    });
    return response.data;
  }

  async getMaxAlert(username: string, password: string): Promise<any> {
    const response = await this.client.get('/api_custom.php', {
      params: {
        cmd: 'select_max_alert',
        username,
        password,
      },
    });
    return response.data;
  }

  async getAlerts(
    username: string,
    password: string,
    maxAlertId: string
  ): Promise<any> {
    const response = await this.client.get('/api_custom.php', {
      params: {
        cmd: 'select_alerts',
        username,
        password,
        max_alert_id: maxAlertId,
      },
    });
    return response.data;
  }

  async geocode(lat: number, lon: number): Promise<string> {
    return reverseGeocode(lat, lon);
  }
}

export const gpsApi = new GPSApiClient();
