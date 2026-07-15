# CDC Migration Plan: MSSQL → PostgreSQL

> **Status:** Planning  
> **Created:** January 29, 2026  
> **Priority:** High  

## Overview

Real-time Change Data Capture (CDC) pipeline to replicate data from multiple MSSQL Server instances to PostgreSQL using Debezium and Kafka.

## Architecture

```
┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│ MSSQL Sources        │     │ Kafka Cluster        │     │ PostgreSQL Target    │
│                      │     │                      │     │                      │
│ • 192.168.20.1       │────▶│ • Zookeeper          │────▶│ 192.168.20.186       │
│   - MobileApp        │     │ • Kafka Broker       │     │ Database: Tracking   │
│   - Tracking         │     │ • Debezium Connect   │     │                      │
│                      │     │ • JDBC Sink Connect  │     │ Replicated Tables:   │
│ • 192.168.21.33      │────▶│ • Schema Registry    │────▶│ • app_login          │
│   - tavl2            │     │ • Kafka UI           │     │ • notifications      │
│   - ERP_Tracking     │     │                      │     │ • console_warning    │
│                      │     │                      │     │ • vehicles           │
└──────────────────────┘     └──────────────────────┘     └──────────────────────┘
                                       │
                                       ▼
                              ┌──────────────────────┐
                              │ Applications         │
                              ├──────────────────────┤
                              │ • TAVL Lite (iCC)    │
                              │ • Mobile App API     │
                              │ • Analytics/Reports  │
                              │ • Future Apps        │
                              └──────────────────────┘
```

## Infrastructure Requirements

| Component | Resource | Notes |
|-----------|----------|-------|
| Kafka Broker | 4GB RAM, 100GB SSD | Single node for start |
| Zookeeper | 1GB RAM | Coordination service |
| Debezium Connect | 2GB RAM | Source connectors |
| JDBC Sink Connect | 2GB RAM | Target connector |
| Schema Registry | 1GB RAM | Schema management |

**Recommended Host:** PostgreSQL server (192.168.20.186) or dedicated VM

---

## Phase 1: MSSQL Preparation

### 1.1 Enable CDC on MobileApp Database (192.168.20.1)

```sql
USE MobileApp;
GO

-- Enable CDC on database
EXEC sys.sp_cdc_enable_db;
GO

-- Enable CDC on AppLogin table
EXEC sys.sp_cdc_enable_table 
    @source_schema = N'dbo',
    @source_name = N'AppLogin',
    @role_name = NULL,
    @supports_net_changes = 1;
GO

-- Enable CDC on Notifications table
EXEC sys.sp_cdc_enable_table 
    @source_schema = N'dbo',
    @source_name = N'Notifications',
    @role_name = NULL,
    @supports_net_changes = 1;
GO

-- Enable CDC on NotificationTypes table
EXEC sys.sp_cdc_enable_table 
    @source_schema = N'dbo',
    @source_name = N'NotificationTypes',
    @role_name = NULL,
    @supports_net_changes = 1;
GO
```

### 1.2 Enable CDC on Tracking Database (192.168.20.1)

```sql
USE Tracking;
GO

EXEC sys.sp_cdc_enable_db;
GO

EXEC sys.sp_cdc_enable_table 
    @source_schema = N'dbo',
    @source_name = N'ConsoleWarning',
    @role_name = NULL,
    @supports_net_changes = 1;
GO
```

### 1.3 Enable CDC on tavl2 Database (192.168.21.33)

```sql
USE tavl2;
GO

EXEC sys.sp_cdc_enable_db;
GO

EXEC sys.sp_cdc_enable_table 
    @source_schema = N'dbo',
    @source_name = N'Objects',
    @role_name = NULL,
    @supports_net_changes = 1;
GO
```

### 1.4 Verify CDC is Enabled

```sql
-- Check databases with CDC enabled
SELECT name, is_cdc_enabled FROM sys.databases WHERE is_cdc_enabled = 1;

-- Check tables with CDC enabled
SELECT * FROM cdc.change_tables;
```

### 1.5 Ensure SQL Server Agent is Running

CDC relies on SQL Server Agent jobs. Verify it's running:
```sql
EXEC xp_servicecontrol 'QueryState', 'SQLServerAgent';
```

---

## Phase 2: Kafka Infrastructure Setup

### 2.1 Docker Compose File

Create `/opt/kafka-cdc/docker-compose.yml`:

