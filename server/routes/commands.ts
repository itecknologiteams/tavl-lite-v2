import { Router } from 'express';
import { queryPostgres } from '../db/postgres';
import { queryCommand, initCommandDatabase } from '../db/command';
import { queryTavl } from '../db/tavl';

const router = Router();

// Initialize command database on startup
initCommandDatabase().catch(err => console.error('Failed to init Command DB:', err.message));

// Device command configurations by module type
const DEVICE_COMMANDS: Record<string, {
  type: 'gprs' | 'sms';
  commands: {
    kill?: string;
    resume?: string;
    location?: string;
    reset?: string;
  };
  needsCredentials?: boolean;
}> = {
  'JM-VG03': {
    type: 'gprs',
    commands: {
      kill: 'RELAY,1#',
      resume: 'RELAY,0#',
      location: 'WHERE#',
      reset: 'RESET#',
    },
  },
  'G1Cmini': {
    type: 'sms',
    commands: {
      kill: '<SPGS*IMB>',
      resume: '<SPGS*RLS>',
      location: 'map',
      reset: 'REST#',
    },
  },
  'G1C': {
    type: 'sms',
    commands: {
      kill: '<SPGS*IMB>',
      resume: '<SPGS*RLS>',
      location: 'map',
      reset: 'REST#',
    },
  },
  // Teltonika devices - SMS based with credentials
  'TM2 (FM2)': { type: 'sms', commands: { kill: 'setdigout 1', resume: 'setdigout 0', location: 'getgps', reset: 'cpureset' }, needsCredentials: true },
  'FMB910': { type: 'sms', commands: { kill: 'setdigout 1', resume: 'setdigout 0', location: 'getgps', reset: 'cpureset' }, needsCredentials: true },
  'FMB920': { type: 'sms', commands: { kill: 'setdigout 1', resume: 'setdigout 0', location: 'getgps', reset: 'cpureset' }, needsCredentials: true },
  'FMB900': { type: 'sms', commands: { kill: 'setdigout 1', resume: 'setdigout 0', location: 'getgps', reset: 'cpureset' }, needsCredentials: true },
  'FMB001': { type: 'sms', commands: { kill: 'setdigout 1', resume: 'setdigout 0', location: 'getgps', reset: 'cpureset' }, needsCredentials: true },
  'FMB100': { type: 'sms', commands: { kill: 'setdigout 11', resume: 'setdigout 0', location: 'getgps', reset: 'cpureset' }, needsCredentials: true },
  'FMB120': { type: 'sms', commands: { kill: 'setdigout 1', resume: 'setdigout 0', location: 'getgps', reset: 'cpureset' }, needsCredentials: true },
  'FMB122': { type: 'sms', commands: { kill: 'setdigout 1', resume: 'setdigout 0', location: 'getgps', reset: 'cpureset' }, needsCredentials: true },
  'FMA120': { type: 'sms', commands: { kill: 'setdigout 11', resume: 'setdigout 0', location: 'getgps', reset: 'cpureset' }, needsCredentials: true },
  'FM10': { type: 'sms', commands: { kill: 'setdigout 1', resume: 'setdigout 0', location: 'getgps', reset: 'cpureset' }, needsCredentials: true },
  'FM11': { type: 'sms', commands: { kill: 'setdigout 11', resume: 'setdigout 0', location: 'getgps', reset: 'cpureset' }, needsCredentials: true },
  'FM53': { type: 'sms', commands: { kill: 'setdigout 1', resume: 'setdigout 0', location: 'getgps', reset: 'cpureset' }, needsCredentials: true },
  'MTB100': { type: 'sms', commands: { kill: 'setdigout 1', resume: 'setdigout 0', location: 'getgps', reset: 'cpureset' }, needsCredentials: true },
  'TFT100': { type: 'sms', commands: { kill: 'setdigout 1', resume: 'setdigout 0', location: 'getgps', reset: 'cpureset' }, needsCredentials: true },
  'MT100': { type: 'sms', commands: { kill: '*22*2#', resume: '*22*3#', location: '*11*3#', reset: '*22*4#' } },
  'IDS100': { type: 'sms', commands: { kill: '*22*2#', resume: '*22*3#', location: '*11*3#', reset: '*22*4#' } },
  'IDST100': { type: 'sms', commands: { kill: '*22*2#', resume: '*22*3#', location: '*11*3#', reset: '*22*4#' } },
};

