import axios, { AxiosInstance } from 'axios';
import type { MDVRLoginResponse, MDVRDeviceStatus } from '@apptypes/api';

class MDVRApiClient {
  private client: AxiosInstance;
  private baseURL = 'http://mdvr.itecknologi.com:8080';

  constructor() {
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 60000, // Increased to 60 seconds for slow networks
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async login(account: string, password: string): Promise<MDVRLoginResponse> {
    const response = await this.client.get('/StandardApiAction_login.action', {
      params: { account, password },
    });
    return response.data;
  }

  async logout(jsession: string): Promise<any> {
    const response = await this.client.get('/StandardApiAction_logout.action', {
      params: { jsession },
    });
    return response.data;
  }

  async getUserVehicles(jsession: string): Promise<any> {
    const response = await this.client.get('/StandardApiAction_queryUserVehicle.action', {
      params: { jsession },
    });
    return response.data;
  }

  async getDeviceStatus(
    jsession: string,
    devIdno: string | string[]
  ): Promise<{ status: MDVRDeviceStatus[] }> {
    const deviceIds = Array.isArray(devIdno) ? devIdno.join(',') : devIdno;
    const response = await this.client.get('/StandardApiAction_getDeviceStatus.action', {
      params: {
        jsession,
        devIdno: deviceIds,
        toMap: 1,
        driver: 0,
        geoaddress: 1,
        language: 'zh',
      },
    });
    return response.data;
  }

  async getDeviceTrack(
    jsession: string,
    devIdno: string,
    begintime: string,
    endtime: string
  ): Promise<any> {
    const response = await this.client.get('/StandardApiAction_queryTrackDetail.action', {
      params: {
        jsession,
        devIdno,
        begintime,
        endtime,
        distance: 0,
        parkTime: 0,
        currentPage: 1,
        toMap: 1,
      },
    });
    return response.data;
  }

  async getDeviceAlarm(
    jsession: string,
    devIdno: string,
    begintime: string,
    endtime: string,
    armType?: string
  ): Promise<any> {
    const response = await this.client.get('/StandardApiAction_queryAlarmDetail.action', {
      params: {
        jsession,
        begintime,
        endtime,
        devIdno,
        armType: armType || '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20',
        handle: 1,
        currentPage: 1,
        pageRecords: 50,
        toMap: 1,
        checkend: 0,
      },
    });
    return response.data;
  }

  async getMileage(
    jsession: string,
    vehiIdno: string,
    begintime: string,
    endtime: string
  ): Promise<any> {
    const response = await this.client.get('/StandardApiAction_runMileage.action', {
      params: {
        jsession,
        vehiIdno,
        begintime,
        endtime,
      },
    });
    return response.data;
  }

  async getParkedDetails(
    jsession: string,
    vehiIdno: string,
    begintime: string,
    endtime: string
  ): Promise<any> {
    const response = await this.client.get('/StandardApiAction_parkDetail.action', {
      params: {
        jsession,
        vehiIdno,
        begintime,
        endtime,
        parkTime: 0,
        toMap: 1,
        currentPage: 1,
        pageRecords: 50,
      },
    });
    return response.data;
  }
}

export const mdvrApi = new MDVRApiClient();