```yaml
version: '3.8'

services:
  zookeeper:
    image: confluentinc/cp-zookeeper:7.5.0
    container_name: zookeeper
    restart: unless-stopped
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
      ZOOKEEPER_TICK_TIME: 2000
    ports:
      - "2181:2181"
    volumes:
      - zookeeper-data:/var/lib/zookeeper/data
      - zookeeper-logs:/var/lib/zookeeper/log
    networks:
      - kafka-network

  kafka:
    image: confluentinc/cp-kafka:7.5.0
    container_name: kafka
    restart: unless-stopped
    depends_on:
      - zookeeper
    ports:
      - "9092:9092"
      - "29092:29092"
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092,PLAINTEXT_HOST://192.168.20.186:29092
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT
      KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
      KAFKA_LOG_RETENTION_HOURS: 168
      KAFKA_LOG_RETENTION_BYTES: 10737418240
      KAFKA_NUM_PARTITIONS: 6
    volumes:
      - kafka-data:/var/lib/kafka/data
    networks:
      - kafka-network

  schema-registry:
    image: confluentinc/cp-schema-registry:7.5.0
    container_name: schema-registry
    restart: unless-stopped
    depends_on:
      - kafka
    ports:
      - "8081:8081"
    environment:
      SCHEMA_REGISTRY_HOST_NAME: schema-registry
      SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS: kafka:9092
    networks:
      - kafka-network

  debezium-connect:
    image: debezium/connect:2.4
    container_name: debezium-connect
    restart: unless-stopped
    depends_on:
      - kafka
      - schema-registry
    ports:
      - "8083:8083"
    environment:
      GROUP_ID: 1
      CONFIG_STORAGE_TOPIC: debezium_configs
      OFFSET_STORAGE_TOPIC: debezium_offsets
      STATUS_STORAGE_TOPIC: debezium_statuses
      BOOTSTRAP_SERVERS: kafka:9092
      KEY_CONVERTER: org.apache.kafka.connect.json.JsonConverter
      VALUE_CONVERTER: org.apache.kafka.connect.json.JsonConverter
      CONNECT_KEY_CONVERTER_SCHEMAS_ENABLE: "false"
      CONNECT_VALUE_CONVERTER_SCHEMAS_ENABLE: "false"
    networks:
      - kafka-network

  jdbc-sink:
    image: quay.io/debezium/connect:2.4
    container_name: jdbc-sink
    restart: unless-stopped
    depends_on:
      - kafka
    ports:
      - "8084:8083"
    environment:
      GROUP_ID: 2
      CONFIG_STORAGE_TOPIC: jdbc_sink_configs
      OFFSET_STORAGE_TOPIC: jdbc_sink_offsets
      STATUS_STORAGE_TOPIC: jdbc_sink_statuses
      BOOTSTRAP_SERVERS: kafka:9092
    volumes:
      - ./jdbc-drivers:/kafka/connect/jdbc-drivers
    networks:
      - kafka-network

  kafka-ui:
    image: provectuslabs/kafka-ui:latest
    container_name: kafka-ui
    restart: unless-stopped
    depends_on:
      - kafka
      - schema-registry
    ports:
      - "8080:8080"
    environment:
      KAFKA_CLUSTERS_0_NAME: tavl-cdc
      KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:9092
      KAFKA_CLUSTERS_0_SCHEMAREGISTRY: http://schema-registry:8081
    networks:
      - kafka-network

networks:
  kafka-network:
    driver: bridge

volumes:
  zookeeper-data:
  zookeeper-logs:
  kafka-data:
```

### 2.2 Download JDBC Drivers

```bash
mkdir -p /opt/kafka-cdc/jdbc-drivers
cd /opt/kafka-cdc/jdbc-drivers

# PostgreSQL JDBC driver
curl -O https://jdbc.postgresql.org/download/postgresql-42.6.0.jar
```

### 2.3 Start the Stack

```bash
cd /opt/kafka-cdc
docker-compose up -d

# Verify all containers are running
docker-compose ps
```

---

## Phase 3: Configure Debezium Source Connectors

### 3.1 MobileApp Connector (192.168.20.1)

Create `/opt/kafka-cdc/connectors/mssql-mobileapp.json`:

```json
{
  "name": "mssql-mobileapp-connector",
  "config": {
    "connector.class": "io.debezium.connector.sqlserver.SqlServerConnector",
    "tasks.max": "1",
    
    "database.hostname": "192.168.20.1",
    "database.port": "1433",
    "database.user": "sa",
    "database.password": "iteck@12",
    "database.names": "MobileApp",
    "topic.prefix": "mobileapp",
    
    "table.include.list": "dbo.AppLogin,dbo.Notifications,dbo.NotificationTypes",
    
    "schema.history.internal.kafka.bootstrap.servers": "kafka:9092",
    "schema.history.internal.kafka.topic": "schema-history.mobileapp",
    
    "transforms": "unwrap",
    "transforms.unwrap.type": "io.debezium.transforms.ExtractNewRecordState",
    "transforms.unwrap.drop.tombstones": "false",
    "transforms.unwrap.delete.handling.mode": "rewrite",
    
    "snapshot.mode": "initial",
    "decimal.handling.mode": "double",
    "time.precision.mode": "connect",
    
    "max.batch.size": "2048",
    "max.queue.size": "8192",
    "poll.interval.ms": "100"
  }
}
```

### 3.2 Tracking Connector (192.168.20.1)

Create `/opt/kafka-cdc/connectors/mssql-tracking.json`:

```json
{
  "name": "mssql-tracking-connector",
  "config": {
    "connector.class": "io.debezium.connector.sqlserver.SqlServerConnector",
    "tasks.max": "1",
    
    "database.hostname": "192.168.20.1",
    "database.port": "1433",
    "database.user": "sa",
    "database.password": "iteck@12",
    "database.names": "Tracking",
    "topic.prefix": "tracking",
    
    "table.include.list": "dbo.ConsoleWarning",
    
    "schema.history.internal.kafka.bootstrap.servers": "kafka:9092",
    "schema.history.internal.kafka.topic": "schema-history.tracking",
    
    "transforms": "unwrap",
    "transforms.unwrap.type": "io.debezium.transforms.ExtractNewRecordState",
    "transforms.unwrap.drop.tombstones": "false",
    "transforms.unwrap.delete.handling.mode": "rewrite",
    
    "snapshot.mode": "initial",
    "decimal.handling.mode": "double"
  }
}
```

### 3.3 TAVL2 Connector (192.168.21.33)

Create `/opt/kafka-cdc/connectors/mssql-tavl2.json`:

```json
{
  "name": "mssql-tavl2-connector",
  "config": {
    "connector.class": "io.debezium.connector.sqlserver.SqlServerConnector",
    "tasks.max": "1",
    
    "database.hostname": "192.168.21.33",
    "database.port": "1433",
    "database.user": "sa",
    "database.password": "iteck@1212",
    "database.names": "tavl2",
    "topic.prefix": "tavl2",
    
    "table.include.list": "dbo.Objects",
    
    "schema.history.internal.kafka.bootstrap.servers": "kafka:9092",
    "schema.history.internal.kafka.topic": "schema-history.tavl2",
    
    "transforms": "unwrap",
    "transforms.unwrap.type": "io.debezium.transforms.ExtractNewRecordState",
    "transforms.unwrap.drop.tombstones": "false",
    "transforms.unwrap.delete.handling.mode": "rewrite",
    
    "snapshot.mode": "initial",
    "decimal.handling.mode": "double"
  }
}
```

### 3.4 Register Source Connectors

```bash
# Register MobileApp connector
curl -X POST http://localhost:8083/connectors \
  -H "Content-Type: application/json" \
  -d @/opt/kafka-cdc/connectors/mssql-mobileapp.json

# Register Tracking connector
curl -X POST http://localhost:8083/connectors \
  -H "Content-Type: application/json" \
  -d @/opt/kafka-cdc/connectors/mssql-tracking.json

# Register TAVL2 connector
curl -X POST http://localhost:8083/connectors \
  -H "Content-Type: application/json" \
  -d @/opt/kafka-cdc/connectors/mssql-tavl2.json
```

---

## Phase 4: Configure JDBC Sink Connector (PostgreSQL)

### 4.1 PostgreSQL Sink Connector

Create `/opt/kafka-cdc/connectors/postgres-sink.json`:

```json
{
  "name": "postgres-sink-connector",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSinkConnector",
    "tasks.max": "3",
    
    "connection.url": "jdbc:postgresql://192.168.20.186:5432/Tracking",
    "connection.user": "admin",
    "connection.password": "admin123",
    
    "topics": "mobileapp.MobileApp.dbo.AppLogin,mobileapp.MobileApp.dbo.Notifications,mobileapp.MobileApp.dbo.NotificationTypes,tracking.Tracking.dbo.ConsoleWarning,tavl2.tavl2.dbo.Objects",
    
    "auto.create": "true",
    "auto.evolve": "true",
    "insert.mode": "upsert",
    "pk.mode": "record_key",
    
    "table.name.format": "cdc_${topic}",
    
    "batch.size": "1000",
    "max.retries": "10",
    "retry.backoff.ms": "3000"
  }
}
```

### 4.2 Register Sink Connector

```bash
curl -X POST http://localhost:8084/connectors \
  -H "Content-Type: application/json" \
  -d @/opt/kafka-cdc/connectors/postgres-sink.json
```

---

## Phase 5: Verification & Monitoring

### 5.1 Check Connector Status

```bash
# Source connectors
curl http://localhost:8083/connectors/mssql-mobileapp-connector/status | jq
curl http://localhost:8083/connectors/mssql-tracking-connector/status | jq
curl http://localhost:8083/connectors/mssql-tavl2-connector/status | jq

# Sink connector
curl http://localhost:8084/connectors/postgres-sink-connector/status | jq
```

### 5.2 List Kafka Topics

```bash
docker exec kafka kafka-topics --list --bootstrap-server localhost:9092
```

### 5.3 View Messages

```bash
# View AppLogin changes
docker exec kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic mobileapp.MobileApp.dbo.AppLogin \
  --from-beginning --max-messages 5
```

### 5.4 Verify PostgreSQL Data

```sql
-- Connect to PostgreSQL
psql -h 192.168.20.186 -U admin -d Tracking

-- Check replicated tables
\dt cdc_*

-- Query replicated data
SELECT COUNT(*) FROM cdc_mobileapp_mobileapp_dbo_applogin;
SELECT * FROM cdc_mobileapp_mobileapp_dbo_notifications LIMIT 10;
```

### 5.5 Kafka UI Dashboard

Access at: `http://192.168.20.186:8080`

Monitor:
- Topic throughput
- Consumer lag
- Connector health
- Message browsing

---

## Tables to Replicate

| Source Server | Database | Table | Target Table | Priority | Est. Rows |
|---------------|----------|-------|--------------|----------|-----------|
| 192.168.20.1 | MobileApp | AppLogin | cdc_applogin | High | 92K |
| 192.168.20.1 | MobileApp | Notifications | cdc_notifications | High | 10M+ |
| 192.168.20.1 | MobileApp | NotificationTypes | cdc_notification_types | Low | ~12 |
| 192.168.20.1 | Tracking | ConsoleWarning | cdc_console_warning | High | ~500K |
| 192.168.21.33 | tavl2 | Objects | cdc_objects | Medium | ~50K |
| 192.168.21.33 | ERP_Tracking | Customer | cdc_customer | Medium | ~30K |

---

## Expected Performance

| Metric | Value |
|--------|-------|
| End-to-end latency | 100-500ms |
| Throughput | 10,000+ events/sec |
| Recovery time | Automatic from last offset |
| Data retention in Kafka | 7 days |

---

## Rollback Plan

If issues occur:

1. **Stop sink connector:**
   ```bash
   curl -X DELETE http://localhost:8084/connectors/postgres-sink-connector
   ```

2. **Stop source connectors:**
   ```bash
   curl -X DELETE http://localhost:8083/connectors/mssql-mobileapp-connector
   ```

3. **Applications fall back to direct MSSQL queries** (existing connections still work)

4. **Disable CDC on MSSQL** (if needed):
   ```sql
   EXEC sys.sp_cdc_disable_table @source_schema = 'dbo', @source_name = 'TableName', @capture_instance = 'all';
   EXEC sys.sp_cdc_disable_db;
   ```

---

## Future Enhancements

- [ ] Add ERP_Tracking tables (CRM data)
- [ ] Set up Kafka cluster (multi-broker) for HA
- [ ] Implement dead letter queue for failed messages
- [ ] Add Prometheus/Grafana monitoring
- [ ] Create views in PostgreSQL for easier querying
- [ ] Update TAVL Lite to query from PostgreSQL replica

---

## Contacts

- **Infrastructure:** [Your Name]
- **Database Admin:** [DBA Name]
- **Application Team:** [Dev Team]

---

## Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-29 | 1.0 | Initial plan created |