// Fallback: query MSSQL directly when PG cache has no data
async function queryDeviceFromMssql(objectId: number) {
  return queryTavl(`
    SELECT O.ObjectId as "ObjectId", O.Number as "PlateNumber",
           O.Comment as "Description", M.Imei as "Imei",
           M.ModuleId as "ModuleId", MT.Name as "ModuleType",
           SC.GsmNumber as "SimNumber", M.Identifier as "Identifier",
           M.Password as "Password"
    FROM [tavl2].[tavl].[Object] O WITH (NOLOCK)
    LEFT JOIN [tavl2].[tavl].[ModuleObject] MO ON O.ObjectId = MO.ObjectId
    LEFT JOIN [tavl2].[tavl].[Module] M ON MO.ModuleId = M.ModuleId
    LEFT JOIN [tavl2].[tavl].[ModuleType] MT ON M.ModuleTypeId = MT.ModuleTypeId
    LEFT JOIN [tavl2].[tavl].[SimCardModule] SCM ON M.ModuleId = SCM.ModuleId
    LEFT JOIN [tavl2].[tavl].[SimCard] SC ON SCM.SimCardId = SC.SimCardId
    WHERE O.ObjectId = @objectId
  `, { objectId });
}

// GET /api/commands/device/:objectId - Get device info and available commands
router.get('/device/:objectId', async (req, res) => {
  const objectId = parseInt(req.params.objectId);
  
  if (isNaN(objectId)) {
    return res.status(400).json({ success: false, error: 'Invalid objectId' });
  }
  
  try {
    // Get device details from PG cache
    let result = await queryPostgres(`
      SELECT object_id as "ObjectId", plate_number as "PlateNumber",
             description as "Description", imei as "Imei", module_id as "ModuleId",
             module_type as "ModuleType", sim_number as "SimNumber",
             identifier as "Identifier", password as "Password"
      FROM tavl_devices WHERE object_id = $1
    `, [objectId]);
    
    // Fallback: query MSSQL directly if PG cache is empty
    if (!result || result.length === 0) {
      result = await queryDeviceFromMssql(objectId);
    }
    if (!result || result.length === 0) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }
    
    const device = result[0];
    const moduleType = device.ModuleType?.trim() || 'Unknown';
    const config = DEVICE_COMMANDS[moduleType];
    
    // Determine available commands
    const availableCommands: string[] = [];
    if (config) {
      if (config.commands.kill) availableCommands.push('kill');
      if (config.commands.resume) availableCommands.push('resume');
      if (config.commands.location) availableCommands.push('location');
      if (config.commands.reset) availableCommands.push('reset');
    }
    
    res.json({
      success: true,
      device: {
        objectId: device.ObjectId,
        plateNumber: device.PlateNumber,
        description: device.Description,
        imei: device.Imei?.trim(),
        simNumber: device.SimNumber?.trim(),
        moduleType,
        commandType: config?.type || 'unknown',
        availableCommands,
        supported: !!config,
      },
    });
    
  } catch (error: any) {
    console.error('❌ Get device error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/commands/send - Send a command to device
router.post('/send', async (req, res) => {
  const { objectId, command, userName } = req.body;
  
  if (!objectId || !command) {
    return res.status(400).json({ success: false, error: 'objectId and command are required' });
  }
  
  try {
    // Get device info from PG cache
    let deviceResult = await queryPostgres(`
      SELECT object_id as "ObjectId", plate_number as "PlateNumber",
             imei as "Imei", module_type as "ModuleType", sim_number as "SimNumber",
             identifier as "Identifier", password as "Password"
      FROM tavl_devices WHERE object_id = $1
    `, [parseInt(objectId)]);
    
    // Fallback: query MSSQL directly if PG cache is empty
    if (!deviceResult || deviceResult.length === 0) {
      deviceResult = await queryDeviceFromMssql(parseInt(objectId));
    }
    if (!deviceResult || deviceResult.length === 0) {
      return res.status(404).json({ success: false, error: 'Vehicle not found' });
    }
    
    const device = deviceResult[0];
    const moduleType = device.ModuleType?.trim() || 'Unknown';
    let config = DEVICE_COMMANDS[moduleType];
    
    // Case-insensitive fallback: match any module type containing "G1C" (any case)
    if (!config) {
      const g1cKey = Object.keys(DEVICE_COMMANDS).find(
        k => k.toUpperCase().includes('G1C') && moduleType.toUpperCase().includes('G1C')
      );
      if (g1cKey) config = DEVICE_COMMANDS[g1cKey];
    }
    
    if (!config) {
      return res.status(400).json({ 
        success: false, 
        error: `Device type "${moduleType}" is not supported for commands` 
      });
    }
    
    // Get the actual command string
    const commandStr = config.commands[command as keyof typeof config.commands];
    if (!commandStr) {
      return res.status(400).json({ 
        success: false, 
        error: `Command "${command}" is not available for this device type` 
      });
    }
    
    // Build full command (with credentials if needed)
    let fullCommand = commandStr;
    if (config.needsCredentials && device.Identifier && device.Password) {
      fullCommand = `${device.Identifier.trim()} ${device.Password.trim()} ${commandStr}`;
    }
    
    const user = userName || 'iTecknologi';
    const imei = device.Imei?.trim();
    const simNumber = device.SimNumber?.trim();
    
    console.log(`📡 Sending ${config.type.toUpperCase()} command to ${device.PlateNumber}:`, {
      command,
      fullCommand,
      moduleType,
      objectId,
    });
    
    if (config.type === 'gprs') {
      // GPRS command - insert into GprsCommandQueue on Command DB (192.168.21.33)
      if (!imei) {
        return res.status(400).json({ success: false, error: 'Device has no IMEI' });
      }
      
      await queryCommand(`
        INSERT INTO [dbo].[GprsCommandQueue] 
        ([ObjectId], [Imei], [Command], [EntryTime], [CrmUser]) 
        VALUES (@objectId, @imei, @command, GETDATE(), @user)
      `, {
        objectId: parseInt(objectId),
        imei,
        command: fullCommand,
        user,
      });
      
    } else {
      // SMS command - insert into to_be_sent queue on Command DB (192.168.21.33)
      if (!simNumber) {
        return res.status(400).json({ success: false, error: 'Device has no SIM number' });
      }
      
      // Check if same command already pending in to_be_sent
      const existing = await queryCommand(`
        SELECT * FROM [dbo].[to_be_sent] WITH (NOLOCK)
        WHERE sim_number = @simNumber AND message = @command
      `, {
        simNumber,
        command: fullCommand,
      });
      
      if (existing && existing.length > 0) {
        return res.json({
          success: true,
          message: 'Command already in queue',
          alreadyQueued: true,
        });
      }
      
      // Insert into to_be_sent (the SMS queue processed by the tracking server)
      await queryCommand(`
        INSERT INTO [dbo].[to_be_sent] 
        (sim_number, message, user_name, object_id) 
        VALUES (@simNumber, @command, @user, @objectId)
      `, {
        simNumber,
        command: fullCommand,
        user,
        objectId: parseInt(objectId),
      });
    }
    
    console.log(`✅ Command queued successfully`);
    
    res.json({
      success: true,
      message: `${command} command sent to ${device.PlateNumber}`,
      commandType: config.type,
      commandSent: fullCommand,
    });
    
  } catch (error: any) {
    console.error('❌ Send command error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PKT (UTC+5) fix: mssql driver treats time stored in PKT as UTC, shifting display +5h.
// Subtract 5h so UTC matches actual PKT stored value.
function fixPktDate(date: Date | null | undefined): Date | null {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return null;
  return new Date(date.getTime() - 5 * 60 * 60 * 1000);
}

// GET /api/commands/history/:objectId - Get command history
router.get('/history/:objectId', async (req, res) => {
  const objectId = parseInt(req.params.objectId);
  const limit = parseInt(req.query.limit as string) || 50;
  
  if (isNaN(objectId)) {
    return res.status(400).json({ success: false, error: 'Invalid objectId' });
  }
  
  try {
    // Get device info from PG cache
    let deviceResult = await queryPostgres(`
      SELECT imei as "Imei", sim_number as "SimNumber"
      FROM tavl_devices WHERE object_id = $1
    `, [objectId]);
    
    // Fallback: query MSSQL directly if PG cache is empty
    if (!deviceResult || deviceResult.length === 0) {
      deviceResult = await queryTavl(`
        SELECT M.Imei as "Imei", SC.GsmNumber as "SimNumber"
        FROM [tavl2].[tavl].[Object] O WITH (NOLOCK)
        LEFT JOIN [tavl2].[tavl].[ModuleObject] MO ON O.ObjectId = MO.ObjectId
        LEFT JOIN [tavl2].[tavl].[Module] M ON MO.ModuleId = M.ModuleId
        LEFT JOIN [tavl2].[tavl].[SimCardModule] SCM ON M.ModuleId = SCM.ModuleId
        LEFT JOIN [tavl2].[tavl].[SimCard] SC ON SCM.SimCardId = SC.SimCardId
        WHERE O.ObjectId = @objectId
      `, { objectId });
    }
    
    const device = deviceResult?.[0];
    const imei = device?.Imei?.trim();
    const simNumber = device?.SimNumber?.trim();
    
    // All command history queries go to Command DB (192.168.21.33)
    
    // Get GPRS commands sent
    let gprsSent: any[] = [];
    if (imei) {
      try {
        gprsSent = await queryCommand(`
          SELECT TOP ${limit}
            GCSId as Id,
            'sent' as Type,
            Imei,
            ObjectId,
            Command,
            SentTime,
            CrmUser
          FROM [dbo].[GprsCommandSent] WITH (NOLOCK)
          WHERE Imei = @imei AND ObjectId = @objectId
          ORDER BY SentTime DESC
        `, { imei, objectId });
      } catch (e: any) {
        console.warn('GPRS sent query failed:', e.message);
      }
    }
    
    // Get GPRS command replies
    let gprsReplies: any[] = [];
    if (imei) {
      try {
        gprsReplies = await queryCommand(`
          SELECT TOP ${limit}
            GCRId as Id,
            'reply' as Type,
            Imei,
            ObjectId,
            Reply,
            RecvTime,
            ReplyBy
          FROM [dbo].[GprsCommandReply] WITH (NOLOCK)
          WHERE Imei = @imei AND ObjectId = @objectId
          ORDER BY RecvTime DESC
        `, { imei, objectId });
      } catch (e: any) {
        console.warn('GPRS reply query failed:', e.message);
      }
    }
    
    // Get pending GPRS queue
    let gprsQueue: any[] = [];
    if (imei) {
      try {
        gprsQueue = await queryCommand(`
          SELECT TOP 20
            GCQId as Id,
            Imei,
            ObjectId,
            Command,
            EntryTime,
            CrmUser
          FROM [dbo].[GprsCommandQueue] WITH (NOLOCK)
          WHERE Imei = @imei AND ObjectId = @objectId
          ORDER BY EntryTime DESC
        `, { imei, objectId });
      } catch (e: any) {
        console.warn('GPRS queue query failed:', e.message);
      }
    }
    
    // Get SMS command history (sent with possible replies)
    let smsSent: any[] = [];
    if (simNumber) {
      try {
        smsSent = await queryCommand(`
          SELECT TOP ${limit}
            id as Id,
            cell_num as SimNumber,
            sent_msg as Command,
            sent_time as SentTime,
            recv_msg as Reply,
            recv_time as ReplyTime,
            sent_by as SentBy
          FROM [dbo].[control_room_sms] WITH (NOLOCK)
          WHERE cell_num = @simNumber
          ORDER BY sent_time DESC
        `, { simNumber });
      } catch (e: any) {
        console.warn('SMS sent query failed:', e.message);
      }
    }
    
    // Get SMS replies from control_room_sms_received
    let smsReplies: any[] = [];
    if (simNumber) {
      try {
        smsReplies = await queryCommand(`
          SELECT TOP ${limit}
            id as Id,
            cell_num as SimNumber,
            recv_msg as Message,
            recv_time as ReceivedTime,
            sent_by as SentBy
          FROM [dbo].[control_room_sms_received] WITH (NOLOCK)
          WHERE cell_num = @simNumber
          ORDER BY recv_time DESC
        `, { simNumber });
      } catch (e: any) {
        console.warn('SMS replies query failed:', e.message);
      }
    }
    
    // Fix PKT timestamps shifted +5h by mssql driver
    gprsQueue.forEach((r: any) => { r.EntryTime = fixPktDate(r.EntryTime); });
    gprsSent.forEach((r: any) => { r.SentTime = fixPktDate(r.SentTime); });
    gprsReplies.forEach((r: any) => { r.RecvTime = fixPktDate(r.RecvTime); });
    smsSent.forEach((r: any) => { r.SentTime = fixPktDate(r.SentTime); r.ReplyTime = fixPktDate(r.ReplyTime); });
    smsReplies.forEach((r: any) => { r.ReceivedTime = fixPktDate(r.ReceivedTime); });

    res.json({
      success: true,
      gprs: {
        queue: gprsQueue,
        sent: gprsSent,
        replies: gprsReplies,
      },
      sms: {
        sent: smsSent,
        replies: smsReplies,
      },
    });
    
  } catch (error: any) {
    console.error('❌ Get history error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/commands/supported-devices - List all supported device types
router.get('/supported-devices', (_req, res) => {
  const devices = Object.entries(DEVICE_COMMANDS).map(([name, config]) => ({
    name,
    type: config.type,
    commands: Object.keys(config.commands),
    needsCredentials: config.needsCredentials || false,
  }));
  
  res.json({ success: true, devices });
});

export default router;
