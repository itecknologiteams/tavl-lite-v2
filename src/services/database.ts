// Database query service via Electron IPC

export interface QueryResult<T = any> {
  success: boolean;
  data?: T[];
  error?: string;
}

class DatabaseService {
  private isElectron(): boolean {
    return typeof window !== 'undefined' && window.electron !== undefined;
  }

  async query<T = any>(
    query: string,
    params?: Record<string, any>
  ): Promise<QueryResult<T>> {
    if (!this.isElectron()) {
      return {
        success: false,
        error: 'Not running in Electron environment',
      };
    }

    try {
      const result = await window.electron.db.query(query, params);
      return result as QueryResult<T>;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Query failed',
      };
    }
  }

  // Vehicle queries
  async getVehicleLastLocation(vehicleId: string) {
    const query = `
      SELECT TOP (1) 
        @carNumber AS Number,
        [ServerTime], [GpsTime], [X] AS longitude, [Y] AS latitude, 
        [Valid], [Angle], [Speed], [Altitude], [Satelites],
        [Ignition], [EngineCut], [Battery], [BackupBattery],
        [PowerVolt], [GSMSignal], [HarshBrake], [HarshAccel],
        [HarshCorner], [SeatBelt]
      FROM [Tracking].[dbo].[VehicleLastLocation]
      WHERE V_Id = @vehicleId
    `;
    
    return this.query(query, { vehicleId, carNumber: vehicleId });
  }

  async getVehiclesByUser(loginIds: string[]) {
    const query = `
      SELECT 
        [ObjectId], [Name], [GroupId]
      FROM [tavl2].[tavl].[Object]
      WHERE [ObjectId] IN (
        SELECT [ObjectId] 
        FROM [tavl2].[tavl].[GroupObject] 
        WHERE [GroupId] IN (
          SELECT [GroupId] 
          FROM [tavl2].[tavl].[GroupLogin] 
          WHERE [LoginId] IN (${loginIds.map((_, i) => `@loginId${i}`).join(',')})
        )
      )
    `;
    
    const params: Record<string, any> = {};
    loginIds.forEach((id, i) => {
      params[`loginId${i}`] = id;
    });
    
    return this.query(query, params);
  }

  async getIgnitionStatus(objectIds: string[]) {
    const query = `
      SELECT [ObjectId], [Name], [Value]
      FROM [tavl2].[tavl].[DeviceLatestIO]
      WHERE [Name] LIKE 'Ignition%'
        AND [ObjectId] IN (${objectIds.map((_, i) => `@objId${i}`).join(',')})
    `;
    
    const params: Record<string, any> = {};
    objectIds.forEach((id, i) => {
      params[`objId${i}`] = id;
    });
    
    return this.query(query, params);
  }

  // Alarm queries
  async getEventsClosure(startDate: string, endDate: string) {
    const query = `
      SELECT 
        [EVENT_ID], [Agent_ID], [Agent_Name], 
        [Event_DT], [Closure_DT], [Base_Name], [Appear_DT]
      FROM [Tracking].[dbo].[Events_closure]
      WHERE [Event_DT] BETWEEN @startDate AND @endDate
      ORDER BY [Event_DT] DESC
    `;
    
    return this.query(query, { startDate, endDate });
  }

  async insertEventClosure(
    eventId: string,
    agentId: string,
    agentName: string,
    eventDT: string,
    closureDT: string,
    baseName: string,
    appearDT: string
  ) {
    const query = `
      INSERT INTO [Tracking].[dbo].[Events_closure]
        (EVENT_ID, Agent_ID, Agent_Name, Event_DT, Closure_DT, Base_Name, Appear_DT)
      VALUES
        (@eventId, @agentId, @agentName, @eventDT, @closureDT, @baseName, @appearDT)
    `;
    
    return this.query(query, {
      eventId,
      agentId,
      agentName,
      eventDT,
      closureDT,
      baseName,
      appearDT,
    });
  }
}

export const db = new DatabaseService();
