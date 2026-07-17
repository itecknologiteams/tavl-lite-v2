/**
 * Alert Distribution Database Module
 * Creates and manages tables for the alert distribution system
 * Uses existing PostgreSQL connection (192.168.20.186/Tracking)
 */
import { initPostgres, queryPostgres, withTransaction } from './postgres';

// Initialize alert distribution tables
export const initAlertDistributionTables = async (): Promise<void> => {
  await initPostgres();
  
  console.log('📊 Initializing Alert Distribution tables...');
  
  try {
    // Create agent_sessions table
    await queryPostgres(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        username VARCHAR(100) NOT NULL,
        role VARCHAR(20) DEFAULT 'agent',
        status VARCHAR(20) DEFAULT 'online',
        logged_in_at TIMESTAMP DEFAULT NOW(),
        last_activity TIMESTAMP DEFAULT NOW(),
        current_alert_count INT DEFAULT 0,
        max_alerts INT DEFAULT 10,
        ws_connection_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id)
      )
    `);
    // Add extension column if not present
    try { await queryPostgres(`ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS extension VARCHAR(20)`); } catch {}

    // Create alert_assignments table
    await queryPostgres(`
      CREATE TABLE IF NOT EXISTS alert_assignments (
        id SERIAL PRIMARY KEY,
        alert_id VARCHAR(50) NOT NULL,
        alert_type VARCHAR(50) NOT NULL,
        vehicle_reg VARCHAR(50),
        customer_name VARCHAR(200),
        alert_message TEXT,
        alert_data JSONB,
        
        assigned_to VARCHAR(50),
        assigned_at TIMESTAMP,
        acknowledged_at TIMESTAMP,
        resolved_at TIMESTAMP,
        resolution VARCHAR(20),
        resolution_notes TEXT,
        
        escalated_to VARCHAR(50),
        escalated_at TIMESTAMP,
        escalation_reason VARCHAR(200),
        
        assignment_count INT DEFAULT 1,
        priority INT DEFAULT 5,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        
        UNIQUE(alert_id)
      )
    `);
    
    // Create alert_history table
    await queryPostgres(`
      CREATE TABLE IF NOT EXISTS alert_history (
        id SERIAL PRIMARY KEY,
        alert_id VARCHAR(50) NOT NULL,
        action VARCHAR(50) NOT NULL,
        performed_by VARCHAR(50),
        performed_at TIMESTAMP DEFAULT NOW(),
        details JSONB,
        handling_time_seconds INT,
        previous_status VARCHAR(20),
        new_status VARCHAR(20)
      )
    `);
    
    // Create distribution_rules table
    await queryPostgres(`
      CREATE TABLE IF NOT EXISTS distribution_rules (
        id SERIAL PRIMARY KEY,
        rule_type VARCHAR(50) NOT NULL,
        rule_name VARCHAR(100),
        description TEXT,
        config JSONB NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        priority INT DEFAULT 10,
        created_by VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Create agent_performance table
    await queryPostgres(`
      CREATE TABLE IF NOT EXISTS agent_performance (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        date DATE DEFAULT CURRENT_DATE,
        alerts_received INT DEFAULT 0,
        alerts_acknowledged INT DEFAULT 0,
        alerts_resolved INT DEFAULT 0,
        alerts_escalated INT DEFAULT 0,
        alerts_timeout INT DEFAULT 0,
        total_handling_time_seconds INT DEFAULT 0,
        avg_acknowledge_time_seconds INT,
        avg_resolution_time_seconds INT,
        UNIQUE(user_id, date)
      )
    `);
    
    // Create shift_schedules table for auto online/offline
    await queryPostgres(`
      CREATE TABLE IF NOT EXISTS shift_schedules (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, day_of_week)
      )
    `);

    // Create alert_comments table for agent-supervisor collaboration
    await queryPostgres(`
      CREATE TABLE IF NOT EXISTS alert_comments (
        id SERIAL PRIMARY KEY,
        alert_id VARCHAR(50) NOT NULL,
        user_id VARCHAR(50) NOT NULL,
        username VARCHAR(100),
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Alert type configuration — supervisor-managed dynamic filter
    await queryPostgres(`
      CREATE TABLE IF NOT EXISTS alert_type_config (
        id SERIAL PRIMARY KEY,
        event_name TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT DEFAULT 'medium',
        match_mode TEXT DEFAULT 'exact',
        enabled BOOLEAN DEFAULT TRUE,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Seed default rows only when the table is empty
    const existing = await queryPostgres(`SELECT COUNT(*) AS cnt FROM alert_type_config`);
    if (parseInt(existing[0]?.cnt) === 0) {
      const seed = [
        { name: 'Battery Status',  cat: 'battery',  sev: 'high',   mode: 'contains' },
        { name: 'FMB Battery',     cat: 'battery',  sev: 'high',   mode: 'contains' },
        { name: 'FMB Battery(PV)', cat: 'battery',  sev: 'high',   mode: 'exact'    },
        { name: 'Chaman',          cat: 'geofence', sev: 'medium', mode: 'exact'    },
        { name: 'Faisalabad',      cat: 'geofence', sev: 'medium', mode: 'exact'    },
        { name: 'KHI L',           cat: 'geofence', sev: 'medium', mode: 'exact'    },
        { name: 'KHI S',           cat: 'geofence', sev: 'medium', mode: 'exact'    },
        { name: 'Kohat',           cat: 'geofence', sev: 'medium', mode: 'exact'    },
        { name: 'LHR L',           cat: 'geofence', sev: 'medium', mode: 'exact'    },
        { name: 'LHR Motorway',    cat: 'geofence', sev: 'medium', mode: 'exact'    },
        { name: 'LHR S',           cat: 'geofence', sev: 'medium', mode: 'exact'    },
        { name: 'Sahiwal',         cat: 'geofence', sev: 'medium', mode: 'exact'    },
        { name: 'Wahh Cantt',      cat: 'geofence', sev: 'medium', mode: 'exact'    },
      ];
      for (const s of seed) {
        await queryPostgres(
          `INSERT INTO alert_type_config (event_name, category, severity, match_mode, created_by)
           VALUES ($1, $2, $3, $4, 'system')`,
          [s.name, s.cat, s.sev, s.mode]
        );
      }
      console.log(`🌱 Seeded ${seed.length} default alert type configs`);
    }

    // Widen resolution column for structured resolution types (was VARCHAR(20))
    await queryPostgres(`ALTER TABLE alert_assignments ALTER COLUMN resolution TYPE VARCHAR(50)`);

    // Add resolved_by to track who actually resolved each alert
    await queryPostgres(`ALTER TABLE alert_assignments ADD COLUMN IF NOT EXISTS resolved_by VARCHAR(100)`);

    // Create indexes for better query performance
    await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_alert_assignments_status ON alert_assignments(status)`);
    await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_alert_assignments_assigned_to ON alert_assignments(assigned_to)`);
    await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_alert_history_alert_id ON alert_history(alert_id)`);
    await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status)`);
    await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_agent_performance_date ON agent_performance(date)`);
    // Composite indexes for common query patterns
    await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_aa_status_created ON alert_assignments(status, created_at)`);
    await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_aa_assigned_status_created ON alert_assignments(assigned_to, status, created_at)`);
    await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_aa_vehicle_type_created ON alert_assignments(vehicle_reg, alert_type, created_at)`);

    // Agent call logs table — tracks per-agent call outcomes (answered, missed, rejected)
    await queryPostgres(`
      CREATE TABLE IF NOT EXISTS agent_call_logs (
        id SERIAL PRIMARY KEY,
        agent_extension VARCHAR(20) NOT NULL,
        crm_username VARCHAR(100),
        caller_id VARCHAR(50),
        caller_id_name VARCHAR(255),
        consumer_uuid VARCHAR(255),
        agent_channel_uuid VARCHAR(255),
        outcome VARCHAR(20) NOT NULL DEFAULT 'no_answer',
        ring_started_at TIMESTAMP DEFAULT NOW(),
        answered_at TIMESTAMP,
        ended_at TIMESTAMP,
        hangup_cause VARCHAR(100),
        duration_seconds INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_agent_call_logs_ext ON agent_call_logs(agent_extension)`);
    await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_agent_call_logs_channel ON agent_call_logs(agent_channel_uuid)`);
    await queryPostgres(`CREATE INDEX IF NOT EXISTS idx_agent_call_logs_outcome ON agent_call_logs(outcome)`);
    // Add column if table already exists without it
    try { await queryPostgres(`ALTER TABLE agent_call_logs ADD COLUMN IF NOT EXISTS crm_username VARCHAR(100)`); } catch {}
    
    console.log('✅ Alert Distribution tables initialized successfully');
    
  } catch (error: any) {
    console.error('❌ Failed to initialize Alert Distribution tables:', error.message);
    throw error;
  }
};

// ============================================
// Agent Session Functions
// ============================================

export const upsertAgentSession = async (
  userId: string,
  username: string,
  role: string = 'agent',
  wsConnectionId?: string,
  extension?: string
): Promise<any> => {
  // Recalculate actual active alert count from assignments table
  const countResult = await queryPostgres(`
    SELECT COUNT(*) as cnt FROM alert_assignments
    WHERE assigned_to = $1
      AND status IN ('assigned', 'acknowledged')
      AND created_at >= NOW() - INTERVAL '24 hours'
  `, [userId]);
  const actualCount = parseInt(countResult?.[0]?.cnt) || 0;

  const result = await queryPostgres(`
    INSERT INTO agent_sessions (user_id, username, role, status, logged_in_at, last_activity, current_alert_count, ws_connection_id, extension, updated_at)
    VALUES ($1, $2, $3, 'online', NOW(), NOW(), $5, $4, $6, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      username = $2,
      role = $3,
      status = 'online',
      last_activity = NOW(),
      current_alert_count = $5,
      ws_connection_id = COALESCE($4, agent_sessions.ws_connection_id),
      extension = COALESCE($6, agent_sessions.extension),
      updated_at = NOW()
    RETURNING *
  `, [userId, username, role, wsConnectionId, actualCount, extension]);
  
  return result[0];
};

export const updateAgentStatus = async (
  userId: string,
  status: 'online' | 'break_requested' | 'on_break' | 'offline'
): Promise<any> => {
  const result = await queryPostgres(`
    UPDATE agent_sessions 
    SET status = $2, last_activity = NOW(), updated_at = NOW()
    WHERE user_id = $1
    RETURNING *
  `, [userId, status]);
  
  return result[0];
};

export const updateAgentAlertCount = async (userId: string, delta: number): Promise<void> => {
  await queryPostgres(`
    UPDATE agent_sessions 
    SET current_alert_count = GREATEST(0, current_alert_count + $2),
        last_activity = NOW(),
        updated_at = NOW()
    WHERE user_id = $1
  `, [userId, delta]);
};

export const getOnlineAgents = async (): Promise<any[]> => {
  return queryPostgres(`
    SELECT * FROM agent_sessions 
    WHERE status IN ('online', 'break_requested')
      AND role = 'agent'
    ORDER BY current_alert_count ASC, last_activity DESC
  `);
};

export const getAgentSession = async (userId: string): Promise<any> => {
  const result = await queryPostgres(`
    SELECT * FROM agent_sessions WHERE user_id = $1
  `, [userId]);
  return result[0];
};

export const getAllAgentSessions = async (): Promise<any[]> => {
  return queryPostgres(`
    SELECT * FROM agent_sessions 
    WHERE role = 'agent'
    ORDER BY 
      CASE status 
        WHEN 'online' THEN 1 
        WHEN 'break_requested' THEN 2 
        WHEN 'on_break' THEN 3 
        ELSE 4 
      END,
      current_alert_count ASC
  `);
};

export const setAgentOffline = async (userId: string): Promise<void> => {
  await queryPostgres(`
    UPDATE agent_sessions 
    SET status = 'offline', current_alert_count = 0, ws_connection_id = NULL, updated_at = NOW()
    WHERE user_id = $1
  `, [userId]);
};

/**
 * Mark ALL agent sessions as offline.
 * Called on server startup to clear stale sessions from previous runs.
 */
export const markAllAgentsOffline = async (): Promise<number> => {
  const result = await queryPostgres(`
    UPDATE agent_sessions
    SET status = 'offline', current_alert_count = 0, ws_connection_id = NULL, updated_at = NOW()
    WHERE status != 'offline'
    RETURNING user_id
  `);
  return result?.length || 0;
};

/**
 * Touch last_activity for an agent (heartbeat).
 */
export const touchAgentActivity = async (userId: string): Promise<void> => {
  await queryPostgres(`
    UPDATE agent_sessions
    SET last_activity = NOW(), updated_at = NOW()
    WHERE user_id = $1 AND status != 'offline'
  `, [userId]);
};

/**
 * Mark agents as offline if their last_activity is older than the given threshold
 * AND they are not in the provided list of currently connected WS agent IDs.
 */
export const markStaleAgentsOffline = async (
  staleThresholdMinutes: number,
  connectedAgentIds: string[]
): Promise<string[]> => {
  if (connectedAgentIds.length > 0) {
    const placeholders = connectedAgentIds.map((_, i) => `$${i + 2}`).join(',');
    const result = await queryPostgres(`
      UPDATE agent_sessions
      SET status = 'offline', ws_connection_id = NULL, current_alert_count = 0, updated_at = NOW()
      WHERE status IN ('online', 'break_requested')
        AND last_activity < NOW() - make_interval(mins => $1)
        AND user_id NOT IN (${placeholders})
      RETURNING user_id
    `, [staleThresholdMinutes, ...connectedAgentIds]);
    return (result || []).map((r: any) => r.user_id);
  }

  const result = await queryPostgres(`
    UPDATE agent_sessions
    SET status = 'offline', ws_connection_id = NULL, current_alert_count = 0, updated_at = NOW()
    WHERE status IN ('online', 'break_requested')
      AND last_activity < NOW() - make_interval(mins => $1)
    RETURNING user_id
  `, [staleThresholdMinutes]);
  return (result || []).map((r: any) => r.user_id);
};

// ============================================
// Alert Assignment Functions
// ============================================

export const createAlertAssignment = async (alert: {
  alertId: string;
  alertType: string;
  vehicleReg?: string;
  customerName?: string;
  alertMessage?: string;
  alertData?: any;
  priority?: number;
}): Promise<any> => {
  const result = await queryPostgres(`
    INSERT INTO alert_assignments (
      alert_id, alert_type, vehicle_reg, customer_name, alert_message, alert_data, priority, status, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())
    ON CONFLICT (alert_id) DO NOTHING
    RETURNING *
  `, [
    alert.alertId,
    alert.alertType,
    alert.vehicleReg,
    alert.customerName,
    alert.alertMessage,
    JSON.stringify(alert.alertData || {}),
    alert.priority || 5,
  ]);
  
  return result[0];
};

export const resetAlertToPending = async (alertId: string, userId: string): Promise<boolean> => {
  return withTransaction(async (txq) => {
    const result = await txq(`
      UPDATE alert_assignments
      SET assigned_to = NULL, status = 'pending', assigned_at = NULL, updated_at = NOW()
      WHERE alert_id = $1 AND assigned_to = $2 AND status = 'assigned'
      RETURNING alert_id
    `, [alertId, userId]);
    if (result[0]) {
      await txq(`
        UPDATE agent_sessions
        SET current_alert_count = GREATEST(0, current_alert_count - 1), updated_at = NOW()
        WHERE user_id = $1
      `, [userId]);
      return true;
    }
    return false;
  });
};

export const assignAlertToAgent = async (alertId: string, userId: string): Promise<any> => {
  return withTransaction(async (txq) => {
    const result = await txq(`
      UPDATE alert_assignments 
      SET assigned_to = $2, 
          assigned_at = NOW(), 
          status = 'assigned',
          updated_at = NOW()
      WHERE alert_id = $1 AND status = 'pending'
      RETURNING *
    `, [alertId, userId]);

    if (result[0]) {
      await txq(`
        UPDATE agent_sessions 
        SET current_alert_count = GREATEST(0, current_alert_count + 1),
            last_activity = NOW(), updated_at = NOW()
        WHERE user_id = $1
      `, [userId]);
    }

    return result[0];
  });
};

export const acknowledgeAlert = async (alertId: string, userId: string): Promise<any> => {
  const result = await queryPostgres(`
    UPDATE alert_assignments 
    SET acknowledged_at = NOW(), 
        status = 'acknowledged',
        updated_at = NOW()
    WHERE alert_id = $1 AND assigned_to = $2 AND status = 'assigned'
    RETURNING *
  `, [alertId, userId]);
  
  return result[0];
};

export const RESOLUTION_TYPES = [
  'customer_contacted',
  'false_alarm',
  'field_team_dispatched',
  'monitoring_completed',
  'vehicle_recovered',
  'no_action_required',
  'auto_resolved',
  'other',
] as const;

export type ResolutionType = typeof RESOLUTION_TYPES[number];

export const resolveAlert = async (
  alertId: string, 
  userId: string, 
  resolutionType: string,
  notes?: string
): Promise<any> => {
  return withTransaction(async (txq) => {
    const result = await txq(`
      UPDATE alert_assignments
      SET resolved_at = NOW(),
          resolution = $3,
          resolution_notes = $4,
          status = 'resolved',
          resolved_by = (SELECT username FROM agent_sessions WHERE user_id = $2 LIMIT 1),
          updated_at = NOW()
      WHERE alert_id = $1 AND assigned_to = $2 AND status = 'acknowledged'
      RETURNING *
    `, [alertId, userId, resolutionType, notes || null]);

    if (result[0]) {
      await txq(`
        UPDATE agent_sessions 
        SET current_alert_count = GREATEST(0, current_alert_count - 1),
            last_activity = NOW(), updated_at = NOW()
        WHERE user_id = $1
      `, [userId]);
    }

    return result[0];
  });
};

export const supervisorResolveAlert = async (
  alertId: string,
  supervisorId: string,
  resolutionType: string,
  notes?: string
): Promise<any> => {
  return withTransaction(async (txq) => {
    const current = await txq(`
      SELECT assigned_to, status FROM alert_assignments WHERE alert_id = $1
    `, [alertId]);
    if (!current[0]) return null;

    const { assigned_to, status } = current[0];
    if (status === 'resolved') return null;

    const result = await txq(`
      UPDATE alert_assignments
      SET resolved_at = NOW(),
          resolution = $2,
          resolution_notes = $3,
          status = 'resolved',
          resolved_by = (SELECT username FROM agent_sessions WHERE user_id = $4 LIMIT 1),
          updated_at = NOW()
      WHERE alert_id = $1
      RETURNING *
    `, [alertId, resolutionType, notes || null, supervisorId]);

    if (result[0] && assigned_to && ['assigned', 'acknowledged', 'escalated'].includes(status)) {
      await txq(`
        UPDATE agent_sessions
        SET current_alert_count = GREATEST(0, current_alert_count - 1),
            last_activity = NOW(), updated_at = NOW()
        WHERE user_id = $1
      `, [assigned_to]);
    }

    return result[0];
  });
};

export const bulkDismissAlerts = async (
  alertIds: string[],
  supervisorId: string,
  reason: string
): Promise<number> => {
  if (!alertIds.length) return 0;

  const placeholders = alertIds.map((_, i) => `$${i + 1}`).join(',');

  const dismissed = await queryPostgres(`
    UPDATE alert_assignments
    SET status = 'expired',
        resolution = 'dismissed',
        resolution_notes = $${alertIds.length + 1},
        updated_at = NOW()
    WHERE alert_id IN (${placeholders})
      AND status IN ('pending', 'assigned', 'escalated')
    RETURNING alert_id, assigned_to
  `, [...alertIds, reason]);

  const agentsToDecrement = [...new Set(
    dismissed.filter((r: any) => r.assigned_to).map((r: any) => r.assigned_to)
  )];

  for (const agentId of agentsToDecrement) {
    const count = dismissed.filter((r: any) => r.assigned_to === agentId).length;
    await queryPostgres(`
      UPDATE agent_sessions
      SET current_alert_count = GREATEST(0, current_alert_count - $2),
          last_activity = NOW(), updated_at = NOW()
      WHERE user_id = $1
    `, [agentId, count]);
  }

  return dismissed.length;
};

export const updateAgentMaxAlerts = async (userId: string, maxAlerts: number): Promise<any> => {
  const clamped = Math.max(1, Math.min(50, maxAlerts));
  const result = await queryPostgres(`
    UPDATE agent_sessions
    SET max_alerts = $2, updated_at = NOW()
    WHERE user_id = $1
    RETURNING *
  `, [userId, clamped]);
  return result[0];
};

export const escalateAlert = async (
  alertId: string, 
  userId: string, 
  supervisorId: string,
  reason?: string
): Promise<any> => {
  return withTransaction(async (txq) => {
    const result = await txq(`
      UPDATE alert_assignments 
      SET escalated_to = $3, 
          escalated_at = NOW(),
          escalation_reason = $4,
          resolution = 'escalated',
          status = 'escalated',
          updated_at = NOW()
      WHERE alert_id = $1 AND assigned_to = $2
      RETURNING *
    `, [alertId, userId, supervisorId, reason]);

    if (result[0]) {
      await txq(`
        UPDATE agent_sessions 
        SET current_alert_count = GREATEST(0, current_alert_count - 1),
            last_activity = NOW(), updated_at = NOW()
        WHERE user_id = $1
      `, [userId]);
    }

    return result[0];
  });
};

export const reassignAlert = async (alertId: string, newUserId: string, reason: string): Promise<any> => {
  const result = await withTransaction(async (txq) => {
    const current = await txq(`
      SELECT assigned_to FROM alert_assignments WHERE alert_id = $1
    `, [alertId]);
    const oldUserId = current[0]?.assigned_to;

    const updated = await txq(`
      UPDATE alert_assignments 
      SET assigned_to = $2, 
          assigned_at = NOW(),
          acknowledged_at = NULL,
          assignment_count = assignment_count + 1,
          status = 'assigned',
          updated_at = NOW()
      WHERE alert_id = $1
      RETURNING *
    `, [alertId, newUserId]);

    if (oldUserId) {
      await txq(`
        UPDATE agent_sessions SET current_alert_count = GREATEST(0, current_alert_count - 1),
          last_activity = NOW(), updated_at = NOW() WHERE user_id = $1
      `, [oldUserId]);
    }
    await txq(`
      UPDATE agent_sessions SET current_alert_count = GREATEST(0, current_alert_count + 1),
        last_activity = NOW(), updated_at = NOW() WHERE user_id = $1
    `, [newUserId]);

    return { row: updated[0], oldUserId };
  });

  if (result.row) {
    await recordAlertHistory(alertId, 'reassigned', 'system', {
      from: result.oldUserId,
      to: newUserId,
      reason,
    });
  }

  return result.row;
};

export const getAgentAlerts = async (userId: string): Promise<any[]> => {
  return queryPostgres(`
    SELECT * FROM alert_assignments 
    WHERE assigned_to = $1 
      AND status IN ('assigned', 'acknowledged')
      AND created_at >= NOW() - INTERVAL '24 hours'
    ORDER BY priority ASC, assigned_at ASC
  `, [userId]);
};

export const getPendingAlerts = async (): Promise<any[]> => {
  return queryPostgres(`
    SELECT * FROM alert_assignments 
    WHERE status = 'pending' AND assigned_to IS NULL
      AND created_at >= NOW() - INTERVAL '2 hours'
    ORDER BY priority ASC, created_at ASC
    LIMIT 100
  `);
};

export const getEscalatedAlerts = async (): Promise<any[]> => {
  return queryPostgres(`
    SELECT * FROM alert_assignments 
    WHERE status = 'escalated'
      AND escalated_at >= NOW() - INTERVAL '24 hours'
    ORDER BY escalated_at DESC
    LIMIT 50
  `);
};

export const getTimedOutAlerts = async (timeoutMinutes: number = 12): Promise<any[]> => {
  return queryPostgres(`
    SELECT * FROM alert_assignments 
    WHERE status = 'assigned' 
      AND acknowledged_at IS NULL
      AND assigned_at < NOW() - make_interval(mins => $1)
      AND created_at >= NOW() - INTERVAL '24 hours'
    ORDER BY assigned_at ASC
    LIMIT 50
  `, [timeoutMinutes]);
};

/**
 * Get acknowledged alerts that have not been resolved within the resolution timeout.
 */
export const getResolutionTimedOutAlerts = async (resolutionTimeoutMinutes: number = 30): Promise<any[]> => {
  return queryPostgres(`
    SELECT * FROM alert_assignments 
    WHERE status = 'acknowledged' 
      AND resolved_at IS NULL
      AND acknowledged_at < NOW() - make_interval(mins => $1)
      AND created_at >= NOW() - INTERVAL '24 hours'
    ORDER BY acknowledged_at ASC
    LIMIT 50
  `, [resolutionTimeoutMinutes]);
};

export const getAlertById = async (alertId: string): Promise<any> => {
  const result = await queryPostgres(`
    SELECT * FROM alert_assignments WHERE alert_id = $1
  `, [alertId]);
  return result[0];
};

// ============================================
// Alert History Functions
// ============================================

export const recordAlertHistory = async (
  alertId: string,
  action: string,
  performedBy: string,
  details?: any,
  handlingTimeSeconds?: number
): Promise<void> => {
  await queryPostgres(`
    INSERT INTO alert_history (alert_id, action, performed_by, details, handling_time_seconds, performed_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
  `, [alertId, action, performedBy, JSON.stringify(details || {}), handlingTimeSeconds]);
};

export const getAlertHistory = async (alertId: string): Promise<any[]> => {
  return queryPostgres(`
    SELECT * FROM alert_history 
    WHERE alert_id = $1 
    ORDER BY performed_at ASC
  `, [alertId]);
};

// ============================================
// Distribution Rules Functions
// ============================================

export const createDistributionRule = async (rule: {
  ruleType: string;
  ruleName: string;
  description?: string;
  config: any;
  priority?: number;
  createdBy: string;
}): Promise<any> => {
  const result = await queryPostgres(`
    INSERT INTO distribution_rules (rule_type, rule_name, description, config, priority, created_by, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    RETURNING *
  `, [rule.ruleType, rule.ruleName, rule.description, JSON.stringify(rule.config), rule.priority || 10, rule.createdBy]);
  
  return result[0];
};

export const getActiveDistributionRules = async (): Promise<any[]> => {
  return queryPostgres(`
    SELECT * FROM distribution_rules 
    WHERE is_active = TRUE 
    ORDER BY priority ASC
  `);
};

export const getAllDistributionRules = async (): Promise<any[]> => {
  return queryPostgres(`
    SELECT * FROM distribution_rules 
    ORDER BY is_active DESC, priority ASC
  `);
};

export const updateDistributionRule = async (ruleId: number, updates: any): Promise<any> => {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.config !== undefined)      { fields.push(`config = $${idx++}`);      values.push(JSON.stringify(updates.config)); }
  if (updates.isActive !== undefined)    { fields.push(`is_active = $${idx++}`);   values.push(updates.isActive); }
  if (updates.ruleName !== undefined)    { fields.push(`rule_name = $${idx++}`);   values.push(updates.ruleName); }
  if (updates.description !== undefined) { fields.push(`description = $${idx++}`); values.push(updates.description); }
  if (updates.priority !== undefined)    { fields.push(`priority = $${idx++}`);    values.push(updates.priority); }
  if (updates.ruleType !== undefined)    { fields.push(`rule_type = $${idx++}`);   values.push(updates.ruleType); }

  fields.push('updated_at = NOW()');
  values.push(ruleId);

  const result = await queryPostgres(
    `UPDATE distribution_rules SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return result[0];
};

export const deleteDistributionRule = async (ruleId: number): Promise<void> => {
  await queryPostgres(`DELETE FROM distribution_rules WHERE id = $1`, [ruleId]);
};

// ============================================
// Agent Performance Functions
// ============================================

export const updateAgentPerformance = async (
  userId: string,
  metrics: {
    alertsReceived?: number;
    alertsAcknowledged?: number;
    alertsResolved?: number;
    alertsEscalated?: number;
    alertsTimeout?: number;
    handlingTimeSeconds?: number;
  }
): Promise<void> => {
  await queryPostgres(`
    INSERT INTO agent_performance (user_id, date, alerts_received, alerts_acknowledged, alerts_resolved, alerts_escalated, alerts_timeout, total_handling_time_seconds)
    VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (user_id, date) DO UPDATE SET
      alerts_received = agent_performance.alerts_received + COALESCE($2, 0),
      alerts_acknowledged = agent_performance.alerts_acknowledged + COALESCE($3, 0),
      alerts_resolved = agent_performance.alerts_resolved + COALESCE($4, 0),
      alerts_escalated = agent_performance.alerts_escalated + COALESCE($5, 0),
      alerts_timeout = agent_performance.alerts_timeout + COALESCE($6, 0),
      total_handling_time_seconds = agent_performance.total_handling_time_seconds + COALESCE($7, 0)
  `, [
    userId,
    metrics.alertsReceived || 0,
    metrics.alertsAcknowledged || 0,
    metrics.alertsResolved || 0,
    metrics.alertsEscalated || 0,
    metrics.alertsTimeout || 0,
    metrics.handlingTimeSeconds || 0,
  ]);
};

export const getAgentPerformance = async (userId: string, days: number = 30): Promise<any[]> => {
  return queryPostgres(`
    SELECT * FROM agent_performance 
    WHERE user_id = $1 AND date >= CURRENT_DATE - make_interval(days => $2)
    ORDER BY date DESC
  `, [userId, days]);
};

export const getAllAgentPerformanceToday = async (): Promise<any[]> => {
  return queryPostgres(`
    SELECT 
      ap.*,
      as2.username,
      as2.status,
      as2.current_alert_count
    FROM agent_performance ap
    JOIN agent_sessions as2 ON ap.user_id = as2.user_id
    WHERE ap.date = CURRENT_DATE
    ORDER BY ap.alerts_resolved DESC
  `);
};

// ============================================
// Utility Functions
// ============================================

export const getDistributionStats = async (): Promise<any> => {
  const stats = await queryPostgres(`
    SELECT
      (SELECT COUNT(*) FROM agent_sessions WHERE status = 'online' AND role = 'agent') as online_agents,
      (SELECT COUNT(*) FROM agent_sessions WHERE status = 'break_requested' AND role = 'agent') as break_requested,
      (SELECT COUNT(*) FROM agent_sessions WHERE status = 'on_break' AND role = 'agent') as on_break,
      (SELECT COUNT(*) FROM alert_assignments WHERE status = 'pending' AND created_at >= NOW() - INTERVAL '2 hours') as pending_alerts,
      (SELECT COUNT(*) FROM alert_assignments WHERE status = 'assigned' AND created_at >= NOW() - INTERVAL '24 hours') as assigned_alerts,
      (SELECT COUNT(*) FROM alert_assignments WHERE status = 'acknowledged' AND created_at >= NOW() - INTERVAL '24 hours') as acknowledged_alerts,
      (SELECT COUNT(*) FROM alert_assignments WHERE status = 'escalated' AND escalated_at >= NOW() - INTERVAL '24 hours') as escalated_alerts,
      (SELECT COUNT(*) FROM alert_assignments WHERE status = 'resolved' AND DATE(resolved_at) = CURRENT_DATE) as resolved_today
  `);
  
  return stats[0];
};

/**
 * Expire stale alerts that are too old to be actionable.
 * - pending alerts older than 2 hours → expired
 * - assigned (unacknowledged) alerts older than 24 hours → expired
 * Returns the number of expired records.
 */
export const expireStaleAlerts = async (): Promise<number> => {
  const pendingResult = await queryPostgres(`
    UPDATE alert_assignments
    SET status = 'expired', resolution = 'auto_expired', updated_at = NOW()
    WHERE status = 'pending'
      AND created_at < NOW() - INTERVAL '2 hours'
    RETURNING alert_id
  `);

  // Expire assigned alerts AND collect which agents are affected
  const assignedResult = await queryPostgres(`
    UPDATE alert_assignments
    SET status = 'expired', resolution = 'auto_expired', updated_at = NOW()
    WHERE status = 'assigned'
      AND acknowledged_at IS NULL
      AND created_at < NOW() - INTERVAL '24 hours'
    RETURNING alert_id, assigned_to
  `);

  // Decrement counts for affected agents
  if (assignedResult && assignedResult.length > 0) {
    const agentCounts = new Map<string, number>();
    for (const row of assignedResult) {
      if (row.assigned_to) {
        agentCounts.set(row.assigned_to, (agentCounts.get(row.assigned_to) || 0) + 1);
      }
    }
    for (const [agentId, count] of agentCounts) {
      await updateAgentAlertCount(agentId, -count);
    }
  }

  return (pendingResult?.length || 0) + (assignedResult?.length || 0);
};

// ============================================
// Shift Scheduling Functions
// ============================================

export const upsertShiftSchedule = async (
  userId: string, dayOfWeek: number, startTime: string, endTime: string
): Promise<any> => {
  const result = await queryPostgres(`
    INSERT INTO shift_schedules (user_id, day_of_week, start_time, end_time, is_active)
    VALUES ($1, $2, $3, $4, TRUE)
    ON CONFLICT (user_id, day_of_week) DO UPDATE SET
      start_time = $3, end_time = $4, is_active = TRUE
    RETURNING *
  `, [userId, dayOfWeek, startTime, endTime]);
  return result[0];
};

export const getAgentShifts = async (userId: string): Promise<any[]> => {
  return queryPostgres(`SELECT * FROM shift_schedules WHERE user_id = $1 ORDER BY day_of_week`, [userId]);
};

export const getAllShifts = async (): Promise<any[]> => {
  return queryPostgres(`SELECT * FROM shift_schedules WHERE is_active = TRUE ORDER BY user_id, day_of_week`);
};

export const deleteShift = async (id: number): Promise<void> => {
  await queryPostgres(`DELETE FROM shift_schedules WHERE id = $1`, [id]);
};

/**
 * Returns agents who should be online based on their shift schedule for the current time.
 */
export const getAgentsOnShift = async (): Promise<string[]> => {
  const result = await queryPostgres(`
    SELECT DISTINCT user_id FROM shift_schedules
    WHERE is_active = TRUE
      AND day_of_week = EXTRACT(DOW FROM NOW())
      AND start_time <= LOCALTIME
      AND end_time > LOCALTIME
  `);
  return (result || []).map((r: any) => r.user_id);
};

// ============================================
// Alert Comments Functions
// ============================================

export const addAlertComment = async (
  alertId: string,
  userId: string,
  username: string,
  message: string
): Promise<any> => {
  const result = await queryPostgres(`
    INSERT INTO alert_comments (alert_id, user_id, username, message, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    RETURNING *
  `, [alertId, userId, username, message]);
  return result[0];
};

export const getAlertComments = async (alertId: string): Promise<any[]> => {
  return queryPostgres(`
    SELECT * FROM alert_comments
    WHERE alert_id = $1
    ORDER BY created_at ASC
  `, [alertId]);
};

/**
 * Archive old resolved/expired/escalated alerts and history older than retentionDays.
 */
export const archiveOldAlerts = async (retentionDays: number = 30): Promise<number> => {
  const historyResult = await queryPostgres(`
    DELETE FROM alert_history
    WHERE performed_at < NOW() - make_interval(days => $1)
    RETURNING id
  `, [retentionDays]);
  const alertResult = await queryPostgres(`
    DELETE FROM alert_assignments
    WHERE status IN ('resolved', 'expired', 'escalated')
      AND created_at < NOW() - make_interval(days => $1)
    RETURNING id
  `, [retentionDays]);
  return (historyResult?.length || 0) + (alertResult?.length || 0);
};

/**
 * Reconcile current_alert_count for all agents with actual active assignments.
 * Fixes any drift caused by edge cases (crashes, race conditions, etc.).
 */
export const reconcileAlertCounts = async (): Promise<number> => {
  const result = await queryPostgres(`
    UPDATE agent_sessions s
    SET current_alert_count = COALESCE(actual.cnt, 0),
        updated_at = NOW()
    FROM (
      SELECT assigned_to, COUNT(*) as cnt
      FROM alert_assignments
      WHERE status IN ('assigned', 'acknowledged')
        AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY assigned_to
    ) actual
    WHERE s.user_id = actual.assigned_to
      AND s.current_alert_count != actual.cnt
    RETURNING s.user_id, s.current_alert_count
  `);

  // Also zero out agents that have no active alerts but non-zero counts
  await queryPostgres(`
    UPDATE agent_sessions
    SET current_alert_count = 0, updated_at = NOW()
    WHERE current_alert_count > 0
      AND user_id NOT IN (
        SELECT DISTINCT assigned_to FROM alert_assignments
        WHERE status IN ('assigned', 'acknowledged')
          AND created_at >= NOW() - INTERVAL '24 hours'
          AND assigned_to IS NOT NULL
      )
  `);

  return result?.length || 0;
};

/**
 * Get the maximum eventlogid currently tracked in alert_assignments.
 * Used to seed the broadcaster's lastAlertId on startup so we don't re-process.
 */
export const getMaxTrackedAlertId = async (): Promise<string> => {
  try {
    const result = await queryPostgres(`
      SELECT MAX(CASE WHEN alert_id ~ '^[0-9]+$' THEN alert_id::bigint ELSE 0 END) as max_id
      FROM alert_assignments
    `);
    return result?.[0]?.max_id?.toString() || '0';
  } catch {
    return '0';
  }
};

// ============================================
// Alert Type Configuration (dynamic filter)
// ============================================

export interface AlertTypeConfig {
  id: number;
  event_name: string;
  category: string;
  severity: string;
  match_mode: string;
  enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const getAlertTypeConfigs = async (enabledOnly = false): Promise<AlertTypeConfig[]> => {
  const where = enabledOnly ? 'WHERE enabled = TRUE' : '';
  return queryPostgres(`SELECT * FROM alert_type_config ${where} ORDER BY category, event_name`);
};

export const createAlertTypeConfig = async (
  eventName: string,
  category: string,
  severity: string,
  matchMode: string,
  createdBy?: string,
): Promise<AlertTypeConfig> => {
  const result = await queryPostgres(
    `INSERT INTO alert_type_config (event_name, category, severity, match_mode, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [eventName, category, severity, matchMode, createdBy || null],
  );
  return result[0];
};

export const updateAlertTypeConfig = async (
  id: number,
  updates: Partial<Pick<AlertTypeConfig, 'event_name' | 'category' | 'severity' | 'match_mode' | 'enabled'>>,
): Promise<AlertTypeConfig> => {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.event_name !== undefined) { fields.push(`event_name = $${idx++}`); values.push(updates.event_name); }
  if (updates.category !== undefined)   { fields.push(`category = $${idx++}`);   values.push(updates.category); }
  if (updates.severity !== undefined)   { fields.push(`severity = $${idx++}`);   values.push(updates.severity); }
  if (updates.match_mode !== undefined) { fields.push(`match_mode = $${idx++}`); values.push(updates.match_mode); }
  if (updates.enabled !== undefined)    { fields.push(`enabled = $${idx++}`);    values.push(updates.enabled); }
  fields.push(`updated_at = NOW()`);
  values.push(id);

  const result = await queryPostgres(
    `UPDATE alert_type_config SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return result[0];
};

export const deleteAlertTypeConfig = async (id: number): Promise<void> => {
  await queryPostgres(`DELETE FROM alert_type_config WHERE id = $1`, [id]);
};

// ============================================
// Agent Call Logs
// ============================================

export const insertAgentCallLog = async (
  extension: string,
  callerId: string,
  callerIdName: string,
  consumerUuid: string,
  agentChannelUuid: string,
  crmUsername?: string,
): Promise<number> => {
  const result = await queryPostgres(`
    INSERT INTO agent_call_logs (agent_extension, crm_username, caller_id, caller_id_name, consumer_uuid, agent_channel_uuid)
    VALUES ($1, $6, $2, $3, $4, $5)
    RETURNING id
  `, [extension, callerId, callerIdName, consumerUuid, agentChannelUuid, crmUsername || null]);
  return result?.[0]?.id || 0;
};

export const updateAgentCallLogAnswered = async (logId: number): Promise<void> => {
  await queryPostgres(`
    UPDATE agent_call_logs
    SET outcome = 'answered', answered_at = NOW()
    WHERE id = $1 AND outcome = 'no_answer'
  `, [logId]);
};

export const updateAgentCallLogEnded = async (logId: number, hangupCause: string): Promise<void> => {
  await queryPostgres(`
    UPDATE agent_call_logs
    SET outcome = CASE
      WHEN outcome = 'answered' THEN 'answered'
      WHEN $2 IN ('ORIGINATOR_CANCEL','CALL_REJECTED','USER_BUSY') THEN 'rejected'
      ELSE 'missed'
    END,
    ended_at = NOW(),
    hangup_cause = $2,
    duration_seconds = COALESCE(
      EXTRACT(EPOCH FROM (NOW() - answered_at))::INT,
      0
    )
    WHERE id = $1
  `, [logId, hangupCause || 'NO_ANSWER']);
};

export const updateAgentCallLogMissedByDisconnect = async (extension: string): Promise<void> => {
  await queryPostgres(`
    UPDATE agent_call_logs
    SET outcome = 'missed', ended_at = NOW(), hangup_cause = 'WS_DISCONNECTED'
    WHERE agent_extension = $1 AND outcome = 'no_answer'
  `, [extension]);
};

export const getAgentCallLogs = async (
  extension?: string,
  from?: string,
  to?: string,
  outcome?: string,
  limit = 100,
  offset = 0,
): Promise<any[]> => {
  const conditions: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (extension) { conditions.push(`agent_extension = $${idx++}`); values.push(extension); }
  if (from)      { conditions.push(`ring_started_at >= $${idx++}`); values.push(from); }
  if (to)        { conditions.push(`ring_started_at <= $${idx++}`); values.push(to); }
  if (outcome)   { conditions.push(`outcome = $${idx++}`); values.push(outcome); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  values.push(limit, offset);

  return queryPostgres(`
    SELECT * FROM agent_call_logs
    ${where}
    ORDER BY ring_started_at DESC
    LIMIT $${idx++} OFFSET $${idx}
  `, values);
};
